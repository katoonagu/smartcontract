import { describe, expect, it } from "vitest";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import type { SmartContractCheckReport } from "../../src/check/smartContractCheck";
import {
  formatDeepForensicFailureUserDeliveryReport,
  formatDeepForensicUserDeliveryReport,
  formatSmartContractCheckReport,
  formatWhereIsMoneyUserDeliveryReport
} from "../../src/bot/createBot";
import { formatIncomingDepositRiskAlert } from "../../src/alerts/formatters";
import { collectUsddPsmRouteObservations } from "../../src/forensics/usddPsmRouteObservation";
import { resolveFinalDisposition } from "../../src/risk/finalDisposition";
import { materializeFreshScoreBindingV2 } from "../../src/risk/scoreAnchorV2";
import { scoreMatrixCandidates, type MatrixCandidate } from "../../src/risk/scoringSignalMatrix";
import type { ForensicCheckJob } from "../../src/storage/repositories";
import type {
  ContractDecisionEvidenceV1,
  ContractDecisionV2,
  ForensicCoverageV2,
  MoneyOriginPath,
  WhereIsMoneyReport
} from "../../src/types";
import {
  BRIDGE_SOURCE,
  BRIDGERS,
  OFFICIAL_USDT,
  PERSISTED_COVERAGE_WHERE_REPORT,
  TGYT,
  USDD_PSM
} from "../fixtures/telegram/remediationTelegramUxCases";

const AT = new Date("2026-07-17T12:00:00.000Z");
const PSM_TX = "a".repeat(64);
const DEEP_TX = "b".repeat(64);
const PSM_EVIDENCE = "where:event:psm-inbound";

function job(kind: ForensicCheckJob["kind"], status: ForensicCheckJob["status"]): ForensicCheckJob {
  return {
    id: `production-path-${kind}`,
    kind,
    subjectAddress: TGYT,
    status,
    windowStart: AT,
    windowEnd: AT,
    priority: 1,
    chatId: "test-chat",
    messageId: null,
    requestedBy: "test",
    progressJson: { locale: "ru" },
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: AT,
    updatedAt: AT,
    startedAt: AT,
    completedAt: status === "completed" || status === "failed" ? AT : null
  };
}

function psmPath(): MoneyOriginPath {
  return {
    balanceTransferTxHash: PSM_TX,
    balanceTransferEvidenceId: PSM_EVIDENCE,
    rootSourceAddress: USDD_PSM,
    rootSourceType: "decline_boundary",
    balanceShare: 0.83,
    exposureSourceKey: "usdd_psm_gemjoin",
    exposureSourceLabel: "USDD PSM",
    sourceExposureKind: "bridge_router_dex",
    effectiveExposureShare: 0.83,
    linkStrength: 1,
    scoreBreakdown: [],
    amountUsage: null,
    pathAddresses: [USDD_PSM, TGYT],
    txHashes: [PSM_TX],
    steps: [{
      txHash: PSM_TX,
      fromAddress: USDD_PSM,
      toAddress: TGYT,
      amountRaw: "83000000",
      timestamp: AT.toISOString()
    }],
    amountPreservationRatio: 1,
    timeSpanMs: 0,
    stoppedReason: "service_boundary",
    verdict: "REVIEW",
    riskScoreContribution: 45,
    reasons: ["RAW_PROVIDER_REASON_MUST_NOT_RENDER"]
  };
}

function coverage(overrides: Partial<ForensicCoverageV2> = {}): ForensicCoverageV2 {
  return {
    version: "forensic-coverage-v2",
    scope: "current_balance",
    availableInboundTxCount: 1,
    selectedInboundTxCount: 1,
    excludedInboundTxCount: 0,
    selectedAmountRaw: "100000000",
    tracedAmountRaw: "83000000",
    tracedShare: 0.83,
    unresolvedAmountRaw: "17000000",
    unresolvedShare: 0.17,
    exclusions: [],
    limitations: [],
    completeness: "partial",
    ...overrides
  };
}

