# Forensic and Scoring Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make contract-backed GasFree accounts traceable and scoreable as ordinary addresses, recognize their dynamic fees structurally, materialize complete local provenance honestly, and resolve every final decision from one evidence-and-coverage policy.

**Architecture:** Keep provider acquisition and existing report storage, then add four narrow semantic seams: address boundary policy, a pure GasFree settlement extractor, bounded local-index materialization, and a canonical final-disposition resolver over normalized matrix candidates. Existing Fast, Deep, Where, and Incoming modes remain separate; unified Wallet/Incoming results consume their evidence without inferring proof class from a numeric score.

**Tech Stack:** TypeScript 5.7, Node.js, Vitest, PostgreSQL repository functions, TronWeb 6, existing Telegram/Admin serializers. No new dependency and no SQL migration.

---

## Reference And Scope Lock

Implement against `docs/superpowers/specs/2026-07-10-forensic-and-scoring-correctness-design.md`.

The following decisions are non-negotiable:

- GasFree Accounts and unknown contracts are non-boundaries; known pooled infrastructure remains a boundary.
- `TLntW9Z59LYY5KEi9cmwk3PKjQga828ird` is a registered TronLink/GasFree provider identity and pooled boundary, but a movement is a GasFree fee only after structural settlement matching.
- Exact subject-applicable hard proof yields `DECLINE` even when unrelated coverage is partial.
- Invalid required coverage without exact hard proof yields `NO_FINAL_DECISION` and `finalScore=null`.
- A context-only Fast score yields at most `REVIEW`, regardless of whether the raw score is 85 or 90.
- `REVIEW` remains `REVIEW`; matrix `INSUFFICIENT_EVIDENCE` maps to `NO_FINAL_DECISION`.
- Existing provider/index acquisition, retry, splitting, and safety-ceiling behavior is not redesigned.

Before Task 1, create or switch to a dedicated `codex/forensic-scoring-correctness` worktree. Confirm `git status --short` is empty and run the focused baseline tests named below. Do not implement this plan on a dirty worktree.

## Scope Check

This is intentionally one causal implementation track: contract-backed account semantics determine edge roles; edge roles determine trace completeness; trace completeness determines evidence eligibility; and that evidence plus decision-scoped coverage determines the final disposition shown by Bot/Admin. Every task leaves a focused, runnable regression check and a commit boundary. Full-audit UI redesign, worker/runtime hardening, migrations, historical rescoring, and provider-acquisition redesign remain deferred.

## File Responsibility Map

### New files

| File | Responsibility |
|---|---|
| `src/forensics/gasFreeSettlement.ts` | Versioned controller/selector registry, calldata decoding, authoritative transfer-list selection, and exact principal/fee extraction |
| `tests/forensics/gasFreeSettlement.test.ts` | Real-address structural fixtures, dynamic fees, duplicate aliases, and mismatch rejection |
| `tests/forensics/counterpartyRisk.test.ts` | Direct scoring controls for traceable contracts and exact service-fee exclusion |
| `src/risk/fastEvidence.ts` | Single allowlist/classifier for exact Fast hard evidence versus context |
| `tests/risk/fastEvidence.test.ts` | Numeric-score non-promotion and exact-code eligibility |
| `src/risk/finalDisposition.ts` | Decision-scoped coverage model and the only matrix-to-user decision resolver |
| `tests/risk/finalDisposition.test.ts` | Hard-proof precedence, lossless decision mapping, and nullable-score behavior |

### Existing production files

| File | Responsibility after this change |
|---|---|
| `src/types.ts` | Economic-role, local-materialization, nullable final-score, and Incoming `REVIEW` contracts |
| `src/forensics/serviceClassifier.ts` | Address facts/identity and explicit boundary policy, including GasFree Account/Endpoint and TLnt registry |
| `src/forensics/moneyOriginTrace.ts` | Resolve transaction-local economic role on selected edges and traverse non-boundary contracts at every hop |
| `src/check/whereIsMoneyCheck.ts` | Cache transaction context, classify exact GasFree accounts, remove Fast-score promotion, and emit explicit invalid/no-final reports |
| `src/forensics/contractDrivenEvidence.ts` | Emit GasFree principal/fee profiles without drainer inflation |
| `src/forensics/serviceRouteEvidence.ts` | Keep label-only GasFree contextual and exact settlement evidence explicit |
| `src/forensics/counterpartyRisk.ts` | Exclude only exact service-fee edges and true boundaries from counterparty risk |
| `src/forensics/counterpartyInteraction.ts` | Do not zero non-boundary contracts; keep exact fee interactions visible with zero risk propagation |
| `src/forensics/inboundProvenance.ts` | Keep principal edges in provenance and exclude exact service-fee edges |
| `src/forensics/flowCounterpartyProfile.ts` | Compute service/unknown-contract metrics from true boundaries, not category alone |
| `src/forensics/incomingDepositExposureProfile.ts` | Treat non-boundary contracts as ordinary unknown addresses, not service exposure |
| `src/check/deepForensicCheck.ts` | Resolve direct-edge economic roles and require `isBoundary` for service snapshots |
| `src/bot/createBot.ts` | Run contract-safety and transfer analysis together; consume canonical final disposition |
| `src/check/smartContractCheck.ts` | Convert standalone contract-safety output into bounded context evidence for unified scoring |
| `src/forensics/localTronUsdtIndex.ts` | Page a complete local index until concrete proof, window exhaustion, or a local safety ceiling |
| `src/storage/repositories.ts` | Stable offset ordering for indexed transfer pages |
| `src/forensics/deepForensicJob.ts` | Use local materialization for complete Where indexes and persist explicit score validity |
| `src/forensics/incomingDepositJob.ts` | Use local materialization for complete deposit provenance and preserve resolver outcomes |
| `src/forensics/moneyOriginOperationalAssessment.ts` | Create hard evidence only from eligible codes and represent local failures as invalid coverage |
| `src/risk/scoringSignalMatrix.ts` | Normalize every candidate with evidence class, proof level, subject, and coverage dependency |
| `src/risk/scoringSignalMatrixInputs.ts` | Build Fast/Deep/Where/Incoming candidates from the canonical evidence classifiers |
| `src/risk/riskPolicy.ts` | Reuse the same explicit Fast hard-code allowlist instead of a second prefix classifier |
| `src/risk/unifiedWalletRisk.ts` | Produce Wallet final fields exclusively through `resolveFinalDisposition` |
| `src/risk/unifiedIncomingDepositRisk.ts` | Produce Incoming final fields through the same resolver without flattening `REVIEW` |
| `src/bot/riskExplanationSummary.ts` | Keep a null final score separate from observed context |
| `src/admin/adminServer.ts` | Stop remapping canonical decisions and show hard decline with partial coverage |
| `src/alerts/formatters.ts` | Render Incoming technical stops without a fake numeric final score |
| `src/alerts/notificationText.ts` | Explain local-index failures as technical limitations |

## Task 1: Separate Contract Facts From Address Boundaries

**Files:**

- Modify: `src/forensics/serviceClassifier.ts:126-287`
- Test: `tests/forensics/serviceClassifier.test.ts:260-458`

- [ ] **Step 1: Write failing classifier tests**

Replace the stale GasFree/unknown-contract expectations and add the registered provider case:

```ts
it.each([
  "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP",
  "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD"
])("classifies real GasFree Account %s as a non-boundary contract account", (address) => {
  const result = classifyServiceAddress({
    address,
    metadata: { address, name: "CreatedByContract", tag: null, isContract: true, verified: false },
    contractProfile: {
      providerTags: [{ kind: "greyTag", label: "GasFree Account", url: null }],
      verified: false,
      providerRisk: false,
      methodMap: { "6f21b898": "permitTransfer(address,address,address,uint256,uint256,uint256,uint256,uint256,bytes)" },
      topMethods: []
    }
  });

  expect(result).toMatchObject({ category: "service", isBoundary: false });
  expect(result.evidence).toContain("role:gasfree_account");
});

it("keeps GasFree Endpoint as a boundary", () => {
  const address = "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U";
  const result = classifyServiceAddress({
    address,
    metadata: { address, name: "GasFree Endpoint", tag: "GasFree Endpoint", isContract: true, verified: true }
  });
  expect(result).toMatchObject({ category: "service", isBoundary: true });
  expect(result.evidence).toContain("role:gasfree_endpoint");
});

it("keeps an unresolved generic GasFree tag traceable", () => {
  const address = "TGenericGasFree1111111111111111111111";
  const result = classifyServiceAddress({
    address,
    metadata: { address, name: "GasFree", tag: "GasFree", isContract: true, verified: false }
  });
  expect(result).toMatchObject({ category: "service", isBoundary: false });
  expect(result.evidence).toContain("role:gasfree_unresolved");
});

it("keeps a weak unknown contract traceable", () => {
  const address = "TUnknownContract111111111111111111111";
  const result = classifyServiceAddress({
    address,
    metadata: { address, name: null, tag: null, isContract: true, verified: false },
    contractProfile: { verified: false, providerRisk: false, lowMetadata: true, topMethods: [] }
  });
  expect(result).toMatchObject({ category: "unknown_contract", isBoundary: false });
});

it("recognizes the TronLink GasFree provider as pooled infrastructure without metadata", () => {
  const result = classifyServiceAddress({
    address: "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird"
  });
  expect(result).toMatchObject({
    category: "service",
    identity: "TronLink GasFree provider",
    confidence: "high",
    isBoundary: true
  });
  expect(result.evidence).toContain("registry:tronlink_gasfree_provider");
});
```

- [ ] **Step 2: Run the classifier tests and verify RED**

Run:

```powershell
npm test -- tests/forensics/serviceClassifier.test.ts
```

Expected: failures show GasFree Accounts and weak unknown contracts still have `isBoundary: true`, and TLnt has no registered identity.

- [ ] **Step 3: Implement explicit boundary selection**

Use these exact helpers and branch rules in `serviceClassifier.ts`:

```ts
const KNOWN_POOLED_SERVICE_ADDRESSES = new Map([
  [
    "tlntw9z59lyy5kei9cmwk3pkjqga828ird",
    { category: "service" as const, identity: "TronLink GasFree provider", evidence: "registry:tronlink_gasfree_provider" }
  ]
]);

function classification(
  input: ClassifyServiceAddressInput,
  category: ServiceCategory,
  identity: string | null,
  confidence: RiskConfidence,
  evidence: string[],
  isBoundary = category !== "none" && category !== "unknown_contract"
): ServiceClassification {
  return { category, identity, confidence, evidence, isBoundary };
}
```

At the start of `classifyServiceAddress()`, before text heuristics:

```ts
const registered = KNOWN_POOLED_SERVICE_ADDRESSES.get(input.address.toLowerCase());
if (registered) {
  return classification(input, registered.category, registered.identity, "high", [registered.evidence], true);
}
```

Replace the current broad GasFree branch with:

```ts
const gasFreeAccount = /\bgas\s*free account\b/.test(identityText);
const gasFreeEndpoint = /\bgas\s*free (endpoint|controller)\b/.test(identityText);
if (gasFreeAccount || gasFreeEndpoint || /\bgas\s*free\b/.test(identityText)) {
  const roleEvidence = gasFreeAccount
    ? "role:gasfree_account"
    : gasFreeEndpoint
      ? "role:gasfree_endpoint"
      : "role:gasfree_unresolved";
  return classification(
    input,
    "service",
    identityFor(input, "GasFree service"),
    confidenceFor(input, true),
    ["tag:gasfree_service", roleEvidence],
    gasFreeEndpoint
  );
}
```

The existing weak-contract branch must call `classification(...)` without an override so the new `unknown_contract` default is non-boundary.

- [ ] **Step 4: Run the classifier tests and verify GREEN**

Run `npm test -- tests/forensics/serviceClassifier.test.ts`.

Expected: all tests pass; CEX/DEX/router/bridge/pool controls remain `isBoundary: true`.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/forensics/serviceClassifier.ts tests/forensics/serviceClassifier.test.ts
git commit -m "fix: separate contract facts from tracing boundaries"
```

## Task 2: Consume `isBoundary` Across Fast, Deep, Where, And Incoming

**Files:**

- Modify: `src/check/deepForensicCheck.ts:698-711`
- Modify: `src/forensics/counterpartyInteraction.ts:56-75`
- Modify: `src/forensics/counterpartyRisk.ts:102-126`
- Modify: `src/forensics/flowCounterpartyProfile.ts:250-390`
- Modify: `src/check/whereIsMoneyCheck.ts:780-810`
- Modify: `src/forensics/incomingDepositExposureProfile.ts:370-410`
- Modify: `src/forensics/approvalDrainProvenance.ts:810-830`
- Modify: `tests/fixtures/forensics/regressionCases.ts:38`
- Test: `tests/forensics/counterpartyInteraction.test.ts`
- Create: `tests/forensics/counterpartyRisk.test.ts`
- Test: `tests/forensics/flowCounterpartyProfile.test.ts`
- Test: `tests/forensics/deepSecondLayerRelationship.test.ts`
- Modify: `tests/forensics/routeSearch.test.ts`
- Test: `tests/forensics/moneyOriginTrace.test.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`
- Test: `tests/forensics/incomingDepositExposureProfile.test.ts`
- Test: `tests/forensics/approvalDrainProvenance.test.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`
- Test: `tests/check/forensicRegressionCases.test.ts`

- [ ] **Step 1: Add RED consumer tests**

Use the shared non-boundary fixture:

```ts
const traceableContract = (identity: string): ServiceClassification => ({
  category: identity === "unknown" ? "unknown_contract" : "service",
  identity,
  confidence: "high",
  evidence: ["test:traceable_contract"],
  isBoundary: false
});
const subject = "TSubject111111111111111111111111111";
const gasFreeHop1 = "TGasFreeHop111111111111111111111111";
const unknownHop2 = "TUnknownHop222222222222222222222222";
const gasFreeHop3 = "TGasFreeHop333333333333333333333333";
const binance = "TBinanceBoundary11111111111111111111";
```

Create `counterpartyRisk.test.ts` with a compile-ready direct control:

```ts
import { describe, expect, it } from "vitest";
import { buildCounterpartyRiskProfiles } from "../../src/forensics/counterpartyRisk";
import type { ForensicRouteEdge, ServiceClassification } from "../../src/types";

it("does not emit service-boundary context for a non-boundary contract", () => {
  const subjectAddress = "TSubject111111111111111111111111111";
  const contractAddress = "TGasFree111111111111111111111111111";
  const edge: ForensicRouteEdge = {
    id: "tx-direct",
    txHash: "tx-direct",
    fromAddress: subjectAddress,
    toAddress: contractAddress,
    amountRaw: "1000000000",
    timestamp: new Date("2026-07-10T00:00:00.000Z"),
    method: "transfer",
    edgeType: "normal_transfer"
  };
  const classification: ServiceClassification = {
    category: "service",
    identity: "GasFree Account",
    confidence: "high",
    evidence: ["test:gasfree_account"],
    isBoundary: false
  };
  const profiles = buildCounterpartyRiskProfiles({
    subjectAddress,
    edges: [edge],
    labelsByAddress: new Map(),
    classifications: new Map([[contractAddress, classification]])
  });
  expect(profiles).toEqual([]);
});
```

Add the following assertions immediately after the existing public builder call in the corresponding named test; `pathAddresses` is source/root → subject and must not be reversed:

```ts
expect(snapshot.source).not.toBe("service_boundary");
expect(profile.features.map((feature) => feature.code)).not.toContain("counterparty_service_boundary_context");
expect(profile.scoreContribution).toBeGreaterThan(0);
expect(secondLayer.statuses.find((item) => item.address === gasFree)?.status).not.toBe("stopped_service_boundary");
expect(path.pathAddresses).toEqual([binance, gasFreeHop3, unknownHop2, gasFreeHop1, subject]);
expect(path.stoppedReason).toBe("allowlist_cex_reached");
expect(path.reasons.join(" ")).not.toContain("unlabeled_service_boundary");
```

In the existing “TFagr-style wrapper contracts” approval test, add `contract_map: { [victim]: true }` to the transaction and pass:

```ts
classifications: new Map([[victim, {
  category: "service",
  identity: "GasFree Account",
  confidence: "high",
  evidence: ["test:gasfree_account"],
  isBoundary: false
}]])
```

Then assert `profiles[0].evidenceStrength === "exact_approval_and_transfer_from"`.

Build the trace in `moneyOriginTrace.test.ts` as:

```text
Binance boundary -> GasFree Account -> unknown contract -> GasFree Account -> subject
```

In `incomingDepositExposureProfile.test.ts` or the existing Incoming job fixture, assert that a non-boundary `unknown_contract` contributes to `unknownShare`, not `unknownContractShare`.

In `routeSearch.test.ts`, retain/add a direct Fast-scope control using one supplied GasFree Account: the direct transfer is counted and expansion is not stopped as `service_boundary`; the registered TLnt provider control still counts the direct transfer and stops expansion.

- [ ] **Step 2: Run the boundary-consumer tests and verify RED**

Run:

```powershell
npm test -- tests/forensics/counterpartyInteraction.test.ts tests/forensics/counterpartyRisk.test.ts tests/forensics/flowCounterpartyProfile.test.ts tests/forensics/deepSecondLayerRelationship.test.ts tests/forensics/routeSearch.test.ts tests/forensics/moneyOriginTrace.test.ts tests/forensics/approvalDrainProvenance.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/incomingDepositExposureProfile.test.ts tests/check/forensicRegressionCases.test.ts
```

Expected: category-only consumers still emit boundary context or suppress contributions.

- [ ] **Step 3: Replace every category-as-boundary guard in scope**

Use the same condition in `snapshotForService()`, `emptySnapshot()`, `groupedProfiles()`, source-class mapping, and exposure bucketing:

```ts
const serviceCategory =
  classification?.isBoundary === true && classification.category !== "none"
    ? classification.category
    : null;
