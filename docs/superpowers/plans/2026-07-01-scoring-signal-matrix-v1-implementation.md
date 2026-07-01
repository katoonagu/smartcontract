# Scoring Signal Matrix v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Scoring Signal Matrix v1 as the production wallet and incoming-deposit scoring layer while preserving existing evidence collectors.

**Architecture:** Add a pure matrix scorer that accepts normalized candidates, then add a thin mapper from current fast/deep/where/incoming reports into those candidates. Integrate the matrix result into `calculateUnifiedWalletRisk` and `calculateUnifiedIncomingDepositRisk` without rewriting the forensic collectors. Keep `queuePriorityScore` and `calibratedRiskProbability` null until a separate temporal backtest proves calibration.

**Tech Stack:** TypeScript, Vitest, existing risk report types, existing unified wallet/incoming scoring modules, existing forensic job audit helpers.

---

## Source Spec

Use this spec as the source of truth:

```text
docs/superpowers/specs/2026-07-01-scoring-signal-matrix-v1-design.md
```

The plan implements the spec's core contract:

```text
atomic signal -> evidence row -> score band -> in-band modifiers -> caps -> decision
```

## Scope Check

This is one connected subsystem: scoring aggregation. It should not change collectors, provider fetching, graph expansion, label ingestion, or contract analysis.

Out of scope for this plan:

- Training a probability model.
- Adding a new database table.
- Adding a queue ranking model.
- Rewriting Deep Research, Where Is Money, or Incoming Deposit provenance collection.
- Changing provider budgets.

## File Map

Create:

```text
src/risk/scoringSignalMatrix.ts
src/risk/scoringSignalMatrixInputs.ts
tests/risk/scoringSignalMatrix.test.ts
tests/risk/scoringSignalMatrixInputs.test.ts
```

Modify:

```text
src/risk/unifiedWalletRisk.ts
src/risk/unifiedIncomingDepositRisk.ts
src/risk/scoringAudit.ts
src/risk/shadowScoring.ts
tests/risk/unifiedWalletRisk.test.ts
tests/risk/shadowScoring.test.ts
tests/risk/scoringAudit.test.ts
src/bot/createBot.ts
src/forensics/incomingDepositJob.ts
tests/forensics/incomingDepositJob.test.ts
```

Do not modify:

```text
src/check/deepForensicCheck.ts
src/forensics/flowCounterpartyProfile.ts
src/forensics/historicalTransitScore.ts
src/risk/riskEngine.ts
```

Reason: those files collect or compute existing evidence. Matrix v1 should consume that evidence, not change how it is collected.

---

### Task 1: Add Pure Matrix Scorer

**Files:**
- Create: `src/risk/scoringSignalMatrix.ts`
- Create: `tests/risk/scoringSignalMatrix.test.ts`

- [ ] **Step 1: Write failing matrix scorer tests**

Create `tests/risk/scoringSignalMatrix.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  scoreMatrixCandidates,
  type MatrixActionUnit,
  type MatrixCandidate,
  type MatrixEvidenceRow
} from "../../src/risk/scoringSignalMatrix";

function candidate(overrides: Partial<MatrixCandidate> = {}): MatrixCandidate {
  return {
    row: "behavior_only_prior",
    actionUnit: "wallet",
    score: 50,
    decisionEligibility: "review_only",
    evidenceIds: ["evidence:1"],
    evidenceEpisodeIds: ["episode:1"],
    atomicSignals: ["address_behavior_fast_post_deposit_exit"],
    modifiers: [],
    caps: [],
    dampeners: [],
    caveats: [],
    ...overrides
  };
}

function scored(row: MatrixEvidenceRow, score: number, actionUnit: MatrixActionUnit = "wallet"): MatrixCandidate {
  return candidate({
    row,
    actionUnit,
    score,
    decisionEligibility: score >= 60 ? "can_decline" : "review_only",
    evidenceIds: [`${row}:evidence`],
    evidenceEpisodeIds: [`${row}:episode`],
    atomicSignals: [row]
  });
}

describe("scoreMatrixCandidates", () => {
  it("hard proof wins and emits null calibration products", () => {
    const result = scoreMatrixCandidates([
      scored("clean_or_operational", 5),
      scored("hard_proof", 95)
    ]);

    expect(result).toMatchObject({
      policyVersion: "scoring-signal-matrix-v1",
      policyScore: 95,
      matrixDecision: "DECLINE",
      winningRow: "hard_proof",
      actionUnit: "wallet",
      queuePriorityScore: null,
      calibratedRiskProbability: null
    });
  });

  it("does not let coverage uncertainty create badness", () => {
    const result = scoreMatrixCandidates([
      candidate({
        row: "coverage_uncertainty",
        score: 65,
        decisionEligibility: "insufficient_only",
        atomicSignals: ["insufficient_coverage"],
        evidenceIds: ["coverage:limited"],
        evidenceEpisodeIds: ["coverage:limited"]
      })
    ]);

    expect(result.policyScore).toBeNull();
    expect(result.matrixDecision).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.winningRow).toBe("coverage_uncertainty");
    expect(result.uncertaintyState.coverage).toBe("insufficient");
  });

  it("caps behavior-only evidence below decline threshold", () => {
    const result = scoreMatrixCandidates([
      candidate({
        row: "behavior_only_prior",
        score: 82,
        decisionEligibility: "can_decline",
        atomicSignals: ["address_behavior_high_volume_transit"]
      })
    ]);

    expect(result.policyScore).toBe(59);
    expect(result.matrixDecision).toBe("REVIEW");
    expect(result.riskVector.behavior_only_prior?.[0].caps).toContain("behavior_only_cap_59");
  });

  it("caps typology-only evidence below 60 without an anchor", () => {
    const result = scoreMatrixCandidates([
      candidate({
        row: "typology_subgraph_pattern",
        score: 72,
        decisionEligibility: "can_decline",
        atomicSignals: ["split_merge_service_exit"]
      })
    ]);

    expect(result.policyScore).toBe(59);
    expect(result.matrixDecision).toBe("REVIEW");
    expect(result.riskVector.typology_subgraph_pattern?.[0].caps).toContain("typology_without_anchor_cap_59");
  });

  it("allows anchored typology to remain above 60 but keeps review eligibility when not auto-declinable", () => {
    const result = scoreMatrixCandidates([
      candidate({
        row: "typology_subgraph_pattern",
        score: 72,
        decisionEligibility: "review_only",
        atomicSignals: ["fast_cashout_to_legitimate_service"],
        modifiers: ["service_anchor"]
      })
    ]);

    expect(result.policyScore).toBe(72);
    expect(result.matrixDecision).toBe("REVIEW");
  });

  it("deduplicates multiple candidates from the same evidence episode", () => {
    const result = scoreMatrixCandidates([
      candidate({
        row: "behavior_only_prior",
        score: 58,
        evidenceIds: ["tx:a", "tx:a:behavior"],
        evidenceEpisodeIds: ["episode:a"],
        atomicSignals: ["address_behavior_fast_post_deposit_exit"]
      }),
      candidate({
        row: "counterparty_context",
        score: 45,
        evidenceIds: ["tx:a:counterparty"],
        evidenceEpisodeIds: ["episode:a"],
        atomicSignals: ["counterparty_behavior_context"]
      })
    ]);

    expect(result.policyScore).toBe(58);
    expect(result.riskVector.behavior_only_prior).toHaveLength(1);
    expect(result.riskVector.counterparty_context ?? []).toHaveLength(0);
  });

  it("treats clean operational evidence as acceptable when no stronger row exists", () => {
    const result = scoreMatrixCandidates([
      candidate({
        row: "clean_or_operational",
        score: 7,
        decisionEligibility: "acceptable_only",
        atomicSignals: ["clean_cex_source"],
        evidenceIds: ["source:clean"],
        evidenceEpisodeIds: ["source:clean"]
      })
    ]);

    expect(result.policyScore).toBe(7);
    expect(result.matrixDecision).toBe("ACCEPTABLE");
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```powershell
npm test -- tests/risk/scoringSignalMatrix.test.ts
```

Expected: fail because `src/risk/scoringSignalMatrix.ts` does not exist.

- [ ] **Step 3: Implement the matrix scorer**

Create `src/risk/scoringSignalMatrix.ts`:

```ts
export type MatrixDecision =
  | "ACCEPTABLE"
  | "REVIEW"
  | "DECLINE"
  | "INSUFFICIENT_EVIDENCE";

