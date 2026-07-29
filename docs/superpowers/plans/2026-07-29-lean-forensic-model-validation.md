# Lean Forensic Model Offline Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove or reject the chronological cashflow and `100 + 100` service-role models on frozen evidence before any production integration.

**Architecture:** Add two pure, versioned forensic functions and one typed offline replay core. A thin CLI reads one checked-in corpus and prints deterministic JSON. Existing exact label, blacklist, GasFree and drainer functions are reused as facts; no traversal, score, database, provider or delivery code is changed.

**Tech Stack:** TypeScript, bigint integer arithmetic, Node.js standard library, Vitest, existing project forensic modules.

---

## Fixed Scope

The target wallet-check contract is in `docs/knowledge/02-check-modes.md`.
This plan validates only the two new decision primitives and their composition
with frozen exact evidence. It does not implement that complete traversal.

Add exactly these implementation and fixture files:

- `src/forensics/chronologicalProportionalLedger.ts`
- `src/forensics/serviceBehaviorResearch.ts`
- `src/forensics/offlineForensicModelReplay.ts`
- `tests/fixtures/forensics/forensic-model-offline-corpus-v1.json`
- `tests/forensics/offlineForensicModelReplay.test.ts`
- `scripts/replayForensicModelCorpus.ts`

After verification, modify only `docs/knowledge/14-current-roadmap.md` to
record the actual offline result. Do not claim production activation.

Do not modify `package.json`, `src/index.ts`, Unified traversal, legacy checks,
the scoring matrix, database code, jobs, migrations, Telegram/Admin, runtime
configuration or provider clients.

The first slice also excludes:

- Fast Check ownership or behavior;
- PostgreSQL and live API calls;
- production routing, snapshot closure or terminal decisions;
- Stage D, canary and rollout;
- `500 recent + 100 historical`;
- report lifecycle, request-identity upgrades and sidecar investigations;
- checkpoint or guessed opening-balance support;
- GasFree compound-settlement cashflow and its atomic allocation matrix;
- a new probability, confidence percentage or AML score.

An incomplete or non-high `100 + 100` result is only a research result. It
does not suppress traversal. Actual boundary action remains Stage D.

## Acceptance Summary

- Every ledger calculation uses raw integer USDT units and conserves value.
- JSON fixtures and replay output encode every raw amount as a canonical
  unsigned decimal string; bigint never reaches JSON serialization directly.
- Canonical order is `blockNumber -> transactionIndex -> eventIndex`; timestamp
  and provider row order never break ties.
- The first ledger accepts only proven genesis-complete history with zero
  opening inventory. Any partial history is typed `unresolved`; current-balance
  queries additionally require a pinned independent balance witness.
- Exact duplicates collapse; conflicting identity or unprovable order returns
  typed `unresolved`, not a guessed answer.
- The isolated zero-opening `300 -> 70 -> 12 -> 180 -> 38` control gives 100%
  target coverage for 180 and 60% utilization of its 300 source lot. The real
  `…PacGy` rows stay unresolved unless the frozen corpus proves opening
  inventory and history completeness; the arithmetic control is not promoted
  into real attribution.
- Both service windows contain at most two physical pages / 100 physical rows.
  Dedupe never tops a window back up.
- The service predicate is exactly `C AND B AND G AND (H OR R OR X)` in both
  windows. It classifies role only, never risk.
- `…W8SRL` is a positive recorded-vector control; `…D7NzP` and `…SH14eaf`
  remain negative; `…VUSXVhd` remains insufficient. Extreme controls ending
  `…98cdn` and `…aEGqTr` exercise `X`.
- Exact Binance authority bypasses inferred-role classification. Event-time
  HTX and blacklist facts remain adverse inventory. A method name alone is not
  drainer proof; the accepted exact fingerprint plus successful matching USDT
  movement is.
- Two identical CLI runs produce byte-identical stdout and perform no writes.

## Task 1: Freeze One Honest Corpus

**Files:**

- Create: `tests/fixtures/forensics/forensic-model-offline-corpus-v1.json`
- Create: `tests/forensics/offlineForensicModelReplay.test.ts`

- [ ] Create a single schema-versioned corpus with three top-level groups:
  `ledgerCases`, `serviceCases`, and `adverseCases`.
