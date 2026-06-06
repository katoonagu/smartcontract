# Shared Source Bundle Exposure Design

Date: 2026-06-06.

## Summary

`incoming_deposit_check` and `where_is_money_check` both answer a provenance question:

```text
Which on-chain money sources explain this checked amount or wallet balance?
```

They already share the same trace engine through `runWhereIsMoneyCheck`, but the newest incoming-deposit improvements are not fully shared. Incoming deposit now separates fresh balance-forming source exposure from historical sender exposure. Standalone Where Is Money still returns its own `assessment.riskScore` and does not expose the same fresh bundle / background exposure fields.

The next improvement is a shared source-bundle exposure layer used by both modes. It must keep one final score and one final decision, while preventing stale historical transfers from being explained as exact source proof.

## Product Problem

The project currently has two neighboring modes:

```text
incoming_deposit_check
where_is_money_check
```

They are similar enough that users expect consistent logic, but different enough that the code currently has mode-specific scoring/reporting paths.

Recent incoming-deposit fixes improved this case:

```text
old stale transfer -> later spends -> checked deposit
```

The system should not say that a 21-day-old HTX/Huobi transfer is the exact source of a later deposit if the wallet spent that money before the checked deposit.

Incoming deposit now handles this better. Where Is Money partially benefits from the shared trace engine, but it does not yet have the same shared exposure profile and final scoring overlay. This can lead to inconsistent product behavior:

- incoming deposit says "fresh HTX share is 0%, historical context only";
- Where Is Money may still rely on older source-policy assessment shape;
- runtime budget exhaustion can make a known bridge/HTX corridor disappear from the final score instead of being reported as unresolved coverage.

## Trigger Cases

### Stale HTX Source Case

Primary incoming deposit:

```text
tx: b4603c390d3b0f08f9a604b26dc31d08e64aeeacc5a1560410bb5bbf030aa39c
sender: TPiyHJDDiUWUuyaxGdz1uTDyh8mDke67z3
watched wallet: TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM
amount: 100,000 USDT
```

Old behavior:

```text
85 CRITICAL / DECLINE
reason: stale HTX/Huobi path treated like 100% source
```

Desired behavior:

```text
Do not claim exact HTX/Huobi source unless the fresh balance-forming bundle proves HTX/Huobi share.
```

### Boundary Coverage Case

High/decline incoming deposit from the historical file:

```text
tx: 51a97751ede658756183529008db5147d645d9215b0b7373973c701bf0b95e39
old saved score: 65 HIGH / DECLINE
new bounded rerun: 42 LOW-MEDIUM / ACCEPTABLE
```

The bounded rerun became too soft because the completed runtime budget did not reach the bridge boundary. This does not prove the bridge risk disappeared. It proves that the report needs explicit coverage-limited boundary handling.

## Current Facts From Code

Where Is Money entry point:

```text
src/check/whereIsMoneyCheck.ts:757
```

Where Is Money selects provenance inputs through:

```text
src/check/whereIsMoneyCheck.ts:829
src/check/whereIsMoneyCheck.ts:834
src/forensics/recentFlowProvenanceSelection.ts:190
src/forensics/balanceFormingTransfers.ts:54
```

Incoming deposit calls Where Is Money in transaction mode:

```text
src/forensics/incomingDepositJob.ts:1136
```

Incoming deposit uses balance-aware funding candidates before calling Where Is Money:

```text
src/forensics/incomingDepositJob.ts:1116
src/forensics/incomingDepositCashflow.ts:277
```

Trace-level hop logic already tries a funding bundle before falling back to a single incoming candidate:

```text
src/forensics/moneyOriginTrace.ts:411
src/forensics/moneyOriginTrace.ts:491
```

Incoming deposit currently builds incoming-only exposure fields:

```text
src/forensics/incomingDepositJob.ts:853
src/forensics/incomingDepositJob.ts:1204
src/forensics/incomingDepositExposureProfile.ts
```

Incoming deposit final score uses an incoming wrapper over the unified scorer:

```text
src/risk/unifiedIncomingDepositRisk.ts:216
```

Standalone Where Is Money final score comes from `buildMoneyOriginOperationalAssessment`:

```text
src/check/whereIsMoneyCheck.ts:1160
src/check/whereIsMoneyCheck.ts:1242
src/forensics/moneyOriginOperationalAssessment.ts:904
```

