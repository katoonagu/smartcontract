# First-Hop USDT Blacklist Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve exact first-hop USDT blacklist evidence from provider lookup through DeepCheck and make every material current-blacklist relationship an independent `DECLINE` policy signal.

**Architecture:** Add an address-scoped, verified blacklist timeline provider and a pure principal-counterparty evidence model. DeepCheck persists typed facts and coverage; matrix v2 consumes those facts, while final disposition lets only the new coverage-independent policy bypass unrelated partial coverage.

**Tech Stack:** TypeScript, Node.js fetch, TronWeb, Vitest, PostgreSQL JSONB job results, existing TronScan scheduler/key pool.

---

## File map

- Create `src/tron/usdtBlacklistTimeline.ts`: validate provider rows and verified contract events.
- Create `tests/tron/usdtBlacklistTimeline.test.ts`: pure provider/timeline regression tests.
- Modify `src/tron/tronClient.ts`: paginate `/api/stableCoin/blackList` and verify tx events.
- Modify `src/types.ts`: first-hop facts, coverage, timeline and policy-version types.
- Modify `src/forensics/directHardEvidence.ts`: principal grouping, material ordering, facts and coverage.
- Modify `src/check/deepForensicCheck.ts`: run first-hop screening in all-time and bounded modes.
- Modify `src/forensics/deepForensicJob.ts` and `src/index.ts`: persist fields and forward timeline options.
- Modify `src/risk/scoringSignalMatrix.ts`, `scoringSignalMatrixInputs.ts`, `finalDisposition.ts`, `unifiedWalletRisk.ts`: matrix v2 and independent policy.
- Modify `src/admin/adminServer.ts` and `src/bot/createBot.ts`: preserve stored policy markers during extraction.

### Task 1: Validate blacklist provider rows and contract events

**Files:**
- Create: `src/tron/usdtBlacklistTimeline.ts`
- Create: `tests/tron/usdtBlacklistTimeline.test.ts`
- Modify: `src/types.ts:2395`

- [ ] **Step 1: Write failing pure parser tests**

```ts
it("validates rows and converts Unix seconds exactly once", () => {
  expect(parseTronscanBlacklistPage({ total: 1, data: [{
    blackAddress: target,
    tokenName: "USDT",
    num: "2642746070000",
    time: 1777985343,
    transHash: eventTx,
    contractAddress: TRON_USDT_CONTRACT_ADDRESS
  }] }, { targetAddress: target })).toMatchObject({
    total: 1,
    rows: [{ occurredAt: "2026-05-05T12:49:03.000Z", txHash: eventTx }]
  });
});

it.each([
  ["address_mismatch", { blackAddress: other }],
  ["wrong_contract", { contractAddress: other }]
])("rejects %s", (failureReason, override) => {
  expect(parseTronscanBlacklistPage(page(override), { targetAddress: target }))
    .toMatchObject({ failureReason });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing-module failure**

Run: `npm test -- tests/tron/usdtBlacklistTimeline.test.ts`

Expected: FAIL because `src/tron/usdtBlacklistTimeline.ts` does not exist.

- [ ] **Step 3: Add exact types and pure validators**

```ts
export type UsdtBlacklistTimelineEvent = {
  eventKind: "added" | "removed";
  occurredAt: string;
  txHash: string;
  tokenContract: string;
  blockNumber: number | null;
  logIndex: number | null;
  verification: "verified_contract_log" | "unverified";
};

