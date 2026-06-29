# Admin DeepCheck Contract-Driven Evidence Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DeepCheck, Where Is Money, and the admin graph show contract-driven USDT movement, repeated transfer evidence, reciprocal flows, wallet roles, and service boundaries honestly instead of making every connection look like a normal wallet-to-wallet transfer.

**Architecture:** Add one small pure classifier for contract-driven evidence and victim-like source activity, then project that metadata into the existing admin graph model. Keep the current vanilla admin UI and SVG graph; improve labels, right-rail details, grouped transfer drawers, and role marks without introducing React or a new graph library.

**Tech Stack:** TypeScript, Vitest, existing admin SVG/HTML console, existing forensic job JSON payloads, existing TRON/Tronscan links.

---

## Scope

This plan implements the accepted product direction from:

- `docs/superpowers/specs/2026-06-28-admin-deepcheck-evidence-map-v1-design.md`
- `docs/superpowers/specs/2026-06-28-admin-deepcheck-transaction-grouping-and-circular-flow-design.md`
- `docs/superpowers/specs/2026-06-29-admin-wallet-entity-role-classification-design.md`

It also adds the latest clarified rules:

- `Verify20(token, from, to, amount)` is not automatically a drainer by method name alone.
- `Verify20 + from/to/amount + one receiver collector + many source wallets + no known service label + victim-like source dormancy` is a high-suspicion drainer-like campaign signal.
- If approval evidence is found before the drain transaction, classify that specific case as exact approval-drain.
- `permitTransfer` and `transferFrom` remain contextual signals. They need service identity, approval context, caller/spender, receiver behavior, and source behavior before they affect role/risk strongly.
- If a service/CEX/DEX/bridge/context edge has no real transaction or grouped transaction evidence, do not render it like money flow.
- Repeated real transactions between the same pair should be grouped only when they are same direction, same evidence type, same episode. A single tx is never a group.

## File Map

- Create: `src/forensics/contractDrivenEvidence.ts`
  - Pure classifier for receiver campaign level and source post-debit activity.
  - No network calls, no DB calls.

- Create: `tests/forensics/contractDrivenEvidence.test.ts`
  - Unit tests for `Verify20`, `permitTransfer`, `transferFrom`, receiver thresholds, and victim-like source activity.

- Modify: `src/admin/forensicsGraph.ts`
  - Project contract-driven evidence into graph nodes and edges.
  - Keep weak DEX/service hints from promoting plain wallets to service nodes.
  - Keep boundary/context-only edges out of money-flow evidence.
  - Preserve grouped transfer and reciprocal flow rules.

- Modify: `tests/admin/forensicsGraph.test.ts`
  - Graph projection tests for contract-driven scenes, grouped tx evidence, reciprocal flow, weak service classification, and context-only boundaries.

- Modify: `src/admin/adminConsole.ts`
  - Render contract-driven edges with clear English labels.
  - Show caller, spender/contract, source, receiver, tx hash, amount, time, and source activity in the right rail.
  - Improve expanded transfer drawer close behavior and human-readable time/gap.

- Modify: `tests/admin/adminConsole.test.ts`
  - UI string and helper tests for role marks, contract-driven wording, grouped transfers, drawer close control, and human time formatting.

---

## Task 1: Add Pure Contract-Driven Evidence Classifier

**Files:**
- Create: `src/forensics/contractDrivenEvidence.ts`
- Create: `tests/forensics/contractDrivenEvidence.test.ts`

- [ ] **Step 1: Write failing classifier tests**

Create `tests/forensics/contractDrivenEvidence.test.ts`:

```ts
import {
  classifyContractDrivenReceiver,
  classifySourcePostDebitActivity
} from "../../src/forensics/contractDrivenEvidence";

describe("contract-driven evidence classifier", () => {
  it("classifies dominant Verify20 receiver campaigns as likely drainer-like collectors", () => {
    const result = classifyContractDrivenReceiver({
      totalIncomingTxCount: 175,
      totalIncomingAmountRaw: "968500000000",
      contractDrivenIncomingTxCount: 168,
      contractDrivenIncomingAmountRaw: "959200000000",
      uniqueSourceCount: 168,
      dominantMethod: "Verify20",
      contractNames: ["VerifyAccount"],
      knownServiceIdentity: null,
      exactApprovalDrainCount: 1
    });

    expect(result.level).toBe("dominant_drainer_like_pattern");
    expect(result.primaryRole).toBe("drainer_receiver_collector");
    expect(result.evidenceStrength).toBe("hard");
    expect(result.label).toBe("Likely drainer campaign");
    expect(result.reasons).toContain("Verify20-like method with explicit source and receiver fields");
    expect(result.reasons).toContain("Exact approval-drain evidence exists in this receiver campaign");
  });

  it("does not mark one Verify20 transfer as drainer by method name alone", () => {
    const result = classifyContractDrivenReceiver({
      totalIncomingTxCount: 5,
      totalIncomingAmountRaw: "12000000000",
      contractDrivenIncomingTxCount: 1,
      contractDrivenIncomingAmountRaw: "1000000000",
      uniqueSourceCount: 1,
      dominantMethod: "Verify20",
      contractNames: ["VerifyAccount"],
      knownServiceIdentity: null,
      exactApprovalDrainCount: 0
    });

    expect(result.level).toBe("contract_driven_transfer");
    expect(result.primaryRole).toBe("collector");
    expect(result.evidenceStrength).toBe("context");
    expect(result.label).toBe("Contract-driven incoming");
  });

  it("keeps permitTransfer with known service identity as service context", () => {
    const result = classifyContractDrivenReceiver({
      totalIncomingTxCount: 224,
      totalIncomingAmountRaw: "5390000000000",
      contractDrivenIncomingTxCount: 5,
      contractDrivenIncomingAmountRaw: "314600000000",
      uniqueSourceCount: 5,
      dominantMethod: "permitTransfer",
      contractNames: ["GasFree"],
      knownServiceIdentity: "GasFree Account",
      exactApprovalDrainCount: 0
    });

    expect(result.level).toBe("contract_driven_service_context");
    expect(result.primaryRole).toBe("service_context");
    expect(result.evidenceStrength).toBe("context");
    expect(result.label).toBe("Service contract-driven flow");
  });

  it("marks no later USDT activity after a large smart-contract debit as victim-like", () => {
    const result = classifySourcePostDebitActivity({
      debitAmountRaw: "50100000000",
      laterIncomingAmountRaw: "0",
      laterOutgoingAmountRaw: "0",
      laterTxCount: 0,
      repeatedContractDrivenDebitToSameReceiver: false,
      checked: true
    });

    expect(result.status).toBe("victim_like_source");
    expect(result.victimLike).toBe(true);
    expect(result.label).toBe("No later USDT activity");
  });

  it("keeps tiny residual activity victim-like after a large smart-contract debit", () => {
    const result = classifySourcePostDebitActivity({
      debitAmountRaw: "50100000000",
      laterIncomingAmountRaw: "296000000",
      laterOutgoingAmountRaw: "296000000",
      laterTxCount: 2,
      repeatedContractDrivenDebitToSameReceiver: false,
      checked: true
    });

    expect(result.status).toBe("minor_residual_activity");
    expect(result.victimLike).toBe(true);
    expect(result.label).toBe("Only minor residual activity");
  });

  it("marks repeated tiny Verify20 collection after the first debit as victim-like residual collection", () => {
    const result = classifySourcePostDebitActivity({
      debitAmountRaw: "41400000000",
      laterIncomingAmountRaw: "47000000",
      laterOutgoingAmountRaw: "47000000",
      laterTxCount: 4,
      repeatedContractDrivenDebitToSameReceiver: true,
      checked: true
    });

    expect(result.status).toBe("repeated_residual_collection");
    expect(result.victimLike).toBe(true);
    expect(result.label).toBe("Repeated residual collection");
  });
});
```

