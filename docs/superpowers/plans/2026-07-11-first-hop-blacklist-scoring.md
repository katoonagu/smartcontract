# First-Hop USDT Blacklist Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task.

**Goal:** Score material direct USDT principal transfers with an actively blacklisted counterparty as independent policy evidence, without treating GasFree fees as principal or silently rescoring legacy reports.

**Architecture:** Add an address-scoped, event-verified USDT blacklist timeline provider; derive sorted material first-hop principal groups and explicit evidence coverage in DeepCheck; map only confirmed active-blacklist facts into a versioned scoring row; resolve that policy row independently of unrelated partial coverage. Persist every new fact and policy version in fresh reports so Telegram and Admin read the same evidence.

**Tech Stack:** TypeScript, Node.js, Vitest, TronGrid/TronScan HTTP APIs, existing DeepCheck JSON reports and scoring matrix.

---

**Release dependency:** Do not ship this plan alone. After Tasks 1–8, execute `2026-07-11-wallet-narrative-verify20.md` on the same unreleased branch so the new policy is visible through the approved Telegram narrative. Task 9 documentation/verification closes the combined release.

## Policy invariants

- A direct principal counterparty that is actively USDT-blacklisted is `DECLINE` when materiality is proven.
- Materiality is either at least `10,000 USDT`, or at least `100 USDT` and `1%` of an exact complete denominator.
- With partial/unknown denominator coverage, only the absolute branch applies and contributes exactly `60`.
- With exact share coverage, contribution is bounded to `60..90` by the existing profile score.
- GasFree service-fee edges never count as principal; GasFree contracts and accounts remain eligible when they transfer principal.
- A confirmed positive first-hop fact remains decisive despite unrelated partial coverage. Incomplete first-hop coverage cannot support a clean negative final.
- Existing stored jobs keep their historical result. Only reports carrying the new policy version may use the new policy.

### Task 1: Parse and verify an address-scoped blacklist timeline

**Files:**
- Create: `src/tron/usdtBlacklistTimeline.ts`
- Modify: `src/types.ts`
- Test: `tests/tron/usdtBlacklistTimeline.test.ts`

- [ ] **Step 1: Write failing parser and verifier tests**

Cover: address normalization, Unix-second timestamps, duplicate rows, malformed rows, event topic decoding, exact USDT contract, exact `_user`, `AddedBlackList`, `RemovedBlackList`, removal/re-add sequences, and unsuccessful transactions.

```ts
expect(parseBlacklistRows(rows, ADDRESS)).toEqual([
  expect.objectContaining({ blackAddress: ADDRESS, transHash: TX, time: 1783763343 }),
]);
expect(verifyBlacklistEvent(events, ADDRESS)).toMatchObject({
  eventKind: "added",
  occurredAt: "2026-07-11T09:49:03.000Z",
  txHash: TX,
  tokenContract: USDT,
  blockNumber: 73456789,
  logIndex: 2,
  verification: "verified_contract_log",
});
expect(verifyBlacklistEvent(wrongUserEvents, ADDRESS)).toBeNull();
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/tron/usdtBlacklistTimeline.test.ts`

Expected: FAIL because the module and timeline types do not exist.

- [ ] **Step 3: Add the minimal typed timeline model and pure helpers**

Add the approved `TronScanBlacklistRow`, `UsdtBlacklistTimelineEvent`, and `UsdtBlacklistTimeline` shapes to `src/types.ts`. `occurredAt` is ISO; event kind, block, and log index come only from the verified contract log. Timeline uses `pagination: "complete" | "partial"` plus `provider_failed | address_mismatch | wrong_contract | transaction_unconfirmed | event_log_unverified | state_timeline_inconsistent | null`. Checked-window bounds belong to first-hop coverage, not the timeline DTO.

- [ ] **Step 4: Run the focused test**