export type UsdtBlacklistTimeline = {
  events: UsdtBlacklistTimelineEvent[];
  pagination: "complete" | "partial";
  failureReason: "provider_failed" | "address_mismatch" | "wrong_contract" |
    "transaction_unconfirmed" | "event_log_unverified" |
    "state_timeline_inconsistent" | null;
};
```

Implement `parseTronscanBlacklistPage()`, `verifyTronscanBlacklistEvent()` and
`finalizeUsdtBlacklistTimeline()`. Decode only exact
`AddedBlackList(address)`/`RemovedBlackList(address)` logs from the official
USDT contract; never infer event kind from `num`.

- [ ] **Step 4: Run pure tests**

Run: `npm test -- tests/tron/usdtBlacklistTimeline.test.ts`

Expected: PASS, including removal/re-add and current-state inconsistency cases.

- [ ] **Step 5: Commit**

```powershell
git add src/types.ts src/tron/usdtBlacklistTimeline.ts tests/tron/usdtBlacklistTimeline.test.ts
git commit -m "feat: validate USDT blacklist timeline evidence"
```

### Task 2: Fetch the address-scoped timeline

**Files:**
- Modify: `src/tron/tronClient.ts:398,833,889`
- Modify: `tests/tron/tronClient.test.ts`

- [ ] **Step 1: Add failing orchestration tests**

```ts
it("paginates address-filtered blacklist rows and verifies transaction events", async () => {
  const timeline = await client.getUsdtBlacklistTimeline(target);
  expect(timeline.pagination).toBe("complete");
  expect(timeline.events).toEqual([
    expect.objectContaining({ eventKind: "added", txHash: eventTx })
  ]);
  expect(requestedUrls).toContainEqual(expect.stringContaining(`blackAddress=${target}`));
  expect(requestedUrls).toContainEqual(expect.stringContaining("start=100"));
});
```

Also assert provider failure returns `pagination: "partial"`, and default
`getUsdtRestrictionStatus(address)` makes no timeline request.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/tron/tronClient.test.ts -t "blacklist timeline|default status"`

Expected: FAIL because `getUsdtBlacklistTimeline()` is missing.

- [ ] **Step 3: Replace the global-50 lookup**

Add:

```ts
async getUsdtBlacklistTimeline(address: string): Promise<UsdtBlacklistTimeline>;

private async listTransactionEvents(txHash: string): Promise<TronContractEvent[]> {
  const url = new URL(`/v1/transactions/${txHash}/events`, this.fullNodeBaseUrl!);
  const json = await this.fetchJson(url, "stablecoin_blacklist_tx_events", {}, this.fullNodeApiKey ?? null);
  return parseVerifiedTransactionEvents(json);
}
```

Request `/api/stableCoin/blackList` with `blackAddress`, official
`tokenAddress`, `sort=2`, `direction=2`, `limit=100`, and increasing `start`
until accumulated rows equal `total`. An early empty page is partial. Preserve
partial timeline details in `StablecoinRestrictionProfile.blacklistTimeline`;
derive legacy `blacklistEvent*` only from the last verified `added` event.

- [ ] **Step 4: Run provider tests and typecheck**

Run: `npm test -- tests/tron/usdtBlacklistTimeline.test.ts tests/tron/tronClient.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/tron/tronClient.ts tests/tron/tronClient.test.ts
git commit -m "feat: fetch address-scoped USDT blacklist timelines"
```

### Task 3: Group material principal counterparties

**Files:**
- Modify: `src/types.ts:2255`
- Modify: `src/forensics/directHardEvidence.ts`
- Modify: `tests/forensics/directHardEvidence.test.ts`

- [ ] **Step 1: Add failing materiality and GasFree tests**

```ts
it.each([
  ["9999999000", false],
  ["10000000000", true]
])("applies the absolute boundary %s", (principalAmountRaw, material) => {
  expect(group({ principalAmountRaw, coverage: "partial" }).material).toBe(material);
});

it("excludes only structural GasFree fees", () => {
  const groups = groupDirectPrincipalCounterparties({ subjectAddress, edges, directTransferCoverage: "complete" });
  expect(groups.find((g) => g.counterpartyAddress === feeProvider)).toBeUndefined();
  expect(groups.find((g) => g.counterpartyAddress === recipient)?.principalAmountRaw)
    .toBe("1176317000000");
});
```

