import { describe, expect, it } from "vitest";
import {
  formatIncomingDepositRiskAlert,
  formatUserApprovalAlert
} from "../../src/alerts/formatters";
import { adaptTelegramForensicResult } from "../../src/telegram/forensicPresentationAdapters";
import { renderTelegramForensicResult } from "../../src/telegram/forensicResultRenderer";
import type { IncomingDepositRiskReport } from "../../src/types";
import { remediationTelegramUxCase } from "../fixtures/telegram/remediationTelegramUxCases";
import { REMEDIATION_TELEGRAM_GOLDEN_MESSAGES } from "../fixtures/telegram/remediationTelegramGoldenMessages";

function renderAlert(id: string): string {
  return renderTelegramForensicResult(adaptTelegramForensicResult(remediationTelegramUxCase(id).source));
}

function formatActualIncomingCallSite(): string {
  const source = remediationTelegramUxCase("INCOMING_APPROVAL_ROUTE_ROLES").source;
  const watchedReceiver = remediationTelegramUxCase("GOLDEN_GASFREE_ACCOUNT").source.checkedWalletAddress;
  const anchor = source.scoreAnchorV2;
  if (!anchor) throw new Error("incoming fixture requires a score anchor");
  const report: IncomingDepositRiskReport = {
    scoringPolicyVersion: anchor.policyVersion,
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    decision: anchor.decision,
    depositRiskScore: anchor.score,
    observedContextScore: anchor.score,
    riskBand: "CRITICAL",
    fastSenderRisk: null,
    originPaths: [],
    originCoverage: 1,
    fundingCoverage: {
      depositFundingCoverageRatio: 1,
      cleanSourceCoverageRatio: 0,
      exactContinuityCoverageRatio: 1
    },
    corridorSummary: null,
    provenanceConfidence: 100,
    dataQuality: "high",
    senderRole: "approval_drain_first_receiver",
    coverageV2: source.coverageV2 ?? undefined,
    hardBadEvidence: [{
      kind: "approval_drain",
      score: anchor.score,
      message: "sanitized exact approval-drain evidence",
      evidenceIds: [...anchor.evidenceIds]
    }],
    contractVerdicts: [],
    unifiedRiskSummary: {
      finalScore: anchor.score,
      finalLevel: "CRITICAL",
      finalDecision: anchor.decision,
      observedContextScore: anchor.score,
      scoreValid: true,
      decisionBasis: "exact_hard_proof",
      coverage: { required: "valid", overall: "complete", invalidModes: [], caveats: [] },
      hardEvidenceFloor: anchor.score,
      policyFloor: 0,
      assetContinuationFloor: 0,
      patternFloor: 0,
      dampener: 0,
      activeAnchor: {
        code: anchor.preferredFactId,
        message: "sanitized exact approval-drain evidence",
        score: anchor.score,
        source: "on_chain",
        row: anchor.matrixRow,
        evidenceIds: [...anchor.evidenceIds]
      },
      scoreAnchorV2: anchor,
      narrativeFactsV2: source.narrativeFactsV2,
      scoringEvidenceV2: source.scoringEvidenceV2,
      scoreAnchorDiagnostic: null
    },
    reasons: [],
    warnings: []
  };

  return formatIncomingDepositRiskAlert({
    jobId: "sanitized-incoming-job",
    amount: "13302",
    watchedWallet: watchedReceiver,
    sender: source.checkedWalletAddress,
    txHash: "b".repeat(64),
    timestamp: new Date("2026-07-16T12:00:00.000Z"),
    locale: "ru",
    report
  }).text;
}