Run: `npm test -- tests/tron/usdtBlacklistTimeline.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/tron/usdtBlacklistTimeline.ts tests/tron/usdtBlacklistTimeline.test.ts
git commit -m "feat: parse verified USDT blacklist timelines"
```

### Task 2: Fetch the complete address-scoped timeline through the Tron client

**Files:**
- Modify: `src/tron/tronClient.ts`
- Modify: `src/tron/usdtBlacklistTimeline.ts`
- Test: `tests/tron/tronClient.test.ts`

- [ ] **Step 1: Write failing provider tests**

Assert pagination of `/api/stableCoin/blackList` with `blackAddress`, official USDT `tokenAddress`, `sort=2`, `direction=2`, and bounded page size. Assert row tx hash and Unix-seconds time agree with the verified transaction/event, every candidate transaction is confirmed, and exact logs provide block/log order. Cover address/contract mismatch, wrong log, removal/re-add, ambiguous same-timestamp order, and disagreement between reconstructed timeline state and the current restriction state. Assert failures return `pagination: "partial"` plus a typed failure reason rather than a false empty timeline.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/tron/tronClient.test.ts`

Expected: FAIL on missing address-scoped timeline behavior.

- [ ] **Step 3: Implement `getUsdtBlacklistTimeline(address, options)`**

Reuse `fetchJson`, the existing scheduler, retry logic, and key pool. Do not infer add/remove state from the list row: verify `/api/transaction-info` success and `/v1/transactions/{txHash}/events`, because multisig outer calls may target a different contract. Expose the timeline through `getUsdtRestrictionStatus(address, { includeEventTimeline: true })`; request it only after a positive current-state lookup so inactive counterparties do not trigger unnecessary history scans.

- [ ] **Step 4: Run provider tests**

Run: `npm test -- tests/tron/tronClient.test.ts tests/tron/usdtBlacklistTimeline.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tron/tronClient.ts src/tron/usdtBlacklistTimeline.ts tests/tron/tronClient.test.ts
git commit -m "feat: fetch address-scoped blacklist history"
```

### Task 3: Group direct principal transfers before live lookups

**Files:**
- Modify: `src/types.ts`
- Modify: `src/forensics/directHardEvidence.ts`
- Test: `tests/forensics/directHardEvidence.test.ts`

- [ ] **Step 1: Add failing grouping tests**

Test separate inbound/outbound groups, unique transaction hashes, deterministic descending principal sort, exact share semantics, and materiality. Lock exact boundaries at `9,999.999/10,000 USDT`, `99.999/100 USDT`, and `0.999%/1%`. Include a GasFree fixture where `3 USDT` is `service_fee` and `1,176,317 USDT` is principal.

```ts
expect(groups[0]).toMatchObject({
  address: "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm",
  principalAmountRaw: 1_176_317_000000n,
  material: true,
});
expect(groups.some(group => group.principalAmountRaw === 3_000000n)).toBe(false);
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/forensics/directHardEvidence.test.ts`

Expected: FAIL because grouping and materiality fields are missing.

- [ ] **Step 3: Implement `DirectPrincipalCounterpartyGroup`**

Exclude only edges already classified as exact `isGasFreeServiceFeeEdge`. Include contract/account counterparties when the transfer is principal. Build directed facts separately, then create one unique material-address lookup list whose sort key is the address's combined principal amount. Apply the live limit to that unique sorted list so an inbound/outbound address consumes one lookup slot, then project the result back to both directed facts.

- [ ] **Step 4: Run the focused test**

Run: `npm test -- tests/forensics/directHardEvidence.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/forensics/directHardEvidence.ts tests/forensics/directHardEvidence.test.ts
git commit -m "feat: group material first-hop principal transfers"
```

### Task 4: Build persisted first-hop blacklist facts and coverage

**Files:**
- Modify: `src/types.ts`
- Modify: `src/forensics/directHardEvidence.ts`
- Test: `tests/forensics/directHardEvidence.test.ts`

- [ ] **Step 1: Write failing evidence tests**

Require `blacklistFacts`, `labelFacts`, and first-hop lookup coverage. Test every temporal relation: `active_at_transfer`, `became_active_after`, `mixed`, and `unknown`. Persist `effectiveAt`, `effectiveTxHash`, `timelineCoverage`, direction, principal amount/count/share, transfer tx hashes, and the approved `beforeEffective`, `active`, and `unknownTiming` amount/count partitions. Both partition sums must equal the group principal and transaction count. A current active restriction is sufficient for the policy fact even when event chronology is incomplete.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/forensics/directHardEvidence.test.ts`