- [ ] **Step 2: Run the new test and confirm failure**

Run:

```bash
npm test -- tests/forensics/contractDrivenEvidence.test.ts
```

Expected: fail because `src/forensics/contractDrivenEvidence.ts` does not exist.

- [ ] **Step 3: Create the classifier**

Create `src/forensics/contractDrivenEvidence.ts`:

```ts
export type ContractDrivenReceiverLevel =
  | "none"
  | "contract_driven_transfer"
  | "contract_driven_cluster"
  | "contract_driven_service_context"
  | "drainer_like_pattern"
  | "dominant_drainer_like_pattern";

export type ContractDrivenReceiverRole =
  | "unknown"
  | "collector"
  | "service_context"
  | "drainer_like_collector"
  | "drainer_receiver_collector";

export type ContractDrivenEvidenceStrength = "none" | "context" | "strong" | "hard";

export interface ContractDrivenReceiverInput {
  totalIncomingTxCount: number;
  totalIncomingAmountRaw: string | number | bigint | null | undefined;
  contractDrivenIncomingTxCount: number;
  contractDrivenIncomingAmountRaw: string | number | bigint | null | undefined;
  uniqueSourceCount: number;
  dominantMethod: string | null | undefined;
  contractNames?: string[];
  knownServiceIdentity?: string | null;
  exactApprovalDrainCount?: number;
}

export interface ContractDrivenReceiverClassification {
  level: ContractDrivenReceiverLevel;
  primaryRole: ContractDrivenReceiverRole;
  evidenceStrength: ContractDrivenEvidenceStrength;
  label: string;
  contractDrivenTxShare: number;
  contractDrivenAmountShare: number;
  reasons: string[];
}

export type SourcePostDebitActivityStatus =
  | "not_checked"
  | "victim_like_source"
  | "minor_residual_activity"
  | "repeated_residual_collection"
  | "active_after_debit";

export interface SourcePostDebitActivityInput {
  debitAmountRaw: string | number | bigint | null | undefined;
  laterIncomingAmountRaw: string | number | bigint | null | undefined;
  laterOutgoingAmountRaw: string | number | bigint | null | undefined;
  laterTxCount: number;
  repeatedContractDrivenDebitToSameReceiver: boolean;
  checked: boolean;
}

export interface SourcePostDebitActivityClassification {
  status: SourcePostDebitActivityStatus;
  victimLike: boolean;
  label: string;
  residualActivityRatio: number;
}

function rawToBigInt(value: string | number | bigint | null | undefined): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10000n / denominator) / 10000;
}

function methodLooksLikeVerify20(method: string | null | undefined): boolean {
  return typeof method === "string" && /verify20/i.test(method);
}

function methodLooksPermitLike(method: string | null | undefined): boolean {
  return typeof method === "string" && /permit|permitTransfer/i.test(method);
}

export function classifyContractDrivenReceiver(input: ContractDrivenReceiverInput): ContractDrivenReceiverClassification {
  const totalAmount = rawToBigInt(input.totalIncomingAmountRaw);
  const contractAmount = rawToBigInt(input.contractDrivenIncomingAmountRaw);
  const txShare = input.totalIncomingTxCount > 0
    ? input.contractDrivenIncomingTxCount / input.totalIncomingTxCount
    : 0;
  const amountShare = ratio(contractAmount, totalAmount);
  const exactApprovalDrainCount = Math.max(0, input.exactApprovalDrainCount ?? 0);
  const reasons: string[] = [];

  if (input.contractDrivenIncomingTxCount <= 0) {
    return {
      level: "none",
      primaryRole: "unknown",
      evidenceStrength: "none",
      label: "No contract-driven incoming",
      contractDrivenTxShare: txShare,
      contractDrivenAmountShare: amountShare,
      reasons: []
    };
  }

  if (methodLooksLikeVerify20(input.dominantMethod)) {
    reasons.push("Verify20-like method with explicit source and receiver fields");
  }

  if (input.knownServiceIdentity) {
    reasons.push(`Known service identity: ${input.knownServiceIdentity}`);
  }

  if (exactApprovalDrainCount > 0) {
    reasons.push("Exact approval-drain evidence exists in this receiver campaign");
  }

  const dominantCampaign =
    input.contractDrivenIncomingTxCount >= 25 &&
    input.uniqueSourceCount >= 10 &&
    contractAmount >= 100_000_000_000n &&
    (txShare >= 0.5 || amountShare >= 0.5);

  if (dominantCampaign && methodLooksLikeVerify20(input.dominantMethod) && !input.knownServiceIdentity) {
    return {
      level: "dominant_drainer_like_pattern",
      primaryRole: exactApprovalDrainCount > 0 ? "drainer_receiver_collector" : "drainer_like_collector",
      evidenceStrength: exactApprovalDrainCount > 0 ? "hard" : "strong",
      label: "Likely drainer campaign",
      contractDrivenTxShare: txShare,
      contractDrivenAmountShare: amountShare,
      reasons
    };
  }

  const strongCampaign =
    input.contractDrivenIncomingTxCount >= 10 &&
    input.uniqueSourceCount >= 5 &&
    contractAmount >= 50_000_000_000n &&
    (txShare >= 0.25 || amountShare >= 0.25);

  if (strongCampaign && methodLooksLikeVerify20(input.dominantMethod) && !input.knownServiceIdentity) {
    return {
      level: "drainer_like_pattern",
      primaryRole: exactApprovalDrainCount > 0 ? "drainer_receiver_collector" : "drainer_like_collector",
      evidenceStrength: exactApprovalDrainCount > 0 ? "hard" : "strong",
      label: "Drainer-like contract pattern",
      contractDrivenTxShare: txShare,
      contractDrivenAmountShare: amountShare,
      reasons
    };
  }

  if (input.knownServiceIdentity && methodLooksPermitLike(input.dominantMethod)) {
    return {
      level: "contract_driven_service_context",
      primaryRole: "service_context",
      evidenceStrength: "context",
      label: "Service contract-driven flow",
      contractDrivenTxShare: txShare,
      contractDrivenAmountShare: amountShare,
      reasons
    };
  }

  const cluster =
    (input.contractDrivenIncomingTxCount >= 3 && input.uniqueSourceCount >= 2) ||
    contractAmount >= 10_000_000_000n;

  return {
    level: cluster ? "contract_driven_cluster" : "contract_driven_transfer",
    primaryRole: "collector",
    evidenceStrength: cluster ? "strong" : "context",
    label: cluster ? "Contract-driven incoming cluster" : "Contract-driven incoming",
    contractDrivenTxShare: txShare,
    contractDrivenAmountShare: amountShare,
    reasons
  };
}

export function classifySourcePostDebitActivity(input: SourcePostDebitActivityInput): SourcePostDebitActivityClassification {
  const debitAmount = rawToBigInt(input.debitAmountRaw);
  const laterIncoming = rawToBigInt(input.laterIncomingAmountRaw);
  const laterOutgoing = rawToBigInt(input.laterOutgoingAmountRaw);
  const laterTotal = laterIncoming + laterOutgoing;
  const residualActivityRatio = ratio(laterTotal, debitAmount);

  if (!input.checked) {
    return {
      status: "not_checked",
      victimLike: false,
      label: "Source activity not checked",
      residualActivityRatio
    };
  }

  if (input.repeatedContractDrivenDebitToSameReceiver) {
    return {
      status: "repeated_residual_collection",
      victimLike: true,
      label: "Repeated residual collection",
      residualActivityRatio
    };
  }

  if (input.laterTxCount <= 0 || laterTotal === 0n) {
    return {
      status: "victim_like_source",
      victimLike: true,
      label: "No later USDT activity",
      residualActivityRatio
    };
  }

  if (laterTotal <= 500_000_000n && residualActivityRatio <= 0.05) {
    return {
      status: "minor_residual_activity",
      victimLike: true,
      label: "Only minor residual activity",
      residualActivityRatio
    };
  }

  return {
    status: "active_after_debit",
    victimLike: false,
    label: "Active after debit",
    residualActivityRatio
  };
}
```

