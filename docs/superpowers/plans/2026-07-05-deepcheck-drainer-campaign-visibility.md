# DeepCheck Drainer-Campaign Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended for this launch) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. A coordinator can assign one task at a time to fresh subagents and review after each task.

**Goal:** Make DeepCheck show the real contract/wrapper-driven drainer-campaign picture: canonical USDT transfers stay plain, Verify20 wrapper campaigns are counted with denominators, and exact approval-drain proofs can preserve multiple profiles.

**Architecture:** Extend the existing `contractDrivenEvidence` and DeepCheck flow instead of adding a parallel scanner. DeepCheck should classify the full subject incoming set when it is modest enough, keep campaign context separate from exact approval-drain proof, and expose denominator counters so partial enrichment is not presented as complete evidence.

**Tech Stack:** TypeScript, Vitest, existing DeepCheck runtime, existing `contractDrivenEvidence`, existing `approvalDrainProvenance`, Admin graph read model, current knowledge docs.

---

## Scope

This plan implements the approved audit finding:

```text
docs/audit/2026-07-knowledge-deep-audit/10-deepcheck-contract-driven-drainer-campaign-finding.md
```

It does not merge DeepCheck and Where. Where remains the mode that proves current-balance source of funds. DeepCheck remains the mode that profiles the wallet as a whole.

The implementation fixes three concrete gaps:

- DeepCheck must not count canonical USDT `transfer(...)` calls as drainer-like contract-driven evidence.
- DeepCheck must enrich/classify the subject incoming set, not only already-contract-looking edges, when building a campaign picture.
- DeepCheck must be able to keep multiple exact approval-drain profiles where budget and proof allow.

## Files

- Modify: `src/types.ts`
- Modify: `src/forensics/contractDrivenEvidence.ts`
- Modify: `src/forensics/approvalDrainProvenance.ts`
- Modify: `src/check/deepForensicCheck.ts`
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `src/risk/unifiedWalletRisk.ts`
- Modify: `tests/forensics/contractDrivenEvidence.test.ts`
- Modify: `tests/forensics/approvalDrainProvenance.test.ts`
- Modify: `tests/check/deepForensicCheck.test.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`
- Modify after behavior changes: `docs/knowledge/06-deepcheck.md`
- Modify after behavior changes: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify after behavior changes: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify after behavior changes: `docs/knowledge/09-current-decisions.md`
- Modify after behavior changes: `docs/knowledge/10-open-problems.md`

## Current Code Facts

- `runDeepAddressForensicCheck` currently calls `buildApprovalDrainProvenanceProfile(...)`, which returns only the first profile from the multi-profile analysis.
- `buildContractDrivenEvidenceProfiles(...)` currently starts from `incomingEdges.filter(methodLooksContractDriven)`, so local indexed subject edges that look like plain `transfer` are not transaction-info enriched for wrapper detection.
- `methodLooksPlainTransfer(...)` already catches simple `transfer(address,uint256)` forms, but not the TPdr-like display string `transfer transfer(address _to,uint256 _value)`.
- Admin graph already has `contractDrivenProfileLooksPlainUsdtTransfer(...)` filtering in projection paths. This should remain as a display guard, but the source report should also classify correctly.
- Admin graph already has role-mark rendering for `nodeIntelligence.role = "drainer"` and `nodeIntelligence.role = "victim"`. Existing tests prove the icon renderer exists, but the TPdr saved jobs did not give Admin a clean campaign payload, so the receiver wallet and wrapper contract can fail to show the drainer/skull mark in the real graph.

## Product Acceptance Criteria

For a TPdr-like DeepCheck result:

```text
incomingTxTotal: 116
txInfoEnrichedIncomingTx: 116
plainUsdtTransferTxCount: 15
wrapperDrivenIncomingTxCount: 101
verify20WrapperTxCount: 101
campaignClusters:
  - TURRt... / TQvjk... / Verify20: 96 tx
  - TH7t... / TNdp... / Verify20: 5 tx
exactApprovalDrainProfileCount: 5 when proof exists and budget checked those candidates
Admin role marks:
  receiver wallet TPdr... -> nodeIntelligence.role = drainer
  wrapper contracts TURRt... and TH7t... -> nodeIntelligence.role = drainer, label = Drainer contract
  Verify20 source wallets -> nodeIntelligence.role = victim when source != receiver
```

If enrichment is partial, the result must say it is partial:

```text
txInfoEnrichedIncomingTx: 200
incomingTxTotal: 2400
countsAreLowerBounds: true
campaignClassificationStatus: partial
```

Plain canonical USDT transfers must remain ordinary flow context and must not become drainer-like evidence.

---

### Task 1: Add Plain-Transfer Pollution Tests

**Files:**
- Modify: `tests/forensics/contractDrivenEvidence.test.ts`

- [ ] **Step 1: Import canonical USDT constant**

Change the imports at the top:

```ts
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
```

- [ ] **Step 2: Add a regression test for doubled transfer method text**

Add this test after `"does not treat standard transfer signatures as contract-driven evidence"`:

```ts
  it("does not treat doubled standard transfer method text as contract-driven evidence", async () => {
    const subjectAddress = "TPlainTransferReceiver222222222222";
    const result = await buildContractDrivenEvidenceProfiles({
      subjectAddress,
      edges: [{
        id: "edge-transfer-doubled-method",
        fromAddress: "TPlainTransferSource22222222222222",
        toAddress: subjectAddress,
        txHash: "tx-transfer-doubled-method",
        amountRaw: "1500000",
        timestamp: new Date("2026-06-29T10:03:00.000Z"),
        method: "transfer transfer(address _to,uint256 _value)",
        edgeType: "normal_transfer"
      }],
      getTransaction: async () => ({
        ownerAddress: "TPlainTransferSource22222222222222",
        contractData: {
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          function_selector: "transfer(address _to,uint256 _value)"
        },
        trigger_info: {
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          methodName: "transfer"
        },
        trc20TransferInfo: [{
          from_address: "TPlainTransferSource22222222222222",
          to_address: subjectAddress,
          quant: "1500000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          tokenInfo: {
            tokenAbbr: "USDT",
            tokenId: TRON_USDT_CONTRACT_ADDRESS,
            tokenType: "trc20"
          }
        }]
      })
    });

    expect(result.receiverProfile).toBeNull();
    expect(result.transferProfiles).toEqual([]);
    expect(result.campaignSummary).toMatchObject({
      incomingTxTotal: 1,
      txInfoEnrichedIncomingTx: 1,
      plainUsdtTransferTxCount: 1,
      wrapperDrivenIncomingTxCount: 0,
      countsAreLowerBounds: false,
      campaignClassificationStatus: "complete"
    });
  });
```

- [ ] **Step 3: Add a regression test for canonical-USDT transfer even with tx-info**

Add:

```ts
  it("classifies canonical USDT transaction-info transfer as plain, not wrapper-driven", async () => {
    const subjectAddress = "TPlainTransferReceiver333333333333";
    const result = await buildContractDrivenEvidenceProfiles({
      subjectAddress,
      edges: [{
        id: "edge-canonical-usdt",
        fromAddress: "TPlainTransferSource33333333333333",
        toAddress: subjectAddress,
        txHash: "tx-canonical-usdt-transfer",
        amountRaw: "4200000",
        timestamp: new Date("2026-06-29T10:04:00.000Z"),
        method: "transfer",
        edgeType: "normal_transfer"
      }],
      getTransaction: async () => ({
        ownerAddress: "TPlainTransferSource33333333333333",
        contractData: {
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          function_selector: "transfer(address,uint256)"
        },
        trigger_info: {
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          methodName: "transfer"
        },
        trc20TransferInfo: [{
          from_address: "TPlainTransferSource33333333333333",
          to_address: subjectAddress,
          quant: "4200000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          tokenInfo: {
            tokenAbbr: "USDT",
            tokenId: TRON_USDT_CONTRACT_ADDRESS,
            tokenType: "trc20"
          }
        }]
      })
    });

    expect(result.receiverProfile).toBeNull();
    expect(result.transferProfiles).toEqual([]);
    expect(result.campaignSummary).toMatchObject({
      incomingTxTotal: 1,
      plainUsdtTransferTxCount: 1,
      wrapperDrivenIncomingTxCount: 0
    });
  });
```