```

For profile ratios, retain category labels for display but count service/bridge/router/DEX/unknown-contract exposure only when `classification.isBoundary === true`. A non-boundary unlabelled contract follows the ordinary unknown-address branch.

In `approvalDrainProvenance.ts`, replace `sourceIsContractOrServiceBoundary` with `sourceIsBoundary` and remove `addressIsContractInTransaction(...)` from the guard. Exact approval plus confirmed `transferFrom` may apply to a non-boundary smart account; only a true shared boundary activates that false-positive guard.

Change the regression fixture conclusion from an `unknown_contract` stop to the final known Binance boundary. Do not change consumers already using `isServiceBoundary()` or `classification.isBoundary` correctly.

- [ ] **Step 4: Run the focused suite and verify GREEN**

Run the Step 2 command.

Expected: all modes traverse contract-backed accounts through hops 1-3, while true pooled infrastructure still stops expansion.

- [ ] **Step 5: Commit Task 2**

```powershell
git add src/check/deepForensicCheck.ts src/forensics/counterpartyInteraction.ts src/forensics/counterpartyRisk.ts src/forensics/flowCounterpartyProfile.ts src/check/whereIsMoneyCheck.ts src/forensics/incomingDepositExposureProfile.ts src/forensics/approvalDrainProvenance.ts tests/fixtures/forensics/regressionCases.ts tests/forensics/counterpartyInteraction.test.ts tests/forensics/counterpartyRisk.test.ts tests/forensics/flowCounterpartyProfile.test.ts tests/forensics/deepSecondLayerRelationship.test.ts tests/forensics/routeSearch.test.ts tests/forensics/moneyOriginTrace.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/incomingDepositExposureProfile.test.ts tests/forensics/approvalDrainProvenance.test.ts tests/check/whereIsMoneyCheck.test.ts tests/check/forensicRegressionCases.test.ts
git commit -m "fix: consume explicit boundary policy across forensic modes"
```

## Task 3: Add The Pure GasFree Settlement Extractor

**Files:**

- Modify: `src/types.ts:150-175, 960-1065`
- Create: `src/forensics/gasFreeSettlement.ts`
- Create: `tests/forensics/gasFreeSettlement.test.ts`

- [ ] **Step 1: Write the real-address fixture and failing structural tests**

Create the test file with these constants and calldata helpers:

```ts
import { describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";
import { TRON_USDT_CONTRACT_ADDRESS as USDT } from "../../src/parser/transactionParser";
import { extractGasFreeSettlement } from "../../src/forensics/gasFreeSettlement";

const CONTROLLER = "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U";
const ACCOUNT = "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP";
const USER = "TW2Py9fWGc1HVXhejufX1stuwQ9N42Y8RE";
const RECEIVER = "TMwjbNHpsVSjn93vtWtLnThHwhAJAnrWNq";
const TLNT = "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird";
const OTHER_FEE = "TFNX7TKYCm1kUYDECjkrogBwYZvt69XQNy";

const uintWord = (value: bigint) => value.toString(16).padStart(64, "0");
const addressWord = (address: string) => TronWeb.address.toHex(address).slice(2).padStart(64, "0");

function permitData(value: bigint, maxFee: bigint): string {
  const signature = "11".repeat(65);
  return [
    "6f21b898",
    addressWord(USDT),
    addressWord(USER),
    addressWord(RECEIVER),
    uintWord(value),
    uintWord(maxFee),
    uintWord(1_800_000_000n),
    uintWord(1n),
    uintWord(9n),
    uintWord(0x120n),
    uintWord(65n),
    signature.padEnd(192, "0")
  ].join("");
}

function row(toAddress: string, amountRaw: string) {
  return {
    from_address: ACCOUNT,
    to_address: toAddress,
    amount_str: amountRaw,
    contract_address: USDT,
    status: 0,
    tokenInfo: { tokenId: USDT, tokenAbbr: "USDT", tokenType: "trc20" }
  };
}

function transaction(rows: unknown[], value = 97_000_000n, maxFee = 3_000_000n) {
  return {
    confirmed: true,
    contractRet: "SUCCESS",
    revert: false,
    contractData: { contract_address: CONTROLLER, data: permitData(value, maxFee) },
    trc20TransferInfo: rows,
    tokenTransferInfo: rows.map((item) => ({ ...(item as Record<string, unknown>) }))
  };
}
```

Add the exact-positive and table-driven negative tests:

```ts
describe("extractGasFreeSettlement", () => {
  it("extracts dynamic principal plus multiple fee recipients without alias double-counting", () => {
    const result = extractGasFreeSettlement(transaction([
      row(TLNT, "1000000"),
      row(RECEIVER, "97000000"),
      row(OTHER_FEE, "2000000")
    ]));

    expect(result).toMatchObject({
      protocol: "tron_gasfree",
      controllerVersion: "permit_transfer_v1",
      controllerAddress: CONTROLLER,
      accountAddress: ACCOUNT,
      userAddress: USER,
      receiverAddress: RECEIVER,
      principalAmountRaw: "97000000",
      maxFeeRaw: "3000000",
      serviceFeeAmountRaw: "3000000",
      grossDebitAmountRaw: "100000000",
      evidenceStrength: "exact"
    });
    expect(result?.movements.filter((item) => item.role === "service_fee")).toEqual([
      expect.objectContaining({ toAddress: TLNT, amountRaw: "1000000" }),
      expect.objectContaining({ toAddress: OTHER_FEE, amountRaw: "2000000" })
    ]);
  });

  it("accepts a changed collector, a 1.5 USDT fee, and zero fee", () => {
    expect(extractGasFreeSettlement(transaction([row(RECEIVER, "97000000"), row(OTHER_FEE, "1500000")], 97_000_000n, 1_500_000n))?.serviceFeeAmountRaw).toBe("1500000");
    expect(extractGasFreeSettlement(transaction([row(RECEIVER, "97000000")], 97_000_000n, 0n))?.serviceFeeAmountRaw).toBe("0");
  });

  it.each([
    ["15000000", "2000000"],
    ["42000000", "1000000"]
  ])("accepts later value %s with dynamic fee %s", (valueRaw, feeRaw) => {
    const result = extractGasFreeSettlement(transaction(
      [row(RECEIVER, valueRaw), row(OTHER_FEE, feeRaw)],
      BigInt(valueRaw),
      BigInt(feeRaw)
    ));
    expect(result).toMatchObject({ principalAmountRaw: valueRaw, serviceFeeAmountRaw: feeRaw });
  });

  it.each([
    ["fee exceeds maxFee", transaction([row(RECEIVER, "97000000"), row(TLNT, "3000001")], 97_000_000n, 3_000_000n)],
    ["principal does not equal value", transaction([row(RECEIVER, "96000000"), row(TLNT, "1000000")])],
    ["receiver does not match calldata", transaction([row(OTHER_FEE, "97000000"), row(TLNT, "1000000")])],
    ["unregistered tag-only controller", { ...transaction([row(RECEIVER, "97000000")]), addressTag: "GasFree Endpoint", contractData: { contract_address: ACCOUNT, data: permitData(97_000_000n, 0n) } }],
    ["malformed calldata", { ...transaction([row(RECEIVER, "97000000")]), contractData: { contract_address: CONTROLLER, data: "0x6f21b898zz" } }],
    ["unconfirmed transaction", { ...transaction([row(RECEIVER, "97000000")]), confirmed: false }],
    ["failed transaction", { ...transaction([row(RECEIVER, "97000000")]), contractRet: "REVERT" }]
  ])("rejects %s", (_name, input) => {
    expect(extractGasFreeSettlement(input)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the extractor test and verify RED**

Run `npm test -- tests/forensics/gasFreeSettlement.test.ts`.

Expected: module-not-found failure for `gasFreeSettlement.ts`.

- [ ] **Step 3: Add runtime economic-role types and implement the extractor**

In `src/types.ts`, add:

```ts
export type ForensicEconomicRole = "principal" | "service_fee";
export type ForensicEconomicProtocol = "tron_gasfree";
```

Add these optional fields to `ForensicRouteEdge`, `BalanceFormingTransfer`, `ContractDrivenTransferProfile`, and each `DirectCounterpartyInteractionProfile.transfers[]` row:

```ts
economicRole?: ForensicEconomicRole;
economicProtocol?: ForensicEconomicProtocol;
```

Extend `ContractDrivenTransferClassification` with `"gasfree_principal" | "gasfree_service_fee"`. These are runtime/report fields only; do not add persistence columns.

Create `gasFreeSettlement.ts` with the following public contract and parsing rules:

```ts
import { TronWeb } from "tronweb";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ForensicRouteEdge } from "../types";

export type GasFreeMovementRole = "principal" | "service_fee";
export type GasFreeSettlementMovement = {
  role: GasFreeMovementRole;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
};
export type GasFreeSettlement = {
  protocol: "tron_gasfree";
  controllerVersion: "permit_transfer_v1";
  controllerAddress: string;
  accountAddress: string;
  userAddress: string;
  receiverAddress: string;
  principalAmountRaw: string;
  maxFeeRaw: string;
  serviceFeeAmountRaw: string;
  grossDebitAmountRaw: string;
  movements: GasFreeSettlementMovement[];
  evidenceStrength: "exact";
  evidenceCodes: string[];
};

const CONTROLLERS = new Map([
  ["tffamqlzybalalb4uxha9rbe7pxhuajf3u", {
    version: "permit_transfer_v1" as const,
    selectors: new Set(["6f21b898"])
  }]
]);
const TRANSFER_LIST_KEYS = [
  "trc20TransferInfo",
  "trc20TransferInfoList",
  "tokenTransferInfo",
  "tokenTransferInfoList",
  "transfersAllList",
  "transfers"
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function text(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) if (typeof source[key] === "string" && source[key]) return source[key] as string;
  return null;
}
function normalizedAddress(value: string): string | null {
  try {
    if (/^41[0-9a-f]{40}$/i.test(value)) return TronWeb.address.fromHex(value);
    if (/^0x[0-9a-f]{40}$/i.test(value)) return TronWeb.address.fromHex(`41${value.slice(2)}`);
    return TronWeb.address.fromHex(TronWeb.address.toHex(value));
  } catch {
    return null;
  }
}
function addressWord(word: string): string | null {
  return /^[0-9a-f]{64}$/i.test(word) ? normalizedAddress(`41${word.slice(-40)}`) : null;
}
function uintWord(word: string | undefined): bigint | null {
  if (!word || !/^[0-9a-f]{64}$/i.test(word)) return null;
  try { return BigInt(`0x${word}`); } catch { return null; }
}
function selectedTransfers(tx: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of TRANSFER_LIST_KEYS) {
    const value = tx[key];
    if (Array.isArray(value) && value.length > 0) return value.map(record).filter((item): item is Record<string, unknown> => item !== null);
  }
  return [];
}
function rowToken(row: Record<string, unknown>): string | null {
  const tokenInfo = record(row.tokenInfo);
  return text(row, ["contract_address", "contractAddress", "tokenId"]) ?? (tokenInfo ? text(tokenInfo, ["tokenId", "token_id"]) : null);
}
function rowAmount(row: Record<string, unknown>): string | null {
  return text(row, ["amount_str", "amountStr", "quant", "amount", "value", "rawAmount"]);
}
function sameAddress(left: string, right: string): boolean {
  const normalizedLeft = normalizedAddress(left);
  const normalizedRight = normalizedAddress(right);
  return normalizedLeft !== null && normalizedRight !== null && normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
}

export function extractGasFreeSettlement(transactionInfo: unknown): GasFreeSettlement | null {
  const tx = record(transactionInfo);
  if (!tx || tx.confirmed !== true || tx.revert === true) return null;
  const contractRet = text(tx, ["contractRet", "contract_ret", "finalResult"]);
  if (contractRet?.toUpperCase() !== "SUCCESS") return null;

  const contractData = record(tx.contractData) ?? record(tx.contract_data);
  if (!contractData) return null;
  const controllerAddress = text(contractData, ["contract_address", "contractAddress"]);
  const rawData = text(contractData, ["data"]);
  const data = rawData?.startsWith("0x") ? rawData.slice(2) : rawData;
  const normalizedController = controllerAddress ? normalizedAddress(controllerAddress) : null;
  if (!normalizedController || !data || !/^[0-9a-f]+$/i.test(data) || data.length < 8 + 5 * 64) return null;
  const controller = CONTROLLERS.get(normalizedController.toLowerCase());
  const selector = data.slice(0, 8).toLowerCase();
  if (!controller?.selectors.has(selector)) return null;

  const words = data.slice(8).match(/.{64}/g) ?? [];
  const tokenAddress = words[0] ? addressWord(words[0]) : null;
  const userAddress = words[1] ? addressWord(words[1]) : null;
  const receiverAddress = words[2] ? addressWord(words[2]) : null;
  if (!tokenAddress || !userAddress || !receiverAddress || !sameAddress(tokenAddress, TRON_USDT_CONTRACT_ADDRESS)) return null;
  const principal = uintWord(words[3]);
  const maxFee = uintWord(words[4]);
  if (principal === null || maxFee === null) return null;

  const rows = selectedTransfers(tx).filter((row) => {
    const token = rowToken(row);
    return token !== null && sameAddress(token, TRON_USDT_CONTRACT_ADDRESS);
  });
  if (rows.length === 0) return null;
  const normalizedSenders = rows.map((row) => {
    const sender = text(row, ["from_address", "fromAddress"]);
    return sender ? normalizedAddress(sender) : null;
  });
  if (normalizedSenders.some((sender) => sender === null)) return null;
  const senders = [...new Set(normalizedSenders.map((sender) => sender!.toLowerCase()))];
  if (senders.length !== 1) return null;
  const accountAddress = normalizedSenders[0];
  if (!accountAddress) return null;

  const movements: GasFreeSettlementMovement[] = [];
  for (const row of rows) {
    const rawFromAddress = text(row, ["from_address", "fromAddress"]);
    const rawToAddress = text(row, ["to_address", "toAddress"]);
    const fromAddress = rawFromAddress ? normalizedAddress(rawFromAddress) : null;
    const toAddress = rawToAddress ? normalizedAddress(rawToAddress) : null;
    const amountRaw = rowAmount(row);
    if (!fromAddress || !toAddress || !amountRaw || !/^\d+$/.test(amountRaw) || !sameAddress(fromAddress, accountAddress)) return null;
    movements.push({
      role: sameAddress(toAddress, receiverAddress) ? "principal" : "service_fee",
      fromAddress,
      toAddress,
      amountRaw
    });
  }
  const principalTotal = movements.filter((item) => item.role === "principal").reduce((sum, item) => sum + BigInt(item.amountRaw), 0n);
  const feeTotal = movements.filter((item) => item.role === "service_fee").reduce((sum, item) => sum + BigInt(item.amountRaw), 0n);
  if (principalTotal !== principal || feeTotal > maxFee) return null;

  return {
    protocol: "tron_gasfree",
    controllerVersion: controller.version,
    controllerAddress: normalizedController,
    accountAddress,
    userAddress,
    receiverAddress,
    principalAmountRaw: principal.toString(),
    maxFeeRaw: maxFee.toString(),
    serviceFeeAmountRaw: feeTotal.toString(),
    grossDebitAmountRaw: (principal + feeTotal).toString(),
    movements,
    evidenceStrength: "exact",
    evidenceCodes: ["gasfree_controller_registered", "gasfree_permit_transfer", "gasfree_value_and_fee_balanced"]
  };
}

export function gasFreeMovementForEdge(
  settlement: GasFreeSettlement,
  edge: Pick<ForensicRouteEdge, "fromAddress" | "toAddress" | "amountRaw">
): GasFreeSettlementMovement | null {
  return settlement.movements.find((movement) =>
    sameAddress(movement.fromAddress, edge.fromAddress) &&
    sameAddress(movement.toAddress, edge.toAddress) &&
    movement.amountRaw === edge.amountRaw
  ) ?? null;
}

export function extractGasFreeEdgeContext(
  transactionInfo: unknown,
  edge: Pick<ForensicRouteEdge, "fromAddress" | "toAddress" | "amountRaw">
): { settlement: GasFreeSettlement; movement: GasFreeSettlementMovement } | null {
  const settlement = extractGasFreeSettlement(transactionInfo);
  if (!settlement) return null;
  const movement = gasFreeMovementForEdge(settlement, edge);
  return movement ? { settlement, movement } : null;
}

export function isGasFreeServiceFeeEdge(
  edge: Pick<ForensicRouteEdge, "economicRole" | "economicProtocol">
): boolean {
  return edge.economicProtocol === "tron_gasfree" && edge.economicRole === "service_fee";
}
```

- [ ] **Step 4: Run extractor tests and typecheck**

Run:

```powershell
npm test -- tests/forensics/gasFreeSettlement.test.ts
npm run typecheck
```

Expected: both commands pass. Verify no fee amount or fee-recipient address appears in production matching logic.

- [ ] **Step 5: Commit Task 3**

```powershell
git add src/types.ts src/forensics/gasFreeSettlement.ts tests/forensics/gasFreeSettlement.test.ts
git commit -m "feat: extract exact GasFree settlements"
```

## Task 4: Propagate GasFree Roles Through Where And Incoming

**Files:**

- Modify: `src/forensics/moneyOriginTrace.ts:20-85, 450-790`
- Modify: `src/forensics/incomingDepositCashflow.ts:115-165`
- Modify: `src/check/whereIsMoneyCheck.ts:1110-1510`
- Modify: `src/forensics/incomingDepositJob.ts:1110-1215, 1580-1660`
- Test: `tests/forensics/moneyOriginTrace.test.ts`
- Test: `tests/forensics/incomingDepositCashflow.test.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add failing all-hop and fee-role tests**

Add a resolver-aware trace fixture to `moneyOriginTrace.test.ts`:

```ts
const subject = "TSubject111111111111111111111111111";
const gasFree1 = "TGasFreeHop111111111111111111111111";
const gasFree2 = "TGasFreeHop222222222222222222222222";
const gasFree3 = "TGasFreeHop333333333333333333333333";
const binance = "TBinanceBoundary11111111111111111111";
const edge = (
  txHash: string,
  fromAddress: string,
  toAddress: string,
  amountRaw = "100000000",
  timestamp = "2026-07-10T00:00:00.000Z"
): ForensicRouteEdge => ({
  id: txHash,
  txHash,
  fromAddress,
  toAddress,
  amountRaw,
  timestamp: new Date(timestamp),
  method: "transfer",
  edgeType: "normal_transfer"
});
const hopEdges = new Map([
  [gasFree1, [edge("tx-hop-2", gasFree2, gasFree1)]],
  [gasFree2, [edge("tx-hop-3", gasFree3, gasFree2)]],
  [gasFree3, [edge("tx-binance", binance, gasFree3)]]
]);
const principalTxHashes = new Set(["tx-seed", "tx-hop-2", "tx-hop-3", "tx-binance"]);
const baseTraceInput: TraceMoneyOriginPathInput = {
  subjectAddress: subject,
  balanceTransfer: {
    txHash: "tx-seed",
    fromAddress: gasFree1,
    toAddress: subject,
    amountRaw: "100000000",
    timestamp: "2026-07-10T00:01:00.000Z",
    coverageShare: 1,
    selectedReason: "covers_current_balance"
  },
  maxDepth: 5,
  beamWidth: 4,
  maxAddressFetches: 10,
  maxEdgesPerAddress: 10,
  fetchEdgesForAddress: async (address) => hopEdges.get(address) ?? [],
  getLabelsForAddress: async () => [],
  getClassificationForAddress: async () => null
};
const gasFreePrincipal = (edge: ForensicRouteEdge): ForensicRouteEdge => ({
  ...edge,
  economicRole: "principal",
  economicProtocol: "tron_gasfree"
});
const gasFreeFee = (edge: ForensicRouteEdge): ForensicRouteEdge => ({
  ...edge,
  economicRole: "service_fee",
  economicProtocol: "tron_gasfree"
});

it("traces GasFree principal edges at hops one two and three", async () => {
  const path = await traceMoneyOriginPath({
    ...baseTraceInput,
    resolveEconomicContext: async (edge) => principalTxHashes.has(edge.txHash) ? gasFreePrincipal(edge) : edge,
    getClassificationForAddress: async (address) => address === binance
      ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["test"], isBoundary: true }
      : { category: "service", identity: "GasFree Account", confidence: "high", evidence: ["test"], isBoundary: false }
  });
  expect(path.pathAddresses).toEqual([binance, gasFree3, gasFree2, gasFree1, subject]);
  expect(path.stoppedReason).toBe("allowlist_cex_reached");
});

it("stops an exact GasFree service fee without treating payer history as provenance", async () => {
  const fetched: string[] = [];
  const path = await traceMoneyOriginPath({
    ...baseTraceInput,
    balanceTransfer: {
      ...baseTraceInput.balanceTransfer,
      economicRole: "service_fee",
      economicProtocol: "tron_gasfree"
    },
    fetchEdgesForAddress: async (address) => { fetched.push(address); return []; }
  });
  expect(path.verdict).toBe("REVIEW");
  expect(path.reasons).toContain("Exact GasFree service-fee movement; not payer provenance.");
  expect(fetched).not.toContain(gasFree1);
});

it("keeps an independently verified hard label authoritative over fee context", async () => {
  const path = await traceMoneyOriginPath({
    ...baseTraceInput,
    balanceTransfer: {
      ...baseTraceInput.balanceTransfer,
      economicRole: "service_fee",
      economicProtocol: "tron_gasfree"
    },
    getLabelsForAddress: async (address) => address === gasFree1 ? [{
      address,
      label: "scam",
      source: "service_admin",
      createdByTelegramId: "1",
      createdAt: new Date("2026-07-10T00:00:00.000Z")
    }] : []
  });
  expect(path.verdict).toBe("DECLINE");
  expect(path.rootSourceType).toBe("risky_label");
});

it("does not classify an unmatched transfer to TLnt as a GasFree fee", () => {
  const ordinaryTlntTransfer = edge("tx-ordinary-tlnt", subject, "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird");
  expect(extractGasFreeEdgeContext({ confirmed: true, contractRet: "SUCCESS", trc20TransferInfo: [] }, ordinaryTlntTransfer)).toBeNull();
});

it("counts an exact GasFree fee in spend-before-hop arithmetic", () => {
  const account = "TGasFreeSpend11111111111111111111111";
  const oldFunding = edge("old-funding", "TFunder111111111111111111111111111", account, "100", "2026-07-10T00:00:00.000Z");
  const fee = {
    ...edge("gasfree-fee", account, "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird", "3", "2026-07-10T00:01:00.000Z"),
    economicRole: "service_fee" as const,
    economicProtocol: "tron_gasfree" as const
  };
  const target = edge("principal-out", account, "TReceiver11111111111111111111111111", "97", "2026-07-10T00:02:00.000Z");
  const bundle = buildFundingBundleForTraceHop({
    target,
    edges: [oldFunding, fee, target],
    minCoverageRatio: 1,
    maxFunders: 3
  });
  expect(bundle?.members[0]).toMatchObject({
    usedAmountRaw: "97",
    spentBeforeHopRaw: "3"
  });
});

it("does not select an inbound GasFree fee as provenance funding", () => {
  const sender = "TSender111111111111111111111111111111";
  const fee = {
    ...edge("fee-in", "TGasFree111111111111111111111111111", sender, "3", "2026-07-10T00:00:00.000Z"),
    economicRole: "service_fee" as const,
    economicProtocol: "tron_gasfree" as const
  };
  const selection = selectIncomingDepositFundingCandidates({
    sender,
    watchedWallet: "TWatched1111111111111111111111111111",
    depositTxHash: "deposit",
    depositAmountRaw: "3",
    depositTimestamp: new Date("2026-07-10T00:01:00.000Z"),
    edges: [fee]
  });
  expect(selection.candidates).toEqual([]);
});
```

Add integration assertions in Where and Incoming:

```ts
expect(report.originPaths[0].pathAddresses).toContain(gasFreeAccount);
expect(report.originPaths[0].stoppedReason).toBe("allowlist_cex_reached");
expect(report.contractDrivenTransferProfiles).toEqual(expect.arrayContaining([
  expect.objectContaining({ classification: "gasfree_principal", countsAsDrainerContext: false })
]));

expect(feeReport.reasons.join(" ")).toContain("GasFree service-fee");
expect(feeReport.sourceBundleExposure?.riskyLabelShare ?? 0).toBe(0);
expect(ordinaryTlntReport.reasons.join(" ")).not.toContain("GasFree service-fee");
```

- [ ] **Step 2: Run the focused trace tests and verify RED**

Run:

```powershell
npm test -- tests/forensics/moneyOriginTrace.test.ts tests/forensics/incomingDepositCashflow.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts
```

Expected: `economicRole` fields and `resolveEconomicContext` do not exist, and GasFree child accounts still lose transaction-local roles.

- [ ] **Step 3: Preserve economic role when building balance seeds**

Wherever a resolved `ForensicRouteEdge` becomes a `BalanceFormingTransfer`, copy the Task 3 fields explicitly:

```ts
async function resolveBalanceTransfer(transfer: BalanceFormingTransfer): Promise<BalanceFormingTransfer> {
  const resolvedEdge = await resolveEconomicContext({
    id: transfer.txHash,
    txHash: transfer.txHash,
    fromAddress: transfer.fromAddress,
    toAddress: transfer.toAddress,
    amountRaw: transfer.amountRaw,
    timestamp: new Date(transfer.timestamp),
    method: transfer.method ?? "transfer",
    edgeType: transfer.edgeType ?? "normal_transfer"
  });
  return {
    ...transfer,
    economicRole: resolvedEdge.economicRole,
    economicProtocol: resolvedEdge.economicProtocol
  };
}
```

For indexed/raw edges without exact settlement context, both fields remain undefined.

- [ ] **Step 4: Add the bounded per-edge resolver to Where**

Import `extractGasFreeEdgeContext` and add one transaction promise cache inside `runWhereIsMoneyCheck()`:

```ts
const transactionCache = new Map<string, Promise<unknown | null>>();
const exactGasFreeAccounts = new Set<string>();
const getCachedTransaction = (txHash: string): Promise<unknown | null> => {
  if (!deps.getTransaction) return Promise.resolve(null);
  const existing = transactionCache.get(txHash);
  if (existing) return existing;
  const request = deps.getTransaction(txHash).catch(() => null);
  transactionCache.set(txHash, request);
  return request;
};
const resolveEconomicContext = async (edge: ForensicRouteEdge): Promise<ForensicRouteEdge> => {
  const context = extractGasFreeEdgeContext(await getCachedTransaction(edge.txHash), edge);
  if (!context) return edge;
  exactGasFreeAccounts.add(context.settlement.accountAddress.toLowerCase());
  return {
    ...edge,
    economicRole: context.movement.role,
    economicProtocol: "tron_gasfree"
  };
};
const getBaseCachedClassification = async (address: string): Promise<ServiceClassification | null> => {
  throwIfAborted(input.abortSignal);
  const cacheKey = classificationCacheKey(address);
  if (classifications.has(cacheKey)) return classifications.get(cacheKey) ?? null;
  const classification = await deps.getClassificationForAddress(cacheKey).catch(() => null);
  throwIfAborted(input.abortSignal);
  classifications.set(cacheKey, classification);
  return classification;
};
const getCachedClassification = async (address: string): Promise<ServiceClassification | null> => {
  if (exactGasFreeAccounts.has(address.toLowerCase())) {
    return {
      category: "service",
      identity: "GasFree Account",
      confidence: "high",
      evidence: ["gasfree_settlement:exact_account"],
      isBoundary: false
    };
  }
  return getBaseCachedClassification(address);
};
```

Resolve every selected balance transfer before calling `traceMoneyOriginPath()`, and pass `getCachedClassification` plus `resolveEconomicContext` into the tracer. Keep the cache bounded naturally to transaction hashes on selected branches; do not scan every historical transaction.

- [ ] **Step 5: Teach the shared tracer to respect economic role**

Extend `TraceMoneyOriginPathInput`:

```ts
resolveEconomicContext?(edge: ForensicRouteEdge): Promise<ForensicRouteEdge>;
```

Use this helper before accepting the seed, a single candidate, or a bundle member:

```ts
async function withEconomicContext(
  input: TraceMoneyOriginPathInput,
  edge: ForensicRouteEdge
): Promise<ForensicRouteEdge> {
  return input.resolveEconomicContext ? input.resolveEconomicContext(edge) : edge;
}
```

Carry the resolved incoming role in `TraceState`:

```ts
incomingEconomicRole: ForensicEconomicRole | null;
incomingEconomicProtocol: ForensicEconomicProtocol | null;
```

Initialize those fields from `input.balanceTransfer` and set them from each resolved candidate/bundle edge when building the next state. After `classifyMoneyOriginStop()`, replace the current `if (stop)` block with this ordered form:

```ts
const appendStopPath = (resolvedStop: NonNullable<typeof stop>): void => {
  terminals.push(pathFromState({
    state,
    balanceTransferTxHash: input.balanceTransfer.txHash,
    balanceShare: state.balanceShare,
    amountUsage: input.balanceTransfer.amountUsage ?? null,
    rootSourceType: resolvedStop.rootSourceType,
    stoppedReason: resolvedStop.stoppedReason,
    verdict: resolvedStop.verdict,
    riskScoreContribution: resolvedStop.riskScoreContribution,
    exposureSourceKey: resolvedStop.exposureSourceKey,
    exposureSourceLabel: resolvedStop.exposureSourceLabel,
    sourceExposureKind: resolvedStop.sourceExposureKind,
    reasons: resolvedStop.reasons
  }));
};
const exactRiskStop = stop?.rootSourceType === "risky_label" || stop?.sourceExposureKind === "sanctioned_service";
if (stop && exactRiskStop) {
  appendStopPath(stop);
  continue;
}
if (!exactRiskStop && state.incomingEconomicProtocol === "tron_gasfree" && state.incomingEconomicRole === "service_fee") {
  terminals.push(pathFromState({
    state,
    balanceTransferTxHash: input.balanceTransfer.txHash,
    balanceShare: state.balanceShare,
    amountUsage: input.balanceTransfer.amountUsage ?? null,
    rootSourceType: "unknown",
    stoppedReason: "service_boundary",
    verdict: "REVIEW",
    riskScoreContribution: 0,
    reasons: ["Exact GasFree service-fee movement; not payer provenance."]
  }));
  continue;
}
if (stop) {
  appendStopPath(stop);
  continue;
}
```

Principal edges follow the ordinary candidate/bundle path. Never synthesize an EOA-to-account money edge. Import `isGasFreeServiceFeeEdge()` in `incomingDepositCashflow.ts`: pass all resolved edges into chronological spend-before-hop arithmetic so outgoing exact fees consume balance, but skip exact fee edges only when an edge is about to become an inbound provenance/funding candidate in `selectIncomingDepositFundingCandidates()`, `buildFundingBundleForOutbound()`, or `buildFundingBundleForTraceHop()`.

- [ ] **Step 6: Keep Incoming transaction-seeded semantics**

Before Incoming replaces the deposit with funding candidates, resolve the concrete deposit edge:

```ts
const depositSeed = incomingSeedTransfer(input);
const depositEdge: ForensicRouteEdge = {
  id: input.depositTxHash,
  txHash: input.depositTxHash,
  fromAddress: input.sender,
  toAddress: input.watchedWallet,
  amountRaw: input.amountRaw,
  timestamp: input.timestamp,
  method: depositSeed.method ?? "transfer",
  edgeType: depositSeed.edgeType ?? "normal_transfer"
};
const depositEconomicContext = deps.getTransaction
  ? extractGasFreeEdgeContext(await deps.getTransaction(input.depositTxHash).catch(() => null), depositEdge)
  : null;
const forceTransactionSeed = depositEconomicContext?.movement.role === "service_fee";
const fundingSelection = forceTransactionSeed
  ? { candidates: [], coverageRaw: input.amountRaw, coverageRatio: 1, amountContinuity: "strong" as const }
  : selectIncomingDepositFundingCandidates({
      sender: input.sender,
      watchedWallet: input.watchedWallet,
      depositTxHash: input.depositTxHash,
      depositAmountRaw: input.amountRaw,
      depositTimestamp: input.timestamp,
      edges: senderEdges
    });
```

Pass the same cached transaction getter to Where. A principal deposit retains funding-first behavior; a service-fee deposit is displayed as service revenue and does not inherit the payer's provenance.

- [ ] **Step 7: Run the trace and Incoming tests**

Run the Step 2 command and `npm run typecheck`.

Expected: all pass; the supplied GasFree accounts are traversed and dynamic fee edges are contextual only.

- [ ] **Step 8: Commit Task 4**

```powershell
git add src/forensics/moneyOriginTrace.ts src/forensics/incomingDepositCashflow.ts src/check/whereIsMoneyCheck.ts src/forensics/incomingDepositJob.ts tests/forensics/moneyOriginTrace.test.ts tests/forensics/incomingDepositCashflow.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "fix: trace GasFree principal and fee roles"
```

## Task 5: Integrate GasFree Roles Into Deep And Contract Evidence

**Files:**

- Modify: `src/forensics/contractDrivenEvidence.ts:430-980`
- Modify: `src/forensics/serviceRouteEvidence.ts:230-300`
- Modify: `src/forensics/counterpartyRisk.ts:80-155`
- Modify: `src/forensics/counterpartyInteraction.ts:150-230`
- Modify: `src/forensics/flowCounterpartyProfile.ts:130-290`
- Modify: `src/forensics/serviceExposure.ts:190-370`
- Modify: `src/forensics/inboundProvenance.ts:45-135`
- Modify: `src/check/deepForensicCheck.ts:620-720, 1430-1620`
- Test: `tests/forensics/contractDrivenEvidence.test.ts`
- Test: `tests/forensics/serviceRouteEvidence.test.ts`
- Modify: `tests/forensics/counterpartyRisk.test.ts`
- Test: `tests/forensics/counterpartyInteraction.test.ts`
- Test: `tests/forensics/flowCounterpartyProfile.test.ts`
- Test: `tests/forensics/serviceExposure.test.ts`
- Test: `tests/forensics/inboundProvenance.test.ts`
- Test: `tests/check/deepForensicCheck.test.ts`

- [ ] **Step 1: Add failing Deep/contract-role tests**

Use the Task 3 transaction fixture and assert:

```ts
expect(serviceFeeProfile).toMatchObject({
  classification: "gasfree_service_fee",
  economicRole: "service_fee",
  economicProtocol: "tron_gasfree",
  countsAsDrainerContext: false
});
expect(principalProfile).toMatchObject({
  classification: "gasfree_principal",
  economicRole: "principal",
  countsAsDrainerContext: false
});
expect(campaign.campaignClusters).toHaveLength(0);
expect(deep.counterpartyRiskProfiles.some((profile) => profile.counterpartyAddress === tlnt)).toBe(false);
const feeInteraction = deep.directCounterpartyInteractionProfiles.find((profile) => profile.counterpartyAddress === tlnt);
expect(feeInteraction).toMatchObject({ scoreContribution: 0 });
expect(feeInteraction?.transfers).toEqual(expect.arrayContaining([
  expect.objectContaining({ txHash: feeTxHash, economicRole: "service_fee", economicProtocol: "tron_gasfree" })
]));
expect(deep.serviceExposureProfiles[0]?.exposureScore ?? 0).toBe(0);
expect(deep.inboundProvenanceProfiles.flatMap((profile) => profile.paths).every((path) => !path.txHashes.includes(feeTxHash))).toBe(true);
expect(deep.inboundProvenanceProfiles.flatMap((profile) => profile.paths).some((path) => path.txHashes.includes(principalTxHash))).toBe(true);
expect(operationalFlow.outgoingVolumeRaw).toBe("100000000");
```

Add controls proving (a) the decoded user EOA never appears as a synthetic money edge, (b) an unmatched direct movement to TLnt remains in the direct-interaction profile without `economicRole:"service_fee"`, and (c) an exact approval-drain fixture still produces the existing exact hard profile.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm test -- tests/forensics/contractDrivenEvidence.test.ts tests/forensics/serviceRouteEvidence.test.ts tests/forensics/counterpartyRisk.test.ts tests/forensics/counterpartyInteraction.test.ts tests/forensics/flowCounterpartyProfile.test.ts tests/forensics/serviceExposure.test.ts tests/forensics/inboundProvenance.test.ts tests/check/deepForensicCheck.test.ts
```

Expected: GasFree permit transfers are still grouped as generic permit/drainer context and fee edges enter counterparty/provenance profiles.

- [ ] **Step 3: Classify contract-driven GasFree movements once per transaction**

In `contractDrivenEvidence.ts`, cache `extractGasFreeSettlement(transactionInfo)` by tx hash. Before generic wrapper classification, map the subject edge:

```ts
const gasFreeContext = extractGasFreeEdgeContext(transactionInfo, edge);
if (gasFreeContext) {
  const role = gasFreeContext.movement.role;
  return {
    classification: role === "principal" ? "gasfree_principal" : "gasfree_service_fee",
    countsAsDrainerContext: false,
    economicRole: role,
    economicProtocol: "tron_gasfree"
  };
}
```

Exclude both GasFree classifications from campaign clusters/counts. Extend the existing amount reader with `amount_str` and `amountStr`, and replace concatenated alias arrays with the same first-non-empty list order used by `gasFreeSettlement.ts`.

In `serviceRouteEvidence.ts`, exact settlement emits `gasfree_controller_exact` plus `gasfree_principal` or `gasfree_service_fee`; tag-only GasFree remains the existing medium-confidence fallback.

- [ ] **Step 4: Filter exact fees, not principal**

Resolve direct edges once in `deepForensicCheck.ts` with a tx-hash promise cache. Pass the enriched edge list to counterparty/provenance builders.

At the start of risk-bearing counterparty grouping, flow/service exposure, and inbound provenance selection, use the shared helper:

```ts
const riskEligibleEdges = input.edges.filter((edge) => !isGasFreeServiceFeeEdge(edge));
```

Compute gross incoming/outgoing totals from `input.edges`; build risk-bearing counterparty groups, unique-peer counts, service-exposure scoring, label propagation, campaign counts, and provenance from `riskEligibleEdges`. Principal edges remain in both sets.

`buildDirectCounterpartyInteractionProfiles()` is the display exception: group all edges so the real fee/provider interaction stays visible, copy `economicRole/economicProtocol` into its transfer rows, but calculate snapshot weight/contribution from non-fee edges only. A fee-only group therefore remains present with `scoreContribution:0`; a mixed group scores only its ordinary/principal portion while `volumeRaw` still reports the gross interaction.

- [ ] **Step 5: Run focused tests and typecheck**

Run the Step 2 command and `npm run typecheck`.

Expected: exact GasFree roles are visible, fees do not propagate payer risk, and approval-drain controls still pass.

- [ ] **Step 6: Commit Task 5**

```powershell
git add src/forensics/contractDrivenEvidence.ts src/forensics/serviceRouteEvidence.ts src/forensics/counterpartyRisk.ts src/forensics/counterpartyInteraction.ts src/forensics/flowCounterpartyProfile.ts src/forensics/serviceExposure.ts src/forensics/inboundProvenance.ts src/check/deepForensicCheck.ts tests/forensics/contractDrivenEvidence.test.ts tests/forensics/serviceRouteEvidence.test.ts tests/forensics/counterpartyRisk.test.ts tests/forensics/counterpartyInteraction.test.ts tests/forensics/flowCounterpartyProfile.test.ts tests/forensics/serviceExposure.test.ts tests/forensics/inboundProvenance.test.ts tests/check/deepForensicCheck.test.ts
git commit -m "fix: exclude GasFree fees from forensic risk propagation"
```

## Task 6: Run Contract Safety Alongside Ordinary `/check` Analysis

**Files:**

- Modify: `src/check/smartContractCheck.ts:1-35, 395-430`
- Modify: `src/bot/createBot.ts:180-215, 1260-1320, 3860-3980`
- Test: `tests/check/smartContractCheck.test.ts`
- Test: `tests/bot/createBot.test.ts:2361-2425`

- [ ] **Step 1: Replace the opposite-policy bot tests**

Replace the tests asserting early return with:

```ts
it("runs contract safety Fast Where and Deep for a contract address", async () => {
  const queued: string[] = [];
  const saved: Array<Record<string, unknown>> = [];
  const { bot, calls } = await createSmokeBot({
    checkSmartContractAddress: async () => smartContractReportForTest(),
    queueWhereIsMoneyJob: async () => { queued.push("where"); return whereIsMoneyJobForTest({ id: "where-contract" }); },
    queueDeepForensicJob: async () => { queued.push("deep"); return whereIsMoneyJobForTest({ id: "deep-contract", kind: "address_deep_check" }); },
    saveAddressFastCheckJob: async (input) => { saved.push(input.resultJson); return whereIsMoneyJobForTest({ id: "fast-contract", kind: "address_fast_check" }); }
  });
  await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));
  expect(queued).toEqual(["where", "deep"]);
  expect(saved[0]).toMatchObject({
    contractSafetyAnalysis: { status: "completed", report: expect.objectContaining({ subjectAddress: walletAddress }) }
  });
  expect(lastPlainText(calls)).toContain("transfer analysis continues");
});

it("continues Fast Where and Deep when contract safety is unavailable", async () => {
  let queueCalls = 0;
  const { bot, calls } = await createSmokeBot({
    checkSmartContractAddress: async () => { throw new Error("contract metadata unavailable"); },
    queueWhereIsMoneyJob: async () => { queueCalls += 1; return whereIsMoneyJobForTest({ id: "where-unavailable" }); },
    queueDeepForensicJob: async () => { queueCalls += 1; return whereIsMoneyJobForTest({ id: "deep-unavailable", kind: "address_deep_check" }); }
  });
  await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));
  expect(queueCalls).toBe(2);
  expect(lastPlainText(calls)).toContain("Contract safety unavailable");
  expect(lastPlainText(calls)).toContain("transfer analysis continues");
});
```

Use the existing `whereIsMoneyJobForTest()` fixture exactly as shown.

- [ ] **Step 2: Run the bot tests and verify RED**

Run `npm test -- tests/bot/createBot.test.ts -t "contract safety"`.

Expected: current early returns prevent Where/Deep queueing.

- [ ] **Step 3: Convert contract safety into bounded Fast context**

Export this helper from `smartContractCheck.ts`:

```ts
export function mergeContractSafetyContext(
  fastReport: RiskReport,
  contractReport: SmartContractCheckReport
): RiskReport {
  const contextScore = Math.min(59, Math.max(0, contractReport.riskScore));
  return {
    ...fastReport,
    score: Math.max(fastReport.score, contextScore),
    level: contextScore >= 30 && fastReport.level === "LOW" ? "MEDIUM" : fastReport.level,
    reasons: [
      ...fastReport.reasons,
      ...contractReport.reasons.map((reason) => ({
        code: `contract_safety_${reason}`,
        message: `Contract safety context: ${reason}`,
        scoreImpact: contextScore,
        source: "contract_safety",
        confidence: "medium" as const,
        severity: contextScore >= 45 ? "medium" as const : "low" as const,
        evidenceRef: `contract_safety:${contractReport.subjectAddress}:${reason}`
      }))
    ]
  };
}
```

Import `RiskReport` in the type import. This helper deliberately caps standalone contract safety below decline; only exact hard-evidence codes handled later may create a hard candidate.

- [ ] **Step 4: Remove contract-address early returns**

Add one local orchestration type in `createBot.ts`:

```ts
type ContractSafetyAnalysis =
  | { status: "not_applicable" }
  | { status: "completed"; report: SmartContractCheckReport }
  | { status: "unavailable"; error: string | null };
```

Resolve it before `checkAddress()`, but never return. Merge completed output into the Fast report, pass the merged Fast snapshot to both queues, and persist the full `contractSafetyAnalysis` in Fast `resultJson` and queued `progressJson`.

Add `contractSafetyAnalysis?: ContractSafetyAnalysis` to `QueueAddressForensicJobInput` and `AddressCheckStartedOptions`; keep it optional so legacy/internal callers compile without fabricating a result.

`formatAddressCheckStarted()` must add exactly one status line:

```ts
const contractSafetyLine = analysis.status === "completed"
  ? "Contract safety completed; transfer analysis continues and will produce the final decision."
  : analysis.status === "unavailable"
    ? "Contract safety unavailable; transfer analysis continues and the limitation is preserved."
    : null;
```

Do not show the standalone contract report's decision as a competing final decision.

- [ ] **Step 5: Run Smart Contract and bot tests**

Run:

```powershell
npm test -- tests/check/smartContractCheck.test.ts tests/bot/createBot.test.ts
npm run typecheck
```

Expected: both pass for contract and EOA controls.

- [ ] **Step 6: Commit Task 6**

```powershell
git add src/check/smartContractCheck.ts src/bot/createBot.ts tests/check/smartContractCheck.test.ts tests/bot/createBot.test.ts
git commit -m "fix: run transfer analysis alongside contract safety"
```

## Task 7: Add Bounded Local-Index Materialization

**Files:**

- Modify: `src/types.ts:500-520, 1426-1455`
- Modify: `src/forensics/localTronUsdtIndex.ts`
- Modify: `src/storage/repositories.ts:4784-4885`
- Modify: `src/forensics/incomingDepositJob.ts:90-115`
- Modify: `src/index.ts:510-530`
- Test: `tests/forensics/localTronUsdtIndex.test.ts`
- Test: `tests/storage/repositories.test.ts`

- [ ] **Step 1: Write failing materializer tests**

Append these cases to `localTronUsdtIndex.test.ts` using numeric rows because the helper is generic:

```ts
describe("materializeIndexedTransferWindow", () => {
  const base = {
    address: "TMaterialize111111111111111111111111",
    minTimestamp: new Date("2026-01-01T00:00:00.000Z"),
    maxTimestamp: new Date("2026-07-10T00:00:00.000Z"),
    pageSize: 2,
    maxRows: 5
  };

  it("pages until a short page proves local completion", async () => {
    const rows = [1, 2, 3];
    const offsets: number[] = [];
    const result = await materializeIndexedTransferWindow({
      ...base,
      readPage: async (_address, options) => {
        offsets.push(options.offset);
        return rows.slice(options.offset, options.offset + options.limit);
      }
    });
    expect(offsets).toEqual([0, 2]);
    expect(result).toMatchObject({ rows, status: "complete", knownZero: false, pageReadCount: 2 });
  });

  it("probes an exact maxRows multiple before calling it limited", async () => {
    const rows = [1, 2, 3, 4];
    const result = await materializeIndexedTransferWindow({
      ...base,
      maxRows: 4,
      readPage: async (_address, options) => rows.slice(options.offset, options.offset + options.limit)
    });
    expect(result).toMatchObject({ status: "complete", rows, pageReadCount: 3 });
  });

  it("stops at page granularity when the concrete proof is already satisfied", async () => {
    const rows = [1, 2, 3, 4, 5, 6];
    const offsets: number[] = [];
    const result = await materializeIndexedTransferWindow({
      ...base,
      readPage: async (_address, options) => {
        offsets.push(options.offset);
        return rows.slice(options.offset, options.offset + options.limit);
      },
      isSatisfied: (materialized) => materialized.includes(3)
    });
    expect(offsets).toEqual([0, 2]);
    expect(result).toMatchObject({
      rows: [1, 2, 3, 4],
      status: "complete",
      completionReason: "proof_satisfied"
    });
  });

  it("distinguishes known zero, local limit, and read failure", async () => {
    const knownZero = await materializeIndexedTransferWindow({ ...base, readPage: async () => [] });
    expect(knownZero).toMatchObject({ status: "complete", knownZero: true, rows: [] });

    const limitedRows = [1, 2, 3, 4, 5, 6];
    const limited = await materializeIndexedTransferWindow({
      ...base,
      readPage: async (_address, options) => limitedRows.slice(options.offset, options.offset + options.limit)
    });
    expect(limited).toMatchObject({ status: "local_limit", knownZero: false, rows: [1, 2, 3, 4, 5] });

    const failed = await materializeIndexedTransferWindow<number>({
      ...base,
      readPage: async () => { throw new Error("local db unavailable"); }
    });
    expect(failed).toMatchObject({ status: "read_failed", knownZero: false, error: "local db unavailable" });
  });

  it.each([{ pageSize: 0, maxRows: 1 }, { pageSize: 1, maxRows: 0 }])("rejects invalid limits %#", async (limits) => {
    await expect(materializeIndexedTransferWindow({ ...base, ...limits, readPage: async () => [] })).rejects.toThrow("pageSize and maxRows must be positive integers");
  });
});
```

Add a repository assertion that the address query ends with `transfer_id desc` before `limit`.

- [ ] **Step 2: Run helper/repository tests and verify RED**

Run:

```powershell
npm test -- tests/forensics/localTronUsdtIndex.test.ts tests/storage/repositories.test.ts
```

Expected: the materializer export is missing and the SQL lacks the deterministic tie-breaker.

- [ ] **Step 3: Add local-materialization types**

Define centrally in `src/types.ts`:

```ts
export type LocalIndexMaterializationStatus = "complete" | "local_limit" | "read_failed";
```

Add `local_budget_limited | local_index_read_failed` to `ForensicScoreBlockedReason`, `local_budget_limited | local_data_error` to `ForensicTechnicalStatus`, and these optional diagnostic fields to `MoneyOriginTraceHistoryCoverage`:

```ts
localMaterializationStatus?: LocalIndexMaterializationStatus | null;
localMaterializationCompletionReason?: "proof_satisfied" | "window_exhausted" | null;
localMaterializationKnownZero?: boolean | null;
localMaterializationError?: string | null;
```

Do not add local states to `TronAddressUsdtCoverageStatusReason`; that enum remains provider-acquisition-only.

- [ ] **Step 4: Implement the generic materializer**

Add to `localTronUsdtIndex.ts`:

```ts
import type { LocalIndexMaterializationStatus } from "../types";

// ponytail: 20k bounds per-job memory; move to keyset/streamed materialization if dense windows routinely hit it.
export const DEFAULT_LOCAL_INDEX_MATERIALIZATION_MAX_ROWS = 20_000;

export type LocalIndexMaterialization<T> = {
  rows: T[];
  status: LocalIndexMaterializationStatus;
  pageReadCount: number;
  completionReason: "proof_satisfied" | "window_exhausted" | null;
  knownZero: boolean;
  error: string | null;
};

export async function materializeIndexedTransferWindow<T>(input: {
  address: string;
  minTimestamp: Date;
  maxTimestamp: Date;
  pageSize: number;
  maxRows: number;
  isSatisfied?(rows: readonly T[]): boolean;
  onPage?(state: { rowCount: number; pageReadCount: number }): Promise<void> | void;
  readPage(address: string, options: {
    minTimestamp: Date;
    maxTimestamp: Date;
    limit: number;
    offset: number;
    orderBy: "newest";
    direction: "both";
  }): Promise<T[]>;
}): Promise<LocalIndexMaterialization<T>> {
  if (!Number.isInteger(input.pageSize) || !Number.isInteger(input.maxRows) || input.pageSize < 1 || input.maxRows < 1) {
    throw new Error("pageSize and maxRows must be positive integers");
  }
  const rows: T[] = [];
  let pageReadCount = 0;
  const read = async (limit: number, offset: number): Promise<{ page: T[]; error: null } | { page: null; error: string }> => {
    try {
      return { page: await input.readPage(input.address, {
        minTimestamp: input.minTimestamp,
        maxTimestamp: input.maxTimestamp,
        limit,
        offset,
        orderBy: "newest",
        direction: "both"
      }), error: null };
    } catch (error) {
      return { page: null, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const failed = (error: string): LocalIndexMaterialization<T> => ({
    rows,
    status: "read_failed",
    pageReadCount,
    completionReason: null,
    knownZero: false,
    error
  });

  while (rows.length < input.maxRows) {
    const limit = Math.min(input.pageSize, input.maxRows - rows.length);
    const result = await read(limit, rows.length);
    pageReadCount += 1;
    if (result.page === null) return failed(result.error);
    rows.push(...result.page);
    await input.onPage?.({ rowCount: rows.length, pageReadCount });
    if (input.isSatisfied?.(rows) === true) {
      return { rows, status: "complete", pageReadCount, completionReason: "proof_satisfied", knownZero: false, error: null };
    }
    if (result.page.length < limit) {
      return { rows, status: "complete", pageReadCount, completionReason: "window_exhausted", knownZero: rows.length === 0, error: null };
    }
  }
  const probe = await read(1, rows.length);
  pageReadCount += 1;
  if (probe.page === null) return failed(probe.error);
  return {
    rows,
    status: probe.page.length === 0 ? "complete" : "local_limit",
    pageReadCount,
    completionReason: probe.page.length === 0 ? "window_exhausted" : null,
    knownZero: false,
    error: null
  };
}
```

Keep the `read_failed` catch narrowly around each `readPage()` call. Validation, `isSatisfied`, and `onPage` failures propagate to the job runner; they must not be mislabeled as a local database read failure.

- [ ] **Step 5: Make offset pages deterministic and plumb Incoming offset**

Append `, transfer_id desc` to every indexed-transfer SQL ordering used by offset pagination in `repositories.ts`.

Add `offset?: number` to Incoming indexed-read options and forward it in `src/index.ts`:

```ts
listIndexedTransfersForAddress(address, {
  minTimestamp: options.minTimestamp,
  maxTimestamp: options.maxTimestamp,
  limit: options.limit,
  offset: options.offset,
  direction: options.direction,
  orderBy: options.orderBy
})
```

- [ ] **Step 6: Run focused tests and typecheck**

Run the Step 2 command and `npm run typecheck`.

Expected: all pass; exact-multiple completion uses one-row probe and local read errors remain errors.

- [ ] **Step 7: Commit Task 7**

```powershell
git add src/types.ts src/forensics/localTronUsdtIndex.ts src/storage/repositories.ts src/forensics/incomingDepositJob.ts src/index.ts tests/forensics/localTronUsdtIndex.test.ts tests/storage/repositories.test.ts
git commit -m "fix: add bounded local index materialization"
```

## Task 8: Require Materialized Local Coverage In Where

**Files:**

- Modify: `src/forensics/deepForensicJob.ts:150-175, 560-585, 1075-1210`
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts:175-290, 1500-1700`
- Modify: `src/check/whereIsMoneyCheck.ts:458-520, 1295-1350`
- Test: `tests/forensics/deepForensicJob.test.ts`
- Test: `tests/forensics/moneyOriginOperationalAssessment.test.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts:3249-3300`

- [ ] **Step 1: Add row-151, ceiling, known-zero, and read-failure RED tests**

Add named tests with these assertions:

```ts
it("materializes row 151 from a complete targeted index before marking Where exact", async () => {
  expect(indexOffsets).toEqual([0, 150]);
  expect(liveProviderCalls).toBe(0);
  expect(report.originPaths[0].pathAddresses).toContain(materialFundingSource);
  expect(completion.resultJson).toMatchObject({ score_valid: true });
});

it("marks a complete-index local ceiling as budget-limited, not provider-capped", async () => {
  expect(history).toMatchObject({
    reachedTargetHop: false,
    providerCapHit: false,
    budgetExhausted: true,
    localMaterializationStatus: "local_limit"
  });
  expect(report).toMatchObject({
    scoreValid: false,
    scoreBlockedReason: "local_budget_limited",
    technicalStatus: "local_budget_limited",
    userDecision: "NO_FINAL_DECISION"
  });
});

it("preserves complete known-zero local history as semantic unknown provenance", async () => {
  expect(history).toMatchObject({ reachedTargetHop: true, localMaterializationKnownZero: true, providerCapHit: false });
  expect(path.stoppedReason).toMatch(/no_incoming_transfers_seen|pre_existing_balance_possible/);
  expect(path.stoppedReason).not.toBe("incoming_history_not_fetched");
});
```

Add a parameterized operational-assessment test for `local_limit` and `read_failed`, plus a control with exact approval-drain evidence where the mode keeps `decision=DECLINE` and the hard evidence but has `scoreValid=false` with the local blocker. Task 12 will prove that the unified decision is independently valid and keeps `coverage=partial`.

Invert the current missing-balance test to expect `REVIEW`, `scoreValid=false`, and `NO_FINAL_DECISION` instead of `DECLINE 65`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/forensics/deepForensicJob.test.ts -t "row 151|local ceiling|known-zero"
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts -t "local materialization"
npm test -- tests/check/whereIsMoneyCheck.test.ts -t "balance lookup fails"
```

Expected: Where reads only the first 150 rows, complete acquisition masks the local limit, and missing balance still emits `DECLINE 65`.

- [ ] **Step 3: Materialize complete targeted indexes without provider fallback**

Add `localIndexMaterializationMaxRows?: number` to `DeepForensicJobRunnerOptions`, import the shared `DEFAULT_LOCAL_INDEX_MATERIALIZATION_MAX_ROWS`, and use the existing page size as `pageSize`.

When `completeBroadTargetedHistory === true`, call `materializeIndexedTransferWindow()`. If `fetchOptions.targetEdge` exists, use the already imported `buildBalanceFormingSlice()` as the proof predicate; otherwise exhaust the requested time window:

```ts
const targetEdge = fetchOptions.targetEdge
  ? fetchOptions.expectedAmountRaw && /^\d+$/.test(fetchOptions.expectedAmountRaw)
    ? { ...fetchOptions.targetEdge, amountRaw: fetchOptions.expectedAmountRaw }
    : fetchOptions.targetEdge
  : null;
const readIndexedPage = deps.listIndexedUsdtTransfersForAddress ?? (async () => {
  throw new Error("local indexed-transfer reader is unavailable");
});
const local = await materializeIndexedTransferWindow({
  address,
  minTimestamp,
  maxTimestamp,
  pageSize: edgeFetchLimit,
  maxRows: options.localIndexMaterializationMaxRows ?? DEFAULT_LOCAL_INDEX_MATERIALIZATION_MAX_ROWS,
  readPage: (pageAddress, pageOptions) => readIndexedPage(pageAddress, pageOptions),
  // ponytail: recompute the small bounded slice per page; carry incremental cashflow state if 20k windows become common.
  isSatisfied: targetEdge
    ? (rows) => buildBalanceFormingSlice({
        target: targetEdge,
        edges: dedupeRouteEdges([targetEdge, ...rows.map(indexedTransferToRouteEdge)]),
        minCoverageRatio: WHERE_BALANCE_SLICE_MIN_COVERAGE_RATIO,
        maxFunders: DEFAULT_MAX_BUNDLE_FUNDERS,
        fetchedPageCount: 0,
        pageBudgetExhausted: false,
        providerCapHit: false,
        providerInconsistent: false
      }).status === "covered"
    : undefined,
  onPage: async ({ rowCount, pageReadCount }) => {
    if (pageReadCount !== 1 && pageReadCount % 10 !== 0) return;
    await persistProgress({
      jobPhase: "reading_local_index",
      targetedIndex: { phase: "reading_local_index", address, rowCount, pageReadCount }
    });
  }
});
```

Then map it exactly:

```ts
const localComplete = local.status === "complete";
const localLimit = local.status === "local_limit";
const historyCoverage: MoneyOriginTraceHistoryCoverage = {
  address,
  targetTimestamp: maxTimestamp.toISOString(),
  fetchedTransferCount: local.rows.length,
  fetchedPageCount: local.pageReadCount,
  oldestFetchedTransferAt: oldestRouteEdgeTimestamp(local.rows.map(indexedTransferToRouteEdge))?.toISOString() ?? null,
  reachedTargetHop: localComplete,
  source: "local_index",
  coverageComplete: localComplete,
  providerCapHit: false,
  budgetExhausted: localLimit,
  providerInconsistent: false,
  statusReason: null,
  localMaterializationStatus: local.status,
  localMaterializationCompletionReason: local.completionReason,
  localMaterializationKnownZero: local.knownZero,
  localMaterializationError: local.error
};
```

Skip live TronScan and targeted requeue in this branch. If provider acquisition is not complete, retain the existing indexed/live/ensure path unchanged.

- [ ] **Step 4: Map local failures before materiality exceptions**

In `moneyOriginOperationalAssessment.ts`, compute the first local failure from `originPaths[].historyCoverage` before the `topHardEvidence` branch:

```ts
const localFailure = input.originPaths
  .flatMap((path) => path.historyCoverage ?? [])
  .find((coverage) => coverage.localMaterializationStatus === "local_limit" || coverage.localMaterializationStatus === "read_failed");
```

Add the local limitation to the exact-hard branch warnings, then keep exact hard authoritative:

```ts
const localFailureWarning = localFailure?.localMaterializationStatus === "read_failed"
  ? "Local indexed provenance could not be read; exact hard evidence remains independently sufficient."
  : localFailure?.localMaterializationStatus === "local_limit"
    ? "Local indexed provenance reached its materialization ceiling; exact hard evidence remains independently sufficient."
    : null;
const hardBranchValidity = localFailure
  ? {
      scoreValid: false,
      scoreBlockedReason: localFailure.localMaterializationStatus === "read_failed"
        ? "local_index_read_failed" as const
        : "local_budget_limited" as const,
      technicalStatus: localFailure.localMaterializationStatus === "read_failed"
        ? "local_data_error" as const
        : "local_budget_limited" as const
    }
  : { scoreValid: true, scoreBlockedReason: null, technicalStatus: "completed" as const };

// Inside the existing topHardEvidence return:
...hardBranchValidity,
warnings: [
  ...(input.coverage.partial ? ["Coverage is partial; hard bad evidence takes priority."] : []),
  ...(localFailureWarning ? [localFailureWarning] : []),
  ...approvalWarnings,
  ...llmWarnings
]
```

Immediately after the exact-hard branch and before below-materiality handling, return the invalid assessment for a local failure:

```ts

if (localFailure) {
  const readFailed = localFailure.localMaterializationStatus === "read_failed";
  const riskScore = clampScore(Math.min(59, Math.max(
    30,
    highestPathRisk(input.originPaths),
    input.fastWalletRisk?.score ?? 0
  )));
  return {
    decision: "REVIEW",
    scoreValid: false,
    scoreBlockedReason: readFailed ? "local_index_read_failed" : "local_budget_limited",
    technicalStatus: readFailed ? "local_data_error" : "local_budget_limited",
    riskScore,
    riskBand: riskBandFromWhereScore(riskScore),
    provenanceConfidence: provenanceScore,
    coverageCompleteness: coverageScore,
    walletRole: role,
    operationalLiquidityScore: operationalScore,
    ageSignals: input.ageSignals ?? null,
    hardBadEvidence: [],
    ...defaultLayerCollections([]),
    sourceProvenanceMateriality,
    reasons: [readFailed
      ? "Local indexed provenance could not be read; final scoring is blocked."
      : "Local indexed provenance reached its materialization ceiling; final scoring is blocked."],
    warnings: [readFailed
      ? "Local indexed provenance could not be read; this is a technical limitation, not risk evidence."
      : "Local indexed provenance reached its materialization ceiling; this is a technical limitation, not risk evidence.",
      ...approvalWarnings,
      ...llmWarnings]
  };
}
```

Exact hard evidence must return before this guard and include the warning instead of being erased, but the incomplete mode must not claim that its own score is valid. In Task 11, `whereCandidates()` emits exact `hardBadEvidence` before adding coverage uncertainty, even when `report.scoreValid === false`; the canonical resolver is what makes the final hard-proof decision valid.

Rename the current exported assessment function to `buildMoneyOriginOperationalAssessmentInternal()` and add this export wrapper so every new result is explicit without editing dozens of valid return branches:

```ts
export function buildMoneyOriginOperationalAssessment(
  input: BuildMoneyOriginOperationalAssessmentInput
): WhereIsMoneyAssessment {
  const assessment = buildMoneyOriginOperationalAssessmentInternal(input);
  if (assessment.scoreValid === false) return assessment;
  return {
    ...assessment,
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed"
  };
}
```

- [ ] **Step 5: Replace the missing-provenance fallback**

Add optional `technicalFailure?: { scoreBlockedReason: ForensicScoreBlockedReason; technicalStatus: ForensicTechnicalStatus } | null` to `fallbackReviewReport()` and pass it only when the caller actually observed a provider/local/budget failure. A covered history with no usable source is semantic insufficiency, not a fabricated technical failure. Change the function to:

```ts
const decision: ExchangeDecision = "REVIEW";
const riskScore = Math.max(0, Math.min(59, input.fastWalletRisk?.score ?? 0));
const technicalFailure = input.currentBalanceRaw === null
  ? { scoreBlockedReason: "provider_error" as const, technicalStatus: "provider_error" as const }
  : input.technicalFailure ?? null;
const assessment: WhereIsMoneyAssessment = {
  decision,
  scoreValid: false,
  scoreBlockedReason: technicalFailure?.scoreBlockedReason ?? "insufficient_coverage",
  technicalStatus: technicalFailure?.technicalStatus ?? "completed",
  riskScore,
  riskBand: riskBandFromWhereScore(riskScore),
  provenanceConfidence: 0,
  coverageCompleteness: 0,
  walletRole: "unknown_wallet",
  operationalLiquidityScore: 0,
  ageSignals: null,
  hardBadEvidence: [],
  sourcePolicyEvidence: [],
  contractSuspicionEvidence: [],
  unknownOriginEvidence: [],
  riskLayers: [],
  dominantRiskLayer: null,
  reasons: input.notes,
  warnings: [technicalFailure
    ? "A technical data limitation blocked final scoring."
    : "Covered history contained no usable balance-forming source; origin remains semantically unresolved."]
};
```

Set top-level `scoreValid=false`, `userDecision="NO_FINAL_DECISION"`, and copy the same blocked reason/status. Remove all “safe default decline” wording. Add a covered-no-source test asserting `technicalStatus:"completed"`, plus the existing missing-balance test asserting `provider_error`.

Change `whereReportScoreValidityResultJson()` from `report.scoreValid !== false` to `report.scoreValid === true` for newly produced results. Legacy optional-field normalization remains only in readers.

- [ ] **Step 6: Run focused tests and provider-acquisition regression tests**

Run:

```powershell
npm test -- tests/forensics/deepForensicJob.test.ts -t "row 151|local ceiling|known-zero"
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts -t "local materialization"
npm test -- tests/check/whereIsMoneyCheck.test.ts -t "balance lookup fails"
npm test -- tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/addressIndexWorker.test.ts
npm run typecheck
```

Expected: all pass; acquisition retry/splitting tests are unchanged.

- [ ] **Step 7: Commit Task 8**

```powershell
git add src/forensics/deepForensicJob.ts src/forensics/moneyOriginOperationalAssessment.ts src/check/whereIsMoneyCheck.ts tests/forensics/deepForensicJob.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "fix: require materialized local coverage for Where"
```

## Task 9: Require Materialized Local Coverage In Incoming

**Files:**

- Modify: `src/forensics/incomingDepositJob.ts:135-165, 1025-1090, 1425-1515`
- Modify: `src/alerts/notificationText.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`
- Test: `tests/alerts/notificationText.test.ts`

- [ ] **Step 1: Add row-201 and local-read-failure RED tests**

```ts
it("materializes row 201 from a complete targeted index", async () => {
  expect(indexOffsets).toEqual([0, 200]);
  expect(liveProviderCalls).toBe(0);
  expect(requeueCalls).toBe(0);
  expect(report.originPaths.flatMap((path) => path.pathAddresses)).toContain(upstreamSource);
  expect(report).toMatchObject({ scoreValid: true });
});

it("maps a complete-index read failure to local_data_error", async () => {
  expect(report).toMatchObject({
    decision: "NO_FINAL_DECISION",
    scoreValid: false,
    scoreBlockedReason: "local_index_read_failed",
    technicalStatus: "local_data_error"
  });
  expect(report.targetedHistoryCoverage?.firstBlockingTechnicalStatus).toBe("local_data_error");
  expect(report.warnings.join(" ")).not.toContain("provider cap");
});
```

Add notification text assertions for both new technical codes.

- [ ] **Step 2: Run focused Incoming tests and verify RED**

Run:

```powershell
npm test -- tests/forensics/incomingDepositJob.test.ts -t "row 201|local_data_error"
npm test -- tests/alerts/notificationText.test.ts
```

Expected: Incoming cannot request offset 200 and mislabels a local read failure.

- [ ] **Step 3: Materialize complete Incoming indexes**

Add `localIndexMaterializationMaxRows?: number` to `BuildIncomingDepositReportInput` and import the shared `DEFAULT_LOCAL_INDEX_MATERIALIZATION_MAX_ROWS`.

Import `buildBalanceFormingSlice`, `DEFAULT_BUNDLE_COVERAGE_THRESHOLD`, and `DEFAULT_MAX_BUNDLE_FUNDERS`. Widen Incoming's local `fetchOptions` type to the existing trace contract (`latestTimestamp`, `deferBroadTargetedHistory`, `targetEdge`, `expectedAmountRaw`). Inside `fetchEdgesForAddress()`, after computing `fetchMinTimestamp`, `fetchMaxTimestamp`, and `cacheKey`, use this complete-index branch before the current indexed/live path:

```ts
const completeBroadTargetedHistory = isTargetedHopFetch &&
  await hasCompleteBroadTargetedHistory(address, fetchMaxTimestamp);
if (completeBroadTargetedHistory) {
  const local = await materializeIndexedTransferWindow({
    address,
    minTimestamp: fetchMinTimestamp,
    maxTimestamp: fetchMaxTimestamp,
    pageSize: RUNTIME_TRANSFER_LIMIT,
    maxRows: input.localIndexMaterializationMaxRows ?? DEFAULT_LOCAL_INDEX_MATERIALIZATION_MAX_ROWS,
    readPage: (pageAddress, options) => input.deps.listIndexedUsdtTransfersForAddress(pageAddress, options),
    isSatisfied: fetchOptions.targetEdge
      ? (rows) => buildBalanceFormingSlice({
          target: fetchOptions.expectedAmountRaw && /^\d+$/.test(fetchOptions.expectedAmountRaw)
            ? { ...fetchOptions.targetEdge!, amountRaw: fetchOptions.expectedAmountRaw }
            : fetchOptions.targetEdge!,
          edges: mergeEdges([fetchOptions.targetEdge!, ...asIndexedTransfers(rows).map(indexedTransferToRouteEdge)]),
          minCoverageRatio: DEFAULT_BUNDLE_COVERAGE_THRESHOLD,
          maxFunders: DEFAULT_MAX_BUNDLE_FUNDERS,
          fetchedPageCount: 0,
          pageBudgetExhausted: false,
          providerCapHit: false,
          providerInconsistent: false
        }).status === "covered"
      : undefined,
    onPage: async ({ rowCount, pageReadCount }) => {
      if (pageReadCount !== 1 && pageReadCount % 10 !== 0) return;
      await persistTargetedProgress({
        jobPhase: "reading_local_index",
        targetedIndex: { phase: "reading_local_index", address, rowCount, pageReadCount }
      });
    }
  });
  const indexedEdges = asIndexedTransfers(local.rows).map(indexedTransferToRouteEdge);
  const edges = mergeEdges([
    ...indexedEdges,
    ...(address === input.sender && fetchMaxTimestamp.getTime() === maxTimestamp.getTime() ? [seedDeposit] : [])
  ]).filter((edge) => edge.timestamp <= fetchMaxTimestamp);
  const localComplete = local.status === "complete";
  const localLimit = local.status === "local_limit";
  edgeCache.set(cacheKey, edges);
  targetedEdgeCacheKeys.add(cacheKey);
  historyCoverageCache.set(cacheKey, {
    address,
    targetTimestamp: fetchMaxTimestamp.toISOString(),
    fetchedTransferCount: indexedEdges.length,
    fetchedPageCount: local.pageReadCount,
    oldestFetchedTransferAt: oldestRouteEdgeTimestamp(indexedEdges)?.toISOString() ?? null,
    reachedTargetHop: localComplete,
    source: "local_index",
    coverageComplete: localComplete,
    providerCapHit: false,
    budgetExhausted: localLimit,
    providerInconsistent: false,
    statusReason: null,
    localMaterializationStatus: local.status,
    localMaterializationCompletionReason: local.completionReason,
    localMaterializationKnownZero: local.knownZero,
    localMaterializationError: local.error
  });
  return edges;
}
```

Skip live fetch/requeue only in this branch. The current provider-acquisition path remains the `else` behavior.

Replace the current `block` expression in `buildIncomingTargetedCoverageSummary()` so local state has precedence:

```ts
const block: IncomingTargetedCoverageBlock | null = firstPartial
  ? firstPartial.localMaterializationStatus === "local_limit"
    ? {
        address: firstPartial.address,
        scoreBlockedReason: "local_budget_limited",
        technicalStatus: "local_budget_limited"
      }
    : firstPartial.localMaterializationStatus === "read_failed"
      ? {
          address: firstPartial.address,
          scoreBlockedReason: "local_index_read_failed",
          technicalStatus: "local_data_error"
        }
      : {
          ...targetedBlockFromStatusReason(firstState?.statusReason, firstState?.lastError ?? firstError),
          address: firstPartial.address
        }
  : null;
```

Keep `targetedBlockFromStatusReason()` unchanged.

- [ ] **Step 4: Add user-facing technical copy**

Add exact cases to `rawActionOrReasonText()` in `notificationText.ts`:

```ts
case "local_budget_limited":
  return locale === "ru"
    ? "Достигнут локальный лимит чтения истории; итоговый риск не опубликован."
    : "The local history read limit was reached; no final risk score was published.";
case "local_index_read_failed":
  return locale === "ru"
    ? "Локальную индексированную историю не удалось прочитать; итоговый риск не опубликован."
    : "The local indexed history could not be read; no final risk score was published.";
case "local_data_error":
  return locale === "ru"
    ? "Локальные данные происхождения средств временно недоступны."
    : "Local provenance data is temporarily unavailable.";
```

- [ ] **Step 5: Run focused and shared acquisition tests**

Run:

```powershell
npm test -- tests/forensics/incomingDepositJob.test.ts -t "row 201|local_data_error"
npm test -- tests/alerts/notificationText.test.ts
npm test -- tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/addressIndexWorker.test.ts
npm run typecheck
```

Expected: all pass; local limits never set `providerCapHit=true`.

- [ ] **Step 6: Commit Task 9**

```powershell
git add src/forensics/incomingDepositJob.ts src/alerts/notificationText.ts tests/forensics/incomingDepositJob.test.ts tests/alerts/notificationText.test.ts
git commit -m "fix: paginate complete Incoming provenance windows"
```

## Task 10: Classify Fast Evidence By Code, Never By Score

**Files:**

- Create: `src/risk/fastEvidence.ts`
- Create: `tests/risk/fastEvidence.test.ts`
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts:183-191`
- Modify: `src/check/whereIsMoneyCheck.ts:667-670, 1487-1496`
- Modify: `src/risk/scoringSignalMatrixInputs.ts:80-165`
- Modify: `src/risk/unifiedWalletRisk.ts:205-257`
- Modify: `src/risk/riskPolicy.ts:38-56`
- Test: `tests/forensics/moneyOriginOperationalAssessment.test.ts:39-44, 1150-1185`
- Test: `tests/check/whereIsMoneyCheck.test.ts:2025-2070`
- Test: `tests/risk/unifiedWalletRisk.test.ts`
- Test: `tests/risk/riskPolicy.test.ts`

- [ ] **Step 1: Write the central classifier tests**

```ts
import { describe, expect, it } from "vitest";
import type { RiskReport } from "../../src/types";
import { exactFastHardEvidence } from "../../src/risk/fastEvidence";

const report = (score: number, code: string): RiskReport => ({
  subjectAddress: "TFastEvidence11111111111111111111111",
  score,
  level: score >= 85 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW",
  reasons: [{ code, message: code, scoreImpact: score, evidenceRef: `evidence:${code}` }]
});

describe("exactFastHardEvidence", () => {
  it.each([85, 90, 100])("does not promote generic context score %s", (score) => {
    expect(exactFastHardEvidence(report(score, "critical_context_only"))).toEqual([]);
  });

  it.each([
    "stablecoin_usdt_blacklisted",
    "forensic_approval_drain_provenance",
    "internal_label_scam"
  ])("accepts explicit exact code %s", (code) => {
    expect(exactFastHardEvidence(report(90, code))).toEqual([
      expect.objectContaining({ code, score: expect.any(Number), evidenceId: `evidence:${code}` })
    ]);
  });

  it("does not treat proximity as exact self evidence", () => {
    expect(exactFastHardEvidence(report(95, "internal_label_darknet_exchange_proximity"))).toEqual([]);
  });

  it.each([
    "internal_label_scam_proximity",
    "forensic_exact_approval_spoof",
    "approval_drain_exactish"
  ])("does not accept prefix or substring lookalike %s", (code) => {
    expect(exactFastHardEvidence(report(100, code))).toEqual([]);
  });
});
```

Change the old `criticalFastRisk` test fixture into generic context and add a separate exact blacklist fixture. Assert generic Fast 90 produces no `fast_critical`, no `scam_or_blacklist`, and no `DECLINE`; exact blacklist retains hard evidence.

- [ ] **Step 2: Run Fast evidence tests and verify RED**

Run:

```powershell
npm test -- tests/risk/fastEvidence.test.ts tests/risk/riskPolicy.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/check/whereIsMoneyCheck.test.ts tests/risk/unifiedWalletRisk.test.ts
```

Expected: module missing and the existing score threshold still creates `fast_critical`/`DECLINE`.

- [ ] **Step 3: Implement one exact-code classifier**

Create `fastEvidence.ts`:

```ts
import type { RiskReason, RiskReport } from "../types";

export type ExactFastHardEvidence = {
  code: string;
  score: number;
  evidenceId: string;
  message: string;
};

const EXACT_FAST_HARD_CODE_FLOORS = new Map<string, number>([
  ["stablecoin_usdt_blacklisted", 95],
  ["forensic_approval_drain_provenance", 95],
  ["internal_label_approval_drain_proximity", 95],
  ["internal_label_scam", 90],
  ["internal_label_reported_scam", 90],
  ["internal_label_stolen_funds", 90],
  ["internal_label_phishing", 90],
  ["internal_label_risky_contract", 90],
  ["internal_label_whitebit", 90],
  ["internal_label_darknet_exchange", 90]
]);

export function isExactFastHardEvidenceCode(code: string): boolean {
  return EXACT_FAST_HARD_CODE_FLOORS.has(code);
}

export function isExactFastHardEvidenceReason(reason: RiskReason): boolean {
  return isExactFastHardEvidenceCode(reason.code);
}

function hardScore(reason: RiskReason): number {
  const floor = EXACT_FAST_HARD_CODE_FLOORS.get(reason.code);
  const observed = Number.isFinite(reason.scoreImpact) ? Math.round(reason.scoreImpact) : 0;
  return Math.max(floor ?? 0, Math.min(100, observed));
}

export function exactFastHardEvidence(report: RiskReport | null | undefined): ExactFastHardEvidence[] {
  if (!report) return [];
  return report.reasons
    .filter(isExactFastHardEvidenceReason)
    .map((reason) => ({
      code: reason.code,
      score: hardScore(reason),
      evidenceId: reason.evidenceRef ?? `fast:${reason.code}`,
      message: reason.message
    }));
}
```

- [ ] **Step 4: Replace all duplicate Fast-hard heuristics**

In the four production consumers, import `exactFastHardEvidence()` and:

```ts
const exactFast = exactFastHardEvidence(report);
const fastDecline = exactFast.length > 0;
const fastScore = exactFast.reduce((score, item) => Math.max(score, item.score), 0);
```

`hardEvidenceFromFastRisk()` maps only `exactFast`. `fastHardProofCandidates()` maps only `exactFast`. `fastContextCandidates()` remains `review_only` and caps its score at 59. `hasUnifiedFastHardEvidence()` becomes `exactFastHardEvidence(report).length > 0`. Import `isExactFastHardEvidenceCode()` in `riskPolicy.ts` so its `hardEvidence` flag uses the same exact set; keep its non-hard contextual classifiers unchanged.

Delete the local score-threshold helpers and duplicate code allowlists.

- [ ] **Step 5: Run focused tests and typecheck**

Run the Step 2 command and `npm run typecheck`.

Expected: generic Fast 90 is context-only; explicit exact codes keep their hard floor.

- [ ] **Step 6: Commit Task 10**

```powershell
git add src/risk/fastEvidence.ts tests/risk/fastEvidence.test.ts src/risk/riskPolicy.ts tests/risk/riskPolicy.test.ts src/forensics/moneyOriginOperationalAssessment.ts src/check/whereIsMoneyCheck.ts src/risk/scoringSignalMatrixInputs.ts src/risk/unifiedWalletRisk.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/check/whereIsMoneyCheck.test.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "fix: classify Fast hard evidence by proof code"
```

## Task 11: Normalize Matrix Evidence And Add The Canonical Resolver

**Files:**

- Modify: `src/types.ts:495-520`
- Modify: `src/risk/scoringSignalMatrix.ts`
- Modify: `src/risk/scoringSignalMatrixInputs.ts`
- Create: `src/risk/finalDisposition.ts`
- Test: `tests/risk/scoringSignalMatrix.test.ts`
- Test: `tests/risk/scoringSignalMatrixInputs.test.ts`
- Create: `tests/risk/finalDisposition.test.ts`

- [ ] **Step 1: Write failing matrix metadata and resolver tests**

Add a reusable matrix context in `scoringSignalMatrix.test.ts`:

```ts
const matrixContext: MatrixCandidateContext = {
  decisionScope: "wallet_unified",
  subjectAddress: "TMatrixSubject111111111111111111111",
  subjectTxHash: null,
  requiredCoverage: "wallet_provenance"
};
const matrixDraft = (
  authority: MatrixEvidenceAuthority,
  overrides: Partial<MatrixCandidate> = {}
): MatrixCandidate => ({
  row: "behavior_only_prior",
  actionUnit: "wallet",
  score: 45,
  evidenceIds: ["evidence:1"],
  evidenceEpisodeIds: ["episode:1"],
  atomicSignals: ["context"],
  modifiers: [],
  caps: [],
  dampeners: [],
  caveats: [],
  subject: {
    decisionScope: matrixContext.decisionScope,
    address: matrixContext.subjectAddress,
    txHash: matrixContext.subjectTxHash
  },
  authority,
  ...overrides
});
```

Pass it to every `scoreMatrixCandidates()` call. Assert an explicitly authoritative hard candidate is preserved:

```ts
const result = scoreMatrixCandidates([
  matrixDraft({ kind: "exact_hard", proofSource: "stablecoin_restriction" }, {
    row: "hard_proof",
    score: 95,
    modifiers: ["hard_anchor"]
  })
], matrixContext);
expect(result.riskVector.hard_proof?.[0]).toMatchObject({
  evidenceClass: "exact_hard",
  proofLevel: "exact",
  subject: {
    decisionScope: "wallet_unified",
    address: matrixContext.subjectAddress,
    txHash: null
  },
  coverageDependency: "none"
});
```

Add the anti-promotion and same-episode precedence controls:

```ts
it("does not promote a contextual candidate merely because it uses the hard_proof row", () => {
  const scored = scoreMatrixCandidates([
    matrixDraft({ kind: "context" }, { row: "hard_proof", score: 100 })
  ], matrixContext);
  expect(scored.riskVector.hard_proof?.[0]).toMatchObject({
    evidenceClass: "context",
    proofLevel: "context",
    decisionEligibility: "review_only",
    score: 59
  });
  expect(scored.matrixDecision).toBe("REVIEW");
});

it("keeps exact hard proof when a higher pattern candidate shares its episode", () => {
  const scored = scoreMatrixCandidates([
    matrixDraft({ kind: "exact_hard", proofSource: "stablecoin_restriction" }, {
      row: "hard_proof",
      score: 95
    }),
    matrixDraft({
      kind: "pattern",
      decisionEligibility: "can_decline",
      coverageDependency: "wallet_provenance"
    }, { row: "service_linked_pattern", score: 100 })
  ], matrixContext);
  expect(scored.riskVector.hard_proof).toEqual([
    expect.objectContaining({ evidenceClass: "exact_hard", score: 95 })
  ]);
});
```

Create `finalDisposition.test.ts` with:

```ts
import type { DecisionCoverage } from "../../src/types";
import type { MatrixCandidate, MatrixCandidateContext, MatrixDecision, MatrixEvidenceAuthority, MatrixScoringResult } from "../../src/risk/scoringSignalMatrix";
import { scoreMatrixCandidates } from "../../src/risk/scoringSignalMatrix";
import { resolveFinalDisposition } from "../../src/risk/finalDisposition";

const address = "TDisposition11111111111111111111111";
const otherAddress = "TOtherDisposition111111111111111111";
const coverage = (required: DecisionCoverage["required"], overall: DecisionCoverage["overall"] = "complete"): DecisionCoverage => ({
  required,
  overall,
  invalidModes: required === "invalid" ? ["where_is_money"] : [],
  caveats: required === "invalid" ? ["where provenance incomplete"] : []
});
const matrixContext = (subjectAddress: string): MatrixCandidateContext => ({
  decisionScope: "wallet_unified",
  subjectAddress,
  subjectTxHash: null,
  requiredCoverage: "wallet_provenance"
});
const matrixCandidate = (
  subjectAddress: string,
  input: Partial<MatrixCandidate> = {},
  authority: MatrixEvidenceAuthority = { kind: "context" }
): MatrixCandidate => ({
  row: "behavior_only_prior",
  actionUnit: "wallet",
  score: 45,
  evidenceIds: ["evidence:1"],
  evidenceEpisodeIds: ["episode:1"],
  atomicSignals: ["context"],
  modifiers: [],
  caps: [],
  dampeners: [],
  caveats: [],
  subject: {
    decisionScope: "wallet_unified",
    address: subjectAddress,
    txHash: null
  },
  authority,
  ...input
});
function matrixResult(subjectAddress: string, decision: MatrixDecision, score: number | null): MatrixScoringResult {
  if (decision === "INSUFFICIENT_EVIDENCE") {
    return scoreMatrixCandidates([matrixCandidate(subjectAddress, {
      row: "coverage_uncertainty",
      score: 0
    }, { kind: "coverage", coverageDependency: "wallet_provenance" })], matrixContext(subjectAddress));
  }
  if (decision === "DECLINE") {
    return scoreMatrixCandidates([matrixCandidate(subjectAddress, {
      row: "source_policy",
      actionUnit: "source_path",
      score: score ?? 70
    }, { kind: "policy", decisionEligibility: "can_decline", coverageDependency: "wallet_provenance" })], matrixContext(subjectAddress));
  }
  if (decision === "ACCEPTABLE") {
    return scoreMatrixCandidates([matrixCandidate(subjectAddress, {
      row: "clean_or_operational",
      score: score ?? 10
    }, { kind: "clean", coverageDependency: "wallet_provenance" })], matrixContext(subjectAddress));
  }
  return scoreMatrixCandidates([matrixCandidate(subjectAddress, { score: score ?? 45 })], matrixContext(subjectAddress));
}
const hardMatrix = (subjectAddress: string, score: number): MatrixScoringResult => scoreMatrixCandidates([
  matrixCandidate(subjectAddress, {
    row: "hard_proof",
    score,
    modifiers: ["hard_anchor"]
  }, { kind: "exact_hard", proofSource: "stablecoin_restriction" })
], matrixContext(subjectAddress));
const contextMatrix = (subjectAddress: string, score: number): MatrixScoringResult =>
  scoreMatrixCandidates([matrixCandidate(subjectAddress, { score })], matrixContext(subjectAddress));

it("keeps exact hard DECLINE when unrelated coverage is partial", () => {
  const result = resolveFinalDisposition({
    subject: { decisionScope: "wallet_unified", address, txHash: null },
    matrixScore: hardMatrix(address, 95),
    coverage: coverage("invalid", "partial"),
    observedContextScore: 45
  });
  expect(result).toMatchObject({
    decision: "DECLINE",
    finalScore: 95,
    observedContextScore: 45,
    scoreValid: true,
    decisionBasis: "exact_hard_proof",
    coverage: { overall: "partial", invalidModes: ["where_is_money"] }
  });
});

it("returns no final score for invalid required coverage without hard proof", () => {
  expect(resolveFinalDisposition({
    subject: { decisionScope: "wallet_unified", address, txHash: null },
    matrixScore: contextMatrix(address, 59),
    coverage: coverage("invalid", "partial"),
    observedContextScore: 90
  })).toMatchObject({
    decision: "NO_FINAL_DECISION",
    finalScore: null,
    observedContextScore: 90,
    scoreValid: false,
    decisionBasis: "technical_stop"
  });
});

it.each([
  ["DECLINE", "DECLINE", 70],
  ["REVIEW", "REVIEW", 45],
  ["ACCEPTABLE", "ACCEPTABLE", 10],
  ["INSUFFICIENT_EVIDENCE", "NO_FINAL_DECISION", null]
] as const)("maps matrix %s losslessly to %s", (matrixDecision, decision, finalScore) => {
  const result = resolveFinalDisposition({
    subject: { decisionScope: "wallet_unified", address, txHash: null },
    matrixScore: matrixResult(address, matrixDecision, finalScore),
    coverage: coverage("valid"),
    observedContextScore: 55
  });
  expect(result.decision).toBe(decision);
  expect(result.finalScore).toBe(finalScore);
});

it("ignores hard evidence linked to another subject", () => {
  const result = resolveFinalDisposition({
    subject: { decisionScope: "wallet_unified", address, txHash: null },
    matrixScore: hardMatrix(otherAddress, 95),
    coverage: coverage("invalid", "partial"),
    observedContextScore: 55
  });
  expect(result.decision).toBe("NO_FINAL_DECISION");
});
```

- [ ] **Step 2: Run matrix/resolver tests and verify RED**

Run:

```powershell
npm test -- tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/finalDisposition.test.ts
```

Expected: matrix context/metadata and resolver modules are missing.

- [ ] **Step 3: Normalize matrix candidates with one subject authority**

Add to `scoringSignalMatrix.ts`. Evidence authority is required on the draft before the matrix sees it; the row never supplies or upgrades proof class:

```ts
export type MatrixDecisionScope = "fast" | "deep" | "wallet_unified" | "incoming_unified" | "contract_transfer";
export type MatrixEvidenceClass = "exact_hard" | "policy" | "pattern" | "context" | "coverage" | "clean";
export type MatrixProofLevel = "exact" | "policy" | "corroborated_pattern" | "context" | "coverage" | "clean";
export type MatrixCoverageDependency = "none" | "wallet_provenance" | "deposit_provenance";
export type MatrixExactProofSource =
  | "fast_exact_code"
  | "stablecoin_restriction"
  | "approval_drain_exact"
  | "exact_labeled_path"
  | "where_exact_hard"
  | "incoming_exact_hard";
export type MatrixEvidenceAuthority =
  | { kind: "exact_hard"; proofSource: MatrixExactProofSource }
  | { kind: "policy"; decisionEligibility: "can_decline" | "review_only"; coverageDependency: MatrixCoverageDependency }
  | { kind: "pattern"; decisionEligibility: "can_decline" | "review_only"; coverageDependency: MatrixCoverageDependency }
  | { kind: "context" }
  | { kind: "coverage"; coverageDependency: MatrixCoverageDependency }
  | { kind: "clean"; coverageDependency: MatrixCoverageDependency };
export type MatrixCandidateContext = {
  decisionScope: MatrixDecisionScope;
  subjectAddress: string;
  subjectTxHash: string | null;
  requiredCoverage: MatrixCoverageDependency;
};
export type MatrixCandidateSubject = {
  decisionScope: MatrixDecisionScope;
  address: string;
  txHash: string | null;
};

export type MatrixCandidate = {
  row: MatrixEvidenceRow;
  actionUnit: MatrixActionUnit;
  score: number;
  evidenceIds: string[];
  evidenceEpisodeIds: string[];
  atomicSignals: string[];
  modifiers: string[];
  caps: string[];
  dampeners: string[];
  caveats: string[];
  subject: MatrixCandidateSubject;
  authority: MatrixEvidenceAuthority;
};

export type ClassifiedMatrixCandidate = Omit<MatrixCandidate, "authority"> & {
  authority: MatrixEvidenceAuthority;
  evidenceClass: MatrixEvidenceClass;
  proofLevel: MatrixProofLevel;
  decisionEligibility: MatrixDecisionEligibility;
  coverageDependency: MatrixCoverageDependency;
};

export type MatrixScoringResult = {
  policyVersion: "scoring-signal-matrix-v1";
  policyScore: number | null;
  matrixDecision: MatrixDecision;
  winningRow: MatrixEvidenceRow;
  winningCandidate: ClassifiedMatrixCandidate;
  actionUnit: MatrixActionUnit;
  riskVector: MatrixRiskVector;
  uncertaintyState: MatrixUncertaintyState;
  queuePriorityScore: null;
  calibratedRiskProbability: null;
};
```

Remove `decisionEligibility` from the unclassified `MatrixCandidate` fields; it is assigned only from `authority`. Change `MatrixRiskVector` to hold `ClassifiedMatrixCandidate[]` and classify from the authority discriminator:

```ts
function classifyCandidate(candidate: MatrixCandidate): ClassifiedMatrixCandidate {
  const metadata = candidate.authority.kind === "exact_hard"
    ? { evidenceClass: "exact_hard" as const, proofLevel: "exact" as const, decisionEligibility: "can_decline" as const, coverageDependency: "none" as const }
    : candidate.authority.kind === "policy"
      ? { evidenceClass: "policy" as const, proofLevel: "policy" as const, decisionEligibility: candidate.authority.decisionEligibility, coverageDependency: candidate.authority.coverageDependency }
      : candidate.authority.kind === "pattern"
        ? { evidenceClass: "pattern" as const, proofLevel: "corroborated_pattern" as const, decisionEligibility: candidate.authority.decisionEligibility, coverageDependency: candidate.authority.coverageDependency }
        : candidate.authority.kind === "coverage"
          ? { evidenceClass: "coverage" as const, proofLevel: "coverage" as const, decisionEligibility: "insufficient_only" as const, coverageDependency: candidate.authority.coverageDependency }
          : candidate.authority.kind === "clean"
            ? { evidenceClass: "clean" as const, proofLevel: "clean" as const, decisionEligibility: "acceptable_only" as const, coverageDependency: candidate.authority.coverageDependency }
            : { evidenceClass: "context" as const, proofLevel: "context" as const, decisionEligibility: "review_only" as const, coverageDependency: "none" as const };
  if (candidate.authority.kind === "exact_hard" && candidate.row !== "hard_proof") {
    throw new Error("exact hard authority requires the hard_proof matrix row");
  }
  return { ...candidate, ...metadata };
}

function sameMatrixSubject(candidate: ClassifiedMatrixCandidate, context: MatrixCandidateContext): boolean {
  return candidate.subject.decisionScope === context.decisionScope &&
    candidate.subject.address.toLowerCase() === context.subjectAddress.toLowerCase() &&
    candidate.subject.txHash === context.subjectTxHash;
}

export function scoreMatrixCandidates(input: MatrixCandidate[], context: MatrixCandidateContext): MatrixScoringResult {
  const classified = input.map(classifyCandidate);
  if (classified.some((candidate) => !sameMatrixSubject(candidate, context))) {
    throw new Error("matrix candidate subject does not match scoring context");
  }
  const capped = classified.map(applyRowCaps);
  const deduped = dedupeByEpisode(capped);
  const riskVector = buildRiskVector(deduped);
  const winner = winningCandidate(deduped, context);
  const matrixDecision = candidateDecision(winner);
  const policyScore = winner.evidenceClass === "coverage" ? null : winner.score;
  return {
    policyVersion: "scoring-signal-matrix-v1",
    policyScore,
    matrixDecision,
    winningRow: winner.row,
    winningCandidate: winner,
    actionUnit: winner.actionUnit,
    riskVector,
    uncertaintyState: uncertaintyState(deduped),
    queuePriorityScore: null,
    calibratedRiskProbability: null
  };
}
```

Change `withCap`, `applyRowCaps`, `betterCandidate`, `dedupeByEpisode`, `buildRiskVector`, and `uncertaintyState` to accept/return `ClassifiedMatrixCandidate`. Apply the zero-badness cap and uncertainty detection from `evidenceClass:"coverage"`, not merely the row. Cap every `evidenceClass:"context"` candidate at 59 regardless of its row. In `betterCandidate`, preserve an `exact_hard` candidate over a non-hard candidate sharing the same episode before comparing score; this prevents deduplication from deleting exact proof. Change `winningCandidate(candidates, context)` to build its empty fallback as an authority=`coverage` draft with the declared subject and pass it through `classifyCandidate()`. Downstream reason/source formatting reads `matrixScore.winningCandidate.evidenceClass/authority`, never `winningRow` as proof authority.

In `scoringSignalMatrixInputs.ts`, replace the current defaulting `candidate()` helper with the only candidate factory:

```ts
function candidate(
  context: MatrixCandidateContext,
  authority: MatrixEvidenceAuthority,
  input: Omit<MatrixCandidate, "subject" | "authority">
): MatrixCandidate {
  return {
    ...input,
    subject: {
      decisionScope: context.decisionScope,
      address: context.subjectAddress,
      txHash: context.subjectTxHash
    },
    authority
  };
}
```

Every builder must declare authority from its domain evidence before choosing a row:

- Task 10 exact Fast code → `exact_hard/fast_exact_code`.
- active stablecoin restriction → `exact_hard/stablecoin_restriction`.
- exact approval plus transferFrom → `exact_hard/approval_drain_exact`; route-linked only → `pattern/review_only`.
- Deep path only when `evidenceStrength === "exact_labeled_path"` → `exact_hard/exact_labeled_path`.
- deterministic Where hard evidence only when its existing proof level is exact → `exact_hard/where_exact_hard`.
- source-policy and corroborated-pattern candidates declare their current `can_decline | review_only` eligibility and required coverage explicitly.
- behavior, contract suspicion, boundary, and generic counterparty evidence → `context`.
- missing coverage → `coverage`; proved clean/operational → `clean`.

No helper may accept only a row and infer authority from it. Then validate report subjects before producing candidates:

```ts
function sameAddress(left: string | null | undefined, right: string): boolean {
  return (left ?? "").toLowerCase() === right.toLowerCase();
}

export function buildWalletMatrixCandidates(input: WalletMatrixCandidateInput): MatrixCandidate[] {
  const context: MatrixCandidateContext = {
    decisionScope: "wallet_unified",
    subjectAddress: input.address,
    subjectTxHash: null,
    requiredCoverage: "wallet_provenance"
  };
  if (!sameAddress(input.whereReport.subjectAddress, input.address)) {
    return [coverageCandidate(context, "coverage:where_subject_mismatch")];
  }
  const fastReport = sameAddress(input.fastReport?.subjectAddress, input.address) ? input.fastReport : null;
  const deepReport = sameAddress(input.deepReport?.subjectAddress, input.address) ? input.deepReport : null;
  const candidates = [
    ...fastHardProofCandidates(context, fastReport),
    ...fastContextCandidates(context, fastReport),
    ...deepCandidates(context, deepReport),
    ...whereCandidates(context, input.whereReport)
  ];
  const deepSparse = deepReport ? (deepReport.coverage?.transferEdges ?? 0) < 10 : true;
  if (input.whereReport.coverage.partial && deepSparse) {
    candidates.push(coverageCandidate(context, "coverage:where_and_deep_limited"));
  }
  return candidates;
}
```

Add `scoringSignalMatrixInputs.test.ts` controls where (a) an exact Fast report belongs to another address and (b) a context-only candidate is deliberately assigned `row:"hard_proof"`; assert neither produces `evidenceClass:"exact_hard"` after scoring.

Do not pass wallet-scoped candidates into the Incoming matrix. Factor the raw report mapping into `buildAddressEvidenceCandidates(context, input, options)`; the Wallet wrapper supplies `wallet_unified/null`, while the Incoming wrapper supplies `incoming_unified/depositTxHash`. Incoming may classify exact sender self/blacklist evidence and exact evidence on its transaction-seeded Where paths as hard. Deep historical exact evidence is context-only unless one of its cited tx hashes equals the deposit tx or a proved transaction-seeded provenance path. Add a test where an unrelated exact Deep path for the same sender does not create an Incoming hard floor.

Update only the two production call sites and matrix tests to supply context. Wallet context uses the checked address and `wallet_provenance`; Incoming uses sender, deposit tx hash, and `deposit_provenance`. `buildIncomingDepositMatrixCandidates()` accepts raw Fast/Deep/Where inputs, not `baseCandidates`, so subject linkage cannot be rewritten after classification.

- [ ] **Step 4: Implement the canonical final resolver**

Add the shared output types to `src/types.ts`:

```ts
export type DecisionCoverage = {
  required: "valid" | "invalid" | "not_applicable";
  overall: "complete" | "partial";
  invalidModes: string[];
  caveats: string[];
};
export type FinalDecisionBasis = "exact_hard_proof" | "matrix" | "technical_stop";
```

Create `finalDisposition.ts`:

```ts
import type { DecisionCoverage, FinalDecisionBasis, UserExchangeDecision } from "../types";
import type { ClassifiedMatrixCandidate, MatrixDecisionScope, MatrixScoringResult } from "./scoringSignalMatrix";

export type DecisionSubject = { decisionScope: MatrixDecisionScope; address: string; txHash: string | null };
export type FinalDisposition = {
  decision: UserExchangeDecision;
  finalScore: number | null;
  observedContextScore: number;
  scoreValid: boolean;
  decisionBasis: FinalDecisionBasis;
  coverage: DecisionCoverage;
  hardProofEvidenceIds: string[];
};

function sameSubject(candidate: ClassifiedMatrixCandidate, subject: DecisionSubject): boolean {
  return candidate.subject.decisionScope === subject.decisionScope &&
    candidate.subject.address.toLowerCase() === subject.address.toLowerCase() &&
    candidate.subject.txHash === subject.txHash;
}

function exactHardCandidate(matrix: MatrixScoringResult, subject: DecisionSubject): ClassifiedMatrixCandidate | null {
  return [...(matrix.riskVector.hard_proof ?? [])]
    .filter((candidate) =>
      candidate.evidenceClass === "exact_hard" &&
      candidate.proofLevel === "exact" &&
      candidate.decisionEligibility === "can_decline" &&
      candidate.coverageDependency === "none" &&
      sameSubject(candidate, subject)
    )
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

export function resolveFinalDisposition(input: {
  subject: DecisionSubject;
  matrixScore: MatrixScoringResult;
  coverage: DecisionCoverage;
  observedContextScore: number;
}): FinalDisposition {
  const observedContextScore = Math.max(0, Math.min(100, Math.round(input.observedContextScore)));
  const hard = exactHardCandidate(input.matrixScore, input.subject);
  if (hard) {
    return {
      decision: "DECLINE",
      finalScore: hard.score,
      observedContextScore,
      scoreValid: true,
      decisionBasis: "exact_hard_proof",
      coverage: input.coverage,
      hardProofEvidenceIds: hard.evidenceIds
    };
  }
  if (input.coverage.required === "invalid" || input.matrixScore.matrixDecision === "INSUFFICIENT_EVIDENCE" || input.matrixScore.policyScore === null) {
    return {
      decision: "NO_FINAL_DECISION",
      finalScore: null,
      observedContextScore,
      scoreValid: false,
      decisionBasis: "technical_stop",
      coverage: input.coverage,
      hardProofEvidenceIds: []
    };
  }
  return {
    decision: input.matrixScore.matrixDecision,
    finalScore: input.matrixScore.policyScore,
    observedContextScore,
    scoreValid: true,
    decisionBasis: "matrix",
    coverage: input.coverage,
    hardProofEvidenceIds: []
  };
}
```

- [ ] **Step 5: Make below-materiality review an explicit candidate**

In `whereCandidates()`, when the report has score-valid `residual_unresolved_below_materiality` or `dense_hop_unresolved_below_materiality`, emit a `counterparty_context`, `review_only` candidate using the bounded Where score. Do not emit `coverage_uncertainty` for that bounded caveat. Other partial/invalid coverage still emits `coverage_uncertainty`.

- [ ] **Step 6: Run matrix/resolver tests and typecheck**

Run the Step 2 command and `npm run typecheck`.

Expected: metadata is explicit, hard proof comes only from the matrix risk vector, and all four matrix outcomes map correctly.

- [ ] **Step 7: Commit Task 11**

```powershell
git add src/types.ts src/risk/scoringSignalMatrix.ts src/risk/scoringSignalMatrixInputs.ts src/risk/finalDisposition.ts tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/finalDisposition.test.ts
git commit -m "feat: add canonical forensic final disposition"
```

## Task 12: Use The Resolver For Wallet And Incoming Results

**Files:**

- Modify: `src/types.ts:495-520, 588-645, 825-905, 1640-1830`
- Modify: `src/check/whereIsMoneyCheck.ts:280-455`
- Modify: `src/risk/unifiedWalletRisk.ts:95-120, 742-895`
- Modify: `src/risk/unifiedIncomingDepositRisk.ts:20-45, 210-320`
- Modify: `src/forensics/incomingDepositJob.ts:1110-1215, 1805-1835`
- Test: `tests/check/whereIsMoneyCheck.test.ts:3268-3300`
- Test: `tests/risk/unifiedWalletRisk.test.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add failing Wallet/Incoming policy tests**

Add or invert these assertions:

```ts
expect(invalidWithoutHard).toMatchObject({
  finalDecision: "NO_FINAL_DECISION",
  finalScore: null,
  scoreValid: false,
  observedContextScore: expect.any(Number)
});
expect(hardWithInvalidWhere).toMatchObject({
  finalDecision: "DECLINE",
  finalScore: 95,
  scoreValid: true,
  coverage: { overall: "partial", invalidModes: ["where_is_money"] }
});
expect(contextFast90).toMatchObject({ finalDecision: "REVIEW", hardEvidenceFloor: 0 });
expect(incomingMatrixReview.finalDecision).toBe("REVIEW");
expect(incomingMatrixInsufficient).toMatchObject({ finalDecision: "NO_FINAL_DECISION", finalScore: null });
expect(incomingWithUnrelatedDeepHard).not.toMatchObject({ decisionBasis: "exact_hard_proof" });
```

For known zero Wallet balance, assert Where has `questionStatus:"not_applicable"`, does not claim `clean_source_proven`, and unified scoring uses other applicable modes. For a zero-current-balance Incoming deposit, assert transaction-seeded provenance still runs.

- [ ] **Step 2: Run unified tests and verify RED**

Run:

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts
```

Expected: invalid coverage maps to `ACCEPTABLE 0`, hard proof is suppressed, Incoming flattens `REVIEW`, and final scores cannot be null.

- [ ] **Step 3: Extend report contracts deliberately**

Apply these type changes in `src/types.ts` and `UnifiedWalletRiskResult`:

```ts
export type IncomingDepositDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE" | "NO_FINAL_DECISION";

// WhereIsMoneyCoverage
questionStatus?: "applicable" | "not_applicable";

// Unified Wallet and Incoming summaries
finalScore: number | null;
finalLevel: RiskLevel | null;
observedContextScore: number;
scoreValid: boolean;
decisionBasis: FinalDecisionBasis;
coverage: DecisionCoverage;

// IncomingDepositRiskReport
depositRiskScore: number | null;
observedContextScore: number;
riskBand: IncomingDepositRiskBand | null;
```

Import `DecisionCoverage` and `FinalDecisionBasis` from `src/types.ts` in `unifiedWalletRisk.ts`, `unifiedIncomingDepositRisk.ts`, and `incomingDepositJob.ts`. Existing JSON/JSONB storage accepts null; do not add a migration.

Update the default `whereIsMoneyReportForTest()` and Incoming test builders to represent new output explicitly: `scoreValid:true`, `scoreBlockedReason:null`, `technicalStatus:"completed"`, and `coverage.questionStatus:"applicable"`. Legacy omissions are created only in Task 13's dedicated compatibility fixtures.

- [ ] **Step 4: Represent known zero as not applicable, not clean**

In `walletProfileZeroBalanceReport()` set:

```ts
const exactHard = hardBadEvidence.length > 0;
const decision: ExchangeDecision = exactHard ? "DECLINE" : "REVIEW";
const riskScore = exactHard ? Math.max(...hardBadEvidence.map((item) => item.score)) : 0;
const decisionFields = exactHard
  ? {
      decision,
      internalDecision: decision,
      userDecision: "DECLINE" as const,
      proofLevel: "exact_scam_or_taint_proof" as const
    }
  : {
      decision,
      internalDecision: decision,
      userDecision: "NO_FINAL_DECISION" as const,
      proofLevel: "insufficient_coverage" as const
    };

// Apply to assessment and top-level report:
scoreValid: true,
scoreBlockedReason: null,
technicalStatus: "completed",
...decisionFields,
riskScore,
coverage: {
  selectedInboundTxCount: 0,
  currentBalanceRaw: input.currentBalanceRaw,
  requestedAmountRaw: input.requestedAmountRaw ?? null,
  targetAmountRaw: "0",
  selectedAmountRaw: "0",
  coverageRatio: 0,
  drainEpisode: input.drainEpisode ?? null,
  checkedScope,
  anchorCoverageRatio: input.anchorCoverageRatio ?? 0,
  episodeCoverageRatio: input.episodeCoverageRatio ?? null,
  selectedInboundVolumeRaw: "0",
  currentBalanceCoverageRatio: 0,
  provenanceScope: input.provenanceScope,
  anchorTransfer: input.anchorTransfer ?? null,
  maxDepth: input.maxDepth,
  fetchedAddressCount: 0,
  questionStatus: "not_applicable",
  partial: false,
  notes: [WALLET_PROFILE_ZERO_BALANCE_REASON]
}
```

Do not use the Fast numeric score inside this not-applicable Where report; Fast remains a separate matrix input. In `whereCandidates()`, when `questionStatus === "not_applicable"`, emit only applicable exact `hardBadEvidence` and return—do not create a clean, coverage, or duplicate context candidate. Every newly produced nonzero/fallback Where coverage object sets `questionStatus: "applicable"`; only the compatibility reader treats a missing legacy field as applicable. Incoming and requested-amount modes remain transaction/amount-seeded.

- [ ] **Step 5: Replace Wallet adapter logic with the resolver**

Delete `finalScoreFromMatrix()` and `finalDecisionFromMatrix()`. Also delete the unified adapter's separate `fastHardEvidenceFloor()`, `deepHardEvidenceFloors()`, and `whereHardEvidenceFloor()` classification path. Derive the diagnostic hard floor/reasons from the same classified matrix candidates consumed by the resolver:

```ts
const exactHardCandidates = Object.values(matrixScore.riskVector)
  .flatMap((candidates) => candidates ?? [])
  .filter((candidate) => candidate.evidenceClass === "exact_hard" && candidate.proofLevel === "exact");
const hardEvidenceFloor = Math.max(0, ...exactHardCandidates.map((candidate) => candidate.score));
const hardReasons: UnifiedWalletRiskReason[] = exactHardCandidates.map((candidate) => ({
  code: candidate.atomicSignals[0] ?? `hard:${candidate.evidenceIds[0] ?? "unknown"}`,
  message: "Applicable exact hard evidence from the canonical scoring matrix.",
  score: candidate.score,
  source: "hard_evidence"
}));
```

Populate `policyFloor`, `patternFloor`, `assetContinuationFloor`, active-anchor diagnostics, and their reason rows from `matrixScore.riskVector` as well. The legacy layer calculators may remain only for weighted observed-context diagnostics and dampeners; they cannot select or rename a floor. This leaves one classification authority while preserving the existing result shape for callers.

Build coverage once:

```ts
function walletDecisionCoverage(report: WhereIsMoneyReport, coverageLevel: UnifiedWalletCoverageLevel): DecisionCoverage {
  const notApplicable = report.coverage.questionStatus === "not_applicable";
  const invalid = !notApplicable && report.scoreValid !== true;
  return {
    required: notApplicable ? "not_applicable" : invalid ? "invalid" : "valid",
    overall: invalid || report.coverage.partial || coverageLevel !== "complete" ? "partial" : "complete",
    invalidModes: invalid ? ["where_is_money"] : [],
    caveats: [...report.coverage.notes, ...(report.assessment.warnings ?? [])]
  };
}
```

After matrix/context calculation, derive a bounded diagnostic score from already-classified non-hard evidence; this is not a decision input:

```ts
export function observedContextFromMatrix(matrix: MatrixScoringResult, weightedContextScore: number): number {
  const candidateScores = Object.values(matrix.riskVector)
    .flatMap((candidates) => candidates ?? [])
    .filter((candidate) => candidate.evidenceClass !== "exact_hard" && candidate.evidenceClass !== "coverage" && candidate.evidenceClass !== "clean")
    .map((candidate) => candidate.score);
  return Math.max(weightedContextScore, ...candidateScores, 0);
}
```

Then resolve:

```ts
const disposition = resolveFinalDisposition({
  subject: { decisionScope: "wallet_unified", address: input.subject.address, txHash: null },
  matrixScore,
  coverage: walletDecisionCoverage(input.whereReport, coverage),
  observedContextScore: observedContextFromMatrix(matrixScore, coverageAdjustedContextScore)
});
```

Return `finalScore`, `finalDecision`, `observedContextScore`, `scoreValid`, `decisionBasis`, and decision coverage from `disposition`. Set `finalLevel` to `null` when `finalScore` is null.

- [ ] **Step 6: Resolve Incoming without post-hoc flattening**

Add optional `decisionCoverage?: DecisionCoverage` to `CalculateUnifiedIncomingDepositRiskInput`. Build deposit coverage from Where plus the targeted local block before calling the calculator.

Use this helper in `incomingDepositJob.ts`:

```ts
function incomingDecisionCoverage(
  whereReport: WhereIsMoneyReport,
  targetedBlock: IncomingTargetedCoverageBlock | null
): DecisionCoverage {
  const invalid = targetedBlock !== null || whereReport.scoreValid !== true;
  return {
    required: invalid ? "invalid" : "valid",
    overall: invalid || whereReport.coverage.partial ? "partial" : "complete",
    invalidModes: invalid ? ["incoming_deposit_provenance"] : [],
    caveats: [
      ...whereReport.coverage.notes,
      ...(targetedBlock ? [`${targetedBlock.scoreBlockedReason}:${targetedBlock.technicalStatus}`] : [])
    ]
  };
}
```

Pass this value as `decisionCoverage` when calling `calculateUnifiedIncomingDepositRisk()`.

Call `buildIncomingDepositMatrixCandidates()` with raw Fast/Deep/transaction-seeded Where reports, then `scoreMatrixCandidates(..., incomingContext)` and `resolveFinalDisposition()` with subject `{ decisionScope:"incoming_unified", address:senderAddress, txHash }`. Reuse `observedContextFromMatrix()` with the Incoming diagnostic overlay score. Remove the current `baseCandidates: buildWalletMatrixCandidates(...)` path. Delete the ternary that maps every non-decline to `ACCEPTABLE`, and delete the job-level mutation of `unifiedRiskSummary.finalDecision`.

Use `base.finalScore ?? base.observedContextScore` only for legacy diagnostic overlay math; derive `freshBundleFloor`, `corridorFloor`, and background summary fields from the classified Incoming risk vector/atomic signals. The resolver remains the sole source of final fields.

In `incomingReportFromWhere()`:

```ts
const decision = unifiedRisk.finalDecision;
const scoreInvalid = !unifiedRisk.scoreValid;
const depositRiskScore = unifiedRisk.finalScore;
const riskBand = depositRiskScore === null ? null : incomingRiskBandFromUnifiedScore(depositRiskScore);
```

Preserve path-level review in `incomingPathFromWhere()`:

```ts
const verdict: IncomingDepositDecision = path.verdict === "DECLINE" && path.riskScoreContribution >= 60
  ? "DECLINE"
  : path.verdict === "REVIEW"
    ? "REVIEW"
    : "ACCEPTABLE";
```

Do not convert a null-score Incoming technical stop into a generic `RiskReport(score=0)`: that would persist fake cleanliness. Guard `recordObservedTransactionRisk()` so it runs only when `depositRiskScore !== null`; the Incoming job result remains the authoritative null-score record. Add a worker test asserting zero generic-risk writes for `NO_FINAL_DECISION`, while the alert/job completion still occurs.

- [ ] **Step 7: Run unified, Incoming, and type tests**

Run the Step 2 command and `npm run typecheck`.

Expected: hard proof survives unrelated partial coverage; invalid provenance without hard proof has no final score; Incoming preserves `REVIEW`.

- [ ] **Step 8: Commit Task 12**

```powershell
git add src/types.ts src/check/whereIsMoneyCheck.ts src/risk/unifiedWalletRisk.ts src/risk/unifiedIncomingDepositRisk.ts src/forensics/incomingDepositJob.ts tests/check/whereIsMoneyCheck.test.ts tests/risk/unifiedWalletRisk.test.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "fix: resolve Wallet and Incoming decisions canonically"
```

## Task 13: Preserve Canonical Semantics In Telegram, Admin, And Alerts

**Files:**

- Modify: `src/bot/riskExplanationSummary.ts:760-850`
- Modify: `src/bot/createBot.ts:2280-2325, 3070-3145, 3355-3460`
- Modify: `src/admin/adminServer.ts:650-680, 1085-1125`
- Modify: `src/admin/forensicsGraph.ts:15-67, 287-295, 3719-4800`
- Modify: `src/alerts/formatters.ts:290-345`
- Test: `tests/bot/createBot.test.ts`
- Test: `tests/admin/adminServer.test.ts`
- Test: `tests/admin/forensicsGraph.test.ts`
- Test: `tests/alerts/formatters.test.ts`

- [ ] **Step 1: Add failing presentation-contract tests**

Build the Bot scenarios through the existing public formatter and real test helpers:

```ts
const technicalWhere = scoreInvalidWhereReportForTest();
const contextFast: RiskReport = {
  subjectAddress: technicalWhere.subjectAddress,
  score: 90,
  level: "CRITICAL",
  reasons: [{ code: "critical_context_only", message: "context only", scoreImpact: 90 }]
};
const technicalText = formatUnifiedAddressFinalReportForTest({
  address: technicalWhere.subjectAddress,
  whereReport: technicalWhere,
  fastReport: contextFast,
  locale: "en"
});

const hardBase = scoreInvalidWhereReportForTest();
const hardPartialWhere: WhereIsMoneyReport = {
  ...hardBase,
  assessment: {
    ...hardBase.assessment,
    hardBadEvidence: [{
      kind: "scam_or_blacklist",
      score: 95,
      message: "Exact subject blacklist evidence.",
      evidenceIds: ["hard:subject:blacklist"]
    }]
  }
};
const hardPartialText = formatUnifiedAddressFinalReportForTest({
  address: hardPartialWhere.subjectAddress,
  whereReport: hardPartialWhere,
  locale: "en"
});
```

In `adminServer.test.ts`, update `whereReportForAdminTest()` defaults with the same explicit new-report validity fields before adding the hard/partial fixture. In `formatters.test.ts`, add `observedContextScore` to `incomingDepositBaseInput.report`; its existing numeric score remains the legacy-readable Incoming control.

Assertions:

```ts
expect(technicalText).toContain("NO_FINAL_DECISION");
expect(technicalText).toContain("Technical stop / no final score");
expect(technicalText).toContain("Observed context: 59");
expect(technicalText).not.toContain("Final risk: 59");

expect(hardPartialText).toContain("DECLINE");
expect(hardPartialText).toContain("95/100");
expect(hardPartialText).toContain("Coverage: partial");
expect(hardPartialText).toContain("where_is_money");

const hardPartialAdminWhere = whereReportForAdminTest({
  scoreValid: false,
  scoreBlockedReason: "provider_cap_unresolved",
  technicalStatus: "provider_cap_unresolved",
  coverage: { partial: true, notes: ["provider cap"] },
  assessment: {
    scoreValid: false,
    scoreBlockedReason: "provider_cap_unresolved",
    technicalStatus: "provider_cap_unresolved",
    hardBadEvidence: [{
      kind: "scam_or_blacklist",
      score: 95,
      message: "Exact subject blacklist evidence.",
      evidenceIds: ["hard:subject:blacklist"]
    }]
  }
});
const hardPartialJob = job({
  id: "job-hard-partial",
  resultJson: {
    subjectAddress: "TSubject111111111111111111111111111111",
    whereIsMoneyReport: hardPartialAdminWhere,
    score_valid: false
  }
});
const server = await start({
  ...deps(),
  listJobs: async () => [hardPartialJob],
  getJob: async (id) => id === hardPartialJob.id ? hardPartialJob : null
});
const adminResponse = await fetch(`${server.url}/admin/api/forensic-jobs/${hardPartialJob.id}/graph`, {
  headers: { authorization: "Bearer secret-token" }
});
const adminGraph = (await adminResponse.json()).graph;
expect(adminGraph.summary).toMatchObject({
  decision: "DECLINE",
  riskScore: 95,
  humanSummary: {
    limitations: expect.arrayContaining([expect.stringMatching(/partial|покрыт/i)])
  }
});
```

For Incoming alerts, use the existing `incomingDepositBaseInput`:

```ts
const noFinalAlert = formatIncomingDepositRiskAlert({
  ...incomingDepositBaseInput,
  locale: "en",
  report: {
    ...incomingDepositBaseInput.report,
    decision: "NO_FINAL_DECISION",
    depositRiskScore: null,
    observedContextScore: 59,
    riskBand: null
  }
}).text;
const reviewAlert = formatIncomingDepositRiskAlert({
  ...incomingDepositBaseInput,
  locale: "en",
  report: {
    ...incomingDepositBaseInput.report,
    decision: "REVIEW",
    depositRiskScore: 45,
    observedContextScore: 45,
    riskBand: "MEDIUM"
  }
}).text;
expect(noFinalAlert).toContain("NO_FINAL_DECISION");
expect(noFinalAlert).toContain("Observed context");
expect(noFinalAlert).not.toContain("null/100");
expect(reviewAlert).toContain("REVIEW");
```

- [ ] **Step 2: Run presentation tests and verify RED**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts tests/alerts/formatters.test.ts
```

Expected: Bot/Admin still remap from Where/matrix independently, hard partial results take the invalid shortcut, and Incoming assumes a numeric score/band.

- [ ] **Step 3: Remove Bot/Admin decision remapping**

Delete `finalDisplayDecision()` and `finalDisplayDecisionForAdmin()`. Both consumers must use `unifiedRisk.finalDecision` directly.

Extend `AdminForensicsDecision` with `"NO_FINAL_DECISION"`. When a new result has `scoreValid:false`, project that decision with `riskScore:null`; keep legacy `UNKNOWN` only for records that genuinely lack decision semantics.

Calculate unified risk before deciding whether to render a technical-stop view:

```ts
const unifiedRisk = calculateUnifiedWalletRisk({
  address: input.address,
  fastReport: input.fastReport,
  deepReport: input.deepReport,
  whereReport: input.whereReport
});
if (unifiedRisk.finalDecision === "NO_FINAL_DECISION") {
  return formatInvalidWhereScoreFinalReport({ ...input, unifiedRisk });
}
```

A Where-invalid result with exact hard proof therefore follows the normal hard-decline view and retains coverage limitations.

In Admin, change `buildAdminHumanSummary()` to return `{ unifiedRisk, humanSummary }` from the same calculation. In `enrichHumanRiskSummary()`, project the canonical fields together—never leave the raw Where score beside a canonical human conclusion:

```ts
const presentation = buildAdminRiskPresentation({
  address: job.subjectAddress,
  whereReport,
  fastReport,
  deepReport
});
return {
  ...graph,
  nodes: graph.nodes.map((node) => node.kind === "subject"
    ? {
        ...node,
        riskLevel: presentation.unifiedRisk.finalLevel,
        metadata: {
          ...node.metadata,
          finalDecision: presentation.unifiedRisk.finalDecision,
          finalScore: presentation.unifiedRisk.finalScore,
          observedContextScore: presentation.unifiedRisk.observedContextScore
        }
      }
    : node),
  summary: {
    ...graph.summary,
    decision: presentation.unifiedRisk.finalDecision,
    riskScore: presentation.unifiedRisk.finalScore,
    riskLevel: presentation.unifiedRisk.finalLevel,
    riskClarity: {
      ...graph.summary.riskClarity,
      finalRiskScore: presentation.unifiedRisk.finalScore,
      riskLevel: presentation.unifiedRisk.finalLevel,
      decisionStatus: presentation.unifiedRisk.finalDecision === "NO_FINAL_DECISION"
        ? "insufficient_coverage"
        : presentation.unifiedRisk.finalDecision === "DECLINE"
          ? "decline"
          : presentation.unifiedRisk.finalDecision === "REVIEW"
            ? "review"
            : "acceptable",
      hardEvidenceObserved: presentation.unifiedRisk.decisionBasis === "exact_hard_proof",
      evidenceClass: presentation.unifiedRisk.decisionBasis === "exact_hard_proof"
        ? "hard"
        : graph.summary.riskClarity.evidenceClass,
      limitations: [...new Set([
        ...graph.summary.riskClarity.limitations,
        ...presentation.unifiedRisk.coverage.caveats
      ])]
    },
    humanSummary: presentation.humanSummary
  }
};
```

- [ ] **Step 4: Separate final score from observed context**

In `riskExplanationSummary.ts`, populate summary `score` and `level` from nullable final fields. Add observed context only to limitations/diagnostics when there is no final score.

Remove serializer-level hard-proof reconstruction in `addFastFacts()`: a Fast reason is rendered as `hard_evidence` only when its code is present in the canonical unified result's hard-evidence reason set. A blacklist/approval marker absent from that set is displayed as context and cannot change conclusion, priority, or decision. Do not inspect score, message text, prefixes, or saved-marker wording to promote it.

Replace the first part of `finalScoreExplanationLines()` with:

```ts
const lines = result.finalScore === null
  ? [locale === "en"
      ? "Technical stop / no final score."
      : "Техническая остановка / итоговый риск не опубликован.",
    locale === "en"
      ? `Observed context: ${result.observedContextScore}; it is not a final score.`
      : `Наблюдаемый контекст: ${result.observedContextScore}; это не итоговый риск.`]
  : [locale === "en"
      ? `Weighted/background score is ${result.weightedLayerScore}; final risk is ${result.finalScore}.`
      : `Взвешенная/фоновая оценка: ${result.weightedLayerScore}; итоговый риск: ${result.finalScore}.`];
```

Add one explicit coverage line when `result.coverage.overall === "partial"`, including `invalidModes.join(", ")`.

- [ ] **Step 5: Render nullable Incoming results honestly**

Make `incomingDepositRiskIcon()` accept a nullable band and return `⚪️` for null.

Replace the risk line in `formatIncomingDepositRiskAlert()`:

```ts
const riskLine = input.report.depositRiskScore === null
  ? `${bold(locale === "en" ? "Deposit risk" : "Риск депозита")}: ${code(locale === "en" ? "no final score" : "нет итоговой оценки")}`
  : `${bold(riskObjectLabel("deposit", locale))}: ${incomingDepositRiskIcon(input.report.riskBand)} ${code(`${input.report.depositRiskScore}/100`)} (${code(input.report.riskBand ?? "unknown")})`;
const contextLine = input.report.depositRiskScore === null
  ? `${bold(locale === "en" ? "Observed context" : "Наблюдаемый контекст")}: ${code(String(input.report.observedContextScore))}`
  : null;
```

Insert `riskLine` and `contextLine` into the message. The decision line already supports the new Incoming `REVIEW` union.

- [ ] **Step 6: Keep legacy reads readable without applying the new policy**

Add one explicit compatibility predicate at the Bot/Admin read boundary:

```ts
function hasExplicitWhereScoreValidity(report: WhereIsMoneyReport): boolean {
  return typeof report.scoreValid === "boolean" || typeof report.assessment.scoreValid === "boolean";
}
```

For a legacy report where this is false:

- Bot uses a small `formatLegacyUnifiedAddressFinalReport()` that displays the stored Where `userDecision` and `riskScore`, adds `Legacy result — run a fresh check to apply the current scoring policy`, and does not call the new matrix/resolver.
- Admin/API preserve the graph's stored legacy decision/score, add the same limitation to `humanSummary`, and do not invoke canonical recomposition.
- No compatibility read writes `resultJson`, adds new fields to the job, or queues a rescore.

Add these controls:

```ts
it("renders an unversioned legacy Where result without rescoring it", () => {
  const legacy = whereIsMoneyReportForTest({
    decision: "REVIEW",
    userDecision: "REVIEW",
    internalDecision: "REVIEW",
    riskScore: 45
  });
  delete legacy.scoreValid;
  delete legacy.assessment.scoreValid;
  const text = formatUnifiedAddressFinalReportForTest({
    address: legacy.subjectAddress,
    whereReport: legacy,
    locale: "en"
  });
  expect(text).toContain("Legacy result");
  expect(text).toContain("REVIEW");
  expect(text).toContain("45/100");
  expect(text).toContain("run a fresh check");
});

it("keeps the legacy admin job byte-for-byte unchanged during graph read", async () => {
  const legacyJob = job({
    id: "job-legacy-read",
    resultJson: {
      subjectAddress: "TSubject111111111111111111111111111111",
      whereIsMoneyReport: whereReportForAdminTest()
    }
  });
  const before = JSON.stringify(legacyJob.resultJson);
  const server = await start({
    ...deps(),
    listJobs: async () => [legacyJob],
    getJob: async (id) => id === legacyJob.id ? legacyJob : null
  });
  const response = await fetch(`${server.url}/admin/api/forensic-jobs/${legacyJob.id}/graph`, {
    headers: { authorization: "Bearer secret-token" }
  });
  const body = await response.json();
  expect(body.graph.summary).toMatchObject({ decision: "REVIEW", riskScore: 78 });
  expect(body.graph.summary.humanSummary.limitations.join(" ")).toMatch(/legacy|fresh check/i);
  expect(JSON.stringify(legacyJob.resultJson)).toBe(before);
});
```

In the same Admin API test group, add a new-format technical-stop job and assert `body.graph.summary.riskScore === null`, `body.graph.summary.riskClarity.finalRiskScore === null`, and the subject node has `riskLevel:null` plus `metadata.observedContextScore`. This is the API/map null-preservation acceptance test.

- [ ] **Step 7: Run presentation tests and typecheck**

Run the Step 2 command and `npm run typecheck`.

Expected: all pass; no consumer derives a new decision from score, matrix row, or Where validity.

- [ ] **Step 8: Commit Task 13**

```powershell
git add src/bot/riskExplanationSummary.ts src/bot/createBot.ts src/admin/adminServer.ts src/admin/forensicsGraph.ts src/alerts/formatters.ts tests/bot/createBot.test.ts tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts tests/alerts/formatters.test.ts
git commit -m "fix: display final disposition without semantic remapping"
```

## Task 14: Update Product Truth And Run The Full Verification Gate

**Files:**

- Modify: `docs/superpowers/specs/2026-07-10-forensic-and-scoring-correctness-design.md:3-4`
- Modify: `docs/knowledge/02-check-modes.md`
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/05-where-is-money-and-incoming.md`
- Modify: `docs/knowledge/06-deepcheck.md`
- Modify: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`
- Modify: `docs/knowledge/13-agent-observations.md`

- [ ] **Step 1: Verify the approved design link**

Confirm the design header still reads:

```markdown
Status: approved; implementation tracked by `docs/superpowers/plans/2026-07-10-forensic-and-scoring-correctness.md`
```

Do not change the locked product invariants while updating current-behavior knowledge docs.

- [ ] **Step 2: Update knowledge docs with current behavior**

Record these exact product truths in the matching current-behavior sections:

- `02`: direct contract `/check` runs contract safety and ordinary transfer modes independently.
- `04`: complete provider index means local availability; exact provenance requires paged local materialization, with local limit/read errors distinct from provider cap.
- `05`: GasFree Accounts and unknown contracts are traversed; dynamic service fees are excluded from payer provenance; missing required provenance is no-final; known-zero wallet balance is not-applicable while Incoming stays transaction-seeded.
- `06`: Deep scores non-boundary contracts normally and excludes only exact GasFree service-fee edges from diversity/risk propagation.
- `07`: numeric score cannot create hard proof; exact hard proof precedes unrelated coverage failure; matrix mapping is lossless; technical stops have null final score and separate observed context.
- `08`: Admin/Telegram display hard decline with `coverage=partial`, and technical stop without a fake numeric final score or subject-node risk badge; observed context stays secondary.
- `09`: add a dated 2026-07-10 decision block covering address boundaries, GasFree settlement roles, local materialization, and canonical final disposition.

In `10-open-problems.md`, remove only the findings actually fixed by Tasks 1-13. Leave UI/UX, runtime, migration, worker-lease, delivery, and other deferred full-audit findings intact.

Add to `13-agent-observations.md`:

```markdown
## 2026-07-10: Contract And Score Are Facts, Not Policy Shortcuts

- `isContract` does not imply service boundary or risk.
- A numeric score does not imply hard evidence.
- Fee/service roles require transaction structure; address identity alone is insufficient.
- Coverage failure changes certainty, not badness.
```

- [ ] **Step 3: Run all focused regression groups**

```powershell
npm test -- tests/forensics/gasFreeSettlement.test.ts tests/forensics/serviceClassifier.test.ts tests/forensics/moneyOriginTrace.test.ts tests/forensics/incomingDepositCashflow.test.ts tests/forensics/contractDrivenEvidence.test.ts tests/forensics/serviceRouteEvidence.test.ts tests/forensics/counterpartyRisk.test.ts tests/forensics/counterpartyInteraction.test.ts tests/forensics/flowCounterpartyProfile.test.ts tests/forensics/serviceExposure.test.ts tests/forensics/inboundProvenance.test.ts tests/check/deepForensicCheck.test.ts tests/check/smartContractCheck.test.ts
npm test -- tests/forensics/localTronUsdtIndex.test.ts tests/storage/repositories.test.ts tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/check/whereIsMoneyCheck.test.ts tests/alerts/notificationText.test.ts
npm test -- tests/risk/fastEvidence.test.ts tests/risk/riskPolicy.test.ts tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/finalDisposition.test.ts tests/risk/unifiedWalletRisk.test.ts
npm test -- tests/bot/createBot.test.ts tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts tests/alerts/formatters.test.ts
```

Expected: every command passes.

- [ ] **Step 4: Run unchanged acquisition and boundary controls**

```powershell
npm test -- tests/forensics/targetedHistoryCoordinator.test.ts tests/forensics/addressIndexWorker.test.ts tests/forensics/deepSecondLayerRelationship.test.ts tests/forensics/routeSearch.test.ts tests/check/forensicRegressionCases.test.ts
```

Expected: provider retry/splitting, true service boundaries, and regression corpus pass without policy drift.

- [ ] **Step 5: Run the full repository gate**

```powershell
npm run typecheck
npm test
git diff --check
git status --short
```

Expected: typecheck and all tests pass, `git diff --check` is empty, and status contains only the intended documentation changes before the final docs commit.

- [ ] **Step 6: Commit Task 14**

```powershell
git add docs/superpowers/specs/2026-07-10-forensic-and-scoring-correctness-design.md docs/knowledge/02-check-modes.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/05-where-is-money-and-incoming.md docs/knowledge/06-deepcheck.md docs/knowledge/07-risk-scoring-matrix.md docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/13-agent-observations.md
git commit -m "docs: record forensic scoring correctness policy"
```

## Final Acceptance Checklist

- [ ] Both supplied GasFree Accounts are `isContract=true`, `isBoundary=false`, and trace through hops 1-3.
- [ ] GasFree Endpoint, TLnt provider, CEX, DEX, router, bridge, and pool controls remain boundaries.
- [ ] Dynamic `$1`, `$1.50`, `$2`, `$3`, zero-fee, changed-collector, and multi-recipient settlements are structural fixtures, never production constants.
- [ ] Arbitrary unmatched TLnt movement stays a visible scored direct transfer and is not labeled a fee.
- [ ] Fees remain in debit/accounting facts but not payer provenance, peer diversity, campaign counts, or ordinary risk propagation.
- [ ] Direct contract `/check` continues transfer analysis even when contract safety fails.
- [ ] Where row 151 and Incoming row 201 are materialized from local index without provider calls.
- [ ] Local ceiling/read failure never becomes provider cap or risk.
- [ ] Missing balance/provenance has `scoreValid=false`, `NO_FINAL_DECISION`, and no numeric final score.
- [ ] Context Fast 90 produces at most `REVIEW`; exact eligible codes retain hard proof.
- [ ] A `hard_proof` row without explicit exact authority remains context/review-only, and exact proof survives same-episode deduplication.
- [ ] Exact hard proof plus unrelated partial coverage is `DECLINE`, `scoreValid=true`, `coverage=partial`.
- [ ] Matrix `REVIEW` remains `REVIEW`; `INSUFFICIENT_EVIDENCE` becomes `NO_FINAL_DECISION`.
- [ ] Admin/Telegram/alerts consume the canonical decision without remapping.
- [ ] New Admin/API technical stops preserve `riskScore=null`; legacy jobs remain readable, unchanged, and clearly require a fresh check for the new policy.
- [ ] No dependency, migration, bulk historical rewrite, or deferred UI/runtime scope was introduced.
