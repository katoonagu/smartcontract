# Unified Wallet Risk Scoring v2

Date: 2026-06-05.

This note documents the current v2 scoring explanation model. It does not introduce multiple wallet scores. The user-facing result is still one final wallet score, one risk level, and one decision:

```text
finalScore
finalLevel
finalDecision
```

The additional fields explain the weighted context, floors, coverage, and decision path behind that one result.

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

`activeAnchor` is the strongest positive floor reason. It explains the floor side of the calculation, but it is not always the driver of `finalScore`: when `contextScore` is higher than every floor, the weighted context drives the final value.

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
| TPv-like policy/deep context | Weighted Deep context plus Where source-policy floor/context | `75 HIGH / DECLINE` |

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

## Fresh Runtime Calibration, 2026-06-05

Artifact:

```text
artifacts/forensic-calibration/fresh-wallet-calibration-2026-06-05T16-05-02-363Z.json
artifacts/forensic-calibration/fresh-wallet-calibration-2026-06-05T16-05-02-363Z.md
```

This was a fresh rerun through the real Fast Check, Deep Research, Where Is Money, and unified scorer functions. It was not a saved-job replay.

Bounded runner limits:

- 90-day window.
- Fast timeout: 30 seconds.
- Deep timeout: 180 seconds.
- Where timeout: 180 seconds.
- Cross-chain Stage 2 disabled.
- LLM contract verdicts disabled.
- Deep counterparty fast snapshots disabled for calibration, because they caused large extra stablecoin and transfer lookups for many counterparties.

Runtime result:

- All 5 addresses completed Fast, Deep, and Where layers.
- No DB errors were observed.
- No rate-limit cooldown / 429 error was observed.
- Runtime logs had 4 TronScan retries and 1 aborted `stablecoin_contract_state` request. The checks still completed.

| Address | Why it is risky / not risky | Fast | Deep | Where | Final | Expected decision | Comment |
|---|---|---:|---:|---:|---:|---|---|
| `THRSTA7nfbBNsM8tCL4yfA4jsFC4Yw8Pet` | High-volume transit-like behavior, but no hard bad evidence and Where treats it as operational liquidity context. | 25 LOW | 55 | 29 ACCEPTABLE | 19 LOW | ACCEPTABLE | Dampener reduced non-hard behavior context. |
| `TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf` | Internal approval-drain proximity label plus exact approval-drain provenance in Where. | 80 HIGH | 55 | 95 DECLINE | 95 CRITICAL | DECLINE | Strong hard-evidence floor works: final score is not diluted by layer weights. |
| `TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d` | High-volume behavior, but no hard evidence. Where declines because recent-flow provenance coverage is insufficient. | 25 LOW | 55 | 65 DECLINE | 30 MEDIUM | ACCEPTABLE / disputed | Product risk: Where layer says `DECLINE`, final unified decision says `ACCEPTABLE`. If only one decision should be shown, UI/reporting must make final decision authoritative or change Where insufficient-coverage wording. |
| `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe` | Large historical pass-through flow: about 7.54M USDT incoming and 7.54M USDT outgoing; bridge/router/DEX-like outgoing share about 25%. | 55 MEDIUM | 55 | 65 DECLINE | 84 HIGH | DECLINE | This is the important fixed case. Earlier saved jobs had Where around 45/60 and Deep context without a strong final anchor. Fresh Deep now adds `historical_transit_pattern`, and Where adds `where_drain_episode_transit_pattern`. |
| `TUzXY779GY3Tm6UDRYDPqNEojZgZEpY127` | High-volume operational pass-through behavior, but no bridge/router/DEX share and no hard bad evidence. | 25 LOW | 55 | 29 ACCEPTABLE | 19 LOW | ACCEPTABLE | Dampener reduced non-hard operational context. |

### What Improved

`TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe` no longer stays in a medium-looking score when fresh Deep data is available.

Fresh evidence:

```text
Deep operational profile:
incoming USDT: 7,541,408.439833
outgoing USDT: 7,541,406.9472
historicalTransitScore: 81
bridgeDexRouterOutgoingRatio: 0.2499

Where:
riskScore: 65
decision: DECLINE

Unified:
finalScore: 84
finalDecision: DECLINE
activeAnchor: where_drain_episode_transit_pattern
secondary reason: historical_transit_pattern
```

The old problem was that regular-activity dampening could make a large historical transit wallet look too normal. In this fresh run the pattern floor beats that dampener.

### What Is Still Disputed

`TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d` is the main disputed case.

Facts from the fresh run:

```text
Fast: 25 LOW
Deep raw: 55
Where: 65 DECLINE
Unified final: 30 MEDIUM / ACCEPTABLE
Anchor: none
Dampener: 25
Where proof level: insufficient_coverage
Where provenance scope: recent_flow
```

Why this happens:

- Where Is Money uses a safe-default exchange policy and can say `DECLINE` when clean source cannot be proven.
- Unified scoring does not let insufficient coverage alone become a hard decline.
- The dampener reduces behavior-only / operational-context risk when no hard evidence, source-policy floor, asset continuation, or transit-pattern floor is present.

Product decision needed:

- If `insufficient_coverage` should never look like a final decline, Where should expose this as `REVIEW` or `INSUFFICIENT_COVERAGE`, not `DECLINE`.
- If a Where score of 65 must always create at least a medium/high final floor, add an explicit non-hard coverage/policy floor.
- If the final unified decision is the only user-facing decision, reports must hide or relabel the layer-level Where decision.

### Runtime Finding

The first bounded runs timed out in Deep on several addresses. Instrumentation showed the cause was not the initial source transfer fetch, all-token fetch, stablecoin lookup, or DB lookup. The slow path was Deep counterparty fast snapshots: for many counterparties it performed extra stablecoin and transfer lookups.

Calibration runner fix:

```text
counterpartyFastSnapshotLimit: 0
counterpartyFastSnapshotActiveLimit: 0
```

After that change, all 5 addresses completed. Production can keep richer counterparty snapshots, but it should budget them explicitly and report when that budget is exhausted.
