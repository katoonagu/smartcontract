# Where Incoming Outcome Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop publishing final user-facing refusals when Where/Incoming only have incomplete provenance coverage and no hard bad evidence.

**Architecture:** Keep the first stage small. Add explicit score-validity fields to reports, teach Where policy to mark guarded approval-drain coverage gaps as non-final, teach Incoming to stop technically when targeted history hits budget/provider caps, and make bot/admin display score-invalid jobs as technical coverage failures instead of final `DECLINE`.

**Tech Stack:** TypeScript, Vitest, existing forensic job runners, existing admin graph projection, existing Telegram formatters.

---

## File Structure

- Modify `src/types.ts`
  - Add shared score-validity types.
  - Add optional score-validity fields to `WhereIsMoneyAssessment`, `WhereIsMoneyReport`, and `IncomingDepositRiskReport`.
- Modify `src/forensics/moneyOriginOperationalAssessment.ts`
  - Add a guarded-approval/non-actionable helper.
  - Return non-final `REVIEW` with `scoreValid=false` for guarded approval-drain review plus incomplete hop coverage and no hard evidence.
- Modify `src/check/whereIsMoneyCheck.ts`
  - Copy assessment score-validity fields to `WhereIsMoneyReport`.
- Modify `src/forensics/deepForensicJob.ts`
  - Store top-level `score_valid`, `score_blocked_reason`, and `technical_status` for non-strict Where jobs when report score is invalid.
- Modify `src/forensics/incomingDepositJob.ts`
  - Track targeted history ensure results.
  - Add technical stop fields to report when a required targeted hop is incomplete.
  - Complete the job as failed technical coverage before risk recording/alert sending when `scoreValid=false`.
- Modify `src/admin/forensicsGraph.ts`
  - Add a generic score-validity summary, not only strict benchmark summary.
- Modify `src/bot/createBot.ts`
  - If `WhereIsMoneyReport.scoreValid === false`, show no final decision instead of `report.userDecision`.
- Test `tests/forensics/moneyOriginOperationalAssessment.test.ts`
- Test `tests/check/whereIsMoneyCheck.test.ts`
- Test `tests/forensics/incomingDepositJob.test.ts`
- Test `tests/admin/forensicsGraph.test.ts`
- Test `tests/bot/createBot.test.ts`

## Task 1: Shared Score-Validity Contract

**Files:**
- Modify: `src/types.ts`
- Verification: compile-time use in Tasks 2-4

- [ ] **Step 1: Add shared score-validity types**

In `src/types.ts`, after `UserExchangeDecision`, add:

```ts
export type ForensicScoreBlockedReason =
  | "insufficient_coverage"
  | "partial_budget_exhausted"
  | "provider_error"
  | "rate_limited_after_retries"
  | "provider_inconsistent"
  | "provider_cap_unresolved"
  | "hard_safety_limit_exceeded";

export type ForensicTechnicalStatus =
  | "completed"
  | "provider_limited"
  | "provider_cap_unresolved"
  | "hard_safety_limit_exceeded";

export type ForensicScoreValidity = {
  scoreValid?: boolean;
  scoreBlockedReason?: ForensicScoreBlockedReason | null;
  technicalStatus?: ForensicTechnicalStatus | null;
};
```

- [ ] **Step 2: Extend Where and Incoming report types**

In `src/types.ts`, update `WhereIsMoneyAssessment`, `WhereIsMoneyReport`, and `IncomingDepositRiskReport`:

```ts
export type WhereIsMoneyAssessment = ForensicScoreValidity & {
  decision: ExchangeDecision;
  riskScore: number;
  riskBand: WhereIsMoneyRiskBand;
  provenanceConfidence: number;
  coverageCompleteness: number;
  walletRole: WhereIsMoneyWalletRole;
  operationalLiquidityScore: number;
  ageSignals: WhereIsMoneyAgeSignals | null;
  hardBadEvidence: WhereIsMoneyHardBadEvidence[];
  sourcePolicyEvidence: SourcePolicyEvidence[];
  contractSuspicionEvidence: RiskLayerScore[];
  unknownOriginEvidence: RiskLayerScore[];
  riskLayers: RiskLayerScore[];
  dominantRiskLayer?: RiskLayerScore | null;
  reasons: string[];
  warnings: string[];
};
```

