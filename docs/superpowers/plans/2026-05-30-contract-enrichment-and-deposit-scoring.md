# Contract Enrichment and Incoming Deposit Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce false `DECLINE` decisions by enriching unknown contracts before classification, using DeepSeek only for ambiguous contract facts, and lowering unresolved-clean-origin scoring.

**Architecture:** Incoming-deposit provenance will first use deterministic enrichment and service classification. If a contract remains ambiguous, a strict fact-only LLM case file is built. Scoring then combines hard evidence, service/LLM verdicts, sender role, coverage, and adaptive depth without treating unresolved clean origin as hard risk.

**Tech Stack:** TypeScript, Node.js, PostgreSQL repositories, TronScan client, DeepSeek OpenAI-compatible JSON client, Vitest.

---

## File Structure

- Modify `src/types.ts`
  - Add service/protocol categories if needed.
  - Keep user-facing decisions as `ACCEPTABLE | DECLINE`.

- Modify `src/forensics/serviceClassifier.ts`
  - Add GasFree, permit-transfer, USDD, PSM, GemJoin, and stablecoin protocol patterns.
  - Keep bridge/router/DEX hard-boundary behavior unchanged.

- Create `src/forensics/contractEnrichment.ts`
  - Centralize live contract profile refresh for unknown contract candidates.
  - Return enriched metadata/profile/classification.

- Modify `src/forensics/incomingDepositJob.ts`
  - Add live contract enrichment deps.
  - Use adaptive depth budgets.
  - Pass enriched contract facts into contract context analysis.

- Modify `src/forensics/incomingDepositContractContext.ts`
  - Build richer case files with metadata, provider tags, method map, tx details, and cashflow path.
  - Call LLM only when deterministic classification remains unknown/ambiguous.

- Modify `src/forensics/incomingDepositRisk.ts`
  - Lower unresolved EOA-chain fallback risk.
  - Let legitimate service verdicts reduce unknown-contract risk.
  - Preserve hard-decline policy.

- Modify `src/index.ts` and `src/bot/createBot.ts`
  - Wire new deps into runtime and bot/manual check flows.

- Tests:
  - `tests/forensics/serviceClassifier.test.ts`
  - `tests/forensics/contractEnrichment.test.ts`
  - `tests/forensics/incomingDepositRisk.test.ts`
  - `tests/forensics/incomingDepositJob.test.ts`
  - `tests/alerts/formatters.test.ts`

---

### Task 1: Expand Deterministic Service Classification

**Files:**
- Modify: `src/types.ts`
- Modify: `src/forensics/serviceClassifier.ts`
- Test: `tests/forensics/serviceClassifier.test.ts`

- [ ] **Step 1: Write failing classifier tests**

Add tests:

```ts
import { describe, expect, it } from "vitest";
import { classifyServiceAddress } from "../../src/forensics/serviceClassifier";

describe("classifyServiceAddress service/protocol patterns", () => {
  it("classifies GasFree Account as a service boundary", () => {
    const result = classifyServiceAddress({
      address: "TBUjhWxMAvB77CeS4TXSCTjtRbeuLmVSZ9",
      metadata: {
        address: "TBUjhWxMAvB77CeS4TXSCTjtRbeuLmVSZ9",
        name: "CreatedByContract",
        tag: null,
        isContract: true,
        verified: false
      },
      contractProfile: {
        contractAddress: "TBUjhWxMAvB77CeS4TXSCTjtRbeuLmVSZ9",
        address: "TBUjhWxMAvB77CeS4TXSCTjtRbeuLmVSZ9",
        name: "CreatedByContract",
        serviceTag: null,
        publicTag: null,
        publicTagDesc: null,
        providerTags: [{ kind: "greyTag", label: "GasFree Account", url: null }],
        publicTags: [],
        isVerified: false,
        verified: false,
        verifyStatus: 0,
        sourceStatus: null,
        topMethods: [],
        methodMap: { "6f21b898": "permitTransfer(address token,address user,address receiver,uint256 value,uint256 maxFee,uint256 deadline,uint256 version,uint256 nonce,bytes sig)" },
        hasTransferFromSelector: false,
        hasOwnerOnlyPattern: false
      } as any
    });

    expect(result.category).toBe("service");
    expect(result.identity).toContain("GasFree");
    expect(result.isBoundary).toBe(true);
  });

  it("classifies USDD PSM GemJoin as a protocol boundary", () => {
    const result = classifyServiceAddress({
      address: "TSUYvQ3H...",
      metadata: {
        address: "TSUYvQ3H...",
        name: null,
        tag: "USDD: PSM GemJoin (USDT)",
        isContract: true,
        verified: true
      },
      contractProfile: null
    });

    expect(result.category).toBe("protocol");
    expect(result.identity).toBe("USDD: PSM GemJoin (USDT)");
    expect(result.isBoundary).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/forensics/serviceClassifier.test.ts
```

