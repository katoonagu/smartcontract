# Phase 9.3 Approval Session Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only temporal session context for TRON USDT approvals so swap/helper approvals linked to Bridgers/SunSwap-style routes are shown as `MEDIUM service-linked helper approval` instead of isolated drainer-like `HIGH review`.

**Architecture:** Keep the existing Approval Guard pipeline. Add one pure session-context detector, fetch nearby wallet transactions/transfers inside the approval worker, pass session context into approval risk evaluation, and store session context as `raw_evidence` + `risk_signal_observations`. Do not add a new DB table in v1.

**Tech Stack:** TypeScript, Vitest, PostgreSQL repositories, TronScan API client, existing `raw_evidence` / `risk_signal_observations` storage.

---

### Task 1: Add Pure Approval Session Context Detector

**Files:**
- Create: `src/approvals/sessionContext.ts`
- Test: `tests/approvals/sessionContext.test.ts`

- [ ] **Step 1: Write failing tests for route-linked, no-route, and collector cases**

Create `tests/approvals/sessionContext.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildApprovalSessionContext } from "../../src/approvals/sessionContext";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { ApprovalGuardEvent } from "../../src/approvals/approvalRisk";

const wallet = "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe";
const spender = "TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5";
const routeTx = "route-tx";

function approval(overrides: Partial<ApprovalGuardEvent> = {}): ApprovalGuardEvent {
  return {
    txHash: "approval-tx",
    ownerAddress: wallet,
    spenderAddress: spender,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    isUnlimited: true,
    timestamp: new Date("2026-05-05T13:42:21.000Z"),
    spenderType: "contract",
    signedAt: new Date("2026-05-05T13:42:19.000Z"),
    expirationAt: new Date("2026-05-05T13:52:19.000Z"),
    refBlockBytes: "abcd",
    refBlockHash: "1234",
    ...overrides
  };
}

describe("buildApprovalSessionContext", () => {
  it("classifies unverified helper approvals as service-linked when a nearby swap route is present", () => {
    const context = buildApprovalSessionContext({
      watchedWalletId: "wallet-1",
      approval: approval(),
      relatedTransfers: [
        {
          transaction_id: routeTx,
          from_address: wallet,
          to_address: "TUrnbc11111111111111111111111111111",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          quant: "100000000",
          confirmed: true,
          contractRet: "SUCCESS",
          finalResult: "SUCCESS",
          status: 0,
          tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20", tokenAbbr: "USDT", tokenDecimal: 6 },
          block_ts: Date.parse("2026-05-05T13:42:27.000Z")
        }
      ],
      transactionDetails: new Map([
        [
          routeTx,
          {
            ownerAddress: wallet,
            trigger_info: { methodName: "swap", methodId: "swap" },
            contractData: { owner_address: wallet },
            contractRet: "SUCCESS"
          }
        ]
      ]),
      addressMetadata: new Map([
        [
          "TUrnbc11111111111111111111111111111",
          {
            address: "TUrnbc11111111111111111111111111111",
            source: "tronscan",
            name: "UniV3Adapter",
            tag: "SunSwap Router",
            isContract: true,
            verified: true,
            accountType: 2,
            rawJson: {},
            fetchedAt: new Date(),
            expiresAt: new Date()
          }
        ]
      ]),
      now: new Date("2026-05-23T00:00:00.000Z")
    });

    expect(context.classification).toBe("service_linked_helper");
    expect(context.scoreImpact).toBe(-35);
    expect(context.linkedRouteTxHash).toBe(routeTx);
    expect(context.reasons.map((reason) => reason.code)).toContain("approval_temporally_linked_to_known_swap");
    expect(context.rawEvidence[0].evidenceJson).toMatchObject({
      approvalTxHash: "approval-tx",
      signedToBlockDelayMs: 2000,
      refBlockBytes: "abcd",
      refBlockHash: "1234"
    });
  });

  it("classifies missing route evidence as no_route_found without dampening", () => {
    const context = buildApprovalSessionContext({
      watchedWalletId: "wallet-1",
      approval: approval(),
      relatedTransfers: [],
      transactionDetails: new Map(),
      addressMetadata: new Map(),
      now: new Date("2026-05-23T00:00:00.000Z")
    });

    expect(context.classification).toBe("no_route_found");
    expect(context.scoreImpact).toBe(0);
    expect(context.reasons.map((reason) => reason.code)).toEqual(["approval_session_no_route_found"]);
  });

  it("classifies transfer to unknown non-service receiver as possible collector drain", () => {
    const context = buildApprovalSessionContext({
      watchedWalletId: "wallet-1",
      approval: approval(),
      relatedTransfers: [
        {
          transaction_id: "collector-tx",
          from_address: wallet,
          to_address: "TCollector111111111111111111111111111",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          quant: "50000000000",
          confirmed: true,
          contractRet: "SUCCESS",
          finalResult: "SUCCESS",
          status: 0,
          tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20", tokenAbbr: "USDT", tokenDecimal: 6 },
          block_ts: Date.parse("2026-05-05T13:42:27.000Z")
        }
      ],
      transactionDetails: new Map([["collector-tx", { ownerAddress: spender, trigger_info: { methodName: "transferFrom" } }]]),
      addressMetadata: new Map(),
      now: new Date("2026-05-23T00:00:00.000Z")
    });

    expect(context.classification).toBe("possible_collector_drain");
    expect(context.scoreImpact).toBe(35);
    expect(context.reasons.map((reason) => reason.code)).toContain("approval_session_possible_collector_drain");
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/approvals/sessionContext.test.ts
```