```ts
export type WhereIsMoneyReport = ForensicScoreValidity & {
  subjectAddress: string;
  currentUsdtBalanceRaw: string | null;
  fastWalletRisk: RiskReport | null;
  balanceFormingTransfers: BalanceFormingTransfer[];
  originPaths: MoneyOriginPath[];
  senderInteractionProfiles: MoneyOriginSenderInteractionProfile[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
  approvalDrainReviewFindings?: ApprovalDrainReviewFinding[];
  contractDrivenReceiverProfile?: ContractDrivenReceiverProfile | null;
  contractDrivenTransferProfiles?: ContractDrivenTransferProfile[];
  contractLlmVerdicts?: ContractLlmVerdictSummary[];
  crossChainCorridor?: CrossChainCorridorReport;
  sourceBundleExposure?: SourceBundleExposureProfile;
  subjectExposureProfile?: SubjectExposureProfile;
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
  layerSummary?: MoneyOriginLayerSummary;
};
```

```ts
export type IncomingDepositTargetedCoverageSummary = {
  selectedDepositTxHash: string;
  sender: string;
  hopCount: number;
  completeHopCount: number;
  partialHopCount: number;
  pagesFetched: number;
  transfersFetched: number;
  firstBlockingReason: ForensicScoreBlockedReason | null;
  firstBlockingAddress: string | null;
};

export type IncomingDepositRiskReport = ForensicScoreValidity & {
  decision: IncomingDepositDecision;
  depositRiskScore: number;
  riskBand: IncomingDepositRiskBand;
  fastSenderRisk: RiskReport | null;
  originPaths: IncomingDepositOriginPath[];
  originCoverage: number;
  fundingCoverage: {
    depositFundingCoverageRatio: number;
    cleanSourceCoverageRatio: number;
    exactContinuityCoverageRatio: number;
  };
  corridorSummary: IncomingDepositCorridorSummary | null;
  provenanceConfidence: number;
  dataQuality: IncomingDepositDataQuality;
  senderRole: string | null;
  targetedHistoryCoverage?: IncomingDepositTargetedCoverageSummary;
  sourcePolicyEvidence?: SourcePolicyEvidence[];
  hardBadEvidence: IncomingDepositHardBadEvidence[];
  contractVerdicts: ContractLlmVerdictSummary[];
  contractDrivenReceiverProfile?: ContractDrivenReceiverProfile | null;
  contractDrivenTransferProfiles?: ContractDrivenTransferProfile[];
  contractDrivenSubjectAddress?: string;
  freshBundleExposure?: IncomingFreshBundleExposure;
  walletExposureProfile?: IncomingWalletExposureProfile;
  sourceBundleExposure?: SourceBundleExposureProfile;
  subjectExposureProfile?: SubjectExposureProfile;
  unifiedRiskSummary?: IncomingDepositUnifiedRiskSummary;
  reasons: string[];
  warnings: string[];
};
```

- [ ] **Step 3: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: TypeScript can report missing reads/writes for the new fields until Tasks 2-4 are implemented. Do not commit Task 1 alone if it fails.

## Task 2: Where Policy Guard

**Files:**
- Modify: `tests/forensics/moneyOriginOperationalAssessment.test.ts`
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`

- [ ] **Step 1: Write failing guarded-approval coverage test**

Append this test inside `describe("buildMoneyOriginOperationalAssessment", ...)`, immediately after the existing test named `lets high-confidence LLM legitimate_service lower unknown contract boundary risk`:

```ts
it("does not publish a final decline for guarded approval review with legitimate service and incomplete hop coverage", () => {
  const guardedFinding = approvalReviewFinding({
    reason: "service_boundary_guard",
    falsePositiveGuards: [{
      code: "service_boundary_route",
      label: "USDD PSM/GemJoin",
      address: "TService1111111111111111111111111111",
      category: "dex",
      identity: "USDD PSM"
    }]
  });

  const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
    originPaths: [
      reviewPath({
        stoppedReason: "incoming_history_not_fetched",
        verdict: "REVIEW",
        riskScoreContribution: 45,
        reasons: ["Fetched incoming transfer history did not reach the current hop timestamp; source remains unproven."]
      })
    ],
    senderInteractionProfiles: [profile()],
    approvalDrainReviewFindings: [guardedFinding],
    contractLlmVerdicts: [
      legitimateServiceVerdict({
        contractAddress: guardedFinding.spenderAddress,
        confidence: 0.91,
        contractRiskScore: 5,
        decisionRecommendation: "ACCEPTABLE"
      })
    ],
    coverage: coverage({
      partial: true,
      notes: ["tx-review: Fetched incoming transfer history did not reach the current hop timestamp; source remains unproven."]
    })
  }));

  expect(assessment.decision).toBe("REVIEW");
  expect(assessment.scoreValid).toBe(false);
  expect(assessment.scoreBlockedReason).toBe("insufficient_coverage");
  expect(assessment.technicalStatus).toBe("provider_cap_unresolved");
  expect(assessment.hardBadEvidence).toEqual([]);
  expect(assessment.reasons.join(" ")).toContain("coverage");
  expect(assessment.reasons.join(" ")).not.toContain("declined by policy");
});
```

- [ ] **Step 2: Write hard-evidence regression test**

Append this test next to the previous one:

```ts
it("still declines guarded approval review when separate hard bad evidence exists", () => {
  const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
    approvalDrainReviewFindings: [
      approvalReviewFinding({
        reason: "service_boundary_guard",
        falsePositiveGuards: [{
          code: "service_boundary_route",
          label: "Guarded route",
          address: "TService1111111111111111111111111111",
          category: "dex",
          identity: "Guarded Service"
        }]
      })
    ],
    contractLlmVerdicts: [legitimateServiceVerdict()],
    extraHardBadEvidence: [extraSanctionedHardEvidence()]
  }));

  expect(assessment.decision).toBe("DECLINE");
  expect(assessment.scoreValid).not.toBe(false);
  expect(assessment.hardBadEvidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "sanctioned_service" })
  ]));
});
```

- [ ] **Step 3: Run the focused failing tests**

Run:

```bash
npx vitest run tests/forensics/moneyOriginOperationalAssessment.test.ts --configLoader bundle
```

Expected before implementation: the first new test fails because the assessment still returns final `DECLINE` or has no `scoreValid=false`.

- [ ] **Step 4: Add policy helpers**

In `src/forensics/moneyOriginOperationalAssessment.ts`, after `function topLegitimateServiceLlmVerdict(...)`, add:

```ts
function hasGuardedApprovalDrainReviewFinding(findings: ApprovalDrainReviewFinding[]): boolean {
  return findings.some((finding) =>
    finding.reason === "service_boundary_guard" ||
    finding.falsePositiveGuards.some((guard) =>
      guard.code === "service_boundary_route" ||
      guard.code === "spender_service_boundary" ||
      guard.code === "receiver_service_boundary" ||
      guard.code === "intermediate_service_boundary" ||
      guard.code === "subject_service_boundary"
    )
  );
}