function freshBinding(input: {
  row: MatrixCandidate["row"];
  score: number;
  signal: string;
  evidenceId: string;
  authority: MatrixCandidate["authority"];
}) {
  const subject = { decisionScope: "wallet_unified" as const, address: TGYT, txHash: null };
  const candidate: MatrixCandidate = {
    row: input.row,
    actionUnit: "wallet",
    score: input.score,
    evidenceIds: [input.evidenceId],
    evidenceEpisodeIds: ["episode:production-path"],
    atomicSignals: [input.signal],
    modifiers: [],
    caps: [],
    dampeners: [],
    caveats: [],
    subject,
    authority: input.authority
  };
  const matrix = scoreMatrixCandidates([candidate], {
    decisionScope: "wallet_unified",
    subjectAddress: TGYT,
    subjectTxHash: null,
    requiredCoverage: "wallet_provenance"
  });
  const disposition = resolveFinalDisposition({
    subject,
    matrixScore: matrix,
    coverage: { required: "valid", overall: "complete", invalidModes: [], caveats: [] },
    observedContextScore: input.score
  });
  const binding = materializeFreshScoreBindingV2({
    mode: "where",
    subjectAddress: TGYT,
    disposition,
    matrix
  });
  if (!binding.anchor) throw new Error("producer binding must have an anchor");
  return binding;
}

function reportWithBinding(
  binding: ReturnType<typeof freshBinding>,
  overrides: Partial<WhereIsMoneyReport> = {}
): WhereIsMoneyReport {
  const anchor = binding.anchor!;
  return {
    ...PERSISTED_COVERAGE_WHERE_REPORT,
    scoringPolicyVersion: "scoring-signal-matrix-v3",
    riskScore: anchor.score,
    decision: anchor.decision,
    userDecision: anchor.decision,
    internalDecision: anchor.decision,
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: null,
    scoreAnchorV2: anchor,
    narrativeFactsV2: binding.facts,
    scoringEvidenceV2: binding.evidence,
    scoreAnchorDiagnostic: null,
    assessment: {
      ...PERSISTED_COVERAGE_WHERE_REPORT.assessment,
      riskScore: anchor.score,
      decision: anchor.decision,
      scoreValid: true,
      scoreBlockedReason: null,
      technicalStatus: null
    },
    ...overrides
  };
}

function psmReport(): WhereIsMoneyReport {
  const binding = freshBinding({
    row: "source_policy",
    score: 45,
    signal: "exact_usdd_psm_exposure",
    evidenceId: PSM_EVIDENCE,
    authority: {
      kind: "policy",
      decisionEligibility: "review_only",
      coverageDependency: "wallet_provenance"
    }
  });
  expect(binding.facts[0]).toMatchObject({
    id: binding.anchor!.preferredFactId,
    subjectAddress: TGYT,
    mode: "where",
    amountRaw: null,
    share: null,
    addresses: []
  });
  const path = psmPath();
  return reportWithBinding(binding, {
    originPaths: [path],
    coverageV2: coverage(),
    usddPsmRouteObservations: collectUsddPsmRouteObservations({
      mode: "where",
      selectedAmountRaw: "100000000",
      paths: [path]
    })
  });
}