- [ ] **Step 4: Run focused tests and confirm failure**

Run:

```powershell
npm test -- tests/forensics/contractDrivenEvidence.test.ts
```

Expected result before implementation:

```text
FAIL tests/forensics/contractDrivenEvidence.test.ts
```

The first new failure should mention missing `campaignSummary` or a non-null `receiverProfile` for the doubled transfer method.

---

### Task 2: Add Campaign Summary Types

**Files:**
- Modify: `src/types.ts`
- Modify: `src/check/deepForensicCheck.ts`

- [ ] **Step 1: Add transfer classification and campaign summary types**

In `src/types.ts`, place these definitions before `ContractDrivenTransferProfile`:

```ts
export type ContractDrivenTransferClassification =
  | "plain_usdt_transfer"
  | "verify20_wrapper"
  | "transfer_from_wrapper"
  | "permit_wrapper"
  | "other_contract_method"
  | "unknown_unenriched"
  | "tx_info_unavailable";

export type ContractDrivenCampaignClassificationStatus =
  | "not_enriched"
  | "partial"
  | "complete";

export type ContractDrivenCampaignCluster = {
  contractAddress: string | null;
  operatorAddress: string | null;
  method: string | null;
  receiverAddress: string;
  txCount: number;
  amountRaw: string;
  uniqueSourceCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  knownServiceIdentity: string | null;
  exactProofCount: number;
  contextOnlyCount: number;
};

export type ContractDrivenCampaignSummary = {
  incomingTxTotal: number;
  incomingAmountRaw: string;
  txInfoEnrichedIncomingTx: number;
  campaignClassificationStatus: ContractDrivenCampaignClassificationStatus;
  countsAreLowerBounds: boolean;
  plainUsdtTransferTxCount: number;
  plainUsdtTransferAmountRaw: string;
  wrapperDrivenIncomingTxCount: number;
  wrapperDrivenIncomingAmountRaw: string;
  verify20WrapperTxCount: number;
  transferFromWrapperTxCount: number;
  permitWrapperTxCount: number;
  otherContractMethodTxCount: number;
  unknownUnenrichedTxCount: number;
  txInfoUnavailableTxCount: number;
  exactApprovalDrainProfileCount: number;
  campaignClusters: ContractDrivenCampaignCluster[];
};
```

- [ ] **Step 2: Extend `ContractDrivenTransferProfile`**

Add optional classification fields:

```ts
  classification?: ContractDrivenTransferClassification;
  countsAsDrainerContext?: boolean;
```

The extended type should keep all existing fields for backwards compatibility.

- [ ] **Step 3: Extend `ContractDrivenReceiverProfile`**

Add optional denominator fields:

```ts
  txInfoEnrichedIncomingTx?: number;
  campaignClassificationStatus?: ContractDrivenCampaignClassificationStatus;
  countsAreLowerBounds?: boolean;
  plainUsdtTransferTxCount?: number;
  wrapperDrivenIncomingTxCount?: number;
  verify20WrapperTxCount?: number;
```

Keep old required fields unchanged so old jobs can still render.

- [ ] **Step 4: Extend DeepCheck report type**

In `src/check/deepForensicCheck.ts`, import `ContractDrivenCampaignSummary` from `../types` and add this field to `DeepAddressForensicReport`:

```ts
  contractDrivenCampaignSummary?: ContractDrivenCampaignSummary | null;
```

- [ ] **Step 5: Run typecheck and confirm implementation errors**

Run:

```powershell
npm test -- tests/forensics/contractDrivenEvidence.test.ts
```

Expected result:

```text
FAIL
```

The remaining failures should come from `buildContractDrivenEvidenceProfiles` not returning `campaignSummary`.

---

### Task 3: Classify Enriched Incoming Transfers

**Files:**
- Modify: `src/forensics/contractDrivenEvidence.ts`
- Modify: `tests/forensics/contractDrivenEvidence.test.ts`

- [ ] **Step 1: Update result type**

Change `BuildContractDrivenEvidenceProfilesResult` to:

```ts
export type BuildContractDrivenEvidenceProfilesResult = {
  receiverProfile: ContractDrivenReceiverProfile | null;
  transferProfiles: ContractDrivenTransferProfile[];
  campaignSummary: ContractDrivenCampaignSummary | null;
};
```

Import the new campaign types from `../types`.

- [ ] **Step 2: Replace method-only prefilter with classification pipeline**

Inside `buildContractDrivenEvidenceProfiles`, keep `incomingEdges` as the source denominator. Replace:

```ts
  const contractDrivenEdges = incomingEdges.filter(methodLooksContractDriven);
  if (contractDrivenEdges.length === 0) {
    return { receiverProfile: null, transferProfiles: [] };
  }
```

with a staged classifier:

```ts
  if (incomingEdges.length === 0) {
    return { receiverProfile: null, transferProfiles: [], campaignSummary: null };
  }

  const maxTxInfo = Math.max(0, input.maxTransactionInfoFetches ?? 30);
  const enriched = await classifyIncomingEdges({
    incomingEdges,
    getTransaction: input.getTransaction,
    maxTxInfo
  });
  const wrapperDriven = enriched.filter((item) => item.countsAsDrainerContext);
```

- [ ] **Step 3: Add internal classification type**

Add above `buildContractDrivenEvidenceProfiles`:

```ts
type ClassifiedIncomingEdge = {
  edge: ForensicRouteEdge;
  txInfo: unknown | null;
  txInfoFetched: boolean;
  classification: ContractDrivenTransferClassification;
  method: string | null;
  contractAddress: string | null;
  contractName: string | null;
  callerAddress: string | null;
  movement: {
    sourceAddress: string;
    receiverAddress: string;
    amountRaw: string;
  };
  countsAsDrainerContext: boolean;
};
```

- [ ] **Step 4: Add `classifyIncomingEdges` helper**

Add:

```ts
async function classifyIncomingEdges(input: {
  incomingEdges: ForensicRouteEdge[];
  getTransaction?: (txHash: string) => Promise<unknown | null>;
  maxTxInfo: number;
}): Promise<ClassifiedIncomingEdge[]> {
  const sorted = [...input.incomingEdges].sort(compareEdgesForClassification);
  const result: ClassifiedIncomingEdge[] = [];
  let txInfoFetches = 0;
  for (const edge of sorted) {
    const shouldFetch = Boolean(input.getTransaction) && txInfoFetches < input.maxTxInfo;
    const txInfo = shouldFetch
      ? await input.getTransaction!(edge.txHash).catch(() => null)
      : null;
    if (shouldFetch) txInfoFetches += 1;
    const movement = matchingUsdtMovement(txInfo, edge) ?? {
      sourceAddress: edge.fromAddress,
      receiverAddress: edge.toAddress,
      amountRaw: edge.amountRaw
    };
    const contractAddress = calledContractAddress(txInfo);
    const displayMethod = methodDisplay(methodText(txInfo) || edge.method);
    const classification = classifyContractDrivenIncoming({
      edge,
      txInfo,
      method: displayMethod,
      contractAddress,
      txInfoFetched: shouldFetch
    });
    result.push({
      edge,
      txInfo,
      txInfoFetched: shouldFetch,
      classification,
      method: displayMethod,
      contractAddress,
      contractName: null,
      callerAddress: transferCaller(txInfo),
      movement,
      countsAsDrainerContext: classification === "verify20_wrapper" ||
        classification === "transfer_from_wrapper" ||
        classification === "permit_wrapper" ||
        classification === "other_contract_method"
    });
  }
  return result.sort((left, right) => compareEdgesForProfile(left.edge, right.edge));
}
```

