# Phase 10A.12 Wallet Risk Policy, Roles, and Boundary Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an evidence-capped wallet risk policy, explicit wallet role classification, and boundary-context reporting so TRON/USDT `/check` can explain dirty-wallet risk without treating weak hop proximity or CEX/bridge/router boundaries as proof.

**Architecture:** Keep the existing forensic stack and Telegram UX shape, but add two read-only profiles (`WalletRoleProfile`, `BoundaryExposureProfile`) and one bounded scoring policy module. Existing detectors continue producing raw evidence and observations; Phase 10A.12 classifies those signals into dimensions, applies evidence-class caps, exposes wallet roles as context, and tightens 3-4 hop extended provenance risk impact while preserving beam-search candidate ranking.

**Tech Stack:** TypeScript, Vitest, existing `raw_evidence` / `risk_signal_observations`, existing TRON/USDT route graph types, existing Telegram formatting helpers.

---

## Scope

Phase 10A.12 implements the four items requested from the Phase 10A roadmap:

1. **Normalize scoring policy** into bounded dimensions:
   - provenance
   - approval-drain
   - behavior
   - service context
   - provider/label
   - dampeners
2. **Add `WalletRoleProfile`**:
   - victim
   - drainer_spender
   - first_receiver
   - collector
   - mule
   - cashout_service
   - treasury_like
   - unknown
3. **Add `BoundaryExposureProfile`** for HTX/Bybit/CEX/bridge/router/DEX/service contact as context, not proof continuation.
4. **Improve 4-hop scoring** by separating beam-search `candidateScore` from final `riskImpact` caps:
   - 3-hop exact labeled path max 45
   - 4-hop exact labeled path max 35
   - service-boundary context max 15
   - weak inferred context max 10

## Non-Goals

- No database migration in this phase. Store new profiles in existing raw evidence JSON and observations.
- No campaign-level clustering across many victims. That belongs in a later approval-drain campaign phase.
- No pre/post balance sweep analysis. That belongs in a later balance-snapshot phase.
- No major Telegram UX redesign. Add concise lines to existing forensic summary blocks only.

## Current Code Map

Existing files to build on:

- `src/risk/riskEngine.ts` - currently sums label, graph, behavior, and AML signals; exact stablecoin blacklist and approval-drain can reach 90.
- `src/risk/evaluation.ts` - converts labels/signals into raw evidence and observations.
- `src/check/manualCheck.ts` - exposes `ManualRiskSignals` and `ManualCheckResult` to bot/check flows.
- `src/check/deepForensicCheck.ts` - orchestrates service exposure, behavior, inbound provenance, counterparty risk, approval-drain provenance, stablecoin blacklist, and extended provenance.
- `src/forensics/temporalBeamSearch.ts` - 3-4 hop beam search; currently candidate score and path risk score are too close.
- `src/forensics/addressBehavior.ts` - deposit-then-drain, transit, collector-like, and dampener features.
- `src/forensics/serviceExposure.ts` - direct/indirect/merged exposure to service infrastructure.
- `src/forensics/approvalDrainProvenance.ts` - exact approval + `transferFrom` + receiver/route evidence.
- `src/forensics/serviceClassifier.ts` - service boundary classification.
- `src/bot/createBot.ts` - formats `/check` and deep forensic summaries.

## Target User-Facing Semantics

Use these exact concepts in report text:

- **Exact evidence:** official blacklist, internal scam/stolen/phishing label, exact approval-drain transferFrom provenance.
- **Strong route candidate:** same-chain labeled path with valid direction, time order, and amount preservation.
- **Behavioral risk:** collector/mule/transit-like activity without direct proof.
- **Boundary context:** funds touched CEX/bridge/router/DEX/service infrastructure; public-chain continuity stops there.

Never say that funds continued through a CEX/bridge/router unless there is exact same-chain evidence after the boundary. Use:

```text
Funds reached a CEX/bridge/service boundary; public-chain continuity after this point should not be assumed.
```

---

## File Structure

### Create

- `src/risk/riskPolicy.ts` - evidence classes, dimension caps, signal policy classification, bounded composite score helper.
- `src/forensics/walletRoleClassifier.ts` - pure classifier that emits `WalletRoleProfile` from existing profiles.
- `src/forensics/boundaryExposure.ts` - pure detector for direct and two-hop service boundary contact.
- `tests/risk/riskPolicy.test.ts` - policy cap and composite scoring tests.
- `tests/forensics/walletRoleClassifier.test.ts` - role classification tests.
- `tests/forensics/boundaryExposure.test.ts` - boundary exposure tests.

### Modify

- `src/types.ts` - add profile and policy types; extend `AddressExposureReport`.
- `src/risk/riskEngine.ts` - use `riskPolicy.ts` for bounded score calculation while preserving current `calculateRisk` signature.
- `src/check/manualCheck.ts` - expose `walletRoleProfiles` and `boundaryExposureProfiles` in manual results.
- `src/check/deepForensicCheck.ts` - build and return new profiles; persist evidence/observations.
- `src/check/addressExposureSignals.ts` - merge new profile arrays in fallback and normal signals.
- `src/forensics/routeSearch.ts` - include boundary and role profiles in standard address exposure report.
- `src/forensics/temporalBeamSearch.ts` - apply final risk caps by evidence class and depth.
- `src/bot/createBot.ts` - add concise role and boundary context lines.
- Existing tests listed in the task sections.

