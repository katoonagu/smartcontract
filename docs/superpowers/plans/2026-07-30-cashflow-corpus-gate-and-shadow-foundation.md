# Cashflow Corpus Gate And Shadow Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all seven chronological-ledger corpus cases executable, independently freeze/adjudicate one real canonical tape, and implement a JSON-safe tape parser plus deterministic pure shadow-artifact foundation.

**Architecture:** This plan has no production integration. It consumes pre-existing independently reviewed source bytes and a pre-accepted non-synthetic tape, splits ledger replay out of oversized mixed files, validates unknown JSON before bigint conversion, and produces only an in-memory content-addressed diagnostic. It ends at mandatory approval; production config, callbacks, persistence, and job integration require a separate future plan after accepted evidence proves safe runtime authority and storage seams.

**Tech Stack:** TypeScript, bigint after validation only, Node.js standard library, Vitest, existing `src/forensics/canonicalJson.ts`. No dependency, DB, migration, job, Admin, Unified, Stage C/D, canary, or activation work.

---

## Current Truth And Scope

Prepared against HEAD `d6113b066bb933b785793c2950dac5db329b4953` on 2026-07-30.

- `npm.cmd test -- tests/forensics/offlineForensicModelReplay.test.ts` passes `155/155`.
- `node --import tsx scripts/replayForensicModelCorpus.ts` exits `1`; stdout is `11,958` bytes with SHA-256 `6ddce2ac4814f5cd9a6f5e38359662c63c706004feea7f31af4b133323adb109`; stderr is empty.
- Full corpus: `37` cases, `29` mismatches, `4` data gaps. Ledger is `0/7`: six `expectation_level`, real PacGy `unresolved/history_incomplete`.
- `src/forensics/chronologicalProportionalLedger.ts:1-544` is pure, accepts bigint, accepts zero `amount_only`, and exposes internal reasons.
- `src/types.ts:321-369` has no transaction index; `src/forensics/tronAddressAllTimeIndex.ts:292-336` may hash-derive event index. Legacy reports/index rows are not canonical tapes.
- `insertUnifiedArtifact()` at `src/unifiedCheck/repository.ts:644-680` is bound by `migrations/033_unified_wallet_check.sql:96-103` to a Unified run. It is not a safe generic artifact seam.
- The mixed replay module is `1,317` lines and its test is `3,672` lines; new ledger ownership is split out.

The synthetic `300 -> 70 -> 12 -> 180 -> 38` control proves only:

```text
target coverage         = 180 / 180 = 100%
source-lot utilization  = 180 / 300 = 60%
```

It is never real `...PacGy` evidence. The real case stays unresolved unless independently accepted history/opening/order/balance evidence actually satisfies the parser and ledger.

Included:

- exact seven-case replay inputs and normalized expected actual JSON;
- pre-existing receipt/tape hash and commit-chain verification;
- JSON-safe canonical tape with raw amounts as decimal strings;
- unknown-to-typed envelope parsing, tamper checks, and post-validation bigint materialization;
- exhaustive internal-to-public reason mapping, positive `amount_only`, deterministic in-memory shadow artifact;
- independent adjudication, exact knowledge updates, mandatory approval stop.

Excluded:

- `src/config.ts`, `src/index.ts`, jobs, callbacks, `resultJson`, reports, Admin, indexing, persistence, DB/migrations, Unified, bot/Telegram/risk;
- current selector/traversal replacement, checkpoint/derived opening, recursive hops, GasFree matrix, ownership, 95%-funder/adverse policy, Stage C/D;
- production policy, rollout, canary, activation, or default flip.

## File Responsibilities

Pre-existing external prerequisites, never created or edited by the implementation worker:

- `tests/fixtures/forensics/authority/pacgy-180-full-node-receipt-v1.json` — raw provider bytes.
- `docs/superpowers/verification/2026-07-30-pacgy-source-review.json` — independently recorded source SHA/commit/reviewer decision.
- `tests/fixtures/forensics/authority/pacgy-canonical-tape-v1.json` — candidate non-synthetic JSON-safe tape.
- `docs/superpowers/verification/2026-07-30-pacgy-canonical-tape-acceptance.json` — independent tape/source hashes and commit-chain acceptance.

Created:

- `src/forensics/chronologicalLedgerCorpusReplay.ts` — seven-case replay/normalization only.
- `src/forensics/cashflowCanonicalTape.ts` — JSON schema types, unknown parser, hash validation, bigint materialization, reason mapper.
- `src/forensics/cashflowShadowArtifact.ts` — repository-independent in-memory artifact builder.
- `tests/fixtures/forensics/loadForensicModelCorpus.ts` — typed corpus loader.
- `tests/forensics/chronologicalLedgerCorpusReplay.test.ts` — exactly seven cases.
- `tests/forensics/chronologicalProportionalLedger.test.ts` — moved ledger tests.
- `tests/forensics/cashflowCanonicalTape.test.ts` — accepted real tape, invalid/tamper/materialization tests.
- `tests/forensics/cashflowShadowArtifact.test.ts` — unavailable/determinism/reason tests.
- `docs/superpowers/verification/2026-07-30-cashflow-foundation-adjudication.md` — independent final review.

Modified:

- `tests/fixtures/forensics/forensic-model-offline-corpus-v1.json`
- `src/forensics/offlineForensicModelReplay.ts:253-375,1256-1317`
- `tests/forensics/offlineForensicModelReplay.test.ts:1-180,1450-2100`
- `scripts/replayForensicModelCorpus.ts:26-332`
- `src/forensics/chronologicalProportionalLedger.ts:90-108,466-510`
- `docs/knowledge/09-current-decisions.md` and `docs/knowledge/14-current-roadmap.md` after adjudication only.

Explicitly untouched: `docs/knowledge/10-open-problems.md` and `13-agent-observations.md` (already user-dirty), all production/runtime/storage/UI paths listed in Excluded.

## Task 0: Prove The Plan And Authority Prerequisites

**Files:** no changes.

- [ ] **Step 1: Define checked Git/path helpers in one PowerShell session**