Expected: fail because `src/approvals/sessionContext.ts` does not exist.

- [ ] **Step 3: Implement the pure detector**

Create `src/approvals/sessionContext.ts`:

```ts
import { createHash } from "node:crypto";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type { AddressMetadata } from "../storage/repositories";
import type { RawEvidenceInput, RiskReason, RiskSignalObservationInput } from "../types";
import type { ApprovalGuardEvent } from "./approvalRisk";

export const APPROVAL_SESSION_CONTEXT_POLICY_VERSION = "2026-05-23-approval-session-context-v1";
const DEFAULT_LOOKBACK_MS = 2 * 60 * 1000;
const DEFAULT_LOOKAHEAD_MS = 10 * 60 * 1000;

export type ApprovalSessionClassification =
  | "known_swap_route"
  | "service_linked_helper"
  | "no_route_found"
  | "possible_collector_drain";

export type ApprovalSessionContext = {
  classification: ApprovalSessionClassification;
  linkedRouteTxHash: string | null;
  routeServiceTags: string[];
  scoreImpact: number;
  reasons: RiskReason[];
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
};

export type ApprovalSessionContextInput = {
  watchedWalletId: string;
  approval: ApprovalGuardEvent;
  relatedTransfers: RawTronscanTrc20Transfer[];
  transactionDetails: Map<string, unknown>;
  addressMetadata: Map<string, AddressMetadata | null>;
  now: Date;
  lookbackMs?: number;
  lookaheadMs?: number;
};

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function reason(code: string, message: string, scoreImpact: number): RiskReason {
  return {
    code,
    message,
    scoreImpact,
    source: "approval_session_context",
    confidence: Math.abs(scoreImpact) >= 30 ? "high" : "medium",
    severity: scoreImpact >= 35 ? "medium" : "info"
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function lowerText(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function transferTimestamp(transfer: RawTronscanTrc20Transfer): Date | null {
  if (typeof transfer.block_ts !== "number" || !Number.isFinite(transfer.block_ts)) return null;
  const date = new Date(transfer.block_ts);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSuccessfulUsdtTransfer(transfer: RawTronscanTrc20Transfer): boolean {
  if (transfer.contract_address !== TRON_USDT_CONTRACT_ADDRESS && transfer.tokenInfo?.tokenId !== TRON_USDT_CONTRACT_ADDRESS) return false;
  if (transfer.confirmed !== true) return false;
  if (transfer.revert === true) return false;
  if (transfer.contractRet && transfer.contractRet !== "SUCCESS") return false;
  if (transfer.finalResult && transfer.finalResult !== "SUCCESS") return false;
  if (transfer.status !== undefined && transfer.status !== 0 && transfer.status !== "0" && transfer.status !== "SUCCESS") return false;
  return true;
}

function isInsideWindow(approval: ApprovalGuardEvent, transfer: RawTronscanTrc20Transfer, lookbackMs: number, lookaheadMs: number): boolean {
  const at = transferTimestamp(transfer);
  if (!at) return false;
  return at.getTime() >= approval.timestamp.getTime() - lookbackMs && at.getTime() <= approval.timestamp.getTime() + lookaheadMs;
}

function methodText(transactionInfo: unknown): string {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : {};
  const trigger = isObjectRecord(tx.trigger_info) ? tx.trigger_info : {};
  const contractData = isObjectRecord(tx.contractData) ? tx.contractData : {};
  return lowerText(
    stringField(trigger.methodName),
    stringField(trigger.method),
    stringField(trigger.methodId),
    stringField(contractData.function_selector)
  );
}

function serviceTag(metadata: AddressMetadata | null | undefined): string | null {
  if (!metadata) return null;
  const text = lowerText(metadata.name, metadata.tag);
  const serviceKeywords = ["bridgers", "cross-chain", "cross chain", "sunswap", "sun swap", "wtrx", "univ3", "adapter", "router", "proxy", "swap", "bridge", "pool"];
  return serviceKeywords.some((keyword) => text.includes(keyword)) ? (metadata.tag ?? metadata.name ?? "service") : null;
}

function hasRouteMethod(transactionInfo: unknown): boolean {
  const text = methodText(transactionInfo);
  return ["swap", "bridge", "withdraw", "deposit", "route", "router", "proxy"].some((keyword) => text.includes(keyword));
}

function evidenceIdFor(input: ApprovalSessionContextInput): string {
  return stableId(["approval_session_context_raw", input.watchedWalletId, input.approval.txHash, APPROVAL_SESSION_CONTEXT_POLICY_VERSION]);
}

function observationIdFor(input: ApprovalSessionContextInput, code: string): string {
  return stableId(["approval_session_context_observation", input.watchedWalletId, input.approval.txHash, code, APPROVAL_SESSION_CONTEXT_POLICY_VERSION]);
}

function signingDelayMs(approval: ApprovalGuardEvent): number | null {
  if (!approval.signedAt) return null;
  const delay = approval.timestamp.getTime() - approval.signedAt.getTime();
  return delay >= 0 ? delay : null;
}

function expirationMs(approval: ApprovalGuardEvent): number | null {
  if (!approval.signedAt || !approval.expirationAt) return null;
  const value = approval.expirationAt.getTime() - approval.signedAt.getTime();
  return value >= 0 ? value : null;
}

export function buildApprovalSessionContext(input: ApprovalSessionContextInput): ApprovalSessionContext {
  const lookbackMs = input.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const lookaheadMs = input.lookaheadMs ?? DEFAULT_LOOKAHEAD_MS;
  const nearby = input.relatedTransfers.filter(
    (transfer) =>
      isSuccessfulUsdtTransfer(transfer) &&
      transfer.from_address === input.approval.ownerAddress &&
      isInsideWindow(input.approval, transfer, lookbackMs, lookaheadMs)
  );

  let classification: ApprovalSessionClassification = "no_route_found";
  let linkedRouteTxHash: string | null = null;
  let scoreImpact = 0;
  const routeServiceTags = new Set<string>();
  const reasons: RiskReason[] = [];

  for (const transfer of nearby) {
    const metadata = input.addressMetadata.get(transfer.to_address) ?? null;
    const tag = serviceTag(metadata);
    const txInfo = input.transactionDetails.get(transfer.transaction_id);
    const routeLike = tag !== null || hasRouteMethod(txInfo);

    if (routeLike && transfer.to_address !== input.approval.spenderAddress) {
      classification = "service_linked_helper";
      linkedRouteTxHash = transfer.transaction_id;
      scoreImpact = -35;
      if (tag) routeServiceTags.add(tag);
      reasons.push(
        reason(
          "approval_temporally_linked_to_known_swap",
          "Approval appears linked to a nearby swap/bridge route through service or adapter infrastructure",
          -35
        )
      );
      break;
    }
  }

  if (classification === "no_route_found") {
    const collector = nearby.find((transfer) => {
      const metadata = input.addressMetadata.get(transfer.to_address) ?? null;
      const txInfo = input.transactionDetails.get(transfer.transaction_id);
      return serviceTag(metadata) === null && !hasRouteMethod(txInfo);
    });

    if (collector) {
      classification = "possible_collector_drain";
      linkedRouteTxHash = collector.transaction_id;
      scoreImpact = 35;
      reasons.push(
        reason(
          "approval_session_possible_collector_drain",
          "Nearby USDT movement after approval goes to a non-service receiver; review as possible collector flow",
          35
        )
      );
    } else {
      reasons.push(reason("approval_session_no_route_found", "No nearby swap/bridge route evidence found for this approval", 0));
    }
  }

  const rawEvidenceId = evidenceIdFor(input);
  const rawEvidence: RawEvidenceInput[] = [
    {
      id: rawEvidenceId,
      source: "approval_session_context",
      sourceType: "detector_output",
      chain: "tron",
      address: input.approval.spenderAddress,
      txHash: input.approval.txHash,
      observedTransactionHash: linkedRouteTxHash ?? input.approval.txHash,
      evidenceJson: {
        policyVersion: APPROVAL_SESSION_CONTEXT_POLICY_VERSION,
        watchedWalletId: input.watchedWalletId,
        approvalTxHash: input.approval.txHash,
        ownerAddress: input.approval.ownerAddress,
        spenderAddress: input.approval.spenderAddress,
        approvalAt: input.approval.timestamp.toISOString(),
        signedAt: input.approval.signedAt?.toISOString() ?? null,
        expirationAt: input.approval.expirationAt?.toISOString() ?? null,
        signedToBlockDelayMs: signingDelayMs(input.approval),
        signingExpirationMs: expirationMs(input.approval),
        refBlockBytes: input.approval.refBlockBytes ?? null,
        refBlockHash: input.approval.refBlockHash ?? null,
        lookbackMs,
        lookaheadMs,
        classification,
        linkedRouteTxHash,
        routeServiceTags: [...routeServiceTags],
        nearbyTransferTxHashes: nearby.map((transfer) => transfer.transaction_id)
      }
    }
  ];

  const observations: RiskSignalObservationInput[] = reasons.map((item) => ({
    id: observationIdFor(input, item.code),
    subjectChain: "tron",
    subjectAddress: input.approval.spenderAddress,
    subjectTxHash: input.approval.txHash,
    observedTransactionHash: linkedRouteTxHash ?? input.approval.txHash,
    signalGroup: "approval",
    code: item.code,
    message: item.message,
    scoreImpact: item.scoreImpact,
    confidence: item.confidence ?? "medium",
    severity: item.severity ?? "info",
    source: "approval_session_context",
    policyVersion: APPROVAL_SESSION_CONTEXT_POLICY_VERSION,
    rawEvidenceId
  }));

  return {
    classification,
    linkedRouteTxHash,
    routeServiceTags: [...routeServiceTags],
    scoreImpact,
    reasons,
    rawEvidence,
    observations
  };
}
```

