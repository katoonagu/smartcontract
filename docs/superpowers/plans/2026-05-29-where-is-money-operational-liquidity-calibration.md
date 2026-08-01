# Where Is Money Operational Liquidity Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recalibrate `where-is-money` so ordinary working/liquidity wallets without hard bad evidence become `ACCEPTABLE / LOW-MEDIUM`, while exact drain, high-risk service boundary, blacklist/scam, and strong contract evidence still produce `DECLINE`.

**Architecture:** Keep balance-forming selection and origin tracing as evidence collection. Add a separate operational assessment layer that computes `risk`, `provenance confidence`, `coverage`, `wallet role`, and `hard bad evidence`, then composes the user-facing decision. Approval/contract enrichment becomes triggered and budgeted, so large wallets return a complete-enough result instead of spending many minutes on low-signal transaction-info calls.

**Tech Stack:** TypeScript, Node.js, Vitest, existing `runWhereIsMoneyCheck`, `traceMoneyOriginPath`, `buildMoneyOriginSenderInteractionProfile`, Telegram formatter in `src/bot/createBot.ts`, CLI `scripts/forensicWhereIsMoney.ts`.

---

## File Structure

Create:

- `src/forensics/moneyOriginOperationalAssessment.ts`
  - Owns the new `where-is-money` policy composer.
  - Separates hard bad evidence from weak provenance.
  - Computes `provenanceConfidence`, `coverageCompleteness`, `operationalLiquidityScore`, and `walletRole`.
  - Applies wallet-age and relationship-age dampeners for long-lived ordinary activity, without treating age as proof of clean funds.
  - Converts ordinary operational/liquidity wallets without hard bad evidence to `ACCEPTABLE / LOW-MEDIUM`.

- `src/forensics/moneyOriginAgeSignals.ts`
  - Computes subject wallet age, direct sender age, top upstream sender age, active-day count, dormancy gaps, and relationship age between checked wallet and senders from fetched USDT edges.
  - Produces dampener/booster signals consumed by `moneyOriginOperationalAssessment.ts`.

- `tests/forensics/moneyOriginOperationalAssessment.test.ts`
  - Unit tests for the new composer.
  - Covers TEY-like, hard HTX, WhiteBIT medium, unknown unresolved, and exact approval-drain cases.

- `tests/forensics/moneyOriginAgeSignals.test.ts`
  - Unit tests for wallet age, active days, dormancy, and repeated relationship calculations.

Modify:

- `src/types.ts`
  - Add `WhereIsMoneyAssessment`, `WhereIsMoneyRiskBand`, `WhereIsMoneyWalletRole`, `WhereIsMoneyHardBadEvidence`, `WhereIsMoneyAgeSignals`.
  - Add `assessment: WhereIsMoneyAssessment` to `WhereIsMoneyReport`.

- `src/forensics/moneyOriginTrace.ts`
  - Stop treating `weak_amount_or_time_continuity` as a high risk contributor.
  - Keep it as an incomplete provenance reason.

- `src/forensics/moneyOriginPolicy.ts`
  - Keep hard stop classification for CEX/service boundaries.
  - Keep WhiteBIT as medium source signal.
  - Let unresolved `REVIEW` paths remain internal evidence; final user decision moves to the new assessment layer.

- `src/check/whereIsMoneyCheck.ts`
  - Replace the current `REVIEW -> DECLINE 65` default-deny block with `buildMoneyOriginOperationalAssessment`.
  - Add budgeted approval/contract enrichment selection instead of `selection.transfers.length * 3` for every large wallet.
  - Build wallet-age and relationship-age signals from the same edge cache used by the graph, without adding extra live requests in the first implementation.
  - Populate the new report fields.

- `src/forensics/whereIsMoneyCliArgs.ts`
  - Add optional CLI controls for approval enrichment budget.
  - Keep defaults conservative enough for Telegram.

- `scripts/forensicWhereIsMoney.ts`
  - Print decision, risk band, provenance confidence, coverage completeness, wallet role, hard bad evidence.
  - Pass approval enrichment budget from CLI args.

- `src/bot/createBot.ts`
  - Show the new fields in Telegram `where-is-money` output.
  - Stop displaying internal path `REVIEW` as user-facing `DECLINE` for otherwise operational wallets.

- `tests/check/whereIsMoneyCheck.test.ts`
  - Update existing default-deny expectations.
  - Add integration-style tests for operational wallets and budgeted approval enrichment.

- `tests/bot/createBot.test.ts`
  - Update report formatting snapshots/assertions for the new fields.

- `docs/research/2026-05-29-where-is-money-score-calibration-notes.md`
  - Keep the calibration note aligned with the implemented behavior after code lands.

---

### Task 1: Add Where-Is-Money Assessment Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the new type definitions**

Add these exports near the existing `WhereIsMoneyCoverage` and `WhereIsMoneyReport` types:

```ts
export type WhereIsMoneyRiskBand =
  | "LOW"
  | "LOW-MEDIUM"
  | "MEDIUM"
  | "HIGH"
  | "CRITICAL";

export type WhereIsMoneyWalletRole =
  | "clean_cex_funded_wallet"
  | "operational_liquidity_wallet"
  | "risky_source_wallet"
  | "unknown_wallet";

export type WhereIsMoneyHardBadEvidenceKind =
  | "fast_critical"
  | "approval_drain"
  | "scam_or_blacklist"
  | "htx_huobi_source"
  | "bridge_router_dex_boundary"
  | "unknown_contract_boundary"
  | "llm_contract_suspicion";

export type WhereIsMoneyHardBadEvidence = {
  kind: WhereIsMoneyHardBadEvidenceKind;
  score: number;
  message: string;
  evidenceIds: string[];
};

export type WhereIsMoneyAgeSignal = {
  code:
    | "subject_long_lived"
    | "subject_new_large_wallet"
    | "sender_long_lived"
    | "relationship_repeated"
    | "relationship_new"
    | "dormancy_gap";
  scoreImpact: number;
  message: string;
  value: number | string | null;
  evidenceIds: string[];
};

export type WhereIsMoneyAgeSignals = {
  subjectFirstSeenAt: string | null;
  subjectAgeDays: number | null;
  subjectActiveDays: number;
  directSenderMedianAgeDays: number | null;
  oldestDirectSenderAgeDays: number | null;
  repeatedRelationshipCount: number;
  longestRelationshipAgeDays: number | null;
  maxDormancyGapDays: number | null;
  signals: WhereIsMoneyAgeSignal[];
};

export type WhereIsMoneyAssessment = {
  decision: ExchangeDecision;
  riskScore: number;
  riskBand: WhereIsMoneyRiskBand;
  provenanceConfidence: number;
  coverageCompleteness: number;
  walletRole: WhereIsMoneyWalletRole;
  operationalLiquidityScore: number;
  ageSignals: WhereIsMoneyAgeSignals | null;
  hardBadEvidence: WhereIsMoneyHardBadEvidence[];
  reasons: string[];
  warnings: string[];
};
```

- [ ] **Step 2: Add `assessment` to `WhereIsMoneyReport`**

Update `WhereIsMoneyReport`:

```ts
export type WhereIsMoneyReport = {
  subjectAddress: string;
  currentUsdtBalanceRaw: string | null;
  fastWalletRisk: RiskReport | null;
  balanceFormingTransfers: BalanceFormingTransfer[];
  originPaths: MoneyOriginPath[];
  senderInteractionProfiles: MoneyOriginSenderInteractionProfile[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
  approvalDrainReviewFindings?: ApprovalDrainReviewFinding[];
  contractLlmVerdicts?: ContractLlmVerdictSummary[];
  assessment: WhereIsMoneyAssessment;
  decision: ExchangeDecision;
  userDecision: UserExchangeDecision;
  internalDecision: ExchangeDecision;
  proofLevel: ProofLevel;
  policyReasons?: PolicyReason[];
  riskCaseFile?: RiskCaseFile;
  riskScore: number;
  decisionReasons: string[];
  coverage: WhereIsMoneyCoverage;
};
```

- [ ] **Step 3: Run typecheck and expect current compile errors**

Run:

```bash
npm run typecheck
```

Expected: FAIL because existing `WhereIsMoneyReport` construction sites do not yet provide `assessment`.

---

### Task 2A: Build Wallet Age And Relationship Signals

**Files:**
- Create: `src/forensics/moneyOriginAgeSignals.ts`
- Test: `tests/forensics/moneyOriginAgeSignals.test.ts`

- [ ] **Step 1: Write age-signal tests**