- [ ] **Step 4: Run classifier tests**

Run:

```bash
npm test -- tests/forensics/contractDrivenEvidence.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/contractDrivenEvidence.ts tests/forensics/contractDrivenEvidence.test.ts
git commit -m "feat(forensics): classify contract-driven evidence"
```

---

## Task 2: Project Contract-Driven Evidence Scenes Into Admin Graph

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add failing graph projection tests**

In `tests/admin/forensicsGraph.test.ts`, add tests near existing exact approval-drain and node-intelligence tests:

```ts
it("projects repeated Verify20 contract-driven inflows as a drainer-like receiver campaign", () => {
  const subject = "TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf";
  const victim = "TB44QiUnyECTGfmqgZmN5jV7SzjnDexzHP";
  const operator = "TQvjkKKHukfpa4tNsENAESZwrDExLbgPTL";
  const contract = "TPiTYVC9NHggG3ttw7PxoYfQ5jYjqoqEki";

  const result = projectForensicJobGraph({
    id: "job-contract-driven",
    kind: "address_deep_check",
    status: "completed",
    subject,
    requestedBy: "system",
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    result: {
      address: subject,
      contractDrivenReceiverProfile: {
        totalIncomingTxCount: 175,
        totalIncomingAmountRaw: "968500000000",
        contractDrivenIncomingTxCount: 168,
        contractDrivenIncomingAmountRaw: "959200000000",
        uniqueSourceCount: 168,
        dominantMethod: "Verify20",
        contractNames: ["VerifyAccount"],
        knownServiceIdentity: null,
        exactApprovalDrainCount: 1
      },
      contractDrivenTransferProfiles: [{
        txHash: "7850ccc3bb69e",
        timestamp: "2026-06-28T00:01:00.000Z",
        amountRaw: "9370000000",
        amount: "9.37K USDT",
        method: "Verify20",
        callerAddress: operator,
        contractAddress: contract,
        sourceAddress: victim,
        receiverAddress: subject,
        sourcePostDebitActivity: {
          checked: true,
          debitAmountRaw: "9370000000",
          laterIncomingAmountRaw: "0",
          laterOutgoingAmountRaw: "0",
          laterTxCount: 0,
          repeatedContractDrivenDebitToSameReceiver: false
        }
      }]
    }
  } as never);

  expect(result.status).toBe("ready");
  expect(result.graph.nodes.find((node) => node.address === subject)?.metadata.nodeIntelligence).toMatchObject({
    role: "drainer",
    label: "Drainer",
    evidenceStrength: "hard"
  });
  expect(result.graph.nodes.find((node) => node.address === victim)?.metadata.nodeIntelligence).toMatchObject({
    role: "victim",
    label: "Victim"
  });
  expect(result.graph.nodes.find((node) => node.address === contract)?.metadata.nodeIntelligence).toMatchObject({
    role: "service",
    label: "Drainer contract"
  });
  expect(result.graph.edges.some((edge) =>
    edge.metadata.evidenceType === "contract_driven_transfer" &&
    edge.from === `addr:${victim}` &&
    edge.to === `addr:${subject}`
  )).toBe(true);
});

it("does not mark a single Verify20 method-only profile as drainer", () => {
  const subject = "TSingleVerify20Receiver111111111111111";

  const result = projectForensicJobGraph({
    id: "job-single-verify20",
    kind: "address_deep_check",
    status: "completed",
    subject,
    requestedBy: "system",
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    result: {
      address: subject,
      contractDrivenReceiverProfile: {
        totalIncomingTxCount: 5,
        totalIncomingAmountRaw: "12000000000",
        contractDrivenIncomingTxCount: 1,
        contractDrivenIncomingAmountRaw: "1000000000",
        uniqueSourceCount: 1,
        dominantMethod: "Verify20",
        contractNames: ["VerifyAccount"],
        exactApprovalDrainCount: 0
      }
    }
  } as never);

  expect(result.graph.nodes.find((node) => node.address === subject)?.metadata.nodeIntelligence?.role).not.toBe("drainer");
});
```