- [ ] **Step 4: Run detector tests**

Run:

```bash
npm test -- tests/approvals/sessionContext.test.ts
```

Expected: all tests pass.

---

### Task 2: Integrate Session Context Into Approval Risk Scoring

**Files:**
- Modify: `src/approvals/approvalRisk.ts`
- Test: `tests/approvals/approvalRisk.test.ts`

- [ ] **Step 1: Add failing risk policy tests**

Append to `tests/approvals/approvalRisk.test.ts`:

```ts
import type { ApprovalSessionContext } from "../../src/approvals/sessionContext";
```

If the file already has imports at top, merge the import there. Then add tests inside `describe("evaluateApprovalRisk", ...)`:

```ts
  it("dampens unknown drainer contract review to MEDIUM when linked to a known swap route", () => {
    const sessionContext: ApprovalSessionContext = {
      classification: "service_linked_helper",
      linkedRouteTxHash: "route-tx",
      routeServiceTags: ["SunSwap Router"],
      scoreImpact: -35,
      reasons: [
        {
          code: "approval_temporally_linked_to_known_swap",
          message: "Approval appears linked to a nearby swap/bridge route through service or adapter infrastructure",
          scoreImpact: -35,
          source: "approval_session_context",
          confidence: "high",
          severity: "info"
        }
      ],
      rawEvidence: [],
      observations: []
    };

    const evaluation = evaluateApprovalRisk({
      event: event({ spenderType: "contract" }),
      spenderLabels: [],
      providerMetadata: {
        name: "tokenApprove",
        tag: null,
        isContract: true,
        verified: true,
        providerRisk: false,
        accountType: 2,
        contractCreatedAt: new Date("2025-07-01T10:07:30.000Z")
      },
      contractProfile: {
        name: "tokenApprove",
        serviceTag: null,
        publicTag: null,
        publicTagDesc: null,
        verified: false,
        providerRisk: false,
        trxCount: "2",
        totalCallCount: null,
        uniqueCallerCount: null,
        topMethods: [],
        methodMap: {},
        hasTransferFromSelector: true,
        hasOwnerOnlyPattern: true,
        lowMetadata: true,
        activityLevel: "low"
      },
      sessionContext
    });

    expect(evaluation.report.level).toBe("MEDIUM");
    expect(evaluation.report.score).toBe(35);
    expect(evaluation.report.reasons.map((reason) => reason.code)).toContain("approval_temporally_linked_to_known_swap");
  });

  it("keeps possible collector session context as HIGH/CRITICAL evidence", () => {
    const sessionContext: ApprovalSessionContext = {
      classification: "possible_collector_drain",
      linkedRouteTxHash: "collector-tx",
      routeServiceTags: [],
      scoreImpact: 35,
      reasons: [
        {
          code: "approval_session_possible_collector_drain",
          message: "Nearby USDT movement after approval goes to a non-service receiver; review as possible collector flow",
          scoreImpact: 35,
          source: "approval_session_context",
          confidence: "high",
          severity: "medium"
        }
      ],
      rawEvidence: [],
      observations: []
    };

    const evaluation = evaluateApprovalRisk({
      event: event({ spenderType: "contract" }),
      spenderLabels: [],
      providerMetadata: {
        name: "tokenApprove",
        tag: null,
        isContract: true,
        verified: false,
        providerRisk: false,
        accountType: 2,
        contractCreatedAt: new Date("2025-07-01T10:07:30.000Z")
      },
      sessionContext
    });

    expect(evaluation.report.level).toBe("HIGH");
    expect(evaluation.report.reasons.map((reason) => reason.code)).toContain("approval_session_possible_collector_drain");
  });
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/approvals/approvalRisk.test.ts
```

