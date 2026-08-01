# Unified Wallet Risk Score v1.2: Decision And Dampener Design

Date: 2026-06-05.

## Summary

This spec defines a focused wallet-level scoring update.

Scope for this phase:

- update only wallet check / unified wallet score;
- keep one user-facing wallet score, one level, and one decision;
- stop treating `insufficient_coverage` as an automatic wallet-level `DECLINE`;
- stop allowing regular-activity dampeners to hide large historical transit / bridge flow;
- keep incoming deposit monitoring for Phase 2, but design this change so deposits can later reuse the same policy logic instead of keeping a separate scoring system.

This is not an address-specific fix. The `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe` case is the calibration example, but the implementation must work for any wallet with similar evidence.

## Current Facts From Code

### Unified Wallet Scoring

`calculateUnifiedWalletRisk` is the wallet-level scorer. It combines:

```text
Fast Check: 10%
Deep Research: 60%
Where Is Money: 30%
```

Source: `src/risk/unifiedWalletRisk.ts:95-97`.

The scorer already returns:

- `finalScore`;
- `finalLevel`;
- `finalDecision`;
- `weightedLayerScore`;
- `contextScore`;
- `hardEvidenceFloor`;
- `policyFloor`;
- `assetContinuationFloor`;
- `patternFloor`;
- `dampener`;
- `scoreBreakdown`.

Source: `src/risk/unifiedWalletRisk.ts:78-93`.

Current final score is built as:

```text
weightedLayerScore = weighted available layers
dampener = allowed dampener
contextScore = weightedLayerScore - dampener
finalScore = max(contextScore, hard/policy/asset/pattern floors)
if no hard evidence, cap finalScore at 84
```

Source: `src/risk/unifiedWalletRisk.ts:627-674`.

Current problem: `finalDecision` inherits `DECLINE` when `whereReport.userDecision === "DECLINE"`, even if final score is low.

Source: `src/risk/unifiedWalletRisk.ts:675-677`.

### Where Is Money Decision Leakage

Where Is Money can return `DECLINE` for unresolved origin / insufficient coverage.

`userDecisionFromInternal` maps everything except `ACCEPTABLE` to `DECLINE`.

Source: `src/risk/proofLevels.ts:3-4`.

`riskPolicyEngine` also maps `insufficient_coverage` to internal `REVIEW` but user `DECLINE`.

Source: `src/risk/riskPolicyEngine.ts:171-179`.

This means a wallet can end up with:

```text
score: 17 LOW
decision: DECLINE
proofLevel: insufficient_coverage
hard evidence: none
```

That is not acceptable for the product goal of one honest wallet-level score and decision.

### Current Dampener Behavior

`rawDampener` currently combines:

- negative Fast Check reasons;
- max `addressBehaviorProfiles[].dampenerScore`;
- wallet-role dampener for clean / operational roles.

Source: `src/risk/unifiedWalletRisk.ts:594-614`.

The allowed dampener is capped by:

```text
min(raw, contextScore - floorScore, 25)
```

Source: `src/risk/unifiedWalletRisk.ts:617-625`.

`regular_activity_dampener` is added when a wallet has many incoming/outgoing transfers, enough counterparties, and no single largest incoming transfer dominates the incoming volume.

Source: `src/forensics/addressBehavior.ts:257-266`.

This can be correct for ordinary merchant / treasury / operational wallets. It is wrong when the same wallet also has strong high-volume pass-through or bridge/router/DEX evidence.

### Historical Transit Helper

`calculateHistoricalTransitBreakdown` already scores historical transit using:

- flow volume;
- pass-through ratio;
- bridge/swap/router/DEX or unknown-contract service share.

It marks a profile eligible only when the score reaches at least `60`, and caps the score at `84`.

Source: `src/forensics/historicalTransitScore.ts:30-67`.

This helper should be reused instead of inventing another one-off rule.

### Where Drain Episode Evidence

Where Is Money coverage can include `drainEpisode` with:

- `fundingAmountRaw`;
- `episodeOutgoingRaw`;
- `bridgeOutgoingRaw`;
- `bridgeOutgoingShare`;
- `episodeCoverageRatio`;
- outgoing transaction hashes.

