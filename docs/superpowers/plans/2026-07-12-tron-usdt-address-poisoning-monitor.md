# TRON USDT Address Poisoning Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an immediate deterministic Telegram warning when a watched TRON wallet receives a small USDT transfer from an address that imitates a recent genuine recipient, while preserving evidence for the future recipient precheck and keeping AML scoring unchanged.

**Architecture:** The main monitor computes only a cheap eligibility status and stores it atomically with the observed incoming transfer. A separately scheduled worker claims persisted checks, reads one bounded logical page of recent official USDT transfers, runs a pure detector, persists one candidate plus typed evidence, and delivers a dedicated alert. Wallet-safety observations are stored with zero score impact and are excluded from AML reads and unified scoring inputs.

**Tech Stack:** TypeScript 5.7, Node.js, PostgreSQL, Grammy Telegram bot, existing TronScan scheduler/client, Vitest.

---

## Execution Preconditions

- Implement in an isolated `codex/address-poisoning-alerts` worktree created from `master`; the current main worktree contains unrelated user changes and must not be cleaned, reset, staged, or reformatted.
- Read `docs/superpowers/specs/2026-07-12-tron-usdt-address-poisoning-monitor-design.md` before each task that changes behavior.
- Keep runtime support USDT-only. Do not add USDD monitoring or recipient blocking in this plan.
- Use test-first development and commit after every task below.
- Telegram delivery is at-least-once. A stored `sent` fingerprint is never reclaimed, but Telegram has no idempotency key for the crash window after API acceptance and before the database write.

## File Map

**Create**

- `migrations/031_address_poisoning_monitor.sql` — queue state, candidate storage, constraints, indexes, and `wallet_safety` database guards.
- `src/risk/riskSignalGroups.ts` — the one allowlist boundary between AML-scoring groups and wallet safety.
- `src/monitor/addressPoisoning.ts` — pure address comparison, match classification, ranking, and initial eligibility.
- `src/monitor/addressPoisoningWorker.ts` — bounded claim/process/deliver cycle and structured metrics.
- `src/alerts/addressPoisoningAlert.ts` — poisoning-specific Telegram formatter and keyboard.
- `tests/fixtures/monitor/addressPoisoningCases.ts` — verified THJ fixture, including separate post-loss facts.
- `tests/risk/riskSignalGroups.test.ts` — zero-impact and AML-exclusion regression tests.
- `tests/monitor/addressPoisoning.test.ts` — pure detector tests.
- `tests/monitor/addressPoisoningWorker.test.ts` — worker lifecycle, pagination, concurrency, retry, delivery, and SLO tests.
- `tests/alerts/addressPoisoningAlert.test.ts` — canonical alert and keyboard tests.

**Modify**

- `src/types.ts` — add poisoning state types and split AML-scoring groups from `wallet_safety`.
- `src/risk/evaluation.ts` — restrict reason metadata and inference to AML-scoring groups.
- `src/storage/repositories.ts` — persistence, claims, CAS transitions, alert dedupe, and separate observation reads.
- `src/monitor/monitorWorker.ts` — atomically persist the initial poisoning status without a provider lookup.
- `src/forensics/serviceClassifier.ts` — expose exact authoritative address-registry matching without using provider text.
- `src/forensics/incomingDepositJob.ts` — check whether a poisoning warning is active immediately before formatting.
- `src/alerts/formatters.ts` — keep the active-warning line in later Incoming Deposit output.
- `src/bot/keyboards.ts` — parse compact poisoning callback tokens.
- `src/bot/createBot.ts` — owner-bound confirm/dismiss actions.
- `src/config.ts` and `.env.example` — product threshold configuration.
- `src/runtime/startupSchedule.ts` and `src/index.ts` — independent non-overlapping worker schedule and wiring.
- `tests/storage/repositories.test.ts` — schema-independent repository SQL and transaction behavior.
- `tests/monitor/monitorWorker.test.ts` — freshness, threshold, paused, and non-blocking enqueue.
- `tests/forensics/incomingDepositJob.test.ts` — active-warning lookup timing.
- `tests/alerts/formatters.test.ts` — Incoming warning copy.
- `tests/bot/createBot.test.ts` — callback parsing, authorization, and idempotency.
- `tests/config/config.test.ts` and `tests/runtime/startupSchedule.test.ts` — defaults and scheduler label.
- `tests/tron/tronClient.test.ts` — short-timeout client behavior remains isolated from the normal client.
- current knowledge documents listed in Task 10.

## Task 1: Build The Pure Detector And Historical Fixture

**Files:**

- Create: `src/monitor/addressPoisoning.ts`
- Create: `tests/fixtures/monitor/addressPoisoningCases.ts`
- Create: `tests/monitor/addressPoisoning.test.ts`

- [ ] **Step 1: Write the verified THJ fixture**

```ts
export const THJ_POISONING_CASE = {
  watchedWallet: "THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7",
  realRecipient: "THDppXpzBV14Wp9o47zkDRjpLvZSCd58Fg",
  lookalike: "TABPfWW3Q7vCnfPQgQ8BCpjHqFqhCd58Fg",
  outgoingTxHash: "8c70cadc7128323239873d886e0c20ae6feb1d6096c951159c3517793e16d44f",
  incomingTxHash: "2c973bca918030e1ed0f49f4e69192368837c050398dc980fabf8ae2cdecbb4e",
  outgoingAt: new Date("2026-07-01T12:46:57.000Z"),
  incomingAt: new Date("2026-07-01T12:47:42.000Z"),
  amountRaw: "10000000",
  postLoss: {
    lossTxHash: "976f0e1609cf0721a9026995e1ccc238b1110ee56c0485c4038226e5ff6c2df7",
    lossAmountRaw: "282693000000",
    psmTxHash: "2fc22b7b5a0da88e506864aa7c073af863ca18fee4116017229d5be296612be4e"
  }
} as const;
```