Expected: fail because `sessionContext` is not accepted by `evaluateApprovalRisk`.

- [ ] **Step 3: Extend `evaluateApprovalRisk` input and scoring**

In `src/approvals/approvalRisk.ts`:

```ts
import type { ApprovalSessionContext } from "./sessionContext";
```

Add to input type:

```ts
sessionContext?: ApprovalSessionContext | null;
```

After existing `contractIntelligenceReasons(contractProfile)` and before signing delay reasons, add:

```ts
  const sessionContext = input.sessionContext ?? null;
  if (!hasTrustedLabel && sessionContext) {
    reasons.push(...sessionContext.reasons);
  }
```

In raw evidence JSON add:

```ts
        sessionContext: sessionContext
          ? {
              classification: sessionContext.classification,
              linkedRouteTxHash: sessionContext.linkedRouteTxHash,
              routeServiceTags: sessionContext.routeServiceTags,
              scoreImpact: sessionContext.scoreImpact
            }
          : null,
```

Leave `shouldAlert: true` unchanged from Phase 9.2.1.

- [ ] **Step 4: Run approval risk tests**

Run:

```bash
npm test -- tests/approvals/approvalRisk.test.ts
```

Expected: all approval risk tests pass.

---

### Task 3: Fetch Session Context Inputs In Approval Worker