Source-policy exposure scoring already exists, but it is not the same as the incoming fresh/background exposure overlay:

```text
src/forensics/provenanceScoring.ts:558
```

## Goals

### Product Goals

- Keep one final user-facing score and one final user-facing decision.
- Make incoming deposit and Where Is Money use the same source exposure semantics.
- Separate exact fresh source proof from historical/background wallet context.
- Prevent stale historical inflows from becoming exact source claims after later spends.
- Preserve high risk when fresh HTX/Huobi, risky labels, or bridge/router/dex exposure materially funds the checked amount.
- Keep historical exposure useful as context, but cap it so it cannot pretend to be exact source proof.
- Show budget exhaustion explicitly when the graph stops before confirming or rejecting a boundary.

### Engineering Goals

- Create a shared pure source exposure module instead of copying incoming logic into Where Is Money.
- Keep existing report fields backward-compatible while adding shared fields.
- Keep mode-specific policy wrappers small.
- Add tests that protect both incoming deposit and Where Is Money behavior.
- Avoid broad rewrite of the unified wallet scorer.

## Non-Goals

- Do not replace the entire wallet unified scorer.
- Do not add multiple final scores for users.
- Do not add manual review as a product requirement.
- Do not make fast check, deep research, Where Is Money, and incoming deposit identical modes.
- Do not remove existing `freshBundleExposure` / `walletExposureProfile` fields immediately; keep compatibility and map them to the shared model.
- Do not solve all Tronscan performance limits in this spec. This spec only requires visible phase budgets and coverage-limited scoring behavior.

## Core Design

### Shared Source Bundle Exposure

Create a shared module:

```text
src/forensics/sourceBundleExposure.ts
```

This module owns source exposure calculation for a checked provenance scope. It should be pure: input origin paths, funding bundles, selected target amount, classifications already collected by the trace, and budget/coverage notes; output a structured exposure profile.

The shared profile should answer:

```text
What share of the checked amount is attributable to each source class?
```

Source classes:

```text
htx_huobi
clean_cex
bridge_router_dex
unknown_contract
risky_label
unknown
```

The profile must distinguish:

```text
fresh / selected amount exposure
historical / background exposure
coverage-limited unresolved boundary
```

### Shared Types

Add generic report-level types in `src/types.ts`.

Recommended type shape:

```ts
export type SourceBundleExposureScope =
  | "incoming_deposit"
  | "where_current_balance"
  | "where_requested_amount"
  | "where_recent_flow"
  | "where_transaction_seed";

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
  dominantSource: "htx_huobi" | "clean_cex" | "bridge_router_dex" | "unknown_contract" | "risky_label" | "unknown" | null;
  evidenceTxHashes: string[];
  reasons: string[];
  warnings: string[];
  budget: SourceBundleExposureBudget;
  unresolvedBoundary: SourceBundleUnresolvedBoundary | null;
};

export type SourceBundleExposureBudget = {
  maxDepth: number | null;
  fetchedAddressCount: number | null;
  maxAddressFetches: number | null;
  liveTransferReadCount: number | null;
  skippedAddressCount: number;
  exhausted: boolean;
  exhaustedPhase: "selection" | "trace" | "bundle_expansion" | "classification" | "stablecoin" | "internal_processing" | null;
};

export type SourceBundleUnresolvedBoundary = {
  kind: "bridge_router_dex" | "htx_huobi" | "unknown_contract" | "risky_label" | "unknown";
  affectedShare: number;
  scoreFloor: number;
  reason: string;
  evidenceTxHashes: string[];
};
```

Existing incoming types can remain:

```text
IncomingFreshBundleExposure
IncomingWalletExposureProfile
```

But incoming deposit should derive those compatibility fields from `SourceBundleExposureProfile` after the shared layer exists.

### Shared Subject Exposure Profile

Keep a historical/background profile, but make it generic enough for Where and Incoming:

```ts
export type SubjectExposureProfile = {
  subjectAddress: string;
  windowStart: string;
  windowEnd: string;
  htxHuobiIncomingShare: number;
  bridgeRouterDexVolumeShare: number;
  unknownContractVolumeShare: number;
  unknownSourceShare: number;
  inOutVelocityScore: number;
  scoreContribution: number;
  reasons: string[];
  warnings: string[];
};
```

