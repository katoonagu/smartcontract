# Evidence-First TRON/USDT Forensics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the current TRON/USDT forensic bot with an evidence-first exchange-decision architecture: deterministic facts and policy own the final decision, while LLM verdicts remain bounded contract/context classifiers.

**Architecture:** Keep the existing modules and evolve them in place. Add a common decision/proof taxonomy, a `RiskCaseFile` evidence layer, separate static-vs-flow LLM cache keys, explicit service-route guards, amount-specific where-is-money, and a single policy-owned final decision path for Telegram/API output.

**Tech Stack:** TypeScript, Vitest, PostgreSQL migrations, existing TronScan/local-index clients, Telegram bot handlers, DeepSeek/OpenAI-compatible JSON client.

---

## File Structure

Existing files to modify:

- `src/types.ts` — shared report, proof, decision, case-file, and score-component types.
- `src/check/whereIsMoneyCheck.ts` — where-is-money orchestration and report assembly.
- `src/forensics/balanceFormingTransfers.ts` — balance/requested-amount transfer selection.
- `src/forensics/moneyOriginTrace.ts` — origin-path trace output and stop reasons.
- `src/forensics/moneyOriginPolicy.ts` — temporary policy logic until `RiskPolicyEngine` owns the final decision.
- `src/forensics/contractLlmVerdict.ts` — split static/flow LLM verdict inputs and cache usage.
- `src/approvals/approvalWorker.ts` — approval monitoring state transition wiring.
- `src/bot/createBot.ts` and message formatter files — user-facing output.
- `scripts/forensicWhereIsMoney.ts` — CLI smoke support.
- `.env.example` — any new config defaults.

New files to create:

- `src/risk/proofLevels.ts` — canonical proof and decision taxonomy.
- `src/risk/riskPolicyEngine.ts` — final score/decision composer.
- `src/forensics/riskCaseFile.ts` — immutable case-file builder and evidence-id helpers.
- `src/forensics/normalServiceRoute.ts` — deterministic DEX/bridge/router false-positive guard.
- `src/forensics/transactionOriginCheck.ts` — transaction-check wrapper over where-is-money core.
- `src/approvals/approvalStateMachine.ts` — approval lifecycle state machine.
- `migrations/021_contract_llm_verdict_cache_scopes.sql` — cache scope/hash columns or replacement tables.
- Tests beside the relevant modules under `tests/risk`, `tests/forensics`, `tests/check`, `tests/approvals`, `tests/bot`, and `tests/storage`.

---

## Task 1: Decision Taxonomy And Proof Levels

**Purpose:** Stop mixing exact proof, exchange-policy decline, LLM suspicion, and coverage failure in one generic `DECLINE`.

**Files:**
- Create: `src/risk/proofLevels.ts`
- Modify: `src/types.ts`
- Test: `tests/risk/proofLevels.test.ts`

- [ ] **Step 1: Write failing tests for proof-level mapping**

Create `tests/risk/proofLevels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { proofLevelTitle, userDecisionFromInternal } from "../../src/risk/proofLevels";

describe("proof levels", () => {
  it("maps internal review states to user-facing decline for exchange UX", () => {
    expect(userDecisionFromInternal("REVIEW")).toBe("DECLINE");
    expect(userDecisionFromInternal("DECLINE")).toBe("DECLINE");
    expect(userDecisionFromInternal("ACCEPTABLE")).toBe("ACCEPTABLE");
  });

  it("keeps exact proof wording separate from policy wording", () => {
    expect(proofLevelTitle("exact_scam_or_taint_proof")).toBe("Exact scam/taint proof");
    expect(proofLevelTitle("exchange_policy_decline")).toBe("Exchange-policy decline");
    expect(proofLevelTitle("llm_assisted_suspicion")).toBe("AI-assisted suspicion");
    expect(proofLevelTitle("clean_source_proven")).toBe("Clean source proven");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm test -- tests/risk/proofLevels.test.ts
```

Expected: FAIL because `src/risk/proofLevels.ts` does not exist.

- [ ] **Step 3: Add shared taxonomy**

Add to `src/types.ts`:

```ts
export type ProofLevel =
  | "exact_scam_or_taint_proof"
  | "exact_approval_drain_provenance"
  | "exchange_policy_decline"
  | "insufficient_coverage"
  | "llm_assisted_suspicion"
  | "clean_source_proven";

export type InternalExchangeDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE";
export type UserExchangeDecision = "ACCEPTABLE" | "DECLINE";

export type RiskDecisionReasonCode =
  | "usdt_blacklist"
  | "internal_scam_label"
  | "approval_drain_exact"
  | "htx_huobi_source"
  | "whitebit_source"
  | "service_boundary"
  | "unknown_contract_boundary"
  | "insufficient_coverage"
  | "llm_contract_suspicion"
  | "clean_cex_source";

export type PolicyReason = {
  code: RiskDecisionReasonCode;
  message: string;
  evidenceIds: string[];
};
```

Create `src/risk/proofLevels.ts`:

```ts
import type { ExchangeDecision, ProofLevel, UserExchangeDecision } from "../types";

export function userDecisionFromInternal(decision: ExchangeDecision): UserExchangeDecision {
  return decision === "ACCEPTABLE" ? "ACCEPTABLE" : "DECLINE";
}

export function proofLevelTitle(proofLevel: ProofLevel): string {
  switch (proofLevel) {
    case "exact_scam_or_taint_proof":
      return "Exact scam/taint proof";
    case "exact_approval_drain_provenance":
      return "Exact approval-drain provenance";
    case "exchange_policy_decline":
      return "Exchange-policy decline";
    case "insufficient_coverage":
      return "Insufficient coverage";
    case "llm_assisted_suspicion":
      return "AI-assisted suspicion";
    case "clean_source_proven":
      return "Clean source proven";
  }
}
```

- [ ] **Step 4: Run proof-level tests**

Run:

```powershell
npm test -- tests/risk/proofLevels.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/types.ts src/risk/proofLevels.ts tests/risk/proofLevels.test.ts
git commit -m "feat: add forensic proof levels"
```