**Files:**
- Modify: `src/approvals/approvalWorker.ts`
- Test: `tests/approvals/approvalWorker.test.ts`

- [ ] **Step 1: Add failing worker test for tokenApprove route-linked dampening**

Add to `tests/approvals/approvalWorker.test.ts`:

```ts
  it("dampens tokenApprove-like approvals when nearby transfer is linked to service route", async () => {
    const routeTxHash = "route-tx";
    const routeReceiver = "TUrnbc11111111111111111111111111111";
    const ctx = createDeps({
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval({ spenderIsContract: null })], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange({ timestamp: new Date("2026-05-05T13:42:21.000Z") })];
        },
        async getAddressMetadata(address: string) {
          if (address === spenderAddress) {
            return {
              address,
              name: "tokenApprove",
              tag: null,
              isContract: true,
              verified: true,
              accountType: 2,
              source: "tronscan" as const,
              rawJson: { contractSearch: { name: "tokenApprove", risk: false, verifyStatus: false } }
            };
          }
          return {
            address,
            name: "UniV3Adapter",
            tag: "SunSwap Router",
            isContract: true,
            verified: true,
            accountType: 2,
            source: "tronscan" as const,
            rawJson: {}
          };
        },
        async getContractIntelligenceProfile() {
          return {
            contractAddress: spenderAddress,
            providerTags: [],
            publicTags: [],
            isVerified: false,
            verifyStatus: 0,
            sourceStatus: null,
            contractAgeDays: null,
            txCount: "2",
            recentCallCount: null,
            totalCallerCount: null,
            rawPayload: {},
            address: spenderAddress,
            source: "tronscan",
            name: "tokenApprove",
            serviceTag: null,
            publicTag: null,
            publicTagDesc: null,
            tagUrl: null,
            verified: false,
            providerRisk: false,
            contractCreatedAt: null,
            trxCount: "2",
            totalCallCount: null,
            uniqueCallerCount: null,
            topMethods: [],
            topCallers: [],
            methodMap: {},
            hasTransferFromSelector: true,
            hasOwnerOnlyPattern: true,
            lowMetadata: true,
            activityLevel: "low",
            rawJson: {},
            fetchedAt: new Date(),
            expiresAt: new Date()
          };
        },
        async listRelatedTrc20Transfers() {
          return [
            {
              transaction_id: routeTxHash,
              from_address: ownerAddress,
              to_address: routeReceiver,
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              quant: "100000000",
              confirmed: true,
              contractRet: "SUCCESS",
              finalResult: "SUCCESS",
              status: 0,
              tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenDecimal: 6, tokenType: "trc20" },
              block_ts: Date.parse("2026-05-05T13:42:27.000Z")
            }
          ];
        },
        async getTransaction(txHash: string) {
          if (txHash === routeTxHash) {
            return {
              ownerAddress,
              trigger_info: { methodName: "swap", methodId: "swap" },
              contractData: { owner_address: ownerAddress }
            };
          }
          return { ownerAddress: spenderAddress, trigger_info: { methodName: "transferFrom", methodId: "23b872dd" } };
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.currentApprovals[0]).toMatchObject({
      spenderType: "contract",
      riskLevel: "MEDIUM",
      riskScore: 35
    });
    expect(ctx.evidence.flatMap((entry) => entry.observations.map((observation) => observation.code))).toContain(
      "approval_temporally_linked_to_known_swap"
    );
    expect(ctx.sentOwnerMessages[0]).toContain("Risk score: 35/100 (MEDIUM)");
  });
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- tests/approvals/approvalWorker.test.ts -t "dampens tokenApprove-like approvals"
```