Incoming deposit can keep `walletExposureProfile` as a compatibility alias or mapped shape. Where Is Money can expose `subjectExposureProfile`.

Historical/background contribution rule:

```text
max contribution: 20 points
cannot by itself make exact source proof
cannot by itself say "this checked amount came from HTX/Huobi"
```

### Where Is Money Integration

Where Is Money should build `sourceBundleExposure` after `originPaths` and before final assessment.

Flow:

```text
select balance-forming transfers
trace origin paths
build sourceBundleExposure from originPaths + fundingBundles + coverage
build subjectExposureProfile from subject edges
build assessment using sourceBundleExposure + subjectExposureProfile
return report with shared fields
```

Where report should include:

```ts
sourceBundleExposure?: SourceBundleExposureProfile;
subjectExposureProfile?: SubjectExposureProfile;
```

This does not remove existing `assessment.sourcePolicyEvidence`. The shared exposure profile becomes the factual breakdown used by scoring and reporting. `sourcePolicyEvidence` remains the policy-scored layer.

### Incoming Deposit Integration

Incoming deposit should stop owning the source-bundle semantics as an incoming-only concept.

Flow:

```text
select incoming funding candidates
run Where Is Money in transaction mode
use shared sourceBundleExposure from Where report or build it through the same module
map shared profile to incoming compatibility fields
calculate final incoming score with shared exposure inputs
```

Incoming deposit keeps:

```text
freshBundleExposure
walletExposureProfile
unifiedRiskSummary
```

But `freshBundleExposure` should be derived from `sourceBundleExposure`, not separately computed with diverging rules.

## Scoring Design

### Fresh / Selected Amount Floors

Fresh or selected amount exposure can set a policy floor.

Rules:

```text
riskyLabelShare >= 10%:
  floor 85
  decision DECLINE

htxHuobiShare >= 70%:
  floor 85
  decision DECLINE

htxHuobiShare >= 30%:
  floor 70
  decision DECLINE

htxHuobiShare >= 10%:
  floor 55
  decision depends on final score threshold

bridgeRouterDexShare >= 50%:
  floor 60
  decision DECLINE

unknownContractShare >= 50%:
  floor 45
  decision depends on final score threshold
```

These floors apply only to fresh/selected amount exposure, not historical background exposure.

### Corridor Context

If HTX/Huobi, bridge/router/dex, or unknown contract appears in the live corridor but exact high-share attribution is not proven:

```text
floor 35-45 depending on affected share and path quality
decision does not auto-decline unless final score reaches decline threshold
```

This is useful for cases where the graph found a risky boundary, but the exact selected amount share is partial.

### Coverage-Limited Boundary

If the runtime budget stops before a boundary can be confirmed or rejected, do not treat missing exposure as zero.

Example:

```text
trace has unresolved service/boundary candidates
budget exhausted before expansion completes
selected unresolved share is material
```

Then the report should add:

```text
coverageLimitedBoundaryUnresolved = true
unresolvedBoundary.scoreFloor = 45 by default
```

If the unresolved boundary is already identified as HTX/Huobi, bridge/router/dex, risky label, or unknown contract from partial evidence, the floor can be higher:

```text
known risky label unresolved: 70
known HTX/Huobi unresolved: 60
known bridge/router/dex unresolved: 55
unknown contract unresolved: 45
unknown EOA unresolved: 35
```

This does not claim exact source proof. It says the final score is conservative because the graph stopped before resolving a material boundary.

### Background Exposure

Historical exposure is additive context:

```text
scoreContribution = min(20, weighted historical exposure)
```

Suggested weights:

```text
HTX/Huobi historical incoming share: up to 20
bridge/router/dex volume share: up to 8
unknown contract volume share: up to 6
unknown source share: up to 5
in/out velocity: up to 8
```

This background score must be visible in the report and must not be described as proof of the checked amount source.

### Clean CEX

Clean CEX share reduces uncertainty but does not erase hard evidence.

Rules:

```text
cleanCexShare >= 70%:
  unknown-origin risk can be dampened

cleanCexShare >= 90% and no hard/policy floor:
  final score should usually stay ACCEPTABLE

clean CEX share does not cancel:
  stablecoin blacklist
  scam/risky label
  exact approval-drain proof
  fresh HTX/Huobi high-share floor
```