function hasNonActionableContractVerdict(verdicts: ContractLlmVerdictSummary[]): boolean {
  return verdicts.some((verdict) =>
    verdict.source !== "unavailable" &&
    verdict.verdict === "legitimate_service" &&
    verdict.decisionRecommendation === "ACCEPTABLE" &&
    verdict.confidence >= 0.8 &&
    verdict.contractRiskScore <= 35
  );
}

function hasIncomingHistoryCoverageGap(input: BuildMoneyOriginOperationalAssessmentInput): boolean {
  return input.coverage.partial === true &&
    input.originPaths.some((path) => path.stoppedReason === "incoming_history_not_fetched");
}

function guardedApprovalReviewBlocksFinalDecline(input: BuildMoneyOriginOperationalAssessmentInput, hardBadEvidence: WhereIsMoneyHardBadEvidence[], sourcePolicyDecline: boolean): boolean {
  return input.approvalDrainReviewFindings.length > 0 &&
    hasGuardedApprovalDrainReviewFinding(input.approvalDrainReviewFindings) &&
    hasNonActionableContractVerdict(input.contractLlmVerdicts) &&
    hasIncomingHistoryCoverageGap(input) &&
    hardBadEvidence.length === 0 &&
    !sourcePolicyDecline;
}
```

- [ ] **Step 5: Add the non-final branch**

In `buildMoneyOriginOperationalAssessment`, after `sourcePolicyDecline` is computed and before the `topContractSuspicion` branch, add:

```ts
  if (guardedApprovalReviewBlocksFinalDecline(input, hardBadEvidence, sourcePolicyDecline)) {
    const riskScore = clampScore(Math.max(
      45,
      Math.min(55, highestPathRisk(input.originPaths)),
      Math.min(55, input.fastWalletRisk?.score ?? 0)
    ));
    const coverageLayer: RiskLayerScore = {
      evidenceClass: "data_quality",
      kind: "guarded_approval_review_insufficient_coverage",
      score: riskScore,
      rawScore: riskScore,
      adjustedScore: riskScore,
      proofLevel: "insufficient_coverage",
      canBeDampened: true,
      reasons: ["Guarded approval-drain review is non-actionable, but hop history coverage is incomplete."],
      warnings: ["No final decline is published until the missing hop history is covered."],
      evidenceIds: input.originPaths.flatMap((path) => path.txHashes).slice(0, 10)
    };
    return {
      decision: "REVIEW",
      scoreValid: false,
      scoreBlockedReason: "insufficient_coverage",
      technicalStatus: "provider_cap_unresolved",
      riskScore,
      riskBand: riskBandFromWhereScore(riskScore),
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      walletRole: role,
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence: [],
      ...layerCollectionsWithExtras({
        sourcePolicyEvidence: sourcePolicyAssessment.sourcePolicyEvidence,
        sourcePolicyLayers: sourcePolicyAssessment.riskLayers,
        aggregateSourcePolicyLayer: aggregateDeclineLayer,
        contractSuspicionEvidence,
        unknownOriginEvidence: [coverageLayer, ...defaultUnknownOriginEvidence],
        hardProofLayers: []
      }),
      reasons: [
        "Approval-drain review is guarded by service context and contract analysis is non-actionable; final scoring is blocked by incomplete hop history coverage."
      ],
      warnings: [
        "No hard bad evidence was found. This is a technical coverage block, not a final decline.",
        ...approvalWarnings,
        ...llmWarnings
      ]
    };
  }
