---
status: current
last_verified: 2026-07-31
owner_area: docs
code_refs:
  - src/index.ts
  - src/bot/createBot.ts
  - src/forensics/deepForensicJob.ts
  - src/risk/fastEvidence.ts
  - src/risk/scoringSignalMatrixInputs.ts
  - src/tron/usdtBlacklistTimeline.ts
  - src/forensics/sanctionedServiceRegistry.ts
  - src/forensics/selectiveTransactionEnrichment.ts
  - src/forensics/forensicSlotPump.ts
  - src/forensics/adversePathDisposition.ts
  - src/unifiedCheck/providerHistoryCompletion.ts
  - src/unifiedCheck
  - docs/superpowers/specs/2026-07-26-unified-service-boundary-and-latency-design.md
  - docs/superpowers/specs/2026-07-28-correctness-stage-b-unified-latency-design.md
  - docs/superpowers/specs/2026-07-29-chronological-proportional-balance-provenance-design.md
  - docs/superpowers/specs/2026-07-29-service-boundary-sampling-amendment-design.md
  - docs/superpowers/specs/2026-07-30-subject-service-and-cashflow-query-amendment-design.md
  - docs/superpowers/specs/2026-07-30-forensic-model-completion-roadmap-and-exact-role-capture-design.md
  - docs/superpowers/plans/2026-07-28-authority-temporal-correctness-gate.md
  - docs/superpowers/plans/2026-07-28-stage-b-release-evidence-closure.md
  - docs/superpowers/plans/2026-07-29-lean-forensic-model-validation.md
---

# Current Roadmap

This page is the short current execution map. Detailed historical designs and
implementation plans do not override the status recorded here.

## Current Order

1. Keep legacy Where at concurrency 1; reopen Stage B rollout only when genuine
   replay, deployment, and attributable observation evidence exists.
2. Preserve the implemented provider-cap correctness patch. Keep the new
   adverse-path disposition pure/offline and unwired.
3. Preserve the admitted real Stage C evidence and Task 2 proof: one frozen
   `200/200` role map exists and the prerequisite audit passes, with no runtime
   hook.
4. Write and execute a separate plan for Stage C disabled runtime shadow with
   exact enabled/disabled byte non-interference. Only then freeze a separate
   blind set, complete two reviews, and adjudicate it without retuning the
   accepted version.
5. Keep the accepted 7/7 cashflow ledger foundation offline-only while a
   production-owned authority producer and a first `current_balance` selector
   are separately proven. Add cashflow runtime shadow only after real complete
   and unresolved controls exist.
6. Keep bounded subject-service mode, Stage D, production boundary action,
   canary, rollout and `500 + 100` outside the immediate plan. Reopen
   `500 + 100` only when a real frozen ambiguous case demonstrates the need;
   write the Stage D plan only after the Stage C shadow and blind gates.
7. Run the full post-model knowledge/code conformance cleanup; factual
   contradictions already proven are corrected immediately, not deferred.
8. Build recipient wallet precheck before signing or broadcasting.

Unified TQr latency is a separate diagnostic track. It is not Stage B release
evidence and does not change the order above.

## Production Routing

Production is currently split. Address `/check` uses Unified intake and
parent-only delivery while the active generation fence is `unified`.
Transaction `/check` plus independent or pre-existing legacy Where, Deep, and
Incoming work retain their legacy lifecycle. The delivery fence prevents both
paths from owning automatic output for the same chat/address pair.

## Status