- [ ] Store every `amountRaw` as an unsigned decimal string and reject signs,
  fractions, exponent notation and leading zeroes other than the value `0`.
- [ ] Every case must declare one evidence class:
  `exact_frozen_rows`, `recorded_calibration_vector`, or `synthetic_edge_case`.
- [ ] Copy exact rows and hashes from already captured evidence. Never recreate
  missing provider bytes and label them exact.
- [ ] Record `…W8SRL` as `recorded_calibration_vector`: its measured two-window
  vector is valid for classifier calibration, but its missing raw provider
  pages are not authoritative page replay.
- [ ] Record the 21 unique CSV controls with their observed vectors or exact
  frozen rows and source metadata. The CSV directory is not a runtime input.
- [ ] Freeze the `…PacGy` chronology containing 300 incoming USDT followed by
  70, 12, 180 and 38 outgoing, plus the later 82.7 incoming. Bind both provider
  aliases of the duplicated 180 row to one receipt-derived transaction/log
  identity; synthetic provider `event_index` values are not canonical proof.
- [ ] Mark real `…PacGy` history completeness as unproven unless the fixture
  contains exact exhaustion plus a zero-opening witness. Its expected
  authoritative result is otherwise `history_incomplete`. Add the same amount
  sequence separately as a labeled synthetic zero-opening arithmetic control.
- [ ] Keep any live 82.7 balance observation as `diagnostic_non_pinned`; it
  cannot prove snapshot reconciliation, so that real current-balance query is
  expected to stay unresolved in this corpus.
- [ ] Add small, explicitly synthetic cases only for integer remainder,
  self-transfer, identity collision, missing order and debit-over-inventory.
- [ ] Freeze adverse fixtures for exact Binance/HTX labels, event-time blacklist
  partitions, GasFree fee/principal classification and method-only versus
  complete drainer evidence. GasFree is not a ledger execution case in v1.

Start the test with schema and honesty assertions:

```ts
expect(corpus.schemaVersion).toBe("forensic-model-offline-corpus-v1");
expect(corpus.serviceCases.find((item) => item.address.endsWith("W8SRL"))?.evidenceClass)
  .toBe("recorded_calibration_vector");
expect(corpus.serviceCases.every((item) => item.evidenceClass !== "exact_frozen_rows" || item.rawEvidenceRef))
  .toBe(true);
```

- [ ] Keep this first test fixture-only and run it before importing any new
  implementation module:

```powershell
npm test -- tests/forensics/offlineForensicModelReplay.test.ts
```

- [ ] Confirm the fixture honesty checks pass, then commit:

```powershell
git add tests/fixtures/forensics/forensic-model-offline-corpus-v1.json tests/forensics/offlineForensicModelReplay.test.ts
git commit -m "test: freeze lean forensic model corpus"
```

## Task 2: Implement Canonical Integer Cashflow

**Files:**

- Create: `src/forensics/chronologicalProportionalLedger.ts`
- Modify: `tests/forensics/offlineForensicModelReplay.test.ts`

- [ ] Define a deliberately small public API:

```ts
export type LedgerEventV1 = {
  canonicalEventId: string | null;
  providerEventIds: readonly string[];
  txHash: string;
  blockNumber: number;
  transactionIndex: number | null;
  eventIndex: number | null;
  eventIndexAuthority: "receipt_log_index" | "provider_synthetic";
  occurredAtMs: number;
  fromAddress: string;
  toAddress: string;
  amountRaw: bigint;
};

export function canonicalizeChronologicalLedgerEventsV1(events: readonly LedgerEventV1[]): CanonicalizationResultV1;
export function apportionRawLargestRemainderV1(targetRaw: bigint, capacities: readonly LedgerLotV1[]): AllocationV1[];
export function runChronologicalProportionalLedgerV1(input: LedgerInputV1): LedgerResultV1;
export function selectLedgerProvenanceV1(input: LedgerQueryV1): LedgerSelectionV1;
```

- [ ] Add the ledger assertions first, run the focused test, and confirm the
  missing exports make it fail. Then implement only the behavior below.

- [ ] Canonicalize only by receipt-derived transaction/log identity. Preserve
  every provider ID as an alias. Equal canonical identity and equal payload is
  one event; equal identity with different payload is `identity_collision`;
  only synthetic provider indices produce `identity_unresolved`.