function formatActualApprovalCallSite(id: "GOLDEN_VERIFY20_ACTIVE_NO_DEBIT" | "GOLDEN_BRIDGERS_ZERO"): string {
  const source = remediationTelegramUxCase(id).source;
  const approval = source.approvalInput;
  if (!approval) throw new Error("approval fixture requires presentation input");
  const input: Parameters<typeof formatUserApprovalAlert>[0] & {
    approvalPresentationInput: typeof approval;
  } = {
    locale: "ru",
    watchedWallet: approval.assessment.subjectAddress,
    token: "USDT",
    spender: approval.assessment.allowance.spenderAddress,
    spenderType: "contract",
    allowanceType: approval.assessment.allowance.isUnlimited ? "unlimited" : "finite",
    allowanceAmount: approval.assessment.allowance.confirmedAllowanceRaw ?? undefined,
    approvalAt: new Date("2026-07-16T12:00:00.000Z"),
    expirationAt: new Date("2036-07-16T12:00:00.000Z"),
    approvalTxHash: approval.assessment.allowance.observedApprovalTxHash ?? "a".repeat(64),
    report: {
      subjectAddress: approval.assessment.subjectAddress,
      level: approval.assessment.level === "UNKNOWN" ? "HIGH" : approval.assessment.level,
      score: approval.assessment.score ?? 0,
      reasons: []
    },
    approvalPresentationInput: approval
  };

  return formatUserApprovalAlert(input).text;
}