Expected: fail because worker does not build session context.

- [ ] **Step 3: Add session context collection helper**

In `src/approvals/approvalWorker.ts`, import:

```ts
import { buildApprovalSessionContext, type ApprovalSessionContext } from "./sessionContext";
```

Add helper near `observeApprovalDrainShadow`:

```ts
async function resolveApprovalSessionContext(
  wallet: WatchedWallet,
  event: ApprovalGuardEvent,
  deps: ApprovalPollingCycleDeps
): Promise<ApprovalSessionContext | null> {
  if (!deps.tronClient.listRelatedTrc20Transfers || !deps.tronClient.getTransaction) return null;

  try {
    const relatedTransfers = await deps.tronClient.listRelatedTrc20Transfers(wallet.address, {
      start: 0,
      limit: deps.pageLimit,
      minTimestamp: event.timestamp.getTime() - 2 * 60 * 1000,
      endTimestamp: event.timestamp.getTime() + 10 * 60 * 1000
    });
    const transactionDetails = new Map<string, unknown>();
    const addressMetadata = new Map<string, AddressMetadata | null>();

    for (const transfer of relatedTransfers) {
      if (!transactionDetails.has(transfer.transaction_id)) {
        transactionDetails.set(transfer.transaction_id, await deps.tronClient.getTransaction(transfer.transaction_id));
      }
      if (!addressMetadata.has(transfer.to_address)) {
        addressMetadata.set(transfer.to_address, await resolveAddressMetadata(transfer.to_address, deps));
      }
    }

    return buildApprovalSessionContext({
      watchedWalletId: wallet.id,
      approval: event,
      relatedTransfers,
      transactionDetails,
      addressMetadata,
      now: (deps.now ?? (() => new Date()))()
    });
  } catch (error) {
    (deps.logger ?? defaultLogger).warn("approval_session_context_fetch_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      approval_tx_hash: event.txHash,
      spender_address: event.spenderAddress,
      error: errorMessage(error)
    });
    return null;
  }
}
```

