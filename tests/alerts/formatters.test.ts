import { describe, expect, it } from "vitest";
import {
  TELEGRAM_MESSAGE_LIMIT,
  formatAdminApprovalAlert,
  formatAdminSuspiciousAlert,
  formatDigestAlert,
  formatIncomingDepositRiskAlert,
  formatUserApprovalAlert,
  formatUserApprovalContextResultAlert,
  formatUserApprovalPendingAlert,
  formatUserIncomingAlert
} from "../../src/alerts/formatters";
import { escapeHtml, formatRiskLine } from "../../src/alerts/telegramHtml";
import type { IncomingDepositRiskReport } from "../../src/types";
import { remediationTelegramUxCase } from "../fixtures/telegram/remediationTelegramUxCases";

const report = {
  subjectAddress: "TSender111111111111111111111111111111",
  level: "HIGH" as const,
  score: 82,
  reasons: [
    { code: "split_pattern", message: "Repeated split transfers detected", scoreImpact: 30 },
    { code: "risky_1_hop", message: "1-hop connection to risky address", scoreImpact: 35 }
  ]
};

const incomingDepositBaseInput = {
  jobId: "job-123",
  amount: "384064.001319",
  watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
  sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
  txHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
  timestamp: new Date("2026-05-31T11:02:00.000Z"),
  report: {
    decision: "DECLINE" as const,
    depositRiskScore: 68,
    observedContextScore: 68,
    riskBand: "HIGH" as const,
    fastSenderRisk: {
      subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      score: 0,
      level: "LOW" as const,
      reasons: []
    },
    originPaths: [],
    originCoverage: 0.76,
    fundingCoverage: {
      depositFundingCoverageRatio: 0.76,
      cleanSourceCoverageRatio: 0,
      exactContinuityCoverageRatio: 0.76
    },
    corridorSummary: null,
    provenanceConfidence: 62,
    dataQuality: "medium" as const,
    senderRole: "fresh_one_shot_wallet",
    hardBadEvidence: [],
    contractVerdicts: [],
    reasons: ["Sender was funded shortly before this deposit by unknown smart contract."],
    warnings: []
  }
};

function typedIncomingReport(): IncomingDepositRiskReport {
  const source = remediationTelegramUxCase("INCOMING_APPROVAL_ROUTE_ROLES").source;
  const anchor = source.scoreAnchorV2;
  if (!anchor) throw new Error("incoming fixture requires a score anchor");
  return {
    ...incomingDepositBaseInput.report,
    scoringPolicyVersion: anchor.policyVersion,
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    decision: anchor.decision,
    depositRiskScore: anchor.score,
    observedContextScore: anchor.score,
    riskBand: "CRITICAL",
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
      activeAnchor: null,
      scoreAnchorV2: anchor,
      narrativeFactsV2: source.narrativeFactsV2,
      scoringEvidenceV2: source.scoringEvidenceV2,
      scoreAnchorDiagnostic: null
    }
  };
}