Expected: FAIL on missing fact and coverage fields.

- [ ] **Step 3: Implement the fact builder**

Perform one screening set per normalized material counterparty: current USDT blacklist, verified timeline, the existing `src/forensics/sanctionedServiceRegistry.ts`, exact/derived internal labels, and existing service classification. Test designation-date matching through the registry rather than adding a network provider. `FirstHopBlacklistFact` must persist `evidenceKind`, `evidenceAuthority`, `statusAtCheck`, `temporalRelation`, `effectiveAt`, `effectiveTxHash`, `checkedAt`, principal amount/count, `directionalPrincipalShare`, `shareSemantics`, transfer tx hashes, all amount/count partitions, `directTransferCoverage`, `timelineCoverage`, and `timelineEvents`. `FirstHopLabelFact` must persist `labelCode`, `evidenceAuthority`, `recordedAt`, `effectiveAt: null`, `linkedToSelectedProvenance`, direction, principal amount/count/share, and transfer tx hashes; never use an internal record creation time as the effective date of an offense or designation. `FirstHopBlacklistCoverage` must persist `requiredForDecision`, scope/window, unique material/checked/failed/unchecked counts, `complete | running | provider_failed | budget_exhausted | history_partial`, incomplete reason, confirmed adverse count, and complete/partial timeline counts. Report all-time coverage as exact only when the underlying transfer index is complete; otherwise name the checked window as partial.

- [ ] **Step 4: Run the focused test**

Run: `npm test -- tests/forensics/directHardEvidence.test.ts`

Expected: PASS, including the chronology-sum invariant.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/forensics/directHardEvidence.ts tests/forensics/directHardEvidence.test.ts
git commit -m "feat: persist first-hop blacklist evidence"
```

### Task 5: Wire evidence through DeepCheck and stored jobs

**Files:**
- Modify: `src/check/deepForensicCheck.ts`
- Modify: `src/index.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Test: `tests/check/deepForensicCheck.test.ts`
- Test: `tests/forensics/deepForensicJob.test.ts`

- [ ] **Step 1: Write failing integration tests**