Keep `postLoss` outside the detector input in every test.

- [ ] **Step 2: Write failing detector tests**

```ts
it("detects the THJ six-character exact-amount lure as CRITICAL", () => {
  const result = detectAddressPoisoning({
    incoming: incomingFromFixture(THJ_POISONING_CASE),
    checkedTransfers: [outgoingFromFixture(THJ_POISONING_CASE)],
    coverage: "partial",
    suppression: null
  });

  expect(result).toMatchObject({
    kind: "candidate",
    primary: {
      classification: "CRITICAL",
      meaningfulPrefixLength: 0,
      suffixLength: 6,
      exactAmount: true,
      elapsedMs: 45_000
    },
    secondary: []
  });
});

it("keeps a negative truncated lookup inconclusive", () => {
  expect(detectAddressPoisoning({
    incoming: incomingFromFixture(THJ_POISONING_CASE),
    checkedTransfers: [],
    coverage: "partial",
    suppression: null
  })).toEqual({ kind: "inconclusive", reason: "partial_no_match" });
});
```

Add cases for identical addresses, the universal leading `T`, suffix five, events after 24 hours, token mismatch, future transfers, prior sender relationship, complete negative coverage, manual trust, authoritative service, free-text labels, and stable multi-match ranking.

- [ ] **Step 3: Run the tests and verify the expected failure**

Run:

```powershell
npx vitest run --configLoader bundle tests/monitor/addressPoisoning.test.ts
```

Expected: FAIL because `src/monitor/addressPoisoning.ts` does not exist.

- [ ] **Step 4: Implement the detector with one deterministic comparator**

Add these public contracts:

```ts
export const ADDRESS_POISONING_POLICY_VERSION = "address-poisoning-v1";

export type AddressPoisoningDetectionResult =
  | { kind: "candidate"; primary: AddressPoisoningMatch; secondary: AddressPoisoningMatch[] }
  | { kind: "clear"; reason: "complete_no_match" | "trusted_sender" | "authoritative_service" | "prior_relationship" }
  | { kind: "inconclusive"; reason: "partial_no_match" };

export function compareTronAddresses(real: string, candidate: string): AddressSimilarity;
export function rankAddressPoisoningMatches(matches: readonly AddressPoisoningMatch[]): AddressPoisoningMatch[];
export function detectAddressPoisoning(input: AddressPoisoningDetectionInput): AddressPoisoningDetectionResult;
export function initialAddressPoisoningCheckStatus(input: {
  amountRaw: string;
  sender: string;
  receiver: string;
  eventAt: Date;
  now: Date;
  realtimeMaxAgeMs: number;
  maxAmountRaw: string;
  alertMode: WalletAlertMode;
}): { status: "pending" | "skipped" | "skipped_backfill"; reason: string | null };
```

The match comparator must use this exact order:

```ts
const rank = (value: AddressPoisoningMatch) => value.classification === "CRITICAL" ? 2 : 1;

export function compareMatches(a: AddressPoisoningMatch, b: AddressPoisoningMatch): number {
  return rank(b) - rank(a)
    || (b.meaningfulPrefixLength + b.suffixLength) - (a.meaningfulPrefixLength + a.suffixLength)
    || Number(b.exactAmount) - Number(a.exactAmount)
    || a.elapsedMs - b.elapsedMs
    || b.outgoingAt.getTime() - a.outgoingAt.getTime()
    || a.outgoingTxHash.localeCompare(b.outgoingTxHash);
}
```

Apply these exact thresholds:

```text
strong = suffix >= 6 OR meaningful prefix after T >= 6 OR (suffix >= 4 AND meaningful prefix >= 3)
moderate = suffix == 5 OR meaningful prefix after T == 5, unless the combined strong rule applies
CRITICAL = strong AND exact raw amount AND same token contract AND elapsed time <= 24 hours
HIGH = strong or moderate within 24 hours when CRITICAL does not apply
```

Use raw `BigInt` amounts. Do not accept symbol-only token identity. Missing account-creation metadata must not suppress a candidate. Positive partial evidence may return a candidate; only complete negative coverage or an exact disqualifier may return `clear`. The detector module must have no LLM import or dependency.

- [ ] **Step 5: Run detector tests**

Run the Task 1 Vitest command again. Expected: PASS.

- [ ] **Step 6: Commit the detector**

```powershell
git add src/monitor/addressPoisoning.ts tests/fixtures/monitor/addressPoisoningCases.ts tests/monitor/addressPoisoning.test.ts
git commit -m "feat: add deterministic address poisoning detector"
```

## Task 2: Add Schema, State Types, And Atomic Persistence

**Files:**

- Create: `migrations/031_address_poisoning_monitor.sql`
- Modify: `src/types.ts`
- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/repositories.test.ts`

- [ ] **Step 1: Write failing repository tests for the new lifecycle**

Test these exact invariants:

```ts
it("claims retryable poisoning checks with skip locked", async () => {
  await claimAddressPoisoningChecks(db, claimInput);
  expect(lastSql()).toContain("for update of tx skip locked");
  expect(lastSql()).toContain("poisoning_lookup_page_count < $5");
});

