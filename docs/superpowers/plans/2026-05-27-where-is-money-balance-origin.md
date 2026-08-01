# Where Is Money Balance-Origin Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `Where is money?` research mode that explains the current TRON USDT balance through recent balance-forming inflows and returns an exchange decision: `ACCEPTABLE`, `REVIEW`, or `DECLINE`.

**Architecture:** Add a separate balance-origin layer instead of expanding the existing deep forensic check. Implement pure modules for balance-forming transfer selection, money-origin policy, bounded backward tracing, then compose them in `runWhereIsMoneyCheck` and expose an offline CLI.

**Tech Stack:** TypeScript, Node.js, Vitest, TRON USDT indexed transfers, existing `TronscanClient`, `classifyServiceAddress`, `evaluateAddressRisk`, and local repository helpers.

---

## File Structure

Create:

- `src/forensics/balanceFormingTransfers.ts`
  - Selects recent inbound transfers that approximately explain the current USDT balance.
  - Contains no network, DB, label, or risk-policy logic.

- `src/forensics/moneyOriginPolicy.ts`
  - Classifies a trace stop as allowlisted CEX, decline boundary, risky label, generic review, or clean EOA continuation.
  - Owns allowlist CEX names and decline-source policy for bridge/router/DEX/HTX/Huobi/WhiteBIT.

- `src/forensics/moneyOriginTrace.ts`
  - Runs bounded backward tracing for one balance-forming transfer.
  - Fetches candidate incoming edges per address through a dependency.
  - Uses `moneyOriginPolicy.ts` to stop and score paths.

- `src/check/whereIsMoneyCheck.ts`
  - Orchestrates balance lookup, fast wallet risk, balance-forming selection, path tracing, and final report composition.

- `src/forensics/whereIsMoneyCliArgs.ts`
  - Parses CLI options for the offline report.

- `scripts/forensicWhereIsMoney.ts`
  - Runs the mode from indexed TRON USDT transfers and live USDT balance lookup.

Modify:

- `src/types.ts`
  - Adds shared report, selection, and path types.

- `package.json`
  - Adds `forensic:where-is-money`.

Test:

- `tests/forensics/balanceFormingTransfers.test.ts`
- `tests/forensics/moneyOriginPolicy.test.ts`
- `tests/forensics/moneyOriginTrace.test.ts`
- `tests/check/whereIsMoneyCheck.test.ts`
- `tests/forensics/whereIsMoneyCliArgs.test.ts`

Out of scope for this plan:

- Telegram command wiring.
- DB migrations.
- Provider live label lookups.

---

### Task 1: Balance-Forming Transfer Selection

**Files:**
- Create: `src/forensics/balanceFormingTransfers.ts`
- Modify: `src/types.ts`
- Test: `tests/forensics/balanceFormingTransfers.test.ts`

- [ ] **Step 1: Write the failing selector tests**

Create `tests/forensics/balanceFormingTransfers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectBalanceFormingTransfers } from "../../src/forensics/balanceFormingTransfers";
import type { ForensicRouteEdge } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const oldSender = "TOldSender11111111111111111111111111";
const senderA = "TSenderA111111111111111111111111111";
const senderB = "TSenderB111111111111111111111111111";
const senderC = "TSenderC111111111111111111111111111";
const outbound = "TOutbound111111111111111111111111111";

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

describe("selectBalanceFormingTransfers", () => {
  it("selects newest inbound transfers until they explain the current balance", () => {
    const result = selectBalanceFormingTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "5000000000",
      edges: [
        edge("tx-old", oldSender, subject, "10000000000", "2026-05-20T10:00:00.000Z"),
        edge("tx-outbound", subject, outbound, "900000000", "2026-05-22T09:00:00.000Z"),
        edge("tx-a", senderA, subject, "2000000000", "2026-05-22T10:00:00.000Z"),
        edge("tx-b", senderB, subject, "2000000000", "2026-05-22T10:05:00.000Z"),
        edge("tx-c", senderC, subject, "1000000000", "2026-05-22T10:10:00.000Z")
      ]
    });

    expect(result.transfers.map((transfer) => transfer.txHash)).toEqual(["tx-c", "tx-b", "tx-a"]);
    expect(result.selectedVolumeRaw).toBe("5000000000");
    expect(result.currentBalanceCoverageRatio).toBe(1);
    expect(result.partial).toBe(false);
    expect(result.transfers).toEqual([
      expect.objectContaining({
        txHash: "tx-c",
        fromAddress: senderC,
        toAddress: subject,
        amountRaw: "1000000000",
        coverageShare: 0.2,
        selectedReason: "covers_current_balance"
      }),
      expect.objectContaining({ txHash: "tx-b", coverageShare: 0.4 }),
      expect.objectContaining({ txHash: "tx-a", coverageShare: 0.4 })
    ]);
  });

  it("marks selection partial when indexed inbound volume cannot explain the balance", () => {
    const result = selectBalanceFormingTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "5000000000",
      edges: [
        edge("tx-a", senderA, subject, "2000000000", "2026-05-22T10:00:00.000Z"),
        edge("tx-b", senderB, subject, "1000000000", "2026-05-22T10:05:00.000Z")
      ]
    });

    expect(result.transfers.map((transfer) => transfer.txHash)).toEqual(["tx-b", "tx-a"]);
    expect(result.selectedVolumeRaw).toBe("3000000000");
    expect(result.currentBalanceCoverageRatio).toBe(0.6);
    expect(result.partial).toBe(true);
    expect(result.notes).toEqual([
      "Selected inbound USDT transfers cover 60% of the current balance; balance-origin coverage is partial."
    ]);
  });

  it("returns an incomplete empty selection for zero or missing balance", () => {
    const result = selectBalanceFormingTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [
        edge("tx-a", senderA, subject, "2000000000", "2026-05-22T10:00:00.000Z")
      ]
    });

    expect(result.transfers).toEqual([]);
    expect(result.selectedVolumeRaw).toBe("0");
    expect(result.currentBalanceCoverageRatio).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.notes).toEqual(["Current USDT balance is zero or unavailable; balance-origin trace cannot prove source funds."]);
  });
});
```

- [ ] **Step 2: Run the selector tests RED**

Run:

```bash
npm test -- tests/forensics/balanceFormingTransfers.test.ts
```

Expected: FAIL with a module resolution error for `../../src/forensics/balanceFormingTransfers`.

- [ ] **Step 3: Add shared balance-forming types**

Modify `src/types.ts` after `IndexedTronUsdtApproval`:

```ts
export type ExchangeDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE";

export type BalanceFormingTransfer = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  coverageShare: number;
  selectedReason: "covers_current_balance";
};

export type BalanceFormingSelection = {
  transfers: BalanceFormingTransfer[];
  selectedVolumeRaw: string;
  currentBalanceCoverageRatio: number;
  partial: boolean;
  notes: string[];
};
```

- [ ] **Step 4: Implement the selector**

Create `src/forensics/balanceFormingTransfers.ts`:

```ts
import type { BalanceFormingSelection, BalanceFormingTransfer, ForensicRouteEdge } from "../types";

export type SelectBalanceFormingTransfersInput = {
  subjectAddress: string;
  currentBalanceRaw: string | null;
  edges: ForensicRouteEdge[];
  minCoverageRatio?: number;
};

const DEFAULT_MIN_COVERAGE_RATIO = 0.95;

function parseAmount(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function compareNewestFirst(left: ForensicRouteEdge, right: ForensicRouteEdge): number {
  const time = right.timestamp.getTime() - left.timestamp.getTime();
  if (time !== 0) return time;
  return right.txHash.localeCompare(left.txHash);
}

function selectionTransfer(edge: ForensicRouteEdge, currentBalanceRaw: bigint): BalanceFormingTransfer {
  return {
    txHash: edge.txHash,
    fromAddress: edge.fromAddress,
    toAddress: edge.toAddress,
    amountRaw: edge.amountRaw,
    timestamp: edge.timestamp.toISOString(),
    coverageShare: ratio(parseAmount(edge.amountRaw), currentBalanceRaw),
    selectedReason: "covers_current_balance"
  };
}

export function selectBalanceFormingTransfers(input: SelectBalanceFormingTransfersInput): BalanceFormingSelection {
  const currentBalanceRaw = parseAmount(input.currentBalanceRaw);
  if (currentBalanceRaw <= 0n) {
    return {
      transfers: [],
      selectedVolumeRaw: "0",
      currentBalanceCoverageRatio: 0,
      partial: true,
      notes: ["Current USDT balance is zero or unavailable; balance-origin trace cannot prove source funds."]
    };
  }

  const selected: ForensicRouteEdge[] = [];
  let selectedVolumeRaw = 0n;
  const inbound = input.edges
    .filter((edge) => edge.toAddress === input.subjectAddress)
    .filter((edge) => parseAmount(edge.amountRaw) > 0n)
    .sort(compareNewestFirst);

  for (const edge of inbound) {
    if (selectedVolumeRaw >= currentBalanceRaw) break;
    selected.push(edge);
    selectedVolumeRaw += parseAmount(edge.amountRaw);
  }

  const coverageRatio = Math.min(1, ratio(selectedVolumeRaw, currentBalanceRaw));
  const minCoverageRatio = input.minCoverageRatio ?? DEFAULT_MIN_COVERAGE_RATIO;
  const partial = coverageRatio < minCoverageRatio;
  const notes = partial
    ? [`Selected inbound USDT transfers cover ${Math.round(coverageRatio * 100)}% of the current balance; balance-origin coverage is partial.`]
    : [];

  return {
    transfers: selected.map((edge) => selectionTransfer(edge, currentBalanceRaw)),
    selectedVolumeRaw: selectedVolumeRaw.toString(),
    currentBalanceCoverageRatio: coverageRatio,
    partial,
    notes
  };
}
```