---

## Data Model

### Add to `src/types.ts`

Add these types near existing forensic profile types:

```ts
export type RiskDimension =
  | "provenance"
  | "approval_drain"
  | "behavior"
  | "service_context"
  | "provider_label"
  | "dampener";

export type RiskEvidenceClass =
  | "exact_self"
  | "exact_approval_drain"
  | "exact_labeled_path"
  | "service_boundary_context"
  | "weak_inferred"
  | "behavior_only"
  | "provider_label"
  | "dampener";

export type WalletRole =
  | "victim"
  | "drainer_spender"
  | "first_receiver"
  | "collector"
  | "mule"
  | "cashout_service"
  | "treasury_like"
  | "unknown";

export type WalletRoleReason = RouteScoreFeature & {
  role: WalletRole;
};

export type WalletRoleProfile = {
  subjectAddress: string;
  primaryRole: WalletRole;
  roles: Array<{
    role: WalletRole;
    confidence: RiskConfidence;
    score: number;
    reasons: WalletRoleReason[];
  }>;
  evidenceStrength: "exact" | "strong_behavior" | "context" | "weak";
  features: RouteScoreFeature[];
};

export type BoundaryExposureDirection = "inbound" | "outbound";
export type BoundaryExposureDepth = 1 | 2;

export type BoundaryExposureFlow = {
  direction: BoundaryExposureDirection;
  depth: BoundaryExposureDepth;
  boundaryAddress: string;
  boundaryCategory: ServiceCategory;
  boundaryIdentity: string | null;
  viaAddress: string | null;
  subjectTxHash: string;
  boundaryTxHash: string;
  amountRaw: string;
  boundaryAmountRaw: string;
  amountPreservationRatio: number;
  firstTransferAt: string;
  lastTransferAt: string;
};

export type BoundaryExposureEntity = {
  address: string;
  category: ServiceCategory;
  identity: string | null;
  direction: BoundaryExposureDirection;
  volumeRaw: string;
  txCount: number;
  maxDepth: BoundaryExposureDepth;
};

export type BoundaryExposureProfile = {
  subjectAddress: string;
  incomingBoundaryVolumeRaw: string;
  outgoingBoundaryVolumeRaw: string;
  incomingBoundaryVolumeRatio: number;
  outgoingBoundaryVolumeRatio: number;
  directBoundaryTxCount: number;
  twoHopBoundaryTxCount: number;
  topBoundaryEntities: BoundaryExposureEntity[];
  categoryBreakdown: Array<{
    category: ServiceCategory;
    direction: BoundaryExposureDirection;
    volumeRaw: string;
    txCount: number;
    volumeRatio: number;
  }>;
  flows: BoundaryExposureFlow[];
  contextScore: number;
  features: RouteScoreFeature[];
};
```

Extend `AddressExposureReport`:

```ts
export type AddressExposureReport = {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
  missingChecks: string[];
  serviceExposureProfiles: ServiceExposureProfile[];
  addressBehaviorProfiles: AddressBehaviorProfile[];
  inboundProvenanceProfiles?: InboundProvenanceProfile[];
  counterpartyRiskProfiles?: CounterpartyRiskProfile[];
  stablecoinRestrictionProfiles?: StablecoinRestrictionProfile[];
  extendedProvenanceProfiles?: ExtendedProvenanceProfile[];
  boundaryExposureProfiles?: BoundaryExposureProfile[];
  walletRoleProfiles?: WalletRoleProfile[];
};
```

---

## Scoring Policy Design

### Evidence caps

The new policy must preserve exact critical evidence while limiting weak context:

- exact self evidence: max 95
- exact approval-drain evidence: max 90
- exact labeled 1-hop path: max 80
- exact labeled 2-hop path: max 60
- exact labeled 3-hop path: max 45
- exact labeled 4-hop path: max 35
- service boundary context: max 15
- weak inferred: max 10
- behavior-only: max 30

### Dimension caps

Composite score should be bounded:

```text
compositeScore =
  min(40, provenance) +
  min(30, approvalDrain) +
  min(25, behavior) +
  min(20, serviceContext) +
  min(20, providerLabel) -
  min(40, dampeners)

finalScore = max(hardEvidenceScore, compositeScore)
finalScore = clamp(0, 100)
```

Exact critical evidence should enter `hardEvidenceScore`, not merely a dimension bucket.

### `src/risk/riskPolicy.ts` shape