export type MatrixEvidenceRow =
  | "hard_proof"
  | "source_policy"
  | "incoming_deposit_source_policy"
  | "service_linked_pattern"
  | "route_linked_approval_pattern"
  | "asset_continuation"
  | "typology_subgraph_pattern"
  | "contract_suspicion"
  | "counterparty_context"
  | "behavior_only_prior"
  | "coverage_uncertainty"
  | "clean_or_operational";

export type MatrixActionUnit =
  | "wallet"
  | "incoming_deposit"
  | "source_path"
  | "transaction"
  | "actor_cluster"
  | "subgraph_typology";

export type MatrixDecisionEligibility =
  | "can_decline"
  | "review_only"
  | "insufficient_only"
  | "acceptable_only";

export type MatrixCandidate = {
  row: MatrixEvidenceRow;
  actionUnit: MatrixActionUnit;
  score: number;
  decisionEligibility: MatrixDecisionEligibility;
  evidenceIds: string[];
  evidenceEpisodeIds: string[];
  atomicSignals: string[];
  modifiers: string[];
  caps: string[];
  dampeners: string[];
  caveats: string[];
};

export type MatrixUncertaintyState = {
  coverage: "sufficient" | "partial" | "insufficient";
  continuity: "strong" | "medium" | "weak" | "unknown";
  provider: "complete" | "partial" | "unknown";
  staleData: boolean;
  caveats: string[];
};

export type MatrixRiskVector = Partial<Record<MatrixEvidenceRow, MatrixCandidate[]>>;

export type MatrixScoringResult = {
  policyVersion: "scoring-signal-matrix-v1";
  policyScore: number | null;
  matrixDecision: MatrixDecision;
  winningRow: MatrixEvidenceRow;
  actionUnit: MatrixActionUnit;
  riskVector: MatrixRiskVector;
  uncertaintyState: MatrixUncertaintyState;
  queuePriorityScore: null;
  calibratedRiskProbability: null;
};

const rowPriority: MatrixEvidenceRow[] = [
  "hard_proof",
  "source_policy",
  "incoming_deposit_source_policy",
  "route_linked_approval_pattern",
  "asset_continuation",
  "service_linked_pattern",
  "typology_subgraph_pattern",
  "contract_suspicion",
  "counterparty_context",
  "behavior_only_prior",
  "clean_or_operational",
  "coverage_uncertainty"
];

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasAnchor(candidate: MatrixCandidate): boolean {
  return candidate.modifiers.includes("hard_anchor") ||
    candidate.modifiers.includes("source_policy_anchor") ||
    candidate.modifiers.includes("service_anchor");
}

function withCap(candidate: MatrixCandidate, score: number, cap: string): MatrixCandidate {
  return {
    ...candidate,
    score,
    caps: candidate.caps.includes(cap) ? candidate.caps : [...candidate.caps, cap]
  };
}

function applyRowCaps(candidate: MatrixCandidate): MatrixCandidate {
  const score = clampScore(candidate.score);
  if (candidate.row === "coverage_uncertainty") {
    return withCap(candidate, 0, "coverage_uncertainty_no_badness");
  }
  if (candidate.row === "behavior_only_prior" && score >= 60) {
    return withCap(candidate, 59, "behavior_only_cap_59");
  }
  if (candidate.row === "contract_suspicion" && score >= 60) {
    return withCap(candidate, 59, "contract_suspicion_cap_59");
  }
  if (candidate.row === "typology_subgraph_pattern" && !hasAnchor(candidate) && score >= 60) {
    return withCap(candidate, 59, "typology_without_anchor_cap_59");
  }
  return { ...candidate, score };
}

function episodeKey(candidate: MatrixCandidate): string {
  if (candidate.evidenceEpisodeIds.length > 0) return candidate.evidenceEpisodeIds.sort().join("|");
  return candidate.evidenceIds.sort().join("|");
}

function betterCandidate(left: MatrixCandidate, right: MatrixCandidate): MatrixCandidate {
  if (left.score !== right.score) return left.score > right.score ? left : right;
  return rowPriority.indexOf(left.row) <= rowPriority.indexOf(right.row) ? left : right;
}

function dedupeByEpisode(candidates: MatrixCandidate[]): MatrixCandidate[] {
  const byEpisode = new Map<string, MatrixCandidate>();
  for (const candidate of candidates) {
    const key = episodeKey(candidate);
    const existing = byEpisode.get(key);
    byEpisode.set(key, existing ? betterCandidate(existing, candidate) : candidate);
  }
  return [...byEpisode.values()];
}

function buildRiskVector(candidates: MatrixCandidate[]): MatrixRiskVector {
  const vector: MatrixRiskVector = {};
  for (const candidate of candidates) {
    vector[candidate.row] = [...(vector[candidate.row] ?? []), candidate];
  }
  return vector;
}

function candidateDecision(candidate: MatrixCandidate): MatrixDecision {
  if (candidate.decisionEligibility === "insufficient_only") return "INSUFFICIENT_EVIDENCE";
  if (candidate.decisionEligibility === "acceptable_only") return "ACCEPTABLE";
  if (candidate.score >= 60 && candidate.decisionEligibility === "can_decline") return "DECLINE";
  if (candidate.score >= 30) return "REVIEW";
  return "ACCEPTABLE";
}

