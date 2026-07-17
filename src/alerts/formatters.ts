import type { BotLocale, IncomingDepositRiskReport, RiskReport, SourceBundleExposureSourceKind } from "../types";
import { DEFAULT_BOT_LOCALE } from "../bot/i18n";
import { userIncomingDepositRiskKeyboard } from "./keyboards";
import { formatNotificationMskTime } from "./notificationTime";
import { adaptTelegramForensicResult } from "../telegram/forensicPresentationAdapters";
import type { ApprovalPresentationInputV1 } from "../telegram/forensicPresentation";
import { renderTelegramForensicResult } from "../telegram/forensicResultRenderer";
import { parseUsdtDecimalToRaw } from "../forensics/usdtAmount";
import {
  checksLabel,
  decisionLabel,
  displayDecisionFromRiskScore,
  normalizeNotificationReason,
  riskObjectLabel,
  senderRoleText,
  statusLabel,
  whyLabel
} from "./notificationText";
import {
  TELEGRAM_MESSAGE_LIMIT,
  bold,
  bulletList,
  code,
  escapeHtml,
  formatRiskIcon,
  formatRiskLine,
  section,
  telegramHtmlMessage,
  type TelegramAlertMessage
} from "./telegramHtml";

export { TELEGRAM_MESSAGE_LIMIT };
const MAX_REASON_COUNT = 8;

type IncomingDepositRiskAlertMessage = TelegramAlertMessage & {
  replyMarkup: ReturnType<typeof userIncomingDepositRiskKeyboard>;
};

function reasonMessages(report: RiskReport): string[] {
  const visibleReasons = report.reasons.slice(0, MAX_REASON_COUNT);
  const formatted = visibleReasons.map((reason) => reason.message);
  const hiddenCount = report.reasons.length - visibleReasons.length;
  if (hiddenCount > 0) {
    formatted.push(`...and ${hiddenCount} more`);
  }
  return formatted;
}

function localizedReasonMessages(report: RiskReport, locale: BotLocale): string[] {
  const visibleReasons = report.reasons.slice(0, MAX_REASON_COUNT);
  const formatted = visibleReasons.map((reason) => normalizeNotificationReason(reason.message, locale));
  const hiddenCount = report.reasons.length - visibleReasons.length;
  if (hiddenCount > 0) {
    formatted.push(locale === "en" ? `...and ${hiddenCount} more` : `...и ещё ${hiddenCount}`);
  }
  return formatted;
}

function formatReasons(report: RiskReport): string {
  return bulletList(reasonMessages(report));
}

function formatLocalizedReasons(report: RiskReport, locale: BotLocale): string {
  return bulletList(
    localizedReasonMessages(report, locale),
    locale === "en" ? "no obvious risk signals found" : "критичные риск-сигналы не найдены"
  );
}

function formatSpenderType(value: string, locale: BotLocale = "en"): string {
  switch (value) {
    case "eoa":
      return locale === "en" ? "wallet (EOA, not smart contract)" : "кошелёк (EOA, не smart contract)";
    case "contract":
      return "smart contract";
    default:
      return locale === "en" ? "unknown" : "неизвестно";
  }
}

function formatApprovalAllowanceText(input: { allowanceType: string; allowanceAmount?: string }): string {
  return input.allowanceAmount && input.allowanceAmount !== input.allowanceType
    ? `${input.allowanceType} ${input.allowanceAmount}`
    : input.allowanceType;
}

function formatApprovalDetails(input: {
  watchedWallet: string;
  token: string;
  spender: string;
  spenderType: string;
  spenderIdentity?: string | null;
  allowanceType: string;
  allowanceAmount?: string;
}, locale: BotLocale): string {
  return [
    `${bold(locale === "en" ? "Wallet" : "Кошелёк")}: ${code(input.watchedWallet)}`,
    `${bold(locale === "en" ? "Token" : "Токен")}: ${code(input.token)}`,
    `${bold(locale === "en" ? "Allowed spender" : "Кому разрешено списание")}: ${code(input.spender)}`,
    `${bold(locale === "en" ? "Identity" : "Метка")}: ${code(input.spenderIdentity ?? (locale === "en" ? "unknown" : "неизвестно"))}`,
    `${bold(locale === "en" ? "Type" : "Тип")}: ${escapeHtml(formatSpenderType(input.spenderType, locale))}`,
    `${bold(locale === "en" ? "Allowance" : "Лимит")}: ${code(formatApprovalAllowanceText(input))}`
  ].join("\n");
}

function formatApprovalTimeLine(label: string, value: Date | null | undefined, locale: BotLocale): string | null {
  const formatted = formatNotificationMskTime(value, locale);
  return formatted ? `${bold(label)}: ${code(formatted)}` : null;
}