```powershell
function Invoke-GitChecked([string[]]$Arguments, [string]$ErrorCode) {
  & git @Arguments
  if ($LASTEXITCODE -ne 0) { throw $ErrorCode }
}
function Get-GitTextChecked([string[]]$Arguments, [string]$ErrorCode) {
  $value = & git @Arguments
  if ($LASTEXITCODE -ne 0) { throw $ErrorCode }
  return @($value)
}
function Get-GitScalarChecked([string[]]$Arguments, [string]$ErrorCode) { return ((Get-GitTextChecked $Arguments $ErrorCode) -join '').Trim() }
$repoLines = Get-GitTextChecked @('rev-parse', '--show-toplevel') 'cashflow_not_in_git_repo'
$repo = [IO.Path]::GetFullPath(($repoLines -join '').Trim())
function Assert-TrackedCleanInsideRepo([string]$Path) {
  $resolved = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path)
  if (!$resolved.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "cashflow_path_outside_repo:$Path"
  }
  Invoke-GitChecked @('ls-files', '--error-unmatch', '--', $Path) "cashflow_file_untracked:$Path"
  Invoke-GitChecked @('diff', '--exit-code', 'HEAD', '--', $Path) "cashflow_file_dirty:$Path"
}
function Assert-Commit([string]$Commit) { Invoke-GitChecked @('cat-file', '-e', "$Commit`^{commit}") "cashflow_commit_missing:$Commit" }
function Assert-EmptyIndex {
  $cached = Get-GitTextChecked @('diff', '--cached', '--name-only') 'cashflow_index_read_failed'
  if ($cached.Count -gt 0) { $cached; throw 'cashflow_index_not_empty' }
}
```

- [ ] **Step 2: Require the renamed plan and all authority records tracked, clean, and inside the repository**

```powershell
$required = @('docs/superpowers/plans/2026-07-30-cashflow-corpus-gate-and-shadow-foundation.md','tests/fixtures/forensics/authority/pacgy-180-full-node-receipt-v1.json','docs/superpowers/verification/2026-07-30-pacgy-source-review.json','tests/fixtures/forensics/authority/pacgy-canonical-tape-v1.json','docs/superpowers/verification/2026-07-30-pacgy-canonical-tape-acceptance.json')
foreach ($path in $required) { Assert-TrackedCleanInsideRepo $path }
Assert-EmptyIndex
```

Expected today: stop if any prerequisite is absent/untracked/dirty. This planning turn does not create evidence or commit the plan.

- [ ] **Step 3: Verify source and tape hashes plus independent commit chain**

```powershell
$sourcePath = $required[1]; $sourceReviewPath = $required[2]; $tapePath = $required[3]; $acceptancePath = $required[4]
$sourceReview = Get-Content -Raw -Encoding UTF8 $sourceReviewPath | ConvertFrom-Json; $acceptance = Get-Content -Raw -Encoding UTF8 $acceptancePath | ConvertFrom-Json
if ($sourceReview.decision -ne 'accepted' -or !$sourceReview.reviewer) { throw 'cashflow_source_not_accepted' }
if ($acceptance.decision -ne 'accepted' -or !$acceptance.reviewer) { throw 'cashflow_tape_not_accepted' }
if ($sourceReview.sourceArtifactPath -ne $sourcePath -or $acceptance.tapeArtifactPath -ne $tapePath) { throw 'cashflow_authority_path_mismatch' }
$sourceSha = (Get-FileHash -Algorithm SHA256 $sourcePath).Hash.ToLowerInvariant(); $tapeFileSha = (Get-FileHash -Algorithm SHA256 $tapePath).Hash.ToLowerInvariant()
if ($sourceSha -ne $sourceReview.sourceSha256 -or $sourceSha -ne $acceptance.sourceSha256) { throw 'cashflow_source_hash_mismatch' }
if ($tapeFileSha -ne $acceptance.tapeFileSha256) { throw 'cashflow_tape_file_hash_mismatch' }
Assert-Commit $sourceReview.sourceCommit; Assert-Commit $acceptance.sourceReviewCommit; Assert-Commit $acceptance.tapeCommit
$sourceCommit = Get-GitScalarChecked @('log', '-1', '--format=%H', '--', $sourcePath) 'cashflow_source_commit_read_failed'; $sourceReviewCommit = Get-GitScalarChecked @('log', '-1', '--format=%H', '--', $sourceReviewPath) 'cashflow_source_review_commit_read_failed'
$tapeCommit = Get-GitScalarChecked @('log', '-1', '--format=%H', '--', $tapePath) 'cashflow_tape_commit_read_failed'; $acceptanceCommit = Get-GitScalarChecked @('log', '-1', '--format=%H', '--', $acceptancePath) 'cashflow_acceptance_commit_read_failed'
if ($sourceCommit -ne $sourceReview.sourceCommit -or $sourceReviewCommit -ne $acceptance.sourceReviewCommit -or $tapeCommit -ne $acceptance.tapeCommit) { throw 'cashflow_authority_commit_binding_mismatch' }
Invoke-GitChecked @('merge-base', '--is-ancestor', $sourceCommit, $sourceReviewCommit) 'cashflow_source_review_chain_invalid'
Invoke-GitChecked @('merge-base', '--is-ancestor', $sourceReviewCommit, $acceptanceCommit) 'cashflow_acceptance_source_chain_invalid'
Invoke-GitChecked @('merge-base', '--is-ancestor', $tapeCommit, $acceptanceCommit) 'cashflow_acceptance_tape_chain_invalid'
if ($sourceCommit -eq $sourceReviewCommit -or $tapeCommit -eq $acceptanceCommit) { throw 'cashflow_review_not_independent' }
```

- [ ] **Step 4: Require clean implementation/docs scope and reproduce the red baseline**

```powershell
$scope = @('tests/fixtures/forensics/forensic-model-offline-corpus-v1.json','src/forensics/offlineForensicModelReplay.ts','tests/forensics/offlineForensicModelReplay.test.ts','scripts/replayForensicModelCorpus.ts','src/forensics/chronologicalProportionalLedger.ts','docs/knowledge/09-current-decisions.md','docs/knowledge/14-current-roadmap.md')
foreach ($path in $scope) { Assert-TrackedCleanInsideRepo $path }
node --import tsx scripts/replayForensicModelCorpus.ts
if ($LASTEXITCODE -ne 1) { throw 'cashflow_red_baseline_exit_changed' }
```

Expected: the exact current counts/hash above. Otherwise stop and revise measured truth.

## Task 1: Make The Seven-Case Ledger Corpus Executable

**Files:** corpus replay/loader/tests and mixed-file delegation listed above.

- [ ] **Step 1: Add failing exact seven-case test**

```ts
export type LedgerCorpusActualV1 = {
  state: "complete" | "unresolved" | "not_applicable";
  reason: "canonical_event_identity_unresolved" | "temporal_order_unresolved" |
    "history_incomplete_before_anchor" | "outgoing_exceeds_reconstructed_inventory" | null;
  authoritative: boolean;
  targetRaw: string;
  coveredRaw: string;
  allocations: readonly {
    lotId: string; sourceEventId: string; sourceAddress: string;
    usedAmountRaw: string; sourceOriginalRaw: string;
  }[];
};
export type ForensicModelOfflineCorpusV1 = OfflineCorpusV1 & { schemaVersion: "forensic-model-offline-corpus-v1" }; export function loadForensicModelOfflineCorpusV1(): ForensicModelOfflineCorpusV1;
export function replayChronologicalLedgerCorpusV1(corpus: Pick<ForensicModelOfflineCorpusV1, "ledgerCases">): {
  caseResults: readonly { caseId: string; actual: LedgerCorpusActualV1 }[];
  mismatches: readonly { caseId: string; code: "ledger_expectation_mismatch" | "ledger_expectation_invalid" }[];
};

