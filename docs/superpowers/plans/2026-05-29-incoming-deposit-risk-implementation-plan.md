# Incoming Deposit Risk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build transaction-centric incoming USDT deposit scoring that returns one final `ACCEPTABLE` or `DECLINE` Telegram alert, while preventing zero-balance senders from being falsely scored as medium risk.

**Architecture:** Add `incoming_deposit_check` as a first-class forensic job kind seeded by the incoming transaction, not by current wallet balance. The job combines fast sender risk, transaction-seeded provenance, cashflow-aware sender inventory, contract/LLM escalation, and sender wallet profile into one `IncomingDepositRiskReport`; balance-centric `where-is-money` remains for current-balance checks only.

**Tech Stack:** TypeScript, Node.js, PostgreSQL migrations, grammY Telegram bot, TronScan/TronGrid clients, existing forensic job queue, existing LLM contract verdict adapter.

---

## Scope Integration

This plan merges the two related requirements into one coherent feature:

1. **Incoming Deposit Provenance Risk:** score the exact incoming deposit, including upstream smart-contract funding and LLM escalation.
2. **Zero-Balance Sender Fix:** when the sender has already sent the funds and now has `0 USDT`, do not run current-balance `where-is-money` and do not score `MEDIUM` solely because there is no balance to trace.

The shared design principle:

```text
Incoming alert context is transaction-centric.
Generic address context is wallet-profile-centric.
Current-balance where-is-money is only used when current balance is the thing being checked.
```

## File Structure

- Create `migrations/020_incoming_deposit_jobs.sql`
  - Adds `incoming_deposit_check` to forensic job kind constraint.
  - Adds `analyzing` user alert status so incoming alerts can wait for one final result.
  - Replaces active forensic job uniqueness so incoming jobs dedupe by `depositTxHash`.

- Modify `src/types.ts`
  - Adds incoming deposit report, origin path, source policy, hard evidence, and data quality types.
  - Adds `incoming_deposit` to `RiskCaseMode`.

- Modify `src/storage/repositories.ts`
  - Adds `incoming_deposit_check` job kind.
  - Adds observed transaction helpers for `analyzing` status and tx lookup.
  - Adds a typed creator for incoming deposit jobs.

- Create `src/forensics/incomingDepositCashflow.ts`
  - Selects candidate inbound transfers that likely funded the specific outgoing deposit.

- Create `src/forensics/incomingDepositProvenance.ts`
  - Builds transaction-seeded origin paths from sender backward before deposit timestamp.

- Create `src/forensics/incomingDepositContractContext.ts`
  - Detects smart-contract upstream funding and builds LLM case files when needed.

- Create `src/forensics/incomingDepositRisk.ts`
  - Aggregates fast sender risk, provenance, sender profile, contract verdicts, policy gates, and final score.

- Create `src/forensics/incomingDepositJob.ts`
  - Runs `incoming_deposit_check` jobs and sends/skips/fails final Telegram alert.

- Modify `src/index.ts`
  - Starts an incoming deposit forensic worker loop separate from generic deep research.

- Modify `src/monitor/monitorWorker.ts`
  - On new incoming tx, queue `incoming_deposit_check` and mark observed transaction as `analyzing` instead of sending sender-only alert.

- Modify `src/alerts/formatters.ts`
  - Adds final deposit-risk alert formatter.

- Modify `src/alerts/keyboards.ts`
  - Replaces sender-only callback with contextual deposit/source callback using forensic job id.

- Modify `src/bot/keyboards.ts` and `src/bot/createBot.ts`
  - Parses and handles `check:deposit:<jobId>`.
  - Keeps generic `check:addr:<address>` as wallet profile/address check, not incoming-deposit context.

- Test files:
  - `tests/forensics/incomingDepositCashflow.test.ts`
  - `tests/forensics/incomingDepositProvenance.test.ts`
  - `tests/forensics/incomingDepositRisk.test.ts`
  - `tests/forensics/incomingDepositJob.test.ts`
  - `tests/monitor/monitorWorker.test.ts`
  - `tests/alerts/formatters.test.ts`
  - `tests/alerts/keyboards.test.ts`
  - `tests/bot/createBot.test.ts`
  - `tests/storage/forensicCheckJobs.test.ts`
  - `tests/storage/repositories.test.ts`

---

### Task 1: Add Data Model And Job Persistence

**Files:**
- Create: `migrations/020_incoming_deposit_jobs.sql`
- Modify: `src/types.ts`
- Modify: `src/storage/repositories.ts`
- Test: `tests/storage/forensicCheckJobs.test.ts`
- Test: `tests/storage/repositories.test.ts`

- [ ] **Step 1: Write migration tests for the new job kind and alert status**

Add tests that exercise repository parsing and SQL assumptions:

```ts
it("accepts incoming_deposit_check forensic jobs", async () => {
  const job = await createOrReuseForensicCheckJob(db, {
    kind: "incoming_deposit_check",
    subjectAddress: "TSender11111111111111111111111111111",
    windowStart: new Date("2026-05-29T00:00:00.000Z"),
    windowEnd: new Date("2026-05-29T00:10:00.000Z"),
    requestedBy: "42",
    progressJson: {
      depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
      watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
      sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      amountRaw: "384064001319",
      timestamp: "2026-05-29T14:01:00.000Z"
    }
  });

  expect(job.kind).toBe("incoming_deposit_check");
  expect(job.progressJson.depositTxHash).toBe("48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b");
});
```

Add an observed transaction status test:

```ts
it("marks observed transaction as analyzing while incoming deposit job runs", async () => {
  await claimObservedTransactionForUserAlert(db, {
    watchedWalletId: wallet.id,
    event: {
      txHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
      token: "USDT",
      sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      receiver: wallet.address,
      amount: "384064.001319",
      timestamp: new Date("2026-05-29T14:01:00.000Z")
    }
  });

  await markUserAlertAnalyzing(db, {
    txHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
    watchedWalletId: wallet.id
  });

  const row = await getObservedTransactionForIncomingDeposit(db, {
    txHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
    watchedWalletId: wallet.id
  });

  expect(row?.userAlertStatus).toBe("analyzing");
});
```

- [ ] **Step 2: Run the focused storage tests and confirm they fail**

Run:

```bash
npm test -- tests/storage/forensicCheckJobs.test.ts tests/storage/repositories.test.ts
```

Expected: failures because `incoming_deposit_check`, `analyzing`, `markUserAlertAnalyzing`, and `getObservedTransactionForIncomingDeposit` do not exist yet.

- [ ] **Step 3: Add migration**

Create `migrations/020_incoming_deposit_jobs.sql`:

```sql
alter table forensic_check_jobs drop constraint if exists forensic_check_jobs_kind_check;

alter table forensic_check_jobs
  add constraint forensic_check_jobs_kind_check
  check (kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check'));

alter table observed_transactions drop constraint if exists observed_transactions_user_alert_status_check;

alter table observed_transactions
  add constraint observed_transactions_user_alert_status_check
  check (user_alert_status in ('pending', 'sending', 'analyzing', 'sent', 'failed', 'skipped'));

drop index if exists forensic_check_jobs_active_unique_idx;

create unique index if not exists forensic_check_jobs_active_unique_idx
  on forensic_check_jobs(
    kind,
    subject_address,
    window_start,
    window_end,
    coalesce(requested_by, ''),
    coalesce(progress_json->>'depositTxHash', '')
  )
  where status in ('queued', 'running');
```

Rationale: incoming jobs are keyed by deposit tx hash. Two deposits from the same sender in the same window must not collapse into one job.

- [ ] **Step 4: Add public types**

In `src/types.ts`, add:

```ts
export type IncomingDepositDecision = "ACCEPTABLE" | "DECLINE";
export type IncomingDepositRiskBand = "LOW" | "LOW-MEDIUM" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IncomingDepositDataQuality = "low" | "medium" | "high";
export type IncomingDepositSourcePolicy = "clean" | "medium_policy" | "hard_decline" | "unknown";

export type IncomingDepositInput = {
  txHash: string;
  watchedWallet: string;
  watchedWalletId?: string | null;
  sender: string;
  amountRaw: string;
  timestamp: Date;
};

export type IncomingDepositOriginStep = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  method: string;
  edgeType: ForensicRouteEdgeType;
};

export type IncomingDepositOriginPath = {
  verdict: IncomingDepositDecision;
  score: number;
  sourcePolicy: IncomingDepositSourcePolicy;
  stoppedReason:
    | "clean_cex_reached"
    | "htx_huobi_reached"
    | "bridge_router_dex_reached"
    | "whitebit_reached"
    | "unknown_contract_reached"
    | "no_previous_transfer"
    | "weak_cashflow_continuity"
    | "data_budget_exhausted";
  pathAddresses: string[];
  txHashes: string[];
  steps: IncomingDepositOriginStep[];
  amountCoverageRatio: number;
  amountContinuity: "weak" | "medium" | "strong";
  proximityHops: number;
  reasons: string[];
};

export type IncomingDepositHardBadEvidence = {
  kind:
    | "scam_or_blacklist"
    | "stablecoin_blacklist"
    | "approval_drain"
    | "htx_huobi_source"
    | "bridge_router_dex_boundary"
    | "llm_contract_suspicion";
  score: number;
  message: string;
  evidenceIds: string[];
};

export type IncomingDepositRiskReport = {
  decision: IncomingDepositDecision;
  depositRiskScore: number;
  riskBand: IncomingDepositRiskBand;
  fastSenderRisk: RiskReport | null;
  originPaths: IncomingDepositOriginPath[];
  originCoverage: number;
  provenanceConfidence: number;
  dataQuality: IncomingDepositDataQuality;
  senderRole: string | null;
  hardBadEvidence: IncomingDepositHardBadEvidence[];
  contractVerdicts: ContractLlmVerdictSummary[];
  reasons: string[];
  warnings: string[];
};
```

Also extend `RiskCaseMode`:

```ts
export type RiskCaseMode =
  | "fast_check"
  | "where_is_money"
  | "incoming_deposit"
  | "transaction_check"
  | "deep_research"
  | "approval_monitoring";
```

- [ ] **Step 5: Update repository job/status parsing**

In `src/storage/repositories.ts`, change:

```ts
export type ForensicCheckJobKind = "address_deep_check" | "where_is_money_check";
```

to:

```ts
export type ForensicCheckJobKind = "address_deep_check" | "where_is_money_check" | "incoming_deposit_check";
```

Update set declarations:

```ts
const userAlertStatuses = new Set<UserAlertStatus>(["pending", "sending", "analyzing", "sent", "failed", "skipped"]);
const forensicCheckJobKinds = new Set<ForensicCheckJobKind>(["address_deep_check", "where_is_money_check", "incoming_deposit_check"]);
```

Add helpers near `markUserAlertSkipped`:

```ts
export async function markUserAlertAnalyzing(
  db: Db,
  input: { txHash: string; watchedWalletId: string }
): Promise<boolean> {
  const result = await db.query(
    `update observed_transactions
     set user_alert_status = 'analyzing',
       user_alert_last_error = null,
       user_alert_updated_at = now()
     where tx_hash = $1 and watched_wallet_id = $2 and user_alert_status = 'sending'`,
    [input.txHash, input.watchedWalletId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getObservedTransactionForIncomingDeposit(
  db: Db,
  input: { txHash: string; watchedWalletId: string }
): Promise<ObservedTransactionUserAlert | null> {
  const result = await db.query(
    `select tx_hash, watched_wallet_id, sender, receiver, token, amount, timestamp,
       user_alert_status, user_alert_attempts, user_alert_last_error, user_alert_updated_at, created_at
     from observed_transactions
     where tx_hash = $1 and watched_wallet_id = $2`,
    [input.txHash, input.watchedWalletId]
  );
  return result.rows[0] ? mapObservedTransactionUserAlertRow(result.rows[0]) : null;
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- tests/storage/forensicCheckJobs.test.ts tests/storage/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add migrations/020_incoming_deposit_jobs.sql src/types.ts src/storage/repositories.ts tests/storage/forensicCheckJobs.test.ts tests/storage/repositories.test.ts
git commit -m "feat: add incoming deposit job model"
```

---

### Task 2: Add Cashflow-Aware Deposit Funding Selection

**Files:**
- Create: `src/forensics/incomingDepositCashflow.ts`
- Test: `tests/forensics/incomingDepositCashflow.test.ts`

- [ ] **Step 1: Write failing tests for transaction-seeded inventory**

Create `tests/forensics/incomingDepositCashflow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ForensicRouteEdge } from "../../src/types";
import { selectIncomingDepositFundingCandidates } from "../../src/forensics/incomingDepositCashflow";

function edge(id: string, fromAddress: string, toAddress: string, amountRaw: string, timestamp: string): ForensicRouteEdge {
  return {
    id,
    txHash: id,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

describe("selectIncomingDepositFundingCandidates", () => {
  it("uses sender cashflow before the deposit timestamp instead of current balance", () => {
    const sender = "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs";
    const watchedWallet = "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM";
    const contract = "TFcRN111111111111111111111111FLR5hvh";
    const other = "TOther111111111111111111111111111111";

    const result = selectIncomingDepositFundingCandidates({
      sender,
      watchedWallet,
      depositAmountRaw: "384064001319",
      depositTimestamp: new Date("2026-05-29T14:01:00.000Z"),
      edges: [
        edge("contract-in-1", contract, sender, "117568000000", "2026-05-29T13:30:00.000Z"),
        edge("contract-in-2", contract, sender, "37000000000", "2026-05-29T13:35:00.000Z"),
        edge("contract-in-3", contract, sender, "30045000000", "2026-05-29T13:40:00.000Z"),
        edge("other-in", other, sender, "250000000000", "2026-05-29T13:45:00.000Z"),
        edge("deposit", sender, watchedWallet, "384064001319", "2026-05-29T14:01:00.000Z")
      ]
    });

    expect(result.coverageRatio).toBeGreaterThan(0.9);
    expect(result.candidates.map((item) => item.edge.txHash)).toEqual(["other-in", "contract-in-3", "contract-in-2", "contract-in-1"]);
    expect(result.amountContinuity).toBe("strong");
  });

  it("penalizes funding that was likely spent before the watched-wallet deposit", () => {
    const sender = "TSender111111111111111111111111111111";
    const watchedWallet = "TWatched1111111111111111111111111111";
    const funder = "TFunder111111111111111111111111111111";
    const sink = "TSink11111111111111111111111111111111";

    const result = selectIncomingDepositFundingCandidates({
      sender,
      watchedWallet,
      depositAmountRaw: "384000000000",
      depositTimestamp: new Date("2026-05-29T14:00:00.000Z"),
      edges: [
        edge("old-in", funder, sender, "500000000000", "2026-05-29T12:00:00.000Z"),
        edge("spent-before", sender, sink, "300000000000", "2026-05-29T13:00:00.000Z"),
        edge("new-in", funder, sender, "250000000000", "2026-05-29T13:30:00.000Z"),
        edge("deposit", sender, watchedWallet, "384000000000", "2026-05-29T14:00:00.000Z")
      ]
    });

    expect(result.candidates[0]?.edge.txHash).toBe("new-in");
    expect(result.coverageRatio).toBeGreaterThan(0.5);
    expect(result.amountContinuity).toBe("medium");
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
npm test -- tests/forensics/incomingDepositCashflow.test.ts
```

Expected: FAIL because `incomingDepositCashflow` does not exist.

- [ ] **Step 3: Implement cashflow selector**

Create `src/forensics/incomingDepositCashflow.ts`:

```ts
import type { ForensicRouteEdge } from "../types";

export type IncomingDepositFundingCandidate = {
  edge: ForensicRouteEdge;
  usableAmountRaw: string;
  coverageRatio: number;
  spentBeforeDepositRaw: string;
};

export type IncomingDepositFundingSelection = {
  candidates: IncomingDepositFundingCandidate[];
  coverageRaw: string;
  coverageRatio: number;
  amountContinuity: "weak" | "medium" | "strong";
};

export type SelectIncomingDepositFundingCandidatesInput = {
  sender: string;
  watchedWallet: string;
  depositAmountRaw: string;
  depositTimestamp: Date;
  edges: ForensicRouteEdge[];
};

function parseRaw(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number((numerator * 10_000n) / denominator) / 10_000;
}

function continuity(value: number): "weak" | "medium" | "strong" {
  if (value >= 0.85) return "strong";
  if (value >= 0.5) return "medium";
  return "weak";
}

export function selectIncomingDepositFundingCandidates(
  input: SelectIncomingDepositFundingCandidatesInput
): IncomingDepositFundingSelection {
  const depositAmount = parseRaw(input.depositAmountRaw);
  if (depositAmount <= 0n) {
    return { candidates: [], coverageRaw: "0", coverageRatio: 0, amountContinuity: "weak" };
  }

  const beforeDeposit = input.edges
    .filter((edge) => edge.timestamp.getTime() <= input.depositTimestamp.getTime())
    .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());

  const outgoingBeforeDeposit = beforeDeposit.filter((edge) =>
    edge.fromAddress === input.sender &&
    edge.toAddress !== input.watchedWallet
  );

  let spendOverhang = outgoingBeforeDeposit.reduce((sum, edge) => sum + parseRaw(edge.amountRaw), 0n);
  let remaining = depositAmount;
  const candidates: IncomingDepositFundingCandidate[] = [];

  for (const edge of beforeDeposit) {
    if (remaining <= 0n) break;
    if (edge.toAddress !== input.sender) continue;

    const amount = parseRaw(edge.amountRaw);
    const consumed = spendOverhang > amount ? amount : spendOverhang;
    spendOverhang -= consumed;
    const usable = amount - consumed;
    if (usable <= 0n) continue;

    const selected = usable > remaining ? remaining : usable;
    candidates.push({
      edge,
      usableAmountRaw: selected.toString(),
      coverageRatio: ratio(selected, depositAmount),
      spentBeforeDepositRaw: consumed.toString()
    });
    remaining -= selected;
  }

  const coverage = depositAmount - remaining;
  const coverageRatio = ratio(coverage, depositAmount);
  return {
    candidates,
    coverageRaw: coverage.toString(),
    coverageRatio,
    amountContinuity: continuity(coverageRatio)
  };
}
```

- [ ] **Step 4: Run test and confirm pass**

Run:

```bash
npm test -- tests/forensics/incomingDepositCashflow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/incomingDepositCashflow.ts tests/forensics/incomingDepositCashflow.test.ts
git commit -m "feat: add incoming deposit cashflow selection"
```

---

### Task 3: Build Transaction-Seeded Provenance Paths

**Files:**
- Create: `src/forensics/incomingDepositProvenance.ts`
- Test: `tests/forensics/incomingDepositProvenance.test.ts`

- [ ] **Step 1: Write tests for tx-seeded provenance**

Create tests that prove the engine starts from the deposit tx and not current balance:

```ts
import { describe, expect, it } from "vitest";
import type { ForensicRouteEdge, ServiceClassification } from "../../src/types";
import { traceIncomingDepositProvenance } from "../../src/forensics/incomingDepositProvenance";

function edge(id: string, fromAddress: string, toAddress: string, amountRaw: string, timestamp: string): ForensicRouteEdge {
  return { id, txHash: id, fromAddress, toAddress, amountRaw, timestamp: new Date(timestamp), method: "transfer", edgeType: "normal_transfer" };
}

describe("traceIncomingDepositProvenance", () => {
  it("finds smart-contract funding before the incoming deposit even when sender current balance is zero", async () => {
    const sender = "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs";
    const watchedWallet = "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM";
    const contract = "TFcRN111111111111111111111111FLR5hvh";
    const deposit = edge("48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b", sender, watchedWallet, "384064001319", "2026-05-29T14:01:00.000Z");
    const edgesByAddress = new Map<string, ForensicRouteEdge[]>([
      [sender, [
        edge("contract-in-1", contract, sender, "117568000000", "2026-05-29T13:30:00.000Z"),
        edge("contract-in-2", contract, sender, "37000000000", "2026-05-29T13:35:00.000Z"),
        edge("contract-in-3", contract, sender, "30045000000", "2026-05-29T13:40:00.000Z"),
        deposit
      ]],
      [contract, []]
    ]);

    const report = await traceIncomingDepositProvenance({
      deposit,
      maxDepth: 4,
      fetchEdgesForAddress: async (address) => edgesByAddress.get(address) ?? [],
      getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
        address === contract
          ? { category: "unknown", identity: null, confidence: "medium", evidence: ["test contract"], isBoundary: true }
          : null
    });

    expect(report.paths[0]?.stoppedReason).toBe("unknown_contract_reached");
    expect(report.paths[0]?.pathAddresses).toContain(contract);
    expect(report.originCoverage).toBeGreaterThan(0.45);
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
npm test -- tests/forensics/incomingDepositProvenance.test.ts
```

Expected: FAIL because provenance module does not exist.

- [ ] **Step 3: Implement provenance module**

Create `src/forensics/incomingDepositProvenance.ts` with these exports:

```ts
import type {
  ForensicRouteEdge,
  IncomingDepositOriginPath,
  IncomingDepositOriginStep,
  ServiceClassification
} from "../types";
import { selectIncomingDepositFundingCandidates } from "./incomingDepositCashflow";

export type IncomingDepositProvenanceResult = {
  paths: IncomingDepositOriginPath[];
  originCoverage: number;
  fetchedAddressCount: number;
  notes: string[];
};

export type TraceIncomingDepositProvenanceInput = {
  deposit: ForensicRouteEdge;
  maxDepth: number;
  fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
};

function step(edge: ForensicRouteEdge): IncomingDepositOriginStep {
  return {
    txHash: edge.txHash,
    fromAddress: edge.fromAddress,
    toAddress: edge.toAddress,
    amountRaw: edge.amountRaw,
    timestamp: edge.timestamp.toISOString(),
    method: edge.method,
    edgeType: edge.edgeType
  };
}

function isHardServiceBoundary(classification: ServiceClassification | null): boolean {
  if (!classification) return false;
  return classification.category === "bridge" ||
    classification.category === "router" ||
    classification.category === "dex" ||
    classification.category === "pool";
}

function isKnownCleanCex(classification: ServiceClassification | null): boolean {
  if (!classification) return false;
  const identity = (classification.identity ?? "").toLowerCase();
  return classification.category === "cex" &&
    (identity.includes("binance") || identity.includes("bybit") || identity.includes("okx"));
}

export async function traceIncomingDepositProvenance(
  input: TraceIncomingDepositProvenanceInput
): Promise<IncomingDepositProvenanceResult> {
  const fetched = new Set<string>();
  const paths: IncomingDepositOriginPath[] = [];
  const queue = [{
    address: input.deposit.fromAddress,
    depth: 0,
    steps: [step(input.deposit)],
    pathAddresses: [input.deposit.toAddress, input.deposit.fromAddress],
    amountRaw: input.deposit.amountRaw,
    timestamp: input.deposit.timestamp
  }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.depth >= input.maxDepth) {
      paths.push({
        verdict: "ACCEPTABLE",
        score: 35,
        sourcePolicy: "unknown",
        stoppedReason: "data_budget_exhausted",
        pathAddresses: [...current.pathAddresses].reverse(),
        txHashes: current.steps.map((item) => item.txHash).reverse(),
        steps: [...current.steps].reverse(),
        amountCoverageRatio: 0,
        amountContinuity: "weak",
        proximityHops: current.depth,
        reasons: [`Clean source was not proven within maxDepth=${input.maxDepth}.`]
      });
      continue;
    }

    fetched.add(current.address);
    const edges = await input.fetchEdgesForAddress(current.address);
    const selection = selectIncomingDepositFundingCandidates({
      sender: current.address,
      watchedWallet: current.pathAddresses[current.pathAddresses.length - 2] ?? input.deposit.toAddress,
      depositAmountRaw: current.amountRaw,
      depositTimestamp: current.timestamp,
      edges
    });

    if (selection.candidates.length === 0) {
      paths.push({
        verdict: "ACCEPTABLE",
        score: 35,
        sourcePolicy: "unknown",
        stoppedReason: "no_previous_transfer",
        pathAddresses: [...current.pathAddresses].reverse(),
        txHashes: current.steps.map((item) => item.txHash).reverse(),
        steps: [...current.steps].reverse(),
        amountCoverageRatio: selection.coverageRatio,
        amountContinuity: selection.amountContinuity,
        proximityHops: current.depth,
        reasons: ["No previous inbound USDT transfer found before this deposit context."]
      });
      continue;
    }

    for (const candidate of selection.candidates.slice(0, 6)) {
      const sourceAddress = candidate.edge.fromAddress;
      const classification = await input.getClassificationForAddress(sourceAddress);
      const nextSteps = [step(candidate.edge), ...current.steps];
      const nextAddresses = [...current.pathAddresses, sourceAddress];

      if (isKnownCleanCex(classification)) {
        paths.push({
          verdict: "ACCEPTABLE",
          score: 5,
          sourcePolicy: "clean",
          stoppedReason: "clean_cex_reached",
          pathAddresses: [...nextAddresses].reverse(),
          txHashes: nextSteps.map((item) => item.txHash),
          steps: nextSteps,
          amountCoverageRatio: selection.coverageRatio,
          amountContinuity: selection.amountContinuity,
          proximityHops: current.depth + 1,
          reasons: [`Deposit funding reaches clean CEX ${classification.identity ?? sourceAddress}.`]
        });
        continue;
      }

      if (isHardServiceBoundary(classification)) {
        paths.push({
          verdict: "DECLINE",
          score: 70,
          sourcePolicy: "hard_decline",
          stoppedReason: "bridge_router_dex_reached",
          pathAddresses: [...nextAddresses].reverse(),
          txHashes: nextSteps.map((item) => item.txHash),
          steps: nextSteps,
          amountCoverageRatio: selection.coverageRatio,
          amountContinuity: selection.amountContinuity,
          proximityHops: current.depth + 1,
          reasons: [`Deposit funding reaches ${classification.category} boundary ${classification.identity ?? sourceAddress}.`]
        });
        continue;
      }

      if (classification?.isBoundary && classification.category === "unknown") {
        paths.push({
          verdict: "DECLINE",
          score: 58,
          sourcePolicy: "medium_policy",
          stoppedReason: "unknown_contract_reached",
          pathAddresses: [...nextAddresses].reverse(),
          txHashes: nextSteps.map((item) => item.txHash),
          steps: nextSteps,
          amountCoverageRatio: selection.coverageRatio,
          amountContinuity: selection.amountContinuity,
          proximityHops: current.depth + 1,
          reasons: ["Deposit funding reaches an unknown smart-contract boundary."]
        });
        continue;
      }

      queue.push({
        address: sourceAddress,
        depth: current.depth + 1,
        steps: nextSteps,
        pathAddresses: nextAddresses,
        amountRaw: candidate.usableAmountRaw,
        timestamp: candidate.edge.timestamp
      });
    }
  }

  const originCoverage = Math.max(0, ...paths.map((path) => path.amountCoverageRatio));
  return {
    paths,
    originCoverage,
    fetchedAddressCount: fetched.size,
    notes: paths.length === 0 ? ["No origin path found from transaction seed."] : []
  };
}
```

- [ ] **Step 4: Run test and confirm pass**

Run:

```bash
npm test -- tests/forensics/incomingDepositProvenance.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/incomingDepositProvenance.ts tests/forensics/incomingDepositProvenance.test.ts
git commit -m "feat: trace incoming deposit provenance"
```

---

### Task 4: Add Contract Discovery And LLM Escalation For Incoming Deposits

**Files:**
- Create: `src/forensics/incomingDepositContractContext.ts`
- Test: `tests/forensics/incomingDepositContractContext.test.ts`

- [ ] **Step 1: Write tests for unknown contract escalation**

Create `tests/forensics/incomingDepositContractContext.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ContractLlmVerdictSummary, IncomingDepositOriginPath } from "../../src/types";
import { analyzeIncomingDepositContracts } from "../../src/forensics/incomingDepositContractContext";

const path: IncomingDepositOriginPath = {
  verdict: "DECLINE",
  score: 58,
  sourcePolicy: "medium_policy",
  stoppedReason: "unknown_contract_reached",
  pathAddresses: ["TFcRN111111111111111111111111FLR5hvh", "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs", "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM"],
  txHashes: ["contract-in-1", "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b"],
  steps: [],
  amountCoverageRatio: 0.92,
  amountContinuity: "strong",
  proximityHops: 1,
  reasons: ["Deposit funding reaches an unknown smart-contract boundary."]
};

describe("analyzeIncomingDepositContracts", () => {
  it("calls LLM analyzer for close unknown contract boundaries", async () => {
    const verdict: ContractLlmVerdictSummary = {
      source: "llm",
      cacheMatch: null,
      reusedFromContractAddress: null,
      providerLabel: "deepseek",
      model: "deepseek-v4-pro",
      contractAddress: "TFcRN111111111111111111111111FLR5hvh",
      caseFileHash: "case-hash-1",
      cacheId: null,
      verdict: "unknown_suspicious",
      confidence: 0.8,
      contractRiskScore: 72,
      decisionRecommendation: "DECLINE",
      reasons: ["Unknown contract funded sender shortly before deposit."],
      citedEvidenceIds: ["contract-in-1"],
      falsePositiveNotes: []
    };

    const analyze = vi.fn(async () => [verdict]);
    const result = await analyzeIncomingDepositContracts({
      subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
      depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
      originPaths: [path],
      getContractIntelligenceProfile: async () => null,
      getTransaction: async () => ({ hash: "contract-in-1" }),
      analyzeContractLlmCaseFiles: analyze
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.verdicts).toEqual([verdict]);
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
npm test -- tests/forensics/incomingDepositContractContext.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement contract context module**

Create `src/forensics/incomingDepositContractContext.ts`:

```ts
import type {
  ContractAnalysisCaseFile,
  ContractLlmVerdictSummary,
  IncomingDepositOriginPath
} from "../types";
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import { CONTRACT_LLM_VERDICT_POLICY_VERSION } from "./contractLlmVerdict";

