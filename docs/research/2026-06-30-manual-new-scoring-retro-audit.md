# Manual New Scoring Retro Audit, 2026-06-30

Purpose: manually replay every saved forensic subject against `Manual Scoring Matrix v1` from `docs/superpowers/specs/2026-06-30-manual-new-scoring-retro-audit-design.md`.

This is not a production rerun, not a new scoring implementation, and not a calibrated probability model. The score is a policy scorecard: strongest evidence row first, then in-band adjustment for path strength, share, continuity, coverage, and clean/operational dampeners.

## Executive Summary

Saved evidence scope:

- 31 unique subjects.
- 73 saved jobs.
- Job kinds: `address_fast_check`, `address_deep_check`, `where_is_money_check`, `incoming_deposit_check`.
- Ordering: newest subject first by latest saved job timestamp.

Manual decision distribution:

- `DECLINE`: 4 subjects.
- `REVIEW`: 10 subjects.
- `INSUFFICIENT_EVIDENCE`: 8 subjects.
- `ACCEPTABLE`: 9 subjects.

Main finding: the new matrix materially changes how we treat weak and incomplete evidence. Hard proof remains high (`95+`). Stablecoin blacklist remains hard decline (`100`). But behavior-only patterns, unknown source, and coverage gaps no longer create decline-level scores by themselves.

The biggest policy correction is that `insufficient_coverage` is no longer a risk reason. It can block `ACCEPTABLE`, but it cannot justify `60+` without hard proof, source-policy proof, or a service-linked/source-anchored pattern.

## Method

For each subject I used the saved job output only:

- latest score-bearing production result;
- hard proof signals;
- source-policy or origin-path signals;
- service-linked pattern signals;
- behavior-only signals;
- coverage and provenance confidence;
- clean CEX or operational context.

Manual aggregation:

1. Pick the strongest evidence row.
2. Place the score inside that row's band.
3. Use secondary signals only as in-band nudges.
4. Cap behavior-only at `59`.
5. Treat coverage as uncertainty, not badness.
6. Do not dampen hard proof.

For `incoming_deposit_check`, the score is deposit-scoped. It does not necessarily label the whole sender wallet as bad.

## Summary Table