it("does not overwrite a terminal candidate on retry", async () => {
  const saved = await persistAddressPoisoningCandidate(db, candidateInput);
  expect(transactionSql()).toContain("when address_poisoning_candidates.status in ('confirmed', 'dismissed')");
  expect(saved.id).toBe(candidateInput.id);
});
```

Also cover default historical rows, stale `running`, page continuation, five-page terminal `inconclusive`, rollback, one candidate per incoming tx, alert claims, and owner-bound CAS.

- [ ] **Step 2: Run repository tests and verify failure**

```powershell
npx vitest run --configLoader bundle tests/storage/repositories.test.ts
```

Expected: FAIL on missing repository exports.

- [ ] **Step 3: Add poisoning and signal-group types**

```ts
export type ScoringRiskSignalGroup =
  | "internal_label" | "provider" | "graph" | "behavior"
  | "incoming_context" | "approval" | "manual";
export type RiskSignalGroup = ScoringRiskSignalGroup | "wallet_safety";

export type AddressPoisoningCheckStatus =
  | "pending" | "running" | "inconclusive" | "clear"
  | "candidate" | "failed" | "skipped" | "skipped_backfill";
export type AddressPoisoningCoverage = "complete" | "partial";
export type AddressPoisoningClassification = "CRITICAL" | "HIGH";
export type AddressPoisoningCandidateStatus = "candidate" | "confirmed" | "dismissed";
export type AddressPoisoningAlertStatus = "pending" | "sending" | "sent" | "failed" | "skipped";
```

- [ ] **Step 4: Add the migration**

The migration must:

1. add poisoning status, attempt, retry time, logical offset, page count, fetched count, oldest timestamp, coverage, accumulated lookup JSON, error, updated time, and checked time to `observed_transactions`;
2. set every pre-migration row to `skipped_backfill` and keep that as the safe column default for inserts that do not explicitly opt into the detector;
3. create `address_poisoning_candidates` with a unique opaque callback token and unique `(watched_wallet_id, token_contract, suspicious_incoming_tx_hash)`;
4. add retry, active-candidate, suspicious-sender, and alert-delivery indexes;
5. recreate the observation group constraint with `wallet_safety` and add the zero-impact constraint.

Use these constraints verbatim:

```sql
check (poisoning_check_status in (
  'pending', 'running', 'inconclusive', 'clear', 'candidate',
  'failed', 'skipped', 'skipped_backfill'
));
check (poisoning_lookup_coverage is null or poisoning_lookup_coverage in ('complete', 'partial'));
check (signal_group <> 'wallet_safety' or score_impact = 0);
check (classification in ('CRITICAL', 'HIGH'));
check (status in ('candidate', 'confirmed', 'dismissed'));
check (alert_status in ('pending', 'sending', 'sent', 'failed', 'skipped'));
```

The candidate table must also store both tx hashes, both complete addresses, raw amounts, token metadata, both timestamps, prefix/suffix lengths, classification, confidence, raw evidence id, secondary matches through evidence JSON, alert fingerprint/state, Telegram message identifiers, optional later-loss evidence, and timestamps.

- [ ] **Step 5: Implement repository contracts**

Add these exact exports:

```ts
claimAddressPoisoningChecks(db, input): Promise<AddressPoisoningCheckWorkItem[]>;
skipExpiredAddressPoisoningChecks(db, input): Promise<number>;
skipPausedAddressPoisoningChecks(db, input): Promise<number>;
markAddressPoisoningCheckClear(db, input): Promise<boolean>;
markAddressPoisoningCheckInconclusive(db, input): Promise<boolean>;
markAddressPoisoningCheckFailed(db, input): Promise<boolean>;
markAddressPoisoningCheckSkipped(db, input): Promise<boolean>;
persistAddressPoisoningCandidate(db, input): Promise<AddressPoisoningCandidate>;
claimAddressPoisoningAlertsForDelivery(db, input): Promise<AddressPoisoningCandidateDelivery[]>;
markAddressPoisoningAlertSent(db, input): Promise<boolean>;
markAddressPoisoningAlertFailed(db, input): Promise<boolean>;
markAddressPoisoningAlertSkipped(db, input): Promise<boolean>;
resolveAddressPoisoningCandidate(db, input): Promise<{
  outcome: "updated" | "idempotent" | "conflict" | "unavailable";
  candidate: AddressPoisoningCandidate | null;
}>;
hasUndismissedAddressPoisoningCandidateForIncoming(db, input): Promise<boolean>;
getAddressPoisoningQueueMetrics(db, now): Promise<{ queueDepth: number; oldestQueueAgeMs: number | null }>;
```

Claims must use `FOR UPDATE SKIP LOCKED` and order eligible rows by event timestamp descending so a fresh security event does not wait behind older continuation work. Retry provider failures after 30, 60, and 120 seconds and stop after three failures. An `inconclusive` row is claimable only while page count is below five; a full fifth page leaves a non-retryable `inconclusive` row. Candidate persistence must insert deterministic raw evidence and a zero-impact `wallet_safety` observation in the same transaction that upserts the candidate and moves the observed tx from `running` to `candidate`. Never reset `confirmed`, `dismissed`, a callback token, or a stored `sent` alert during retry.

Generate the compact token without a dependency:

```ts
const callbackToken = randomBytes(15).toString("base64url"); // 20 characters
```

Add `wallet_safety` to the repository parser allowlist in the same change. Derive evidence and observation ids from policy version, watched wallet id, token contract, and incoming tx hash so retry reuses them.

- [ ] **Step 6: Run migration and repository checks**

```powershell
npm run db:migrate
npx vitest run --configLoader bundle tests/storage/repositories.test.ts
```

Expected: migration succeeds and tests PASS.

- [ ] **Step 7: Commit schema and persistence**

```powershell
git add migrations/031_address_poisoning_monitor.sql src/types.ts src/storage/repositories.ts tests/storage/repositories.test.ts
git commit -m "feat: persist address poisoning checks and candidates"
```

## Task 3: Enforce Wallet-Safety Isolation From AML Scoring

**Files:**

- Create: `src/risk/riskSignalGroups.ts`
- Create: `tests/risk/riskSignalGroups.test.ts`
- Modify: `src/risk/evaluation.ts`
- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/repositories.test.ts`