export type AnalyzeIncomingDepositContractsInput = {
  subjectAddress: string;
  watchedWallet: string;
  depositTxHash: string;
  originPaths: IncomingDepositOriginPath[];
  getContractIntelligenceProfile(address: string): Promise<ContractRiskContext | null>;
  getTransaction(txHash: string): Promise<unknown>;
  analyzeContractLlmCaseFiles?: (caseFiles: ContractAnalysisCaseFile[]) => Promise<ContractLlmVerdictSummary[]>;
};

export type AnalyzeIncomingDepositContractsResult = {
  verdicts: ContractLlmVerdictSummary[];
  caseFileCount: number;
};

function contractCandidates(paths: IncomingDepositOriginPath[]): string[] {
  const result = new Set<string>();
  for (const path of paths) {
    if (path.stoppedReason !== "unknown_contract_reached") continue;
    const contract = path.pathAddresses[0];
    if (contract) result.add(contract);
  }
  return [...result];
}

export async function analyzeIncomingDepositContracts(
  input: AnalyzeIncomingDepositContractsInput
): Promise<AnalyzeIncomingDepositContractsResult> {
  if (!input.analyzeContractLlmCaseFiles) {
    return { verdicts: [], caseFileCount: 0 };
  }

  const caseFiles: ContractAnalysisCaseFile[] = [];
  for (const contractAddress of contractCandidates(input.originPaths)) {
    const relatedPaths = input.originPaths.filter((path) => path.pathAddresses[0] === contractAddress);
    const txHashes = [...new Set(relatedPaths.flatMap((path) => path.txHashes))];
    const txDetails = [];
    for (const txHash of txHashes.slice(0, 4)) {
      txDetails.push({ txHash, raw: await input.getTransaction(txHash).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })) });
    }

    const profile = await input.getContractIntelligenceProfile(contractAddress).catch(() => null);
    const evidenceIds = [...new Set([input.depositTxHash, ...txHashes])];
    caseFiles.push({
      policyVersion: CONTRACT_LLM_VERDICT_POLICY_VERSION,
      subjectAddress: input.subjectAddress,
      checkedWalletAddress: input.watchedWallet,
      contractAddress,
      currentUsdtBalanceRaw: null,
      balanceFormingTransfers: [],
      originPaths: [],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [],
      serviceClassification: null,
      contractProfile: {
        ...(profile ? { intelligenceProfile: profile } : {}),
        incomingDepositContext: {
          depositTxHash: input.depositTxHash,
          watchedWallet: input.watchedWallet,
          relatedPaths: relatedPaths.map((path) => ({
            pathAddresses: path.pathAddresses,
            txHashes: path.txHashes,
            amountCoverageRatio: path.amountCoverageRatio,
            amountContinuity: path.amountContinuity,
            proximityHops: path.proximityHops,
            reasons: path.reasons
          })),
          transactionDetails: txDetails
        }
      },
      evidenceIds,
      policyQuestion: "Classify whether this unknown contract funding an incoming deposit looks like a legitimate service, drainer-like contract, suspicious unknown contract, or insufficient data. Return JSON only."
    });
  }

  if (caseFiles.length === 0) return { verdicts: [], caseFileCount: 0 };
  return {
    verdicts: await input.analyzeContractLlmCaseFiles(caseFiles),
    caseFileCount: caseFiles.length
  };
}
```

- [ ] **Step 4: Run test and confirm pass**

Run:

```bash
npm test -- tests/forensics/incomingDepositContractContext.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/incomingDepositContractContext.ts tests/forensics/incomingDepositContractContext.test.ts src/types.ts
git commit -m "feat: escalate incoming deposit contracts to llm"
```

---

### Task 5: Add Deposit Risk Scoring And Zero-Balance-Safe Policy

**Files:**
- Create: `src/forensics/incomingDepositRisk.ts`
- Test: `tests/forensics/incomingDepositRisk.test.ts`

- [ ] **Step 1: Write scoring tests**

Create tests for the combined policy:

```ts
import { describe, expect, it } from "vitest";
import type { IncomingDepositOriginPath, RiskReport } from "../../src/types";
import { buildIncomingDepositRiskReport } from "../../src/forensics/incomingDepositRisk";

const lowFast: RiskReport = {
  score: 0,
  level: "LOW",
  reasons: [{ code: "no_obvious_risk", message: "no obvious risk signals found", scoreImpact: 0, source: "test", confidence: "low", severity: "info" }],
  signalGroups: []
};

function path(overrides: Partial<IncomingDepositOriginPath>): IncomingDepositOriginPath {
  return {
    verdict: "ACCEPTABLE",
    score: 35,
    sourcePolicy: "unknown",
    stoppedReason: "no_previous_transfer",
    pathAddresses: ["TFunder", "TSender", "TWatched"],
    txHashes: ["funding", "deposit"],
    steps: [],
    amountCoverageRatio: 0.8,
    amountContinuity: "strong",
    proximityHops: 1,
    reasons: ["Source remains unproven."],
    ...overrides
  };
}