describe("alert formatters", () => {
  it("formats user incoming alert with score, HTML parse mode, and reasons", () => {
    const message = formatUserIncomingAlert({
      amount: "12450",
      watchedWallet: "TWallet111111111111111111111111111111",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("<b>Incoming USDT</b>");
    expect(message.text).toContain("<b>Watched wallet</b>: <code>TWallet111111111111111111111111111111</code>");
    expect(message.text).toContain("<b>High risk</b>");
    expect(message.text).toContain("<code>82/100</code>");
    expect(message.text).toContain("Repeated split transfers detected");
  });

  it("formats final incoming deposit risk in Russian by default with sender risk separated", () => {
    const message = formatIncomingDepositRiskAlert(incomingDepositBaseInput);

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("<b>Входящий USDT");
    expect(message.text).toContain("31.05.2026 14:02 MSK");
    expect(message.text).toContain("<b>Решение</b>: <code>DECLINE</code>");
    expect(message.text).toContain("<b>Риск депозита</b>: 🟠 <code>68/100</code> (<code>HIGH</code>)");
    expect(message.text).toContain("<b>Быстрая проверка отправителя</b>: <code>0/100</code> (<code>LOW</code>)");
    expect(message.text).toContain("<b>Покрытие депозита</b>: <code>76%</code>");
    expect(message.text).toContain("<b>Чистый источник</b>: <code>0%</code>");
    expect(message.text).toContain("<b>уверенность</b>: <code>средняя</code>");
    expect(message.text).toContain("<b>Роль отправителя</b>");
    expect(message.text).not.toContain("Data quality");
    expect(message.text).not.toContain("<b>AI-оценка контракта</b>");
    expect(message.text).not.toContain("подозрительный неизвестный контракт 68/100 для");
    expect(message.text).not.toContain("<b>AI contract verdict</b>");
    expect(message.text).not.toContain("<b>Fast sender check</b>");
    expect(message.text).not.toContain("68/100 for");
    expect(message.text).not.toContain("Отправитель получил средства от неизвестного смарт-контракта незадолго до депозита.");
    expect(message.text).toContain("Отправитель был пополнен неизвестным смарт-контрактом незадолго до этого депозита.");
    expect(message.text).not.toContain("Low risk: <code>0/100</code>");
    expect(JSON.stringify(message.replyMarkup?.inline_keyboard)).toContain("check:deposit:job-123");
  });

  it("[REQ-08][INCOMING-SUBJECT-BINDING] links the scored Incoming subject when the watched receiver differs", () => {
    const source = remediationTelegramUxCase("INCOMING_APPROVAL_ROUTE_ROLES").source;
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      sender: source.checkedWalletAddress,
      report: typedIncomingReport()
    });

    expect(source.checkedWalletAddress).not.toBe(incomingDepositBaseInput.watchedWallet);
    expect(message.text).toContain(`https://tronscan.org/#/address/${source.checkedWalletAddress}`);
    expect(message.text).toContain("95/100");
    expect(message.text).not.toContain("Итоговая оценка не рассчитана");
  });

  it("[REQ-08][INCOMING-SUBJECT-FAIL-CLOSED] rejects a foreign anchor and keeps a no-anchor result unscored", () => {
    const source = remediationTelegramUxCase("INCOMING_APPROVAL_ROUTE_ROLES").source;
    const foreignSender = remediationTelegramUxCase("GOLDEN_GASFREE_ACCOUNT").source.checkedWalletAddress;
    const foreign = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      sender: foreignSender,
      report: typedIncomingReport()
    });
    const noAnchorReport = typedIncomingReport();
    noAnchorReport.scoreValid = false;
    noAnchorReport.decision = "NO_FINAL_DECISION";
    noAnchorReport.depositRiskScore = null;
    noAnchorReport.riskBand = null;
    noAnchorReport.unifiedRiskSummary = {
      ...noAnchorReport.unifiedRiskSummary!,
      finalScore: null,
      finalLevel: null,
      finalDecision: "NO_FINAL_DECISION",
      scoreValid: false,
      scoreAnchorV2: null,
      narrativeFactsV2: [],
      scoringEvidenceV2: []
    };
    const noAnchor = formatIncomingDepositRiskAlert({ ...incomingDepositBaseInput, sender: foreignSender, report: noAnchorReport });

    for (const message of [foreign, noAnchor]) {
      expect(message.text).toContain(`https://tronscan.org/#/address/${foreignSender}`);
      expect(message.text).toContain("Итоговая оценка не рассчитана");
      expect(message.text).not.toContain("95/100");
    }
    expect(source.checkedWalletAddress).not.toBe(foreignSender);
  });

  it("[REQ-15][INCOMING-CANONICAL-LEVEL] fails closed when the saved final level is missing or disagrees with the anchor", () => {
    const source = remediationTelegramUxCase("INCOMING_APPROVAL_ROUTE_ROLES").source;
    for (const finalLevel of [null, "HIGH" as const]) {
      const report = typedIncomingReport();
      report.unifiedRiskSummary = { ...report.unifiedRiskSummary!, finalLevel };
      const message = formatIncomingDepositRiskAlert({
        ...incomingDepositBaseInput,
        sender: source.checkedWalletAddress,
        report
      });

      expect(message.text, String(finalLevel)).toContain("Итоговая оценка не рассчитана");
      expect(message.text, String(finalLevel)).not.toContain("95/100");
    }
  });

  it("[REQ-15][INCOMING-TECHNICAL-FINAL-CONFLICT] rejects a final-looking score with a blocker or non-completed technical state", () => {
    const source = remediationTelegramUxCase("INCOMING_APPROVAL_ROUTE_ROLES").source;
    const cases = [
      {
        scoreBlockedReason: "hard_safety_limit_exceeded" as const,
        technicalStatus: "hard_safety_limit_exceeded" as const
      },
      {
        scoreBlockedReason: null,
        technicalStatus: "provider_error" as const
      }
    ];

    for (const item of cases) {
      const report = typedIncomingReport();
      report.scoreBlockedReason = item.scoreBlockedReason;
      report.technicalStatus = item.technicalStatus;
      const message = formatIncomingDepositRiskAlert({
        ...incomingDepositBaseInput,
        sender: source.checkedWalletAddress,
        report
      });

      expect(message.text, JSON.stringify(item)).toContain("Итоговая оценка не рассчитана");
      expect(message.text, JSON.stringify(item)).not.toContain("95/100");
      expect(message.text, JSON.stringify(item)).not.toContain(String(item.scoreBlockedReason));
      expect(message.text, JSON.stringify(item)).not.toContain(item.technicalStatus);
    }
  });

  it("[REQ-08][REQ-11][INCOMING-ROUTES] keeps typed inbound provenance separate from the outgoing transfer", () => {
    const source = remediationTelegramUxCase("INCOMING_APPROVAL_ROUTE_ROLES").source;
    const subject = source.checkedWalletAddress;
    const inboundFrom = source.routes[0]!.fromAddress;
    const outboundTo = incomingDepositBaseInput.watchedWallet;
    const fundingTxHash = "c".repeat(64);
    const depositTxHash = "b".repeat(64);
    const steps = [
      {
        txHash: fundingTxHash,
        fromAddress: inboundFrom,
        toAddress: subject,
        amountRaw: "500000000",
        timestamp: "2026-07-16T11:59:00.000Z",
        method: "transfer",
        edgeType: "normal_transfer" as const
      },
      {
        txHash: depositTxHash,
        fromAddress: subject,
        toAddress: outboundTo,
        amountRaw: "13302000000",
        timestamp: "2026-07-16T12:00:00.000Z",
        method: "transfer",
        edgeType: "normal_transfer" as const
      }
    ];
    const path = {
      verdict: "DECLINE" as const,
      score: 95,
      sourcePolicy: "hard_decline" as const,
      stoppedReason: "risky_label_reached" as const,
      pathAddresses: [inboundFrom, subject, outboundTo],
      txHashes: [fundingTxHash, depositTxHash],
      steps,
      amountCoverageRatio: 0.4,
      amountContinuity: "strong" as const,
      proximityHops: 1,
      reasons: []
    };
    const report = typedIncomingReport();
    report.originPaths = [path, { ...path, steps: [...steps] }];
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      sender: subject,
      txHash: depositTxHash,
      amount: "13302",
      report
    });

    expect(message.text).toContain(`https://tronscan.org/#/address/${inboundFrom}`);
    expect(message.text).toMatch(new RegExp(`${inboundFrom}\">[^<]+</a> → <a href=\"https://tronscan.org/#/address/${subject}`));
    expect(message.text).toMatch(new RegExp(`${subject}\">[^<]+</a> → <a href=\"https://tronscan.org/#/address/${outboundTo}`));
    expect(message.text.split("→")).toHaveLength(3);
    expect(message.text.split("500 USDT")).toHaveLength(2);
    expect(message.text.split("13 302 USDT")).toHaveLength(2);
  });

  it("[REQ-11][INCOMING-TXHASH-CANONICAL] deduplicates case variants and drops conflicting routes for one transaction", () => {
    const source = remediationTelegramUxCase("INCOMING_APPROVAL_ROUTE_ROLES").source;
    const subject = source.checkedWalletAddress;
    const inboundFrom = source.routes[0]!.fromAddress;
    const outboundTo = incomingDepositBaseInput.watchedWallet;
    const fundingTxHash = "c".repeat(64);
    const conflictingTxHash = "d".repeat(64);
    const depositTxHash = "b".repeat(64);
    const exactDeposit = {
      txHash: depositTxHash.toUpperCase(),
      fromAddress: subject,
      toAddress: outboundTo,
      amountRaw: "13302000000",
      timestamp: "2026-07-16T12:00:00.000Z",
      method: "transfer",
      edgeType: "normal_transfer" as const
    };
    const path = (steps: IncomingDepositRiskReport["originPaths"][number]["steps"]): IncomingDepositRiskReport["originPaths"][number] => ({
      verdict: "DECLINE",
      score: 95,
      sourcePolicy: "hard_decline",
      stoppedReason: "risky_label_reached",
      pathAddresses: [inboundFrom, subject, outboundTo],
      txHashes: steps.map((step) => step.txHash),
      steps,
      amountCoverageRatio: 0.4,
      amountContinuity: "strong",
      proximityHops: 1,
      reasons: []
    });
    const inbound = (txHash: string, amountRaw: string) => ({
      txHash,
      fromAddress: inboundFrom,
      toAddress: subject,
      amountRaw,
      timestamp: "2026-07-16T11:59:00.000Z",
      method: "transfer",
      edgeType: "normal_transfer" as const
    });
    const report = typedIncomingReport();
    report.originPaths = [
      path([inbound(fundingTxHash.toUpperCase(), "500000000"), exactDeposit]),
      path([inbound(fundingTxHash, "500000000"), { ...exactDeposit, txHash: depositTxHash }]),
      path([inbound(conflictingTxHash.toUpperCase(), "100000000"), exactDeposit]),
      path([inbound(conflictingTxHash, "200000000"), { ...exactDeposit, txHash: depositTxHash }])
    ];
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      sender: subject,
      txHash: depositTxHash,
      amount: "13302",
      report
    });

    expect(message.text.split("→")).toHaveLength(3);
    expect(message.text.split("500 USDT")).toHaveLength(2);
    expect(message.text).not.toContain("100 USDT");
    expect(message.text).not.toContain("200 USDT");
  });

  it("[AC-13][INCOMING-TECHNICAL-REASON] preserves distinct hard safety and local index limitations", () => {
    const cases = [
      {
        scoreBlockedReason: "partial_budget_exhausted" as const,
        technicalStatus: "hard_safety_limit_exceeded" as const,
        expected: "Проверка остановлена на предельном объёме данных, установленном для безопасности системы."
      },
      {
        scoreBlockedReason: "hard_safety_limit_exceeded" as const,
        technicalStatus: "hard_safety_limit_exceeded" as const,
        expected: "Проверка остановлена на предельном объёме данных, установленном для безопасности системы."
      },
      {
        scoreBlockedReason: "local_index_read_failed" as const,
        technicalStatus: "local_data_error" as const,
        expected: "Локальный индекс переводов не удалось прочитать."
      }
    ];
    for (const item of cases) {
      const report = typedIncomingReport();
      report.scoreValid = false;
      report.decision = "NO_FINAL_DECISION";
      report.depositRiskScore = null;
      report.riskBand = null;
      report.scoreBlockedReason = item.scoreBlockedReason;
      report.technicalStatus = item.technicalStatus;
      report.unifiedRiskSummary = {
        ...report.unifiedRiskSummary!,
        finalScore: null,
        finalLevel: null,
        finalDecision: "NO_FINAL_DECISION",
        scoreValid: false,
        scoreAnchorV2: null,
        narrativeFactsV2: [],
        scoringEvidenceV2: []
      };
      const message = formatIncomingDepositRiskAlert({ ...incomingDepositBaseInput, report });

      expect(message.text, item.scoreBlockedReason).toContain(item.expected);
      expect(message.text, item.scoreBlockedReason).not.toContain("Источник данных не отдал старые переводы");
    }

    const conflicting = typedIncomingReport();
    conflicting.scoreValid = false;
    conflicting.decision = "NO_FINAL_DECISION";
    conflicting.depositRiskScore = null;
    conflicting.riskBand = null;
    conflicting.scoreBlockedReason = "hard_safety_limit_exceeded";
    conflicting.technicalStatus = "local_data_error";
    conflicting.unifiedRiskSummary = {
      ...conflicting.unifiedRiskSummary!,
      finalScore: null,
      finalLevel: null,
      finalDecision: "NO_FINAL_DECISION",
      scoreValid: false,
      scoreAnchorV2: null,
      narrativeFactsV2: [],
      scoringEvidenceV2: []
    };
    const conflictMessage = formatIncomingDepositRiskAlert({ ...incomingDepositBaseInput, report: conflicting });

    expect(conflictMessage.text).toContain("Данных недостаточно для итоговой оценки.");
    expect(conflictMessage.text).not.toContain("hard_safety_limit_exceeded");
    expect(conflictMessage.text).not.toContain("local_data_error");
  });

  it("formats final incoming deposit risk in English when requested", () => {
    const message = formatIncomingDepositRiskAlert({ ...incomingDepositBaseInput, locale: "en" });

    expect(message.text).toContain("<b>Incoming USDT");
    expect(message.text).toContain("May 31, 2026 14:02 MSK");
    expect(message.text).toContain("<b>Decision</b>: <code>DECLINE</code>");
    expect(message.text).toContain("<b>Deposit risk</b>: 🟠 <code>68/100</code> (<code>HIGH</code>)");
    expect(message.text).toContain("<b>Fast sender check</b>: <code>0/100</code> (<code>LOW</code>)");
    expect(message.text).not.toContain("<b>AI contract verdict</b>");
    expect(message.text).not.toContain("unknown_suspicious 68/100 for");
    expect(message.text).toContain("<b>Deposit funding coverage</b>: <code>76%</code>");
    expect(message.text).toContain("<b>clean-source proof</b>: <code>0%</code>");
    expect(message.text).toContain("<b>origin confidence</b>: <code>medium</code>");
    expect(message.text).not.toContain("Data quality");
  });

  it("keeps the Russian address-substitution warning prominent without changing the AML result", () => {
    const baseline = formatIncomingDepositRiskAlert(incomingDepositBaseInput);
    const explicitlyInactive = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      addressPoisoningWarningActive: false
    });
    const active = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      addressPoisoningWarningActive: true
    });
    const warning = "⚠️ Предупреждение о возможной подмене адреса остаётся активным.";

    expect(explicitlyInactive).toEqual(baseline);
    expect(active.text.split(warning)).toHaveLength(2);
    expect(active.text.indexOf(warning)).toBeGreaterThan(active.text.indexOf("<b>Риск депозита</b>"));
    expect(active.text.indexOf(warning)).toBeLessThan(active.text.indexOf("<b>Сумма</b>"));
    expect(active.text.replace(`\n\n${warning}`, "")).toBe(baseline.text);
  });

  it("keeps the English address-substitution warning prominent without changing the AML result", () => {
    const baseline = formatIncomingDepositRiskAlert({ ...incomingDepositBaseInput, locale: "en" });
    const active = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      addressPoisoningWarningActive: true
    });
    const warning = "⚠️ Address substitution warning remains active.";

    expect(active.text.split(warning)).toHaveLength(2);
    expect(active.text.indexOf(warning)).toBeGreaterThan(active.text.indexOf("<b>Deposit risk</b>"));
    expect(active.text.indexOf(warning)).toBeLessThan(active.text.indexOf("<b>Amount</b>"));
    expect(active.text.replace(`\n\n${warning}`, "")).toBe(baseline.text);
  });

  it("renders an Incoming technical stop without inventing a numeric final risk", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        decision: "NO_FINAL_DECISION",
        depositRiskScore: null,
        observedContextScore: 59,
        riskBand: null
      }
    });

    expect(message.text).toContain("NO_FINAL_DECISION");
    expect(message.text).toContain("no final score");
    expect(message.text).toContain("Observed context");
    expect(message.text).toContain("59");
    expect(message.text).not.toContain("null/100");
  });

  it("renders the canonical Incoming REVIEW decision", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        decision: "REVIEW",
        depositRiskScore: 45,
        observedContextScore: 45,
        riskBand: "MEDIUM"
      }
    });

    expect(message.text).toContain("<b>Decision</b>: <code>REVIEW</code>");
    expect(message.text).toContain("<code>45/100</code>");
  });

  it("shows historical HTX/Huobi context without source-proof wording in incoming deposit alerts", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        reasons: [
          "Historical HTX/Huobi sender inflow is 51% of incoming wallet volume; background context only, not fresh deposit proof."
        ]
      }
    });

    expect(message.text).toContain("Historical HTX/Huobi sender inflow");
    expect(message.text).toContain("background context only, not fresh deposit proof");
    expect(message.text).not.toContain("100% of selected provenance target");
  });

  it("adds shared incoming exposure context without mixing source proof and history", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        sourceBundleExposure: {
          scope: "incoming_deposit",
          targetAmountRaw: "1000000000",
          coveredAmountRaw: "700000000",
          coverageRatio: 0.7,
          htxHuobiShare: 0.7,
          cleanCexShare: 0,
          bridgeRouterDexShare: 0,
          unknownContractShare: 0,
          riskyLabelShare: 0,
          unknownShare: 0.3,
          dominantSource: "htx_huobi",
          evidenceTxHashes: ["fresh-source-proof-tx"],
          reasons: [],
          warnings: [],
          budget: {
            maxDepth: 7,
            fetchedAddressCount: 12,
            maxAddressFetches: 12,
            liveTransferReadCount: 20,
            skippedAddressCount: 1,
            exhausted: true,
            exhaustedPhase: "trace"
          },
          unresolvedBoundary: {
            kind: "bridge_router_dex",
            affectedShare: 0.3,
            scoreFloor: 55,
            reason: "Source bundle coverage-limited: unresolved bridge/router/DEX boundary remains after the graph budget stopped.",
            evidenceTxHashes: ["boundary-proof-tx"]
          }
        },
        subjectExposureProfile: {
          subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
          windowStart: "2026-06-01T00:00:00.000Z",
          windowEnd: "2026-06-04T00:00:00.000Z",
          transferEventsScanned: 40,
          incomingVolumeRaw: "2000000000",
          outgoingVolumeRaw: "1800000000",
          htxHuobiIncomingShare: 0.4,
          cleanCexIncomingShare: 0,
          bridgeRouterDexVolumeShare: 0.2,
          unknownContractVolumeShare: 0,
          unknownSourceShare: 0.4,
          inOutVelocityScore: 5,
          scoreContribution: 12,
          reasons: [],
          warnings: []
        }
      }
    });

    expect(message.text).toContain("HTX/Huobi funds 70% of the selected amount.");
    expect(message.text).toContain("Historical HTX/Huobi exposure is context, not selected-amount source proof.");
    expect(message.text).toContain("The graph stopped before resolving a material bridge/router/DEX boundary.");
    expect(message.text).not.toContain("fresh-source-proof-tx");
    expect(message.text).not.toContain("boundary-proof-tx");
    expect(message.text).not.toContain("Historical HTX/Huobi funds 70% of the selected amount");
  });

  it("labels non-bridge unresolved source boundaries in incoming deposit alerts", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        sourceBundleExposure: {
          scope: "incoming_deposit",
          targetAmountRaw: "1000000000",
          coveredAmountRaw: "300000000",
          coverageRatio: 0.3,
          htxHuobiShare: 0,
          cleanCexShare: 0,
          bridgeRouterDexShare: 0,
          unknownContractShare: 0,
          riskyLabelShare: 0,
          unknownShare: 0.7,
          dominantSource: null,
          evidenceTxHashes: [],
          reasons: [],
          warnings: [],
          budget: {
            maxDepth: 7,
            fetchedAddressCount: 12,
            maxAddressFetches: 12,
            liveTransferReadCount: 20,
            skippedAddressCount: 1,
            exhausted: true,
            exhaustedPhase: "trace"
          },
          unresolvedBoundary: {
            kind: "unknown_contract",
            affectedShare: 0.7,
            scoreFloor: 45,
            reason: "Source bundle coverage-limited: unresolved unknown-contract boundary remains after the graph budget stopped.",
            evidenceTxHashes: ["unknown-contract-boundary-tx"]
          }
        }
      }
    });

    expect(message.text).toContain("The graph stopped before resolving a material unknown-contract source boundary.");
    expect(message.text).not.toContain("bridge/router/DEX boundary");
  });

  it("formats incoming deposit LOW-MEDIUM risk with a yellow icon", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      report: {
        ...incomingDepositBaseInput.report,
        decision: "ACCEPTABLE",
        depositRiskScore: 40,
        riskBand: "LOW-MEDIUM"
      }
    });

    expect(message.text).toContain("<b>Риск депозита</b>: 🟡 <code>40/100</code> (<code>LOW-MEDIUM</code>)");
  });

  it("shows funding coverage instead of checked-origin amount for low-confidence incoming deposits", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      amount: "300000",
      report: {
        ...incomingDepositBaseInput.report,
        originCoverage: 0.15249102,
        fundingCoverage: {
          depositFundingCoverageRatio: 1,
          cleanSourceCoverageRatio: 0,
          exactContinuityCoverageRatio: 0.15249102
        },
        provenanceConfidence: 31
      }
    });

    expect(message.text).not.toContain("Checked origin");
    expect(message.text).not.toContain("15% of amount");
    expect(message.text).toContain("<b>Deposit funding coverage</b>: <code>100%</code>");
    expect(message.text).toContain("<b>clean-source proof</b>: <code>0%</code>");
    expect(message.text).toContain("<b>origin confidence</b>: <code>low</code>");
  });

  it("shows localized funding coverage instead of checked-origin amount for low-confidence incoming deposits", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      amount: "300000",
      report: {
        ...incomingDepositBaseInput.report,
        originCoverage: 0.15249102,
        fundingCoverage: {
          depositFundingCoverageRatio: 1,
          cleanSourceCoverageRatio: 0,
          exactContinuityCoverageRatio: 0.15249102
        },
        provenanceConfidence: 31
      }
    });

    expect(message.text).not.toContain("Проверено происхождение");
    expect(message.text).not.toContain("15% суммы");
    expect(message.text).toContain("<b>Покрытие депозита</b>: <code>100%</code>");
    expect(message.text).toContain("<b>Чистый источник</b>: <code>0%</code>");
    expect(message.text).toContain("<b>уверенность</b>: <code>низкая</code>");
  });

  it("shows large-transfer funding bundle context without dumping paths or claiming clean origin", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        decision: "ACCEPTABLE",
        depositRiskScore: 40,
        riskBand: "LOW-MEDIUM",
        fundingCoverage: {
          depositFundingCoverageRatio: 1,
          cleanSourceCoverageRatio: 0,
          exactContinuityCoverageRatio: 0.15
        },
        originPaths: [{
          verdict: "ACCEPTABLE" as const,
          score: 30,
          sourcePolicy: "unknown" as const,
          stoppedReason: "weak_cashflow_continuity" as const,
          pathAddresses: ["TLargeLiquidityHub111111111111111111", "TCorridorLiquidity111111111111111111"],
          txHashes: ["large-corridor-transfer"],
          steps: [{
            txHash: "large-corridor-transfer",
            fromAddress: "TLargeLiquidityHub111111111111111111",
            toAddress: "TCorridorLiquidity111111111111111111",
            amountRaw: "1960000000000",
            timestamp: "2026-06-01T10:00:00.000Z",
            method: "transfer",
            edgeType: "normal_transfer" as const
          }],
          amountCoverageRatio: 0.15,
          amountContinuity: "weak" as const,
          proximityHops: 1,
          reasons: ["Clean CEX origin is not fully proven for the deposit amount."],
          fundingBundles: [{
            targetTxHash: "large-corridor-transfer",
            targetFromAddress: "TLargeLiquidityHub111111111111111111",
            targetToAddress: "TCorridorLiquidity111111111111111111",
            targetAmountRaw: "1960000000000",
            bundleAmountRaw: "1958999000000",
            bundleCoverageRatio: 0.9994,
            windowStart: "2026-06-01T04:00:00.000Z",
            windowEnd: "2026-06-01T10:00:00.000Z",
            fundingTxHashes: ["bundle-funding-1", "bundle-funding-2", "bundle-funding-3"],
            fundingAddresses: ["TFunderA11111111111111111111111111111", "TFunderB11111111111111111111111111111"],
            fundingFunders: [
              { address: "TFunderA11111111111111111111111111111", amountRaw: "1058999000000", txHashes: ["bundle-funding-1", "bundle-funding-3"] },
              { address: "TFunderB11111111111111111111111111111", amountRaw: "900000000000", txHashes: ["bundle-funding-2"] }
            ]
          }]
        }],
        reasons: ["Clean CEX origin is not fully proven for the deposit amount."]
      }
    });

    expect(message.text).toContain("A large intermediate transfer is covered by inbound liquidity, but the clean source further upstream is not proven.");
    expect(message.text).not.toContain("TLargeLiquidityHub111111111111111111 -&gt; TCorridorLiquidity111111111111111111");
    expect(message.text).not.toContain("bundle-funding-1");
    expect(message.text).not.toContain("<b>clean-source proof</b>: <code>100%</code>");
    expect(message.text).not.toContain("Balance-forming paths reach allowlisted CEX sources through clean on-chain hops.");
  });

  it("shows compressed liquidity corridor context without dumping paths or tx hashes", () => {
    const corridorSteps = Array.from({ length: 8 }, (_, index) => ({
      txHash: `corridor-hop-tx-${index + 1}`,
      fromAddress: `TLongCorridorFrom${index + 1}111111111111`,
      toAddress: `TLongCorridorTo${index + 1}11111111111111`,
      amountRaw: index === 3 ? "900000000000" : "300000000000",
      timestamp: `2026-06-01T10:0${index}:00.000Z`,
      method: "transfer",
      edgeType: "normal_transfer" as const
    }));
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        decision: "ACCEPTABLE",
        depositRiskScore: 40,
        riskBand: "LOW-MEDIUM",
        originPaths: [{
          verdict: "ACCEPTABLE" as const,
          score: 30,
          sourcePolicy: "unknown" as const,
          stoppedReason: "no_previous_transfer" as const,
          pathAddresses: [
            "TLongCorridorFrom111111111111111111",
            "TLongCorridorMiddle111111111111111",
            "TLongCorridorTo11111111111111111111"
          ],
          txHashes: corridorSteps.map((step) => step.txHash),
          steps: corridorSteps,
          amountCoverageRatio: 0.82,
          amountContinuity: "medium" as const,
          proximityHops: 8,
          reasons: ["Large operational liquidity corridor; clean CEX was not reached."]
        }],
        corridorSummary: {
          kind: "large_liquidity_corridor",
          pathLength: 8,
          largestTransferRaw: "900000000000",
          cleanSourceReached: false,
          hardRiskReached: false,
          reason: "Large operational liquidity corridor; clean CEX was not reached."
        },
        reasons: ["Clean CEX origin is not fully proven for the deposit amount."]
      }
    });

    expect(message.text).toContain("Large liquidity corridor: the money flow is explained, but clean CEX was not reached further upstream.");
    expect(message.text).not.toContain("-&gt;");
    expect(message.text).not.toContain("corridor-hop-tx-1");
    expect(message.text).not.toContain("TLongCorridorMiddle111111111111111");
  });

  it("uses neutral missing-reason copy for high-risk incoming deposits", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      report: {
        ...incomingDepositBaseInput.report,
        reasons: []
      }
    });

    expect(message.text).toContain("Детальные причины не переданы.");
    expect(message.text).not.toContain("Критичных риск-сигналов по депозиту не найдено.");
  });

  it("uses positive missing-reason copy only for acceptable low incoming deposits", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        decision: "ACCEPTABLE",
        depositRiskScore: 8,
        riskBand: "LOW",
        reasons: []
      }
    });

    expect(message.text).toContain("No critical deposit-risk signals were found.");
    expect(message.text).not.toContain("No detailed reasons were provided.");
  });

  it("omits incoming deposit AI contract verdict section when there are no verdicts", () => {
    const message = formatIncomingDepositRiskAlert({
      jobId: "job-no-ai",
      amount: "120",
      watchedWallet: "TWallet111111111111111111111111111111",
      sender: "TSender111111111111111111111111111111",
      txHash: "deposit-tx",
      report: {
        decision: "ACCEPTABLE",
        depositRiskScore: 8,
        observedContextScore: 8,
        riskBand: "LOW",
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
        senderRole: "known_service",
        hardBadEvidence: [],
        contractVerdicts: [],
        reasons: ["Sender matches a known service route."],
        warnings: []
      }
    });

    expect(message.text).not.toContain("AI contract verdict");
    expect(message.text).not.toContain("Data quality");
    expect(JSON.stringify(message.replyMarkup?.inline_keyboard)).toContain("check:deposit:job-no-ai");
  });

  it("omits legacy deterministic-as-LLM contract verdicts from incoming alerts", () => {
    const message = formatIncomingDepositRiskAlert({
      jobId: "job-service",
      amount: "250",
      watchedWallet: "TWallet111111111111111111111111111111",
      sender: "TSender111111111111111111111111111111",
      txHash: "service-deposit-tx",
      report: {
        decision: "ACCEPTABLE",
        depositRiskScore: 12,
        observedContextScore: 12,
        riskBand: "LOW",
        fastSenderRisk: null,
        originPaths: [],
        originCoverage: 0.98,
        fundingCoverage: {
          depositFundingCoverageRatio: 0.98,
          cleanSourceCoverageRatio: 0,
          exactContinuityCoverageRatio: 0.98
        },
        corridorSummary: null,
        provenanceConfidence: 94,
        dataQuality: "high",
        senderRole: "service_hot_wallet",
        hardBadEvidence: [],
        contractVerdicts: [
          {
            source: "deterministic",
            cacheMatch: null,
            reusedFromContractAddress: null,
            providerLabel: "local",
            model: "rule",
            contractAddress: "TGasFree1111111111111111111111111111",
            caseFileHash: "case-hash",
            cacheId: null,
            verdict: "legitimate_service",
            confidence: 1,
            contractRiskScore: 0,
            decisionRecommendation: "ACCEPTABLE",
            reasons: ["GasFree service contract matched deterministic allowlist."],
            citedEvidenceIds: ["gasfree"],
            falsePositiveNotes: []
          }
        ],
        reasons: ["Sender was funded by known service infrastructure."],
        warnings: []
      }
    });

    expect(message.text).not.toContain("<b>AI-оценка контракта</b>");
    expect(message.text).not.toContain("легитимный сервис 0/100");
    expect(message.text).not.toContain("Контракт сервиса совпал с локальным allowlist.");
  });

  it("[AC-39][REQ-25][LLM-PROJECTION] preserves the typed incoming result when deterministic prose names legacy model tokens", () => {
    const deterministicReason = "Deterministic policy: DeepSeek and legitimate_service labels do not change this exact debit result.";
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        contractVerdicts: [],
        reasons: [deterministicReason]
      }
    });

    expect(message.text).toContain("<b>Decision</b>: <code>DECLINE</code>");
    expect(message.text).toContain("<code>68/100</code>");
    expect(message.text).toContain(deterministicReason);
    expect(message.text).not.toContain("AI contract verdict");
  });

  it("formats admin alert with Telegram owner identity", () => {
    const text = formatAdminSuspiciousAlert({
      telegramUserId: "123456789",
      telegramUsername: "client_user",
      watchedWallet: "TWallet111111111111111111111111111111",
      amount: "12450",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report
    }).text;

    expect(text).toContain("<b>User</b>: @client_user - tg_id: <code>123456789</code>");
    expect(text).toContain("<b>Watched wallet</b>: <code>TWallet111111111111111111111111111111</code>");
  });

  it("formats admin alert without username", () => {
    const text = formatAdminSuspiciousAlert({
      telegramUserId: "123456789",
      telegramUsername: null,
      watchedWallet: "TWallet111111111111111111111111111111",
      amount: "12450",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report
    }).text;

    expect(text).toContain("<b>User</b>: tg_id: <code>123456789</code>");
  });

  it("formats read-only approval guard alerts in Russian by default", () => {
    const message = formatUserApprovalAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "eoa",
      spenderIdentity: "unknown",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalAt: new Date("2026-05-06T19:06:15.000Z"),
      signedAt: new Date("2026-05-04T15:06:28.559Z"),
      expirationAt: new Date("2026-05-06T21:07:27.000Z"),
      approvalTxHash: "approval-tx",
      report
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("USDT approval");
    expect(message.text).toContain("<b>Решение</b>");
    expect(message.text).toContain("<b>Риск approval</b>");
    expect(message.text).toContain("Кому разрешено списание");
    expect(message.text).toContain("Это не доказанная кража");
    expect(message.text).toContain("не просит сид-фразу или приватный ключ");
    expect(message.text).not.toContain("Review/revoke");
    expect(message.text).not.toContain("seed/private key");
    expect(message.text).toContain("<code>82/100</code>");
  });

  it("formats service-linked approval guard alerts with route context", () => {
    const text = formatUserApprovalAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "contract",
      spenderIdentity: "tokenApprove",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalTxHash: "approval-tx",
      report: {
        ...report,
        level: "MEDIUM",
        score: 35,
        reasons: [
          {
            code: "approval_temporally_linked_to_known_swap",
            message: "Approval appears linked to a nearby swap/bridge route through service or adapter infrastructure",
            scoreImpact: -35
          }
        ]
      }
    }).text;

    expect(text).toContain("Это не доказанная кража");
    expect(text).not.toContain("Review/revoke");
  });

  it("formats pending approval context alerts", () => {
    const message = formatUserApprovalPendingAlert({
      watchedWallet: "TWallet<owner>",
      token: "USDT",
      spender: "TSpender&helper",
      spenderType: "contract",
      spenderIdentity: "tokenApprove",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalAt: new Date("2026-05-05T13:42:21.000Z"),
      contextDeadlineAt: new Date("2026-05-05T13:52:21.000Z"),
      approvalTxHash: "approval-tx",
      report: {
        ...report,
        level: "HIGH",
        score: 70,
        reasons: [{ code: "approval_context_pending", message: "Waiting for route context <pending>", scoreImpact: 10 }]
      }
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("Подписан smart contract");
    expect(message.text).toContain("Статус");
    expect(message.text).toContain("ждём контекст операции");
    expect(message.text).toContain("Финальный результат придёт отдельным сообщением");
    expect(message.text).toContain("<code>TWallet&lt;owner&gt;</code>");
    expect(message.text).toContain("<code>TSpender&amp;helper</code>");
    expect(message.text).toContain("Waiting for route context &lt;pending&gt;");
  });

  it("formats linked approval context result follow-up alerts", () => {
    const message = formatUserApprovalContextResultAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "contract",
      spenderIdentity: "tokenApprove",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalAt: new Date("2026-05-05T13:42:21.000Z"),
      contextDeadlineAt: new Date("2026-05-05T13:52:21.000Z"),
      approvalTxHash: "approval-tx",
      initialReport: {
        ...report,
        level: "HIGH",
        score: 70,
        reasons: [{ code: "approval_context_pending", message: "Pending route context", scoreImpact: 10 }]
      },
      finalReport: {
        ...report,
        level: "MEDIUM",
        score: 35,
        reasons: [
          {
            code: "approval_temporally_linked_to_known_swap",
            message: "Linked to nearby Bridgers/SunSwap route",
            scoreImpact: -35
          }
        ]
      },
      result: "linked_swap_route",
      linkedRouteTxHash: "route-tx",
      routeServiceTags: ["Bridgers", "SunSwap"]
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("Контекст approval найден");
    expect(message.text).toContain("<b>Решение</b>: <code>ACCEPTABLE</code>");
    expect(message.text).toContain("Approval связан с bridge/swap-операцией");
    expect(message.text).toContain("Списания USDT как drain не доказаны");
    expect(message.text).toContain("<code>35/100</code>");
    expect(message.text).toContain("<b>Дедлайн контекста</b>: <code>05.05.2026 16:52 MSK</code>");
    expect(message.text).toContain("<b>Связанная tx</b>: <code>route-tx</code>");
    expect(message.text).not.toContain("Review/revoke");
  });

  it("formats missing approval context result follow-up alerts", () => {
    const message = formatUserApprovalContextResultAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "contract",
      spenderIdentity: "tokenApprove",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalAt: new Date("2026-05-05T13:42:21.000Z"),
      contextDeadlineAt: new Date("2026-05-05T13:52:21.000Z"),
      approvalTxHash: "approval-tx",
      initialReport: {
        ...report,
        level: "HIGH",
        score: 70,
        reasons: [{ code: "approval_context_pending", message: "Pending route context", scoreImpact: 10 }]
      },
      finalReport: {
        ...report,
        level: "HIGH",
        score: 70,
        reasons: [
          {
            code: "approval_no_route_found",
            message: "No related swap/bridge route found",
            scoreImpact: 0
          }
        ]
      },
      result: "no_route_found"
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("Контекст approval не найден");
    expect(message.text).toContain("<b>Решение</b>: <code>DECLINE</code>");
    expect(message.text).toContain("кошелёк небезопасен для работы");
    expect(message.text).not.toContain("Review/revoke");
  });

  it("formats collector-drain approval context result with distinct outflow title", () => {
    const message = formatUserApprovalContextResultAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "contract",
      spenderIdentity: "tokenApprove",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalAt: new Date("2026-05-05T13:42:21.000Z"),
      approvalTxHash: "approval-tx",
      initialReport: {
        ...report,
        level: "HIGH",
        score: 70,
        reasons: [{ code: "approval_context_pending", message: "Pending route context", scoreImpact: 10 }]
      },
      finalReport: {
        ...report,
        level: "CRITICAL",
        score: 95,
        reasons: [
          {
            code: "approval_collector_drain",
            message: "approval monitoring state: transfer_from_observed",
            scoreImpact: 25
          }
        ]
      },
      result: "collector_drain",
      linkedRouteTxHash: "collector-tx"
    });

    expect(message.text).toContain("Найден вывод USDT после approval");
    expect(message.text).toContain("<b>Решение</b>: <code>DECLINE</code>");
    expect(message.text).toContain("После approval найден вывод USDT. Точный drain доказывается только при совпадении spender и transferFrom.");
    expect(message.text).toContain("<b>Tx вывода USDT</b>: <code>collector-tx</code>");
    expect(message.text).not.toContain("<b>Связанная tx</b>");
    expect(message.text).not.toContain("Linked route tx");
    expect(message.text).not.toContain("Контекст approval не найден");
  });

  it("formats finite approval allowance as decoded USDT", () => {
    const text = formatUserApprovalAlert({
      locale: "en",
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "eoa",
      spenderIdentity: "Bridgers",
      allowanceType: "finite",
      allowanceAmount: "111,111 USDT",
      approvalTxHash: "approval-tx",
      report
    }).text;

    expect(text).toContain("<b>Allowance</b>: <code>finite 111,111 USDT</code>");
    expect(text).toContain("<b>Identity</b>: <code>Bridgers</code>");
  });

  it("formats service-admin approval alerts", () => {
    const text = formatAdminApprovalAlert({
      telegramUserId: "123456789",
      telegramUsername: "client_user",
      watchedWallet: "TWallet111111111111111111111111111111",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "eoa",
      spenderIdentity: "unknown",
      approvalTxHash: "approval-tx",
      report
    }).text;

    expect(text).toContain("HIGH approval event");
    expect(text).toContain("<b>User</b>: @client_user - tg_id: <code>123456789</code>");
    expect(text).toContain("Spender type");
    expect(text).toContain("<b>Approval tx</b>: <code>approval-tx</code>");
  });

  it("formats empty reasons with a safe fallback", () => {
    const text = formatUserIncomingAlert({
      amount: "12450",
      watchedWallet: "TWallet111111111111111111111111111111",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report: { ...report, reasons: [] }
    }).text;

    expect(text).toContain("• no obvious risk signals found");
  });

  it("normalizes newlines and control characters in user-controlled fields", () => {
    const text = formatUserIncomingAlert({
      amount: "12450\nRisk: LOW",
      watchedWallet: "TWallet\nInjected: no",
      sender: "TSender\nTx: fake",
      txHash: "abc123\r\nInjected: yes",
      report: {
        ...report,
        reasons: [{ code: "provider", message: "Line one\nRisk: LOW\t\u0000", scoreImpact: 10 }]
      }
    }).text;

    expect(text).toContain("<b>Amount</b>: <code>12450 Risk: LOW USDT</code>");
    expect(text).toContain("<b>Watched wallet</b>: <code>TWallet Injected: no</code>");
    expect(text).toContain("<b>From</b>: <code>TSender Tx: fake</code>");
    expect(text).toContain("• Line one Risk: LOW");
    expect(text).not.toContain("\r");
    expect(text).not.toContain("\u0000");
  });

  it("escapes HTML in dynamic fields", () => {
    const text = formatUserIncomingAlert({
      amount: "1 < 2 & ok",
      watchedWallet: "TWallet<bad>",
      sender: "TSender&bad",
      txHash: "tx\"quote'",
      report: {
        ...report,
        reasons: [{ code: "html", message: "Reason <script> & \"quote\"", scoreImpact: 1 }]
      }
    }).text;

    expect(text).toContain("1 &lt; 2 &amp; ok USDT");
    expect(text).toContain("TWallet&lt;bad&gt;");
    expect(text).toContain("TSender&amp;bad");
    expect(text).toContain("tx&quot;quote&#39;");
    expect(text).toContain("Reason &lt;script&gt; &amp; &quot;quote&quot;");
    expect(text).not.toContain("<script>");
  });

  it("formats risk lines by level", () => {
    expect(formatRiskLine({ ...report, level: "LOW", score: 0 })).toContain("🟢 <b>Low risk</b>");
    expect(formatRiskLine({ ...report, level: "MEDIUM", score: 35 })).toContain("🟡 <b>Medium risk</b>");
    expect(formatRiskLine({ ...report, level: "HIGH", score: 80 })).toContain("🟠 <b>High risk</b>");
    expect(formatRiskLine({ ...report, level: "CRITICAL", score: 95 })).toContain("🔴 <b>Critical risk</b>");
  });

  it("exports a reusable HTML escaper", () => {
    expect(escapeHtml("<>&\"'")).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("formats digest alerts with risky summary", () => {
    const message = formatDigestAlert({
      walletAddress: "TWallet111111111111111111111111111111",
      intervalMinutes: 10,
      transactionCount: 23,
      totalUsdt: "81 240",
      uniqueSenderCount: 19,
      riskyTransactionCount: 1,
      riskySenderCount: 1,
      topRisky: { level: "HIGH", score: 80, sender: "TRisky111111111111111111111111111111" }
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("<b>USDT digest</b>");
    expect(message.text).toContain("<b>Incoming</b>: <code>23 tx</code>");
    expect(message.text).toContain("<b>Total</b>: <code>81 240 USDT</code>");
    expect(message.text).toContain("<b>Risky</b>: <code>1 tx / 1 sender</code>");
    expect(message.text).toContain("High-risk tx were alerted immediately");
  });

  it("limits visible reasons and keeps messages below Telegram hard limit", () => {
    const manyReasons = Array.from({ length: 40 }, (_, index) => ({
      code: `reason_${index}`,
      message: `Very long provider reason ${index} ${"x".repeat(500)}`,
      scoreImpact: 1
    }));

    const text = formatAdminSuspiciousAlert({
      telegramUserId: "123456789",
      telegramUsername: "client_user",
      watchedWallet: "TWallet111111111111111111111111111111",
      amount: "12450",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report: { ...report, reasons: manyReasons }
    }).text;

    expect(text).toContain("...and 32 more");
    expect(text.length).toBeLessThan(TELEGRAM_MESSAGE_LIMIT);
    expect(text).not.toContain("<code>Very long");
  });
});