- [ ] **Step 1: Write failing zero-impact and exclusion tests**

```ts
it("excludes wallet safety from AML observations even if a fixture is malformed", () => {
  const malformed = observation({ signalGroup: "wallet_safety", scoreImpact: 90 });
  expect(filterAmlRiskSignalObservations([malformed])).toEqual([]);
});

it("rejects non-zero wallet safety persistence before opening a transaction", async () => {
  await expect(saveRiskEvaluationEvidence(db, {
    rawEvidence: [],
    observations: [observation({ signalGroup: "wallet_safety", scoreImpact: 90 })]
  })).rejects.toThrow("wallet_safety observations must have scoreImpact 0");
  expect(db.connect).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

```powershell
npx vitest run --configLoader bundle tests/risk/riskSignalGroups.test.ts tests/storage/repositories.test.ts
```

Expected: FAIL because the guard module and group are missing.

- [ ] **Step 3: Implement the scoring allowlist**

```ts
const AML_GROUPS = new Set<ScoringRiskSignalGroup>([
  "internal_label", "provider", "graph", "behavior",
  "incoming_context", "approval", "manual"
]);

export function isAmlRiskSignalObservation(
  observation: RiskSignalObservationInput
): observation is RiskSignalObservationInput & { signalGroup: ScoringRiskSignalGroup } {
  return AML_GROUPS.has(observation.signalGroup as ScoringRiskSignalGroup);
}

export function filterAmlRiskSignalObservations(
  observations: readonly RiskSignalObservationInput[]
): Array<RiskSignalObservationInput & { signalGroup: ScoringRiskSignalGroup }> {
  return observations.filter(isAmlRiskSignalObservation);
}
```

Make `ReasonMetadata.signalGroup`, `inferSignalGroup`, and `groupForReason` use `ScoringRiskSignalGroup`; they must not be able to emit `wallet_safety`.

- [ ] **Step 4: Separate repository reads and add runtime guards**

Keep the existing all-observation audit read for support. Add:

```ts
export async function listRecentAmlRiskSignalObservations(
  db: Db,
  input: { subjectAddress: string; chain?: string; limit?: number }
): Promise<RiskSignalObservationInput[]>;