describe("buildIncomingDepositRiskReport", () => {
  it("does not score medium solely because sender current balance is zero", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "tx",
      watchedWallet: "TWatched",
      sender: "TSender",
      amountRaw: "100000000000",
      fastSenderRisk: lowFast,
      originPaths: [path({ stoppedReason: "no_previous_transfer" })],
      originCoverage: 0.75,
      senderRole: "operational_liquidity_wallet",
      senderCurrentBalanceRaw: "0",
      contractVerdicts: [],
      warnings: ["Sender current balance is zero after outgoing deposit; balance-origin mode is not applicable."]
    });

    expect(report.decision).toBe("ACCEPTABLE");
    expect(report.depositRiskScore).toBeLessThanOrEqual(40);
    expect(report.reasons.join(" ")).not.toMatch(/zero.*risk/i);
  });

  it("declines close unknown contract funding for a fresh one-shot sender and large amount", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "48d33",
      watchedWallet: "TEYPUt",
      sender: "TEaViA",
      amountRaw: "384064001319",
      fastSenderRisk: lowFast,
      originPaths: [path({
        verdict: "DECLINE",
        score: 58,
        sourcePolicy: "medium_policy",
        stoppedReason: "unknown_contract_reached",
        pathAddresses: ["TFcRN", "TEaViA", "TEYPUt"],
        amountCoverageRatio: 0.92,
        amountContinuity: "strong",
        proximityHops: 1
      })],
      originCoverage: 0.92,
      senderRole: "fresh_one_shot_wallet",
      senderCurrentBalanceRaw: "0",
      contractVerdicts: [{
        source: "llm",
        cacheMatch: null,
        reusedFromContractAddress: null,
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TFcRN",
        caseFileHash: "case-hash-1",
        cacheId: null,
        verdict: "unknown_suspicious",
        confidence: 0.8,
        contractRiskScore: 72,
        decisionRecommendation: "DECLINE",
        reasons: ["Unknown contract funded sender shortly before deposit."],
        citedEvidenceIds: ["contract-in"],
        falsePositiveNotes: []
      }],
      warnings: []
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.depositRiskScore).toBeGreaterThanOrEqual(60);
  });

  it("hard declines HTX/Huobi close source", () => {
    const report = buildIncomingDepositRiskReport({
      depositTxHash: "tx",
      watchedWallet: "TWatched",
      sender: "TSender",
      amountRaw: "100000000000",
      fastSenderRisk: lowFast,
      originPaths: [path({
        verdict: "DECLINE",
        score: 78,
        sourcePolicy: "hard_decline",
        stoppedReason: "htx_huobi_reached",
        reasons: ["Deposit path reaches HTX/Huobi."]
      })],
      originCoverage: 1,
      senderRole: "unknown_wallet",
      senderCurrentBalanceRaw: null,
      contractVerdicts: [],
      warnings: []
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.depositRiskScore).toBeGreaterThanOrEqual(70);
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
npm test -- tests/forensics/incomingDepositRisk.test.ts
```

Expected: FAIL because scoring module does not exist.

- [ ] **Step 3: Implement scoring module**

Create `src/forensics/incomingDepositRisk.ts`:

```ts
import type {
  ContractLlmVerdictSummary,
  IncomingDepositHardBadEvidence,
  IncomingDepositOriginPath,
  IncomingDepositRiskBand,
  IncomingDepositRiskReport,
  RiskReport
} from "../types";

export type BuildIncomingDepositRiskReportInput = {
  depositTxHash: string;
  watchedWallet: string;
  sender: string;
  amountRaw: string;
  fastSenderRisk: RiskReport | null;
  originPaths: IncomingDepositOriginPath[];
  originCoverage: number;
  senderRole: string | null;
  senderCurrentBalanceRaw: string | null;
  contractVerdicts: ContractLlmVerdictSummary[];
  warnings: string[];
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rawUsdt(value: string): number {
  if (!/^\d+$/.test(value)) return 0;
  return Number(BigInt(value) / 1_000_000n);
}

function band(score: number): IncomingDepositRiskBand {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 45) return "MEDIUM";
  if (score >= 20) return "LOW-MEDIUM";
  return "LOW";
}

function highestPathRisk(paths: IncomingDepositOriginPath[]): number {
  return Math.max(0, ...paths.map((path) => path.score));
}

function hardEvidence(paths: IncomingDepositOriginPath[], verdicts: ContractLlmVerdictSummary[], fast: RiskReport | null): IncomingDepositHardBadEvidence[] {
  const evidence: IncomingDepositHardBadEvidence[] = [];
  if (fast && fast.score >= 85) {
    evidence.push({
      kind: "scam_or_blacklist",
      score: fast.score,
      message: `Fast sender check has critical score ${fast.score}/100.`,
      evidenceIds: fast.reasons.map((reason) => reason.evidenceRef ?? reason.code)
    });
  }
  for (const path of paths) {
    if (path.stoppedReason === "htx_huobi_reached") {
      evidence.push({ kind: "htx_huobi_source", score: Math.max(78, path.score), message: path.reasons[0] ?? "Deposit path reaches HTX/Huobi.", evidenceIds: path.txHashes });
    }
    if (path.stoppedReason === "bridge_router_dex_reached") {
      evidence.push({ kind: "bridge_router_dex_boundary", score: Math.max(70, path.score), message: path.reasons[0] ?? "Deposit path reaches bridge/router/DEX.", evidenceIds: path.txHashes });
    }
  }
  for (const verdict of verdicts) {
    if (verdict.verdict === "drainer_like" && verdict.decisionRecommendation === "DECLINE" && (verdict.confidence >= 0.75 || verdict.contractRiskScore >= 90)) {
      evidence.push({
        kind: "llm_contract_suspicion",
        score: Math.max(85, verdict.contractRiskScore),
        message: `LLM contract verdict is drainer_like with score ${verdict.contractRiskScore}/100.`,
        evidenceIds: verdict.citedEvidenceIds
      });
    }
  }
  return evidence.sort((left, right) => right.score - left.score);
}

function provenanceConfidence(paths: IncomingDepositOriginPath[], originCoverage: number): number {
  const cleanShare = paths.some((path) => path.stoppedReason === "clean_cex_reached") ? 50 : 0;
  const continuityBonus = Math.max(0, ...paths.map((path) => path.amountContinuity === "strong" ? 20 : path.amountContinuity === "medium" ? 10 : 0));
  return clamp(20 + originCoverage * 30 + cleanShare + continuityBonus);
}

function dataQuality(paths: IncomingDepositOriginPath[], coverage: number): "low" | "medium" | "high" {
  if (coverage >= 0.85 && paths.length > 0) return "high";
  if (coverage >= 0.45) return "medium";
  return "low";
}

function isOperational(role: string | null): boolean {
  return role === "operational_liquidity_wallet" || role === "clean_cex_funded_wallet";
}

function hasUnknownContract(paths: IncomingDepositOriginPath[]): boolean {
  return paths.some((path) => path.stoppedReason === "unknown_contract_reached");
}

function hasSuspiciousUnknownContract(verdicts: ContractLlmVerdictSummary[]): boolean {
  return verdicts.some((verdict) =>
    verdict.decisionRecommendation === "DECLINE" &&
    (verdict.verdict === "unknown_suspicious" || verdict.verdict === "drainer_like")
  );
}

export function buildIncomingDepositRiskReport(input: BuildIncomingDepositRiskReportInput): IncomingDepositRiskReport {
  const hard = hardEvidence(input.originPaths, input.contractVerdicts, input.fastSenderRisk);
  const confidence = provenanceConfidence(input.originPaths, input.originCoverage);
  const quality = dataQuality(input.originPaths, input.originCoverage);
  const topHard = hard[0] ?? null;

  if (topHard) {
    const score = clamp(Math.max(topHard.score, highestPathRisk(input.originPaths)));
    return {
      decision: "DECLINE",
      depositRiskScore: score,
      riskBand: band(score),
      fastSenderRisk: input.fastSenderRisk,
      originPaths: input.originPaths,
      originCoverage: input.originCoverage,
      provenanceConfidence: confidence,
      dataQuality: quality,
      senderRole: input.senderRole,
      hardBadEvidence: hard,
      contractVerdicts: input.contractVerdicts,
      reasons: [topHard.message],
      warnings: input.warnings
    };
  }

  const amount = rawUsdt(input.amountRaw);
  const unknownContractRisk = hasUnknownContract(input.originPaths);
  const suspiciousContract = hasSuspiciousUnknownContract(input.contractVerdicts);
  const freshOneShot = input.senderRole === "fresh_one_shot_wallet" || input.senderRole === "unknown_wallet";

  if ((unknownContractRisk || suspiciousContract) && freshOneShot && amount >= 10_000) {
    const score = clamp(Math.max(60, highestPathRisk(input.originPaths), ...input.contractVerdicts.map((verdict) => verdict.contractRiskScore)));
    return {
      decision: "DECLINE",
      depositRiskScore: score,
      riskBand: band(score),
      fastSenderRisk: input.fastSenderRisk,
      originPaths: input.originPaths,
      originCoverage: input.originCoverage,
      provenanceConfidence: confidence,
      dataQuality: quality,
      senderRole: input.senderRole,
      hardBadEvidence: [],
      contractVerdicts: input.contractVerdicts,
      reasons: ["Large deposit has close unknown contract funding and sender is not established as operational liquidity."],
      warnings: input.warnings
    };
  }

  if (isOperational(input.senderRole)) {
    const score = clamp(Math.min(40, Math.max(25, 25 + Math.max(0, 70 - confidence) * 0.15 + Math.max(0, 0.7 - input.originCoverage) * 15)));
    return {
      decision: "ACCEPTABLE",
      depositRiskScore: score,
      riskBand: band(score),
      fastSenderRisk: input.fastSenderRisk,
      originPaths: input.originPaths,
      originCoverage: input.originCoverage,
      provenanceConfidence: confidence,
      dataQuality: quality,
      senderRole: input.senderRole,
      hardBadEvidence: [],
      contractVerdicts: input.contractVerdicts,
      reasons: ["Sender looks like an operational/liquidity wallet and no hard bad evidence was found."],
      warnings: input.warnings
    };
  }

  const unresolvedScore = clamp(Math.max(45, highestPathRisk(input.originPaths), input.fastSenderRisk?.score ?? 0));
  return {
    decision: unresolvedScore >= 45 ? "DECLINE" : "ACCEPTABLE",
    depositRiskScore: unresolvedScore,
    riskBand: band(unresolvedScore),
    fastSenderRisk: input.fastSenderRisk,
    originPaths: input.originPaths,
    originCoverage: input.originCoverage,
    provenanceConfidence: confidence,
    dataQuality: quality,
    senderRole: input.senderRole,
    hardBadEvidence: [],
    contractVerdicts: input.contractVerdicts,
    reasons: ["Clean source is not proven and sender does not match the operational/liquidity profile."],
    warnings: input.warnings
  };
}
```

- [ ] **Step 4: Run test and confirm pass**

Run:

```bash
npm test -- tests/forensics/incomingDepositRisk.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/incomingDepositRisk.ts tests/forensics/incomingDepositRisk.test.ts
git commit -m "feat: score incoming deposit risk"
```

---

### Task 6: Add Incoming Deposit Job Runner

**Files:**
- Create: `src/forensics/incomingDepositJob.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Write job runner tests**

Create tests for job claim, report completion, and final delivery:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ForensicCheckJob } from "../../src/storage/repositories";
import { runSingleIncomingDepositJobCycle } from "../../src/forensics/incomingDepositJob";

function job(progressJson: Record<string, unknown>): ForensicCheckJob {
  return {
    id: "job-incoming-1",
    kind: "incoming_deposit_check",
    subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
    status: "running",
    windowStart: new Date("2026-05-29T13:00:00.000Z"),
    windowEnd: new Date("2026-05-29T14:02:00.000Z"),
    priority: 140,
    chatId: "42",
    messageId: null,
    requestedBy: "42",
    progressJson,
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-05-29T14:02:00.000Z"),
    updatedAt: new Date("2026-05-29T14:02:00.000Z"),
    startedAt: new Date("2026-05-29T14:02:01.000Z"),
    completedAt: null
  };
}

describe("runSingleIncomingDepositJobCycle", () => {
  it("completes an incoming deposit job and sends one final alert", async () => {
    const complete = vi.fn(async () => true);
    const send = vi.fn(async () => undefined);
    const markSent = vi.fn(async () => true);

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job({
        depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
        watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
        watchedWalletId: "wallet-1",
        sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
        amountRaw: "384064001319",
        amount: "384064.001319",
        timestamp: "2026-05-29T14:01:00.000Z",
        telegramUserId: "42",
        alertMode: "realtime"
      }),
      completeForensicCheckJob: complete,
      markUserAlertSent: markSent,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: send,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML",
        replyMarkup: undefined
      }),
      buildReport: async () => ({
        decision: "ACCEPTABLE",
        depositRiskScore: 32,
        riskBand: "LOW-MEDIUM",
        fastSenderRisk: null,
        originPaths: [],
        originCoverage: 0.72,
        provenanceConfidence: 58,
        dataQuality: "medium",
        senderRole: "operational_liquidity_wallet",
        hardBadEvidence: [],
        contractVerdicts: [],
        reasons: ["Sender looks operational."],
        warnings: []
      })
    });

    expect(handled).toBe(true);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith({
      txHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
      watchedWalletId: "wallet-1"
    });
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: FAIL because job module does not exist.

- [ ] **Step 3: Implement job module**

Create `src/forensics/incomingDepositJob.ts`:

```ts
import type { ForensicCheckJob, ForensicCheckJobKind } from "../storage/repositories";
import type { IncomingDepositRiskReport, RiskReport, WalletAlertMode } from "../types";

type CompleteJobInput = {
  id: string;
  status: "completed" | "partial" | "failed";
  progressJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  rawEvidenceIds: string[];
  observationIds: string[];
  lastError: string | null;
};

export type RunSingleIncomingDepositJobCycleDeps = {
  claimNextForensicCheckJob(): Promise<ForensicCheckJob | null>;
  completeForensicCheckJob(input: CompleteJobInput): Promise<boolean>;
  markUserAlertSent(input: { txHash: string; watchedWalletId: string }): Promise<boolean>;
  markUserAlertFailed(input: { txHash: string; watchedWalletId: string; error: string }): Promise<boolean>;
  recordObservedTransactionRisk(input: { txHash: string; watchedWalletId: string; report: RiskReport }): Promise<boolean>;
  sendUserAlert(telegramUserId: string, message: string, options?: { parse_mode?: "HTML"; reply_markup?: unknown }): Promise<void>;
  formatIncomingDepositRiskAlert(input: {
    jobId: string;
    amount: string;
    watchedWallet: string;
    sender: string;
    txHash: string;
    report: IncomingDepositRiskReport;
  }): { text: string; parseMode: "HTML"; replyMarkup?: unknown };
  buildReport(input: {
    job: ForensicCheckJob;
    depositTxHash: string;
    watchedWallet: string;
    sender: string;
    amountRaw: string;
    timestamp: Date;
  }): Promise<IncomingDepositRiskReport>;
};

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function riskReportFromIncoming(report: IncomingDepositRiskReport): RiskReport {
  return {
    score: report.depositRiskScore,
    level: report.riskBand === "CRITICAL" ? "CRITICAL" : report.riskBand === "HIGH" ? "HIGH" : report.riskBand === "MEDIUM" ? "MEDIUM" : "LOW",
    reasons: report.reasons.map((reason, index) => ({
      code: `incoming_deposit_reason_${index + 1}`,
      message: reason,
      scoreImpact: 0,
      source: "incoming_deposit",
      confidence: "medium",
      severity: report.decision === "DECLINE" ? "high" : "low"
    })),
    signalGroups: []
  };
}

function shouldSend(alertMode: WalletAlertMode, report: IncomingDepositRiskReport): boolean {
  if (alertMode === "paused") return false;
  if (alertMode === "realtime") return true;
  if (alertMode === "risk_only") return report.decision === "DECLINE";
  if (alertMode === "digest") return false;
  return true;
}

export async function runSingleIncomingDepositJobCycle(
  deps: RunSingleIncomingDepositJobCycleDeps
): Promise<boolean> {
  const job = await deps.claimNextForensicCheckJob();
  if (!job) return false;

  const depositTxHash = stringField(job.progressJson.depositTxHash);
  const watchedWallet = stringField(job.progressJson.watchedWallet);
  const watchedWalletId = stringField(job.progressJson.watchedWalletId);
  const sender = stringField(job.progressJson.sender);
  const amountRaw = stringField(job.progressJson.amountRaw);
  const timestampText = stringField(job.progressJson.timestamp);
  const telegramUserId = stringField(job.progressJson.telegramUserId);
  const alertMode = (stringField(job.progressJson.alertMode) ?? "realtime") as WalletAlertMode;

  if (!depositTxHash || !watchedWallet || !watchedWalletId || !sender || !amountRaw || !timestampText || !telegramUserId) {
    const error = "incoming_deposit_check job is missing required progress_json fields";
    await deps.completeForensicCheckJob({
      id: job.id,
      status: "failed",
      progressJson: job.progressJson,
      resultJson: {},
      rawEvidenceIds: [],
      observationIds: [],
      lastError: error
    });
    return true;
  }

  try {
    const report = await deps.buildReport({
      job,
      depositTxHash,
      watchedWallet,
      sender,
      amountRaw,
      timestamp: new Date(timestampText)
    });
    const riskReport = riskReportFromIncoming(report);
    await deps.recordObservedTransactionRisk({ txHash: depositTxHash, watchedWalletId, report: riskReport });
    await deps.completeForensicCheckJob({
      id: job.id,
      status: "completed",
      progressJson: job.progressJson,
      resultJson: report as unknown as Record<string, unknown>,
      rawEvidenceIds: [],
      observationIds: [],
      lastError: null
    });

    if (shouldSend(alertMode, report)) {
      const message = deps.formatIncomingDepositRiskAlert({
        jobId: job.id,
        amount: stringField(job.progressJson.amount) ?? amountRaw,
        watchedWallet,
        sender,
        txHash: depositTxHash,
        report
      });
      await deps.sendUserAlert(telegramUserId, message.text, { parse_mode: message.parseMode, reply_markup: message.replyMarkup });
      await deps.markUserAlertSent({ txHash: depositTxHash, watchedWalletId });
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.markUserAlertFailed({ txHash: depositTxHash, watchedWalletId, error: message });
    await deps.completeForensicCheckJob({
      id: job.id,
      status: "failed",
      progressJson: job.progressJson,
      resultJson: {},
      rawEvidenceIds: [],
      observationIds: [],
      lastError: message
    });
    return true;
  }
}

export const INCOMING_DEPOSIT_JOB_KIND: ForensicCheckJobKind = "incoming_deposit_check";
```

- [ ] **Step 4: Keep runtime wiring out of this task**

No `src/index.ts` changes in this task. Runtime wiring happens after the real formatter exists, in Task 9. This keeps the job runner unit-testable and prevents a compile-time dependency on Telegram formatter work that has not been implemented yet.

- [ ] **Step 5: Run job tests**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "feat: add incoming deposit job runner"
```

---

### Task 7: Wire Runtime Report Builder

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add integration test for report builder dependencies**

Extend `tests/forensics/incomingDepositJob.test.ts` with a test that verifies:

```ts
expect(buildReport).toHaveBeenCalledWith(expect.objectContaining({
  depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
  watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
  sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs"
}));
```

- [ ] **Step 2: Add runtime builder function**

In `src/forensics/incomingDepositJob.ts`, export a builder:

```ts
import { evaluateAddressRisk } from "../risk/evaluation";
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import { indexedTransferToRouteEdge } from "./localTronUsdtIndex";
import { normalizeTransfer } from "./routeSearch";
import { traceIncomingDepositProvenance } from "./incomingDepositProvenance";
import { analyzeIncomingDepositContracts } from "./incomingDepositContractContext";
import { buildIncomingDepositRiskReport } from "./incomingDepositRisk";
```

Add:

```ts
export type IncomingDepositRuntimeDeps = {
  listIndexedUsdtTransfersForAddress(address: string, options: { minTimestamp?: Date; maxTimestamp?: Date; limit: number; orderBy: "newest"; direction: "both" }): Promise<unknown[]>;
  listRelatedTrc20Transfers(address: string, options: { start: number; limit: number; minTimestamp?: number; endTimestamp?: number }): Promise<unknown[]>;
  getLabelsForAddress(address: string): Promise<import("../types").AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<import("../types").ServiceClassification | null>;
  getContractIntelligenceProfile(address: string): Promise<ContractRiskContext | null>;
  getTransaction(txHash: string): Promise<unknown>;
  getUsdtRestrictionStatus(address: string): Promise<import("../types").StablecoinRestrictionProfile | null>;
  analyzeContractLlmCaseFiles?: (caseFiles: import("../types").ContractAnalysisCaseFile[]) => Promise<import("../types").ContractLlmVerdictSummary[]>;
};
```

Then add a `buildIncomingDepositReport` function that:

1. fetches sender labels and USDT restriction;
2. builds fast sender risk with `evaluateAddressRisk`;
3. fetches indexed/live edges for sender and upstream addresses;
4. calls `traceIncomingDepositProvenance`;
5. calls `analyzeIncomingDepositContracts`;
6. infers sender role from existing behavior/profile helpers when available;
7. calls `buildIncomingDepositRiskReport`.

Use warning text for zero-balance:

```ts
const zeroBalanceWarning = stablecoinState?.balanceRaw === "0"
  ? "Sender current balance is zero after outgoing deposit; balance-origin mode is not applicable."
  : null;
```

Do not convert this warning into risk evidence.

- [ ] **Step 3: Keep runtime dependency injection explicit**

The builder must accept dependencies through `IncomingDepositRuntimeDeps`; do not import the Tron client, database, Telegram bot, or config directly inside `src/forensics/incomingDepositJob.ts`. The real `src/index.ts` wiring happens in Task 9 after the Telegram formatter and callback UX exist.

Use this dependency shape in tests:

```ts
const buildReport = (input: Parameters<typeof buildIncomingDepositReport>[0]) => buildIncomingDepositReport({
  job: input.job,
  depositTxHash: input.depositTxHash,
  watchedWallet: input.watchedWallet,
  sender: input.sender,
  amountRaw: input.amountRaw,
  timestamp: input.timestamp,
  deps: {
    listIndexedUsdtTransfersForAddress: (address, options) => listIndexedTronUsdtTransfersForAddress(db, {
      address,
      minTimestamp: options.minTimestamp,
      maxTimestamp: options.maxTimestamp,
      limit: options.limit,
      orderBy: options.orderBy,
      direction: "both"
    }),
    listRelatedTrc20Transfers: (address, options) => tronClient.listRelatedTrc20Transfers(address, options),
    getLabelsForAddress: (address) => listAddressLabels(db, address),
    getClassificationForAddress: async (address) => {
      const [metadata, contractProfile] = await Promise.all([
        getCachedOrLiveAddressMetadata(address),
        getContractIntelligenceProfile(db, address, new Date())
      ]);
      return classifyServiceAddress({ address, metadata, contractProfile });
    },
    getContractIntelligenceProfile: (address) => getContractIntelligenceProfile(db, address, new Date()),
    getTransaction: (txHash) => tronClient.getTransaction(txHash),
    getUsdtRestrictionStatus: (address) => tronClient.getUsdtRestrictionStatus(address),
    analyzeContractLlmCaseFiles: contractLlmVerdictAnalyzer
  }
})
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts tests/forensics/incomingDepositRisk.test.ts tests/forensics/incomingDepositProvenance.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "feat: wire incoming deposit report builder"
```

---

### Task 8: Update Telegram Alert UX And Contextual Buttons

**Files:**
- Modify: `src/alerts/formatters.ts`
- Modify: `src/alerts/keyboards.ts`
- Modify: `src/bot/keyboards.ts`
- Modify: `src/bot/createBot.ts`
- Test: `tests/alerts/formatters.test.ts`
- Test: `tests/alerts/keyboards.test.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write alert formatter test**

Add:

```ts
it("formats final incoming deposit risk with sender risk separated", () => {
  const message = formatIncomingDepositRiskAlert({
    jobId: "job-123",
    amount: "384064.001319",
    watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
    sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
    txHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
    report: {
      decision: "DECLINE",
      depositRiskScore: 68,
      riskBand: "HIGH",
      fastSenderRisk: { score: 0, level: "LOW", reasons: [], signalGroups: [] },
      originPaths: [],
      originCoverage: 0.76,
      provenanceConfidence: 62,
      dataQuality: "medium",
      senderRole: "fresh_one_shot_wallet",
      hardBadEvidence: [],
      contractVerdicts: [],
      reasons: ["Sender was funded shortly before this deposit by unknown smart contract."],
      warnings: []
    }
  });

  expect(message.text).toContain("Decision: <code>DECLINE</code>");
  expect(message.text).toContain("Deposit risk");
  expect(message.text).toContain("Fast sender risk");
  expect(message.text).not.toContain("Low risk: <code>0/100</code>");
});
```

- [ ] **Step 2: Write keyboard callback tests**

Add:

```ts
it("uses deposit job id for contextual incoming deposit actions", () => {
  const keyboard = userIncomingDepositRiskKeyboard({
    jobId: "42a0a912-dc6a-45b5-b281-a2f0c7ac034e",
    sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
    txHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b"
  });

  expect(JSON.stringify(keyboard.inline_keyboard)).toContain("check:deposit:42a0a912-dc6a-45b5-b281-a2f0c7ac034e");
});
```

- [ ] **Step 3: Implement formatter**

In `src/alerts/formatters.ts`, add:

```ts
import type { IncomingDepositRiskReport } from "../types";
import { userIncomingDepositRiskKeyboard } from "./keyboards";
```

Add:

```ts
export function formatIncomingDepositRiskAlert(input: {
  jobId: string;
  amount: string;
  watchedWallet: string;
  sender: string;
  txHash: string;
  report: IncomingDepositRiskReport;
}): TelegramAlertMessage & { replyMarkup: ReturnType<typeof userIncomingDepositRiskKeyboard> } {
  const fast = input.report.fastSenderRisk
    ? `${input.report.fastSenderRisk.score}/100 ${input.report.fastSenderRisk.level}`
    : "not available";
  const message = telegramHtmlMessage([
    bold("Incoming USDT"),
    `${bold("Decision")}: ${code(input.report.decision)}`,
    `${bold("Deposit risk")}: ${formatRiskIcon(input.report.depositRiskScore)} ${code(`${input.report.depositRiskScore}/100`)} ${escapeHtml(input.report.riskBand)}`,
    [
      `${bold("Amount")}: ${code(`${input.amount} USDT`)}`,
      `${bold("Watched wallet")}: ${code(input.watchedWallet)}`,
      `${bold("From")}: ${code(input.sender)}`
    ].join("\n"),
    section("Reasons", [bulletList(input.report.reasons)]),
    section("Checks", [
      bulletList([
        `Fast sender risk: ${fast}`,
        `Origin coverage: ${Math.round(input.report.originCoverage * 100)}%`,
        `Data quality: ${input.report.dataQuality}`,
        input.report.senderRole ? `Sender role: ${input.report.senderRole}` : "Sender role: unknown"
      ])
    ]),
    `${bold("Tx")}: ${code(input.txHash)}`
  ]);
  return {
    ...message,
    replyMarkup: userIncomingDepositRiskKeyboard({
      jobId: input.jobId,
      sender: input.sender,
      txHash: input.txHash
    })
  };
}
```

- [ ] **Step 4: Implement contextual keyboard**

In `src/alerts/keyboards.ts`, add:

```ts
export function userIncomingDepositRiskKeyboard(input: { jobId: string; sender: string; txHash: string }): InlineKeyboard {
  return new InlineKeyboard()
    .text("Check deposit/source", `check:deposit:${input.jobId}`)
    .row()
    .url("Open tx", tronscanTransactionUrl(input.txHash))
    .url("Open sender", tronscanAddressUrl(input.sender));
}
```

In `src/bot/keyboards.ts`, extend callback type:

```ts
| { kind: "check_deposit_job"; jobId: string }
```

Parse:

```ts
const depositJobMatch = /^check:deposit:([0-9a-fA-F-]{36})$/.exec(data);
if (depositJobMatch) return { kind: "check_deposit_job", jobId: depositJobMatch[1] };
```

- [ ] **Step 5: Handle callback in bot**

In `src/bot/createBot.ts`, route `check_deposit_job` to existing job status display:

```ts
if (callback.kind === "check_deposit_job") {
  await clearTelegramUserPendingAction(db, id);
  await sendMessage(ctx, formatForensicJobStatus(await resolveForensicCheckJob(callback.jobId), {
    runtimeLabel: config.runtimeInstanceLabel,
    locale
  }));
  return;
}
```

Ensure this branch is placed near existing forensic job status handling.

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- tests/alerts/formatters.test.ts tests/alerts/keyboards.test.ts tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/alerts/formatters.ts src/alerts/keyboards.ts src/bot/keyboards.ts src/bot/createBot.ts tests/alerts/formatters.test.ts tests/alerts/keyboards.test.ts tests/bot/createBot.test.ts
git commit -m "feat: show incoming deposit risk alerts"
```

---

### Task 9: Update Monitor Flow To Queue One Final Incoming Alert

**Files:**
- Modify: `src/monitor/monitorWorker.ts`
- Modify: `src/index.ts`
- Test: `tests/monitor/monitorWorker.test.ts`

- [ ] **Step 1: Write monitor tests**

Add tests:

```ts
it("queues incoming deposit job instead of sending sender-only alert", async () => {
  const queued: unknown[] = [];
  const sent: unknown[] = [];

  await runSinglePollingCycle({
    wallets: [wallet],
    tronClient,
    pageLimit: 50,
    maxPagesPerWallet: 1,
    backfillLookbackMs: 86_400_000,
    getWalletPollState: async () => null,
    upsertWalletPollState: async () => undefined,
    claimObservedTransactionForUserAlert: async () => true,
    markUserAlertAnalyzing: async () => true,
    queueIncomingDepositJob: async (input) => {
      queued.push(input);
      return { id: "job-incoming-1" };
    },
    claimUserAlertsForRetry: async () => [],
    claimDigestTransactions: async () => [],
    recordObservedTransactionRisk: async () => true,
    markUserAlertSent: async () => true,
    markUserAlertSkipped: async () => true,
    markUserAlertFailed: async () => true,
    markDigestSent: async () => 0,
    getLabelsForAddress: async () => [],
    sendUserAlert: async (...args) => { sent.push(args); },
    sendAdminAlert: async () => undefined
  });

  expect(queued).toHaveLength(1);
  expect(sent).toHaveLength(0);
});
```

Add a retry test that `analyzing` rows are not reclaimed by the generic immediate sender-only retry loop.

- [ ] **Step 2: Run monitor tests and confirm failure**

Run:

```bash
npm test -- tests/monitor/monitorWorker.test.ts
```

Expected: FAIL because monitor deps do not include `queueIncomingDepositJob` or `markUserAlertAnalyzing`.

- [ ] **Step 3: Extend monitor deps**

In `src/monitor/monitorWorker.ts`, add:

```ts
queueIncomingDepositJob?(input: {
  txHash: string;
  watchedWalletId: string;
  watchedWallet: string;
  sender: string;
  amount: string;
  amountRaw: string;
  timestamp: Date;
  telegramUserId: string;
  chatId: string;
  requestedBy: string;
  alertMode: WalletAlertMode;
  locale?: string | null;
}): Promise<{ id: string }>;
markUserAlertAnalyzing?(input: { txHash: string; watchedWalletId: string }): Promise<boolean>;
```

Use a small amount parser:

```ts
function parseUsdtDisplayToRaw(amount: string): string {
  return parseUsdtToMicro(amount).toString();
}
```

- [ ] **Step 4: Replace immediate sender-only delivery in incoming context**

In `deliverUserAlert`, before `calculateSenderRisk`, branch when `queueIncomingDepositJob` and `markUserAlertAnalyzing` exist:

```ts
if (deps.queueIncomingDepositJob && deps.markUserAlertAnalyzing) {
  try {
    await deps.queueIncomingDepositJob({
      txHash: event.txHash,
      watchedWalletId: wallet.id,
      watchedWallet: wallet.address,
      sender: event.sender,
      amount: event.amount,
      amountRaw: parseUsdtDisplayToRaw(event.amount),
      timestamp: event.timestamp,
      telegramUserId: wallet.telegramUserId,
      chatId: wallet.telegramUserId,
      requestedBy: wallet.telegramUserId,
      alertMode: wallet.alertMode,
      locale: null
    });
    await deps.markUserAlertAnalyzing({ txHash: event.txHash, watchedWalletId: wallet.id });
    return;
  } catch (error) {
    const message = errorMessage(error);
    await markUserAlertFailedSafely(event, wallet, message, deps);
    (deps.logger ?? defaultLogger).error("incoming_deposit_job_queue_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      tx_hash: event.txHash,
      error: message
    });
    return;
  }
}
```

This keeps backward compatibility in tests or local runs that do not pass the new deps.

- [ ] **Step 5: Wire monitor deps in `src/index.ts`**

Add imports:

```ts
import { markUserAlertAnalyzing } from "./storage/repositories";
import { formatIncomingDepositRiskAlert } from "./alerts/formatters";
import { buildIncomingDepositReport, runSingleIncomingDepositJobCycle } from "./forensics/incomingDepositJob";
```

Pass to `runSinglePollingCycle`:

```ts
markUserAlertAnalyzing: (input) => markUserAlertAnalyzing(db, input),
queueIncomingDepositJob: async (input) => {
  const windowEnd = new Date(input.timestamp.getTime() + 60_000);
  const windowStart = new Date(input.timestamp.getTime() - 30 * 24 * 60 * 60 * 1000);
  const job = await createOrReuseForensicCheckJob(db, {
    kind: "incoming_deposit_check",
    subjectAddress: input.sender,
    windowStart,
    windowEnd,
    chatId: input.chatId,
    requestedBy: input.requestedBy,
    priority: 140,
    progressJson: {
      depositTxHash: input.txHash,
      watchedWalletId: input.watchedWalletId,
      watchedWallet: input.watchedWallet,
      sender: input.sender,
      amount: input.amount,
      amountRaw: input.amountRaw,
      timestamp: input.timestamp.toISOString(),
      telegramUserId: input.telegramUserId,
      alertMode: input.alertMode
    }
  });
  return { id: job.id };
}
```

- [ ] **Step 6: Start the incoming deposit worker loop in `src/index.ts`**

Add one active-poll guard near the existing forensic worker guards:

```ts
let activeIncomingDepositPoll: Promise<void> | null = null;
```

Add the loop:

```ts
async function incomingDepositOnce(): Promise<void> {
  if (activeIncomingDepositPoll) return activeIncomingDepositPoll;
  activeIncomingDepositPoll = runForensicJobBatch({
    maxJobs: config.forensicWhereJobsPerPoll,
    runSingleCycle: () => runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: () => claimNextForensicCheckJob(db, { kinds: ["incoming_deposit_check"] }),
      completeForensicCheckJob: (input) => completeForensicCheckJob(db, input),
      markUserAlertSent: (input) => markUserAlertSent(db, input),
      markUserAlertFailed: (input) => markUserAlertFailed(db, input),
      recordObservedTransactionRisk: (input) => recordObservedTransactionRisk(db, input),
      formatIncomingDepositRiskAlert,
      sendUserAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      buildReport: (input) => buildIncomingDepositReport({
        ...input,
        deps: incomingDepositRuntimeDeps
      })
    })
  }).then((handled) => {
    if (handled > 0) logger.info("incoming_deposit_jobs_processed", { handled });
  }).finally(() => {
    activeIncomingDepositPoll = null;
  });
  return activeIncomingDepositPoll;
}
```

Define `incomingDepositRuntimeDeps` beside the existing where/deep forensic dependency setup:

```ts
const incomingDepositRuntimeDeps = {
  listIndexedUsdtTransfersForAddress: (address, options) => listIndexedTronUsdtTransfersForAddress(db, {
    address,
    minTimestamp: options.minTimestamp,
    maxTimestamp: options.maxTimestamp,
    limit: options.limit,
    orderBy: options.orderBy,
    direction: "both"
  }),
  listRelatedTrc20Transfers: (address, options) => tronClient.listRelatedTrc20Transfers(address, options),
  getLabelsForAddress: (address) => listAddressLabels(db, address),
  getClassificationForAddress: async (address) => {
    const [metadata, contractProfile] = await Promise.all([
      getCachedOrLiveAddressMetadata(address),
      getContractIntelligenceProfile(db, address, new Date())
    ]);
    return classifyServiceAddress({ address, metadata, contractProfile });
  },
  getContractIntelligenceProfile: (address) => getContractIntelligenceProfile(db, address, new Date()),
  getTransaction: (txHash) => tronClient.getTransaction(txHash),
  getUsdtRestrictionStatus: (address) => tronClient.getUsdtRestrictionStatus(address),
  analyzeContractLlmCaseFiles: contractLlmVerdictAnalyzer
};
```

Register `incomingDepositOnce` on the same interval family as where-is-money:

```ts
setInterval(() => {
  incomingDepositOnce().catch((error) => logger.error("incoming_deposit_worker_failed", { error: errorMessage(error) }));
}, config.forensicWherePollIntervalMs);
```

- [ ] **Step 7: Run monitor tests**

Run:

```bash
npm test -- tests/monitor/monitorWorker.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/monitor/monitorWorker.ts src/index.ts tests/monitor/monitorWorker.test.ts
git commit -m "feat: queue incoming deposit alerts"
```

---

### Task 10: Fix Generic Zero-Balance Sender Checks

**Files:**
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `src/bot/createBot.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write zero-balance address-check regression**