```ts
import type { RiskReason } from "../types";

export type RiskPolicyClassification = {
  dimension: "provenance" | "approval_drain" | "behavior" | "service_context" | "provider_label" | "dampener";
  evidenceClass:
    | "exact_self"
    | "exact_approval_drain"
    | "exact_labeled_path"
    | "service_boundary_context"
    | "weak_inferred"
    | "behavior_only"
    | "provider_label"
    | "dampener";
  hardEvidence: boolean;
  cap: number;
};

export const RISK_POLICY_VERSION = "2026-05-25-phase-10a12-v1";

export function policyForReason(reason: Pick<RiskReason, "code" | "scoreImpact">): RiskPolicyClassification {
  if (reason.scoreImpact < 0) {
    return { dimension: "dampener", evidenceClass: "dampener", hardEvidence: false, cap: 40 };
  }
  if (reason.code.startsWith("internal_label_scam") || reason.code.startsWith("internal_label_stolen_funds") || reason.code.startsWith("internal_label_phishing") || reason.code.startsWith("internal_label_risky_contract") || reason.code === "stablecoin_usdt_blacklisted") {
    return { dimension: "provider_label", evidenceClass: "exact_self", hardEvidence: true, cap: 95 };
  }
  if (reason.code === "forensic_approval_drain_provenance") {
    return { dimension: "approval_drain", evidenceClass: "exact_approval_drain", hardEvidence: true, cap: 90 };
  }
  if (reason.code.includes("boundary") || reason.code === "forensic_boundary_exposure_context") {
    return { dimension: "service_context", evidenceClass: "service_boundary_context", hardEvidence: false, cap: 15 };
  }
  if (reason.code === "forensic_address_behavior" || reason.code.startsWith("address_behavior_")) {
    return { dimension: "behavior", evidenceClass: "behavior_only", hardEvidence: false, cap: 30 };
  }
  if (reason.code.includes("provenance") || reason.code.includes("route") || reason.code.includes("counterparty")) {
    return { dimension: "provenance", evidenceClass: "exact_labeled_path", hardEvidence: false, cap: 60 };
  }
  return { dimension: "provider_label", evidenceClass: "provider_label", hardEvidence: false, cap: 20 };
}

export function boundedReasonImpact(reason: RiskReason): RiskReason {
  const policy = policyForReason(reason);
  if (reason.scoreImpact < 0) return reason;
  return {
    ...reason,
    scoreImpact: Math.min(policy.cap, Math.max(0, reason.scoreImpact))
  };
}

export function calculateBoundedPolicyScore(reasons: RiskReason[]): number {
  let hardEvidenceScore = 0;
  const buckets = {
    provenance: 0,
    approval_drain: 0,
    behavior: 0,
    service_context: 0,
    provider_label: 0,
    dampener: 0
  };

  for (const original of reasons) {
    const reason = boundedReasonImpact(original);
    const policy = policyForReason(reason);
    if (policy.hardEvidence) hardEvidenceScore = Math.max(hardEvidenceScore, reason.scoreImpact);
    if (policy.dimension === "dampener") {
      buckets.dampener += Math.abs(reason.scoreImpact);
    } else {
      buckets[policy.dimension] += reason.scoreImpact;
    }
  }

  const composite =
    Math.min(40, buckets.provenance) +
    Math.min(30, buckets.approval_drain) +
    Math.min(25, buckets.behavior) +
    Math.min(20, buckets.service_context) +
    Math.min(20, buckets.provider_label) -
    Math.min(40, buckets.dampener);

  return Math.max(0, Math.min(100, Math.max(hardEvidenceScore, composite)));
}
```

This exact first version intentionally uses signal-code heuristics so existing `RiskSignal` producers do not all need to change in one task. Later phases can add explicit `dimension` / `evidenceClass` fields to `RiskSignal`.

---

## Task 1: Add Bounded Risk Policy

**Files:**
- Create: `src/risk/riskPolicy.ts`
- Modify: `src/risk/riskEngine.ts`
- Test: `tests/risk/riskPolicy.test.ts`
- Test: `tests/risk/riskEngine.test.ts`

- [ ] **Step 1: Write failing policy tests**

Create `tests/risk/riskPolicy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { boundedReasonImpact, calculateBoundedPolicyScore, policyForReason } from "../../src/risk/riskPolicy";
import type { RiskReason } from "../../src/types";

function reason(code: string, scoreImpact: number): RiskReason {
  return { code, message: code, scoreImpact };
}

describe("riskPolicy", () => {
  it("preserves exact critical stablecoin evidence", () => {
    const score = calculateBoundedPolicyScore([reason("stablecoin_usdt_blacklisted", 90)]);
    expect(score).toBe(90);
    expect(policyForReason(reason("stablecoin_usdt_blacklisted", 90))).toMatchObject({
      dimension: "provider_label",
      evidenceClass: "exact_self",
      hardEvidence: true,
      cap: 95
    });
  });

  it("caps service boundary context at 15", () => {
    const capped = boundedReasonImpact(reason("forensic_boundary_exposure_context", 80));
    expect(capped.scoreImpact).toBe(15);
    expect(calculateBoundedPolicyScore([capped])).toBe(15);
  });

  it("caps behavior-only suspicion at 30", () => {
    expect(boundedReasonImpact(reason("forensic_address_behavior", 75)).scoreImpact).toBe(30);
    expect(calculateBoundedPolicyScore([reason("forensic_address_behavior", 75)])).toBe(25);
  });

  it("combines bounded dimensions without letting weak context reach critical", () => {
    const score = calculateBoundedPolicyScore([
      reason("forensic_extended_provenance", 45),
      reason("forensic_address_behavior", 30),
      reason("forensic_boundary_exposure_context", 15)
    ]);
    expect(score).toBe(80);
  });

  it("lets exact approval-drain provenance dominate composite score", () => {
    const score = calculateBoundedPolicyScore([
      reason("forensic_approval_drain_provenance", 90),
      reason("forensic_address_behavior", 30),
      reason("forensic_boundary_exposure_context", 15)
    ]);
    expect(score).toBe(90);
  });

  it("applies trusted/false-positive dampeners to non-hard evidence", () => {
    const score = calculateBoundedPolicyScore([
      reason("forensic_address_behavior", 30),
      reason("internal_label_false_positive", -40)
    ]);
    expect(score).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/risk/riskPolicy.test.ts
```