| # | Subject | Saved jobs | Latest comparable saved score | New manual score | Delta | Manual decision | Evidence class | Short reason |
|---:|---|---:|---|---:|---:|---|---|---|
| 1 | `TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE` | 16 | `95 DECLINE` | 95 | 0 | `DECLINE` | `hard_proof` | Exact approval-drain provenance reaches subject. |
| 2 | `TQTiScrNLt53rvfSQiWULdAvHDRrr3Vm3Q` | 1 | `4 ACCEPTABLE` | 5 | +1 | `ACCEPTABLE` | `clean_or_operational_dampener` | Deposit path reaches allowlisted Binance with high confidence. |
| 3 | `TEG5DEvGUQ33ZPug7wwfbp2Quf2VFa5pk8` | 3 | `39 ACCEPTABLE` | 35 | -4 | `INSUFFICIENT_EVIDENCE` | `coverage_uncertainty` | Latest path is mostly unknown despite earlier clean CEX jobs. |
| 4 | `TYQDZBYfog34M384c37iekwyt5rbAE1xg4` | 3 | `9 ACCEPTABLE` | 6 | -3 | `ACCEPTABLE` | `clean_or_operational_dampener` | Latest completed job reaches Binance and OKX clean sources. |
| 5 | `TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf` | 6 | `95 DECLINE` | 95 | 0 | `DECLINE` | `hard_proof` | Exact approval-drain provenance reaches subject. |
| 6 | `TYznvCkMPQLEmKHmjxNM1yQn88yabRqSdM` | 2 | `39 ACCEPTABLE` | 50 | +11 | `REVIEW` | `case_route_prior` | Dominant unknown-contract/service boundary, but no exact risky source proof. |
| 7 | `TNAraW3cWKETcRz9p6obg7SzeiMzH2Z9i1` | 6 | `80 fast / 35 where` | 72 | -8 | `REVIEW` | `case_route_prior` | Route-linked approval-drain context exists, but exact drain proof is not established. |
| 8 | `TC3dkHK8kqgv81Fko7AG31Qd2EyRDbNGMf` | 1 | `39 ACCEPTABLE` | 8 | -31 | `ACCEPTABLE` | `clean_or_operational_dampener` | Deposit path reaches KuCoin clean source; historical unknown volume is not source proof. |
| 9 | `TSLe4c5wPWh1N6XnfiZEMHSjQZAPTYu7YA` | 1 | `3 ACCEPTABLE` | 5 | +2 | `ACCEPTABLE` | `clean_or_operational_dampener` | Clean Binance source with full coverage. |
| 10 | `TFw2bgSKihGBK8cjFx7Rkbxi32G4FbXFXp` | 1 | `8 ACCEPTABLE` | 12 | +4 | `ACCEPTABLE` | `clean_or_operational_dampener` | Clean Bybit source; bridge/router history is contextual only. |
| 11 | `TU4vEruvZwLLkSfV9bNw12EJTPvNr7Pvaa` | 2 | `34 ACCEPTABLE` | 25 | -9 | `INSUFFICIENT_EVIDENCE` | `coverage_uncertainty` | Clean path appears, but deposit amount provenance is not proven. |
| 12 | `TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d` | 2 | `65 DECLINE` | 32 | -33 | `INSUFFICIENT_EVIDENCE` | `coverage_uncertainty` | Old decline came from coverage failure, not risky source proof. |
| 13 | `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe` | 4 | `65 DECLINE` | 70 | +5 | `DECLINE` | `service_linked_pattern` | High bridge/unknown-contract service exposure supports service-linked pattern. |
| 14 | `THRSTA7nfbBNsM8tCL4yfA4jsFC4Yw8Pet` | 2 | `35 ACCEPTABLE` | 45 | +10 | `REVIEW` | `case_route_prior` | Material outbound exposure to exact labeled counterparty, but not source proof. |
| 15 | `TCen1YLCVztCFZwW8uujGWG2WXxQc8huD1` | 1 | `41 ACCEPTABLE` | 42 | +1 | `REVIEW` | `behavior_only_prior` | Unknown source, mule-like role, low provenance confidence. |
| 16 | `TY8WacTAyj4PdYPGvtyzvZCJJx8AUepH7E` | 1 | `37 ACCEPTABLE` | 35 | -2 | `INSUFFICIENT_EVIDENCE` | `coverage_uncertainty` | Very weak coverage and unknown/no-previous-transfer evidence. |
| 17 | `TR3aoPthSukgT3y2BMo5yCmk6i362rckJd` | 1 | `18 ACCEPTABLE` | 22 | +4 | `ACCEPTABLE` | `clean_or_operational_dampener` | Majority clean Bybit source with high confidence; rest remains context. |
| 18 | `TRZXXfghN8Q56RyKwfTniCd6TfjvcHGL7d` | 2 | `52 ACCEPTABLE` | 55 | +3 | `REVIEW` | `case_route_prior` | Dominant unknown-contract source plus approval-drain review hints, but no exact drain proof. |
| 19 | `TKVZTQz94vu3gDehFQkzdwJ6uNYvzQuBQV` | 1 | `30 ACCEPTABLE` | 35 | +5 | `INSUFFICIENT_EVIDENCE` | `coverage_uncertainty` | Minority clean CEX; dominant unknown source remains unproven. |
| 20 | `TAAvdgWLxVVRCZmFBVVRBkT8dRYHSqPaM9` | 1 | `34 ACCEPTABLE` | 38 | +4 | `REVIEW` | `behavior_only_prior` | Partial clean CEX, material unknown share, non-operational note. |
| 21 | `TWtc4tySWNs2XLpFrVw9jYz6TRZYN8CBX3` | 1 | `34 ACCEPTABLE` | 40 | +6 | `REVIEW` | `behavior_only_prior` | Fully unknown source with collector role and partial coverage. |
| 22 | `TKLNcQfvhynGfufehXV2dJDgKtfvnprBMa` | 1 | `34 ACCEPTABLE` | 40 | +6 | `REVIEW` | `behavior_only_prior` | Fully unknown source with mule role and partial coverage. |
| 23 | `TRWbRtwn8fht9HbePXc5XKwpjUBpQVBYnH` | 2 | `30 ACCEPTABLE` | 35 | +5 | `INSUFFICIENT_EVIDENCE` | `coverage_uncertainty` | Weak continuity and low clean CEX share. |
| 24 | `TGmgosh7Cq788gc8SWAeGYoUSonpB9gwTm` | 1 | `0 ACCEPTABLE` | 5 | +5 | `ACCEPTABLE` | `clean_or_operational_dampener` | Clean Bybit source with high confidence. |
| 25 | `TUhBB36igAP3cbsvJqTWJD7p1skHjKJJXU` | 1 | `34 ACCEPTABLE` | 40 | +6 | `REVIEW` | `behavior_only_prior` | Fully unknown source with mule role and partial coverage. |
| 26 | `TYksomCeBMM5TB1e56BxjnaJcFoGEUGtZL` | 2 | `30 ACCEPTABLE` | 34 | +4 | `INSUFFICIENT_EVIDENCE` | `coverage_uncertainty` | Partial unknown source and weak continuity; no risky source proof. |
| 27 | `TWuNuWcZPG6GnZiPGAM381eYwZ2pLm8yzp` | 1 | `0 ACCEPTABLE` | 5 | +5 | `ACCEPTABLE` | `clean_or_operational_dampener` | Clean Bybit source with full coverage. |
| 28 | `TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC` | 2 | `45 DECLINE` | 45 | 0 | `REVIEW` | `case_route_prior` | Approval-drain review hints exist, but exact drain provenance was not proven. |
| 29 | `TJaXbx3S9wwQ5KKSkDgS63URwa4c6zqcC8` | 1 | `-` | 0 | n/a | `ACCEPTABLE` | `insufficient_saved_evidence` | Saved job has no transfer edges and no risk evidence. |
| 30 | `TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm` | 3 | `-` | 100 | n/a | `DECLINE` | `hard_proof` | Stablecoin restriction shows subject blacklisted. |
| 31 | `TUzXY779GY3Tm6UDRYDPqNEojZgZEpY127` | 1 | `-` | 32 | n/a | `INSUFFICIENT_EVIDENCE` | `coverage_uncertainty` | Partial behavior context only; no source or hard proof. |