- [ ] **Step 5: Run selector tests GREEN**

Run:

```bash
npm test -- tests/forensics/balanceFormingTransfers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit selector**

Run:

```bash
git add src/types.ts src/forensics/balanceFormingTransfers.ts tests/forensics/balanceFormingTransfers.test.ts
git commit -m "feat: select balance-forming USDT transfers"
```

Expected: commit succeeds.

---

### Task 2: Money-Origin Source Policy

**Files:**
- Create: `src/forensics/moneyOriginPolicy.ts`
- Modify: `src/types.ts`
- Test: `tests/forensics/moneyOriginPolicy.test.ts`

- [ ] **Step 1: Write the failing policy tests**

Create `tests/forensics/moneyOriginPolicy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyMoneyOriginStop, combineMoneyOriginDecision, riskLevelFromMoneyOriginScore } from "../../src/forensics/moneyOriginPolicy";
import type { AddressLabel, MoneyOriginPath, ServiceClassification } from "../../src/types";

const address = "TAddress11111111111111111111111111111";

function label(labelValue: AddressLabel["label"]): AddressLabel {
  return {
    address,
    label: labelValue,
    source: "service_admin",
    createdByTelegramId: "1",
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

function service(category: ServiceClassification["category"], identity: string | null): ServiceClassification {
  return {
    category,
    identity,
    confidence: "high",
    evidence: identity ? [`tag:${identity}`] : [],
    isBoundary: category !== "none"
  };
}

function path(verdict: MoneyOriginPath["verdict"], score: number, txHash: string): MoneyOriginPath {
  return {
    balanceTransferTxHash: txHash,
    rootSourceAddress: address,
    rootSourceType: verdict === "ACCEPTABLE" ? "allowlist_cex" : verdict === "DECLINE" ? "decline_boundary" : "incomplete",
    pathAddresses: [address, "TSubject111111111111111111111111111111"],
    txHashes: [txHash],
    amountPreservationRatio: 1,
    timeSpanMs: 0,
    stoppedReason: verdict === "ACCEPTABLE" ? "allowlist_cex_reached" : "data_budget_exhausted",
    verdict,
    riskScoreContribution: score,
    reasons: [`${verdict} fixture`]
  };
}

describe("money origin policy", () => {
  it("accepts allowlisted CEX roots", () => {
    const result = classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("cex", "Binance Hot Wallet"),
      balanceShare: 1
    });

    expect(result).toEqual({
      verdict: "ACCEPTABLE",
      rootSourceType: "allowlist_cex",
      stoppedReason: "allowlist_cex_reached",
      riskScoreContribution: 5,
      reasons: ["Balance-forming path reaches allowlisted CEX Binance through clean on-chain hops."]
    });
  });

  it("declines bridge router DEX HTX Huobi and WhiteBIT sources", () => {
    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("bridge", "Allbridge"),
      balanceShare: 1
    })).toMatchObject({
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: 78
    });

    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("router", "MetaRouter"),
      balanceShare: 1
    })).toMatchObject({ verdict: "DECLINE", riskScoreContribution: 78 });

    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("dex", "SunSwap"),
      balanceShare: 1
    })).toMatchObject({ verdict: "DECLINE", riskScoreContribution: 78 });

    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("cex", "HTX"),
      balanceShare: 1
    })).toMatchObject({ verdict: "DECLINE", riskScoreContribution: 78 });

    expect(classifyMoneyOriginStop({
      address,
      labels: [label("whitebit")],
      classification: service("cex", "WhiteBIT"),
      balanceShare: 1
    })).toMatchObject({ verdict: "DECLINE", rootSourceType: "risky_label", riskScoreContribution: 85 });
  });

  it("continues through clean EOAs and reviews unlabeled services", () => {
    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("none", null),
      balanceShare: 1
    })).toBeNull();

    expect(classifyMoneyOriginStop({
      address,
      labels: [],
      classification: service("cex", "Unknown Exchange"),
      balanceShare: 1
    })).toMatchObject({
      verdict: "REVIEW",
      rootSourceType: "unknown",
      stoppedReason: "unlabeled_service_boundary",
      riskScoreContribution: 50
    });
  });

  it("combines paths with decline taking precedence over review and acceptable", () => {
    const decision = combineMoneyOriginDecision([
      path("ACCEPTABLE", 5, "tx-acceptable"),
      path("REVIEW", 45, "tx-review"),
      path("DECLINE", 78, "tx-decline")
    ]);

    expect(decision).toEqual({
      decision: "DECLINE",
      riskScore: 78,
      decisionReasons: ["DECLINE fixture", "REVIEW fixture", "ACCEPTABLE fixture"]
    });
  });

  it("maps money-origin scores to risk levels", () => {
    expect(riskLevelFromMoneyOriginScore(0)).toBe("LOW");
    expect(riskLevelFromMoneyOriginScore(30)).toBe("MEDIUM");
    expect(riskLevelFromMoneyOriginScore(60)).toBe("HIGH");
    expect(riskLevelFromMoneyOriginScore(85)).toBe("CRITICAL");
  });
});
```

- [ ] **Step 2: Run the policy tests RED**

Run:

```bash
npm test -- tests/forensics/moneyOriginPolicy.test.ts
```

Expected: FAIL with a module resolution error for `../../src/forensics/moneyOriginPolicy`.

- [ ] **Step 3: Add origin path types**

Modify `src/types.ts` after `BalanceFormingSelection`:

```ts
export type MoneyOriginRootSourceType =
  | "allowlist_cex"
  | "decline_boundary"
  | "risky_label"
  | "unknown"
  | "incomplete";

export type MoneyOriginStoppedReason =
  | "allowlist_cex_reached"
  | "decline_boundary_reached"
  | "risky_label_reached"
  | "data_budget_exhausted"
  | "no_previous_transfer"
  | "weak_amount_or_time_continuity"
  | "unlabeled_service_boundary";

export type MoneyOriginPath = {
  balanceTransferTxHash: string;
  rootSourceAddress: string | null;
  rootSourceType: MoneyOriginRootSourceType;
  pathAddresses: string[];
  txHashes: string[];
  amountPreservationRatio: number;
  timeSpanMs: number | null;
  stoppedReason: MoneyOriginStoppedReason;
  verdict: ExchangeDecision;
  riskScoreContribution: number;
  reasons: string[];
};
```

- [ ] **Step 4: Implement the policy module**

Create `src/forensics/moneyOriginPolicy.ts`:

```ts
import type {
  AddressLabel,
  ExchangeDecision,
  MoneyOriginPath,
  MoneyOriginRootSourceType,
  MoneyOriginStoppedReason,
  RiskLevel,
  ServiceCategory,
  ServiceClassification
} from "../types";

export type MoneyOriginStopClassification = {
  verdict: ExchangeDecision;
  rootSourceType: MoneyOriginRootSourceType;
  stoppedReason: MoneyOriginStoppedReason;
  riskScoreContribution: number;
  reasons: string[];
};

export type ClassifyMoneyOriginStopInput = {
  address: string;
  labels: AddressLabel[];
  classification: ServiceClassification | null;
  balanceShare: number;
};

export type CombinedMoneyOriginDecision = {
  decision: ExchangeDecision;
  riskScore: number;
  decisionReasons: string[];
};