function formatApprovalTimeSection(input: {
  approvalAt?: Date | null;
  signedAt?: Date | null;
  expirationAt?: Date | null;
  contextDeadlineAt?: Date | null;
}, locale: BotLocale): string | null {
  const lines = [
    formatApprovalTimeLine(locale === "en" ? "Approval" : "Approval", input.approvalAt, locale),
    formatApprovalTimeLine(locale === "en" ? "Signed" : "Подписано", input.signedAt, locale)
  ];
  const body = lines.filter((line): line is string => line !== null);
  return body.length > 0 ? section(locale === "en" ? "Time" : "Время", body) : null;
}

function formatTypedApprovalAlert(input: {
  locale: BotLocale;
  watchedWallet: string;
  approvalAt?: Date | null;
  approvalPresentationInput?: ApprovalPresentationInputV1;
  approvalPresentationEvaluatedAt?: Date | null;
}): TelegramAlertMessage | null {
  if (!input.approvalPresentationInput) return null;
  const evaluatedAt = input.approvalPresentationEvaluatedAt ?? input.approvalAt;
  if (!evaluatedAt || !Number.isFinite(evaluatedAt.getTime())) return null;
  const assessment = input.approvalPresentationInput.assessment;
  return telegramHtmlMessage([renderTelegramForensicResult(adaptTelegramForensicResult({
    kind: "approval_safety",
    locale: input.locale,
    evaluatedAt: evaluatedAt.toISOString(),
    checkedWalletAddress: input.watchedWallet,
    resultState: assessment.score === null ? "no_final" : "final",
    scoreAnchorV2: null,
    narrativeFactsV2: [],
    scoringEvidenceV2: [],
    amlPresentation: null,
    routes: [],
    coverageV2: null,
    legacyCoverage: null,
    approvalInput: input.approvalPresentationInput,
    contractDecision: null,
    technicalLimitTextKey: null
  }))]);
}

export function formatApprovalSafetyPresentationAlert(input: {
  locale?: BotLocale;
  watchedWallet: string;
  evaluatedAt: Date;
  approvalPresentationInput: ApprovalPresentationInputV1;
}): TelegramAlertMessage {
  return formatTypedApprovalAlert({
    locale: input.locale ?? DEFAULT_BOT_LOCALE,
    watchedWallet: input.watchedWallet,
    approvalPresentationEvaluatedAt: input.evaluatedAt,
    approvalPresentationInput: input.approvalPresentationInput
  }) ?? telegramHtmlMessage([input.locale === "en" ? "Approval safety result is unavailable." : "Результат проверки доступа к USDT недоступен."]);
}

function formatApprovalRiskLine(report: RiskReport, locale: BotLocale): string {
  return `${formatRiskIcon(report.level)} ${bold(riskObjectLabel("approval", locale))}: ${code(`${report.score}/100`)} (${code(report.level)})`;
}

function readOnlyNotice(locale: BotLocale): string {
  return locale === "en"
    ? "Read-only: bot never signs transactions, never asks for seed/private key, and never controls funds."
    : "Только чтение: бот не подписывает транзакции, не просит сид-фразу или приватный ключ и не управляет средствами.";
}

function approvalContextTxLabel(
  result: "linked_swap_route" | "no_route_found" | "collector_drain",
  locale: BotLocale
): string {
  if (result === "collector_drain") return locale === "en" ? "USDT outflow tx" : "Tx вывода USDT";
  return locale === "en" ? "Linked route tx" : "Связанная tx";
}

function hasLowAcceptableDepositRisk(report: IncomingDepositRiskReport): boolean {
  return report.decision === "ACCEPTABLE" && report.riskBand === "LOW";
}

function missingIncomingDepositReasonText(report: IncomingDepositRiskReport, locale: BotLocale): string {
  if (hasLowAcceptableDepositRisk(report)) {
    return locale === "en"
      ? "No critical deposit-risk signals were found."
      : "Критичных риск-сигналов по депозиту не найдено.";
  }

  return locale === "en"
    ? "No detailed reasons were provided."
    : "Детальные причины не переданы.";
}

function hasIncomingDepositFundingBundles(report: IncomingDepositRiskReport): boolean {
  return report.originPaths.some((path) => (path.fundingBundles?.length ?? 0) > 0);
}

function incomingDepositFundingBundleContextText(locale: BotLocale): string {
  return locale === "en"
    ? "A large intermediate transfer is covered by inbound liquidity, but the clean source further upstream is not proven."
    : "Крупный промежуточный перевод покрыт входящими потоками, но чистый источник выше по цепочке не доказан.";
}

function hasIncomingDepositCorridorSummary(report: IncomingDepositRiskReport): boolean {
  return report.corridorSummary?.kind === "large_liquidity_corridor";
}