| Area | Current state | Next acceptance boundary |
|---|---|---|
| Correctness gate | Complete; four authority/temporal defects closed without historical recalculation | Preserve the gate while later stages add evidence or policy |
| Provider-cap correctness | Implemented in the current tree: `provider_range_capped` no longer becomes account creation; old cached pages without the completion reason fail closed | Preserve focused regression coverage; do not reuse the `10 000` provider sentinel as product policy |
| Adverse path disposition | Pure `provenance-adverse-terminal-matrix-v1` classification is implemented offline and has no production imports or routing | Keep unwired until caller evidence contracts, frozen fixtures and explicit integration policy are accepted |
| Stage A | Code-complete; user default remains V1 | Isolated V2 replay/canary and a separate default decision |
| Stage B | Runtime/evidence tooling complete; real PostgreSQL gate passed; genuine replay/deployment/observer evidence unavailable; repository default remains 1 | Park rollout at 1; reopen only when the missing real evidence exists |
| Ordinary wallet-check contract | Target subject, direct-neighbor, second-hop, cashflow, adverse-disposition and service-boundary responsibilities are recorded in `02-check-modes.md`; current production does not yet implement that contract | Validate the cashflow/service pieces offline without assigning the contract to Fast or changing traversal |
| Bounded subject-service mode | Design-only; current production still expands every direct subject event and every non-terminal frontier address; `SUBJECT_EVENT_CAP` is unapproved | Freeze explicit selection/cap policy and canonical positive/negative fixtures before an implementation plan |
| Cashflow Query Selector | No shared production selector; legacy `<1000` recent-flow, exact Incoming deposit, and the offline ledger executor remain separate paths | Freeze a first `current_balance`-only selector with typed unavailable semantics; keep completed exact episode, triggered relevance and amount-only expansion outside V1 |
| Forensic query/provenance model | The accepted cashflow ledger slice executes exactly 7/7 and remains offline-only. Real PacGy remains non-authoritative and unresolved; its synthetic calibration is separate. Accepted address history still lacks authoritative transaction order, opening balance and an independent pinned USDT balance witness | Prove a production-owned canonical-tape-or-unavailable producer, then freeze the first `current_balance` selector before any runtime shadow plan |
| Stage C | Real evidence admission and preserved Task 2 proof are complete: the frozen accepted history has one exact `200/200` role map, the prerequisite audit exits `0`, and the standalone artifacts have zero accepted-attempt references. No runtime hook exists | Write a separate disabled-shadow plan and prove enabled/disabled byte non-interference before blind review |
| Stage D | Design-only and explicitly outside the immediate plan | Reconsider only after offline validation and blind review; write a separate disabled-by-default V3 plan if accepted |
| Knowledge conformance cleanup | Focused provider-cap, adverse-disposition and recorded-evidence corrections are documented; repository-wide conformance remains incomplete | Compare every current knowledge claim with code and accepted artifacts after the new model stages, then remove stale/historical duplication |
| Unified TQr latency | Live V1/barrier/capacity-1 expansion observed | Separate V2/rolling/boundary measurements without treating TQr as terminal |
| Post A-D product | Not started | Recipient precheck design |

## Cashflow Shadow Foundation — 2026-07-30

The independently adjudicated ledger group executes exactly 7/7 frozen cases.
The accepted non-synthetic PacGy tape is parsed and consumed, but produces
`unresolved` / `history_incomplete_before_anchor` with
`authoritative: false`. The separate synthetic zero-opening control remains a
calibration result and cannot promote the real tape. This foundation is
offline-only and authorizes no production runtime or integration.

The remaining blockers are:

- accepted production sampling;
- upstream authority acquisition that supplies canonical tapes or typed
  unavailable envelopes without deriving them from reports;
- safe legacy-neutral immutable storage for unreferenced artifacts.

## Lean Offline Model Gate Baseline — 2026-07-30

The pre-foundation deterministic read-only runner measured 37 cases: 7 ledger,
24 service, 6 adverse and no broad-scope cases. Eight cases matched their frozen
expectations. The gate failed with exit code 1 and reported 29
`frozen_expectation_not_replayed` mismatches, not converted into passes. Of
those, 27 replay results have `state: expectation_level`. The other two are the
real PacGy result, which is `state: unresolved` with
`reason: history_incomplete` and retains an unreplayed nested current-balance
expectation, and the blacklist timeline result, whose nested per-transfer
temporal expectations remain unreplayed. Four honest data gaps remain in the
output. Two runs produced identical 11,958-byte stdout
(`sha256:6ddce2ac4814f5cd9a6f5e38359662c63c706004feea7f31af4b133323adb109`)
and empty stderr.