describe("unified Telegram alert acceptance", () => {
  it("[REQ-02][REQ-08][INCOMING-WIRING] routes the real Incoming formatter through the common presentation", () => {
    const html = formatActualIncomingCallSite();
    const source = remediationTelegramUxCase("INCOMING_APPROVAL_ROUTE_ROLES").source;

    expect(html).toContain(`https://tronscan.org/#/address/${source.checkedWalletAddress}`);
    expect(html).toMatch(/кошел[её]к.*выдал доступ/i);
    expect(html).toMatch(/контракт.*получил доступ/i);
    expect(html).not.toMatch(/Быстрая проверка|fast sender/i);
  });

  it("[REQ-02][REQ-18][APPROVAL-WIRING] routes the real Approval formatter through the common presentation", () => {
    expect(formatActualApprovalCallSite("GOLDEN_VERIFY20_ACTIVE_NO_DEBIT")).toBe(
      REMEDIATION_TELEGRAM_GOLDEN_MESSAGES.GOLDEN_VERIFY20_ACTIVE_NO_DEBIT
    );
    expect(formatActualApprovalCallSite("GOLDEN_BRIDGERS_ZERO")).toBe(
      REMEDIATION_TELEGRAM_GOLDEN_MESSAGES.GOLDEN_BRIDGERS_ZERO
    );
  });

  it("[AC-07] renders the active non-Fast score anchor first", () => {
    const html = renderAlert("INCOMING_APPROVAL_ROUTE_ROLES");

    expect(html.indexOf("списан")).toBeLessThan(html.indexOf("Движение денег"));
    expect(html).not.toMatch(/fast|быстр.*провер/i);
  });

  it("[AC-08] links the checked wallet in every Telegram result type", () => {
    for (const id of ["INCOMING_APPROVAL_ROUTE_ROLES", "GOLDEN_VERIFY20_ACTIVE_NO_DEBIT"]) {
      const source = remediationTelegramUxCase(id).source;
      expect(renderAlert(id), id).toContain(`https://tronscan.org/#/address/${source.checkedWalletAddress}`);
    }
  });

  it("[AC-20] shows confirmed balance at risk and no debit found", () => {
    const html = renderAlert("GOLDEN_VERIFY20_ACTIVE_NO_DEBIT");

    expect(html).toContain("4 084,665 USDT");
    expect(html).toContain("Фактическое списание через этот контракт: не найдено");
    expect(html).not.toMatch(/кражи не было|средства в безопасности/i);
  });

  it("[AC-21] keeps campaign counts and BTTOLD sequence as context only", () => {
    const html = renderAlert("GOLDEN_VERIFY20_ACTIVE_NO_DEBIT");

    expect(html).toMatch(/Связи кампании и BTTOLD-последовательность — контекст, а не доказательство кражи/);
    expect(html).toContain("90/100");
    expect(html).not.toMatch(/BTTOLD.*доказыва|кампани.*доказыва/i);
  });

  it("[AC-24] reports failed allowance check as unconfirmed current state", () => {
    for (const id of ["BRIDGERS_FAILED", "BRIDGERS_STALE"]) {
      const html = renderAlert(id);
      expect(html, id).toMatch(/подтвердить не удалось|нельзя утверждать/i);
      expect(html, id).not.toMatch(/сейчас: активное|сейчас: 0 USDT|разрешение больше не активно/i);
    }
  });

  it("[AC-27] omits transaction expiration from approval Telegram copy", () => {
    for (const id of [
      "GOLDEN_VERIFY20_ACTIVE_NO_DEBIT",
      "GOLDEN_VERIFY20_EXACT_DEBIT",
      "GOLDEN_BRIDGERS_ACTIVE",
      "GOLDEN_BRIDGERS_ZERO",
      "GOLDEN_BRIDGERS_ALLOWANCE_UNKNOWN"
    ]) {
      const html = renderAlert(id);
      expect(html, id).not.toMatch(/2036-07-16|истекает|expiration|deadline|срок действия/i);
    }
  });

  it("[REQ-08] keeps victim spender receiver and route roles distinct", () => {
    const html = renderAlert("INCOMING_APPROVAL_ROUTE_ROLES");

    expect(html).toMatch(/кошел[её]к.*выдал доступ/i);
    expect(html).toMatch(/контракт.*получил доступ/i);
    expect(html).toMatch(/получател/i);
    expect(html).toContain("→");
  });

  it("[REQ-11] deduplicates one physical transfer across mode facts", () => {
    const html = renderAlert("DEDUPLICATED_PHYSICAL_TRANSFER");

    expect(html.split("305 USDT")).toHaveLength(2);
    expect(html.split("→")).toHaveLength(2);
  });

  it("[REQ-18] keeps approval wallet safety separate from an AML decision", () => {
    for (const id of ["GOLDEN_VERIFY20_ACTIVE_NO_DEBIT", "GOLDEN_BRIDGERS_ACTIVE"]) {
      const html = renderAlert(id);
      expect(html, id).toMatch(/риск для кошелька|разрешение больше не активно/i);
      expect(html, id).not.toMatch(/AML|решение обменника|Операцию не проводить/i);
    }
  });

  it("[REQ-18][APPROVAL-ISOLATION] keeps approval out of AML Where and provenance sections", () => {
    const html = renderAlert("GOLDEN_VERIFY20_EXACT_DEBIT");

    expect(html).not.toMatch(/Движение денег|Покрытие|Откуда деньги|происхождение средств/i);
  });

  it("[REQ-22] ignores transaction envelope expiration on every approval surface", () => {
    for (const id of [
      "GOLDEN_VERIFY20_ACTIVE_NO_DEBIT",
      "GOLDEN_VERIFY20_EXACT_DEBIT",
      "GOLDEN_BRIDGERS_ACTIVE",
      "GOLDEN_BRIDGERS_ZERO",
      "BRIDGERS_FAILED",
      "BRIDGERS_STALE"
    ]) {
      expect(renderAlert(id), id).not.toMatch(/2036|expiration|deadline|истека|срок действия/i);
    }
  });

  it("[REQ-18][APPROVAL-ROLES] renders checked owner spender current allowance and exact debit as separate roles", () => {
    const html = renderAlert("GOLDEN_VERIFY20_EXACT_DEBIT");
    const owner = html.indexOf("Проверяемый кошелёк — кошелёк, который выдал доступ к USDT");
    const spender = html.indexOf("Контракт, получивший доступ к USDT");
    const current = html.indexOf("Разрешение на управление USDT сейчас");
    const debit = html.indexOf("Фактическое списание через этот контракт");

    expect(owner).toBeGreaterThan(-1);
    expect(spender).toBeGreaterThan(owner);
    expect(current).toBeGreaterThan(spender);
    expect(debit).toBeGreaterThan(current);
    expect(html).toContain("TGyt…ZAZD");
    expect(html).toContain("TFag…nXzK");
    expect(html).toContain("13 302 USDT");
  });

  it("[REQ-18][AC-20][APPROVAL-AUDIENCE] chooses conditional actions for watched and externally checked wallets", () => {
    const watched = renderAlert("VERIFY20_ACTIVE_WATCHED_NO_DEBIT");
    const external = renderAlert("GOLDEN_VERIFY20_ACTIVE_NO_DEBIT");

    expect(watched).toContain("Если это ваш кошелёк — отзовите разрешение");
    expect(external).toContain("Если вы проверяете чужой кошелёк — не переводите на него деньги");
    expect(watched).not.toContain("вы владелец");
    expect(external).not.toContain("вы владелец");
  });

  it("[REQ-20][AC-20][VERIFY20-ACTIVE] requires official USDT confirmation and renders unlimited finite balance and no debit", () => {
    const unlimited = renderAlert("GOLDEN_VERIFY20_ACTIVE_NO_DEBIT");
    const finite = renderAlert("VERIFY20_FINITE_ACTIVE");

    expect(unlimited).toMatch(/активное, безлимитное; подтверждено напрямую в официальном контракте USDT/);
    expect(finite).toMatch(/активное, 500 USDT; подтверждено напрямую в официальном контракте USDT/);
    for (const html of [unlimited, finite]) {
      expect(html).toContain("4 084,665 USDT");
      expect(html).toMatch(/списание.*не найдено/i);
    }
  });

  it("[REQ-20][VERIFY20-DEBIT] renders exact debit without claiming theft", () => {
    const html = renderAlert("GOLDEN_VERIFY20_EXACT_DEBIT");

    expect(html).toContain("Фактическое списание через этот контракт: подтверждено, 13 302 USDT");
    expect(html).toContain("само по себе не доказывает кражу");
    expect(html).not.toMatch(/деньги украдены|владелец участвовал в атаке/i);
  });

  it("[REQ-20][VERIFY20-DEBIT-BINDING] rejects a foreign exact debit profile and amount", () => {
    const html = renderAlert("FOREIGN_EXACT_DEBIT_PROFILE");

    expect(html).not.toContain("13 302 USDT");
    expect(html).not.toMatch(/списание.*подтверждено/i);
    expect(html).toMatch(/не подтверждено|не рассчитан|проверить/i);
  });

  it("[REQ-18][BRIDGERS-ACTIVE] renders explained active session as low risk with optional hygiene", () => {
    const html = renderAlert("GOLDEN_BRIDGERS_ACTIVE");

    expect(html).toBe(REMEDIATION_TELEGRAM_GOLDEN_MESSAGES.GOLDEN_BRIDGERS_ACTIVE);
    expect(html).toContain("91,103009 USDT");
    expect(html).toContain("через 66 секунд");
    expect(html).toContain("10/100 — низкий риск для кошелька");
    expect(html).toMatch(/можно отозвать.*цифровую гигиену/i);
  });

  it("[REQ-18][BRIDGERS-ZERO] renders confirmed zero as inactive with no action", () => {
    const html = renderAlert("GOLDEN_BRIDGERS_ZERO");

    expect(html).toBe(REMEDIATION_TELEGRAM_GOLDEN_MESSAGES.GOLDEN_BRIDGERS_ZERO);
    expect(html).toContain("0/100 — разрешение больше не активно");
    expect(html).toContain("действий не требуется");
    expect(html).not.toContain("Что делать");
  });

  it("[REQ-18][AC-24][BRIDGERS-UNKNOWN] never calls failed or stale allowance active or revoked", () => {
    for (const id of ["BRIDGERS_FAILED", "BRIDGERS_STALE"]) {
      const html = renderAlert(id);
      expect(html, id).toMatch(/подтвердить не удалось|нельзя утверждать/i);
      expect(html, id).not.toMatch(/сейчас: активное|больше не активно|отозвано|0\/100/i);
    }
  });

  it("[REQ-22][AC-27][APPROVAL-NO-EXECUTION] omits expiration and never implies the bot revokes on chain", () => {
    for (const id of [
      "GOLDEN_VERIFY20_ACTIVE_NO_DEBIT",
      "GOLDEN_VERIFY20_EXACT_DEBIT",
      "GOLDEN_BRIDGERS_ACTIVE",
      "GOLDEN_BRIDGERS_ZERO",
      "GOLDEN_BRIDGERS_ALLOWANCE_UNKNOWN"
    ]) {
      const html = renderAlert(id);
      expect(html, id).not.toMatch(/expiration|deadline|истека|2036-07-16|бот (?:сам )?отзов|мы отзов[её]м|callback_data/i);
    }
  });
});