```

- [ ] **Step 6: Run the focused test**

Run:

```bash
npx vitest run tests/forensics/moneyOriginOperationalAssessment.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/types.ts src/forensics/moneyOriginOperationalAssessment.ts tests/forensics/moneyOriginOperationalAssessment.test.ts
git commit -m "fix(where): block final decline on guarded coverage gaps"
```

## Task 3: Propagate Where Score Invalidity to Job, Admin, and Bot

**Files:**
- Modify: `tests/check/whereIsMoneyCheck.test.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`
- Modify: `tests/bot/createBot.test.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `src/bot/createBot.ts`

- [ ] **Step 1: Add Where report propagation test**

In `tests/check/whereIsMoneyCheck.test.ts`, add a focused test immediately after the existing test named `treats an unknown contract boundary as unproven context, not scam proof`. Reuse the local constants `subject`, `cleanSender`, `wrapperContract`, `victim`, `operator`, `lowFastRisk`, and helpers `edge(...)` and `service(...)`. The assertion block must be:

```ts
expect(report.assessment.scoreValid).toBe(false);
expect(report.scoreValid).toBe(false);
expect(report.scoreBlockedReason).toBe("insufficient_coverage");
expect(report.technicalStatus).toBe("provider_cap_unresolved");
expect(report.decision).toBe("REVIEW");
```

Use a fixture with:

```ts
approvalDrainReviewFindings: [{
  victimAddress: "TVictim11111111111111111111111111111",
  drainTxHash: "tx-review-drain",
  spenderAddress: "TSpender1111111111111111111111111111",
  operatorAddress: "TOperator111111111111111111111111111",
  spenderResolution: "wrapper_contract",
  firstReceiverAddress: subjectAddress,
  subjectAddress,
  reason: "service_boundary_guard",
  falsePositiveGuards: [{
    code: "service_boundary_route",
    label: "USDD PSM/GemJoin",
    address: "TService1111111111111111111111111111",
    category: "dex",
    identity: "USDD PSM"
  }],
  supportingFingerprints: []
}]
```

- [ ] **Step 2: Copy score-validity fields into report**

In `src/check/whereIsMoneyCheck.ts`, at the existing block:

```ts
  const decision = assessment.decision;
  const riskScore = assessment.riskScore;
  const decisionReasons = assessment.reasons;
```

add:

```ts
  const scoreValid = assessment.scoreValid;
  const scoreBlockedReason = assessment.scoreBlockedReason ?? null;
  const technicalStatus = assessment.technicalStatus ?? null;
```

Then include these fields in the returned report:

```ts
    scoreValid,
    scoreBlockedReason,
    technicalStatus,
```

- [ ] **Step 3: Store top-level snake-case score validity for Where jobs**

In `src/forensics/deepForensicJob.ts`, inside `runWhereIsMoneyJob`, before `completeForensicCheckJob`, add:

```ts
  const scoreValidityResult = report.scoreValid === false
    ? {
        score_valid: false,
        score_blocked_reason: report.scoreBlockedReason ?? "insufficient_coverage",
        technical_status: report.technicalStatus ?? "provider_cap_unresolved"
      }
    : {};
```

In the normal completion `resultJson`, include:

```ts
      ...scoreValidityResult,
```

Keep strict benchmark result fields taking precedence by spreading `strictCompletedResultJson()` after this object for strict completed jobs.

- [ ] **Step 4: Add generic admin score-validity summary test**

In `tests/admin/forensicsGraph.test.ts`, add:

```ts
it("projects non-strict score invalidity into the graph summary", () => {
  const result = projectForensicJobGraph(job({
    kind: "where_is_money_check",
    status: "failed",
    resultJson: {
      score_valid: false,
      score_blocked_reason: "insufficient_coverage",
      technical_status: "provider_cap_unresolved",
      whereIsMoneyReport: {
        subjectAddress: "TSubject111111111111111111111111111111",
        riskScore: 45,
        decision: "REVIEW",
        scoreValid: false,
        scoreBlockedReason: "insufficient_coverage",
        technicalStatus: "provider_cap_unresolved",
        coverage: { partial: true, notes: [] },
        assessment: { decision: "REVIEW", scoreValid: false, reasons: [], warnings: [] },
        originPaths: []
      }
    }
  }));

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.graph.summary.layerSummary?.scoreValidity).toMatchObject({
    scoreValid: false,
    scoreBlockedReason: "insufficient_coverage",
    technicalStatus: "provider_cap_unresolved"
  });
  expect(result.graph.summary.decision).not.toBe("DECLINE");
});
```

- [ ] **Step 5: Implement generic admin score-validity summary**

In `src/admin/forensicsGraph.ts`, add immediately after `function strictProvenanceSummary(...)`:

```ts
function scoreValiditySummary(result: Record<string, unknown>): Record<string, unknown> | null {
  const nestedWhere = recordField(result, "whereIsMoneyReport");
  const nestedIncoming = recordField(result, "incomingDepositReport");
  const source = result.score_valid !== undefined
    ? result
    : nestedWhere?.scoreValid !== undefined
      ? nestedWhere
      : nestedIncoming?.scoreValid !== undefined
        ? nestedIncoming
        : null;
  if (!source) return null;
  const scoreValid = source.score_valid === true || source.scoreValid === true
    ? true
    : source.score_valid === false || source.scoreValid === false
      ? false
      : null;
  return {
    scoreValid,
    scoreBlockedReason: stringField(source, "score_blocked_reason") ?? stringField(source, "scoreBlockedReason"),
    technicalStatus: stringField(source, "technical_status") ?? stringField(source, "technicalStatus")
  };
}
```

At the layer summary assembly, add:

```ts
  const scoreValidity = scoreValiditySummary(resultForStrictStatus);
```

and include it:

```ts
        scoreValidity,
```

Update the condition so `layerSummary` exists when `scoreValidity` exists.

- [ ] **Step 6: Add bot formatting test**

In `tests/bot/createBot.test.ts`, add this formatter test immediately after the existing test named `keeps where-is-money details available through the support formatter`:

```ts
it("does not show a final Where decline when score is invalid", () => {
  const whereReport = whereIsMoneyReportForTest({
    decision: "REVIEW",
    userDecision: "DECLINE",
    scoreValid: false,
    scoreBlockedReason: "insufficient_coverage",
    technicalStatus: "provider_cap_unresolved",
    proofLevel: "insufficient_coverage",
    decisionReasons: ["Approval-drain review is guarded; coverage is incomplete."]
  });

  const message = formatWhereIsMoneySupportReport(whereIsMoneyJobForTest(), whereReport, "partial", { locale: "en" });
  const text = plainTelegramText(message.text);

  expect(text).toContain("No final decision");
  expect(text).toContain("insufficient_coverage");
  expect(text).not.toContain("DECLINE");
});
```

- [ ] **Step 7: Implement bot invalid-score decision line**

In `src/bot/createBot.ts`, add this helper immediately before `export function formatWhereIsMoneySupportReport(...)`:

```ts
function whereDecisionDisplayLine(report: WhereIsMoneyReport, locale: BotLocale): string {
  if (report.scoreValid === false) {
    const reason = report.scoreBlockedReason ?? "insufficient_coverage";
    return `${bold(locale === "en" ? "Decision" : "Решение")}: ${code(locale === "en" ? "NO_FINAL_DECISION" : "НЕТ_ФИНАЛЬНОГО_РЕШЕНИЯ")} (${escapeHtml(reason)})`;
  }
  return `${bold(locale === "en" ? "Decision" : "Решение")}: ${code(report.userDecision)}`;
}
```

Replace direct Where decision lines:

```ts
`${bold(locale === "en" ? "Decision" : "Decision")}: ${code(report.userDecision)}`,
```

with:

```ts
whereDecisionDisplayLine(report, locale),
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
npx vitest run tests/check/whereIsMoneyCheck.test.ts tests/admin/forensicsGraph.test.ts tests/bot/createBot.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
git add src/check/whereIsMoneyCheck.ts src/forensics/deepForensicJob.ts src/admin/forensicsGraph.ts src/bot/createBot.ts tests/check/whereIsMoneyCheck.test.ts tests/admin/forensicsGraph.test.ts tests/bot/createBot.test.ts
git commit -m "fix(where): surface invalid score as technical coverage"
```

## Task 4: Incoming Technical Stop

**Files:**
- Modify: `tests/forensics/incomingDepositJob.test.ts`
- Modify: `src/forensics/incomingDepositJob.ts`

- [ ] **Step 1: Add report-builder test for targeted budget exhaustion**