function incomingDepositCorridorContextText(locale: BotLocale): string {
  return locale === "en"
    ? "Large liquidity corridor: the money flow is explained, but clean CEX was not reached further upstream."
    : "Крупный liquidity corridor: поток денег объяснён, но clean CEX выше по цепочке не достигнут.";
}

function sourceUnresolvedBoundaryLabel(kind: SourceBundleExposureSourceKind, locale: BotLocale): string {
  switch (kind) {
    case "bridge_router_dex":
      return locale === "ru" ? "граница bridge/router/DEX" : "bridge/router/DEX boundary";
    case "htx_huobi":
      return locale === "ru" ? "граница источника HTX/Huobi" : "HTX/Huobi source boundary";
    case "risky_label":
      return locale === "ru" ? "граница источника с риск-лейблом" : "risky-label source boundary";
    case "unknown_contract":
      return locale === "ru" ? "граница неизвестного смарт-контракта" : "unknown-contract source boundary";
    case "unknown":
      return locale === "ru" ? "неизвестная граница источника" : "unknown source boundary";
    case "clean_cex":
    default:
      return locale === "ru" ? "граница источника" : "source boundary";
  }
}

function sharedIncomingExposureContextLines(report: IncomingDepositRiskReport, locale: BotLocale): string[] {
  const lines: string[] = [];
  const sourceExposure = report.sourceBundleExposure;
  if (sourceExposure && Number.isFinite(sourceExposure.htxHuobiShare) && sourceExposure.htxHuobiShare > 0) {
    lines.push(locale === "en"
      ? `HTX/Huobi funds ${clampedPercent(sourceExposure.htxHuobiShare)} of the selected amount.`
      : `HTX/Huobi покрывает ${clampedPercent(sourceExposure.htxHuobiShare)} выбранной суммы.`);
  }
  if (report.subjectExposureProfile && Number.isFinite(report.subjectExposureProfile.htxHuobiIncomingShare) && report.subjectExposureProfile.htxHuobiIncomingShare > 0) {
    lines.push(locale === "en"
      ? "Historical HTX/Huobi exposure is context, not selected-amount source proof."
      : "Историческая связь с HTX/Huobi — это контекст по отправителю, а не доказательство источника выбранной суммы.");
  }
  if (sourceExposure?.unresolvedBoundary) {
    const boundaryLabel = sourceUnresolvedBoundaryLabel(sourceExposure.unresolvedBoundary.kind, locale);
    lines.push(locale === "en"
      ? `The graph stopped before resolving a material ${boundaryLabel}.`
      : `Граф остановился до разрешения существенной границы: ${boundaryLabel}.`);
  }
  return lines;
}

function formatIncomingDepositReasons(report: IncomingDepositRiskReport, locale: BotLocale): string {
  const reasons = report.reasons.length > 0
    ? report.reasons.slice(0, MAX_REASON_COUNT).map((reason) => normalizeNotificationReason(reason, locale))
    : [missingIncomingDepositReasonText(report, locale)];
  for (const contextReason of sharedIncomingExposureContextLines(report, locale)) {
    if (!reasons.includes(contextReason)) reasons.push(contextReason);
  }
  if (hasIncomingDepositFundingBundles(report)) {
    const contextReason = incomingDepositFundingBundleContextText(locale);
    if (!reasons.includes(contextReason)) reasons.push(contextReason);
  }
  if (hasIncomingDepositCorridorSummary(report)) {
    const contextReason = incomingDepositCorridorContextText(locale);
    if (!reasons.includes(contextReason)) reasons.push(contextReason);
  }
  return bulletList(reasons);
}

function fastSenderCheckLabel(locale: BotLocale): string {
  return locale === "en" ? "Fast sender check" : "Быстрая проверка отправителя";
}

function formatFastSenderRisk(report: IncomingDepositRiskReport): string {
  if (!report.fastSenderRisk) return code("unknown");
  return `${code(`${report.fastSenderRisk.score}/100`)} (${code(report.fastSenderRisk.level)})`;
}

function clampedPercent(value: number): string {
  const finiteValue = Number.isFinite(value) ? value : 0;
  return `${Math.round(Math.max(0, Math.min(1, finiteValue)) * 100)}%`;
}

function incomingOriginConfidenceText(report: IncomingDepositRiskReport, locale: BotLocale): string {
  const confidence = Number.isFinite(report.provenanceConfidence) ? report.provenanceConfidence : 0;
  if (confidence >= 70) return locale === "en" ? "high" : "высокая";
  if (confidence >= 40) return locale === "en" ? "medium" : "средняя";
  return locale === "en" ? "low" : "низкая";
}