- [ ] Sort only by `blockNumber`, `transactionIndex`, and `eventIndex`. If two
  relevant events in one block cannot be ordered because transaction index is
  missing, return `order_unresolved`. Do not use timestamps or hash order.
- [ ] Treat an exact `fromAddress === toAddress` transfer as a no-op.
- [ ] Accept only `historyCompleteness="genesis_complete"` with zero opening
  inventory. Return `history_incomplete` for a partial history; do not infer an
  opening balance or add checkpoint support in this slice.
- [ ] Never merge different addresses as one owner without an exact ownership
  fact. The offline core has no heuristic ownership clustering.
- [ ] An external incoming creates one lot. An external outgoing consumes all
  then-open lots proportionally to their remaining raw capacity.
- [ ] Allocate floor shares first, then assign remaining raw units by largest
  fractional remainder; break exact ties by canonical lot ID.
- [ ] If an outgoing amount exceeds inventory, return
  `debit_exceeds_inventory` with the unresolved raw amount and invalidate the
  whole affected ledger state; earlier partial allocations are diagnostic and
  cannot be published as an authoritative selection.
- [ ] Preserve the consumption vector for every outgoing event. Implement
  `current_balance`, `amount_only`, and `exact_episode` as projections of the
  same replay, not three cashflow algorithms.
- [ ] Require a pinned independent snapshot-balance witness for
  `current_balance` and `amount_only`, and require it to equal reconstructed
  remaining inventory. A missing or mismatching witness returns unresolved.
  `exact_episode` uses its exact event anchor and does not borrow a live balance.
- [ ] Make `95%` a query-selection boundary only. It may choose ordinary deep
  contributors, but a supplied exact-red contributor is always retained.

Add deterministic loop-based property checks; do not add a dependency:

```ts
for (let seed = 1; seed <= 200; seed += 1) {
  const result = runDeterministicLedgerCase(seed);
  expect(result.totalIncomingRaw).toBe(result.totalOutgoingRaw + result.remainingRaw);
  expect(result.allocations.every((item) => item.amountRaw >= 0n)).toBe(true);
}
```

- [ ] Assert the zero-opening arithmetic control has target coverage `180/180`
  and source-lot utilization `180/300`; do not call the latter 60% coverage.
  Assert the real `…PacGy` case remains unresolved when its opening authority
  is absent.
- [ ] Assert permutation invariance, exact dedupe, collision failure, stable
  largest-remainder ties, self-transfer no-op and overdraw unresolved.
- [ ] Run:

```powershell
npm test -- tests/forensics/offlineForensicModelReplay.test.ts
npm run typecheck
```

- [ ] Commit:

```powershell
git add src/forensics/chronologicalProportionalLedger.ts tests/forensics/offlineForensicModelReplay.test.ts
git commit -m "feat: add offline chronological cashflow ledger"
```

## Task 3: Implement the Pure `100 + 100` Classifier

**Files:**

- Create: `src/forensics/serviceBehaviorResearch.ts`
- Modify: `tests/forensics/offlineForensicModelReplay.test.ts`

- [ ] Expose only research data and predicates:

```ts
export function computeServiceWindowVectorV2(rows: readonly ServiceBehaviorRowV2[]): ServiceWindowVectorV2;
export function evaluateServiceWindowPredicateV2(vector: ServiceWindowVectorV2): ServiceWindowPredicatesV2;
export function classifyServiceBehavior100Plus100V2(input: {
  recent: ServiceWindowVectorV2;
  historical: ServiceWindowVectorV2;
  exactRoleConflict: boolean;
}): ServiceBehaviorResultV2;
```

- [ ] Preserve physical row count separately from canonical event count. Read
  at most 100 physical rows per window and never request or synthesize top-up.
- [ ] Exclude invalid/collision, poisoning-only and exact GasFree fee rows from
  positive behavior features. Preserve them in inventory. GasFree principal
  remains an ordinary eligible USDT movement.
- [ ] If incoming and outgoing counts tie, set dominant direction to `null`;
  then `C`, `R`, and `X` are false. This avoids a positive vote from an
  arbitrary tie-break.
- [ ] Use count of all feature-eligible events as the denominator for largest
  counterparty share. Do not use transferred value or only the dominant side.
- [ ] Implement every threshold with integers:

```text
C: dominant >= 20 AND (median gap <= 120s OR hourly max >= 15)
B: counterparties >= 25 AND counterparties*5 >= eligible
   AND largest-counterparty-count*2 <= eligible
G: (dominant*10 >= eligible*7 AND dominant counterparties >= 20)
   OR (unique senders >= 10 AND unique recipients >= 10)
H: distinct UTC hour-of-day values >= 12
R: repeated exact raw amount >= 10 AND repeated*10 >= dominant
X: dominant >= 80 AND dominant*10 >= eligible*8
   AND dominant counterparties >= 80
   AND (median gap <= 15s OR hourly max >= 80)
P: C AND B AND G AND (H OR R OR X)
```

- [ ] Compare an even-length median without floating point by comparing the
  sum of the two central gaps against twice the threshold.
- [ ] Require both independent windows to pass `P`. Missing order, fewer than
  100 canonical events after fixed-page dedupe, temporal overlap or missing
  seven-day separation returns `insufficient_data`.
- [ ] Limit outputs to raw vectors, `C/B/G/H/R/X`, and one of
  `high_inferred_service`, `non_service_profile`, `insufficient_data`, or
  `role_conflict`. Do not add `wouldAction`, `boundaryEligible` or score.
- [ ] Do not implement an expanded window. A non-high result stays non-high;
  later evidence may justify a separate `500 + 100` change.
- [ ] Add inclusive-threshold and one-unit-below tests for every predicate,
  two-window enforcement, fixed-page dedupe, row permutation and negative
  feature exclusions.
- [ ] Assert the named real controls and all remaining calibration controls.

- [ ] Run:

```powershell
npm test -- tests/forensics/offlineForensicModelReplay.test.ts
npm run typecheck
```

- [ ] Commit:

```powershell
git add src/forensics/serviceBehaviorResearch.ts tests/forensics/offlineForensicModelReplay.test.ts
git commit -m "feat: add offline service behavior classifier"
```

## Task 4: Compose Existing Exact Evidence Offline

**Files:**

- Create: `src/forensics/offlineForensicModelReplay.ts`
- Modify: `tests/forensics/offlineForensicModelReplay.test.ts`

- [ ] Add one typed replay function. It accepts parsed fixture data and returns
  canonical facts; it performs no file, network, database or environment I/O.

```ts
export function replayOfflineForensicModelCorpusV1(corpus: OfflineCorpusV1): OfflineReplayResultV1;
export function evaluateExactDrainerSceneV1(input: ExactDrainerSceneInputV1): ExactDrainerSceneResultV1;
```

- [ ] Parse raw amount strings to bigint only at the replay boundary and map
  every bigint result back to canonical decimal strings before returning the
  JSON-safe replay result.

- [ ] Reuse exact service authority through
  `decideTronScanProviderServiceAssertion`, `buildFrozenLabelRecord`, and
  `resolveFrozenLabelAtEventV1`. Do not use `classifyServiceAddress` as
  authority.
- [ ] Reuse blacklist handling through `groupDirectPrincipalCounterparties`
  and `partitionPrincipalTransfersByBlacklistTimeline`. Keep
  `active_at_event`, `before_event`, and `unknown` distinct.
- [ ] Reuse `extractGasFreeSettlement` / `isGasFreeServiceFeeEdge` only for
  evidence inventory and service-feature eligibility. Never remove the
  principal AML path, but do not run a compound GasFree settlement through the
  v1 ledger; its atomic allocation matrix is a separate change.
- [ ] Reuse `detectVerify20Fingerprint`, then add one small typed
  `evaluateExactDrainerSceneV1` predicate in this offline module. One occurrence
  is red only when the full fingerprint is unblocked, the exact relevant call
  is confirmed and successful, and its USDT movement matches token,
  `from/to/amount`, transaction and receiver. Reverted/unconfirmed calls,
  mismatched movement, trusted-service guard and method name alone remain
  context rather than red.
- [ ] Do not import `contractDrivenEvidence` or `approvalDrainProvenance` into
  the new replay core: their current transitive route-scoring dependency is
  outside this lean slice. Keep their existing tests in the regression gate.
- [ ] Build an evidence inventory, not a risk score. Do not use
  `buildDirectHardEvidenceSnapshots().hasHardEvidence` as a clean/red gate: it
  mixes service labels, materiality and a 250-address limit.