Evidence limits remain explicit:

- recorded calibration vectors are not exact frozen-row/provider-page replay;
- the D7NzP control is sparse predicate-only evidence and is not a complete
  service-window replay;
- VUSXVhd remains `insufficient_data` because its recent window is short and
  its historical baseline is empty;
- the real PacGy chronology remains `history_incomplete`; the synthetic
  zero-opening arithmetic control cannot promote it;
- normalized locked provider rows retain the design-only limitation
  `raw_provider_assertion_not_replayed`.

Verification on this tree passed:

- `npm test -- tests/forensics/offlineForensicModelReplay.test.ts`: 155 tests;
- `npm run typecheck`;
- `npm test -- tests/forensics/offlineForensicModelReplay.test.ts tests/forensics/directHardEvidence.test.ts tests/forensics/contractDrivenEvidence.test.ts tests/forensics/approvalDrainProvenance.test.ts tests/forensics/verify20Fingerprint.test.ts tests/forensics/gasFreeSettlement.test.ts tests/unified-check/labelCatalog.test.ts tests/unified-check/providerServiceBindings.test.ts`:
  374 tests across the full eight-file authority gate;
- `npm test -- tests/forensics/tronAddressAllTimeIndex.test.ts tests/unified-check/directHistory.test.ts tests/golden-v2/attribution.test.ts`: 33 tests;
- `npm test`: 5,106 passed and 157 skipped across 288 passed and 27 skipped
  test files;
- the runner's runtime import graph was traversed with the TypeScript compiler
  AST, including runtime re-exports, import-equals and literal dynamic imports,
  while excluding type-only edges; all local runtime edges resolved and the
  graph excluded production paths;
- `git diff --check`.

The PowerShell recipe below records a deterministic capture from the repository
root. The numeric baseline that follows it is historical evidence for tree
`b6c0f74dcd11119f62ba93923a2fec209d6f36e3`; reproduce those exact bytes only
from that tree. `Start-Process -PassThru` records the expected nonzero CLI exits
without turning exit code 1 into a script abort. Base64 encoding is used only to
compare the two raw byte arrays exactly; the files themselves are not decoded
or line-normalized before the comparison or hash calculation.

```powershell
$replayTemp = Join-Path ([IO.Path]::GetTempPath()) ("forensic-replay-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $replayTemp | Out-Null
$stdout1 = Join-Path $replayTemp "stdout-1.json"
$stdout2 = Join-Path $replayTemp "stdout-2.json"
$stderr1 = Join-Path $replayTemp "stderr-1.txt"
$stderr2 = Join-Path $replayTemp "stderr-2.txt"
$nodePath = (Get-Command node).Source
$replayArgs = @("--import", "tsx", "scripts/replayForensicModelCorpus.ts")
$run1 = Start-Process -FilePath $nodePath -ArgumentList $replayArgs -WorkingDirectory (Get-Location).Path -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdout1 -RedirectStandardError $stderr1
$run2 = Start-Process -FilePath $nodePath -ArgumentList $replayArgs -WorkingDirectory (Get-Location).Path -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdout2 -RedirectStandardError $stderr2
$report = Get-Content -Raw -Encoding UTF8 $stdout1 | ConvertFrom-Json
$caseResults = @($report.result.ledgerCases) + @($report.result.serviceCases) + @($report.result.adverseCases) + @($report.result.broadScopeCases)
$joined = foreach ($mismatch in $report.expectationMismatches) {
  $case = $caseResults | Where-Object id -eq $mismatch.caseId | Select-Object -First 1
  [pscustomobject]@{ CaseId = $mismatch.caseId; Code = $mismatch.code; ResultState = $case.state; Reason = $case.reason }
}
[pscustomobject]@{
  TempDirectory = $replayTemp
  Exit1 = $run1.ExitCode
  Exit2 = $run2.ExitCode
  ByteIdentical = [Convert]::ToBase64String([IO.File]::ReadAllBytes($stdout1)) -ceq [Convert]::ToBase64String([IO.File]::ReadAllBytes($stdout2))
  Stdout1Bytes = (Get-Item -LiteralPath $stdout1).Length
  Stdout2Bytes = (Get-Item -LiteralPath $stdout2).Length
  Stdout1Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $stdout1).Hash.ToLowerInvariant()
  Stdout2Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $stdout2).Hash.ToLowerInvariant()
  Stderr1Bytes = (Get-Item -LiteralPath $stderr1).Length
  Stderr2Bytes = (Get-Item -LiteralPath $stderr2).Length
  FrozenExpectationNotReplayed = @($joined | Where-Object Code -eq "frozen_expectation_not_replayed").Count
  ExpectationLevelResults = @($joined | Where-Object ResultState -eq "expectation_level").Count
  OtherUnreplayedResults = @($joined | Where-Object ResultState -ne "expectation_level").Count
  Matched = $caseResults.Count - $joined.Count
  DataGaps = @($report.result.dataGaps).Count
} | Format-List
$joined | Where-Object ResultState -ne "expectation_level" | Format-Table CaseId, ResultState, Reason -AutoSize
```