Add to `tests/check/whereIsMoneyCheck.test.ts`:

```ts
it("does not treat zero current balance as medium risk in generic wallet profile context", async () => {
  const report = await runWhereIsMoneyCheck({
    getTrc20Balance: async () => "0",
    fetchEdgesForAddress: async () => [],
    fetchLatestEdgesForAddress: async () => [],
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async () => null,
    getFastWalletRisk: async () => ({ score: 0, level: "LOW", reasons: [], signalGroups: [] })
  }, {
    sourceAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
    windowStart: new Date("2026-04-29T00:00:00.000Z"),
    windowEnd: new Date("2026-05-29T00:00:00.000Z"),
    maxDepth: 7,
    beamWidth: 8,
    maxAddressFetches: 60,
    maxEdgesPerAddress: 40,
    mode: "wallet_profile"
  });

  expect(report.assessment.reasons.join(" ")).toContain("Balance-origin mode is not applicable");
  expect(report.riskScore).toBeLessThan(45);
});
```

This failing test intentionally uses the new `mode: "wallet_profile"` value that Step 3 adds.

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: FAIL because zero balance currently returns the balance-origin insufficient coverage path.

- [ ] **Step 3: Split balance-origin mode from wallet-profile mode**

In `src/check/whereIsMoneyCheck.ts`, extend options:

```ts
mode?: "where_is_money" | "transaction_check" | "wallet_profile";
```

When current balance is zero:

```ts
if (currentBalanceRaw === "0" && options.mode === "wallet_profile") {
  return buildZeroBalanceWalletProfileReport({
    sourceAddress,
    fastWalletRisk,
    message: "Current USDT balance is zero; balance-origin mode is not applicable for this wallet profile check."
  });
}
```

The report should:

- keep `currentUsdtBalanceRaw: "0"`;
- set coverage to `0`;
- set decision from fast risk and labels only;
- use `ACCEPTABLE` if fast risk is low and no hard labels exist;
- include the warning, not a medium-risk reason.

- [ ] **Step 4: Update bot behavior for generic `check:addr`**

In `src/bot/createBot.ts`, when queuing a `where_is_money_check` from a generic address button or manual address check, pass:

```ts
progressJson: {
  mode: "wallet_profile"
}
```

Do not use `wallet_profile` for explicit `/where_is_money` or incoming deposit jobs.

- [ ] **Step 5: Add bot test**

Add a test that pressing old `check:addr:<sender>` does not produce `Risk: 45/100 MEDIUM` solely from zero balance. Expected message text includes:

```text
Balance-origin mode is not applicable
```

and does not include:

```text
Current USDT balance is zero or unavailable; balance-origin trace cannot prove source funds.
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/check/whereIsMoneyCheck.ts src/bot/createBot.ts tests/check/whereIsMoneyCheck.test.ts tests/bot/createBot.test.ts
git commit -m "fix: avoid zero balance sender false positives"
```

