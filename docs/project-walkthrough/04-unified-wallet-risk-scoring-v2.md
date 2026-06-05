# Unified Wallet Risk Scoring v2

Date: 2026-06-05.

This note documents the current v2 scoring explanation model. It does not introduce multiple wallet scores. The user-facing result is still one final wallet score, one risk level, and one decision:

```text
finalScore
finalLevel
finalDecision
```

The additional fields explain why that one result reached its value.

## Score Fields

`calculateUnifiedWalletRisk(...)` returns:

- `weightedLayerScore`: normalized weighted score from the available Fast Check, Deep Research, and Where Is Money layers.
- `contextScore`: `weightedLayerScore` after allowed dampening and limited-coverage adjustment.
- floors: `hardEvidenceFloor`, `policyFloor`, `assetContinuationFloor`, and `patternFloor`.
- `scoreBreakdown.floors`: the same floors split into `hardEvidence`, `policy`, `assetContinuation`, `pattern`, and `coverage`.
- `scoreBreakdown.activeAnchor`: the strongest positive floor reason that anchors the score explanation.
- `dampener`: the amount subtracted from non-hard context when trusted-role or false-positive context is allowed to reduce risk.
- `coverageLevel`: `complete`, `partial`, or `limited`.
- `finalScore` and `finalDecision`: the final user-facing result.

The score is computed as a baseline plus anchors, not as separate competing outputs. In simplified form:

```text
weightedLayerScore -> dampener/coverage -> contextScore
floors -> activeAnchor explanation
finalScore = max(contextScore, strongest floor), capped at 84 when there is no hard evidence
```

`finalDecision` remains `DECLINE` when Where Is Money already declined the wallet. Otherwise it follows the final score threshold.

## Why Anchors Can Raise The Score

Layer weighting is useful for combining broad context, but it can dilute a strong single signal. Example: a Where source-policy score of `70` contributes only `21` points at a `30%` layer weight when all layers are available.

Anchors prevent that dilution for specific evidence classes:

- `where_source_policy_floor`: source-policy decline evidence from Where Is Money.
- `asset_continuation_floor`: verified or known asset continuation after USDT movement.
- `historical_transit_pattern`: large historical pass-through flow with bridge/router/DEX or unknown-contract exposure.
- hard-evidence anchors: exact approval-drain, blacklist, scam/taint, or equivalent deterministic evidence.

This is why the final score can be higher than `weightedLayerScore`: the weighted baseline says how the available layers average out, while the anchor says a specific evidence class must not be scored below its policy floor.

## Deep Historical Flow

Deep Research can attach `operationalFlowProfiles` to the report. v2 uses two historical-flow fields from each profile:

- `historicalTransitScore`: the stored score for a large pass-through pattern.
- `historicalTransitBreakdown`: the stored explanation, including `eligible`, `flowUsdt`, `volumeScore`, `passThrough`, `passThroughScore`, `serviceShare`, `serviceShareScore`, and `score`.

The scorer recalculates the historical transit breakdown from the raw fields before trusting the stored score. The floor uses the minimum of the recalculated score, stored `historicalTransitScore`, and stored `historicalTransitBreakdown.score`. This protects against stale or incoherent stored profile data.

Calibration example:

```text
TLh-like flow:
incoming about 7.54M USDT
outgoing about 7.54M USDT
pass-through about 0.999
service share about 0.25
historicalTransitScore: 81
activeAnchor: historical_transit_pattern
finalScore: 81 HIGH / DECLINE
```

## Calibration Cases

The fixture calibration tests cover the three observed address styles:

| Style | Main anchor/context | Expected final |
|---|---|---:|
| TLh-like historical transit | `historical_transit_pattern` from Deep operational flow | `81 HIGH / DECLINE` |
| TYs-like verified continuation | `asset_continuation_floor` over policy evidence | `84 HIGH / DECLINE` |
| TPv-like policy/deep context | Deep score plus Where source-policy floor | `>=70` and `<85`, `HIGH / DECLINE` |

These are calibration fixtures, not live provider claims about current blockchain state.

## Provider Budgeting

Provider budgeting keeps deep checks bounded and explainable:

- Deep reports carry `runProfile`: currently `production_full` or `bounded_rerun`.
- Deep reports carry `providerBudget`: `providerCallBudget`, `transferCallBudget`, `contractCallBudget`, `approvalCallBudget`, `elapsedTimeBudgetMs`, and `exhausted`.
- Cross-chain provider expansion uses a provider-call budget and adds coverage notes when the budget is exhausted.
- TronScan scheduling separates endpoint buckets and account groups so transfer, approval, contract, fullnode, trongrid, and default traffic can be paced independently.

`TRONSCAN_API_KEY_GROUPS` uses this format:

```text
group:key1,key2;backup:key3
```

Default group behavior:

- If no TronScan keys are configured, key groups are empty and unkeyed requests use the scheduler's `default` group.
- If `TRONSCAN_API_KEY` has keys but `TRONSCAN_API_KEY_GROUPS` is empty, all configured keys are placed in one `default` group.
- If explicit groups omit some configured keys, the omitted keys are added to `default`.
- A key must be present in `TRONSCAN_API_KEY` before it can appear in `TRONSCAN_API_KEY_GROUPS`.
- One key cannot be assigned to multiple groups.

This lets production split account-level pacing across key pools while keeping a safe fallback for unassigned keys.

## Runtime Reporting

Task 9 made runtime metadata visible in the final report. The score breakdown can now include:

```text
Run profile: bounded_rerun.
Provider budget: calls 20, transfers 10, contracts 0, approvals 0, elapsed 30000 ms, exhausted no.
```

When all budget fields are `null` and `exhausted` is false, the report still shows the run profile but omits the empty provider-budget line. This keeps old `production_full` jobs readable while making bounded reruns auditable.