- [ ] **Step 2: Run graph tests and confirm failure**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts -t "Verify20|contract-driven"
```

Expected: fail because contract-driven profiles are not projected yet.

- [ ] **Step 3: Import the classifier**

In `src/admin/forensicsGraph.ts`, add:

```ts
import {
  classifyContractDrivenReceiver,
  classifySourcePostDebitActivity
} from "../forensics/contractDrivenEvidence";
```

- [ ] **Step 4: Parse contract-driven profiles from result data**

Add small helpers near existing `recordArrayField`/string parsing helpers:

```ts
function contractDrivenTransferProfiles(result: Record<string, unknown>): Record<string, unknown>[] {
  return recordArrayField(result, "contractDrivenTransferProfiles");
}

function contractDrivenReceiverProfile(result: Record<string, unknown>): Record<string, unknown> | null {
  return recordField(result, "contractDrivenReceiverProfile");
}
```

- [ ] **Step 5: Add graph projection helper**

Add this helper near other graph append helpers:

```ts
function appendContractDrivenEvidence(
  graph: AdminForensicsGraph,
  result: Record<string, unknown>,
  subjectAddress: string
): void {
  const receiverProfile = contractDrivenReceiverProfile(result);
  if (receiverProfile) {
    const classification = classifyContractDrivenReceiver({
      totalIncomingTxCount: firstNumber(receiverProfile["totalIncomingTxCount"]) ?? 0,
      totalIncomingAmountRaw: stringField(receiverProfile, "totalIncomingAmountRaw"),
      contractDrivenIncomingTxCount: firstNumber(receiverProfile["contractDrivenIncomingTxCount"]) ?? 0,
      contractDrivenIncomingAmountRaw: stringField(receiverProfile, "contractDrivenIncomingAmountRaw"),
      uniqueSourceCount: firstNumber(receiverProfile["uniqueSourceCount"]) ?? 0,
      dominantMethod: stringField(receiverProfile, "dominantMethod"),
      contractNames: recordArrayField(receiverProfile, "contractNames").map((item) => String(item)),
      knownServiceIdentity: stringField(receiverProfile, "knownServiceIdentity"),
      exactApprovalDrainCount: firstNumber(receiverProfile["exactApprovalDrainCount"]) ?? 0
    });
    const subjectNode = ensureAddressNode(graph, subjectAddress, { label: shortenAddress(subjectAddress), kind: "wallet" });
    subjectNode.metadata.contractDrivenReceiver = classification;
    if (classification.primaryRole === "drainer_receiver_collector" || classification.primaryRole === "drainer_like_collector") {
      attachNodeIntelligence(subjectNode, {
        role: "drainer",
        label: "Drainer",
        evidenceStrength: classification.evidenceStrength === "hard" ? "hard" : "strong",
        source: "contract_driven_receiver_profile",
        reason: classification.label
      });
    } else if (classification.primaryRole === "collector") {
      attachNodeIntelligence(subjectNode, {
        role: "collector",
        label: "Collector",
        evidenceStrength: "context",
        source: "contract_driven_receiver_profile",
        reason: classification.label
      });
    }
  }

  for (const profile of contractDrivenTransferProfiles(result)) {
    const txHash = stringField(profile, "txHash") ?? "inferred";
    const timestamp = stringField(profile, "timestamp");
    const amountRaw = stringField(profile, "amountRaw");
    const amount = stringField(profile, "amount") ?? amountRaw;
    const method = stringField(profile, "method");
    const callerAddress = stringField(profile, "callerAddress") ?? stringField(profile, "operatorAddress");
    const contractAddress = stringField(profile, "contractAddress") ?? stringField(profile, "spenderAddress");
    const sourceAddress = stringField(profile, "sourceAddress") ?? stringField(profile, "victimAddress");
    const receiverAddress = stringField(profile, "receiverAddress") ?? subjectAddress;

    if (!sourceAddress || !receiverAddress) continue;

    const sourceNode = ensureAddressNode(graph, sourceAddress, { label: shortenAddress(sourceAddress), kind: "wallet" });
    const receiverNode = ensureAddressNode(graph, receiverAddress, { label: shortenAddress(receiverAddress), kind: "wallet" });

    const sourceActivity = recordField(profile, "sourcePostDebitActivity");
    if (sourceActivity) {
      const activity = classifySourcePostDebitActivity({
        checked: sourceActivity["checked"] === true,
        debitAmountRaw: stringField(sourceActivity, "debitAmountRaw") ?? amountRaw,
        laterIncomingAmountRaw: stringField(sourceActivity, "laterIncomingAmountRaw"),
        laterOutgoingAmountRaw: stringField(sourceActivity, "laterOutgoingAmountRaw"),
        laterTxCount: firstNumber(sourceActivity["laterTxCount"]) ?? 0,
        repeatedContractDrivenDebitToSameReceiver: sourceActivity["repeatedContractDrivenDebitToSameReceiver"] === true
      });
      sourceNode.metadata.sourcePostDebitActivity = activity;
      if (activity.victimLike) {
        attachNodeIntelligence(sourceNode, {
          role: "victim",
          label: "Victim",
          evidenceStrength: "strong",
          source: "post_debit_activity",
          reason: activity.label
        });
      }
    }

    if (contractAddress) {
      const contractNode = ensureAddressNode(graph, contractAddress, { label: "Spender contract", kind: "contract" });
      attachNodeIntelligence(contractNode, {
        role: "service",
        label: "Drainer contract",
        evidenceStrength: "context",
        source: "contract_driven_transfer",
        reason: method ? `${method} contract call` : "Contract-driven transfer"
      });
    }

    if (callerAddress && contractAddress) {
      ensureAddressNode(graph, callerAddress, { label: shortenAddress(callerAddress), kind: "wallet" });
      graph.edges.push({
        id: `edge:contract_call:${txHash}`,
        from: `addr:${callerAddress}`,
        to: `addr:${contractAddress}`,
        direction: "outgoing",
        type: "context",
        label: "contract call",
        metadata: {
          evidenceType: "contract_call_context",
          txHash,
          method,
          callerAddress,
          contractAddress,
          boundaryContextOnly: true
        }
      });
    }

    graph.edges.push({
      id: `edge:contract_driven:${txHash}`,
      from: `addr:${sourceAddress}`,
      to: `addr:${receiverAddress}`,
      direction: "inbound",
      type: "transfer",
      label: amount ?? "USDT transfer",
      amount,
      amountRaw,
      txHash,
      timestamp,
      metadata: {
        evidenceType: "contract_driven_transfer",
        txHash,
        timestamp,
        amount,
        amountRaw,
        method,
        callerAddress,
        contractAddress,
        sourceAddress,
        receiverAddress,
        underlyingTransfers: [{
          txHash,
          timestamp,
          amount,
          amountRaw,
          fromAddress: sourceAddress,
          toAddress: receiverAddress,
          method,
          callerAddress,
          contractAddress
        }]
      }
    });
  }
}
```

If `ensureAddressNode`, `attachNodeIntelligence`, or the edge shape has a local signature mismatch, adapt this helper to the existing signatures instead of adding wrapper abstractions.

- [ ] **Step 6: Call the helper from address deep-check projection**

Inside `projectAddressDeepJob`, after core subject/profile projection and before final layout metadata:

```ts
appendContractDrivenEvidence(graph, result, subjectAddress);
```

- [ ] **Step 7: Run graph tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts -t "Verify20|contract-driven|approval-drain"
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat(admin): project contract-driven evidence scenes"
```