Create `tests/forensics/moneyOriginAgeSignals.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMoneyOriginAgeSignals } from "../../src/forensics/moneyOriginAgeSignals";
import type { BalanceFormingTransfer, ForensicRouteEdge } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const oldSender = "TOldSender11111111111111111111111111";
const newSender = "TNewSender11111111111111111111111111";
const upstream = "TUpstream111111111111111111111111111";

function edge(txHash: string, fromAddress: string, toAddress: string, amountRaw: string, at: string): ForensicRouteEdge {
  return {
    txHash,
    fromAddress,
    toAddress,
    amountRaw,
    tokenAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    timestamp: new Date(at)
  };
}

function transfer(txHash: string, fromAddress: string, amountRaw: string, at: string): BalanceFormingTransfer {
  return {
    txHash,
    fromAddress,
    toAddress: subject,
    amountRaw,
    timestamp: at,
    coverageShare: 0.5,
    selectedReason: "covers_current_balance"
  };
}

describe("buildMoneyOriginAgeSignals", () => {
  it("adds dampeners for long-lived subject, long-lived sender, and repeated relationship", () => {
    const signals = buildMoneyOriginAgeSignals({
      subjectAddress: subject,
      balanceFormingTransfers: [
        transfer("tx-old-relationship-1", oldSender, "100000000000", "2026-05-20T10:00:00.000Z"),
        transfer("tx-old-relationship-2", oldSender, "50000000000", "2026-05-22T10:00:00.000Z")
      ],
      edgesByAddress: new Map([
        [subject, [
          edge("tx-first-subject", "TFirst11111111111111111111111111111", subject, "1000000", "2025-01-01T10:00:00.000Z"),
          edge("tx-old-relationship-1", oldSender, subject, "100000000000", "2026-05-20T10:00:00.000Z"),
          edge("tx-old-relationship-2", oldSender, subject, "50000000000", "2026-05-22T10:00:00.000Z")
        ]],
        [oldSender, [
          edge("tx-first-old-sender", upstream, oldSender, "1000000", "2025-02-01T10:00:00.000Z"),
          edge("tx-old-relationship-1", oldSender, subject, "100000000000", "2026-05-20T10:00:00.000Z"),
          edge("tx-old-relationship-2", oldSender, subject, "50000000000", "2026-05-22T10:00:00.000Z")
        ]]
      ]),
      now: new Date("2026-05-29T00:00:00.000Z"),
      largeBalanceRaw: "225240325624"
    });

    expect(signals.subjectAgeDays).toBeGreaterThan(500);
    expect(signals.subjectActiveDays).toBeGreaterThanOrEqual(3);
    expect(signals.repeatedRelationshipCount).toBe(1);
    expect(signals.signals.map((signal) => signal.code)).toEqual(expect.arrayContaining([
      "subject_long_lived",
      "sender_long_lived",
      "relationship_repeated"
    ]));
    expect(signals.signals.filter((signal) => signal.scoreImpact < 0).length).toBeGreaterThanOrEqual(3);
  });

  it("adds boosters for new large wallets and dormancy gaps", () => {
    const signals = buildMoneyOriginAgeSignals({
      subjectAddress: subject,
      balanceFormingTransfers: [
        transfer("tx-new-large", newSender, "225240325624", "2026-05-28T10:00:00.000Z")
      ],
      edgesByAddress: new Map([
        [subject, [
          edge("tx-old-dust", upstream, subject, "1000000", "2025-01-01T10:00:00.000Z"),
          edge("tx-new-large", newSender, subject, "225240325624", "2026-05-28T10:00:00.000Z")
        ]],
        [newSender, [
          edge("tx-new-large", newSender, subject, "225240325624", "2026-05-28T10:00:00.000Z")
        ]]
      ]),
      now: new Date("2026-05-29T00:00:00.000Z"),
      largeBalanceRaw: "225240325624"
    });

    expect(signals.maxDormancyGapDays).toBeGreaterThan(300);
    expect(signals.signals.map((signal) => signal.code)).toEqual(expect.arrayContaining([
      "relationship_new",
      "dormancy_gap"
    ]));
    expect(signals.signals.some((signal) => signal.scoreImpact > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the age-signal test and verify it fails**

Run:

```bash
npm test -- tests/forensics/moneyOriginAgeSignals.test.ts
```

Expected: FAIL because `moneyOriginAgeSignals.ts` does not exist.

- [ ] **Step 3: Implement age-signal builder**

Create `src/forensics/moneyOriginAgeSignals.ts`:

```ts
import type {
  BalanceFormingTransfer,
  ForensicRouteEdge,
  WhereIsMoneyAgeSignal,
  WhereIsMoneyAgeSignals
} from "../types";