- [ ] **Step 5: Add `classifyContractDrivenIncoming` helper**

Add:

```ts
function classifyContractDrivenIncoming(input: {
  edge: ForensicRouteEdge;
  txInfo: unknown | null;
  method: string | null;
  contractAddress: string | null;
  txInfoFetched: boolean;
}): ContractDrivenTransferClassification {
  const method = normalizeTransferMethod(input.method ?? input.edge.method);
  const contract = input.contractAddress;
  if (contract === TRON_USDT_CONTRACT_ADDRESS && methodLooksPlainTransfer(method)) {
    return "plain_usdt_transfer";
  }
  if (methodLooksPlainTransfer(method) && input.edge.edgeType !== "transfer_from") {
    return "plain_usdt_transfer";
  }
  if (method.includes("verify20")) return "verify20_wrapper";
  if (method.includes("transferfrom") || method.includes("23b872dd") || input.edge.edgeType === "transfer_from") {
    return "transfer_from_wrapper";
  }
  if (method.includes("permit")) return "permit_wrapper";
  if (method.length > 0) return "other_contract_method";
  if (input.txInfoFetched && !input.txInfo) return "tx_info_unavailable";
  return "unknown_unenriched";
}
```

- [ ] **Step 6: Make `methodLooksPlainTransfer` handle doubled method text**

Replace `methodLooksPlainTransfer` with:

```ts
function methodLooksPlainTransfer(method: string): boolean {
  const normalized = normalizeTransferMethod(method);
  return normalized === "transfer" ||
    normalized === "transfer(address,uint256)" ||
    normalized === "a9059cbb" ||
    normalized === "transfera9059cbb" ||
    normalized === "transfer(address,uint256)a9059cbb";
}

function normalizeTransferMethod(method: string): string {
  const compact = method.trim().toLowerCase().replace(/\s+/g, "");
  const withoutNamedParams = compact.replace(
    /transfer\(address[a-z0-9_]*,uint256[a-z0-9_]*\)/g,
    "transfer(address,uint256)"
  );
  return withoutNamedParams.replace(/^transfertransfer\(/, "transfer(");
}
```

- [ ] **Step 7: Build profiles only from wrapper-driven classifications**

Replace `sortedContractEdges` loops with loops over `wrapperDriven`. Profile fields should use the classified item:

```ts
  for (const item of wrapperDriven) {
    const edge = item.edge;
    const movement = item.movement;
    const contractAddress = item.contractAddress;
    const contractClassification = contractAddress
      ? classificationFor(input.classifications, contractAddress)
      : null;
    const contractName = contractDisplayName(item.txInfo, contractClassification);
    ...
    transferProfiles.push({
      txHash: edge.txHash,
      timestamp: edge.timestamp.toISOString(),
      amountRaw: movement.amountRaw,
      amount: formatUsdtAmount(movement.amountRaw),
      method: item.method,
      classification: item.classification,
      countsAsDrainerContext: item.countsAsDrainerContext,
      callerAddress: item.callerAddress,
      operatorAddress: item.callerAddress,
      contractAddress,
      spenderAddress: contractAddress,
      contractName,
      sourceAddress: movement.sourceAddress,
      victimAddress: movement.sourceAddress,
      receiverAddress: movement.receiverAddress,
      sourcePostDebitActivity
    });
  }
```

- [ ] **Step 8: Add campaign summary helper**

Add:

```ts
function buildCampaignSummary(input: {
  incomingEdges: ForensicRouteEdge[];
  enriched: ClassifiedIncomingEdge[];
  transferProfiles: ContractDrivenTransferProfile[];
  exactApprovalDrainCount: number;
}): ContractDrivenCampaignSummary {
  const count = (classification: ContractDrivenTransferClassification) =>
    input.enriched.filter((item) => item.classification === classification).length;
  const amountFor = (predicate: (item: ClassifiedIncomingEdge) => boolean) =>
    input.enriched.reduce((sum, item) => predicate(item) ? sum + amountRaw(item.movement.amountRaw) : sum, 0n);
  const enrichedCount = input.enriched.filter((item) => item.txInfoFetched).length;
  const complete = enrichedCount >= input.incomingEdges.length;
  return {
    incomingTxTotal: input.incomingEdges.length,
    incomingAmountRaw: sumEdgeAmounts(input.incomingEdges).toString(),
    txInfoEnrichedIncomingTx: enrichedCount,
    campaignClassificationStatus: input.incomingEdges.length === 0
      ? "not_enriched"
      : complete ? "complete" : "partial",
    countsAreLowerBounds: !complete,
    plainUsdtTransferTxCount: count("plain_usdt_transfer"),
    plainUsdtTransferAmountRaw: amountFor((item) => item.classification === "plain_usdt_transfer").toString(),
    wrapperDrivenIncomingTxCount: input.enriched.filter((item) => item.countsAsDrainerContext).length,
    wrapperDrivenIncomingAmountRaw: amountFor((item) => item.countsAsDrainerContext).toString(),
    verify20WrapperTxCount: count("verify20_wrapper"),
    transferFromWrapperTxCount: count("transfer_from_wrapper"),
    permitWrapperTxCount: count("permit_wrapper"),
    otherContractMethodTxCount: count("other_contract_method"),
    unknownUnenrichedTxCount: count("unknown_unenriched"),
    txInfoUnavailableTxCount: count("tx_info_unavailable"),
    exactApprovalDrainProfileCount: input.exactApprovalDrainCount,
    campaignClusters: buildCampaignClusters(input.transferProfiles)
  };
}
```

- [ ] **Step 9: Add campaign cluster helper**

Add:

```ts
function buildCampaignClusters(profiles: ContractDrivenTransferProfile[]): ContractDrivenCampaignCluster[] {
  const groups = new Map<string, ContractDrivenTransferProfile[]>();
  for (const profile of profiles) {
    const key = JSON.stringify([
      profile.contractAddress ?? null,
      profile.operatorAddress ?? profile.callerAddress ?? null,
      profile.method ?? null,
      profile.receiverAddress
    ]);
    groups.set(key, [...(groups.get(key) ?? []), profile]);
  }
  return [...groups.values()]
    .map((items) => {
      const sorted = [...items].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
      return {
        contractAddress: sorted[0]?.contractAddress ?? null,
        operatorAddress: sorted[0]?.operatorAddress ?? sorted[0]?.callerAddress ?? null,
        method: sorted[0]?.method ?? null,
        receiverAddress: sorted[0]?.receiverAddress ?? "",
        txCount: sorted.length,
        amountRaw: sorted.reduce((sum, item) => sum + amountRaw(item.amountRaw), 0n).toString(),
        uniqueSourceCount: new Set(sorted.map((item) => normalizeAddress(item.sourceAddress))).size,
        firstSeenAt: sorted[0]?.timestamp ?? null,
        lastSeenAt: sorted[sorted.length - 1]?.timestamp ?? null,
        knownServiceIdentity: null,
        exactProofCount: 0,
        contextOnlyCount: sorted.length
      };
    })
    .sort((left, right) => compareBigintDesc(amountRaw(left.amountRaw), amountRaw(right.amountRaw)));
}
```

- [ ] **Step 10: Return null receiver but non-null summary for plain-only incoming**

