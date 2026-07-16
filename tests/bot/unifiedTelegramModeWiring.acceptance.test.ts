import { describe, expect, it } from "vitest";
import { formatWhereIsMoneyReport } from "../../src/bot/createBot";
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
  return formatWhereIsMoneyReport(whereJob(status), report, status, { locale: "ru" }).text;
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
