import { describe, expect, it } from "vitest";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import type { SmartContractCheckReport } from "../../src/check/smartContractCheck";
import {
  formatDeepForensicUserDeliveryReport,
  formatSmartContractCheckReport,
  formatWhereIsMoneyUserDeliveryReport
} from "../../src/bot/createBot";
import type { ForensicCheckJob } from "../../src/storage/repositories";
import type { WhereIsMoneyReport } from "../../src/types";
import { adaptTelegramForensicResult } from "../../src/telegram/forensicPresentationAdapters";
import { renderTelegramForensicResult } from "../../src/telegram/forensicResultRenderer";
import {
  PERSISTED_COVERAGE_WHERE_REPORT,
  remediationTelegramUxCase
} from "../fixtures/telegram/remediationTelegramUxCases";
import { REMEDIATION_TELEGRAM_GOLDEN_MESSAGES } from "../fixtures/telegram/remediationTelegramGoldenMessages";

function renderMode(id: string): string {
  return renderTelegramForensicResult(adaptTelegramForensicResult(remediationTelegramUxCase(id).source));
}

function whereJob(status: "partial" | "completed"): ForensicCheckJob {
  const at = new Date("2026-07-16T12:00:00.000Z");
  return {
    id: `telegram-acceptance-${status}`,
    kind: "where_is_money_check",
    subjectAddress: PERSISTED_COVERAGE_WHERE_REPORT.subjectAddress,
    status,
    windowStart: at,
    windowEnd: at,
    priority: 100,
    chatId: "sanitized-plan4-test-chat",
    messageId: null,
    requestedBy: "sanitized-reviewer",
    progressJson: { locale: "ru" },
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: at,
    updatedAt: at,
    startedAt: at,
    completedAt: status === "completed" ? at : null
  };
}

function formatActualWhereCallSite(id: "GOLDEN_WHERE_PRELIMINARY" | "GOLDEN_FINAL_AML"): string {
  const source = remediationTelegramUxCase(id).source;
  const anchor = source.scoreAnchorV2;
  if (!anchor) throw new Error("Where fixture requires a score anchor");
  const report: WhereIsMoneyReport = {
    ...PERSISTED_COVERAGE_WHERE_REPORT,
    riskScore: anchor.score,
    decision: anchor.decision,
    userDecision: anchor.decision,
    internalDecision: anchor.decision,
    coverageV2: source.coverageV2 ?? undefined,
    scoreAnchorV2: anchor,
    narrativeFactsV2: source.narrativeFactsV2,
    scoringEvidenceV2: source.scoringEvidenceV2,
    assessment: {
      ...PERSISTED_COVERAGE_WHERE_REPORT.assessment,
      riskScore: anchor.score,
      decision: anchor.decision
    }
  };
  const status = id === "GOLDEN_WHERE_PRELIMINARY" ? "partial" : "completed";
  const job = whereJob(status);
  const pendingDeep = id === "GOLDEN_WHERE_PRELIMINARY"
    ? { ...whereJob("partial"), kind: "address_deep_check" as const, status: "queued" as const }
    : null;
  const actual = formatWhereIsMoneyUserDeliveryReport(job, report, status, pendingDeep, { locale: "ru" }).text;
  if (pendingDeep) {
    const noPendingDeep = formatWhereIsMoneyUserDeliveryReport(job, report, status, null, { locale: "ru" }).text;
    if (noPendingDeep.includes("Откуда деньги — предварительный результат")) {
      throw new Error("where_preliminary_requires_pending_deep");
    }
  }
  return actual;
}