At the end, return:

```ts
  const campaignSummary = buildCampaignSummary({
    incomingEdges,
    enriched,
    transferProfiles,
    exactApprovalDrainCount
  });

  if (wrapperDriven.length === 0) {
    return { receiverProfile: null, transferProfiles: [], campaignSummary };
  }
```

Then populate `receiverProfile` from `campaignSummary` fields:

```ts
      contractDrivenIncomingTxCount: campaignSummary.wrapperDrivenIncomingTxCount,
      contractDrivenIncomingAmountRaw: campaignSummary.wrapperDrivenIncomingAmountRaw,
      uniqueSourceCount: new Set(wrapperDriven.map((item) => normalizeAddress(item.movement.sourceAddress))).size,
      txInfoEnrichedIncomingTx: campaignSummary.txInfoEnrichedIncomingTx,
      campaignClassificationStatus: campaignSummary.campaignClassificationStatus,
      countsAreLowerBounds: campaignSummary.countsAreLowerBounds,
      plainUsdtTransferTxCount: campaignSummary.plainUsdtTransferTxCount,
      wrapperDrivenIncomingTxCount: campaignSummary.wrapperDrivenIncomingTxCount,
      verify20WrapperTxCount: campaignSummary.verify20WrapperTxCount,
```

- [ ] **Step 11: Run focused tests**

Run:

```powershell
npm test -- tests/forensics/contractDrivenEvidence.test.ts
```

Expected:

```text
PASS tests/forensics/contractDrivenEvidence.test.ts
```

---

### Task 4: Add TPdr-Like DeepCheck All-Time Enrichment Test

**Files:**
- Modify: `tests/check/deepForensicCheck.test.ts`

- [ ] **Step 1: Add test for local plain edges enriched into Verify20 campaign**

Add this test after `"enriches every Verify20 incoming transfer in a large drainer-like receiver campaign"`:

```ts
  it("enriches all-time plain transfer edges into a Verify20 campaign when transaction-info shows wrappers", async () => {
    const sourceAddress = "TSubjectCampaign1111111111111111111";
    const wrapperContract = "TWrapperCampaign111111111111111111";
    const operator = "TOperatorCampaign11111111111111111";
    const victims = Array.from({ length: 6 }, (_, index) => `TVictimCampaign${String(index).padStart(2, "0")}111111111111`);
    const plainSenders = Array.from({ length: 2 }, (_, index) => `TPlainSender${String(index).padStart(2, "0")}11111111111111`);
    const indexedTransfers: IndexedTronUsdtTransfer[] = [
      ...victims.map((victimAddress, index) => indexed({
        id: `tx-campaign-wrapper-${index}`,
        from: victimAddress,
        to: sourceAddress,
        amountRaw: `${(index + 1) * 1_000_000}`,
        at: `2026-06-29T10:0${index}:00.000Z`,
        eventIndex: index
      })),
      ...plainSenders.map((senderAddress, index) => indexed({
        id: `tx-campaign-plain-${index}`,
        from: senderAddress,
        to: sourceAddress,
        amountRaw: `${(index + 10) * 1_000_000}`,
        at: `2026-06-29T11:0${index}:00.000Z`,
        eventIndex: 10 + index
      }))
    ];
    const getTransactionCalls: string[] = [];

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        if (address !== sourceAddress) return [];
        return indexedTransfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getTransaction: async (txHash) => {
        getTransactionCalls.push(txHash);
        if (txHash.startsWith("tx-campaign-plain-")) {
          const index = Number(txHash.replace("tx-campaign-plain-", ""));
          return {
            ownerAddress: plainSenders[index],
            contractData: {
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              function_selector: "transfer(address _to,uint256 _value)"
            },
            trigger_info: {
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              methodName: "transfer"
            },
            trc20TransferInfo: [{
              from_address: plainSenders[index],
              to_address: sourceAddress,
              quant: `${(index + 10) * 1_000_000}`,
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
            }]
          };
        }
        const index = Number(txHash.replace("tx-campaign-wrapper-", ""));
        return {
          ownerAddress: operator,
          contractData: {
            contract_address: wrapperContract,
            function_selector: "Verify20(address token,address from,address to,uint256 amount)"
          },
          trigger_info: { methodName: "Verify20" },
          trc20TransferInfo: [{
            from_address: victims[index],
            to_address: sourceAddress,
            quant: `${(index + 1) * 1_000_000}`,
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
          }]
        };
      },
      listTrc20ApprovalChanges: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress,
      windowStart: new Date(0),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 20,
      maxPagesPerAddress: 3,
      maxInboundSenders: 2,
      maxApprovalDrainCandidates: 5,
      allTimeSubjectIndexState: completeIndexState(sourceAddress, 8, 8),
      allTimeMode: "strict",
      secondLayerMaxActiveWalletsPerJob: 0
    });

    expect(new Set(getTransactionCalls)).toEqual(new Set(indexedTransfers.map((item) => item.txHash)));
    expect(report.contractDrivenCampaignSummary).toMatchObject({
      incomingTxTotal: 8,
      txInfoEnrichedIncomingTx: 8,
      campaignClassificationStatus: "complete",
      countsAreLowerBounds: false,
      plainUsdtTransferTxCount: 2,
      wrapperDrivenIncomingTxCount: 6,
      verify20WrapperTxCount: 6
    });
    expect(report.contractDrivenReceiverProfile).toMatchObject({
      totalIncomingTxCount: 8,
      contractDrivenIncomingTxCount: 6,
      plainUsdtTransferTxCount: 2,
      wrapperDrivenIncomingTxCount: 6,
      verify20WrapperTxCount: 6
    });
    expect(report.contractDrivenTransferProfiles).toHaveLength(6);
    expect(report.contractDrivenTransferProfiles?.every((profile) => profile.method === "Verify20")).toBe(true);
  });
```

- [ ] **Step 2: Add TPdr-sized modest denominator regression**

Add this test after the previous campaign enrichment test. It proves a modest
subject incoming set larger than the old default tx-info limit is enriched as a
complete denominator:

```ts
  it("enriches the full TPdr-like modest incoming denominator instead of capping at approval candidates", async () => {
    const sourceAddress = "TSubjectCampaign116111111111111";
    const wrapperContract = "TWrapperCampaign11611111111111";
    const operator = "TOperatorCampaign1161111111111";
    const wrapperTxCount = 101;
    const plainTxCount = 15;
    const timestampFor = (index: number) =>
      new Date(Date.UTC(2026, 5, 29, 10, Math.floor(index / 60), index % 60)).toISOString();
    const victims = Array.from({ length: wrapperTxCount }, (_, index) =>
      `TVictimCampaign116${String(index).padStart(3, "0")}`
    );
    const plainSenders = Array.from({ length: plainTxCount }, (_, index) =>
      `TPlainCampaign116${String(index).padStart(3, "0")}`
    );
    const indexedTransfers: IndexedTronUsdtTransfer[] = [
      ...victims.map((victimAddress, index) => indexed({
        id: `tx-wrapper-116-${index}`,
        from: victimAddress,
        to: sourceAddress,
        amountRaw: "1000000",
        at: timestampFor(index),
        eventIndex: index
      })),
      ...plainSenders.map((senderAddress, index) => indexed({
        id: `tx-plain-116-${index}`,
        from: senderAddress,
        to: sourceAddress,
        amountRaw: "2000000",
        at: timestampFor(wrapperTxCount + index),
        eventIndex: wrapperTxCount + index
      }))
    ];
    const getTransactionCalls: string[] = [];

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        if (address !== sourceAddress) return [];
        return indexedTransfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getTransaction: async (txHash) => {
        getTransactionCalls.push(txHash);
        if (txHash.startsWith("tx-plain-116-")) {
          const index = Number(txHash.replace("tx-plain-116-", ""));
          return {
            ownerAddress: plainSenders[index],
            contractData: {
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              function_selector: "transfer(address _to,uint256 _value)"
            },
            trigger_info: {
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              methodName: "transfer"
            },
            trc20TransferInfo: [{
              from_address: plainSenders[index],
              to_address: sourceAddress,
              quant: "2000000",
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
            }]
          };
        }
        const index = Number(txHash.replace("tx-wrapper-116-", ""));
        return {
          ownerAddress: operator,
          contractData: {
            contract_address: wrapperContract,
            function_selector: "Verify20(address token,address from,address to,uint256 amount)"
          },
          trigger_info: { methodName: "Verify20" },
          trc20TransferInfo: [{
            from_address: victims[index],
            to_address: sourceAddress,
            quant: "1000000",
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
          }]
        };
      },
      listTrc20ApprovalChanges: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress,
      windowStart: new Date(0),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 150,
      maxPagesPerAddress: 2,
      maxInboundSenders: 2,
      maxApprovalDrainCandidates: 5,
      allTimeSubjectIndexState: completeIndexState(sourceAddress, indexedTransfers.length, indexedTransfers.length),
      allTimeMode: "strict",
      secondLayerMaxActiveWalletsPerJob: 0
    });

    expect(new Set(getTransactionCalls)).toEqual(new Set(indexedTransfers.map((item) => item.txHash)));
    expect(report.contractDrivenCampaignSummary).toMatchObject({
      incomingTxTotal: 116,
      txInfoEnrichedIncomingTx: 116,
      campaignClassificationStatus: "complete",
      countsAreLowerBounds: false,
      plainUsdtTransferTxCount: 15,
      wrapperDrivenIncomingTxCount: 101,
      verify20WrapperTxCount: 101
    });
  });
```

- [ ] **Step 3: Run focused test and confirm failure**

Run:

```powershell
npm test -- tests/check/deepForensicCheck.test.ts
```

Expected result before DeepCheck wiring:

```text
FAIL tests/check/deepForensicCheck.test.ts
```

The failure should show that `contractDrivenCampaignSummary` is missing or only zero wrapper transfers were found from all-time plain edges.

---

### Task 5: Wire Campaign Summary Into DeepCheck

**Files:**
- Modify: `src/check/deepForensicCheck.ts`

- [ ] **Step 1: Add modest incoming enrichment limit**

Near `DEFAULT_CONTRACT_DRIVEN_TX_INFO_FETCH_LIMIT`, add a conservative complete-enrichment cap for modest wallets:

```ts
const COMPLETE_CONTRACT_DRIVEN_CAMPAIGN_ENRICHMENT_MAX_INCOMING_TX = 250;

function contractDrivenCampaignTxInfoFetchLimit(input: {
  sourceAddress: string;
  edges: ForensicRouteEdge[];
  maxApprovalDrainCandidates?: number;
}): number {
  const defaultLimit = Math.max(
    input.maxApprovalDrainCandidates ?? 0,
    DEFAULT_CONTRACT_DRIVEN_TX_INFO_FETCH_LIMIT
  );
  const subject = input.sourceAddress.toLowerCase();
  const incomingTxCount = new Set(input.edges
    .filter((edge) => edge.toAddress.toLowerCase() === subject)
    .map((edge) => edge.txHash)
  ).size;
  return incomingTxCount > 0 &&
    incomingTxCount <= COMPLETE_CONTRACT_DRIVEN_CAMPAIGN_ENRICHMENT_MAX_INCOMING_TX
    ? Math.max(defaultLimit, incomingTxCount)
    : defaultLimit;
}
```

This is the narrow first implementation of "full incoming enrichment when modest". Larger wallets remain bounded and must report `countsAreLowerBounds=true`.

- [ ] **Step 2: Pass subject direct edges into contract-driven evidence**

Keep `provenanceEdges` for approval-drain path analysis. For campaign visibility, call `buildContractDrivenEvidenceProfiles` with the full subject direct set:

```ts
  const contractDrivenTxInfoFetchLimit = contractDrivenCampaignTxInfoFetchLimit({
    sourceAddress: input.sourceAddress,
    edges: sourceTransfers.edges,
    maxApprovalDrainCandidates: input.maxApprovalDrainCandidates
  });
  const contractDrivenEvidence = await buildContractDrivenEvidenceProfiles({
    subjectAddress: input.sourceAddress,
    edges: sourceTransfers.edges,
    classifications,
    approvalDrainProvenanceProfiles: approvalDrainProfiles,
    getTransaction: deps.getTransaction,
    fetchEdgesForAddress: async (address) => {
      const result = await fetchEdgesForAddress(deps.tronClient, input, address, 1, { allowRecentFallback: true });
      return result.edges;
    },
    maxTransactionInfoFetches: contractDrivenTxInfoFetchLimit,
    maxSourceActivityChecks: Math.min(20, contractDrivenTxInfoFetchLimit)
  });
```

This is the product distinction:

```text
approval drain provenance = proof/path candidates from provenanceEdges
campaign visibility = subject incoming set from sourceTransfers.edges
```

- [ ] **Step 3: Save campaign summary in report**

In the returned report object, add:

```ts
    contractDrivenCampaignSummary: contractDrivenEvidence.campaignSummary,
```

next to the existing `contractDrivenReceiverProfile` and `contractDrivenTransferProfiles`.

- [ ] **Step 4: Keep extended search trigger compatible**

Find `shouldRunExtendedSearch` input and keep it using a boolean derived from all profiles:

```ts
  const approvalDrainProfiles = approvalDrainAnalysis.profiles;
  const strongestApprovalDrainProfile = approvalDrainProfiles[0] ?? null;
```

Pass `strongestApprovalDrainProfile` into existing places that still expect a single `approvalDrainProfile`.

- [ ] **Step 5: Run DeepCheck focused tests**

Run:

```powershell
npm test -- tests/check/deepForensicCheck.test.ts
```

Expected:

```text
PASS tests/check/deepForensicCheck.test.ts
```

---

### Task 6: Preserve Multiple Approval-Drain Profiles In DeepCheck

**Files:**
- Modify: `src/check/deepForensicCheck.ts`
- Modify: `src/forensics/approvalDrainProvenance.ts`
- Modify: `tests/check/deepForensicCheck.test.ts`
- Modify: `tests/forensics/approvalDrainProvenance.test.ts`

- [ ] **Step 1: Add suspicion-aware candidate ranking test**

In `tests/forensics/approvalDrainProvenance.test.ts`, add a test that proves a smaller Verify20 wrapper candidate can be checked before larger plain transfers:

```ts
  it("prioritizes wrapper-like transferFrom candidates over larger plain transfers", async () => {
    const getTransaction = vi.fn(async (txHash: string) => txHash === "tx-small-wrapper"
      ? {
        ownerAddress: spender,
        contractData: { contract_address: spender, function_selector: "Verify20(address,address,address,uint256)" },
        trigger_info: { methodName: "Verify20" },
        trc20TransferInfo: [{
          from_address: victim,
          to_address: subject,
          quant: "2000000000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
        }]
      }
      : {
        ownerAddress: "TLargePlainSender111111111111111",
        contractData: { contract_address: TRON_USDT_CONTRACT_ADDRESS, function_selector: "transfer(address,uint256)" },
        trigger_info: { methodName: "transfer" },
        trc20TransferInfo: [{
          from_address: "TLargePlainSender111111111111111",
          to_address: subject,
          quant: "90000000000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
        }]
      });
    const analysis = await buildApprovalDrainProvenanceAnalysis({
      subjectAddress: subject,
      edges: [
        edge({
          id: "tx-large-plain",
          from: "TLargePlainSender111111111111111",
          to: subject,
          amountRaw: "90000000000",
          at: "2026-05-20T09:00:00.000Z"
        }),
        edge({
          id: "tx-small-wrapper",
          from: victim,
          to: subject,
          amountRaw: "2000000000",
          at: "2026-05-20T10:00:00.000Z",
          edgeType: "transfer_from"
        })
      ],
      deps: {
        getTransaction,
        listTrc20ApprovalChanges: vi.fn(async () => [approval({
          ownerAddress: victim,
          spenderAddress: spender,
          amountRaw: "2000000000",
          timestamp: new Date("2026-05-20T09:50:00.000Z")
        })]),
        getUsdtRestrictionStatus: vi.fn()
      },
      maxCandidates: 1
    });

    expect(getTransaction).toHaveBeenCalledWith("tx-small-wrapper");
    expect(analysis.profiles).toEqual([expect.objectContaining({
      drainTxHash: "tx-small-wrapper",
      victimAddress: victim,
      amountRaw: "2000000000"
    })]);
  });
```

- [ ] **Step 2: Replace amount-only sorting in approval-drain analysis**

In `src/forensics/approvalDrainProvenance.ts`, replace:

```ts
    .sort((a, b) => compareBigintDesc(edgeAmount(a), edgeAmount(b)))
```

with:

```ts
    .sort(compareApprovalDrainCandidates)
```

Add:

```ts
function compareApprovalDrainCandidates(left: ForensicRouteEdge, right: ForensicRouteEdge): number {
  const rankOrder = approvalDrainCandidateRank(right) - approvalDrainCandidateRank(left);
  if (rankOrder !== 0) return rankOrder;
  const amountOrder = compareBigintDesc(edgeAmount(left), edgeAmount(right));
  if (amountOrder !== 0) return amountOrder;
  return right.timestamp.getTime() - left.timestamp.getTime();
}

function approvalDrainCandidateRank(edge: ForensicRouteEdge): number {
  const method = edge.method.trim().toLowerCase();
  let rank = 0;
  if (edge.edgeType === "transfer_from") rank += 100;
  if (method.includes("verify20")) rank += 80;
  if (method.includes("transferfrom") || method.includes("23b872dd")) rank += 70;
  if (method.includes("permit")) rank += 40;
  if (method.length > 0 && !methodLooksPlainTransfer(method)) rank += 10;
  return rank;
}
```

Use the existing local plain-transfer detector if it exists in this file. If it does not, add the same `methodLooksPlainTransfer` and `normalizeTransferMethod` helpers from Task 3.

- [ ] **Step 3: Use multi-profile analysis in DeepCheck**

In `src/check/deepForensicCheck.ts`, import `buildApprovalDrainProvenanceAnalysis` instead of `buildApprovalDrainProvenanceProfile`.

Replace the single-profile block with:

```ts
  const approvalDrainAnalysis = deps.getTransaction && deps.listTrc20ApprovalChanges
    ? await buildApprovalDrainProvenanceAnalysis({
      subjectAddress: input.sourceAddress,
      edges: provenanceEdges,
      classifications,
      deps: {
        getTransaction: deps.getTransaction,
        listTrc20ApprovalChanges: deps.listTrc20ApprovalChanges,
        getUsdtRestrictionStatus: deps.getUsdtRestrictionStatus
      },
      maxCandidates: input.maxApprovalDrainCandidates,
      approvalChangeLookupLimit: input.approvalChangeLookupLimit
    }).catch(() => ({ profiles: [], reviewFindings: [] }))
    : { profiles: [], reviewFindings: [] };
  const approvalDrainProfiles = approvalDrainAnalysis.profiles;
  const approvalDrainProfile = approvalDrainProfiles[0] ?? null;
```

Keep existing single-profile evidence/observation behavior for the strongest profile in this task. Add multi-profile raw evidence in a later task only if product needs every profile as a separate observation.

- [ ] **Step 4: Add DeepCheck multi-profile test**

In `tests/check/deepForensicCheck.test.ts`, add a test with two wrapper drains into the subject and two valid approvals. Assert:

```ts
    expect(report.approvalDrainProvenanceProfiles).toHaveLength(2);
    expect(report.contractDrivenReceiverProfile?.exactApprovalDrainCount).toBe(2);
    expect(report.contractDrivenCampaignSummary?.exactApprovalDrainProfileCount).toBe(2);
```

Use two `transfer(...)` or `indexed(...)` rows whose tx-info methods are `Verify20`, and return approval changes matching each victim/spender pair.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm test -- tests/forensics/approvalDrainProvenance.test.ts tests/check/deepForensicCheck.test.ts
```

Expected:

```text
PASS
```

---

### Task 7: Project Campaign Summary In Admin Graph

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add graph summary metadata for campaign denominators**

Where `contractDrivenReceiverCampaign` metadata is attached, include the new optional fields from `receiverProfile`:

```ts
        txInfoEnrichedIncomingTx: firstNumber(numberField(receiverProfile, "txInfoEnrichedIncomingTx")),
        campaignClassificationStatus: stringField(receiverProfile, "campaignClassificationStatus"),
        countsAreLowerBounds: booleanField(receiverProfile, "countsAreLowerBounds"),
        plainUsdtTransferTxCount: firstNumber(numberField(receiverProfile, "plainUsdtTransferTxCount")),
        wrapperDrivenIncomingTxCount: firstNumber(numberField(receiverProfile, "wrapperDrivenIncomingTxCount")),
        verify20WrapperTxCount: firstNumber(numberField(receiverProfile, "verify20WrapperTxCount")),
```

- [ ] **Step 2: Read `contractDrivenCampaignSummary` when available**

In the graph projection result summary, add a compact object:

```ts
      contractDrivenCampaign: recordField(result, "contractDrivenCampaignSummary") ?? null,
```

Use the current summary-building pattern in `projectForensicJobGraph`.

- [ ] **Step 3: Add Admin test for denominator visibility**

In `tests/admin/forensicsGraph.test.ts`, add a case next to the existing contract-driven campaign tests:

```ts
  it("projects contract-driven campaign denominators for DeepCheck", () => {
    const subject = "TDeepCampaignSummary111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        contractDrivenCampaignSummary: {
          incomingTxTotal: 116,
          incomingAmountRaw: "440672340000",
          txInfoEnrichedIncomingTx: 116,
          campaignClassificationStatus: "complete",
          countsAreLowerBounds: false,
          plainUsdtTransferTxCount: 15,
          plainUsdtTransferAmountRaw: "115542340000",
          wrapperDrivenIncomingTxCount: 101,
          wrapperDrivenIncomingAmountRaw: "325130000000",
          verify20WrapperTxCount: 101,
          transferFromWrapperTxCount: 0,
          permitWrapperTxCount: 0,
          otherContractMethodTxCount: 0,
          unknownUnenrichedTxCount: 0,
          txInfoUnavailableTxCount: 0,
          exactApprovalDrainProfileCount: 5,
          campaignClusters: [{
            contractAddress: "TURRtRavZxXeoQF6tWbeNQ5gfzWEH7sEHh",
            operatorAddress: "TQvjkKKHukfpa4tNsENAESZwrDExLbgPTL",
            method: "Verify20",
            receiverAddress: subject,
            txCount: 96,
            amountRaw: "269791000000",
            uniqueSourceCount: 96,
            firstSeenAt: "2026-06-28T00:00:00.000Z",
            lastSeenAt: "2026-07-04T00:00:00.000Z",
            knownServiceIdentity: null,
            exactProofCount: 5,
            contextOnlyCount: 91
          }]
        },
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 116,
          totalIncomingAmountRaw: "440672340000",
          contractDrivenIncomingTxCount: 101,
          contractDrivenIncomingAmountRaw: "325130000000",
          uniqueSourceCount: 101,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 5,
          txInfoEnrichedIncomingTx: 116,
          campaignClassificationStatus: "complete",
          countsAreLowerBounds: false,
          plainUsdtTransferTxCount: 15,
          wrapperDrivenIncomingTxCount: 101,
          verify20WrapperTxCount: 101
        },
        contractDrivenTransferProfiles: [],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(JSON.stringify(result.graph.summary)).toContain("incomingTxTotal");
    expect(JSON.stringify(result.graph.summary)).toContain("txInfoEnrichedIncomingTx");
    expect(JSON.stringify(result.graph.summary)).toContain("wrapperDrivenIncomingTxCount");
    expect(JSON.stringify(result.graph.summary)).toContain("plainUsdtTransferTxCount");
  });