const ALLOWLIST_CEX_IDENTITIES = [
  "binance",
  "bybit",
  "okx",
  "coinbase",
  "kraken",
  "kucoin",
  "gate",
  "bitget",
  "mexc",
  "bitstamp",
  "crypto.com",
  "cryptocom"
];

const DECLINE_IDENTITY_KEYWORDS = ["htx", "huobi", "whitebit"];

const DECLINE_BOUNDARY_CATEGORIES = new Set<ServiceCategory>([
  "bridge",
  "bridge_pool",
  "dex",
  "router",
  "swap_adapter",
  "unknown_contract"
]);

const EXACT_RISK_LABELS = new Set<AddressLabel["label"]>([
  "scam",
  "stolen_funds",
  "phishing",
  "mixer_like",
  "risky_contract",
  "whitebit",
  "darknet_exchange",
  "darknet_exchange_proximity",
  "approval_drain_proximity"
]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[\s:_-]+/g, " ").trim();
}

function identityText(classification: ServiceClassification | null): string {
  return normalizeText([
    classification?.identity ?? "",
    ...(classification?.evidence ?? [])
  ].join(" "));
}

function matchedAllowlistIdentity(text: string): string | null {
  const match = ALLOWLIST_CEX_IDENTITIES.find((identity) => text.includes(identity));
  if (!match) return null;
  if (match === "cryptocom") return "Crypto.com";
  return match.split(".").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(".");
}

function hasDeclineIdentity(text: string): boolean {
  return DECLINE_IDENTITY_KEYWORDS.some((keyword) => text.includes(keyword));
}

function exactRiskLabel(labels: AddressLabel[]): AddressLabel | null {
  return labels.find((label) => EXACT_RISK_LABELS.has(label.label)) ?? null;
}

export function classifyMoneyOriginStop(input: ClassifyMoneyOriginStopInput): MoneyOriginStopClassification | null {
  const riskLabel = exactRiskLabel(input.labels);
  if (riskLabel) {
    return {
      verdict: "DECLINE",
      rootSourceType: "risky_label",
      stoppedReason: "risky_label_reached",
      riskScoreContribution: riskLabel.label === "whitebit" ? 85 : 90,
      reasons: [`Balance-forming path reaches high-risk label ${riskLabel.label}; exchange policy declines this source.`]
    };
  }

  const classification = input.classification;
  if (!classification || classification.category === "none" || classification.isBoundary === false) {
    return null;
  }

  const text = identityText(classification);
  if (hasDeclineIdentity(text)) {
    return {
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: 78,
      reasons: [`Balance-forming path reaches ${classification.identity ?? classification.category}; exchange policy declines HTX/Huobi/WhiteBIT sources.`]
    };
  }

  if (classification.category === "cex") {
    const allowlistIdentity = matchedAllowlistIdentity(text);
    if (allowlistIdentity) {
      return {
        verdict: "ACCEPTABLE",
        rootSourceType: "allowlist_cex",
        stoppedReason: "allowlist_cex_reached",
        riskScoreContribution: 5,
        reasons: [`Balance-forming path reaches allowlisted CEX ${allowlistIdentity} through clean on-chain hops.`]
      };
    }
    return {
      verdict: "REVIEW",
      rootSourceType: "unknown",
      stoppedReason: "unlabeled_service_boundary",
      riskScoreContribution: 50,
      reasons: [`Balance-forming path reaches unlabeled or non-allowlisted CEX ${classification.identity ?? input.address}; manual review required.`]
    };
  }

  if (DECLINE_BOUNDARY_CATEGORIES.has(classification.category)) {
    const score = classification.category === "unknown_contract" && input.balanceShare < 0.5 ? 65 : 78;
    return {
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: score,
      reasons: [`Balance-forming path reaches ${classification.category} boundary; this is an exchange-policy decline source. Public-chain continuity after the service boundary should not be assumed.`]
    };
  }

  return {
    verdict: "REVIEW",
    rootSourceType: "unknown",
    stoppedReason: "unlabeled_service_boundary",
    riskScoreContribution: 45,
    reasons: [`Balance-forming path reaches service boundary ${classification.category}; manual review required.`]
  };
}

function decisionRank(decision: ExchangeDecision): number {
  if (decision === "DECLINE") return 3;
  if (decision === "REVIEW") return 2;
  return 1;
}

export function combineMoneyOriginDecision(paths: MoneyOriginPath[]): CombinedMoneyOriginDecision {
  if (paths.length === 0) {
    return {
      decision: "REVIEW",
      riskScore: 45,
      decisionReasons: ["No balance-forming origin paths were available; manual review required."]
    };
  }

  const sorted = [...paths].sort((left, right) =>
    decisionRank(right.verdict) - decisionRank(left.verdict) ||
    right.riskScoreContribution - left.riskScoreContribution
  );
  return {
    decision: sorted[0].verdict,
    riskScore: Math.max(...paths.map((path) => path.riskScoreContribution)),
    decisionReasons: sorted.flatMap((path) => path.reasons).slice(0, 6)
  };
}

export function riskLevelFromMoneyOriginScore(score: number): RiskLevel {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}
```

- [ ] **Step 5: Run policy tests GREEN**

Run:

```bash
npm test -- tests/forensics/moneyOriginPolicy.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit policy**

Run:

```bash
git add src/types.ts src/forensics/moneyOriginPolicy.ts tests/forensics/moneyOriginPolicy.test.ts
git commit -m "feat: add money-origin source policy"
```

Expected: commit succeeds.

---

### Task 3: Bounded Money-Origin Trace

**Files:**
- Create: `src/forensics/moneyOriginTrace.ts`
- Test: `tests/forensics/moneyOriginTrace.test.ts`

- [ ] **Step 1: Write the failing trace tests**

Create `tests/forensics/moneyOriginTrace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { traceMoneyOriginPath } from "../../src/forensics/moneyOriginTrace";
import type { AddressLabel, BalanceFormingTransfer, ForensicRouteEdge, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const walletB = "TWalletB1111111111111111111111111111";
const walletC = "TWalletC1111111111111111111111111111";
const walletD = "TWalletD1111111111111111111111111111";
const binance = "TBinance111111111111111111111111111";
const bridge = "TBridge1111111111111111111111111111";
const whitebit = "TWhiteBIT11111111111111111111111111";

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

function balanceTransfer(fromAddress: string, txHash = "tx-balance"): BalanceFormingTransfer {
  return {
    txHash,
    fromAddress,
    toAddress: subject,
    amountRaw: "5000000000",
    timestamp: "2026-05-22T10:15:00.000Z",
    coverageShare: 1,
    selectedReason: "covers_current_balance"
  };
}

function service(category: ServiceClassification["category"], identity: string | null): ServiceClassification {
  return {
    category,
    identity,
    confidence: "high",
    evidence: identity ? [`tag:${identity}`] : [],
    isBoundary: category !== "none"
  };
}

function whitebitLabel(): AddressLabel {
  return {
    address: whitebit,
    label: "whitebit",
    source: "service_admin",
    createdByTelegramId: "1",
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

describe("traceMoneyOriginPath", () => {
  it("accepts a clean multi-hop EOA chain from an allowlisted CEX", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [walletD, [edge("tx-c-d", walletC, walletD, "5000000000", "2026-05-22T10:10:00.000Z")]],
      [walletC, [edge("tx-b-c", walletB, walletC, "5000000000", "2026-05-22T10:05:00.000Z")]],
      [walletB, [edge("tx-binance-b", binance, walletB, "5000000000", "2026-05-22T10:00:00.000Z")]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(walletD),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "ACCEPTABLE",
      rootSourceAddress: binance,
      rootSourceType: "allowlist_cex",
      stoppedReason: "allowlist_cex_reached",
      riskScoreContribution: 5,
      pathAddresses: [binance, walletB, walletC, walletD, subject],
      txHashes: ["tx-binance-b", "tx-b-c", "tx-c-d", "tx-balance"],
      amountPreservationRatio: 1
    });
  });

  it("declines when the balance-forming path reaches a bridge boundary", async () => {
    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(bridge),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === bridge ? service("bridge", "Allbridge") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "DECLINE",
      rootSourceAddress: bridge,
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: 78,
      pathAddresses: [bridge, subject]
    });
    expect(path.reasons.join(" ")).toContain("exchange-policy decline source");
  });

  it("declines WhiteBIT labels even when the service classification is generic CEX", async () => {
    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(whitebit),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async (address) => address === whitebit ? [whitebitLabel()] : [],
      getClassificationForAddress: async (address) => address === whitebit ? service("cex", "WhiteBIT") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "DECLINE",
      rootSourceType: "risky_label",
      stoppedReason: "risky_label_reached",
      riskScoreContribution: 85
    });
  });

  it("returns review incomplete when clean EOA tracing exhausts the configured depth", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [walletD, [edge("tx-c-d", walletC, walletD, "5000000000", "2026-05-22T10:10:00.000Z")]],
      [walletC, [edge("tx-b-c", walletB, walletC, "5000000000", "2026-05-22T10:05:00.000Z")]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(walletD),
      maxDepth: 2,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "REVIEW",
      rootSourceAddress: walletB,
      rootSourceType: "incomplete",
      stoppedReason: "data_budget_exhausted",
      riskScoreContribution: 45,
      pathAddresses: [walletB, walletC, walletD, subject]
    });
  });
});
```