---

### Task 11: Full Verification And Live Smoke

**Files:**
- No planned edits. When a verification step fails, fix the specific failing file and include that path in the final verification commit.

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 2: Run full tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run focused live smoke for the problematic tx**

Use the Telegram bot flow to enqueue this exact deposit:

```text
Tx: 48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b
Sender: TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs
Watched wallet: TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM
Amount: 384064.001319 USDT
```

Expected:

- final Telegram message says `Deposit risk`, not sender-only `Low risk: 0/100`;
- `Fast sender risk: 0/100 LOW` appears separately if fast sender remains clean;
- unknown smart-contract upstream funding triggers contract case file and LLM verdict when metadata/classification is unknown;
- no final `REVIEW` state is shown;
- if sender current balance is `0`, the message does not use that alone as medium-risk evidence.

- [ ] **Step 4: Run zero-balance sender smoke**

Press `Check sender` or run the equivalent callback for `TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs`.

Expected:

- generic sender profile does not say `Current USDT: 0` as a medium-risk reason;
- incoming alert contextual action opens `check:deposit:<jobId>` and preserves tx context;
- old generic address check says balance-origin mode is not applicable when balance is zero.

- [ ] **Step 5: Check 429 behavior**

Review logs for:

```text
tronscan_request_rate_limited
HTTP 429
```

Expected:

- no burst of transaction-info requests;
- contract/LLM enrichment respects existing scheduler/cooldown;
- if TronScan times out, job fails safely or returns policy fallback without duplicate Telegram alerts.

- [ ] **Step 6: Final commit**

If verification fixes were needed:

```bash
git add <changed-files>
git commit -m "test: verify incoming deposit risk flow"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Checklist

- [ ] Incoming deposit scoring is transaction-centric and starts from `depositTxHash`.
- [ ] Current sender balance is never used as risk evidence in incoming deposit context.
- [ ] Generic zero-balance address checks use wallet profile semantics, not balance-origin medium risk.
- [ ] Unknown smart-contract funding close to the deposit creates a contract case file and can trigger LLM.
- [ ] HTX/Huobi and bridge/router/DEX remain hard decline in close deposit provenance.
- [ ] WhiteBIT remains medium policy and only becomes decline when close, large, high-share, or repeated.
- [ ] Telegram sends one final incoming alert, not a preliminary plus final pair.
- [ ] Fast sender risk remains visible as separate context.
- [ ] User-facing final decision is only `ACCEPTABLE` or `DECLINE`.
- [ ] Tests cover tx `48d33...`, zero-balance sender, operational-liquidity benign cases, and unknown-contract escalation.