---

## Task 3: Guard Weak Service/DEX/CEX/Bridge Role Classification

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`
- Check existing tests in: `tests/forensics/serviceClassifier.test.ts`

- [ ] **Step 1: Add a failing graph test for weak DEX hints**

In `tests/admin/forensicsGraph.test.ts`, add:

```ts
it("does not promote a plain wallet with a weak DEX hint into a DEX service node", () => {
  const subject = "TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf";
  const plainWallet = "TB44QiUnyECTGfmqgZmN5jV7SzjnDexzHP";

  const result = projectForensicJobGraph({
    id: "job-weak-dex",
    kind: "where_is_money_check",
    status: "completed",
    subject,
    requestedBy: "system",
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    result: {
      address: subject,
      subjectExposureProfile: {
        topIncoming: [{
          counterpartyAddress: plainWallet,
          amountRaw: "8750000000",
          txCount: 1,
          serviceCategory: "dex",
          serviceIdentitySource: "weak_keyword"
        }]
      }
    }
  } as never);

  const node = result.graph.nodes.find((item) => item.address === plainWallet);
  expect(node?.kind).toBe("wallet");
  expect(node?.displayKind).not.toBe("dex");
  expect(node?.metadata.boundaryIdentity).toBeUndefined();
  expect(node?.metadata.weakServiceHint).toMatchObject({
    category: "dex",
    reason: "weak service label not promoted to service node"
  });
});
```

- [ ] **Step 2: Run the weak DEX test and confirm failure**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts -t "weak DEX"
```

Expected: fail if weak service hints still promote wallets.

- [ ] **Step 3: Add strong-service guard helper**

In `src/admin/forensicsGraph.ts`, near boundary identity helpers, add:

```ts
function hasStrongServiceIdentity(input: {
  category: string | null;
  identity: string | null;
  source: string | null;
  isContract: boolean;
  evidenceType: string | null;
}): boolean {
  const category = (input.category ?? "").toLowerCase();
  const source = (input.source ?? "").toLowerCase();
  const identity = (input.identity ?? "").trim();
  const evidenceType = (input.evidenceType ?? "").toLowerCase();

  if (!category) return false;
  if (identity && /registry|metadata|provider|tag|service_route/.test(source)) return true;
  if (input.isContract && category !== "cex" && /contract|metadata|provider|registry/.test(source)) return true;
  if (/service_boundary|boundary_exposure|grouped_boundary/.test(evidenceType)) return true;
  return false;
}

function weakServiceHint(category: string | null, identity: string | null, source: string | null): Record<string, unknown> | undefined {
  if (!category && !identity) return undefined;
  return {
    category: category ?? "unknown",
    identity: identity ?? null,
    source: source ?? null,
    reason: "weak service label not promoted to service node"
  };
}
```