Cover `99.999/100 USDT`, `0.999/1%`, partial denominator and separate
inbound/outbound groups.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/forensics/directHardEvidence.test.ts`

Expected: FAIL because principal groups do not exist.

- [ ] **Step 3: Add the principal group and exact bigint rules**

```ts
export type DirectPrincipalCounterpartyGroup = {
  counterpartyAddress: string;
  direction: "inbound" | "outbound";
  principalAmountRaw: string;
  principalTxCount: number;
  directionalPrincipalShare: number | null;
  shareSemantics: "exact" | "lower_bound" | "unavailable";
  transferTxHashes: string[];
  transfers: ForensicRouteEdge[];
  material: boolean;
};
```

Material is `amount >= 10_000_000_000n`, or, only with a complete denominator,
`amount >= 100_000_000n && amount * 100n >= directionalTotal`. Count unique tx
hashes. Sort material groups by principal amount before applying live limits.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/forensics/directHardEvidence.test.ts tests/forensics/counterpartyInteraction.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/types.ts src/forensics/directHardEvidence.ts tests/forensics/directHardEvidence.test.ts
git commit -m "feat: group material first-hop principal counterparties"
```

### Task 4: Produce structured facts and report-level coverage

**Files:**
- Modify: `src/forensics/directHardEvidence.ts`
- Modify: `tests/forensics/directHardEvidence.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Add failing chronology and coverage tests**

```ts
expect(result.blacklistFacts[0]).toMatchObject({
  direction: "outbound",
  statusAtCheck: "active",
  temporalRelation: "became_active_after",
  principalAmountRaw: "1176317000000",
  directionalPrincipalShare: 1,
  beforeEffectiveAmountRaw: "1176317000000",
  activeAmountRaw: "0",
  unknownTimingAmountRaw: "0"
});
expect(sumBuckets(result.blacklistFacts[0])).toBe(1176317000000n);
```

Add cases for `active_at_transfer`, `mixed`, `unknown`, provider failure,
re-add, typed exact/derived labels and zero-fact partial coverage.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/forensics/directHardEvidence.test.ts -t "chronology|coverage|label"`

Expected: FAIL because facts/coverage are absent.

- [ ] **Step 3: Extend the builder result**

```ts
type DirectHardEvidenceResult = {
  // existing counters
  blacklistFacts: FirstHopBlacklistFact[];
  labelFacts: FirstHopLabelFact[];
  coverage: FirstHopBlacklistCoverage;
};
```

Current active state creates a fact even when timeline is partial. Any partial
timeline, re-add ambiguity or same-block unknown order assigns affected
transfers to the `unknown` bucket. `AddressLabel.createdAt` maps only to
`recordedAt`; `effectiveAt` remains null. Live lookup is once per unique address,
while directed facts remain separate.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/forensics/directHardEvidence.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/types.ts src/forensics/directHardEvidence.ts tests/forensics/directHardEvidence.test.ts
git commit -m "feat: produce structured first-hop evidence"
```

### Task 5: Wire facts into DeepCheck and production jobs

**Files:**
- Modify: `src/check/deepForensicCheck.ts:94,853,1620,1935,2040`
- Modify: `tests/check/deepForensicCheck.test.ts`
- Modify: `src/forensics/deepForensicJob.ts:1880`
- Modify: `tests/forensics/deepForensicJob.test.ts`
- Modify: `src/index.ts:555,906`

- [ ] **Step 1: Add failing TGyt and persistence tests**

```ts
expect(report.firstHopBlacklistFacts).toContainEqual(expect.objectContaining({
  counterpartyAddress: "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm",
  direction: "outbound",
  principalAmountRaw: "1176317000000",
  directionalPrincipalShare: 1,
  temporalRelation: "became_active_after"
}));
expect(report.firstHopBlacklistCoverage.checkedMaterialCounterpartyCount).toBe(1);
```

In the job test, assert all three new fields survive `resultJson` unchanged.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/check/deepForensicCheck.test.ts tests/forensics/deepForensicJob.test.ts -t "first-hop|TGyt|persists"`

