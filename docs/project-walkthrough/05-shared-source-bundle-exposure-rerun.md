# Shared Source Bundle Exposure Rerun

Date: 2026-06-06.

## Build Under Test

Commit: `0af9f84`.

## What Changed

- `incoming_deposit_check` and `where_is_money_check` now share `sourceBundleExposure`.
- Incoming deposit keeps `freshBundleExposure` and `walletExposureProfile` as compatibility fields.
- Where Is Money exposes `sourceBundleExposure` and `subjectExposureProfile` on fresh reports.
- Fresh selected-amount exposure can set score floors.
- Historical subject exposure is capped and cannot become exact source proof.
- Budget-limited unresolved boundaries remain visible in score and graph output when the rerun reaches that state.

This document separates fresh source proof, historical context, and coverage limits. It does not treat old saved reports as fresh proof.

## Rerun Method

The completed live rerun used a temporary local script that:

- loaded env from `C:/Users/User/OneDrive/Desktop/smartcontract/.env`;
- read saved `incoming_deposit_check` inputs from `forensic_check_jobs.progress_json`;
- called `buildIncomingDepositReport(...)` directly;
- did not call `completeForensicCheckJob`;
- wrote nothing to DB;
- set `listTrc20ApprovalChanges` to `[]`;
- set `getTransaction` to `{}`;
- disabled cross-chain Stage 2 and EVM continuation;
- used a bounded `TASK8_LIVE_TRANSFER_LIMIT=16`.

The temporary script was removed before commit.

## Case Results

### Incoming Deposit Summary

| Case | Old saved baseline | Prior documented bounded baseline | Current shared rerun status | Current shared result |
|---|---|---|---|---|
| `b4603c390d3b0f08f9a604b26dc31d08e64aeeacc5a1560410bb5bbf030aa39c` | `85 CRITICAL / DECLINE` | `39 / ACCEPTABLE` | completed | `39 LOW-MEDIUM / ACCEPTABLE` |
| `51a97751ede658756183529008db5147d645d9215b0b7373973c701bf0b95e39` | `65 HIGH / DECLINE` | `42 / ACCEPTABLE`, bridge boundary missed | not completed | needs production rerun |
| `53b742b18613bc072093d68ff6d95d0209680368cb40a2df8455f2bc9ac27c72` | `40 / ACCEPTABLE` | `38 / ACCEPTABLE` | not completed | needs production rerun |
| `e3a049d52d62a7c2bca4bce928051950e2919b958716cd94f3696a28f55b27c9` | `45 / DECLINE` | `37 / ACCEPTABLE` | not completed | needs production rerun |
| `0eac2348cad4ae9fb342e1ecb40102040c34d651cba371f7072c958a5be76b0f` | `38 / ACCEPTABLE` | `37 / ACCEPTABLE` | not completed | needs production rerun |

The second live command for `51a977...`, `53b742...`, `e3a049...`, and `0eac...` was interrupted by the user because it ran too long. It emitted no final JSON result, so this document does not invent current shared values for those cases.

### `b4603...` stale HTX incoming deposit

Old saved behavior:

- Score: `85 CRITICAL / DECLINE`.
- Old explanation: stale HTX/Huobi was treated as `100%` of the selected provenance target.

Current completed shared rerun:

- Score: `39 LOW-MEDIUM / ACCEPTABLE`.
- `sourceBundleExposure.htxHuobiShare`: `0`.
- `sourceBundleExposure.cleanCexShare`: `0`.
- `sourceBundleExposure.bridgeRouterDexShare`: `0`.
- `sourceBundleExposure.unknownShare`: `1`.
- `sourceBundleExposure.coverageRatio`: `0.154488`.
- `sourceBundleExposure.unresolvedBoundary`: `null`.
- `subjectExposureProfile.htxHuobiIncomingShare`: `0`.
- `subjectExposureProfile.cleanCexIncomingShare`: `0.010781`.
- `subjectExposureProfile.unknownSourceShare`: `0.964975`.
- `subjectExposureProfile.scoreContribution`: `9`.
- `unifiedRiskSummary.backgroundScore`: `9`.
- `unifiedRiskSummary.activeAnchor`: `limited_coverage_floor`, score `30`.
- Runtime: completed in about `446` seconds with `16/16` live transfer reads.

Fresh source proof:

The current shared profile did not prove fresh HTX/Huobi, clean CEX, bridge/router/DEX, unknown-contract, or risky-label source for the checked amount. Only about `15.45%` of the checked deposit was covered by observed source paths; uncovered share was assigned to `unknown`.

Historical context:

The subject profile found no HTX/Huobi incoming share in the current 30-day window. It found a small clean CEX incoming share and mostly unknown counterparty volume. This is background context only, not proof of the deposit source.

Coverage limits:

Coverage was partial, but the current completed report did not set `sourceBundleExposure.unresolvedBoundary`. That means this rerun does not prove a hidden boundary was absent; it only records that the shared unresolved-boundary detector did not fire in this bounded run.

Why the final score is fairer:

The final score no longer preserves `85 CRITICAL` from stale HTX/Huobi wording. The report avoids the exact-source claim unless `sourceBundleExposure.htxHuobiShare` proves it. The remaining score comes from limited coverage and historical/background uncertainty.

### `51a977...` budget-limited bridge boundary

Old saved behavior:

- Score: `65 HIGH / DECLINE`.
- Old explanation: balance-forming path reached a bridge boundary at `100%` of selected provenance target.

Prior documented bounded baseline:

- Score: `42 / ACCEPTABLE`.
- The previous bounded run missed the bridge boundary.
- The earlier walkthrough already marked this as a coverage/runtime problem, not proof that bridge risk disappeared.

Current shared rerun:

- Status: not completed.
- The live command covering this case was interrupted by the user because runtime was too long.
- No current `sourceBundleExposure` JSON was emitted.
- No current `sourceBundleExposure.unresolvedBoundary.kind` or `scoreFloor` can be claimed from this run.

Fresh source proof:

Not available from the current shared rerun.

Historical context:

Not available from the current shared rerun.

Coverage limits:

This remains the key production rerun case. Expected validation target is whether the shared report now records an unresolved bridge/router/DEX boundary instead of silently scoring the missed boundary as zero. This document cannot claim that result because the rerun did not complete.

### Additional incoming deposits from historical score file

`C:/Users/User/OneDrive/Desktop/оценки.txt` was accessible. The saved jobs for the known documented cases were also found in DB. Current shared reruns for these additional cases did not complete before the live command was stopped.

| Case | Old saved baseline from DB/file | Prior documented bounded baseline | Current shared rerun status | Notes |
|---|---|---|---|---|
| `53b742...` | `40 / ACCEPTABLE` | `38 / ACCEPTABLE` | not completed | No current shared fields emitted. |
| `e3a049...` | `45 / DECLINE` | `37 / ACCEPTABLE` | not completed | No current shared fields emitted. |
| `0eac...` | `38 / ACCEPTABLE` | `37 / ACCEPTABLE` | not completed | No current shared fields emitted. |

Fresh source proof:

Not available from current shared reruns for these three cases.

Historical context:

Not available from current shared reruns for these three cases.

Coverage limits:

The stopped run means these cases need a production rerun or a narrower runner with explicit phase budgets. The prior documented bounded baselines can be used only as old comparison baselines, not as proof of current shared behavior.

### Where Is Money saved jobs

Read-only DB inventory found saved `where_is_money_check` jobs, including:

| Saved job | Subject | Saved score / decision | Saved source-policy context | Shared fields in saved result |
|---|---|---|---|---|
| `0c4e2abe-33ec-45d8-8a8b-54834588cd21` | `TYs4UuvnUHr8D744bURoKWqfNA2TNJEXi7` | `75 / DECLINE` | `bridge_router_dex` raw/effective share about `100%` | absent |
| `1a8603ec-06d8-41c5-967a-22263d5d09f7` | `TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM` | `40 / ACCEPTABLE` | no saved source-policy evidence | absent |

Current shared rerun:

- Not attempted after the user stopped live reruns.
- The sampled saved Where jobs predate the shared fields and do not contain `sourceBundleExposure` or `subjectExposureProfile`.
- Therefore there are no current fresh shared Where values in this document.

Fresh source proof:

Not available for Where Is Money from this Task 8 run.

Historical context:

Not available for Where Is Money from this Task 8 run.

Coverage limits:

Saved Where jobs without shared fields cannot validate the new source-bundle behavior. They are useful only as old baselines for selecting production reruns: one service/bridge source-policy case and one unknown/clean case.

## Product Conclusion

The one completed current rerun validates the core stale-source fix for `b4603...`: old HTX/Huobi wording no longer survives unless fresh `sourceBundleExposure.htxHuobiShare` proves it.

The run did not complete enough cases to validate the full Task 8 matrix. In particular, `51a977...` still needs a production rerun to prove whether unresolved bridge/router/DEX coverage now creates the expected conservative boundary floor.

The product rule remains:

- fresh source proof may drive policy floors;
- historical context may add capped background risk;
- coverage limits must be visible and must not be silently treated as zero risk.