- [ ] **Step 4: Use the guard before service-node promotion**

Where service/boundary identity currently promotes a node to CEX/DEX/bridge/service, wrap it:

```ts
const strongService = hasStrongServiceIdentity({
  category,
  identity,
  source,
  isContract,
  evidenceType
});

if (strongService) {
  attachBoundaryIdentity(node, boundaryIdentityMetadata);
  node.displayKind = boundaryIdentityMetadata.category;
} else {
  const hint = weakServiceHint(category, identity, source);
  if (hint) node.metadata.weakServiceHint = hint;
}
```

Do not overwrite existing exact service identities from registry/provider tags.

- [ ] **Step 5: Run classification tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts -t "weak DEX|boundary identity|service exposure"
npm test -- tests/forensics/serviceClassifier.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "fix(admin): guard weak service role classification"
```

---

## Task 4: Finish Grouped Tx And Reciprocal Flow Rules

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add missing grouping tests**

Existing tests already cover several grouping cases. Add this extra test if it is not already present:

```ts
it("never groups one direct counterparty transfer as grouped evidence", () => {
  const subject = "TNAraW3cWKETcRz9p6obg7SzeiMzH2Z9i1";
  const counterparty = "TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE";

  const result = projectForensicJobGraph({
    id: "job-single-direct-counterparty",
    kind: "address_deep_check",
    status: "completed",
    subject,
    requestedBy: "system",
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    result: {
      address: subject,
      directCounterpartyTransfers: [{
        txHash: "318cb95612abe99b24a96d95e578a11d0170f3bd83fa458c8bd60ee4dc7fe654",
        fromAddress: counterparty,
        toAddress: subject,
        amountRaw: "900000000",
        timestamp: "2026-06-25T09:49:03.000Z"
      }]
    }
  } as never);

  const edge = result.graph.edges.find((item) => item.txHash === "318cb95612abe99b24a96d95e578a11d0170f3bd83fa458c8bd60ee4dc7fe654");
  expect(edge?.metadata.evidenceType).not.toBe("grouped_transfers");
  expect(edge?.metadata.underlyingTransfers).toHaveLength(1);
});
```

Also keep or add:

```ts
it("does not group opposite direct counterparty transfer directions together", () => {
  const subject = "TNAraW3cWKETcRz9p6obg7SzeiMzH2Z9i1";
  const counterparty = "TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE";

  const result = projectForensicJobGraph({
    id: "job-opposite-directions",
    kind: "address_deep_check",
    status: "completed",
    subject,
    requestedBy: "system",
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    result: {
      address: subject,
      directCounterpartyTransfers: [
        {
          txHash: "tx-a",
          fromAddress: counterparty,
          toAddress: subject,
          amountRaw: "11250000000",
          timestamp: "2026-06-25T09:49:03.000Z"
        },
        {
          txHash: "tx-b",
          fromAddress: subject,
          toAddress: counterparty,
          amountRaw: "115540000000",
          timestamp: "2026-06-25T09:50:45.000Z"
        }
      ]
    }
  } as never);

  const directEdges = result.graph.edges.filter((edge) =>
    edge.metadata.evidenceType === "direct_counterparty_transfer" ||
    edge.metadata.evidenceType === "grouped_transfers"
  );

  expect(directEdges).toHaveLength(2);
  expect(directEdges.every((edge) => edge.metadata.reciprocalFlow === true)).toBe(true);
});
```

- [ ] **Step 2: Run grouping tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts -t "group|single|episode|reciprocal|opposite"
```

Expected: fail only if the current implementation still groups too aggressively.

- [ ] **Step 3: Enforce grouping key**

In the direct counterparty grouping logic, ensure the grouping key includes all of:

```ts
const key = [
  fromNodeId,
  toNodeId,
  direction,
  evidenceType ?? "direct_counterparty_transfer",
  episodeIndex
].join("\u0000");
```

Use these rules:

- 1 tx: `evidenceType = "direct_counterparty_transfer"`, show one gray dashed line.
- 2+ tx in same direction, same evidence type, same episode: `evidenceType = "grouped_transfers"`, show one gray-purple dashed grouped line.
- Opposite directions are never grouped together.
- Normal transfer and contract-driven transfer are never grouped together.
- Service/boundary context is never grouped into wallet-to-wallet transfer evidence.
- Gaps over 30 days create a new episode.

- [ ] **Step 4: Keep reciprocal flow metadata without merging**

For A -> B and B -> A:

```ts
edge.metadata.reciprocalFlow = true;
edge.metadata.reciprocalPairKey = pairKey;
edge.metadata.reciprocalEdgeIds = reciprocalEdgeIds;
```

This marks circular funding without hiding direction.

- [ ] **Step 5: Run grouping tests again**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts -t "group|single|episode|reciprocal|opposite"
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "fix(admin): keep grouped transfer evidence honest"
```

---

## Task 5: Improve Right Rail, Transfer Drawer, And Human Time

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add UI tests for contract-driven evidence details**

In `tests/admin/adminConsole.test.ts`, add:

```ts
it("renders contract-driven transfer evidence details in the selected flow panel", () => {
  const html = adminConsoleHtml();
  expect(html).toContain("Contract-driven USDT transfer");
  expect(html).toContain("Spender authority context");
  expect(html).toContain("USDT moved by smart-contract call");
  expect(html).toContain("sourcePostDebitActivityLabel");
});
```

- [ ] **Step 2: Add UI tests for drawer close and gap formatting**

Add:

```ts
it("renders a close control for the expanded transfer drawer", () => {
  const html = adminConsoleHtml();
  expect(html).toContain('id="closeTransferDrawer"');
  expect(html).toContain("setTransferDrawer(false)");
});