## Detailed Audit

### 1. `TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE`

Saved evidence:
- 16 jobs across deep, fast, and where-is-money checks.
- Multiple where-is-money jobs saved `oldScore=95`, `oldDecision=DECLINE`.
- Hard layer repeatedly reports `approval_drain:95`.
- Reason repeatedly says exact approval-drain provenance reaches the checked wallet.
- Deep jobs also show high-volume operational/transit behavior, but that is secondary.

Manual matrix row:
- Exact approval-drain proof, `90-95`.

Manual score:
- `95 DECLINE`.

Reasoning:
- This is direct hard proof. Coverage caveats and clean Bybit side paths do not dampen an exact approval-drain provenance result.

Caveats:
- Deep behavior-only evidence would not independently justify `60+`; the score is high only because of hard proof.

### 2. `TQTiScrNLt53rvfSQiWULdAvHDRrr3Vm3Q`

Saved evidence:
- One incoming deposit job.
- Saved score `4 ACCEPTABLE`.
- Origin path reaches allowlisted Binance with `98%` share and provenance confidence `100`.
- No hard, policy, or service-linked risk evidence.

Manual matrix row:
- Clean CEX source, `0-29`.

Manual score:
- `5 ACCEPTABLE`.

Reasoning:
- The deposit path is clean and well supported. Unknown counterparty volume in sender history is context, not deposit-source proof.

Caveats:
- This is deposit-scoped, not a full clean certification for every future sender action.

### 3. `TEG5DEvGUQ33ZPug7wwfbp2Quf2VFa5pk8`

Saved evidence:
- Three incoming deposit jobs.
- Latest saved score `39 ACCEPTABLE`.
- Latest job has `99%` unknown source share, low provenance confidence `53`, and partial coverage.
- Earlier jobs reached Kraken/Binance clean CEX sources with low scores.

Manual matrix row:
- Coverage uncertainty / weak context, `30-44`.

Manual score:
- `35 INSUFFICIENT_EVIDENCE`.

Reasoning:
- The newest evidence does not prove a risky source, so it cannot cross `60`. But the latest deposit also cannot be called clean because the dominant source remains unknown and confidence is weak.

Caveats:
- Earlier clean CEX jobs reduce suspicion but do not prove the latest deposit source.