Expected: FAIL because reports do not expose the fields.

- [ ] **Step 3: Integrate both Deep modes**

Add required fresh-report fields:

```ts
firstHopBlacklistFacts: FirstHopBlacklistFact[];
firstHopLabelFacts: FirstHopLabelFact[];
firstHopBlacklistCoverage: FirstHopBlacklistCoverage;
scoringPolicyVersion?: string;
```

Use `scope="all_time"` only for a complete materialized subject index;
otherwise use the declared checked window and partial share semantics. Do not
include sparse fallback rows outside that window. Overlay exact snapshots onto
behavior snapshots without repeating blacklist calls.

Forward options in both production adapters:

```ts
getUsdtRestrictionStatus: (address, options) =>
  tronClient.getUsdtRestrictionStatus(address, options)
```

- [ ] **Step 4: Run Deep and production tests**

Run: `npm test -- tests/check/deepForensicCheck.test.ts tests/forensics/deepForensicJob.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/check/deepForensicCheck.ts src/forensics/deepForensicJob.ts src/index.ts tests/check/deepForensicCheck.test.ts tests/forensics/deepForensicJob.test.ts
git commit -m "feat: persist first-hop evidence in DeepCheck jobs"
```

### Task 6: Add matrix v2 direct-counterparty policy

**Files:**
- Modify: `src/risk/scoringSignalMatrix.ts`
- Modify: `src/risk/scoringSignalMatrixInputs.ts:159,457`
- Modify: `tests/risk/scoringSignalMatrix.test.ts`
- Modify: `tests/risk/scoringSignalMatrixInputs.test.ts`

- [ ] **Step 1: Add failing row and candidate tests**

```ts
expect(result.winningCandidate).toMatchObject({
  row: "direct_counterparty_policy",
  score: 90,
  actionUnit: "wallet",
  authority: { kind: "policy", decisionEligibility: "can_decline", coverageDependency: "none" }
});
```

Test floor 60, cap 90, partial-denominator amount-only 60, inactive/non-official
rejection, exact thresholds and incoming tx-hash linkage.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts -t "direct counterparty|first-hop"`

Expected: FAIL because the row is unknown.

- [ ] **Step 3: Add the row and mapping**

```ts
export const SCORING_SIGNAL_MATRIX_POLICY_VERSION = "scoring-signal-matrix-v2" as const;
```

Place `direct_counterparty_policy` after `hard_proof` in `rowPriority`. Map only
`usdt_blacklist + official_contract + statusAtCheck=active`. Use
`max(60, profile.scoreContribution)` with cap 90 only for exact share; use 60
for the partial absolute branch. Incoming mode requires the checked tx hash in
`transferTxHashes`.

- [ ] **Step 4: Run matrix tests**

Run: `npm test -- tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/risk/scoringSignalMatrix.ts src/risk/scoringSignalMatrixInputs.ts tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts
git commit -m "feat(scoring): add direct counterparty policy"
```

### Task 7: Resolve independent policy and incomplete negative coverage

**Files:**
- Modify: `src/types.ts:503`
- Modify: `src/risk/finalDisposition.ts:25`
- Modify: `tests/risk/finalDisposition.test.ts`
- Modify: `src/risk/unifiedWalletRisk.ts:367,475`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add failing resolver and coverage tests**

```ts
expect(resolveFinalDisposition({
  subject,
  matrixScore: independentDirectPolicyMatrix(60),
  coverage: coverage("invalid", "partial"),
  observedContextScore: 80
})).toMatchObject({ decision: "DECLINE", finalScore: 60, decisionBasis: "independent_policy" });
```

Also assert dependent policy, review-only policy, another subject and score 59
do not bypass invalid coverage. Add clean-result tests for checked vs unchecked
material counterparties.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/risk/finalDisposition.test.ts tests/risk/unifiedWalletRisk.test.ts -t "independent policy|first-hop coverage"`