export async function listRecentWalletSafetyObservations(
  db: Db,
  input: { subjectAddress: string; chain?: string; limit?: number }
): Promise<RiskSignalObservationInput[]>;
```

The first SQL contains `signal_group <> 'wallet_safety'`; the second contains `signal_group = 'wallet_safety'`.

Validate zero impact in both evidence persistence functions before `db.connect()`. Do not add observations to `UnifiedWalletRiskInput` or `CalculateUnifiedIncomingDepositRiskInput`; current unified scoring correctly consumes reports, not audit rows.

- [ ] **Step 5: Run risk, storage, and unified regressions**

```powershell
npx vitest run --configLoader bundle tests/risk/riskSignalGroups.test.ts tests/storage/repositories.test.ts tests/risk/unifiedWalletRisk.test.ts
```

Expected: PASS with unchanged unified scores.

- [ ] **Step 6: Commit scoring isolation**

```powershell
git add src/risk/riskSignalGroups.ts src/risk/evaluation.ts src/storage/repositories.ts tests/risk/riskSignalGroups.test.ts tests/storage/repositories.test.ts
git commit -m "fix: isolate wallet safety from AML scoring"
```

## Task 4: Atomically Enqueue Fresh Checks In The Main Monitor

**Files:**

- Modify: `src/monitor/monitorWorker.ts`
- Modify: `src/storage/repositories.ts`
- Modify: `src/config.ts`
- Modify: `.env.example`
- Modify: `tests/monitor/monitorWorker.test.ts`
- Modify: `tests/config/config.test.ts`

- [ ] **Step 1: Write failing monitor tests**

Assert:

```ts
expect(claimObservedTransactionForUserAlert).toHaveBeenCalledWith({
  watchedWalletId: wallet.id,
  event: freshTenUsdt,
  poisoningCheckStatus: "pending",
  poisoningCheckReason: null
});
expect(listRelatedTrc20Transfers).not.toHaveBeenCalled();
expect(queueIncomingDepositJob).toHaveBeenCalledTimes(1);
```

Add separate cases for `skipped_backfill`, `paused`, self-transfer, zero, and above-threshold amounts.

- [ ] **Step 2: Run monitor/config tests and verify failure**

```powershell
npx vitest run --configLoader bundle tests/monitor/monitorWorker.test.ts tests/config/config.test.ts
```

- [ ] **Step 3: Add the single product configuration value**

```text
ADDRESS_POISONING_SMALL_TRANSFER_MAX_USDT=100
```

Parse it as a non-negative decimal string, convert it to six-decimal raw USDT once at startup, and pass the raw string into the monitor. Do not add a floating-point amount comparison.

Add `addressPoisoningSmallTransferMaxUsdt: string` to `AppConfig`; keep the parsed value as text until `parseUsdtDecimalToRaw()` converts it.

- [ ] **Step 4: Persist initial status in the existing insert**

Extend `claimObservedTransactionForUserAlert` with:

```ts
poisoningCheckStatus: "pending" | "skipped" | "skipped_backfill";
poisoningCheckReason: string | null;
```

Compute the status before the insert and save it atomically with the observed transaction. This avoids a crash window between the ordinary observation and a second poisoning update. After a successful claim, continue directly into the existing Incoming Deposit queue; do not await any poisoning provider work.

- [ ] **Step 5: Run monitor/config tests**

Run the Task 4 command again. Expected: PASS.

- [ ] **Step 6: Commit the non-blocking enqueue**

```powershell
git add src/monitor/monitorWorker.ts src/storage/repositories.ts src/config.ts .env.example tests/monitor/monitorWorker.test.ts tests/config/config.test.ts
git commit -m "feat: enqueue fresh poisoning checks from monitor"
```

## Task 5: Implement The Independent Bounded Worker

**Files:**

- Create: `src/monitor/addressPoisoningWorker.ts`
- Create: `tests/monitor/addressPoisoningWorker.test.ts`
- Modify: `src/forensics/serviceClassifier.ts`
- Modify: `tests/tron/tronClient.test.ts`

- [ ] **Step 1: Write failing worker lifecycle tests**

Cover these results with injected limits:

```ts
const metrics = await runSingleAddressPoisoningCycle(deps, {
  claimLimit: 20,
  concurrency: 2,
  pageSize: 100,
  maxPages: 5,
  realtimeMaxAgeMs: 15 * 60_000,
  retryDelayMs: 30_000
});

expect(metrics.claimed).toBeLessThanOrEqual(20);
expect(maxObservedProviderConcurrency).toBeLessThanOrEqual(2);
expect(normalIncomingCalls).toBe(0);
```

Add tests for continuation offsets `0 -> 100 -> 200`, short final page `clear`, full fifth page `inconclusive`, positive partial candidate, exact disqualifier, provider failure retaining the offset, stale retry skip, and future transfers ignored.

- [ ] **Step 2: Run worker tests and verify failure**

```powershell
npx vitest run --configLoader bundle tests/monitor/addressPoisoningWorker.test.ts
```

- [ ] **Step 3: Expose exact authoritative service matching**

Add an export that reads only the exact-address map already used by `serviceClassifier.ts`:

```ts
export function authoritativeRegisteredService(address: string): { identity: string; evidence: string } | null {
  const registered = KNOWN_POOLED_SERVICE_ADDRESSES.get(address);
  return registered ? { identity: registered.identity, evidence: registered.evidence } : null;
}
```

Do not use contract names, provider tags, public tags, token names, or `matchServiceRouteRegistryPhrase` for alert suppression. Manual suppression requires a `trusted` or `false_positive` `AddressLabel` whose source is `service_admin`.

- [ ] **Step 4: Implement the worker contracts and page algorithm**

```ts
export const ADDRESS_POISONING_WORKER_DEFAULTS = {
  claimLimit: 20,
  concurrency: 2,
  pageSize: 100,
  maxPages: 5,
  retryDelayMs: 30_000,
  maxFailureAttempts: 3
} as const;

export async function runSingleAddressPoisoningCycle(
  deps: AddressPoisoningWorkerDeps,
  options: AddressPoisoningWorkerOptions = ADDRESS_POISONING_WORKER_DEFAULTS
): Promise<AddressPoisoningCycleMetrics>;
```

For each claimed row:

1. request `listRelatedTrc20Transfers(address, { start, limit: 100, minTimestamp, endTimestamp: incomingAt - 1 })`;
2. normalize with `shouldIndexCanonicalTronscanUsdtTransfer()` and `normalizeTronscanTransferForAddressIndex()` from `src/forensics/tronAddressAllTimeIndex.ts`, and use `parseUsdtDecimalToRaw()` from `src/forensics/usdtAmount.ts` for display inputs;
3. filter again to timestamps strictly before the incoming event;
4. merge matches and provider hashes into persisted `poisoning_lookup_json`;
5. run the pure detector;
6. persist `candidate`, `clear`, or the next `inconclusive` offset with CAS from `running`;
7. stop lookup immediately after a positive result and rank all matches actually fetched so far.

At the start of every cycle, mark rows older than the realtime limit as `skipped_backfill` and rows whose wallet is currently `paused` as `skipped`. Then claim check work, process it, claim candidate-alert delivery, and deliver it. Failures in any poisoning stage are persisted and logged but never call or fail the ordinary Incoming Deposit path.

Use two consumer loops over one in-memory claimed array for concurrency; do not add a dependency.

- [ ] **Step 5: Prove the dedicated short-timeout TronScan configuration in tests**

Instantiate the worker client with the existing shared scheduler but separate HTTP behavior:

```ts
const addressPoisoningTronClient = new TronscanClient({
  baseUrl: config.tronscanBaseUrl,
  fullNodeBaseUrl: config.tronFullNodeBaseUrl,
  apiKey: config.tronscanApiKeys,
  fullNodeApiKey: config.tronFullNodeApiKey,
  timeoutMs: 5_000,
  retryAttempts: 0,
  retryBaseDelayMs: config.tronscanRetryBaseDelayMs,
  scheduler: tronscanScheduler
});
```

The existing client AbortController performs real cancellation; do not wrap the normal client in `Promise.race`. Add a client test proving the five-second worker instance aborts without changing retry behavior of the ordinary instance. Create the actual runtime instance in Task 9 after the scheduler label exists.

- [ ] **Step 6: Run worker and Tron client tests**

```powershell
npx vitest run --configLoader bundle tests/monitor/addressPoisoningWorker.test.ts tests/tron/tronClient.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the worker**