### 4. `TYQDZBYfog34M384c37iekwyt5rbAE1xg4`

Saved evidence:
- Three incoming deposit jobs, including one failed job.
- Latest completed job saved `9 ACCEPTABLE`.
- Origin paths reach allowlisted Binance and OKX with strong continuity and provenance confidence `100`.

Manual matrix row:
- Clean CEX source, `0-29`.

Manual score:
- `6 ACCEPTABLE`.

Reasoning:
- The latest completed evidence is clean CEX sourced. The older failed job is not a risk signal.

Caveats:
- Sender history includes unknown counterparty volume, but it does not become source-policy proof.

### 5. `TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf`

Saved evidence:
- Six jobs across deep, fast, and where-is-money checks.
- Where-is-money jobs saved `95 DECLINE`.
- Hard layer reports `approval_drain:95`.
- Reason says exact approval-drain provenance reaches the checked wallet.

Manual matrix row:
- Exact approval-drain proof, `90-95`.

Manual score:
- `95 DECLINE`.

Reasoning:
- This is the same hard-proof class as subject 1. Clean Binance side paths and operational behavior do not reduce exact approval-drain proof.

Caveats:
- Fast/deep behavior-only evidence would be low if evaluated alone.

### 6. `TYznvCkMPQLEmKHmjxNM1yQn88yabRqSdM`

Saved evidence:
- Two incoming deposit jobs.
- Latest saved score `39 ACCEPTABLE`; earlier same-day score `54 ACCEPTABLE`.
- Earlier job shows unknown contract/service boundary at `94%` of checked-deposit source share.
- AI/service verdict downgraded the unknown-contract risk; no exact drain or hard risky source was proven.
- Latest job falls back to `100%` unknown/no-previous-transfer source with provenance confidence `30`.

Manual matrix row:
- Unknown contract source exposure / case-route prior, `15-55`.

Manual score:
- `50 REVIEW`.

Reasoning:
- Dominant unknown-contract/service boundary is enough for manual review, especially with weak provenance. It still cannot cross `60` because the saved evidence does not prove a risky source, exact drain, or decline-level source policy.

Caveats:
- If a later trace proves the service is benign, this should drop into low/operational range. If it proves the service is a drain or risky source, it should jump to hard/source-policy bands.

### 7. `TNAraW3cWKETcRz9p6obg7SzeiMzH2Z9i1`

Saved evidence:
- Six jobs across fast, deep, and where-is-money checks.
- Fast job saved `80` from `internal_label_approval_drain_proximity`.
- Deep jobs show `approvalDrain score=80 evidence=route_linked`.
- Where-is-money jobs saved `35 ACCEPTABLE` and say recent-flow source was not fully proven.
- Wallet looks operational/liquidity-like in where-is-money context.

Manual matrix row:
- Route-linked approval pattern, `60-80`.

Manual score:
- `72 REVIEW`.

Reasoning:
- Route-linked approval-drain context is materially stronger than ordinary behavior and can enter the `60-80` row. But the saved evidence stops short of exact approval-drain provenance, and where-is-money could not prove the recent-flow source. That keeps the decision at `REVIEW`, not auto-`DECLINE`.

Caveats:
- This is a prime candidate for manual analyst escalation: either prove exact drain provenance and raise to `90+`, or demote if the route-link label is stale/noisy.

### 8. `TC3dkHK8kqgv81Fko7AG31Qd2EyRDbNGMf`

Saved evidence:
- One incoming deposit job.
- Saved score `39 ACCEPTABLE`.
- Origin path reaches allowlisted KuCoin with `100%` share and provenance confidence `91`.
- Sender history has large unknown counterparty volume.

Manual matrix row:
- Clean CEX source, `0-29`.

Manual score:
- `8 ACCEPTABLE`.

Reasoning:
- The checked deposit source is clean. Historical unknown counterparty volume is not enough to keep the score in the 30s when deposit provenance is strong.

Caveats:
- This corrects an over-weighted limited-coverage/unknown-history floor.

### 9. `TSLe4c5wPWh1N6XnfiZEMHSjQZAPTYu7YA`

Saved evidence:
- One incoming deposit job.
- Saved score `3 ACCEPTABLE`.
- Origin path reaches allowlisted Binance with `100%` coverage and confidence `100`.