const replay = replayChronologicalLedgerCorpusV1(loadForensicModelOfflineCorpusV1());
expect(replay.caseResults).toHaveLength(7);
expect(replay.mismatches).toEqual([]);
```

Run `npm.cmd test -- tests/forensics/chronologicalLedgerCorpusReplay.test.ts`.
Expected: FAIL with all seven IDs before implementation.

- [ ] **Step 2: Use complete synthetic fields and exact case inputs**

```ts
function syntheticEvent(txHash: string, blockNumber: number, fromAddress: string, toAddress: string, amountRaw: bigint, transactionIndex: number | null = 0): LedgerEventV1 {
  return {
    canonicalEventId: null, providerEventIds: [`synthetic:${txHash}`], txHash,
    blockNumber, transactionIndex, eventIndex: 0, eventIndexAuthority: "receipt_log_index",
    occurredAtMs: blockNumber * 1_000, fromAddress, toAddress, amountRaw
  };
}
```

Synthetic defaults: subject `subject`, snapshot block `99`, hash `synthetic-block-99`, evidence `synthetic:snapshot:99`, `genesis_complete`, opening `0`. Inputs:

```text
debit-over: in-10@1 funder->subject 10; out-11@2 subject->sink 11; exact_episode out-11 amount 11
self: in-10@1 funder->subject 10; self-7@2 subject->subject 7; current_balance; pinned independent witness 10
identity: shared@1 funder->subject 5 and shared@1 funder->subject 7; amount_only 1
remainder: in-a@1 a->subject 1; in-b@2 b->subject 2; out-2@3 subject->sink 2; exact_episode out-2 amount 2
missing-order: in-10@10 funder->subject 10 txIndex null; out-8@10 subject->sink 8 txIndex null; exact_episode out-8 amount 8
synthetic-PacGy: in-300@1 old->subject 300000000; out-70@2 70000000; out-12@3 12000000; out-180@4 180000000; out-38@5 38000000; in-82-7@6 new->subject 82700000; exact_episode out-180 amount 180000000
real-PacGy: subject `recorded:PacGy`; snapshot block 83711746; hash `unavailable:not-authoritative`; evidence ref to the tape acceptance; partial history; opening 0 inert sentinel; events `[]`; exact_episode receipt:676a97390c99f997e3c9af9a57e8c684c7b6253710e8b009950f73b8b25fe7ca:0 amount 180000000; this executes the unresolved branch and never constructs chronology from the recorded vector
```

- [ ] **Step 3: Freeze every normalized expected actual JSON object**

```json
[
  {"caseId":"debit-over-inventory-control","actual":{"state":"unresolved","reason":"outgoing_exceeds_reconstructed_inventory","authoritative":false,"targetRaw":"0","coveredRaw":"0","allocations":[]}},
  {"caseId":"exact-self-transfer-control","actual":{"state":"complete","reason":null,"authoritative":true,"targetRaw":"10","coveredRaw":"10","allocations":[{"lotId":"receipt:in-10:0","sourceEventId":"receipt:in-10:0","sourceAddress":"funder","usedAmountRaw":"10","sourceOriginalRaw":"10"}]}},
  {"caseId":"identity-collision-control","actual":{"state":"unresolved","reason":"canonical_event_identity_unresolved","authoritative":false,"targetRaw":"0","coveredRaw":"0","allocations":[]}},
  {"caseId":"integer-remainder-control","actual":{"state":"complete","reason":null,"authoritative":true,"targetRaw":"2","coveredRaw":"2","allocations":[{"lotId":"receipt:in-a:0","sourceEventId":"receipt:in-a:0","sourceAddress":"a","usedAmountRaw":"1","sourceOriginalRaw":"1"},{"lotId":"receipt:in-b:0","sourceEventId":"receipt:in-b:0","sourceAddress":"b","usedAmountRaw":"1","sourceOriginalRaw":"2"}]}},
  {"caseId":"missing-order-control","actual":{"state":"unresolved","reason":"temporal_order_unresolved","authoritative":false,"targetRaw":"0","coveredRaw":"0","allocations":[]}},
  {"caseId":"pacgy-recorded-chronology","actual":{"state":"unresolved","reason":"history_incomplete_before_anchor","authoritative":false,"targetRaw":"0","coveredRaw":"0","allocations":[]}},
  {"caseId":"pacgy-synthetic-zero-opening-control","actual":{"state":"complete","reason":null,"authoritative":true,"targetRaw":"180000000","coveredRaw":"180000000","allocations":[{"lotId":"receipt:in-300:0","sourceEventId":"receipt:in-300:0","sourceAddress":"old","usedAmountRaw":"180000000","sourceOriginalRaw":"300000000"}]}}
]
```

The replay-local exhaustive normalizer maps `identity_collision|identity_unresolved -> canonical_event_identity_unresolved`, `order_unresolved -> temporal_order_unresolved`, `history_incomplete -> history_incomplete_before_anchor`, and `debit_exceeds_inventory -> outgoing_exceeds_reconstructed_inventory`; Task 2 tests the shared mapper against the same four outputs.
The real expected object may change only through a new independent tape acceptance commit whose evidence satisfies every authority field. `recordedNonAuthoritativeCalibration` separately keeps `180000000/180000000` target coverage and `180000000/300000000` source utilization.

- [ ] **Step 4: Move ownership, add CLI scope, run green**

Move, do not copy, ledger tests/helpers to `chronologicalProportionalLedger.test.ts`; move ledger replay to `chronologicalLedgerCorpusReplay.ts`; mixed files delegate. CLI accepts only `--group all|ledger` and `--fixture <path>`; unknown group throws `forensic_replay_group_invalid`.

```powershell
npm.cmd test -- tests/forensics/chronologicalProportionalLedger.test.ts tests/forensics/chronologicalLedgerCorpusReplay.test.ts tests/forensics/offlineForensicModelReplay.test.ts
if ($LASTEXITCODE -ne 0) { throw 'cashflow_corpus_tests_failed' }
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'cashflow_corpus_typecheck_failed' }
node --import tsx scripts/replayForensicModelCorpus.ts --group ledger
if ($LASTEXITCODE -ne 0) { throw 'cashflow_ledger_not_7_of_7' }
```

- [ ] **Step 5: Commit exact corpus files from an empty index**

```powershell
Assert-EmptyIndex
$files = @('src/forensics/chronologicalLedgerCorpusReplay.ts','src/forensics/offlineForensicModelReplay.ts','scripts/replayForensicModelCorpus.ts','tests/fixtures/forensics/forensic-model-offline-corpus-v1.json','tests/fixtures/forensics/loadForensicModelCorpus.ts','tests/forensics/chronologicalLedgerCorpusReplay.test.ts','tests/forensics/chronologicalProportionalLedger.test.ts','tests/forensics/offlineForensicModelReplay.test.ts')
Invoke-GitChecked (@('add','--') + $files) 'cashflow_corpus_stage_failed'
$cached = Get-GitTextChecked @('diff','--cached','--name-only') 'cashflow_corpus_cached_read_failed'
if ((@($cached | Sort-Object) -join "`n") -ne (@($files | Sort-Object) -join "`n")) { throw 'cashflow_corpus_cached_scope_invalid' }
Invoke-GitChecked @('diff','--cached','--check') 'cashflow_corpus_diff_check_failed'
Invoke-GitChecked @('commit','-m','test: execute chronological ledger corpus') 'cashflow_corpus_commit_failed'
```

## Task 2: Implement JSON-Safe Canonical Tape And Pure Shadow Foundation

**Files:** `cashflowCanonicalTape.ts`, `cashflowShadowArtifact.ts`, ledger amount rule, and their two tests.

- [ ] **Step 1: Define the JSON-safe accepted types**

```ts
export type CashflowPublicUnresolvedReasonV1 =
  | "canonical_event_identity_unresolved" | "temporal_order_unresolved"
  | "history_incomplete_before_anchor" | "anchor_balance_witness_missing"
  | "snapshot_balance_mismatch" | "outgoing_exceeds_reconstructed_inventory"
  | "requested_amount_missing" | "requested_amount_not_positive"
  | "requested_amount_exceeds_snapshot_balance" | "economic_role_unresolved"
  | "provider_or_snapshot_inconsistent";
export const PUBLIC_REASONS = new Set<CashflowPublicUnresolvedReasonV1>(["canonical_event_identity_unresolved","temporal_order_unresolved","history_incomplete_before_anchor","anchor_balance_witness_missing","snapshot_balance_mismatch","outgoing_exceeds_reconstructed_inventory","requested_amount_missing","requested_amount_not_positive","requested_amount_exceeds_snapshot_balance","economic_role_unresolved","provider_or_snapshot_inconsistent"]);
export const publicReason = (value: unknown): value is CashflowPublicUnresolvedReasonV1 => typeof value === "string" && PUBLIC_REASONS.has(value as CashflowPublicUnresolvedReasonV1);
export type CashflowTapeQueryV1 =
  | { purpose: "current_balance"; exactRedContributorLotIds: readonly string[] }
  | { purpose: "amount_only"; requestedAmountRaw: string; exactRedContributorLotIds: readonly string[] }
  | { purpose: "exact_episode"; exactEventId: string; exactRedContributorLotIds: readonly string[] };

