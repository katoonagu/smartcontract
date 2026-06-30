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

## Manual Scoring Rubric

Each subject receives a manual `newResearchScore` from 0 to 100 and a manual decision:

- `DECLINE`
- `REVIEW`
- `ACCEPTABLE`
- `INSUFFICIENT_EVIDENCE`

Score classes:

- `95-100`: deterministic blacklist, sanction, exact stablecoin restriction, or equivalent hard proof.
- `85-94`: exact scam/drain/taint proof or exact approval-drain provenance.
- `70-84`: strong source-policy or service-linked laundering pattern, not hard proof.
- `60-69`: decline-level policy exposure or strong source-anchored pattern.
- `45-59`: suspicious behavior/context, review candidate, behavior-only cap range.
- `30-44`: weak context, limited evidence, or partial suspicious pattern.
- `0-29`: low evidence of risk, clean/operational context, or no meaningful saved evidence.

Evidence classes:

- `hard_proof`
- `source_policy`
- `service_linked_pattern`
- `behavior_only_prior`
- `coverage_uncertainty`
- `clean_or_operational_dampener`
- `insufficient_saved_evidence`

Manual rules:

- Hard proof cannot be dampened.
- Source-policy proof is separate from behavior.
- Service-linked transit can cross `60` only when saved evidence includes a service/source anchor.
- Behavior-only suspicion is capped below `60`.
- Coverage uncertainty does not mean badness; it creates review pressure or an insufficient-evidence note.
- Clean CEX or operational context can reduce context-only suspicion, not hard/source proof.

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