Manual matrix row:
- Clean CEX source, `0-29`.

Manual score:
- `5 ACCEPTABLE`.

Reasoning:
- Low-risk deposit-source evidence. Unknown historical volume remains contextual only.

Caveats:
- None material in saved evidence.

### 10. `TFw2bgSKihGBK8cjFx7Rkbxi32G4FbXFXp`

Saved evidence:
- One incoming deposit job.
- Saved score `8 ACCEPTABLE`.
- Origin path reaches allowlisted Bybit with `100%` share.
- Sender history touches bridge/router/DEX volume at `18%` and unknown counterparty volume at `51%`.

Manual matrix row:
- Clean CEX source with contextual history, `0-29`.

Manual score:
- `12 ACCEPTABLE`.

Reasoning:
- The bridge/router/DEX exposure is below the material `20%` source-policy threshold and is historical sender context, not deposit-source proof. Clean Bybit origin controls the score.

Caveats:
- If bridge/router exposure becomes deposit-source exposure at `20%+`, this should move into review.

### 11. `TU4vEruvZwLLkSfV9bNw12EJTPvNr7Pvaa`

Saved evidence:
- Two incoming deposit jobs.
- Latest saved score `34 ACCEPTABLE`.
- Origin path reaches allowlisted Bybit, but saved result says clean CEX origin is not fully proven for the deposit amount.
- Origin coverage is `0`; provenance confidence is high but amount coverage is weak.

Manual matrix row:
- Coverage uncertainty with clean context, `0-29`.

Manual score:
- `25 INSUFFICIENT_EVIDENCE`.

Reasoning:
- There is clean context, so this should not be a risk score in the 30s. But amount provenance is not proven enough to call the checked deposit clean.

Caveats:
- This is an evidence-quality failure, not a bad-source finding.

### 12. `TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d`

Saved evidence:
- One deep check and one where-is-money check.
- Where-is-money saved `65 DECLINE`.
- Coverage ratio is `0`; selected funding candidates cover `0%` of the outgoing anchor.
- Deep evidence has no source-policy, hard proof, or service exposure.
- Behavior signals are only transit/deposit-drain context.

Manual matrix row:
- Coverage uncertainty / insufficient evidence.

Manual score:
- `32 INSUFFICIENT_EVIDENCE`.

Reasoning:
- The old `65 DECLINE` was driven by a safe default when clean source could not be proven. Under Matrix v1, coverage failure cannot create `60+`. With no risky source proof, the correct outcome is insufficient evidence.

Caveats:
- A fresh trace could raise or lower this, but the saved evidence cannot support decline.

### 13. `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe`

Saved evidence:
- Four jobs.
- Where-is-money saved `65 DECLINE` due insufficient coverage.
- Deep jobs repeatedly show bridge/service exposure: `serviceExposure score=95 type=bridge`, earlier `serviceExposure score=85 type=bridge`.
- Operational/service mix shows bridge and unknown-contract service share.

Manual matrix row:
- Service-linked transit pattern, `60-84`.

Manual score:
- `70 DECLINE`.

Reasoning:
- The old reason was weak because it leaned on insufficient coverage. The stronger saved evidence is the service-linked bridge/unknown-contract pattern. That can cross `60` because there is a clear service anchor and repeated saved exposure.

Caveats:
- The score stays near the lower end because some huge amounts look like approval/accounting artifacts, and where-is-money provenance itself was incomplete.

### 14. `THRSTA7nfbBNsM8tCL4yfA4jsFC4Yw8Pet`

Saved evidence:
- One deep check and one where-is-money check.
- Where-is-money saved `35 ACCEPTABLE`.
- Deep check shows an outbound direct counterparty with `37%` ratio, `snapshot=90`, `evidence=exact_labeled_counterparty`.
- Recent-flow source remains incomplete; wallet otherwise looks operational/liquidity-like.

Manual matrix row:
- Case-route prior / weak exact-labeled counterparty context, `45-59`.

Manual score:
- `45 REVIEW`.

Reasoning:
- A material direct labeled counterparty is stronger than generic unknown-origin context. But it is outbound counterparty exposure, not exact source proof or a direct subject label, so it cannot be treated as hard proof.

Caveats:
- If the labeled counterparty is confirmed as direct taint source or exact scam path, this should move to `85+`.