Expected: fail because `src/risk/riskPolicy.ts` does not exist.

- [ ] **Step 3: Implement `src/risk/riskPolicy.ts`**

Implement the module using the exact shape in the **Scoring Policy Design** section.

- [ ] **Step 4: Wire policy into `calculateRisk`**

Modify `src/risk/riskEngine.ts`:

```ts
import { boundedReasonImpact, calculateBoundedPolicyScore } from "./riskPolicy";
```

Replace the current final score reducer with:

```ts
const boundedReasons = reasons.map((reason) => boundedReasonImpact(reason));
const score = calculateBoundedPolicyScore(boundedReasons);
```

Return sorted `boundedReasons` instead of raw `reasons`:

```ts
return {
  subjectAddress: input.subjectAddress,
  level: levelFromScore(score),
  score,
  reasons: sortReasons(boundedReasons.filter((reason) => reason.scoreImpact !== 0))
};
```

- [ ] **Step 5: Update risk engine tests for new capped behavior**

In `tests/risk/riskEngine.test.ts`, update expectations that relied on unrestricted summing:

```ts
expect(report.level).toBe("HIGH");
expect(report.score).toBe(65);
```

becomes:

```ts
expect(report.level).toBe("MEDIUM");
expect(report.score).toBe(60);
```

For the excessive external score test, expect generic non-exact provider context to cap at 20:

```ts
expect(report.score).toBe(20);
expect(report.level).toBe("LOW");
```

- [ ] **Step 6: Run risk tests**

Run:

```bash
npm test -- tests/risk/riskPolicy.test.ts tests/risk/riskEngine.test.ts tests/risk/evaluation.test.ts
```

Expected: all selected risk tests pass.

---

## Task 2: Add `BoundaryExposureProfile`

**Files:**
- Create: `src/forensics/boundaryExposure.ts`
- Modify: `src/types.ts`
- Test: `tests/forensics/boundaryExposure.test.ts`

- [ ] **Step 1: Add the boundary types to `src/types.ts`**

Add the type block from **Data Model**.

- [ ] **Step 2: Write failing tests**

Create `tests/forensics/boundaryExposure.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildBoundaryExposureProfile } from "../../src/forensics/boundaryExposure";
import type { ForensicRouteEdge, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const intermediate = "TInter111111111111111111111111111111";
const cex = "THTX11111111111111111111111111111111";

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

const htx: ServiceClassification = {
  category: "cex",
  identity: "HTX",
  isBoundary: true,
  reasons: [{ code: "metadata_exchange_tag", label: "HTX exchange tag", scoreImpact: 0 }]
};

describe("buildBoundaryExposureProfile", () => {
  it("records direct outbound service boundary context", () => {
    const profile = buildBoundaryExposureProfile({
      subjectAddress: subject,
      edges: [edge("direct", subject, cex, "100000000", "2026-05-25T10:00:00.000Z")],
      classifications: new Map([[cex, htx]])
    });

    expect(profile.outgoingBoundaryVolumeRaw).toBe("100000000");
    expect(profile.directBoundaryTxCount).toBe(1);
    expect(profile.contextScore).toBe(15);
    expect(profile.topBoundaryEntities[0]).toMatchObject({ address: cex, category: "cex", identity: "HTX", direction: "outbound" });
    expect(profile.features.map((feature) => feature.code)).toContain("boundary_exposure_direct_service");
  });

  it("records two-hop outbound boundary context with amount preservation", () => {
    const profile = buildBoundaryExposureProfile({
      subjectAddress: subject,
      edges: [
        edge("source", subject, intermediate, "100000000", "2026-05-25T10:00:00.000Z"),
        edge("boundary", intermediate, cex, "95000000", "2026-05-25T10:15:00.000Z")
      ],
      classifications: new Map([[cex, htx]])
    });

    expect(profile.twoHopBoundaryTxCount).toBe(1);
    expect(profile.flows[0]).toMatchObject({
      direction: "outbound",
      depth: 2,
      boundaryAddress: cex,
      viaAddress: intermediate,
      amountPreservationRatio: 0.95
    });
    expect(profile.features.map((feature) => feature.code)).toContain("boundary_exposure_two_hop_service");
  });

  it("does not treat boundary context as exact taint proof", () => {
    const profile = buildBoundaryExposureProfile({
      subjectAddress: subject,
      edges: [edge("direct", subject, cex, "1000000000", "2026-05-25T10:00:00.000Z")],
      classifications: new Map([[cex, htx]])
    });

    expect(profile.contextScore).toBeLessThanOrEqual(15);
    expect(profile.features.map((feature) => feature.code)).toContain("boundary_exposure_continuity_stop");
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test -- tests/forensics/boundaryExposure.test.ts
```

Expected: fail because `src/forensics/boundaryExposure.ts` does not exist.

- [ ] **Step 4: Implement pure boundary detector**

Create `src/forensics/boundaryExposure.ts` with these responsibilities:

- direct inbound: `boundary -> subject`
- direct outbound: `subject -> boundary`
- two-hop inbound: `boundary -> intermediate -> subject`, in timestamp order
- two-hop outbound: `subject -> intermediate -> boundary`, in timestamp order
- use subject-side edge amount as `amountRaw`
- use boundary-side edge amount as `boundaryAmountRaw`
- compute preservation as `min(amountRaw, boundaryAmountRaw) / max(amountRaw, boundaryAmountRaw)`
- cap `contextScore` at 15
- add `boundary_exposure_continuity_stop` whenever a flow reaches a boundary

