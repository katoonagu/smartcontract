# Shared Source Bundle Exposure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one shared source-bundle exposure layer for `incoming_deposit_check` and `where_is_money_check`, so both modes explain fresh source proof, historical context, unresolved coverage, score floors, and final decisions consistently.

**Architecture:** Add a pure `src/forensics/sourceBundleExposure.ts` module that converts origin paths and historical wallet edges into shared report profiles. Incoming deposit keeps backward-compatible `freshBundleExposure` and `walletExposureProfile` fields by mapping from the shared profiles. Where Is Money writes the same shared profiles into `WhereIsMoneyReport` and passes them into `buildMoneyOriginOperationalAssessment` for calibrated score floors.

**Tech Stack:** TypeScript, Vitest, existing forensic job JSON reports, existing `runWhereIsMoneyCheck`, `buildIncomingDepositReport`, `buildMoneyOriginOperationalAssessment`, admin forensics graph projection.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-06-06-shared-source-bundle-exposure-design.md`
- Product walkthrough: `docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md`
- Prior incoming bundle plan: `docs/superpowers/plans/2026-06-06-incoming-deposit-bundle-exposure-profile.md`
- Balance-aware incoming plan: `docs/superpowers/plans/2026-06-06-balance-aware-incoming-provenance.md`

## Current Code Entry Points

- `src/types.ts`
  - Owns `IncomingFreshBundleExposure`, `IncomingWalletExposureProfile`, `IncomingDepositRiskReport`, `MoneyOriginPath`, `WhereIsMoneyReport`.
- `src/forensics/incomingDepositExposureProfile.ts`
  - Current incoming-only fresh bundle and sender historical exposure logic.
- `src/forensics/incomingDepositJob.ts`
  - Incoming job orchestration, balance-aware funding candidates, report assembly, alert delivery.
- `src/check/whereIsMoneyCheck.ts`
  - Where Is Money orchestration, provenance selection, origin tracing, assessment assembly.
- `src/forensics/moneyOriginOperationalAssessment.ts`
  - Standalone Where Is Money risk score, risk band, decision, and source policy layers.
- `src/forensics/provenanceScoring.ts`
  - Existing source-policy scoring helpers and source exposure classification from origin paths.
- `src/admin/forensicsGraph.ts`
  - Admin graph projection for Where and Incoming jobs.
- `src/bot/createBot.ts`
  - Bot-facing Where report consumption.
- Alert formatter tests:
  - `tests/alerts/formatters.test.ts`
  - `tests/forensics/incomingDepositJob.test.ts`
- Existing forensic tests:
  - `tests/forensics/incomingDepositExposureProfile.test.ts`
  - `tests/forensics/incomingDepositJob.test.ts`
  - `tests/check/whereIsMoneyCheck.test.ts`
  - `tests/forensics/moneyOriginOperationalAssessment.test.ts`
  - `tests/admin/forensicsGraph.test.ts`

## Design Boundaries

The shared layer must be pure and deterministic. It receives already-built origin paths, selected amount metadata, historical wallet edges, classifications, and budget notes. It must not fetch TronScan, query the database, call LLMs, or enqueue jobs.

Incoming deposit must keep the old fields:

```text
freshBundleExposure
walletExposureProfile
unifiedRiskSummary
```

Where Is Money must gain the shared fields:

```text
sourceBundleExposure
subjectExposureProfile
```

The final user-facing result remains one score and one decision. The implementation must not introduce manual review as a product requirement.

## Scoring Invariants

Fresh selected-amount exposure may set score floors:

```text
riskyLabelShare >= 10%      -> floor 85, DECLINE
htxHuobiShare >= 70%        -> floor 85, DECLINE
htxHuobiShare >= 30%        -> floor 70, DECLINE
htxHuobiShare >= 10%        -> floor 55
bridgeRouterDexShare >= 50% -> floor 60, DECLINE
unknownContractShare >= 50% -> floor 45
```

Historical subject exposure is context only:

```text
max scoreContribution = 20
never says the checked amount came from HTX/Huobi
never overrides hard evidence or fresh high-share policy floors
```

Coverage-limited unresolved boundaries are conservative, not exact source proof:

```text
risky_label unresolved      -> floor 70
htx_huobi unresolved        -> floor 60
bridge_router_dex unresolved-> floor 55
unknown_contract unresolved -> floor 45
unknown unresolved          -> floor 35
```

Clean CEX exposure dampens uncertainty, but does not cancel blacklist, scam label, exact approval-drain proof, or fresh HTX/Huobi high-share floors.

## Task 1: Add Shared Types And Pure Builder Tests

**Files:**
- Modify: `src/types.ts`
- Create: `src/forensics/sourceBundleExposure.ts`
- Create: `tests/forensics/sourceBundleExposure.test.ts`

- [ ] **Step 1: Add failing unit tests for the shared builder**

Create `tests/forensics/sourceBundleExposure.test.ts` with this full test file:

```ts
import { describe, expect, it } from "vitest";
import {
  buildSourceBundleExposure,
  buildSubjectExposureProfile,
  incomingFreshBundleExposureFromSourceProfile,
  incomingWalletExposureProfileFromSubjectProfile
} from "../../src/forensics/sourceBundleExposure";
import type {
  SourceBundleExposureFinding,
  SourceBundleExposureProfile,
  SubjectExposureEvent
} from "../../src/types";

function finding(overrides: Partial<SourceBundleExposureFinding>): SourceBundleExposureFinding {
  return {
    sourceClass: "unknown",
    amountRaw: "0",
    share: 0,
    evidenceTxHashes: [],
    stoppedReason: "no_previous_transfer",
    proofKind: "selected_amount",
    ...overrides
  };
}

function event(overrides: Partial<SubjectExposureEvent>): SubjectExposureEvent {
  return {
    direction: "incoming",
    amountRaw: "0",
    counterparty: "TUnknown",
    sourceClass: "unknown",
    txHash: "tx-unknown",
    timestamp: "2026-06-04T00:00:00.000Z",
    ...overrides
  };
}

describe("buildSourceBundleExposure", () => {
  it("normalizes selected amount source shares and records the dominant source", () => {
    const profile = buildSourceBundleExposure({
      scope: "incoming_deposit",
      targetAmountRaw: "100000000000",
      findings: [
        finding({
          sourceClass: "htx_huobi",
          amountRaw: "70000000000",
          share: 0.7,
          evidenceTxHashes: ["tx-htx"],
          stoppedReason: "htx_huobi_reached"
        }),
        finding({
          sourceClass: "clean_cex",
          amountRaw: "20000000000",
          share: 0.2,
          evidenceTxHashes: ["tx-clean"],
          stoppedReason: "clean_cex_reached"
        }),
        finding({
          sourceClass: "unknown_contract",
          amountRaw: "10000000000",
          share: 0.1,
          evidenceTxHashes: ["tx-contract"],
          stoppedReason: "unknown_contract_reached"
        })
      ],
      budget: {
        maxDepth: 4,
        fetchedAddressCount: 3,
        maxAddressFetches: 20,
        liveTransferReadCount: 60,
        skippedAddressCount: 0,
        exhausted: false,
        exhaustedPhase: null
      }
    });

    expect(profile.coveredAmountRaw).toBe("100000000000");
    expect(profile.coverageRatio).toBe(1);
    expect(profile.htxHuobiShare).toBeCloseTo(0.7);
    expect(profile.cleanCexShare).toBeCloseTo(0.2);
    expect(profile.unknownContractShare).toBeCloseTo(0.1);
    expect(profile.unknownShare).toBe(0);
    expect(profile.dominantSource).toBe("htx_huobi");
    expect(profile.evidenceTxHashes).toEqual(["tx-htx", "tx-clean", "tx-contract"]);
    expect(profile.unresolvedBoundary).toBeNull();
  });

  it("assigns missing selected coverage to unknown without inventing a source", () => {
    const profile = buildSourceBundleExposure({
      scope: "where_requested_amount",
      targetAmountRaw: "100000000000",
      findings: [
        finding({
          sourceClass: "clean_cex",
          amountRaw: "30000000000",
          share: 0.3,
          evidenceTxHashes: ["tx-clean"],
          stoppedReason: "clean_cex_reached"
        })
      ],
      budget: {
        maxDepth: 3,
        fetchedAddressCount: 1,
        maxAddressFetches: 10,
        liveTransferReadCount: 50,
        skippedAddressCount: 0,
        exhausted: false,
        exhaustedPhase: null
      }
    });

    expect(profile.cleanCexShare).toBeCloseTo(0.3);
    expect(profile.unknownShare).toBeCloseTo(0.7);
    expect(profile.reasons.join(" ")).toContain("Uncovered selected source share is assigned to unknown.");
  });

  it("keeps coverage-limited bridge boundary visible and adds the conservative floor", () => {
    const profile = buildSourceBundleExposure({
      scope: "incoming_deposit",
      targetAmountRaw: "100000000000",
      findings: [
        finding({
          sourceClass: "unknown",
          amountRaw: "45000000000",
          share: 0.45,
          evidenceTxHashes: ["tx-known"],
          stoppedReason: "no_previous_transfer"
        })
      ],
      unresolvedBoundary: {
        kind: "bridge_router_dex",
        affectedShare: 0.55,
        evidenceTxHashes: ["tx-bridge-boundary"],
        reason: "Trace stopped at a material bridge/router/DEX boundary before source resolution."
      },
      budget: {
        maxDepth: 3,
        fetchedAddressCount: 8,
        maxAddressFetches: 8,
        liveTransferReadCount: 100,
        skippedAddressCount: 4,
        exhausted: true,
        exhaustedPhase: "trace"
      }
    });

    expect(profile.budget.exhausted).toBe(true);
    expect(profile.unresolvedBoundary).toMatchObject({
      kind: "bridge_router_dex",
      affectedShare: 0.55,
      scoreFloor: 55
    });
    expect(profile.warnings.join(" ")).toContain("coverage-limited");
  });
});