Expected: FAIL with `NO_FINAL_DECISION` for the independent policy case.

- [ ] **Step 3: Implement the targeted resolver exception**

Add `"independent_policy"` to `FinalDecisionBasis`. Select only a same-subject
`direct_counterparty_policy` with policy/can-decline, dependency none and score
at least 60 before the invalid-coverage branch. Extend `walletDecisionCoverage`
with Deep first-hop coverage: incomplete required screening invalidates a
negative result, but a confirmed adverse fact leaves `overall="partial"` and a
caveat for the independent resolver.

- [ ] **Step 4: Run resolver and unified tests**

Run: `npm test -- tests/risk/finalDisposition.test.ts tests/risk/unifiedWalletRisk.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/types.ts src/risk/finalDisposition.ts src/risk/unifiedWalletRisk.ts tests/risk/finalDisposition.test.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "feat(scoring): preserve independent policy through partial coverage"
```

### Task 8: Version fresh reports and preserve legacy semantics

**Files:**
- Modify: `src/risk/scoringAudit.ts`
- Modify: `src/risk/shadowScoring.ts`
- Modify: `src/check/deepForensicCheck.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `src/bot/createBot.ts:2068`
- Modify: `src/admin/adminServer.ts`
- Test: corresponding risk, Deep job, bot and Admin tests.

- [ ] **Step 1: Add failing version/extraction tests**

Assert fresh Deep reports and stored JSON contain `scoring-signal-matrix-v2`,
both extractors preserve it, and an explicit-score legacy report without that
marker is not recalculated.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/risk tests/forensics/deepForensicJob.test.ts tests/bot/createBot.test.ts tests/admin/adminServer.test.ts -t "matrix-v2|legacy Deep|policy version"`

Expected: FAIL on v1 expectations/missing marker.

- [ ] **Step 3: Replace hardcoded versions and add the fresh marker**

Use `SCORING_SIGNAL_MATRIX_POLICY_VERSION` in matrix, audit and shadow scoring.
Fresh Deep reports set it; JSON persistence and Admin/bot extraction keep it.
Do not migrate or rewrite old JSONB rows.

- [ ] **Step 4: Run affected suites**

Run: `npm test -- tests/risk tests/forensics/deepForensicJob.test.ts tests/admin/adminServer.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/risk src/check/deepForensicCheck.ts src/forensics/deepForensicJob.ts src/bot/createBot.ts src/admin/adminServer.ts tests
git commit -m "feat(scoring): version first-hop policy and preserve legacy jobs"
```

### Task 9: Update product truth and run the full gate

**Files:**
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/06-deepcheck.md`
- Modify: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`

- [ ] **Step 1: Update current behavior only after code passes**

Document the address-scoped provider, principal materiality, matrix v2,
independent policy, partial negative coverage and legacy boundary. Mark the
open-problem entry resolved; do not claim Telegram narrative changes from Plan
2 yet.

- [ ] **Step 2: Run the focused verification gate**

Run:

```powershell
npm test -- tests/tron/usdtBlacklistTimeline.test.ts tests/tron/tronClient.test.ts tests/forensics/directHardEvidence.test.ts tests/check/deepForensicCheck.test.ts tests/forensics/deepForensicJob.test.ts tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/finalDisposition.test.ts tests/risk/unifiedWalletRisk.test.ts
npm run typecheck
```

Expected: all selected tests PASS and typecheck exits 0.

- [ ] **Step 3: Run the complete repository suite**

Run: `npm test`

Expected baseline or better: 148 test files and 2506 tests pass, with new tests
raising those counts and zero failures.

- [ ] **Step 4: Check the diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intended implementation/docs files.

- [ ] **Step 5: Commit docs**

```powershell
git add docs/knowledge
git commit -m "docs: document first-hop blacklist scoring"
```