---

## Task 2: RiskCaseFile V1 And Evidence IDs

**Purpose:** Every report line, Telegram reason, and LLM case file must trace back to evidence. This avoids unverifiable narrative and makes dashboard/internal review possible later.

**Files:**
- Create: `src/forensics/riskCaseFile.ts`
- Modify: `src/types.ts`
- Test: `tests/forensics/riskCaseFile.test.ts`

- [ ] **Step 1: Write failing tests for case-file builder**

Create `tests/forensics/riskCaseFile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createEvidenceId, createRiskCaseFile } from "../../src/forensics/riskCaseFile";

describe("RiskCaseFile", () => {
  it("creates stable evidence ids from type and source id", () => {
    expect(createEvidenceId("money_path", "tx-1")).toBe("money_path:tx-1");
    expect(createEvidenceId("contract_profile", "TContract")).toBe("contract_profile:TContract");
  });

  it("builds a where-is-money case file with internal and user decisions separated", () => {
    const caseFile = createRiskCaseFile({
      policyVersion: "test-policy",
      subject: {
        chain: "tron",
        address: "TSubject",
        asset: "USDT",
        mode: "where_is_money",
        requestedAmountRaw: "1000000000",
        currentBalanceRaw: "4982000000"
      },
      deterministicEvidence: [{
        id: "money_path:tx-1",
        type: "money_path",
        strength: "exact",
        txHash: "tx-1",
        facts: { fromAddress: "TSender", toAddress: "TSubject" }
      }],
      scoring: {
        internalDecision: "REVIEW",
        userDecision: "DECLINE",
        proofLevel: "insufficient_coverage",
        reasons: [{
          code: "insufficient_coverage",
          message: "Clean source is not proven due to limited coverage.",
          evidenceIds: ["money_path:tx-1"]
        }]
      },
      coverage: {
        status: "partial",
        fetchedAddressCount: 2,
        maxDepthReached: 1,
        providerErrors: [],
        missingData: ["sender history"]
      }
    });

    expect(caseFile.schemaVersion).toBe("risk-case-v1");
    expect(caseFile.scoring.internalDecision).toBe("REVIEW");
    expect(caseFile.scoring.userDecision).toBe("DECLINE");
    expect(caseFile.audit.evidenceIds).toEqual(["money_path:tx-1"]);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm test -- tests/forensics/riskCaseFile.test.ts
```

Expected: FAIL because `riskCaseFile.ts` does not exist.

- [ ] **Step 3: Add RiskCaseFile types**

Add to `src/types.ts`:

```ts
export type RiskCaseMode =
  | "fast_check"
  | "where_is_money"
  | "transaction_check"
  | "deep_research"
  | "approval_monitoring";

export type RiskCaseEvidenceType =
  | "usdt_blacklist"
  | "internal_label"
  | "provider_label"
  | "money_path"
  | "service_boundary"
  | "approval"
  | "transfer_from"
  | "contract_profile"
  | "coverage";

export type RiskCaseEvidence = {
  id: string;
  type: RiskCaseEvidenceType;
  strength: "exact" | "strong" | "context" | "weak";
  subjectAddress?: string;
  txHash?: string;
  contractAddress?: string;
  facts: Record<string, unknown>;
};

export type RiskCaseFile = {
  schemaVersion: "risk-case-v1";
  policyVersion: string;
  subject: {
    chain: "tron";
    address: string;
    asset: "USDT";
    mode: RiskCaseMode;
    requestedAmountRaw?: string | null;
    currentBalanceRaw?: string | null;
  };
  deterministicEvidence: RiskCaseEvidence[];
  scoring: {
    internalDecision: ExchangeDecision;
    userDecision: UserExchangeDecision;
    proofLevel: ProofLevel;
    reasons: PolicyReason[];
  };
  coverage: {
    status: "complete" | "partial" | "failed";
    fetchedAddressCount: number;
    maxDepthReached: number;
    providerErrors: string[];
    missingData: string[];
  };
  audit: {
    createdAt: string;
    sourceJobId?: string;
    evidenceIds: string[];
  };
};
```

- [ ] **Step 4: Add builder**

Create `src/forensics/riskCaseFile.ts`:

```ts
import type { RiskCaseEvidenceType, RiskCaseFile } from "../types";

export function createEvidenceId(type: RiskCaseEvidenceType, sourceId: string): string {
  return `${type}:${sourceId}`;
}

export function createRiskCaseFile(
  input: Omit<RiskCaseFile, "schemaVersion" | "audit"> & {
    sourceJobId?: string;
    createdAt?: string;
  }
): RiskCaseFile {
  return {
    schemaVersion: "risk-case-v1",
    policyVersion: input.policyVersion,
    subject: input.subject,
    deterministicEvidence: input.deterministicEvidence,
    scoring: input.scoring,
    coverage: input.coverage,
    audit: {
      createdAt: input.createdAt ?? new Date().toISOString(),
      sourceJobId: input.sourceJobId,
      evidenceIds: input.deterministicEvidence.map((evidence) => evidence.id)
    }
  };
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/forensics/riskCaseFile.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/types.ts src/forensics/riskCaseFile.ts tests/forensics/riskCaseFile.test.ts
git commit -m "feat: add risk case file foundation"
```

---

## Task 3: RiskPolicyEngine Owns Final Decisions

**Purpose:** Move final exchange-decision ownership out of scattered modules and into one deterministic policy composer.

**Files:**
- Create: `src/risk/riskPolicyEngine.ts`
- Modify: `src/forensics/moneyOriginPolicy.ts`
- Test: `tests/risk/riskPolicyEngine.test.ts`

- [ ] **Step 1: Write failing tests for policy gates**