Source types: `src/types.ts:809-814`, `src/types.ts:899-902`.

Saved `TLhVzk...` jobs already contain this evidence:

```text
fundingAmountRaw: 1.885M USDT
episodeOutgoingRaw: 1.885M USDT
bridgeOutgoingShare: 1
episodeCoverageRatio: 0.071763
```

The current unified scorer does not use `whereReport.coverage.drainEpisode` as a wallet-level pattern anchor.

### Incoming Deposits Are Separate Today

Incoming deposit monitoring does not call `calculateUnifiedWalletRisk`.

It currently computes:

```text
depositRiskScore = max(whereReport.riskScore, topHardScore)
decision = topHardScore >= 85 ? DECLINE : whereReport.userDecision
```

Source: `src/forensics/incomingDepositJob.ts:750-772`.

Phase 2 must remove this separate decision system and reuse the same evidence classification / final decision rules as wallet checks.

## Product Goal

The wallet report must behave like this:

```text
one wallet
one final score
one final level
one final decision
one explainable breakdown
```

The decision must not contradict the score.

Examples:

- `17 LOW` must not be `DECLINE` only because origin coverage is incomplete.
- `43 MEDIUM` must not hide a large bridge pass-through episode when the report already has that evidence.
- hard evidence still overrides normal scoring.
- strong source-policy or operational-transit evidence can raise the score through anchors/floors.

## Decision Design

Replace the current wallet-level decision rule:

```text
if whereReport.userDecision == DECLINE:
  finalDecision = DECLINE
else:
  finalDecision = decisionFromScore(finalScore)
```

with a score-and-evidence decision rule:

```text
if hardEvidenceFloor >= 85:
  finalDecision = DECLINE
else if finalScore >= 60:
  finalDecision = DECLINE
else:
  finalDecision = ACCEPTABLE
```

`insufficient_coverage` can still add score or coverage context, but it cannot force `DECLINE` when final score is below the decision threshold.

Hard evidence includes deterministic scam/taint, exact approval-drain provenance, stablecoin blacklist, sanctioned service, and exact high-risk provenance.

Source-policy evidence can still produce `DECLINE`, but only because it raises `finalScore` through `policyFloor` to the high-risk range.

## Pattern Anchor Design

Add a new wallet-level pattern anchor from `whereReport.coverage.drainEpisode`.

Name:

```text
where_drain_episode_transit_pattern
```

Source:

```text
pattern_floor
```

Scoring:

Use `calculateHistoricalTransitBreakdown` with:

```text
incomingVolumeRaw = drainEpisode.fundingAmountRaw
outgoingVolumeRaw = drainEpisode.episodeOutgoingRaw
inflowToOutflowRatio = episodeOutgoingRaw / fundingAmountRaw
bridgeDexRouterOutgoingRatio = drainEpisode.bridgeOutgoingShare
unknownContractOutgoingRatio = 0
```

If the helper returns `eligible = true`, add a pattern floor with that helper score.

This makes the score objective and reusable:

- no hardcoded address list;
- no one-off `TLh` exception;
- same helper as Deep historical transit;
- same no-hard-evidence critical cap of `84`.

For the `TLhVzk...` saved job, this should create a high pattern floor because the episode shows about `1.885M USDT` entering and about `1.885M USDT` leaving, with `bridgeOutgoingShare = 1`.

## Dampener Design

Keep dampeners, but make them conditional.

The current `regular_activity_dampener` has a valid purpose: a normal long-lived operational wallet can have repeated distributed activity without being a drain wallet.

But it must not reduce score when strong transit evidence is present.

Define a helper:

```text
hasStrongTransitAnchor(input)
```

It returns true if at least one of these is present:

- eligible Deep `historicalTransitPatternFloor`;
- eligible Where `drainEpisode` transit pattern;
- `assetContinuationFloor > 0`;
- Deep operational flow profile with eligible historical transit breakdown;
- boundary/bridge/router/DEX evidence that already produced a pattern or policy floor.

Then apply behavior dampener like this:

```text
if hasStrongTransitAnchor:
  behaviorDampener = min(behaviorDampener, 5)
else:
  behaviorDampener = behaviorDampener
```