In `tests/forensics/incomingDepositJob.test.ts`, add after `keeps incoming hop history incomplete when targeted ensure fails`:

```ts
it("marks incoming report score invalid when targeted history hits the page budget", async () => {
  const result = await buildIncomingDepositReport({
    deps: {
      listIndexedUsdtTransfersForAddress: async () => [],
      listRelatedTrc20Transfers: async () => [],
      ensureAddressUsdtHistory: async (input) => ({
        ...queuedTargetedIndexState({
          address: input.address,
          targetTimestamp: input.targetTimestamp ?? null,
          requestedByJobId: input.requestedByJobId ?? null,
          queuedReason: input.queuedReason
        }),
        status: "partial" as const,
        statusReason: "partial_budget_exhausted" as const,
        fetchedPageCount: 4,
        fetchedTransferCount: 50,
        budgetExhausted: true
      }),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getContractIntelligenceProfile: async () => null,
      getTransaction: async () => ({}),
      getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "1000000" })
    },
    job: job(validProgressJson),
    depositTxHash,
    watchedWallet: validProgressJson.watchedWallet,
    sender: validProgressJson.sender,
    amountRaw: validProgressJson.amountRaw,
    timestamp: new Date(validProgressJson.timestamp)
  });

  expect(result.scoreValid).toBe(false);
  expect(result.scoreBlockedReason).toBe("partial_budget_exhausted");
  expect(result.technicalStatus).toBe("provider_cap_unresolved");
  expect(result.targetedHistoryCoverage).toMatchObject({
    selectedDepositTxHash: depositTxHash,
    sender: validProgressJson.sender,
    partialHopCount: expect.any(Number),
    pagesFetched: expect.any(Number),
    transfersFetched: expect.any(Number),
    firstBlockingReason: "partial_budget_exhausted"
  });
});
```

- [ ] **Step 2: Add runner test for no score publication**

In `tests/forensics/incomingDepositJob.test.ts`, add under `describe("runSingleIncomingDepositJobCycle", ...)`:

```ts
it("finishes incoming deposit as technical failed when report score is invalid", async () => {
  const complete = vi.fn(async () => true);
  const recordRisk = vi.fn(async () => true);
  const send = vi.fn(async () => undefined);
  const markFailed = vi.fn(async () => true);

  const handled = await runSingleIncomingDepositJobCycle({
    claimNextForensicCheckJob: async () => job(validProgressJson),
    completeForensicCheckJob: complete,
    updateForensicCheckJobProgress: async () => true,
    markUserAlertSent: async () => true,
    markUserAlertFailed: markFailed,
    recordObservedTransactionRisk: recordRisk,
    sendUserAlert: send,
    formatIncomingDepositRiskAlert: () => ({ text: "<b>Incoming USDT</b>", parseMode: "HTML" }),
    buildReport: async () => report({
      scoreValid: false,
      scoreBlockedReason: "partial_budget_exhausted",
      technicalStatus: "provider_cap_unresolved",
      targetedHistoryCoverage: {
        selectedDepositTxHash: depositTxHash,
        sender: validProgressJson.sender,
        hopCount: 3,
        completeHopCount: 1,
        partialHopCount: 2,
        pagesFetched: 8,
        transfersFetched: 100,
        firstBlockingReason: "partial_budget_exhausted",
        firstBlockingAddress: validProgressJson.sender
      }
    })
  });

  expect(handled).toBe(true);
  expect(recordRisk).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(markFailed).toHaveBeenCalledWith({
    txHash: depositTxHash,
    watchedWalletId,
    error: "partial_budget_exhausted"
  });
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({
    status: "failed",
    lastError: "partial_budget_exhausted",
    resultJson: expect.objectContaining({
      score_valid: false,
      score_blocked_reason: "partial_budget_exhausted",
      technical_status: "provider_cap_unresolved",
      targetedHistoryCoverage: expect.objectContaining({
        partialHopCount: 2
      })
    })
  }));
});
```

- [ ] **Step 3: Run focused failing tests**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts --configLoader bundle
```

Expected before implementation: the new tests fail because reports do not expose `scoreValid=false` and the runner records/sends even invalid reports.

- [ ] **Step 4: Track targeted ensure result objects**

In `src/forensics/incomingDepositJob.ts`, add this local type immediately after `export type BuildIncomingDepositReportInput`:

```ts
type TargetedHistoryEnsureResult = {
  address: string;
  complete: boolean;
  status: TronAddressUsdtIndexState["status"] | "failed";
  statusReason: TronAddressUsdtIndexState["statusReason"] | "provider_error";
  fetchedPageCount: number;
  fetchedTransferCount: number;
};
```

Change:

```ts
  const targetedEnsureCache = new Map<string, Promise<boolean>>();