Create `tests/risk/riskPolicyEngine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideRiskPolicy } from "../../src/risk/riskPolicyEngine";

describe("risk policy engine", () => {
  it("hard-declines exact approval-drain evidence", () => {
    const decision = decideRiskPolicy({
      taintScore: 0,
      approvalDrainScore: 92,
      moneyOriginScore: 0,
      serviceBoundaryScore: 0,
      contractRiskScore: 0,
      operationalPatternScore: 0,
      fastWalletScore: 0,
      coverageRiskScore: 0,
      llmAssistedScore: 0,
      dampenerScore: 0,
      signals: ["approval_drain_exact"]
    });

    expect(decision).toMatchObject({
      internalDecision: "DECLINE",
      userDecision: "DECLINE",
      proofLevel: "exact_approval_drain_provenance",
      riskScore: 92
    });
  });

  it("treats WhiteBIT as policy decline with share-based medium score", () => {
    const decision = decideRiskPolicy({
      taintScore: 0,
      approvalDrainScore: 0,
      moneyOriginScore: 45,
      serviceBoundaryScore: 0,
      contractRiskScore: 0,
      operationalPatternScore: 0,
      fastWalletScore: 0,
      coverageRiskScore: 0,
      llmAssistedScore: 0,
      dampenerScore: 0,
      signals: ["whitebit_source"]
    });

    expect(decision).toMatchObject({
      userDecision: "DECLINE",
      proofLevel: "exchange_policy_decline",
      riskScore: 45
    });
  });

  it("accepts only deterministic clean source", () => {
    const decision = decideRiskPolicy({
      taintScore: 0,
      approvalDrainScore: 0,
      moneyOriginScore: 5,
      serviceBoundaryScore: 0,
      contractRiskScore: 0,
      operationalPatternScore: 0,
      fastWalletScore: 0,
      coverageRiskScore: 0,
      llmAssistedScore: 0,
      dampenerScore: 20,
      signals: ["clean_cex_source"]
    });

    expect(decision).toMatchObject({
      internalDecision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      proofLevel: "clean_source_proven"
    });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm test -- tests/risk/riskPolicyEngine.test.ts
```

Expected: FAIL because `riskPolicyEngine.ts` does not exist.

- [ ] **Step 3: Add policy engine**

Create `src/risk/riskPolicyEngine.ts`:

```ts
import type { ExchangeDecision, PolicyReason, ProofLevel, UserExchangeDecision } from "../types";

export type ScoreComponents = {
  taintScore: number;
  approvalDrainScore: number;
  moneyOriginScore: number;
  serviceBoundaryScore: number;
  contractRiskScore: number;
  operationalPatternScore: number;
  fastWalletScore: number;
  coverageRiskScore: number;
  llmAssistedScore: number;
  dampenerScore: number;
  signals: Array<
    | "exact_taint"
    | "approval_drain_exact"
    | "htx_huobi_source"
    | "whitebit_source"
    | "service_boundary"
    | "insufficient_coverage"
    | "llm_contract_suspicion"
    | "clean_cex_source"
  >;
};

export type PolicyDecision = {
  internalDecision: ExchangeDecision;
  userDecision: UserExchangeDecision;
  proofLevel: ProofLevel;
  riskScore: number;
  reasons: PolicyReason[];
};

function cappedSum(values: number[], cap: number): number {
  return Math.min(cap, values.reduce((sum, value) => sum + Math.max(0, value), 0));
}

function reason(code: PolicyReason["code"], message: string): PolicyReason {
  return { code, message, evidenceIds: [] };
}

export function decideRiskPolicy(input: ScoreComponents): PolicyDecision {
  if (input.signals.includes("exact_taint")) {
    return {
      internalDecision: "DECLINE",
      userDecision: "DECLINE",
      proofLevel: "exact_scam_or_taint_proof",
      riskScore: Math.max(input.taintScore, 90),
      reasons: [reason("internal_scam_label", "Exact scam/taint evidence was found.")]
    };
  }

  if (input.signals.includes("approval_drain_exact")) {
    return {
      internalDecision: "DECLINE",
      userDecision: "DECLINE",
      proofLevel: "exact_approval_drain_provenance",
      riskScore: Math.max(input.approvalDrainScore, 90),
      reasons: [reason("approval_drain_exact", "Exact approval-drain provenance was found.")]
    };
  }

  if (input.signals.includes("htx_huobi_source")) {
    return {
      internalDecision: "DECLINE",
      userDecision: "DECLINE",
      proofLevel: "exchange_policy_decline",
      riskScore: Math.max(input.moneyOriginScore, 78),
      reasons: [reason("htx_huobi_source", "Balance-forming path reaches HTX/Huobi source boundary.")]
    };
  }

  if (input.signals.includes("whitebit_source")) {
    return {
      internalDecision: "DECLINE",
      userDecision: "DECLINE",
      proofLevel: "exchange_policy_decline",
      riskScore: Math.max(input.moneyOriginScore, 35),
      reasons: [reason("whitebit_source", "Balance-forming path has WhiteBIT policy exposure.")]
    };
  }

  if (input.signals.includes("service_boundary")) {
    return {
      internalDecision: "DECLINE",
      userDecision: "DECLINE",
      proofLevel: "exchange_policy_decline",
      riskScore: Math.max(input.serviceBoundaryScore, 65),
      reasons: [reason("service_boundary", "Clean source is not proven after a service/contract boundary.")]
    };
  }

  if (input.signals.includes("insufficient_coverage")) {
    return {
      internalDecision: "REVIEW",
      userDecision: "DECLINE",
      proofLevel: "insufficient_coverage",
      riskScore: Math.max(input.coverageRiskScore, 65),
      reasons: [reason("insufficient_coverage", "Clean source is not proven due to limited coverage.")]
    };
  }

  if (input.signals.includes("llm_contract_suspicion")) {
    return {
      internalDecision: "REVIEW",
      userDecision: "DECLINE",
      proofLevel: "llm_assisted_suspicion",
      riskScore: Math.max(input.llmAssistedScore, input.contractRiskScore, 65),
      reasons: [reason("llm_contract_suspicion", "AI contract verdict indicates suspicious contract context.")]
    };
  }

  if (input.signals.includes("clean_cex_source")) {
    return {
      internalDecision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      proofLevel: "clean_source_proven",
      riskScore: Math.max(0, input.moneyOriginScore - input.dampenerScore),
      reasons: [reason("clean_cex_source", "Balance-forming path reaches allowlisted CEX through clean on-chain hops.")]
    };
  }

  const contextualScore = cappedSum([
    input.moneyOriginScore,
    input.serviceBoundaryScore,
    input.contractRiskScore,
    input.operationalPatternScore,
    input.fastWalletScore,
    input.coverageRiskScore,
    input.llmAssistedScore
  ], 85);

  return {
    internalDecision: "REVIEW",
    userDecision: "DECLINE",
    proofLevel: "insufficient_coverage",
    riskScore: Math.max(45, contextualScore - input.dampenerScore),
    reasons: [reason("insufficient_coverage", "Clean source is not proven.")]
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/risk/riskPolicyEngine.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/risk/riskPolicyEngine.ts tests/risk/riskPolicyEngine.test.ts src/types.ts
git commit -m "feat: add forensic risk policy engine"
```

