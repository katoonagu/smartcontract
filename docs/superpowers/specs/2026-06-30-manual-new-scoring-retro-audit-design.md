# Manual New Scoring Retro Audit Design

Date: 2026-06-30

## Goal

Create a manual Codex research audit for every unique `subject_address` that has ever been saved in local `forensic_check_jobs`.

The audit compares old saved production scores with a fresh manual scoring judgment based on the new scoring research:

- `docs/research/2026-06-29-unified-scoring-research-review.md`
- `docs/research/2026-06-29-scoring-numeric-calibration-deep-research.md`

This is not a production rerun and does not execute a new scoring implementation. It is an analyst-style replay over saved evidence.

## Source Data

Primary source:

- local Postgres table `forensic_check_jobs`

Observed current scope during design:

- 73 saved forensic jobs;
- 31 unique `subject_address` values;
- job kinds include:
  - `address_fast_check`
  - `address_deep_check`
  - `where_is_money_check`
  - `incoming_deposit_check`

Subjects are ordered newest to oldest by latest saved job timestamp.

## Research Basis

This manual matrix is a policy scorecard, not a calibrated probability model.

Research constraints behind the matrix:

- Risk matrices can mis-rank risk when ordinal bins are treated as precise arithmetic. Use the matrix as a decision rubric, not as a free-form sum of all signals.
- AML scoring should control false positives and investigation burden. A `60+` score requires hard proof, source-policy proof, or service-linked/source-anchored pattern evidence.
- Calibration literature distinguishes ranking quality from probability quality. The manual score is not `P(bad)` until validated against historical labels with calibration tests.
- Scorecard/WOE practice supports monotonic, auditable feature buckets. Matrix rows should move monotonically with share, continuity, recency, and evidence strength.
- MCDA/AHP-style methods are useful only as expert-prior discipline. They do not make weights objective without backtesting.

Sources used for this basis:

- Cox, 2008, "What's Wrong with Risk Matrices?": https://pubmed.ncbi.nlm.nih.gov/18419665/
- Malik et al., 2026, actor-level AML queue evaluation: https://arxiv.org/abs/2604.23494
- Naser Eddin et al., 2021, AML alert optimization with graphs: https://arxiv.org/abs/2112.07508
- Gueneau et al., 2025, AML scoring with two thresholds and FDR control: https://arxiv.org/abs/2507.08835
- Calibration of ML classifiers for probability of default: https://arxiv.org/abs/1710.08901
- Reliability diagrams and calibration: https://arxiv.org/abs/2008.03033
- Bayesian and Dempster-Shafer evidence fusion in fraud detection: https://arxiv.org/abs/2104.07440

## Manual Scoring Rubric

Each subject receives a manual `newResearchScore` from 0 to 100 and a manual decision:

- `DECLINE`
- `REVIEW`
- `ACCEPTABLE`
- `INSUFFICIENT_EVIDENCE`

The manual score is assigned by the strongest evidence row, then adjusted inside that row's allowed band. Do not add every signal together.

### Score Classes

- `95-100`: deterministic blacklist, sanction, exact stablecoin restriction, or equivalent hard proof.
- `85-94`: exact scam/drain/taint proof or exact approval-drain provenance.
- `70-84`: strong source-policy or service-linked laundering pattern, not hard proof.
- `60-69`: decline-level policy exposure or strong source-anchored pattern.
- `45-59`: suspicious behavior/context, review candidate, behavior-only cap range.
- `30-44`: weak context, limited evidence, or partial suspicious pattern.
- `0-29`: low evidence of risk, clean/operational context, or no meaningful saved evidence.

### Evidence Classes

- `hard_proof`
- `source_policy`
- `service_linked_pattern`
- `behavior_only_prior`
- `case_route_prior`
- `coverage_uncertainty`
- `clean_or_operational_dampener`
- `insufficient_saved_evidence`

### Manual Scoring Matrix v1