Feature codes:

```ts
"boundary_exposure_direct_service"
"boundary_exposure_two_hop_service"
"boundary_exposure_high_volume_context"
"boundary_exposure_fast_context"
"boundary_exposure_exchange_identity"
"boundary_exposure_continuity_stop"
```

- [ ] **Step 5: Run boundary tests**

Run:

```bash
npm test -- tests/forensics/boundaryExposure.test.ts
```

Expected: all boundary exposure tests pass.

---

## Task 3: Add `WalletRoleProfile`

**Files:**
- Create: `src/forensics/walletRoleClassifier.ts`
- Modify: `src/types.ts`
- Test: `tests/forensics/walletRoleClassifier.test.ts`

- [ ] **Step 1: Add wallet role types to `src/types.ts`**

Add `WalletRole`, `WalletRoleReason`, and `WalletRoleProfile` from **Data Model**.

- [ ] **Step 2: Write failing role classifier tests**

Create `tests/forensics/walletRoleClassifier.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildWalletRoleProfile } from "../../src/forensics/walletRoleClassifier";
import type { AddressBehaviorProfile, ApprovalDrainProvenanceProfile, ServiceExposureProfile } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";

function behavior(overrides: Partial<AddressBehaviorProfile>): AddressBehaviorProfile {
  return {
    subjectAddress: subject,
    incomingVolumeRaw: "0",
    outgoingVolumeRaw: "0",
    incomingTxCount: 0,
    outgoingTxCount: 0,
    uniqueIncomingCounterparties: 0,
    uniqueOutgoingCounterparties: 0,
    largestIncomingRaw: null,
    largestOutgoingRaw: null,
    topOutgoingCounterpartyAddress: null,
    topOutgoingCounterpartyRaw: null,
    topOutgoingCounterpartyTxCount: 0,
    topOutgoingCounterpartyRatio: 0,
    inflowToOutflowRatio: null,
    drainToServiceRatio: 0,
    timeToFirstOutgoingMs: null,
    timeToFirstServiceExitMs: null,
    depositThenDrainScore: 0,
    transitScore: 0,
    dampenerScore: 0,
    features: [],
    ...overrides
  };
}

function service(overrides: Partial<ServiceExposureProfile>): ServiceExposureProfile {
  return {
    subjectAddress: subject,
    totalOutgoingRaw: "0",
    totalOutgoingCount: 0,
    directServiceVolumeRatio: 0,
    directServiceTxRatio: 0,
    indirectServiceVolumeRatio: 0,
    indirectServiceTxRatio: 0,
    mergedServiceVolumeRatio: 0,
    mergedServiceGroupCount: 0,
    combinedServiceVolumeRatio: 0,
    combinedServiceTxRatio: 0,
    dominantCategory: null,
    categoryBreakdown: [],
    topServiceCounterparties: [],
    topMergedServiceFlows: [],
    fastestServiceExitMs: null,
    bestAmountPreservationRatio: null,
    exposureScore: 0,
    features: [],
    ...overrides
  };
}

function approval(overrides: Partial<ApprovalDrainProvenanceProfile>): ApprovalDrainProvenanceProfile {
  return {
    victimAddress: "TVictim1111111111111111111111111111111",
    approvalTxHash: "approval-tx",
    drainTxHash: "drain-tx",
    spenderAddress: "TSpender111111111111111111111111111111",
    firstReceiverAddress: subject,
    subjectAddress: subject,
    hopDepth: 0,
    amountRaw: "100000000",
    amountPreservationRatio: 1,
    approvalAt: "2026-05-25T09:59:00.000Z",
    drainAt: "2026-05-25T10:00:00.000Z",
    pathTxHashes: ["drain-tx"],
    pathAddresses: [subject],
    score: 90,
    evidenceStrength: "exact_approval_and_transfer_from",
    subjectTokenState: null,
    victimTokenState: null,
    features: [],
    ...overrides
  };
}

describe("buildWalletRoleProfile", () => {
  it("classifies exact first receiver from approval-drain provenance", () => {
    const profile = buildWalletRoleProfile({
      subjectAddress: subject,
      approvalDrainProfiles: [approval({})],
      addressBehaviorProfile: null,
      serviceExposureProfile: null,
      boundaryExposureProfile: null,
      subjectClassification: null
    });

    expect(profile.primaryRole).toBe("first_receiver");
    expect(profile.evidenceStrength).toBe("exact");
    expect(profile.roles[0].confidence).toBe("high");
  });

  it("classifies collector-like behavior without making exact claims", () => {
    const profile = buildWalletRoleProfile({
      subjectAddress: subject,
      approvalDrainProfiles: [],
      addressBehaviorProfile: behavior({
        uniqueIncomingCounterparties: 8,
        uniqueOutgoingCounterparties: 1,
        topOutgoingCounterpartyRatio: 0.88,
        transitScore: 25,
        features: [{ code: "address_behavior_collector_like_wallet", label: "Collector-like wallet", scoreImpact: 20 }]
      }),
      serviceExposureProfile: service({ combinedServiceVolumeRatio: 0.75, exposureScore: 30 }),
      boundaryExposureProfile: null,
      subjectClassification: null
    });

    expect(profile.primaryRole).toBe("collector");
    expect(profile.evidenceStrength).toBe("strong_behavior");
  });

  it("classifies known service boundary as cashout service context", () => {
    const profile = buildWalletRoleProfile({
      subjectAddress: subject,
      approvalDrainProfiles: [],
      addressBehaviorProfile: null,
      serviceExposureProfile: null,
      boundaryExposureProfile: null,
      subjectClassification: { category: "cex", identity: "HTX", isBoundary: true, reasons: [] }
    });

    expect(profile.primaryRole).toBe("cashout_service");
    expect(profile.evidenceStrength).toBe("context");
  });

  it("classifies victim separately from dirty receiver roles", () => {
    const profile = buildWalletRoleProfile({
      subjectAddress: subject,
      approvalDrainProfiles: [approval({ victimAddress: subject, firstReceiverAddress: "TReceiver11111111111111111111111111111", subjectAddress: subject })],
      addressBehaviorProfile: null,
      serviceExposureProfile: null,
      boundaryExposureProfile: null,
      subjectClassification: null
    });

    expect(profile.primaryRole).toBe("victim");
    expect(profile.roles.some((role) => role.role === "first_receiver")).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test -- tests/forensics/walletRoleClassifier.test.ts
```