export type CashflowCanonicalTapeBodyV1 = {
  tapeId: string; chain: "tron"; tokenContract: typeof TRON_USDT_CONTRACT_ADDRESS;
  subjectAddress: string;
  snapshot: { blockNumber: number; blockHash: string; evidenceRef: string; balance: {
    amountRaw: string | null; pinned: boolean; independent: boolean; evidenceRef: string | null;
  }};
  history: { completeness: "genesis_complete" | "partial"; openingBalanceRaw: string | null; evidenceRef: string | null };
  movements: readonly { canonicalEventId: string; providerEventIds: readonly string[]; txHash: string;
    blockNumber: number; transactionIndex: number | null; eventIndex: number;
    eventIndexAuthority: "receipt_log_index"; occurredAtMs: number; fromAddress: string; toAddress: string;
    amountRaw: string; finality: "confirmed_success"; identityEvidenceRef: string;
    finalityEvidenceRef: string; orderEvidenceRef: string | null }[];
  query: CashflowTapeQueryV1;
  economicRoleCoverage: "complete" | "incomplete";
  evidenceRefs: readonly string[];
};
export type CashflowCanonicalTapeArtifactV1 = { schemaVersion: "cashflow-canonical-tape-v1"; artifactSha256: string; body: CashflowCanonicalTapeBodyV1 };
export type CashflowAuthorityEnvelopeV1 =
  | { kind: "unavailable"; typedReason: CashflowPublicUnresolvedReasonV1; evidenceRefs: readonly string[] }
  | { kind: "canonical_tape"; tape: CashflowCanonicalTapeArtifactV1 };
```

Canonical convention: `artifactSha256` is lowercase hex `fingerprintCanonicalArtifact(body)`, not file-byte hash or hash of the wrapper. Arrays must already be unique/code-unit-sorted; movements are sorted by `canonicalEventId` for serialization only, never treated as chronological authority.

- [ ] **Step 2: Implement unknown parsing before bigint conversion**

```ts
export function parseCashflowAuthorityEnvelopeV1(value: unknown): CashflowAuthorityEnvelopeV1;
export function parseCashflowCanonicalTapeArtifactV1(value: unknown): CashflowCanonicalTapeArtifactV1;
export function materializeCashflowCanonicalTapeV1(tape: CashflowCanonicalTapeArtifactV1): { input: LedgerInputV1; query: LedgerQueryV1 };
```

Implementation core (all failures throw `cashflow_canonical_tape_invalid`):

```ts
const fail = (): never => { throw new TypeError("cashflow_canonical_tape_invalid"); };
const rec = (v: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return fail();
  const out = v as Record<string, unknown>;
  if (Object.keys(out).some((key) => !keys.includes(key))) return fail();
  return out;
};
const str = (v: unknown, pattern?: RegExp): string => {
  if (typeof v !== "string" || v.length === 0 || (pattern && !pattern.test(v))) return fail();
  return v;
};
const nullableStr = (v: unknown, pattern?: RegExp): string | null => v === null ? null : str(v, pattern);
const integer = (v: unknown): number => Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const raw = (v: unknown): string => str(v, /^(0|[1-9][0-9]*)$/);
const sortedStrings = (v: unknown, allowEmpty = true): string[] => {
  if (!Array.isArray(v) || (!allowEmpty && v.length === 0)) return fail();
  const values = v.map((item) => str(item));
  if (new Set(values).size !== values.length || values.some((item, i) => i > 0 && values[i - 1]! >= item)) return fail();
  return values;
};
const txPattern = /^[0-9a-f]{64}$/;
const addressPattern = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const shaPattern = /^[0-9a-f]{64}$/;
function parseMovement(v: unknown): CashflowCanonicalTapeBodyV1["movements"][number] {
  const o = rec(v, ["canonicalEventId","providerEventIds","txHash","blockNumber","transactionIndex","eventIndex","eventIndexAuthority","occurredAtMs","fromAddress","toAddress","amountRaw","finality","identityEvidenceRef","finalityEvidenceRef","orderEvidenceRef"]);
  const txHash = str(o.txHash, txPattern);
  const eventIndex = integer(o.eventIndex);
  const transactionIndex = o.transactionIndex === null ? null : integer(o.transactionIndex);
  const orderEvidenceRef = nullableStr(o.orderEvidenceRef);
  if ((transactionIndex === null) !== (orderEvidenceRef === null)) return fail();
  const canonicalEventId = str(o.canonicalEventId);
  if (canonicalEventId !== `receipt:${txHash}:${eventIndex}`) return fail();
  if (o.eventIndexAuthority !== "receipt_log_index" || o.finality !== "confirmed_success") return fail();
  return { canonicalEventId, providerEventIds: sortedStrings(o.providerEventIds, false), txHash,
    blockNumber: integer(o.blockNumber), transactionIndex, eventIndex,
    eventIndexAuthority: "receipt_log_index", occurredAtMs: integer(o.occurredAtMs),
    fromAddress: str(o.fromAddress, addressPattern), toAddress: str(o.toAddress, addressPattern),
    amountRaw: raw(o.amountRaw), finality: "confirmed_success",
    identityEvidenceRef: str(o.identityEvidenceRef), finalityEvidenceRef: str(o.finalityEvidenceRef), orderEvidenceRef };
}
function parseTapeBody(v: unknown): CashflowCanonicalTapeBodyV1 {
  const o = rec(v, ["tapeId","chain","tokenContract","subjectAddress","snapshot","history","movements","query","economicRoleCoverage","evidenceRefs"]);
  if (o.chain !== "tron" || o.tokenContract !== TRON_USDT_CONTRACT_ADDRESS) return fail();
  const s = rec(o.snapshot, ["blockNumber","blockHash","evidenceRef","balance"]);
  const b = rec(s.balance, ["amountRaw","pinned","independent","evidenceRef"]);
  const balance = { amountRaw: b.amountRaw === null ? null : raw(b.amountRaw), pinned: bool(b.pinned), independent: bool(b.independent), evidenceRef: nullableStr(b.evidenceRef) };
  const authoritativeBalance = balance.amountRaw !== null && balance.pinned && balance.independent && balance.evidenceRef !== null;
  const absentBalance = balance.amountRaw === null && !balance.pinned && !balance.independent && balance.evidenceRef === null;
  if (!authoritativeBalance && !absentBalance) return fail();
  const h = rec(o.history, ["completeness","openingBalanceRaw","evidenceRef"]);
  if (h.completeness !== "genesis_complete" && h.completeness !== "partial") return fail();
  const history = { completeness: h.completeness, openingBalanceRaw: h.openingBalanceRaw === null ? null : raw(h.openingBalanceRaw), evidenceRef: nullableStr(h.evidenceRef) };
  if (history.completeness === "genesis_complete" ? history.openingBalanceRaw === null || history.evidenceRef === null : history.openingBalanceRaw !== null) return fail();
  const q0 = rec(o.query, ["purpose","requestedAmountRaw","exactEventId","exactRedContributorLotIds"]);
  let query: CashflowTapeQueryV1;
  if (q0.purpose === "current_balance") { const q = rec(o.query, ["purpose","exactRedContributorLotIds"]); query = { purpose: "current_balance", exactRedContributorLotIds: sortedStrings(q.exactRedContributorLotIds) }; }
  else if (q0.purpose === "amount_only") { const q = rec(o.query, ["purpose","requestedAmountRaw","exactRedContributorLotIds"]); const requestedAmountRaw = raw(q.requestedAmountRaw); if (requestedAmountRaw === "0") return fail(); query = { purpose: "amount_only", requestedAmountRaw, exactRedContributorLotIds: sortedStrings(q.exactRedContributorLotIds) }; }
  else if (q0.purpose === "exact_episode") { const q = rec(o.query, ["purpose","exactEventId","exactRedContributorLotIds"]); query = { purpose: "exact_episode", exactEventId: str(q.exactEventId, /^receipt:[0-9a-f]{64}:[0-9]+$/), exactRedContributorLotIds: sortedStrings(q.exactRedContributorLotIds) }; }
  else return fail();
  const movements = Array.isArray(o.movements) ? o.movements.map(parseMovement) : fail();
  if (movements.some((item, i) => i > 0 && movements[i - 1]!.canonicalEventId >= item.canonicalEventId)) return fail();
  const role = o.economicRoleCoverage;
  if (role !== "complete" && role !== "incomplete") return fail();
  return { tapeId: str(o.tapeId), chain: "tron", tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    subjectAddress: str(o.subjectAddress, addressPattern), snapshot: { blockNumber: integer(s.blockNumber), blockHash: str(s.blockHash, shaPattern), evidenceRef: str(s.evidenceRef), balance },
    history, movements, query,
    economicRoleCoverage: role, evidenceRefs: sortedStrings(o.evidenceRefs, false) };
}

