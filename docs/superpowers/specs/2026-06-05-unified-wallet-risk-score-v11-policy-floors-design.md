# Unified Wallet Risk Score v1.1: Policy Floors And Asset Continuation Design

## Goal

Improve the unified wallet score so strong risk evidence is not diluted by weighted averaging.

v1 created one final wallet score from:

- Fast Check;
- Deep Research;
- Where Is Money.

That architecture stays. v1.1 changes the final formula from "mostly weighted average" to "weighted baseline plus evidence floors".

The product goal is:

```text
one wallet
one final score
one final level
one final decision
```

The score must reflect strong policy and behavioral evidence. If one layer finds a strong enough risk class, that class must anchor the final score instead of being reduced to a small weighted contribution.

## Problem Found In Real DB Case

Address:

```text
TYs4UuvnUHr8D744bURoKWqfNA2TNJEXi7
```

The existing DB jobs produced:

```text
Fast: 0
Deep: 45
Where: 70
Weighted final: 48
Decision: DECLINE
```

The weighted math was:

```text
Fast: 0 * 10% = 0
Deep: 45 * 60% = 27
Where: 70 * 30% = 21
Final weighted score = 48
```

This is too weak for the actual flow.

Observed transfer sequence:

```text
UsdtOFT contract -> subject wallet
subject wallet -> jUSDT Token contract
jUSDT Token contract -> subject wallet
subject wallet -> risk-marked target address
```

The issue is not only `jUSDT`. The issue is a generic asset conversion continuation:

```text
USDT -> verified protocol/token contract -> another verified TRC20 token -> outgoing transfer to risky destination
```

The current code mainly follows official TRON USDT transfers:

- `src/forensics/routeSearch.ts` filters transfer rows to `TRON_USDT_CONTRACT_ADDRESS`;
- `src/check/whereIsMoneyCheck.ts` checks current balance using `TRON_USDT_CONTRACT_ADDRESS`;
- `src/tron/tronClient.ts` adds `contract_address=TRON_USDT_CONTRACT_ADDRESS` in its regular transfer-history URL builder.

That is correct for USDT provenance, but not enough for post-conversion continuation.

## Product Rule

Weighted score is a baseline, not the final authority.

If a layer finds a strong evidence class, the final score must not fall below the floor for that evidence class.

Use this model:

```text
contextScore = weightedLayerScore - contextDampener

floorScore = max(
  hardEvidenceFloor,
  policyFloor,
  assetContinuationFloor,
  patternFloor,
  coverageFloor
)

finalScore = max(contextScore, floorScore)
```

Then apply global caps:

```text
if hardEvidenceFloor == 0:
  finalScore <= 84
```

This keeps non-hard-evidence cases below `CRITICAL`, but lets strong policy and continuation evidence become `HIGH`.

## Evidence Classes

### Hard Evidence

Hard evidence means the system has deterministic bad evidence.

Examples:

- active USDT blacklist;
- exact approval-drain evidence;
- exact scam/stolen/phishing internal label;
- exact high-risk provenance path;
- deterministic Where Is Money hard bad evidence such as `approval_drain`, `scam_or_blacklist`, or `sanctioned_service`.

Floor:

```text
85-95
```

Hard evidence cannot be dampened below its floor.

### Policy Evidence

Policy evidence means the wallet may not be proven scam, but it violates source-risk policy strongly enough to decline.

Examples:

- Where Is Money produces `exchange_policy_decline`;
- `sourcePolicyEvidence` contains strong `bridge_router_dex`, protocol, router, bridge, or service-source exposure;
- aggregate source-policy risk is high even if no single layer is hard proof.

Floor:

```text
70-84
```

Policy evidence is not hard evidence. It should not produce `CRITICAL` by itself. But it must not be diluted to `MEDIUM` by layer weights.

For a case like `TYs4...`, Where already found:

```text
proofLevel: exchange_policy_decline
sourcePolicyEvidence.kind: bridge_router_dex
sourcePolicyEvidence.score: 70
effectiveShare: 1
selected amount: 101,607.5086 USDT
```