Expected: fail because `src/forensics/walletRoleClassifier.ts` does not exist.

- [ ] **Step 4: Implement role classifier**

Create `src/forensics/walletRoleClassifier.ts`.

Rules:

- `victim`:
  - `approvalDrainProfile.victimAddress === subjectAddress`
  - high confidence if exact approval + transferFrom evidence exists
- `drainer_spender`:
  - `approvalDrainProfile.spenderAddress === subjectAddress`
- `first_receiver`:
  - `approvalDrainProfile.firstReceiverAddress === subjectAddress`
  - or `approvalDrainProfile.subjectAddress === subjectAddress && hopDepth === 0`
- `collector`:
  - `address_behavior_collector_like_wallet`
  - fan-in/fan-out with `uniqueIncomingCounterparties >= 5`, `uniqueOutgoingCounterparties <= 3`, `topOutgoingCounterpartyRatio >= 0.5`
- `mule`:
  - `depositThenDrainScore > 0` or `transitScore > 0`
  - fast redistribution with meaningful preservation
- `cashout_service`:
  - subject itself is a service boundary
- `treasury_like`:
  - behavior has `known_service_or_treasury_dampener` or `long_lived_high_activity_wallet_dampener`
- `unknown`:
  - no role score above 0

Do not produce a positive risk signal from role alone. Role profile is explanatory context. Existing graph/behavior/approval/provider signals determine risk.

- [ ] **Step 5: Run role tests**

Run:

```bash
npm test -- tests/forensics/walletRoleClassifier.test.ts
```

Expected: all role classifier tests pass.

---

## Task 4: Tighten Extended 3-4 Hop Risk Impact

**Files:**
- Modify: `src/forensics/temporalBeamSearch.ts`
- Test: `tests/forensics/temporalBeamSearch.test.ts`

- [ ] **Step 1: Add failing tests for 3-hop, 4-hop, and boundary caps**

Append tests to `tests/forensics/temporalBeamSearch.test.ts`:

```ts
it("caps 3-hop exact labeled path risk impact at 45", async () => {
  const profile = await runTemporalBeamSearch({
    subjectAddress: "TSubject111111111111111111111111111111",
    direction: "outbound",
    maxDepth: 4,
    fetchEdgesForAddress: async (address) => edgeFixtures.get(address) ?? [],
    getLabelsForAddress: async (address) => address === "TDirty333333333333333333333333333333" ? [dirtyLabel(address)] : [],
    getClassificationForAddress: async () => null
  });

  const exact = profile.paths.find((path) => path.depth === 3 && path.evidenceStrength === "exact_labeled_path");
  expect(exact?.candidateScore).toBeLessThanOrEqual(45);
  expect(profile.score).toBeLessThanOrEqual(45);
});

it("caps 4-hop exact labeled path risk impact at 35", async () => {
  const profile = await runTemporalBeamSearch({
    subjectAddress: "TSubject111111111111111111111111111111",
    direction: "outbound",
    maxDepth: 4,
    fetchEdgesForAddress: async (address) => fourHopFixtures.get(address) ?? [],
    getLabelsForAddress: async (address) => address === "TDirty444444444444444444444444444444" ? [dirtyLabel(address)] : [],
    getClassificationForAddress: async () => null
  });

  const exact = profile.paths.find((path) => path.depth === 4 && path.evidenceStrength === "exact_labeled_path");
  expect(exact?.candidateScore).toBeLessThanOrEqual(35);
  expect(profile.score).toBeLessThanOrEqual(35);
});

it("keeps service-boundary context at or below 15", async () => {
  const profile = await runTemporalBeamSearch({
    subjectAddress: "TSubject111111111111111111111111111111",
    direction: "outbound",
    maxDepth: 4,
    fetchEdgesForAddress: async (address) => boundaryFixtures.get(address) ?? [],
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async (address) => address === "THTX11111111111111111111111111111111"
      ? { category: "cex", identity: "HTX", isBoundary: true, reasons: [] }
      : null
  });

  const boundary = profile.paths.find((path) => path.evidenceStrength === "service_boundary_context");
  expect(boundary?.candidateScore).toBeLessThanOrEqual(15);
  expect(profile.score).toBe(0);
});
```