it("formats expanded transfer times with human labels and preserves first-row gap when available", () => {
  const html = adminConsoleHtml();
  expect(html).toContain("function transferTableTimeLabel");
  expect(html).toContain("function transferTableGapLabel");
  expect(html).toContain("edgeTxGap(edge)");
});
```

- [ ] **Step 3: Run UI tests and confirm failure if helpers are missing**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "contract-driven|drawer|gap|time"
```

Expected: fail for missing helpers or missing close button.

- [ ] **Step 4: Add clearer evidence labels**

In `src/admin/adminConsole.ts`, update the evidence label helper:

```ts
function edgeEvidenceTypeLabel(edge) {
  const type = edgeEvidenceType(edge);
  if (type === "contract_driven_transfer") return "Contract-driven USDT transfer";
  if (type === "contract_call_context") return "Contract call context";
  if (type === "debit_authority_context") return "Spender authority context";
  if (type === "grouped_transfers") return edgeIsGroupedBoundaryEvidence(edge) ? "Grouped boundary evidence" : "Grouped transfers";
  return existingEdgeEvidenceTypeLabel(edge);
}
```

Do not literally introduce `existingEdgeEvidenceTypeLabel`; fold these cases into the existing helper to avoid a new abstraction.

- [ ] **Step 5: Add contract-driven detail block**

In `src/admin/adminConsole.ts`, near selected edge detail helpers:

```js
function sourcePostDebitActivityLabel(value) {
  if (!value || typeof value !== "object") return "not checked";
  return value.label || value.status || "not checked";
}

function contractDrivenDetailBlock(edge) {
  const type = edgeEvidenceType(edge);
  if (type !== "contract_driven_transfer" && type !== "approval_drain_transfer") return "";
  const metadata = edge?.metadata || {};
  return cardBlockHtml("Contract-driven evidence",
    metric("Meaning", "USDT moved by smart-contract call", "wide") +
    metric("Method", metadata.method || "method n/a") +
    metricHtml("Caller", addressDetailLink(metadata.callerAddress || metadata.operatorAddress || "")) +
    metricHtml("Contract", addressDetailLink(metadata.contractAddress || metadata.spenderAddress || "")) +
    metricHtml("Source", addressDetailLink(metadata.sourceAddress || metadata.victimAddress || "")) +
    metricHtml("Receiver", addressDetailLink(metadata.receiverAddress || "")) +
    metric("Source activity", sourcePostDebitActivityLabel(metadata.sourcePostDebitActivity), "wide")
  );
}
```

Include it in the selected edge card after the main selected-flow metrics:

```js
contractDrivenDetailBlock(edge) +
```

- [ ] **Step 6: Add close button to expanded transfer drawer**

In the transfer drawer HTML:

```html
<button id="closeTransferDrawer" type="button" class="drawer-close" title="Close transfer details">x</button>
```

In the event binding section:

```js
const closeTransferDrawerButton = document.getElementById("closeTransferDrawer");
if (closeTransferDrawerButton) {
  closeTransferDrawerButton.addEventListener("click", () => setTransferDrawer(false));
}
```

Keep the existing right rail close button unchanged.

- [ ] **Step 7: Use human-readable time consistently**

In transfer row formatting, ensure each expanded transfer row uses:

```js
function transferTableTimeLabel(value) {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number(value);
  if (!Number.isFinite(timestamp)) return "time n/a";
  const date = new Date(timestamp);
  const currentYear = new Date().getUTCFullYear();
  const year = date.getUTCFullYear();
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return year === currentYear
    ? `${month} ${day}, ${hour}:${minute}`
    : `${year} ${month} ${day}, ${hour}:${minute}`;
}
```

For first row gap:

```js
function transferTableGapLabel(value, index) {
  if (value && value !== "n/a") return String(value);
  return index === 0 ? "start" : "n/a";
}
```

If the selected grouped edge has a real `txGapMs`, the first row should use `edgeTxGap(edge)` instead of always `n/a`.

- [ ] **Step 8: Run UI tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "contract-driven|drawer|gap|time|selected flow"
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat(admin): explain contract-driven graph evidence"
```

---

## Task 6: Keep Context Boundaries Out Of Money Flow

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add graph test for context-only boundary**

In `tests/admin/forensicsGraph.test.ts`, add:

```ts
it("keeps context-only boundary stops out of transfer evidence", () => {
  const subject = "TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf";

  const result = projectForensicJobGraph({
    id: "job-context-only-boundary",
    kind: "address_deep_check",
    status: "completed",
    subject,
    requestedBy: "system",
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    result: {
      address: subject,
      boundaryStops: [{
        reason: "history_not_fully_fetched",
        label: "History incomplete",
        boundaryContextOnly: true
      }]
    }
  } as never);

  const boundaryEdge = result.graph.edges.find((edge) => edge.metadata.boundaryContextOnly === true);
  expect(boundaryEdge?.metadata.underlyingTransfers).toEqual([]);
  expect(boundaryEdge?.metadata.evidenceType).toBe("boundary_context_only");
});
```

- [ ] **Step 2: Ensure boundary context-only metadata is explicit**

In boundary stop projection:

```ts
metadata: {
  evidenceType: "boundary_context_only",
  boundaryContextOnly: true,
  underlyingTransfers: [],
  meaning: "Investigation stop, not a stored money transfer"
}
```

- [ ] **Step 3: Hide context-only edges from transfer-like tables**

In `src/admin/adminConsole.ts`, add or update:

```js
function edgeHasTransferRows(edge) {
  if (edge?.metadata?.boundaryContextOnly === true) return false;
  if (edge?.metadata?.evidenceType === "boundary_context_only") return false;
  if (Array.isArray(edge?.metadata?.underlyingTransfers) && edge.metadata.underlyingTransfers.length > 0) return true;
  return Boolean(edge?.txHash && edge.txHash !== "inferred");
}
```

Use this helper when building transfer rows and selected-path rows.

- [ ] **Step 4: Add UI test for context-only wording**

In `tests/admin/adminConsole.test.ts`:

```ts
it("describes context-only boundary edges without amount not available copy", () => {
  const html = adminConsoleHtml();
  expect(html).toContain("Investigation stop");
  expect(html).not.toContain("amount not available");
});
```

- [ ] **Step 5: Run boundary tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts -t "boundary context|context-only"
npm test -- tests/admin/adminConsole.test.ts -t "context-only|amount not available|boundary"
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix(admin): separate boundary context from money flow"
```