The final score should not be below `70`.

### Asset Continuation Evidence

Asset continuation evidence means the wallet converted or wrapped USDT into another verified asset and immediately continued movement in that new asset.

This is generic. It must not be hard-coded to `jUSDT`.

Pattern:

```text
1. subject wallet sends or receives official USDT;
2. subject wallet interacts with a contract/protocol;
3. the same transaction or nearby transactions produce a different TRC20 token for the subject;
4. subject sends that non-USDT token onward;
5. the next destination is risk-marked, internally labeled, or a risky service boundary.
```

Floor:

```text
65-84
```

The floor depends on strength:

```text
65: verified conversion plus rapid continuation
70: conversion plus service/protocol source or destination
75: conversion plus large USDT amount and rapid onward movement
80-84: conversion plus risk-marked target or labeled risky counterparty
```

For `TYs4...`, the expected floor is `80-84` because:

- USDT entered from `UsdtOFT`;
- USDT was sent into `jUSDT Token`;
- a verified TRC20 token was minted/received;
- that token was sent onward within seconds;
- the destination address is risk-marked by TronScan.

This is still not hard evidence of scam unless the destination is internally confirmed or the path proves a known bad actor. Without hard evidence, cap remains `84`.

### Pattern Evidence

Pattern evidence means strong suspicious behavior without exact proof.

Examples:

- high-volume rapid pass-through;
- repeated transit behavior;
- large historical bridge/swap/router outflow;
- route-linked approval-drain context without exact approval-drain proof.

Floor:

```text
60-80
```

Pattern evidence should be computed every time enough transfer data exists. It should not depend on a manual trigger.

### Context Evidence

Context evidence is useful but weak by itself.

Examples:

- service boundary touched;
- unknown contract touched;
- low-confidence route;
- partial enrichment;
- weak behavior signal.

Context evidence should contribute to weighted score, but it should not anchor the final score above `HIGH` by itself.

## Policy Floor Formula

Add a new floor:

```text
policyFloor
```

Inputs:

- `whereReport.proofLevel`;
- `whereReport.assessment.sourcePolicyEvidence`;
- `whereReport.assessment.riskLayers`;
- `whereReport.coverage`;
- optional Deep Research service/operational/boundary profiles.

Rules:

```text
if whereReport.proofLevel == "exchange_policy_decline":
  policyFloor >= 70
```

When Where exposes source-policy layers, use their own adjusted scores:

```text
policyFloorCandidate =
  max(sourcePolicyEvidence.score, riskLayer.adjustedScore, riskLayer.score)
```

Then:

```text
policyFloor = clamp(policyFloorCandidate, 70, 84)
```

Do not set `policyFloor` from service boundary context alone. A service boundary is not enough. The floor requires an actual source-policy decline or strong aggregate source-policy risk.

For weak source-policy context:

```text
policyFloor = 0
```

## Asset Continuation Detector

Add a detector that works across TRON TRC20 tokens, not only USDT.

### Data Needed

The current regular transfer history path is USDT-scoped. v1.1 needs a second, bounded lookup:

```text
listRelatedTrc20TransfersAllTokens(address, window, limit)
```

This lookup should be small and targeted:

- subject address only;
- short window around selected USDT anchor transfers;
- newest or transaction-local rows first;
- no broad graph expansion in v1.1.

### Token Quality Filter

Only treat a non-USDT token as eligible if it looks real enough.

Accept when multiple facts are true:

- token has `tokenInfo`;
- token is TRC20;
- token has symbol/name/contract address;
- token can be shown by provider metadata, when available;
- contract metadata says it is a token or known protocol token;
- token is connected to the USDT transaction by same tx, same contract interaction, or close timestamp.

Reject or downgrade when:

- token metadata is missing;
- token is not displayable;
- token has no name/symbol;
- token appears only as an unrelated dust transfer;
- there is no clear USDT-to-token continuity.

Unknown tokens can be reported as context or missing-check evidence, but should not create a high floor.

### Continuation Episode

Represent a detected continuation as a profile:

```ts
type AssetContinuationProfile = {
  subjectAddress: string;
  sourceAsset: "USDT";
  continuationAssetSymbol: string;
  continuationTokenContract: string;
  conversionTxHash: string;
  outgoingTxHash: string | null;
  protocolAddress: string | null;
  destinationAddress: string | null;
  destinationRisk: "provider_risk" | "internal_label" | "service_boundary" | "unknown";
  elapsedMs: number | null;
  sourceAmountRaw: string | null;
  continuationAmountRaw: string | null;
  tokenQuality: "verified" | "known" | "unknown";
  score: number;
  evidenceClass: "asset_continuation";
  reasons: string[];
};
```

This profile can live first in Deep Research, because Deep is the main wallet-risk layer. Where Is Money can also use it later if the continuation is tied to selected balance/recent-flow provenance.

## Final Formula v1.1

Replace v1 final formula with:

```text
weightedLayerScore = normalized weighted Fast/Deep/Where score

contextDampener = allowed dampener for weak/context score only
contextScore = clamp(weightedLayerScore - contextDampener)

floorScore = max(
  hardEvidenceFloor,
  policyFloor,
  assetContinuationFloor,
  patternFloor,
  coverageFloor
)

finalScore = max(contextScore, floorScore)

if hardEvidenceFloor == 0:
  finalScore = min(finalScore, 84)
```

Dampeners must not reduce:

- `hardEvidenceFloor`;
- `policyFloor`;
- `assetContinuationFloor`;
- strong `patternFloor`.

This is the core correction from v1.

## Expected Result For `TYs4...`

Current v1 result:

```text
weightedLayerScore: 48
hardEvidenceFloor: 0
patternFloor: 0
finalScore: 48
finalDecision: DECLINE
```

Expected v1.1 result:

```text
weightedLayerScore: 48
policyFloor: 70
assetContinuationFloor: 80-84
hardEvidenceFloor: 0
finalScore: 80-84
finalLevel: HIGH
finalDecision: DECLINE
```

The exact score should depend on the detector result:

- if only source-policy decline is available: `70`;
- if verified asset continuation is detected: `75+`;
- if continuation goes to provider-risk destination: `80-84`.

## Reporting Changes

The final report should show floors explicitly:

```text
Weighted layer score: 48
Policy floor: 70
Asset continuation floor: 82
Hard evidence floor: 0
Pattern floor: 0
Dampener: 0
Final score: 82
```

This is better than saying only:

```text
Fast 0 * 10%
Deep 45 * 60%
Where 70 * 30%
```

The user needs to see why the weighted average did not control the final result.

## Scope

In scope for v1.1:

- add `policyFloor`;
- add `assetContinuationFloor`;
- add generic TRC20 asset continuation detector;
- keep no-hard-evidence cap at `84`;
- keep blacklist and exact approval-drain as hard evidence;
- update final Telegram score breakdown;
- add tests for `TYs4...` style flow using fixtures;
- update documentation.

Out of scope for v1.1:

- full multi-token graph search;
- full all-token historical indexing;
- chain-wide token reputation engine;
- manual review workflow;
- changing every existing detector score.

## Testing Requirements

Add tests for:

1. Blacklist remains hard evidence and is not diluted by weights.
2. `exchange_policy_decline` with strong source-policy score anchors final score at least `70`.
3. Service-boundary context alone does not create `policyFloor`.
4. Generic asset continuation anchors score above weighted average.
5. Unknown/unverified token continuation does not create high floor.
6. Asset continuation to provider-risk destination caps below `CRITICAL` without hard evidence.
7. Dampener cannot reduce hard, policy, or asset-continuation floors.

## Design Self-Review

Placeholder scan: no placeholders remain.

Internal consistency: the design keeps v1 architecture and changes only final evidence aggregation plus one bounded continuation detector.

Scope check: v1.1 is a single implementation plan. It avoids a full multi-token graph engine.

Ambiguity check: `policyFloor` requires `exchange_policy_decline` or strong source-policy evidence; simple service boundary context is explicitly excluded.