Assert fresh Deep reports and serialized jobs retain timeline, first-hop facts, coverage, directions, transaction hashes, and amounts. Test both complete all-time and bounded checked-window paths. In the bounded path, exclude sparse fallback transfers outside the declared window.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/check/deepForensicCheck.test.ts tests/forensics/deepForensicJob.test.ts`

Expected: FAIL because fields/options are dropped.

- [ ] **Step 3: Wire the new data without recomputing it**

Replace argument-dropping wrappers with `tronClient.getUsdtRestrictionStatus.bind(tronClient)` so both address and options flow unchanged without a new adapter abstraction. Run `buildDirectHardEvidenceSnapshots` in complete and bounded paths. Snapshot the timeline and facts in `DeepAddressForensicReport`; serialize the same structures in the job result.

- [ ] **Step 4: Run integration tests**

Run: `npm test -- tests/check/deepForensicCheck.test.ts tests/forensics/deepForensicJob.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/check/deepForensicCheck.ts src/index.ts src/forensics/deepForensicJob.ts tests/check/deepForensicCheck.test.ts tests/forensics/deepForensicJob.test.ts
git commit -m "feat: carry first-hop evidence through DeepCheck"
```

### Task 6: Add the versioned direct-counterparty policy row

**Files:**
- Modify: `src/risk/scoringSignalMatrix.ts`
- Modify: `src/risk/scoringSignalMatrixInputs.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Test: `tests/risk/scoringSignalMatrix.test.ts`
- Test: `tests/risk/scoringSignalMatrixInputs.test.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Write failing matrix tests**

Assert a new `direct_counterparty_policy` row whose `authority` is `{ kind: "policy", decisionEligibility: "can_decline", coverageDependency: "none" }`. Only `usdt_blacklist + official_contract + statusAtCheck=active` facts qualify. Evidence IDs must include the direct transfer tx, verified blacklist-event tx when available, and current contract-state evidence. Wallet action unit is `wallet`; `incoming_deposit` is allowed only when the fact contains the exact checked incoming transaction hash.

- [ ] **Step 2: Encode score boundaries in tests**

Assert exact thresholds: partial denominator at `9,999.999/10,000 USDT`; complete denominator at `99.999/100 USDT` and `0.999%/1%`. Partial absolute materiality gives exactly `60`; exact complete share uses the profile contribution clamped to `60..90`. Inactive blacklist, GasFree fee-only, and incomplete relative denominator produce no candidate.

- [ ] **Step 3: Run tests and confirm failure**

Run: `npm test -- tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/forensics/incomingDepositJob.test.ts`

Expected: FAIL because the row and mapping do not exist.

- [ ] **Step 4: Implement matrix v2**

Export `SCORING_SIGNAL_MATRIX_POLICY_VERSION = "scoring-signal-matrix-v2" as const`. Split the current subject stablecoin-blacklist candidate into a dedicated highest-priority restriction row, place `direct_counterparty_policy` next, and keep remaining `hard_proof` candidates after it in `rowPriority`. Candidate selection remains score-first, so an exact approval drain keeps its `95` floor and is never lowered to the direct-policy cap. Do not convert service labels, behavioral hints, or unverified blacklist events into this row.

- [ ] **Step 5: Run matrix tests**

Run: `npm test -- tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/forensics/incomingDepositJob.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/risk/scoringSignalMatrix.ts src/risk/scoringSignalMatrixInputs.ts src/forensics/incomingDepositJob.ts tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "feat: score direct blacklisted counterparties"
```

### Task 7: Resolve independent policy and negative coverage correctly

**Files:**
- Modify: `src/risk/finalDisposition.ts`
- Modify: `src/risk/unifiedWalletRisk.ts`
- Modify: `src/types.ts`
- Test: `tests/risk/finalDisposition.test.ts`
- Test: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Write failing decision tests**

Add `FinalDecisionBasis: "independent_policy"`. Assert a confirmed direct policy row returns `DECLINE` despite unrelated partial coverage, with overall coverage still marked partial. Assert incomplete required first-hop coverage with no positive fact produces exactly `NO_FINAL_DECISION`, not `REVIEW` or a clean result.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/risk/finalDisposition.test.ts tests/risk/unifiedWalletRisk.test.ts`

Expected: FAIL on the missing basis and coverage rules.

- [ ] **Step 3: Implement the smallest resolver change**

Resolve exact hard proof first, then independent policy, then invalid-coverage fallback. Keep first-hop negative coverage separate from unrelated coverage so a positive fact is not erased and an unchecked negative is not presented as clean.

- [ ] **Step 4: Run decision tests**

Run: `npm test -- tests/risk/finalDisposition.test.ts tests/risk/unifiedWalletRisk.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/risk/finalDisposition.ts src/risk/unifiedWalletRisk.ts tests/risk/finalDisposition.test.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "fix: resolve independent policy under partial coverage"
```

### Task 8: Version fresh reports and preserve legacy decisions