Expected: tests fail because `service` and `protocol` categories do not exist or are not returned.

- [ ] **Step 3: Add service categories**

Modify `src/types.ts`:

```ts
export type ServiceCategory =
  | "bridge"
  | "bridge_pool"
  | "dex"
  | "router"
  | "cex"
  | "hot_wallet"
  | "swap_adapter"
  | "service"
  | "protocol"
  | "unknown_contract"
  | "none";
```

- [ ] **Step 4: Implement classifier rules**

In `src/forensics/serviceClassifier.ts`, add these checks before `weakContract(input)`. Keep `methodMap` out of the global classifier text. Method names are supporting evidence only after a service/protocol identity has matched through metadata/profile tags/name.

```ts
  const identityText = [metadataText, tagText].join(" ");
  const supportingMethods = [methodsOriginal, methodMapText(input.contractProfile)].filter(Boolean).join(" ").toLowerCase();

  if (hasAny(identityText, ["gasfree", "gas free", "smart account", "account abstraction", "fee account"])) {
    evidence.push("tag:gasfree_service");
    if (hasAny(supportingMethods, ["permittransfer"])) evidence.push("method:permittransfer");
    return classification(input, "service", identityFor(input, "GasFree service"), confidenceFor(input, true), evidence);
  }

  if (hasAny(text, ["usdd", "psm", "gemjoin", "gem join", "stablecoin module", "stablecoin protocol"])) {
    evidence.push("tag:stablecoin_protocol");
    return classification(input, "protocol", identityFor(input, "stablecoin protocol"), confidenceFor(input, true), evidence);
  }

  if (hasAny(text, ["justlend", "just lend"])) {
    evidence.push("tag:lending_protocol");
    return classification(input, "protocol", identityFor(input, "lending protocol"), confidenceFor(input, true), evidence);
  }
```

Add two false-positive regression tests:

```ts
it("does not classify method-only permitTransfer contracts as GasFree service boundaries", () => {
  const result = classifyServiceAddress({
    address: "TPermitOnly11111111111111111111111111",
    metadata: {
      address: "TPermitOnly11111111111111111111111111",
      name: "CreatedByContract",
      tag: null,
      isContract: true,
      verified: false
    },
    contractProfile: {
      serviceTag: null,
      publicTag: null,
      providerTags: [],
      publicTags: [],
      verified: false,
      providerRisk: false,
      hasTransferFromSelector: true,
      lowMetadata: true,
      activityLevel: "low",
      methodMap: { a1b2c3d4: "permitTransfer(address,address,uint256,uint256,bytes)" },
      topMethods: []
    } as any
  });

  expect(result.category).toBe("unknown_contract");
});

it("does not classify methodMap-only bridge pool methods as service boundaries", () => {
  const result = classifyServiceAddress({
    address: "TMethodMapOnly11111111111111111111111",
    metadata: {
      address: "TMethodMapOnly11111111111111111111111",
      name: null,
      tag: null,
      isContract: true,
      verified: false
    },
    contractProfile: {
      serviceTag: null,
      publicTag: null,
      providerTags: [],
      publicTags: [],
      verified: false,
      providerRisk: false,
      hasTransferFromSelector: true,
      lowMetadata: true,
      activityLevel: "low",
      methodMap: {
        a1b2c3d4: "ClaimRewards()",
        b2c3d4e5: "Deposit(uint256)",
        c3d4e5f6: "Withdraw(uint256)"
      },
      topMethods: []
    } as any
  });

  expect(result.category).toBe("unknown_contract");
});
```