function winningCandidate(candidates: MatrixCandidate[]): MatrixCandidate {
  const sorted = [...candidates].sort((left, right) => {
    const scoreDelta = right.score - left.score;
    if (scoreDelta !== 0) return scoreDelta;
    return rowPriority.indexOf(left.row) - rowPriority.indexOf(right.row);
  });
  return sorted[0] ?? {
    row: "coverage_uncertainty",
    actionUnit: "wallet",
    score: 0,
    decisionEligibility: "insufficient_only",
    evidenceIds: [],
    evidenceEpisodeIds: [],
    atomicSignals: [],
    modifiers: [],
    caps: ["no_candidates"],
    dampeners: [],
    caveats: ["No matrix candidates were produced."]
  };
}

function uncertaintyState(candidates: MatrixCandidate[]): MatrixUncertaintyState {
  const coverageCandidate = candidates.find((candidate) => candidate.row === "coverage_uncertainty");
  return {
    coverage: coverageCandidate ? "insufficient" : "sufficient",
    continuity: "unknown",
    provider: coverageCandidate ? "partial" : "complete",
    staleData: false,
    caveats: candidates.flatMap((candidate) => candidate.caveats)
  };
}

export function scoreMatrixCandidates(input: MatrixCandidate[]): MatrixScoringResult {
  const capped = input.map(applyRowCaps);
  const deduped = dedupeByEpisode(capped);
  const riskVector = buildRiskVector(deduped);
  const winner = winningCandidate(deduped);
  const matrixDecision = candidateDecision(winner);
  const policyScore = winner.row === "coverage_uncertainty" ? null : winner.score;

  return {
    policyVersion: "scoring-signal-matrix-v1",
    policyScore,
    matrixDecision,
    winningRow: winner.row,
    actionUnit: winner.actionUnit,
    riskVector,
    uncertaintyState: uncertaintyState(deduped),
    queuePriorityScore: null,
    calibratedRiskProbability: null
  };
}
```

- [ ] **Step 4: Run the matrix scorer tests**

Run:

```powershell
npm test -- tests/risk/scoringSignalMatrix.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/risk/scoringSignalMatrix.ts tests/risk/scoringSignalMatrix.test.ts
git commit -m "feat: add scoring signal matrix core"
```

---

### Task 2: Map Existing Evidence Into Matrix Candidates

**Files:**
- Create: `src/risk/scoringSignalMatrixInputs.ts`
- Create: `tests/risk/scoringSignalMatrixInputs.test.ts`

- [ ] **Step 1: Write failing mapper tests**

Create `tests/risk/scoringSignalMatrixInputs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildIncomingDepositMatrixCandidates, buildWalletMatrixCandidates } from "../../src/risk/scoringSignalMatrixInputs";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import type { IncomingFreshBundleExposure, RiskReport, WhereIsMoneyReport } from "../../src/types";

const address = `T${"1".repeat(33)}`;

function fastReport(score: number, code = "address_behavior_fast_post_deposit_exit"): RiskReport {
  return {
    subjectAddress: address,
    level: score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW",
    score,
    reasons: [{ code, message: code, scoreImpact: score }]
  };
}

function deepReport(overrides: Partial<DeepAddressForensicReport> = {}): DeepAddressForensicReport {
  return {
    subjectAddress: address,
    windowStart: new Date("2026-04-24T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z"),
    runProfile: "production_full",
    providerBudget: {
      providerCallBudget: null,
      transferCallBudget: null,
      contractCallBudget: null,
      approvalCallBudget: null,
      elapsedTimeBudgetMs: null,
      exhausted: false
    },
    rawEvidence: [],
    observations: [],
    missingChecks: [],
    serviceExposureProfiles: [],
    addressBehaviorProfiles: [],
    inboundProvenanceProfiles: [],
    counterpartyRiskProfiles: [],
    approvalDrainProvenanceProfiles: [],
    boundaryExposureProfiles: [],
    walletRoleProfiles: [],
    extendedProvenanceProfiles: [],
    directCounterpartyInteractionProfiles: [],
    operationalFlowProfiles: [],
    assetContinuationProfiles: [],
    stablecoinRestrictionProfiles: [],
    coverage: {
      sourceTransferPages: 2,
      inboundSendersExpanded: 5,
      transferEdges: 100,
      extendedIndexedEdges: 100,
      extendedFetchedAddresses: 60,
      apiKeyConfigured: true
    },
    ...overrides
  };
}

function whereReport(overrides: Partial<WhereIsMoneyReport> = {}): WhereIsMoneyReport {
  const assessment = {
    decision: "ACCEPTABLE" as const,
    riskScore: 0,
    riskBand: "LOW" as const,
    provenanceConfidence: 100,
    coverageCompleteness: 100,
    walletRole: "unknown_wallet" as const,
    operationalLiquidityScore: 0,
    ageSignals: null,
    hardBadEvidence: [],
    sourcePolicyEvidence: [],
    contractSuspicionEvidence: [],
    unknownOriginEvidence: [],
    riskLayers: [],
    dominantRiskLayer: null,
    reasons: [],
    warnings: []
  };
  return {
    subjectAddress: address,
    currentUsdtBalanceRaw: "0",
    fastWalletRisk: null,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    assessment,
    decision: "ACCEPTABLE",
    userDecision: "ACCEPTABLE",
    internalDecision: "ACCEPTABLE",
    proofLevel: "clean_source_proven",
    riskScore: 0,
    decisionReasons: [],
    coverage: {
      selectedInboundTxCount: 0,
      selectedInboundVolumeRaw: "0",
      currentBalanceCoverageRatio: 1,
      coverageRatio: 1,
      checkedScope: "current_balance",
      maxDepth: 20,
      fetchedAddressCount: 10,
      partial: false,
      notes: []
    },
    ...overrides
  };
}