```powershell
git add src/monitor/addressPoisoningWorker.ts src/forensics/serviceClassifier.ts tests/monitor/addressPoisoningWorker.test.ts tests/tron/tronClient.test.ts
git commit -m "feat: process poisoning checks in bounded worker"
```

## Task 6: Format And Deliver The Dedicated Telegram Alert

**Files:**

- Create: `src/alerts/addressPoisoningAlert.ts`
- Create: `tests/alerts/addressPoisoningAlert.test.ts`
- Modify: `src/monitor/addressPoisoningWorker.ts`
- Modify: `src/storage/repositories.ts`
- Modify: `tests/monitor/addressPoisoningWorker.test.ts`

- [ ] **Step 1: Write failing formatter and delivery tests**

The canonical Russian assertion must include:

```text
🔴 Возможна подмена адреса
Пришло 10 USDT от адреса, который не встречался среди переводов за проверенные 24 часа
TABPfWW3Q7vCnfPQgQ8BCpjHqFqhCd58Fg
THDppXpzBV14Wp9o47zkDRjpLvZSCd58Fg
последние 6 символов
45 секунд назад
```

Assert two TronScan URL buttons, two mutation buttons, full addresses inside escaped `<code>` tags, and callback payloads shorter than 64 bytes.
Also assert the wallet address and the concrete instruction not to copy the recipient from transaction history. Keep the shown Russian text canonical and add a concise English fallback selected through the existing `BotLocale`.

- [ ] **Step 2: Run alert tests and verify failure**

```powershell
npx vitest run --configLoader bundle tests/alerts/addressPoisoningAlert.test.ts tests/monitor/addressPoisoningWorker.test.ts
```

- [ ] **Step 3: Implement the focused formatter and keyboard**

```ts
export function formatAddressPoisoningAlert(candidate: AddressPoisoningCandidateDelivery): TelegramAlertMessage;
export function addressPoisoningAlertKeyboard(input: {
  callbackToken: string;
  incomingTxHash: string;
  outgoingTxHash: string;
  terminal?: boolean;
}): InlineKeyboard;
```

Callback values are:

```text
poison:dismiss:<16-24 base64url characters>
poison:confirm:<16-24 base64url characters>
```

The terminal keyboard retains both transaction links and removes mutation buttons.

- [ ] **Step 4: Add claim/send/mark delivery**

The worker must claim `pending`, `failed`, and stale `sending` candidate alerts independently from check claims. Deliver immediately for `realtime`, `risk_only`, and `digest`; mark `paused` as skipped. Fingerprint the formatter policy plus every displayed immutable fact before the claim.

On successful Telegram send, store `sent`, fingerprint, chat id, message id, and timestamps. On failure, store bounded error and increment attempts. Never modify `observed_transactions.user_alert_status` from this path.

- [ ] **Step 5: Test dedupe and the external crash gap**

Assert a stored `sent` fingerprint is never reclaimed. Add a test/documentation assertion that a simulated crash before `markAddressPoisoningAlertSent` leaves `sending` retryable; this is the intentional at-least-once crash gap, not an exactly-once promise.

- [ ] **Step 6: Run alert and worker tests**

Run the Task 6 command again. Expected: PASS.

- [ ] **Step 7: Commit alert delivery**

```powershell
git add src/alerts/addressPoisoningAlert.ts src/monitor/addressPoisoningWorker.ts src/storage/repositories.ts tests/alerts/addressPoisoningAlert.test.ts tests/monitor/addressPoisoningWorker.test.ts
git commit -m "feat: deliver immediate poisoning warnings"
```

## Task 7: Authorize Confirm And Dismiss Callbacks

**Files:**

- Modify: `src/bot/keyboards.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `src/storage/repositories.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write failing parser and authorization tests**

```ts
expect(parseCallbackData("poison:confirm:AbCdEf0123_-xyZ9")).toEqual({
  kind: "address_poisoning_confirm",
  callbackToken: "AbCdEf0123_-xyZ9"
});
expect(parseCallbackData("poison:confirm:token:extra")).toBeNull();
```

Simulate owner, wrong user, forwarded-message outsider, unknown token, repeated same action, and opposite terminal action. Wrong user and unknown token must receive the same neutral response and make zero writes.

- [ ] **Step 2: Run bot tests and verify failure**

```powershell
npx vitest run --configLoader bundle tests/bot/createBot.test.ts
```

- [ ] **Step 3: Add strict callback parsing**