### 15. `TCen1YLCVztCFZwW8uujGWG2WXxQc8huD1`

Saved evidence:
- One incoming deposit job.
- Saved score `41 ACCEPTABLE`.
- Origin source is `100%` unknown/no-previous-transfer.
- Sender role is `mule`; provenance confidence is `24`.
- Sender has both incoming and outgoing volume.

Manual matrix row:
- Weak behavior-only prior, `30-44`.

Manual score:
- `42 REVIEW`.

Reasoning:
- Unknown source plus mule-like sender role justifies review, but there is no source-policy or hard proof. It stays below `45` because the evidence is weak and partial.

Caveats:
- The score should not become a decline without source proof.

### 16. `TY8WacTAyj4PdYPGvtyzvZCJJx8AUepH7E`

Saved evidence:
- One incoming deposit job.
- Saved score `37 ACCEPTABLE`.
- Origin coverage is `0.0016`; provenance confidence `52`.
- Unknown/no-previous-transfer paths appear but account for effectively `0%` of checked-deposit source share.
- Warnings say weak amount/time continuity and partial coverage.

Manual matrix row:
- Coverage uncertainty / weak context, `30-44`.

Manual score:
- `35 INSUFFICIENT_EVIDENCE`.

Reasoning:
- The saved evidence is too weak to call clean, but also too weak to call suspicious beyond a low weak-context score.

Caveats:
- The role label is inconsistent with the operational-language reason; that inconsistency supports insufficient evidence rather than review.

### 17. `TR3aoPthSukgT3y2BMo5yCmk6i362rckJd`

Saved evidence:
- One incoming deposit job.
- Saved score `18 ACCEPTABLE`.
- Clean Bybit path covers `59%` of source share with provenance confidence `97`.
- Remaining share is uncovered/unknown; sender history has large unknown counterparty volume.

Manual matrix row:
- Clean/partial CEX context, `0-29`.

Manual score:
- `22 ACCEPTABLE`.

Reasoning:
- Majority clean CEX and high confidence keep this in acceptable territory. The unknown remainder raises the score inside the low band but does not create review by itself.

Caveats:
- If the uncovered remainder is material to the exact deposit amount, this should become insufficient evidence.

### 18. `TRZXXfghN8Q56RyKwfTniCd6TfjvcHGL7d`

Saved evidence:
- Two incoming deposit jobs.
- Latest saved score `52 ACCEPTABLE`; earlier `49 ACCEPTABLE`.
- Unknown contract/service boundary accounts for `87-100%` of checked-deposit source share.
- Approval-drain review finding exists, but exact drain provenance was not proven.
- Sender role is `mule`.

Manual matrix row:
- Unknown contract source exposure, `15-55`.

Manual score:
- `55 REVIEW`.

Reasoning:
- This is the top of the unknown-contract band: dominant share, mule-like sender, and approval-drain review hints. It still cannot cross `60` because exact drain/source proof is absent.

Caveats:
- This is a strong manual review candidate. Exact proof would reclassify it into `90+`.

### 19. `TKVZTQz94vu3gDehFQkzdwJ6uNYvzQuBQV`

Saved evidence:
- One incoming deposit job.
- Saved score `30 ACCEPTABLE`.
- Clean Bybit paths cover only about `10%`.
- Unknown/no-previous-transfer paths cover about `90%`.
- Provenance confidence is `36`; coverage is partial.

Manual matrix row:
- Coverage uncertainty / weak unknown-source context, `30-44`.

Manual score:
- `35 INSUFFICIENT_EVIDENCE`.

Reasoning:
- There is not enough clean coverage to accept, but no risky source proof to review as suspicious or decline.

Caveats:
- This is a data-quality outcome, not a negative AML finding.

### 20. `TAAvdgWLxVVRCZmFBVVRBkT8dRYHSqPaM9`

Saved evidence:
- One incoming deposit job.
- Saved score `34 ACCEPTABLE`.
- Clean Bybit source covers `23%`; unknown/no-previous-transfer covers `31%`.
- Result says clean source could not be proven and wallet did not match ordinary operational/liquidity pattern.

Manual matrix row:
- Weak behavior-only prior, `30-44`.

Manual score:
- `38 REVIEW`.