function incomingOriginConfidenceLabel(report: IncomingDepositRiskReport, locale: BotLocale): string {
  return [
    `${bold(locale === "en" ? "Deposit funding coverage" : "Покрытие депозита")}: ${code(clampedPercent(report.fundingCoverage.depositFundingCoverageRatio))}`,
    `${bold(locale === "en" ? "clean-source proof" : "Чистый источник")}: ${code(clampedPercent(report.fundingCoverage.cleanSourceCoverageRatio))}`,
    `${bold(locale === "en" ? "origin confidence" : "уверенность")}: ${code(incomingOriginConfidenceText(report, locale))}`
  ].join("; ");
}

function incomingDepositRiskIcon(band: IncomingDepositRiskReport["riskBand"]): string {
  if (band === null) return "⚪️";
  switch (band) {
    case "LOW":
      return "🟢";
    case "LOW-MEDIUM":
    case "MEDIUM":
      return "🟡";
    case "HIGH":
      return "🟠";
    case "CRITICAL":
      return "🔴";
  }
}

type IncomingPresentationRoute = {
  routeId: string;
  direction: "inbound" | "outbound";
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  asset: "USDT";
  share: number | null;
  transferCount: number;
  evidenceIds: string[];
};

function incomingPresentationRoutes(input: {
  sender: string;
  watchedWallet: string;
  txHash: string;
  amount: string;
  report: IncomingDepositRiskReport;
}): IncomingPresentationRoute[] {
  const amountRaw = parseUsdtDecimalToRaw(input.amount);
  const depositTxHash = /^[0-9a-f]{64}$/i.test(input.txHash) ? input.txHash.toLowerCase() : null;
  if (!amountRaw || !depositTxHash) return [];
  const routes = new Map<string, IncomingPresentationRoute>();
  const conflicts = new Set<string>();
  const add = (route: IncomingPresentationRoute): void => {
    if (conflicts.has(route.routeId)) return;
    const existing = routes.get(route.routeId);
    if (!existing) {
      routes.set(route.routeId, route);
      return;
    }
    if (
      existing.direction !== route.direction || existing.fromAddress !== route.fromAddress ||
      existing.toAddress !== route.toAddress || existing.amountRaw !== route.amountRaw || existing.share !== route.share
    ) {
      routes.delete(route.routeId);
      conflicts.add(route.routeId);
    }
  };
  const route = (value: Omit<IncomingPresentationRoute, "routeId" | "asset" | "transferCount" | "evidenceIds"> & { txHash: string }): IncomingPresentationRoute => ({
    routeId: `route-${value.txHash}`,
    direction: value.direction,
    fromAddress: value.fromAddress,
    toAddress: value.toAddress,
    amountRaw: value.amountRaw,
    asset: "USDT",
    share: value.share,
    transferCount: 1,
    evidenceIds: [`route:${value.txHash}`]
  });

  add(route({
    txHash: depositTxHash,
    direction: "outbound",
    fromAddress: input.sender,
    toAddress: input.watchedWallet,
    amountRaw,
    share: 1
  }));
  for (const path of input.report.originPaths) {
    const exactDeposit = path.steps.some((step) =>
      /^[0-9a-f]{64}$/i.test(step.txHash) && step.txHash.toLowerCase() === depositTxHash &&
      step.fromAddress === input.sender && step.toAddress === input.watchedWallet &&
      step.amountRaw === amountRaw
    );
    if (!exactDeposit) continue;
    const share = Number.isFinite(path.amountCoverageRatio) && path.amountCoverageRatio >= 0 && path.amountCoverageRatio <= 1
      ? path.amountCoverageRatio
      : null;
    for (const step of path.steps) {
      const stepTxHash = /^[0-9a-f]{64}$/i.test(step.txHash) ? step.txHash.toLowerCase() : null;
      if (!stepTxHash || stepTxHash === depositTxHash || !/^[1-9][0-9]*$/.test(step.amountRaw)) continue;
      if (step.toAddress === input.sender) {
        add(route({
          txHash: stepTxHash,
          direction: "inbound",
          fromAddress: step.fromAddress,
          toAddress: step.toAddress,
          amountRaw: step.amountRaw,
          share
        }));
      } else if (step.fromAddress === input.sender) {
        add(route({
          txHash: stepTxHash,
          direction: "outbound",
          fromAddress: step.fromAddress,
          toAddress: step.toAddress,
          amountRaw: step.amountRaw,
          share
        }));
      }
    }
  }
  return [...routes.values()];
}