---

## Task 7: Add QA Fixtures For Known Drainer-Like Cases

**Files:**
- Modify: `tests/forensics/contractDrivenEvidence.test.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add TS3ga fixture test**

In `tests/forensics/contractDrivenEvidence.test.ts`, add:

```ts
it("classifies the TS3ga Verify20 sample as dominant drainer-like evidence", () => {
  const result = classifyContractDrivenReceiver({
    totalIncomingTxCount: 175,
    totalIncomingAmountRaw: "968500000000",
    contractDrivenIncomingTxCount: 168,
    contractDrivenIncomingAmountRaw: "959200000000",
    uniqueSourceCount: 168,
    dominantMethod: "Verify20",
    contractNames: ["VerifyAccount"],
    knownServiceIdentity: null,
    exactApprovalDrainCount: 1
  });

  expect(result.level).toBe("dominant_drainer_like_pattern");
  expect(result.contractDrivenTxShare).toBeGreaterThan(0.95);
  expect(result.contractDrivenAmountShare).toBeGreaterThan(0.98);
});
```

- [ ] **Step 2: Add TPdrEz fixture test**

Add:

```ts
it("classifies the TPdrEz Verify20 sample as drainer-like receiver evidence", () => {
  const result = classifyContractDrivenReceiver({
    totalIncomingTxCount: 112,
    totalIncomingAmountRaw: "437600000000",
    contractDrivenIncomingTxCount: 97,
    contractDrivenIncomingAmountRaw: "322100000000",
    uniqueSourceCount: 97,
    dominantMethod: "Verify20",
    contractNames: ["VerifyAccount"],
    knownServiceIdentity: null,
    exactApprovalDrainCount: 1
  });

  expect(result.level).toBe("dominant_drainer_like_pattern");
  expect(result.primaryRole).toBe("drainer_receiver_collector");
});
```

- [ ] **Step 3: Add victim activity QA sample**

Add:

```ts
it("keeps tiny post-debit residual source activity victim-like", () => {
  const samples = [
    { debitAmountRaw: "50100000000", laterIncomingAmountRaw: "296000000", laterOutgoingAmountRaw: "296000000", laterTxCount: 2 },
    { debitAmountRaw: "16000000000", laterIncomingAmountRaw: "20980000", laterOutgoingAmountRaw: "20980000", laterTxCount: 2 },
    { debitAmountRaw: "12700000000", laterIncomingAmountRaw: "5000000", laterOutgoingAmountRaw: "5000000", laterTxCount: 2 }
  ];

  for (const sample of samples) {
    const result = classifySourcePostDebitActivity({
      ...sample,
      checked: true,
      repeatedContractDrivenDebitToSameReceiver: false
    });
    expect(result.victimLike).toBe(true);
    expect(result.status).toBe("minor_residual_activity");
  }
});
```

- [ ] **Step 4: Run focused QA tests**

Run:

```bash
npm test -- tests/forensics/contractDrivenEvidence.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add tests/forensics/contractDrivenEvidence.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "test(admin): cover contract-driven evidence map qa cases"
```

---

## Task 8: Manual Admin Smoke Test

**Files:**
- No code changes unless a smoke test finds a bug.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 2: Run focused test suite**

Run:

```bash
npm test -- tests/forensics/contractDrivenEvidence.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/forensics/serviceClassifier.test.ts
```

Expected: pass.

- [ ] **Step 3: Start admin/bot locally using the current project runner**

Run the same local runner the project currently uses for admin/bot development. If no wrapper script is active in the terminal, start the app with:

```bash
npm run dev
```

Expected: app starts without TypeScript/runtime errors.

- [ ] **Step 4: Check admin graph manually**

Open the admin console and verify:

- Role marks are on by default.
- Existing drainer/collector/victim icons still use the approved assets.
- DeepCheck graph still uses the newer curved/dashed visual style, not the old wooden straight-line style.
- Weak DEX hints on plain wallets do not turn normal wallets into DEX nodes.
- Contract-driven transfers show a clear selected-flow explanation.
- Context-only boundary stops do not appear as money transfer evidence.
- Expanded transfer drawer has an `x` close button.
- Expanded transfer drawer shows human-readable time and non-`n/a` gaps where the graph has enough data.

- [ ] **Step 5: Final status check**

Run:

```bash
git status --short
```

Expected: clean working tree after all task commits.

---

## Self-Review

### Spec Coverage

- Multi-step DeepCheck evidence map: covered by Tasks 2, 4, 6, and 8.
- Contract-driven transfer scene: covered by Tasks 1, 2, 5, and 7.
- Drainer/victim/collector/mule role display: covered by Tasks 2, 5, and 8. This plan reuses existing approved role icons; it does not create new icons.
- Weak DEX/service misclassification: covered by Task 3.
- Grouped transfer rules and single-tx behavior: covered by Task 4.
- Reciprocal A -> B / B -> A circular flow: covered by Task 4.
- Boundary context not rendered as money flow: covered by Task 6.
- Right rail transaction details with Tronscan-ready tx hashes: covered by Task 5.
- Victim-like source activity QA: covered by Task 7.

### Placeholder Scan

No step uses unresolved placeholder wording. Where local function signatures may differ, the plan explicitly says to adapt to existing signatures rather than add wrappers.

### Type Consistency

The new pure module exports `classifyContractDrivenReceiver` and `classifySourcePostDebitActivity`. Later graph tasks import those exact functions. Graph metadata uses `contract_driven_transfer`, `contract_call_context`, `boundary_context_only`, and `grouped_transfers` consistently across projection and UI tasks.

---

Plan complete and saved to `docs/superpowers/plans/2026-06-29-admin-deepcheck-contract-driven-evidence-map.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