**Files:**
- Modify: `src/check/deepForensicCheck.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `src/admin/adminServer.ts`
- Modify: `src/risk/scoringAudit.ts`
- Modify: `src/risk/shadowScoring.ts`
- Test: `tests/forensics/deepForensicJob.test.ts`
- Test: `tests/bot/createBot.test.ts`
- Test: `tests/admin/adminServer.test.ts`
- Test: `tests/risk/scoringAudit.test.ts`
- Test: `tests/risk/shadowScoring.test.ts`

- [ ] **Step 1: Write failing compatibility tests**

Assert fresh reports persist `scoringPolicyVersion: "scoring-signal-matrix-v2"`. Assert audit and shadow payloads use the shared constant instead of hard-coded v1. Assert stored reports without that exact marker display their stored score/decision, request a fresh rerun for v2, and are not recalculated or reused as current even when legacy `scoreValid` is present.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/forensics/deepForensicJob.test.ts tests/bot/createBot.test.ts tests/admin/adminServer.test.ts tests/risk/scoringAudit.test.ts tests/risk/shadowScoring.test.ts`

Expected: FAIL because the persisted version guard is absent.

- [ ] **Step 3: Add the explicit version guard**

Use a shared constant and exact equality. Do not migrate or rewrite old JSONB rows. Do not use `hasExplicitWhereScoreValidity()` as a substitute for policy-version compatibility.

- [ ] **Step 4: Run compatibility tests**

Run: `npm test -- tests/forensics/deepForensicJob.test.ts tests/bot/createBot.test.ts tests/admin/adminServer.test.ts tests/risk/scoringAudit.test.ts tests/risk/shadowScoring.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/check/deepForensicCheck.ts src/forensics/deepForensicJob.ts src/bot/createBot.ts src/admin/adminServer.ts src/risk/scoringAudit.ts src/risk/shadowScoring.ts tests/forensics/deepForensicJob.test.ts tests/bot/createBot.test.ts tests/admin/adminServer.test.ts tests/risk/scoringAudit.test.ts tests/risk/shadowScoring.test.ts
git commit -m "fix: preserve legacy scoring policy results"
```

### Task 9: Lock the policy in knowledge docs and run full verification

**Files:**
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/06-deepcheck.md`
- Modify: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`
- Modify: `docs/knowledge/13-agent-observations.md`

- [ ] **Step 1: Document the implemented invariants**

Record materiality, partial-denominator behavior, direct-policy independence, GasFree principal/fee split, timeline verification, first-hop negative coverage, and legacy version preservation. Close the existing direct-counterparty hard-evidence item in `10-open-problems.md`. Add the recurring correction that contract/account type must not exclude principal from scoring.

- [ ] **Step 2: Run focused suites**

Run:

```bash
npm test -- tests/tron/usdtBlacklistTimeline.test.ts tests/tron/tronClient.test.ts tests/forensics/directHardEvidence.test.ts tests/check/deepForensicCheck.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/finalDisposition.test.ts tests/risk/unifiedWalletRisk.test.ts tests/risk/scoringAudit.test.ts tests/risk/shadowScoring.test.ts tests/bot/createBot.test.ts tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the complete project checks**

Run: `npm test`

Expected: all suites pass with zero failures.

Run: `npm run typecheck`

Expected: exit code `0`.

- [ ] **Step 4: Check the diff**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: Commit docs**

```bash
git add docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/06-deepcheck.md docs/knowledge/07-risk-scoring-matrix.md docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/13-agent-observations.md
git commit -m "docs: record first-hop blacklist scoring policy"
```

## Completion criteria

- TGyt-style GasFree principal is scored; its fee is excluded.
- Active direct blacklist evidence produces `DECLINE` under the approved materiality rules.
- Partial coverage never invents a percentage and never hides a confirmed positive fact.
- Incomplete negative first-hop coverage cannot claim the address is clean.
- Fresh jobs carry matrix v2; legacy stored jobs retain their historical decision.
- Provider, DeepCheck, scoring, bot, Admin, typecheck, and full test suite pass.
