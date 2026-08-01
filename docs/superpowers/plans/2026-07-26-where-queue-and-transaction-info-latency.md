# Where Queue Fairness and Selective Transaction Info Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make legacy Where checks start fairly and stop spending minutes on full TronScan details for ordinary USDT transfers, while preserving forensic facts, provider safety, restart safety, and explicit incomplete coverage when required evidence is unavailable.

**Architecture:** Add one shared, scheduler-backed transaction-evidence resolver in front of full-node raw transaction and TronScan transaction-info calls. It first reuses immutable exact evidence, then proves plain official-USDT transfers from raw calldata plus indexed movement identity, and calls full transaction-info only for the eight approved hard triggers. Separately replace the serial Where batch with a two-slot-capable database-backed pump, fenced by a per-claim generation token derived from the existing `started_at` column. PostgreSQL remains the only queue authority; provider capacity and Deep/Incoming lane concurrency do not change.

**Tech Stack:** TypeScript, Node.js standard library, Vitest, PostgreSQL (`pg`), TronWeb, the existing TronScan scheduler, `raw_evidence`, and the existing legacy Where/Incoming/Deep runtime.

---

## Scope, authority, and verified baseline

This plan implements only **Stage B** from
`docs/superpowers/specs/2026-07-26-unified-service-boundary-and-latency-design.md`.
The implementation baseline is commit
`7ae2275919888ed1bb0cfe5c88ac3536c69ed448`, which already contains Stage A.

Stage B is a legacy runtime correction. It does **not**:

- connect legacy Where to the Unified provider controller;
- implement behavioral service-wallet classification or inferred boundaries;
- change `snapshot-closure-v1`, `snapshot-closure-v2`, manifests, frozen facts,
  matrix-v4, scores, or final decisions;
- suppress a hard blacklist, sanctions, drainer, Verify20, approval, contract, or
  bridge fact;
- add a global 500-row limit or an arbitrary subject transaction-info limit;
- raise Incoming or Deep worker concurrency;
- raise TronScan/full-node request capacity, add keys, or bypass cooldowns;
- promise a start-time bound when both Where slots are occupied by monolithic
  jobs.

Verified current behavior that this plan replaces:

- `runWhereIsMoneyCheck` treats every non-`ACCEPTABLE` path, including
  `REVIEW`, as a reason to fetch full transaction-info.
- Incoming supplies a local `15_000 ms` gap; standalone Where supplies a
  separate local delay. The delay may be paid even for an already fetched hash.
- raw `/wallet/gettransactionbyid` is already called for signing metadata, but
  its current API discards contract type, contract address, caller, selector,
  recipient, and amount.
- scheduler pacing/cooldown exists, but raw and transaction-info requests do not
  have versioned in-flight cache keys; transaction-info falls into `default`
  rather than the existing `contract` endpoint bucket.
- Where polling waits for a sequential batch of up to three jobs behind one
  long-lived promise.
- DB claiming already uses `FOR UPDATE SKIP LOCKED` and
  `priority DESC, created_at ASC`, but lacks an `id` tiebreaker.
- stale recovery can requeue a running job while its old worker is alive, and
  current progress/completion writes do not distinguish the old attempt from a
  newly claimed attempt.
- real frozen legacy TXc raw/full responses have not yet been captured. The
  existing Unified TXc fixture is synthetic and is not valid Stage B evidence.

The focused baseline is green:

```text
5 files passed, 290 tests passed
```

for the current Where, config, Tron client, and scheduler suites. Re-run that
baseline at the beginning of execution; do not normalize a new failure as part
of Stage B.

## Fixed implementation decisions

### Evidence identity and storage

No schema migration is required. Reuse `raw_evidence` with immutable,
deterministic provider-response rows:

```ts
type TronTransactionProviderEvidenceV1 = {
  version: "tron-transaction-provider-evidence-v1";
  chain: "tron";
  txHash: string;
  provider: "tron_fullnode" | "tronscan";
  endpoint: "gettransactionbyid" | "transaction-info";
  providerSchemaVersion: 1;
  fetchedAt: string;
  finality: {
    status:
      | "confirmed_success"
      | "confirmed_failed"
      | "confirmed_reverted";
    witnessKind: "indexed_tron_usdt_transfer" | "tronscan_transaction_info";
    witnessSha256: string;
  };
  payloadSha256: string;
  payload: unknown;
};
```

The deterministic ID hashes only the stable identity tuple
`(version, chain, txHash, provider, endpoint, providerSchemaVersion)`. An
existing row is parsed and its identity and payload hash are verified. A
different payload under the same immutable ID is a conflict and fails closed;
transient failures are never stored as provider evidence.

Persist a response only when it is finalized and bound to the requested
transaction. A finalized response is immutable evidence whether its result is
successful, failed, or reverted. Raw evidence additionally requires a confirmed
rich movement witness for that same transaction; full transaction-info requires
its own explicit confirmed/final result. An empty/not-found, pending,
unconfirmed, partial, HTTP-error, timeout, aborted, or identity-unbound response
is unavailable evidence and is not negative-cached. Only
`finality.status === "confirmed_success"` can contribute to
`plain_usdt_raw_proven`. A saved `confirmed_failed` or `confirmed_reverted`
response forces/records route inconsistency and can never be interpreted as
clean; reusing it prevents pointless provider refetches. A finalized immutable
raw transaction may still produce a policy-level `ambiguous` result (for
example multiple contracts); that valid payload may be saved and will
deterministically trigger full enrichment. This avoids freezing a provisional
Incoming response forever under a permanent identity.
`witnessSha256` is the hash of the canonical finality fields used for that
decision, not an operator-supplied assertion, and is verified again when the
saved row is read.

Persist the policy conclusion separately in the same table as
`source_type = 'detector_output'`:

```ts
type TransactionEnrichmentDecisionEvidenceV1 = {
  version: "transaction-enrichment-decision-evidence-v1";
  policyVersion: "selective-transaction-enrichment-v1";
  chain: "tron";
  txHash: string;
  decision:
    | "plain_usdt_raw_proven"
    | "full_transaction_info_confirmed"
    | "confirmed_failed_or_reverted";
  triggerCodes: FullTransactionInfoTrigger[];
  providerEvidenceIds: string[];
  movementWitnessSha256: string;
};
```

Its deterministic ID includes the policy version, transaction, decision,
provider evidence IDs, and movement witness hash. This is where
`plain_usdt_raw_proven` is durably recorded. Failed/unavailable attempts remain
coverage diagnostics and are not reusable success evidence.

### Raw proof boundary

Raw calldata does not prove event count by itself. A plain proof therefore
requires agreement between:

1. one successful `TriggerSmartContract` raw call;
2. the official TRON USDT contract;
3. selector `a9059cbb`;
4. decoded caller, recipient, and uint256 amount; and
5. exactly one rich indexed official-USDT movement for the transaction, with
   matching contract, sender, receiver, amount, final result, and event identity.

If rich movement identity is absent or ambiguous, full transaction-info is
required. A normalized route edge alone is not enough to establish event count.

### Incomplete enrichment vocabulary

Do not alter global scoring status enums. Stage B adds a report-local audit
contract:

```ts
type TransactionEnrichmentCoverageStatus = "complete" | "coverage_incomplete";
type TransactionEnrichmentTechnicalStatus = "proven" | "technical_unknown";
```

When both raw and required full enrichment fail, set these local fields to
`coverage_incomplete` and `technical_unknown`, set existing
`WhereIsMoneyCoverage.partial = true`, add a stable coverage note, and withhold
the unavailable enrichment fact. Do not turn unrelated proven facts into clean
or risky guesses, and do not change the score merely because enrichment is
missing.

A finalized failed/reverted provider response is different from a transport or
provisional failure: persist it, report `coverage_incomplete` with
`technicalStatus: "proven"` and stable reason
`confirmed_failed_or_reverted`, and never treat the conflicting indexed route
movement as clean. Save the corresponding decision evidence after a finalized
full transaction-info result; if only raw is final and the full request is
transiently unavailable, keep the raw provider evidence, retain the hard full
trigger, and report the already-proven inconsistency without negative-caching
the unavailable full response.

### Pacing and bounded work

- raw requests use the existing `fullnode` scheduler bucket;
- transaction-info uses the existing `contract` scheduler bucket;
- existing endpoint/global/account-group intervals remain authoritative;
- the resolver has a small bounded submission loop, default `4`, but the
  scheduler remains the capacity authority;
- no `Promise.all` over an unbounded transaction list;
- hard candidates are processed before optional context;
- subject hard evidence has no arbitrary full-request cap;
- a reusable intermediate-boundary budget returns `incomplete` after five
  triggered full requests, but Stage B does not activate V3 or an inferred stop.

### Queue and restart safety

`started_at` becomes the claim-generation token without adding a column. Every
claim assigns a new millisecond-normalized value that is strictly newer than the
previous value. Every worker-owned progress, release, and completion write uses
`WHERE started_at = claimStartedAt`. This prevents an old worker from completing
a newly reclaimed attempt. Existing stale recovery remains authoritative and
the runner continues periodic `jobHeartbeatAt` updates during long enrichment.
Job-owned wait, index-queue, risk, and derived-assertion writes lock and verify
the same claim inside their own DB transactions before producing side effects.

## File map

### Create