function deepReport(): DeepAddressForensicReport {
  const at = new Date("2026-07-16T12:00:00.000Z");
  return {
    scoringPolicyVersion: "scoring-signal-matrix-v3",
    subjectAddress: PERSISTED_COVERAGE_WHERE_REPORT.subjectAddress,
    windowStart: at,
    windowEnd: at,
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
    firstHopBlacklistFacts: [],
    firstHopLabelFacts: [],
    firstHopBlacklistCoverage: {
      requiredForDecision: true,
      scope: "all_time",
      windowStart: null,
      windowEnd: null,
      directPrincipalTransferCoverage: "complete",
      materialCounterpartyCount: 0,
      checkedMaterialCounterpartyCount: 0,
      failedMaterialCounterpartyCount: 0,
      uncheckedMaterialCounterpartyCount: 0,
      blacklistCheckCoverage: "complete",
      incompleteReason: null,
      confirmedAdverseFactCount: 0,
      completeTimelineFactCount: 0,
      partialTimelineFactCount: 0
    },
    coverage: {
      sourceTransferPages: 0,
      inboundSendersExpanded: 0,
      transferEdges: 0
    },
    coverageDebug: {
      jobId: null,
      subjectAddress: PERSISTED_COVERAGE_WHERE_REPORT.subjectAddress,
      status: "completed",
      windowStart: at.toISOString(),
      windowEnd: at.toISOString(),
      summary: {
        sourceTransferPages: 0,
        transferEdges: 0,
        inboundSendersExpanded: 0,
        extendedIndexedEdges: 0,
        extendedFetchedAddresses: 0,
        apiKeyConfigured: null,
        thirtyDayTransferCount: null,
        historicalFallbackTransferCount: null,
        historicalFallbackRequestedLimit: null,
        directCounterpartyCount: 0,
        analyzedCounterpartyCount: 0,
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

function formatActualDeepCallSite(): string {
  const deepJob = { ...whereJob("completed"), kind: "address_deep_check" as const };
  const whereResultJob: ForensicCheckJob = {
    ...whereJob("completed"),
    resultJson: {
      subjectAddress: PERSISTED_COVERAGE_WHERE_REPORT.subjectAddress,
      whereIsMoneyReport: PERSISTED_COVERAGE_WHERE_REPORT
    }
  };
  return formatDeepForensicUserDeliveryReport(
    deepJob,
    deepReport(),
    "completed",
    whereResultJob,
    { locale: "ru" }
  ).text;
}

function formatActualContractCallSite(): string {
  const source = remediationTelegramUxCase("GOLDEN_GASFREE_ACCOUNT").source;
  const decision = source.contractDecision;
  if (!decision) throw new Error("GasFree contract fixture requires a deterministic decision");
  const at = new Date("2026-07-16T12:00:00.000Z");
  const report: SmartContractCheckReport = {
    subjectAddress: source.checkedWalletAddress,
    decision: decision.deterministic.decision,
    decisionScope: "contract_safety",
    riskScore: decision.deterministic.score,
    riskLevel: decision.deterministic.level,
    metadata: {
      address: source.checkedWalletAddress,
      source: "tronscan",
      name: "GasFree Account",
      tag: "GasFree Account",
      isContract: true,
      verified: true,
      accountType: 2,
      rawJson: {},
      fetchedAt: at,
      expiresAt: at
    },
    contractProfile: null,
    relatedApprovals: [],
    llmVerdict: null,
    exactDrainProven: false,
    verify20Fingerprint: {
      matched: false,
      selectors: [],
      blockedByTrustedService: true,
      missingSelectors: ["5082dd12", "fc61dd23", "ea4418d9", "f2fde38b"],
      mismatchedSelectors: []
    },
    serviceLabel: "GasFree Account",
    activityLabel: "normal",
    reasons: ["gasfree_account_service"],
    limitations: [],
    contractDecisionV2: decision
  };
  return formatSmartContractCheckReport(report, { locale: "ru" }).text;
}

describe("bot mode wiring uses the unified Telegram presentation boundary", () => {
  it("[REQ-02][REQ-12][BOT-WIRING] routes the real preliminary Where formatter through the common renderer", () => {
    expect(formatActualWhereCallSite("GOLDEN_WHERE_PRELIMINARY")).toBe(
      REMEDIATION_TELEGRAM_GOLDEN_MESSAGES.GOLDEN_WHERE_PRELIMINARY
    );
  });

  it("[REQ-02][BOT-WIRING] routes the real completed Where formatter through the common renderer", () => {
    expect(formatActualWhereCallSite("GOLDEN_FINAL_AML")).toBe(
      REMEDIATION_TELEGRAM_GOLDEN_MESSAGES.GOLDEN_FINAL_AML
    );
  });

  it("[REQ-02][REQ-15][DEEP-CALL-SITE] routes the real DeepCheck user formatter through the common renderer", () => {
    expect(formatActualDeepCallSite()).toBe(REMEDIATION_TELEGRAM_GOLDEN_MESSAGES.GOLDEN_FINAL_AML);
  });

  it("[REQ-27][CONTRACT-CALL-SITE] routes the real smart-contract formatter through the common renderer", () => {
    expect(formatActualContractCallSite()).toBe(REMEDIATION_TELEGRAM_GOLDEN_MESSAGES.GOLDEN_GASFREE_ACCOUNT);
  });

  it("[AC-07] renders the active non-Fast score anchor first", () => {
    const final = renderMode("GOLDEN_FINAL_AML");
    const preliminary = renderMode("GOLDEN_WHERE_PRELIMINARY");

    expect(final.indexOf("Кошелёк отправил 1 176 317 USDT")).toBeLessThan(final.indexOf("83% проверяемой суммы"));
    expect(preliminary.indexOf("83% выбранной суммы")).toBeLessThan(preliminary.indexOf("Движение денег"));
  });

  it("[AC-08] links the checked wallet in every Telegram result type", () => {
    for (const id of [
      "GOLDEN_WHERE_PRELIMINARY",
      "GOLDEN_FINAL_AML",
      "THJ_COLLECTOR_ONLY",
      "GOLDEN_GASFREE_ACCOUNT",
      "GOLDEN_NO_FINAL_TECHNICAL"
    ]) {
      const source = remediationTelegramUxCase(id).source;
      expect(renderMode(id), id).toContain(`https://tronscan.org/#/address/${source.checkedWalletAddress}`);
    }
  });

  it("[AC-39][UNIFIED-RENDERER] excludes every legacy LLM field and heading", () => {
    const html = renderMode("LEGACY_LLM_ALL_FIELDS");

    expect(html).not.toMatch(/LEGACY_|LLM|AI[- ]?вердикт|confidence|цитат/i);
  });

  it("[REQ-06][REQ-15] renders only the subject-bound deterministic score fact", () => {
    expect(renderMode("GOLDEN_FINAL_AML")).toBe(REMEDIATION_TELEGRAM_GOLDEN_MESSAGES.GOLDEN_FINAL_AML);
    expect(renderMode("INVALID_ADDRESS_AND_ANCHOR")).not.toMatch(/\b90\/100\b|Операцию не проводить/);
  });

  it("[REQ-12][REQ-13][REQ-14] keeps preliminary score-fact-only and action-free", () => {
    const html = renderMode("GOLDEN_WHERE_PRELIMINARY");

    expect(html).toBe(REMEDIATION_TELEGRAM_GOLDEN_MESSAGES.GOLDEN_WHERE_PRELIMINARY);
    expect(html).toContain("Предварительный риск: 78/100");
    expect(html).not.toMatch(/Операцию не проводить|не принимайте|Что делать|DeepCheck|завершил проверку/i);
  });

  it("[REQ-09][REQ-28] explains bridge HTX collector and PSM without a theft claim", () => {
    for (const id of ["GOLDEN_WHERE_PRELIMINARY", "HTX_HISTORICAL_CONTEXT", "THJ_COLLECTOR_ONLY", "GOLDEN_USDD_PSM"]) {
      expect(renderMode(id), id).not.toMatch(/кража доказана|украл|отмывание доказано/i);
    }
  });

  it("[REQ-27] renders deterministic contract decisions without model output", () => {
    expect(renderMode("GOLDEN_GASFREE_ACCOUNT")).toBe(REMEDIATION_TELEGRAM_GOLDEN_MESSAGES.GOLDEN_GASFREE_ACCOUNT);
    expect(renderMode("OFFICIAL_USDT_CONTRACT")).not.toMatch(/LLM|модел|confidence|citation/i);
  });

  it("[REQ-32][RUNTIME-HIDDEN] omits runtime branch and SHA from ordinary Telegram results", () => {
    for (const id of ["GOLDEN_WHERE_PRELIMINARY", "GOLDEN_FINAL_AML", "THJ_COLLECTOR_ONLY", "GOLDEN_GASFREE_ACCOUNT"]) {
      expect(renderMode(id), id).not.toMatch(/Runtime:|codex\/|d18067f6|\bSHA\b/i);
    }
  });

  it("[REQ-38] fails closed for invalid addresses facts and legacy denominators", () => {
    const invalid = renderMode("INVALID_ADDRESS_AND_ANCHOR");
    const technical = renderMode("GOLDEN_NO_FINAL_TECHNICAL");

    expect(invalid).not.toMatch(/\b\d{1,3}\/100\b/);
    expect(technical).toContain("Общее число доступных переводов в этом результате не сохранено");
  });
});