describe("incoming compatibility mappers", () => {
  it("maps a shared selected exposure profile to the existing incoming fresh field shape", () => {
    const shared: SourceBundleExposureProfile = buildSourceBundleExposure({
      scope: "incoming_deposit",
      targetAmountRaw: "100000000000",
      findings: [
        finding({
          sourceClass: "htx_huobi",
          amountRaw: "49000000000",
          share: 0.49,
          evidenceTxHashes: ["tx-htx"],
          stoppedReason: "htx_huobi_reached"
        }),
        finding({
          sourceClass: "clean_cex",
          amountRaw: "51000000000",
          share: 0.51,
          evidenceTxHashes: ["tx-clean"],
          stoppedReason: "clean_cex_reached"
        })
      ],
      budget: {
        maxDepth: 4,
        fetchedAddressCount: 2,
        maxAddressFetches: 20,
        liveTransferReadCount: 50,
        skippedAddressCount: 0,
        exhausted: false,
        exhaustedPhase: null
      }
    });

    const incoming = incomingFreshBundleExposureFromSourceProfile(shared);

    expect(incoming.targetAmountRaw).toBe("100000000000");
    expect(incoming.htxHuobiShare).toBeCloseTo(0.49);
    expect(incoming.cleanCexShare).toBeCloseTo(0.51);
    expect(incoming.dominantFreshSource).toBe("clean_cex");
  });

  it("maps a shared historical subject profile to the existing incoming wallet field shape", () => {
    const subject = buildSubjectExposureProfile({
      subjectAddress: "TSender",
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-06-04T12:00:00.000Z",
      transferEventsScanned: 5,
      events: [
        event({
          direction: "incoming",
          amountRaw: "40000000000",
          sourceClass: "htx_huobi",
          txHash: "tx-htx"
        }),
        event({
          direction: "outgoing",
          amountRaw: "30000000000",
          sourceClass: "bridge_router_dex",
          txHash: "tx-bridge"
        }),
        event({
          direction: "incoming",
          amountRaw: "60000000000",
          sourceClass: "unknown",
          txHash: "tx-unknown"
        })
      ]
    });

    const incoming = incomingWalletExposureProfileFromSubjectProfile(subject);

    expect(subject.scoreContribution).toBeLessThanOrEqual(20);
    expect(incoming.transferEventsScanned).toBe(5);
    expect(incoming.htxHuobiIncomingShare).toBeCloseTo(0.4);
    expect(incoming.bridgeRouterDexVolumeShare).toBeCloseTo(0.3);
    expect(incoming.scoreContribution).toBe(subject.scoreContribution);
  });
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```bash
npx vitest run tests/forensics/sourceBundleExposure.test.ts --configLoader bundle
```

Expected result:

```text
FAIL tests/forensics/sourceBundleExposure.test.ts
Cannot find module '../../src/forensics/sourceBundleExposure'
```

- [ ] **Step 3: Add shared source exposure types**

Modify `src/types.ts` near `IncomingExposureSourceKind` and add these exported types:

```ts
export type SourceBundleExposureSourceKind = IncomingExposureSourceKind;

export type SourceBundleExposureScope =
  | "incoming_deposit"
  | "where_current_balance"
  | "where_requested_amount"
  | "where_recent_flow"
  | "where_transaction_seed";

export type SourceBundleExposureProofKind =
  | "selected_amount"
  | "fresh_corridor_context"
  | "coverage_limited_boundary";

export type SourceBundleExposureBudget = {
  maxDepth: number | null;
  fetchedAddressCount: number | null;
  maxAddressFetches: number | null;
  liveTransferReadCount: number | null;
  skippedAddressCount: number;
  exhausted: boolean;
  exhaustedPhase: "selection" | "trace" | "bundle_expansion" | "classification" | "stablecoin" | "internal_processing" | null;
};

export type SourceBundleUnresolvedBoundaryInput = {
  kind: SourceBundleExposureSourceKind;
  affectedShare: number;
  reason: string;
  evidenceTxHashes: string[];
};

export type SourceBundleUnresolvedBoundary = SourceBundleUnresolvedBoundaryInput & {
  scoreFloor: number;
};

export type SourceBundleExposureFinding = {
  sourceClass: SourceBundleExposureSourceKind;
  amountRaw: string;
  share: number;
  evidenceTxHashes: string[];
  stoppedReason: string;
  proofKind: SourceBundleExposureProofKind;
};

export type SourceBundleExposureProfile = {
  scope: SourceBundleExposureScope;
  targetAmountRaw: string | null;
  coveredAmountRaw: string;
  coverageRatio: number;
  htxHuobiShare: number;
  cleanCexShare: number;
  bridgeRouterDexShare: number;
  unknownContractShare: number;
  riskyLabelShare: number;
  unknownShare: number;
  dominantSource: SourceBundleExposureSourceKind | null;
  evidenceTxHashes: string[];
  reasons: string[];
  warnings: string[];
  budget: SourceBundleExposureBudget;
  unresolvedBoundary: SourceBundleUnresolvedBoundary | null;
};

export type SubjectExposureEvent = {
  direction: "incoming" | "outgoing";
  amountRaw: string;
  counterparty: string;
  sourceClass: SourceBundleExposureSourceKind;
  txHash: string;
  timestamp: string;
};

export type SubjectExposureProfile = {
  subjectAddress: string;
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

- [ ] **Step 4: Add shared report fields to existing report types**

Modify `src/types.ts`.

In `IncomingDepositRiskReport`, add:

```ts
  sourceBundleExposure?: SourceBundleExposureProfile;
  subjectExposureProfile?: SubjectExposureProfile;
```

Place them next to the existing compatibility fields:

```ts
  freshBundleExposure?: IncomingFreshBundleExposure;
  walletExposureProfile?: IncomingWalletExposureProfile;
```

In `WhereIsMoneyReport`, add:

```ts
  sourceBundleExposure?: SourceBundleExposureProfile;
  subjectExposureProfile?: SubjectExposureProfile;
```

Place them before `assessment`.

- [ ] **Step 5: Implement the pure shared builder**

Create `src/forensics/sourceBundleExposure.ts` with these exports and helper functions:

```ts
import type {
  IncomingFreshBundleExposure,
  IncomingWalletExposureProfile,
  SourceBundleExposureBudget,
  SourceBundleExposureFinding,
  SourceBundleExposureProfile,
  SourceBundleExposureScope,
  SourceBundleExposureSourceKind,
  SourceBundleUnresolvedBoundary,
  SourceBundleUnresolvedBoundaryInput,
  SubjectExposureEvent,
  SubjectExposureProfile
} from "../types";

type ShareAccumulator = Record<SourceBundleExposureSourceKind, number>;

export type BuildSourceBundleExposureInput = {
  scope: SourceBundleExposureScope;
  targetAmountRaw: string | null;
  findings: SourceBundleExposureFinding[];
  budget: SourceBundleExposureBudget;
  unresolvedBoundary?: SourceBundleUnresolvedBoundaryInput | null;
};

export type BuildSubjectExposureProfileInput = {
  subjectAddress: string;
  windowStart: string;
  windowEnd: string;
  transferEventsScanned: number;
  events: SubjectExposureEvent[];
};

const SHARE_SCALE = 1_000_000n;

function emptyShares(): ShareAccumulator {
  return {
    htx_huobi: 0,
    clean_cex: 0,
    bridge_router_dex: 0,
    unknown_contract: 0,
    risky_label: 0,
    unknown: 0
  };
}

function clampShare(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampScore(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

function parseRawAmount(value: string): bigint {
  if (!/^\d+$/.test(value.trim())) return 0n;
  return BigInt(value.trim());
}

function formatPercent(value: number): string {
  return `${Math.round(clampShare(value) * 100)}%`;
}

function rawShare(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n || numerator <= 0n) return 0;
  return clampShare(Number((numerator * SHARE_SCALE) / denominator) / Number(SHARE_SCALE));
}

function dominantSource(shares: ShareAccumulator): SourceBundleExposureSourceKind | null {
  let dominant: SourceBundleExposureSourceKind | null = null;
  let dominantShare = 0;
  for (const kind of Object.keys(shares) as SourceBundleExposureSourceKind[]) {
    const share = clampShare(shares[kind]);
    if (share > dominantShare) {
      dominant = kind;
      dominantShare = share;
    }
  }
  return dominant;
}

function unresolvedBoundaryFloor(kind: SourceBundleExposureSourceKind): number {
  switch (kind) {
    case "risky_label":
      return 70;
    case "htx_huobi":
      return 60;
    case "bridge_router_dex":
      return 55;
    case "unknown_contract":
      return 45;
    case "clean_cex":
      return 35;
    case "unknown":
      return 35;
  }
}

function withUnresolvedBoundaryFloor(
  unresolvedBoundary: SourceBundleUnresolvedBoundaryInput | null | undefined
): SourceBundleUnresolvedBoundary | null {
  if (!unresolvedBoundary) return null;
  return {
    ...unresolvedBoundary,
    affectedShare: clampShare(unresolvedBoundary.affectedShare),
    scoreFloor: unresolvedBoundaryFloor(unresolvedBoundary.kind)
  };
}

function normalizeSelectedShares(input: {
  shares: ShareAccumulator;
  coveredShare: number;
}): { shares: ShareAccumulator; missingShare: number; scale: number } {
  const observedShare = Object.values(input.shares).reduce((sum, current) => sum + current, 0);
  if (observedShare > 1) {
    const scale = 1 / observedShare;
    return {
      scale,
      missingShare: 0,
      shares: {
        htx_huobi: clampShare(input.shares.htx_huobi * scale),
        clean_cex: clampShare(input.shares.clean_cex * scale),
        bridge_router_dex: clampShare(input.shares.bridge_router_dex * scale),
        unknown_contract: clampShare(input.shares.unknown_contract * scale),
        risky_label: clampShare(input.shares.risky_label * scale),
        unknown: clampShare(input.shares.unknown * scale)
      }
    };
  }

  const missingShare = clampShare(1 - observedShare);
  return {
    scale: 1,
    missingShare,
    shares: {
      htx_huobi: clampShare(input.shares.htx_huobi),
      clean_cex: clampShare(input.shares.clean_cex),
      bridge_router_dex: clampShare(input.shares.bridge_router_dex),
      unknown_contract: clampShare(input.shares.unknown_contract),
      risky_label: clampShare(input.shares.risky_label),
      unknown: clampShare(input.shares.unknown + missingShare)
    }
  };
}

function exposureReasons(input: {
  scope: SourceBundleExposureScope;
  shares: ShareAccumulator;
  missingShare: number;
}): string[] {
  const noun = input.scope === "incoming_deposit" ? "checked-deposit source share" : "selected source share";
  const reasons: string[] = [];
  if (input.shares.htx_huobi > 0) reasons.push(`HTX/Huobi accounts for ${formatPercent(input.shares.htx_huobi)} of ${noun}.`);
  if (input.shares.clean_cex > 0) reasons.push(`Clean CEX accounts for ${formatPercent(input.shares.clean_cex)} of ${noun}.`);
  if (input.shares.bridge_router_dex > 0) reasons.push(`Bridge/router/DEX accounts for ${formatPercent(input.shares.bridge_router_dex)} of ${noun}.`);
  if (input.shares.unknown_contract > 0) reasons.push(`Unknown contract accounts for ${formatPercent(input.shares.unknown_contract)} of ${noun}.`);
  if (input.shares.risky_label > 0) reasons.push(`Risky label accounts for ${formatPercent(input.shares.risky_label)} of ${noun}.`);
  if (input.missingShare > 0) reasons.push(`Uncovered selected source share is assigned to unknown.`);
  return reasons;
}

export function buildSourceBundleExposure(input: BuildSourceBundleExposureInput): SourceBundleExposureProfile {
  const shares = emptyShares();
  const evidenceTxHashes: string[] = [];
  let coveredAmount = 0n;

  for (const finding of input.findings) {
    const share = clampShare(finding.share);
    if (share <= 0) continue;
    shares[finding.sourceClass] += share;
    coveredAmount += parseRawAmount(finding.amountRaw);
    for (const txHash of finding.evidenceTxHashes) {
      if (!evidenceTxHashes.includes(txHash)) evidenceTxHashes.push(txHash);
    }
  }

  const normalized = normalizeSelectedShares({
    shares,
    coveredShare: Object.values(shares).reduce((sum, current) => sum + current, 0)
  });
  const finalShares = normalized.shares;
  const targetAmount = input.targetAmountRaw ? parseRawAmount(input.targetAmountRaw) : 0n;
  const unresolvedBoundary = withUnresolvedBoundaryFloor(input.unresolvedBoundary);
  const warnings: string[] = [];
  if (input.budget.exhausted || unresolvedBoundary) {
    warnings.push("Source bundle coverage-limited: graph budget stopped before every material boundary was resolved.");
  }

  return {
    scope: input.scope,
    targetAmountRaw: input.targetAmountRaw,
    coveredAmountRaw: coveredAmount.toString(),
    coverageRatio: input.targetAmountRaw ? rawShare(coveredAmount, targetAmount) : clampShare(1 - normalized.missingShare),
    htxHuobiShare: finalShares.htx_huobi,
    cleanCexShare: finalShares.clean_cex,
    bridgeRouterDexShare: finalShares.bridge_router_dex,
    unknownContractShare: finalShares.unknown_contract,
    riskyLabelShare: finalShares.risky_label,
    unknownShare: finalShares.unknown,
    dominantSource: dominantSource(finalShares),
    evidenceTxHashes,
    reasons: exposureReasons({
      scope: input.scope,
      shares: finalShares,
      missingShare: normalized.missingShare
    }),
    warnings,
    budget: input.budget,
    unresolvedBoundary
  };
}

export function buildSubjectExposureProfile(input: BuildSubjectExposureProfileInput): SubjectExposureProfile {
  let incomingVolume = 0n;
  let outgoingVolume = 0n;
  let htxIncoming = 0n;
  let cleanIncoming = 0n;
  let bridgeVolume = 0n;
  let unknownContractVolume = 0n;
  let unknownVolume = 0n;

  for (const event of input.events) {
    const amount = parseRawAmount(event.amountRaw);
    if (event.direction === "incoming") incomingVolume += amount;
    if (event.direction === "outgoing") outgoingVolume += amount;
    if (event.direction === "incoming" && event.sourceClass === "htx_huobi") htxIncoming += amount;
    if (event.direction === "incoming" && event.sourceClass === "clean_cex") cleanIncoming += amount;
    if (event.sourceClass === "bridge_router_dex") bridgeVolume += amount;
    if (event.sourceClass === "unknown_contract") unknownContractVolume += amount;
    if (event.sourceClass === "unknown") unknownVolume += amount;
  }

  const totalVolume = incomingVolume + outgoingVolume;
  const htxHuobiIncomingShare = rawShare(htxIncoming, incomingVolume);
  const cleanCexIncomingShare = rawShare(cleanIncoming, incomingVolume);
  const bridgeRouterDexVolumeShare = rawShare(bridgeVolume, totalVolume);
  const unknownContractVolumeShare = rawShare(unknownContractVolume, totalVolume);
  const unknownSourceShare = rawShare(unknownVolume, totalVolume);
  const inOutVelocityScore = clampScore(totalVolume > 0n && incomingVolume > 0n && outgoingVolume > 0n ? 8 : 0, 8);
  const scoreContribution = clampScore(
    htxHuobiIncomingShare * 20 +
      bridgeRouterDexVolumeShare * 8 +
      unknownContractVolumeShare * 6 +
      unknownSourceShare * 5 +
      inOutVelocityScore,
    20
  );
  const reasons: string[] = [];
  if (htxHuobiIncomingShare > 0) reasons.push(`Historical HTX/Huobi sender inflow accounts for ${formatPercent(htxHuobiIncomingShare)} of incoming volume.`);
  if (bridgeRouterDexVolumeShare > 0) reasons.push(`Historical bridge/router/DEX activity accounts for ${formatPercent(bridgeRouterDexVolumeShare)} of sender volume.`);
  if (unknownContractVolumeShare > 0) reasons.push(`Historical unknown-contract activity accounts for ${formatPercent(unknownContractVolumeShare)} of sender volume.`);
  if (unknownSourceShare > 0) reasons.push(`Historical unknown-source activity accounts for ${formatPercent(unknownSourceShare)} of sender volume.`);
  if (inOutVelocityScore > 0) reasons.push("Sender shows in/out historical flow context.");

  return {
    subjectAddress: input.subjectAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    transferEventsScanned: input.transferEventsScanned,
    incomingVolumeRaw: incomingVolume.toString(),
    outgoingVolumeRaw: outgoingVolume.toString(),
    htxHuobiIncomingShare,
    cleanCexIncomingShare,
    bridgeRouterDexVolumeShare,
    unknownContractVolumeShare,
    unknownSourceShare,
    inOutVelocityScore,
    scoreContribution,
    reasons,
    warnings: []
  };
}

export function incomingFreshBundleExposureFromSourceProfile(
  profile: SourceBundleExposureProfile
): IncomingFreshBundleExposure {
  return {
    targetAmountRaw: profile.targetAmountRaw ?? "0",
    htxHuobiShare: profile.htxHuobiShare,
    cleanCexShare: profile.cleanCexShare,
    bridgeRouterDexShare: profile.bridgeRouterDexShare,
    unknownContractShare: profile.unknownContractShare,
    riskyLabelShare: profile.riskyLabelShare,
    unknownShare: profile.unknownShare,
    dominantFreshSource: profile.dominantSource,
    reasons: profile.reasons
  };
}

export function incomingWalletExposureProfileFromSubjectProfile(
  profile: SubjectExposureProfile
): IncomingWalletExposureProfile {
  return {
    windowStart: profile.windowStart,
    windowEnd: profile.windowEnd,
    transferEventsScanned: profile.transferEventsScanned,
    incomingVolumeRaw: profile.incomingVolumeRaw,
    outgoingVolumeRaw: profile.outgoingVolumeRaw,
    htxHuobiIncomingShare: profile.htxHuobiIncomingShare,
    cleanCexIncomingShare: profile.cleanCexIncomingShare,
    bridgeRouterDexVolumeShare: profile.bridgeRouterDexVolumeShare,
    unknownContractVolumeShare: profile.unknownContractVolumeShare,
    unknownSourceShare: profile.unknownSourceShare,
    inOutVelocityScore: profile.inOutVelocityScore,
    scoreContribution: profile.scoreContribution,
    reasons: profile.reasons,
    warnings: profile.warnings
  };
}
```

- [ ] **Step 6: Run the shared builder tests**

Run:

```bash
npx vitest run tests/forensics/sourceBundleExposure.test.ts --configLoader bundle
```

Expected result:

```text
PASS tests/forensics/sourceBundleExposure.test.ts
```

- [ ] **Step 7: Run typecheck for the new exported types**

Run:

```bash
npm run typecheck
```

Expected result:

```text
tsc --noEmit
```

No TypeScript errors.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add src/types.ts src/forensics/sourceBundleExposure.ts tests/forensics/sourceBundleExposure.test.ts
git commit -m "Add shared source bundle exposure builder"
```

Review gate before next task:

```text
Confirm the new module has no provider, database, bot, admin, or job dependencies.
Confirm incoming compatibility mappers compile against the current IncomingFreshBundleExposure and IncomingWalletExposureProfile fields.
```

## Task 2: Migrate Incoming Exposure Profile To The Shared Builder

**Files:**
- Modify: `src/forensics/incomingDepositExposureProfile.ts`
- Modify: `tests/forensics/incomingDepositExposureProfile.test.ts`
- Test: `tests/forensics/sourceBundleExposure.test.ts`

- [ ] **Step 1: Add regression tests that require incoming compatibility fields to come from the shared profile**

Append these tests to `tests/forensics/incomingDepositExposureProfile.test.ts`:

```ts
it("keeps the incoming fresh shape while using shared selected source semantics", () => {
  const exposure = buildIncomingFreshBundleExposure({
    targetAmountRaw: "100000000000",
    originPaths: [
      originPath({ stoppedReason: "htx_huobi_reached", sourcePolicy: "hard_decline", balanceShare: 0.49 }),
      originPath({ stoppedReason: "clean_cex_reached", sourcePolicy: "clean", balanceShare: 0.51 })
    ]
  });

  expect(exposure.targetAmountRaw).toBe("100000000000");
  expect(exposure.htxHuobiShare).toBeCloseTo(0.49);
  expect(exposure.cleanCexShare).toBeCloseTo(0.51);
  expect(exposure.dominantFreshSource).toBe("clean_cex");
  expect(exposure.reasons.join(" ")).toContain("checked-deposit source share");
});

it("keeps data-budget-exhausted paths as unknown selected share", () => {
  const exposure = buildIncomingFreshBundleExposure({
    targetAmountRaw: "100000000000",
    originPaths: [
      originPath({ stoppedReason: "data_budget_exhausted", sourcePolicy: "unknown", balanceShare: 0.4 })
    ]
  });

  expect(exposure.unknownShare).toBe(1);
  expect(exposure.htxHuobiShare).toBe(0);
  expect(exposure.bridgeRouterDexShare).toBe(0);
});
```

- [ ] **Step 2: Run incoming exposure tests before migration**

Run:

```bash
npx vitest run tests/forensics/incomingDepositExposureProfile.test.ts --configLoader bundle
```

Expected result:

```text
PASS tests/forensics/incomingDepositExposureProfile.test.ts
```

- [ ] **Step 3: Replace duplicate fresh-bundle math with a shared builder call**

Modify `src/forensics/incomingDepositExposureProfile.ts`.

Keep the existing exported function signatures:

```ts
export function buildIncomingFreshBundleExposure(
  input: BuildIncomingFreshBundleExposureInput
): IncomingFreshBundleExposure
```

Add imports:

```ts
import {
  buildSourceBundleExposure,
  incomingFreshBundleExposureFromSourceProfile
} from "./sourceBundleExposure";
import type {
  SourceBundleExposureFinding,
  SourceBundleExposureSourceKind
} from "../types";
```

Replace the body of `buildIncomingFreshBundleExposure` with:

```ts
export function buildIncomingFreshBundleExposure(
  input: BuildIncomingFreshBundleExposureInput
): IncomingFreshBundleExposure {
  const findings: SourceBundleExposureFinding[] = input.originPaths
    .map((path): SourceBundleExposureFinding | null => {
      const pathShare = clampShare(path.balanceShare ?? 0);
      if (pathShare <= 0) return null;
      const sourceClass: SourceBundleExposureSourceKind = sourceKindForPath(path);
      return {
        sourceClass,
        amountRaw: path.amountRaw ?? "0",
        share: pathShare,
        evidenceTxHashes: path.txHashes,
        stoppedReason: path.stoppedReason,
        proofKind: "selected_amount"
      };
    })
    .filter((finding): finding is SourceBundleExposureFinding => finding !== null);

  const shared = buildSourceBundleExposure({
    scope: "incoming_deposit",
    targetAmountRaw: input.targetAmountRaw,
    findings,
    budget: {
      maxDepth: null,
      fetchedAddressCount: null,
      maxAddressFetches: null,
      liveTransferReadCount: null,
      skippedAddressCount: 0,
      exhausted: input.originPaths.some((path) => path.stoppedReason === "data_budget_exhausted"),
      exhaustedPhase: input.originPaths.some((path) => path.stoppedReason === "data_budget_exhausted") ? "trace" : null
    }
  });

  return incomingFreshBundleExposureFromSourceProfile(shared);
}
```

Retain existing helper functions used by `buildIncomingWalletExposureProfile`.

- [ ] **Step 4: Run shared and incoming exposure tests**

Run:

```bash
npx vitest run tests/forensics/sourceBundleExposure.test.ts tests/forensics/incomingDepositExposureProfile.test.ts --configLoader bundle
```

Expected result:

```text
PASS tests/forensics/sourceBundleExposure.test.ts
PASS tests/forensics/incomingDepositExposureProfile.test.ts
```

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/forensics/incomingDepositExposureProfile.ts tests/forensics/incomingDepositExposureProfile.test.ts
git commit -m "Route incoming exposure through shared source profile"
```

Review gate before next task:

```text
Confirm no incoming report JSON fields were renamed.
Confirm existing incoming tests still assert freshBundleExposure and walletExposureProfile.
```

## Task 3: Attach Shared Exposure Profiles To Incoming Reports

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`
- Test: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add incoming report regression tests for shared fields and stale HTX wording**

In `tests/forensics/incomingDepositJob.test.ts`, add a test near the current fresh-bundle exposure tests:

```ts
it("writes shared source and subject exposure profiles without claiming stale HTX as fresh source", async () => {
  const result = await buildIncomingDepositReport({
    ...incomingDepositJobInput({
      txHash: "deposit-stale-htx",
      sender: "TSender",
      watchedWallet: "TWatched",
      amountRaw: "100000000000"
    }),
    now: new Date("2026-06-04T12:00:00.000Z"),
    originPaths: [
      incomingOriginPath({
        stoppedReason: "no_previous_transfer",
        sourcePolicy: "unknown",
        balanceShare: 1,
        amountRaw: "100000000000",
        txHashes: ["fresh-funding-tx"]
      })
    ],
    senderExposureEdges: [
      forensicEdge({
        fromAddress: "THTX",
        toAddress: "TSender",
        amountRaw: "249590000000",
        txHash: "stale-htx-in",
        timestamp: new Date("2026-05-14T12:00:00.000Z")
      }),
      forensicEdge({
        fromAddress: "TSender",
        toAddress: "TSpender",
        amountRaw: "303919000000",
        txHash: "spent-after-stale-htx",
        timestamp: new Date("2026-05-14T12:51:06.000Z")
      })
    ],
    classifyAddress: async (address) => {
      if (address === "THTX") {
        return {
          category: "cex",
          identity: "HTX 4",
          confidence: "high",
          evidence: ["metadata:HTX"],
          isBoundary: true
        };
      }
      return null;
    }
  });

  expect(result.sourceBundleExposure).toEqual(expect.objectContaining({
    scope: "incoming_deposit",
    htxHuobiShare: 0,
    unknownShare: 1
  }));
  expect(result.freshBundleExposure).toEqual(expect.objectContaining({
    htxHuobiShare: 0,
    unknownShare: 1
  }));
  expect(result.subjectExposureProfile?.htxHuobiIncomingShare).toBeGreaterThan(0);
  expect(result.walletExposureProfile?.htxHuobiIncomingShare).toBeGreaterThan(0);
  expect(result.reasons.join(" ")).not.toContain("100% of checked-deposit source share");
});
```

Use the existing local helper names in the file. When a helper has a different name, adapt only the helper calls and keep the same assertions.

- [ ] **Step 2: Run the incoming job test and verify the expected failure**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts --configLoader bundle
```

Expected result:

```text
FAIL tests/forensics/incomingDepositJob.test.ts
expected result.sourceBundleExposure to equal object containing scope incoming_deposit
```

- [ ] **Step 3: Build shared incoming profiles in the job report**

Modify `src/forensics/incomingDepositJob.ts`.

Add imports:

```ts
import {
  buildSourceBundleExposure,
  buildSubjectExposureProfile,
  incomingFreshBundleExposureFromSourceProfile,
  incomingWalletExposureProfileFromSubjectProfile
} from "./sourceBundleExposure";
import type {
  SourceBundleExposureFinding,
  SubjectExposureEvent
} from "../types";
```

Add a local path mapper close to the current incoming exposure helpers:

```ts
function sourceFindingFromIncomingOriginPath(path: IncomingDepositOriginPath): SourceBundleExposureFinding | null {
  const share = clampShare(path.balanceShare ?? 0);
  if (share <= 0) return null;
  return {
    sourceClass: incomingSourceKindForStoppedReason(path.stoppedReason),
    amountRaw: path.amountRaw ?? "0",
    share,
    evidenceTxHashes: path.txHashes,
    stoppedReason: path.stoppedReason,
    proofKind: "selected_amount"
  };
}
```

Add a local historical event mapper:

```ts
function subjectExposureEventsFromEdges(input: {
  subjectAddress: string;
  edges: ForensicRouteEdge[];
  classifyAddress(address: string): ServiceClassification | null | undefined;
}): SubjectExposureEvent[] {
  return input.edges.map((edge) => {
    const counterparty = edge.fromAddress === input.subjectAddress ? edge.toAddress : edge.fromAddress;
    const classification = input.classifyAddress(counterparty);
    return {
      direction: edge.toAddress === input.subjectAddress ? "incoming" : "outgoing",
      amountRaw: edge.amountRaw,
      counterparty,
      sourceClass: sourceClassFromServiceClassification(classification),
      txHash: edge.txHash,
      timestamp: edge.timestamp.toISOString()
    };
  });
}
```

Use existing helper names for classification if they already exist in `incomingDepositJob.ts`. Keep the mapper local and deterministic.

- [ ] **Step 4: Populate shared and compatibility fields**

In the object that returns `IncomingDepositRiskReport`, set:

```ts
const sourceBundleExposure = buildSourceBundleExposure({
  scope: "incoming_deposit",
  targetAmountRaw: deposit.amountRaw,
  findings: originPaths
    .map(sourceFindingFromIncomingOriginPath)
    .filter((finding): finding is SourceBundleExposureFinding => finding !== null),
  budget: {
    maxDepth: traceOptions.maxDepth ?? null,
    fetchedAddressCount: traceBudget.fetchedAddressCount ?? null,
    maxAddressFetches: traceOptions.maxAddressFetches ?? null,
    liveTransferReadCount: traceBudget.liveTransferReadCount ?? null,
    skippedAddressCount: traceBudget.skippedAddressCount ?? 0,
    exhausted: traceBudget.exhausted,
    exhaustedPhase: traceBudget.exhausted ? "trace" : null
  }
});

const subjectExposureProfile = buildSubjectExposureProfile({
  subjectAddress: deposit.sender,
  windowStart: senderExposureWindow.start.toISOString(),
  windowEnd: senderExposureWindow.end.toISOString(),
  transferEventsScanned: senderExposureEdges.length,
  events: subjectExposureEventsFromEdges({
    subjectAddress: deposit.sender,
    edges: senderExposureEdges,
    classifyAddress: getCachedClassificationForAddress
  })
});

const freshBundleExposure = incomingFreshBundleExposureFromSourceProfile(sourceBundleExposure);
const walletExposureProfile = incomingWalletExposureProfileFromSubjectProfile(subjectExposureProfile);
```

Use the existing variable names in `incomingDepositJob.ts` for `deposit`, `traceOptions`, `traceBudget`, `senderExposureWindow`, and `senderExposureEdges`. The values must come from data already present in the report assembly path.

Add these fields to the returned report:

```ts
sourceBundleExposure,
subjectExposureProfile,
freshBundleExposure,
walletExposureProfile
```

- [ ] **Step 5: Run incoming job and risk tests**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts tests/risk/unifiedWalletRisk.test.ts --configLoader bundle
```

Expected result:

```text
PASS tests/forensics/incomingDepositJob.test.ts
PASS tests/risk/unifiedWalletRisk.test.ts
```

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "Write shared exposure profiles on incoming reports"
```

Review gate before next task:

```text
Confirm b4603-style stale HTX can appear in subjectExposureProfile but not in sourceBundleExposure.
Confirm unifiedRiskSummary still has one finalScore and one finalDecision.
```

## Task 4: Attach Shared Exposure Profiles To Where Is Money Reports

**Files:**
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `tests/check/whereIsMoneyCheck.test.ts`
- Test: `tests/forensics/moneyOriginOperationalAssessment.test.ts`

- [ ] **Step 1: Add Where report tests for shared source exposure**

In `tests/check/whereIsMoneyCheck.test.ts`, add tests near the source-policy evidence tests:

```ts
it("returns shared source bundle exposure for requested-amount provenance", async () => {
  const report = await runWhereIsMoneyCheck({
    ...whereIsMoneyInput({
      subjectAddress: "TSubject",
      requestedAmountRaw: "100000000000"
    }),
    balanceFormingTransfers: [
      balanceFormingTransfer({
        fromAddress: "THTX",
        toAddress: "TSubject",
        amountRaw: "70000000000",
        txHash: "tx-htx",
        timestamp: new Date("2026-06-04T10:00:00.000Z")
      }),
      balanceFormingTransfer({
        fromAddress: "TClean",
        toAddress: "TSubject",
        amountRaw: "30000000000",
        txHash: "tx-clean",
        timestamp: new Date("2026-06-04T10:10:00.000Z")
      })
    ],
    classifyAddress: async (address) => {
      if (address === "THTX") return serviceClassification({ category: "cex", identity: "HTX 4" });
      if (address === "TClean") return serviceClassification({ category: "cex", identity: "Binance" });
      return null;
    }
  });

  expect(report.sourceBundleExposure).toEqual(expect.objectContaining({
    scope: "where_requested_amount",
    htxHuobiShare: 0.7,
    cleanCexShare: 0.3,
    dominantSource: "htx_huobi"
  }));
  expect(report.subjectExposureProfile).toEqual(expect.objectContaining({
    subjectAddress: "TSubject"
  }));
});

it("does not convert historical subject exposure into selected amount source proof", async () => {
  const report = await runWhereIsMoneyCheck({
    ...whereIsMoneyInput({
      subjectAddress: "TSubject",
      requestedAmountRaw: "100000000000"
    }),
    balanceFormingTransfers: [
      balanceFormingTransfer({
        fromAddress: "TUnknown",
        toAddress: "TSubject",
        amountRaw: "100000000000",
        txHash: "fresh-unknown",
        timestamp: new Date("2026-06-04T11:00:00.000Z")
      })
    ],
    historicalTransfers: [
      forensicEdge({
        fromAddress: "THTX",
        toAddress: "TSubject",
        amountRaw: "249590000000",
        txHash: "stale-htx",
        timestamp: new Date("2026-05-14T12:00:00.000Z")
      }),
      forensicEdge({
        fromAddress: "TSubject",
        toAddress: "TSpent",
        amountRaw: "303919000000",
        txHash: "spent-stale",
        timestamp: new Date("2026-05-14T12:51:06.000Z")
      })
    ],
    classifyAddress: async (address) => {
      if (address === "THTX") return serviceClassification({ category: "cex", identity: "HTX 4" });
      return null;
    }
  });

  expect(report.sourceBundleExposure?.htxHuobiShare).toBe(0);
  expect(report.subjectExposureProfile?.htxHuobiIncomingShare).toBeGreaterThan(0);
  expect(report.decisionReasons.join(" ")).not.toContain("HTX/Huobi funds 100% of the selected amount");
});
```

Use the existing helper names in `tests/check/whereIsMoneyCheck.test.ts`. Keep the assertion intent unchanged when adapting helper calls.

- [ ] **Step 2: Run Where tests and verify the expected failure**

Run:

```bash
npx vitest run tests/check/whereIsMoneyCheck.test.ts --configLoader bundle
```

Expected result:

```text
FAIL tests/check/whereIsMoneyCheck.test.ts
expected report.sourceBundleExposure to equal object containing scope where_requested_amount
```

- [ ] **Step 3: Add Where path-to-finding mapping**

Modify `src/check/whereIsMoneyCheck.ts`.

Add imports:

```ts
import {
  buildSourceBundleExposure,
  buildSubjectExposureProfile
} from "../forensics/sourceBundleExposure";
import type {
  SourceBundleExposureFinding,
  SourceBundleExposureScope,
  SubjectExposureEvent
} from "../types";
```

Add local helper:

```ts
function whereSourceExposureScope(input: {
  requestedAmountRaw: string | null;
  transactionSeedTxHash: string | null;
  currentUsdtBalanceRaw: string | null;
}): SourceBundleExposureScope {
  if (input.transactionSeedTxHash) return "where_transaction_seed";
  if (input.requestedAmountRaw) return "where_requested_amount";
  if (input.currentUsdtBalanceRaw) return "where_current_balance";
  return "where_recent_flow";
}
```

Add local mapper:

```ts
function sourceFindingFromMoneyOriginPath(path: MoneyOriginPath): SourceBundleExposureFinding | null {
  const share = selectedMoneyOriginPathShare(path);
  if (share <= 0) return null;
  return {
    sourceClass: sourceExposureKindFromPath(path),
    amountRaw: path.amountRaw ?? "0",
    share,
    evidenceTxHashes: path.txHashes,
    stoppedReason: path.stoppedReason,
    proofKind: "selected_amount"
  };
}
```

Use existing imports from `moneyOriginAttribution` and `provenanceScoring` if they are already present. If `selectedMoneyOriginPathShare` or `sourceExposureKindFromPath` are not exported to this file, export them from their current modules instead of reimplementing the logic.

- [ ] **Step 4: Build shared profiles before assessment**

In `runWhereIsMoneyCheck`, after `originPaths` and coverage are available, add:

```ts
const sourceBundleExposure = buildSourceBundleExposure({
  scope: whereSourceExposureScope({
    requestedAmountRaw: input.requestedAmountRaw ?? null,
    transactionSeedTxHash: input.transactionSeedTxHash ?? null,
    currentUsdtBalanceRaw
  }),
  targetAmountRaw: input.requestedAmountRaw ?? currentUsdtBalanceRaw ?? null,
  findings: originPaths
    .map(sourceFindingFromMoneyOriginPath)
    .filter((finding): finding is SourceBundleExposureFinding => finding !== null),
  budget: {
    maxDepth: traceOptions.maxDepth ?? null,
    fetchedAddressCount: traceBudget.fetchedAddressCount ?? null,
    maxAddressFetches: traceOptions.maxAddressFetches ?? null,
    liveTransferReadCount: traceBudget.liveTransferReadCount ?? null,
    skippedAddressCount: traceBudget.skippedAddressCount ?? 0,
    exhausted: traceBudget.exhausted,
    exhaustedPhase: traceBudget.exhausted ? "trace" : null
  }
});
```

Build historical subject profile from the same transfer window already used for sender interaction profiles:

```ts
const subjectExposureProfile = buildSubjectExposureProfile({
  subjectAddress: input.subjectAddress,
  windowStart: subjectTransferWindow.start.toISOString(),
  windowEnd: subjectTransferWindow.end.toISOString(),
  transferEventsScanned: subjectTransferEdges.length,
  events: subjectTransferEdges.map((edge): SubjectExposureEvent => {
    const counterparty = edge.fromAddress === input.subjectAddress ? edge.toAddress : edge.fromAddress;
    return {
      direction: edge.toAddress === input.subjectAddress ? "incoming" : "outgoing",
      amountRaw: edge.amountRaw,
      counterparty,
      sourceClass: sourceClassFromServiceClassification(getCachedClassificationForAddress(counterparty)),
      txHash: edge.txHash,
      timestamp: edge.timestamp.toISOString()
    };
  })
});
```

Use existing variable names in `whereIsMoneyCheck.ts`. Do not add new provider reads for this step.

- [ ] **Step 5: Write the shared fields into `WhereIsMoneyReport`**

Add these properties to the returned report object:

```ts
sourceBundleExposure,
subjectExposureProfile,
```

Place them before:

```ts
assessment,
```

- [ ] **Step 6: Run Where tests**

Run:

```bash
npx vitest run tests/check/whereIsMoneyCheck.test.ts --configLoader bundle
```

Expected result:

```text
PASS tests/check/whereIsMoneyCheck.test.ts
```

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add src/check/whereIsMoneyCheck.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "Expose shared source profiles in where is money"
```

Review gate before next task:

```text
Confirm Where report JSON includes sourceBundleExposure and subjectExposureProfile.
Confirm no bot or admin consumer is required to read the new fields to keep old behavior working.
```

## Task 5: Add Shared Exposure Score Floors To Where Assessment

**Files:**
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
- Modify: `tests/forensics/moneyOriginOperationalAssessment.test.ts`
- Modify: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add assessment tests for fresh source floors**

Append these tests to `tests/forensics/moneyOriginOperationalAssessment.test.ts`:

```ts
it("floors Where risk at 85 and declines when selected HTX/Huobi share is at least 70%", () => {
  const assessment = buildMoneyOriginOperationalAssessment({
    ...baseAssessmentInput(),
    sourceBundleExposure: sourceBundleExposure({
      htxHuobiShare: 0.7,
      cleanCexShare: 0.3,
      dominantSource: "htx_huobi"
    }),
    subjectExposureProfile: null
  });

  expect(assessment.riskScore).toBeGreaterThanOrEqual(85);
  expect(assessment.userDecision).toBe("DECLINE");
  expect(assessment.sourcePolicyEvidence.map((item) => item.kind)).toContain("htx_huobi");
});

it("floors Where risk at 70 and declines when selected HTX/Huobi share is at least 30%", () => {
  const assessment = buildMoneyOriginOperationalAssessment({
    ...baseAssessmentInput(),
    sourceBundleExposure: sourceBundleExposure({
      htxHuobiShare: 0.31,
      cleanCexShare: 0.69,
      dominantSource: "clean_cex"
    }),
    subjectExposureProfile: null
  });

  expect(assessment.riskScore).toBeGreaterThanOrEqual(70);
  expect(assessment.userDecision).toBe("DECLINE");
});

it("floors Where risk at 60 and declines when selected bridge/router/DEX share is at least 50%", () => {
  const assessment = buildMoneyOriginOperationalAssessment({
    ...baseAssessmentInput(),
    sourceBundleExposure: sourceBundleExposure({
      bridgeRouterDexShare: 0.5,
      unknownShare: 0.5,
      dominantSource: "bridge_router_dex"
    }),
    subjectExposureProfile: null
  });

  expect(assessment.riskScore).toBeGreaterThanOrEqual(60);
  expect(assessment.userDecision).toBe("DECLINE");
});

it("caps historical subject exposure contribution and does not auto-decline from background HTX alone", () => {
  const assessment = buildMoneyOriginOperationalAssessment({
    ...baseAssessmentInput(),
    sourceBundleExposure: sourceBundleExposure({
      cleanCexShare: 1,
      dominantSource: "clean_cex"
    }),
    subjectExposureProfile: subjectExposureProfile({
      htxHuobiIncomingShare: 0.8,
      scoreContribution: 20
    })
  });

  expect(assessment.riskScore).toBeLessThan(70);
  expect(assessment.userDecision).not.toBe("DECLINE");
  expect(assessment.decisionReasons.join(" ")).toContain("historical HTX/Huobi");
  expect(assessment.decisionReasons.join(" ")).not.toContain("selected amount came from HTX/Huobi");
});
```

Add helper builders in the same test file:

```ts
function sourceBundleExposure(
  overrides: Partial<SourceBundleExposureProfile>
): SourceBundleExposureProfile {
  return {
    scope: "where_requested_amount",
    targetAmountRaw: "100000000000",
    coveredAmountRaw: "100000000000",
    coverageRatio: 1,
    htxHuobiShare: 0,
    cleanCexShare: 0,
    bridgeRouterDexShare: 0,
    unknownContractShare: 0,
    riskyLabelShare: 0,
    unknownShare: 1,
    dominantSource: "unknown",
    evidenceTxHashes: ["tx-source"],
    reasons: [],
    warnings: [],
    budget: {
      maxDepth: 4,
      fetchedAddressCount: 1,
      maxAddressFetches: 20,
      liveTransferReadCount: 50,
      skippedAddressCount: 0,
      exhausted: false,
      exhaustedPhase: null
    },
    unresolvedBoundary: null,
    ...overrides
  };
}

function subjectExposureProfile(
  overrides: Partial<SubjectExposureProfile>
): SubjectExposureProfile {
  return {
    subjectAddress: "TSubject",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-06-04T12:00:00.000Z",
    transferEventsScanned: 10,
    incomingVolumeRaw: "100000000000",
    outgoingVolumeRaw: "90000000000",
    htxHuobiIncomingShare: 0,
    cleanCexIncomingShare: 0,
    bridgeRouterDexVolumeShare: 0,
    unknownContractVolumeShare: 0,
    unknownSourceShare: 0,
    inOutVelocityScore: 0,
    scoreContribution: 0,
    reasons: [],
    warnings: [],
    ...overrides
  };
}
```

- [ ] **Step 2: Run assessment tests and verify the expected failure**

Run:

```bash
npx vitest run tests/forensics/moneyOriginOperationalAssessment.test.ts --configLoader bundle
```

Expected result:

```text
FAIL tests/forensics/moneyOriginOperationalAssessment.test.ts
Object literal may only specify known properties, and 'sourceBundleExposure' does not exist
```

- [ ] **Step 3: Extend assessment input**

Modify `src/forensics/moneyOriginOperationalAssessment.ts`.

Add imports:

```ts
import type {
  SourceBundleExposureProfile,
  SubjectExposureProfile
} from "../types";
```

Extend `BuildMoneyOriginOperationalAssessmentInput`:

```ts
  sourceBundleExposure?: SourceBundleExposureProfile | null;
  subjectExposureProfile?: SubjectExposureProfile | null;
```

- [ ] **Step 4: Add source bundle policy layer builder**

In `src/forensics/moneyOriginOperationalAssessment.ts`, add:

```ts
function sourceBundlePolicyLayer(profile: SourceBundleExposureProfile | null | undefined): RiskLayerScore | null {
  if (!profile) return null;

  let score = 0;
  let message = "";
  let proofLevel: ProofLevel = "operational_liquidity_context";
  let userDecision: "DECLINE" | "ACCEPTABLE" | null = null;

  if (profile.riskyLabelShare >= 0.1) {
    score = 85;
    message = `Risky label funds ${Math.round(profile.riskyLabelShare * 100)}% of the selected amount.`;
    proofLevel = "exact_scam_or_taint_proof";
    userDecision = "DECLINE";
  } else if (profile.htxHuobiShare >= 0.7) {
    score = 85;
    message = `HTX/Huobi funds ${Math.round(profile.htxHuobiShare * 100)}% of the selected amount.`;
    proofLevel = "exchange_policy_decline";
    userDecision = "DECLINE";
  } else if (profile.htxHuobiShare >= 0.3) {
    score = 70;
    message = `HTX/Huobi funds ${Math.round(profile.htxHuobiShare * 100)}% of the selected amount.`;
    proofLevel = "exchange_policy_decline";
    userDecision = "DECLINE";
  } else if (profile.bridgeRouterDexShare >= 0.5) {
    score = 60;
    message = `Bridge/router/DEX funds ${Math.round(profile.bridgeRouterDexShare * 100)}% of the selected amount.`;
    proofLevel = "operational_liquidity_context";
    userDecision = "DECLINE";
  } else if (profile.htxHuobiShare >= 0.1) {
    score = 55;
    message = `HTX/Huobi funds ${Math.round(profile.htxHuobiShare * 100)}% of the selected amount.`;
    proofLevel = "exchange_policy_context";
  } else if (profile.unknownContractShare >= 0.5) {
    score = 45;
    message = `Unknown contract funds ${Math.round(profile.unknownContractShare * 100)}% of the selected amount.`;
  } else if (profile.unresolvedBoundary) {
    score = profile.unresolvedBoundary.scoreFloor;
    message = profile.unresolvedBoundary.reason;
  }

  if (score <= 0) return null;

  return {
    kind: "source_bundle_exposure",
    score,
    rawScore: score,
    adjustedScore: score,
    evidenceClass: "source_policy",
    proofLevel,
    canBeDampened: userDecision !== "DECLINE",
    message,
    reasons: [message],
    evidenceIds: profile.evidenceTxHashes,
    metadata: {
      scope: profile.scope,
      htxHuobiShare: profile.htxHuobiShare,
      bridgeRouterDexShare: profile.bridgeRouterDexShare,
      unknownContractShare: profile.unknownContractShare,
      riskyLabelShare: profile.riskyLabelShare,
      unresolvedBoundary: profile.unresolvedBoundary
    }
  };
}
```

Use the existing `RiskLayerScore` field names in the file. If `RiskLayerScore` has a different required field, add the field with a literal value that matches existing source-policy layers.

- [ ] **Step 5: Add historical subject context layer**

In the same file, add:

```ts
function subjectExposureContextLayer(profile: SubjectExposureProfile | null | undefined): RiskLayerScore | null {
  if (!profile || profile.scoreContribution <= 0) return null;

  const score = Math.min(20, Math.max(0, Math.round(profile.scoreContribution)));
  const reasons = profile.reasons.length > 0
    ? profile.reasons
    : ["Historical subject exposure adds background context only."];

  return {
    kind: "subject_exposure_context",
    score,
    rawScore: score,
    adjustedScore: score,
    evidenceClass: "behavior",
    proofLevel: "operational_liquidity_context",
    canBeDampened: true,
    message: "Historical subject exposure adds background context; it is not selected-amount source proof.",
    reasons,
    evidenceIds: [],
    metadata: {
      htxHuobiIncomingShare: profile.htxHuobiIncomingShare,
      bridgeRouterDexVolumeShare: profile.bridgeRouterDexVolumeShare,
      unknownContractVolumeShare: profile.unknownContractVolumeShare,
      unknownSourceShare: profile.unknownSourceShare,
      scoreContribution: score
    }
  };
}
```

- [ ] **Step 6: Include the new layers in assessment aggregation**

In `buildMoneyOriginOperationalAssessment`, add:

```ts
const sourceBundleLayer = sourceBundlePolicyLayer(input.sourceBundleExposure);
const subjectExposureLayer = subjectExposureContextLayer(input.subjectExposureProfile);
```

When constructing `extraRiskLayers` or the local layer array, include:

```ts
...(sourceBundleLayer ? [sourceBundleLayer] : []),
...(subjectExposureLayer ? [subjectExposureLayer] : []),
```

When determining `userDecision`, preserve current hard evidence priority and add:

```ts
const sourceBundleDecline =
  sourceBundleLayer?.proofLevel === "exchange_policy_decline" ||
  sourceBundleLayer?.proofLevel === "exact_scam_or_taint_proof" ||
  (input.sourceBundleExposure?.bridgeRouterDexShare ?? 0) >= 0.5;
```

Then include `sourceBundleDecline` in the same branch that returns `DECLINE`.

- [ ] **Step 7: Pass shared profiles from Where into assessment**

Modify `src/check/whereIsMoneyCheck.ts` where `buildMoneyOriginOperationalAssessment` is called:

```ts
const assessment = buildMoneyOriginOperationalAssessment({
  fastWalletRisk,
  originPaths,
  senderInteractionProfiles,
  approvalDrainProvenanceProfiles,
  approvalDrainReviewFindings,
  contractLlmVerdicts,
  coverage,
  ageSignals,
  extraSourcePolicyEvidence,
  extraRiskLayers,
  extraHardBadEvidence,
  sourceBundleExposure,
  subjectExposureProfile
});
```

Use existing fields already passed at that callsite and append the two new profile fields.

- [ ] **Step 8: Run assessment and Where tests**

Run:

```bash
npx vitest run tests/forensics/moneyOriginOperationalAssessment.test.ts tests/check/whereIsMoneyCheck.test.ts --configLoader bundle
```

Expected result:

```text
PASS tests/forensics/moneyOriginOperationalAssessment.test.ts
PASS tests/check/whereIsMoneyCheck.test.ts
```

- [ ] **Step 9: Commit Task 5**

Run:

```bash
git add src/forensics/moneyOriginOperationalAssessment.ts src/check/whereIsMoneyCheck.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "Apply shared source exposure floors to where scoring"
```

Review gate before next task:

```text
Confirm background subject exposure is capped at 20 points.
Confirm selected HTX/Huobi high-share and bridge high-share can drive final DECLINE.
Confirm clean CEX share does not remove hard proof layers.
```

## Task 6: Add Coverage-Limited Boundary Handling

**Files:**
- Modify: `src/forensics/sourceBundleExposure.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `tests/forensics/sourceBundleExposure.test.ts`
- Modify: `tests/check/whereIsMoneyCheck.test.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add tests for unresolved boundary floors**

Append this test to `tests/forensics/sourceBundleExposure.test.ts`:

```ts
it("uses known boundary class to choose unresolved score floor", () => {
  const profile = buildSourceBundleExposure({
    scope: "where_recent_flow",
    targetAmountRaw: "100000000000",
    findings: [
      finding({
        sourceClass: "unknown",
        amountRaw: "40000000000",
        share: 0.4,
        evidenceTxHashes: ["known-tx"],
        stoppedReason: "no_previous_transfer"
      })
    ],
    unresolvedBoundary: {
      kind: "htx_huobi",
      affectedShare: 0.6,
      reason: "Trace stopped at HTX/Huobi boundary before expansion completed.",
      evidenceTxHashes: ["boundary-tx"]
    },
    budget: {
      maxDepth: 4,
      fetchedAddressCount: 12,
      maxAddressFetches: 12,
      liveTransferReadCount: 100,
      skippedAddressCount: 9,
      exhausted: true,
      exhaustedPhase: "bundle_expansion"
    }
  });

  expect(profile.unresolvedBoundary).toEqual(expect.objectContaining({
    kind: "htx_huobi",
    affectedShare: 0.6,
    scoreFloor: 60
  }));
  expect(profile.warnings.join(" ")).toContain("coverage-limited");
});
```

- [ ] **Step 2: Add integration tests for budget-limited Where and Incoming reports**

In `tests/check/whereIsMoneyCheck.test.ts`, add:

```ts
it("keeps a budget-limited bridge boundary visible instead of treating missing exposure as zero", async () => {
  const report = await runWhereIsMoneyCheck({
    ...whereIsMoneyInput({ subjectAddress: "TSubject", requestedAmountRaw: "100000000000" }),
    traceBudgetOverride: {
      exhausted: true,
      exhaustedPhase: "bundle_expansion",
      skippedAddressCount: 5
    },
    originPaths: [
      moneyOriginPath({
        stoppedReason: "bridge_router_dex_reached",
        balanceShare: 0.55,
        txHashes: ["bridge-boundary-tx"]
      })
    ]
  });

  expect(report.sourceBundleExposure?.unresolvedBoundary).toEqual(expect.objectContaining({
    kind: "bridge_router_dex",
    scoreFloor: 55
  }));
  expect(report.assessment.riskScore).toBeGreaterThanOrEqual(55);
});
```

In `tests/forensics/incomingDepositJob.test.ts`, add:

```ts
it("writes unresolved boundary when incoming trace budget stops before material bridge expansion", async () => {
  const result = await buildIncomingDepositReport({
    ...incomingDepositJobInput({ txHash: "budget-limited-bridge", sender: "TSender", watchedWallet: "TWatched" }),
    traceBudgetOverride: {
      exhausted: true,
      exhaustedPhase: "bundle_expansion",
      skippedAddressCount: 5
    },
    originPaths: [
      incomingOriginPath({
        stoppedReason: "bridge_router_dex_reached",
        balanceShare: 0.55,
        txHashes: ["bridge-boundary-tx"]
      })
    ]
  });

  expect(result.sourceBundleExposure?.unresolvedBoundary).toEqual(expect.objectContaining({
    kind: "bridge_router_dex",
    scoreFloor: 55
  }));
  expect(result.sourceBundleExposure?.warnings.join(" ")).toContain("coverage-limited");
});
```

Use current helper names and fixture hooks. Keep the assertions about unresolved boundary unchanged.

- [ ] **Step 3: Run the new tests and verify the expected failures**

Run:

```bash
npx vitest run tests/forensics/sourceBundleExposure.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts --configLoader bundle
```

Expected result:

```text
FAIL tests/check/whereIsMoneyCheck.test.ts
FAIL tests/forensics/incomingDepositJob.test.ts
```

The pure source bundle test should pass after Task 1, but integration tests should fail until budget boundary inputs are wired.

- [ ] **Step 4: Add boundary extraction helper**

In `src/forensics/sourceBundleExposure.ts`, add:

```ts
export function unresolvedBoundaryFromFindings(input: {
  findings: SourceBundleExposureFinding[];
  budget: SourceBundleExposureBudget;
}): SourceBundleUnresolvedBoundaryInput | null {
  if (!input.budget.exhausted) return null;

  const materialStoppedFinding = input.findings
    .filter((finding) => finding.share >= 0.1)
    .find((finding) =>
      finding.sourceClass === "htx_huobi" ||
      finding.sourceClass === "bridge_router_dex" ||
      finding.sourceClass === "unknown_contract" ||
      finding.sourceClass === "risky_label"
    );

  if (materialStoppedFinding) {
    return {
      kind: materialStoppedFinding.sourceClass,
      affectedShare: materialStoppedFinding.share,
      reason: `Trace stopped before fully resolving material ${materialStoppedFinding.sourceClass} boundary.`,
      evidenceTxHashes: materialStoppedFinding.evidenceTxHashes
    };
  }

  const unknownShare = input.findings
    .filter((finding) => finding.sourceClass === "unknown")
    .reduce((sum, finding) => sum + finding.share, 0);

  if (unknownShare >= 0.1) {
    return {
      kind: "unknown",
      affectedShare: clampShare(unknownShare),
      reason: "Trace stopped before fully resolving a material unknown boundary.",
      evidenceTxHashes: input.findings.flatMap((finding) => finding.evidenceTxHashes)
    };
  }

  return null;
}
```

- [ ] **Step 5: Use the boundary helper in Where**

In `src/check/whereIsMoneyCheck.ts`, after building `findings`, add:

```ts
const sourceBundleFindings = originPaths
  .map(sourceFindingFromMoneyOriginPath)
  .filter((finding): finding is SourceBundleExposureFinding => finding !== null);

const sourceBundleBudget = {
  maxDepth: traceOptions.maxDepth ?? null,
  fetchedAddressCount: traceBudget.fetchedAddressCount ?? null,
  maxAddressFetches: traceOptions.maxAddressFetches ?? null,
  liveTransferReadCount: traceBudget.liveTransferReadCount ?? null,
  skippedAddressCount: traceBudget.skippedAddressCount ?? 0,
  exhausted: traceBudget.exhausted,
  exhaustedPhase: traceBudget.exhaustedPhase ?? (traceBudget.exhausted ? "trace" : null)
};

const sourceBundleExposure = buildSourceBundleExposure({
  scope: whereSourceExposureScope({
    requestedAmountRaw: input.requestedAmountRaw ?? null,
    transactionSeedTxHash: input.transactionSeedTxHash ?? null,
    currentUsdtBalanceRaw
  }),
  targetAmountRaw: input.requestedAmountRaw ?? currentUsdtBalanceRaw ?? null,
  findings: sourceBundleFindings,
  budget: sourceBundleBudget,
  unresolvedBoundary: unresolvedBoundaryFromFindings({
    findings: sourceBundleFindings,
    budget: sourceBundleBudget
  })
});
```

Add the import:

```ts
import { unresolvedBoundaryFromFindings } from "../forensics/sourceBundleExposure";
```

- [ ] **Step 6: Use the boundary helper in Incoming**

In `src/forensics/incomingDepositJob.ts`, build `sourceBundleFindings` and `sourceBundleBudget` once, then pass:

```ts
unresolvedBoundary: unresolvedBoundaryFromFindings({
  findings: sourceBundleFindings,
  budget: sourceBundleBudget
})
```

to `buildSourceBundleExposure`.

- [ ] **Step 7: Run coverage tests**

Run:

```bash
npx vitest run tests/forensics/sourceBundleExposure.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts --configLoader bundle
```

Expected result:

```text
PASS tests/forensics/sourceBundleExposure.test.ts
PASS tests/check/whereIsMoneyCheck.test.ts
PASS tests/forensics/incomingDepositJob.test.ts
```

- [ ] **Step 8: Commit Task 6**

Run:

```bash
git add src/forensics/sourceBundleExposure.ts src/check/whereIsMoneyCheck.ts src/forensics/incomingDepositJob.ts tests/forensics/sourceBundleExposure.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "Track unresolved source boundaries under trace budgets"
```

Review gate before next task:

```text
Confirm budget exhaustion is visible in JSON reports.
Confirm unresolved boundary wording does not claim exact source proof.
```

## Task 7: Project Shared Exposure In Admin Graph And Bot Text

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `src/admin/adminConsole.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`
- Modify: `tests/bot/createBot.test.ts`
- Modify: `tests/alerts/formatters.test.ts`

- [ ] **Step 1: Add admin graph tests for shared source bundle nodes**

Append this test to `tests/admin/forensicsGraph.test.ts`:

```ts
it("projects shared source bundle exposure and unresolved boundary for where jobs", () => {
  const graph = buildForensicsGraph(forensicJob({
    kind: "where_is_money_check",
    status: "completed",
    result: {
      ...whereResult(),
      sourceBundleExposure: {
        scope: "where_requested_amount",
        targetAmountRaw: "100000000000",
        coveredAmountRaw: "45000000000",
        coverageRatio: 0.45,
        htxHuobiShare: 0,
        cleanCexShare: 0,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 1,
        dominantSource: "unknown",
        evidenceTxHashes: ["tx-known"],
        reasons: ["Uncovered selected source share is assigned to unknown."],
        warnings: ["Source bundle coverage-limited: graph budget stopped before every material boundary was resolved."],
        budget: {
          maxDepth: 4,
          fetchedAddressCount: 12,
          maxAddressFetches: 12,
          liveTransferReadCount: 100,
          skippedAddressCount: 5,
          exhausted: true,
          exhaustedPhase: "bundle_expansion"
        },
        unresolvedBoundary: {
          kind: "bridge_router_dex",
          affectedShare: 0.55,
          scoreFloor: 55,
          reason: "Trace stopped before fully resolving material bridge/router/DEX boundary.",
          evidenceTxHashes: ["bridge-boundary-tx"]
        }
      }
    }
  }));

  expect(graph.nodes.some((node) => node.kind === "source_bundle_exposure")).toBe(true);
  expect(graph.edges.some((edge) => edge.kind === "coverage_limited_boundary")).toBe(true);
  expect(JSON.stringify(graph)).toContain("bundle_expansion");
  expect(JSON.stringify(graph)).toContain("scoreFloor");
});
```

Append this test for incoming:

```ts
it("projects shared source bundle exposure for incoming deposit jobs", () => {
  const graph = buildForensicsGraph(forensicJob({
    kind: "incoming_deposit_check",
    status: "completed",
    result: {
      ...incomingDepositResult(),
      sourceBundleExposure: {
        scope: "incoming_deposit",
        targetAmountRaw: "100000000000",
        coveredAmountRaw: "100000000000",
        coverageRatio: 1,
        htxHuobiShare: 0.49,
        cleanCexShare: 0.51,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0,
        dominantSource: "clean_cex",
        evidenceTxHashes: ["tx-htx", "tx-clean"],
        reasons: ["HTX/Huobi accounts for 49% of checked-deposit source share."],
        warnings: [],
        budget: {
          maxDepth: 4,
          fetchedAddressCount: 2,
          maxAddressFetches: 20,
          liveTransferReadCount: 50,
          skippedAddressCount: 0,
          exhausted: false,
          exhaustedPhase: null
        },
        unresolvedBoundary: null
      }
    }
  }));

  expect(graph.nodes.some((node) => node.kind === "source_bundle_exposure")).toBe(true);
  expect(JSON.stringify(graph)).toContain("htxHuobiShare");
  expect(JSON.stringify(graph)).toContain("cleanCexShare");
});
```

Use existing test helpers from the file. Keep the assertions focused on graph nodes, edges, metadata, and budget visibility.

- [ ] **Step 2: Run admin graph tests and verify the expected failure**

Run:

```bash
npx vitest run tests/admin/forensicsGraph.test.ts --configLoader bundle
```

Expected result:

```text
FAIL tests/admin/forensicsGraph.test.ts
expected graph.nodes.some(...) to be true
```

- [ ] **Step 3: Add graph projection for shared source bundle**

Modify `src/admin/forensicsGraph.ts`.

Add a reusable projection helper:

```ts
function addSourceBundleExposureGraph(input: {
  graph: MutableForensicsGraph;
  parentId: string;
  mode: "where_is_money" | "incoming_deposit";
  exposure: Record<string, unknown>;
}): void {
  const id = `${input.parentId}:source_bundle_exposure`;
  input.graph.nodes.push({
    id,
    kind: "source_bundle_exposure",
    label: "Source bundle exposure",
    riskScore: numberField(input.exposure, "unresolvedBoundary")
      ? numberField(recordField(input.exposure, "unresolvedBoundary"), "scoreFloor")
      : null,
    metadata: {
      mode: input.mode,
      scope: stringField(input.exposure, "scope"),
      targetAmountRaw: stringField(input.exposure, "targetAmountRaw"),
      coveredAmountRaw: stringField(input.exposure, "coveredAmountRaw"),
      coverageRatio: numberField(input.exposure, "coverageRatio"),
      htxHuobiShare: numberField(input.exposure, "htxHuobiShare"),
      cleanCexShare: numberField(input.exposure, "cleanCexShare"),
      bridgeRouterDexShare: numberField(input.exposure, "bridgeRouterDexShare"),
      unknownContractShare: numberField(input.exposure, "unknownContractShare"),
      riskyLabelShare: numberField(input.exposure, "riskyLabelShare"),
      unknownShare: numberField(input.exposure, "unknownShare"),
      dominantSource: stringField(input.exposure, "dominantSource")
    }
  });
  input.graph.edges.push({
    from: input.parentId,
    to: id,
    kind: "source_bundle_exposure",
    weight: numberField(input.exposure, "coverageRatio") ?? 0,
    metadata: {
      reasons: arrayField(input.exposure, "reasons"),
      warnings: arrayField(input.exposure, "warnings"),
      budget: recordField(input.exposure, "budget")
    }
  });

  const unresolvedBoundary = recordField(input.exposure, "unresolvedBoundary");
  if (unresolvedBoundary) {
    const boundaryId = `${id}:unresolved_boundary`;
    input.graph.nodes.push({
      id: boundaryId,
      kind: "coverage_limited_boundary",
      label: "Coverage-limited boundary",
      riskScore: numberField(unresolvedBoundary, "scoreFloor"),
      metadata: unresolvedBoundary
    });
    input.graph.edges.push({
      from: id,
      to: boundaryId,
      kind: "coverage_limited_boundary",
      weight: numberField(unresolvedBoundary, "affectedShare") ?? 0,
      metadata: {
        evidenceTxHashes: arrayField(unresolvedBoundary, "evidenceTxHashes"),
        reason: stringField(unresolvedBoundary, "reason")
      }
    });
  }
}
```

Use existing graph node and edge types in the file. If the local type names differ, keep the same helper body and adjust only the type annotations.

- [ ] **Step 4: Call graph projection for Where and Incoming jobs**

In the Where graph branch:

```ts
const sourceBundleExposure = recordField(result, "sourceBundleExposure");
if (sourceBundleExposure) {
  addSourceBundleExposureGraph({
    graph,
    parentId: reportNodeId,
    mode: "where_is_money",
    exposure: sourceBundleExposure
  });
}
```

In the Incoming graph branch:

```ts
const sourceBundleExposure = recordField(result, "sourceBundleExposure");
if (sourceBundleExposure) {
  addSourceBundleExposureGraph({
    graph,
    parentId: reportNodeId,
    mode: "incoming_deposit",
    exposure: sourceBundleExposure
  });
}
```

- [ ] **Step 5: Add bot/report text tests for factual wording**

In `tests/bot/createBot.test.ts` or `tests/alerts/formatters.test.ts`, add assertions that message text uses exact-source wording only when `sourceBundleExposure.htxHuobiShare > 0`:

```ts
expect(message).toContain("HTX/Huobi funds 70% of the selected amount");
expect(message).not.toContain("historical HTX/Huobi funds the selected amount");
```

For background context:

```ts
expect(message).toContain("Historical HTX/Huobi exposure");
expect(message).toContain("not selected-amount source proof");
```

- [ ] **Step 6: Update bot/admin text consumers**

Modify `src/bot/createBot.ts` and `src/admin/adminConsole.ts`.

Use these wording rules:

```text
Fresh source proof: "HTX/Huobi funds 70% of the selected amount."
Background context: "Historical HTX/Huobi exposure is context, not selected-amount source proof."
Coverage boundary: "The graph stopped before resolving a material bridge/router/DEX boundary."
```

Do not remove existing lines that display `sourcePolicyEvidence`.

- [ ] **Step 7: Run admin and bot tests**

Run:

```bash
npx vitest run tests/admin/forensicsGraph.test.ts tests/bot/createBot.test.ts tests/alerts/formatters.test.ts --configLoader bundle
```

Expected result:

```text
PASS tests/admin/forensicsGraph.test.ts
PASS tests/bot/createBot.test.ts
PASS tests/alerts/formatters.test.ts
```

- [ ] **Step 8: Commit Task 7**

Run:

```bash
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts src/bot/createBot.ts tests/admin/forensicsGraph.test.ts tests/bot/createBot.test.ts tests/alerts/formatters.test.ts
git commit -m "Show shared source exposure in reports and graph"
```

Review gate before next task:

```text
Confirm admin graph shows sourceBundleExposure for both job kinds.
Confirm bot text separates fresh proof from historical context.
```

## Task 8: Run Saved-Case Comparisons And Update Documentation

**Files:**
- Modify: `docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md`
- Create: `docs/project-walkthrough/05-shared-source-bundle-exposure-rerun.md`

- [ ] **Step 1: Capture the current git SHA before reruns**

Run:

```bash
git rev-parse --short HEAD
```

Record the output in the new doc under:

```md
## Build Under Test
```

- [ ] **Step 2: Rerun the stale HTX incoming deposit case**

Run the existing forensic job rerun command used in prior incoming-deposit comparisons for:

```text
tx: b4603c390d3b0f08f9a604b26dc31d08e64aeeacc5a1560410bb5bbf030aa39c
sender: TPiyHJDDiUWUuyaxGdz1uTDyh8mDke67z3
watched wallet: TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM
```

Record:

```md
### b4603 stale HTX incoming deposit

Old behavior:
- Score: 85 CRITICAL / DECLINE
- Problem: stale HTX/Huobi transfer was treated as exact fresh source.

New expected behavior:
- sourceBundleExposure.htxHuobiShare: 0
- subjectExposureProfile.htxHuobiIncomingShare: greater than 0
- score: not 85 from stale HTX alone
- decision: follows final score and active fresh/policy floors
```

- [ ] **Step 3: Rerun the budget-limited bridge boundary case**

Run the existing forensic job rerun command for:

```text
tx: 51a97751ede658756183529008db5147d645d9215b0b7373973c701bf0b95e39
```

Record:

```md
### 51a budget-limited bridge boundary

Old bounded rerun:
- Score: 42 LOW-MEDIUM / ACCEPTABLE
- Problem: missed bridge boundary was treated like zero risk.

New expected behavior:
- sourceBundleExposure.unresolvedBoundary.kind: bridge_router_dex
- sourceBundleExposure.unresolvedBoundary.scoreFloor: 55
- score: at least 55 unless stronger evidence exists
- wording: coverage-limited boundary, not exact bridge funding proof
```

- [ ] **Step 4: Rerun at least three additional incoming deposits from the historical score file**

Use `C:\Users\User\OneDrive\Desktop\оценки.txt`.

Pick three incoming deposit rows with different outcomes:

```text
one ACCEPTABLE or LOW case
one MEDIUM case
one HIGH or DECLINE case
```

For each case, record:

```md
### Case: transaction short hash from the selected score-file row

Before:
- fast / deep / where:
- final score:
- final decision:

After:
- sourceBundleExposure:
- subjectExposureProfile:
- unresolvedBoundary:
- final score:
- final decision:

Explanation:
- Fresh source proof:
- Historical context:
- Coverage limits:
- Why the final score is fairer:
```

- [ ] **Step 5: Rerun two Where Is Money jobs from existing saved forensic jobs**

Query existing jobs from storage using the project script or existing admin endpoint. Select:

```text
one where_is_money_check with service/bridge source-policy evidence
one where_is_money_check with mostly unknown or clean source context
```

Record the same before/after table.

- [ ] **Step 6: Update the scoring walkthrough**

Modify `docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md`.

Add a section:

```md
## Shared Source Bundle Exposure

The final score still has one user-facing value and one decision. The new shared exposure layer explains which part of the checked amount is fresh source proof, which part is historical wallet context, and which part is unresolved because runtime budget stopped the graph.

Fresh selected-amount exposure can set score floors. Historical subject exposure is capped at 20 points and cannot be described as exact source proof. Coverage-limited unresolved boundaries add conservative floors without claiming that the source is proven.
```

Add the score floor table from this plan.

- [ ] **Step 7: Create the rerun comparison doc**

Create `docs/project-walkthrough/05-shared-source-bundle-exposure-rerun.md` with:

```md
# Shared Source Bundle Exposure Rerun

Date: 2026-06-06.

## Build Under Test

Commit: use the short SHA captured in Step 1.

## What Changed

- Incoming deposit and Where Is Money now share `sourceBundleExposure`.
- Incoming deposit keeps `freshBundleExposure` and `walletExposureProfile` as compatibility fields.
- Where Is Money now exposes `sourceBundleExposure` and `subjectExposureProfile`.
- Fresh selected-amount exposure can set score floors.
- Historical subject exposure is capped and cannot become exact source proof.
- Budget-limited unresolved boundaries remain visible in score and graph output.

## Case Results

Add the case sections recorded in Steps 2, 3, 4, and 5. Each case must include before score, after score, fresh source proof, historical context, coverage limits, and final score explanation.

## Product Conclusion

The new behavior is more objective because it separates exact fresh funding proof from historical wallet background. It also prevents bounded graph runs from silently lowering risk when a material boundary remains unresolved.
```

- [ ] **Step 8: Commit Task 8**

Run:

```bash
git add docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md docs/project-walkthrough/05-shared-source-bundle-exposure-rerun.md
git commit -m "Document shared source exposure reruns"
```

Review gate before next task:

```text
Confirm docs include exact old/new case results.
Confirm docs do not describe historical HTX exposure as exact source proof.
```

## Task 9: Full Verification And PR Review

**Files:**
- Review all modified files from Tasks 1-8.

- [ ] **Step 1: Run targeted test suite**

Run:

```bash
npx vitest run tests/forensics/sourceBundleExposure.test.ts tests/forensics/incomingDepositExposureProfile.test.ts tests/forensics/incomingDepositJob.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/admin/forensicsGraph.test.ts tests/bot/createBot.test.ts tests/alerts/formatters.test.ts --configLoader bundle
```

Expected result:

```text
PASS selected test files
```

- [ ] **Step 2: Run full typecheck**

Run:

```bash
npm run typecheck
```

Expected result:

```text
tsc --noEmit
```

No TypeScript errors.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected result:

```text
vitest run --configLoader bundle
```

All tests pass.

- [ ] **Step 4: Review the diff for product correctness**

Run:

```bash
git diff HEAD~8..HEAD -- src types tests docs
```

Review checklist:

```text
Fresh source proof and historical context are separate fields.
Background score is capped at 20.
Unresolved boundaries include phase, affectedShare, scoreFloor, reason, evidence hashes.
Where and Incoming both write shared exposure profiles.
Incoming compatibility fields still exist.
Bot/admin wording does not overclaim stale HTX proof.
One final score and one final decision remain the user-facing output.
```

- [ ] **Step 5: Run PR review skill or subagent review**

Use the repository review workflow after tests pass:

```text
Run a code-review pass focused on scoring regressions, report compatibility, admin graph correctness, and missing tests.
Fix any P0/P1/P2 findings before final commit.
```

- [ ] **Step 6: Commit verification fixes**

When review produces fixes, run:

```bash
git add src/forensics/sourceBundleExposure.ts src/forensics/incomingDepositExposureProfile.ts src/forensics/incomingDepositJob.ts src/check/whereIsMoneyCheck.ts src/forensics/moneyOriginOperationalAssessment.ts src/admin/forensicsGraph.ts src/admin/adminConsole.ts src/bot/createBot.ts tests/forensics/sourceBundleExposure.test.ts tests/forensics/incomingDepositExposureProfile.test.ts tests/forensics/incomingDepositJob.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/admin/forensicsGraph.test.ts tests/bot/createBot.test.ts tests/alerts/formatters.test.ts docs/project-walkthrough/04-unified-wallet-risk-scoring-v2.md docs/project-walkthrough/05-shared-source-bundle-exposure-rerun.md
git commit -m "Address shared exposure review findings"
```

When review produces no fixes, do not create an empty commit.

- [ ] **Step 7: Final status**

Run:

```bash
git status --short
```

Expected result:

```text
clean working tree
```

## Subagent Execution Map

Use one fresh subagent per task:

```text
Task 1 subagent: shared types and pure builder.
Task 2 subagent: incoming compatibility migration.
Task 3 subagent: incoming report wiring.
Task 4 subagent: Where report wiring.
Task 5 subagent: Where scoring floors.
Task 6 subagent: coverage-limited boundary handling.
Task 7 subagent: admin graph and bot/reporting text.
Task 8 subagent: saved-case reruns and docs.
Task 9 reviewer: final PR review and verification.
```

After each subagent returns:

```text
Read the diff.
Run the task's targeted tests.
Fix issues in the main session or dispatch a narrow repair subagent.
Commit only after the task passes.
```

## Self-Review

Spec coverage:

```text
Shared source bundle exposure: Task 1.
Incoming backward compatibility: Tasks 2 and 3.
Where shared report fields: Task 4.
Fresh source score floors: Task 5.
Historical/background cap: Tasks 1 and 5.
Clean CEX dampening groundwork: Tasks 1 and 5; existing hard evidence priority remains.
Coverage-limited unresolved boundary: Task 6.
Admin graph and reporting: Task 7.
Saved-case comparisons: Task 8.
Full verification and review: Task 9.
```

Placeholder scan:

```text
No TBD markers.
No unnamed files.
No unbounded implementation tasks.
Each code-changing task has concrete tests, implementation snippets, commands, expected outcomes, and a commit command.
```

Type consistency:

```text
Shared report fields are named sourceBundleExposure and subjectExposureProfile in both IncomingDepositRiskReport and WhereIsMoneyReport.
Incoming compatibility fields remain freshBundleExposure and walletExposureProfile.
The shared source enum uses existing incoming source names: htx_huobi, clean_cex, bridge_router_dex, unknown_contract, risky_label, unknown.
The shared budget field uses exhaustedPhase values from the spec.
```