```

- [ ] **Step 4: Add Admin role-mark regression for drainer receiver, drainer contract, and victims**

In `tests/admin/forensicsGraph.test.ts`, add a case next to the existing
contract-driven campaign tests:

```ts
  it("marks Verify20 campaign receiver and wrapper contract as drainer role-mark nodes", () => {
    const subject = "TDeepCampaignRoleReceiver111111";
    const contract = "TDeepCampaignRoleContract111111";
    const victimOne = "TDeepCampaignRoleVictim1111111";
    const victimTwo = "TDeepCampaignRoleVictim2222222";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        contractDrivenCampaignSummary: {
          incomingTxTotal: 30,
          incomingAmountRaw: "180000000000",
          txInfoEnrichedIncomingTx: 30,
          campaignClassificationStatus: "complete",
          countsAreLowerBounds: false,
          plainUsdtTransferTxCount: 0,
          plainUsdtTransferAmountRaw: "0",
          wrapperDrivenIncomingTxCount: 30,
          wrapperDrivenIncomingAmountRaw: "180000000000",
          verify20WrapperTxCount: 30,
          transferFromWrapperTxCount: 0,
          permitWrapperTxCount: 0,
          otherContractMethodTxCount: 0,
          unknownUnenrichedTxCount: 0,
          txInfoUnavailableTxCount: 0,
          exactApprovalDrainProfileCount: 0,
          campaignClusters: [{
            contractAddress: contract,
            operatorAddress: "TDeepCampaignRoleOperator11111",
            method: "Verify20",
            receiverAddress: subject,
            txCount: 30,
            amountRaw: "180000000000",
            uniqueSourceCount: 30,
            firstSeenAt: "2026-06-28T00:00:00.000Z",
            lastSeenAt: "2026-07-04T00:00:00.000Z",
            knownServiceIdentity: null,
            exactProofCount: 0,
            contextOnlyCount: 30
          }]
        },
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 30,
          totalIncomingAmountRaw: "180000000000",
          contractDrivenIncomingTxCount: 30,
          contractDrivenIncomingAmountRaw: "180000000000",
          uniqueSourceCount: 30,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 0,
          txInfoEnrichedIncomingTx: 30,
          campaignClassificationStatus: "complete",
          countsAreLowerBounds: false,
          plainUsdtTransferTxCount: 0,
          wrapperDrivenIncomingTxCount: 30,
          verify20WrapperTxCount: 30
        },
        contractDrivenTransferProfiles: [
          {
            txHash: "role-mark-victim-one",
            timestamp: "2026-06-28T00:01:00.000Z",
            amountRaw: "9000000000",
            amount: "9K USDT",
            method: "Verify20",
            callerAddress: "TDeepCampaignRoleOperator11111",
            operatorAddress: "TDeepCampaignRoleOperator11111",
            contractAddress: contract,
            spenderAddress: contract,
            sourceAddress: victimOne,
            victimAddress: victimOne,
            receiverAddress: subject
          },
          {
            txHash: "role-mark-victim-two",
            timestamp: "2026-06-28T00:02:00.000Z",
            amountRaw: "8000000000",
            amount: "8K USDT",
            method: "Verify20",
            callerAddress: "TDeepCampaignRoleOperator11111",
            operatorAddress: "TDeepCampaignRoleOperator11111",
            contractAddress: contract,
            spenderAddress: contract,
            sourceAddress: victimTwo,
            victimAddress: victimTwo,
            receiverAddress: subject
          }
        ],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.nodes.find((node) => node.address === subject)?.metadata.nodeIntelligence).toMatchObject({
      role: "drainer",
      label: "Drainer",
      source: "contract_driven_evidence",
      evidenceStrength: "behavior"
    });
    expect(result.graph.nodes.find((node) => node.address === contract)?.metadata.nodeIntelligence).toMatchObject({
      role: "drainer",
      label: "Drainer contract",
      source: "contract_driven_evidence",
      evidenceStrength: "behavior"
    });
    expect(result.graph.nodes.find((node) => node.address === victimOne)?.metadata.nodeIntelligence).toMatchObject({
      role: "victim",
      label: "Victim",
      source: "contract_driven_evidence"
    });
    expect(result.graph.nodes.find((node) => node.address === victimTwo)?.metadata.nodeIntelligence).toMatchObject({
      role: "victim",
      label: "Victim",
      source: "contract_driven_evidence"
    });
  });
```

This test is the backend acceptance gate for the visual bug. The Admin renderer
already draws the existing drainer/victim role icons when `nodeIntelligence.role`
is present; the implementation must ensure the graph payload actually carries
those roles for a TPdr-like Verify20 campaign.

- [ ] **Step 5: Keep Admin role-mark renderer covered**

In `tests/admin/adminConsole.test.ts`, keep the existing role-mark test and add
one assertion if it is missing:

```ts
expect(renderBlock).toContain("nodeRoleMarkSvg(node, radius)");
expect(renderBlock).toContain("role-marked node-role-");
expect(html).toContain("/admin/assets/node-role/drainer.png");
expect(html).toContain("/admin/assets/node-role/victim.png");
```

Do not add a new icon system. Use the existing `drainer.png` and `victim.png`
assets.

- [ ] **Step 6: Run Admin graph and renderer tests**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
```

Expected:

```text
PASS
```

---

### Task 8: Keep Scoring Conservative

**Files:**
- Modify: `src/risk/unifiedWalletRisk.ts`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add test that campaign context is not exact proof**

Add a test near DeepCheck hard-evidence tests:

```ts
  it("does not treat wrapper campaign context without exact profiles as approval-drain hard evidence", () => {
    const risk = buildUnifiedWalletRisk({
      fastReport: null,
      whereReport: null,
      deepReport: deepReport({
        approvalDrainProvenanceProfiles: [],
        contractDrivenCampaignSummary: {
          incomingTxTotal: 116,
          incomingAmountRaw: "440672340000",
          txInfoEnrichedIncomingTx: 116,
          campaignClassificationStatus: "complete",
          countsAreLowerBounds: false,
          plainUsdtTransferTxCount: 15,
          plainUsdtTransferAmountRaw: "115542340000",
          wrapperDrivenIncomingTxCount: 101,
          wrapperDrivenIncomingAmountRaw: "325130000000",
          verify20WrapperTxCount: 101,
          transferFromWrapperTxCount: 0,
          permitWrapperTxCount: 0,
          otherContractMethodTxCount: 0,
          unknownUnenrichedTxCount: 0,
          txInfoUnavailableTxCount: 0,
          exactApprovalDrainProfileCount: 0,
          campaignClusters: []
        }
      })
    });

    expect(risk.finalDecision).not.toBe("DECLINE");
    expect(risk.hardEvidenceFloor).toBe(0);
  });
```