## Runtime Budget Design

The system needs visible phase budgets.

Track at least:

```text
selection edge limit
trace max depth
trace max address fetches
trace max edges per address
bundle expansion max funders
bundle expansion max address fetches
classification fetch limit
stablecoin status fetch limit
live transfer read count
internal processing timeout or step count
```

A report should say:

```text
which phase exhausted
how many addresses were fetched
how many candidate addresses were skipped
whether a boundary candidate remained unresolved
```

This is required because Task 8 showed that `51a977...` can become too soft when a bounded rerun stops before reaching the bridge boundary.

## Reporting Design

### User-Facing Report

Use factual wording:

```text
HTX/Huobi funds 70% of the fresh checked amount.
```

Only use that wording when the fresh/selected amount bundle proves the share.

Use contextual wording:

```text
The sender wallet has historical HTX/Huobi exposure. This is background context, not proof that this checked amount came from HTX/Huobi.
```

Use coverage wording:

```text
The graph stopped before resolving a material service boundary. The score includes a conservative unresolved-boundary floor.
```

### Admin Graph

Admin graph should show:

```text
sourceBundleExposure
subjectExposureProfile
budget exhaustion phase
unresolved boundary node/edge when present
time gaps between selected funding transfers and checked transfer
```

The graph should not hide a branch just because the final score is acceptable.

## Backward Compatibility

Existing reports may already contain:

```text
freshBundleExposure
walletExposureProfile
sourcePolicyEvidence
```

New code should:

- read old reports without failing;
- write new shared fields;
- keep old incoming fields for bot/admin consumers until they are migrated;
- avoid DB migrations unless existing JSON report storage cannot hold the new fields.

## Testing Requirements

### Unit Tests

Add tests for:

- stale HTX inflow spent before checked transfer does not become fresh source proof;
- fresh HTX share creates the expected floor;
- fresh bridge/router/dex share creates the expected floor;
- historical HTX exposure contributes background score capped at 20;
- clean CEX majority dampens unknown-origin context;
- coverage-limited boundary creates unresolved-boundary floor and warning;
- generic shared profile maps correctly to incoming compatibility fields.

### Integration Tests

Add or update tests for:

- `runWhereIsMoneyCheck` returns `sourceBundleExposure`;
- `buildIncomingDepositReport` derives `freshBundleExposure` from the shared profile;
- `calculateUnifiedIncomingDepositRisk` uses shared exposure without changing wallet-scope scorer behavior;
- admin graph projects exposure and budget fields.

### Regression Cases

Protect these cases:

```text
b4603... does not claim stale HTX/Huobi 100% source.
51a977... does not silently drop bridge risk to zero when graph coverage is budget-limited.
e3a049... does not decline only from disabled approval-review context.
0eac... remains acceptable when no fresh risky source is proven.
```

## Acceptance Criteria

- Incoming deposit and Where Is Money both expose a shared `sourceBundleExposure` shape.
- Incoming deposit keeps backward-compatible `freshBundleExposure` and `walletExposureProfile`.
- Where Is Money gets the same fresh/source/background distinction as incoming deposit.
- Fresh HTX/Huobi and bridge/router/dex exposure can floor final risk when materially funding the checked amount.
- Historical exposure is capped and cannot be worded as exact source proof.
- Coverage-limited unresolved boundary is visible and can add a conservative score floor.
- `51a977...` style cases do not become falsely low just because the completed budget missed the bridge boundary.
- Existing full test suite and typecheck pass.

## Implementation Strategy

Implement in small phases:

1. Add shared types and pure profile builder.
2. Move incoming fresh exposure logic onto the shared builder while keeping old fields.
3. Wire shared exposure into Where Is Money report.
4. Add shared scoring overlay or assessment inputs for Where Is Money.
5. Add coverage-limited unresolved boundary handling.
6. Update admin graph/reporting.
7. Run saved job comparisons for incoming and Where modes.

This keeps the rollout incremental and avoids a full scorer rewrite.

## Risks And Limits

- The shared layer can expose more honest coverage, but it cannot invent unavailable Tronscan history.
- Runtime can still be slow if phase budgets are too high. The fix is visible budget control, not unlimited graph expansion.
- Existing saved reports will not retroactively gain shared fields until rerun.
- The first implementation should prioritize correctness and traceability over aggressive risk increases.