Historical stable output on
`b6c0f74dcd11119f62ba93923a2fec209d6f36e3`, apart from the unique
temporary-directory name:
`Exit1: 1`, `Exit2: 1`, `ByteIdentical: True`, both stdout lengths
`11958`, both stdout SHA-256 values
`6ddce2ac4814f5cd9a6f5e38359662c63c706004feea7f31af4b133323adb109`,
both stderr lengths `0`, `FrozenExpectationNotReplayed: 29`,
`ExpectationLevelResults: 27`, `OtherUnreplayedResults: 2`, `Matched: 8`
and `DataGaps: 4`. The final table contains
`pacgy-recorded-chronology` with `unresolved` / `history_incomplete` and
`event-time-blacklist-partitions` with no `state` or `reason` field in that
typed result.

On the current Cashflow Foundation plus Stage C offline integration tree, the
same default runner remains deterministically fail-closed: both runs exit `1`,
stdout is byte-identical at `12334` bytes with SHA-256
`372e7b64f97ba02bbc58db431af1db73eac57465ceec5e8946f9daef6239a9e8`, stderr
is empty, `22` expectations are not replayed, `21` of those remain
`expectation_level`, `1` is another unresolved result, `15` cases match, and
there are `4` data gaps. The separate ledger-only gate passes `7/7`; the real
PacGy case remains `unresolved` / `history_incomplete_before_anchor`.

This is no production activation. Stage D remains deferred and not approved;
production routing, scoring, traversal, configuration and delivery are
unchanged.

## Stage C Real Evidence Admission — 2026-07-31

The frozen run `5417cbf6-7cef-4b91-8367-d266eaf3857e`, accepted
address-history manifest
`08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0`,
and anchor `2026-06-04T09:20:33.000Z` now have one exact completed capture and
one real `200/200` role map. Capture manifest
`3549712030d464a8b76a81c78000ba860e9065aa553f15a265ce6dda9c3a00d4`,
receipt
`f73237add53aa53baef87ddf86f5b8188fad90706879fc93ab22a916816a8d04`,
evidence bundle
`f84498b1f3098789233486ddd1135a3cfb708d3baff0c375fcc6a926f3270974`,
and role map
`6f5e219e16b49e3e7434763a5647104125823dd6cc1367972578b1f45056fa40`
revalidate without missing events or conflicts. All 200 roles are `ordinary`.

The prerequisite audit exits `0` with
`fullyRoleBoundHistories=1` and `roleBoundSampledEvents=200`. These are
standalone offline artifacts referenced by zero accepted attempts. Production
runtime/config paths remain byte-unmodified from the pre-plan baseline. Real
evidence admission and the preserved Task 2 prerequisite are complete; Stage C
runtime shadow is the next separate design/plan and remains disabled.