Reasoning:
- Partial clean source helps, but non-operational context and material unknown share make this a review case. It remains below `45` because source proof is absent.

Caveats:
- Better amount-level provenance is needed before a firmer decision.

### 21. `TWtc4tySWNs2XLpFrVw9jYz6TRZYN8CBX3`

Saved evidence:
- One incoming deposit job.
- Saved score `34 ACCEPTABLE`.
- Origin source is `100%` unknown/no-previous-transfer.
- Sender role is `collector`; provenance confidence is `24`.
- Coverage is partial.

Manual matrix row:
- Weak behavior-only prior, `30-44`.

Manual score:
- `40 REVIEW`.

Reasoning:
- Fully unknown source and weak confidence should not be accepted, but there is no risk proof for a higher score.

Caveats:
- The decision is review because the checked deposit is not source-proven.

### 22. `TKLNcQfvhynGfufehXV2dJDgKtfvnprBMa`

Saved evidence:
- One incoming deposit job.
- Saved score `34 ACCEPTABLE`.
- Origin source is `100%` unknown/no-previous-transfer.
- Sender role is `mule`; provenance confidence is `24`.
- Coverage is partial.

Manual matrix row:
- Weak behavior-only prior, `30-44`.

Manual score:
- `40 REVIEW`.

Reasoning:
- Same evidence shape as subject 21, with a more concerning role label. Still no source-policy or hard proof, so the score remains weak-context.

Caveats:
- This should not be auto-declined from role plus unknown source alone.

### 23. `TRWbRtwn8fht9HbePXc5XKwpjUBpQVBYnH`

Saved evidence:
- Two incoming deposit jobs.
- Latest saved score `30 ACCEPTABLE`.
- Latest clean Bybit share is only `6%`; older job has `89%` unknown/no-previous-transfer.
- Weak amount/time continuity and partial coverage warnings.

Manual matrix row:
- Coverage uncertainty / weak source context, `30-44`.

Manual score:
- `35 INSUFFICIENT_EVIDENCE`.

Reasoning:
- Saved evidence does not prove a risky source, but it also does not prove clean CEX origin for the checked amount.

Caveats:
- Old acceptable decision was too generous for the provenance quality.

### 24. `TGmgosh7Cq788gc8SWAeGYoUSonpB9gwTm`

Saved evidence:
- One incoming deposit job.
- Saved score `0 ACCEPTABLE`.
- Origin path reaches allowlisted Bybit with `100%` share and provenance confidence `97`.

Manual matrix row:
- Clean CEX source, `0-29`.

Manual score:
- `5 ACCEPTABLE`.

Reasoning:
- Clean deposit source with high confidence. A small non-zero score keeps the matrix consistent with clean CEX rows rather than implying mathematical zero risk.

Caveats:
- Deposit-scoped only.

### 25. `TUhBB36igAP3cbsvJqTWJD7p1skHjKJJXU`

Saved evidence:
- One incoming deposit job.
- Saved score `34 ACCEPTABLE`.
- Origin source is `100%` unknown/no-previous-transfer.
- Sender role is `mule`; provenance confidence is `24`.
- Coverage is partial.

Manual matrix row:
- Weak behavior-only prior, `30-44`.

Manual score:
- `40 REVIEW`.

Reasoning:
- Same pattern as subjects 21 and 22: unknown source plus mule-like role warrants review, but no decline-level evidence exists.

Caveats:
- Needs source-policy or exact path proof before it can cross `60`.

### 26. `TYksomCeBMM5TB1e56BxjnaJcFoGEUGtZL`

Saved evidence:
- Two incoming deposit jobs; one failed.
- Completed job saved `30 ACCEPTABLE`.
- Unknown/no-previous-transfer paths cover about `52%`.
- Provenance confidence `58`; weak continuity and partial coverage warnings.

Manual matrix row:
- Coverage uncertainty / weak context, `30-44`.

Manual score:
- `34 INSUFFICIENT_EVIDENCE`.

Reasoning:
- The checked deposit source is not cleanly proven, but the unknown share alone is not suspicious enough for review-level behavior scoring.

Caveats:
- Failed job is ignored as a risk signal, but it reinforces that evidence is incomplete.

### 27. `TWuNuWcZPG6GnZiPGAM381eYwZ2pLm8yzp`