- `src/tron/rawTransactionPreflight.ts`
- `src/storage/transactionEvidenceRepository.ts`
- `src/forensics/selectiveTransactionEnrichment.ts`
- `src/forensics/forensicSlotPump.ts`
- `src/forensics/whereLatencyReplay.ts`
- `scripts/captureWhereLatencyReplay.ts`
- `scripts/runWhereLatencyCanary.ts`
- `tests/tron/rawTransactionPreflight.test.ts`
- `tests/storage/transactionEvidenceRepository.test.ts`
- `tests/forensics/selectiveTransactionEnrichment.test.ts`
- `tests/forensics/forensicSlotPump.test.ts`
- `tests/forensics/whereLatencyReplay.test.ts`
- `tests/scripts/runWhereLatencyCanary.test.ts`
- `tests/scripts/forensicWalletCalibrationRerun.test.ts`
- `tests/fixtures/forensics/txc-legacy-where-latency-v1.json`

### Modify

- `src/types.ts`
- `src/forensics/localTronUsdtIndex.ts`
- `src/forensics/routeSearch.ts`
- `src/check/whereIsMoneyCheck.ts`
- `src/forensics/incomingDepositJob.ts`
- `src/forensics/deepForensicJob.ts`
- `src/forensics/targetedHistoryCoordinator.ts`
- `src/forensics/whereIsMoneyCliArgs.ts`
- `src/tron/tronClient.ts`
- `src/storage/repositories.ts`
- `src/config.ts`
- `src/index.ts`
- `scripts/forensicWhereIsMoney.ts`
- `scripts/forensicWalletCalibrationRerun.ts`
- `tests/forensics/localTronUsdtIndex.test.ts`
- `tests/forensics/routeSearch.test.ts`
- `tests/check/whereIsMoneyCheck.test.ts`
- `tests/forensics/incomingDepositJob.test.ts`
- `tests/forensics/deepForensicJob.test.ts`
- `tests/forensics/whereIsMoneyCliArgs.test.ts`
- `tests/forensics/targetedHistoryCoordinator.test.ts`
- `tests/tron/tronClient.test.ts`
- `tests/tron/tronscanScheduler.test.ts`
- `tests/storage/forensicCheckJobs.test.ts`
- `tests/storage/repositories.test.ts`
- `tests/storage/runtimeDelivery.postgres.test.ts`
- `tests/config/config.test.ts`
- `.env.example`
- `package.json`
- `docs/knowledge/03-job-lifecycle.md`
- `docs/knowledge/04-data-sources-tronscan-indexing.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/12-runbooks.md`

## Task 1: Freeze a real legacy TXc replay before changing behavior

**Files:**

- Create: `src/forensics/whereLatencyReplay.ts`
- Create: `scripts/captureWhereLatencyReplay.ts`
- Create: `tests/forensics/whereLatencyReplay.test.ts`
- Create: `tests/fixtures/forensics/txc-legacy-where-latency-v1.json`
- Modify: `src/tron/tronClient.ts`
- Modify: `tests/tron/tronClient.test.ts`
- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/addressLabelAssertions.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a failing strict replay-envelope test**

Define a canonical, versioned envelope that contains the baseline Git commit,
the hash of the resolved non-secret runtime options, the exact legacy job
window/options, a frozen clock ISO value, every dependency request/response observed by Where, raw/full
provider responses, baseline request counts, and the stable expected report
projection. The capture must exclude API keys, DB URLs, chat IDs, Telegram IDs,
and request headers.

Do not maintain an allowlist of selected facts. The stable projection is the
canonical **entire semantic report** with only the new Stage B operational audit
field removed:

```ts
export type StableWhereFactsV1 = Omit<
  WhereIsMoneyReport,
  "transactionInfoEnrichment"
>;
```

The frozen clock makes semantic timestamps deterministic. Canonicalize only
arrays whose existing contract is explicitly order-insensitive, using their
stable IDs or `(txHash, eventIndex, address)` identity. Keep and compare
`coverage`, `coverageV2`, `decisionReasons`, `fastWalletRisk`,
`sourceProvenanceMateriality`, `crossChainCorridor`, `riskCaseFile`, and all
other report fields. Provider counters/timings live under the omitted Stage B
audit field and are asserted separately. A field may be added to the omission
list only with a written reason and a failing nondeterminism test.

Test these failure modes:

- unsupported version/schema;
- duplicate canonical dependency request;
- missing response;
- payload SHA-256 mismatch;
- noncanonical JSON;
- a forbidden secret/header field anywhere in the envelope;
- missing or mismatched baseline Git commit/resolved-config hash;
- missing rich indexed movements for a frozen candidate hash;
- missing assertion-query tape entry, including when the correct result is an
  explicitly recorded empty array;
- missing supplemental full transaction-info tape entry for any route-critical
  hash, even when legacy Where did not request that hash;
- a changed stable fact.

- [ ] **Step 2: Prove RED**

First prove the unchanged focused baseline:

```bash
npx vitest run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 tests/check/whereIsMoneyCheck.test.ts tests/config/config.test.ts tests/tron/tronscanScheduler.test.ts tests/tron/tronClient.test.ts tests/forensics/forensicJobBatch.test.ts
```

Expected: 5 files and 290 tests pass on the stated baseline. Then run the new
test:

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/forensics/whereLatencyReplay.test.ts
```

Expected: FAIL because the replay parser and stable-fact projector do not exist.

- [ ] **Step 3: Implement the strict recorder/replayer**

Use `src/forensics/canonicalJson.ts` and Node `createHash("sha256")`; do not add a
serialization dependency. Expose:

```ts
export function parseWhereLatencyReplayV1(bytes: string): WhereLatencyReplayV1;
export function buildWhereLatencyReplayV1(input: BuildWhereLatencyReplayInput): {
  envelope: WhereLatencyReplayV1;
  canonicalJson: string;
};
export function projectStableWhereFacts(report: WhereIsMoneyReport): StableWhereFactsV1;
export function createWhereReplayDeps(replay: WhereLatencyReplayV1): WhereIsMoneyDeps;
```

The dependency tape key is a canonical hash of `{ method, args }`. A second call
with the same key reuses the same recorded response. A call absent from the tape
throws `where_latency_replay_request_missing`; replay never falls through to a
live provider or DB.

- [ ] **Step 4: Add the scheduler-backed raw getter without wiring it into Where**

Extend `FetchJsonOptions` with `schedulerCacheKey?: string`, prefer that key in
`fetchJsonOnce`, and add `getRawTransaction(txHash)`. Its key is:

```ts
`${this.schedulerDedupeNamespace}:tron:raw_transaction:v1:${txHash}`
```

Write client tests for exact hash/body binding, same-hash concurrent dispatch
dedupe, different-hash separation on the shared POST URL, and `fullnode` bucket
ownership. Existing runtime call sites remain unchanged in Task 1.

- [ ] **Step 5: Add the read-only rich assertion snapshot query**

Add `listActiveAddressLabelAssertionsForRoute(db, { chain, addresses,
txHashes })` now, before capture, without wiring it into legacy decisions. Use
the safe `CASE ... ELSE '[]'::jsonb` expansion specified in Task 4. Test active,
inactive, exact scalar-hash, array-hash, malformed JSON shapes, and an exact
empty result against PostgreSQL. This makes the pre-change assertion snapshot
use the same repository contract that Stage B later consumes.

- [ ] **Step 6: Add and test the capture command while legacy behavior is intact**

Add:

```json
"forensic:where-latency:capture": "node --import tsx scripts/captureWhereLatencyReplay.ts"
```

The command automatically selects the latest completed
`where_is_money_check` for the supplied address, reuses its exact window and
options, wraps every dependency used by `runWhereIsMoneyCheck`, records public
responses, re-runs the legacy checker, compares its stable projection with the
saved completed report, and writes with `{ flag: "wx" }` so it cannot overwrite
an existing fixture.

Legacy Where does not call raw preflight, so dependency recording alone is not
enough. Before any Stage B behavior change, add a public
`TronscanClient.getRawTransaction(txHash)` method that uses the existing
`fullnode` scheduler bucket and a versioned hash-specific scheduler cache key;
do not wire it into legacy Where yet. After the legacy run, collect every unique
route-critical transaction hash from selected balance transfers, origin path
steps, approval/contract profiles, unresolved economic-role inputs, and every
legacy full transaction-info request. Do not fetch raw data for unrelated rows
that were merely returned on a history page. Unit-test the collector as a
conservative superset of the Stage B candidate fixtures. Fetch and bind a raw
response for every collected hash, validate its normalized `txID` against the
requested hash, and store it in the replay tape. The capture fails if a route
candidate lacks a raw tape entry; it never postpones raw capture until after
Stage B is implemented.

Stage B can discover a new hard trigger from raw calldata, multiple rich
movements, or an exact rich assertion for a hash that legacy Where never sent to
transaction-info. Therefore also fetch and bind full transaction-info for every
route-critical hash while the legacy baseline is still frozen. Mark each tape
entry as `legacy_observed` or `supplemental_stage_b_fixture`; keep baseline
request counts restricted to requests actually made by the legacy checker.
Supplemental fixture collection is scheduler-paced preparation, not a baseline
request and not a post-change cache hit. The capture fails closed if any
route-critical hash lacks this full tape entry, so the offline Stage B replay
cannot silently turn a newly discovered hard trigger into missing evidence.

For the same frozen hash/address set, capture complete
`listIndexedTronUsdtTransfersByHashes` rows before they are normalized and the
exact `listActiveAddressLabelAssertionsForRoute` result. Persist an explicit
empty array when no active route-linked assertion exists. Replay dependencies
serve these frozen rows only and throw on an unseen hash/address set; they never
query the live DB. This preserves `transferId`, `eventIndex`, provider ordinal,
caller, finality/result fields, and the negative assertion fact required to
prove `plain_usdt_raw_proven` offline.

Run:

```bash
npm run forensic:where-latency:capture -- --source TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd --out tests/fixtures/forensics/txc-legacy-where-latency-v1.json
```

Then verify:

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/forensics/whereLatencyReplay.test.ts tests/tron/tronClient.test.ts tests/storage/addressLabelAssertions.test.ts
rg -ni "api[_-]?key|authorization|database_url|chat[_-]?id|telegram|cookie" tests/fixtures/forensics/txc-legacy-where-latency-v1.json
```