- [ ] **Step 5: Keep hard-boundary helper unchanged**

Confirm `isServiceBoundary()` still returns true for every category except `none`.

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run tests/forensics/serviceClassifier.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/forensics/serviceClassifier.ts tests/forensics/serviceClassifier.test.ts
git commit -m "feat: classify gasfree and protocol service boundaries"
```

---

### Task 2: Add Live Contract Enrichment Before LLM

**Files:**
- Create: `src/forensics/contractEnrichment.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `src/index.ts`
- Modify: `src/bot/createBot.ts`
- Test: `tests/forensics/contractEnrichment.test.ts`

- [ ] **Step 1: Write failing enrichment tests**

Create `tests/forensics/contractEnrichment.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { enrichContractClassification } from "../../src/forensics/contractEnrichment";

describe("enrichContractClassification", () => {
  it("fetches live profile when cached profile is missing and reclassifies GasFree", async () => {
    const upsertProfile = vi.fn().mockResolvedValue(undefined);
    const result = await enrichContractClassification({
      address: "TBUjhWxMAvB77CeS4TXSCTjtRbeuLmVSZ9",
      getMetadata: vi.fn().mockResolvedValue({
        address: "TBUjhWxMAvB77CeS4TXSCTjtRbeuLmVSZ9",
        name: "CreatedByContract",
        tag: null,
        isContract: true,
        verified: false
      }),
      getCachedProfile: vi.fn().mockResolvedValue(null),
      fetchLiveProfile: vi.fn().mockResolvedValue({
        contractAddress: "TBUjhWxMAvB77CeS4TXSCTjtRbeuLmVSZ9",
        address: "TBUjhWxMAvB77CeS4TXSCTjtRbeuLmVSZ9",
        name: "CreatedByContract",
        providerTags: [{ kind: "greyTag", label: "GasFree Account", url: null }],
        publicTags: [],
        topMethods: [],
        methodMap: { "6f21b898": "permitTransfer(address token,address user,address receiver,uint256 value,uint256 maxFee,uint256 deadline,uint256 version,uint256 nonce,bytes sig)" }
      } as any),
      upsertProfile,
      now: () => new Date("2026-05-30T00:00:00.000Z")
    });

    expect(result.classification.category).toBe("service");
    expect(result.classification.identity).toContain("GasFree");
    expect(result.profileSource).toBe("live");
    expect(upsertProfile).toHaveBeenCalledOnce();
  });

  it("does not call live fetch when cached profile already classifies a service", async () => {
    const fetchLiveProfile = vi.fn();
    const result = await enrichContractClassification({
      address: "TSUYvQ3H...",
      getMetadata: vi.fn().mockResolvedValue({
        address: "TSUYvQ3H...",
        name: null,
        tag: "USDD: PSM GemJoin (USDT)",
        isContract: true,
        verified: true
      }),
      getCachedProfile: vi.fn().mockResolvedValue(null),
      fetchLiveProfile,
      upsertProfile: vi.fn(),
      now: () => new Date("2026-05-30T00:00:00.000Z")
    });

    expect(result.classification.category).toBe("protocol");
    expect(fetchLiveProfile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/forensics/contractEnrichment.test.ts
```

Expected: FAIL because `contractEnrichment.ts` does not exist.

- [ ] **Step 3: Implement enrichment module**

Create `src/forensics/contractEnrichment.ts`:

```ts
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import type { ServiceClassification } from "../types";
import type { ServiceAddressMetadata } from "./serviceClassifier";
import { classifyServiceAddress } from "./serviceClassifier";

export type ContractEnrichmentResult = {
  address: string;
  metadata: ServiceAddressMetadata | null;
  contractProfile: ContractRiskContext | null;
  classification: ServiceClassification;
  profileSource: "cache" | "live" | "none";
  liveFetchError: string | null;
};

export type EnrichContractClassificationInput = {
  address: string;
  getMetadata(address: string): Promise<ServiceAddressMetadata | null>;
  getCachedProfile(address: string, now: Date): Promise<ContractRiskContext | null>;
  fetchLiveProfile(address: string, now: Date): Promise<ContractRiskContext | null>;
  upsertProfile(profile: ContractRiskContext): Promise<void>;
  now?: () => Date;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isKnownBoundary(classification: ServiceClassification): boolean {
  return classification.category !== "none" && classification.category !== "unknown_contract";
}

export async function enrichContractClassification(input: EnrichContractClassificationInput): Promise<ContractEnrichmentResult> {
  const now = input.now?.() ?? new Date();
  const metadata = await input.getMetadata(input.address).catch(() => null);
  const cachedProfile = await input.getCachedProfile(input.address, now).catch(() => null);
  const cachedClassification = classifyServiceAddress({
    address: input.address,
    metadata,
    contractProfile: cachedProfile
  });

  if (isKnownBoundary(cachedClassification)) {
    return {
      address: input.address,
      metadata,
      contractProfile: cachedProfile,
      classification: cachedClassification,
      profileSource: cachedProfile ? "cache" : "none",
      liveFetchError: null
    };
  }

  let liveProfile: ContractRiskContext | null = null;
  let liveFetchError: string | null = null;
  try {
    liveProfile = await input.fetchLiveProfile(input.address, now);
    if (liveProfile) {
      await input.upsertProfile(liveProfile).catch(() => undefined);
    }
  } catch (error) {
    liveFetchError = errorMessage(error);
  }

  const profile = liveProfile ?? cachedProfile;
  return {
    address: input.address,
    metadata,
    contractProfile: profile,
    classification: classifyServiceAddress({
      address: input.address,
      metadata,
      contractProfile: profile
    }),
    profileSource: liveProfile ? "live" : cachedProfile ? "cache" : "none",
    liveFetchError
  };
}
```

- [ ] **Step 4: Wire runtime deps**

Extend `IncomingDepositRuntimeDeps` in `src/forensics/incomingDepositJob.ts`:

```ts
  enrichContractClassification?(address: string): Promise<ContractEnrichmentResult>;
```

Import the type:

```ts
import type { ContractEnrichmentResult } from "./contractEnrichment";
```

- [ ] **Step 5: Wire `src/index.ts`**

Add dependency:

```ts
enrichContractClassification: (address) => enrichContractClassification({
  address,
  getMetadata: (candidate) => getCachedOrLiveAddressMetadata(candidate),
  getCachedProfile: (candidate, now) => getContractIntelligenceProfile(db, candidate, now),
  fetchLiveProfile: (candidate, now) => tronClient.getContractIntelligenceProfile(candidate, { now }),
  upsertProfile: (profile) => upsertContractIntelligenceProfile(db, profile)
})
```

Add imports:

```ts
import { enrichContractClassification } from "./forensics/contractEnrichment";
import { upsertContractIntelligenceProfile } from "./storage/repositories";
```

- [ ] **Step 6: Wire `src/bot/createBot.ts`**

Use the same dependency pattern as `src/index.ts`, with the bot's existing `db`, `tronClient`, and metadata resolver.

- [ ] **Step 7: Run tests**

Run:

```bash
npx vitest run tests/forensics/contractEnrichment.test.ts tests/forensics/serviceClassifier.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/forensics/contractEnrichment.ts src/forensics/incomingDepositJob.ts src/index.ts src/bot/createBot.ts tests/forensics/contractEnrichment.test.ts
git commit -m "feat: enrich contract classification before llm"
```

---

### Task 3: Enrich Unknown Contract Case Files