- [ ] **Step 4: Pass session context into risk evaluation and persist evidence**

In `processApproval`, after creating `event` and before `evaluateApprovalRisk`, add:

```ts
  const sessionContext = await resolveApprovalSessionContext(wallet, event, deps);
```

Pass it:

```ts
    sessionContext
```

When calling `deps.recordRiskEvaluation`, include session context evidence:

```ts
      rawEvidence: [...evaluation.rawEvidence, ...(sessionContext?.rawEvidence ?? [])],
      observations: [...evaluation.observations, ...(sessionContext?.observations ?? [])]
```

- [ ] **Step 5: Run worker tests**

Run:

```bash
npm test -- tests/approvals/approvalWorker.test.ts
```

Expected: all worker tests pass.

---

### Task 4: Improve Approval Alert And Safety Wording For Service-Linked Helpers

**Files:**
- Modify: `src/alerts/formatters.ts`
- Modify: `src/bot/messages.ts`
- Test: `tests/alerts/formatters.test.ts`
- Test: `tests/bot/messages.test.ts`

- [ ] **Step 1: Add message formatter test**

In `tests/alerts/formatters.test.ts`, add a case where `report.reasons` contains `approval_temporally_linked_to_known_swap` and assert:

```ts
expect(text).toContain("This approval appears connected to a swap/bridge route");
expect(text).toContain("Review/revoke if unexpected or no longer needed.");
```

- [ ] **Step 2: Update user approval formatter**

