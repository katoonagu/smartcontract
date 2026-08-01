# Product Modes

## 1. What This Section Is And Why It Matters

This section checks the boundaries between product modes.

The question is simple: does the system still treat fast check, DeepCheck,
Where is money, Incoming deposit, and unified `/check` as separate answers to
separate questions?

This matters because the rest of the audit depends on these boundaries. If the
modes are mixed up, later sections will judge data coverage, jobs, scoring, and
UX against the wrong promise.

## 2. Product Promise

Each mode has its own job.

- Fast check asks: are there obvious wallet risk signals right now?
- DeepCheck asks: what is the wider forensic profile of this wallet?
- Where is money asks: where did the relevant funds come from?
- Incoming deposit asks: can we trust this concrete incoming deposit?
- Unified `/check` composes address-level signals from fast, deep, and Where.

Unified `/check` is not a replacement for the separate jobs. It is a final
composition layer for the user-facing address check.

## 3. Current Behavior

The code matches the product model.

For address `/check`, the bot first runs a fast snapshot. Then it queues Where
and Deep jobs. The fast result is saved as a terminal `address_fast_check` job;
it is not claimed by the worker queue.

Where, Deep, and Incoming are queued jobs with separate kinds:

- `where_is_money_check`;
- `address_deep_check`;
- `incoming_deposit_check`.

The background workers claim those jobs by kind. Where and Deep share runner
infrastructure, but they branch by job kind and answer different questions.

Incoming deposit starts from one deposit transaction. It builds an incoming
deposit report, uses Where logic for the sender funding path, and then computes
incoming-deposit risk. It is not the same as a wallet biography.

Unified wallet risk is a composition layer. Its layers are explicitly `fast`,
`deep`, and `where`; it is not a separate queueable job kind.

One naming caveat: `deepForensicJob.ts` now acts as shared job-runner
infrastructure for Where and Deep. That file name can confuse readers, but it
does not collapse the product modes.

## 4. Verification And Confidence

Confidence: test-backed for the product-mode boundary.

Checked:

- knowledge docs for the product promise;
- job kind definitions and queue rules;
- bot `/check` routing;
- Where, Deep, Incoming, and unified-risk entry points;
- focused tests for mode behavior and queue boundaries.

Commands run:

```powershell
npm test -- tests/check/whereIsMoneyCheck.test.ts tests/check/deepForensicCheck.test.ts tests/forensics/incomingDepositJob.test.ts tests/risk/unifiedWalletRisk.test.ts
```

Result:

```text
4 test files passed
221 tests passed
```

```powershell
npm test -- tests/check/manualCheck.test.ts tests/storage/forensicCheckJobs.test.ts tests/bot/createBot.test.ts
```

Result:

```text
3 test files passed
184 tests passed
```

Not checked in this section:

- live Admin;
- live Telegram;
- live database jobs.

Those belong to later UX and job-lifecycle sections.

## 5. What Works And Should Stay

The mode boundaries should stay as they are.

Fast check stays fast and direct. It does not pretend to prove money origin.

Where and Deep stay separate. Where explains source of funds. DeepCheck builds
profile and context. That distinction is product-critical.

Unified `/check` should also stay a composition layer. Turning it into another
full mode would blur the same boundaries the docs are trying to protect.

## 6. Problems, Risks, And Known Gaps

No new product-mode finding was found in this pilot.

Known adjacent gaps:

- Incoming deposit still lacks the shared resumable targeted-indexing flow that
  ordinary Where now has.
- DeepCheck second-layer work is still partial/planned in the documented path.

These are real project gaps, but they are not failures of the product-mode
boundary itself. They should be handled in the relevant later audit sections.

Risk for future work: agents may describe the product as one "full provenance
mode" and erase the distinction between questions. The current docs already
record this as a repeated agent mistake.

## 7. Improvement Ideas

Later documentation can make the shared runner clearer:

- explain that `deepForensicJob.ts` runs both Where and Deep job paths;
- add a compact table: `mode -> user question -> job kind -> worker -> surface`.

This is not a product-code change and does not block the audit.

## 8. Section Verdict

Verdict: healthy with known adjacent gaps.

No new P0/P1 findings.

Recommended ledger decision: `leave as-is` for mode separation.

Known adjacent gaps should be referenced, not filed as new findings in this
section.

## 9. Open Confirmation

Before finalizing this pilot into a broader audit pass, confirm:

- product-mode separation is recorded as `leave as-is`;
- no new findings are opened from this section;
- Incoming resumable indexing and DeepCheck second-layer remain known adjacent
  gaps for later sections.

## Evidence Appendix

Docs read:

- `docs/knowledge/AGENT_BRIEF.md`;
- `docs/knowledge/00-index.md`;
- `docs/knowledge/02-check-modes.md`;
- `docs/knowledge/09-current-decisions.md`;
- `docs/knowledge/10-open-problems.md`;
- `docs/knowledge/12-runbooks.md`;
- `docs/knowledge/13-agent-observations.md`.

Code anchors:

- `src/bot/createBot.ts`: address `/check`, fast snapshot, queue Where and Deep.
- `src/storage/repositories.ts`: forensic job kinds, fast check terminal save,
  queue exclusion for `address_fast_check`.
- `src/index.ts`: separate polling for Where, Deep, and Incoming jobs.
- `src/forensics/deepForensicJob.ts`: shared Where and Deep job runner.
- `src/forensics/incomingDepositJob.ts`: incoming deposit report and unified
  incoming risk.
- `src/risk/unifiedWalletRisk.ts`: unified address-risk composition layers.
- `src/check/manualCheck.ts` and `src/risk/evaluation.ts`: fast snapshot risk.