```ts
| { kind: "address_poisoning_dismiss"; callbackToken: string }
| { kind: "address_poisoning_confirm"; callbackToken: string }
```

Parse only `/^poison:(dismiss|confirm):([A-Za-z0-9_-]{16,24})$/`.

- [ ] **Step 4: Implement owner-bound CAS handling**

For poisoning actions, parse before the generic early callback acknowledgement so the handler can return action-specific text. Call the repository with only:

```ts
{
  callbackToken: callback.callbackToken,
  telegramUserId: String(ctx.from.id),
  resolution: callback.kind === "address_poisoning_confirm" ? "confirmed" : "dismissed"
}
```

The SQL mutation must join `watched_wallets` and include `watched_wallets.telegram_user_id = $telegramUserId`. Do not trust chat id, forwarded metadata, message owner, callback wallet id, or a prior read. Return the outcome plus candidate facts only for an authorized `updated` or `idempotent` result. Use the same neutral text for `conflict` and `unavailable` to avoid leaking candidate existence.

- [ ] **Step 5: Remove mutation buttons after owner success**

Edit only `reply_markup` using the terminal keyboard. Preserve message text and both transaction links. Repeated identical action returns the same success text without another state transition.

- [ ] **Step 6: Run bot tests**

Run the Task 7 command again. Expected: PASS.

- [ ] **Step 7: Commit callbacks**

```powershell
git add src/bot/keyboards.ts src/bot/createBot.ts src/storage/repositories.ts tests/bot/createBot.test.ts
git commit -m "feat: authorize poisoning alert decisions"
```

## Task 8: Keep The Warning In Later Incoming Deposit Results

**Files:**

- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `src/alerts/formatters.ts`
- Modify: `src/index.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`
- Modify: `tests/alerts/formatters.test.ts`

- [ ] **Step 1: Write failing formatter and job-cycle tests**

```ts
expect(formatIncomingDepositRiskAlert({
  ...incomingDepositBaseInput,
  addressPoisoningWarningActive: true
}).text).toContain("⚠️ Предупреждение о возможной подмене адреса остаётся активным.");
```

Assert the job queries candidate state immediately before formatting, includes `candidate` and `confirmed`, excludes `dismissed`, and leaves a result unchanged when Incoming finishes first.

- [ ] **Step 2: Run Incoming/formatter tests and verify failure**

```powershell
npx vitest run --configLoader bundle tests/forensics/incomingDepositJob.test.ts tests/alerts/formatters.test.ts
```

- [ ] **Step 3: Add the dependency and formatter flag**

```ts
hasUndismissedAddressPoisoningCandidateForIncoming(input: {
  watchedWalletId: string;
  incomingTxHash: string;
}): Promise<boolean>;
```

Pass `addressPoisoningWarningActive` into the formatter. Place the warning immediately after the score/context lines and before long forensic sections. The flag changes neither `depositRiskScore`, decision, nor `shouldSend()`.
Use `⚠️ Address substitution warning remains active.` for the English locale.

- [ ] **Step 4: Wire the repository read in `src/index.ts`**

Use the candidate query only when the Incoming result is about to be sent. If the independent safety candidate does not exist yet, the ordinary result remains unchanged and the later dedicated safety alert still arrives.

- [ ] **Step 5: Run focused tests**

Run the Task 8 command again. Expected: PASS.

- [ ] **Step 6: Commit Incoming warning persistence**

```powershell
git add src/forensics/incomingDepositJob.ts src/alerts/formatters.ts src/index.ts tests/forensics/incomingDepositJob.test.ts tests/alerts/formatters.test.ts
git commit -m "fix: preserve poisoning warning in incoming results"
```

## Task 9: Schedule The Worker And Verify The SLO

**Files:**

- Modify: `src/runtime/startupSchedule.ts`
- Modify: `src/index.ts`
- Modify: `tests/runtime/startupSchedule.test.ts`
- Modify: `tests/monitor/addressPoisoningWorker.test.ts`

- [ ] **Step 1: Write failing scheduler and fake-time SLO tests**

Add `address_poisoning` to the expected startup labels. With fake timers, observe an eligible event, let a healthy provider return the THJ match, and assert the alert is sent within 120 seconds and no later than two normal wallet polling intervals.

- [ ] **Step 2: Run scheduler/SLO tests and verify failure**

```powershell
npx vitest run --configLoader bundle tests/runtime/startupSchedule.test.ts tests/monitor/addressPoisoningWorker.test.ts
```

- [ ] **Step 3: Add the independent schedule and non-overlap guard**

Extend `StartupWorkLabel` with `address_poisoning`. Use a 30-second interval and a start delay no later than the normal poll start. In `src/index.ts` add:

```ts
const addressPoisoningTronClient = new TronscanClient({
  baseUrl: config.tronscanBaseUrl,
  fullNodeBaseUrl: config.tronFullNodeBaseUrl,
  apiKey: config.tronscanApiKeys,
  fullNodeApiKey: config.tronFullNodeApiKey,
  timeoutMs: 5_000,
  retryAttempts: 0,
  retryBaseDelayMs: config.tronscanRetryBaseDelayMs,
  scheduler: tronscanScheduler
});
```

Then add the overlap guard:

```ts
let activeAddressPoisoningPoll: Promise<void> | null = null;

async function addressPoisoningOnce(): Promise<void> {
  if (activeAddressPoisoningPoll) return activeAddressPoisoningPoll;
  activeAddressPoisoningPoll = runSingleAddressPoisoningCycle(addressPoisoningDeps)
    .finally(() => { activeAddressPoisoningPoll = null; });
  return activeAddressPoisoningPoll;
}
```