function deepReport(): DeepAddressForensicReport {
  return {
    scoringPolicyVersion: "scoring-signal-matrix-v3",
    subjectAddress: TGYT,
    windowStart: AT,
    windowEnd: AT,
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
    directCounterpartyInteractionProfiles: [{
      subjectAddress: TGYT,
      direction: "inbound",
      counterpartyAddress: BRIDGE_SOURCE,
      volumeRaw: "50000000",
      volumeRatio: 0.5,
      txCount: 1,
      firstSeen: AT.toISOString(),
      lastSeen: AT.toISOString(),
      txHashes: [DEEP_TX],
      transfers: [{
        txHash: DEEP_TX,
        fromAddress: BRIDGE_SOURCE,
        toAddress: TGYT,
        amountRaw: "50000000",
        timestamp: AT.toISOString(),
        method: "transfer",
        edgeType: "normal_transfer",
        economicRole: "principal"
      }],
      serviceCategory: null,
      identity: null,
      snapshot: {
        address: BRIDGE_SOURCE,
        riskScore: 20,
        riskLevel: "LOW",
        source: "fast_address_check",
        evidenceClass: "counterparty_behavior_context",
        reasons: [],
        partialNotes: []
      },
      interactionWeight: 1,
      scoreContribution: 0,
      evidenceClass: "counterparty_behavior_context",
      skippedReason: "counterparty_behavior_context"
    }],
    firstHopBlacklistFacts: [],
    firstHopLabelFacts: [],
    firstHopBlacklistCoverage: {
      requiredForDecision: true,
      scope: "all_time",
      windowStart: null,
      windowEnd: null,
      directPrincipalTransferCoverage: "complete",
      materialCounterpartyCount: 1,
      checkedMaterialCounterpartyCount: 1,
      failedMaterialCounterpartyCount: 0,
      uncheckedMaterialCounterpartyCount: 0,
      blacklistCheckCoverage: "complete",
      incompleteReason: null,
      confirmedAdverseFactCount: 0,
      completeTimelineFactCount: 0,
      partialTimelineFactCount: 0
    },
    coverageV2: coverage({ scope: "deep_history", completeness: "complete", unresolvedAmountRaw: "0", unresolvedShare: 0 }),
    coverage: { sourceTransferPages: 1, inboundSendersExpanded: 1, transferEdges: 1 },
    coverageDebug: {
      jobId: null,
      subjectAddress: TGYT,
      status: "completed",
      windowStart: AT.toISOString(),
      windowEnd: AT.toISOString(),
      summary: {
        sourceTransferPages: 1,
        transferEdges: 1,
        inboundSendersExpanded: 1,
        extendedIndexedEdges: 0,
        extendedFetchedAddresses: 0,
        apiKeyConfigured: true,
        thirtyDayTransferCount: 1,
        historicalFallbackTransferCount: 0,
        historicalFallbackRequestedLimit: 0,
        directCounterpartyCount: 1,
        analyzedCounterpartyCount: 1,
        expandedCounterpartyCount: 0,
        metadataEnrichedCounterpartyCount: 0,
        skippedCounterpartyCount: 0,
        legacyPartial: false
      },
      rows: [],
      missingChecks: [],
      notes: []
    }
  };
}

function contractReport(input: {
  subjectAddress: string;
  score: 0 | 10 | 45;
  evidence: ContractDecisionEvidenceV1[];
}): SmartContractCheckReport {
  const decision: ContractDecisionV2 = {
    finalSource: "deterministic",
    deterministic: {
      score: input.score,
      level: input.score === 45 ? "MEDIUM" : "LOW",
      decision: input.score === 45 ? "REVIEW" : "ACCEPTABLE",
      authority: "official_registry",
      evidenceIds: input.evidence.map((row) => row.id)
    },
    llm: null
  };
  return {
    subjectAddress: input.subjectAddress,
    decision: decision.deterministic.decision,
    decisionScope: "contract_safety",
    riskScore: input.score,
    riskLevel: decision.deterministic.level,
    metadata: {
      address: input.subjectAddress,
      source: "tronscan",
      name: null,
      tag: null,
      isContract: true,
      verified: true,
      accountType: 2,
      rawJson: {},
      fetchedAt: AT,
      expiresAt: AT
    },
    contractProfile: null,
    relatedApprovals: [],
    llmVerdict: null,
    exactDrainProven: false,
    verify20Fingerprint: {
      matched: false,
      selectors: [],
      blockedByTrustedService: true,
      missingSelectors: [],
      mismatchedSelectors: []
    },
    serviceLabel: null,
    activityLabel: "normal",
    reasons: [],
    limitations: [],
    contractDecisionV2: decision,
    contractDecisionEvidenceV1: input.evidence
  };
}