describe("scoring signal matrix input mappers", () => {
  it("maps Where source-policy evidence to a source-policy candidate", () => {
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: null,
      deepReport: null,
      whereReport: whereReport({
        assessment: {
          ...whereReport().assessment,
          sourcePolicyEvidence: [{
            kind: "htx_huobi",
            aggregateShare: 0.72,
            effectiveShare: 0.72,
            pathCount: 2,
            score: 80,
            riskBand: "HIGH",
            proofLevel: "exchange_policy_decline",
            canBeDampened: false,
            reasons: ["HTX/Huobi funds material source share."],
            warnings: [],
            evidenceIds: ["source-policy:htx"]
          }]
        }
      })
    });

    expect(candidates).toContainEqual(expect.objectContaining({
      row: "source_policy",
      actionUnit: "source_path",
      score: 80,
      decisionEligibility: "can_decline",
      evidenceIds: ["source-policy:htx"],
      evidenceEpisodeIds: ["source-policy:htx"]
    }));
  });

  it("maps limited coverage to uncertainty without badness authority", () => {
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: null,
      deepReport: deepReport({ coverage: { transferEdges: 0 } as DeepAddressForensicReport["coverage"] }),
      whereReport: whereReport({
        coverage: {
          ...whereReport().coverage,
          partial: true,
          fetchedAddressCount: 1,
          notes: ["provider limit"]
        }
      })
    });

    expect(candidates).toContainEqual(expect.objectContaining({
      row: "coverage_uncertainty",
      decisionEligibility: "insufficient_only",
      atomicSignals: expect.arrayContaining(["insufficient_coverage"])
    }));
  });

  it("maps incoming fresh HTX/Huobi exposure to deposit-scoped source policy", () => {
    const exposure: IncomingFreshBundleExposure = {
      htxHuobiShare: 0.72,
      cleanCexShare: 0,
      bridgeRouterDexShare: 0,
      unknownContractShare: 0,
      riskyLabelShare: 0,
      unknownShare: 0.28
    };

    const candidates = buildIncomingDepositMatrixCandidates({
      senderAddress: "TSender1111111111111111111111111111",
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash: "tx-incoming",
      freshBundleExposure: exposure,
      baseCandidates: []
    });

    expect(candidates).toContainEqual(expect.objectContaining({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 85,
      decisionEligibility: "can_decline",
      atomicSignals: ["incoming_fresh_htx_huobi_source"]
    }));
  });
});
```

- [ ] **Step 2: Run mapper tests and verify failure**

Run:

```powershell
npm test -- tests/risk/scoringSignalMatrixInputs.test.ts
```

Expected: fail because `src/risk/scoringSignalMatrixInputs.ts` does not exist.

- [ ] **Step 3: Implement mapper helpers**

Create `src/risk/scoringSignalMatrixInputs.ts`:

```ts
import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import type {
  IncomingFreshBundleExposure,
  RiskReport,
  SourcePolicyEvidence,
  WhereIsMoneyReport
} from "../types";
import type { MatrixCandidate } from "./scoringSignalMatrix";

export type WalletMatrixCandidateInput = {
  address: string;
  fastReport?: RiskReport | null;
  deepReport?: DeepAddressForensicReport | null;
  whereReport: WhereIsMoneyReport;
};

export type IncomingDepositMatrixCandidateInput = {
  senderAddress: string;
  receiverAddress: string;
  txHash: string;
  freshBundleExposure?: IncomingFreshBundleExposure | null;
  baseCandidates: MatrixCandidate[];
};

function candidate(input: MatrixCandidate): MatrixCandidate {
  return input;
}

function evidenceIds(ids: string[], fallback: string): string[] {
  const cleaned = ids.filter((id) => id.trim().length > 0);
  return cleaned.length > 0 ? cleaned : [fallback];
}

function coverageCandidate(reason: string): MatrixCandidate {
  return candidate({
    row: "coverage_uncertainty",
    actionUnit: "wallet",
    score: 0,
    decisionEligibility: "insufficient_only",
    evidenceIds: [reason],
    evidenceEpisodeIds: [reason],
    atomicSignals: ["insufficient_coverage"],
    modifiers: [],
    caps: [],
    dampeners: [],
    caveats: [reason]
  });
}

function sourcePolicyCandidate(item: SourcePolicyEvidence): MatrixCandidate {
  const ids = evidenceIds(item.evidenceIds, `source_policy:${item.kind}`);
  return candidate({
    row: "source_policy",
    actionUnit: "source_path",
    score: item.score,
    decisionEligibility: item.proofLevel === "exchange_policy_decline" && item.score >= 60 ? "can_decline" : "review_only",
    evidenceIds: ids,
    evidenceEpisodeIds: ids,
    atomicSignals: [`source_policy_${item.kind}`],
    modifiers: item.topPath ? [`share_${Math.round(item.effectiveShare * 100)}`, `hops_${item.topPath.hops}`] : [`share_${Math.round(item.effectiveShare * 100)}`],
    caps: [],
    dampeners: item.canBeDampened ? ["source_policy_can_be_dampened"] : [],
    caveats: item.warnings
  });
}

function fastHardProofCandidates(report: RiskReport | null | undefined): MatrixCandidate[] {
  if (!report) return [];
  return report.reasons.flatMap((reason) => {
    if (reason.code !== "stablecoin_usdt_blacklisted") return [];
    const id = reason.evidenceRef ?? `fast:${reason.code}`;
    return [candidate({
      row: "hard_proof",
      actionUnit: "wallet",
      score: Math.max(95, reason.scoreImpact),
      decisionEligibility: "can_decline",
      evidenceIds: [id],
      evidenceEpisodeIds: [id],
      atomicSignals: [reason.code],
      modifiers: ["hard_anchor"],
      caps: [],
      dampeners: [],
      caveats: []
    })];
  });
}

function deepCandidates(report: DeepAddressForensicReport | null | undefined): MatrixCandidate[] {
  if (!report) return [];
  const candidates: MatrixCandidate[] = [];

  for (const profile of report.approvalDrainProvenanceProfiles) {
    const exact = profile.evidenceStrength === "exact_approval_and_transfer_from";
    candidates.push(candidate({
      row: exact ? "hard_proof" : "route_linked_approval_pattern",
      actionUnit: "transaction",
      score: exact ? Math.max(90, profile.score) : Math.min(80, profile.score),
      decisionEligibility: exact ? "can_decline" : "review_only",
      evidenceIds: [profile.approvalTxHash, profile.drainTxHash, ...profile.pathTxHashes],
      evidenceEpisodeIds: [`approval_drain:${profile.drainTxHash}`],
      atomicSignals: [exact ? "approval_drain_exact_transfer_from" : "route_linked_approval_pattern"],
      modifiers: exact ? ["hard_anchor"] : [],
      caps: [],
      dampeners: [],
      caveats: profile.falsePositiveGuards?.map((guard) => guard.code) ?? []
    }));
  }

  for (const profile of report.assetContinuationProfiles) {
    if (profile.evidenceClass !== "asset_continuation" || profile.tokenQuality === "unknown" || profile.score < 65) continue;
    candidates.push(candidate({
      row: "asset_continuation",
      actionUnit: "transaction",
      score: Math.min(84, profile.score),
      decisionEligibility: "review_only",
      evidenceIds: [profile.conversionTxHash, profile.outgoingTxHash ?? profile.conversionTxHash],
      evidenceEpisodeIds: [`asset_continuation:${profile.conversionTxHash}`],
      atomicSignals: ["asset_continuation"],
      modifiers: [`token_quality_${profile.tokenQuality}`],
      caps: [],
      dampeners: [],
      caveats: profile.reasons
    }));
  }

  for (const profile of report.operationalFlowProfiles) {
    if (profile.historicalTransitScore >= 60) {
      candidates.push(candidate({
        row: "service_linked_pattern",
        actionUnit: "wallet",
        score: Math.min(84, profile.historicalTransitScore),
        decisionEligibility: "can_decline",
        evidenceIds: [`operational_flow:${profile.subjectAddress}`],
        evidenceEpisodeIds: [`operational_flow:${profile.subjectAddress}`],
        atomicSignals: ["historical_transit_pattern"],
        modifiers: ["service_anchor"],
        caps: [],
        dampeners: [],
        caveats: profile.features.map((feature) => feature.code)
      }));
    }
  }

  for (const profile of report.addressBehaviorProfiles) {
    const score = Math.max(profile.depositThenDrainScore, profile.transitScore);
    if (score <= 0) continue;
    candidates.push(candidate({
      row: "behavior_only_prior",
      actionUnit: "wallet",
      score,
      decisionEligibility: "review_only",
      evidenceIds: [`address_behavior:${profile.subjectAddress}`],
      evidenceEpisodeIds: [`address_behavior:${profile.subjectAddress}`],
      atomicSignals: profile.features.map((feature) => feature.code),
      modifiers: [],
      caps: [],
      dampeners: profile.dampenerScore > 0 ? [`behavior_dampener_${profile.dampenerScore}`] : [],
      caveats: []
    }));
  }

  return candidates;
}