```

to:

```ts
  const targetedEnsureCache = new Map<string, Promise<TargetedHistoryEnsureResult>>();
  const targetedEnsureResults = new Map<string, TargetedHistoryEnsureResult>();
```

- [ ] **Step 5: Return detailed targeted ensure result**

Replace `ensureTargetedHistory` so it returns `TargetedHistoryEnsureResult`:

```ts
  const ensureTargetedHistory = async (
    address: string,
    fetchMaxTimestamp: Date,
    fetchOptions: { latestTimestamp?: Date }
  ): Promise<TargetedHistoryEnsureResult> => {
    if (!fetchOptions.latestTimestamp || !input.deps.ensureAddressUsdtHistory) {
      return {
        address,
        complete: true,
        status: "complete",
        statusReason: "complete_provider_windowed",
        fetchedPageCount: 0,
        fetchedTransferCount: 0
      };
    }
    const cacheKey = edgeCacheKey(address, fetchMaxTimestamp);
    const cached = targetedEnsureCache.get(cacheKey);
    if (cached) return cached;
    const ensureAddressUsdtHistory = input.deps.ensureAddressUsdtHistory;
    const ensured = Promise.resolve()
      .then(() => ensureAddressUsdtHistory({
        address,
        coverageMode: "targeted",
        targetTimestamp: fetchMaxTimestamp,
        stopAtTimestamp: fetchMaxTimestamp,
        requestedByJobId: input.job.id,
        queuedReason: "where_is_money_hop"
      }))
      .then((state): TargetedHistoryEnsureResult => {
        const complete = state.coverageMode === "targeted" && state.status === "complete";
        const result = {
          address,
          complete,
          status: state.status,
          statusReason: state.statusReason,
          fetchedPageCount: state.fetchedPageCount,
          fetchedTransferCount: state.fetchedTransferCount
        };
        targetedEnsureResults.set(cacheKey, result);
        if (!complete) {
          fetchWarnings.push(`targeted history ensure incomplete for ${address}: ${state.statusReason ?? state.status}`);
        }
        return result;
      })
      .catch((error): TargetedHistoryEnsureResult => {
        const result = {
          address,
          complete: false,
          status: "failed" as const,
          statusReason: "provider_error" as const,
          fetchedPageCount: 0,
          fetchedTransferCount: 0
        };
        targetedEnsureResults.set(cacheKey, result);
        fetchWarnings.push(`targeted history ensure failed for ${address}: ${formatErrorMessage(error)}`);
        return result;
      });
    targetedEnsureCache.set(cacheKey, ensured);
    return ensured;
  };
```

In `fetchEdgesForAddress`, replace:

```ts
    const targetedEnsureSucceeded = await ensureTargetedHistory(address, fetchMaxTimestamp, fetchOptions);
```

with:

```ts
    const targetedEnsureResult = await ensureTargetedHistory(address, fetchMaxTimestamp, fetchOptions);
```

and replace `targetedEnsureSucceeded` with `targetedEnsureResult.complete`.

- [ ] **Step 6: Summarize Incoming targeted coverage**

Add this helper immediately after `getHistoryCoverageForAddress`:

```ts
  const incomingScoreBlockedReasonFromTargeted = (result: TargetedHistoryEnsureResult): "partial_budget_exhausted" | "provider_cap_unresolved" | "provider_error" => {
    if (result.statusReason === "partial_budget_exhausted") return "partial_budget_exhausted";
    if (result.statusReason === "partial_provider_cap" || result.statusReason === "partial_provider_inconsistent") return "provider_cap_unresolved";
    return "provider_error";
  };

  const targetedCoverageSummary = (): IncomingDepositRiskReport["targetedHistoryCoverage"] | undefined => {
    const results = [...targetedEnsureResults.values()];
    if (results.length === 0) return undefined;
    const firstBlocking = results.find((result) => !result.complete) ?? null;
    return {
      selectedDepositTxHash: input.depositTxHash,
      sender: input.sender,
      hopCount: results.length,
      completeHopCount: results.filter((result) => result.complete).length,
      partialHopCount: results.filter((result) => !result.complete).length,
      pagesFetched: results.reduce((sum, result) => sum + result.fetchedPageCount, 0),
      transfersFetched: results.reduce((sum, result) => sum + result.fetchedTransferCount, 0),
      firstBlockingReason: firstBlocking ? incomingScoreBlockedReasonFromTargeted(firstBlocking) : null,
      firstBlockingAddress: firstBlocking?.address ?? null
    };
  };