export type BuildMoneyOriginAgeSignalsInput = {
  subjectAddress: string;
  balanceFormingTransfers: BalanceFormingTransfer[];
  edgesByAddress: Map<string, ForensicRouteEdge[]>;
  now: Date;
  largeBalanceRaw: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const LONG_LIVED_DAYS = 180;
const NEW_WALLET_DAYS = 7;
const LARGE_BALANCE_RAW = 50_000n * 1_000_000n;
const DORMANCY_GAP_DAYS = 90;

function parseAmount(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ageDays(firstSeenAt: Date | null, now: Date): number | null {
  if (!firstSeenAt) return null;
  return Math.max(0, Math.floor((now.getTime() - firstSeenAt.getTime()) / DAY_MS));
}

function firstSeen(edges: ForensicRouteEdge[]): Date | null {
  if (edges.length === 0) return null;
  return edges.reduce((min, edge) => edge.timestamp < min ? edge.timestamp : min, edges[0].timestamp);
}

function activeDays(edges: ForensicRouteEdge[]): number {
  return new Set(edges.map((edge) => dayKey(edge.timestamp))).size;
}

function maxDormancyGapDays(edges: ForensicRouteEdge[]): number | null {
  const sorted = [...edges].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  if (sorted.length < 2) return null;
  let maxGap = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = Math.floor((sorted[index].timestamp.getTime() - sorted[index - 1].timestamp.getTime()) / DAY_MS);
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function relationshipEdges(input: BuildMoneyOriginAgeSignalsInput, sender: string): ForensicRouteEdge[] {
  return [
    ...(input.edgesByAddress.get(input.subjectAddress) ?? []),
    ...(input.edgesByAddress.get(sender) ?? [])
  ].filter((edge) => edge.fromAddress === sender && edge.toAddress === input.subjectAddress);
}

export function buildMoneyOriginAgeSignals(input: BuildMoneyOriginAgeSignalsInput): WhereIsMoneyAgeSignals {
  const subjectEdges = input.edgesByAddress.get(input.subjectAddress) ?? [];
  const subjectFirstSeen = firstSeen(subjectEdges);
  const subjectAgeDays = ageDays(subjectFirstSeen, input.now);
  const subjectActiveDays = activeDays(subjectEdges);
  const directSenders = [...new Set(input.balanceFormingTransfers.map((transfer) => transfer.fromAddress))];
  const senderAges = directSenders
    .map((sender) => ageDays(firstSeen(input.edgesByAddress.get(sender) ?? []), input.now))
    .filter((value): value is number => value !== null);
  const relationshipAges: number[] = [];
  let repeatedRelationshipCount = 0;
  const signals: WhereIsMoneyAgeSignal[] = [];

  if (subjectAgeDays !== null && subjectAgeDays >= LONG_LIVED_DAYS && subjectActiveDays >= 3) {
    signals.push({
      code: "subject_long_lived",
      scoreImpact: -6,
      message: `Subject wallet has ${subjectAgeDays} days of observed USDT history across ${subjectActiveDays} active day(s).`,
      value: subjectAgeDays,
      evidenceIds: subjectEdges.slice(0, 5).map((edge) => edge.txHash)
    });
  }

  if (
    subjectAgeDays !== null &&
    subjectAgeDays <= NEW_WALLET_DAYS &&
    parseAmount(input.largeBalanceRaw) >= LARGE_BALANCE_RAW
  ) {
    signals.push({
      code: "subject_new_large_wallet",
      scoreImpact: 12,
      message: `Subject wallet is new in observed USDT history and already holds a large balance.`,
      value: subjectAgeDays,
      evidenceIds: subjectEdges.slice(0, 5).map((edge) => edge.txHash)
    });
  }

  for (const sender of directSenders) {
    const senderEdges = input.edgesByAddress.get(sender) ?? [];
    const senderAge = ageDays(firstSeen(senderEdges), input.now);
    if (senderAge !== null && senderAge >= LONG_LIVED_DAYS) {
      signals.push({
        code: "sender_long_lived",
        scoreImpact: -4,
        message: `Direct sender ${sender} has ${senderAge} days of observed USDT history.`,
        value: senderAge,
        evidenceIds: senderEdges.slice(0, 5).map((edge) => edge.txHash)
      });
    }

    const relations = relationshipEdges(input, sender);
    const relationFirstSeen = firstSeen(relations);
    const relationAge = ageDays(relationFirstSeen, input.now);
    if (relationAge !== null) relationshipAges.push(relationAge);
    if (relations.length >= 2 && relationAge !== null && relationAge >= 2) {
      repeatedRelationshipCount += 1;
      signals.push({
        code: "relationship_repeated",
        scoreImpact: -5,
        message: `Direct sender ${sender} has repeated observed transfers to the checked wallet.`,
        value: relationAge,
        evidenceIds: relations.slice(0, 5).map((edge) => edge.txHash)
      });
    } else if (relations.length === 1 && parseAmount(relations[0].amountRaw) >= LARGE_BALANCE_RAW) {
      signals.push({
        code: "relationship_new",
        scoreImpact: 6,
        message: `Large balance-forming transfer comes from a sender with only one observed relationship edge.`,
        value: relations[0].amountRaw,
        evidenceIds: [relations[0].txHash]
      });
    }
  }

  const dormancy = maxDormancyGapDays(subjectEdges);
  if (dormancy !== null && dormancy >= DORMANCY_GAP_DAYS) {
    signals.push({
      code: "dormancy_gap",
      scoreImpact: 8,
      message: `Subject wallet has a ${dormancy}-day observed USDT dormancy gap before later activity.`,
      value: dormancy,
      evidenceIds: subjectEdges.slice(0, 5).map((edge) => edge.txHash)
    });
  }

  return {
    subjectFirstSeenAt: subjectFirstSeen?.toISOString() ?? null,
    subjectAgeDays,
    subjectActiveDays,
    directSenderMedianAgeDays: median(senderAges),
    oldestDirectSenderAgeDays: senderAges.length > 0 ? Math.max(...senderAges) : null,
    repeatedRelationshipCount,
    longestRelationshipAgeDays: relationshipAges.length > 0 ? Math.max(...relationshipAges) : null,
    maxDormancyGapDays: dormancy,
    signals
  };
}
```

- [ ] **Step 4: Run age-signal tests**

Run:

```bash
npm test -- tests/forensics/moneyOriginAgeSignals.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2A**

Run:

```bash
git add src/types.ts src/forensics/moneyOriginAgeSignals.ts tests/forensics/moneyOriginAgeSignals.test.ts
git commit -m "feat: add where-is-money wallet age signals"
```

---

### Task 2: Build The Operational Assessment Composer

**Files:**
- Create: `src/forensics/moneyOriginOperationalAssessment.ts`
- Test: `tests/forensics/moneyOriginOperationalAssessment.test.ts`

- [ ] **Step 1: Write tests for the new policy behavior**

Create `tests/forensics/moneyOriginOperationalAssessment.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMoneyOriginOperationalAssessment, riskBandFromWhereScore } from "../../src/forensics/moneyOriginOperationalAssessment";
import type {
  MoneyOriginPath,
  MoneyOriginSenderInteractionProfile,
  RiskReport,
  WhereIsMoneyCoverage
} from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const sender = "TSender1111111111111111111111111111111";
const funding = "TFunding111111111111111111111111111111";

function coverage(overrides: Partial<WhereIsMoneyCoverage> = {}): WhereIsMoneyCoverage {
  return {
    selectedInboundTxCount: 2,
    currentBalanceRaw: "225240325624",
    requestedAmountRaw: null,
    targetAmountRaw: "225240325624",
    selectedAmountRaw: "225240325624",
    coverageRatio: 1,
    selectedInboundVolumeRaw: "225240325624",
    currentBalanceCoverageRatio: 1,
    maxDepth: 7,
    fetchedAddressCount: 19,
    partial: true,
    notes: [],
    ...overrides
  };
}

function reviewPath(overrides: Partial<MoneyOriginPath> = {}): MoneyOriginPath {
  return {
    balanceTransferTxHash: "tx-review",
    rootSourceAddress: funding,
    rootSourceType: "incomplete",
    balanceShare: 0.5,
    exposureSourceKey: null,
    exposureSourceLabel: null,
    pathAddresses: [funding, sender, subject],
    txHashes: ["tx-funding", "tx-review"],
    steps: [
      {
        txHash: "tx-funding",
        fromAddress: funding,
        toAddress: sender,
        amountRaw: "100000000000",
        timestamp: "2026-05-22T09:00:00.000Z"
      },
      {
        txHash: "tx-review",
        fromAddress: sender,
        toAddress: subject,
        amountRaw: "100000000000",
        timestamp: "2026-05-22T10:00:00.000Z"
      }
    ],
    amountPreservationRatio: 1,
    timeSpanMs: 60 * 60 * 1000,
    stoppedReason: "weak_amount_or_time_continuity",
    verdict: "REVIEW",
    riskScoreContribution: 30,
    reasons: ["Previous incoming transfers exist, but clean CEX origin is not fully proven."],
    ...overrides
  };
}

function profile(overrides: Partial<MoneyOriginSenderInteractionProfile> = {}): MoneyOriginSenderInteractionProfile {
  return {
    balanceTransferTxHash: "tx-review",
    senderAddress: sender,
    incomingVolumeRaw: "512624000216",
    outgoingVolumeRaw: "507355503200",
    incomingTxCount: 4,
    outgoingTxCount: 5,
    topIncomingCounterparties: [
      {
        address: funding,
        direction: "incoming",
        volumeRaw: "258493000000",
        txCount: 2,
        firstSeen: "2026-05-20T00:00:00.000Z",
        lastSeen: "2026-05-22T09:00:00.000Z",
        txHashes: ["tx-funding"]
      }
    ],
    topOutgoingCounterparties: [
      {
        address: subject,
        direction: "outgoing",
        volumeRaw: "100000000000",
        txCount: 1,
        firstSeen: "2026-05-22T10:00:00.000Z",
        lastSeen: "2026-05-22T10:00:00.000Z",
        txHashes: ["tx-review"]
      }
    ],
    fundingCandidates: [
      {
        txHash: "tx-funding",
        fromAddress: funding,
        toAddress: sender,
        amountRaw: "100000000000",
        timestamp: "2026-05-22T09:00:00.000Z",
        amountPreservationRatio: 1,
        timeDeltaMs: 60 * 60 * 1000
      }
    ],
    ...overrides
  };
}

const lowFastRisk: RiskReport = {
  subjectAddress: subject,
  score: 0,
  level: "LOW",
  reasons: []
};

describe("riskBandFromWhereScore", () => {
  it("uses LOW-MEDIUM for scores close to low but above LOW", () => {
    expect(riskBandFromWhereScore(0)).toBe("LOW");
    expect(riskBandFromWhereScore(32)).toBe("LOW-MEDIUM");
    expect(riskBandFromWhereScore(50)).toBe("MEDIUM");
    expect(riskBandFromWhereScore(65)).toBe("HIGH");
    expect(riskBandFromWhereScore(90)).toBe("CRITICAL");
  });
});

describe("buildMoneyOriginOperationalAssessment", () => {
  it("accepts an operational liquidity wallet when source is not fully proven but no hard bad evidence exists", () => {
    const assessment = buildMoneyOriginOperationalAssessment({
      fastWalletRisk: lowFastRisk,
      originPaths: [
        reviewPath({ balanceShare: 0.45 }),
        reviewPath({ balanceTransferTxHash: "tx-review-2", balanceShare: 0.55 })
      ],
      senderInteractionProfiles: [
        profile(),
        profile({
          balanceTransferTxHash: "tx-review-2",
          incomingVolumeRaw: "1399178000000",
          outgoingVolumeRaw: "1382660771000",
          incomingTxCount: 8,
          outgoingTxCount: 9
        })
      ],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [],
      contractLlmVerdicts: [],
      coverage: coverage()
    });

    expect(assessment.decision).toBe("ACCEPTABLE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(25);
    expect(assessment.riskScore).toBeLessThanOrEqual(40);
    expect(assessment.riskBand).toBe("LOW-MEDIUM");
    expect(assessment.walletRole).toBe("operational_liquidity_wallet");
    expect(assessment.provenanceConfidence).toBeGreaterThanOrEqual(45);
    expect(assessment.hardBadEvidence).toEqual([]);
    expect(assessment.reasons.join(" ")).toContain("operational/liquidity wallet");
  });

  it("declines exact approval-drain evidence regardless of operational pattern", () => {
    const assessment = buildMoneyOriginOperationalAssessment({
      fastWalletRisk: lowFastRisk,
      originPaths: [reviewPath()],
      senderInteractionProfiles: [profile()],
      approvalDrainProvenanceProfiles: [
        {
          subjectAddress: subject,
          victimAddress: "TVictim11111111111111111111111111111",
          spenderAddress: "TSpender1111111111111111111111111111",
          operatorAddress: "TOperator111111111111111111111111111",
          firstReceiverAddress: subject,
          spenderResolution: "wrapper_contract",
          approvalTxHash: "tx-approve",
          drainTxHash: "tx-drain",
          amountRaw: "100000000000",
          allowanceRaw: "100000000000",
          approvalTimestamp: "2026-05-22T09:00:00.000Z",
          drainTimestamp: "2026-05-22T10:00:00.000Z",
          hopDepth: 0,
          pathAddresses: ["TVictim11111111111111111111111111111", subject],
          pathTxHashes: ["tx-drain"],
          evidenceStrength: "exact_approval_and_transfer_from",
          falsePositiveGuards: [],
          supportingFingerprints: [],
          score: 92,
          reasons: ["Exact approve plus transferFrom reaches checked wallet."]
        }
      ],
      approvalDrainReviewFindings: [],
      contractLlmVerdicts: [],
      coverage: coverage()
    });

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(90);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).toContain("approval_drain");
  });

  it("keeps WhiteBIT as medium source signal instead of critical taint", () => {
    const assessment = buildMoneyOriginOperationalAssessment({
      fastWalletRisk: lowFastRisk,
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          exposureSourceKey: "whitebit",
          exposureSourceLabel: "WhiteBIT",
          riskScoreContribution: 45,
          reasons: ["Balance-forming path has WhiteBIT exposure (20% of current balance); this is a medium-risk source signal, not HTX/Huobi high-risk exposure."]
        })
      ],
      senderInteractionProfiles: [profile()],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [],
      contractLlmVerdicts: [],
      coverage: coverage()
    });

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBe(45);
    expect(assessment.riskBand).toBe("MEDIUM");
    expect(assessment.hardBadEvidence).toEqual([]);
  });

  it("declines HTX/Huobi as hard high-risk source evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment({
      fastWalletRisk: lowFastRisk,
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          exposureSourceKey: null,
          exposureSourceLabel: null,
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches HTX; exchange policy treats HTX/Huobi sources as high risk."]
        })
      ],
      senderInteractionProfiles: [profile()],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [],
      contractLlmVerdicts: [],
      coverage: coverage()
    });

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBe(78);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).toContain("htx_huobi_source");
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected: FAIL because `moneyOriginOperationalAssessment.ts` does not exist.

- [ ] **Step 3: Implement the assessment composer**

Create `src/forensics/moneyOriginOperationalAssessment.ts`:

```ts
import type {
  ApprovalDrainProvenanceProfile,
  ContractLlmVerdictSummary,
  ExchangeDecision,
  MoneyOriginPath,
  MoneyOriginSenderInteractionProfile,
  RiskReport,
  WhereIsMoneyAssessment,
  WhereIsMoneyAgeSignals,
  WhereIsMoneyCoverage,
  WhereIsMoneyHardBadEvidence,
  WhereIsMoneyRiskBand,
  WhereIsMoneyWalletRole
} from "../types";

export type BuildMoneyOriginOperationalAssessmentInput = {
  fastWalletRisk: RiskReport | null;
  originPaths: MoneyOriginPath[];
  senderInteractionProfiles: MoneyOriginSenderInteractionProfile[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
  approvalDrainReviewFindings: unknown[];
  contractLlmVerdicts: ContractLlmVerdictSummary[];
  coverage: WhereIsMoneyCoverage;
  ageSignals?: WhereIsMoneyAgeSignals | null;
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseAmount(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

export function riskBandFromWhereScore(score: number): WhereIsMoneyRiskBand {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 45) return "MEDIUM";
  if (score >= 20) return "LOW-MEDIUM";
  return "LOW";
}

function pathShare(path: MoneyOriginPath): number {
  const share = path.balanceShare ?? 0;
  return Number.isFinite(share) && share > 0 ? Math.min(1, share) : 0;
}

function hardEvidenceFromPaths(paths: MoneyOriginPath[]): WhereIsMoneyHardBadEvidence[] {
  const evidence: WhereIsMoneyHardBadEvidence[] = [];
  for (const path of paths) {
    const reasonText = path.reasons.join(" ").toLowerCase();
    if (path.rootSourceType === "risky_label") {
      evidence.push({
        kind: "scam_or_blacklist",
        score: Math.max(path.riskScoreContribution, 90),
        message: path.reasons[0] ?? "Balance-forming path reaches scam/blacklist risk label.",
        evidenceIds: path.txHashes
      });
      continue;
    }
    if (reasonText.includes("htx") || reasonText.includes("huobi")) {
      evidence.push({
        kind: "htx_huobi_source",
        score: Math.max(path.riskScoreContribution, 78),
        message: path.reasons[0] ?? "Balance-forming path reaches HTX/Huobi high-risk source.",
        evidenceIds: path.txHashes
      });
      continue;
    }
    if (
      path.rootSourceType === "decline_boundary" &&
      path.exposureSourceKey !== "whitebit" &&
      /bridge|router|dex|swap|unknown_contract|service boundary/i.test(reasonText)
    ) {
      evidence.push({
        kind: reasonText.includes("unknown_contract") ? "unknown_contract_boundary" : "bridge_router_dex_boundary",
        score: Math.max(path.riskScoreContribution, 65),
        message: path.reasons[0] ?? "Balance-forming path reaches hard service boundary.",
        evidenceIds: path.txHashes
      });
    }
  }
  return evidence;
}

function hardEvidenceFromApprovalDrain(profiles: ApprovalDrainProvenanceProfile[]): WhereIsMoneyHardBadEvidence[] {
  return profiles.map((profile) => ({
    kind: "approval_drain",
    score: Math.max(profile.score, 90),
    message: `Exact approval-drain provenance reaches checked wallet via ${profile.hopDepth} hop(s).`,
    evidenceIds: [profile.approvalTxHash, profile.drainTxHash, ...profile.pathTxHashes]
  }));
}

function hardEvidenceFromFastRisk(report: RiskReport | null): WhereIsMoneyHardBadEvidence[] {
  if (!report || report.score < 85) return [];
  return [{
    kind: "fast_critical",
    score: report.score,
    message: `Fast wallet check has critical score ${report.score}/100.`,
    evidenceIds: report.reasons.map((reason) => reason.code)
  }];
}

function hardEvidenceFromLlm(verdicts: ContractLlmVerdictSummary[]): WhereIsMoneyHardBadEvidence[] {
  return verdicts
    .filter((verdict) =>
      verdict.decisionRecommendation === "DECLINE" &&
      verdict.verdict === "drainer_like" &&
      verdict.confidence >= 0.75
    )
    .map((verdict) => ({
      kind: "llm_contract_suspicion",
      score: Math.max(verdict.contractRiskScore, 75),
      message: `AI contract verdict is drainer_like with ${Math.round(verdict.confidence * 100)}% confidence.`,
      evidenceIds: verdict.citedEvidenceIds
    }));
}

function operationalLiquidityScore(profiles: MoneyOriginSenderInteractionProfile[]): number {
  if (profiles.length === 0) return 0;
  const profileScores = profiles.map((profile) => {
    const incoming = parseAmount(profile.incomingVolumeRaw);
    const outgoing = parseAmount(profile.outgoingVolumeRaw);
    const volumeMax = incoming > outgoing ? incoming : outgoing;
    const volumeMin = incoming < outgoing ? incoming : outgoing;
    const volumeBalance = ratio(volumeMin, volumeMax);
    const activityCount = profile.incomingTxCount + profile.outgoingTxCount;
    const hasTwoSidedFlow = incoming > 0n && outgoing > 0n;
    const activityScore = Math.min(35, activityCount * 5);
    const volumeScore = hasTwoSidedFlow ? Math.min(35, volumeBalance * 35) : 0;
    const counterpartyCount = profile.topIncomingCounterparties.length + profile.topOutgoingCounterparties.length;
    const counterpartyScore = Math.min(20, counterpartyCount * 3);
    const fundingScore = profile.fundingCandidates.length > 0 ? 10 : 0;
    return activityScore + volumeScore + counterpartyScore + fundingScore;
  });
  return clampScore(profileScores.reduce((sum, score) => sum + score, 0) / profileScores.length);
}

function coverageCompleteness(input: BuildMoneyOriginOperationalAssessmentInput): number {
  const balanceCoverage = input.coverage.coverageRatio ?? input.coverage.currentBalanceCoverageRatio;
  const resolvedShare = input.originPaths.reduce((sum, path) =>
    path.verdict === "ACCEPTABLE" || path.verdict === "DECLINE" ? sum + pathShare(path) : sum
  , 0);
  const fetchedBreadth = input.coverage.maxDepth > 0
    ? Math.min(1, input.coverage.fetchedAddressCount / Math.max(1, input.coverage.maxDepth * 3))
    : 0;
  const partialPenalty = input.coverage.partial ? 10 : 0;
  return clampScore(balanceCoverage * 45 + Math.min(1, resolvedShare) * 35 + fetchedBreadth * 20 - partialPenalty);
}

function provenanceConfidence(input: BuildMoneyOriginOperationalAssessmentInput, operationalScore: number): number {
  const cleanShare = input.originPaths.reduce((sum, path) =>
    path.verdict === "ACCEPTABLE" ? sum + pathShare(path) : sum
  , 0);
  const weakShare = input.originPaths.reduce((sum, path) =>
    path.verdict === "REVIEW" ? sum + pathShare(path) : sum
  , 0);
  const averageFundingQuality = input.senderInteractionProfiles.length === 0
    ? 0
    : input.senderInteractionProfiles.reduce((sum, profile) => {
        const best = profile.fundingCandidates[0]?.amountPreservationRatio ?? 0;
        return sum + best;
      }, 0) / input.senderInteractionProfiles.length;
  return clampScore(20 + cleanShare * 55 + averageFundingQuality * 20 + operationalScore * 0.25 - weakShare * 10);
}

function highestPathRisk(paths: MoneyOriginPath[]): number {
  return Math.max(0, ...paths.map((path) => path.riskScoreContribution));
}

function walletRole(input: {
  hardEvidence: WhereIsMoneyHardBadEvidence[];
  originPaths: MoneyOriginPath[];
  operationalScore: number;
}): WhereIsMoneyWalletRole {
  if (input.hardEvidence.length > 0) return "risky_source_wallet";
  if (input.originPaths.length > 0 && input.originPaths.every((path) => path.verdict === "ACCEPTABLE")) {
    return "clean_cex_funded_wallet";
  }
  if (input.operationalScore >= 65) return "operational_liquidity_wallet";
  return "unknown_wallet";
}

function operationalRiskScore(input: {
  provenanceConfidence: number;
  coverageCompleteness: number;
  operationalScore: number;
  highestPathRisk: number;
  ageDampener: number;
}): number {
  const confidencePenalty = Math.max(0, 60 - input.provenanceConfidence) * 0.15;
  const coveragePenalty = Math.max(0, 70 - input.coverageCompleteness) * 0.1;
  const pathContext = Math.min(10, Math.max(0, input.highestPathRisk - 30) * 0.2);
  return clampScore(25 + confidencePenalty + coveragePenalty + pathContext - input.ageDampener);
}

function ageRiskDampener(ageSignals: WhereIsMoneyAgeSignals | null | undefined): number {
  if (!ageSignals) return 0;
  const dampener = ageSignals.signals
    .filter((signal) => signal.scoreImpact < 0)
    .reduce((sum, signal) => sum + Math.abs(signal.scoreImpact), 0);
  const booster = ageSignals.signals
    .filter((signal) => signal.scoreImpact > 0)
    .reduce((sum, signal) => sum + signal.scoreImpact, 0);
  return Math.max(-12, Math.min(15, dampener - booster));
}

export function buildMoneyOriginOperationalAssessment(input: BuildMoneyOriginOperationalAssessmentInput): WhereIsMoneyAssessment {
  const hardBadEvidence = [
    ...hardEvidenceFromFastRisk(input.fastWalletRisk),
    ...hardEvidenceFromApprovalDrain(input.approvalDrainProvenanceProfiles),
    ...hardEvidenceFromPaths(input.originPaths),
    ...hardEvidenceFromLlm(input.contractLlmVerdicts)
  ].sort((left, right) => right.score - left.score);

  const operationalScore = operationalLiquidityScore(input.senderInteractionProfiles);
  const coverageScore = coverageCompleteness(input);
  const provenanceScore = provenanceConfidence(input, operationalScore);
  const role = walletRole({ hardEvidence: hardBadEvidence, originPaths: input.originPaths, operationalScore });
  const topHardEvidence = hardBadEvidence[0] ?? null;
  const ageDampener = ageRiskDampener(input.ageSignals);

  if (topHardEvidence) {
    const riskScore = clampScore(Math.max(topHardEvidence.score, highestPathRisk(input.originPaths)));
    return {
      decision: "DECLINE",
      riskScore,
      riskBand: riskBandFromWhereScore(riskScore),
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      walletRole: role,
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence,
      reasons: [topHardEvidence.message],
      warnings: input.coverage.partial ? ["Coverage is partial; hard evidence still takes priority."] : []
    };
  }

  const whitebitScore = Math.max(
    0,
    ...input.originPaths
      .filter((path) => path.exposureSourceKey === "whitebit")
      .map((path) => path.riskScoreContribution)
  );
  if (whitebitScore > 0) {
    return {
      decision: "DECLINE",
      riskScore: whitebitScore,
      riskBand: riskBandFromWhereScore(whitebitScore),
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      walletRole: "risky_source_wallet",
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence: [],
      reasons: ["Balance-forming path has WhiteBIT exposure; policy treats it as a medium-risk source signal."],
      warnings: ["This is source-policy risk, not direct scam/blacklist proof."]
    };
  }

  if (role === "clean_cex_funded_wallet") {
    const riskScore = Math.max(5, input.fastWalletRisk?.score ?? 0);
    return {
      decision: "ACCEPTABLE",
      riskScore,
      riskBand: riskBandFromWhereScore(riskScore),
      provenanceConfidence: Math.max(provenanceScore, 80),
      coverageCompleteness: coverageScore,
      walletRole: role,
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence: [],
      reasons: ["Balance-forming paths reach allowlisted CEX sources through clean on-chain hops."],
      warnings: []
    };
  }

  if (role === "operational_liquidity_wallet" && (input.fastWalletRisk?.score ?? 0) < 30) {
    const riskScore = Math.min(40, Math.max(25, operationalRiskScore({
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      operationalScore,
      highestPathRisk: highestPathRisk(input.originPaths),
      ageDampener
    })));
    return {
      decision: "ACCEPTABLE",
      riskScore,
      riskBand: riskBandFromWhereScore(riskScore),
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      walletRole: role,
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence: [],
      reasons: ["Clean CEX origin is not fully proven; wallet looks like an operational/liquidity wallet and no hard bad evidence was found."],
      warnings: ["Weak amount/time continuity lowers provenance confidence but does not by itself prove high risk."]
    };
  }

  const unresolvedRisk = clampScore(Math.max(45, highestPathRisk(input.originPaths), input.fastWalletRisk?.score ?? 0));
  return {
    decision: "DECLINE" as ExchangeDecision,
    riskScore: unresolvedRisk,
    riskBand: riskBandFromWhereScore(unresolvedRisk),
    provenanceConfidence: provenanceScore,
    coverageCompleteness: coverageScore,
    walletRole: "unknown_wallet",
    operationalLiquidityScore: operationalScore,
    ageSignals: input.ageSignals ?? null,
    hardBadEvidence: [],
    reasons: ["Clean source could not be proven and the wallet did not match the ordinary operational/liquidity pattern."],
    warnings: input.coverage.partial ? ["Coverage is partial; result is conservative."] : []
  };
}
```

- [ ] **Step 4: Run the new test and verify it passes**

Run:

```bash
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/types.ts src/forensics/moneyOriginOperationalAssessment.ts tests/forensics/moneyOriginOperationalAssessment.test.ts
git commit -m "feat: add where-is-money operational assessment"
```

---

### Task 3: Recalibrate Weak Continuity Path Risk

**Files:**
- Modify: `src/forensics/moneyOriginTrace.ts`
- Test: `tests/forensics/moneyOriginTrace.test.ts`

- [ ] **Step 1: Add or update a money-origin trace test**

In `tests/forensics/moneyOriginTrace.test.ts`, add:

```ts
it("treats weak amount or time continuity as provenance weakness rather than high risk", async () => {
  const path = await traceMoneyOriginPath({
    subjectAddress: subject,
    balanceTransfer: {
      txHash: "tx-subject",
      fromAddress: sender,
      toAddress: subject,
      amountRaw: "100000000",
      timestamp: "2026-05-22T10:00:00.000Z",
      coverageShare: 1,
      selectedReason: "covers_current_balance"
    },
    maxDepth: 7,
    beamWidth: 8,
    maxAddressFetches: 60,
    maxEdgesPerAddress: 40,
    fetchEdgesForAddress: async (address) => address === sender
      ? [edge("tx-small", funding, sender, "10000000", "2026-05-22T09:00:00.000Z")]
      : [],
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async () => ({ category: "none", identity: null, confidence: "low", isBoundary: false, evidence: [] })
  });

  expect(path.stoppedReason).toBe("weak_amount_or_time_continuity");
  expect(path.verdict).toBe("REVIEW");
  expect(path.riskScoreContribution).toBe(30);
  expect(path.reasons[0]).toContain("Clean CEX origin is not fully proven");
});
```

Use existing local helper names in that test file. If the file has different constants, reuse its existing `subject`, `sender`, `funding`, and `edge` helpers instead of duplicating them.

- [ ] **Step 2: Run the trace test and verify it fails**

Run:

```bash
npm test -- tests/forensics/moneyOriginTrace.test.ts
```

Expected: FAIL because weak continuity still contributes `50`.

- [ ] **Step 3: Change incomplete path scoring**

In `src/forensics/moneyOriginTrace.ts`, change `incompletePath`:

```ts
function incompletePath(input: {
  state: TraceState;
  balanceTransferTxHash: string;
  balanceShare: number;
  stoppedReason: MoneyOriginPath["stoppedReason"];
  message: string;
}): MoneyOriginPath {
  const riskScoreContribution = input.stoppedReason === "data_budget_exhausted"
    ? 45
    : input.stoppedReason === "no_previous_transfer"
      ? 35
      : 30;
  return pathFromState({
    state: input.state,
    balanceTransferTxHash: input.balanceTransferTxHash,
    balanceShare: input.balanceShare,
    rootSourceType: "incomplete",
    stoppedReason: input.stoppedReason,
    verdict: "REVIEW",
    riskScoreContribution,
    reasons: [input.message]
  });
}
```

Change the weak continuity message in the `candidates.length === 0` branch:

```ts
message: hasAnyPreviousIncoming
  ? "Previous incoming transfers exist, but clean CEX origin is not fully proven; this lowers provenance confidence and is not direct high-risk evidence."
  : "No previous inbound USDT transfer found before this clean EOA hop; source remains unproven."
```

- [ ] **Step 4: Run trace tests**

Run:

```bash
npm test -- tests/forensics/moneyOriginTrace.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/forensics/moneyOriginTrace.ts tests/forensics/moneyOriginTrace.test.ts
git commit -m "fix: treat weak money continuity as provenance context"
```

---

### Task 4: Wire Assessment Into Where-Is-Money Decision

**Files:**
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add an integration test for TEY-like operational liquidity**

Add this test to `tests/check/whereIsMoneyCheck.test.ts`:

```ts
it("accepts a working liquidity wallet when only weak provenance is unresolved", async () => {
  const senderA = "TMFpCL111111111111111111111111111111";
  const senderB = "TWVNcQ111111111111111111111111111111";
  const funderA = "TGZkfS111111111111111111111111111111";
  const funderB = "TG5EbS111111111111111111111111111111";
  const byAddress = new Map<string, ForensicRouteEdge[]>([
    [subject, [
      edge("tx-a-subject", senderA, subject, "100000000000", "2026-05-22T10:00:00.000Z"),
      edge("tx-b-subject", senderB, subject, "125240325624", "2026-05-22T10:10:00.000Z")
    ]],
    [senderA, [
      edge("tx-a-in-1", funderA, senderA, "100000000000", "2026-05-22T09:00:00.000Z"),
      edge("tx-a-in-2", funderB, senderA, "258493000000", "2026-05-21T09:00:00.000Z"),
      edge("tx-a-out-1", senderA, "TOutA111111111111111111111111111111", "200000000000", "2026-05-22T12:00:00.000Z"),
      edge("tx-a-subject", senderA, subject, "100000000000", "2026-05-22T10:00:00.000Z")
    ]],
    [senderB, [
      edge("tx-b-in-1", funderB, senderB, "350000000000", "2026-05-22T08:00:00.000Z"),
      edge("tx-b-in-2", "TAnother1111111111111111111111111111", senderB, "499900000000", "2026-05-22T08:20:00.000Z"),
      edge("tx-b-out-1", senderB, "TOutB111111111111111111111111111111", "300000000000", "2026-05-22T12:20:00.000Z"),
      edge("tx-b-subject", senderB, subject, "125240325624", "2026-05-22T10:10:00.000Z")
    ]]
  ]);

  const report = await runWhereIsMoneyCheck({
    getTrc20Balance: async () => "225240325624",
    fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
    getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
    getClassificationForAddress: async () => service("none", null),
    getFastWalletRisk: async () => lowFastRisk
  }, {
    sourceAddress: subject,
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z")
  });

  expect(report.decision).toBe("ACCEPTABLE");
  expect(report.userDecision).toBe("ACCEPTABLE");
  expect(report.assessment.walletRole).toBe("operational_liquidity_wallet");
  expect(report.assessment.hardBadEvidence).toEqual([]);
  expect(report.assessment.riskBand).toBe("LOW-MEDIUM");
  expect(report.riskScore).toBeGreaterThanOrEqual(25);
  expect(report.riskScore).toBeLessThanOrEqual(40);
  expect(report.decisionReasons.join(" ")).toContain("operational/liquidity wallet");
});
```

- [ ] **Step 2: Run where-is-money tests and verify failure**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: FAIL because the current code still maps `REVIEW` to `DECLINE 65`.

- [ ] **Step 3: Import and call the new assessment composer**

In `src/check/whereIsMoneyCheck.ts`, add:

```ts
import { buildMoneyOriginAgeSignals } from "../forensics/moneyOriginAgeSignals";
import { buildMoneyOriginOperationalAssessment } from "../forensics/moneyOriginOperationalAssessment";
```

After LLM verdict adjustment and before the final return, replace this block:

```ts
if (decision === "REVIEW") {
  decision = "DECLINE";
  riskScore = Math.max(riskScore, 65);
  decisionReasons = [
    "Clean source could not be proven; exchange policy declines this wallet by safe default.",
    ...decisionReasons
  ];
}
```

with:

```ts
const coverage = {
  selectedInboundTxCount: selection.transfers.length,
  currentBalanceRaw,
  requestedAmountRaw: selection.requestedAmountRaw,
  targetAmountRaw: selection.targetAmountRaw,
  selectedAmountRaw: selection.selectedAmountRaw,
  coverageRatio: selection.coverageRatio,
  selectedInboundVolumeRaw: selection.selectedVolumeRaw,
  currentBalanceCoverageRatio: selection.currentBalanceCoverageRatio,
  maxDepth,
  fetchedAddressCount: fetchedAddresses.size,
  partial: selection.partial || originPaths.some((path) => path.verdict === "REVIEW"),
  notes: [
    selection.selectionMethod === "requested_amount"
      ? "Balance-forming approximation: latest inbound USDT flows sufficient to cover the requested amount."
      : "Balance-forming approximation: latest inbound USDT flows sufficient to explain the current wallet balance.",
    ...selection.notes,
    ...originPaths
      .filter((path) => path.verdict === "REVIEW")
      .map((path) => `${path.balanceTransferTxHash}: ${path.reasons[0]}`)
  ]
};

const ageSignals = buildMoneyOriginAgeSignals({
  subjectAddress: sourceAddress,
  balanceFormingTransfers: selection.transfers,
  edgesByAddress: edgeCache,
  now: input.windowEnd,
  largeBalanceRaw: currentBalanceRaw
});

const assessment = buildMoneyOriginOperationalAssessment({
  fastWalletRisk,
  originPaths,
  senderInteractionProfiles,
  approvalDrainProvenanceProfiles,
  approvalDrainReviewFindings,
  contractLlmVerdicts,
  coverage,
  ageSignals
});

decision = assessment.decision;
riskScore = assessment.riskScore;
decisionReasons = assessment.reasons;
```

Then in the returned object:

```ts
assessment,
decision,
...whereDecisionFields({
  decision,
  decisionReasons,
  approvalDrainProvenanceProfileCount: approvalDrainProvenanceProfiles.length
}),
riskScore,
decisionReasons,
coverage
```

Remove the duplicate inline `coverage: { ... }` object from the return because the `coverage` constant now owns it.

- [ ] **Step 4: Update `fallbackReviewReport`**

In `fallbackReviewReport`, add an assessment object that remains conservative because no balance-forming data exists:

```ts
const assessment: WhereIsMoneyAssessment = {
  decision,
  riskScore: Math.max(65, input.fastWalletRisk?.score ?? 0),
  riskBand: "HIGH",
  provenanceConfidence: 0,
  coverageCompleteness: 0,
  walletRole: "unknown_wallet",
  operationalLiquidityScore: 0,
  ageSignals: null,
  hardBadEvidence: [],
  reasons: decisionReasons,
  warnings: ["No balance-forming transfers were available."]
};
```

Add `assessment` to the returned report and set `riskScore: assessment.riskScore`.

- [ ] **Step 5: Run where-is-money tests**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: Existing assertions that expected default `DECLINE 65` may fail. Update only tests whose risk came solely from weak provenance. Keep HTX, bridge/router/DEX, exact approval-drain, blacklist/scam, LLM drainer-like, and WhiteBIT policy tests as decline cases.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/check/whereIsMoneyCheck.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "feat: compose where-is-money decisions from operational assessment"
```

---

### Task 5: Budget Approval And Contract Enrichment

**Files:**
- Modify: `src/types.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add budget fields to `RunWhereIsMoneyCheckInput`**

Find the `RunWhereIsMoneyCheckInput` type in `src/check/whereIsMoneyCheck.ts` and add:

```ts
  approvalEnrichmentMode?: "off" | "triggered" | "always";
  maxApprovalCandidates?: number;
  maxContractTransactionInfoFetches?: number;
```

Use these defaults near the existing constants:

```ts
const DEFAULT_APPROVAL_ENRICHMENT_MODE: NonNullable<RunWhereIsMoneyCheckInput["approvalEnrichmentMode"]> = "triggered";
const DEFAULT_MAX_APPROVAL_CANDIDATES = 12;
const DEFAULT_MAX_CONTRACT_TRANSACTION_INFO_FETCHES = 12;
```

- [ ] **Step 2: Add a test proving large normal wallets do not fetch transaction-info for every transfer**

In `tests/check/whereIsMoneyCheck.test.ts`, add:

```ts
it("limits approval transaction-info enrichment for large ordinary wallets", async () => {
  const txInfoCalls: string[] = [];
  const transfers = Array.from({ length: 28 }, (_, index) =>
    edge(`tx-subject-${index}`, `TSender${index.toString().padStart(2, "0")}111111111111111111111`, subject, "50000000000", `2026-05-22T10:${String(index).padStart(2, "0")}:00.000Z`)
  );
  const byAddress = new Map<string, ForensicRouteEdge[]>([
    [subject, transfers],
    ...transfers.map((transfer, index): [string, ForensicRouteEdge[]] => [
      transfer.fromAddress,
      [
        edge(`tx-funding-${index}`, `TFunder${index.toString().padStart(2, "0")}111111111111111111111`, transfer.fromAddress, "50000000000", `2026-05-22T09:${String(index).padStart(2, "0")}:00.000Z`),
        transfer
      ]
    ])
  ]);

  const report = await runWhereIsMoneyCheck({
    getTrc20Balance: async () => "1400000000000",
    fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
    getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
    getClassificationForAddress: async () => service("none", null),
    getFastWalletRisk: async () => lowFastRisk,
    getTransaction: async (txHash) => {
      txInfoCalls.push(txHash);
      return {};
    },
    listTrc20ApprovalChanges: async () => []
  }, {
    sourceAddress: subject,
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z"),
    maxApprovalCandidates: 5,
    maxContractTransactionInfoFetches: 5
  });

  expect(txInfoCalls.length).toBeLessThanOrEqual(5);
  expect(report.coverage.notes.join(" ")).toContain("Approval/contract enrichment budget");
});
```

- [ ] **Step 3: Implement budgeted candidate selection**

In `src/check/whereIsMoneyCheck.ts`, add this helper before `runWhereIsMoneyCheck`:

```ts
function selectApprovalEnrichmentEdges(input: {
  edges: ForensicRouteEdge[];
  originPaths: MoneyOriginPath[];
  maxCandidates: number;
  mode: "off" | "triggered" | "always";
}): ForensicRouteEdge[] {
  if (input.mode === "off" || input.maxCandidates <= 0) return [];
  const byHash = new Map(input.edges.map((edge) => [edge.txHash, edge]));
  const importantHashes = new Set<string>();
  for (const path of input.originPaths) {
    if (
      input.mode === "always" ||
      path.verdict === "DECLINE" ||
      path.stoppedReason === "unlabeled_service_boundary" ||
      path.rootSourceType === "decline_boundary"
    ) {
      for (const txHash of path.txHashes) importantHashes.add(txHash);
    }
  }
  const important = [...importantHashes]
    .map((txHash) => byHash.get(txHash))
    .filter((edge): edge is ForensicRouteEdge => Boolean(edge));
  const fallback = input.mode === "always"
    ? input.edges.filter((edge) => !importantHashes.has(edge.txHash)).sort(compareApprovalDrainCandidateAmountDesc)
    : [];
  return dedupeEdges([...important, ...fallback]).slice(0, input.maxCandidates);
}
```

Then change approval enrichment:

```ts
const approvalMode = input.approvalEnrichmentMode ?? DEFAULT_APPROVAL_ENRICHMENT_MODE;
const maxApprovalCandidates = input.maxApprovalCandidates ?? DEFAULT_MAX_APPROVAL_CANDIDATES;
const maxTxInfoFetches = input.maxContractTransactionInfoFetches ?? DEFAULT_MAX_CONTRACT_TRANSACTION_INFO_FETCHES;
const approvalEdges = selectApprovalEnrichmentEdges({
  edges: dedupeEdges([...edgeCache.values()].flat()),
  originPaths,
  maxCandidates: maxApprovalCandidates,
  mode: approvalMode
});
```

Pass `approvalEdges` to both `buildApprovalDrainContractProfiles` and `buildApprovalDrainProvenanceAnalysis`.

Use `Math.min(maxApprovalCandidates, maxTxInfoFetches)` for `buildApprovalDrainContractProfiles.maxCandidates`.

After enrichment, if `approvalEdges.length < dedupeEdges([...edgeCache.values()].flat()).length`, push a coverage note:

```ts
const approvalBudgetNote = approvalMode === "off"
  ? "Approval/contract enrichment disabled for this run."
  : approvalEdges.length > 0
    ? `Approval/contract enrichment budget: checked ${approvalEdges.length} candidate edge(s).`
    : "Approval/contract enrichment skipped because no contract/service trigger was found.";
```

Include `approvalBudgetNote` in `coverage.notes`.

- [ ] **Step 4: Run where-is-money tests**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: PASS after adjusting the new coverage note expectations.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add src/check/whereIsMoneyCheck.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "fix: budget where-is-money approval enrichment"
```

---

### Task 6: Add CLI Controls And Report The New Metrics

**Files:**
- Modify: `src/forensics/whereIsMoneyCliArgs.ts`
- Modify: `scripts/forensicWhereIsMoney.ts`
- Test: `tests/forensics/whereIsMoneyCliArgs.test.ts`

- [ ] **Step 1: Extend CLI args tests**

In `tests/forensics/whereIsMoneyCliArgs.test.ts`, add:

```ts
it("parses approval enrichment controls", () => {
  const parsed = parseWhereIsMoneyCliArgs([
    "--source", "TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf",
    "--approval-mode", "always",
    "--approval-candidates", "40",
    "--contract-tx-info", "25"
  ]);

  expect(parsed.approvalEnrichmentMode).toBe("always");
  expect(parsed.maxApprovalCandidates).toBe(40);
  expect(parsed.maxContractTransactionInfoFetches).toBe(25);
});
```

- [ ] **Step 2: Update parser type and usage**

In `src/forensics/whereIsMoneyCliArgs.ts`, extend `ParsedWhereIsMoneyCliArgs`:

```ts
  approvalEnrichmentMode: "off" | "triggered" | "always";
  maxApprovalCandidates: number;
  maxContractTransactionInfoFetches: number;
```

Add constants:

```ts
export const WHERE_IS_MONEY_DEFAULT_APPROVAL_ENRICHMENT_MODE = "triggered" as const;
export const WHERE_IS_MONEY_DEFAULT_MAX_APPROVAL_CANDIDATES = 12;
export const WHERE_IS_MONEY_MAX_APPROVAL_CANDIDATES = 100;
export const WHERE_IS_MONEY_DEFAULT_MAX_CONTRACT_TX_INFO = 12;
export const WHERE_IS_MONEY_MAX_CONTRACT_TX_INFO = 100;
```

Add flags to `VALUE_FLAGS`:

```ts
"--approval-mode",
"--approval-candidates",
"--contract-tx-info"
```

Add parser:

```ts
function parseApprovalMode(args: readonly string[]): "off" | "triggered" | "always" {
  const value = argValue(args, "--approval-mode");
  if (value === undefined) return WHERE_IS_MONEY_DEFAULT_APPROVAL_ENRICHMENT_MODE;
  if (value === "off" || value === "triggered" || value === "always") return value;
  throw new Error(`--approval-mode must be off, triggered, or always.\n${WHERE_IS_MONEY_USAGE}`);
}
```

Return parsed values:

```ts
approvalEnrichmentMode: parseApprovalMode(args),
maxApprovalCandidates: parseIntegerInRange({
  args,
  name: "--approval-candidates",
  fallback: WHERE_IS_MONEY_DEFAULT_MAX_APPROVAL_CANDIDATES,
  min: 0,
  max: WHERE_IS_MONEY_MAX_APPROVAL_CANDIDATES
}),
maxContractTransactionInfoFetches: parseIntegerInRange({
  args,
  name: "--contract-tx-info",
  fallback: WHERE_IS_MONEY_DEFAULT_MAX_CONTRACT_TX_INFO,
  min: 0,
  max: WHERE_IS_MONEY_MAX_CONTRACT_TX_INFO
})
```

- [ ] **Step 3: Pass args to `runWhereIsMoneyCheck`**

In `scripts/forensicWhereIsMoney.ts`, add to the input object:

```ts
approvalEnrichmentMode: args.approvalEnrichmentMode,
maxApprovalCandidates: args.maxApprovalCandidates,
maxContractTransactionInfoFetches: args.maxContractTransactionInfoFetches
```

- [ ] **Step 4: Print the new assessment fields**

In `scripts/forensicWhereIsMoney.ts`, after the existing risk line, print:

```ts
console.log(`Risk band: ${report.assessment.riskBand}`);
console.log(`Provenance confidence: ${report.assessment.provenanceConfidence}/100`);
console.log(`Coverage completeness: ${report.assessment.coverageCompleteness}/100`);
console.log(`Wallet role: ${report.assessment.walletRole}`);
console.log(`Operational liquidity score: ${report.assessment.operationalLiquidityScore}/100`);
console.log(`Wallet age: ${report.assessment.ageSignals?.subjectAgeDays ?? "unknown"} observed day(s)`);
console.log(`Repeated sender relationships: ${report.assessment.ageSignals?.repeatedRelationshipCount ?? 0}`);
console.log(`Hard bad evidence: ${report.assessment.hardBadEvidence.length === 0 ? "none" : report.assessment.hardBadEvidence.map((item) => item.kind).join(", ")}`);
```

- [ ] **Step 5: Run parser tests**

Run:

```bash
npm test -- tests/forensics/whereIsMoneyCliArgs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add src/forensics/whereIsMoneyCliArgs.ts scripts/forensicWhereIsMoney.ts tests/forensics/whereIsMoneyCliArgs.test.ts
git commit -m "feat: expose where-is-money completeness controls"
```

---

### Task 7: Update Telegram Where-Is-Money Output

**Files:**
- Modify: `src/bot/createBot.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add bot formatting expectation**

In the existing where-is-money report formatting tests in `tests/bot/createBot.test.ts`, add an accepted operational report fixture or update one existing fixture so it includes:

```ts
assessment: {
  decision: "ACCEPTABLE",
  riskScore: 32,
  riskBand: "LOW-MEDIUM",
  provenanceConfidence: 58,
  coverageCompleteness: 72,
  walletRole: "operational_liquidity_wallet",
  operationalLiquidityScore: 76,
  ageSignals: {
    subjectFirstSeenAt: "2025-01-01T10:00:00.000Z",
    subjectAgeDays: 513,
    subjectActiveDays: 12,
    directSenderMedianAgeDays: 480,
    oldestDirectSenderAgeDays: 500,
    repeatedRelationshipCount: 2,
    longestRelationshipAgeDays: 30,
    maxDormancyGapDays: null,
    signals: [
      {
        code: "subject_long_lived",
        scoreImpact: -6,
        message: "Subject wallet has long-lived observed USDT history.",
        value: 513,
        evidenceIds: ["tx-first-subject"]
      }
    ]
  },
  hardBadEvidence: [],
  reasons: ["Clean CEX origin is not fully proven; wallet looks like an operational/liquidity wallet and no hard bad evidence was found."],
  warnings: ["Weak amount/time continuity lowers provenance confidence but does not by itself prove high risk."]
}
```

Assert the rendered plain text contains:

```ts
expect(text).toContain("Decision: ACCEPTABLE");
expect(text).toContain("Risk: 32/100");
expect(text).toContain("LOW-MEDIUM");
expect(text).toContain("Provenance confidence: 58/100");
expect(text).toContain("Coverage completeness: 72/100");
expect(text).toContain("Wallet role: operational_liquidity_wallet");
expect(text).toContain("Wallet age: 513 days observed");
expect(text).toContain("Repeated sender relationships: 2");
expect(text).toContain("Hard bad evidence: none");
```

- [ ] **Step 2: Update formatter**

In `src/bot/createBot.ts`, add a helper near `whereRiskReport`:

```ts
function whereAssessmentLines(report: WhereIsMoneyReport): string[] {
  const hardBadEvidence = report.assessment.hardBadEvidence.length === 0
    ? "none"
    : report.assessment.hardBadEvidence.map((item) => item.kind).join(", ");
  return [
    `Risk band: ${report.assessment.riskBand}`,
    `Provenance confidence: ${report.assessment.provenanceConfidence}/100`,
    `Coverage completeness: ${report.assessment.coverageCompleteness}/100`,
    `Wallet role: ${report.assessment.walletRole}`,
    `Operational liquidity score: ${report.assessment.operationalLiquidityScore}/100`,
    report.assessment.ageSignals?.subjectAgeDays !== null && report.assessment.ageSignals?.subjectAgeDays !== undefined
      ? `Wallet age: ${report.assessment.ageSignals.subjectAgeDays} days observed`
      : "Wallet age: unknown",
    report.assessment.ageSignals?.repeatedRelationshipCount
      ? `Repeated sender relationships: ${report.assessment.ageSignals.repeatedRelationshipCount}`
      : "Repeated sender relationships: none observed",
    `Hard bad evidence: ${hardBadEvidence}`
  ];
}
```

In `formatWhereIsMoneyReport`, after the risk line, add:

```ts
bold("Assessment"),
bulletList(whereAssessmentLines(report)),
```

Change `whereOriginPathLines` so path-level `REVIEW` stays internal and does not render as `DECLINE`:

```ts
`${index + 1}. ${path.verdict}`
```

instead of:

```ts
`${index + 1}. ${userFacingWhereDecision(path.verdict)}`
```

- [ ] **Step 3: Run bot tests**

Run:

```bash
npm test -- tests/bot/createBot.test.ts
```

Expected: PASS after adding `assessment` to existing `WhereIsMoneyReport` fixtures.

- [ ] **Step 4: Commit Task 7**

Run:

```bash
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: show where-is-money provenance quality in telegram"
```

---

### Task 8: Regression Tests For Ordinary Working Wallet Patterns

**Files:**
- Modify: `tests/check/forensicRegressionCases.test.ts`
- Modify: `tests/fixtures/forensics/regressionCases.ts`
- Test: `tests/check/forensicRegressionCases.test.ts`

- [ ] **Step 1: Add synthetic regression cases**

In `tests/fixtures/forensics/regressionCases.ts`, add three synthetic cases based on the observed shape of TEY, TVz, and TTs without depending on live TronScan:

```ts
export const operationalLiquidityWhereIsMoneyCases = [
  {
    name: "tey_like_two_sender_operational_wallet",
    expectedDecision: "ACCEPTABLE",
    expectedRiskBand: "LOW-MEDIUM",
    expectedWalletRole: "operational_liquidity_wallet"
  },
  {
    name: "tvz_like_multi_sender_operational_wallet",
    expectedDecision: "ACCEPTABLE",
    expectedRiskBand: "LOW-MEDIUM",
    expectedWalletRole: "operational_liquidity_wallet"
  },
  {
    name: "tts_like_large_many_sender_partial_operational_wallet",
    expectedDecision: "ACCEPTABLE",
    expectedRiskBand: "LOW-MEDIUM",
    expectedWalletRole: "operational_liquidity_wallet"
  }
] as const;
```

If this fixture file already has a stricter schema, add these fields to the existing schema instead of exporting a separate array.

- [ ] **Step 2: Add regression assertions**

In `tests/check/forensicRegressionCases.test.ts`, add tests that build reports through `runWhereIsMoneyCheck` using local fixture edges:

```ts
it("keeps ordinary working wallets acceptable when hard bad evidence is absent", async () => {
  for (const caseItem of operationalLiquidityWhereIsMoneyCases) {
    const report = await runWhereIsMoneyCheck(caseItem.deps, caseItem.input);
    expect(report.userDecision).toBe(caseItem.expectedDecision);
    expect(report.assessment.riskBand).toBe(caseItem.expectedRiskBand);
    expect(report.assessment.walletRole).toBe(caseItem.expectedWalletRole);
    expect(report.assessment.hardBadEvidence).toEqual([]);
  }
});
```

Use the existing regression fixture style in the file. If the file uses one exported fixture list, add these cases there with enough local edge data to execute offline.

- [ ] **Step 3: Run regression tests**

Run:

```bash
npm test -- tests/check/forensicRegressionCases.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit Task 8**

Run:

```bash
git add tests/check/forensicRegressionCases.test.ts tests/fixtures/forensics/regressionCases.ts
git commit -m "test: cover ordinary liquidity wallet calibration"
```

---

### Task 9: Final Verification And Live Smoke

**Files:**
- No planned source changes unless tests reveal a defect.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/forensics/moneyOriginAgeSignals.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/forensics/moneyOriginTrace.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/whereIsMoneyCliArgs.test.ts tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Live smoke ordinary wallet with slower/full settings**

Run TEY with a broader but bounded check:

```bash
npm run forensic:where-is-money -- -- --source TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM --days 30 --depth 7 --beam 8 --max-addresses 60 --max-edges 100 --approval-mode triggered --approval-candidates 30 --contract-tx-info 20
```

Expected:

- `Decision: ACCEPTABLE`
- `Risk band: LOW-MEDIUM`
- `Wallet role: operational_liquidity_wallet`
- `Hard bad evidence: none`
- `Provenance confidence` visible and not confused with risk.
- `Wallet age` and repeated sender relationship signals visible when enough historical edges are available.

- [ ] **Step 5: Live smoke historical high-risk wallet**

Run:

```bash
npm run forensic:where-is-money -- -- --source TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf --days 30 --depth 7 --beam 8 --max-addresses 60 --max-edges 100 --approval-mode triggered --approval-candidates 30 --contract-tx-info 20
```

Expected:

- WhiteBIT/HTX/approval-drain behavior remains visible if still present in current data/cache.
- A hard source boundary still returns `DECLINE`.
- Report includes assessment fields.

- [ ] **Step 6: Telegram smoke**

Run the bot locally, then send:

```text
/check TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM
```

Expected:

- Fast result arrives first.
- `Where is money` result arrives after.
- Message includes `Assessment`, `Provenance confidence`, `Coverage completeness`, `Wallet role`, and `Hard bad evidence`.
- Message includes wallet age and repeated sender relationship lines.
- No user-facing `REVIEW` decision.

- [ ] **Step 7: Commit any verification fixes**

Only if source/test/docs changed during verification:

```bash
git add <changed-files>
git commit -m "fix: stabilize where-is-money operational calibration"
```

---

## Implementation Notes

- Do not remove hard evidence behavior. Exact approval-drain, blacklist/scam, HTX/Huobi, and bridge/router/DEX/unknown-contract boundary rules must stay stronger than the operational wallet classifier.
- WhiteBIT remains a medium policy source signal. It can still decline by policy, but it should not be described as direct scam/blacklist proof.
- Weak amount/time continuity is not high risk by itself. It lowers provenance confidence.
- More graph breadth should be weighted toward the strongest balance-forming senders. Do not expand every small dust input equally.
- Approval/contract enrichment must be budgeted. Large wallets should not spend 15 minutes on transaction-info calls before returning a report.
- Keep the user UX binary: `ACCEPTABLE` or `DECLINE`. Store uncertainty in `provenanceConfidence`, `coverageCompleteness`, and `warnings`.
- Wallet age is a dampener, not proof of clean funds. It should reduce risk only together with long-lived activity, repeated relationships, and no hard bad evidence. New large wallets and long dormancy gaps should increase caution.

## Self-Review

- Spec coverage: The plan covers score recalibration, ordinary working wallet handling, wallet-age/relationship-age dampeners, separate provenance/coverage metrics, expanded but weighted graph thinking, Telegram/CLI output, and timeout-prone approval enrichment.
- Placeholder scan: No task relies on vague placeholder wording; each task has concrete files, code snippets, commands, and expected outcomes.
- Type consistency: The new `WhereIsMoneyAssessment` and `WhereIsMoneyAgeSignals` types are added first, then used by age-signal builder, composer, `runWhereIsMoneyCheck`, CLI, and Telegram formatter.