function whereCandidates(report: WhereIsMoneyReport): MatrixCandidate[] {
  const candidates: MatrixCandidate[] = [];

  for (const item of report.assessment.hardBadEvidence) {
    const hardKinds = new Set(["approval_drain", "scam_or_blacklist", "sanctioned_service"]);
    if (!hardKinds.has(item.kind)) continue;
    const ids = evidenceIds(item.evidenceIds, `where_hard:${item.kind}`);
    candidates.push(candidate({
      row: "hard_proof",
      actionUnit: "source_path",
      score: Math.max(90, item.score),
      decisionEligibility: "can_decline",
      evidenceIds: ids,
      evidenceEpisodeIds: ids,
      atomicSignals: [`where_${item.kind}`],
      modifiers: ["hard_anchor"],
      caps: [],
      dampeners: [],
      caveats: []
    }));
  }

  candidates.push(...report.assessment.sourcePolicyEvidence.map(sourcePolicyCandidate));

  if (report.coverage.partial || report.coverage.fetchedAddressCount <= 1) {
    candidates.push(coverageCandidate("coverage:where_partial"));
  }

  return candidates;
}

export function buildWalletMatrixCandidates(input: WalletMatrixCandidateInput): MatrixCandidate[] {
  const candidates = [
    ...fastHardProofCandidates(input.fastReport),
    ...deepCandidates(input.deepReport),
    ...whereCandidates(input.whereReport)
  ];

  const deepSparse = input.deepReport ? (input.deepReport.coverage?.transferEdges ?? 0) < 10 : true;
  if (input.whereReport.coverage.partial && deepSparse) {
    candidates.push(coverageCandidate("coverage:where_and_deep_limited"));
  }

  return candidates;
}

export function buildIncomingDepositMatrixCandidates(input: IncomingDepositMatrixCandidateInput): MatrixCandidate[] {
  const candidates = [...input.baseCandidates];
  const exposure = input.freshBundleExposure;
  if (!exposure) return candidates;

  if (exposure.riskyLabelShare >= 0.1) {
    candidates.push(candidate({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 85,
      decisionEligibility: "can_decline",
      evidenceIds: [`incoming:${input.txHash}:risky_label`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_risky_label_source"],
      modifiers: ["source_policy_anchor"],
      caps: [],
      dampeners: [],
      caveats: []
    }));
  }

  if (exposure.htxHuobiShare >= 0.7) {
    candidates.push(candidate({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 85,
      decisionEligibility: "can_decline",
      evidenceIds: [`incoming:${input.txHash}:htx_huobi`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_htx_huobi_source"],
      modifiers: ["source_policy_anchor", `share_${Math.round(exposure.htxHuobiShare * 100)}`],
      caps: [],
      dampeners: [],
      caveats: []
    }));
  } else if (exposure.htxHuobiShare >= 0.3) {
    candidates.push(candidate({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 70,
      decisionEligibility: "can_decline",
      evidenceIds: [`incoming:${input.txHash}:htx_huobi`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_htx_huobi_source"],
      modifiers: ["source_policy_anchor", `share_${Math.round(exposure.htxHuobiShare * 100)}`],
      caps: [],
      dampeners: [],
      caveats: []
    }));
  } else if (exposure.htxHuobiShare >= 0.1) {
    candidates.push(candidate({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 55,
      decisionEligibility: "review_only",
      evidenceIds: [`incoming:${input.txHash}:htx_huobi_context`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_htx_huobi_context"],
      modifiers: [`share_${Math.round(exposure.htxHuobiShare * 100)}`],
      caps: [],
      dampeners: [],
      caveats: []
    }));
  }

  if (exposure.bridgeRouterDexShare >= 0.5) {
    candidates.push(candidate({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 70,
      decisionEligibility: "can_decline",
      evidenceIds: [`incoming:${input.txHash}:bridge_router_dex`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_bridge_router_dex_source"],
      modifiers: ["service_anchor", `share_${Math.round(exposure.bridgeRouterDexShare * 100)}`],
      caps: [],
      dampeners: [],
      caveats: []
    }));
  }

  if (exposure.unknownContractShare >= 0.5) {
    candidates.push(candidate({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 55,
      decisionEligibility: "review_only",
      evidenceIds: [`incoming:${input.txHash}:unknown_contract`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_unknown_contract_source"],
      modifiers: [`share_${Math.round(exposure.unknownContractShare * 100)}`],
      caps: ["unknown_contract_cap_59"],
      dampeners: [],
      caveats: []
    }));
  }

  return candidates;
}
```

- [ ] **Step 4: Run mapper tests**

Run:

```powershell
npm test -- tests/risk/scoringSignalMatrixInputs.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/risk/scoringSignalMatrixInputs.ts tests/risk/scoringSignalMatrixInputs.test.ts
git commit -m "feat: map forensic evidence to scoring matrix"
```

---

### Task 3: Add Matrix Result To Unified Wallet Scoring

**Files:**
- Modify: `src/risk/unifiedWalletRisk.ts`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add failing wallet integration tests**

Append these tests inside `describe("calculateUnifiedWalletRisk", ...)` in `tests/risk/unifiedWalletRisk.test.ts`:

```ts
  it("exposes scoring matrix result without calibrated probability", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReport(),
      whereReport: whereReport(0, {
        assessment: whereAssessment(70, {
          sourcePolicyEvidence: [sourcePolicyEvidence(70)]
        })
      })
    });

    expect(result.matrixScore).toMatchObject({
      policyVersion: "scoring-signal-matrix-v1",
      policyScore: 70,
      matrixDecision: "DECLINE",
      winningRow: "source_policy",
      queuePriorityScore: null,
      calibratedRiskProbability: null
    });
  });

  it("keeps behavior-only matrix score below decline threshold", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReport({
        addressBehaviorProfiles: [{
          subjectAddress: address,
          incomingVolumeRaw: "1000000000",
          outgoingVolumeRaw: "990000000",
          incomingTxCount: 1,
          outgoingTxCount: 1,
          uniqueIncomingCounterparties: 1,
          uniqueOutgoingCounterparties: 1,
          largestIncomingRaw: "1000000000",
          largestOutgoingRaw: "990000000",
          topOutgoingCounterpartyAddress: `T${"2".repeat(33)}`,
          topOutgoingCounterpartyRaw: "990000000",
          topOutgoingCounterpartyTxCount: 1,
          topOutgoingCounterpartyRatio: 0.99,
          inflowToOutflowRatio: 0.99,
          drainToServiceRatio: 0,
          timeToFirstOutgoingMs: 5 * 60 * 1000,
          timeToFirstServiceExitMs: null,
          depositThenDrainScore: 82,
          transitScore: 82,
          dampenerScore: 0,
          features: [{ code: "address_behavior_fast_post_deposit_exit", label: "fast exit", scoreImpact: 82 }]
        }]
      }),
      whereReport: whereReport(0)
    });

    expect(result.matrixScore.policyScore).toBe(59);
    expect(result.matrixScore.matrixDecision).toBe("REVIEW");
    expect(result.matrixScore.riskVector.behavior_only_prior?.[0].caps).toContain("behavior_only_cap_59");
  });
