import type { BotLocale, IncomingDepositRiskReport, RiskReport } from "../types";
import { DEFAULT_BOT_LOCALE } from "../bot/i18n";
import { userIncomingDepositRiskKeyboard } from "./keyboards";
import { formatNotificationMskTime } from "./notificationTime";
import {
  checkedOriginLabel,
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
    formatApprovalTimeLine(locale === "en" ? "Signed" : "Подписано", input.signedAt, locale),
    formatApprovalTimeLine(locale === "en" ? "Expires" : "Истекает", input.expirationAt, locale),
    formatApprovalTimeLine(locale === "en" ? "Context deadline" : "Дедлайн контекста", input.contextDeadlineAt, locale)
  ];
  const body = lines.filter((line): line is string => line !== null);
  return body.length > 0 ? section(locale === "en" ? "Time" : "Время", body) : null;
}

function formatApprovalRiskLine(report: RiskReport, locale: BotLocale): string {
  return `${formatRiskIcon(report.level)} ${bold(riskObjectLabel("approval", locale))}: ${code(`${report.score}/100`)} (${code(report.level)})`;
}

function readOnlyNotice(locale: BotLocale): string {
  return locale === "en"
    ? "Read-only: bot never signs transactions, never asks for seed/private key, and never controls funds."
    : "Только чтение: бот не подписывает транзакции, не просит seed/private key и не управляет средствами.";
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

function formatIncomingDepositReasons(report: IncomingDepositRiskReport, locale: BotLocale): string {
  const reasons = report.reasons.length > 0
    ? report.reasons.slice(0, MAX_REASON_COUNT).map((reason) => normalizeNotificationReason(reason, locale))
    : [missingIncomingDepositReasonText(report, locale)];
  return bulletList(reasons);
}

function aiContractVerdictLabel(locale: BotLocale): string {
  return locale === "en" ? "AI contract verdict" : "AI-оценка контракта";
}

function fastSenderCheckLabel(locale: BotLocale): string {
  return locale === "en" ? "Fast sender check" : "Быстрая проверка отправителя";
}

function formatFastSenderRisk(report: IncomingDepositRiskReport): string {
  if (!report.fastSenderRisk) return code("unknown");
  return `${code(`${report.fastSenderRisk.score}/100`)} (${code(report.fastSenderRisk.level)})`;
}

function formatContractAddress(address: string | null): string {
  if (!address) return "unknown";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatIncomingDepositContractVerdicts(report: IncomingDepositRiskReport, locale: BotLocale): string | null {
  if (report.contractVerdicts.length === 0) return null;
  const addressConnector = locale === "en" ? "for" : "для";
  return bulletList(report.contractVerdicts.slice(0, 3).map((verdict) => {
    const reason = verdict.reasons[0] ? ` - ${verdict.reasons[0]}` : "";
    return `${verdict.verdict} ${verdict.contractRiskScore}/100 ${addressConnector} ${formatContractAddress(verdict.contractAddress)}${reason}`;
  }));
}

export function formatIncomingDepositRiskAlert(input: {
  jobId: string;
  amount: string;
  watchedWallet: string;
  sender: string;
  txHash: string;
  timestamp?: Date | null;
  locale?: BotLocale;
  report: IncomingDepositRiskReport;
}): IncomingDepositRiskAlertMessage {
  const locale = input.locale ?? DEFAULT_BOT_LOCALE;
  const eventTime = formatNotificationMskTime(input.timestamp, locale);
  const title = locale === "en"
    ? `Incoming USDT${eventTime ? ` — ${eventTime}` : ""}`
    : `Входящий USDT${eventTime ? ` — ${eventTime}` : ""}`;
  const aiSection = formatIncomingDepositContractVerdicts(input.report, locale);
  const message = telegramHtmlMessage([
    bold(title),
    `${bold(decisionLabel(locale))}: ${code(input.report.decision)}`,
    `${bold(riskObjectLabel("deposit", locale))}: ${code(`${input.report.depositRiskScore}/100`)} (${code(input.report.riskBand)})`,
    [
      `${bold(locale === "en" ? "Amount" : "Сумма")}: ${code(`${input.amount} USDT`)}`,
      `${bold(locale === "en" ? "Watched wallet" : "Кошелек")}: ${code(input.watchedWallet)}`,
      `${bold(locale === "en" ? "Sender" : "Отправитель")}: ${code(input.sender)}`
    ].join("\n"),
    section(locale === "en" ? "Reasons" : "Причины", [formatIncomingDepositReasons(input.report, locale)]),
    aiSection ? section(aiContractVerdictLabel(locale), [aiSection]) : null,
    section(checksLabel(locale), [
      `${bold(fastSenderCheckLabel(locale))}: ${formatFastSenderRisk(input.report)}`,
      checkedOriginLabel(input.report.originCoverage, locale),
      `${bold(locale === "en" ? "Sender role" : "Роль отправителя")}: ${code(senderRoleText(input.report.senderRole, locale))}`
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
}): TelegramAlertMessage {
  const locale = input.locale ?? DEFAULT_BOT_LOCALE;
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
}): TelegramAlertMessage {
  const locale = input.locale ?? DEFAULT_BOT_LOCALE;
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
  approvalTxHash: string;
  initialReport: RiskReport;
  finalReport: RiskReport;
  result: "linked_swap_route" | "no_route_found" | "collector_drain";
  linkedRouteTxHash?: string | null;
  routeServiceTags?: string[];
}): TelegramAlertMessage {
  const locale = input.locale ?? DEFAULT_BOT_LOCALE;
  const title = input.result === "linked_swap_route"
    ? (locale === "en" ? "Approval context found" : "Контекст approval найден")
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
    formatApprovalRiskLine(input.finalReport, locale),
    `${bold(locale === "en" ? "Initial status" : "Первичный статус")}: ${escapeHtml(`${input.initialReport.level}, ${input.initialReport.score}/100`)}`,
    section(locale === "en" ? "Meaning" : "Что это значит", meaningLines),
    formatApprovalDetails(input, locale),
    formatApprovalTimeSection(input, locale),
    input.linkedRouteTxHash ? `${bold(locale === "en" ? "Linked route tx" : "Связанная tx")}: ${code(input.linkedRouteTxHash)}` : null,
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