Add it to startup work, interval maps, error maps, shutdown waiting, and structured logging.

- [ ] **Step 4: Record operational metrics through the existing logger**

Emit:

```text
address_poisoning_cycle_completed: queueDepth, oldestQueueAgeMs, claimed, durationMs, timeoutCount
address_poisoning_lookup_completed: txHash, providerLatencyMs, pageCount, fetchedCount, coverage
address_poisoning_alert_sent: candidateId, classification, queueAgeMs, alertLatencyMs
```

Do not add a metrics dependency.

- [ ] **Step 5: Run scheduler/SLO tests**

Run the Task 9 command again. Expected: PASS.

- [ ] **Step 6: Commit runtime scheduling**

```powershell
git add src/runtime/startupSchedule.ts src/index.ts tests/runtime/startupSchedule.test.ts tests/monitor/addressPoisoningWorker.test.ts
git commit -m "feat: schedule poisoning worker with SLO metrics"
```

## Task 10: Complete Regression Coverage, Knowledge Docs, And Release Verification

**Files:**

- Modify: `docs/superpowers/specs/2026-07-12-tron-usdt-address-poisoning-monitor-design.md`
- Modify: `docs/knowledge/02-check-modes.md`
- Modify: `docs/knowledge/03-job-lifecycle.md`
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`
- Modify: `docs/knowledge/13-agent-observations.md`
- Modify: `README.md`

- [ ] **Step 1: Run the complete focused suite**

```powershell
npx vitest run --configLoader bundle tests/monitor/addressPoisoning.test.ts
npx vitest run --configLoader bundle tests/storage/repositories.test.ts
npx vitest run --configLoader bundle tests/monitor/monitorWorker.test.ts tests/monitor/addressPoisoningWorker.test.ts
npx vitest run --configLoader bundle tests/alerts/addressPoisoningAlert.test.ts tests/alerts/formatters.test.ts
npx vitest run --configLoader bundle tests/bot/createBot.test.ts
npx vitest run --configLoader bundle tests/forensics/incomingDepositJob.test.ts
npx vitest run --configLoader bundle tests/risk/riskSignalGroups.test.ts tests/risk/unifiedWalletRisk.test.ts
npx vitest run --configLoader bundle tests/runtime/startupSchedule.test.ts tests/config/config.test.ts tests/tron/tronClient.test.ts
```

Expected: every command exits 0.

- [ ] **Step 2: Run static and full regression checks**

```powershell
npm run typecheck
npm test
git diff --check
```

Expected: TypeScript exits 0, the full Vitest suite passes, and `git diff --check` prints nothing.

- [ ] **Step 3: Update current product truth**

Document these exact decisions:

- incoming official USDT is the trigger; USDD PSM is optional post-loss evidence;
- wallet safety is not AML and always has zero score impact;
- partial negative coverage is `inconclusive`, never `clear`;
- runtime is USDT-only while detector inputs remain token-aware;
- recipient precheck is the next phase and reuses candidate/evidence records;
- normal Incoming results cannot clear an active safety warning;
- automatic suppression requires authorized manual trust or exact authoritative address registry;
- Telegram delivery is at-least-once with a narrow external crash gap.

Add the crash gap to `10-open-problems.md` and the repeated scoring/safety separation lesson to `13-agent-observations.md`.

- [ ] **Step 4: Commit docs and release checks**

```powershell
git add docs/superpowers/specs/2026-07-12-tron-usdt-address-poisoning-monitor-design.md docs/knowledge/02-check-modes.md docs/knowledge/03-job-lifecycle.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/07-risk-scoring-matrix.md docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/13-agent-observations.md README.md
git commit -m "docs: document address poisoning protection"
```

- [ ] **Step 5: Perform final diff review before landing**

```powershell
git status --short
git log --oneline --decorate -12
git diff master...HEAD --stat
git diff master...HEAD -- migrations/031_address_poisoning_monitor.sql src/monitor src/risk src/storage/repositories.ts src/alerts src/bot src/forensics/incomingDepositJob.ts src/index.ts
```

Verify only planned files changed, no user-owned dirty files entered the branch, every migration is additive, the main monitor has no poisoning provider call, and all callback mutations are owner-bound.

## Acceptance Checklist

- [ ] The THJ fixture produces one `CRITICAL` candidate from the 10 USDT lure before the 282,693 USDT loss.
- [ ] USDD and PSM are absent from initial detector inputs.
- [ ] Complete negative history can be `clear`; partial negative history cannot.
- [ ] Historical backfill is `skipped_backfill` and sends nothing.
- [ ] One incoming tx creates at most one candidate and one logical alert.
- [ ] `wallet_safety` cannot affect AML or unified scores.
- [ ] `risk_only` and `digest` receive the security alert immediately; `paused` does not.
- [ ] Normal Incoming processing continues when poisoning lookup fails or times out.
- [ ] Only the watched-wallet owner can confirm or dismiss a candidate.
- [ ] A later low-risk Incoming result preserves the active-warning line.
- [ ] Healthy-provider delivery meets the 120-second target under normal queue capacity.
- [ ] Evidence and candidates are directly reusable by the future recipient precheck.
- [ ] No detector, worker, or formatter path calls an LLM.