- [ ] **Step 2: Run the trace tests RED**

Run:

```bash
npm test -- tests/forensics/moneyOriginTrace.test.ts
```

Expected: FAIL with a module resolution error for `../../src/forensics/moneyOriginTrace`.

- [ ] **Step 3: Implement the trace module**

Create `src/forensics/moneyOriginTrace.ts`:

```ts
import type {
  AddressLabel,
  BalanceFormingTransfer,
  ForensicRouteEdge,
  MoneyOriginPath,
  ServiceClassification
} from "../types";
import { classifyMoneyOriginStop } from "./moneyOriginPolicy";

export type TraceMoneyOriginPathInput = {
  subjectAddress: string;
  balanceTransfer: BalanceFormingTransfer;
  maxDepth: number;
  beamWidth: number;
  maxAddressFetches: number;
  maxEdgesPerAddress: number;
  minAmountPreservationRatio?: number;
  maxTimeDeltaMs?: number;
  fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
};

type TraceState = {
  currentAddress: string;
  expectedAmountRaw: bigint;
  latestTimestamp: Date;
  addressesFromSubject: string[];
  txHashesFromSubject: string[];
  minPreservation: number;
  depth: number;
  score: number;
};

const DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO = 0.7;
const DEFAULT_MAX_TIME_DELTA_MS = 24 * 60 * 60 * 1000;

function parseAmount(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function preservationRatio(left: bigint, right: bigint): number {
  if (left <= 0n || right <= 0n) return 0;
  const min = left < right ? left : right;
  const max = left > right ? left : right;
  return ratio(min, max);
}

function timeDeltaMs(previous: Date, next: Date): number {
  return next.getTime() - previous.getTime();
}

function compareCandidateEdges(input: {
  expectedAmountRaw: bigint;
  latestTimestamp: Date;
  left: ForensicRouteEdge;
  right: ForensicRouteEdge;
}): number {
  const leftPreservation = preservationRatio(parseAmount(input.left.amountRaw), input.expectedAmountRaw);
  const rightPreservation = preservationRatio(parseAmount(input.right.amountRaw), input.expectedAmountRaw);
  if (leftPreservation !== rightPreservation) return rightPreservation - leftPreservation;
  const leftDelta = timeDeltaMs(input.left.timestamp, input.latestTimestamp);
  const rightDelta = timeDeltaMs(input.right.timestamp, input.latestTimestamp);
  if (leftDelta !== rightDelta) return leftDelta - rightDelta;
  return input.left.txHash.localeCompare(input.right.txHash);
}

function candidateIncomingEdges(input: {
  currentAddress: string;
  expectedAmountRaw: bigint;
  latestTimestamp: Date;
  edges: ForensicRouteEdge[];
  minPreservation: number;
  maxTimeDeltaMs: number;
  maxEdges: number;
}): ForensicRouteEdge[] {
  return input.edges
    .filter((edge) => edge.toAddress === input.currentAddress)
    .filter((edge) => edge.timestamp <= input.latestTimestamp)
    .filter((edge) => parseAmount(edge.amountRaw) > 0n)
    .filter((edge) => preservationRatio(parseAmount(edge.amountRaw), input.expectedAmountRaw) >= input.minPreservation)
    .filter((edge) => timeDeltaMs(edge.timestamp, input.latestTimestamp) <= input.maxTimeDeltaMs)
    .sort((left, right) => compareCandidateEdges({
      expectedAmountRaw: input.expectedAmountRaw,
      latestTimestamp: input.latestTimestamp,
      left,
      right
    }))
    .slice(0, input.maxEdges);
}

function pathFromState(input: {
  state: TraceState;
  balanceTransferTxHash: string;
  rootSourceType: MoneyOriginPath["rootSourceType"];
  stoppedReason: MoneyOriginPath["stoppedReason"];
  verdict: MoneyOriginPath["verdict"];
  riskScoreContribution: number;
  reasons: string[];
}): MoneyOriginPath {
  return {
    balanceTransferTxHash: input.balanceTransferTxHash,
    rootSourceAddress: input.state.currentAddress,
    rootSourceType: input.rootSourceType,
    pathAddresses: [...input.state.addressesFromSubject].reverse(),
    txHashes: [...input.state.txHashesFromSubject].reverse(),
    amountPreservationRatio: input.state.minPreservation,
    timeSpanMs: input.state.txHashesFromSubject.length > 1
      ? Math.max(0, Date.now() - Date.now())
      : 0,
    stoppedReason: input.stoppedReason,
    verdict: input.verdict,
    riskScoreContribution: input.riskScoreContribution,
    reasons: input.reasons
  };
}

function incompletePath(input: {
  state: TraceState;
  balanceTransferTxHash: string;
  stoppedReason: MoneyOriginPath["stoppedReason"];
  message: string;
}): MoneyOriginPath {
  return pathFromState({
    state: input.state,
    balanceTransferTxHash: input.balanceTransferTxHash,
    rootSourceType: "incomplete",
    stoppedReason: input.stoppedReason,
    verdict: "REVIEW",
    riskScoreContribution: input.stoppedReason === "weak_amount_or_time_continuity" ? 50 : 45,
    reasons: [input.message]
  });
}

function terminalRank(path: MoneyOriginPath): number {
  if (path.verdict === "DECLINE") return 3_000 + path.riskScoreContribution;
  if (path.verdict === "ACCEPTABLE") return 2_000 - path.txHashes.length;
  return 1_000 + path.riskScoreContribution;
}

export async function traceMoneyOriginPath(input: TraceMoneyOriginPathInput): Promise<MoneyOriginPath> {
  const minPreservation = input.minAmountPreservationRatio ?? DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO;
  const maxTimeDeltaMs = input.maxTimeDeltaMs ?? DEFAULT_MAX_TIME_DELTA_MS;
  const initialTimestamp = new Date(input.balanceTransfer.timestamp);
  const initialState: TraceState = {
    currentAddress: input.balanceTransfer.fromAddress,
    expectedAmountRaw: parseAmount(input.balanceTransfer.amountRaw),
    latestTimestamp: initialTimestamp,
    addressesFromSubject: [input.subjectAddress, input.balanceTransfer.fromAddress],
    txHashesFromSubject: [input.balanceTransfer.txHash],
    minPreservation: 1,
    depth: 0,
    score: 0
  };

  const fetchedAddresses = new Set<string>();
  const terminals: MoneyOriginPath[] = [];
  let frontier: TraceState[] = [initialState];

  while (frontier.length > 0) {
    const nextFrontier: TraceState[] = [];
    for (const state of frontier) {
      const labels = await input.getLabelsForAddress(state.currentAddress);
      const classification = await input.getClassificationForAddress(state.currentAddress);
      const stop = classifyMoneyOriginStop({
        address: state.currentAddress,
        labels,
        classification,
        balanceShare: 1
      });
      if (stop) {
        terminals.push(pathFromState({
          state,
          balanceTransferTxHash: input.balanceTransfer.txHash,
          rootSourceType: stop.rootSourceType,
          stoppedReason: stop.stoppedReason,
          verdict: stop.verdict,
          riskScoreContribution: stop.riskScoreContribution,
          reasons: stop.reasons
        }));
        continue;
      }

      if (state.depth >= input.maxDepth) {
        terminals.push(incompletePath({
          state,
          balanceTransferTxHash: input.balanceTransfer.txHash,
          stoppedReason: "data_budget_exhausted",
          message: `Clean EOA chain reached maxDepth=${input.maxDepth} before a known good or decline source was found; manual review required.`
        }));
        continue;
      }

      if (!fetchedAddresses.has(state.currentAddress) && fetchedAddresses.size >= input.maxAddressFetches) {
        terminals.push(incompletePath({
          state,
          balanceTransferTxHash: input.balanceTransfer.txHash,
          stoppedReason: "data_budget_exhausted",
          message: `Trace reached maxAddressFetches=${input.maxAddressFetches} before a known good or decline source was found; manual review required.`
        }));
        continue;
      }

      fetchedAddresses.add(state.currentAddress);
      const edges = await input.fetchEdgesForAddress(state.currentAddress);
      const candidates = candidateIncomingEdges({
        currentAddress: state.currentAddress,
        expectedAmountRaw: state.expectedAmountRaw,
        latestTimestamp: state.latestTimestamp,
        edges,
        minPreservation,
        maxTimeDeltaMs,
        maxEdges: input.maxEdgesPerAddress
      });

      if (candidates.length === 0) {
        const hasAnyPreviousIncoming = edges.some((edge) =>
          edge.toAddress === state.currentAddress &&
          edge.timestamp <= state.latestTimestamp &&
          parseAmount(edge.amountRaw) > 0n
        );
        terminals.push(incompletePath({
          state,
          balanceTransferTxHash: input.balanceTransfer.txHash,
          stoppedReason: hasAnyPreviousIncoming ? "weak_amount_or_time_continuity" : "no_previous_transfer",
          message: hasAnyPreviousIncoming
            ? "Previous incoming transfers exist, but amount/time continuity is too weak for acceptable balance-origin proof; manual review required."
            : "No previous inbound USDT transfer found before this clean EOA hop; manual review required."
        }));
        continue;
      }

      for (const edge of candidates) {
        const preservation = preservationRatio(parseAmount(edge.amountRaw), state.expectedAmountRaw);
        nextFrontier.push({
          currentAddress: edge.fromAddress,
          expectedAmountRaw: parseAmount(edge.amountRaw),
          latestTimestamp: edge.timestamp,
          addressesFromSubject: [...state.addressesFromSubject, edge.fromAddress],
          txHashesFromSubject: [...state.txHashesFromSubject, edge.txHash],
          minPreservation: Math.min(state.minPreservation, preservation),
          depth: state.depth + 1,
          score: state.score + preservation * 100
        });
      }
    }

    if (terminals.some((path) => path.verdict === "DECLINE")) break;
    frontier = nextFrontier
      .sort((left, right) => right.score - left.score || left.currentAddress.localeCompare(right.currentAddress))
      .slice(0, input.beamWidth);
  }

  if (terminals.length === 0) {
    return incompletePath({
      state: initialState,
      balanceTransferTxHash: input.balanceTransfer.txHash,
      stoppedReason: "data_budget_exhausted",
      message: "Trace ended without terminal candidates; manual review required."
    });
  }

  return terminals.sort((left, right) => terminalRank(right) - terminalRank(left))[0];
}
```