function incomingTechnicalReason(report: IncomingDepositRiskReport): string | null {
  const pair = `${report.scoreBlockedReason ?? "null"}:${report.technicalStatus ?? "null"}`;
  const canonical: Record<string, string> = {
    "insufficient_coverage:completed": "insufficient_coverage",
    "insufficient_coverage:provider_cap_unresolved": "provider_cap_unresolved",
    "partial_budget_exhausted:budget_limited": "partial_budget_exhausted",
    "partial_budget_exhausted:hard_safety_limit_exceeded": "hard_safety_limit_exceeded",
    "local_budget_limited:local_budget_limited": "local_budget_limited",
    "local_index_read_failed:local_data_error": "local_index_read_failed",
    "provider_error:provider_error": "provider_error",
    "rate_limited_after_retries:provider_limited": "rate_limited_after_retries",
    "provider_inconsistent:provider_error": "provider_inconsistent",
    "provider_cap_unresolved:provider_cap_unresolved": "provider_cap_unresolved",
    "hard_safety_limit_exceeded:hard_safety_limit_exceeded": "hard_safety_limit_exceeded"
  };
  return canonical[pair] ?? null;
}

function formatTypedIncomingDepositRiskAlert(input: {
  watchedWallet: string;
  sender: string;
  txHash: string;
  amount: string;
  timestamp?: Date | null;
  locale: BotLocale;
  addressPoisoningWarningActive?: boolean;
  report: IncomingDepositRiskReport;
}): TelegramAlertMessage | null {
  const summary = input.report.unifiedRiskSummary;
  if (
    !summary || !("scoreAnchorV2" in summary) ||
    !Array.isArray(summary.narrativeFactsV2) || !Array.isArray(summary.scoringEvidenceV2)
  ) return null;

  const anchor = summary.scoreAnchorV2 ?? null;
  const technical = input.report.decision === "NO_FINAL_DECISION" || input.report.scoreValid === false ||
    input.report.scoreBlockedReason !== null || input.report.technicalStatus !== "completed";
  const checkedWalletAddress = input.sender;
  const savedLevel = summary.finalLevel;
  const validSavedLevel = savedLevel === "LOW" || savedLevel === "MEDIUM" || savedLevel === "HIGH" || savedLevel === "CRITICAL"
    ? savedLevel
    : null;
  const savedOutcomeConsistent = Boolean(
    anchor && anchor.subjectAddress === input.sender && validSavedLevel && summary.scoreValid === true && summary.finalScore === anchor.score &&
    summary.finalDecision === anchor.decision && input.report.scoreValid === true &&
    input.report.depositRiskScore === summary.finalScore && input.report.decision === summary.finalDecision &&
    input.report.scoreBlockedReason === null && input.report.technicalStatus === "completed"
  );
  const technicalReason = technical ? incomingTechnicalReason(input.report) : null;
  const rendered = renderTelegramForensicResult(adaptTelegramForensicResult({
    kind: "incoming_deposit",
    locale: input.locale,
    evaluatedAt: (input.timestamp ?? new Date(0)).toISOString(),
    checkedWalletAddress,
    resultState: technical
      ? technicalReason ? "technical_limit" : "no_final"
      : "final",
    scoreAnchorV2: anchor,
    narrativeFactsV2: summary.narrativeFactsV2,
    scoringEvidenceV2: summary.scoringEvidenceV2,
    amlPresentation: savedOutcomeConsistent
      ? {
          level: validSavedLevel!,
          actionTextKey: anchor!.decision === "DECLINE" ? "do_not_operate" : anchor!.decision === "REVIEW" ? "manual_review" : null
        }
      : null,
    routes: incomingPresentationRoutes(input),
    coverageV2: input.report.coverageV2 ?? null,
    legacyCoverage: null,
    approvalInput: null,
    contractDecision: null,
    technicalLimitTextKey: technicalReason
  }));
  const poisoningWarning = input.addressPoisoningWarningActive
    ? input.locale === "en"
      ? "⚠️ Address substitution warning remains active."
      : "⚠️ Предупреждение о возможной подмене адреса остаётся активным."
    : null;
  return telegramHtmlMessage([rendered, poisoningWarning]);
}