In `src/alerts/formatters.ts`, inside `formatUserApprovalAlert`, detect:

```ts
const serviceLinked = input.report.reasons.some((reason) => reason.code === "approval_temporally_linked_to_known_swap");
```

Use this meaning text:

```ts
const meaning = serviceLinked
  ? "Meaning: this approval appears connected to a swap/bridge route, but the spender is unverified or untagged. Review/revoke if unexpected or no longer needed."
  : "Meaning: active USDT allowance was found on-chain. This is not proof of theft.";
```

Ensure the message still includes existing revoke instruction and buttons are unchanged.

- [ ] **Step 3: Add Safety screen test**

In `tests/bot/messages.test.ts`, add a `WalletApproval` item with reason code `approval_temporally_linked_to_known_swap` and assert the Safety message contains:

```ts
expect(text).toContain("Session: linked to swap/bridge route");
```

- [ ] **Step 4: Update Safety screen formatting**

In `src/bot/messages.ts`, when rendering approval rows, add:

```ts
const sessionLinked = approval.riskReasons.some((reason) => reason.code === "approval_temporally_linked_to_known_swap");
```

Append to the row:

```ts
sessionLinked ? "Session: linked to swap/bridge route" : "Session: no service route found"
```

Only show this session line for approvals with `riskLevel !== "LOW"` or when the reason exists, to avoid clutter for normal low-risk approvals.

- [ ] **Step 5: Run formatter and bot message tests**

Run:

```bash
npm test -- tests/alerts/formatters.test.ts tests/bot/messages.test.ts
```

Expected: all tests pass.

---

### Task 5: Recheck Integration And Regression Verification

**Files:**
- Modify only if tests expose a missed dependency: `src/approvals/safetyRecheck.ts`
- Test: `tests/approvals/safetyRecheck.test.ts`

- [ ] **Step 1: Add safety recheck test for session context evidence**

Extend `tests/approvals/safetyRecheck.test.ts` with a fake Tron client that returns a route-linked transfer and assert:

```ts
expect(summary.riskRowsUpdated).toBe(1);
expect(queries.some((query) => JSON.stringify(query.params).includes("approval_temporally_linked_to_known_swap"))).toBe(true);
```

- [ ] **Step 2: Run safety recheck tests**

Run:

```bash
npm test -- tests/approvals/safetyRecheck.test.ts
```

Expected: pass. If it fails because `runSafetyRecheck` did not provide `listRelatedTrc20Transfers` or `getTransaction`, fix the test fake first; `runSafetyRecheck` already passes through the provided Tron client.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run typecheck
npm test
```

Expected:

- TypeScript passes.
- Vitest passes.
- Existing Approval Guard tests still prove:
  - Bridgers service tag stays LOW.
  - unknown helper without route evidence stays HIGH review.
  - unknown EOA confirmed drain remains CRITICAL.
  - `safety:recheck` does not send owner/customer alerts.

---

### Task 6: Manual Smoke

**Files:**
- No code changes.

- [ ] **Step 1: Restart bot**

Stop the existing `tsx src/index.ts` process and start:

```bash
npm run dev
```

- [ ] **Step 2: Recheck known wallets**

Run:

```bash
npm run safety:recheck -- --wallet TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe
npm run safety:recheck -- --wallet TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d --tx aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2
```

Expected:

- `TLhV... -> TPwez... Bridgers`: LOW.
- `TLhV... -> TNKG... tokenApprove`: MEDIUM with route-linked/session reason if TronScan returns nearby route data.
- `TDwx... -> TMou... EOA`: CRITICAL with delayed signed transaction evidence.

- [ ] **Step 3: Telegram smoke**

Remove/re-add the test wallets or use fresh wallets with known approvals.

Expected:

- All approval alerts still arrive once because Phase 9.2.1 sends all levels.
- Route-linked helper text says review/revoke if unexpected, not scam proof.
- Revoke buttons still open TronScan approvals.