- [ ] **Step 4: Fix the deterministic `timeSpanMs` field**

Replace the `timeSpanMs` expression in `pathFromState` with a value derived from ordered timestamps. Add `timestampsFromSubject` to `TraceState`:

```ts
type TraceState = {
  currentAddress: string;
  expectedAmountRaw: bigint;
  latestTimestamp: Date;
  addressesFromSubject: string[];
  txHashesFromSubject: string[];
  timestampsFromSubject: Date[];
  minPreservation: number;
  depth: number;
  score: number;
};
```

Set the initial state:

```ts
timestampsFromSubject: [initialTimestamp],
```

When pushing a next state, append the edge timestamp:

```ts
timestampsFromSubject: [...state.timestampsFromSubject, edge.timestamp],
```

Then replace `timeSpanMs` in `pathFromState`:

```ts
const timestamps = input.state.timestampsFromSubject.map((timestamp) => timestamp.getTime());
const timeSpanMs = timestamps.length > 1 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
```

and use:

```ts
timeSpanMs,
```

- [ ] **Step 5: Run trace tests GREEN**

Run:

```bash
npm test -- tests/forensics/moneyOriginTrace.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit trace**

Run:

```bash
git add src/forensics/moneyOriginTrace.ts tests/forensics/moneyOriginTrace.test.ts
git commit -m "feat: trace balance-forming origin paths"
```

Expected: commit succeeds.

---

### Task 4: Where-Is-Money Orchestrator

**Files:**
- Create: `src/check/whereIsMoneyCheck.ts`
- Modify: `src/types.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Write the failing orchestrator tests**

Create `tests/check/whereIsMoneyCheck.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runWhereIsMoneyCheck } from "../../src/check/whereIsMoneyCheck";
import type { AddressLabel, ForensicRouteEdge, RiskReport, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const oldSender = "TOldSender11111111111111111111111111";
const cleanSender = "TCleanSender11111111111111111111111";
const bridge = "TBridge1111111111111111111111111111";
const binance = "TBinance111111111111111111111111111";

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

function service(category: ServiceClassification["category"], identity: string | null): ServiceClassification {
  return {
    category,
    identity,
    confidence: "high",
    evidence: identity ? [`tag:${identity}`] : [],
    isBoundary: category !== "none"
  };
}

const lowFastRisk: RiskReport = {
  subjectAddress: subject,
  level: "LOW",
  score: 0,
  reasons: []
};

describe("runWhereIsMoneyCheck", () => {
  it("traces only balance-forming inbound transfers and ignores older unrelated inflows", async () => {
    const calls: string[] = [];
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-old", oldSender, subject, "20000000000", "2026-05-20T10:00:00.000Z"),
          edge("tx-bridge-subject", bridge, subject, "3000000000", "2026-05-22T10:10:00.000Z"),
          edge("tx-clean-subject", cleanSender, subject, "2000000000", "2026-05-22T10:15:00.000Z")
        ]
      ],
      [cleanSender, [edge("tx-binance-clean", binance, cleanSender, "2000000000", "2026-05-22T10:00:00.000Z")]],
      [oldSender, [edge("tx-binance-old", binance, oldSender, "20000000000", "2026-05-20T09:00:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "5000000000",
      fetchEdgesForAddress: async (address) => {
        calls.push(address);
        return byAddress.get(address) ?? [];
      },
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "Binance");
        if (address === bridge) return service("bridge", "Allbridge");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40
    });

    expect(report.currentUsdtBalanceRaw).toBe("5000000000");
    expect(report.balanceFormingTransfers.map((transfer) => transfer.txHash)).toEqual(["tx-clean-subject", "tx-bridge-subject"]);
    expect(calls).not.toContain(oldSender);
    expect(report.originPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ balanceTransferTxHash: "tx-clean-subject", verdict: "ACCEPTABLE" }),
      expect.objectContaining({ balanceTransferTxHash: "tx-bridge-subject", verdict: "DECLINE" })
    ]));
    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(78);
    expect(report.coverage).toMatchObject({
      selectedInboundTxCount: 2,
      selectedInboundVolumeRaw: "5000000000",
      currentBalanceCoverageRatio: 1,
      partial: false
    });
  });

  it("returns review incomplete when balance lookup fails", async () => {
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => null,
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("REVIEW");
    expect(report.riskScore).toBe(45);
    expect(report.coverage.partial).toBe(true);
    expect(report.decisionReasons).toEqual(["Current USDT balance is zero or unavailable; balance-origin trace cannot prove source funds."]);
  });
});
```

- [ ] **Step 2: Run orchestrator tests RED**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: FAIL with a module resolution error for `../../src/check/whereIsMoneyCheck`.

- [ ] **Step 3: Add report types**

Modify `src/types.ts` after `MoneyOriginPath`:

```ts
export type WhereIsMoneyCoverage = {
  selectedInboundTxCount: number;
  selectedInboundVolumeRaw: string;
  currentBalanceCoverageRatio: number;
  maxDepth: number;
  fetchedAddressCount: number;
  partial: boolean;
  notes: string[];
};

export type WhereIsMoneyReport = {
  subjectAddress: string;
  currentUsdtBalanceRaw: string | null;
  fastWalletRisk: RiskReport | null;
  balanceFormingTransfers: BalanceFormingTransfer[];
  originPaths: MoneyOriginPath[];
  decision: ExchangeDecision;
  riskScore: number;
  decisionReasons: string[];
  coverage: WhereIsMoneyCoverage;
};
```

- [ ] **Step 4: Implement the orchestrator**

Create `src/check/whereIsMoneyCheck.ts`:

```ts
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import { selectBalanceFormingTransfers } from "../forensics/balanceFormingTransfers";
import { combineMoneyOriginDecision } from "../forensics/moneyOriginPolicy";
import { traceMoneyOriginPath } from "../forensics/moneyOriginTrace";
import type {
  AddressLabel,
  ForensicRouteEdge,
  RiskReport,
  ServiceClassification,
  WhereIsMoneyReport
} from "../types";

export type WhereIsMoneyDeps = {
  getTrc20Balance(address: string, tokenContractAddress: string): Promise<string | null>;
  fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  getFastWalletRisk?(address: string): Promise<RiskReport | null>;
};

export type RunWhereIsMoneyCheckInput = {
  sourceAddress: string;
  windowStart: Date;
  windowEnd: Date;
  maxDepth?: number;
  beamWidth?: number;
  maxAddressFetches?: number;
  maxEdgesPerAddress?: number;
};

const DEFAULT_MAX_DEPTH = 7;
const DEFAULT_BEAM_WIDTH = 8;
const DEFAULT_MAX_ADDRESS_FETCHES = 60;
const DEFAULT_MAX_EDGES_PER_ADDRESS = 40;

function fallbackReviewReport(input: {
  sourceAddress: string;
  currentBalanceRaw: string | null;
  fastWalletRisk: RiskReport | null;
  maxDepth: number;
  notes: string[];
}): WhereIsMoneyReport {
  return {
    subjectAddress: input.sourceAddress,
    currentUsdtBalanceRaw: input.currentBalanceRaw,
    fastWalletRisk: input.fastWalletRisk,
    balanceFormingTransfers: [],
    originPaths: [],
    decision: "REVIEW",
    riskScore: Math.max(45, input.fastWalletRisk?.score ?? 0),
    decisionReasons: input.notes,
    coverage: {
      selectedInboundTxCount: 0,
      selectedInboundVolumeRaw: "0",
      currentBalanceCoverageRatio: 0,
      maxDepth: input.maxDepth,
      fetchedAddressCount: 0,
      partial: true,
      notes: input.notes
    }
  };
}

function fastRiskDecisionScore(report: RiskReport | null): number {
  if (!report) return 0;
  return report.score >= 85 ? report.score : 0;
}

export async function runWhereIsMoneyCheck(
  deps: WhereIsMoneyDeps,
  input: RunWhereIsMoneyCheckInput
): Promise<WhereIsMoneyReport> {
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const beamWidth = input.beamWidth ?? DEFAULT_BEAM_WIDTH;
  const maxAddressFetches = input.maxAddressFetches ?? DEFAULT_MAX_ADDRESS_FETCHES;
  const maxEdgesPerAddress = input.maxEdgesPerAddress ?? DEFAULT_MAX_EDGES_PER_ADDRESS;
  const fastWalletRisk = await deps.getFastWalletRisk?.(input.sourceAddress) ?? null;
  const currentBalanceRaw = await deps.getTrc20Balance(input.sourceAddress, TRON_USDT_CONTRACT_ADDRESS).catch(() => null);
  const sourceEdges = await deps.fetchEdgesForAddress(input.sourceAddress).catch(() => []);
  const selection = selectBalanceFormingTransfers({
    subjectAddress: input.sourceAddress,
    currentBalanceRaw,
    edges: sourceEdges
  });

  if (selection.transfers.length === 0) {
    return fallbackReviewReport({
      sourceAddress: input.sourceAddress,
      currentBalanceRaw,
      fastWalletRisk,
      maxDepth,
      notes: selection.notes.length > 0 ? selection.notes : ["No balance-forming inbound USDT transfers were available; manual review required."]
    });
  }

  const fetchedAddresses = new Set<string>([input.sourceAddress]);
  const fetchEdgesForAddress = async (address: string): Promise<ForensicRouteEdge[]> => {
    fetchedAddresses.add(address);
    const edges = await deps.fetchEdgesForAddress(address);
    return edges.filter((edge) => edge.timestamp >= input.windowStart && edge.timestamp <= input.windowEnd);
  };

  const originPaths = await Promise.all(selection.transfers.map((balanceTransfer) =>
    traceMoneyOriginPath({
      subjectAddress: input.sourceAddress,
      balanceTransfer,
      maxDepth,
      beamWidth,
      maxAddressFetches,
      maxEdgesPerAddress,
      fetchEdgesForAddress,
      getLabelsForAddress: deps.getLabelsForAddress,
      getClassificationForAddress: deps.getClassificationForAddress
    })
  ));
  const combined = combineMoneyOriginDecision(originPaths);
  const fastScore = fastRiskDecisionScore(fastWalletRisk);
  const riskScore = Math.max(combined.riskScore, fastScore);
  const fastDecline = fastScore >= 85;
  const decision = fastDecline ? "DECLINE" : combined.decision;
  const decisionReasons = fastDecline && fastWalletRisk
    ? [
        `Fast wallet check is ${fastWalletRisk.level} ${fastWalletRisk.score}/100 from exact or critical evidence.`,
        ...combined.decisionReasons
      ]
    : combined.decisionReasons;

  return {
    subjectAddress: input.sourceAddress,
    currentUsdtBalanceRaw: currentBalanceRaw,
    fastWalletRisk,
    balanceFormingTransfers: selection.transfers,
    originPaths,
    decision,
    riskScore,
    decisionReasons,
    coverage: {
      selectedInboundTxCount: selection.transfers.length,
      selectedInboundVolumeRaw: selection.selectedVolumeRaw,
      currentBalanceCoverageRatio: selection.currentBalanceCoverageRatio,
      maxDepth,
      fetchedAddressCount: fetchedAddresses.size,
      partial: selection.partial || originPaths.some((path) => path.verdict === "REVIEW"),
      notes: [
        "Balance-forming approximation: latest inbound USDT flows sufficient to explain the current wallet balance.",
        ...selection.notes,
        ...originPaths
          .filter((path) => path.verdict === "REVIEW")
          .map((path) => `${path.balanceTransferTxHash}: ${path.reasons[0]}`)
      ]
    }
  };
}
```

- [ ] **Step 5: Run orchestrator tests GREEN**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit orchestrator**

Run:

```bash
git add src/types.ts src/check/whereIsMoneyCheck.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "feat: compose where-is-money balance-origin reports"
```

Expected: commit succeeds.

---

### Task 5: Where-Is-Money CLI Args

**Files:**
- Create: `src/forensics/whereIsMoneyCliArgs.ts`
- Test: `tests/forensics/whereIsMoneyCliArgs.test.ts`

- [ ] **Step 1: Write failing CLI args tests**

Create `tests/forensics/whereIsMoneyCliArgs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseWhereIsMoneyCliArgs, WHERE_IS_MONEY_USAGE } from "../../src/forensics/whereIsMoneyCliArgs";

const source = "TUzXY779GY3Tm6UDRYDPqNEojZgZEpY127";

describe("where is money CLI args", () => {
  it("defaults to bounded balance-origin search settings", () => {
    const parsed = parseWhereIsMoneyCliArgs([
      "--",
      "--source",
      source,
      "--end",
      "2026-05-26T00:00:00.000Z"
    ]);

    expect(parsed).toMatchObject({
      source,
      days: 30,
      depth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40
    });
    expect(parsed.windowEnd.toISOString()).toBe("2026-05-26T00:00:00.000Z");
    expect(parsed.windowStart.toISOString()).toBe("2026-04-26T00:00:00.000Z");
  });

  it("rejects values that would make the local search too broad", () => {
    expect(() => parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--depth",
      "21"
    ])).toThrow(/--depth must be an integer between 1 and 20/);

    expect(() => parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--beam",
      "20"
    ])).toThrow(/--beam must be an integer between 1 and 8/);

    expect(() => parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--max-addresses",
      "120"
    ])).toThrow(/--max-addresses must be an integer between 1 and 60/);

    expect(() => parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--max-edges",
      "250"
    ])).toThrow(/--max-edges must be an integer between 1 and 100/);
  });

  it("documents the where-is-money command", () => {
    expect(WHERE_IS_MONEY_USAGE).toContain("forensic:where-is-money");
    expect(WHERE_IS_MONEY_USAGE).toContain("--depth 7");
    expect(WHERE_IS_MONEY_USAGE).toContain("--max-edges 40");
  });
});
```

- [ ] **Step 2: Run CLI args tests RED**

Run:

```bash
npm test -- tests/forensics/whereIsMoneyCliArgs.test.ts
```

Expected: FAIL with a module resolution error for `../../src/forensics/whereIsMoneyCliArgs`.

- [ ] **Step 3: Implement CLI args parser**

Create `src/forensics/whereIsMoneyCliArgs.ts`:

```ts
import { classifyInput } from "../tron/address";

export type ParsedWhereIsMoneyCliArgs = {
  source: string;
  days: number;
  windowStart: Date;
  windowEnd: Date;
  depth: number;
  beamWidth: number;
  maxAddressFetches: number;
  maxEdgesPerAddress: number;
};

export const WHERE_IS_MONEY_DEFAULT_DAYS = 30;
export const WHERE_IS_MONEY_DEFAULT_DEPTH = 7;
export const WHERE_IS_MONEY_MAX_DEPTH = 20;
export const WHERE_IS_MONEY_DEFAULT_BEAM_WIDTH = 8;
export const WHERE_IS_MONEY_MAX_BEAM_WIDTH = 8;
export const WHERE_IS_MONEY_DEFAULT_MAX_ADDRESS_FETCHES = 60;
export const WHERE_IS_MONEY_MAX_ADDRESS_FETCHES = 60;
export const WHERE_IS_MONEY_DEFAULT_MAX_EDGES_PER_ADDRESS = 40;
export const WHERE_IS_MONEY_MAX_EDGES_PER_ADDRESS = 100;

export const WHERE_IS_MONEY_USAGE = [
  "Usage:",
  "  npm run forensic:where-is-money -- --source <TRON-address> [--days 30] [--depth 7] [--beam 8] [--max-addresses 60] [--max-edges 40]",
  "  node --import tsx scripts/forensicWhereIsMoney.ts --source <TRON-address> [--days 30] [--depth 7] [--beam 8] [--max-addresses 60] [--max-edges 40]"
].join("\n");

function normalizeArgs(argv: readonly string[]): string[] {
  const separatorIndex = argv.indexOf("--");
  return separatorIndex === -1 ? [...argv] : argv.slice(separatorIndex + 1);
}

function argValue(args: readonly string[], name: string): string | undefined {
  const equalsPrefix = `${name}=`;
  const equalsValue = args.find((arg) => arg.startsWith(equalsPrefix));
  if (equalsValue) return equalsValue.slice(equalsPrefix.length);

  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function parseAddress(args: readonly string[]): string {
  const value = argValue(args, "--source");
  if (!value) throw new Error(WHERE_IS_MONEY_USAGE);
  const classified = classifyInput(value);
  if (classified.kind !== "tron_address") {
    throw new Error(`--source must be a valid TRON address.\n${WHERE_IS_MONEY_USAGE}`);
  }
  return classified.value;
}

function parseIntegerInRange(input: {
  args: readonly string[];
  name: string;
  fallback: number;
  min: number;
  max: number;
}): number {
  const value = argValue(input.args, input.name);
  if (value === undefined) return input.fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < input.min || parsed > input.max) {
    throw new Error(`${input.name} must be an integer between ${input.min} and ${input.max}.\n${WHERE_IS_MONEY_USAGE}`);
  }
  return parsed;
}

function parseOptionalDate(args: readonly string[], name: string): Date | null {
  const value = argValue(args, name);
  if (value === undefined) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${name} must be a valid ISO date.\n${WHERE_IS_MONEY_USAGE}`);
  }
  return parsed;
}

export function parseWhereIsMoneyCliArgs(argv: readonly string[]): ParsedWhereIsMoneyCliArgs {
  const args = normalizeArgs(argv);
  const source = parseAddress(args);
  const days = parseIntegerInRange({
    args,
    name: "--days",
    fallback: WHERE_IS_MONEY_DEFAULT_DAYS,
    min: 1,
    max: 365
  });
  const windowEnd = parseOptionalDate(args, "--end") ?? new Date();
  const windowStart = parseOptionalDate(args, "--start") ?? new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);
  if (windowStart >= windowEnd) {
    throw new Error(`--start must be before --end.\n${WHERE_IS_MONEY_USAGE}`);
  }

  const depth = parseIntegerInRange({
    args,
    name: "--depth",
    fallback: WHERE_IS_MONEY_DEFAULT_DEPTH,
    min: 1,
    max: WHERE_IS_MONEY_MAX_DEPTH
  });
  const beamWidth = parseIntegerInRange({
    args,
    name: "--beam",
    fallback: WHERE_IS_MONEY_DEFAULT_BEAM_WIDTH,
    min: 1,
    max: WHERE_IS_MONEY_MAX_BEAM_WIDTH
  });
  const maxAddressFetches = parseIntegerInRange({
    args,
    name: "--max-addresses",
    fallback: WHERE_IS_MONEY_DEFAULT_MAX_ADDRESS_FETCHES,
    min: 1,
    max: WHERE_IS_MONEY_MAX_ADDRESS_FETCHES
  });
  const maxEdgesPerAddress = parseIntegerInRange({
    args,
    name: "--max-edges",
    fallback: WHERE_IS_MONEY_DEFAULT_MAX_EDGES_PER_ADDRESS,
    min: 1,
    max: WHERE_IS_MONEY_MAX_EDGES_PER_ADDRESS
  });

  return {
    source,
    days,
    windowStart,
    windowEnd,
    depth,
    beamWidth,
    maxAddressFetches,
    maxEdgesPerAddress
  };
}
```

- [ ] **Step 4: Run CLI args tests GREEN**

Run:

```bash
npm test -- tests/forensics/whereIsMoneyCliArgs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit CLI args**

Run:

```bash
git add src/forensics/whereIsMoneyCliArgs.ts tests/forensics/whereIsMoneyCliArgs.test.ts
git commit -m "feat: parse where-is-money CLI args"
```

Expected: commit succeeds.

---

### Task 6: Offline CLI Report

**Files:**
- Create: `scripts/forensicWhereIsMoney.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the package script**

Modify `package.json` scripts:

```json
"forensic:where-is-money": "node --import tsx scripts/forensicWhereIsMoney.ts"
```

Keep the trailing commas valid for the surrounding JSON object.

- [ ] **Step 2: Create the CLI script**

Create `scripts/forensicWhereIsMoney.ts`:

```ts
import "dotenv/config";
import { runWhereIsMoneyCheck } from "../src/check/whereIsMoneyCheck";
import { evaluateAddressRisk } from "../src/risk/evaluation";
import { loadConfig } from "../src/config";
import { closeDb, createDb } from "../src/storage/db";
import {
  getAddressMetadata,
  getContractIntelligenceProfile,
  listAddressLabels,
  listIndexedTronUsdtTransfersForAddress
} from "../src/storage/repositories";
import { indexedTransferToRouteEdge } from "../src/forensics/localTronUsdtIndex";
import { parseWhereIsMoneyCliArgs } from "../src/forensics/whereIsMoneyCliArgs";
import { classifyServiceAddress } from "../src/forensics/serviceClassifier";
import { TronscanClient } from "../src/tron/tronClient";
import { createTronscanScheduler } from "../src/tron/tronscanScheduler";
import type { ForensicRouteEdge, ServiceClassification } from "../src/types";

