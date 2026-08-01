# Deep Research Detector Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the first Deep Research detector assembly module so detector profiles, raw evidence, observations, and report fields are packaged in one place without changing scoring behavior.

**Architecture:** Keep `runDeepAddressForensicCheck` as the coordinator for fetches, limits, labels, classifications, coverage, and final report assembly. Add `src/check/deepForensicAssembly.ts` as the first repeatable assembly seam for detector outputs. Start with asset continuation only, preserving the current `DeepAddressForensicReport` shape and current unified score behavior.

**Tech Stack:** TypeScript, Vitest, existing Deep Research report types, existing `AssetContinuationProfile`, existing forensic route policy version, existing Telegram/report consumers.

---

## Source Decisions

Current domain terms are recorded in:

```text
CONTEXT.md
```

Decision for this plan:

```text
Use a common forensic detector pattern, but implement it Deep-first.
```

Do not build a global detector framework in this phase. The first implementation must be a small module used by Deep Research. The module must be generic enough to assemble more Deep detector outputs later, but this plan wires only `assetContinuationProfiles`.

## Current Code Facts

- `src/check/deepForensicCheck.ts:61` defines `DeepAddressForensicReport`.
- `src/check/deepForensicCheck.ts:840` currently builds raw evidence for asset continuation inline.
- `src/check/deepForensicCheck.ts:869` currently builds asset-continuation observations inline.
- `src/check/deepForensicCheck.ts:1283` filters asset-continuation profiles to `score >= 65` before creating raw evidence and observations.
- `src/check/deepForensicCheck.ts:1538` returns `assetContinuationProfiles` in the final Deep report.
- `src/forensics/assetContinuation.ts:154` detects asset-continuation profiles and should not change in this phase.
- `src/risk/unifiedWalletRisk.ts:277` consumes `DeepAddressForensicReport.assetContinuationProfiles` for the asset-continuation floor and should not change in this phase.
- `tests/check/deepForensicCheck.test.ts:804` verifies that Deep Research adds asset-continuation profiles, raw evidence, and observations from all-token subject transfers.

## File Structure

Create:

```text
src/check/deepForensicAssembly.ts
tests/check/deepForensicAssembly.test.ts
```

Modify:

```text
src/check/deepForensicCheck.ts
docs/project-walkthrough/01-address-check-fast-check.md
```

Already added in this planning session:

```text
CONTEXT.md
```

Do not modify:

```text
src/forensics/assetContinuation.ts
src/risk/unifiedWalletRisk.ts
src/bot/createBot.ts
src/types.ts
```

Reason: Phase 1 is a behavior-preserving assembly refactor. Detector scoring, unified scoring, Telegram reporting, and public report types must stay unchanged.

## Target Shape

After this plan, asset continuation should flow like this:

```text
buildAssetContinuationProfiles(...)
-> assembleAssetContinuationProfiles(...)
-> {
     profiles,
     persistedProfiles,
     rawEvidence,
     observations
   }
-> DeepAddressForensicReport.assetContinuationProfiles
-> DeepAddressForensicReport.rawEvidence
-> DeepAddressForensicReport.observations
```

The important preservation rule:

```text
all assetContinuationProfiles stay in the report
only profiles with score >= 65 create rawEvidence and observations
```

---

### Task 1: Add Deep Detector Assembly Tests

**Files:**

```text
tests/check/deepForensicAssembly.test.ts
```

- [ ] **Step 1: Create the failing test file**