Expected: replay test PASS; secret scan has no matches. Public wallet addresses
and transaction hashes are expected and are not secrets.

If the live credentials or a completed TXc legacy job are unavailable, do not
invent a fixture and do not substitute the synthetic Unified replay. Record this
gate in `docs/knowledge/10-open-problems.md`. The remaining code can be developed
with synthetic tests and default Where concurrency `1`, but Stage B cannot be
released or promoted to concurrency `2` until this real fixture exists.
Commit the recorder/parser separately while legacy behavior is still present
and record that commit hash. Later capture from a worktree pinned to that hash;
never capture the supposed “before” projection by running the post-Stage-B
checker.

- [ ] **Step 7: Commit the frozen baseline**

When capture succeeded:

```bash
git add src/forensics/whereLatencyReplay.ts scripts/captureWhereLatencyReplay.ts tests/forensics/whereLatencyReplay.test.ts tests/fixtures/forensics/txc-legacy-where-latency-v1.json src/tron/tronClient.ts tests/tron/tronClient.test.ts src/storage/repositories.ts tests/storage/addressLabelAssertions.test.ts package.json
git commit -m "test(forensics): freeze legacy TXc latency replay"
```

When capture is externally blocked, commit only the harness and retain the
release blocker:

```bash
git add src/forensics/whereLatencyReplay.ts scripts/captureWhereLatencyReplay.ts tests/forensics/whereLatencyReplay.test.ts src/tron/tronClient.ts tests/tron/tronClient.test.ts src/storage/repositories.ts tests/storage/addressLabelAssertions.test.ts package.json docs/knowledge/10-open-problems.md
git commit -m "test(forensics): add legacy latency replay harness"
git rev-parse HEAD
```

## Task 2: Preserve rich transaction-movement identity through route edges

**Files:**

- Modify: `src/types.ts`
- Modify: `src/forensics/localTronUsdtIndex.ts`
- Modify: `src/forensics/routeSearch.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `scripts/forensicWhereIsMoney.ts`
- Modify: `tests/forensics/localTronUsdtIndex.test.ts`
- Modify: `tests/forensics/routeSearch.test.ts`
- Modify: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Write failing identity-preservation and dedupe tests**

Cover:

- indexed `transferId`, `eventIndex`, `provider`, `providerRowOrdinalInTx`, caller,
  contract, final result, confirmation, and reverted status survive conversion;
- two same-hash/same-from/same-to/same-amount movements with different event
  indexes remain two movements;
- the same indexed movement from duplicate branches is still deduplicated;
- a live normalized edge without event identity remains valid but is marked
  insufficient for a raw-only one-movement proof.

- [ ] **Step 2: Prove RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/forensics/localTronUsdtIndex.test.ts tests/forensics/routeSearch.test.ts tests/check/whereIsMoneyCheck.test.ts
```

Expected: FAIL because `ForensicRouteEdge` drops rich indexed identity and the
legacy tuple dedupe collapses distinct events.

- [ ] **Step 3: Extend the route-edge type with optional provenance fields**

Add optional fields so existing live/provider test edges remain compatible:

```ts
export type ForensicRouteEdge = {
  // existing fields stay unchanged
  transferId?: string | null;
  eventIndex?: number | null;
  provider?: string | null;
  providerRowOrdinalInTx?: number | null;
  callerAddress?: string | null;
  contractAddress?: string | null;
  contractRet?: string | null;
  finalResult?: string | null;
  confirmed?: boolean | null;
  reverted?: boolean | null;
};
```

Populate them in `indexedTransferToRouteEdge`; because this index is explicitly
official-USDT-only, it may set `contractAddress` to the existing official-USDT
constant. Populate only what a live row actually proves in `normalizeTransfer`;
never manufacture an event index or official contract identity for an unknown
row.

- [ ] **Step 4: Replace tuple-only dedupe with one shared event identity helper**

Keep the helper in `src/forensics/localTronUsdtIndex.ts` and reuse it from the
checker and CLI:

```ts
export function forensicRouteEdgeIdentity(edge: ForensicRouteEdge): string {
  if (edge.transferId) return `transfer:${edge.transferId}`;
  if (edge.eventIndex !== null && edge.eventIndex !== undefined) {
    return `event:${edge.txHash}:${edge.eventIndex}`;
  }
  if (edge.provider && edge.providerRowOrdinalInTx !== null && edge.providerRowOrdinalInTx !== undefined) {
    return `provider:${edge.provider}:${edge.txHash}:${edge.providerRowOrdinalInTx}`;
  }
  return `legacy:${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`;
}
```

The `legacy:` fallback supports old/live rows but is never evidence of exactly
one emitted movement.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/forensics/localTronUsdtIndex.test.ts tests/forensics/routeSearch.test.ts tests/check/whereIsMoneyCheck.test.ts
npm run typecheck
git add src/types.ts src/forensics/localTronUsdtIndex.ts src/forensics/routeSearch.ts src/check/whereIsMoneyCheck.ts scripts/forensicWhereIsMoney.ts tests/forensics/localTronUsdtIndex.test.ts tests/forensics/routeSearch.test.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "refactor(forensics): preserve route event identity"
```

## Task 3: Add canonical raw preflight and scheduler-backed exact request keys

**Files:**

- Create: `src/tron/rawTransactionPreflight.ts`
- Create: `tests/tron/rawTransactionPreflight.test.ts`
- Modify: `src/tron/tronClient.ts`
- Modify: `tests/tron/tronClient.test.ts`
- Modify: `tests/tron/tronscanScheduler.test.ts`

- [ ] **Step 1: Write failing raw parser tests**

Use fixture objects matching the full-node `gettransactionbyid` shape. Cover:

- one successful `TriggerSmartContract` call to official USDT;
- selector extraction and ABI decoding of recipient/uint256 amount;
- caller and contract conversion from `41...` hex to canonical Base58;
- non-USDT contract;
- `transferFrom`, permit, Verify20, unknown selector;
- multiple raw contracts;
- malformed hex, short calldata, missing caller/contract, failed/reverted result;
- a valid transaction with insufficient fields returns an explicit ambiguous
  result rather than throwing or looking clean.

The parser result is a discriminated union:

```ts
export type RawTransactionPreflightV1 =
  | {
      status: "parsed";
      contractType: string;
      contractAddress: string;
      selector: string;
      callerAddress: string;
      recipientAddress: string | null;
      amountRaw: string | null;
      successful: boolean;
      rawContractCount: number;
    }
  | { status: "ambiguous"; reason: string };
```

- [ ] **Step 2: Prove RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/tron/rawTransactionPreflight.test.ts
```

Expected: FAIL because the raw preflight module does not exist.

- [ ] **Step 3: Implement the parser with TronWeb and strict validation**

Use the installed `tronweb` dependency. Accept only exact known raw shapes;
normalize selectors to lowercase eight-hex characters; parse amounts through
`BigInt`; return ambiguity for extra/missing contracts. Do not reuse signing
metadata as a substitute for the raw payload.

- [ ] **Step 4: Extend the client/scheduler tests for the full endpoint**

Add tests that prove:

- the Task 1 `getRawTransaction(txHash)` behavior remains unchanged;
- two simultaneous calls for the same raw identity dispatch once;
- two simultaneous calls for the same transaction-info identity dispatch once;
- raw and full for the same hash remain two distinct identities;
- different hashes do not collide, especially for the POST endpoint;
- transaction-info uses the existing `contract` bucket;
- raw uses `fullnode`;
- a 429 opens scheduler cooldown and does not busy-loop;
- account-group/key independence is unchanged.

- [ ] **Step 5: Reuse the explicit key seam for transaction-info**

Task 1 already added `FetchJsonOptions.schedulerCacheKey`. Keep it before the
existing transfer fallback:

```ts
cacheKey: options.schedulerCacheKey
  ?? (requestName === "transfer" ? `${this.schedulerDedupeNamespace}:${url.toString()}` : undefined)
```

Pass versioned keys from both transaction methods:

```ts
`${this.schedulerDedupeNamespace}:tron:raw_transaction:v1:${txHash}`
`${this.schedulerDedupeNamespace}:tron:transaction_info:v1:${txHash}`
```

Validate and normalize the hash before constructing either key. Map
`tronscan_transaction_info` into `contract` in `endpointBucketForRequest`.
Do not add a new endpoint bucket or a new capacity setting.

- [ ] **Step 6: Keep signing metadata compatible**

Refactor `getTransactionSigningMetadata` to call `getRawTransaction` and project
the existing timestamp/ref-block result. Existing signing tests must remain
unchanged except for the scheduler-aware mock setup.

- [ ] **Step 7: Verify and commit**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/tron/rawTransactionPreflight.test.ts tests/tron/tronClient.test.ts tests/tron/tronscanScheduler.test.ts
npm run typecheck
git add src/tron/rawTransactionPreflight.ts src/tron/tronClient.ts tests/tron/rawTransactionPreflight.test.ts tests/tron/tronClient.test.ts tests/tron/tronscanScheduler.test.ts
git commit -m "feat(tron): add scheduled transaction preflight"
```

## Task 4: Add immutable provider evidence and exact route-linked assertion lookup

**Files:**

- Create: `src/storage/transactionEvidenceRepository.ts`
- Create: `tests/storage/transactionEvidenceRepository.test.ts`
- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/addressLabelAssertions.test.ts`

- [ ] **Step 1: Write failing repository contract tests**

Test both a lightweight fake DB and the existing PostgreSQL test gate:

- deterministic identity produces the same ID across jobs/restarts;
- raw and full identities produce different IDs;
- insert uses `source_type = 'provider_response'` and `ON CONFLICT DO NOTHING`;
- reading verifies source, chain, tx hash, schema, endpoint, identity, and
  `payloadSha256`;
- an existing mismatched/corrupt row fails closed with
  `transaction_provider_evidence_conflict`;
- transient error objects cannot be saved;
- empty/not-found/unbound provider payloads cannot be saved;
- provisional, unconfirmed, and partial payloads cannot be saved under the
  permanent evidence identity;
- finalized successful, failed, and reverted payloads are saved with distinct
  finality status; only successful evidence is eligible for raw-plain proof;
- re-reading saved failed/reverted evidence performs no provider refetch and can
  never return a clean/plain decision;
- a valid saved raw payload may parse to a policy-level ambiguity without being
  mistaken for a transient failure;
- concurrent inserts converge to one immutable row;
- a deterministic decision-evidence row durably records
  `plain_usdt_raw_proven`, its provider evidence ID, and movement witness hash;
- no migration is expected.

- [ ] **Step 2: Prove RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/storage/transactionEvidenceRepository.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement immutable read/insert/read-back**

Use `canonicalizeArtifactJson` and Node SHA-256. Export only the minimal API:

```ts
export function transactionProviderEvidenceId(identity: TransactionProviderEvidenceIdentityV1): string;
export async function getTransactionProviderEvidence(
  db: Db,
  identity: TransactionProviderEvidenceIdentityV1
): Promise<TronTransactionProviderEvidenceV1 | null>;
export async function saveTransactionProviderEvidence(
  db: Db,
  evidence: TronTransactionProviderEvidenceV1
): Promise<{ id: string; evidence: TronTransactionProviderEvidenceV1 }>;
export async function saveTransactionEnrichmentDecisionEvidence(
  db: Db,
  evidence: TransactionEnrichmentDecisionEvidenceV1
): Promise<{ id: string; evidence: TransactionEnrichmentDecisionEvidenceV1 }>;
```

`save` performs `INSERT ... ON CONFLICT DO NOTHING`, reads the final row back,
and validates it. It never overwrites evidence JSON.
Add the parallel minimal save/read parser for
`TransactionEnrichmentDecisionEvidenceV1`; it uses `detector_output`, never
masquerades as a provider response, and follows the same immutable conflict
rule.

- [ ] **Step 4: Write failing exact route-link policy matching tests**

Task 1 already added and froze the read-only active-assertion query. Here, add
pure selective-policy matching tests: live validation may be triggered only
when the returned rich `evidenceJson` contains an exact current
transaction/path link, such as `approvalTxHash`, `drainTxHash`,
`pathTxHashes`, and corresponding route addresses. Cover:

- exact approval/drain transaction match;
- exact Verify20/contract assertion match;
- route-linked path transaction match;
- inactive/retired/false-positive assertion ignored;
- assertion for another chain/address/path ignored;
- flat `address_labels` entry alone ignored;
- category/name/label text without exact evidence ignored.

- [ ] **Step 5: Reuse and harden the Task 1 active-assertion query**

Use the existing `src/storage/repositories.ts` contract; do not add a second
query or a parallel assertion source:

```ts
export async function listActiveAddressLabelAssertionsForRoute(
  db: Db,
  input: { chain: "tron"; addresses: string[]; txHashes: string[] }
): Promise<AddressLabelAssertion[]>;
```

If Task 1 did not already enforce any of the following, harden it now.
Deduplicate and validate addresses and hashes before the SQL query. Filter
`status = 'active'` and retain a row only when its assertion address is in the
route or its exact `approvalTxHash`, `drainTxHash`, or `pathTxHashes` JSON value
matches a route hash. Order by `id`, then repeat strict transaction/address/path
matching in the selective policy module. Do not infer authority from the
derived flat label table. Guard every JSON array expansion with
an explicit normalized expression, because SQL `AND` evaluation order is not a
short-circuit guarantee:

```sql
jsonb_array_elements_text(
  case
    when jsonb_typeof(evidence_json->'pathTxHashes') = 'array'
      then evidence_json->'pathTxHashes'
    else '[]'::jsonb
  end
)
```

Malformed scalar, object, JSON null, and missing assertion evidence is ignored
and must not make the query throw. Exercise all four shapes against real
PostgreSQL, not only a query-string fake.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/storage/transactionEvidenceRepository.test.ts tests/storage/addressLabelAssertions.test.ts
npm run typecheck
git add src/storage/transactionEvidenceRepository.ts src/storage/repositories.ts tests/storage/transactionEvidenceRepository.test.ts tests/storage/addressLabelAssertions.test.ts
git commit -m "feat(storage): persist exact transaction evidence"
```

## Task 5: Implement the eight-trigger selective enrichment policy

**Files:**

- Create: `src/forensics/selectiveTransactionEnrichment.ts`
- Create: `tests/forensics/selectiveTransactionEnrichment.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write the complete failing decision matrix**

Use one independent test for every approved full-fetch trigger:

```ts
export type FullTransactionInfoTrigger =
  | "non_official_usdt_contract"
  | "non_plain_transfer_selector"
  | "non_plain_transfer_method"
  | "multiple_official_usdt_movements"
  | "raw_edge_mismatch"
  | "unresolved_economic_role"
  | "exact_route_linked_assertion"
  | "raw_unavailable_or_ambiguous";
```

For trigger 5, do not collapse all mismatch checks into one test. Independently
prove that caller, contract, event identity/type, sender, receiver, amount,
confirmation, reverted status, `contractRet`, and `finalResult` unknown/mismatch
each prevents raw-only proof and forces full enrichment.

Also cover these negative and failure cases:

- exact raw + exactly one rich plain official-USDT movement + no adverse
  assertion returns `plain_usdt_raw_proven` and makes zero full calls;
- `REVIEW`, `unknown`, service-likelihood, and flat labels alone make zero full
  calls;
- identical hashes from multiple paths/branches are scheduled once;
- raw saved evidence is reused without a provider call;
- full saved evidence is reused without a provider call;
- simultaneous jobs share one in-process promise per exact evidence identity;
- raw failure falls back to full;
- raw ambiguity forces full;
- a finalized raw failed/reverted result is persisted, forces full, and cannot
  prove a plain transfer;
- a finalized full failed/reverted result is persisted, returns
  `coverage_incomplete` / `proven` with decision
  `confirmed_failed_or_reverted`, and is reused without another provider call;
- both raw and full transient/unavailable failures return `coverage_incomplete` /
  `technical_unknown`, never `plain_usdt_raw_proven`;
- a corrupt saved row fails closed;
- aborting one resolver call while a shared raw request is already in flight
  allows that shared immutable request to settle/persist for other waiters, but
  the aborted caller attaches no result and dispatches neither a full fallback
  nor the next candidate;
- hard candidates are dispatched before optional candidates;
- bounded workers never exceed four submissions and still leave endpoint
  capacity to the scheduler;
- subject mode never drops a hard trigger because of a numeric cap;
- intermediate-boundary mode permits at most five triggered full calls, returns
  `adverseGate: "incomplete"`, `inferredStopAllowed: false`, and preserves a
  `continueTraversal: true` outcome for overflow; overflow candidate IDs and
  trigger reasons remain recorded as missing evidence rather than being dropped
  or interpreted as clean.

- [ ] **Step 2: Prove RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/forensics/selectiveTransactionEnrichment.test.ts
```

Expected: FAIL because the resolver and policy do not exist.

- [ ] **Step 3: Implement pure candidate construction first**

The candidate builder accepts route edges plus the rich indexed movements for
their hashes. It deduplicates by normalized tx hash and returns deterministic
hard-first order. Its decision must not call a provider.

An exact plain proof requires all of these checks:

```ts
const rawPlain =
  raw.status === "parsed" &&
  raw.successful === true &&
  raw.contractType === "TriggerSmartContract" &&
  raw.contractAddress === TRON_USDT_CONTRACT_ADDRESS &&
  raw.selector === "a9059cbb" &&
  raw.rawContractCount === 1;

const movementPlain =
  movements.length === 1 &&
  movements[0].eventIndex !== null &&
  movements[0].confirmed === true &&
  movements[0].reverted === false &&
  movements[0].contractRet === "SUCCESS" &&
  movements[0].finalResult === "SUCCESS" &&
  fieldsAgree(raw, movements[0]);
```

Unknown finality/result fields are not equivalent to success. They trigger full
enrichment. A non-final full response is unavailable, is not persisted, and
produces incomplete/technical-unknown coverage. A finalized failed/reverted full
response is persisted and produces incomplete/technical-proven coverage with
`confirmed_failed_or_reverted`; it is never clean. Only a finalized successful
full response enters the normal full-confirmation branch.

The actual code should use named helpers for stable reason reporting, but it
must not create a generic rules engine.

- [ ] **Step 4: Implement one shared resolver with saved and in-flight reuse**

Expose a factory whose returned instance is shared by the runtime:

```ts
export function createSelectiveTransactionEnricher(deps: {
  getSavedEvidence(identity: TransactionProviderEvidenceIdentityV1): Promise<TronTransactionProviderEvidenceV1 | null>;
  saveProviderEvidence(evidence: TronTransactionProviderEvidenceV1): Promise<{ id: string }>;
  saveDecisionEvidence(evidence: TransactionEnrichmentDecisionEvidenceV1): Promise<{ id: string }>;
  getRawTransaction(txHash: string): Promise<unknown>;
  getFullTransactionInfo(txHash: string): Promise<unknown>;
  now(): Date;
  maxConcurrentSubmissions?: number;
}): SelectiveTransactionEnricher;

type SelectiveTransactionEnricher = {
  enrich(
    input: SelectiveTransactionEnrichmentInput,
    options?: { signal?: AbortSignal }
  ): Promise<SelectiveTransactionEnrichmentResult>;
};
```

Keep a process-level `Map<evidenceId, Promise<ResolvedEvidence>>`. Remove settled
promises in `finally`; durable reuse comes from `raw_evidence`, not an unbounded
memory cache. The client scheduler provides the second in-flight safety layer.

Use a small worker loop over the deterministic candidate array. `Promise.all`
over only the fixed worker array is allowed; `Promise.all(candidates.map(...))`
is not.

The per-run `AbortSignal` is an authority/cancellation boundary. Check it before
dequeueing each candidate, before raw dispatch, before full fallback, and after
every await before attaching a result. Do not pass that caller-specific signal
into an underlying shared in-flight provider promise: another current job may
still own that exact request, and a finalized response remains safe to persist.
On abort, stop all workers from taking new candidates and reject the caller with
`selective_transaction_enrichment_aborted`; the job runner translates a lost
claim to `lost_forensic_job_claim`. CLI/non-job callers may omit the signal.

- [ ] **Step 5: Add report-local audit types**

Add an optional `transactionInfoEnrichment` summary to `WhereIsMoneyReport`:

```ts
export type WhereTransactionInfoEnrichmentSummary = {
  policyVersion: "selective-transaction-enrichment-v1";
  coverageStatus: "complete" | "coverage_incomplete";
  technicalStatus: "proven" | "technical_unknown";
  candidateCount: number;
  hardCandidateCount: number;
  rawProviderRequests: number;
  fullProviderRequests: number;
  savedEvidenceHits: number;
  inFlightHits: number;
  schedulerAwaitMs: number;
  evidenceIds: string[];
  decisions: TransactionEnrichmentDecisionV1[];
};
```

Keep every hard decision/evidence ID auditable. Do not include provider payloads
inside the report; those stay in `raw_evidence`. `evidenceIds` contains both the
exact provider-response IDs and the successful policy decision-evidence IDs, so
`plain_usdt_raw_proven` survives report/job boundaries.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/forensics/selectiveTransactionEnrichment.test.ts
npm run typecheck
git add src/forensics/selectiveTransactionEnrichment.ts tests/forensics/selectiveTransactionEnrichment.test.ts src/types.ts
git commit -m "feat(forensics): select transaction enrichment by evidence"
```

## Task 6: Integrate selective enrichment across Where and Incoming

**Files:**

- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `src/forensics/whereIsMoneyCliArgs.ts`
- Modify: `scripts/forensicWhereIsMoney.ts`
- Modify: `scripts/forensicWalletCalibrationRerun.ts`
- Create: `tests/scripts/forensicWalletCalibrationRerun.test.ts`
- Modify: `src/index.ts`
- Modify: `tests/check/whereIsMoneyCheck.test.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`
- Modify: `tests/forensics/whereIsMoneyCliArgs.test.ts`

- [ ] **Step 1: Replace the old REVIEW-wide test with failing Stage B behavior tests**

Add integrated tests proving:

- a path whose only reason is `REVIEW` performs raw proof and skips full details
  when plain;
- every hard trigger still reaches the existing approval/GasFree/contract
  parsers with full transaction-info;
- exact rich drainer/approval/Verify20 assertions request live confirmation;
- flat labels do not;
- balance-forming, money-origin, approval, and Incoming economic-context paths
  share the same evidence resolver and tx-hash dedupe;
- existing GasFree principal/fee allocation is unchanged;
- existing approval-drain and contract-driven facts are unchanged;
- double provider failure sets `coverage.partial`, the new local incomplete
  summary, and a stable note; it does not publish a clean enrichment fact;
- completed Where jobs persist the resolver evidence IDs in
  `rawEvidenceIds`;
- completed Incoming jobs persist the same resolver evidence IDs instead of the
  current empty array;
- the wallet-calibration rerun uses the same resolver/scheduler path and has no
  private 2-second transaction-info delay;
- when a heartbeat/progress CAS reports claim loss during a delayed raw request,
  the runner aborts its resolver call; after that shared request settles, the
  stale attempt dispatches no full fallback and no next-candidate request.

- [ ] **Step 2: Prove RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/whereIsMoneyCliArgs.test.ts tests/scripts/forensicWalletCalibrationRerun.test.ts
```

Expected: FAIL because the old local caches, candidate selector, and local sleep
remain active.

- [ ] **Step 3: Replace both Where transaction caches and the local serial sleep**

Remove the report-local full transaction cache, the second approval cache,
`transactionInfoQueue`, and every checker-level delay. Route all economic-role
and approval enrichment through one `SelectiveTransactionEnricher` supplied in
the dependency contract.

Do not merely patch `selectApprovalEnrichmentEdges`: the earlier
balance-forming/money-origin economic resolver and Incoming's outer resolver
currently fetch full details too, so they must use the same selective path.
`scripts/forensicWalletCalibrationRerun.ts` is also a real legacy Where caller;
replace its direct `getTransaction` plus `2_000 ms` option with the shared
resolver factory and cover it with a script-level dependency test.

- [ ] **Step 4: Preserve hard evidence while narrowing optional work**

Change selection semantics as follows:

- hard trigger candidates are always included;
- `maxApprovalCandidates` may limit optional analyst context only;
- `maxContractTransactionInfoFetches` may limit explicitly requested optional
  CLI context only; it never drops a hard trigger;
- production subject jobs pass no numeric full-request cap;
- `approvalEnrichmentMode: "off"` may disable optional approval exploration but
  may not suppress an exact saved adverse assertion already linked to the route.

- [ ] **Step 5: Make the CLI delay flag a scheduler override, not a per-item sleep**

Keep CLI syntax compatible, but change absent defaults:

```ts
maxContractTransactionInfoFetches: number | null;
contractTransactionInfoMinIntervalMs: number | null;
```

When the delay flag is absent, use central
`TRONSCAN_CONTRACT_REQUEST_MIN_INTERVAL_MS`. When explicitly present, use the
larger of the central interval and the requested value for the CLI-owned
`contract` scheduler bucket. A CLI value can make pacing slower but cannot
bypass the configured safety floor. Update usage text to describe it as an
endpoint pacing override. Remove the old 15-second default.

- [ ] **Step 6: Build one runtime resolver instance**

In `src/index.ts`, construct one resolver from the existing singleton `db`,
`tronClient`, and scheduler-backed client methods. Pass the same instance into
Where and Incoming/Deep code paths. Query rich indexed rows by deduplicated
transaction hashes before candidate decisions, and query active rich assertions
only for addresses already in the route candidate set.

- [ ] **Step 7: Persist audit and heartbeat progress**

Merge the enrichment summary into report/progress. During a long candidate run,
write `jobHeartbeatAt` no more frequently than once every 30 seconds and on the
final candidate. A lost claim-generation CAS stops further job writes and lets
the old worker finish only its already-started shared provider await; it cannot
publish or deliver. Create one `AbortController` per claimed job, pass its signal
to every resolver call, and abort it as soon as any heartbeat/progress CAS
returns false. The resolver checks the signal after that await and starts no full
fallback or next candidate. Do not abort the shared underlying provider promise;
it may settle and persist exact immutable evidence for a different waiter.
Deduplicate `transactionInfoEnrichment.evidenceIds` into both Where and Incoming
completion `rawEvidenceIds`; preserve each mode's pre-existing raw evidence IDs
as well.

- [ ] **Step 8: Verify focused regressions and commit**

```bash
npx vitest run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 tests/check/whereIsMoneyCheck.test.ts tests/forensics/selectiveTransactionEnrichment.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/whereIsMoneyCliArgs.test.ts tests/scripts/forensicWalletCalibrationRerun.test.ts tests/tron/tronClient.test.ts tests/tron/tronscanScheduler.test.ts
npm run typecheck
git add src/check/whereIsMoneyCheck.ts src/forensics/incomingDepositJob.ts src/forensics/deepForensicJob.ts src/forensics/whereIsMoneyCliArgs.ts scripts/forensicWhereIsMoney.ts scripts/forensicWalletCalibrationRerun.ts src/index.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/whereIsMoneyCliArgs.test.ts tests/scripts/forensicWalletCalibrationRerun.test.ts
git commit -m "refactor(forensics): use selective transaction evidence"
```

## Task 7: Fence every forensic job write to its claim generation

**Files:**

- Modify: `src/storage/repositories.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `src/forensics/targetedHistoryCoordinator.ts`
- Modify: `src/runtime/forensicRuntimeOrchestration.ts`
- Modify: `src/index.ts`
- Modify: `tests/storage/forensicCheckJobs.test.ts`
- Modify: `tests/storage/repositories.test.ts`
- Modify: `tests/storage/runtimeDelivery.postgres.test.ts`
- Modify: `tests/forensics/targetedHistoryCoordinator.test.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Write the stale-worker race as a failing PostgreSQL test**

The test must execute this exact sequence:

1. worker A claims job J and keeps `startedAt = tokenA`;
2. stale recovery requeues J;
3. worker B claims J and receives `tokenB`, where `tokenB !== tokenA`;
4. worker A attempts progress, waiting release, completion, and failure writes;
5. worker A also attempts to upsert a targeted-history wait, queue index work,
   save risk evidence, save a derived label assertion, and record Incoming
   transaction risk;
6. every A mutation returns a lost-claim result and cannot alter B's job or any
   authoritative downstream table;
7. A's resolver signal is aborted; after an already-running shared provider
   promise settles, A dispatches no full fallback and no next raw/full request;
8. worker B completes once with token B;
9. exactly one pending Telegram delivery remains.

Also add deterministic tie-order coverage for equal priority and `created_at`.
Add one more race assertion: stale recovery executed immediately after a fresh
claim must not requeue that claim because the claim transaction refreshes
`jobHeartbeatAt` atomically.

- [ ] **Step 2: Prove RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 tests/storage/forensicCheckJobs.test.ts tests/storage/repositories.test.ts tests/storage/runtimeDelivery.postgres.test.ts
```

Expected: FAIL because completion currently checks only ID/status and claim order
lacks an ID tiebreaker.

- [ ] **Step 3: Make `started_at` a strictly advancing, JS-safe token**

Compute one millisecond clock value in the claim CTE, select the next job with:

```sql
order by priority desc, created_at asc, id asc
```

derive `claim_started_at` with:

```sql
greatest(
  claim_clock.now_ms,
  coalesce(
    date_trunc('milliseconds', job.started_at) + interval '1 millisecond',
    claim_clock.now_ms
  )
)
```

and atomically set both:

```sql
started_at = next_job.claim_started_at,
progress_json = job.progress_json || jsonb_build_object(
  'jobHeartbeatAt',
  to_char(next_job.claim_started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
```

Do not null `started_at` when stale recovery requeues a job. Millisecond
normalization ensures the `Date` returned through `pg` round-trips exactly;
`greatest(... previous + 1 ms)` ensures a rapid release/reclaim still changes
the token. Refreshing the heartbeat in the same claim statement prevents stale
recovery from observing a new `running` row with the previous attempt's stale
heartbeat. Add a PostgreSQL regression row whose pre-existing `started_at` has
microseconds and prove the returned token still round-trips through a JavaScript
`Date` and passes its own CAS.

- [ ] **Step 4: Add `claimStartedAt` to every worker-owned mutation**

Update repository inputs and SQL:

```ts
type ForensicJobClaimMutation = {
  id: string;
  claimStartedAt: Date;
};
```

Use `AND started_at = $claimStartedAt` for:

- `updateForensicCheckJobProgress`;
- the parent lock inside `upsertForensicJobWait`;
- the running branch of `releaseForensicCheckJobToWaiting`;
- its idempotent queued/waiting branch;
- `completeForensicCheckJob`.

Thread `job.startedAt` from the claimed row through Deep, Where, Incoming,
targeted-history coordination, scenario orchestration, terminal failures, and
delivery-producing completion. Reject a claimed job with null `startedAt` before
executing it.

- [ ] **Step 5: Fence authoritative pre-completion side effects in their DB transactions**

A progress CAS immediately before a write is not sufficient because stale
recovery can win between the check and the side effect. Add one private
repository helper that locks the claim row inside the same transaction as the
side effect:

```sql
select id
from forensic_check_jobs
where id = $jobId
  and status = 'running'
  and started_at = $claimStartedAt
for share
```

If the row is absent, return `false`/`lost_forensic_job_claim` without writing.
For the existing idempotent wait/release path only, `queued` plus
`jobPhase = 'waiting_for_targeted_index'` may also pass when the exact same
`started_at` token matches. Risk, label, score, and index-queue creation require
`running`.
Thread the claim through and guard:

- `upsertForensicJobWait`;
- job-requested `queueTronAddressUsdtIndexState` / `queueAddressUsdtHistory`;
- `saveRiskEvaluationEvidence`;
- `upsertAddressLabelAssertion` when called for a derived job assertion;
- `recordObservedTransactionRisk` in Incoming.

The row lock must remain held until each mutation commits, so stale recovery
cannot interleave between authority verification and the write. Keep non-job
callers compatible by adding explicit guarded job-owned entry points such as
`saveClaimedRiskEvaluationEvidence`,
`upsertClaimedAddressLabelAssertion`,
`recordClaimedObservedTransactionRisk`, and
`queueClaimedTronAddressUsdtIndexState`. They take required
`{ jobId, claimStartedAt }`; the existing non-job functions remain for their
current callers. Do not make the claim an optional argument that a forensic
runner can accidentally omit.

Immutable, exact provider-response and deterministic transaction-enrichment
decision artifacts may finish after claim loss as unreferenced reusable
artifacts; they do not publish a wallet verdict, label, alert, wait, score, or
job result. `indexWalletIntelligenceBestEffort` and alert sent/failed markers
already run only after a successful fenced completion and remain in that order.

- [ ] **Step 6: Make lost-claim behavior explicit**

A `false` progress/completion result means the attempt lost authority. Do not
retry the write without a token and do not prepare a Telegram delivery. Return a
stable `lost_forensic_job_claim` diagnostic from the worker boundary and abort
the per-job resolver signal exactly once. Provider requests already in flight
may settle, but their result cannot be attached to the reclaimed job; the stale
worker must not dequeue or dispatch any further raw/full work.

- [ ] **Step 7: Verify and commit**

```bash
npx vitest run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 tests/storage/forensicCheckJobs.test.ts tests/storage/repositories.test.ts tests/storage/runtimeDelivery.postgres.test.ts tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts
npm run typecheck
git add src/storage/repositories.ts src/forensics/deepForensicJob.ts src/forensics/incomingDepositJob.ts src/forensics/targetedHistoryCoordinator.ts src/runtime/forensicRuntimeOrchestration.ts src/index.ts tests/storage/forensicCheckJobs.test.ts tests/storage/repositories.test.ts tests/storage/runtimeDelivery.postgres.test.ts tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "fix(forensics): fence writes to job claim generation"
```

## Task 8: Replace the serial Where batch with a bounded slot pump

**Files:**

- Create: `src/forensics/forensicSlotPump.ts`
- Create: `tests/forensics/forensicSlotPump.test.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Modify: `tests/config/config.test.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`
- Modify: `tests/storage/forensicCheckJobs.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing deterministic pump tests**

Use deferred promises and fake time. Prove:

- concurrency `1` starts one claimed job and reproduces head-of-line blocking:
  the second claimed job does not enter its handler until the first settles;
- concurrency `2` starts a second job without waiting for the first;
- active count never exceeds configured capacity;
- each free slot claims exactly one job;
- completing one slot refills immediately while another remains active;
- an empty claim waits for the next timer poll and never microtask-spins;
- one rejected handler is isolated and the freed slot can refill;
- simultaneous timer/finally refill requests do not over-claim;
- reconciliation/stale recovery runs once per timer poll, not for every immediate
  refill;
- `stopAndDrain` blocks new claims, waits for a short active pump, then waits for
  all active handlers;
- no local pending-job queue exists.

- [ ] **Step 2: Prove RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/forensics/forensicSlotPump.test.ts
```

Expected: FAIL because the slot pump does not exist.

- [ ] **Step 3: Implement the minimal pump**

Use a `Set<Promise<void>>`, a short `activePumpPoll`, and a boolean
`refillRequested`. Keep the API narrow:

```ts
export function createForensicSlotPump<Job>(input: {
  concurrency: number;
  beforePoll(): Promise<void>;
  claimOne(): Promise<Job | null>;
  runClaimed(job: Job): Promise<void>;
  onHandlerError(error: unknown): void;
}): {
  poll(): Promise<void>;
  diagnostics(): { activeSlots: number; configuredSlots: number; stopping: boolean };
  stopAndDrain(): Promise<void>;
};
```

`poll()` performs `beforePoll`, fills free slots, and returns without awaiting
handlers. A handler `finally` requests one serialized refill. When `claimOne()`
returns null, that fill pass ends and does not request itself again.

- [ ] **Step 4: Split claim from execution without changing other lanes**

Extract from `runSingleDeepForensicJobCycle`:

```ts
export async function runClaimedForensicJob(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  options: DeepForensicJobRunnerOptions = {}
): Promise<void>;
```

Keep `runSingleDeepForensicJobCycle` as the compatibility wrapper used by the
Deep lane and existing generic callers: it claims once, calls
`runClaimedForensicJob`, and returns its existing boolean. Incoming keeps its
separate `runSingleIncomingDepositJobCycle`; only the Where pump claims
externally.

- [ ] **Step 5: Add the new config and retire the old setting from Where only**

Add:

```ts
forensicWhereWorkerConcurrency: parseIntegerInRange(
  "FORENSIC_WHERE_WORKER_CONCURRENCY",
  process.env.FORENSIC_WHERE_WORKER_CONCURRENCY ?? "1",
  1,
  2
)
```

Stop using `forensicWhereJobsPerPoll` in the Where runtime. Keep parsing
`FORENSIC_WHERE_JOBS_PER_POLL` temporarily because the existing Incoming default
inherits it; removing that fallback in Stage B would silently change a lane that
the spec requires to remain unchanged. Mark it deprecated for Where and state
that only `FORENSIC_WHERE_WORKER_CONCURRENCY` controls Where claims. A later
config-cleanup change may remove the compatibility setting after deployments
define `FORENSIC_INCOMING_JOBS_PER_POLL` explicitly.

In `.env.example` document:

```dotenv
# Stage B rollout: keep 1 by default; use 2 only for isolated canary and after acceptance.
FORENSIC_WHERE_WORKER_CONCURRENCY=1
# Deprecated for Where; retained as the legacy Incoming fallback during Stage B.
FORENSIC_WHERE_JOBS_PER_POLL=3
```

- [ ] **Step 6: Wire the Where-only pump in `src/index.ts`**

Replace `activeWhereForensicPoll` and the serial batch call. The timer poll does:

1. Telegram delivery cycle remains independent;
2. reconciliation and stale recovery under the short pump guard;
3. fill free Where slots using the existing DB claim filtered to
   `where_is_money_check`;
4. run each claimed job through `runClaimedForensicJob`.

Do not change Deep or Incoming guards, intervals, or concurrency. Do not call
`runForensicJobBatch` for Where after this task. Keep the batch helper for any
remaining caller or delete it only if `rg` proves it has no callers.

- [ ] **Step 7: Add PostgreSQL fairness and lane-isolation tests**

Cover:

- multiple simultaneously claimable Where jobs are unique;
- priority/FIFO/ID tie order is deterministic;
- `waiting_for_targeted_index` is not claimable;
- Where claims never take Incoming/Deep jobs;
- Deep/Incoming claims and configured concurrency remain unchanged;
- while one Where handler is deliberately blocked, independent Incoming and
  Deep cycle fakes still enter their own handlers;
- one released-to-waiting job immediately frees its local slot.

- [ ] **Step 8: Verify and commit**

```bash
npx vitest run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 tests/forensics/forensicSlotPump.test.ts tests/forensics/deepForensicJob.test.ts tests/storage/forensicCheckJobs.test.ts tests/config/config.test.ts
npm run typecheck
git add src/forensics/forensicSlotPump.ts src/forensics/deepForensicJob.ts src/config.ts src/index.ts tests/forensics/forensicSlotPump.test.ts tests/forensics/deepForensicJob.test.ts tests/storage/forensicCheckJobs.test.ts tests/config/config.test.ts .env.example
git commit -m "feat(forensics): pump independent Where slots"
```

## Task 9: Publish queue and enrichment diagnostics without sensitive labels

**Files:**

- Modify: `src/storage/repositories.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `src/forensics/forensicSlotPump.ts`
- Modify: `src/index.ts`
- Modify: `tests/storage/forensicCheckJobs.test.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`
- Modify: `tests/forensics/forensicSlotPump.test.ts`

- [ ] **Step 1: Write failing queue-diagnostic tests**

Add a lane summary query that excludes `waiting_for_targeted_index` from
runnable queue age and returns only bounded aggregates:

```ts
export type ForensicLaneQueueDiagnostics = {
  kind: "where_is_money_check" | "address_deep_check";
  runnableQueuedCount: number;
  oldestRunnableQueuedAt: Date | null;
  dbRunningCount: number;
};
```

Tests must prove waiting jobs are excluded, empty lanes return zeros/null, and no
subject address, transaction hash, chat ID, key identifier, or username appears
in the result/log payload.

- [ ] **Step 2: Prove RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/storage/forensicCheckJobs.test.ts tests/forensics/forensicSlotPump.test.ts tests/forensics/deepForensicJob.test.ts
```

Expected: FAIL because Where/Deep do not expose comparable queue-age/slot data.

- [ ] **Step 3: Add Where and Deep lifecycle diagnostics**

At claim/start and completion, record count-only fields under existing
`performanceTiming` and structured logs:

```ts
{
  queueWaitMs,
  runnableQueuedCount,
  oldestRunnableQueueAgeMs,
  activeSlots,
  configuredSlots,
  dbRunningCount,
  transactionInfoCandidateCount,
  transactionInfoHardCandidateCount,
  transactionInfoRawProviderRequests,
  transactionInfoFullProviderRequests,
  transactionInfoSavedEvidenceHits,
  transactionInfoInFlightHits,
  transactionInfoSchedulerAwaitMs,
  schedulerDispatchedRequestCountAtStart,
  schedulerFailedRequestCountAtStart,
  schedulerRateLimitedRequestCountAtStart,
  schedulerDispatchedRequestCountAtEnd,
  schedulerFailedRequestCountAtEnd,
  schedulerRateLimitedRequestCountAtEnd,
  schedulerCapacityFingerprint
}
```

For Deep, `configuredSlots` remains `1`; this task observes the residual queue
and does not raise its concurrency. Keep Incoming's existing `queueWaitMs` and
do not merge its lane into Where. Scheduler counters are monotonic snapshots,
not per-address metric labels. They let an isolated canary compute the aggregate
delta for its controlled window without exposing an address or API-key identity.

- [ ] **Step 4: Make the bounded-fairness limit explicit in diagnostics**

When Where concurrency is `2`, log a stable count-only field stating whether
zero, one, or two slots were occupied at the poll. Do not report a start SLA when
both were occupied. The runbook must say: one occupied slot leaves capacity for
the new job; two occupied monolithic jobs have no Stage B bounded-start
guarantee.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/storage/forensicCheckJobs.test.ts tests/forensics/forensicSlotPump.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts
npm run typecheck
git add src/storage/repositories.ts src/forensics/deepForensicJob.ts src/forensics/incomingDepositJob.ts src/forensics/forensicSlotPump.ts src/index.ts tests/storage/forensicCheckJobs.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/forensicSlotPump.test.ts
git commit -m "feat(forensics): expose queue and enrichment latency"
```

## Task 10: Prove TXc fact equivalence and provider-call reduction

**Files:**

- Modify: `src/forensics/whereLatencyReplay.ts`
- Modify: `tests/forensics/whereLatencyReplay.test.ts`
- Modify: `tests/fixtures/forensics/txc-legacy-where-latency-v1.json`
- Modify: `package.json`

- [ ] **Step 1: Add the failing post-Stage-B replay assertions**

Run the new selective resolver against the frozen real tape and assert:

- `projectStableWhereFacts(after)` exactly equals the frozen legacy projection;
- `coverage`, `coverageV2`, `decisionReasons`, `fastWalletRisk`,
  `sourceProvenanceMateriality`, `crossChainCorridor`, and `riskCaseFile` are
  asserted explicitly as well as through the full semantic projection;
- all ordinary plain official-USDT hashes make zero full transaction-info calls;
- each hard-trigger hash makes at most one full call per provider/schema
  identity;
- total full transaction-info calls are lower than the frozen baseline;
- raw and full saved evidence IDs are deterministic;
- repeated branches and a simulated second job reuse the same evidence;
- no live DB/network method is reachable during replay;
- missing required raw and full tape entries produce incomplete coverage rather
  than an unchanged clean projection.

- [ ] **Step 2: Prove RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 tests/forensics/whereLatencyReplay.test.ts
```

Expected before final replay wiring: FAIL on old full-request count or missing
selective replay dependency.

- [ ] **Step 3: Add a read-only replay command**

Add:

```json
"forensic:where-latency:replay": "node --import tsx scripts/captureWhereLatencyReplay.ts replay"
```

The replay mode reads the checked-in fixture, performs no write and no network
call, and prints canonical JSON with baseline/new raw/full counts and one boolean
`stableFactsEqual`.

- [ ] **Step 4: Verify the acceptance artifact**

```bash
npm run forensic:where-latency:replay -- --fixture tests/fixtures/forensics/txc-legacy-where-latency-v1.json
npx vitest run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 tests/forensics/whereLatencyReplay.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts
```

Expected: stable facts equal; ordinary-transfer full calls `0`; total provider
calls lower; no coverage regression.

- [ ] **Step 5: Commit the replay proof**

```bash
git add src/forensics/whereLatencyReplay.ts tests/forensics/whereLatencyReplay.test.ts tests/fixtures/forensics/txc-legacy-where-latency-v1.json package.json
git commit -m "test(forensics): prove selective TXc replay"
```

## Task 11: Add and run the isolated concurrency-two canary

**Files:**

- Create: `scripts/runWhereLatencyCanary.ts`
- Create: `tests/scripts/runWhereLatencyCanary.test.ts`
- Modify: `package.json`
- Modify: `docs/knowledge/12-runbooks.md`

- [ ] **Step 1: Write failing canary contract tests**

The script must reject execution unless all are true:

- explicit `--confirm` is present;
- `FORENSIC_WHERE_WORKER_CONCURRENCY=2`;
- it is running in a dedicated canary deployment/database clone whose canonical
  config receipt enables only the Where pump, required address indexing, and
  no unrelated monitor/approval/Deep/Incoming/Unified provider consumers;
- the canary DB has zero pre-existing running/runnable forensic jobs and the
  dedicated scheduler starts with `queued = 0` and `inFlight = 0`;
- the observed scheduler capacity/config hash matches the pre-canary baseline;
- both jobs use `chatId = null` and cannot create Telegram delivery intent;
- source addresses are valid TRON addresses;
- the output receipt path does not already exist.

Use defaults from the investigated case:

```text
long wallet:  TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP
fresh wallet: TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd
```

- [ ] **Step 2: Prove RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/scripts/runWhereLatencyCanary.test.ts
```

Expected: FAIL because the canary command does not exist.

- [ ] **Step 3: Implement a fail-closed, no-delivery canary**

Add:

```json
"forensic:where-latency:canary": "node --import tsx scripts/runWhereLatencyCanary.ts"
```

`prepare` writes a non-overwriting canonical
`where-latency-canary-isolation-v1` receipt containing the non-secret database
fingerprint, runtime instance label, enabled runtime-cycle allowlist, worker
concurrency, scheduler capacity fingerprint, and receipt SHA-256. `run` requires
that exact receipt through `--isolation-receipt`, re-derives every field, and
rejects any mismatch. The allowed cycles are `where`, `address_index`, and the
no-op/null-chat delivery reconciliation required by the runtime.

The command:

1. snapshots scheduler diagnostics and the current runnable Where/Deep lane
   diagnostics;
2. enqueues the long Where job with higher priority so it occupies one slot;
3. waits until its handler is running;
4. enqueues fresh TXc with `chatId = null`;
5. records the time from TXc creation to its handler start;
6. records the start gate immediately, then waits for both TXc and the long
   canary job to reach a terminal state;
7. verifies active Where handlers never exceeded two;
8. verifies no Telegram delivery intent/claim exists for either canary job;
9. stops new canary claims after both jobs are terminal and drains every
   canary-owned active promise;
10. only after that drain, takes the final scheduler snapshot and compares
    monotonic counters and capacity fingerprint across the complete window from
    the clean isolated start through the drained end; an isolated canary
    requires zero new rate-limited and failed scheduler requests;
11. writes a canonical, non-overwriting receipt under
    `outputs/where-latency-canary/`.

Do not delete or cancel pre-existing user jobs; their presence means this is not
an isolated canary and the command must refuse to start. Use unique
`requestedBy` and progress marker values so the script reads only its own
canary rows. A run against a shared scheduler may emit a
`non_gating_not_isolated` diagnostic, but its global counter deltas are not
release evidence and it cannot promote concurrency `2`.

- [ ] **Step 4: Run the isolated canary**

```bash
$env:FORENSIC_WHERE_WORKER_CONCURRENCY='2'
npm run forensic:where-latency:canary -- prepare --out outputs/where-latency-canary/isolation.json
npm run forensic:where-latency:canary -- run --confirm --isolation-receipt outputs/where-latency-canary/isolation.json
```

Acceptance:

- with exactly one slot already occupied, TXc handler starts within two Where
  polling intervals and no later than five seconds;
- active Where handlers never exceed two;
- duplicate Telegram deliveries remain zero;
- the isolated canary's scheduler rate-limited and failed-request deltas are
  both zero;
- scheduler/key capacity does not increase;
- both canary jobs are terminal and the canary pump has drained before the pass
  receipt is written;
- the code/config receipt still shows Deep concurrency `1`; Deep latency is
  measured in the separate next step, not mixed into the isolated Where canary.

If both Where slots are already occupied, record `no_stage_b_start_guarantee` and
do not call that a failed one-slot canary. Re-run only in an isolated window; do
not evict real work.

- [ ] **Step 5: Reproduce the residual Deep queue separately**

After the Where canary, enqueue/read a TXc Deep check through the existing
single-slot lane and record queue age, start, provider errors, memory, and
delivery count. Do not change Deep concurrency in this plan. If Deep remains the
dominant latency, keep/open a separate problem for its own `default 1 / isolated
canary 2` design and gates.

- [ ] **Step 6: Document and commit the canary**

Document exact commands, pass/fail interpretation, cleanup ownership, and the
two-slots-occupied limitation in `docs/knowledge/12-runbooks.md`. Also document
a dedicated canary deployment recipe and the fields proving that no unrelated
provider consumer shared its scheduler. Then document
a 30-minute pre/post production observation: compare rate-limited and failed
requests per dispatched request from the existing structured scheduler logs;
promotion to production concurrency `2` requires neither rate to be higher in
the post window.

```bash
git add scripts/runWhereLatencyCanary.ts tests/scripts/runWhereLatencyCanary.test.ts package.json docs/knowledge/12-runbooks.md
git commit -m "test(forensics): add Where latency canary"
```

## Task 12: Update product truth and run the full release gate

**Files:**

- Modify: `docs/knowledge/03-job-lifecycle.md`
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/05-where-is-money-and-incoming.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`
- Modify: `docs/knowledge/12-runbooks.md`

- [ ] **Step 1: Update knowledge docs to match implemented behavior**

Record:

- Where DB claim order, slot-pump lifecycle, default/canary/production values,
  short poll guard, immediate refill, shutdown, and bounded-fairness limitation;
- claim-generation CAS, guarded downstream writes, and stale-worker behavior;
- exact raw/full evidence identity, immutability, provider/schema authority, and
  finalized-success/failed/reverted persistence semantics;
- the eight full-fetch triggers and `plain_usdt_raw_proven`;
- no full fetch from `REVIEW` or flat labels alone;
- structured incomplete coverage and its zero direct score impact;
- scheduler ownership of pacing and unchanged provider capacity;
- Deep remaining singleton and its measured residual latency;
- TXc replay/canary artifact paths and results.

Remove the frozen-TXc-bundle open problem only if the real fixture was captured
and verified. Otherwise leave it explicit and state that production concurrency
`2` is blocked.

- [ ] **Step 2: Run targeted Stage B suites**

```bash
npx vitest run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 tests/tron/rawTransactionPreflight.test.ts tests/tron/tronClient.test.ts tests/tron/tronscanScheduler.test.ts tests/storage/transactionEvidenceRepository.test.ts tests/storage/addressLabelAssertions.test.ts tests/storage/forensicCheckJobs.test.ts tests/storage/repositories.test.ts tests/storage/runtimeDelivery.postgres.test.ts tests/forensics/selectiveTransactionEnrichment.test.ts tests/forensics/forensicSlotPump.test.ts tests/forensics/whereLatencyReplay.test.ts tests/forensics/localTronUsdtIndex.test.ts tests/forensics/routeSearch.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/whereIsMoneyCliArgs.test.ts tests/scripts/forensicWalletCalibrationRerun.test.ts tests/config/config.test.ts tests/scripts/runWhereLatencyCanary.test.ts
```

Expected: all pass. PostgreSQL-backed tests may skip only under their existing
explicit environment gate; a skipped claim-generation/fairness test is not
sufficient release evidence and must be run against PostgreSQL before canary.

- [ ] **Step 3: Run schema, type, and full regression checks**

```bash
npm run schema:verify
npm run typecheck
npm test
git diff --check
```

Expected: all pass, no migration added, no changed Unified manifest/hash/golden
fixture, and no snapshot update used to hide a semantic difference.

- [ ] **Step 4: Audit forbidden implementation shortcuts**

```bash
rg -n "15000|15_000|2_000|contractTransactionInfoMinIntervalMs|transactionInfoQueue" src/check src/forensics scripts/forensicWhereIsMoney.ts scripts/forensicWalletCalibrationRerun.ts
rg -n "Promise\.all\([^\n]*candidates" src tests
rg -n "FORENSIC_WHERE_JOBS_PER_POLL|forensicWhereJobsPerPoll" src/index.ts src/forensics/forensicSlotPump.ts
rg -n "transaction-info|gettransactionbyid" src/tron src/forensics src/check
rg -n "FORENSIC_WHERE_WORKER_CONCURRENCY" src tests .env.example docs/knowledge
```

Expected:

- no local per-candidate 15-second sleep or old serial queue;
- no unbounded candidate `Promise.all`;
- no use of the deprecated batch setting in the Where poll/pump (its documented
  Incoming compatibility fallback may remain in config);
- every raw/full provider path passes through the scheduler-backed client;
- concurrency config and rollout wording are consistent.

- [ ] **Step 5: Run the read-only replay one final time**

```bash
npm run forensic:where-latency:replay -- --fixture tests/fixtures/forensics/txc-legacy-where-latency-v1.json
```

Expected: stable forensic facts exactly equal, ordinary-transfer full calls
zero, total provider calls lower, and no missing required evidence.

- [ ] **Step 6: Commit product-truth documentation**

```bash
git add docs/knowledge/03-job-lifecycle.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/05-where-is-money-and-incoming.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/12-runbooks.md
git commit -m "docs(forensics): record Stage B latency policy"
```

## Release and rollout checklist

- [ ] Real legacy TXc replay bundle is checked in and passes strict parsing.
- [ ] Stable TXc forensic facts are exactly equal before/after.
- [ ] Ordinary plain official-USDT transfers make zero full transaction-info
  calls.
- [ ] Each exact provider/schema evidence identity dispatches at most once while
  in flight and reuses persisted evidence across jobs/restarts.
- [ ] Every approved hard trigger is covered independently.
- [ ] Raw plus full failure produces incomplete/technical-unknown coverage.
- [ ] Finalized failed/reverted evidence is reused, produces
  incomplete/technical-proven coverage, and never proves a clean/plain result.
- [ ] No provisional/unconfirmed provider response is persisted under a
  permanent evidence identity.
- [ ] `REVIEW`, unknown verdict, behavioral service likelihood, and flat labels
  alone do not trigger full enrichment.
- [ ] Local 15-second candidate sleeps are absent; scheduler cooldown/429 tests
  pass without busy-loop.
- [ ] Claim-generation PostgreSQL race test passes against a real PostgreSQL
  instance.
- [ ] A superseded worker cannot write waits, index requests, risk evidence,
  Incoming risk, or derived assertions.
- [ ] Losing a claim aborts that resolver caller: an already-shared request may
  settle, but the stale worker dispatches no full fallback or next candidate.
- [ ] Where concurrency default remains `1` in code and deployment config.
- [ ] Isolated concurrency-`2` canary starts TXc within five seconds/two poll
  intervals when one slot is occupied.
- [ ] Both canary jobs are terminal and all canary-owned promises are drained
  before the pass receipt is accepted.
- [ ] Active Where handlers never exceed two and DB claims are unique.
- [ ] Incoming and Deep lane concurrency is unchanged.
- [ ] 429s, provider errors, and duplicate Telegram deliveries do not increase.
- [ ] Provider scheduler/key capacity is unchanged.
- [ ] Deep residual queue latency is recorded, not hidden.
- [ ] Knowledge docs and runbook match code.
- [ ] `npm run schema:verify`, `npm run typecheck`, and `npm test` pass.

Rollout order:

1. merge/deploy with selective enrichment and
   `FORENSIC_WHERE_WORKER_CONCURRENCY=1`;
2. run frozen replay and observe provider/error diagnostics;
3. run isolated canary with concurrency `2` and `chatId = null`;
4. promote production to `2` only after every release checklist item passes;
5. keep Deep at `1` and decide its separate follow-up from measured evidence.
