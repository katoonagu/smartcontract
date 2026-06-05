# Unified Wallet Risk Scoring v2 Design

## Summary

This spec defines the next version of wallet risk scoring and the provider-budget rules needed to make that scoring reliable in production.

The product goal stays unchanged:

```text
one wallet
one final score
one final level
one final decision
```

v2 focuses on three connected areas:

1. Unified scoring that treats strong evidence as an anchor, not as a small weighted contribution.
2. Deep Research historical-flow detection, especially pass-through wallets and bridge/swap/router/DEX exposure.
3. Provider budgeting for TronScan so full production checks can run without degrading into partial coverage or rate-limit failures.

The spec intentionally keeps one user-facing score. It does not introduce separate manual-review scores.

## Current Facts From The Codebase

### Unified Score

`calculateUnifiedWalletRisk` already composes three layers:

```text
Fast Check: 10%
Deep Research: 60%
Where Is Money: 30%
```

Source: `src/risk/unifiedWalletRisk.ts:60-62`.

The scorer already exposes:

- `weightedLayerScore`;
- `contextScore`;
- `hardEvidenceFloor`;
- `policyFloor`;
- `assetContinuationFloor`;
- `patternFloor`;
- `dampener`;
- `coverageLevel`.

Source: `src/risk/unifiedWalletRisk.ts:44-57`.

The current final score is:

```text
floorScore = max(hardEvidenceFloor, policyFloor, assetContinuationFloor, patternFloor)
contextScore = weightedLayerScore - dampener
finalScore = max(contextScore, floorScore)
```

If there is no hard evidence, `finalScore` is capped below `CRITICAL` at `84`.

Source: `src/risk/unifiedWalletRisk.ts:602-617`.

If `Where Is Money` returns `userDecision = DECLINE`, unified score preserves `finalDecision = DECLINE`.

Source: `src/risk/unifiedWalletRisk.ts:618-620`.

### Deep Historical Flow

Deep Research already returns `operationalFlowProfiles`, `assetContinuationProfiles`, `boundaryExposureProfiles`, and related evidence.

Source: `src/check/deepForensicCheck.ts:1431-1475`.

`historicalTransitPatternFloor` already raises score when a Deep operational-flow profile shows:

- meaningful flow volume;
- outgoing movement;
- pass-through behavior;
- bridge/swap/router/DEX or unknown-contract outgoing share.

Source: `src/risk/unifiedWalletRisk.ts:473-500`.

After commit `c98bf06`, Deep Research can build operational flow from live source transfers even when the local indexed USDT table is empty.

Source: `src/check/deepForensicCheck.ts:391-415` and `tests/check/deepForensicCheck.test.ts:625`.

### Provider Scheduling

The app already has a TronScan scheduler.

Current config includes:

- `TRONSCAN_REQUEST_MIN_INTERVAL_MS`;
- `TRONSCAN_GLOBAL_REQUEST_MIN_INTERVAL_MS`;
- `TRONSCAN_TRANSFER_REQUEST_MIN_INTERVAL_MS`;
- `TRONSCAN_APPROVAL_REQUEST_MIN_INTERVAL_MS`;
- `TRONSCAN_CONTRACT_REQUEST_MIN_INTERVAL_MS`;
- `TRONSCAN_FULLNODE_REQUEST_MIN_INTERVAL_MS`;
- `TRONGRID_REQUEST_MIN_INTERVAL_MS`;
- `TRONSCAN_RATE_LIMIT_COOLDOWN_MS`.

Source: `src/config.ts:33-40` and `src/config.ts:212-245`.

The scheduler currently creates one slot per API key.

Source: `src/tron/tronscanScheduler.ts:145-162`.

The scheduler also has process/global, endpoint-bucket, and cooldown state.

Source: `src/tron/tronscanScheduler.ts:183-260`.

Existing runtime-hardening docs already identified that multiple API keys can still burst above likely provider/IP/account limits.

Source: `docs/superpowers/specs/2026-06-01-bot-runtime-hardening-design.md`.

## Provider Rate-Limit Facts

External provider facts are unstable and must be treated as provider policy, not as product logic.

Relevant public TRONSCAN pages:

- TRONSCAN API key docs: https://docs.tronscan.org/en/getting-started/api-keys
- TRONSCAN 2023 no-key limit announcement: https://support.tronscan.org/hc/en-us/articles/20508935629209-Announcement-on-additional-limitations-for-requests-without-a-key
- TRONSCAN 2025 API-key requirement follow-up: https://support.tronscan.org/hc/en-us/articles/49272903085465-Follow-up-Announcement-on-the-Mandatory-Requirement-of-API-Key-for-All-Requests