```

- [ ] **Step 2: Run wallet integration tests and verify failure**

Run:

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts -t "scoring matrix|behavior-only matrix"
```

Expected: fail because `matrixScore` is not part of `UnifiedWalletRiskResult`.

- [ ] **Step 3: Extend unified wallet result type**

In `src/risk/unifiedWalletRisk.ts`, add imports:

```ts
import { buildWalletMatrixCandidates } from "./scoringSignalMatrixInputs";
import { scoreMatrixCandidates, type MatrixScoringResult } from "./scoringSignalMatrix";
```

Add this field to `UnifiedWalletRiskResult`:

```ts
  matrixScore: MatrixScoringResult;
```

- [ ] **Step 4: Calculate matrix score in `calculateUnifiedWalletRisk`**

In `calculateUnifiedWalletRisk`, after `const { weightedLayerScore, layerBreakdown } = normalizedWeightedLayers(...)`, add:

```ts
  const matrixScore = scoreMatrixCandidates(buildWalletMatrixCandidates(input));
```

In the returned object, add:

```ts
    matrixScore,
```

Do not change `finalScore` yet in this task. This keeps the first integration shadow-only and makes the diff easy to review.

- [ ] **Step 5: Run wallet integration tests**

Run:

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts -t "scoring matrix|behavior-only matrix"
```

Expected: pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/risk/unifiedWalletRisk.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "feat: expose scoring matrix on unified wallet risk"
```

---

### Task 4: Add Matrix Result To Incoming Deposit Scoring

**Files:**
- Modify: `src/risk/unifiedIncomingDepositRisk.ts`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add failing incoming matrix tests**

Append these tests inside `describe("calculateUnifiedIncomingDepositRisk", ...)` in `tests/risk/unifiedWalletRisk.test.ts`:

```ts
  it("uses deposit-scoped matrix source policy for fresh HTX/Huobi bundle", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: address,
      receiverAddress: `T${"2".repeat(33)}`,
      txHash: "tx-incoming-htx",
      amountRaw: "1000000000",
      timestamp: new Date("2026-06-01T00:00:00.000Z"),
      fastSenderRisk: fastReport(0),
      senderStablecoinState: null,
      whereReport: whereReport(0),
      deepReport: deepReport(),
      freshBundleExposure: {
        htxHuobiShare: 0.72,
        cleanCexShare: 0,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0.28
      }
    });

    expect(result.matrixScore).toMatchObject({
      policyScore: 85,
      matrixDecision: "DECLINE",
      winningRow: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit"
    });
  });

  it("keeps unknown-contract-only incoming evidence in review range", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: address,
      receiverAddress: `T${"2".repeat(33)}`,
      txHash: "tx-incoming-unknown-contract",
      amountRaw: "1000000000",
      timestamp: new Date("2026-06-01T00:00:00.000Z"),
      fastSenderRisk: fastReport(0),
      senderStablecoinState: null,
      whereReport: whereReport(0),
      deepReport: deepReport(),
      freshBundleExposure: {
        htxHuobiShare: 0,
        cleanCexShare: 0,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0.87,
        riskyLabelShare: 0,
        unknownShare: 0.13
      }
    });

    expect(result.matrixScore.policyScore).toBeLessThan(60);
    expect(result.matrixScore.matrixDecision).toBe("REVIEW");
  });
```

- [ ] **Step 2: Run incoming matrix tests and verify failure**

Run:

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts -t "deposit-scoped matrix|unknown-contract-only incoming"
```

Expected: fail because incoming overlays are not part of the matrix result.

- [ ] **Step 3: Merge base wallet candidates with incoming deposit candidates**

In `src/risk/unifiedIncomingDepositRisk.ts`, add imports:

```ts
import { buildIncomingDepositMatrixCandidates, buildWalletMatrixCandidates } from "./scoringSignalMatrixInputs";
import { scoreMatrixCandidates } from "./scoringSignalMatrix";
```

After the `base` calculation in `calculateUnifiedIncomingDepositRisk`, add:

```ts
  const matrixScore = scoreMatrixCandidates(buildIncomingDepositMatrixCandidates({
    senderAddress: input.senderAddress,
    receiverAddress: input.receiverAddress,
    txHash: input.txHash,
    freshBundleExposure: input.freshBundleExposure,
    baseCandidates: buildWalletMatrixCandidates({
      address: input.senderAddress,
      fastReport: fastRiskWithSenderBlacklist(
        input.fastSenderRisk,
        input.senderAddress,
        input.senderStablecoinState
      ),
      deepReport: input.deepReport,
      whereReport: input.whereReport
    })
  }));
```

In the returned object, override the base matrix:

```ts
    matrixScore,
```

- [ ] **Step 4: Run incoming matrix tests**

Run:

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts -t "deposit-scoped matrix|unknown-contract-only incoming"
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/risk/unifiedIncomingDepositRisk.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "feat: expose scoring matrix on incoming deposits"
```

---

### Task 5: Switch Production Score To Matrix Policy Score

**Files:**
- Modify: `src/risk/unifiedWalletRisk.ts`
- Modify: `src/risk/unifiedIncomingDepositRisk.ts`
- Modify: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add failing production-switch tests**

Append these tests in `tests/risk/unifiedWalletRisk.test.ts`:

```ts
  it("does not turn limited coverage into a decline after matrix switch", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReport({
        coverage: {
          sourceTransferPages: 0,
          inboundSendersExpanded: 0,
          transferEdges: 0,
          extendedIndexedEdges: 0,
          extendedFetchedAddresses: 0,
          apiKeyConfigured: true
        }
      }),
      whereReport: whereReport(0, {
        coverage: {
          ...whereReport(0).coverage,
          fetchedAddressCount: 1,
          partial: true,
          notes: ["provider limit"]
        }
      })
    });

    expect(result.matrixScore.policyScore).toBeNull();
    expect(result.matrixScore.matrixDecision).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.finalScore).toBe(0);
    expect(result.finalDecision).toBe("ACCEPTABLE");
  });

  it("uses matrix source-policy score as final score after switch", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReport(),
      whereReport: whereReport(0, {
        assessment: whereAssessment(70, {
          sourcePolicyEvidence: [sourcePolicyEvidence(70)]
        })
      })
    });

    expect(result.finalScore).toBe(70);
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.scoreBreakdown.activeAnchor).toMatchObject({
      code: "matrix:source_policy",
      score: 70,
      source: "policy_floor"
    });
  });
```