function formatRawUsdt(amountRaw: string | null): string {
  if (!amountRaw || !/^\d+$/.test(amountRaw)) return "not checked";
  const raw = BigInt(amountRaw);
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} USDT` : `${whole} USDT`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function levelFromScore(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function databaseUrlFromEnvironment(): string {
  try {
    return loadConfig().databaseUrl;
  } catch (error) {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    throw error;
  }
}

const args = parseWhereIsMoneyCliArgs(process.argv.slice(2));
const config = loadConfig();
const db = createDb(databaseUrlFromEnvironment());
const scheduler = createTronscanScheduler({
  requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
  rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
  apiKeyConfigured: Boolean(config.tronscanApiKey)
});
const tronClient = new TronscanClient({
  baseUrl: config.tronscanBaseUrl,
  fullNodeBaseUrl: config.tronFullNodeBaseUrl,
  apiKey: config.tronscanApiKey,
  fullNodeApiKey: config.tronFullNodeApiKey,
  timeoutMs: config.tronscanTimeoutMs,
  retryAttempts: config.tronscanRetryAttempts,
  retryBaseDelayMs: config.tronscanRetryBaseDelayMs,
  requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
  rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
  scheduler
});

const edgeCache = new Map<string, ForensicRouteEdge[]>();
const classificationCache = new Map<string, ServiceClassification | null>();

async function fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]> {
  if (edgeCache.has(address)) return edgeCache.get(address) ?? [];
  const transfers = await listIndexedTronUsdtTransfersForAddress(db, {
    address,
    minTimestamp: args.windowStart,
    maxTimestamp: args.windowEnd,
    direction: "both",
    limit: 200,
    orderBy: "newest"
  });
  const edges = transfers.map(indexedTransferToRouteEdge);
  edgeCache.set(address, edges);
  return edges;
}

async function getClassificationForAddress(address: string): Promise<ServiceClassification | null> {
  if (classificationCache.has(address)) return classificationCache.get(address) ?? null;
  const metadata = await getAddressMetadata(db, address, new Date());
  const contractProfile = metadata?.isContract
    ? await getContractIntelligenceProfile(db, address, new Date())
    : null;
  const classification = classifyServiceAddress({ address, metadata, contractProfile });
  classificationCache.set(address, classification);
  return classification;
}

try {
  const report = await runWhereIsMoneyCheck({
    getTrc20Balance: async (address) => {
      const state = await tronClient.getUsdtRestrictionStatus(address);
      return state.balanceRaw;
    },
    fetchEdgesForAddress,
    getLabelsForAddress: (address) => listAddressLabels(db, address),
    getClassificationForAddress,
    getFastWalletRisk: async (address) => {
      const labels = await listAddressLabels(db, address);
      const stablecoinState = await tronClient.getUsdtRestrictionStatus(address).catch(() => null);
      const amlSignals = stablecoinState?.isBlacklisted
        ? [{
            code: "stablecoin_usdt_blacklisted",
            message: "Official TRON USDT contract blacklist state is active for this address.",
            scoreImpact: 90,
            source: "stablecoin_contract",
            confidence: "high" as const,
            severity: "critical" as const
          }]
        : [];
      return evaluateAddressRisk({
        context: { subjectAddress: address },
        labels,
        amlSignals
      }).report;
    }
  }, {
    sourceAddress: args.source,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    maxDepth: args.depth,
    beamWidth: args.beamWidth,
    maxAddressFetches: args.maxAddressFetches,
    maxEdgesPerAddress: args.maxEdgesPerAddress
  });

  console.log(`Subject: ${report.subjectAddress}`);
  console.log(`Window: ${args.windowStart.toISOString()} -> ${args.windowEnd.toISOString()}`);
  console.log(`Current USDT balance: ${formatRawUsdt(report.currentUsdtBalanceRaw)}`);
  console.log(`Balance-forming transfers: ${report.coverage.selectedInboundTxCount} txs, covering ${formatPercent(report.coverage.currentBalanceCoverageRatio)} of current balance`);
  console.log(`Decision: ${report.decision}`);
  console.log(`Risk: ${report.riskScore}/100 ${levelFromScore(report.riskScore)}`);
  console.log("");
  console.log("Main reasons:");
  if (report.decisionReasons.length === 0) {
    console.log("- none");
  }
  for (const reason of report.decisionReasons) {
    console.log(`- ${reason}`);
  }

  console.log("");
  console.log("Balance-forming transfers:");
  if (report.balanceFormingTransfers.length === 0) {
    console.log("- none");
  }
  for (const transfer of report.balanceFormingTransfers) {
    console.log(`- ${transfer.txHash} | ${transfer.fromAddress} -> ${transfer.toAddress} | ${formatRawUsdt(transfer.amountRaw)} | share ${formatPercent(transfer.coverageShare)}`);
  }

  console.log("");
  console.log("Origin paths:");
  if (report.originPaths.length === 0) {
    console.log("- none");
  }
  for (const path of report.originPaths) {
    console.log(`- ${path.verdict} | ${path.riskScoreContribution}/100 | ${path.stoppedReason}`);
    console.log(`  path: ${path.pathAddresses.join(" -> ")}`);
    console.log(`  tx: ${path.txHashes.join(" -> ")}`);
    console.log(`  preservation: ${formatPercent(path.amountPreservationRatio)}`);
  }

  console.log("");
  console.log("Fast wallet check:");
  if (!report.fastWalletRisk) {
    console.log("- not available");
  } else {
    console.log(`- ${report.fastWalletRisk.score}/100 ${report.fastWalletRisk.level}`);
    for (const reason of report.fastWalletRisk.reasons.slice(0, 5)) {
      console.log(`- ${reason.message}`);
    }
  }

  console.log("");
  console.log("Coverage:");
  console.log(`- partial: ${report.coverage.partial ? "yes" : "no"}`);
  console.log(`- max depth: ${report.coverage.maxDepth}`);
  console.log(`- fetched addresses: ${report.coverage.fetchedAddressCount}`);
  for (const note of report.coverage.notes) {
    console.log(`- ${note}`);
  }
} finally {
  await closeDb(db);
}
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run all targeted tests**

Run:

```bash
npm test -- tests/forensics/balanceFormingTransfers.test.ts tests/forensics/moneyOriginPolicy.test.ts tests/forensics/moneyOriginTrace.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/whereIsMoneyCliArgs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run a local CLI smoke test**

Run with an address that may or may not have local indexed data:

```bash
npm run forensic:where-is-money -- --source TUzXY779GY3Tm6UDRYDPqNEojZgZEpY127 --days 30 --depth 7 --beam 8 --max-addresses 60 --max-edges 40
```

Expected:

- Command exits successfully when database and TRON config are available.
- Output includes `Subject`, `Current USDT balance`, `Decision`, `Risk`, `Balance-forming transfers`, `Origin paths`, and `Coverage`.
- If indexed data is empty, output says no balance-forming paths are available through the `REVIEW` decision and coverage notes.
- Output does not contain `confirmed scam`, `fraud proven`, or `black wallet`.

- [ ] **Step 6: Commit CLI**

Run:

```bash
git add package.json scripts/forensicWhereIsMoney.ts
git commit -m "feat: add where-is-money forensic CLI"
```

Expected: commit succeeds.

---

### Task 7: Full Verification

**Files:**
- No production file changes unless verification exposes a defect.

- [ ] **Step 1: Run targeted test suite**

Run:

```bash
npm test -- tests/forensics/balanceFormingTransfers.test.ts tests/forensics/moneyOriginPolicy.test.ts tests/forensics/moneyOriginTrace.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/whereIsMoneyCliArgs.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run related forensic tests**

Run:

```bash
npm test -- tests/forensics/serviceClassifier.test.ts tests/forensics/multiHopBoundaryExposure.test.ts tests/check/deepForensicCheck.test.ts tests/risk/riskPolicy.test.ts tests/risk/riskEngine.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Check report wording**

Run:

```bash
npm run forensic:where-is-money -- --source TUzXY779GY3Tm6UDRYDPqNEojZgZEpY127 --days 30 --depth 7 --beam 8 --max-addresses 60 --max-edges 40
```

Then inspect the output. Expected:

- Service-boundary decline wording says `exchange-policy decline source`.
- Service-boundary decline wording says public-chain continuity should not be assumed.
- Output does not say `confirmed scam`, `fraud proven`, or `black wallet`.
- Output may say `blacklisted` only when the fast wallet check reports official TRON USDT blacklist state.

- [ ] **Step 6: Final status**

Run:

```bash
git status --short
```

Expected:

- No unstaged implementation files remain.
- Unrelated pre-existing untracked files, such as `.codegraph/`, may still appear and should not be committed by this feature.

---

## Self-Review

Spec coverage:

- Hybrid mode: Task 4 composes fast wallet risk and balance-origin trace.
- Current balance target: Task 1 selects transfers against `currentBalanceRaw`; Task 4 fetches the balance.
- Balance-forming approximation: Task 4 adds the coverage note; Task 6 prints it.
- Bridge/router/DEX automatic decline: Task 2 policy and Task 3 trace tests.
- HTX/Huobi automatic decline: Task 2 identity policy.
- WhiteBIT automatic decline: Task 2 label policy and Task 3 trace test.
- Clean EOA chains from allowlisted CEX: Task 3 multi-hop acceptable test.
- No hop-count risk by itself: Task 3 accepts `Binance -> B -> C -> D -> subject`.
- Incomplete clean EOA chain: Task 3 depth cap review test.
- Ignore older unrelated inflows: Task 4 orchestrator test checks old sender is not traced.
- CLI rollout: Task 5 and Task 6.

Placeholder scan:

- The plan names exact files, commands, expected outputs, and concrete code blocks.
- There are no `TBD`, `TODO`, or unspecified implementation steps.

Type consistency:

- `ExchangeDecision`, `BalanceFormingTransfer`, `BalanceFormingSelection`, `MoneyOriginPath`, and `WhereIsMoneyReport` are defined in `src/types.ts` before modules import them.
- `runWhereIsMoneyCheck` depends on `ForensicRouteEdge` fetchers, matching existing `indexedTransferToRouteEdge`.
- CLI uses existing repository functions and `TronscanClient.getUsdtRestrictionStatus` for live balance.