- [ ] For the frozen broad-scope cases, assert that every unique direct
  counterparty is represented in the shallow probe in both transfer
  directions, and exact second-hop red branches are retained. Do not build a
  crawler or mutate a frontier.
- [ ] Exact Binance role bypasses the inferred classifier. Exact HTX may be
  both a service role and an adverse fact. A later label cannot be applied to
  an earlier event.
- [ ] Assert that a red contributor outside the ordinary 95% cashflow set is
  still present in the replay result.

- [ ] Run focused tests for the new composition and reused authorities:

```powershell
npm test -- `
  tests/forensics/offlineForensicModelReplay.test.ts `
  tests/forensics/directHardEvidence.test.ts `
  tests/forensics/contractDrivenEvidence.test.ts `
  tests/forensics/approvalDrainProvenance.test.ts `
  tests/forensics/verify20Fingerprint.test.ts `
  tests/forensics/gasFreeSettlement.test.ts `
  tests/unified-check/labelCatalog.test.ts `
  tests/unified-check/providerServiceBindings.test.ts
npm run typecheck
```

- [ ] Commit:

```powershell
git add src/forensics/offlineForensicModelReplay.ts tests/forensics/offlineForensicModelReplay.test.ts
git commit -m "test: compose forensic models on frozen evidence"
```

## Task 5: Add One Read-Only Corpus Runner

**Files:**

- Create: `scripts/replayForensicModelCorpus.ts`
- Modify: `tests/forensics/offlineForensicModelReplay.test.ts`
- Modify: `docs/knowledge/14-current-roadmap.md`

- [ ] Implement a thin CLI using only `node:fs/promises`, argument validation,
  JSON parsing, `replayOfflineForensicModelCorpusV1`, and canonical JSON output.
- [ ] Accept exactly one optional `--fixture <path>` argument, defaulting to the
  checked-in corpus. Reject unknown flags and unknown schema versions.
- [ ] Write only to stdout/stderr. Do not write artifacts or read secrets.
- [ ] Sort semantic arrays by their explicit IDs, then serialize the JSON-safe
  result with the existing `canonicalizeArtifactJson`. Two executions on the
  same fixture must be byte-identical.
- [ ] Print evidence class beside every case so a recorded vector cannot be
  mistaken for exact raw replay.
- [ ] Exit nonzero when an actual result differs from the frozen expectation.
- [ ] Add a CLI smoke test and an import-boundary test proving the new files do
  not directly or transitively import `config`, `tronClient`, repositories,
  jobs, bot, route scoring or Unified production runtime.

Run the CLI twice and compare bytes:

```powershell
node --import tsx scripts/replayForensicModelCorpus.ts > $env:TEMP\forensic-replay-1.json
node --import tsx scripts/replayForensicModelCorpus.ts > $env:TEMP\forensic-replay-2.json
Compare-Object (Get-Content -Raw $env:TEMP\forensic-replay-1.json) (Get-Content -Raw $env:TEMP\forensic-replay-2.json)
```

Expected: exit code 0 and no `Compare-Object` output.

- [ ] Run the complete validation gate:

```powershell
npm test -- tests/forensics/offlineForensicModelReplay.test.ts
npm run typecheck
npm test -- `
  tests/forensics/tronAddressAllTimeIndex.test.ts `
  tests/unified-check/directHistory.test.ts `
  tests/golden-v2/attribution.test.ts
npm test
git diff --check
```

- [ ] Inspect `git diff --stat` and imports. The implementation must contain no
  Stage D action, `500 + 100`, DB/provider/bot dependency or scoring change.
- [ ] Update only the roadmap status with the measured pass/fail result, exact
  command evidence and the still-deferred production decision.
- [ ] Commit:

```powershell
git add scripts/replayForensicModelCorpus.ts tests/forensics/offlineForensicModelReplay.test.ts docs/knowledge/14-current-roadmap.md
git commit -m "test: add deterministic forensic corpus runner"
```

## Stop Condition

Stop after the offline gate and report the corpus result. Do not turn a
positive replay into production wiring in the same change. The next decision
is one of:

1. reject or revise a model because a frozen control failed;
2. accept the pure model and write a separate production integration plan;
3. collect a real ambiguous service case before considering `500 + 100`.