export function formatIncomingDepositRiskAlert(input: {
  jobId: string;
  amount: string;
  watchedWallet: string;
  sender: string;
  txHash: string;
  timestamp?: Date | null;
  locale?: BotLocale;
  addressPoisoningWarningActive?: boolean;
  report: IncomingDepositRiskReport;
}): IncomingDepositRiskAlertMessage {
  const locale = input.locale ?? DEFAULT_BOT_LOCALE;
  const report = input.report;
  const typedMessage = formatTypedIncomingDepositRiskAlert({
    watchedWallet: input.watchedWallet,
    sender: input.sender,
    txHash: input.txHash,
    amount: input.amount,
    timestamp: input.timestamp,
    locale,
    addressPoisoningWarningActive: input.addressPoisoningWarningActive,
    report
  });
  if (typedMessage) {
    return {
      ...typedMessage,
      replyMarkup: userIncomingDepositRiskKeyboard({
        jobId: input.jobId,
        sender: input.sender,
        txHash: input.txHash
      })
    };
  }
  const eventTime = formatNotificationMskTime(input.timestamp, locale);
  const title = locale === "en"
    ? `Incoming USDT${eventTime ? ` — ${eventTime}` : ""}`
    : `Входящий USDT${eventTime ? ` — ${eventTime}` : ""}`;
  const riskLine = report.depositRiskScore === null
    ? `${bold(locale === "en" ? "Deposit risk" : "Риск депозита")}: ${code(locale === "en" ? "no final score" : "нет итоговой оценки")}`
    : `${bold(riskObjectLabel("deposit", locale))}: ${incomingDepositRiskIcon(report.riskBand)} ${code(`${report.depositRiskScore}/100`)} (${code(report.riskBand ?? "unknown")})`;
  const contextLine = report.depositRiskScore === null
    ? `${bold(locale === "en" ? "Observed context" : "Наблюдаемый контекст")}: ${code(String(report.observedContextScore))}`
    : null;
  const message = telegramHtmlMessage([
    bold(title),
    `${bold(decisionLabel(locale))}: ${code(report.decision)}`,
    riskLine,
    contextLine,
    input.addressPoisoningWarningActive
      ? locale === "en"
        ? "⚠️ Address substitution warning remains active."
        : "⚠️ Предупреждение о возможной подмене адреса остаётся активным."
      : null,
    [
      `${bold(locale === "en" ? "Amount" : "Сумма")}: ${code(`${input.amount} USDT`)}`,
      `${bold(locale === "en" ? "Watched wallet" : "Кошелек")}: ${code(input.watchedWallet)}`,
      `${bold(locale === "en" ? "Sender" : "Отправитель")}: ${code(input.sender)}`
    ].join("\n"),
    section(locale === "en" ? "Reasons" : "Причины", [formatIncomingDepositReasons(report, locale)]),
    section(checksLabel(locale), [
      `${bold(fastSenderCheckLabel(locale))}: ${formatFastSenderRisk(report)}`,
      incomingOriginConfidenceLabel(report, locale),
      `${bold(locale === "en" ? "Sender role" : "Роль отправителя")}: ${code(senderRoleText(report.senderRole, locale))}`
    ]),
    `${bold(locale === "en" ? "Tx" : "Транзакция")}: ${code(input.txHash)}`
  ]);

  return {
    ...message,
    replyMarkup: userIncomingDepositRiskKeyboard({
      jobId: input.jobId,
      sender: input.sender,
      txHash: input.txHash
    })
  };
}

export function formatUserIncomingAlert(input: {
  amount: string;
  watchedWallet: string;
  sender: string;
  txHash: string;
  report: RiskReport;
}): TelegramAlertMessage {
  return telegramHtmlMessage([
    bold("Incoming USDT"),
    formatRiskLine(input.report),
    [
      `${bold("Amount")}: ${code(`${input.amount} USDT`)}`,
      `${bold("Watched wallet")}: ${code(input.watchedWallet)}`,
      `${bold("From")}: ${code(input.sender)}`
    ].join("\n"),
    section("Reasons", [formatReasons(input.report)]),
    `${bold("Tx")}: ${code(input.txHash)}`
  ]);
}

export function formatAdminSuspiciousAlert(input: {
  telegramUserId: string;
  telegramUsername: string | null;
  watchedWallet: string;
  amount: string;
  sender: string;
  txHash: string;
  report: RiskReport;
}): TelegramAlertMessage {
  const user = input.telegramUsername
    ? `@${escapeHtml(input.telegramUsername)} - tg_id: ${code(input.telegramUserId)}`
    : `tg_id: ${code(input.telegramUserId)}`;

  return telegramHtmlMessage([
    `${bold(`${input.report.level} incoming event`)} \u00B7 ${code(`${input.report.score}/100`)}`,
    [
      `${bold("User")}: ${user}`,
      `${bold("Watched wallet")}: ${code(input.watchedWallet)}`,
      `${bold("Sender")}: ${code(input.sender)}`,
      `${bold("Amount")}: ${code(`${input.amount} USDT`)}`
    ].join("\n"),
    section("Reasons", [formatReasons(input.report)]),
    `${bold("Tx")}: ${code(input.txHash)}`
  ]);
}