The 2023 announcement explicitly says no-key access was reduced to `5 requests per second`. The 2025 follow-up says requests without a valid API key are subject to stricter limiting and no requested QPS is guaranteed after August 31, 2025.

Design implication:

The app must not assume that two configured keys always mean two independent quotas. Two keys can belong to one provider account, one IP, or one backend quota. The safe design is:

```text
provider budget = min(account group budget, endpoint budget, process budget, key slot budget)
```

## Problems To Solve

### Problem 1: Strong Evidence Can Still Be Hard To Explain

The current formula is directionally correct, but users need to see why score changed.

Example:

```text
weightedLayerScore: 48
patternFloor: 81
finalScore: 81
```

This is correct only if the report explains that historical transit evidence anchored the score.

### Problem 2: Deep Operational Score And Pattern Floor Can Diverge

In the `TLh...` fresh rerun, the operational profile had:

```text
operationalScore: 15
patternFloor: 81
```

This happened because `operationalScore` is feature-threshold based, while `historicalTransitPatternFloor` independently evaluates volume, pass-through, and service-share.

That may be technically valid, but it is hard to explain. v2 must make this relationship explicit.

### Problem 3: Provider Limits Can Create False Low Risk

If TronScan rate limits or rejects expanded requests, checks become partial. Partial data can make a wallet look cleaner than it is.

This is a scoring problem, not only an infrastructure problem.

v2 must treat provider coverage as part of risk confidence and report clarity.

### Problem 4: API Keys Are Currently Modeled Too Optimistically

The scheduler has per-key slots. That is useful, but it can overestimate capacity when multiple keys share one provider account.

The app needs account-group level budgeting.

## Product Requirements

### Single Final Score

Every wallet check must return:

```text
finalScore: 0-100
finalLevel: LOW | MEDIUM | HIGH | CRITICAL
finalDecision: ACCEPTABLE | DECLINE
```

There must be no user-facing requirement to manually compare separate Fast, Deep, and Where scores.

### Evidence Anchors

The final score must be anchored by strong evidence classes:

- hard evidence;
- exchange/source policy evidence;
- verified asset continuation;
- historical transit/pass-through pattern;
- route-linked approval-drain pattern;
- limited coverage floor.

Weighted layer math remains a baseline, not the final authority.

### Non-Hard Evidence Cap

Without hard evidence, score must not become `CRITICAL`.

Current cap:

```text
finalScore <= 84 when hardEvidenceFloor == 0
```

This should remain unless a later policy spec redefines hard evidence.

### Decision Preservation

If `Where Is Money` returns `userDecision = DECLINE`, unified scoring must not downgrade the final decision to `ACCEPTABLE`.

The report must clearly explain when:

```text
score < 60
decision = DECLINE
```

This is not a bug if the decision came from policy or insufficient provenance.

### Coverage Transparency

Every final report must expose:

```text
coverageLevel
available layers
missing checks
provider budget limits hit
partial result reason
```

This prevents a partial low score from looking like a confident clean result.

## Scoring v2 Design

### Formula

v2 keeps the current formula shape:

```text
weightedLayerScore = normalized weighted score from available layers

contextScore = weightedLayerScore - allowedDampener

floorScore = max(
  hardEvidenceFloor,
  policyFloor,
  assetContinuationFloor,
  historicalTransitPatternFloor,
  routeLinkedApprovalPatternFloor,
  coverageFloor
)

finalBeforeCap = max(contextScore, floorScore)

if hardEvidenceFloor == 0:
  finalScore = min(finalBeforeCap, 84)
else:
  finalScore = finalBeforeCap
```

### Layer Availability

Layer availability must be shown in every report.

Example:

```text
Fast available: yes, score 0
Deep available: yes, score 90
Where available: yes, score 70
```

This matters because:

- if Fast is missing, weights normalize across Deep and Where;
- if Fast is present with score `0`, it participates as a true zero.

The `TPv...` fresh rerun showed this clearly: score was lower with available Fast `0` than in an older partial job where Fast was unavailable.

### Scoring Breakdown

Every report must expose:

```text
weightedLayerScore
contextScore
hardEvidenceFloor
policyFloor
assetContinuationFloor
patternFloor
dampener
coverageLevel
finalScore
finalDecision
```

The Telegram/admin UI should not hide this behind raw JSON. It should present a compact explanation:

```text
Final: 81 HIGH / DECLINE
Baseline from layers: 48
Anchored by: historical transit pattern 81
Reason: large pass-through flow with bridge/swap/router exposure
Coverage: partial
```

## Deep Research Historical Flow Design

### What Deep Must Always Try To Measure

For the subject wallet, Deep Research should measure:

- incoming USDT volume;
- outgoing USDT volume;
- pass-through ratio;
- top incoming counterparties;
- top outgoing counterparties;
- outgoing share to bridge/swap/router/DEX;
- outgoing share to unknown contracts;
- terminal-liquidity outgoing share;
- verified TRC20 asset continuation after USDT movement;
- boundary exposure paths.

### Direct Live Source Fallback

If the local indexed USDT table is empty or sparse, Deep must still use live source transfers already fetched from TronScan.

This is now implemented by passing `sourceTransfers.edges` into operational profile assembly.

Source: `src/check/deepForensicCheck.ts:391-415`.

### Historical Fallback

If the requested window is sparse, Deep can fetch recent latest transfers outside the strict window for context.

The report must label this explicitly:

```text
30d window had N transfers; added latest M/K historical transfers for sparse-wallet context.
```

This currently appears in `missingChecks`.

### Historical Transit Pattern

The historical transit pattern should anchor score when:

- volume is material;
- outgoing volume exists;
- incoming/outgoing preservation is high;
- service-share is meaningful.

Current implementation uses:

```text
volumeFactor = log10(flowUsdt + 1) / 6
passThrough = inflowToOutflowRatio
serviceShare = max(bridgeDexRouterOutgoingRatio, unknownContractOutgoingRatio)
score = 35 + volumeFactor * 20 + passThrough * 20 + serviceShare * 25
```

Source: `src/risk/unifiedWalletRisk.ts:473-500`.

v2 should keep this shape, but make it visible in report breakdown:

```text
historicalTransitPattern:
  volumeScore
  passThroughScore
  serviceShareScore
  finalPatternFloor
```

### Operational Score Alignment

`OperationalFlowProfile.operationalScore` and `historicalTransitPatternFloor` should not appear contradictory.

v2 should either:

1. rename `operationalScore` to `operationalFeatureScore`, or
2. add a second field to the profile:

```text
historicalTransitScore
```

Recommendation: add `historicalTransitScore`.

Reason:

`operationalScore` can remain useful as a feature-threshold score, while `historicalTransitScore` becomes the exact profile-level value used by `patternFloor`.

### Verified Asset Continuation

Deep already detects generic TRC20 continuation:

```text
USDT out -> protocol/token in -> verified token out -> destination
```

The signal must remain generic. It must not be hardcoded to `jUSDT`.

`jUSDT` is only one observed example.

If token metadata is verified or known and destination risk is provider-risk/internal-label/service-boundary, the profile can contribute to `assetContinuationFloor`.

Source: `src/forensics/assetContinuation.ts`.

### What Must Not Happen

The system must not label every bridge/swap/router usage as scam.

Bridge/swap/router exposure is risk context unless combined with:

- high pass-through;
- material volume;
- risky destination;
- policy boundary;
- hard evidence;
- verified continuation to risky destination.

## Provider Budgeting Design

### Goal

Full production checks should complete more often without `400/429` bursts, provider cooldown spirals, or accidental partial coverage.

Provider budgeting is part of scoring quality because data gaps change the final score.

### Safe Default Rate

Use a conservative account-group budget:

```text
TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS=250
```

This is `4 requests per second`.

Reason:

TRONSCAN has publicly documented `5 requests per second` for no-key access in the past, but keyed and account/IP/endpoint limits may differ. A 4 rps safe default leaves margin.

### Account Grouping

Add a concept of API key groups:

```text
TRONSCAN_API_KEY_GROUPS=main:key1,key2;backup:key3
```

If groups are not configured:

```text
all configured TRONSCAN_API_KEY values belong to one default group
```

This is the safe default.

The scheduler should choose a key slot inside the account group, but the group bucket must also be ready.

Dispatch gate:

```text
readyAt = max(
  keySlotReadyAt,
  accountGroupReadyAt,
  endpointBucketReadyAt,
  providerScopeReadyAt,
  processGlobalReadyAt
)
```

### Endpoint Budgets

Keep endpoint-specific budgets:

```text
transfer
approval
contract
fullnode
trongrid
default
```

For full production forensic runs, transfer endpoints should be the most conservative because route expansion can generate many transfer-history calls.

Recommended starting values:

```text
TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS=250
TRONSCAN_GLOBAL_REQUEST_MIN_INTERVAL_MS=250
TRONSCAN_TRANSFER_REQUEST_MIN_INTERVAL_MS=300
TRONSCAN_APPROVAL_REQUEST_MIN_INTERVAL_MS=400
TRONSCAN_CONTRACT_REQUEST_MIN_INTERVAL_MS=500
TRONSCAN_FULLNODE_REQUEST_MIN_INTERVAL_MS=300
TRONGRID_REQUEST_MIN_INTERVAL_MS=300
```

These are safe defaults, not provider guarantees.

### Error Handling

Treat provider errors differently:

- `429`: rate limit; apply cooldown to key slot, account group, endpoint bucket, and provider scope.
- `401`: authentication/config problem; surface configuration error.
- `400`: do not blindly treat as rate limit. Capture request category, endpoint, query shape, and address count. It can be caused by unsupported parameters, invalid ranges, endpoint-specific restrictions, or too-heavy queries.
- `5xx`: retry with backoff and mark provider instability if repeated.

### Job Budgeting

Full forensic jobs should have explicit budgets:

```text
providerCallBudget
transferCallBudget
contractCallBudget
approvalCallBudget
elapsedTimeBudgetMs
```

When a budget is exhausted, the job should return partial result with precise missing-check reasons.

### Full vs Bounded Runs

Use two named run profiles:

```text
bounded_rerun
production_full
```

`bounded_rerun`:

- lower call budget;
- approval enrichment off;
- contract tx info off;
- cross-chain off;
- used for fast calibration checks and debugging.

`production_full`:

- full configured budgets;
- approval enrichment triggered;
- contract tx info triggered;
- cross-chain Stage 2 according to policy;
- used for final customer-facing forensic jobs.

The report must state which profile produced the score.

## Reporting Requirements

Every final wallet report should include a scoring section:

```text
Final score: 81 HIGH
Final decision: DECLINE

Layer baseline:
Fast: 0
Deep: 65
Where: 31
Weighted baseline: 48

Evidence anchors:
patternFloor: 81 historical_transit_pattern
policyFloor: 0
assetContinuationFloor: 0
hardEvidenceFloor: 0

Coverage:
partial
missing checks: ...
run profile: production_full
```

Admin graph/report should expose:

- layer availability;
- layer raw scores;
- floor reasons;
- dampener reasons;
- provider budget status;
- missed checks;
- graph edges that contributed to operational flow.

## Calibration Cases

v2 implementation must include fixtures or DB-based test runs for:

1. `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe`
   - expected: HIGH due to historical transit pattern;
   - observed fresh bounded: `81 HIGH / DECLINE`.

2. `TYs4UuvnUHr8D744bURoKWqfNA2TNJEXi7`
   - expected: HIGH due to asset continuation and policy floor;
   - observed fresh bounded: `84 HIGH / DECLINE`.

3. `TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb`
   - expected: HIGH due to Deep and policy floor;
   - observed fresh bounded: `75 HIGH / DECLINE`.

4. Ordinary exchange-funded wallet
   - expected: LOW or MEDIUM, not false HIGH only because of exchange/service context.

5. Merchant/liquidity wallet
   - expected: operational context can dampen weak evidence, but cannot suppress hard evidence or strong floors.

6. Exact hard evidence wallet
   - expected: CRITICAL allowed only when hard evidence exists.

## Test Strategy

### Unit Tests

Add or extend tests for:

- account-group scheduler behavior;
- `429` cooldown propagation to key, account group, endpoint, and provider scope;
- `400` classification as provider/query failure, not automatic rate limit;
- `historicalTransitScore` calculation;
- final score explanation breakdown;
- layer availability and normalized weights.

### Integration Tests

Add integration-style tests for:

- Deep report with live source transfer fallback;
- Deep report with local index empty;
- Deep report with verified asset continuation;
- Where + Deep + Fast unified score composition.

### Golden Calibration Tests

Keep fixture-based golden tests for the three observed addresses. These tests should not require live provider calls. Use frozen report JSON or compact fixture builders.

## Rollout Plan At Spec Level

Implementation should be split into phases:

1. Scoring/reporting transparency
   - add explicit breakdown to report output;
   - no scoring behavior change required.

2. Deep historical score alignment
   - add `historicalTransitScore`;
   - make `patternFloor` source visible from the profile.

3. Provider account-group budgeting
   - add account group parsing;
   - gate scheduler dispatch by group bucket;
   - add diagnostics.

4. Production full rerun mode
   - run full jobs with provider budgets;
   - persist new jobs;
   - compare against bounded rerun and saved jobs.

5. Admin graph visibility
   - show floor sources and operational-flow edges.

## Non-Goals

This spec does not introduce:

- multiple user-facing scores;
- manual review as a required final decision path;
- ML/statistical calibration;
- hardcoded token-specific risk rules for `jUSDT`;
- proof that bridge/swap/router usage is always malicious.

## Acceptance Criteria

The design is successful when:

- a wallet always has one final score and one final decision;
- strong floors cannot be diluted by layer weights;
- `TLh...`-like pass-through wallets become HIGH through Deep historical evidence;
- ordinary service usage does not automatically become HIGH;
- the report explains why score and decision differ;
- full jobs respect provider budgets;
- multiple API keys from one account cannot accidentally multiply the account quota;
- partial provider coverage is visible in the final report.