```

- [ ] **Step 7: Mark report score invalid during assemble**

In the final `assemble` return, before returning the object, compute:

```ts
    const targetedCoverage = targetedCoverageSummary();
    const blockingReason = targetedCoverage?.firstBlockingReason ?? null;
```

Return:

```ts
    scoreValid: blockingReason ? false : true,
    scoreBlockedReason: blockingReason,
    technicalStatus: blockingReason ? "provider_cap_unresolved" : "completed",
    targetedHistoryCoverage: targetedCoverage,
```

inside the assembled report.

- [ ] **Step 8: Stop runner before risk recording and alert sending**

In `runSingleIncomingDepositJobCycle`, immediately after `const report = await timing.measure("build_report", ...)`, add:

```ts
    if (report.scoreValid === false) {
      const blockedReason = report.scoreBlockedReason ?? "partial_budget_exhausted";
      const technicalStatus = report.technicalStatus ?? "provider_cap_unresolved";
      await persistProgress({
        jobPhase: "provider_limited",
        incomingTargetedCoverage: report.targetedHistoryCoverage as unknown as Record<string, unknown>
      }, "persist_phase_provider_limited");
      await timing.measure("mark_alert_failed", () =>
        deps.markUserAlertFailed({ txHash: depositTxHash, watchedWalletId, error: blockedReason })
      );
      await persistPerformanceTiming();
      await timing.measure("fail_job", () => deps.completeForensicCheckJob({
        id: job.id,
        status: "failed",
        progressJson: currentProgress,
        resultJson: {
          ...(report as unknown as Record<string, unknown>),
          score_valid: false,
          score_blocked_reason: blockedReason,
          technical_status: technicalStatus
        },
        rawEvidenceIds: [],
        observationIds: [],
        lastError: blockedReason
      }));
      logTiming("failed");
      return true;
    }
```

- [ ] **Step 9: Run focused Incoming tests**

Run:

```bash
npx vitest run tests/forensics/incomingDepositJob.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 10: Commit Task 4**

Run:

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts src/types.ts
git commit -m "fix(incoming): stop scoring on targeted history budget"
```

## Task 5: Final Verification

**Files:**
- No new source files
- Verify all files changed by Tasks 1-4

- [ ] **Step 1: Run focused forensic tests**

Run:

```bash
npx vitest run tests/forensics/moneyOriginOperationalAssessment.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts tests/admin/forensicsGraph.test.ts tests/bot/createBot.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Manual live sanity run**

Use the last address from the live investigation:

```text
THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7
```

Run the local live harness already used for the previous live check, or trigger the same job kinds from Admin:

- `address_fast_check`
- `where_is_money_check`
- `address_deep_check`
- `incoming_deposit_check`

Expected:

- Where no longer shows a final user-facing `DECLINE` only from guarded approval-drain review plus incomplete hop coverage.
- Incoming does not remain `running` after targeted history budget exhaustion.
- If Incoming cannot cover targeted history, result has `score_valid=false`, `score_blocked_reason`, `technical_status`, and `targetedHistoryCoverage`.

- [ ] **Step 5: Final commit if verification changed snapshots or tests**

Run only if verification required updates to the planned files:

```bash
git status --short
git add src/types.ts src/forensics/moneyOriginOperationalAssessment.ts src/check/whereIsMoneyCheck.ts src/forensics/deepForensicJob.ts src/forensics/incomingDepositJob.ts src/admin/forensicsGraph.ts src/bot/createBot.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/incomingDepositJob.test.ts tests/admin/forensicsGraph.test.ts tests/bot/createBot.test.ts
git commit -m "test: verify where incoming outcome safety"
```

If `git status --short` shows no planned-file changes, do not create an empty commit.

## Self-Review

- Spec coverage:
  - Where guarded approval-drain review no longer becomes final user-facing decline: Task 2 and Task 3.
  - Incoming targeted history budget stop becomes technical `score_valid=false`: Task 4.
  - Minimal Incoming progress fields: Task 4 targeted coverage summary.
  - Admin/bot distinguish forensic decision from technical coverage failure: Task 3 and Task 4.
  - Background `waiting_for_targeted_index`, budget config, `missingChecks` categories, and DeepCheck second layer are explicitly out of this first implementation.
- Placeholder scan:
  - No unresolved placeholder markers.
  - No unspecified error handling steps.
  - Tests include concrete assertions and fixture shapes.
- Type consistency:
  - Report fields use camelCase in TypeScript: `scoreValid`, `scoreBlockedReason`, `technicalStatus`.
  - Stored job result fields use existing snake-case convention: `score_valid`, `score_blocked_reason`, `technical_status`.
  - `partial_budget_exhausted` is a score blocked reason, while `provider_cap_unresolved` is the user-visible technical status for the current inline provider-cap stop.