---

## Task 4: Wire Where-Is-Money Reports To Proof Levels

**Purpose:** Existing where-is-money should start returning proof-level and user/internal decision fields without changing all policy logic at once.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `scripts/forensicWhereIsMoney.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add failing report tests**

In `tests/check/whereIsMoneyCheck.test.ts`, add a case near existing WhiteBIT/unknown-contract tests:

```ts
it("returns proof level for WhiteBIT exchange-policy declines", async () => {
  const report = await runWhereIsMoneyCheck(createDepsForWhitebitPath());

  expect(report.decision).toBe("DECLINE");
  expect(report.userDecision).toBe("DECLINE");
  expect(report.proofLevel).toBe("exchange_policy_decline");
  expect(report.decisionReasons.join(" ")).toContain("WhiteBIT");
  expect(report.decisionReasons.join(" ")).not.toContain("scam proof");
});
```

Use the existing test fixtures in that file. If there is no helper named `createDepsForWhitebitPath`, create one by copying the current WhiteBIT fixture setup and naming it explicitly.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: FAIL because `WhereIsMoneyReport` does not expose `userDecision` or `proofLevel`.

- [ ] **Step 3: Extend report type**

In `src/types.ts`, extend `WhereIsMoneyReport`:

```ts
userDecision: UserExchangeDecision;
internalDecision: ExchangeDecision;
proofLevel: ProofLevel;
policyReasons?: PolicyReason[];
riskCaseFile?: RiskCaseFile;
```

- [ ] **Step 4: Map current decision to proofLevel**

In `src/check/whereIsMoneyCheck.ts`, after current combined decision calculation, add a small adapter:

```ts
function proofLevelFromCurrentReasons(input: {
  decision: ExchangeDecision;
  riskScore: number;
  reasons: string[];
}): ProofLevel {
  const text = input.reasons.join(" ").toLowerCase();
  if (text.includes("approval-drain") || text.includes("transferfrom")) return "exact_approval_drain_provenance";
  if (text.includes("whitebit") || text.includes("htx") || text.includes("huobi") || text.includes("boundary")) return "exchange_policy_decline";
  if (text.includes("coverage") || text.includes("no previous inbound") || text.includes("limited")) return "insufficient_coverage";
  if (text.includes("ai contract verdict")) return "llm_assisted_suspicion";
  if (input.decision === "ACCEPTABLE") return "clean_source_proven";
  return "insufficient_coverage";
}
```

This adapter is intentionally temporary. Later tasks replace it with `RiskPolicyEngine`.

- [ ] **Step 5: Set report fields**

In report assembly:

```ts
const proofLevel = proofLevelFromCurrentReasons({
  decision: finalDecision,
  riskScore,
  reasons: decisionReasons
});