## Correctness Gate

The authority and event-time correctness gate is complete. Historical results
were not recalculated. Implementation landed as four independent fixes, one
compatibility gate, and focused cross-chain authority follow-ups:

- approval authority: [`5f7021768eb5cc941d6758379f6e8e7052bbaa35`](https://github.com/katoonagu/smartcontract/commit/5f7021768eb5cc941d6758379f6e8e7052bbaa35);
- semantic blacklist declarations: [`b926cea227bc38c7378e32e4d79079e071218550`](https://github.com/katoonagu/smartcontract/commit/b926cea227bc38c7378e32e4d79079e071218550);
- blacklist event-time active subset: [`99ed99e38f6a55a38906781de913fa45152485d7`](https://github.com/katoonagu/smartcontract/commit/99ed99e38f6a55a38906781de913fa45152485d7);
- sanctions tri-state and local evidence binding: [`a8370d1d8ea79c1f31537c1cb14fa6db9c448e9c`](https://github.com/katoonagu/smartcontract/commit/a8370d1d8ea79c1f31537c1cb14fa6db9c448e9c);
- legacy compatibility gate: [`d3a4f1b0b7e9d964df6b7bca71b937bb66290f28`](https://github.com/katoonagu/smartcontract/commit/d3a4f1b0b7e9d964df6b7bca71b937bb66290f28);
- typed cross-chain sanctions authority: [`a169d6f11ca358dd9a51d2416b6a25e018c5e163`](https://github.com/katoonagu/smartcontract/commit/a169d6f11ca358dd9a51d2416b6a25e018c5e163),
  preserving separate exact corridor authority without authorizing colliding
  local sanctions artifacts;
- typed cross-chain sanctions score: [`e0d011bcaf43b47a2cf83628d4ff5a8a0fa29702`](https://github.com/katoonagu/smartcontract/commit/e0d011bcaf43b47a2cf83628d4ff5a8a0fa29702),
  retaining the validated decline score for that exact typed corridor while
  local artifacts remain isolated.

Verification passed: the combined targeted suite (`1,690` tests), Golden V2
verification (`24` tests; locked manifest
`4d1f2568d3676cf1ee2e4411bc70e056d1f6fc80997b2919e3da4705811cb407`),
the production comparator contract (`8` tests), typecheck, the full suite
(`4,942` passed, `157` skipped), and the forbidden-shortcut audit. Skipped
PostgreSQL-gated tests in that run were not PostgreSQL proof; the separate
Stage B dedicated PostgreSQL gate below now closes that one evidence item while
the replay, deployment, canary, Deep, and observer blockers remain open.

## Stage B Release Closure

Stage B is the legacy Where/selective-enrichment track. Its runtime core and
replay/canary client contracts are present, but production Where concurrency
two is not accepted. Evidence-tooling hardening landed in `6bf24285` and merged
through `8bbbbc00`: PostgreSQL `Date` handling, read-only capture dependencies,
safe assertion/endpoint projection, configured-secret rejection, disposal,
create-only caller-bound canary output, canonical readers, and evidence binding
are covered by 92 targeted tests. Combined master passed 4,951 tests and
typecheck.

The real PostgreSQL gate is also complete: the dedicated `tron_watch_plan3`
database verified schema 037 and passed four migration plus 168
claim/fairness/evidence/delivery tests without skips. The replay gate remains
blocked for two independent reasons. The configured schema-037 database has no
completed TXc legacy Where job/report, and exact recorder `6bf24285` is not on
the approved historical behavior tree. A direct historical backport lacks the
later execution `dispose` and replay-schema contracts; baseline hashes and
behavior files were not weakened. The repository and all available
worktrees/refs also lack the deployment-owned bridge/server, tracked adapter,
cycle-isolated composition, deployment receipt builder, and attributable
observer required for canary and rollout proof.

Required capabilities and evidence:

- a reviewed historical-recorder identity that preserves the approved behavior
  tree while satisfying the hardened recorder contract;
- a genuine completed TXc legacy Where job followed by a checked-in replay tape
  and passing strict replay;
- an approved deployment path supplying the immutable bridge, tracked adapter, cycle
  composition and deployment receipt required by the trusted canary CLI;
- dedicated isolated canary deployment and clone;
- accepted concurrency-two Where receipt plus a create-only binding manifest
  tying it to the trusted CLI, combined candidate and deployment artifact;
- separate Deep singleton residual receipt with its own canonical binding
  manifest and Deep deployment/config identity;
- a separately reviewed attributable/cycle-isolated observer and canonical
  manifest writer installed and validated before any production trial;
- attributable before/after provider-error, 429, and delivery observation
  produced during that trial. Current process-global endpoint logs alone are
  insufficient.

Replay, deployment integration, the Where canary and the Deep receipt, plus
observer readiness proof, are required before a separately
approved reversible production trial at Where 2. The attributable before/after
observation produced by that trial then decides whether it remains 2 or is
restored to 1. If deployment or attribution capabilities remain absent, the
official decision is to keep 1 and open a separate reviewed integration design.
Deep remains 1 throughout. Shared production state must not be altered to
manufacture a canary.

## Unified TQr Latency

The 2026-07-28 `/check TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP` observation was a
Unified authoritative run on `snapshot-closure-v1`, `global_barrier`, and
provider capacity ceiling 1. Direct history completed quickly; mandatory
neighbor histories expanded the traversal. Healthy providers and current
heartbeats ruled out a simple provider outage or frozen lease at observation
time.

This delay is not caused by legacy Stage B. TQr is also a mandatory negative
inferred-boundary case: reconstructed Stage C must produce
`estimatedWouldAction=continue_full`; any exact-page profile must produce
authoritative `wouldAction=continue_full`, and Stage D must never make the
subject terminal. Savings may come from exact event-time-valid boundaries or
separately adjudicated intermediate nodes, not by classifying TQr itself as a
service boundary.

## Non-Blocking Maintenance Queue

These changes are useful but do not block the product sequence:

- retire only confirmed finished worktrees and avoid duplicated dependencies
  in inactive worktrees;
- add an app-only inner-loop typecheck while retaining the full release check;
- define explicit ignore/retention policy for generated `outputs/` and raw CSV;
- perform a deletion-first pass over test-only dead modules;
- deepen shared claim/provider-failure seams only where repeated production
  behavior proves the boundary.

Do not split large files merely to reduce line counts.

## Detailed Design

The current approved designs are in
`docs/superpowers/specs/2026-07-28-correctness-stage-b-unified-latency-design.md`,
`docs/superpowers/specs/2026-07-26-unified-service-boundary-and-latency-design.md`,
`docs/superpowers/specs/2026-07-29-chronological-proportional-balance-provenance-design.md`,
and
`docs/superpowers/specs/2026-07-29-service-boundary-sampling-amendment-design.md`.
The bounded checked-subject and missing cashflow-query-selector gaps are
corrected without activation in
`docs/superpowers/specs/2026-07-30-subject-service-and-cashflow-query-amendment-design.md`.
The completed correctness and Stage B work is split into
`docs/superpowers/plans/2026-07-28-authority-temporal-correctness-gate.md` and
`docs/superpowers/plans/2026-07-28-stage-b-release-evidence-closure.md`.
The 2026-07-29 manual gate and remaining authority gaps are recorded in
`docs/superpowers/verification/2026-07-29-forensic-model-manual-corpus-replay.md`.
Their first implementation slice is intentionally limited by
`docs/superpowers/plans/2026-07-29-lean-forensic-model-validation.md` to frozen
offline fixtures, pure functions, exact evidence reuse and tests. Production
routing remains unchanged; Stage D and `500 + 100` are not part of that plan.