Saved evidence:
- One incoming deposit job.
- Saved score `0 ACCEPTABLE`.
- Origin path reaches allowlisted Bybit with `100%` share and provenance confidence `100`.

Manual matrix row:
- Clean CEX source, `0-29`.

Manual score:
- `5 ACCEPTABLE`.

Reasoning:
- Clean source with full coverage. No hard, policy, service, or behavior risk evidence.

Caveats:
- Deposit-scoped only.

### 28. `TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC`

Saved evidence:
- One partial deep check and one where-is-money check.
- Where-is-money saved `45 DECLINE`.
- Origin paths include clean Binance/Bybit shares, but no exact drain provenance.
- Saved reason: approval-drain review findings exist, but exact benign or drain provenance was not proven.
- Deep behavior shows transit/deposit-drain context, but no hard or source-policy proof.

Manual matrix row:
- Same-amount/case-route prior without source proof, `45-55`.

Manual score:
- `45 REVIEW`.

Reasoning:
- Keeping the numeric score at `45` is fair: there is approval-drain review context, but it is not exact proof. The decision changes from `DECLINE` to `REVIEW` because Matrix v1 does not allow unproven approval-drain suspicion or coverage uncertainty to act like hard evidence.

Caveats:
- If approval-drain provenance is later proven, this should become `90+`. If clean CEX paths prove the relevant amount, it should drop below `30`.

### 29. `TJaXbx3S9wwQ5KKSkDgS63URwa4c6zqcC8`

Saved evidence:
- One deep check.
- `transferEdges=0`, `missing=0`.
- No inbound provenance, behavior, service exposure, or hard proof.

Manual matrix row:
- No meaningful saved risk evidence, `0-29`.

Manual score:
- `0 ACCEPTABLE`.

Reasoning:
- The saved job contains no transfer activity and no risk evidence. There is no basis for review or decline.

Caveats:
- This is only as good as the saved check scope.

### 30. `TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm`

Saved evidence:
- Three deep jobs, one failed and two partial.
- Partial jobs explicitly show `stablecoinRestriction ... blacklisted=true`.
- No final old score was saved.

Manual matrix row:
- Stablecoin blacklist/restriction, `95-100`.

Manual score:
- `100 DECLINE`.

Reasoning:
- Stablecoin restriction is deterministic hard proof. It is not dampened by partial coverage or lack of behavior/source provenance.

Caveats:
- None for risk scoring. Operationally, the blacklist source should be auditable and timestamped in production output.

### 31. `TUzXY779GY3Tm6UDRYDPqNEojZgZEpY127`

Saved evidence:
- One partial deep check.
- `transferEdges=448`, `missing=1`.
- Behavior transit `30`, deposit-drain `22`, dampener `30`.
- No hard proof, source-policy proof, inbound provenance, or service exposure.

Manual matrix row:
- Coverage uncertainty / weak behavior context, `30-44`.

Manual score:
- `32 INSUFFICIENT_EVIDENCE`.

Reasoning:
- Behavior-only context is weak and dampened. With no source proof, it cannot move into review-high or decline bands.

Caveats:
- More complete provenance could change the decision, but the saved evidence supports only insufficient evidence.

## Calibration Notes

The manual audit suggests four implementation changes for the future production scorer:

1. Separate `badness` from `uncertainty`.
   `insufficient_coverage`, `no_previous_transfer`, and low provenance confidence should produce `REVIEW` or `INSUFFICIENT_EVIDENCE`, not automatic high risk.

2. Use winner-row aggregation.
   Hard proof wins. Source-policy rows win over behavior. Behavior-only rows are capped below `60`. Clean/operational dampeners apply only to context rows.

3. Make unknown-contract handling explicit.
   Dominant unknown-contract source exposure belongs in `15-55`; it becomes `60+` only when combined with a clear risky source, exact drain proof, or service-linked laundering pattern.

4. Preserve decision reason separately from numeric score.
   `45 REVIEW` and `45 DECLINE` are not equivalent. The old system sometimes used the same number with a harsher policy decision than the evidence supports.

## Verification Notes

Manual coverage checklist:

- Unique subjects expected: 31.
- Unique subjects audited in summary table: 31.
- Detailed subject sections: 31.
- Order is newest to oldest by latest saved job timestamp.
- No production scoring code was changed.