describe("unified Telegram production paths", () => {
  it("[PLAN4][REQ-07][REQ-10][REQ-12][PRODUCER-WHERE] enriches a real generic score binding from exact PSM route evidence for preliminary and final delivery", () => {
    const report = psmReport();
    const where = job("where_is_money_check", "completed");
    const pendingDeep = { ...job("address_deep_check", "queued"), completedAt: null };
    const preliminary = formatWhereIsMoneyUserDeliveryReport(where, report, "completed", pendingDeep, { locale: "ru" }).text;
    const final = formatWhereIsMoneyUserDeliveryReport(where, report, "completed", null, { locale: "ru" }).text;

    for (const html of [preliminary, final]) {
      expect(html).toContain("45/100");
      expect(html).toContain("83%");
      expect(html).toContain("USDD PSM");
      expect(html).toContain("децентрализованного сервиса обмена USDT и USDD с общей ликвидностью");
      expect(html).toContain(`https://tronscan.org/#/address/${USDD_PSM}`);
      expect(html).toContain("83 USDT");
      expect(html).not.toContain("RAW_PROVIDER_REASON_MUST_NOT_RENDER");
    }
    expect(preliminary).toContain("предварительный результат");
    expect(final).not.toContain("предварительный результат");
  });

  it("[PLAN4][REQ-09][PRODUCER-WHERE-PATH] renders an exact subject-bound generic bridge origin path", () => {
    const evidenceId = "where:event:generic-bridge";
    const binding = freshBinding({
      row: "source_policy",
      score: 45,
      signal: "source_policy_bridge_router_dex",
      evidenceId,
      authority: { kind: "policy", decisionEligibility: "review_only", coverageDependency: "wallet_provenance" }
    });
    const report = reportWithBinding(binding, {
      coverageV2: coverage({ tracedAmountRaw: "50000000", tracedShare: 0.5, unresolvedAmountRaw: "50000000", unresolvedShare: 0.5 }),
      originPaths: [{
        ...psmPath(),
        balanceTransferTxHash: DEEP_TX,
        balanceTransferEvidenceId: evidenceId,
        rootSourceAddress: BRIDGE_SOURCE,
        exposureSourceKey: "generic_bridge",
        exposureSourceLabel: "Bridge",
        sourceExposureKind: "bridge_router_dex",
        effectiveExposureShare: 0.5,
        balanceShare: 0.5,
        pathAddresses: [BRIDGE_SOURCE, TGYT],
        txHashes: [DEEP_TX],
        steps: [{
          txHash: DEEP_TX,
          fromAddress: BRIDGE_SOURCE,
          toAddress: TGYT,
          amountRaw: "50000000",
          timestamp: AT.toISOString()
        }]
      }],
      usddPsmRouteObservations: []
    });

    const where = job("where_is_money_check", "completed");
    const pendingDeep = { ...job("address_deep_check", "queued"), completedAt: null };
    const preliminary = formatWhereIsMoneyUserDeliveryReport(where, report, "completed", pendingDeep, { locale: "ru" }).text;
    const final = formatWhereIsMoneyUserDeliveryReport(where, report, "completed", null, { locale: "ru" }).text;

    for (const html of [preliminary, final]) {
      expect(html).toContain(`https://tronscan.org/#/address/${BRIDGE_SOURCE}`);
      expect(html).toContain("50 USDT");
      expect(html).toContain("50%");
      expect(html).toContain("мост или обменный сервис с общей ликвидностью");
      expect(html).toContain("более ранний источник сложнее отделить");
    }
  });

  it("[PLAN4][REQ-28][PRODUCER-PSM-BINDING] rejects tampered PSM service identity or extra unbound evidence", () => {
    const serviceTampered = psmReport();
    serviceTampered.usddPsmRouteObservations![0] = {
      ...serviceTampered.usddPsmRouteObservations![0]!,
      serviceAddress: BRIDGE_SOURCE
    };
    const evidenceTampered = psmReport();
    evidenceTampered.usddPsmRouteObservations![0] = {
      ...evidenceTampered.usddPsmRouteObservations![0]!,
      evidenceIds: [...evidenceTampered.usddPsmRouteObservations![0]!.evidenceIds, "unbound:evidence"]
    };

    for (const report of [serviceTampered, evidenceTampered]) {
      const html = formatWhereIsMoneyUserDeliveryReport(
        job("where_is_money_check", "completed"), report, "completed", null, { locale: "ru" }
      ).text;
      expect(html).not.toContain("USDD PSM");
      expect(html).not.toContain("83 USDT");
      expect(html).not.toContain(`https://tronscan.org/#/address/${USDD_PSM}`);
    }
  });

  it("[PLAN4][REQ-15][PRODUCER-DEEP] preserves the Where score anchor while showing independent exact Deep principal context", () => {
    const report = psmReport();
    const whereResultJob = {
      ...job("where_is_money_check", "completed"),
      resultJson: { subjectAddress: TGYT, whereIsMoneyReport: report }
    };
    const html = formatDeepForensicUserDeliveryReport(
      job("address_deep_check", "completed"),
      deepReport(),
      "completed",
      whereResultJob,
      { locale: "ru" }
    ).text;

    expect(html).toContain("45/100");
    expect(html).toContain(`https://tronscan.org/#/address/${USDD_PSM}`);
    expect(html).toContain(`https://tronscan.org/#/address/${BRIDGE_SOURCE}`);
    expect(html).toContain("50 USDT");
    expect(html).not.toMatch(/(?:55|65|75|90)\/100/);

    const multiTransferDeep = deepReport();
    const profile = multiTransferDeep.directCounterpartyInteractionProfiles![0]!;
    profile.txCount = 2;
    profile.txHashes.push("d".repeat(64));
    profile.transfers!.push({
      ...profile.transfers![0]!,
      txHash: "d".repeat(64),
      amountRaw: "25000000"
    });
    const multiHtml = formatDeepForensicUserDeliveryReport(
      job("address_deep_check", "completed"), multiTransferDeep, "completed", whereResultJob, { locale: "ru" }
    ).text;
    expect(multiHtml).not.toContain("50 USDT (50%");
  });

  it("[PLAN4][REQ-09][REQ-15][PRODUCER-DEEP-COLLECTOR] presents subject-bound collector flow from the real Deep operational profile", () => {
    const whereResultJob = {
      ...job("where_is_money_check", "completed"),
      resultJson: { subjectAddress: TGYT, whereIsMoneyReport: psmReport() }
    };
    const deep = deepReport();
    deep.directCounterpartyInteractionProfiles = [];
    deep.operationalFlowProfiles = [{
      subjectAddress: TGYT,
      windowStart: AT.toISOString(),
      windowEnd: AT.toISOString(),
      incomingVolumeRaw: "100000000",
      outgoingVolumeRaw: "80000000",
      incomingTxCount: 5,
      outgoingTxCount: 3,
      inflowToOutflowRatio: 0.8,
      topIncomingCounterparties: [],
      topOutgoingCounterparties: [{
        address: BRIDGERS,
        direction: "outgoing",
        volumeRaw: "60000000",
        txCount: 2,
        volumeRatio: 0.75,
        category: "router",
        identity: "Bridgers",
        isTerminalLiquidity: true,
        isHtxHuobi: false
      }],
      categoryBreakdown: [],
      terminalLiquidityIncomingRatio: 0,
      terminalLiquidityOutgoingRatio: 0.75,
      htxHuobiIncomingRatio: 0,
      htxHuobiOutgoingRatio: 0,
      bridgeDexRouterOutgoingRatio: 0.75,
      unknownContractOutgoingRatio: 0,
      historicalTransitScore: 80,
      historicalTransitBreakdown: {
        eligible: true,
        flowUsdt: 100,
        volumeScore: 7,
        passThrough: 0.8,
        passThroughScore: 16,
        serviceShare: 0.75,
        serviceShareScore: 19,
        score: 80
      },
      operationalScore: 50,
      features: [{
        code: "operational_flow_bridge_dex_router_outgoing",
        label: "RAW_OPERATIONAL_LABEL_MUST_NOT_RENDER",
        scoreImpact: 10,
        value: 0.75
      }]
    }];

    const html = formatDeepForensicUserDeliveryReport(
      job("address_deep_check", "completed"), deep, "completed", whereResultJob, { locale: "ru" }
    ).text;

    expect(html).toContain("коллектор");
    expect(html).toContain("60 USDT");
    expect(html).toContain("60%");
    expect(html).toContain(`https://tronscan.org/#/address/${BRIDGERS}`);
    expect(html).not.toContain("RAW_OPERATIONAL_LABEL_MUST_NOT_RENDER");

    const foreign = deepReport();
    foreign.directCounterpartyInteractionProfiles = [];
    foreign.operationalFlowProfiles = [{ ...deep.operationalFlowProfiles![0]!, subjectAddress: BRIDGE_SOURCE }];
    const foreignHtml = formatDeepForensicUserDeliveryReport(
      job("address_deep_check", "completed"), foreign, "completed", whereResultJob, { locale: "ru" }
    ).text;
    expect(foreignHtml).not.toContain("коллектор");
    expect(foreignHtml).not.toContain(`https://tronscan.org/#/address/${BRIDGERS}`);
  });

  it("[PLAN4][REQ-10][LOW-BALANCE] presents actual latest principal transfers and true no-activity only from typed recent-flow coverage", () => {
    const binding = freshBinding({
      row: "clean_or_operational",
      score: 0,
      signal: "where_clean_or_operational",
      evidenceId: DEEP_TX,
      authority: { kind: "clean", coverageDependency: "wallet_provenance" }
    });
    const recent = reportWithBinding(binding, {
      coverageV2: coverage({
        scope: "recent_flow",
        availableInboundTxCount: 2,
        selectedInboundTxCount: 2,
        selectedAmountRaw: "75000000",
        tracedAmountRaw: "75000000",
        tracedShare: 1,
        unresolvedAmountRaw: "0",
        unresolvedShare: 0,
        completeness: "complete"
      }),
      recentFlowPrincipalTransfers: [{
        txHash: DEEP_TX,
        fromAddress: BRIDGE_SOURCE,
        toAddress: TGYT,
        direction: "incoming",
        amountRaw: "75000000",
        timestamp: AT.toISOString(),
        economicRole: "principal"
      }]
    });
    const recentHtml = formatWhereIsMoneyUserDeliveryReport(
      job("where_is_money_check", "completed"), recent, "completed", null, { locale: "ru" }
    ).text;
    expect(recentHtml).toContain("75 USDT");
    expect(recentHtml).toContain(`https://tronscan.org/#/address/${BRIDGE_SOURCE}`);

    const noActivity: WhereIsMoneyReport = {
      ...recent,
      scoreValid: false,
      scoreBlockedReason: null,
      technicalStatus: null,
      scoreAnchorV2: null,
      narrativeFactsV2: [],
      scoringEvidenceV2: [],
      recentFlowPrincipalTransfers: [],
      coverageV2: coverage({
        scope: "recent_flow",
        availableInboundTxCount: 0,
        selectedInboundTxCount: 0,
        selectedAmountRaw: "0",
        tracedAmountRaw: "0",
        tracedShare: null,
        unresolvedAmountRaw: "0",
        unresolvedShare: null,
        completeness: "complete"
      }),
      assessment: { ...recent.assessment, scoreValid: false, scoreBlockedReason: null, technicalStatus: null }
    };
    const emptyHtml = formatWhereIsMoneyUserDeliveryReport(
      job("where_is_money_check", "completed"), noActivity, "completed", null, { locale: "ru" }
    ).text;
    expect(emptyHtml).toContain("нет входящих переводов основной суммы");
    expect(emptyHtml).not.toContain("Источник данных завершил проверку с ошибкой");
  });

  it("[PLAN4][REQ-27][CONTRACT-REGISTRY] reserves official-USDT copy for the canonical token contract and uses registered-service copy for other registry outcomes", () => {
    const official = formatSmartContractCheckReport(contractReport({
      subjectAddress: OFFICIAL_USDT,
      score: 0,
      evidence: [{
        id: "registry:official-tron-usdt",
        kind: "official_registry",
        subjectAddress: OFFICIAL_USDT,
        spenderAddress: null,
        tokenContract: null
      }]
    }), { locale: "ru" }).text;
    const service = formatSmartContractCheckReport(contractReport({
      subjectAddress: BRIDGERS,
      score: 10,
      evidence: [{
        id: "registry:bridgers",
        kind: "official_registry",
        subjectAddress: BRIDGERS,
        spenderAddress: null,
        tokenContract: null
      }]
    }), { locale: "ru" }).text;
    const activeService = formatSmartContractCheckReport(contractReport({
      subjectAddress: BRIDGERS,
      score: 45,
      evidence: [{
        id: "registry:bridgers",
        kind: "official_registry",
        subjectAddress: BRIDGERS,
        spenderAddress: null,
        tokenContract: null
      }, {
        id: "allowance:bridgers",
        kind: "allowance_read",
        subjectAddress: BRIDGERS,
        spenderAddress: BRIDGERS,
        tokenContract: OFFICIAL_USDT
      }]
    }), { locale: "ru" }).text;

    expect(official).toContain("официальный контракт USDT");
    for (const html of [service, activeService]) {
      expect(html).toContain("известный сервис");
      expect(html).not.toContain("официальный контракт USDT");
    }
    expect(activeService).toContain("45/100");
  });

  it("[PLAN4][REQ-31][DEEP-FAILURE] renders terminal Deep failures as linked technical results without raw errors or runtime metadata", () => {
    const error = "RAW_JOB_FAILURE_<b>owned</b>_provider_secret";
    const failedJob = { ...job("address_deep_check", "failed"), lastError: error };
    const html = formatDeepForensicFailureUserDeliveryReport(failedJob, error, null, {
      locale: "ru",
      runtimeLabel: "master-secret-runtime"
    }).text;

    expect(html).toContain(`https://tronscan.org/#/address/${TGYT}`);
    expect(html).toContain("Итоговая оценка не рассчитана");
    expect(html).not.toMatch(/RAW_JOB_FAILURE|provider_secret|production-path-address_deep_check|master-secret-runtime|<b>owned<\/b>|Reason|Job/);
    expect(html).not.toMatch(/\b\d{1,3}\/100\b/);

    const matchingWhere = {
      ...job("where_is_money_check", "completed"),
      resultJson: { subjectAddress: TGYT, whereIsMoneyReport: psmReport() }
    };
    const withWhere = formatDeepForensicFailureUserDeliveryReport(failedJob, error, matchingWhere, { locale: "ru" }).text;
    expect(withWhere).toContain("Итоговая оценка не рассчитана");
    expect(withWhere).not.toMatch(/45\/100|USDD PSM|RAW_JOB_FAILURE/);
  });

  it("[PLAN4][REQ-22][REQ-31][INCOMING-FALLBACK] uses a linked no-final result for legacy Incoming payloads without raw decisions or reasons", () => {
    const html = formatIncomingDepositRiskAlert({
      jobId: "incoming-legacy-job",
      amount: "15",
      watchedWallet: TGYT,
      sender: BRIDGE_SOURCE,
      txHash: "c".repeat(64),
      timestamp: AT,
      locale: "ru",
      addressPoisoningWarningActive: true,
      report: {
        decision: "DECLINE",
        depositRiskScore: 95,
        observedContextScore: 95,
        riskBand: "CRITICAL",
        reasons: ["RAW_LEGACY_DECISION_REASON_<script>"],
        originPaths: [],
        fundingCoverage: { depositFundingCoverageRatio: 0, cleanSourceCoverageRatio: 0 },
        provenanceConfidence: 0,
        senderRole: "unknown",
        fastSenderRisk: null
      } as never
    });

    expect(html.text).toContain(`https://tronscan.org/#/address/${BRIDGE_SOURCE}`);
    expect(html.text).toContain("Итоговая оценка не рассчитана");
    expect(html.text).toContain("Предупреждение о возможной подмене адреса остаётся активным");
    expect(html.text).not.toMatch(/RAW_LEGACY|DECLINE|95\/100|<script>|Runtime|Job/);
    expect(html.replyMarkup.inline_keyboard.length).toBeGreaterThan(0);
  });
});