export function formatUserApprovalAlert(input: {
  locale?: BotLocale;
  watchedWallet: string;
  token: string;
  spender: string;
  spenderType: string;
  spenderIdentity?: string | null;
  allowanceType: string;
  allowanceAmount?: string;
  approvalAt?: Date | null;
  signedAt?: Date | null;
  expirationAt?: Date | null;
  approvalTxHash: string;
  report: RiskReport;
  approvalPresentationInput?: ApprovalPresentationInputV1;
  approvalPresentationEvaluatedAt?: Date | null;
}): TelegramAlertMessage {
  const locale = input.locale ?? DEFAULT_BOT_LOCALE;
  const typed = formatTypedApprovalAlert({ ...input, locale });
  if (typed) return typed;
  const eventTime = formatNotificationMskTime(input.approvalAt ?? input.signedAt ?? null, locale);
  const title = `USDT approval${eventTime ? ` — ${eventTime}` : ""}`;
  return telegramHtmlMessage([
    bold(title),
    `${bold(decisionLabel(locale))}: ${code(displayDecisionFromRiskScore(input.report.score))}`,
    formatApprovalRiskLine(input.report, locale),
    formatApprovalDetails(input, locale),
    section(locale === "en" ? "Meaning" : "Что это значит", [
      locale === "en" ? "This is not proven theft." : "Это не доказанная кража.",
      locale === "en"
        ? "But the wallet may be unsafe to work with while this approval is active."
        : "Но кошелёк может быть небезопасен для работы, пока approval активен."
    ]),
    section(whyLabel(locale), [formatLocalizedReasons(input.report, locale)]),
    formatApprovalTimeSection(input, locale),
    `${bold(locale === "en" ? "Approval tx" : "Approval tx")}: ${code(input.approvalTxHash)}`,
    readOnlyNotice(locale)
  ]);
}

export function formatUserApprovalPendingAlert(input: {
  locale?: BotLocale;
  watchedWallet: string;
  token: string;
  spender: string;
  spenderType: string;
  spenderIdentity?: string | null;
  allowanceType: string;
  allowanceAmount?: string;
  approvalAt?: Date | null;
  signedAt?: Date | null;
  expirationAt?: Date | null;
  contextDeadlineAt: Date;
  approvalTxHash: string;
  report: RiskReport;
  approvalPresentationInput?: ApprovalPresentationInputV1;
  approvalPresentationEvaluatedAt?: Date | null;
}): TelegramAlertMessage {
  const locale = input.locale ?? DEFAULT_BOT_LOCALE;
  const typed = formatTypedApprovalAlert({ ...input, locale });
  if (typed) return typed;
  const title = locale === "en" ? "Smart-contract signature" : "Подписан smart contract";
  return telegramHtmlMessage([
    bold(title),
    `${bold(statusLabel(locale))}: ${escapeHtml(locale === "en" ? "waiting for operation context" : "ждём контекст операции")}`,
    formatApprovalRiskLine(input.report, locale),
    locale === "en"
      ? "Final result will arrive in a separate message."
      : "Финальный результат придёт отдельным сообщением.",
    locale === "en" ? "This is not proven theft yet." : "Это ещё не доказанная кража.",
    formatApprovalDetails(input, locale),
    formatApprovalTimeSection(input, locale),
    section(whyLabel(locale), [formatLocalizedReasons(input.report, locale)]),
    `${bold(locale === "en" ? "Approval tx" : "Approval tx")}: ${code(input.approvalTxHash)}`,
    readOnlyNotice(locale)
  ]);
}

