# Phase 10A.13 Implementation Plan: Deep Forensic Coverage Debug Report

> Source spec: `docs/research/2026-05-27-phase-10a13-deep-forensic-coverage-debug-report.md`

## Goal

Add a developer/admin debug report for deep forensic runs. The report must show what the job collected, what it analyzed, what it skipped, and why the final score did not include expected counterparties.

## Tasks

- [ ] Add a pure coverage debug module.
  - Build a `coverageDebug` object from deep run edges, classifications, labels, profiles, coverage, and missing checks.
  - Include summary fields and per-counterparty rows.
  - Support legacy jobs by synthesizing partial reports from `result_json`, `progress_json`, and `missingChecks`.

- [ ] Store coverage debug output in future deep job result JSON.
  - Add `coverageDebug` to `DeepAddressForensicReport`.
  - Include it in `forensic_check_jobs.result_json`.
  - Do not change risk scoring or derived label policy.

- [ ] Add read-only CLI.
  - Add `npm run forensic:debug`.
  - Support `--job <jobId>`.
  - Support `--address <address> --latest`.
  - Print summary and coverage table.
  - Write JSON artifact to `artifacts/forensic-debug/<jobId>.json`.

- [ ] Improve sparse wallet coverage.
  - Change deep job default fallback trigger to fewer than 60 transfers.
  - Keep fallback limit at latest 60 transfers.
  - Keep heavy expansion bounded by existing deep budgets.

- [ ] Verify with tests.
  - Unit test coverage debug rows and skipped reasons.
  - Unit test legacy partial report behavior.
  - Test sparse fallback default changes.
  - Test CLI argument/error behavior through pure helpers where possible.

## Acceptance Criteria

- `npm run forensic:debug -- --job <jobId>` prints a summary/table and writes an artifact.
- `npm run forensic:debug -- --address <address> --latest` resolves the latest job.
- Legacy jobs without `coverageDebug` do not crash.
- Sparse wallet fallback requests latest 60 transfers when the 30d transfer count is below 60.
- Existing `/check` risk scoring remains unchanged.