Use existing fixture helper style in the file instead of duplicating unrelated helpers.

- [ ] **Step 2: Change `pathScore` caps**

Replace `pathScore` in `src/forensics/temporalBeamSearch.ts` with:

```ts
function pathScore(input: {
  depth: number;
  label: AddressLabel | null;
  boundary: ServiceClassification | null;
  candidateScore: number;
  preservation: number;
}): number {
  if (isBoundary(input.boundary) && !input.label) return Math.min(15, input.candidateScore);
  if (!input.label) return 0;
  if (isBoundary(input.boundary) && input.label.label !== "darknet_exchange") return Math.min(15, input.candidateScore);
  if (input.depth === 1) return Math.min(80, input.candidateScore);
  if (input.depth === 2) return Math.min(60, input.candidateScore);
  if (input.depth === 3 && input.preservation >= 0.7) return Math.min(45, input.candidateScore);
  if (input.depth === 4 && input.preservation >= 0.7) return Math.min(35, input.candidateScore);
  return 0;
}
```

When assigning `candidateScore` to an `ExtendedProvenancePath`, keep the capped risk score visible:

```ts
candidateScore: riskScore,
```

Keep the raw beam sort score internal to frontier ranking only. This makes `candidateScore` in reports represent final risk impact, not search priority.

- [ ] **Step 3: Run extended provenance tests**

Run:

```bash
npm test -- tests/forensics/temporalBeamSearch.test.ts tests/check/deepForensicCheck.test.ts
```

Expected: all selected tests pass with updated score expectations.

---

## Task 5: Integrate Profiles into Forensic Reports

**Files:**
- Modify: `src/check/deepForensicCheck.ts`
- Modify: `src/forensics/routeSearch.ts`
- Modify: `src/check/manualCheck.ts`
- Modify: `src/check/addressExposureSignals.ts`
- Test: `tests/check/deepForensicCheck.test.ts`
- Test: `tests/forensics/routeSearch.test.ts`
- Test: `tests/check/manualCheck.test.ts`
- Test: `tests/check/addressExposureSignals.test.ts`

- [ ] **Step 1: Extend `ManualRiskSignals` and `ManualCheckResult`**

Modify `src/check/manualCheck.ts` imports and types:

```ts
import type {
  AddressBehaviorProfile,
  AddressLabel,
  BoundaryExposureProfile,
  CounterpartyRiskProfile,
  ExtendedProvenanceProfile,
  InboundProvenanceProfile,
  RawEvidenceInput,
  RiskReport,
  RiskSignalObservationInput,
  ServiceExposureProfile,
  StablecoinRestrictionProfile,
  WalletRoleProfile
} from "../types";
```

Add fields:

```ts
boundaryExposureProfiles?: BoundaryExposureProfile[];
walletRoleProfiles?: WalletRoleProfile[];
extendedProvenanceProfiles?: ExtendedProvenanceProfile[];
```

Return arrays in `checkAddressWithContext`:

```ts
boundaryExposureProfiles: signals.boundaryExposureProfiles ?? [],
walletRoleProfiles: signals.walletRoleProfiles ?? [],
extendedProvenanceProfiles: signals.extendedProvenanceProfiles ?? [],
```

- [ ] **Step 2: Add profile arrays to `addressExposureSignals.ts` merge helpers**

Update `emptySignals`, `partialSignals`, `signalsFromReport`, and `mergeSignals` so the new arrays survive fallback and normal paths.

- [ ] **Step 3: Build profiles in `runForensicAddressExposureSearch`**

In `src/forensics/routeSearch.ts`, after `serviceExposureProfiles` and `addressBehaviorProfiles` are created:

```ts
const boundaryExposureProfiles = [
  buildBoundaryExposureProfile({
    subjectAddress: input.sourceAddress,
    edges: graphEdges,
    classifications: classificationResult.classifications
  })
];

const walletRoleProfiles = [
  buildWalletRoleProfile({
    subjectAddress: input.sourceAddress,
    approvalDrainProfiles: [],
    addressBehaviorProfile: addressBehaviorProfiles[0] ?? null,
    serviceExposureProfile: serviceExposureProfiles[0] ?? null,
    boundaryExposureProfile: boundaryExposureProfiles[0] ?? null,
    subjectClassification: classificationResult.classifications.get(input.sourceAddress) ?? null
  })
];
```

Add raw evidence and observations for non-empty profiles:

- boundary observation code: `forensic_boundary_exposure_context`
- wallet role observation code: `forensic_wallet_role_context`
- wallet role observation `scoreImpact`: `0`
- boundary observation `scoreImpact`: `profile.contextScore`

- [ ] **Step 4: Build profiles in `runDeepAddressForensicCheck`**

In `src/check/deepForensicCheck.ts`, build boundary exposure from `provenanceEdges` and `classifications`, then wallet role after approval/stablecoin/extended profiles exist.

Deep role classifier input must include approval drain profiles:

```ts
const approvalDrainProfiles = approvalDrainProfile ? [approvalDrainProfile] : [];
const boundaryExposureProfiles = [buildBoundaryExposureProfile({
  subjectAddress: input.sourceAddress,
  edges: provenanceEdges,
  classifications
})];
const walletRoleProfiles = [buildWalletRoleProfile({
  subjectAddress: input.sourceAddress,
  approvalDrainProfiles,
  addressBehaviorProfile: exposureReport.addressBehaviorProfiles[0] ?? null,
  serviceExposureProfile: exposureReport.serviceExposureProfiles[0] ?? null,
  boundaryExposureProfile: boundaryExposureProfiles[0] ?? null,
  subjectClassification: classifications.get(input.sourceAddress) ?? null
})];
```

Include arrays in returned report and in raw evidence/observations.

- [ ] **Step 5: Add integration tests**

Update `tests/check/deepForensicCheck.test.ts` with assertions:

```ts
expect(report.boundaryExposureProfiles?.[0]).toBeDefined();
expect(report.walletRoleProfiles?.[0]).toBeDefined();
expect(report.rawEvidence.some((evidence) => "boundaryExposureProfile" in evidence.evidenceJson)).toBe(true);
expect(report.rawEvidence.some((evidence) => "walletRoleProfile" in evidence.evidenceJson)).toBe(true);
```

Update `tests/check/manualCheck.test.ts` to verify new arrays are returned from `checkAddress`.

- [ ] **Step 6: Run integration tests**

Run:

```bash
npm test -- tests/forensics/routeSearch.test.ts tests/check/deepForensicCheck.test.ts tests/check/manualCheck.test.ts tests/check/addressExposureSignals.test.ts
```

Expected: all selected integration tests pass.

---

## Task 6: Add Telegram Summary Lines Without UX Redesign

**Files:**
- Modify: `src/bot/createBot.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Extend `ForensicSurface`**

In `src/bot/createBot.ts`, add:

```ts
boundaryExposureProfiles?: BoundaryExposureProfile[];
walletRoleProfiles?: WalletRoleProfile[];
```

Add imports from `../types`.

- [ ] **Step 2: Add formatter helpers**

Add concise helpers:

```ts
function walletRoleSignalLines(result: ForensicSurface): string[] {
  const profile = result.walletRoleProfiles?.[0] ?? null;
  if (!profile || profile.primaryRole === "unknown") return [];
  return [`Wallet role context: ${profile.primaryRole} (${profile.roles[0]?.confidence ?? "medium"} confidence).`];
}

function boundaryExposureSignalLines(result: ForensicSurface): string[] {
  const profile = result.boundaryExposureProfiles?.[0] ?? null;
  if (!profile || profile.flows.length === 0) return [];
  const top = profile.topBoundaryEntities[0] ?? null;
  const identity = top?.identity ?? top?.category ?? "service";
  return [
    `Boundary context: funds touched ${identity} infrastructure; public-chain continuity after this point should not be assumed.`
  ];
}
```

- [ ] **Step 3: Include helpers in existing forensic summary sections**

Where current signal lines include service exposure, address behavior, inbound provenance, counterparty risk, stablecoin, approval drain, and extended provenance, add:

```ts
...walletRoleSignalLines(result),
...boundaryExposureSignalLines(result),
```

Keep this below exact evidence lines so it does not visually outrank exact blacklist/approval-drain evidence.

- [ ] **Step 4: Add bot tests**

Update `tests/bot/createBot.test.ts` to assert:

```ts
expect(message).toContain("Wallet role context: collector");
expect(message).toContain("public-chain continuity after this point should not be assumed");
```

- [ ] **Step 5: Run bot tests**

Run:

```bash
npm test -- tests/bot/createBot.test.ts
```

Expected: bot tests pass.

---

## Final Verification

Run these commands from `/workspace/smartcontract`:

```bash
npm run typecheck
npm test -- tests/risk/riskPolicy.test.ts tests/risk/riskEngine.test.ts tests/forensics/boundaryExposure.test.ts tests/forensics/walletRoleClassifier.test.ts tests/forensics/temporalBeamSearch.test.ts tests/check/deepForensicCheck.test.ts tests/check/manualCheck.test.ts tests/check/addressExposureSignals.test.ts tests/bot/createBot.test.ts
npm test
git diff --check
```

Expected final state:

- TypeScript passes.
- Targeted tests pass.
- Full Vitest suite passes.
- `git diff --check` has no output.

## Acceptance Criteria

- Exact USDT blacklist still reports CRITICAL and score around 90.
- Exact approval-drain receiver/route evidence still reports HIGH/CRITICAL depending hop depth.
- Behavior-only suspicious wallet cannot exceed MEDIUM without exact or route-linked evidence.
- Boundary-only service/CEX/bridge/router context cannot exceed LOW by itself.
- 3-hop exact labeled extended provenance cannot exceed 45.
- 4-hop exact labeled extended provenance cannot exceed 35.
- Service boundary reports explicitly say public-chain continuity should not be assumed.
- Victim wallets are classified as `victim`, not as dirty first receivers or drainer spenders.
- `/check` output remains concise and does not introduce a new UX flow.

## Rollout Notes

- Keep `RISK_POLICY_VERSION = "2026-05-25-phase-10a12-v1"` in evidence/observation policy fields where new observations are created.
- If score reductions affect existing tests, prefer updating tests to the evidence-capped policy rather than increasing weak signal weights.
- If a real address appears lower risk after caps, check whether it lacks exact evidence; do not compensate by making service-boundary context stronger.
- Use raw evidence and observations to preserve explainability even when score impact is capped.