- [ ] **Step 2: Run production-switch tests and verify failure**

Run:

```powershell
npm test -- tests/risk/unifiedWalletRisk.test.ts -t "matrix switch|matrix source-policy score"
```

Expected: fail because legacy weighted/floor aggregation still controls `finalScore`.

- [ ] **Step 3: Add matrix-to-legacy helpers**

In `src/risk/unifiedWalletRisk.ts`, add these helpers near `decisionFromScore`:

```ts
function finalScoreFromMatrix(matrixScore: MatrixScoringResult): number {
  return matrixScore.policyScore ?? 0;
}

function finalDecisionFromMatrix(matrixScore: MatrixScoringResult): UserExchangeDecision {
  return matrixScore.matrixDecision === "DECLINE" ? "DECLINE" : "ACCEPTABLE";
}

function matrixAnchorSource(row: MatrixScoringResult["winningRow"]): UnifiedWalletRiskReason["source"] {
  if (row === "hard_proof") return "hard_evidence";
  if (row === "source_policy" || row === "incoming_deposit_source_policy") return "policy_floor";
  if (row === "asset_continuation") return "asset_continuation";
  if (row === "service_linked_pattern" || row === "route_linked_approval_pattern" || row === "typology_subgraph_pattern") {
    return "pattern_floor";
  }
  if (row === "coverage_uncertainty") return "coverage";
  return "deep_research";
}

function matrixAnchorReason(matrixScore: MatrixScoringResult): UnifiedWalletRiskReason | null {
  if (matrixScore.policyScore === null) return null;
  return {
    code: `matrix:${matrixScore.winningRow}`,
    message: `Scoring Signal Matrix winning row is ${matrixScore.winningRow}.`,
    score: matrixScore.policyScore,
    source: matrixAnchorSource(matrixScore.winningRow)
  };
}
```

- [ ] **Step 4: Replace final wallet score with matrix policy score**

In `calculateUnifiedWalletRisk`, keep legacy calculations for diagnostics, but change the production variables:

```ts
  const legacyFinalBeforeHardCap = maxScore([coverageAdjustedContextScore, floorScore]);
  const legacyFinalScore = hardEvidenceFloor === 0 ? Math.min(legacyFinalBeforeHardCap, 84) : legacyFinalBeforeHardCap;
  const finalScore = finalScoreFromMatrix(matrixScore);
  const finalDecision = finalDecisionFromMatrix(matrixScore);
```

Update `noHardEvidenceCriticalCapApplied` to reference the legacy cap only as a diagnostic:

```ts
  const noHardEvidenceCriticalCapApplied = hardEvidenceFloor === 0 && legacyFinalBeforeHardCap > legacyFinalScore;
```

Add matrix anchor into `floorReasons`:

```ts
  const matrixAnchor = matrixAnchorReason(matrixScore);
  const floorReasons = [
    ...hardReasons,
    ...policyReasons,
    ...assetContinuationReasons,
    ...patternReasons,
    ...(matrixAnchor ? [matrixAnchor] : [])
  ];
```

Add `matrixAnchor` to returned `reasons` before dampener:

```ts
    ...(matrixAnchor ? [matrixAnchor] : []),
```

- [ ] **Step 5: Replace incoming final score with incoming matrix policy score**

In `calculateUnifiedIncomingDepositRisk`, after `matrixScore` is created, replace:

```ts
  const finalScore = noHardEvidenceCriticalCapApplies
    ? Math.min(uncappedFinalScore, base.scoreBreakdown.noHardEvidenceCriticalCap.maxScore)
    : uncappedFinalScore;
```

with:

```ts
  const legacyFinalScore = noHardEvidenceCriticalCapApplies
    ? Math.min(uncappedFinalScore, base.scoreBreakdown.noHardEvidenceCriticalCap.maxScore)
    : uncappedFinalScore;
  const finalScore = matrixScore.policyScore ?? 0;
```

Replace the `finalDecision` field in the return object:

```ts
    finalDecision: matrixScore.matrixDecision === "DECLINE" ? "DECLINE" : "ACCEPTABLE",
```

Keep `legacyFinalScore` only for the cap diagnostic:

```ts
  const noHardEvidenceCriticalCapApplied = legacyFinalScore <= base.scoreBreakdown.noHardEvidenceCriticalCap.maxScore && (
    base.scoreBreakdown.noHardEvidenceCriticalCap.applied ||
    (noHardEvidenceCriticalCapApplies && uncappedFinalScore > legacyFinalScore)
  );
```

- [ ] **Step 6: Run focused scorer tests**

Run:

```powershell
npm test -- tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/unifiedWalletRisk.test.ts
```

Expected: pass after updating older assertions in `tests/risk/unifiedWalletRisk.test.ts` that intentionally expected weighted/floor scores to control production. When updating those older assertions, assert both:

```ts
expect(result.matrixScore.policyScore).toBe(result.finalScore);
expect(result.matrixScore.calibratedRiskProbability).toBeNull();
```

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/risk/unifiedWalletRisk.ts src/risk/unifiedIncomingDepositRisk.ts tests/risk/unifiedWalletRisk.test.ts
git commit -m "feat: switch unified scoring to signal matrix"
```

---

### Task 6: Surface Matrix Decision In Bot And Incoming Jobs

**Files:**
- Modify: `src/bot/createBot.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Add failing incoming job summary assertion**

In `tests/forensics/incomingDepositJob.test.ts`, extend an existing successful incoming deposit job test with:

```ts
expect(result.unifiedRiskSummary?.activeAnchor?.code).toContain("matrix:");
expect(result.unifiedRiskSummary?.matrixDecision).toBe(result.unifiedRiskSummary?.finalDecision === "DECLINE" ? "DECLINE" : expect.any(String));
```

If the selected fixture is an acceptable/insufficient case, use:

```ts
expect(["ACCEPTABLE", "REVIEW", "INSUFFICIENT_EVIDENCE"]).toContain(result.unifiedRiskSummary?.matrixDecision);
```

- [ ] **Step 2: Run incoming job test and verify failure**

Run:

```powershell
npm test -- tests/forensics/incomingDepositJob.test.ts -t "unifiedRiskSummary"
```

Expected: fail because `IncomingDepositUnifiedRiskSummary` does not expose `matrixDecision`.

- [ ] **Step 3: Extend incoming summary shape**

In `src/types.ts`, add fields to `IncomingDepositUnifiedRiskSummary`:

```ts
  matrixDecision?: "ACCEPTABLE" | "REVIEW" | "DECLINE" | "INSUFFICIENT_EVIDENCE";
  winningRow?: string;
  policyScore?: number | null;
  calibratedRiskProbability?: number | null;
```

In `src/risk/unifiedIncomingDepositRisk.ts`, update `incomingUnifiedRiskSummary`:

```ts
    matrixDecision: result.matrixScore.matrixDecision,
    winningRow: result.matrixScore.winningRow,
    policyScore: result.matrixScore.policyScore,
    calibratedRiskProbability: result.matrixScore.calibratedRiskProbability,
```

- [ ] **Step 4: Update bot explanation text to prefer matrix decision**

In `src/bot/createBot.ts`, update `finalScoreExplanationLines(result, locale)` to include a compact matrix line before legacy layer diagnostics:

```ts
  lines.push(locale === "en"
    ? `Matrix row: ${result.matrixScore.winningRow}; matrix decision: ${result.matrixScore.matrixDecision}.`
    : `Строка матрицы: ${result.matrixScore.winningRow}; решение матрицы: ${result.matrixScore.matrixDecision}.`);
```

Keep existing final score line. Do not add long research explanations to the user-facing message.

- [ ] **Step 5: Run bot and incoming tests**

Run:

```powershell
npm test -- tests/forensics/incomingDepositJob.test.ts tests/bot/createBot.test.ts
```

Expected: pass after updating snapshots/string assertions that mention final scoring explanations.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/types.ts src/risk/unifiedIncomingDepositRisk.ts src/bot/createBot.ts src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts tests/bot/createBot.test.ts
git commit -m "feat: surface scoring matrix decisions"
```

---

### Task 7: Update Audit And Shadow Comparison

**Files:**
- Modify: `src/risk/scoringAudit.ts`
- Modify: `src/risk/shadowScoring.ts`
- Modify: `tests/risk/scoringAudit.test.ts`
- Modify: `tests/risk/shadowScoring.test.ts`

- [ ] **Step 1: Add failing audit extraction tests**

In `tests/risk/scoringAudit.test.ts`, add a job fixture whose `resultJson.unifiedRiskSummary` contains:

```ts
unifiedRiskSummary: {
  finalScore: 0,
  finalLevel: "LOW",
  finalDecision: "ACCEPTABLE",
  matrixDecision: "INSUFFICIENT_EVIDENCE",
  winningRow: "coverage_uncertainty",
  policyScore: null,
  calibratedRiskProbability: null,
  activeAnchor: null
}
```

Assert:

```ts
expect(row.auditDecision).toBe("INSUFFICIENT_COVERAGE");
expect(row.cohorts).toContain("low_score_incomplete_coverage");
expect(row.policyVersion).toContain("scoring-signal-matrix");
```

- [ ] **Step 2: Add failing shadow scoring test**

In `tests/risk/shadowScoring.test.ts`, update the policy version assertion:

```ts
expect(comparison.candidatePolicyVersion).toBe("scoring-signal-matrix-v1");
```

- [ ] **Step 3: Run audit and shadow tests and verify failure**

Run:

```powershell
npm test -- tests/risk/scoringAudit.test.ts tests/risk/shadowScoring.test.ts
```

Expected: fail because audit/shadow still expose the calibration-first version.

- [ ] **Step 4: Update audit extractor**

In `src/risk/scoringAudit.ts`, read matrix fields from `unifiedRiskSummary`:

```ts
const matrixDecision = normalizeDecision(unified["matrixDecision"]);
const winningRow = stringField(unified, "winningRow");
```

Use matrix decision as the strongest normalized scorer decision:

```ts
const unifiedDecision = matrixDecision === "MANUAL_REQUIRED"
  ? normalizeDecision(unified["finalDecision"])
  : matrixDecision;
```

Set policy version to matrix when a winning row exists:

```ts
policyVersion: winningRow ? "scoring-signal-matrix-v1" : clarity.policyVersion,
```

- [ ] **Step 5: Update shadow scoring version**

In `src/risk/shadowScoring.ts`, change:

```ts
  candidatePolicyVersion: "scoring-calibration-shadow-v1";
```

to:

```ts
  candidatePolicyVersion: "scoring-signal-matrix-v1";
```

and:

```ts
const candidatePolicyVersion = "scoring-signal-matrix-v1" as const;
```

- [ ] **Step 6: Run audit and shadow tests**

Run:

```powershell
npm test -- tests/risk/scoringAudit.test.ts tests/risk/shadowScoring.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/risk/scoringAudit.ts src/risk/shadowScoring.ts tests/risk/scoringAudit.test.ts tests/risk/shadowScoring.test.ts
git commit -m "feat: audit scoring matrix outcomes"
```

---

### Task 8: Full Verification

**Files:**
- Verify: all touched files

- [ ] **Step 1: Run focused risk tests**

Run:

```powershell
npm test -- tests/risk/scoringSignalMatrix.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/unifiedWalletRisk.test.ts tests/risk/scoringAudit.test.ts tests/risk/shadowScoring.test.ts
```

Expected: pass.

- [ ] **Step 2: Run incoming job tests**

Run:

```powershell
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: pass.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: pass.

- [ ] **Step 4: Run full test suite**

Run:

```powershell
npm test
```

Expected: pass.

- [ ] **Step 5: Inspect diff for unintended collector changes**

Run:

```powershell
git diff --stat
git diff -- src/check/deepForensicCheck.ts src/forensics/flowCounterpartyProfile.ts src/forensics/historicalTransitScore.ts src/risk/riskEngine.ts
```

Expected: no diff for the collector and legacy engine files listed in the second command.

- [ ] **Step 6: Final commit**

Run:

```powershell
git status --short
git add src/risk src/bot/createBot.ts src/forensics/incomingDepositJob.ts src/types.ts tests/risk tests/forensics/incomingDepositJob.test.ts tests/bot/createBot.test.ts
git commit -m "test: verify scoring signal matrix rollout"
```

Expected: commit succeeds only if there are verification or assertion updates left after prior task commits. If `git status --short` is clean before this step, skip this commit.

---

## Implementation Notes

- The first production version is still a policy scorecard, not a probability model.
- `queuePriorityScore` stays `null`.
- `calibratedRiskProbability` stays `null`.
- `REVIEW` and `INSUFFICIENT_EVIDENCE` are internal matrix decisions. Existing `UserExchangeDecision` still maps only to `ACCEPTABLE` or `DECLINE`.
- The matrix scorer should be pure. If a candidate cannot be built from existing reports, the collector should not be changed in this plan.
- Prefer adding a new atomic signal mapping over changing old score formulas.

## Self-Review

Spec coverage:

- Action units: Task 1 defines `MatrixActionUnit`; Task 2 maps wallet/source/deposit/transaction units.
- Score products: Task 1 defines `MatrixScoringResult`; Tasks 3-6 expose it.
- Winner-row scoring: Task 1 implements caps, de-duplication, winner selection, and decision mapping.
- Coverage uncertainty: Tasks 1, 2, and 5 ensure coverage does not create badness.
- Behavior-only cap: Tasks 1 and 3 test cap below `60`.
- Typology cap: Task 1 tests typology-only below `60`; future candidate mappings can use the existing row.
- Incoming deposit scope: Tasks 2 and 4 add deposit-scoped candidates.
- Backtesting/calibration: Task 7 updates audit/shadow reporting; probability and queue products remain null.