return {
  ...existingReport,
  internalDecision: finalDecision,
  userDecision: finalDecision === "ACCEPTABLE" ? "ACCEPTABLE" : "DECLINE",
  proofLevel
};
```

- [ ] **Step 6: Update Telegram wording**

In `src/bot/createBot.ts`, where where-is-money result is formatted, add:

```ts
lines.push(`Evidence type: ${proofLevelTitle(report.proofLevel)}`);
```

For `exchange_policy_decline`, make sure wording says:

```text
This is an exchange-policy decline, not direct scam proof.
```

- [ ] **Step 7: Run tests**

Run:

```powershell
npm test -- tests/check/whereIsMoneyCheck.test.ts tests/bot/createBot.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/types.ts src/check/whereIsMoneyCheck.ts src/bot/createBot.ts scripts/forensicWhereIsMoney.ts tests/check/whereIsMoneyCheck.test.ts tests/bot/createBot.test.ts
git commit -m "feat: add proof levels to where reports"
```

---

## Task 5: Split LLM Verdict Cache Into Static And Flow Context

**Purpose:** Prevent unsafe reuse of a `drainer_like` flow verdict for the same/static-similar contract in a legitimate service route.

**Files:**
- Modify: `src/forensics/contractLlmVerdict.ts`
- Modify: `src/storage/repositories.ts`
- Create: `migrations/021_contract_llm_verdict_cache_scopes.sql`
- Test: `tests/forensics/contractLlmVerdict.test.ts`
- Test: `tests/storage/repositories.test.ts`

- [ ] **Step 1: Add failing LLM cache tests**

In `tests/forensics/contractLlmVerdict.test.ts`, add:

```ts
it("does not reuse fingerprint flow verdict when flow context changes", async () => {
  const drainerFlow = buildContractAnalysisCaseFiles({
    subjectAddress: subject,
    currentUsdtBalanceRaw: "1100000000",
    balanceFormingTransfers: [balanceTransfer],
    originPaths: [originPath],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [reviewFinding],
    classifications: new Map([[wrapperContract, service("unknown_contract", null)]])
  })[0];

  const serviceFlow = {
    ...drainerFlow,
    approvalDrainReviewFindings: [],
    serviceClassification: service("router", "Known Router"),
    originPaths: drainerFlow.originPaths.map((path) => ({
      ...path,
      rootSourceType: "decline_boundary" as const,
      reasons: ["Clean source not proven after known router boundary."]
    }))
  };

  expect(hashContractFlowContextForLlm(drainerFlow)).not.toBe(hashContractFlowContextForLlm(serviceFlow));
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- tests/forensics/contractLlmVerdict.test.ts
```

Expected: FAIL because `hashContractFlowContextForLlm` does not exist/export.

- [ ] **Step 3: Add flow-context hash**

In `src/forensics/contractLlmVerdict.ts`, export:

```ts
export function hashContractFlowContextForLlm(caseFile: ContractAnalysisCaseFile): string {
  return stableHash({
    approvalEvidenceClass: caseFile.approvalDrainProvenanceProfiles.length > 0
      ? "provenance"
      : caseFile.approvalDrainReviewFindings.length > 0
        ? "review"
        : "none",
    transferFromObserved: caseFile.approvalDrainProvenanceProfiles.length > 0 ||
      caseFile.approvalDrainReviewFindings.length > 0,
    spenderResolution: [
      ...caseFile.approvalDrainProvenanceProfiles.map((profile) => profile.spenderResolution),
      ...caseFile.approvalDrainReviewFindings.map((finding) => finding.spenderResolution)
    ].sort(),
    serviceCategory: caseFile.serviceClassification?.category ?? "none",
    serviceIdentity: caseFile.serviceClassification?.identity ?? null,
    pathStoppedReasons: caseFile.originPaths.map((path) => path.stoppedReason).sort(),
    pathRootSourceTypes: caseFile.originPaths.map((path) => path.rootSourceType).sort()
  });
}
```

- [ ] **Step 4: Extend DB migration**

Create `migrations/021_contract_llm_verdict_cache_scopes.sql`:

```sql
alter table contract_llm_verdict_cache
  add column if not exists cache_scope text not null default 'address_flow',
  add column if not exists flow_context_hash text;

create index if not exists contract_llm_verdict_cache_flow_idx
  on contract_llm_verdict_cache(cache_scope, contract_fingerprint_hash, flow_context_hash, policy_version, model, updated_at desc);
```

- [ ] **Step 5: Update repository types and queries**

In `src/types.ts` or repository-local types, add `cacheScope` and `flowContextHash` to the cache record. In `src/storage/repositories.ts`, include:

```sql
cache_scope, flow_context_hash
```

in select/insert/update. Keep backward compatibility by defaulting missing rows to:

```ts
cacheScope: row.cache_scope ?? "address_flow",
flowContextHash: row.flow_context_hash ?? null
```

- [ ] **Step 6: Use flow hash for flow verdict cache**

In `createContractLlmVerdictAnalyzer`, include `flowContextHash` in the cache id:

```ts
const flowContextHash = hashContractFlowContextForLlm(caseFile);
const cacheId = stableHash([
  CONTRACT_LLM_VERDICT_POLICY_VERSION,
  contractAddress,
  profileHash,
  flowContextHash,
  cacheModelKey
]);
```

Fingerprint reuse should require matching `flowContextHash`.

- [ ] **Step 7: Run tests**

Run:

```powershell
npm test -- tests/forensics/contractLlmVerdict.test.ts tests/storage/repositories.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/forensics/contractLlmVerdict.ts src/storage/repositories.ts src/types.ts migrations/021_contract_llm_verdict_cache_scopes.sql tests/forensics/contractLlmVerdict.test.ts tests/storage/repositories.test.ts
git commit -m "feat: split contract llm flow cache"
```

---

## Task 6: NormalServiceRouteDetector

**Purpose:** Avoid false “drainer/scam proof” on normal DEX/bridge/router approvals while still allowing exchange-policy decline when clean source continuity stops.

**Files:**
- Create: `src/forensics/normalServiceRoute.ts`
- Modify: `src/forensics/approvalDrainProvenance.ts`
- Modify: `src/forensics/contractLlmVerdict.ts`
- Test: `tests/forensics/normalServiceRoute.test.ts`

- [ ] **Step 1: Write failing normal-service tests**

Create `tests/forensics/normalServiceRoute.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectNormalServiceRoute } from "../../src/forensics/normalServiceRoute";

describe("detectNormalServiceRoute", () => {
  it("guards known router approval with economic output", () => {
    expect(detectNormalServiceRoute({
      serviceCategory: "router",
      serviceIdentity: "SunSwap Router",
      verifiedContract: true,
      serviceTags: ["router", "swap"],
      pairedAssetOutputObserved: true,
      economicOutputToVictimObserved: true,
      swapOrBridgeMethodObserved: true,
      receiverIsPoolOrBridge: true,
      directUnknownCollectorReceiver: false
    })).toEqual({
      guarded: true,
      reason: "known service route with economic output"
    });
  });

  it("does not guard unknown contract with collector receiver", () => {
    expect(detectNormalServiceRoute({
      serviceCategory: "unknown_contract",
      serviceIdentity: null,
      verifiedContract: false,
      serviceTags: [],
      pairedAssetOutputObserved: false,
      economicOutputToVictimObserved: false,
      swapOrBridgeMethodObserved: false,
      receiverIsPoolOrBridge: false,
      directUnknownCollectorReceiver: true
    }).guarded).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- tests/forensics/normalServiceRoute.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement detector**

Create `src/forensics/normalServiceRoute.ts`:

```ts
import type { ServiceCategory } from "../types";

export type NormalServiceRouteEvidence = {
  serviceCategory: ServiceCategory;
  serviceIdentity: string | null;
  verifiedContract: boolean;
  serviceTags: string[];
  pairedAssetOutputObserved: boolean;
  economicOutputToVictimObserved: boolean;
  swapOrBridgeMethodObserved: boolean;
  receiverIsPoolOrBridge: boolean;
  directUnknownCollectorReceiver: boolean;
};

export type NormalServiceRouteResult = {
  guarded: boolean;
  reason: string;
};

export function detectNormalServiceRoute(input: NormalServiceRouteEvidence): NormalServiceRouteResult {
  const knownService = input.serviceCategory === "router" ||
    input.serviceCategory === "dex" ||
    input.serviceCategory === "bridge" ||
    input.serviceCategory === "bridge_pool" ||
    input.serviceCategory === "swap_adapter";
  const hasEconomicOutput = input.pairedAssetOutputObserved || input.economicOutputToVictimObserved;
  const hasServiceBehavior = input.swapOrBridgeMethodObserved || input.receiverIsPoolOrBridge;

  if (knownService && input.verifiedContract && hasEconomicOutput && hasServiceBehavior && !input.directUnknownCollectorReceiver) {
    return { guarded: true, reason: "known service route with economic output" };
  }

  return { guarded: false, reason: "normal service route not proven" };
}
```

- [ ] **Step 4: Wire guard into approval-drain provenance**

In `src/forensics/approvalDrainProvenance.ts`, before returning exact drainer proof, call `detectNormalServiceRoute` if service/classification evidence is available. If guarded:

```ts
falsePositiveGuards: ["service_route_guarded"]
```

and do not emit `proven_approval_drain_provenance`.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/forensics/normalServiceRoute.test.ts tests/forensics/approvalDrainProvenance.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/forensics/normalServiceRoute.ts src/forensics/approvalDrainProvenance.ts tests/forensics/normalServiceRoute.test.ts tests/forensics/approvalDrainProvenance.test.ts
git commit -m "feat: add normal service route guard"
```

---

## Task 7: Amount-Specific Where-Is-Money

**Purpose:** Exchange checks are about the amount the client wants to exchange, not always the full wallet balance.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/forensics/balanceFormingTransfers.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `scripts/forensicWhereIsMoney.ts`
- Test: `tests/forensics/balanceFormingTransfers.test.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Add failing selector test**

In `tests/forensics/balanceFormingTransfers.test.ts`, add:

```ts
it("selects only enough newest inbound transfers to cover requested amount", () => {
  const selection = selectBalanceFormingTransfers({
    currentBalanceRaw: "5000000000",
    requestedAmountRaw: "1000000000",
    transfers: [
      inbound("tx-new", "700000000", "2026-05-28T10:00:00.000Z"),
      inbound("tx-old", "700000000", "2026-05-28T09:00:00.000Z"),
      inbound("tx-older", "4000000000", "2026-05-27T09:00:00.000Z")
    ]
  });

  expect(selection.targetAmountRaw).toBe("1000000000");
  expect(selection.transfers.map((tx) => tx.txHash)).toEqual(["tx-new", "tx-old"]);
  expect(selection.coverageRatio).toBeGreaterThanOrEqual(1);
});
```

Use or create local fixture helper:

```ts
function inbound(txHash: string, amountRaw: string, timestamp: string) {
  return { txHash, fromAddress: `TFrom${txHash}`, toAddress: "TSubject", amountRaw, timestamp };
}
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- tests/forensics/balanceFormingTransfers.test.ts
```

Expected: FAIL because selector does not accept `requestedAmountRaw`.

- [ ] **Step 3: Extend input/output types**

In `src/types.ts`:

```ts
export type BalanceFormingSelection = {
  transfers: BalanceFormingTransfer[];
  currentBalanceRaw: string;
  requestedAmountRaw?: string | null;
  targetAmountRaw: string;
  selectedAmountRaw: string;
  coverageRatio: number;
  partial: boolean;
  selectionMethod: "reverse_balance_cover" | "single_tx_seed";
};
```

- [ ] **Step 4: Update selector**

In `src/forensics/balanceFormingTransfers.ts`, calculate:

```ts
const targetAmountRaw = input.requestedAmountRaw && BigInt(input.requestedAmountRaw) > 0n
  ? input.requestedAmountRaw
  : input.currentBalanceRaw;
```

Then select newest inbound transfers until `selectedAmountRaw >= targetAmountRaw`.

- [ ] **Step 5: Wire CLI and bot**

Add optional amount parsing:

```text
/check <address> <amount_usdt_optional>
```

Convert user amount to USDT micro-units before passing `requestedAmountRaw`.

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test -- tests/forensics/balanceFormingTransfers.test.ts tests/check/whereIsMoneyCheck.test.ts tests/bot/createBot.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/types.ts src/forensics/balanceFormingTransfers.ts src/check/whereIsMoneyCheck.ts src/bot/createBot.ts scripts/forensicWhereIsMoney.ts tests/forensics/balanceFormingTransfers.test.ts tests/check/whereIsMoneyCheck.test.ts tests/bot/createBot.test.ts
git commit -m "feat: support amount-specific money origin checks"
```

---

## Task 8: Transaction Check Reuses Where-Is-Money Core

**Purpose:** A transaction check is just where-is-money seeded by one inbound transfer. It must not duplicate scoring.

**Files:**
- Create: `src/forensics/transactionOriginCheck.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `src/bot/createBot.ts`
- Test: `tests/forensics/transactionOriginCheck.test.ts`

- [ ] **Step 1: Write failing transaction wrapper test**

Create `tests/forensics/transactionOriginCheck.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runTransactionOriginCheck } from "../../src/forensics/transactionOriginCheck";

describe("runTransactionOriginCheck", () => {
  it("calls where-is-money core with the transaction as the only seed transfer", async () => {
    const runWhereCore = vi.fn(async () => ({ decision: "ACCEPTABLE", riskScore: 5 }));

    await runTransactionOriginCheck({
      txHash: "tx-1",
      loadTransfer: async () => ({
        txHash: "tx-1",
        fromAddress: "TSender",
        toAddress: "TSubject",
        amountRaw: "1000000000",
        timestamp: "2026-05-28T10:00:00.000Z"
      }),
      runWhereCore
    });

    expect(runWhereCore).toHaveBeenCalledWith(expect.objectContaining({
      mode: "transaction_check",
      subjectAddress: "TSubject",
      requestedAmountRaw: "1000000000",
      seedTransfers: [expect.objectContaining({ txHash: "tx-1" })]
    }));
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- tests/forensics/transactionOriginCheck.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement wrapper**

Create `src/forensics/transactionOriginCheck.ts`:

```ts
import type { BalanceFormingTransfer } from "../types";

type TransferSeed = Omit<BalanceFormingTransfer, "coverageShare" | "selectedReason">;

export async function runTransactionOriginCheck<TReport>(input: {
  txHash: string;
  loadTransfer(txHash: string): Promise<TransferSeed>;
  runWhereCore(args: {
    mode: "transaction_check";
    subjectAddress: string;
    requestedAmountRaw: string;
    seedTransfers: BalanceFormingTransfer[];
  }): Promise<TReport>;
}): Promise<TReport> {
  const tx = await input.loadTransfer(input.txHash);
  return input.runWhereCore({
    mode: "transaction_check",
    subjectAddress: tx.toAddress,
    requestedAmountRaw: tx.amountRaw,
    seedTransfers: [{
      ...tx,
      coverageShare: 1,
      selectedReason: "covers_current_balance"
    }]
  });
}
```

- [ ] **Step 4: Wire bot `/tx` path gradually**

In `src/bot/createBot.ts`, route transaction checks through `runTransactionOriginCheck`. Keep existing command text unless tests require update.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/forensics/transactionOriginCheck.test.ts tests/bot/createBot.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/forensics/transactionOriginCheck.ts src/bot/createBot.ts tests/forensics/transactionOriginCheck.test.ts tests/bot/createBot.test.ts
git commit -m "feat: reuse money origin core for tx checks"
```

---

## Task 9: Approval Monitoring State Machine

**Purpose:** Approval monitor must distinguish approval-only, transferFrom observed, service-route guarded, route-linked, and exact approval-drain provenance.

**Files:**
- Create: `src/approvals/approvalStateMachine.ts`
- Modify: `src/approvals/approvalWorker.ts`
- Modify: `src/approvals/drainObservation.ts`
- Test: `tests/approvals/approvalStateMachine.test.ts`
- Test: `tests/approvals/approvalWorker.test.ts`

- [ ] **Step 1: Write failing state-machine tests**

Create `tests/approvals/approvalStateMachine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextApprovalState } from "../../src/approvals/approvalStateMachine";

describe("approval state machine", () => {
  it("keeps approval-only unknown spender below exact proof", () => {
    expect(nextApprovalState({
      current: "none",
      approvalObserved: true,
      transferFromObserved: false,
      serviceRouteGuarded: false,
      pathToCheckedWallet: false
    })).toBe("approval_only");
  });

  it("guards known service route after transferFrom", () => {
    expect(nextApprovalState({
      current: "approval_only",
      approvalObserved: true,
      transferFromObserved: true,
      serviceRouteGuarded: true,
      pathToCheckedWallet: false
    })).toBe("service_route_guarded");
  });

  it("promotes matching path to exact provenance only without service boundary", () => {
    expect(nextApprovalState({
      current: "transfer_from_observed",
      approvalObserved: true,
      transferFromObserved: true,
      serviceRouteGuarded: false,
      pathToCheckedWallet: true
    })).toBe("proven_approval_drain_provenance");
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- tests/approvals/approvalStateMachine.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement state machine**

Create `src/approvals/approvalStateMachine.ts`:

```ts
export type ApprovalMonitoringState =
  | "none"
  | "approval_only"
  | "transfer_from_observed"
  | "service_route_guarded"
  | "route_linked"
  | "proven_approval_drain_provenance";

export function nextApprovalState(input: {
  current: ApprovalMonitoringState;
  approvalObserved: boolean;
  transferFromObserved: boolean;
  serviceRouteGuarded: boolean;
  pathToCheckedWallet: boolean;
}): ApprovalMonitoringState {
  if (!input.approvalObserved) return "none";
  if (!input.transferFromObserved) return "approval_only";
  if (input.serviceRouteGuarded) return "service_route_guarded";
  if (input.pathToCheckedWallet) return "proven_approval_drain_provenance";
  return "transfer_from_observed";
}
```

- [ ] **Step 4: Wire into approval worker**

In `src/approvals/approvalWorker.ts`, replace direct risk wording with state transition output. Keep existing storage writes unchanged unless a migration is necessary.

- [ ] **Step 5: Run approval tests**

Run:

```powershell
npm test -- tests/approvals/approvalStateMachine.test.ts tests/approvals/approvalWorker.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/approvals/approvalStateMachine.ts src/approvals/approvalWorker.ts src/approvals/drainObservation.ts tests/approvals/approvalStateMachine.test.ts tests/approvals/approvalWorker.test.ts
git commit -m "feat: add approval monitoring state machine"
```

---

## Task 10: Telegram UX For Proof Types

**Purpose:** Novice users see only `ACCEPTABLE` or `DECLINE`; internal uncertainty is explained as policy/coverage, not exposed as `REVIEW`.

**Files:**
- Modify: `src/bot/createBot.ts`
- Modify: message formatting helpers if present.
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add failing Telegram output test**

In `tests/bot/createBot.test.ts`, add:

```ts
it("formats policy decline without claiming scam proof", async () => {
  const text = formatWhereIsMoneyResultForTest({
    decision: "DECLINE",
    userDecision: "DECLINE",
    internalDecision: "DECLINE",
    proofLevel: "exchange_policy_decline",
    riskScore: 65,
    decisionReasons: [
      "Clean source is not proven after unknown contract boundary."
    ],
    contractLlmVerdicts: []
  });

  expect(text).toContain("Decision: DECLINE");
  expect(text).toContain("Evidence type: Exchange-policy decline");
  expect(text).toContain("not direct scam proof");
  expect(text).not.toContain("REVIEW");
});
```

If there is no `formatWhereIsMoneyResultForTest`, expose the existing formatter as a named function from the bot message module or test through the existing job-result handler.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected: FAIL until formatter includes proof-type wording.

- [ ] **Step 3: Update formatter**

Where where-is-money messages are built:

```ts
const proofTitle = proofLevelTitle(report.proofLevel);
lines.push(`Evidence type: ${proofTitle}`);
if (report.proofLevel === "exchange_policy_decline") {
  lines.push("This is an exchange-policy decline, not direct scam proof.");
}
if (report.proofLevel === "llm_assisted_suspicion") {
  lines.push("AI verdict is advisory; final exchange decision is policy-owned.");
}
```

- [ ] **Step 4: Run bot tests**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: clarify proof types in bot output"
```

---

## Task 11: Regression Corpus

**Purpose:** Lock the architecture against the exact false positives and policy mistakes we already discussed.

**Files:**
- Create: `tests/fixtures/forensics/regressionCases.ts`
- Test: `tests/check/forensicRegressionCases.test.ts`

- [ ] **Step 1: Create regression fixture file**

Create `tests/fixtures/forensics/regressionCases.ts`:

```ts
export const regressionCases = [
  {
    name: "Binance through clean EOA is acceptable",
    expectedDecision: "ACCEPTABLE",
    expectedProofLevel: "clean_source_proven"
  },
  {
    name: "HTX through clean EOA is high policy decline",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  },
  {
    name: "WhiteBIT small share is medium policy decline",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  },
  {
    name: "Unknown contract boundary is policy decline not scam proof",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  },
  {
    name: "Known DEX router approval with output is guarded, not drainer proof",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  },
  {
    name: "Wrapper transferFrom path to checked wallet is exact approval-drain decline",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exact_approval_drain_provenance"
  },
  {
    name: "LLM timeout on uncertain contract is user decline with no cache",
    expectedDecision: "DECLINE",
    expectedProofLevel: "insufficient_coverage"
  },
  {
    name: "Fingerprint clone with different flow does not reuse drainer verdict",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  }
] as const;
```

- [ ] **Step 2: Add test that every fixture is implemented**

Create `tests/check/forensicRegressionCases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { regressionCases } from "../fixtures/forensics/regressionCases";

describe("forensic regression corpus", () => {
  it("contains the minimum architecture regression cases", () => {
    expect(regressionCases.map((item) => item.name)).toEqual([
      "Binance through clean EOA is acceptable",
      "HTX through clean EOA is high policy decline",
      "WhiteBIT small share is medium policy decline",
      "Unknown contract boundary is policy decline not scam proof",
      "Known DEX router approval with output is guarded, not drainer proof",
      "Wrapper transferFrom path to checked wallet is exact approval-drain decline",
      "LLM timeout on uncertain contract is user decline with no cache",
      "Fingerprint clone with different flow does not reuse drainer verdict"
    ]);
  });
});
```

- [ ] **Step 3: Run tests**

Run:

```powershell
npm test -- tests/check/forensicRegressionCases.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Gradually wire real scenario tests**

For each fixture, add one real test to `tests/check/whereIsMoneyCheck.test.ts`, `tests/forensics/approvalDrainProvenance.test.ts`, or `tests/forensics/contractLlmVerdict.test.ts`. Each real test must assert:

```ts
expect(report.userDecision).toBe(caseItem.expectedDecision);
expect(report.proofLevel).toBe(caseItem.expectedProofLevel);
```

- [ ] **Step 5: Commit**

```powershell
git add tests/fixtures/forensics/regressionCases.ts tests/check/forensicRegressionCases.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/approvalDrainProvenance.test.ts tests/forensics/contractLlmVerdict.test.ts
git commit -m "test: add forensic regression corpus"
```

---

## Task 12: Final Integration Check

**Purpose:** Verify the architecture holds end-to-end after all phases.

**Files:**
- Modify only if tests expose issues.

- [ ] **Step 1: Run full typecheck**

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Run CLI smoke for known wallet**

Run the current where-is-money CLI command for:

```text
TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf
```

Expected:

```text
Decision: DECLINE
Evidence type: Exchange-policy decline or AI-assisted suspicion
WhiteBIT shown as policy exposure, not scam proof
AI contract verdict shown as advisory if present
```

- [ ] **Step 4: Run Telegram smoke**

Use `/check TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf`.

Expected:

```text
Fast result appears first.
Where-is-money result appears after.
No final REVIEW is shown.
Decision is ACCEPTABLE or DECLINE.
Evidence type is visible.
```

- [ ] **Step 5: Commit any final fixes**

```powershell
git status --short
git add <only files changed by final fixes>
git commit -m "fix: harden forensic decision integration"
```

Skip this commit if there are no final fixes.

---

## Execution Order And Gates

Use this order:

1. Task 1 — proof taxonomy.
2. Task 2 — case file foundation.
3. Task 3 — policy engine.
4. Task 4 — where report proof fields.
5. Task 5 — LLM cache split.
6. Task 6 — normal service route guard.
7. Task 7 — requested amount.
8. Task 8 — transaction check wrapper.
9. Task 9 — approval state machine.
10. Task 10 — Telegram proof UX.
11. Task 11 — regression corpus.
12. Task 12 — final integration check.

Hard gates:

- Do not start Task 5 until Task 4 passes; LLM cache output should already have proof-level context.
- Do not start Task 7 until Task 3 or Task 4 exists; amount-specific checks need policy wording.
- Do not expose new Telegram wording until tests prove `REVIEW` is not user-facing.
- Do not claim exact scam/drainer proof unless exact deterministic evidence exists.

---

## Self-Review

Spec coverage:

- Evidence-first architecture: Tasks 1, 2, 3.
- `RiskCaseFile`: Task 2.
- Deterministic proof vs LLM suspicion: Tasks 1, 3, 5, 10.
- DEX/bridge/router false-positive guard: Task 6.
- WhiteBIT medium policy exposure: Tasks 3, 4, 11.
- Static vs flow LLM cache: Task 5.
- Approval monitor v2: Task 9.
- Where-is-money requested amount: Task 7.
- Transaction check as where specialization: Task 8.
- Telegram novice UX: Task 10.
- Regression fixtures: Task 11.

Placeholder scan:

- No `TBD`, `TODO`, or unspecified “add tests” steps remain.
- Each code task includes exact files, test command, and expected result.

Type consistency:

- `ProofLevel`, `UserExchangeDecision`, `PolicyReason`, and `RiskCaseFile` are introduced before dependent tasks use them.
- `RiskPolicyEngine` returns `internalDecision`, `userDecision`, `proofLevel`, and `riskScore`, matching later report wiring.