**Files:**
- Modify: `src/forensics/incomingDepositContractContext.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Write failing case-file test**

Add a test that builds an incoming deposit path with `unknown_contract_reached`, stubs enrichment to return GasFree classification/profile, and expects no LLM case file for a resolved GasFree service.

```ts
it("does not call LLM when live enrichment resolves an unknown contract as GasFree", async () => {
  const analyzeContractLlmCaseFiles = vi.fn();
  const report = await buildIncomingDepositReport({
    deps: makeIncomingDepositDeps({
      enrichContractClassification: vi.fn().mockResolvedValue({
        address: "TBUjhWxMAvB77CeS4TXSCTjtRbeuLmVSZ9",
        metadata: { address: "TBUjhWxMAvB77CeS4TXSCTjtRbeuLmVSZ9", name: "CreatedByContract", tag: null, isContract: true, verified: false },
        contractProfile: { providerTags: [{ kind: "greyTag", label: "GasFree Account", url: null }], methodMap: { "6f21b898": "permitTransfer(...)" } } as any,
        classification: { category: "service", identity: "GasFree service", confidence: "medium", evidence: ["tag:gasfree_service"], isBoundary: true },
        profileSource: "live",
        liveFetchError: null
      }),
      analyzeContractLlmCaseFiles
    }),
    job: makeIncomingDepositJob(),
    depositTxHash: "deposit-tx",
    watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
    sender: "TMw3M7hdB4nFjXYCUDc286gBPcjBJSGwe7",
    amountRaw: "518054000000",
    timestamp: new Date("2026-05-21T13:29:21.000Z")
  });

  expect(analyzeContractLlmCaseFiles).not.toHaveBeenCalled();
  expect(report.contractVerdicts).toEqual([]);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts
```

Expected: FAIL because enrichment is not used.

- [ ] **Step 3: Apply enrichment in contract context**

In `analyzeIncomingDepositContracts`, before creating an LLM case file for a contract:

```ts
const enrichment = input.enrichContractClassification
  ? await input.enrichContractClassification(contractAddress).catch(() => null)
  : null;

if (enrichment && enrichment.classification.category !== "unknown_contract") {
  continue;
}
```

Extend `AnalyzeIncomingDepositContractsInput`:

```ts
  enrichContractClassification?(address: string): Promise<ContractEnrichmentResult>;
```

Include enriched metadata/profile in the case file when still unknown:

```ts
contractProfile: {
  ...(profile ? { intelligenceProfile: profile } : {}),
  ...(enrichment ? {
    enrichment: {
      profileSource: enrichment.profileSource,
      liveFetchError: enrichment.liveFetchError,
      classification: enrichment.classification,
      metadata: enrichment.metadata
    }
  } : {}),
  incomingDepositContext: { ... }
}
```

- [ ] **Step 4: Pass enrichment from job**

In `buildIncomingDepositReport`, pass:

```ts
enrichContractClassification: input.deps.enrichContractClassification
```

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/forensics/incomingDepositContractContext.ts src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "feat: enrich incoming deposit contract cases"
```

---

### Task 4: Calibrate Incoming Deposit Scoring

**Files:**
- Modify: `src/forensics/incomingDepositRisk.ts`
- Test: `tests/forensics/incomingDepositRisk.test.ts`

- [ ] **Step 1: Write failing score tests**

Add tests:

```ts
it("keeps unresolved EOA-only provenance acceptable when no hard bad evidence exists", () => {
  const report = buildIncomingDepositRiskReport({
    depositTxHash: "tx",
    watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
    sender: "TDdyV5tKFP5gR2n9GUrveioT1jBeLeRPem",
    amountRaw: "1000000000000",
    fastSenderRisk: { subjectAddress: "sender", score: 0, level: "LOW", reasons: [] },
    originPaths: [{
      verdict: "ACCEPTABLE",
      score: 35,
      sourcePolicy: "unknown",
      stoppedReason: "data_budget_exhausted",
      pathAddresses: ["A", "B", "C"],
      txHashes: ["tx1"],
      steps: [],
      amountCoverageRatio: 0,
      amountContinuity: "weak",
      proximityHops: 4,
      reasons: ["Clean source was not proven within maxDepth=4."]
    }],
    originCoverage: 0,
    senderRole: "mule",
    senderCurrentBalanceRaw: "0",
    contractVerdicts: [],
    warnings: []
  });

  expect(report.decision).toBe("ACCEPTABLE");
  expect(report.depositRiskScore).toBeGreaterThanOrEqual(30);
  expect(report.depositRiskScore).toBeLessThanOrEqual(40);
});

it("lowers unknown contract risk when LLM returns legitimate_service", () => {
  const report = buildIncomingDepositRiskReport({
    depositTxHash: "tx",
    watchedWallet: "wallet",
    sender: "sender",
    amountRaw: "518054000000",
    fastSenderRisk: { subjectAddress: "sender", score: 0, level: "LOW", reasons: [] },
    originPaths: [{
      verdict: "DECLINE",
      score: 58,
      sourcePolicy: "medium_policy",
      stoppedReason: "unknown_contract_reached",
      pathAddresses: ["contract", "sender", "wallet"],
      txHashes: ["tx1"],
      steps: [],
      amountCoverageRatio: 0.95,
      amountContinuity: "strong",
      proximityHops: 2,
      reasons: ["Deposit funding reaches an unknown smart-contract boundary."]
    }],
    originCoverage: 0.95,
    senderRole: "fresh_one_shot_wallet",
    senderCurrentBalanceRaw: "0",
    contractVerdicts: [{
      verdict: "legitimate_service",
      confidence: 0.9,
      contractRiskScore: 25,
      decisionRecommendation: "ACCEPTABLE",
      reasons: ["GasFree Account / permitTransfer service pattern."],
      citedEvidenceIds: ["tx1"],
      falsePositiveNotes: ["service route evidence"],
      providerLabel: "deepseek",
      model: "deepseek-v4-pro",
      source: "llm",
      contractAddress: "TBUjhWxMAvB77CeS4TXSCTjtRbeuLmVSZ9",
      caseFileHash: "hash",
      cacheId: "cache"
    } as any],
    warnings: []
  });

  expect(report.decision).toBe("ACCEPTABLE");
  expect(report.depositRiskScore).toBeLessThanOrEqual(35);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/forensics/incomingDepositRisk.test.ts
```

Expected: FAIL because unresolved fallback still returns `45 / DECLINE`.

- [ ] **Step 3: Replace unresolved fallback score**

In `src/forensics/incomingDepositRisk.ts`, replace:

```ts
const unresolvedScore = clamp(Math.max(45, highestPathRisk(input.originPaths), input.fastSenderRisk?.score ?? 0));
```

with:

```ts
const baseUnresolved = amount >= 100_000 ? 35 : 30;
const lowQualityPenalty = quality === "low" ? 5 : 0;
const fastPenalty = Math.min(10, Math.max(0, (input.fastSenderRisk?.score ?? 0) - 25));
const unresolvedScore = clamp(Math.min(40, baseUnresolved + lowQualityPenalty + fastPenalty));
```

Return `ACCEPTABLE` unless `unresolvedScore >= 60`.

- [ ] **Step 4: Keep hard evidence unchanged**

Confirm existing `topHard` branch still returns `DECLINE`.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run tests/forensics/incomingDepositRisk.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/forensics/incomingDepositRisk.ts tests/forensics/incomingDepositRisk.test.ts
git commit -m "fix: lower unresolved incoming deposit risk"
```

---

### Task 5: Add Adaptive Depth for Incoming Deposits

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `src/forensics/incomingDepositProvenance.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Write failing adaptive-depth test**

Add a test where depth 4 returns only unresolved paths, depth 8 finds no hard bad evidence, and depth 12 reaches a protocol boundary.

Expected:

```ts
expect(report.originPaths.some((path) => path.stoppedReason === "clean_cex_reached" || path.sourcePolicy === "service_context")).toBe(true);
expect(report.warnings).toContain("Incoming deposit provenance search was extended beyond the fast depth budget.");
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts
```

Expected: FAIL because depth is fixed at 4.

- [ ] **Step 3: Add depth constants**

In `src/forensics/incomingDepositJob.ts`:

```ts
const RUNTIME_PROVENANCE_FAST_DEPTH = 4;
const RUNTIME_PROVENANCE_EXTENDED_DEPTH = 8;
const RUNTIME_PROVENANCE_LARGE_DEPOSIT_DEPTH = 12;
const LARGE_DEPOSIT_RAW = 100_000n * 1_000_000n;
```

- [ ] **Step 4: Add helper**

```ts
function shouldExtendProvenance(input: {
  amountRaw: string;
  paths: IncomingDepositOriginPath[];
  hardBadEvidenceFound: boolean;
}): boolean {
  if (input.hardBadEvidenceFound) return false;
  if (input.paths.length === 0) return true;
  return input.paths.every((path) =>
    path.stoppedReason === "data_budget_exhausted" ||
    path.stoppedReason === "no_previous_transfer" ||
    path.stoppedReason === "weak_cashflow_continuity"
  );
}

function isLargeDepositRaw(amountRaw: string): boolean {
  return /^\d+$/.test(amountRaw) && BigInt(amountRaw) >= LARGE_DEPOSIT_RAW;
}
```

- [ ] **Step 5: Run provenance in passes**

Replace single `traceIncomingDepositProvenance({ maxDepth: RUNTIME_PROVENANCE_MAX_DEPTH })` with:

```ts
let provenance = await traceIncomingDepositProvenance({
  deposit: seedDeposit,
  maxDepth: RUNTIME_PROVENANCE_FAST_DEPTH,
  fetchEdgesForAddress,
  getClassificationForAddress: input.deps.getClassificationForAddress
});

const extendedDepth = isLargeDepositRaw(input.amountRaw)
  ? RUNTIME_PROVENANCE_LARGE_DEPOSIT_DEPTH
  : RUNTIME_PROVENANCE_EXTENDED_DEPTH;

if (shouldExtendProvenance({
  amountRaw: input.amountRaw,
  paths: provenance.paths,
  hardBadEvidenceFound: provenance.paths.some((path) => path.sourcePolicy === "hard_decline")
})) {
  provenance = await traceIncomingDepositProvenance({
    deposit: seedDeposit,
    maxDepth: extendedDepth,
    fetchEdgesForAddress,
    getClassificationForAddress: input.deps.getClassificationForAddress
  });
  provenance.notes.push("Incoming deposit provenance search was extended beyond the fast depth budget.");
}
```

- [ ] **Step 6: Prevent runaway breadth**

Keep existing candidate cap:

```ts
selection.candidates.slice(0, 6)
```

Do not increase it in this task.

- [ ] **Step 7: Run tests**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/forensics/incomingDepositJob.ts src/forensics/incomingDepositProvenance.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "feat: extend incoming deposit provenance adaptively"
```

---

### Task 6: Update Telegram Output for AI and Data Quality

**Files:**
- Modify: `src/alerts/formatters.ts`
- Test: `tests/alerts/formatters.test.ts`

- [ ] **Step 1: Write formatter tests**

Add tests:

```ts
it("shows when LLM was not used", () => {
  const alert = formatIncomingDepositRiskAlert({
    jobId: "job",
    amount: "1000000",
    watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
    sender: "TDdyV5tKFP5gR2n9GUrveioT1jBeLeRPem",
    txHash: "tx",
    report: makeIncomingDepositReport({ contractVerdicts: [] })
  });

  expect(alert.text).not.toContain("AI contract verdict");
});

it("shows legitimate service verdict when present", () => {
  const alert = formatIncomingDepositRiskAlert({
    jobId: "job",
    amount: "518054",
    watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
    sender: "TMw3M7hdB4nFjXYCUDc286gBPcjBJSGwe7",
    txHash: "tx",
    report: makeIncomingDepositReport({
      contractVerdicts: [{
        verdict: "legitimate_service",
        contractRiskScore: 25,
        contractAddress: "TBUjhWxMAvB77CeS4TXSCTjtRbeuLmVSZ9",
        reasons: ["GasFree Account / permitTransfer service pattern."]
      } as any]
    })
  });

  expect(alert.text).toContain("AI contract verdict");
  expect(alert.text).toContain("legitimate_service");
  expect(alert.text).toContain("GasFree");
});
```

- [ ] **Step 2: Run tests and verify behavior**

Run:

```bash
npx vitest run tests/alerts/formatters.test.ts
```

Expected: existing output may always render an empty AI section; test fails if so.

- [ ] **Step 3: Render AI section only when verdicts exist**

In `formatIncomingDepositRiskAlert`, build sections conditionally:

```ts
const aiSection = formatIncomingDepositContractVerdicts(input.report);
const message = telegramHtmlMessage([
  bold("Incoming USDT"),
  `${bold("Decision")}: ${code(input.report.decision)}`,
  `${bold("Deposit risk")}: ${code(`${input.report.depositRiskScore}/100`)} (${code(input.report.riskBand)})`,
  [
    `${bold("Amount")}: ${code(`${input.amount} USDT`)}`,
    `${bold("Watched wallet")}: ${code(input.watchedWallet)}`,
    `${bold("Sender")}: ${code(input.sender)}`
  ].join("\n"),
  section("Reasons", [formatIncomingDepositReasons(input.report)]),
  ...(aiSection ? [section("AI contract verdict", [aiSection])] : []),
  section("Checks", [
    `${bold("Fast sender risk")}: ${formatFastSenderRisk(input.report)}`,
    `${bold("Origin coverage")}: ${code(formatPercent(input.report.originCoverage))}`,
    `${bold("Data quality")}: ${code(input.report.dataQuality)}`,
    `${bold("Sender role")}: ${code(input.report.senderRole ?? "unknown")}`
  ]),
  `${bold("Tx")}: ${code(input.txHash)}`
]);
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run tests/alerts/formatters.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/alerts/formatters.ts tests/alerts/formatters.test.ts
git commit -m "fix: clarify incoming deposit ai verdict output"
```

---

### Task 7: Integration Verification

**Files:**
- No production code changes expected.
- Use existing CLI/script patterns or a one-off `tsx` command.

- [ ] **Step 1: Run focused tests**

```bash
npx vitest run tests/forensics/serviceClassifier.test.ts tests/forensics/contractEnrichment.test.ts tests/forensics/incomingDepositRisk.test.ts tests/forensics/incomingDepositJob.test.ts tests/alerts/formatters.test.ts
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

- [ ] **Step 4: Live smoke GasFree-like tx**

Run a real incoming-deposit smoke for:

```text
watchedWallet: TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM
depositTxHash: 204134351bc1731fccd4a5ba9e1421c59cc8ac46221df87250c3defe19439ae1
```

Expected:

```text
AI contract verdict or deterministic classifier: legitimate_service / GasFree-like
Decision: ACCEPTABLE unless another hard bad signal appears
Deposit risk: about 25-35
No plain unknown_contract decline
```

- [ ] **Step 5: Live smoke deep EOA chain**

Run a real incoming-deposit smoke for:

```text
watchedWallet: TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM
depositTxHash: 2b62cdc401161883080119d757f045a152f54eae87b60364e112fecff891e190
```

Expected:

```text
No hard bad evidence
No automatic 45/DECLINE solely from unresolved clean origin
Adaptive search attempts deeper provenance
If USDD PSM/GemJoin reached, report service/protocol boundary context
```

- [ ] **Step 6: Final PR-style review**

Review the final diff with focus on:

- missed live-fetch paths;
- any LLM call before deterministic enrichment;
- any hard-decline path accidentally weakened;
- rate-limit impact from adaptive depth;
- whether Telegram output implies AI ran when it did not.

- [ ] **Step 7: Commit verification notes if a doc update was needed**

Only commit docs if verification uncovered a durable operational note:

```bash
git add docs/research/<new-note>.md
git commit -m "docs: record incoming deposit enrichment smoke results"
```

---

## Self-Review

- Spec coverage: all spec requirements map to Tasks 1-7.
- Completeness scan: no open implementation gaps are present.
- Type consistency: new categories `service` and `protocol` are introduced before use.
- Risk policy consistency: hard bad evidence remains `DECLINE`; unresolved clean-origin no longer becomes hard risk by itself.
- LLM policy consistency: DeepSeek receives backend-collected facts only and does not browse the internet directly.

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-05-30-contract-enrichment-and-deposit-scoring.md`.

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