This keeps a small confidence adjustment for ambiguous behavior, but prevents a `15` or `25` dampener from hiding strong bridge/pass-through evidence.

For `TLhVzk...`, the saved report has `regular_activity_dampener = 15`, but it also has strong bridge drain episode evidence. After this change, that dampener should be capped to `5` or neutralized by the higher pattern floor.

## Expected Case Behavior

### `TSdKkavp6EGy3CNG8iqZvVDiMP1Sdh1fUU`

Current saved behavior:

```text
score: 17 LOW
decision: DECLINE
proofLevel: insufficient_coverage
hard evidence: none
```

Expected v1.2 behavior:

```text
score: stays low unless another anchor is found
decision: ACCEPTABLE if finalScore < 60
reason: insufficient coverage is context, not deterministic decline
```

### `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe`

Current saved behavior:

```text
raw deep: 65
raw where: 45
weightedLayerScore: 58
dampener: 15
finalScore: 43 MEDIUM
decision: DECLINE
```

Saved evidence that is currently underused:

```text
drainEpisode funding: about 1.885M USDT
drainEpisode outgoing: about 1.885M USDT
bridgeOutgoingShare: 1
```

Expected v1.2 behavior:

```text
where_drain_episode_transit_pattern creates patternFloor
regular_activity_dampener no longer hides this evidence
finalScore becomes HIGH unless contradicted by stronger clean evidence
decision follows finalScore
```

## Reporting Design

Expose the active reason in the existing unified breakdown.

The final report should make this understandable:

```text
Weighted layer score: 58
Dampener: 5
Context score: 53
Pattern floor: 80
Active anchor: where_drain_episode_transit_pattern
Final score: 80 HIGH
Decision: DECLINE
```

For low insufficient-coverage cases:

```text
Weighted layer score: 32
Dampener: 15
Context score: 17
No hard evidence
No policy floor
No pattern floor
Final score: 17 LOW
Decision: ACCEPTABLE
Coverage note: clean source was not fully proven
```

## Test Plan

Add focused tests in `tests/risk/unifiedWalletRisk.test.ts`.

Required cases:

1. `insufficient_coverage` whereReport with low final score does not force `DECLINE`.
2. Hard evidence still forces `DECLINE`.
3. Source-policy floor still raises score and produces `DECLINE` when final score is high.
4. Where drain episode with high bridge share creates `patternFloor`.
5. Regular activity dampener is capped when a strong transit anchor exists.
6. Regular activity dampener still applies for ordinary operational wallets without strong transit anchors.
7. `TLh`-like saved report fixture moves from medium context into high final score.
8. `TSd`-like insufficient-coverage fixture becomes low/acceptable unless another anchor is present.

## Phase 2: Incoming Deposits

This phase intentionally does not change incoming deposit monitoring.

But Phase 2 must align it with wallet scoring:

- incoming deposit reports should not have a separate final-decision philosophy;
- hard evidence should still decline;
- source-policy / pattern evidence should raise score through shared anchors;
- `insufficient_coverage` should not force user-facing `DECLINE` by itself;
- deposit monitoring should reuse the shared decision helper created for wallet-level scoring.

Current separate logic is in `src/forensics/incomingDepositJob.ts:750-772`.

## Out Of Scope

- live TronScan reruns;
- changing provider RPS / scheduler behavior;
- changing incoming deposit monitoring in this phase;
- changing admin graph rendering;
- adding manual review as a separate user-facing score.

## Acceptance Criteria

- Wallet-level `finalDecision` no longer blindly inherits `whereReport.userDecision`.
- Low-score `insufficient_coverage` wallet checks no longer show `DECLINE`.
- Hard evidence remains a deterministic high-risk decline path.
- `whereReport.coverage.drainEpisode` can produce a wallet-level pattern floor through `calculateHistoricalTransitBreakdown`.
- Strong transit anchors cap or neutralize behavior dampeners.
- `TLhVzk...`-like saved evidence no longer ends as `43 MEDIUM` solely because of `regular_activity_dampener`.
- Tests cover the new decision rule, dampener gating, and drain-episode pattern anchor.
- Incoming deposits remain unchanged in this phase, but the spec clearly marks them as Phase 2 shared-policy work.