Create `tests/check/deepForensicAssembly.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import { assembleAssetContinuationProfiles } from "../../src/check/deepForensicAssembly";
import type { AssetContinuationProfile } from "../../src/types";

const subjectAddress = "TSubject111111111111111111111111111111";
const windowStart = new Date("2026-05-01T00:00:00.000Z");
const windowEnd = new Date("2026-05-24T00:00:00.000Z");

function assetContinuationProfile(overrides: Partial<AssetContinuationProfile> = {}): AssetContinuationProfile {
  return {
    subjectAddress,
    sourceAsset: "USDT",
    continuationAssetSymbol: "WRAPPED",
    continuationTokenContract: "TWrappedToken1111111111111111111111",
    conversionTxHash: "tx-token-in",
    outgoingTxHash: "tx-token-out",
    protocolAddress: "TProtocol111111111111111111111111111",
    destinationAddress: "TRiskyDestination1111111111111111111",
    destinationRisk: "provider_risk",
    elapsedMs: 7_000,
    sourceAmountRaw: "101607508600",
    continuationAmountRaw: "101607508600",
    tokenQuality: "verified",
    score: 82,
    evidenceClass: "asset_continuation",
    reasons: ["USDT movement continued through WRAPPED to a provider_risk destination."],
    ...overrides
  };
}

describe("assembleAssetContinuationProfiles", () => {
  it("keeps all profiles in the report but persists only floor-grade profiles", () => {
    const high = assetContinuationProfile();
    const low = assetContinuationProfile({
      conversionTxHash: "tx-low-token-in",
      outgoingTxHash: "tx-low-token-out",
      tokenQuality: "unknown",
      score: 40,
      reasons: ["USDT movement continued through an unknown token."]
    });

    const result = assembleAssetContinuationProfiles({
      subjectAddress,
      windowStart,
      windowEnd,
      profiles: [high, low]
    });

    expect(result.profiles).toEqual([high, low]);
    expect(result.persistedProfiles).toEqual([high]);
    expect(result.rawEvidence).toHaveLength(1);
    expect(result.observations).toHaveLength(1);
    expect(result.rawEvidence[0]).toMatchObject({
      source: "tronscan_all_token_transfer_history",
      sourceType: "detector_output",
      chain: "tron",
      address: subjectAddress,
      txHash: "tx-token-in",
      observedTransactionHash: "tx-token-out"
    });
    expect(result.rawEvidence[0]?.evidenceJson).toMatchObject({
      assetContinuationProfile: high,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString()
    });
    expect(result.observations[0]).toMatchObject({
      subjectChain: "tron",
      subjectAddress,
      subjectTxHash: "tx-token-in",
      observedTransactionHash: "tx-token-out",
      signalGroup: "incoming_context",
      code: "forensic_asset_continuation",
      message: "USDT movement continued through another verified TRC20 asset.",
      scoreImpact: 82,
      confidence: "high",
      severity: "high",
      source: "asset_continuation",
      rawEvidenceId: result.rawEvidence[0]?.id
    });
  });

  it("uses medium confidence for known token metadata and medium severity below 80", () => {
    const profile = assetContinuationProfile({
      tokenQuality: "known",
      score: 66
    });

    const result = assembleAssetContinuationProfiles({
      subjectAddress,
      windowStart,
      windowEnd,
      profiles: [profile]
    });

    expect(result.observations[0]).toMatchObject({
      confidence: "medium",
      severity: "medium",
      scoreImpact: 66
    });
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
npm test -- tests/check/deepForensicAssembly.test.ts
```

Expected result:

```text
FAIL tests/check/deepForensicAssembly.test.ts
Cannot find module '../../src/check/deepForensicAssembly'
```

- [ ] **Step 3: Commit the failing test**

Run:

```bash
git add tests/check/deepForensicAssembly.test.ts
git commit -m "test: cover deep detector assembly"
```

---

### Task 2: Implement Deep Detector Assembly Module

**Files:**

```text
src/check/deepForensicAssembly.ts
tests/check/deepForensicAssembly.test.ts
```

- [ ] **Step 1: Create `src/check/deepForensicAssembly.ts`**

Create `src/check/deepForensicAssembly.ts` with this content:

```ts
import { createHash } from "node:crypto";
import { FORENSIC_ROUTE_POLICY_VERSION } from "../forensics/routeScorer";
import type {
  AssetContinuationProfile,
  RawEvidenceInput,
  RiskSignalObservationInput
} from "../types";

type DeepDetectorEvidenceBuilderInput<TProfile> = {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: TProfile;
};

type DeepDetectorObservationBuilderInput<TProfile> = {
  subjectAddress: string;
  profile: TProfile;
  rawEvidenceId: string;
};

export type DeepDetectorAssemblyInput<TProfile> = {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profiles: TProfile[];
  shouldPersistProfile(profile: TProfile): boolean;
  buildRawEvidence(input: DeepDetectorEvidenceBuilderInput<TProfile>): RawEvidenceInput;
  buildObservation(input: DeepDetectorObservationBuilderInput<TProfile>): RiskSignalObservationInput | null;
};

export type DeepDetectorAssemblyResult<TProfile> = {
  profiles: TProfile[];
  persistedProfiles: TProfile[];
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
};

function stableId(parts: unknown[]): string {
  return createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex");
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}

export function assembleDeepDetectorProfiles<TProfile>(
  input: DeepDetectorAssemblyInput<TProfile>
): DeepDetectorAssemblyResult<TProfile> {
  const persistedProfiles = input.profiles.filter(input.shouldPersistProfile);
  const rawEvidence = persistedProfiles.map((profile) =>
    input.buildRawEvidence({
      subjectAddress: input.subjectAddress,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      profile
    })
  );
  const observations = rawEvidence
    .map((evidence, index) =>
      input.buildObservation({
        subjectAddress: input.subjectAddress,
        profile: persistedProfiles[index],
        rawEvidenceId: evidence.id
      })
    )
    .filter(notNull);

  return {
    profiles: input.profiles,
    persistedProfiles,
    rawEvidence,
    observations
  };
}

function rawEvidenceForAssetContinuation(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: AssetContinuationProfile;
}): RawEvidenceInput {
  return {
    id: stableId([
      "forensic_asset_continuation_raw",
      input.subjectAddress,
      input.profile.conversionTxHash,
      input.profile.outgoingTxHash,
      input.windowStart.toISOString(),
      input.windowEnd.toISOString()
    ]),
    source: "tronscan_all_token_transfer_history",
    sourceType: "detector_output",
    chain: "tron",
    address: input.subjectAddress,
    txHash: input.profile.conversionTxHash,
    observedTransactionHash: input.profile.outgoingTxHash,
    evidenceJson: {
      assetContinuationProfile: input.profile,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString()
    }
  };
}

function observationForAssetContinuation(input: {
  subjectAddress: string;
  profile: AssetContinuationProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput | null {
  if (input.profile.score < 65) return null;
  return {
    id: stableId([
      "forensic_asset_continuation_observation",
      input.subjectAddress,
      input.profile.conversionTxHash,
      input.profile.outgoingTxHash,
      FORENSIC_ROUTE_POLICY_VERSION
    ]),
    subjectChain: "tron",
    subjectAddress: input.subjectAddress,
    subjectTxHash: input.profile.conversionTxHash,
    observedTransactionHash: input.profile.outgoingTxHash,
    signalGroup: "incoming_context",
    code: "forensic_asset_continuation",
    message: "USDT movement continued through another verified TRC20 asset.",
    scoreImpact: input.profile.score,
    confidence: input.profile.tokenQuality === "verified" ? "high" : "medium",
    severity: input.profile.score >= 80 ? "high" : "medium",
    source: "asset_continuation",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}

export function assembleAssetContinuationProfiles(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profiles: AssetContinuationProfile[];
}): DeepDetectorAssemblyResult<AssetContinuationProfile> {
  return assembleDeepDetectorProfiles({
    subjectAddress: input.subjectAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    profiles: input.profiles,
    shouldPersistProfile: (profile) => profile.score >= 65,
    buildRawEvidence: rawEvidenceForAssetContinuation,
    buildObservation: observationForAssetContinuation
  });
}
```

- [ ] **Step 2: Run the new assembly test**

Run:

```bash
npm test -- tests/check/deepForensicAssembly.test.ts
```

Expected result:

```text
Test Files  1 passed
Tests  2 passed
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected result:

```text
tsc --noEmit
```

with exit code `0`.

- [ ] **Step 4: Commit the assembly module**

Run:

```bash
git add src/check/deepForensicAssembly.ts tests/check/deepForensicAssembly.test.ts
git commit -m "feat: add deep detector assembly module"
```

---

### Task 3: Wire Asset Continuation Through Assembly

**Files:**

```text
src/check/deepForensicCheck.ts
tests/check/deepForensicCheck.test.ts
```

- [ ] **Step 1: Import the assembly function**

In `src/check/deepForensicCheck.ts`, add this import near the existing local imports:

```ts
import { assembleAssetContinuationProfiles } from "./deepForensicAssembly";
```

- [ ] **Step 2: Delete inline asset-continuation evidence helpers**

Remove these two functions from `src/check/deepForensicCheck.ts`:

```text
rawEvidenceForAssetContinuation
observationForAssetContinuation
```

Do not remove other `rawEvidenceFor...` or `observationFor...` helpers in this task.

- [ ] **Step 3: Replace the inline asset-continuation evidence block**

Find this block in `runDeepAddressForensicCheck`:

```ts
  const persistedAssetContinuationProfiles = assetContinuationProfiles.filter((profile) => profile.score >= 65);
  const assetContinuationEvidence = persistedAssetContinuationProfiles.map((profile) => rawEvidenceForAssetContinuation({
    subjectAddress: input.sourceAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    profile
  }));
  const assetContinuationObservations = assetContinuationEvidence
    .map((evidence, index) => observationForAssetContinuation({
      subjectAddress: input.sourceAddress,
      profile: persistedAssetContinuationProfiles[index],
      rawEvidenceId: evidence.id
    }))
    .filter((observation): observation is RiskSignalObservationInput => observation !== null);
```

Replace it with:

```ts
  const assetContinuationAssembly = assembleAssetContinuationProfiles({
    subjectAddress: input.sourceAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    profiles: assetContinuationProfiles
  });
```

- [ ] **Step 4: Replace raw evidence and observation array references**

In the returned `rawEvidence` array, replace:

```ts
      ...assetContinuationEvidence,
```

with:

```ts
      ...assetContinuationAssembly.rawEvidence,
```

In the returned `observations` array, replace:

```ts
      ...assetContinuationObservations,
```

with:

```ts
      ...assetContinuationAssembly.observations,
```

In the returned report fields, replace:

```ts
    assetContinuationProfiles,
```

with:

```ts
    assetContinuationProfiles: assetContinuationAssembly.profiles,
```

- [ ] **Step 5: Run the Deep wiring tests**

Run:

```bash
npm test -- tests/check/deepForensicCheck.test.ts tests/check/deepForensicAssembly.test.ts
```

Expected result:

```text
Test Files  2 passed
```

- [ ] **Step 6: Run the detector test to prove detector behavior did not change**

Run:

```bash
npm test -- tests/forensics/assetContinuation.test.ts
```

Expected result:

```text
Test Files  1 passed
```

- [ ] **Step 7: Commit the Deep wiring refactor**

Run:

```bash
git add src/check/deepForensicCheck.ts tests/check/deepForensicAssembly.test.ts
git commit -m "refactor: assemble asset continuation deep evidence"
```

---

### Task 4: Document The Deep-First Assembly Pattern

**Files:**

```text
docs/project-walkthrough/01-address-check-fast-check.md
CONTEXT.md
```

- [ ] **Step 1: Verify `CONTEXT.md` contains the new domain terms**

Open `CONTEXT.md` and verify it contains these entries:

```text
Deep Research Report Assembly
Forensic Detector Pattern
```

If either entry is missing, add this text under `## Domain Terms`:

```md
- **Deep Research Report Assembly**: the part of Deep Research that turns fetched transfers and detector outputs into profiles, raw evidence, observations, coverage, coverage debug output, and the final `DeepAddressForensicReport`.
- **Forensic Detector Pattern**: shared shape for code that detects one forensic signal, returns structured profiles, and lets an assembly layer persist evidence, observations, missing checks, and report fields.
```

- [ ] **Step 2: Add a short implementation note to the walkthrough**

In `docs/project-walkthrough/01-address-check-fast-check.md`, add this section after the `### Unified Wallet Risk Formula v1.1` section and before `## Fast Check In Human Terms`:

````md
### Deep Research Detector Assembly

Deep Research keeps the same external report shape, but detector packaging now has a dedicated assembly seam.

Product split:

```text
detector -> finds profiles
assembly -> packages profiles into raw evidence and observations
scorer -> decides score impact
bot -> explains the result
```

Phase 1 applies this to asset continuation:

```text
buildAssetContinuationProfiles(...)
-> assembleAssetContinuationProfiles(...)
-> DeepAddressForensicReport.assetContinuationProfiles
-> rawEvidence / observations
```

This does not change the score. It only moves report packaging out of `runDeepAddressForensicCheck`.
````

- [ ] **Step 3: Run markdown unresolved-marker scan**

Run:

```bash
rg -n "UNRESOLVED_MARKER_SHOULD_NOT_EXIST" CONTEXT.md docs/project-walkthrough/01-address-check-fast-check.md
```

Expected result:

```text
no output for newly added sections
```

If the command finds older existing lines outside the new sections, inspect them and leave unrelated text unchanged.

- [ ] **Step 4: Commit the docs**

Run:

```bash
git add CONTEXT.md docs/project-walkthrough/01-address-check-fast-check.md
git commit -m "docs: explain deep detector assembly pattern"
```

---

### Task 5: Final Verification

**Files:**

```text
src/check/deepForensicAssembly.ts
src/check/deepForensicCheck.ts
tests/check/deepForensicAssembly.test.ts
tests/check/deepForensicCheck.test.ts
tests/forensics/assetContinuation.test.ts
docs/project-walkthrough/01-address-check-fast-check.md
CONTEXT.md
```

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- tests/check/deepForensicAssembly.test.ts tests/check/deepForensicCheck.test.ts tests/forensics/assetContinuation.test.ts tests/risk/unifiedWalletRisk.test.ts tests/bot/createBot.test.ts
```

Expected result:

```text
Test Files  5 passed
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected result:

```text
tsc --noEmit
```

with exit code `0`.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
npm test
```

Expected result:

```text
Test Files  110 passed
Tests  1332 passed
```

The exact test count may increase by the new `deepForensicAssembly` tests. Treat additional passing tests as expected.

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected result:

```text
no whitespace errors
```

Git may print the existing CRLF warning for markdown files. That warning is not a whitespace failure.

- [ ] **Step 5: Inspect the final diff**

Run:

```bash
git diff --stat HEAD
git diff HEAD -- src/check/deepForensicAssembly.ts src/check/deepForensicCheck.ts tests/check/deepForensicAssembly.test.ts CONTEXT.md docs/project-walkthrough/01-address-check-fast-check.md
```

Expected result:

```text
new assembly module
asset-continuation packaging removed from deepForensicCheck
Deep report shape unchanged
no changes to unified scoring
no changes to assetContinuation detector scoring
```

---

## Self-Review

Spec coverage:

- Deep Research report assembly is addressed by `src/check/deepForensicAssembly.ts`.
- Asset continuation is the first detector wired through the assembly seam.
- External report shape stays unchanged because `DeepAddressForensicReport.assetContinuationProfiles` remains the report field.
- Score behavior stays unchanged because `src/risk/unifiedWalletRisk.ts` is not modified.
- Detector behavior stays unchanged because `src/forensics/assetContinuation.ts` is not modified.

Unresolved-marker scan:

- This plan does not contain unresolved implementation markers.

Type consistency:

- `assembleAssetContinuationProfiles` returns `DeepDetectorAssemblyResult<AssetContinuationProfile>`.
- `assetContinuationAssembly.profiles` maps to `DeepAddressForensicReport.assetContinuationProfiles`.
- `assetContinuationAssembly.rawEvidence` maps to `DeepAddressForensicReport.rawEvidence`.
- `assetContinuationAssembly.observations` maps to `DeepAddressForensicReport.observations`.

## Execution Handoff

Plan complete and saved to:

```text
docs/superpowers/plans/2026-06-05-deep-research-detector-assembly.md
```

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Recommended choice for this plan: **Subagent-Driven**. The tasks are small and have clean ownership boundaries.