| Evidence row | Manual score band | Decision default | Required saved evidence | Notes |
|---|---:|---|---|---|
| Stablecoin blacklist, sanction, exact restriction | `95-100` | `DECLINE` | explicit blacklist/restriction/sanction evidence on subject/sender/deposit source | Never dampen. |
| Exact approval-drain proof | `90-95` | `DECLINE` | exact approval + transfer-from/drain provenance, or equivalent exact approval-drain profile | Use `95` when amount/path proof is direct and recent; `90-94` when exact but context is less complete. |
| Direct hard risky label | `90-95` | `DECLINE` | direct scam, reported scam, stolen funds, phishing, risky contract, or equivalent exact subject label | Direct label beats behavior/context. |
| Exact high-risk inbound/extended provenance | `85-94` | `DECLINE` | exact labeled path from high-risk source with path evidence | Use higher end when continuity is high and path is short/recent. |
| Sanctioned service source-policy path | `90-100` | `DECLINE` | source-policy or origin path to sanctioned service | Treat as hard-like if path is exact; otherwise document policy proof level. |
| Mixer source-policy path | `78-95` | `DECLINE` if `>=60` | mixer exposure with source path/share | High end for dominant/high-continuity exposure; low end for weaker source-policy exposure. |
| No-name token liquidity source | `70-88` | `DECLINE` if `>=60` | no-name token liquidity source exposure | Source-policy proof, not direct scam proof. |
| HTX/Huobi source-policy exposure | `30-85` | `DECLINE` when `>=60` | saved source-policy evidence with share/continuity | `>=80%` share: `85`; `50-79%`: `78-82`; `30-49%`: `68-75`; `20-29%`: `60-68`; `10-19%`: `55`; `<10%`: `30-45`. |
| WhiteBIT source-policy exposure | `30-60` | `DECLINE` only at `60` | saved source-policy evidence with share/continuity | `>=50%`: `60`; `30-49%`: `55`; `10-29%`: `50`; `5-9%`: `38`; `<5%`: `30`. |
| Bridge/router/DEX/cross-chain source-policy | `10-78` | `DECLINE` when `>=60` | bridge/router/DEX/cross-chain source exposure with share/continuity | `>=80%`: `78`; `50-79%`: `70`; `20-49%`: `59` cap; `10-19%`: `45`; `5-9%`: `30`; `<5%`: `10-20`. |
| Unknown contract source exposure | `15-55` | `REVIEW` | unknown-contract source exposure | Never crosses `60` alone. Needs service-linked pattern or hard/source proof to decline. |
| Unknown CEX source exposure | `35-50` | `REVIEW` | unknown CEX source exposure | Context only unless combined with stronger evidence. |
| Service-linked transit pattern | `60-84` | `DECLINE` when source/service anchor is clear | high-volume pass-through with bridge/router/DEX/unknown-contract service share `>=20%` | Use `60-74` for adequate service-linked transit; `75-84` for dominant, high-continuity, high-volume transit. |
| Route-linked approval pattern | `60-80` | `DECLINE` or `REVIEW` depending proof level | route-linked approval-drain context without exact proof | Do not score as hard proof unless exact approval-drain evidence exists. |
| Asset continuation | `65-84` | `DECLINE` or `REVIEW` depending proof level | verified continuation across asset/chain with non-unknown token quality | Not hard proof unless tied to hard source. |
| Incoming deposit exact hard source | `90-100` | `DECLINE` | deposit amount traced to hard proof source or sender blacklist | Deposit-scoped score can be higher than sender wallet score. |
| Incoming deposit source-policy path | source-policy row band | `DECLINE` if row `>=60` | deposit amount path has source-policy evidence and coverage | Score the deposit amount, not only sender historical wallet behavior. |
| Same-amount fast pass-through case, no source proof | `45-55` | `REVIEW` | exact/near-exact amount exits quickly, but no risky source proof | Behavior-only case route prior; cannot cross `60`. |
| Extreme behavior-only wallet prior | `55-59` | `REVIEW` | no source proof, but multiple behavior features are strong | New/fresh wallet, top sender concentration `>=80%`, turnover `>=90%`, fast outgoing or high fanout. |
| Strong behavior-only wallet prior | `50-54` | `REVIEW` | no source proof, but high flow and pass-through behavior | High turnover or concentration, but not all extreme features. |
| Moderate behavior-only wallet prior | `45-49` | `REVIEW` | one or two suspicious behavior features | Example: high turnover only, or fast same-amount case only. |
| Weak context | `30-44` | `REVIEW` or `INSUFFICIENT_EVIDENCE` | weak/partial/stale suspicion | Use when evidence hints exist but cannot support a stronger row. |
| Clean/operational/no meaningful risk evidence | `0-29` | `ACCEPTABLE` or `INSUFFICIENT_EVIDENCE` | clean CEX, operational liquidity, or no saved risk evidence | Use `INSUFFICIENT_EVIDENCE` if lack of evidence is caused by poor coverage. |
| Coverage uncertainty | no direct risk score | `REVIEW` or `INSUFFICIENT_EVIDENCE` | partial/limited coverage, missing checks, stale evidence | Coverage is uncertainty, not badness. It can block `ACCEPTABLE`, but should not create `60+` by itself. |