export function formatUserApprovalContextResultAlert(input: {
  locale?: BotLocale;
  watchedWallet: string;
  token: string;
  spender: string;
  spenderType: string;
  spenderIdentity?: string | null;
  allowanceType: string;
  allowanceAmount?: string;
  approvalAt?: Date | null;
  signedAt?: Date | null;
  expirationAt?: Date | null;
  contextDeadlineAt?: Date | null;
  approvalTxHash: string;
  initialReport: RiskReport;
  finalReport: RiskReport;
  result: "linked_swap_route" | "no_route_found" | "collector_drain";
  linkedRouteTxHash?: string | null;
  routeServiceTags?: string[];
  approvalPresentationInput?: ApprovalPresentationInputV1;
  approvalPresentationEvaluatedAt?: Date | null;
}): TelegramAlertMessage {
  const locale = input.locale ?? DEFAULT_BOT_LOCALE;
  const typed = formatTypedApprovalAlert({ ...input, locale });
  if (typed) return typed;
  const title = input.result === "linked_swap_route"
    ? (locale === "en" ? "Approval context found" : "Контекст approval найден")
    : input.result === "collector_drain"
      ? (locale === "en" ? "USDT outflow after approval found" : "Найден вывод USDT после approval")
      : (locale === "en" ? "Approval context not found" : "Контекст approval не найден");
  const routeText = input.routeServiceTags && input.routeServiceTags.length > 0
    ? input.routeServiceTags.join(" / ")
    : "bridge/swap";
  const routeSuffix = routeText ? `: ${escapeHtml(routeText)}` : "";
  const meaningLines = input.result === "linked_swap_route"
    ? [
        locale === "en"
          ? `Approval is linked to a bridge/swap operation${routeSuffix}.`
          : `Approval связан с bridge/swap-операцией${routeSuffix}.`,
        locale === "en" ? "USDT drain spend is not proven." : "Списания USDT как drain не доказаны."
      ]
    : input.result === "collector_drain"
      ? [
          locale === "en"
            ? "USDT outflow after approval was observed. Exact drain proof depends on spender and transferFrom match."
            : "После approval найден вывод USDT. Точный drain доказывается только при совпадении spender и transferFrom.",
          locale === "en"
            ? "Treat this wallet as unsafe to work with while this approval is active."
            : "Пока approval активен, кошелёк небезопасен для работы."
        ]
      : [
          locale === "en"
            ? "No related bridge/swap operation was found in the context window."
            : "Связанная bridge/swap-операция не найдена в окне проверки.",
          locale === "en"
            ? "Treat this wallet as unsafe to work with while this approval is active."
            : "Пока approval активен, кошелёк небезопасен для работы."
        ];
  return telegramHtmlMessage([
    bold(title),
    `${bold(decisionLabel(locale))}: ${code(displayDecisionFromRiskScore(input.finalReport.score))}`,
    formatApprovalRiskLine(input.finalReport, locale),
    `${bold(locale === "en" ? "Initial status" : "Первичный статус")}: ${escapeHtml(`${input.initialReport.level}, ${input.initialReport.score}/100`)}`,
    section(locale === "en" ? "Meaning" : "Что это значит", meaningLines),
    formatApprovalDetails(input, locale),
    formatApprovalTimeSection(input, locale),
    input.linkedRouteTxHash ? `${bold(approvalContextTxLabel(input.result, locale))}: ${code(input.linkedRouteTxHash)}` : null,
    section(locale === "en" ? "Final reasons" : "Финальные причины", [formatLocalizedReasons(input.finalReport, locale)]),
    `${bold(locale === "en" ? "Approval tx" : "Approval tx")}: ${code(input.approvalTxHash)}`,
    readOnlyNotice(locale)
  ]);
}

export function formatDigestAlert(input: {
  walletAddress: string;
  intervalMinutes: number;
  transactionCount: number;
  totalUsdt: string;
  uniqueSenderCount: number;
  riskyTransactionCount: number;
  riskySenderCount: number;
  topRisky?: { level: RiskReport["level"]; score: number; sender: string } | null;
}): TelegramAlertMessage {
  return telegramHtmlMessage([
    bold("USDT digest"),
    [
      `${bold("Wallet")}: ${code(input.walletAddress)}`,
      `${bold("Window")}: ${code(`${input.intervalMinutes} min`)}`,
      `${bold("Incoming")}: ${code(`${input.transactionCount} tx`)}`,
      `${bold("Total")}: ${code(`${input.totalUsdt} USDT`)}`,
      `${bold("Senders")}: ${code(String(input.uniqueSenderCount))}`,
      `${bold("Risky")}: ${code(`${input.riskyTransactionCount} tx / ${input.riskySenderCount} sender${input.riskySenderCount === 1 ? "" : "s"}`)}`
    ].join("\n"),
    input.topRisky
      ? section("Top risky", [
          `${input.topRisky.level} ${input.topRisky.score}/100 from ${code(input.topRisky.sender)}`,
          "High-risk tx were alerted immediately"
        ])
      : null
  ]);
}

export function formatAdminApprovalAlert(input: {
  telegramUserId: string;
  telegramUsername: string | null;
  watchedWallet: string;
  spender: string;
  spenderType: string;
  spenderIdentity?: string | null;
  approvalTxHash: string;
  report: RiskReport;
}): TelegramAlertMessage {
  const user = input.telegramUsername
    ? `@${escapeHtml(input.telegramUsername)} - tg_id: ${code(input.telegramUserId)}`
    : `tg_id: ${code(input.telegramUserId)}`;

  return telegramHtmlMessage([
    `${bold(`${input.report.level} approval event`)} \u00B7 ${code(`${input.report.score}/100`)}`,
    [
      `${bold("User")}: ${user}`,
      `${bold("Watched wallet")}: ${code(input.watchedWallet)}`,
      `${bold("Spender")}: ${code(input.spender)}`,
      `${bold("Identity")}: ${code(input.spenderIdentity ?? "unknown")}`,
      `${bold("Spender type")}: ${escapeHtml(formatSpenderType(input.spenderType))}`
    ].join("\n"),
    section("Reasons", [formatReasons(input.report)]),
    `${bold("Approval tx")}: ${code(input.approvalTxHash)}`
  ]);
}