export function parseCashflowCanonicalTapeArtifactV1(value: unknown): CashflowCanonicalTapeArtifactV1 {
  const o = rec(value, ["schemaVersion","artifactSha256","body"]);
  if (o.schemaVersion !== "cashflow-canonical-tape-v1") return fail();
  const body = parseTapeBody(o.body);
  const artifactSha256 = str(o.artifactSha256, shaPattern);
  if (fingerprintCanonicalArtifact(body) !== artifactSha256) return fail();
  return { schemaVersion: "cashflow-canonical-tape-v1", artifactSha256, body };
}
export function parseCashflowAuthorityEnvelopeV1(value: unknown): CashflowAuthorityEnvelopeV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail();
  if ((value as Record<string, unknown>).kind === "canonical_tape") { const o = rec(value, ["kind","tape"]); return { kind: "canonical_tape", tape: parseCashflowCanonicalTapeArtifactV1(o.tape) }; }
  const o = rec(value, ["kind","typedReason","evidenceRefs"]);
  if (o.kind !== "unavailable" || !publicReason(o.typedReason)) return fail();
  return { kind: "unavailable", typedReason: o.typedReason, evidenceRefs: sortedStrings(o.evidenceRefs) };
}
```

The parser rejects non-records, unknown or cross-variant keys, invalid discriminants, non-TRON chain, non-official token, non-Base58Check-shaped addresses, non-64-hex tx/block/hash, unsafe integers, negative/leading-zero amount strings, duplicate/unsorted refs, canonical ID not equal to `receipt:<full-lowercase-tx-hash>:<eventIndex>`, failed/unknown finality, receipt identity without evidence, missing order evidence when `transactionIndex` is present, inconsistent history/opening or balance evidence, invalid purpose-specific query shape, invalid economic-role identifier, or recomputed hash mismatch. Accepted `economicRoleCoverage: "incomplete"` becomes `economic_role_unresolved`; only after tape parsing returns typed data may `BigInt(amountRaw)` run.

`materializeCashflowCanonicalTapeV1` maps validated strings to bigint, runs the ledger, binds the query to that exact result, and creates a snapshot witness only when balance is non-null, pinned, independent, and evidence-bound. For partial history with null opening it passes `0n` only as the ledger type's inert sentinel; `historyCompleteness: "partial"` forces unresolved before allocation.

```ts
export function materializeCashflowCanonicalTapeV1(tape: CashflowCanonicalTapeArtifactV1) {
  const b = tape.body;
  const input: LedgerInputV1 = { subjectAddress: b.subjectAddress, snapshotBlockNumber: b.snapshot.blockNumber,
    snapshotBlockHash: b.snapshot.blockHash, snapshotEvidenceRef: b.snapshot.evidenceRef,
    historyCompleteness: b.history.completeness, openingBalanceRaw: BigInt(b.history.openingBalanceRaw ?? "0"),
    events: [...b.movements].sort((a, z) => a.canonicalEventId < z.canonicalEventId ? -1 : a.canonicalEventId > z.canonicalEventId ? 1 : 0).map((m) => ({ canonicalEventId: m.canonicalEventId, providerEventIds: m.providerEventIds,
      txHash: m.txHash, blockNumber: m.blockNumber, transactionIndex: m.transactionIndex, eventIndex: m.eventIndex,
      eventIndexAuthority: m.eventIndexAuthority, occurredAtMs: m.occurredAtMs, fromAddress: m.fromAddress,
      toAddress: m.toAddress, amountRaw: BigInt(m.amountRaw) })) };
  const ledger = runChronologicalProportionalLedgerV1(input);
  const balance = b.snapshot.balance;
  const query: LedgerQueryV1 = { ledger, purpose: b.query.purpose,
    ...(b.query.purpose === "amount_only" ? { requestedAmountRaw: BigInt(b.query.requestedAmountRaw) } : {}),
    ...(b.query.purpose === "exact_episode" ? { exactEventId: b.query.exactEventId } : {}),
    exactRedContributorLotIds: b.query.exactRedContributorLotIds,
    ...(balance.amountRaw === null ? {} : { snapshotBalanceWitness: { amountRaw: BigInt(balance.amountRaw), pinned: true,
      independent: true, subjectAddress: b.subjectAddress, snapshotBlockNumber: b.snapshot.blockNumber,
      snapshotBlockHash: b.snapshot.blockHash, evidenceRef: balance.evidenceRef! } }) };
  return { input, query };
}
```

- [ ] **Step 3: Implement positive amount and exhaustive reason mapping**

```ts
export function cashflowPublicReasonV1(reason: LedgerFailureReasonV1 | LedgerSelectionReasonV1): CashflowPublicUnresolvedReasonV1 {
  switch (reason) {
    case "identity_collision": case "identity_unresolved": return "canonical_event_identity_unresolved";
    case "order_unresolved": return "temporal_order_unresolved";
    case "history_incomplete": return "history_incomplete_before_anchor";
    case "snapshot_inconsistent": case "balance_witness_binding_mismatch":
    case "requested_amount_exceeds_episode": return "provider_or_snapshot_inconsistent";
    case "debit_exceeds_inventory": return "outgoing_exceeds_reconstructed_inventory";
    case "balance_witness_missing": return "anchor_balance_witness_missing";
    case "snapshot_balance_mismatch": return "snapshot_balance_mismatch";
    case "requested_amount_missing": return "requested_amount_missing";
    case "requested_amount_not_positive": return "requested_amount_not_positive";
    case "requested_amount_exceeds_balance": return "requested_amount_exceeds_snapshot_balance";
    case "exact_event_missing": return "canonical_event_identity_unresolved";
  }
}
```

Add `requested_amount_not_positive` to `LedgerSelectionReasonV1`; after a valid witness, missing amount keeps `requested_amount_missing`, `<= 0n` returns the new reason, and over-balance keeps its mapped reason.

- [ ] **Step 4: Implement the pure JSON-safe shadow artifact**

```ts
export type CashflowShadowArtifactV1 = { schemaVersion: "cashflow-shadow-artifact-v1"; artifactSha256: string; body: {
  state: "complete" | "unresolved" | "not_applicable"; reason: CashflowPublicUnresolvedReasonV1 | null;
  subjectAddress: string | null; purpose: LedgerQueryV1["purpose"] | null;
  targetRaw: string | null; coveredRaw: string | null;
  allocations: readonly { lotId: string; sourceEventId: string; sourceAddress: string; usedAmountRaw: string; sourceOriginalRaw: string }[];
  evidenceRefs: readonly string[]; authorityArtifactSha256: string | null;
}};
export function buildCashflowShadowArtifactV1(authority: CashflowAuthorityEnvelopeV1): CashflowShadowArtifactV1;
export function parseCashflowShadowArtifactV1(value: unknown): CashflowShadowArtifactV1;
```

Unavailable produces null subject/purpose/amounts, empty allocations, and its typed reason without invented ledger fields. Canonical tape materializes/selects once, maps the reason, sorts allocations/evidence, and hashes only `body`. Parsing recomputes the hash.

```ts
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const finishShadow = (body: CashflowShadowArtifactV1["body"]): CashflowShadowArtifactV1 => {
  const canonical = { ...body, evidenceRefs: [...new Set(body.evidenceRefs)].sort(compareId), allocations: [...body.allocations].sort((a, b) => compareId(a.lotId, b.lotId) || compareId(a.sourceEventId, b.sourceEventId)) };
  return { schemaVersion: "cashflow-shadow-artifact-v1", artifactSha256: fingerprintCanonicalArtifact(canonical), body: canonical };
};
export function buildCashflowShadowArtifactV1(authority: CashflowAuthorityEnvelopeV1): CashflowShadowArtifactV1 {
  if (authority.kind === "unavailable") return finishShadow({ state: "unresolved", reason: authority.typedReason,
    subjectAddress: null, purpose: null, targetRaw: null, coveredRaw: null, allocations: [],
    evidenceRefs: authority.evidenceRefs, authorityArtifactSha256: null });
  const { tape } = authority;
  if (tape.body.economicRoleCoverage === "incomplete") return finishShadow({ state: "unresolved",
    reason: "economic_role_unresolved", subjectAddress: tape.body.subjectAddress, purpose: tape.body.query.purpose,
    targetRaw: null, coveredRaw: null, allocations: [], evidenceRefs: tape.body.evidenceRefs,
    authorityArtifactSha256: tape.artifactSha256 });
  const { query } = materializeCashflowCanonicalTapeV1(tape);
  const selected = selectLedgerProvenanceV1(query);
  if (selected.state === "unresolved") return finishShadow({ state: "unresolved", reason: cashflowPublicReasonV1(selected.reason!), subjectAddress: tape.body.subjectAddress, purpose: tape.body.query.purpose, targetRaw: null, coveredRaw: null, allocations: [], evidenceRefs: tape.body.evidenceRefs, authorityArtifactSha256: tape.artifactSha256 });
  return finishShadow({ state: selected.state, reason: selected.reason === null ? null : cashflowPublicReasonV1(selected.reason),
    subjectAddress: tape.body.subjectAddress, purpose: tape.body.query.purpose,
    targetRaw: selected.targetRaw.toString(), coveredRaw: selected.coveredRaw.toString(),
    allocations: selected.allocations.map((a) => ({ lotId: a.lotId, sourceEventId: a.sourceEventId, sourceAddress: a.sourceAddress,
      usedAmountRaw: a.amountRaw.toString(), sourceOriginalRaw: a.sourceOriginalRaw.toString() })),
    evidenceRefs: tape.body.evidenceRefs, authorityArtifactSha256: tape.artifactSha256 });
}
export function parseCashflowShadowArtifactV1(value: unknown): CashflowShadowArtifactV1 {
  try {
    const o = rec(value, ["schemaVersion","artifactSha256","body"]);
    if (o.schemaVersion !== "cashflow-shadow-artifact-v1") throw new Error();
    const b = rec(o.body, ["state","reason","subjectAddress","purpose","targetRaw","coveredRaw","allocations","evidenceRefs","authorityArtifactSha256"]);
    if (!["complete","unresolved","not_applicable"].includes(String(b.state))) throw new Error();
    if (b.reason !== null && !publicReason(b.reason)) throw new Error();
    if (b.purpose !== null && !["current_balance","amount_only","exact_episode"].includes(String(b.purpose))) throw new Error();
    const allocations = Array.isArray(b.allocations) ? b.allocations.map((v) => {
      const a = rec(v, ["lotId","sourceEventId","sourceAddress","usedAmountRaw","sourceOriginalRaw"]);
      return { lotId: str(a.lotId), sourceEventId: str(a.sourceEventId), sourceAddress: str(a.sourceAddress, addressPattern), usedAmountRaw: raw(a.usedAmountRaw), sourceOriginalRaw: raw(a.sourceOriginalRaw) };
    }) : fail();
    if (allocations.some((a, i) => i > 0 && `${allocations[i - 1]!.lotId}\0${allocations[i - 1]!.sourceEventId}` >= `${a.lotId}\0${a.sourceEventId}`)) throw new Error();
    const body = { state: b.state, reason: b.reason, subjectAddress: nullableStr(b.subjectAddress, addressPattern),
      purpose: b.purpose, targetRaw: b.targetRaw === null ? null : raw(b.targetRaw), coveredRaw: b.coveredRaw === null ? null : raw(b.coveredRaw),
      allocations, evidenceRefs: sortedStrings(b.evidenceRefs), authorityArtifactSha256: nullableStr(b.authorityArtifactSha256, shaPattern) } as CashflowShadowArtifactV1["body"];
    const sum = allocations.reduce((n, a) => n + BigInt(a.usedAmountRaw), 0n); const paired = (body.subjectAddress === null) === (body.purpose === null) && (body.subjectAddress === null) === (body.authorityArtifactSha256 === null); const authoritative = body.subjectAddress !== null && body.purpose !== null && body.authorityArtifactSha256 !== null; const coherentAllocations = allocations.every((a) => BigInt(a.usedAmountRaw) > 0n && BigInt(a.sourceOriginalRaw) >= BigInt(a.usedAmountRaw));
    if (!paired || !coherentAllocations || (body.state === "complete" && (!authoritative || body.reason !== null || body.targetRaw === null || body.coveredRaw === null || BigInt(body.targetRaw) <= 0n || BigInt(body.targetRaw) !== BigInt(body.coveredRaw) || BigInt(body.coveredRaw) !== sum)) || (body.state === "unresolved" && (!publicReason(body.reason) || body.targetRaw !== null || body.coveredRaw !== null || allocations.length !== 0)) || (body.state === "not_applicable" && (!authoritative || body.purpose !== "current_balance" || body.reason !== null || body.targetRaw !== "0" || body.coveredRaw !== "0" || allocations.length !== 0))) throw new Error();
    const artifactSha256 = str(o.artifactSha256, shaPattern);
    if (fingerprintCanonicalArtifact(body) !== artifactSha256) throw new Error();
    return { schemaVersion: "cashflow-shadow-artifact-v1", artifactSha256, body };
  } catch { throw new TypeError("cashflow_shadow_artifact_invalid"); }
}
```

- [ ] **Step 5: Add complete trust/determinism tests, including accepted real tape**

```ts
const acceptance = JSON.parse(readFileSync(acceptancePath, "utf8"));
const rawTape: unknown = JSON.parse(readFileSync(acceptance.tapeArtifactPath, "utf8"));
const tape = parseCashflowCanonicalTapeArtifactV1(rawTape);
expect(tape.artifactSha256).toBe(acceptance.tapeArtifactSha256);
expect(fingerprintCanonicalArtifact(tape.body)).toBe(tape.artifactSha256);
const real = buildCashflowShadowArtifactV1({ kind: "canonical_tape", tape });
expect(real.body).toMatchObject({ state: "unresolved", reason: "history_incomplete_before_anchor" });
expect(real.body.authorityArtifactSha256).toBe(tape.artifactSha256);
```

```ts
const cases: Array<[string, (copy: any) => void]> = [
  ["chain", (x) => { x.body.chain = "ethereum"; }], ["token", (x) => { x.body.tokenContract = "T" + "1".repeat(33); }],
  ["full tx", (x) => { const m=x.body.movements[0]; m.txHash=m.txHash==="0".repeat(64)?"1".repeat(64):"0".repeat(64); }], ["canonical id", (x) => { x.body.movements[0].canonicalEventId += "x"; }],
  ["amount", (x) => { x.body.movements[0].amountRaw = "0180000000"; }], ["finality", (x) => { x.body.movements[0].finality = "unknown"; }],
  ["order", (x) => { const m=x.body.movements[0]; m.transactionIndex===null ? m.orderEvidenceRef="forbidden" : m.orderEvidenceRef=null; }], ["history", (x) => { x.body.history.completeness=x.body.history.completeness==="partial"?"genesis_complete":"partial"; }],
  ["balance", (x) => { x.body.snapshot.balance.pinned=!x.body.snapshot.balance.pinned; }], ["refs", (x) => { x.body.evidenceRefs.push(x.body.evidenceRefs[0]); }],
  ["identity evidence", (x) => { x.body.movements[0].identityEvidenceRef = ""; }], ["provider refs", (x) => { x.body.movements[0].providerEventIds.push(x.body.movements[0].providerEventIds[0]); }],
  ["snapshot hash", (x) => { x.body.snapshot.blockHash = "bad"; }], ["query", (x) => { x.body.query.purpose = "other"; }],
  ["economic role", (x) => { x.body.economicRoleCoverage = "partial"; }], ["unknown key", (x) => { x.body.extra = true; }]
];
it.each(cases)("rejects tampered %s", (_name, mutate) => {
  const copy = structuredClone(rawTape) as any; const before=fingerprintCanonicalArtifact(copy.body); mutate(copy); expect(fingerprintCanonicalArtifact(copy.body)).not.toBe(before);
  copy.artifactSha256 = fingerprintCanonicalArtifact(copy.body);
  expect(() => parseCashflowCanonicalTapeArtifactV1(copy)).toThrow("cashflow_canonical_tape_invalid");
});
it("rejects body hash tampering", () => {
  const copy = structuredClone(rawTape) as any; copy.body.economicRoleCoverage = "incomplete";
  expect(() => parseCashflowCanonicalTapeArtifactV1(copy)).toThrow("cashflow_canonical_tape_invalid");
});
expect(tape.body.movements.some((m) => m.txHash === "676a97390c99f997e3c9af9a57e8c684c7b6253710e8b009950f73b8b25fe7ca")).toBe(true);
const unavailable: CashflowAuthorityEnvelopeV1 = { kind: "unavailable", typedReason: "history_incomplete_before_anchor", evidenceRefs: ["accepted:gap:history"] };
const first = buildCashflowShadowArtifactV1(unavailable); const second = buildCashflowShadowArtifactV1(unavailable);
expect(second).toEqual(first); expect(parseCashflowShadowArtifactV1(first)).toEqual(first);
const tamperedShadow: any = structuredClone(first); tamperedShadow.body.reason = "temporal_order_unresolved";
expect(() => parseCashflowShadowArtifactV1(tamperedShadow)).toThrow("cashflow_shadow_artifact_invalid");
it.each([["current extra",{purpose:"current_balance",requestedAmountRaw:null,exactRedContributorLotIds:[]}],["amount missing",{purpose:"amount_only",exactRedContributorLotIds:[]}],["amount zero",{purpose:"amount_only",requestedAmountRaw:"0",exactRedContributorLotIds:[]}],["amount exact",{purpose:"amount_only",requestedAmountRaw:"1",exactEventId:"receipt:"+"0".repeat(64)+":0",exactRedContributorLotIds:[]}],["episode missing",{purpose:"exact_episode",exactRedContributorLotIds:[]}],["episode amount",{purpose:"exact_episode",exactEventId:"receipt:"+"0".repeat(64)+":0",requestedAmountRaw:"1",exactRedContributorLotIds:[]}]])("rejects query %s", (_name, query) => { const x:any=structuredClone(rawTape); x.body.query=query; x.artifactSha256=fingerprintCanonicalArtifact(x.body); expect(() => parseCashflowCanonicalTapeArtifactV1(x)).toThrow("cashflow_canonical_tape_invalid"); });
const oneQuery:any=structuredClone(rawTape); oneQuery.body.query={purpose:"current_balance",exactRedContributorLotIds:[]}; oneQuery.artifactSha256=fingerprintCanonicalArtifact(oneQuery.body); expect(parseCashflowCanonicalTapeArtifactV1(oneQuery).artifactSha256).toBe(fingerprintCanonicalArtifact(oneQuery.body));
expect(() => parseCashflowAuthorityEnvelopeV1({ ...unavailable, tape })).toThrow("cashflow_canonical_tape_invalid"); expect(() => parseCashflowAuthorityEnvelopeV1({ kind:"canonical_tape", tape, typedReason:"history_incomplete_before_anchor" })).toThrow("cashflow_canonical_tape_invalid");
const completeBody:any={state:"complete",reason:null,subjectAddress:tape.body.subjectAddress,purpose:"current_balance",targetRaw:"1",coveredRaw:"1",allocations:[{lotId:"receipt:"+"0".repeat(64)+":0",sourceEventId:"receipt:"+"0".repeat(64)+":0",sourceAddress:tape.body.movements[0]!.fromAddress,usedAmountRaw:"1",sourceOriginalRaw:"1"}],evidenceRefs:tape.body.evidenceRefs,authorityArtifactSha256:tape.artifactSha256};
const contradictoryComplete:any={schemaVersion:"cashflow-shadow-artifact-v1",body:{...completeBody,reason:"temporal_order_unresolved"}}; contradictoryComplete.artifactSha256=fingerprintCanonicalArtifact(contradictoryComplete.body); expect(() => parseCashflowShadowArtifactV1(contradictoryComplete)).toThrow("cashflow_shadow_artifact_invalid");
const contradictoryUnresolved:any=structuredClone(first); contradictoryUnresolved.body.targetRaw="0"; contradictoryUnresolved.body.coveredRaw="0"; contradictoryUnresolved.body.allocations=completeBody.allocations; contradictoryUnresolved.artifactSha256=fingerprintCanonicalArtifact(contradictoryUnresolved.body); expect(() => parseCashflowShadowArtifactV1(contradictoryUnresolved)).toThrow("cashflow_shadow_artifact_invalid");
const badNotApplicable:any={schemaVersion:"cashflow-shadow-artifact-v1",body:{...completeBody,state:"not_applicable",purpose:"amount_only",targetRaw:"0",coveredRaw:"0",allocations:[]}}; badNotApplicable.artifactSha256=fingerprintCanonicalArtifact(badNotApplicable.body); expect(() => parseCashflowShadowArtifactV1(badNotApplicable)).toThrow("cashflow_shadow_artifact_invalid");
it.each([
  ["identity_collision","canonical_event_identity_unresolved"],["identity_unresolved","canonical_event_identity_unresolved"],["order_unresolved","temporal_order_unresolved"],["history_incomplete","history_incomplete_before_anchor"],
  ["snapshot_inconsistent","provider_or_snapshot_inconsistent"],["debit_exceeds_inventory","outgoing_exceeds_reconstructed_inventory"],["balance_witness_missing","anchor_balance_witness_missing"],["balance_witness_binding_mismatch","provider_or_snapshot_inconsistent"],
  ["snapshot_balance_mismatch","snapshot_balance_mismatch"],["requested_amount_missing","requested_amount_missing"],["requested_amount_not_positive","requested_amount_not_positive"],["requested_amount_exceeds_balance","requested_amount_exceeds_snapshot_balance"],
  ["exact_event_missing","canonical_event_identity_unresolved"],["requested_amount_exceeds_episode","provider_or_snapshot_inconsistent"]
] as const)("maps %s", (internal, expected) => expect(cashflowPublicReasonV1(internal)).toBe(expected));
```

- [ ] **Step 6: Run and commit exact foundation files**

```powershell
npm.cmd test -- tests/forensics/cashflowCanonicalTape.test.ts tests/forensics/cashflowShadowArtifact.test.ts tests/forensics/chronologicalProportionalLedger.test.ts tests/forensics/chronologicalLedgerCorpusReplay.test.ts
if ($LASTEXITCODE -ne 0) { throw 'cashflow_foundation_tests_failed' }
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'cashflow_foundation_typecheck_failed' }
Assert-EmptyIndex
$files = @('src/forensics/cashflowCanonicalTape.ts','src/forensics/cashflowShadowArtifact.ts','src/forensics/chronologicalProportionalLedger.ts','tests/forensics/cashflowCanonicalTape.test.ts','tests/forensics/cashflowShadowArtifact.test.ts')
Invoke-GitChecked (@('add','--') + $files) 'cashflow_foundation_stage_failed'
$cached = Get-GitTextChecked @('diff','--cached','--name-only') 'cashflow_foundation_cached_read_failed'
if ((@($cached | Sort-Object) -join "`n") -ne (@($files | Sort-Object) -join "`n")) { throw 'cashflow_foundation_cached_scope_invalid' }
Invoke-GitChecked @('diff','--cached','--check') 'cashflow_foundation_diff_check_failed'
Invoke-GitChecked @('commit','-m','feat: add canonical cashflow tape foundation') 'cashflow_foundation_commit_failed'
```

## Task 3: Independently Adjudicate, Update Truth, And Stop

**Files:** adjudication, `docs/knowledge/09-current-decisions.md`, `docs/knowledge/14-current-roadmap.md` only.

- [ ] **Step 1: Independent reviewer reruns every gate**

The reviewer is not the implementation worker. They rerun Task 0 hash/chain checks, both focused suites, `--group ledger`, full `npm.cmd test`, typecheck, and `git diff --check`; compare all seven actual JSON objects; inspect the real tape/body hash/source bindings; confirm real PacGy remains unresolved and synthetic calibration is separate.

- [ ] **Step 2: Reviewer creates the exact adjudication record**

`docs/superpowers/verification/2026-07-30-cashflow-foundation-adjudication.md` records: corpus/foundation commits; source-review/tape-acceptance commits and hashes; seven normalized actual JSON objects; test commands/exits; `real_pacgy_authoritative: false`; `production_runtime_authorized: false`; reviewer/date; `decision: accepted|rejected`.

- [ ] **Step 3: Update only relevant clean knowledge files**

`09-current-decisions.md` records the accepted JSON-safe tape/hash convention, unresolved semantics, and no runtime authorization. `14-current-roadmap.md` records 7/7 plus blockers: accepted production sampling, upstream authority acquisition, and safe legacy-neutral immutable storage. Do not edit or stage `10-open-problems.md` or `13-agent-observations.md`.

- [ ] **Step 4: Commit exact review/docs files from an empty index**

```powershell
Assert-EmptyIndex
$files = @('docs/superpowers/verification/2026-07-30-cashflow-foundation-adjudication.md','docs/knowledge/09-current-decisions.md','docs/knowledge/14-current-roadmap.md')
Invoke-GitChecked (@('add','--') + $files) 'cashflow_adjudication_stage_failed'
$cached = Get-GitTextChecked @('diff','--cached','--name-only') 'cashflow_adjudication_cached_read_failed'
if ((@($cached | Sort-Object) -join "`n") -ne (@($files | Sort-Object) -join "`n")) { throw 'cashflow_adjudication_cached_scope_invalid' }
Invoke-GitChecked @('diff','--cached','--check') 'cashflow_adjudication_diff_check_failed'
Invoke-GitChecked @('commit','-m','docs: adjudicate cashflow shadow foundation') 'cashflow_adjudication_commit_failed'
```

- [ ] **Step 5: Mandatory approval stop**

Present all three commits and receipts to a human. The later approval file contains exactly six non-empty `key: value` lines: `decision`, `corpus_commit`, `foundation_commit`, `adjudication_commit`, `approver`, `approved_at`; no Markdown header or extra key is allowed.

```powershell
$approvalPath = 'docs/superpowers/verification/2026-07-30-cashflow-foundation-approval.md'; Assert-TrackedCleanInsideRepo $approvalPath; $lines = @(Get-Content -Encoding UTF8 $approvalPath | Where-Object { $_ -ne '' })
$allowed=@('decision','corpus_commit','foundation_commit','adjudication_commit','approver','approved_at'); $map=@{}
foreach($line in $lines){ if($line -notmatch '^([a-z_]+):\s*(\S(?:.*\S)?)$' -or $allowed -notcontains $Matches[1] -or $map.ContainsKey($Matches[1])){ throw 'cashflow_approval_content_invalid' }; $map[$Matches[1]]=$Matches[2] }
if($map.Count -ne 6 -or $map.decision -ne 'approved' -or $map.approved_at -notmatch '^\d{4}-\d{2}-\d{2}$'){ throw 'cashflow_approval_content_invalid' }; $refs=@($map.corpus_commit,$map.foundation_commit,$map.adjudication_commit)
$expected=@{corpus_commit=(Get-GitScalarChecked @('log','-1','--format=%H','--','src/forensics/chronologicalLedgerCorpusReplay.ts') 'cashflow_corpus_commit_read_failed');foundation_commit=(Get-GitScalarChecked @('log','-1','--format=%H','--','src/forensics/cashflowCanonicalTape.ts') 'cashflow_foundation_commit_read_failed');adjudication_commit=(Get-GitScalarChecked @('log','-1','--format=%H','--','docs/superpowers/verification/2026-07-30-cashflow-foundation-adjudication.md') 'cashflow_adjudication_commit_read_failed')}
foreach($key in @('corpus_commit','foundation_commit','adjudication_commit')){ if($map[$key] -ne $expected[$key]){ throw 'cashflow_approval_commit_binding_mismatch' } }
$approvalCommit = Get-GitScalarChecked @('log','-1','--format=%H','--',$approvalPath) 'cashflow_approval_commit_read_failed'; Assert-Commit $approvalCommit
foreach ($commit in $refs) { if($commit -notmatch '^[0-9a-f]{40}$'){ throw 'cashflow_approval_content_invalid' }; Assert-Commit $commit; Invoke-GitChecked @('merge-base','--is-ancestor',$commit,$approvalCommit) 'cashflow_approval_chain_invalid' }
```

**STOP.** No production integration plan can be written or executed until separately accepted outputs prove both (1) an upstream runtime seam that supplies canonical tapes or typed unavailable envelopes without deriving them from reports, and (2) a legacy-neutral immutable unreferenced artifact storage API. This plan proves neither seam.

## Final Acceptance Gate

- [ ] Renamed plan, raw source, source review, real tape, and tape acceptance were pre-existing, tracked, clean, inside repo, hash-matched, and independently chained.
- [ ] Exactly 7/7 cases execute with the seven frozen actual JSON objects.
- [ ] Real PacGy stays unresolved unless a new independent evidence acceptance proves complete authority; synthetic `180/180` and `180/300` remain separate.
- [ ] Tape JSON contains no bigint; parser accepts `unknown`, rejects unknown/tampered authority, and converts amounts only afterward.
- [ ] Full tx hashes, chain/token, finality, identity, order, history/opening, balance, query, economic role, evidence refs, and canonical body hash are validated.
- [ ] At least one independently accepted non-synthetic tape is parsed and consumed by tests.
- [ ] `requested_amount_missing`, positive amount, all public reasons, unavailable behavior, determinism, and tamper rejection are tested.
- [ ] Every commit began with an empty index and exact cached file list.
- [ ] Only knowledge 09/14 changed; dirty 10/13 were untouched.
- [ ] No production config/runtime/callback/storage/job/Admin/indexing/DB/Unified/Stage C/D/canary/activation work exists.
- [ ] Independent adjudication committed; human approval stop observed.

## Self-Review

- The document is a prerequisite foundation plan, not a disguised production integration plan.
- External evidence cannot be created and blessed by the same worker; missing bytes/hash/acceptance stop Task 0.
- Seven actual outputs, JSON-safe schema, hash convention, parser/materializer APIs, reason switch, tests, commands, failures, and exact commits are specified.
- Production persistence and tautological job/Unified no-diff tests were removed because no safe seam exists.