Use the existing `deepReport(...)` factory in this test file. If it lacks a field passthrough, extend the factory object spread to preserve `contractDrivenCampaignSummary`.

- [ ] **Step 2: Add test that exact profiles still drive hard evidence**

Add:

```ts
  it("keeps exact approval-drain profiles as hard evidence even when campaign context is partial", () => {
    const risk = buildUnifiedWalletRisk({
      fastReport: null,
      whereReport: null,
      deepReport: deepReport({
        approvalDrainProvenanceProfiles: [approvalDrainProfile({ score: 92 })],
        contractDrivenCampaignSummary: {
          incomingTxTotal: 2400,
          incomingAmountRaw: "9000000000000",
          txInfoEnrichedIncomingTx: 200,
          campaignClassificationStatus: "partial",
          countsAreLowerBounds: true,
          plainUsdtTransferTxCount: 126,
          plainUsdtTransferAmountRaw: "1000000000000",
          wrapperDrivenIncomingTxCount: 74,
          wrapperDrivenIncomingAmountRaw: "400000000000",
          verify20WrapperTxCount: 74,
          transferFromWrapperTxCount: 0,
          permitWrapperTxCount: 0,
          otherContractMethodTxCount: 0,
          unknownUnenrichedTxCount: 2200,
          txInfoUnavailableTxCount: 0,
          exactApprovalDrainProfileCount: 1,
          campaignClusters: []
        }
      })
    });

    expect(risk.finalDecision).toBe("DECLINE");
    expect(risk.hardEvidenceFloor).toBeGreaterThanOrEqual(90);
  });
```

- [ ] **Step 3: Adjust scoring only if tests expose a real false hard-evidence path**

If the first test already passes, do not add scoring code. If it fails, change only the branch that treats contract-driven campaign context as hard evidence so that hard evidence requires `approvalDrainProvenanceProfiles.length > 0` or an equivalent exact proof count.

- [ ] **Step 4: Run focused scoring tests**

Run:

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts
```

Expected:

```text
PASS tests/risk/unifiedWalletRisk.test.ts
```

---

### Task 9: Update Knowledge Docs After Behavior Change

**Files:**
- Modify: `docs/knowledge/06-deepcheck.md`
- Modify: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`

- [ ] **Step 1: Update DeepCheck knowledge**

Add to `docs/knowledge/06-deepcheck.md` under Current Behavior after implementation:

```md
DeepCheck separates canonical USDT transfers from wrapper-driven incoming
activity in its contract-driven campaign summary. When the subject incoming set
is small enough for transaction-info enrichment, DeepCheck reports denominator
counters such as total incoming tx, enriched incoming tx, plain USDT transfer
tx, wrapper-driven tx, Verify20 tx, exact approval-drain profile count, and
campaign clusters. Partial enrichment is marked as lower-bound context.
```

- [ ] **Step 2: Update scoring knowledge**

Add to `docs/knowledge/07-risk-scoring-matrix.md`:

```md
Wrapper-driven campaign context is not the same as exact approval-drain proof.
A broad Verify20 campaign can increase review pressure, but hard evidence
floors require exact approval/provenance profiles or another deterministic hard
evidence source. Plain canonical USDT transfers do not count as drainer-like
contract-driven evidence.
```

- [ ] **Step 3: Update Admin UX knowledge**

Add to `docs/knowledge/08-admin-and-bot-ux.md`:

```md
DeepCheck Admin campaign displays should show denominator counters instead of a
single ambiguous contract-driven count: incoming tx total, tx-info enriched,
plain USDT transfers, wrapper-driven incoming, Verify20 wrapper tx, exact proof
count, and whether counts are complete or lower bounds.
```

- [ ] **Step 4: Update current decisions**

Add to `docs/knowledge/09-current-decisions.md`:

```md
## 2026-07-05 DeepCheck Drainer-Campaign Visibility

DeepCheck should show broad drainer-campaign context separately from exact
approval-drain proof. Canonical USDT transfers stay plain. Verify20 and similar
non-USDT wrapper calls are campaign context until exact approval/provenance
proof is established. Reports must include enrichment denominators so partial
campaign counts are not presented as complete totals.
```

- [ ] **Step 5: Update open problems**

Replace the active TPdr DeepCheck open problem in `docs/knowledge/10-open-problems.md` with:

```md
- DeepCheck now separates plain USDT transfers from wrapper-driven campaign
  context and reports enrichment denominators for contract-driven campaign
  summaries. Remaining open work: calibrate enrichment budgets on very large
  wallets and decide whether campaign clusters should get a dedicated product
  severity tier beyond the current review-context behavior.
```

- [ ] **Step 6: Run docs checks**

Run:

```powershell
git diff --check -- docs/knowledge docs/superpowers/plans/2026-07-05-deepcheck-drainer-campaign-visibility.md
Get-ChildItem -LiteralPath 'docs\\knowledge' -Filter '*.md' | Select-String -Pattern 'T[O]DO|T[B]D|\\?\\?\\?' -CaseSensitive:$false
```

Expected:

```text
no output from git diff --check
no unfinished marker matches
```

---

### Task 10: Final Verification

**Files:**
- No new code files beyond the modified existing files.

- [ ] **Step 1: Run focused forensic tests**

Run:

```powershell
npm test -- tests/forensics/contractDrivenEvidence.test.ts tests/forensics/approvalDrainProvenance.test.ts tests/check/deepForensicCheck.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 2: Run graph and scoring tests**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/risk/unifiedWalletRisk.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected:

```text
no TypeScript errors
```

- [ ] **Step 4: Run whitespace check**

Run:

```powershell
git diff --check
```

Expected:

```text
no output
```

- [ ] **Step 5: Review final diff**

Run:

```powershell
git diff -- src/types.ts src/forensics/contractDrivenEvidence.ts src/forensics/approvalDrainProvenance.ts src/check/deepForensicCheck.ts src/admin/forensicsGraph.ts src/risk/unifiedWalletRisk.ts tests/forensics/contractDrivenEvidence.test.ts tests/forensics/approvalDrainProvenance.test.ts tests/check/deepForensicCheck.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/risk/unifiedWalletRisk.test.ts docs/knowledge
```

Expected review result:

- no product-code changes outside DeepCheck contract campaign visibility and scoring guards;
- canonical USDT transfers do not produce drainer-like `contractDrivenTransferProfiles`;
- Verify20 wrapper tx can be counted from transaction-info even when local index edges look like plain `transfer`;
- campaign counts include denominators and lower-bound status;
- multiple exact approval-drain profiles are preserved where proof exists;
- campaign context alone does not become exact hard evidence.
- Admin graph payload marks drainer-like Verify20 receivers and wrapper
  contracts with `nodeIntelligence.role = "drainer"` so the existing skull icon
  renderer can show them.
- Admin graph payload marks Verify20 source wallets as victims when the source
  differs from the receiver and the receiver campaign is drainer-like.

## Plan Self-Review

- Spec coverage: covers plain-transfer pollution, Verify20 underreporting, full subject incoming enrichment for modest wallets, multi-profile exact approval-drain proof, Admin denominator display, Admin drainer/victim role marks, conservative scoring, and knowledge docs.
- Scope control: does not change TronScan indexing, migrations, provider key pool, Where source-of-funds logic, or Telegram formatting.
- Test coverage: starts with focused failing tests in `contractDrivenEvidence`, then adds TPdr-like DeepCheck all-time coverage, approval candidate ranking, Admin projection, and scoring guard tests.
- Type consistency: the plan uses one new summary type, `ContractDrivenCampaignSummary`, and one classification enum, `ContractDrivenTransferClassification`.
- Known limit: very large wallets remain bounded. Partial enrichment must show `countsAreLowerBounds=true` instead of pretending the campaign count is complete.