### In-Band Modifiers

Use modifiers only to move inside the selected row's allowed band. They should not move a behavior-only row above `59`.

Path strength:

- direct path or 0 hops: move toward top of band;
- 1 hop: high within band;
- 2 hops: moderate-high within band;
- 3-5 hops: neutral/low within band;
- 6+ hops: move down unless continuity and timing are very strong.

Timing:

- `<=10 min`: move strongly up within band;
- `<=1 hour`: move up;
- `<=24 hours`: slight up;
- `<=7 days`: neutral;
- `>30 days`: move down or mark stale context.

Amount continuity:

- `>=95%`: move strongly up within band;
- `90-94%`: move up;
- `70-89%`: slight up;
- `40-69%`: move down;
- `<40%`: weak path unless other hard proof exists.

Share and dominance:

- `>=80%`: dominant exposure, use high end of source-policy band;
- `50-79%`: strong exposure, usually decline-level for risky source classes;
- `20-49%`: material exposure, often review/high-review unless source kind has a decline floor;
- `<20%`: context unless source kind is hard/non-dampenable.

Repetition:

- `>=4` independent similar paths: move up within band;
- `2-3` paths: slight up;
- single path: no repetition bonus.

Coverage and data quality:

- complete/high-confidence evidence: no penalty;
- partial evidence: use lower half of band and caveat;
- limited evidence: prefer `INSUFFICIENT_EVIDENCE` unless hard proof exists.

Dampeners:

- clean CEX-funded context: subtract `10-15` from context-only/behavior-only rows;
- operational liquidity context: subtract `8-12` from context-only/behavior-only rows;
- known service/hub context: subtract `10-20` from behavior/counterparty context when saved evidence supports service role;
- never dampen blacklist, sanction, exact drain, exact hard label, or non-dampenable source exposure.

### Aggregation Rules

Manual aggregation uses a winner-row model:

1. Identify the strongest evidence row by class and proof quality.
2. Place the score inside that row's band using path/share/timing/coverage modifiers.
3. Add secondary evidence only as an in-band nudge unless it creates a higher evidence class.
4. Multiple weak behavior/context signals cannot cross `60`.
5. Multiple source-policy rows can reinforce each other, but weak source-policy rows should saturate near `59` unless at least one row is decline-level.
6. Hard proof overrides all other rows.
7. Coverage uncertainty can block `ACCEPTABLE`, but does not create a high risk score alone.

### Decision Rules

- Hard proof cannot be dampened.
- Source-policy proof is separate from behavior.
- Service-linked transit can cross `60` only when saved evidence includes a service/source anchor.
- Behavior-only suspicion is capped below `60`.
- Coverage uncertainty does not mean badness; it creates review pressure or an insufficient-evidence note.
- Clean CEX or operational context can reduce context-only suspicion, not hard/source proof.
- `DECLINE`: score `>=60` and the winning row is hard proof, source policy, service-linked/source-anchored pattern, asset continuation with strong proof, or deposit-scoped hard/source evidence.
- `REVIEW`: score `30-59`, or score `>=60` with material uncertainty that prevents confident auto-decline.
- `ACCEPTABLE`: score `<30` with enough saved evidence to treat risk as low.
- `INSUFFICIENT_EVIDENCE`: saved evidence is too sparse/stale/partial to call the subject clean.

## Output

Create a markdown report:

`docs/research/2026-06-30-manual-new-scoring-retro-audit.md`

The report contains:

1. Executive summary.
2. Method and limitations.
3. Newest-to-oldest table for all unique subjects:
   - order;
   - subject address;
   - saved job count and job kinds;
   - latest saved production score/decision;
   - manual new score/decision;
   - score delta;
   - winning evidence class;
   - short reason.
4. Detailed per-subject audit:
   - saved evidence summary;
   - old score/decision summary;
   - manual scoring reasoning;
   - final manual score and decision;
   - caveats.

## Constraints

- Do not modify production scoring code.
- Do not run fresh Fast/Deep/Where checks for this pass.
- Do not treat the manual score as calibrated probability.
- Do not hide uncertainty when saved evidence is incomplete or stale.
- Keep old-vs-new comparison explicit, even when the old case is stale and comparison has limited relevance.

## Verification

Because this is documentation/research output, verification is:

- confirm the DB query returns the expected unique subjects;
- confirm every unique subject appears exactly once in the final report table;
- confirm the report is ordered newest to oldest;
- run `git diff --check` on the generated markdown files.
