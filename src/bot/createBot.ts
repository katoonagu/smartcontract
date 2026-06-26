import { Bot, type Context, type InlineKeyboard } from "grammy";
import type { AppConfig } from "../config";
import { checkAddress, checkTransactionHash } from "../check/manualCheck";
import type { ManualCheckResult, ManualRiskSignals } from "../check/manualCheck";
import type { SmartContractCheckReport } from "../check/smartContractCheck";
import { loadTheftReportTransfer } from "../check/theftReportTransaction";
import { createAddressExposureRiskSignalProvider } from "../check/addressExposureSignals";
import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import { addressBehaviorEffectiveScore } from "../forensics/addressBehavior";
import {
  extractUsdtTransferDisplayContext,
  extractUsdtTransferSeedFromTransaction,
  runTransactionOriginCheck,
  type TransactionOriginDisplayContext
} from "../forensics/transactionOriginCheck";
import { parseUsdtAmountToRaw } from "../forensics/whereIsMoneyCliArgs";
import { buildRiskClaritySummary, type RiskClaritySummary } from "../risk/riskClarity";
import { calculateRisk, type RiskSignal } from "../risk/riskEngine";
import { calculateUnifiedWalletRisk, hasUnifiedFastHardEvidence, type UnifiedWalletRiskResult } from "../risk/unifiedWalletRisk";
import type { Db } from "../storage/db";
import { formatSafetyRecheckSummary, parseSafetyRecheckTarget, runSafetyRecheck } from "../approvals/safetyRecheck";
import {
  addCustomerAlertRecipient,
  addWatchedWallet,
  cancelTheftReport,
  clearTelegramUserPendingAction,
  confirmTheftReportDeposit,
  getTelegramUserSession,
  getTheftReport,
  getWalletApprovalSummary,
  getWalletDashboardSnapshot,
  getWalletPollState,
  getAddressMetadata,
  getContractIntelligenceProfile,
  getForensicCheckJob,
  getTelegramUserLocale,
  listCustomerAlertRecipients,
  listAddressLabels,
  listWatchedWallets,
  markTheftReportAwaitingDeposit,
  removeCustomerAlertRecipient,
  removeWatchedWallet,
  saveAddressLabel,
  saveAddressFastCheckJob as saveAddressFastCheckJobRecord,
  createOrReuseForensicCheckJob,
  saveRiskEvaluationEvidence,
  upsertAddressMetadata,
  upsertContractIntelligenceProfile,
  setTelegramUserPendingAction,
  updateTelegramUserLocale,
  updateTheftReportComment,
  updateWatchedWalletAlertMode,
  upsertTheftReportDraft,
  upsertTelegramUser,
  upsertWalletDashboardSnapshot
} from "../storage/repositories";
import type { AddressFastCheckJobInput, CustomerAlertMode, ForensicCheckJob, TheftReport } from "../storage/repositories";
import type {
  ApprovalDrainProvenanceProfile,
  BalanceFormingTransfer,
  BoundaryExposureProfile,
  CounterpartyRiskProfile,
  CrossChainContinuationReasoningStep,
  DirectCounterpartyInteractionProfile,
  ExtendedProvenanceProfile,
  InboundProvenanceProfile,
  OperationalFlowProfile,
  RiskLabel,
  RiskLevel,
  RiskReport,
  StablecoinRestrictionProfile,
  BotLocale,
  WhereIsMoneyReport,
  WalletAlertMode,
  WalletRoleProfile,
  WatchedWallet
} from "../types";
import { classifyInput } from "../tron/address";
import type { TronApprovalClient, TronClient, TronDashboardClient } from "../tron/tronClient";
import { getWalletDashboard } from "../wallet/dashboard";
import {
  bold,
  bulletList,
  code,
  escapeHtml,
  formatRiskIcon,
  section,
  telegramHtmlMessage,
  type TelegramHtmlMessage
} from "../alerts/telegramHtml";
import { formatNotificationMskTime } from "../alerts/notificationTime";
import {
  deepCompactMeaningLines
} from "../alerts/notificationSummaries";
import { normalizeNotificationReason, riskObjectLabel, whyLabel } from "../alerts/notificationText";
import {
  addWalletPrompt,
  addAlertAdminPrompt,
  alertAdminAddedMessage,
  alertAdminNotFoundMessage,
  alertAdminRemovedMessage,
  alertAdminsMessage,
  analyticsMessage,
  checkAddressPrompt,
  checkTxPrompt,
  dashboardMessage,
  helpMessage,
  homeMessage,
  myIdMessage,
  profileMessage,
  removeAlertAdminPrompt,
  removeConfirmMessage,
  riskIntelOverviewMessage,
  safetyMessage,
  securityMessage,
  settingsMessage,
  walletAlertModeMessage,
  walletAlertModeUpdatedMessage,
  walletsMessage
} from "./messages";
import {
  addressCheckResultKeyboard,
  alertAdminsKeyboard,
  backToWalletKeyboard,
  cancelKeyboard,
  mainMenuKeyboard,
  parseCallbackData,
  profileKeyboard,
  settingsKeyboard,
  theftReportCardKeyboard,
  theftReportDepositKeyboard,
  theftReportNextStepsKeyboard,
  walletAlertModeKeyboard,
  walletDashboardKeyboard,
  walletSafetyKeyboard,
  walletRemoveKeyboard,
  walletsKeyboard
} from "./keyboards";
import { DEFAULT_BOT_LOCALE, languageName, normalizeBotLocale, riskLevelText } from "./i18n";
import { shouldHandlePendingText } from "./pendingActions";

const ALLOWED_LABELS: readonly RiskLabel[] = [
  "scam",
  "reported_scam",
  "stolen_funds",
  "phishing",
  "victim",
  "mule",
  "collector",
  "bridge",
  "exchange",
  "trusted",
  "false_positive",
  "needs_review",
  "mixer_like",
  "risky_contract",
  "whitebit",
  "darknet_exchange",
  "approval_drain_proximity"
];

const allowedLabelSet = new Set<RiskLabel>(ALLOWED_LABELS);
const allowedWalletAlertModes = new Set<WalletAlertMode>(["realtime", "risk_only", "digest", "paused"]);
const telegramIdPattern = /^\d{1,20}$/;
const TRANSACTION_ORIGIN_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;
const ADDRESS_PROFILE_HISTORY_MS = 90 * 24 * 60 * 60 * 1000;

type BotMessage = string | TelegramHtmlMessage;
type BotSendOptions = {
  reply_markup?: InlineKeyboard;
  parse_mode?: "HTML";
};
type QueueAddressForensicJobInput = {
  subjectAddress: string;
  chatId: string | null;
  requestedBy: string | null;
  mode?: "where_is_money" | "transaction_check" | "wallet_profile";
  requestedAmountRaw?: string | null;
  seedTransfers?: BalanceFormingTransfer[];
  windowStart?: Date;
  windowEnd?: Date;
  fastRiskSnapshot?: FastRiskSnapshot;
  crossChainManualDeepMode?: boolean;
  locale?: BotLocale;
};
type SmartContractCheckOutcome =
  | { kind: "not_contract" }
  | { kind: "report"; report: SmartContractCheckReport }
  | { kind: "unavailable"; error?: string | null };

type SmartContractCheckReturn = SmartContractCheckOutcome | SmartContractCheckReport | null;

type CreateBotOptions = {
  getAddressRiskSignalsForAddress?: (address: string) => Promise<ManualRiskSignals>;
  checkSmartContractAddress?: (input: { address: string; telegramUserId: string | null; locale: BotLocale }) => Promise<SmartContractCheckReturn>;
  queueWhereIsMoneyJob?: (input: QueueAddressForensicJobInput) => Promise<ForensicCheckJob>;
  queueDeepForensicJob?: (input: QueueAddressForensicJobInput) => Promise<ForensicCheckJob>;
  saveAddressFastCheckJob?: (input: AddressFastCheckJobInput) => Promise<ForensicCheckJob>;
  getForensicCheckJob?: (id: string) => Promise<ForensicCheckJob | null>;
};

function telegramId(ctx: { from?: { id: number } }): string {
  if (!ctx.from?.id) throw new Error("Telegram user id is missing");
  return String(ctx.from.id);
}

function isServiceAdmin(config: AppConfig, id: string): boolean {
  return config.serviceAdminTelegramIds.has(id);
}

function messageText(message: BotMessage): string {
  return typeof message === "string" ? message : message.text;
}

function messageOptions(message: BotMessage, keyboard?: InlineKeyboard): BotSendOptions | undefined {
  const options: BotSendOptions = {};
  if (keyboard) options.reply_markup = keyboard;
  if (typeof message !== "string") options.parse_mode = message.parseMode;
  return Object.keys(options).length > 0 ? options : undefined;
}

async function sendMessage(
  ctx: { reply(text: string, options?: BotSendOptions): Promise<unknown> },
  message: BotMessage,
  keyboard?: InlineKeyboard
): Promise<void> {
  await ctx.reply(messageText(message), messageOptions(message, keyboard));
}

function combineMessages(messages: TelegramHtmlMessage[]): TelegramHtmlMessage {
  return {
    text: messages.map((message) => message.text).join("\n\n"),
    parseMode: "HTML"
  };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatRawUsdt(amountRaw: string): string {
  if (!/^\d+$/.test(amountRaw)) return amountRaw;
  const raw = BigInt(amountRaw);
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} USDT` : `${whole} USDT`;
}

function theftReportTxPrompt(locale: BotLocale): TelegramHtmlMessage {
  return telegramHtmlMessage([
    bold(locale === "en" ? "🚨 Report theft" : "🚨 Сообщить о краже"),
    locale === "en"
      ? "Send the TRON transaction hash for the USDT transfer that left your wallet."
      : "Отправьте TRON transaction hash перевода USDT, который ушел с вашего кошелька.",
    `${bold(locale === "en" ? "Format" : "Формат")}: ${code("64 hex chars")}`
  ]);
}

function theftReportInvalidTxMessage(locale: BotLocale): TelegramHtmlMessage {
  return telegramHtmlMessage([
    bold(locale === "en" ? "Invalid transaction hash" : "Неверный transaction hash"),
    locale === "en"
      ? `Send a TRON transaction hash in this format: ${code("64 hex chars")}.`
      : `Отправьте TRON transaction hash в формате: ${code("64 hex chars")}.`
  ]);
}

function theftReportTxParseFailedMessage(locale: BotLocale): TelegramHtmlMessage {
  return telegramHtmlMessage([
    bold(locale === "en" ? "Could not parse transaction" : "Не удалось разобрать транзакцию"),
    locale === "en"
      ? "Could not parse this transaction as a successful outgoing official TRON USDT transfer from your wallet."
      : "Не удалось распознать эту транзакцию как успешный исходящий official TRON USDT перевод с вашего кошелька.",
    locale === "en" ? "Check the hash and send it again." : "Проверьте hash и отправьте его еще раз."
  ]);
}

function theftReportCardMessage(report: TheftReport, locale: BotLocale): TelegramHtmlMessage {
  return telegramHtmlMessage([
    bold(locale === "en" ? "🚨 Theft report" : "🚨 Заявка о краже"),
    [
      `${bold(locale === "en" ? "From wallet" : "С этого кошелька")}: ${code(report.victimAddress)}`,
      `${bold(locale === "en" ? "Amount sent" : "Ушла сумма")}: ${code(`${report.amountUsdt} USDT`)}`,
      `${bold(locale === "en" ? "To wallet" : "На кошелек")}: ${code(report.reportedScamAddress)}`,
      `${bold("Tx")}: ${code(report.txHash)}`,
      `${bold(locale === "en" ? "Comment" : "Комментарий")}: ${report.comment ? escapeHtml(report.comment) : locale === "en" ? "not set" : "не указан"}`
    ].join("\n")
  ]);
}

function theftReportDepositMessage(report: TheftReport, locale: BotLocale): TelegramHtmlMessage {
  const depositAddress = report.depositAddress
    ? code(report.depositAddress)
    : locale === "en" ? "not configured" : "не настроен";
  return telegramHtmlMessage([
    bold(locale === "en" ? "Deposit required" : "Нужен депозит"),
    locale === "en"
      ? `Send ${code(report.depositAmountUsdt)} USDT to activate the preliminary theft signal.`
      : `Отправьте ${code(report.depositAmountUsdt)} USDT, чтобы активировать предварительный сигнал о краже.`,
    [
      `${bold(locale === "en" ? "Deposit wallet" : "Кошелек для депозита")}: ${depositAddress}`,
      `${bold(locale === "en" ? "Amount" : "Сумма")}: ${code(`${report.depositAmountUsdt} USDT`)}`
    ].join("\n"),
    report.depositAddress
      ? null
      : locale === "en"
        ? "Deposit wallet is not configured. Contact admin before sending funds."
        : "Кошелек депозита не настроен. Свяжитесь с админом перед оплатой."
  ].filter((line): line is string => Boolean(line)));
}

function theftReportNextStepsMessage(report: TheftReport, locale: BotLocale): TelegramHtmlMessage {
  return telegramHtmlMessage([
    bold(locale === "en" ? "Report accepted" : "Заявка принята"),
    locale === "en"
      ? "Paid preliminary signal is active: the receiver wallet is marked with the reported_scam label."
      : "Платный предварительный сигнал активен: кошелек получателя помечен меткой reported_scam.",
    locale === "en"
      ? "Prepare a formal statement and documents that confirm wallet ownership and the outgoing transfer."
      : "Подготовьте официальное заявление и документы, которые подтверждают владение кошельком и исходящий перевод.",
    locale === "en"
      ? "Tracing and freezing attempts can start after review. The service deposit fee is 20%."
      : "Попытки трассировки и заморозки могут начаться после проверки. Депозитная комиссия сервиса - 20%.",
    `${bold(locale === "en" ? "Report ID" : "ID заявки")}: ${code(report.id)}`
  ]);
}

function theftReportGuideFallbackMessage(locale: BotLocale): TelegramHtmlMessage {
  return telegramHtmlMessage([
    bold(locale === "en" ? "📘 Theft report guide" : "📘 Инструкция по заявке"),
    bulletList(locale === "en"
      ? [
          "Save the transaction hash and screenshots from the wallet.",
          "Prepare proof that the victim wallet belongs to you.",
          "Prepare the exchange, police, or legal documents you already have.",
          "Do not send seed phrases, private keys, or signed transactions."
        ]
      : [
          "Сохраните transaction hash и скриншоты из кошелька.",
          "Подготовьте подтверждение, что victim wallet принадлежит вам.",
          "Подготовьте документы от биржи, полиции или юристов, если они уже есть.",
          "Не отправляйте seed phrases, private keys или подписанные транзакции."
        ])
  ]);
}

function theftReportAdminContactMessage(report: TheftReport, contact: string | undefined, locale: BotLocale): TelegramHtmlMessage {
  return telegramHtmlMessage([
    bold(locale === "en" ? "👤 Contact admin" : "👤 Связаться с админом"),
    contact
      ? (locale === "en" ? `Contact: ${escapeHtml(contact)}` : `Контакт: ${escapeHtml(contact)}`)
      : (locale === "en"
          ? `Admin contact is not configured. Send the report ID to support: ${code(report.id)}.`
          : `Контакт админа не настроен. Отправьте ID заявки в поддержку: ${code(report.id)}.`)
  ]);
}

function formatDurationMs(value: number | null): string {
  if (value === null) return "none";
  const minute = 60_000;
  const hour = 60 * minute;
  if (value < minute) return `${Math.round(value / 1000)}s`;
  if (value < hour) return `${Math.round(value / minute)}m`;
  return `${Math.round(value / hour)}h`;
}

function userFacingLine(locale: BotLocale, line: string): string {
  if (locale === "en") return normalizeNotificationReason(line, locale);
  const exact: Record<string, string> = {
    "Service exposure candidate; manual review required.": "Есть service exposure candidate; нужна ручная проверка.",
    "Funds reached service/CEX/bridge boundary; public-chain continuity should not be assumed.": "Деньги дошли до service/CEX/bridge boundary. Нельзя считать, что публичная on-chain цепочка продолжается дальше.",
    "Unknown contract exposure requires manual review.": "Есть контакт с unknown contract; нужна ручная проверка.",
    "Some provider checks were incomplete; review coverage before treating this as final.": "Часть provider-проверок неполная. Перед выводами проверьте покрытие.",
    "Deep result may add or change context.": "Deep-анализ может добавить или изменить контекст.",
    "Deep analysis completed with limited coverage.": "Deep-анализ завершен с ограниченным покрытием.",
    "No strong risk signals were found in the currently connected checks.": "Подключенные проверки не нашли сильных risk-сигналов.",
    "No strong fast-check signals were found yet; deep analysis may add context.": "Быстрая проверка пока не нашла сильных сигналов. Deep-анализ может добавить контекст.",
    "Connected risk modules found review-worthy signals. Manual review is recommended.": "Подключенные модули нашли сигналы для проверки. Нужна ручная проверка.",
    "Outgoing USDT reaches service, router, CEX, bridge, or contract infrastructure. Manual review is recommended.": "Исходящие USDT доходят до service/router/CEX/bridge/contract инфраструктуры. Нужна ручная проверка.",
    "The address shows rapid transit-like USDT movement. This can also match some legitimate operational wallets.": "Адрес похож на быстрый транзит USDT. Это также может быть нормальным поведением operational wallet.",
    "The official TRON USDT contract reports this address as blacklisted. This is exact token-contract state, not a behavioral guess.": "Официальный TRON USDT контракт показывает адрес как blacklisted. Это точное состояние контракта, не поведенческая догадка.",
    "No exact provenance path found.": "Точная provenance-цепочка не найдена.",
    "No additional service/behavior context found.": "Дополнительный service/behavior контекст не найден.",
    "30-day activity was sparse, so latest historical USDT transfers were included for context.": "За 30 дней активности мало, поэтому для контекста добавлены последние исторические USDT переводы.",
    "Service/router boundary reached. Public-chain continuity after this point should not be assumed.": "Цепочка дошла до service/router boundary. После этой точки нельзя уверенно продолжать публичную on-chain связку.",
    "Outgoing USDT preserves most of the recent incoming amount": "Исходящие USDT сохраняют большую часть недавнего входящего объема",
    "Large incoming USDT amount was rapidly redistributed into service infrastructure; manual review required.": "Крупный входящий USDT быстро перераспределен в service-инфраструктуру; нужна ручная проверка.",
    "Address shows high-volume transit-like behavior; this may also match legitimate treasury, trading, merchant, or operational wallet activity.": "Адрес похож на high-volume transit. Это также может быть нормальным поведением treasury/trading/merchant/operational wallet."
  };
  if (exact[line]) return exact[line];
  const outgoingService = /^(\d+%) of outgoing USDT reaches (.+)$/.exec(line);
  if (outgoingService) return `${outgoingService[1]} исходящих USDT доходит до ${outgoingService[2]}.`;
  const amountPreservation = /^Amount preservation on the strongest service route is (\d+%).$/.exec(line);
  if (amountPreservation) return `Сохранение суммы на сильнейшем service-route: ${amountPreservation[1]}.`;
  const redistributed = /^(\d+%) of received USDT was redistributed within ~(.+).$/.exec(line);
  if (redistributed) return `${redistributed[1]} полученных USDT перераспределено примерно за ${redistributed[2]}.`;
  const topOutgoing = /^Top outgoing counterparty (.+) received (.+) across (\d+) transfers \((\d+%)\).$/.exec(line);
  if (topOutgoing) return `Главный исходящий counterparty ${topOutgoing[1]} получил ${topOutgoing[2]} в ${topOutgoing[3]} переводах (${topOutgoing[4]}).`;
  const coverage = /^(\d+) transfer edges scanned; (\d+) inbound senders checked.$/.exec(line);
  if (coverage) return `Просканировано transfer edges: ${coverage[1]}; проверено входящих отправителей: ${coverage[2]}.`;
  const extendedCoverage = /^(\d+) local-index addresses checked by extended search.$/.exec(line);
  if (extendedCoverage) return `Extended search проверил адресов в local-index: ${extendedCoverage[1]}.`;
  if (line.startsWith("New deep finding:")) return line.replace("New deep finding:", "Новая deep-находка:");
  if (line.startsWith("Deep analysis")) return line.replace("Deep analysis", "Deep-анализ");
  return normalizeNotificationReason(line, locale);
}

function userFacingLines(locale: BotLocale, lines: string[]): string[] {
  return lines.map((line) => userFacingLine(locale, line));
}

type ForensicSurface = {
  serviceExposureProfiles: ManualCheckResult["serviceExposureProfiles"];
  addressBehaviorProfiles: ManualCheckResult["addressBehaviorProfiles"];
  inboundProvenanceProfiles?: InboundProvenanceProfile[];
  counterpartyRiskProfiles?: CounterpartyRiskProfile[];
  directCounterpartyInteractionProfiles?: DirectCounterpartyInteractionProfile[];
  approvalDrainProvenanceProfiles?: ApprovalDrainProvenanceProfile[];
  stablecoinRestrictionProfiles?: StablecoinRestrictionProfile[];
  boundaryExposureProfiles?: BoundaryExposureProfile[];
  operationalFlowProfiles?: OperationalFlowProfile[];
  walletRoleProfiles?: WalletRoleProfile[];
  extendedProvenanceProfiles?: ExtendedProvenanceProfile[];
  missingChecks: string[];
};

type FastRiskSnapshot = {
  score: number;
  level: RiskLevel;
  reasons?: RiskReport["reasons"];
};

type UnifiedAddressFinalReportInput = {
  address: string;
  whereReport: WhereIsMoneyReport;
  deepReport?: DeepAddressForensicReport | null;
  fastReport?: RiskReport | null;
  locale?: BotLocale;
  runtimeLabel?: string;
  showBetaDiagnostics?: boolean;
};

const riskLevelRank: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL";
}

function riskLine(report: RiskReport, label = "Risk", includeBeta = true, locale: BotLocale = DEFAULT_BOT_LOCALE): string {
  const labelText = locale === "en" ? label : label === "Risk" ? "Риск" : label;
  const level = locale === "en" ? report.level : `${riskLevelText(locale, report.level)} / ${report.level}`;
  const suffix = includeBeta ? ` (${escapeHtml(level)}, beta)` : ` (${escapeHtml(level)})`;
  return `${bold(labelText)}: ${formatRiskIcon(report.level)} ${code(`${report.score}/100`)}${suffix}`;
}

function riskBreakdownLines(report: RiskReport): string[] {
  const lines: string[] = [];
  if (typeof report.taintScore === "number") {
    lines.push(`${bold("Taint evidence")}: ${code(`${report.taintScore}/100`)}${report.taintScore === 0 ? " - no direct blacklist/scam/approval-drain proof found." : ""}`);
  }
  if (typeof report.launderingPatternScore === "number" && report.launderingPatternScore > 0) {
    lines.push(`${bold("Operational laundering pattern")}: ${code(`${report.launderingPatternScore}/100`)} (${escapeHtml(levelFromScore(report.launderingPatternScore))}) - not a blacklist/scam claim.`);
  }
  return lines;
}

function runtimeMarkerLine(runtimeLabel: string | undefined): string | null {
  const label = runtimeLabel?.trim();
  return label ? `${bold("Runtime")}: ${code(label.slice(0, 120))}` : null;
}

function levelFromScore(score: number): RiskLevel {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function shortIdentifier(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function firstServiceExposureProfile(result: ForensicSurface): ForensicSurface["serviceExposureProfiles"][number] | null {
  const profile = result.serviceExposureProfiles[0] ?? null;
  return profile && profile.exposureScore > 0 ? profile : null;
}

function serviceExposureSignalLines(result: ForensicSurface): string[] {
  const profile = firstServiceExposureProfile(result);
  if (!profile) return [];
  const topMerged = profile.topMergedServiceFlows[0] ?? null;
  const topCounterparty = profile.topServiceCounterparties[0] ?? null;
  const ratio = topMerged ? profile.mergedServiceVolumeRatio : profile.combinedServiceVolumeRatio;
  const category = topMerged?.category ?? topCounterparty?.category ?? profile.dominantCategory ?? "service";
  const identity = topMerged?.identity ?? topCounterparty?.identity ?? null;
  const address = topMerged?.serviceAddress ?? topCounterparty?.address ?? null;
  const flowTarget = identity ?? (address ? shortIdentifier(address) : null);
  const flowSuffix = flowTarget ? ` via ${flowTarget}` : "";
  const lines = [
    `${formatPercent(ratio)} of outgoing USDT reaches ${category} infrastructure${flowSuffix}.`
  ];

  const preservation = topMerged?.amountPreservationRatio ?? profile.bestAmountPreservationRatio;
  if (preservation !== null && preservation !== undefined) {
    lines.push(`Amount preservation on the strongest service route is ${formatPercent(preservation)}.`);
  }
  if (category === "unknown_contract") {
    lines.push("Unknown contract exposure requires manual review.");
  }
  return lines;
}

function addressBehaviorSignalLines(result: ForensicSurface): string[] {
  const profile = result.addressBehaviorProfiles[0] ?? null;
  if (!profile) return [];
  const score = addressBehaviorEffectiveScore(profile);
  const hasLowContext = profile.features.some((feature) => feature.code === "low_context_dampener");
  if (score <= 0 && !hasLowContext) return [];

  const lines: string[] = [];
  if (profile.inflowToOutflowRatio !== null && profile.timeToFirstOutgoingMs !== null) {
    lines.push(`${formatPercent(profile.inflowToOutflowRatio)} of received USDT was redistributed within ~${formatDurationMs(profile.timeToFirstOutgoingMs)}.`);
  }
  if (profile.topOutgoingCounterpartyAddress) {
    lines.push(
      `Top outgoing counterparty ${shortIdentifier(profile.topOutgoingCounterpartyAddress)} received ${formatRawUsdt(profile.topOutgoingCounterpartyRaw ?? "0")} across ${profile.topOutgoingCounterpartyTxCount} transfers (${formatPercent(profile.topOutgoingCounterpartyRatio)}).`
    );
  }
  const primaryReason = profile.features.find((feature) => feature.scoreImpact > 0)?.label ?? null;
  if (primaryReason) lines.push(primaryReason);
  return lines;
}

function firstOperationalFlowProfile(result: ForensicSurface): OperationalFlowProfile | null {
  const profile = result.operationalFlowProfiles?.[0] ?? null;
  return profile && profile.operationalScore > 0 ? profile : null;
}

function operationalFlowSignalLines(result: ForensicSurface): string[] {
  const profile = firstOperationalFlowProfile(result);
  if (!profile) return [];
  const lines = [
    `Terminal liquidity outgoing: ${formatPercent(profile.terminalLiquidityOutgoingRatio)} of outgoing 30d USDT flow.`,
    profile.htxHuobiOutgoingRatio > 0 ? `HTX/Huobi outgoing exposure: ${formatPercent(profile.htxHuobiOutgoingRatio)} of outgoing 30d flow.` : null,
    profile.bridgeDexRouterOutgoingRatio > 0 ? `bridge/DEX/router outgoing exposure: ${formatPercent(profile.bridgeDexRouterOutgoingRatio)} of outgoing 30d flow.` : null,
    ...profile.features.filter((feature) => feature.scoreImpact > 0).map((feature) => feature.label)
  ].filter((line): line is string => Boolean(line));
  return [...new Set(lines)].slice(0, 5);
}

function operationalFlowEvidenceLines(result: ForensicSurface): string[] {
  const profile = firstOperationalFlowProfile(result);
  if (!profile) return [];
  const topOutgoing = profile.topOutgoingCounterparties[0] ?? null;
  return [
    `${bold("Operational laundering pattern")}: ${formatRiskIcon(levelFromScore(profile.operationalScore))} ${code(`${profile.operationalScore}/100`)} (${escapeHtml(levelFromScore(profile.operationalScore))}) - not a blacklist/scam claim`,
    `${bold("Window")}: ${code(`${profile.windowStart} -> ${profile.windowEnd}`)}`,
    `${bold("Terminal liquidity outgoing")}: ${code(formatPercent(profile.terminalLiquidityOutgoingRatio))}`,
    `${bold("HTX/Huobi outgoing")}: ${code(formatPercent(profile.htxHuobiOutgoingRatio))}; ${bold("bridge/DEX/router outgoing")}: ${code(formatPercent(profile.bridgeDexRouterOutgoingRatio))}`,
    topOutgoing ? `${bold("Top outgoing")}: ${code(`${topOutgoing.identity ?? shortIdentifier(topOutgoing.address)} ${formatRawUsdt(topOutgoing.volumeRaw)} (${formatPercent(topOutgoing.volumeRatio)})`)}` : null,
    ...profile.features.filter((feature) => feature.scoreImpact > 0).map((feature) => `${bold("Feature")}: ${escapeHtml(feature.label)}`)
  ].filter((line): line is string => Boolean(line));
}

function firstBoundaryExposureProfile(result: ForensicSurface): BoundaryExposureProfile | null {
  const profile = result.boundaryExposureProfiles?.[0] ?? null;
  return profile && profile.contextScore > 0 && profile.flows.length > 0 ? profile : null;
}

function firstWalletRoleProfile(result: ForensicSurface): WalletRoleProfile | null {
  const profile = result.walletRoleProfiles?.[0] ?? null;
  return profile && profile.primaryRole !== "unknown" ? profile : null;
}

function boundaryExposureSignalLines(result: ForensicSurface): string[] {
  const profile = firstBoundaryExposureProfile(result);
  if (!profile) return [];
  const flow = profile.flows[0];
  const entity = profile.topBoundaryEntities[0] ?? null;
  const direction = flow.direction ?? entity?.direction ?? (profile.outgoingBoundaryVolumeRatio >= profile.incomingBoundaryVolumeRatio ? "outbound" : "inbound");
  const ratio = direction === "outbound" ? profile.outgoingBoundaryVolumeRatio : profile.incomingBoundaryVolumeRatio;
  const category = flow.boundaryCategory ?? entity?.category ?? "service_boundary";
  const identity = flow.boundaryIdentity ?? entity?.identity ?? null;
  const address = flow.boundaryAddress ?? entity?.address ?? null;
  const target = identity ?? (address ? shortIdentifier(address) : null);
  const targetSuffix = target ? ` via ${target}` : "";
  const lines = [
    `${formatPercent(ratio)} of ${direction === "outbound" ? "outgoing" : "incoming"} USDT touches ${category} boundary${targetSuffix} within ${flow.depth} hop(s).`
  ];
  lines.push(`Boundary route preservation is ${formatPercent(flow.amountPreservationRatio)}.`);
  return lines;
}

function walletRoleSignalLines(result: ForensicSurface): string[] {
  const profile = firstWalletRoleProfile(result);
  if (!profile) return [];
  const primary = profile.roles.find((role) => role.role === profile.primaryRole) ?? profile.roles[0] ?? null;
  if (!primary || primary.role === "unknown") return [];
  const lines = [
    `Likely wallet role: ${primary.role} (${primary.confidence} confidence, ${profile.evidenceStrength} evidence).`
  ];
  const primaryReason = primary.reasons.find((reason) => reason.scoreImpact > 0)?.label ?? profile.features.find((feature) => feature.scoreImpact > 0)?.label ?? null;
  if (primaryReason) lines.push(primaryReason);
  return lines;
}

function boundaryExposureEvidenceLines(result: ForensicSurface): string[] {
  const profile = firstBoundaryExposureProfile(result);
  if (!profile) return [];
  const flow = profile.flows[0];
  const roleProfile = firstWalletRoleProfile(result);
  const role = roleProfile?.roles.find((item) => item.role === roleProfile.primaryRole) ?? roleProfile?.roles[0] ?? null;
  const level = levelFromScore(profile.contextScore);
  const target = flow.boundaryIdentity ? `${flow.boundaryCategory} via ${flow.boundaryIdentity}` : `${flow.boundaryCategory} ${shortIdentifier(flow.boundaryAddress)}`;
  return [
    `${bold("Boundary exposure")}: ${formatRiskIcon(level)} ${code(`${profile.contextScore}/100`)} (${escapeHtml(level)})`,
    `${bold("Direction")}: ${code(flow.direction)}; ${bold("Depth")}: ${code(String(flow.depth))}`,
    `${bold("Boundary")}: ${code(target)}`,
    `${bold("Amount")}: ${code(formatRawUsdt(flow.amountRaw))}; ${bold("preservation")}: ${code(formatPercent(flow.amountPreservationRatio))}`,
    flow.viaAddress ? `${bold("Path")}: ${code([profile.subjectAddress, flow.viaAddress, flow.boundaryAddress].map(shortIdentifier).join(" -> "))}` : `${bold("Path")}: ${code([profile.subjectAddress, flow.boundaryAddress].map(shortIdentifier).join(" -> "))}`,
    role && role.role !== "unknown" ? `${bold("Role")}: ${code(`${role.role} (${role.confidence}, ${roleProfile?.evidenceStrength ?? "weak"})`)}` : null,
    `${bold("Tx evidence")}: ${code([flow.subjectTxHash, flow.boundaryTxHash].map(shortIdentifier).join(" -> "))}`
  ].filter((line): line is string => Boolean(line));
}

function topInboundPath(result: ForensicSurface): InboundProvenanceProfile["paths"][number] | null {
  const profile = result.inboundProvenanceProfiles?.[0] ?? null;
  return profile?.paths[0] ?? null;
}

function topCounterpartyRiskProfile(result: ForensicSurface): CounterpartyRiskProfile | null {
  return result.counterpartyRiskProfiles?.find((profile) => profile.score > 0) ?? null;
}

function topDirectCounterpartyInteractionProfile(result: ForensicSurface): DirectCounterpartyInteractionProfile | null {
  return result.directCounterpartyInteractionProfiles
    ?.filter((profile) => profile.scoreContribution > 0)
    .sort((left, right) => right.scoreContribution - left.scoreContribution || right.volumeRatio - left.volumeRatio)[0] ?? null;
}

function activeStablecoinRestrictionProfile(result: ForensicSurface): StablecoinRestrictionProfile | null {
  return result.stablecoinRestrictionProfiles?.find((profile) => profile.isBlacklisted) ?? null;
}

function firstApprovalDrainProfile(result: ForensicSurface): ApprovalDrainProvenanceProfile | null {
  return result.approvalDrainProvenanceProfiles?.find((profile) => profile.score > 0) ?? null;
}

function approvalDrainRiskLine(profile: ApprovalDrainProvenanceProfile): string {
  const level = levelFromScore(profile.score);
  return `${bold("Approval-drain provenance")}: ${formatRiskIcon(level)} ${code(`${profile.score}/100`)} (${escapeHtml(level)})`;
}

function inboundProvenanceSignalLines(result: ForensicSurface): string[] {
  const profile = result.inboundProvenanceProfiles?.[0] ?? null;
  const path = topInboundPath(result);
  if (!profile || !path || profile.score <= 0) return [];
  const source = path.label === "darknet_exchange" ? "known darknet exchange seed" : `${path.label} source`;
  return [
    `${formatRawUsdt(profile.matchedInboundVolumeRaw)} inbound matched an exact ${path.depth}-hop on-chain path from a ${source}.`
  ];
}

function counterpartyRiskSignalLines(result: ForensicSurface): string[] {
  const profile = topCounterpartyRiskProfile(result);
  if (!profile) return [];
  return [
    `${formatRawUsdt(profile.amountRaw)} ${profile.direction} volume is directly connected to ${profile.label ?? "labeled"} counterparty ${shortIdentifier(profile.counterpartyAddress)}.`
  ];
}

function directCounterpartyInteractionSignalLines(result: ForensicSurface): string[] {
  const profile = topDirectCounterpartyInteractionProfile(result);
  if (!profile) return [];
  return [
    `${formatPercent(profile.volumeRatio)} of ${profile.direction} volume is connected to counterparty ${shortIdentifier(profile.counterpartyAddress)} with fast risk ${profile.snapshot.riskScore}/100 (${profile.snapshot.riskLevel}).`
  ];
}

function stablecoinRestrictionSignalLines(result: ForensicSurface): string[] {
  const profile = activeStablecoinRestrictionProfile(result);
  if (!profile) return [];
  const balance = profile.balanceRaw ? ` Current blocked balance: ${formatRawUsdt(profile.balanceRaw)}.` : "";
  return [`Official TRON USDT contract blacklist state is active for this address.${balance}`];
}

function approvalDrainSignalLines(result: ForensicSurface): string[] {
  const profile = firstApprovalDrainProfile(result);
  if (!profile) return [];
  const hopText = profile.hopDepth === 0 ? "as the first receiver" : `within ${profile.hopDepth} hop(s)`;
  return [
    `Funds are connected to an exact approval-drain flow ${hopText}.`,
    `Approval-drain route preservation is ${formatPercent(profile.amountPreservationRatio)}.`
  ];
}

function topExtendedProvenanceProfile(result: ForensicSurface): ExtendedProvenanceProfile | null {
  return result.extendedProvenanceProfiles
    ?.filter((profile) => profile.paths.length > 0)
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function extendedProvenanceSignalLines(result: ForensicSurface): string[] {
  const profile = topExtendedProvenanceProfile(result);
  if (!profile) return [];
  const exact = profile.paths.find((path) => path.evidenceStrength === "exact_labeled_path" && path.candidateScore > 0);
  if (exact) {
    return [
      `Extended ${profile.direction} search found a ${exact.depth}-hop exact labeled path to ${exact.label}; manual review required.`
    ];
  }
  const boundary = profile.paths.find((path) => path.evidenceStrength === "service_boundary_context");
  if (boundary) {
    return [
      `Extended ${profile.direction} search reached ${boundary.boundaryCategory} boundary; public-chain continuity should not be assumed.`
    ];
  }
  return [];
}

function stablecoinRestrictionEvidenceLines(result: ForensicSurface): string[] {
  const profile = activeStablecoinRestrictionProfile(result);
  if (!profile) return [];
  const lines = [
    "USDT blacklist: active",
    `Blocked balance: ${profile.balanceRaw ? formatRawUsdt(profile.balanceRaw) : "not checked"}`,
    `Contract: ${profile.tokenContract}`,
    `Method: ${profile.methods.blacklist}`
  ];
  if (profile.blacklistEventTxHash) {
    const eventParts = [
      profile.blacklistEventTxHash,
      profile.blacklistEventTimestamp,
      profile.blacklistEventBlock ? `block ${profile.blacklistEventBlock}` : null
    ].filter((value): value is string => Boolean(value));
    lines.push(`Blacklist event: ${eventParts.join(" / ")}`);
  } else {
    lines.push("Blacklist event: timeline unavailable");
  }
  return lines;
}

function limitLines(result: ForensicSurface, options: { deepQueued?: boolean; deepStatus?: "completed" | "partial" } = {}): string[] {
  const lines: string[] = [];
  const hasBoundaryStop = result.missingChecks.some((check) => check.toLowerCase().includes("service boundary"));
  const sparseWindowChecks = result.missingChecks.filter((check) => check.toLowerCase().includes("sparse-wallet context"));
  if (hasBoundaryStop) {
    lines.push("Service/router boundary reached. Public-chain continuity after this point should not be assumed.");
  }
  if (sparseWindowChecks.length > 0) {
    lines.push("30-day activity was sparse, so latest historical USDT transfers were included for context.");
  }
  const providerChecks = result.missingChecks.filter((check) =>
    !check.toLowerCase().includes("service boundary") &&
    !check.toLowerCase().includes("sparse-wallet context")
  );
  if (providerChecks.length > 0) {
    lines.push("Some provider checks were incomplete; review coverage before treating this as final.");
  }
  if (options.deepQueued) {
    lines.push("Deep result may add or change context.");
  }
  if (options.deepStatus === "partial") {
    lines.unshift("Deep analysis completed with limited coverage.");
  }
  return [...new Set(lines)];
}

function keySignalLines(result: ForensicSurface & { report?: RiskReport }): string[] {
  const lines = [
    ...stablecoinRestrictionSignalLines(result),
    ...approvalDrainSignalLines(result),
    ...extendedProvenanceSignalLines(result),
    ...inboundProvenanceSignalLines(result),
    ...counterpartyRiskSignalLines(result),
    ...directCounterpartyInteractionSignalLines(result),
    ...operationalFlowSignalLines(result),
    ...serviceExposureSignalLines(result),
    ...boundaryExposureSignalLines(result),
    ...walletRoleSignalLines(result),
    ...addressBehaviorSignalLines(result),
    ...(result.report?.reasons.map((reason) => reason.message) ?? [])
  ];
  return [...new Set(lines)].slice(0, 4);
}

function meaningLines(result: ForensicSurface & { report?: RiskReport }, options: { deepQueued?: boolean } = {}): string[] {
  const hasInbound = inboundProvenanceSignalLines(result).length > 0;
  const hasStablecoinRestriction = stablecoinRestrictionSignalLines(result).length > 0;
  const hasApprovalDrain = approvalDrainSignalLines(result).length > 0;
  const hasExtended = extendedProvenanceSignalLines(result).length > 0;
  const hasCounterpartyRisk = counterpartyRiskSignalLines(result).length > 0;
  const hasDirectCounterpartyInteraction = directCounterpartyInteractionSignalLines(result).length > 0;
  const hasOperationalFlow = operationalFlowSignalLines(result).length > 0;
  const hasService = serviceExposureSignalLines(result).length > 0;
  const hasBoundary = boundaryExposureSignalLines(result).length > 0;
  const hasWalletRole = walletRoleSignalLines(result).length > 0;
  const hasBehavior = addressBehaviorSignalLines(result).length > 0;
  const hasDarknetExchangeProximityMarker = result.report?.reasons.some((reason) => reason.code === "internal_label_darknet_exchange_proximity") ?? false;

  if (hasStablecoinRestriction) {
    return ["The official TRON USDT contract reports this address as blacklisted. This is exact token-contract state, not a behavioral guess."];
  }
  if (hasApprovalDrain) {
    return ["Deep analysis connected this address to an exact USDT approval-drain flow. This is route-linked provenance evidence, not legal attribution."];
  }
  if (hasExtended) {
    return ["Extended local-index search found a longer on-chain route candidate. Exact labels and boundaries stay separated from weak inference."];
  }
  if (hasInbound) {
    return ["Deep analysis found exact upstream exposure to a labeled high-risk source. Manual review is recommended."];
  }
  if (hasCounterpartyRisk) {
    return ["Deep analysis found direct exposure to a labeled high-risk counterparty. Manual review is recommended."];
  }
  if (hasDirectCounterpartyInteraction) {
    return ["A major direct counterparty has high fast forensic risk. This raises review priority, but it is not exact blacklist/scam proof by itself."];
  }
  if (hasDarknetExchangeProximityMarker) {
    return ["This address has a saved high-risk marker from exact on-chain exposure to a manually verified darknet exchange seed within 2 hops."];
  }
  if (hasOperationalFlow) {
    return ["Deep analysis found high terminal-liquidity flow through service/CEX/bridge/router boundaries. This is operational laundering-pattern context, not a blacklist/scam claim."];
  }
  if (hasBoundary && hasWalletRole) {
    return ["Funds touch service-boundary infrastructure where public-chain continuity becomes limited. This is context for manual review, not proof of wrongdoing."];
  }
  if (hasBoundary) {
    return ["Funds touch service-boundary infrastructure where public-chain continuity becomes limited. Manual review is recommended before drawing conclusions."];
  }
  if (hasService && hasBehavior) {
    return ["This address quickly moved most received USDT into service/router infrastructure. Manual review is recommended."];
  }
  if (hasService) {
    return ["Outgoing USDT reaches service, router, CEX, bridge, or contract infrastructure. Manual review is recommended."];
  }
  if (hasBehavior) {
    return ["The address shows rapid transit-like USDT movement. This can also match some legitimate operational wallets."];
  }
  if ((result.report?.score ?? 0) > 0) {
    return ["Connected risk modules found review-worthy signals. Manual review is recommended."];
  }
  return [options.deepQueued ? "No strong fast-check signals were found yet; deep analysis may add context." : "No strong risk signals were found in the currently connected checks."];
}

function riskSignalsFromDeepReport(report: DeepAddressForensicReport): {
  graphSignals: RiskSignal[];
  behaviorSignals: RiskSignal[];
  amlSignals: RiskSignal[];
} {
  const serviceProfile = firstServiceExposureProfile(report);
  const behaviorProfile = report.addressBehaviorProfiles[0] ?? null;
  const inboundProfile = report.inboundProvenanceProfiles[0] ?? null;
  const inboundPath = topInboundPath(report);
  const stablecoinRestrictionProfile = activeStablecoinRestrictionProfile(report);
  const approvalDrainProfile = firstApprovalDrainProfile(report);
  const extendedProfile = topExtendedProvenanceProfile(report);
  const boundaryProfile = firstBoundaryExposureProfile(report);
  const operationalFlowProfile = firstOperationalFlowProfile(report);
  const counterpartyProfile = topCounterpartyRiskProfile(report);
  const directCounterpartyInteractionProfile = topDirectCounterpartyInteractionProfile(report);

  const graphSignals: RiskSignal[] = [];
  if (approvalDrainProfile) {
    graphSignals.push({
      code: "forensic_approval_drain_provenance",
      message: "Funds are connected to an exact approval-drain flow within 2 hops.",
      scoreImpact: approvalDrainProfile.score,
      source: "approval_drain_provenance",
      confidence: "high",
      severity: approvalDrainProfile.score >= 90 ? "critical" : "high"
    });
  }
  if (serviceProfile) {
    graphSignals.push({
      code: "forensic_service_exposure",
      message: "Service exposure candidate; manual review required.",
      scoreImpact: Math.min(50, serviceProfile.exposureScore),
      source: "forensic_route_search",
      confidence: serviceProfile.exposureScore >= 40 ? "high" : "medium",
      severity: serviceProfile.exposureScore >= 40 ? "high" : "medium"
    });
  }
  if (inboundProfile && inboundProfile.score > 0) {
    graphSignals.push({
      code: inboundPath?.label === "darknet_exchange" ? "forensic_darknet_exchange_provenance" : "forensic_inbound_provenance",
      message: inboundPath?.label === "darknet_exchange"
        ? "Confirmed on-chain exposure to known darknet exchange seed within 2 hops."
        : "Inbound provenance candidate; manual review required.",
      scoreImpact: Math.min(50, inboundProfile.score),
      source: "incoming_provenance",
      confidence: inboundProfile.score >= 40 ? "high" : "medium",
      severity: inboundProfile.score >= 45 ? "high" : "medium"
    });
  }
  if (extendedProfile && extendedProfile.score > 0) {
    graphSignals.push({
      code: "forensic_extended_provenance",
      message: "Extended on-chain provenance candidate; manual review required.",
      scoreImpact: Math.min(70, extendedProfile.score),
      source: "local_tron_usdt_index",
      confidence: extendedProfile.score >= 60 ? "high" : "medium",
      severity: extendedProfile.score >= 60 ? "high" : "medium"
    });
  }
  if (counterpartyProfile) {
    graphSignals.push({
      code: counterpartyProfile.label === "whitebit"
        ? "forensic_counterparty_whitebit"
        : counterpartyProfile.label === "darknet_exchange"
          ? "forensic_counterparty_darknet_exchange"
          : "forensic_counterparty_darknet_exchange_proximity",
      message: counterpartyProfile.label === "whitebit"
        ? "Direct counterparty is labeled WhiteBIT high-risk source."
        : counterpartyProfile.label === "darknet_exchange"
          ? "Direct counterparty is a manually verified darknet exchange seed."
          : "Direct counterparty has a confirmed high-risk proximity marker.",
      scoreImpact: counterpartyProfile.score,
      source: "counterparty_propagation",
      confidence: "high",
      severity: "high"
    });
  }
  if (directCounterpartyInteractionProfile) {
    graphSignals.push({
      code: "forensic_counterparty_fast_snapshot_context",
      message: "Major direct counterparty has high fast forensic risk; this is interaction context, not exact taint proof.",
      scoreImpact: directCounterpartyInteractionProfile.scoreContribution,
      source: "counterparty_fast_snapshot",
      confidence: directCounterpartyInteractionProfile.scoreContribution >= 60 ? "high" : "medium",
      severity: directCounterpartyInteractionProfile.scoreContribution >= 60 ? "high" : "medium"
    });
  }
  if (operationalFlowProfile) {
    graphSignals.push({
      code: "forensic_operational_boundary_flow",
      message: "Operational laundering-pattern context; service/CEX/bridge/router boundary exposure requires manual review.",
      scoreImpact: operationalFlowProfile.operationalScore,
      source: "local_tron_usdt_index",
      confidence: operationalFlowProfile.operationalScore >= 40 ? "high" : "medium",
      severity: operationalFlowProfile.operationalScore >= 40 ? "high" : "medium"
    });
  }
  if (boundaryProfile) {
    graphSignals.push({
      code: "forensic_boundary_exposure_context",
      message: "Service-boundary exposure context; manual review required.",
      scoreImpact: Math.min(15, boundaryProfile.contextScore),
      source: "forensic_route_search",
      confidence: boundaryProfile.contextScore >= 15 ? "medium" : "low",
      severity: "medium"
    });
  }
  const amlSignals: RiskSignal[] = [];
  if (stablecoinRestrictionProfile) {
    const evidence = report.rawEvidence.find((item) => "stablecoinRestrictionProfile" in item.evidenceJson) ?? null;
    amlSignals.push({
      code: "stablecoin_usdt_blacklisted",
      message: "Official TRON USDT contract blacklist state is active for this address.",
      scoreImpact: 90,
      source: "stablecoin_contract",
      confidence: "high",
      severity: "critical",
      evidenceRef: evidence?.id
    });
  }
  const behaviorSignals: RiskSignal[] = [];
  if (behaviorProfile) {
    const score = addressBehaviorEffectiveScore(behaviorProfile);
    if (score > 0) {
      behaviorSignals.push({
        code: "forensic_address_behavior",
        message: "Address behavior pattern requires manual review.",
        scoreImpact: Math.min(30, score),
        source: "forensic_route_search",
        confidence: score >= 20 ? "high" : "medium",
        severity: score >= 20 ? "high" : "medium"
      });
    }
  }

  return { graphSignals, behaviorSignals, amlSignals };
}

function deepRiskReport(report: DeepAddressForensicReport): RiskReport {
  const counterpartyProfile = topCounterpartyRiskProfile(report);
  return calculateRisk({
    subjectAddress: report.subjectAddress,
    labels: counterpartyProfile && (counterpartyProfile.label === "darknet_exchange" || counterpartyProfile.label === "darknet_exchange_proximity")
      ? [{
          address: report.subjectAddress,
          label: "darknet_exchange_proximity",
          source: "system",
          createdByTelegramId: null,
          createdAt: new Date(counterpartyProfile.firstTransferAt)
        }]
      : [],
    ...riskSignalsFromDeepReport(report)
  });
}

function fastRiskSnapshot(job: ForensicCheckJob): FastRiskSnapshot {
  const value = job.progressJson.fastRiskSnapshot;
  if (!isRecord(value)) return { score: 0, level: "LOW" };
  const score = typeof value.score === "number" && Number.isFinite(value.score)
    ? Math.max(0, Math.min(100, Math.round(value.score)))
    : 0;
  const level = isRiskLevel(value.level) ? value.level : "LOW";
  return { score, level };
}

function riskDeltaLabel(current: RiskReport, previous: FastRiskSnapshot): "risk increased" | "risk confirmed" | "risk changed" {
  if (current.score > previous.score || riskLevelRank[current.level] > riskLevelRank[previous.level]) return "risk increased";
  if (current.score === previous.score || current.level === previous.level) return "risk confirmed";
  return "risk changed";
}

function deepFindingLine(report: DeepAddressForensicReport): string | null {
  const path = topInboundPath(report);
  const counterpartyProfile = topCounterpartyRiskProfile(report);
  if (activeStablecoinRestrictionProfile(report)) return "New deep finding: official TRON USDT blacklist state is active.";
  if (firstApprovalDrainProfile(report)) return "New deep finding: exact approval-drain provenance found.";
  if (topExtendedProvenanceProfile(report)?.score) return "New deep finding: extended local-index provenance candidate found.";
  if (path?.label === "darknet_exchange") return "New deep finding: confirmed 2-hop exposure to known darknet exchange seed.";
  if (path) return `New deep finding: inbound provenance candidate from ${path.label} source.`;
  if (counterpartyProfile) return "New deep finding: direct exposure to a high-risk counterparty.";
  if (topDirectCounterpartyInteractionProfile(report)) return "New deep finding: major direct counterparty has high fast forensic risk.";
  if (firstOperationalFlowProfile(report)) return "New deep finding: operational laundering-pattern context found.";
  if (firstBoundaryExposureProfile(report) && firstWalletRoleProfile(report)) return "New deep finding: service-boundary exposure and wallet-role context found.";
  if (firstBoundaryExposureProfile(report)) return "New deep finding: service-boundary exposure context found.";
  if (firstServiceExposureProfile(report)) return "New deep finding: service exposure context confirmed.";
  if (addressBehaviorSignalLines(report).length > 0) return "New deep finding: address behavior context confirmed.";
  return "New deep finding: no additional risk signal found.";
}

function whatChangedLines(report: DeepAddressForensicReport, status: "completed" | "partial"): string[] {
  const profile = report.inboundProvenanceProfiles[0] ?? null;
  const path = topInboundPath(report);
  const lines: string[] = [];
  if (activeStablecoinRestrictionProfile(report)) {
    const stablecoinProfile = activeStablecoinRestrictionProfile(report);
    const balance = stablecoinProfile?.balanceRaw ? ` Current blocked balance: ${formatRawUsdt(stablecoinProfile.balanceRaw)}.` : "";
    lines.push(`Deep analysis confirmed active TRON USDT blacklist state directly from the token contract.${balance}`);
  } else if (firstApprovalDrainProfile(report)) {
    const approvalProfile = firstApprovalDrainProfile(report);
    if (approvalProfile) {
      lines.push(`Deep analysis found an exact approval-drain root: approval ${shortIdentifier(approvalProfile.approvalTxHash)} was followed by transferFrom drain ${shortIdentifier(approvalProfile.drainTxHash)}, then funds linked to this address within ${approvalProfile.hopDepth} hop(s).`);
    }
  } else if (topExtendedProvenanceProfile(report)?.score) {
    const extended = topExtendedProvenanceProfile(report);
    const top = extended?.paths.find((candidate) => candidate.evidenceStrength === "exact_labeled_path") ?? extended?.paths[0];
    if (extended && top) {
      lines.push(`Extended local-index search found a ${top.depth}-hop ${extended.direction} candidate with ${formatPercent(top.amountPreservationRatio)} amount preservation.`);
    }
  } else if (profile && path?.label === "darknet_exchange") {
    lines.push(`Deep analysis found that ${formatRawUsdt(profile.matchedInboundVolumeRaw)} of inbound volume has exact on-chain upstream exposure to a manually verified darknet exchange seed.`);
  } else if (profile && path) {
    lines.push(`Deep analysis found that ${formatRawUsdt(profile.matchedInboundVolumeRaw)} of inbound volume has upstream exposure to a labeled source.`);
  } else {
    const counterpartyProfile = topCounterpartyRiskProfile(report);
    if (counterpartyProfile) {
      lines.push(`Deep analysis found that ${formatRawUsdt(counterpartyProfile.amountRaw)} of ${counterpartyProfile.direction} volume is directly connected to a high-risk counterparty label.`);
    } else if (topDirectCounterpartyInteractionProfile(report)) {
      const interaction = topDirectCounterpartyInteractionProfile(report);
      if (interaction) {
        lines.push(`${formatPercent(interaction.volumeRatio)} of ${interaction.direction} volume is connected to counterparty ${shortIdentifier(interaction.counterpartyAddress)}, whose fast forensic snapshot is ${interaction.snapshot.riskScore}/100 (${interaction.snapshot.riskLevel}). This is interaction context, not exact taint proof.`);
      }
    } else if (firstOperationalFlowProfile(report)) {
      const operationalProfile = firstOperationalFlowProfile(report);
      if (operationalProfile) {
        lines.push(`Deep analysis found ${formatPercent(operationalProfile.terminalLiquidityOutgoingRatio)} of outgoing 30d USDT flow reaching terminal liquidity/service boundaries. This is not a blacklist/scam claim.`);
      }
    } else if (firstBoundaryExposureProfile(report) && firstWalletRoleProfile(report)) {
      const role = firstWalletRoleProfile(report)?.primaryRole ?? "unknown";
      lines.push(`Deep analysis found service-boundary exposure and classified the likely wallet role as ${role}.`);
    } else if (firstBoundaryExposureProfile(report)) {
      lines.push("Deep analysis found service-boundary exposure where public-chain continuity becomes limited.");
    } else if (firstServiceExposureProfile(report) || addressBehaviorSignalLines(report).length > 0) {
      lines.push("Deep analysis confirmed the preliminary service/behavior signals.");
    } else {
      lines.push("Deep analysis did not find additional risk signals in the collected evidence.");
    }
  }
  if (status === "partial" || report.missingChecks.length > 0) {
    lines.push("Deep analysis completed with limited coverage.");
  }
  return lines;
}

function evidenceLines(report: DeepAddressForensicReport): string[] {
  const path = topInboundPath(report);
  const stablecoinProfile = activeStablecoinRestrictionProfile(report);
  if (stablecoinProfile) {
    return [
      `${bold("Token")}: ${code(stablecoinProfile.tokenSymbol)} (${code(stablecoinProfile.tokenStandard)})`,
      `${bold("Contract")}: ${code(stablecoinProfile.tokenContract)}`,
      `${bold("Blacklist method")}: ${code(stablecoinProfile.methods.blacklist)} returned ${code("true")}`,
      `${bold("Balance")}: ${code(stablecoinProfile.balanceRaw ? formatRawUsdt(stablecoinProfile.balanceRaw) : "not checked")}`,
      stablecoinProfile.blacklistEventTxHash
        ? `${bold("Blacklist event")}: ${code(stablecoinProfile.blacklistEventTxHash)}`
        : `${bold("Blacklist event")}: ${code("timeline unavailable")}`,
      `${bold("Checked at")}: ${code(stablecoinProfile.checkedAt)}`
    ];
  }
  const approvalDrainProfile = firstApprovalDrainProfile(report);
  if (approvalDrainProfile) {
    return [
      approvalDrainRiskLine(approvalDrainProfile),
      `${bold("Path")}: ${code(approvalDrainProfile.pathAddresses.map(shortIdentifier).join(" -> "))}`,
      `${bold("Amount")}: ${code(formatRawUsdt(approvalDrainProfile.amountRaw))}; ${bold("preservation")}: ${code(formatPercent(approvalDrainProfile.amountPreservationRatio))}`,
      `${bold("Approval tx")}: ${code(shortIdentifier(approvalDrainProfile.approvalTxHash))}; ${bold("drain tx")}: ${code(shortIdentifier(approvalDrainProfile.drainTxHash))}`,
      `${bold("Spender")}: ${code(shortIdentifier(approvalDrainProfile.spenderAddress))}; ${bold("first receiver")}: ${code(shortIdentifier(approvalDrainProfile.firstReceiverAddress))}`,
      `${bold("Time")}: ${code(`${approvalDrainProfile.approvalAt} -> ${approvalDrainProfile.drainAt}`)}`,
      `${bold("Tx evidence")}: ${code(approvalDrainProfile.pathTxHashes.map(shortIdentifier).join(" -> "))}`,
      `${bold("Subject USDT")}: ${code(approvalDrainProfile.subjectTokenState?.balanceRaw ? formatRawUsdt(approvalDrainProfile.subjectTokenState.balanceRaw) : "not checked")}`,
      `${bold("Victim USDT")}: ${code(approvalDrainProfile.victimTokenState?.balanceRaw ? formatRawUsdt(approvalDrainProfile.victimTokenState.balanceRaw) : "not checked")}`
    ];
  }
  const extendedProfile = topExtendedProvenanceProfile(report);
  const extendedPath = extendedProfile?.paths.find((candidate) => candidate.evidenceStrength === "exact_labeled_path" && candidate.candidateScore > 0) ?? null;
  if (extendedProfile && extendedPath) {
    return [
      `${bold("Extended provenance")}: ${formatRiskIcon(levelFromScore(extendedProfile.score))} ${code(`${extendedProfile.score}/100`)} (${escapeHtml(levelFromScore(extendedProfile.score))})`,
      `${bold("Direction")}: ${code(extendedProfile.direction)}; ${bold("Depth")}: ${code(String(extendedPath.depth))}`,
      `${bold("Path")}: ${code(extendedPath.pathAddresses.map(shortIdentifier).join(" -> "))}`,
      `${bold("Amount")}: ${code(formatRawUsdt(extendedPath.amountRaw))}; ${bold("preservation")}: ${code(formatPercent(extendedPath.amountPreservationRatio))}`,
      `${bold("Label")}: ${code(extendedPath.label ?? "none")}`,
      `${bold("Tx evidence")}: ${code(extendedPath.txHashes.map(shortIdentifier).join(" -> "))}`
    ];
  }
  if (!path) {
    const counterpartyProfile = topCounterpartyRiskProfile(report);
    const directInteractionProfile = topDirectCounterpartyInteractionProfile(report);
    const operationalLines = operationalFlowEvidenceLines(report);
    if (!counterpartyProfile && directInteractionProfile) {
      return [
        `${bold("Counterparty fast snapshot")}: ${formatRiskIcon(levelFromScore(directInteractionProfile.scoreContribution))} ${code(`${directInteractionProfile.scoreContribution}/100`)} (${escapeHtml(levelFromScore(directInteractionProfile.scoreContribution))})`,
        `${bold("Counterparty")}: ${code(directInteractionProfile.counterpartyAddress)}`,
        `${bold("Direction")}: ${code(directInteractionProfile.direction)}; ${bold("snapshot")}: ${code(`${directInteractionProfile.snapshot.riskScore}/100 ${directInteractionProfile.snapshot.riskLevel}`)}`,
        `${bold("Amount")}: ${code(formatRawUsdt(directInteractionProfile.volumeRaw))}; ${bold("share")}: ${code(formatPercent(directInteractionProfile.volumeRatio))}`,
        `${bold("Evidence class")}: ${code(directInteractionProfile.evidenceClass)}`,
        `${bold("Tx evidence")}: ${code(directInteractionProfile.txHashes.map(shortIdentifier).join(" -> "))}`,
        "This is interaction context, not exact blacklist/scam proof."
      ];
    }
    if (!counterpartyProfile) return operationalLines.length > 0 ? operationalLines : boundaryExposureEvidenceLines(report);
    return [
      `${bold("Counterparty")}: ${code(counterpartyProfile.counterpartyAddress)}`,
      `${bold("Direction")}: ${code(counterpartyProfile.direction)}; ${bold("Label")}: ${code(counterpartyProfile.label ?? "unknown")}`,
      `${bold("Amount")}: ${code(formatRawUsdt(counterpartyProfile.amountRaw))}; ${bold("share")}: ${code(formatPercent(counterpartyProfile.volumeRatio))}`,
      `${bold("Time")}: ${code(`${counterpartyProfile.firstTransferAt} -> ${counterpartyProfile.lastTransferAt}`)}`,
      `${bold("Tx evidence")}: ${code(counterpartyProfile.txHashes.map(shortIdentifier).join(" -> "))}`
    ];
  }
  return [
    `${bold("Path")}: ${code([path.sourceAddress, ...path.viaAddresses, report.subjectAddress].map(shortIdentifier).join(" -> "))}`,
    `${bold("Amount")}: ${code(formatRawUsdt(path.amountRaw))}; ${bold("preservation")}: ${code(formatPercent(path.amountPreservationRatio))}`,
    `${bold("Time")}: ${code(`${path.firstTransferAt} -> ${path.lastTransferAt}`)}`,
    `${bold("Tx evidence")}: ${code(path.txHashes.map(shortIdentifier).join(" -> "))}`
  ];
}

function otherContextLines(report: DeepAddressForensicReport): string[] {
  return [
    ...extendedProvenanceSignalLines(report),
    ...directCounterpartyInteractionSignalLines(report),
    ...operationalFlowSignalLines(report),
    ...serviceExposureSignalLines(report),
    ...boundaryExposureSignalLines(report),
    ...walletRoleSignalLines(report),
    ...addressBehaviorSignalLines(report)
  ].slice(0, 4);
}

function coverageLimitLines(report: DeepAddressForensicReport, status: "completed" | "partial"): string[] {
  return [
    `${report.coverage.transferEdges} transfer edges scanned; ${report.coverage.inboundSendersExpanded} inbound senders checked.`,
    report.coverage.extendedFetchedAddresses ? `${report.coverage.extendedFetchedAddresses} local-index addresses checked by extended search.` : null,
    ...limitLines(report, { deepStatus: status })
  ].filter((line): line is string => Boolean(line));
}

type AddressCheckStartedOptions = {
  whereIsMoneyJob?: ForensicCheckJob | null;
  deepJob?: ForensicCheckJob | null;
  runtimeLabel?: string;
  locale?: BotLocale;
};

function formatManualReport(
  result: ManualCheckResult,
  options: {
    whereIsMoneyJob?: ForensicCheckJob | null;
    deepJob?: ForensicCheckJob | null;
    transactionOriginRecipientAddress?: string | null;
    transactionDisplay?: TransactionOriginDisplayContext | null;
    runtimeLabel?: string;
    locale?: BotLocale;
  } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? DEFAULT_BOT_LOCALE;
  const deepQueued = Boolean(options.whereIsMoneyJob || options.deepJob);
  if (options.transactionDisplay) {
    const txTime = formatNotificationMskTime(options.transactionDisplay.timestamp, locale);
    const txTitle = locale === "en"
      ? `Tx check${txTime ? ` — ${txTime}` : ""}`
      : `Проверка tx${txTime ? ` — ${txTime}` : ""}`;
    const stablecoinRestrictionLines = stablecoinRestrictionEvidenceLines(result);
    const checksLines = [
      options.whereIsMoneyJob ? `${bold(locale === "en" ? "Amount origin" : "Происхождение суммы")}: ${code(locale === "en" ? "queued" : "запущено")} (${code(options.whereIsMoneyJob.id)})` : null,
      options.deepJob ? `${bold(locale === "en" ? "Deep analysis queued" : "Глубокий анализ поставлен в очередь")}: ${code(options.deepJob.id)}` : null
    ];
    return telegramHtmlMessage([
      bold(txTitle),
      riskLine(result.report, locale === "en" ? "Fast sender check" : "Быстрая проверка отправителя", true, locale),
      ...riskBreakdownLines(result.report),
      `${bold(locale === "en" ? "Amount" : "Сумма")}: ${code(options.transactionDisplay.amountRaw ? formatRawUsdt(options.transactionDisplay.amountRaw) : "unknown")}`,
      `${bold(locale === "en" ? "From" : "От")}: ${code(options.transactionDisplay.fromAddress ?? result.subjectAddress)}`,
      `${bold(locale === "en" ? "To" : "Кому")}: ${code(options.transactionDisplay.toAddress ?? "unknown")}`,
      stablecoinRestrictionLines.length > 0 ? bold(locale === "en" ? "Exact token-contract evidence" : "Точное состояние USDT контракта") : null,
      stablecoinRestrictionLines.length > 0 ? bulletList(stablecoinRestrictionLines) : null,
      section(whyLabel(locale), [bulletList(userFacingLines(locale, meaningLines(result, { deepQueued })))]),
      section(locale === "en" ? "Key signals" : "Главные сигналы", [
        bulletList(userFacingLines(locale, keySignalLines(result)), locale === "en" ? "No positive forensic signals found." : "Позитивных forensic-сигналов не найдено.")
      ]),
      section(locale === "en" ? "Limits" : "Ограничения", [
        bulletList(userFacingLines(locale, limitLines(result, { deepQueued })), locale === "en" ? "No major coverage limits reported." : "Серьезных ограничений покрытия не найдено.")
      ]),
      section(locale === "en" ? "Checks" : "Проверки", checksLines),
      runtimeMarkerLine(options.runtimeLabel)
    ].filter((line): line is string => Boolean(line)));
  }
  const addressTitle = locale === "en"
    ? (deepQueued ? "Address check — preliminary" : "Address check")
    : (deepQueued ? "Проверка адреса — предварительно" : "Проверка адреса");
  const stablecoinRestrictionLines = stablecoinRestrictionEvidenceLines(result);
  const whereIsMoneyStatus = locale === "en" ? "queued" : "запущено";
  const deepLabel = locale === "en" ? "Deep research" : "Глубокий анализ";
  const deepStatus = locale === "en" ? "queued" : "запущен";
  return telegramHtmlMessage([
    bold(addressTitle),
    `${bold(locale === "en" ? "Subject" : "Адрес")}: ${code(result.subjectAddress)}`,
    riskLine(result.report, riskObjectLabel("address", locale), true, locale),
    stablecoinRestrictionLines.length > 0 ? section(locale === "en" ? "Hard evidence" : "Точное доказательство", [
      bulletList(stablecoinRestrictionLines.slice(0, 3))
    ]) : null,
    section(whyLabel(locale), [
      bulletList(userFacingLines(locale, meaningLines(result, { deepQueued })).slice(0, 4))
    ]),
    deepQueued ? section(locale === "en" ? "Next" : "Дальше", [
      options.whereIsMoneyJob ? `${locale === "en" ? "Where is money" : "Откуда деньги"}: ${code(whereIsMoneyStatus)} (${code(options.whereIsMoneyJob.id)})` : null,
      options.deepJob ? `${deepLabel}: ${code(deepStatus)} (${code(options.deepJob.id)})` : null
    ].filter((line): line is string => Boolean(line))) : null,
    runtimeMarkerLine(options.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}

export function formatAddressCheckStarted(
  result: ManualCheckResult,
  options: AddressCheckStartedOptions = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? DEFAULT_BOT_LOCALE;
  if (hasUnifiedFastHardEvidence(result.report)) {
    return formatManualReport(result, options);
  }

  const runningLines = locale === "en"
    ? [
        "Origin of the current USDT balance.",
        "Address behavior as additional context."
      ]
    : [
        "Происхождение текущего USDT-баланса.",
        "Поведение адреса как дополнительный контекст."
      ];

  return telegramHtmlMessage([
    bold(locale === "en" ? "Address check — started" : "Проверка адреса — запущена"),
    `${bold(locale === "en" ? "Address" : "Адрес")}: ${code(result.subjectAddress)}`,
    section(locale === "en" ? "What is running" : "Что проверяем", [
      bulletList(runningLines)
    ]),
    locale === "en"
      ? "Final risk appears after provenance analysis."
      : "Итоговый риск появится после анализа происхождения средств.",
    runtimeMarkerLine(options.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}

function formatCrossBridgeQueued(
  job: ForensicCheckJob,
  options: { runtimeLabel?: string; locale?: BotLocale } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? DEFAULT_BOT_LOCALE;
  return telegramHtmlMessage([
    bold(locale === "en" ? "Cross-bridge analysis queued" : "Кроссбридж-анализ запущен"),
    `${bold(locale === "en" ? "Address" : "Адрес")}: ${code(job.subjectAddress)}`,
    `${bold("Job")}: ${code(job.id)}`,
    locale === "en"
      ? "This job will continue across bridge boundaries for this address."
      : "Этот job продолжит анализ через bridge-boundary для этого адреса.",
    runtimeMarkerLine(options.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}

function smartContractReasonText(reason: string, locale: BotLocale): string {
  const reasons: Record<string, { en: string; ru: string }> = {
    address_is_smart_contract: {
      en: "This is a smart contract, not a regular wallet.",
      ru: "Это смарт-контракт, не обычный кошелёк."
    },
    exact_drain_not_proven_in_standalone_check: {
      en: "Exact theft is not proven in this standalone check.",
      ru: "Точная кража в этой отдельной проверке не доказана."
    },
    active_unlimited_usdt_approval_spender: {
      en: "Your wallets have an active unlimited USDT approval to this contract.",
      ru: "В ваших кошельках есть активный unlimited USDT approval на этот контракт."
    },
    known_verified_service_contract: {
      en: "The contract matches a verified service label.",
      ru: "Контракт похож на проверенный сервис."
    },
    provider_risk_contract: {
      en: "Provider metadata marks this contract as risky.",
      ru: "Провайдерские данные помечают контракт как рискованный."
    },
    verified_contract_without_service_evidence: {
      en: "Source is verified, but service evidence is limited.",
      ru: "Исходный код проверен, но сервисные признаки ограничены."
    },
    unknown_weak_contract_metadata: {
      en: "Contract metadata is weak or incomplete.",
      ru: "Метаданные контракта слабые или неполные."
    },
    active_risky_related_approval_spender: {
      en: "Active related approvals carry elevated risk.",
      ru: "Активные связанные approvals имеют повышенный риск."
    },
    transferfrom_surface_with_active_unlimited_approval: {
      en: "The contract can use transferFrom while an unlimited approval is active.",
      ru: "Контракт может использовать transferFrom при активном unlimited approval."
    },
    llm_legitimate_service_with_service_evidence: {
      en: "AI verdict supports legitimate service context.",
      ru: "AI-вердикт поддерживает контекст легитимного сервиса."
    },
    llm_unknown_suspicious_high_confidence: {
      en: "AI verdict marks the contract as suspicious with high confidence.",
      ru: "AI-вердикт с высокой уверенностью помечает контракт как подозрительный."
    },
    llm_drainer_like_high_confidence: {
      en: "AI verdict marks the contract as drainer-like with high confidence.",
      ru: "AI-вердикт с высокой уверенностью помечает контракт как похожий на drainer."
    }
  };
  return reasons[reason]?.[locale] ?? reason;
}

function smartContractVerifiedSource(report: SmartContractCheckReport): string {
  const parts = [
    report.metadata.verified === true ? "metadata verified" : report.metadata.verified === false ? "metadata not verified" : "metadata unknown",
    report.contractProfile?.isVerified === true || report.contractProfile?.verified === true ? "source verified" : null,
    report.contractProfile?.sourceStatus ? `source ${report.contractProfile.sourceStatus}` : null,
    report.metadata.source ? `via ${report.metadata.source}` : null
  ].filter((part): part is string => Boolean(part));
  return parts.join("; ");
}

function smartContractApprovalLine(report: SmartContractCheckReport, locale: BotLocale): string {
  const activeUnlimitedCount = report.relatedApprovals.filter((approval) =>
    approval.status === "active" && approval.isUnlimited
  ).length;
  if (locale === "en") {
    return `${report.relatedApprovals.length} related approval(s); ${activeUnlimitedCount} active unlimited.`;
  }
  return `${report.relatedApprovals.length} связанных approval; ${activeUnlimitedCount} active unlimited.`;
}

function smartContractLlmVerdictLine(report: SmartContractCheckReport, locale: BotLocale): string {
  const verdict = report.llmVerdict;
  if (!verdict) return locale === "en" ? "not available" : "нет данных";
  const confidence = `${Math.round(verdict.confidence * 100)}%`;
  const reason = verdict.reasons[0] ? `; ${verdict.reasons[0]}` : "";
  return `${verdict.verdict} | ${confidence} | ${verdict.contractRiskScore}/100${reason}`;
}

export function formatSmartContractCheckReport(
  report: SmartContractCheckReport,
  options: { runtimeLabel?: string; locale?: BotLocale } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? DEFAULT_BOT_LOCALE;
  const name = report.metadata.name ?? report.contractProfile?.name ?? report.metadata.tag ?? "unknown";
  const reasonLines = [...report.reasons, ...report.limitations]
    .filter((reason, index, all) => all.indexOf(reason) === index)
    .map((reason) => smartContractReasonText(reason, locale));
  return telegramHtmlMessage([
    bold(locale === "en" ? "Smart contract check" : "Проверка смарт-контракта"),
    `${bold(locale === "en" ? "Decision" : "Решение")}: ${code(report.decision)}`,
    `${bold(locale === "en" ? "Contract risk" : "Риск контракта")}: ${formatRiskIcon(report.riskLevel)} ${code(`${report.riskScore}/100`)} (${escapeHtml(locale === "en" ? report.riskLevel : `${riskLevelText(locale, report.riskLevel)} / ${report.riskLevel}`)})`,
    `${bold(locale === "en" ? "Contract address" : "Адрес контракта")}: ${code(report.subjectAddress)}`,
    `${bold(locale === "en" ? "Name" : "Название")}: ${escapeHtml(name)}`,
    `${bold(locale === "en" ? "Verified source" : "Проверенный source")}: ${escapeHtml(smartContractVerifiedSource(report))}`,
    `${bold(locale === "en" ? "Service label" : "Service label")}: ${escapeHtml(report.serviceLabel ?? "none")}`,
    `${bold(locale === "en" ? "Activity" : "Активность")}: ${code(report.activityLabel)}`,
    section(locale === "en" ? "Meaning" : "Вывод", [
      bulletList(reasonLines)
    ]),
    `${bold(locale === "en" ? "Seen in approvals" : "В approvals")}: ${escapeHtml(smartContractApprovalLine(report, locale))}`,
    `${bold(locale === "en" ? "AI contract verdict" : "AI contract verdict")}: ${escapeHtml(smartContractLlmVerdictLine(report, locale))}`,
    runtimeMarkerLine(options.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}

function normalizeSmartContractCheckOutcome(result: SmartContractCheckReturn): SmartContractCheckOutcome {
  if (!result) return { kind: "not_contract" };
  if ("kind" in result) return result;
  return { kind: "report", report: result };
}

function formatSmartContractCheckUnavailable(
  address: string,
  options: { runtimeLabel?: string; locale?: BotLocale; error?: string | null } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? DEFAULT_BOT_LOCALE;
  return telegramHtmlMessage([
    bold(locale === "en" ? "Smart contract check unavailable" : "Проверка смарт-контракта недоступна"),
    `${bold(locale === "en" ? "Contract address" : "Адрес контракта")}: ${code(address)}`,
    locale === "en"
      ? "The address may be a smart contract, but the contract-safety check failed. I did not run the regular wallet check to avoid a misleading result."
      : "Адрес может быть смарт-контрактом, но проверка безопасности контракта не сработала. Обычную wallet-проверку я не запускаю, чтобы не дать вводящий в заблуждение результат.",
    options.error ? `${bold(locale === "en" ? "Reason" : "Причина")}: ${escapeHtml(options.error)}` : null,
    runtimeMarkerLine(options.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}

function formatForensicJobStatus(job: ForensicCheckJob | null, options: { runtimeLabel?: string; locale?: BotLocale } = {}): TelegramHtmlMessage {
  const locale = options.locale ?? DEFAULT_BOT_LOCALE;
  if (!job) return telegramHtmlMessage([locale === "en" ? "Deep forensic job not found." : "Deep forensic job не найден.", runtimeMarkerLine(options.runtimeLabel)].filter((line): line is string => Boolean(line)));
  return telegramHtmlMessage([
    bold(locale === "en" ? "Deep forensic status" : "Статус глубокого анализа"),
    `${bold("Job")}: ${code(job.id)}`,
    `${bold(locale === "en" ? "Subject" : "Адрес")}: ${code(job.subjectAddress)}`,
    `${bold(locale === "en" ? "Status" : "Статус")}: ${code(job.status)}`,
    `${bold(locale === "en" ? "Window" : "Окно")}: ${code(`${job.windowStart.toISOString()} -> ${job.windowEnd.toISOString()}`)}`,
    job.lastError ? `${bold(locale === "en" ? "Last error" : "Последняя ошибка")}: ${escapeHtml(job.lastError)}` : null,
    runtimeMarkerLine(options.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}

function deepFindingText(line: string, locale: BotLocale): string {
  if (locale === "en") return line;
  const exact: Array<[string, string]> = [
    ["official TRON USDT blacklist state is active", "USDT-контракт показывает активный blacklist для адреса."],
    ["exact approval-drain provenance found", "Найдена точная цепочка approval-drain."],
    ["extended local-index provenance candidate found", "Локальный индекс нашёл длинную цепочку происхождения средств."],
    ["confirmed 2-hop exposure to known darknet exchange seed", "Найдена связь с размеченным высокорисковым источником в пределах 2 шагов."],
    ["direct exposure to a high-risk counterparty", "Есть прямой контрагент с высоким риском."],
    ["major direct counterparty has high fast forensic risk", "Крупный прямой контрагент сам выглядит рискованно."],
    ["operational laundering-pattern context found", "Похоже на рабочий транзитный поток через сервисы и ликвидность."],
    ["service-boundary exposure and wallet-role context found", "Найдена сервисная граница и определена роль кошелька."],
    ["service-boundary exposure context found", "Деньги проходят через сервисную границу."],
    ["service exposure context confirmed", "Подтверждён контакт с сервисной инфраструктурой."],
    ["address behavior context confirmed", "Подтверждён поведенческий контекст адреса."]
  ];
  const normalized = line.toLowerCase();
  const match = exact.find(([needle]) => normalized.includes(needle));
  if (match) return match[1];
  if (normalized.includes("inbound provenance candidate")) return "Есть входящая цепочка от размеченного источника.";
  return userFacingLine(locale, line);
}

function deepSignalText(line: string, locale: BotLocale): string {
  if (locale === "en") return line;
  if (line.includes("did not find additional risk signals")) {
    return "Дополнительных риск-сигналов не найдено.";
  }
  if (line.includes("This is interaction context, not exact taint proof")) {
    return line
      .replace("of inbound volume is connected to counterparty", "входящего объёма связано с контрагентом")
      .replace("of outbound volume is connected to counterparty", "исходящего объёма связано с контрагентом")
      .replace("whose fast forensic snapshot is", "его быстрый риск:")
      .replace("This is interaction context, not exact taint proof.", "Это контекст поведения, не доказательство скама.");
  }
  if (line.startsWith("Deep-анализ found that ")) {
    return line
      .replace("Deep-анализ found that ", "")
      .replace(" of outbound volume is directly connected to a high-risk counterparty label.", " исходящего объёма связано с рискованным контрагентом.")
      .replace(" of inbound volume has exact on-chain upstream exposure to a manually verified darknet exchange seed.", " входящего объёма связано с размеченным высокорисковым источником.")
      .replace(" of inbound volume has upstream exposure to a labeled source.", " входящего объёма связано с размеченным источником.");
  }
  if (line.startsWith("Deep-анализ found ")) {
    return line
      .replace("Deep-анализ found ", "")
      .replace(" of outgoing 30d USDT flow reaching terminal liquidity/service boundaries. This is not a blacklist/scam claim.", " исходящего USDT за 30 дней дошло до сервисов или ликвидности. Это не доказательство скама.");
  }
  if (line.includes("service-boundary exposure and classified the likely wallet role as")) {
    return line
      .replace("Deep-анализ found service-boundary exposure and classified the likely wallet role as ", "Найдена сервисная граница. Вероятная роль кошелька: ")
      .replace(".", ".");
  }
  return line;
}

function formatCompactDeepForensicReport(
  job: ForensicCheckJob,
  report: DeepAddressForensicReport,
  status: "completed" | "partial",
  locale: BotLocale,
  finalRisk: RiskReport,
  previousRisk: FastRiskSnapshot,
  runtimeLabel: string | undefined
): TelegramHtmlMessage {
  const delta = riskDeltaLabel(finalRisk, previousRisk);
  const findingLine = deepFindingLine(report);
  const meaningfulFindingLine = findingLine && !findingLine.includes("no additional risk signal found")
    ? deepFindingText(findingLine, locale)
    : null;
  const changedLines = userFacingLines(locale, whatChangedLines(report, status)).map((line) => deepSignalText(line, locale)).slice(0, 2);
  const contextLines = userFacingLines(locale, otherContextLines(report)).map((line) => deepSignalText(line, locale)).slice(0, Math.max(0, 3 - changedLines.length));
  const signalLines = [...changedLines, ...contextLines];
  const stablecoinLines = stablecoinRestrictionEvidenceLines(report);
  const coverageLines = [
    locale === "en"
      ? `${report.coverage.transferEdges} transfer edges checked.`
      : `Проверено переводов: ${report.coverage.transferEdges}.`,
    locale === "en"
      ? `${report.coverage.inboundSendersExpanded} inbound senders expanded.`
      : `Проверено входящих отправителей: ${report.coverage.inboundSendersExpanded}.`,
    status === "partial" || report.missingChecks.length > 0
      ? (locale === "en" ? "Coverage is limited." : "Покрытие ограничено.")
      : null
  ].filter((line): line is string => Boolean(line));
  const supportLines = locale === "en"
    ? [
        `Report ID: ${job.id}`,
        `Risk change: ${delta}`
      ]
    : [
        `ID отчёта: ${job.id}`,
        `Изменение: ${delta === "risk increased" ? "риск вырос" : delta === "risk confirmed" ? "риск подтвердился" : "риск изменился"}`
      ];

  return telegramHtmlMessage([
    bold(locale === "en" ? "Address behavior — context" : "Поведение адреса — контекст"),
    `${bold(locale === "en" ? "Address" : "Адрес")}: ${code(report.subjectAddress)}`,
    riskLine(finalRisk, locale === "en" ? "Behavior risk" : "Риск поведения", true, locale),
    section(locale === "en" ? "Meaning" : "Что это значит", [
      bulletList(deepCompactMeaningLines(report, locale))
    ]),
    meaningfulFindingLine ? section(locale === "en" ? "Main signal" : "Главный сигнал", [
      meaningfulFindingLine
    ]) : null,
    signalLines.length > 0 ? section(locale === "en" ? "Signals" : "Сигналы", [
      bulletList(signalLines)
    ]) : null,
    stablecoinLines.length > 0 ? section(locale === "en" ? "Exact token-contract evidence" : "Точное состояние USDT контракта", [
      bulletList(stablecoinLines)
    ]) : null,
    section(locale === "en" ? "Coverage" : "Покрытие", [
      bulletList(coverageLines)
    ]),
    section(locale === "en" ? "For support" : "Для поддержки", [
      bulletList(supportLines)
    ]),
    runtimeMarkerLine(runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}

export function formatDeepForensicReport(
  job: ForensicCheckJob,
  report: DeepAddressForensicReport,
  status: "completed" | "partial",
  options: { runtimeLabel?: string; locale?: BotLocale } = {}
): TelegramHtmlMessage {
  void status;
  const locale = options.locale ?? normalizeBotLocale(job.progressJson.locale);
  const finalRisk = deepRiskReport(report);
  const previousRisk = fastRiskSnapshot(job);
  return formatCompactDeepForensicReport(job, report, status, locale, finalRisk, previousRisk, options.runtimeLabel);
}

export function formatDeepForensicSupportReport(
  job: ForensicCheckJob,
  report: DeepAddressForensicReport,
  status: "completed" | "partial",
  options: { runtimeLabel?: string; locale?: BotLocale } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? normalizeBotLocale(job.progressJson.locale);
  const finalRisk = deepRiskReport(report);
  const previousRisk = fastRiskSnapshot(job);
  const delta = riskDeltaLabel(finalRisk, previousRisk);
  const deltaText = locale === "en"
    ? delta
    : delta === "risk increased"
      ? "риск вырос"
      : delta === "risk confirmed"
        ? "риск подтвержден"
        : "риск изменился";
  const findingLine = deepFindingLine(report);
  const stablecoinLines = stablecoinRestrictionEvidenceLines(report);
  const importantEvidenceLines = evidenceLines(report);

  return telegramHtmlMessage([
    bold(locale === "en" ? "Deep research — support/debug" : "Deep research — support/debug"),
    `${bold(locale === "en" ? "Address" : "Адрес")}: ${code(report.subjectAddress)}`,
    riskLine(finalRisk, locale === "en" ? "Behavior risk" : "Риск поведения", true, locale),
    `${bold("Job")}: ${code(job.id)}`,
    `${bold(locale === "en" ? "Risk delta" : "Изменение риска")}: ${escapeHtml(deltaText)}`,
    ...riskBreakdownLines(finalRisk),
    `${bold(locale === "en" ? "Previous fast risk" : "Предыдущий быстрый риск")}: ${formatRiskIcon(previousRisk.level)} ${code(`${previousRisk.score}/100`)} (${escapeHtml(locale === "en" ? previousRisk.level : `${riskLevelText(locale, previousRisk.level)} / ${previousRisk.level}`)})`,
    stablecoinLines.length > 0 ? bold(locale === "en" ? "Exact token-contract evidence" : "Точное состояние USDT контракта") : null,
    stablecoinLines.length > 0 ? bulletList(stablecoinLines) : null,
    findingLine ? userFacingLine(locale, findingLine) : null,
    bold(locale === "en" ? "What changed" : "Что изменилось"),
    ...userFacingLines(locale, whatChangedLines(report, status)),
    bold(locale === "en" ? "Most important evidence" : "Главное evidence"),
    ...(importantEvidenceLines.length > 0 ? importantEvidenceLines : [bulletList([], locale === "en" ? "No exact provenance path found." : "Точная provenance-цепочка не найдена.")]),
    bold(locale === "en" ? "Other context" : "Дополнительный контекст"),
    bulletList(userFacingLines(locale, otherContextLines(report)), locale === "en" ? "No additional service/behavior context found." : "Дополнительный service/behavior контекст не найден."),
    bold(locale === "en" ? "Coverage and limits" : "Покрытие и ограничения"),
    bulletList(userFacingLines(locale, coverageLimitLines(report, status))),
    runtimeMarkerLine(options.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}

export function formatDeepForensicContextReadyReport(
  job: ForensicCheckJob,
  report: DeepAddressForensicReport,
  status: "completed" | "partial",
  options: { runtimeLabel?: string; locale?: BotLocale } = {}
): TelegramHtmlMessage {
  void status;
  const locale = options.locale ?? normalizeBotLocale(job.progressJson.locale);
  return telegramHtmlMessage([
    bold(locale === "en" ? "Address behavior — context ready" : "Контекст поведения готов"),
    `${bold(locale === "en" ? "Address" : "Адрес")}: ${code(report.subjectAddress)}`,
    locale === "en"
      ? "Final risk will be shown after provenance analysis."
      : "Итоговый риск покажем после анализа происхождения средств.",
    runtimeMarkerLine(options.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}

function isWhereIsMoneyReport(value: unknown): value is WhereIsMoneyReport {
  if (!isRecord(value)) return false;
  const coverage = value.coverage;
  const assessment = value.assessment;
  if (!isRecord(coverage) || !isRecord(assessment)) return false;
  const hasUsableCoverageRatio = isFiniteNumber(coverage.coverageRatio) || isFiniteNumber(coverage.currentBalanceCoverageRatio);
  const hasValidPresentCoverageRatios = isOptionalFiniteNumber(coverage.coverageRatio)
    && isOptionalFiniteNumber(coverage.currentBalanceCoverageRatio);
  return typeof value.subjectAddress === "string"
    && isFiniteNumber(value.riskScore)
    && typeof value.decision === "string"
    && typeof value.userDecision === "string"
    && typeof value.internalDecision === "string"
    && typeof value.proofLevel === "string"
    && isStringArray(value.decisionReasons)
    && Array.isArray(value.originPaths)
    && value.originPaths.every(isRecord)
    && isStringArray(coverage.notes)
    && isFiniteNumber(coverage.selectedInboundTxCount)
    && isFiniteNumber(coverage.fetchedAddressCount)
    && isFiniteNumber(coverage.maxDepth)
    && typeof coverage.partial === "boolean"
    && hasUsableCoverageRatio
    && hasValidPresentCoverageRatios
    && Array.isArray(assessment.hardBadEvidence)
    && isStringArray(assessment.reasons)
    && typeof assessment.walletRole === "string"
    && isFiniteNumber(assessment.provenanceConfidence)
    && isFiniteNumber(assessment.coverageCompleteness);
}

export function extractWhereIsMoneyReportFromJob(job: ForensicCheckJob | null | undefined, subjectAddress: string): WhereIsMoneyReport | null {
  if (!job || job.kind !== "where_is_money_check" || (job.status !== "completed" && job.status !== "partial")) return null;
  if (!isRecord(job.resultJson)) return null;
  const wrappedReport = job.resultJson.whereIsMoneyReport;
  if (!isWhereIsMoneyReport(wrappedReport)) return null;
  if (job.resultJson.subjectAddress !== subjectAddress || wrappedReport.subjectAddress !== subjectAddress) return null;
  return wrappedReport;
}

function whereSupportDecisionReasonLines(report: WhereIsMoneyReport, locale: BotLocale): string[] {
  const seen = new Set<string>();
  return [...report.decisionReasons, ...report.assessment.reasons]
    .map((reason) => reason.trim())
    .filter((reason) => {
      if (!reason || seen.has(reason)) return false;
      seen.add(reason);
      return true;
    })
    .map((reason) => normalizeNotificationReason(reason, locale))
    .slice(0, 6);
}

export function formatWhereIsMoneySupportReport(
  job: ForensicCheckJob,
  report: WhereIsMoneyReport,
  status: "completed" | "partial",
  options: { runtimeLabel?: string; locale?: BotLocale } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? normalizeBotLocale(job.progressJson.locale);
  const coverageRatio = isFiniteNumber(report.coverage.coverageRatio)
    ? report.coverage.coverageRatio
    : isFiniteNumber(report.coverage.currentBalanceCoverageRatio)
      ? report.coverage.currentBalanceCoverageRatio
      : 0;
  const coveragePercent = `${Math.round(coverageRatio * 100)}%`;
  const scopedCoverageLines = [
    report.coverage.checkedScope
      ? `${bold(locale === "en" ? "Checked scope" : "Checked scope")}: ${code(report.coverage.checkedScope)}`
      : null,
    isFiniteNumber(report.coverage.anchorCoverageRatio)
      ? `${bold(locale === "en" ? "Anchor coverage" : "Anchor coverage")}: ${code(formatPercent(report.coverage.anchorCoverageRatio))}`
      : null,
    isFiniteNumber(report.coverage.episodeCoverageRatio)
      ? `${bold(locale === "en" ? "Episode coverage" : "Episode coverage")}: ${code(formatPercent(report.coverage.episodeCoverageRatio))}`
      : null
  ].filter((line): line is string => Boolean(line));
  const decisionReasonLines = whereSupportDecisionReasonLines(report, locale);
  const coverageLines = [
    `${bold(locale === "en" ? "Selected inbound transfers" : "Selected inbound transfers")}: ${code(String(report.coverage.selectedInboundTxCount))}`,
    `${bold(locale === "en" ? "Coverage" : "Coverage")}: ${code(coveragePercent)}`,
    ...scopedCoverageLines,
    `${bold(locale === "en" ? "Fetched addresses" : "Fetched addresses")}: ${code(String(report.coverage.fetchedAddressCount))}`,
    `${bold(locale === "en" ? "Max depth" : "Max depth")}: ${code(String(report.coverage.maxDepth))}`,
    report.coverage.partial ? (locale === "en" ? "Partial provenance coverage." : "Partial provenance coverage.") : null
  ].filter((line): line is string => Boolean(line));
  const assessmentLines = [
    `${bold(locale === "en" ? "Proof level" : "Proof level")}: ${code(report.proofLevel)}`,
    `${bold(locale === "en" ? "Wallet role" : "Wallet role")}: ${code(report.assessment.walletRole)}`,
    `${bold(locale === "en" ? "Provenance confidence" : "Provenance confidence")}: ${code(String(report.assessment.provenanceConfidence))}`,
    `${bold(locale === "en" ? "Coverage completeness" : "Coverage completeness")}: ${code(String(report.assessment.coverageCompleteness))}`
  ];

  return telegramHtmlMessage([
    bold("Where-is-money — support/debug"),
    `${bold("Job")}: ${code(job.id)}`,
    `${bold(locale === "en" ? "Address" : "Address")}: ${code(report.subjectAddress)}`,
    `${bold(locale === "en" ? "Status" : "Status")}: ${code(status)}`,
    `${bold(locale === "en" ? "Decision" : "Decision")}: ${code(report.userDecision)}`,
    riskLine({ subjectAddress: report.subjectAddress, score: report.riskScore, level: levelFromScore(report.riskScore), reasons: [] }, locale === "en" ? "Where risk" : "Where risk", true, locale),
    section(locale === "en" ? "Coverage" : "Coverage", coverageLines),
    section(locale === "en" ? "Assessment" : "Assessment", assessmentLines),
    section(locale === "en" ? "Decision reasons" : "Decision reasons", [
      bulletList(decisionReasonLines, locale === "en" ? "No decision reasons recorded." : "No decision reasons recorded.")
    ]),
    report.coverage.notes.length > 0 ? section(locale === "en" ? "Coverage notes" : "Coverage notes", [
      bulletList(report.coverage.notes.map((note) => normalizeNotificationReason(note, locale)).slice(0, 4))
    ]) : null,
    runtimeMarkerLine(options.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}

export function formatDeepForensicUserDeliveryReport(
  job: ForensicCheckJob,
  report: DeepAddressForensicReport,
  status: "completed" | "partial",
  whereJob: ForensicCheckJob | null | undefined,
  options: { runtimeLabel?: string; locale?: BotLocale; showBetaDiagnostics?: boolean } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? normalizeBotLocale(job.progressJson.locale);
  const whereReport = extractWhereIsMoneyReportFromJob(whereJob, job.subjectAddress);
  return whereReport
    ? formatUnifiedAddressFinalReport({
        address: report.subjectAddress,
        whereReport,
        deepReport: report,
        runtimeLabel: options.runtimeLabel,
        locale,
        showBetaDiagnostics: options.showBetaDiagnostics
      })
    : formatDeepForensicContextReadyReport(job, report, status, {
        runtimeLabel: options.runtimeLabel,
        locale
      });
}

function forensicFailureLabel(job: ForensicCheckJob): string {
  if (job.kind === "where_is_money_check") return "Where is money job";
  if (job.kind === "address_deep_check") return "Deep forensic job";
  return "Forensic job";
}

export function formatDeepForensicFailureUserDeliveryReport(
  job: ForensicCheckJob,
  error: string,
  whereJob: ForensicCheckJob | null | undefined,
  options: { runtimeLabel?: string; locale?: BotLocale } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? normalizeBotLocale(job.progressJson.locale);
  if (job.kind === "address_deep_check") {
    const whereReport = extractWhereIsMoneyReportFromJob(whereJob, job.subjectAddress);
    if (whereReport && whereJob) {
      return formatWhereIsMoneyUserDeliveryReport(
        whereJob,
        whereReport,
        whereJob.status as "completed" | "partial",
        null,
        { runtimeLabel: options.runtimeLabel, locale }
      );
    }
  }

  const label = `${forensicFailureLabel(job)} failed`;
  return telegramHtmlMessage([
    bold(label),
    `${bold("Job")}: ${code(job.id)}`,
    `${bold("Address")}: ${code(job.subjectAddress)}`,
    `${bold("Reason")}: ${code(error)}`,
    runtimeMarkerLine(options.runtimeLabel)
  ]);
}

function arrayField<T = unknown>(record: Record<string, unknown>, key: string): T[] | null {
  const value = record[key];
  return Array.isArray(value) ? value as T[] : null;
}

function optionalArrayField<T = unknown>(record: Record<string, unknown>, key: string): T[] {
  const value = record[key];
  return Array.isArray(value) ? value as T[] : [];
}

function defaultDeepProviderBudget(): DeepAddressForensicReport["providerBudget"] {
  return {
    providerCallBudget: null,
    transferCallBudget: null,
    contractCallBudget: null,
    approvalCallBudget: null,
    elapsedTimeBudgetMs: null,
    exhausted: false
  };
}

function deepRunProfileFromResultJson(record: Record<string, unknown>): DeepAddressForensicReport["runProfile"] {
  return record.runProfile === "bounded_rerun" || record.runProfile === "production_full"
    ? record.runProfile
    : "production_full";
}

function deepBudgetNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function deepProviderBudgetFromResultJson(record: Record<string, unknown>): DeepAddressForensicReport["providerBudget"] {
  const value = record.providerBudget;
  if (!isRecord(value)) return defaultDeepProviderBudget();
  return {
    providerCallBudget: deepBudgetNumber(value.providerCallBudget),
    transferCallBudget: deepBudgetNumber(value.transferCallBudget),
    contractCallBudget: deepBudgetNumber(value.contractCallBudget),
    approvalCallBudget: deepBudgetNumber(value.approvalCallBudget),
    elapsedTimeBudgetMs: deepBudgetNumber(value.elapsedTimeBudgetMs),
    exhausted: value.exhausted === true
  };
}

export function extractDeepForensicReportFromJob(job: ForensicCheckJob | null | undefined, subjectAddress: string): DeepAddressForensicReport | null {
  if (!job || job.kind !== "address_deep_check" || (job.status !== "completed" && job.status !== "partial")) return null;
  if (!isRecord(job.resultJson)) return null;
  if (job.resultJson.subjectAddress !== subjectAddress) return null;
  if (!isRecord(job.resultJson.coverage) || !isRecord(job.resultJson.coverageDebug)) return null;

  const serviceExposureProfiles = arrayField(job.resultJson, "serviceExposureProfiles");
  const addressBehaviorProfiles = arrayField(job.resultJson, "addressBehaviorProfiles");
  const inboundProvenanceProfiles = arrayField(job.resultJson, "inboundProvenanceProfiles");
  const counterpartyRiskProfiles = arrayField(job.resultJson, "counterpartyRiskProfiles");
  const approvalDrainProvenanceProfiles = arrayField(job.resultJson, "approvalDrainProvenanceProfiles");
  const missingChecks = arrayField<string>(job.resultJson, "missingChecks");
  if (!serviceExposureProfiles || !addressBehaviorProfiles || !inboundProvenanceProfiles || !counterpartyRiskProfiles || !approvalDrainProvenanceProfiles || !missingChecks) {
    return null;
  }

  return {
    subjectAddress,
    windowStart: job.windowStart,
    windowEnd: job.windowEnd,
    runProfile: deepRunProfileFromResultJson(job.resultJson),
    providerBudget: deepProviderBudgetFromResultJson(job.resultJson),
    rawEvidence: [],
    observations: [],
    missingChecks,
    serviceExposureProfiles: serviceExposureProfiles as DeepAddressForensicReport["serviceExposureProfiles"],
    addressBehaviorProfiles: addressBehaviorProfiles as DeepAddressForensicReport["addressBehaviorProfiles"],
    inboundProvenanceProfiles: inboundProvenanceProfiles as DeepAddressForensicReport["inboundProvenanceProfiles"],
    counterpartyRiskProfiles: counterpartyRiskProfiles as DeepAddressForensicReport["counterpartyRiskProfiles"],
    directCounterpartyInteractionProfiles: optionalArrayField(job.resultJson, "directCounterpartyInteractionProfiles") as DeepAddressForensicReport["directCounterpartyInteractionProfiles"],
    approvalDrainProvenanceProfiles: approvalDrainProvenanceProfiles as DeepAddressForensicReport["approvalDrainProvenanceProfiles"],
    assetContinuationProfiles: optionalArrayField(job.resultJson, "assetContinuationProfiles") as DeepAddressForensicReport["assetContinuationProfiles"],
    stablecoinRestrictionProfiles: optionalArrayField(job.resultJson, "stablecoinRestrictionProfiles") as DeepAddressForensicReport["stablecoinRestrictionProfiles"],
    boundaryExposureProfiles: optionalArrayField(job.resultJson, "boundaryExposureProfiles") as DeepAddressForensicReport["boundaryExposureProfiles"],
    operationalFlowProfiles: optionalArrayField(job.resultJson, "operationalFlowProfiles") as DeepAddressForensicReport["operationalFlowProfiles"],
    walletRoleProfiles: optionalArrayField(job.resultJson, "walletRoleProfiles") as DeepAddressForensicReport["walletRoleProfiles"],
    extendedProvenanceProfiles: optionalArrayField(job.resultJson, "extendedProvenanceProfiles") as DeepAddressForensicReport["extendedProvenanceProfiles"],
    coverage: job.resultJson.coverage as DeepAddressForensicReport["coverage"],
    coverageDebug: job.resultJson.coverageDebug as DeepAddressForensicReport["coverageDebug"]
  };
}

function isPendingDeepForensicJob(job: ForensicCheckJob | null | undefined, subjectAddress: string): boolean {
  return Boolean(
    job &&
    job.kind === "address_deep_check" &&
    job.subjectAddress === subjectAddress &&
    (job.status === "queued" || job.status === "running")
  );
}

function formatWhereIsMoneyPreliminaryReport(
  job: ForensicCheckJob,
  report: WhereIsMoneyReport,
  options: { runtimeLabel?: string; locale?: BotLocale } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? normalizeBotLocale(job.progressJson.locale);
  const level = levelFromScore(report.riskScore);
  const hardEvidence = whereHardEvidenceReasonLines(report, locale)[0] ?? null;
  const reason = hardEvidence
    ? hardEvidence.replace(/^Жёсткое доказательство:\s*/u, "").replace(/^Hard evidence:\s*/u, "")
    : locale === "en"
      ? "Where Is Money completed a preliminary provenance pass."
      : "Where Is Money завершил предварительную проверку происхождения средств.";

  return telegramHtmlMessage([
    bold(locale === "en" ? "Address check — preliminary result" : "Проверка адреса — предварительный результат"),
    `${bold(locale === "en" ? "Address" : "Адрес")}: ${code(report.subjectAddress)}`,
    `${bold(locale === "en" ? "Preliminary risk" : "Предварительный риск")}: ${formatRiskIcon(level)} ${code(`${report.riskScore}/100`)}`,
    section(locale === "en" ? "Why" : "Почему", [
      bulletList([normalizeNotificationReason(reason, locale)])
    ]),
    section(locale === "en" ? "What happens next" : "Что дальше", [
      locale === "en"
        ? "DeepCheck is still checking address links and behavior."
        : "DeepCheck ещё продолжает проверку связей и поведения адреса.",
      locale === "en"
        ? "Final result will arrive after the remaining analysis completes."
        : "Финальный итог придёт после завершения анализа."
    ]),
    runtimeMarkerLine(options.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}

export function formatWhereIsMoneyUserDeliveryReport(
  job: ForensicCheckJob,
  report: WhereIsMoneyReport,
  status: "completed" | "partial",
  deepJob: ForensicCheckJob | null | undefined,
  options: { runtimeLabel?: string; locale?: BotLocale; showBetaDiagnostics?: boolean } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? normalizeBotLocale(job.progressJson.locale);
  const deepReport = extractDeepForensicReportFromJob(deepJob, report.subjectAddress);
  if (deepReport) {
    return formatUnifiedAddressFinalReport({
      address: report.subjectAddress,
      whereReport: report,
      deepReport,
      runtimeLabel: options.runtimeLabel,
      locale,
      showBetaDiagnostics: options.showBetaDiagnostics
    });
  }
  if (isPendingDeepForensicJob(deepJob, report.subjectAddress)) {
    return formatWhereIsMoneyPreliminaryReport(job, report, {
      runtimeLabel: options.runtimeLabel,
      locale
    });
  }
  return formatWhereIsMoneyReport(job, report, status, {
    runtimeLabel: options.runtimeLabel,
    locale,
    showBetaDiagnostics: options.showBetaDiagnostics
  });
}

type UnifiedRiskReasonSource = UnifiedWalletRiskResult["reasons"][number]["source"];
type UnifiedRiskLayer = keyof UnifiedWalletRiskResult["layerBreakdown"];
type UnifiedRiskCoverageLevel = UnifiedWalletRiskResult["coverageLevel"];
type UnifiedRiskFinalDecision = UnifiedWalletRiskResult["finalDecision"];

function finalDecisionExplanation(decision: UnifiedRiskFinalDecision, locale: BotLocale): string {
  if (locale === "en") {
    switch (decision) {
      case "DECLINE":
        return "Address cannot be accepted automatically.";
      case "ACCEPTABLE":
        return "No strong risk signals were found.";
    }
  }

  switch (decision) {
    case "DECLINE":
      return "Адрес нельзя принять автоматически.";
    case "ACCEPTABLE":
      return "Сильных риск-сигналов не найдено.";
  }
}

function unifiedRiskReasonSourceLabel(source: UnifiedRiskReasonSource, locale: BotLocale): string {
  const labels: Record<UnifiedRiskReasonSource, { en: string; ru: string }> = {
    fast_check: { en: "Fast Check", ru: "Быстрая проверка" },
    deep_research: { en: "Deep Research", ru: "Глубокий анализ" },
    where_is_money: { en: "Where Is Money", ru: "Where Is Money" },
    hard_evidence: { en: "Hard evidence", ru: "Жёсткое доказательство" },
    policy_floor: { en: "Policy floor", ru: "Порог политики" },
    asset_continuation: { en: "Asset continuation", ru: "Продолжение актива" },
    pattern_floor: { en: "Pattern floor", ru: "Порог по паттерну" },
    dampener: { en: "Dampener", ru: "Снижение" },
    coverage: { en: "Coverage", ru: "Покрытие" },
    incoming_exposure: { en: "Incoming exposure", ru: "Входящий риск" }
  };
  const label = labels[source];
  return locale === "en" ? label.en : label.ru;
}

function unifiedRiskLayerLabel(layer: UnifiedRiskLayer, locale: BotLocale): string {
  const labels: Record<UnifiedRiskLayer, { en: string; ru: string }> = {
    fast: { en: "Fast Check", ru: "Быстрая проверка" },
    deep: { en: "Deep Research", ru: "Глубокий анализ" },
    where: { en: "Where Is Money", ru: "Where Is Money" }
  };
  const label = labels[layer];
  return locale === "en" ? label.en : label.ru;
}

function unifiedRiskCoverageLabel(coverage: UnifiedRiskCoverageLevel, locale: BotLocale): string {
  const labels: Record<UnifiedRiskCoverageLevel, { en: string; ru: string }> = {
    complete: { en: "complete", ru: "полное" },
    partial: { en: "partial", ru: "неполное" },
    limited: { en: "limited", ru: "ограниченное" }
  };
  const label = labels[coverage];
  return locale === "en" ? label.en : label.ru;
}

const deterministicWhereHardEvidenceKinds = new Set<WhereIsMoneyReport["assessment"]["hardBadEvidence"][number]["kind"]>([
  "approval_drain",
  "scam_or_blacklist",
  "sanctioned_service"
]);

function isDeterministicWhereHardEvidence(
  evidence: WhereIsMoneyReport["assessment"]["hardBadEvidence"][number]
): boolean {
  return deterministicWhereHardEvidenceKinds.has(evidence.kind);
}

function unifiedRiskReasonMessage(
  reason: UnifiedWalletRiskResult["reasons"][number],
  locale: BotLocale
): string {
  if (locale === "en") {
    switch (reason.code) {
      case "exact_approval_drain":
        return "Exact approval-drain provenance was found.";
      case "deep_high_risk_inbound_provenance":
      case "deep_high_risk_extended_provenance":
      case "where_hard_bad_evidence":
        return "Deterministic high-risk provenance evidence was found.";
    }
  }
  return reason.message;
}

function whereHardEvidenceReasonLines(report: WhereIsMoneyReport, locale: BotLocale): string[] {
  return report.assessment.hardBadEvidence.filter(isDeterministicWhereHardEvidence).slice(0, 2).map((evidence) => {
    return locale === "en"
      ? `Hard evidence: ${evidence.message} (score ${evidence.score}).`
      : `Жёсткое доказательство: ${evidence.message} (оценка ${evidence.score}).`;
  });
}

function whereContextEvidenceReasonLines(report: WhereIsMoneyReport, locale: BotLocale): string[] {
  void locale;
  return report.assessment.hardBadEvidence
    .filter((evidence) => !isDeterministicWhereHardEvidence(evidence))
    .slice(0, 1)
    .map((evidence) => `Context evidence: ${evidence.message} (score ${evidence.score}).`);
}

function whereDecisionContextReasonLines(report: WhereIsMoneyReport, locale: BotLocale): string[] {
  if (report.userDecision !== "DECLINE") return [];
  const seen = new Set<string>();
  const line = [...report.decisionReasons, ...report.assessment.reasons]
    .map((reason) => normalizeNotificationReason(reason.trim(), locale))
    .find((reason) => {
      if (!reason || seen.has(reason)) return false;
      seen.add(reason);
      return true;
    });
  return line ? [`Where Is Money: ${line}`] : [];
}

function unifiedRiskReasonLines(
  result: UnifiedWalletRiskResult,
  locale: BotLocale,
  options: { skipWhereHardEvidence?: boolean } = {}
): string[] {
  const topReasonLines = result.reasons
    .filter((reason) => reason.source !== "dampener")
    .filter((reason) => !(options.skipWhereHardEvidence && reason.code === "where_hard_bad_evidence"))
    .slice(0, 2)
    .map((reason) => {
      const source = unifiedRiskReasonSourceLabel(reason.source, locale);
      const message = unifiedRiskReasonMessage(reason, locale);
      return locale === "en"
        ? `${source}: ${message} (score ${reason.score}).`
        : `${source}: ${message} (оценка ${reason.score}).`;
    });

  return [
    ...topReasonLines,
    locale === "en"
      ? `Weighted layer score: ${result.weightedLayerScore}.`
      : `Взвешенная оценка слоёв: ${result.weightedLayerScore}.`
  ];
}

function displayedUnifiedRiskScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function postDampenerContextScore(result: UnifiedWalletRiskResult): number {
  return displayedUnifiedRiskScore(result.weightedLayerScore - result.dampener);
}

function unifiedRiskBreakdownLines(result: UnifiedWalletRiskResult, locale: BotLocale): string[] {
  const layerLines = (["fast", "deep", "where"] as const).map((layer) => {
    const item = result.layerBreakdown[layer];
    const label = unifiedRiskLayerLabel(layer, locale);
    return locale === "en"
      ? `${label}: raw ${item.rawScore}, configured weight ${item.weight.toFixed(2)}, normalized contribution ${item.weightedContribution}.`
      : `${label}: исходная ${item.rawScore}, настроенный вес ${item.weight.toFixed(2)}, нормализованный вклад ${item.weightedContribution}.`;
  });
  const contextScoreLine = result.contextScore !== result.weightedLayerScore
    ? (locale === "en"
        ? `Coverage-adjusted context score: ${result.contextScore}.`
        : `Контекст после коррекции покрытия: ${result.contextScore}.`)
    : (locale === "en"
        ? `Context score: ${result.contextScore}.`
        : `Оценка контекста: ${result.contextScore}.`);

  return [
    ...layerLines,
    ...unifiedRiskAnchorLines(result, locale),
    contextScoreLine,
    locale === "en"
      ? `Hard evidence floor: ${result.hardEvidenceFloor}.`
      : `Порог жёстких доказательств: ${result.hardEvidenceFloor}.`,
    locale === "en"
      ? `Policy floor: ${result.policyFloor}.`
      : `Порог политики: ${result.policyFloor}.`,
    locale === "en"
      ? `Asset continuation floor: ${result.assetContinuationFloor}.`
      : `Порог продолжения актива: ${result.assetContinuationFloor}.`,
    locale === "en"
      ? `Pattern floor: ${result.patternFloor}.`
      : `Порог по паттернам: ${result.patternFloor}.`,
    locale === "en"
      ? `Dampener: ${result.dampener}.`
      : `Снижение: ${result.dampener}.`,
    locale === "en"
      ? `Coverage: ${unifiedRiskCoverageLabel(result.coverageLevel, locale)}.`
      : `Покрытие: ${unifiedRiskCoverageLabel(result.coverageLevel, locale)}.`
  ];
}

function providerBudgetValue(value: number | null): string {
  return value === null ? "none" : String(value);
}

function hasProviderBudgetDetails(budget: DeepAddressForensicReport["providerBudget"]): boolean {
  return budget.exhausted
    || budget.providerCallBudget !== null
    || budget.transferCallBudget !== null
    || budget.contractCallBudget !== null
    || budget.approvalCallBudget !== null
    || budget.elapsedTimeBudgetMs !== null;
}

function deepRunProfileAndProviderBudgetLines(report: DeepAddressForensicReport | null | undefined): string[] {
  if (!report) return [];
  const lines = [`Run profile: ${report.runProfile}.`];
  const budget = report.providerBudget;
  if (hasProviderBudgetDetails(budget)) {
    const parts = [
      `calls ${providerBudgetValue(budget.providerCallBudget)}`,
      `transfers ${providerBudgetValue(budget.transferCallBudget)}`,
      `contracts ${providerBudgetValue(budget.contractCallBudget)}`,
      `approvals ${providerBudgetValue(budget.approvalCallBudget)}`,
      `elapsed ${providerBudgetValue(budget.elapsedTimeBudgetMs)} ms`,
      `exhausted ${budget.exhausted ? "yes" : "no"}`
    ];
    lines.push(`Provider budget: ${parts.join(", ")}.`);
  }
  return lines;
}

function compactUnifiedRiskLayerLabel(layer: UnifiedRiskLayer): string {
  switch (layer) {
    case "fast":
      return "FastCheck";
    case "deep":
      return "DeepCheck";
    case "where":
      return "Where Is Money";
  }
}

function compactUnifiedRiskBreakdownLines(
  result: UnifiedWalletRiskResult,
  locale: BotLocale,
  deepReport: DeepAddressForensicReport | null | undefined
): string[] {
  const layerLines = (["fast", "deep", "where"] as const).map((layer) => {
    const item = result.layerBreakdown[layer];
    return `${compactUnifiedRiskLayerLabel(layer)}: raw ${item.rawScore}, weight ${item.weight.toFixed(2)}, normalized contribution ${item.weightedContribution}.`;
  });
  const anchorLines = unifiedRiskAnchorLines(result, locale);
  const floorLines = [
    result.hardEvidenceFloor > 0 ? `Hard evidence floor: ${result.hardEvidenceFloor}.` : null,
    result.policyFloor > 0 ? `Policy floor: ${result.policyFloor}.` : null,
    result.assetContinuationFloor > 0 ? `Asset continuation floor: ${result.assetContinuationFloor}.` : null,
    result.patternFloor > 0 ? `Pattern floor: ${result.patternFloor}.` : null,
    result.dampener > 0 ? `Dampener: ${result.dampener}.` : null
  ].filter((line): line is string => Boolean(line));
  const anchor = result.scoreBreakdown.activeAnchor ?? null;
  const topReason = result.reasons[0] ?? null;
  const evidenceClass = anchor
    ? `${anchor.source}/${anchor.code}`
    : topReason
      ? `${topReason.source}/${topReason.code}`
      : "context/no_hard_evidence";
  const policyLine = result.hardEvidenceFloor > 0
    ? "Policy: hard evidence can pin the final risk."
    : "Policy: context-only risk is capped below critical.";
  const contextScore = displayedUnifiedRiskScore(result.contextScore);
  const postDampenerScore = postDampenerContextScore(result);
  const contextScoreLines = [
    result.dampener > 0 ? `Context score after dampener: ${postDampenerScore}.` : null,
    contextScore !== postDampenerScore
      ? `Coverage-adjusted context score: ${contextScore}.`
      : result.dampener > 0
        ? null
        : `Context score: ${contextScore}.`
  ].filter((line): line is string => Boolean(line));

  return [
    ...layerLines,
    `Weighted layer score: ${result.weightedLayerScore}.`,
    ...contextScoreLines,
    ...anchorLines,
    ...floorLines,
    `Coverage: ${unifiedRiskCoverageLabel(result.coverageLevel, locale)}.`,
    `Evidence class: ${evidenceClass}.`,
    policyLine,
    `Final risk diagnostic: ${result.finalScore}, decision ${result.finalDecision}.`,
    ...deepRunProfileAndProviderBudgetLines(deepReport)
  ];
}

function unifiedRiskAnchorLines(result: UnifiedWalletRiskResult, locale: BotLocale): string[] {
  const anchor = result.scoreBreakdown.activeAnchor;
  if (!anchor) return [];
  if (anchor.source === "coverage" || anchor.code === "limited_coverage_floor") return [];
  return [
    locale === "en"
      ? `Anchored by: ${anchor.code} ${anchor.score}.`
      : `Закреплено сигналом: ${anchor.code} ${anchor.score}.`
  ];
}

function whereCoverageSummaryLine(report: WhereIsMoneyReport, locale: BotLocale): string {
  const coverage = report.coverage;
  const ratio = isFiniteNumber(coverage.coverageRatio)
    ? coverage.coverageRatio
    : isFiniteNumber(coverage.currentBalanceCoverageRatio)
      ? coverage.currentBalanceCoverageRatio
      : 0;
  const percent = Math.round(ratio * 100);
  const count = coverage.selectedInboundTxCount;
  if (coverage.checkedScope === "drain_episode") {
    const episodeRatio = isFiniteNumber(coverage.episodeCoverageRatio)
      ? coverage.episodeCoverageRatio
      : isFiniteNumber(coverage.drainEpisode?.episodeCoverageRatio)
        ? coverage.drainEpisode.episodeCoverageRatio
        : ratio;
    const anchorContext = isFiniteNumber(coverage.anchorCoverageRatio)
      ? `; anchor coverage ${formatPercent(coverage.anchorCoverageRatio)}`
      : "";
    return `Checked ${formatPercent(episodeRatio)} of the selected drain episode${anchorContext}.`;
  }
  if (coverage.checkedScope === "selected_anchor") {
    const anchorRatio = isFiniteNumber(coverage.anchorCoverageRatio) ? coverage.anchorCoverageRatio : ratio;
    return `Checked ${formatPercent(anchorRatio)} of the selected recent-flow anchor across ${count} inbound USDT transfer(s).`;
  }
  if (coverage.checkedScope === "recent_flow") {
    return "Checked recent-flow wallet context; no selected outgoing anchor was available.";
  }
  if (locale === "en") return `Checked ${percent}% of the target amount across ${count} inbound USDT transfer(s).`;
  return `Проверено ${percent}% суммы: ${count} входящих USDT-перевода.`;
}

function whereLimitationLines(report: WhereIsMoneyReport, locale: BotLocale): string[] {
  const weak = report.originPaths.filter((path) => path.stoppedReason === "weak_amount_or_time_continuity").length;
  const missing = report.originPaths.filter((path) => path.stoppedReason === "no_previous_transfer").length;
  const lines: string[] = [];
  if (weak > 0) {
    lines.push(locale === "en"
      ? `${weak} path(s) stopped because amount/time continuity was too weak.`
      : `${weak} путей остановлены из-за слабой связи суммы/времени.`);
  }
  if (missing > 0) {
    lines.push(locale === "en"
      ? `${missing} path(s) stopped because no earlier inbound USDT transfer was found.`
      : `${missing} путей остановлены без предыдущего входящего USDT-перевода.`);
  }
  if (report.coverage.partial && lines.length === 0) {
    lines.push(locale === "en"
      ? "The report is complete, but some provenance limits remain."
      : "Отчёт готов, но по происхождению остались ограничения.");
  }
  return lines.slice(0, 3);
}

function unifiedBehaviorContextLines(report: DeepAddressForensicReport | null | undefined, locale: BotLocale): string[] {
  if (!report) return [];
  const direct = topDirectCounterpartyInteractionProfile(report);
  if (direct?.snapshot?.riskScore && direct.scoreContribution > 0) {
    return [locale === "en"
      ? `Behavior warning: a major ${direct.direction} counterparty looks risky, but this is not dirty-funds proof.`
      : "Есть поведенческий риск по крупному контрагенту, но это не доказательство грязного происхождения."];
  }
  const boundary = firstBoundaryExposureProfile(report);
  if (boundary) {
    return [locale === "en"
      ? "Service-boundary context exists; public-chain continuity is limited after that point."
      : "Есть сервисная граница: после неё публичная цепочка происхождения ограничена."];
  }
  return [];
}

function sourceUnresolvedBoundaryLabel(kind: NonNullable<NonNullable<WhereIsMoneyReport["sourceBundleExposure"]>["unresolvedBoundary"]>["kind"]): string {
  switch (kind) {
    case "htx_huobi":
      return "HTX/Huobi source boundary";
    case "bridge_router_dex":
      return "bridge/router/DEX boundary";
    case "unknown_contract":
      return "unknown contract boundary";
    case "unknown":
      return "unknown source boundary";
    case "clean_cex":
    default:
      return "source boundary";
  }
}

function whereSharedSourceExposureLines(report: WhereIsMoneyReport, locale: BotLocale): string[] {
  void locale;
  const lines: string[] = [];
  const sourceExposure = report.sourceBundleExposure;
  if (sourceExposure && isFiniteNumber(sourceExposure.htxHuobiShare) && sourceExposure.htxHuobiShare > 0) {
    lines.push(`HTX/Huobi funds ${formatPercent(sourceExposure.htxHuobiShare)} of the selected amount.`);
  }
  if (report.subjectExposureProfile && isFiniteNumber(report.subjectExposureProfile.htxHuobiIncomingShare) && report.subjectExposureProfile.htxHuobiIncomingShare > 0) {
    lines.push("Historical HTX/Huobi exposure is context, not selected-amount source proof.");
  }
  if (sourceExposure?.unresolvedBoundary) {
    lines.push(`The graph stopped before resolving a material ${sourceUnresolvedBoundaryLabel(sourceExposure.unresolvedBoundary.kind)}.`);
  }
  return lines;
}

function finalScoreExplanationLines(result: UnifiedWalletRiskResult, locale: BotLocale): string[] {
  const lines = [
    locale === "en"
      ? `Weighted/background score is ${result.weightedLayerScore}; final risk is ${result.finalScore}.`
      : `Взвешенная/фоновая оценка: ${result.weightedLayerScore}; итоговый риск: ${result.finalScore}.`
  ];
  const contextScore = displayedUnifiedRiskScore(result.contextScore);
  const postDampenerScore = postDampenerContextScore(result);

  if (result.dampener > 0) {
    lines.push(locale === "en"
      ? `Dampener lowers the context used for the final score to ${postDampenerScore}.`
      : `Снижение опускает контекст для итогового риска до ${postDampenerScore}.`);
  }

  if (contextScore !== postDampenerScore) {
    lines.push(locale === "en"
      ? (contextScore > postDampenerScore
          ? `Coverage adjustment raises the context used for the final score to ${contextScore}.`
          : `Coverage-adjusted context used for the final score is ${contextScore}.`)
      : (contextScore > postDampenerScore
          ? `Коррекция из-за покрытия повышает контекст для итогового риска до ${contextScore}.`
          : `Контекст после коррекции покрытия для итогового риска: ${contextScore}.`));
  }

  if (result.hardEvidenceFloor > 0 && result.hardEvidenceFloor >= result.contextScore) {
    lines.push(locale === "en"
      ? `Hard evidence floor ${result.hardEvidenceFloor} raises or pins the final risk.`
      : `Жёсткие доказательства поднимают или фиксируют итоговый риск на ${result.hardEvidenceFloor}.`);
  } else if (result.scoreBreakdown.noHardEvidenceCriticalCap.applied) {
    lines.push(locale === "en"
      ? `No hard evidence floor was found, so context-only risk is capped at ${result.scoreBreakdown.noHardEvidenceCriticalCap.maxScore}.`
      : `Жёсткого доказательства нет, поэтому контекстный риск ограничен ${result.scoreBreakdown.noHardEvidenceCriticalCap.maxScore}.`);
  } else if (result.hardEvidenceFloor === 0) {
    lines.push(locale === "en" ? "No deterministic bad evidence was found." : "Жёстких плохих доказательств не найдено.");
    lines.push(locale === "en"
      ? "Behavior and source-policy signals are context, not proof by themselves."
      : "Поведенческие и source-policy сигналы — это контекст, не самостоятельное доказательство.");
  }

  return lines;
}

function finalDataTrustLines(result: UnifiedWalletRiskResult, whereReport: WhereIsMoneyReport, locale: BotLocale): string[] {
  const partialNote = whereReport.coverage.partial
    ? (locale === "en"
        ? "Some provenance/provider coverage is partial."
        : "Часть происхождения или провайдерского покрытия неполная.")
    : null;

  const coverageLine = (() => {
    switch (result.coverageLevel) {
      case "complete":
        return locale === "en"
          ? "Coverage is enough for this automated screen, but it is not a guarantee the address is clean."
          : "Покрытия достаточно для автоматической проверки, но это не гарантия, что адрес чистый.";
      case "partial":
        return locale === "en"
          ? "Coverage is partial: the result reflects the data that was available, not a clean guarantee."
          : "Покрытие неполное: итог отражает доступные данные, а не гарантирует чистоту адреса.";
      case "limited":
        return locale === "en"
          ? "Coverage is limited: low risk only means no strong signal was found in available data."
          : "Покрытие ограничено: низкий риск означает только отсутствие сильных сигналов в доступных данных.";
    }
  })();

  return [coverageLine, partialNote].filter((line): line is string => Boolean(line));
}

function finalReportEvidenceHints(input: UnifiedAddressFinalReportInput, reasons: string[]): string[] {
  return [
    ...reasons,
    ...(input.whereReport.assessment?.reasons ?? []),
    ...(input.deepReport?.missingChecks ?? [])
  ];
}

function finalReportHasHardEvidence(input: UnifiedAddressFinalReportInput, unifiedRisk: UnifiedWalletRiskResult): boolean {
  if (unifiedRisk.hardEvidenceFloor >= 85) return true;
  if (input.whereReport.assessment.hardBadEvidence.length > 0) return true;
  return input.deepReport?.stablecoinRestrictionProfiles?.some((profile) => profile.isBlacklisted === true) === true;
}

function localizedClarityDisplayNote(note: string, locale: BotLocale): string {
  if (locale === "en") return note;
  if (note === "High contextual risk; no hard evidence observed.") {
    return "Высокий контекстный риск; жестких доказательств не найдено.";
  }
  if (note === "No material risk found in available data; this is not a guarantee of clean history.") {
    return "В доступных данных существенный риск не найден; это не гарантия чистой истории.";
  }
  if (note === "Coverage is limited; review the evidence before treating this result as final.") {
    return "Покрытие ограничено; проверьте доказательства перед итоговым решением.";
  }
  return note;
}

function clarityUserLines(clarity: RiskClaritySummary, locale: BotLocale): string[] {
  const lines: string[] = [];
  if (clarity.coverageStatus === "partial") {
    lines.push(locale === "en" ? "Data is partial; review coverage before treating this as final." : "Данные частичные; перед итоговым решением проверьте покрытие.");
  }
  if (clarity.coverageStatus === "limited" || clarity.coverageStatus === "insufficient") {
    lines.push(locale === "en" ? "Data is limited; this is not a guarantee of clean history." : "Данные ограничены; это не гарантия чистой истории.");
  }
  const visibleNotes = clarity.displayNotes.filter((note) => {
    if (note === "High contextual risk; no hard evidence observed.") return true;
    if (clarity.coverageStatus === "limited" || clarity.coverageStatus === "insufficient") {
      return !note.includes("not a guarantee of clean history") && !note.startsWith("Coverage is limited;");
    }
    if (clarity.coverageStatus === "partial") {
      return !note.includes("not a guarantee of clean history");
    }
    return true;
  });
  lines.push(...visibleNotes.map((note) => localizedClarityDisplayNote(note, locale)));
  return [...new Set(lines)];
}

function betaDiagnosticsLines(clarity: RiskClaritySummary): string[] {
  if (!clarity.betaDiagnosticsVisible) return [];
  return [
    `${bold("Beta/internal diagnostics")}: ${code(`coverage ${clarity.coverageStatus} · confidence ${clarity.confidenceScore ?? "n/a"} · evidence ${clarity.evidenceClass} · policy ${clarity.policyVersion}`)}`
  ];
}

function finalFindingLines(
  whereReport: WhereIsMoneyReport,
  deepReport: DeepAddressForensicReport | null | undefined,
  locale: BotLocale
): string[] {
  const hardEvidence = whereReport.assessment.hardBadEvidence.find(isDeterministicWhereHardEvidence) ?? null;
  const whereReason = hardEvidence?.message
    ?? whereReport.decisionReasons[0]
    ?? whereReport.assessment.reasons[0]
    ?? null;
  const whereLine = whereReason
    ? `Where Is Money: ${normalizeNotificationReason(whereReason, locale)}`
    : locale === "en"
      ? `Where Is Money: provenance check completed with score ${whereReport.riskScore}.`
      : `Where Is Money: проверка происхождения завершена, оценка ${whereReport.riskScore}.`;
  const deepContext = unifiedBehaviorContextLines(deepReport, locale)[0] ?? null;
  const deepLine = deepReport
    ? deepContext
      ? `DeepCheck: ${deepContext}`
      : locale === "en"
        ? "DeepCheck: behavior/provenance context checked; no strong extra signal in that pass."
        : "DeepCheck: поведение и контекст происхождения проверены; сильного дополнительного сигнала нет."
    : null;
  const coverageLine = whereCoverageSummaryLine(whereReport, locale);
  const partialLine = whereReport.coverage.partial
    ? (locale === "en"
        ? "Coverage note: provenance coverage is partial."
        : "Покрытие: часть происхождения не попала в проверку.")
    : null;

  return [whereLine, deepLine, coverageLine, partialLine].filter((line): line is string => Boolean(line));
}

export function formatUnifiedAddressFinalReport(input: UnifiedAddressFinalReportInput): TelegramHtmlMessage {
  const locale = input.locale ?? DEFAULT_BOT_LOCALE;
  const unifiedRisk = calculateUnifiedWalletRisk({
    address: input.address,
    fastReport: input.fastReport,
    deepReport: input.deepReport,
    whereReport: input.whereReport
  });
  const finalDecision = unifiedRisk.finalDecision;
  const finalScore = unifiedRisk.finalScore;
  const finalLevel = unifiedRisk.finalLevel;
  const whereHardEvidenceLines = whereHardEvidenceReasonLines(input.whereReport, locale);
  const whereContextEvidenceLines = whereContextEvidenceReasonLines(input.whereReport, locale);
  const whereDecisionContextLines = whereHardEvidenceLines.length === 0 && whereContextEvidenceLines.length === 0
    ? whereDecisionContextReasonLines(input.whereReport, locale)
    : [];
  const topRiskReasonLines = unifiedRiskReasonLines(unifiedRisk, locale, {
    skipWhereHardEvidence: whereHardEvidenceLines.length > 0
  }).filter((line) => !(locale === "en" ? line.startsWith("Weighted layer score:") : line.startsWith("Взвешенная оценка слоёв:")));
  const mainReasonLines = [
    ...whereHardEvidenceLines,
    ...whereContextEvidenceLines,
    ...whereDecisionContextLines,
    ...topRiskReasonLines,
    unifiedRisk.hardEvidenceFloor === 0
      ? (locale === "en" ? "No deterministic bad evidence was found." : "Жёстких плохих доказательств не найдено.")
      : null
  ].filter((line): line is string => Boolean(line)).slice(0, 2);
  const findingLines = [
    ...finalFindingLines(input.whereReport, input.deepReport, locale),
    ...whereContextEvidenceLines,
    ...topRiskReasonLines.filter((line) => !mainReasonLines.includes(line)),
    ...whereSharedSourceExposureLines(input.whereReport, locale)
  ];
  const clarity = buildRiskClaritySummary({
    kind: "address_deep_check",
    executionStatus: input.whereReport.coverage.partial ? "partial" : "completed",
    finalRiskScore: finalScore,
    explicitDecision: finalDecision,
    missingChecks: [
      ...input.whereReport.coverage.notes,
      ...(input.deepReport?.missingChecks ?? [])
    ],
    coveragePartial: input.whereReport.coverage.partial || unifiedRisk.coverageLevel !== "complete",
    fetchedAddressCount: input.whereReport.coverage.fetchedAddressCount,
    hardEvidenceObserved: finalReportHasHardEvidence(input, unifiedRisk),
    evidenceHints: finalReportEvidenceHints(input, [...mainReasonLines, ...findingLines])
  }, { betaDiagnosticsVisible: input.showBetaDiagnostics === true });
  const scoreExplanationLines = finalScoreExplanationLines(unifiedRisk, locale);
  const dataTrustLines = [...new Set([
    ...finalDataTrustLines(unifiedRisk, input.whereReport, locale),
    ...clarityUserLines(clarity, locale)
  ])];
  const limitationLines = whereLimitationLines(input.whereReport, locale);
  const betaInternalLines = compactUnifiedRiskBreakdownLines(unifiedRisk, locale, input.deepReport);
  const crossChainCorridorLines = whereCrossChainCorridorLines(input.whereReport);

  return telegramHtmlMessage([
    bold(locale === "en" ? "Address check — final" : "Проверка адреса — итог"),
    `${bold(locale === "en" ? "Address" : "Адрес")}: ${code(input.address)}`,
    `${bold(locale === "en" ? "Decision" : "Решение")}: ${code(finalDecision)} — ${finalDecisionExplanation(finalDecision, locale)}`,
    riskLine({ subjectAddress: input.address, score: finalScore, level: finalLevel, reasons: [] }, locale === "en" ? "Final risk" : "Итоговый риск", true, locale),
    section(locale === "en" ? "Main reason" : "Главная причина", [
      bulletList(mainReasonLines)
    ]),
    section(locale === "en" ? "Findings" : "Что нашли", [
      bulletList(findingLines)
    ]),
    section(locale === "en" ? `Why risk ${finalScore}` : `Почему риск ${finalScore}`, [
      bulletList(scoreExplanationLines)
    ]),
    section(locale === "en" ? "Data trust" : "Доверие к данным", [
      bulletList(dataTrustLines)
    ]),
    ...betaDiagnosticsLines(clarity),
    limitationLines.length > 0 ? section(locale === "en" ? "Limits" : "Ограничения", [
      bulletList(limitationLines)
    ]) : null,
    crossChainCorridorLines.length > 0 ? section("Cross-chain corridor", [
      bulletList(crossChainCorridorLines)
    ]) : null,
    section("Beta/internal", [
      bulletList(betaInternalLines)
    ]),
    runtimeMarkerLine(input.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}

type CrossChainCorridor = NonNullable<WhereIsMoneyReport["crossChainCorridor"]>;
type CrossChainCorridorPathForReport = CrossChainCorridor["paths"][number];
type CrossChainCorridorAddressForReport = CrossChainCorridorPathForReport["edges"][number]["source"];

function crossChainTerminalBoundaryText(boundary: CrossChainCorridorPathForReport["terminalBoundary"]): string {
  switch (boundary) {
    case "tornado_or_mixer":
      return "Tornado/mixer";
    case "sanctioned_service":
      return "sanctioned service";
    case "no_name_token_liquidity":
      return "no-name token liquidity";
    case "bridge_boundary":
      return "bridge boundary";
    case "dex_router_boundary":
      return "DEX/router boundary";
    case "unknown_contract":
      return "unknown contract";
    case "data_exhausted":
      return "data exhausted";
    case "candidate_only":
      return "candidate-only continuation";
    case "none":
      return "none";
  }
}

function crossChainAddressLabel(address: CrossChainCorridorAddressForReport): string {
  if (!address) return "unknown";
  return `${address.chain}:${shortIdentifier(address.address)}`;
}

function crossChainTopPathLine(path: CrossChainCorridorPathForReport): string {
  const firstEdge = path.edges[0] ?? null;
  const lastEdge = path.edges.at(-1) ?? null;
  const route = [
    firstEdge?.source ? crossChainAddressLabel(firstEdge.source) : null,
    firstEdge?.destination ? crossChainAddressLabel(firstEdge.destination) : null,
    lastEdge && lastEdge !== firstEdge && lastEdge.destination ? crossChainAddressLabel(lastEdge.destination) : null
  ].filter((part): part is string => Boolean(part)).join(" -> ");
  const txHashes = [firstEdge?.txHash ?? null, lastEdge && lastEdge !== firstEdge ? lastEdge.txHash : null]
    .filter((txHash): txHash is string => Boolean(txHash))
    .map(shortIdentifier)
    .join("; ");
  const amount = path.selectedAmountRaw ? `; selected ${formatRawUsdt(path.selectedAmountRaw)}` : "";
  const txText = txHashes ? `; tx ${txHashes}` : "";
  return `Top path: ${route || path.id}${amount}${txText}`;
}

function crossChainSkippedLine(skippedReason: string | null): string {
  const normalized = (skippedReason ?? "").toLowerCase();
  if (normalized.includes("threshold") || normalized.includes("manual deep") || normalized.includes("auto-run")) {
    return "Deep cross-chain analysis was not auto-run below threshold";
  }
  return "Deep cross-chain analysis was not auto-run";
}

function crossChainProofText(path: CrossChainCorridorPathForReport): string {
  const proofLevel = path.riskLayer.proofLevel;
  const hardProof = path.terminalBoundary === "sanctioned_service" && proofLevel === "exact_scam_or_taint_proof";
  if (hardProof) return `${proofLevel}; hard proof`;
  if (path.riskLayer.evidenceClass === "source_policy") return `${proofLevel}; source-policy risk, not direct scam proof`;
  if (path.riskLayer.evidenceClass === "data_quality") return `${proofLevel}; provider coverage is incomplete`;
  return proofLevel;
}

function continuationTerminalText(boundary: CrossChainCorridorPathForReport["terminalBoundary"]): string {
  if (boundary === "candidate_only") return "candidate-only";
  if (boundary === "data_exhausted") return "data exhausted";
  return crossChainTerminalBoundaryText(boundary);
}

function continuationLines(path: CrossChainCorridorPathForReport): string[] {
  const continuation = path.continuation;
  if (!continuation?.enabled) return [];

  const topEdge = continuation.edges[0] ?? null;
  const candidateAddress = topEdge?.destination ?? topEdge?.source ?? null;
  const candidateText = candidateAddress
    ? crossChainAddressLabel(candidateAddress)
    : continuation.seed.address
      ? `${continuation.seed.chain}:${shortIdentifier(continuation.seed.address)}`
      : null;
  const evidenceText = topEdge
    ? `${topEdge.continuationEvidenceClass}; score ${topEdge.score}`
    : null;
  const note = continuation.coverageNotes[0] ?? null;
  const reasoning = salientContinuationReasoning(continuation.reasoningTrace)?.message ?? null;

  return [
    [
      "Bridge continuation:",
      continuationTerminalText(continuation.terminalBoundary),
      candidateText ? `candidate ${candidateText}` : null,
      evidenceText
    ].filter((part): part is string => Boolean(part)).join("; "),
    reasoning ? `Continuation reasoning: ${reasoning}` : null,
    note
  ].filter((line): line is string => Boolean(line));
}

function salientContinuationReasoning(
  trace: CrossChainContinuationReasoningStep[] | undefined
): CrossChainContinuationReasoningStep | null {
  if (!trace?.length) return null;

  return trace.find((step) =>
    step.kind === "decision" &&
    step.fromChain &&
    step.toChain &&
    step.fromChain !== step.toChain
  ) ?? trace.find((step) =>
    step.kind === "evidence_gate" &&
    step.message.toLowerCase().includes("accepted")
  ) ?? trace.find((step) =>
    step.kind === "stop_reason"
  ) ?? trace[0] ?? null;
}

function whereCrossChainCorridorLines(report: WhereIsMoneyReport): string[] {
  const corridor = report.crossChainCorridor;
  if (!corridor?.enabled) return [];

  if (!corridor.triggered) {
    return [
      crossChainSkippedLine(corridor.skippedReason),
      corridor.skippedReason ? `Skipped reason: ${corridor.skippedReason}` : null
    ].filter((line): line is string => Boolean(line));
  }

  const topPath = corridor.paths[0] ?? null;
  const partialNote = corridor.partial || topPath?.partial
    ? "Stage 2 was triggered, but provider data is partial"
    : null;
  if (!topPath) {
    return [
      partialNote,
      "Stage 2 was triggered, but no cross-chain corridor path was returned."
    ].filter((line): line is string => Boolean(line));
  }

  const terminal = crossChainTerminalBoundaryText(topPath.terminalBoundary);
  const proofText = crossChainProofText(topPath);

  return [
    partialNote,
    crossChainTopPathLine(topPath),
    `Terminal boundary: ${terminal}`,
    `Proof level: ${proofText}`,
    ...continuationLines(topPath),
    topPath.reasons[0] ?? null,
    topPath.warnings[0] ?? null
  ].filter((line): line is string => Boolean(line));
}

function whereResultTitle(status: "completed" | "partial", locale: BotLocale): string {
  if (locale === "en") return `Where is money — ${status}`;
  return `Откуда деньги — результат: ${status === "partial" ? "частично" : "готово"}`;
}


export function formatWhereIsMoneyReport(
  job: ForensicCheckJob,
  report: WhereIsMoneyReport,
  status: "completed" | "partial",
  options: { runtimeLabel?: string; locale?: BotLocale; showBetaDiagnostics?: boolean } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? normalizeBotLocale(job.progressJson.locale);
  report = {
    ...report,
    decisionReasons: report.decisionReasons.map((reason) => normalizeNotificationReason(reason, locale)),
    coverage: {
      ...report.coverage,
      notes: report.coverage.notes.map((note) => normalizeNotificationReason(note, locale))
    }
  };
  void status;
  return formatUnifiedAddressFinalReport({
    address: report.subjectAddress,
    whereReport: report,
    locale,
    runtimeLabel: options.runtimeLabel,
    showBetaDiagnostics: options.showBetaDiagnostics
  });
}

function formatRuntimeStatus(config: AppConfig, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return telegramHtmlMessage([
    bold(locale === "en" ? "Runtime status" : "Статус runtime"),
    `${bold(locale === "en" ? "Instance" : "Инстанс")}: ${code(config.runtimeInstanceLabel ?? "unlabeled")}`,
    `${bold(locale === "en" ? "Mode" : "Режим")}: ${code(config.runtimeInstanceLabel ? "marked" : "default")}`,
    locale === "en"
      ? "Use this line to confirm which runtime answered this Telegram chat."
      : "По этой строке можно понять, какая версия runtime ответила в Telegram."
  ]);
}

function commandText(value: string | undefined): string {
  return (value ?? "").trim();
}

type ParsedManualCheckInput = {
  target: string;
  requestedAmountRaw: string | null;
  amountError: boolean;
};

function parseManualCheckInput(value: string): ParsedManualCheckInput {
  const parts = value.trim().split(/\s+/).filter((part) => part.length > 0);
  const [target = "", amount] = parts;
  const requestedAmountRaw = parseUsdtAmountToRaw(amount);
  return {
    target,
    requestedAmountRaw,
    amountError: parts.length > 2 || (amount !== undefined && !requestedAmountRaw)
  };
}

function invalidCheckAmountMessage(locale: BotLocale): string {
  return locale === "en"
    ? "Could not read the amount. Use: /check <TRON-address-or-tx-hash> 5000"
    : "Не распознал сумму. Напишите: /check <TRON-адрес или tx-hash> 5000";
}

function checkUsageMessage(locale: BotLocale): string {
  return locale === "en"
    ? "Use: /check <TRON-address-or-tx-hash>"
    : "Напишите: /check <TRON-адрес или tx-hash>";
}

function removeWalletUsageMessage(locale: BotLocale): string {
  return locale === "en"
    ? "Use: /remove_wallet <TRON-address>"
    : "Напишите: /remove_wallet <TRON-адрес>";
}

function walletModeUsageMessage(locale: BotLocale): string {
  return locale === "en"
    ? "Use: /wallet_mode <TRON-address> <realtime|risk_only|digest|paused> [minutes]"
    : "Напишите: /wallet_mode <TRON-адрес> <realtime|risk_only|digest|paused> [minutes]";
}

function walletModeDigestOnlyMessage(locale: BotLocale): string {
  return locale === "en"
    ? "Digest interval can only be set for digest mode."
    : "Интервал можно указать только для режима digest.";
}

function walletModeDigestIntervalMessage(locale: BotLocale): string {
  return locale === "en"
    ? "Digest interval must be between 5 and 60 minutes."
    : "Интервал сводки должен быть от 5 до 60 минут.";
}

function parseAlertMode(value: string | undefined): CustomerAlertMode | null {
  if (!value) return "suspicious_only";
  if (value === "suspicious") return "suspicious_only";
  if (value === "all" || value === "suspicious_only") return value;
  return null;
}

function parseAlertAdminInput(
  text: string,
  ownerTelegramUserId: string,
  defaultMode: CustomerAlertMode = "suspicious_only"
): { recipientTelegramUserId: string; alertMode: CustomerAlertMode } | { error: string } {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  const recipientTelegramUserId = parts[0] ?? "";
  const alertMode = parseAlertMode(parts[1]) ?? (parts[1] ? null : defaultMode);

  if (parts.length === 0 || parts.length > 2 || !telegramIdPattern.test(recipientTelegramUserId) || !alertMode) {
    return { error: "Send a numeric Telegram ID, optionally followed by all or suspicious_only." };
  }

  if (recipientTelegramUserId === ownerTelegramUserId) {
    return { error: "You already receive owner alerts. Add a different Telegram ID." };
  }

  return { recipientTelegramUserId, alertMode };
}

function parseAlertAdminRemoveInput(text: string, ownerTelegramUserId: string): { recipientTelegramUserId: string } | { error: string } {
  const recipientTelegramUserId = text.trim();
  if (!telegramIdPattern.test(recipientTelegramUserId)) {
    return { error: "Send a numeric Telegram ID." };
  }

  if (recipientTelegramUserId === ownerTelegramUserId) {
    return { error: "The wallet owner cannot be removed from owner alerts." };
  }

  return { recipientTelegramUserId };
}

function parseWalletModeInput(
  text: string,
  locale: BotLocale = DEFAULT_BOT_LOCALE
):
  | { address: string; alertMode: WalletAlertMode; digestIntervalMinutes: number }
  | { error: string } {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  const input = classifyInput(parts[0] ?? "");
  const alertMode = parts[1] as WalletAlertMode | undefined;

  if (parts.length < 2 || parts.length > 3 || input.kind !== "tron_address" || !alertMode || !allowedWalletAlertModes.has(alertMode)) {
    return { error: walletModeUsageMessage(locale) };
  }

  if (alertMode !== "digest" && parts[2]) {
    return { error: walletModeDigestOnlyMessage(locale) };
  }

  const digestIntervalMinutes = alertMode === "digest" ? Number(parts[2] ?? "10") : 10;
  if (!Number.isSafeInteger(digestIntervalMinutes) || digestIntervalMinutes < 5 || digestIntervalMinutes > 60) {
    return { error: walletModeDigestIntervalMessage(locale) };
  }

  return { address: input.value, alertMode, digestIntervalMinutes };
}

async function replyOrEdit(ctx: Context, message: BotMessage, keyboard?: InlineKeyboard): Promise<void> {
  const text = messageText(message);
  const options = messageOptions(message, keyboard);
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, options);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const normalizedMessage = message.toLowerCase();
      if (normalizedMessage.includes("message is not modified")) {
        return;
      }
      if (
        !normalizedMessage.includes("message to edit not found") &&
        !normalizedMessage.includes("message can't be edited") &&
        !normalizedMessage.includes("message cannot be edited")
      ) {
        throw error;
      }
      await ctx.reply(text, options);
      return;
    }
  }
  await ctx.reply(text, options);
}

async function ensureTelegramUser(ctx: Context, db: Db): Promise<string> {
  const id = telegramId(ctx);
  await upsertTelegramUser(db, {
    telegramUserId: id,
    username: ctx.from?.username ?? null
  });
  return id;
}

async function getBotLocale(db: Db, telegramUserId: string): Promise<BotLocale> {
  try {
    return await getTelegramUserLocale(db, telegramUserId);
  } catch {
    return DEFAULT_BOT_LOCALE;
  }
}

async function ensureTelegramUserContext(ctx: Context, db: Db): Promise<{ id: string; locale: BotLocale }> {
  const id = await ensureTelegramUser(ctx, db);
  return { id, locale: await getBotLocale(db, id) };
}

async function answerCallbackQuerySafely(ctx: Context): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("query is too old")) return;
    throw error;
  }
}

async function replyWithCheck(
  input: string,
  ctx: { reply(text: string, options?: BotSendOptions): Promise<unknown>; chat?: { id: number | string } },
  tronClient: TronClient,
  db: Db,
  getAddressRiskSignalsForAddress?: (address: string) => Promise<ManualRiskSignals>,
  options: {
    telegramUserId?: string | null;
    queueWhereIsMoneyJob?: CreateBotOptions["queueWhereIsMoneyJob"];
    queueDeepForensicJob?: CreateBotOptions["queueDeepForensicJob"];
    saveAddressFastCheckJob?: CreateBotOptions["saveAddressFastCheckJob"];
    checkSmartContractAddress?: CreateBotOptions["checkSmartContractAddress"];
    runtimeLabel?: string;
    locale?: BotLocale;
  } = {}
): Promise<void> {
  const locale = options.locale ?? DEFAULT_BOT_LOCALE;
  const parsedInput = parseManualCheckInput(input);
  const classified = classifyInput(parsedInput.target);
  if ((classified.kind === "tron_address" || classified.kind === "tron_tx") && parsedInput.amountError) {
    await ctx.reply(invalidCheckAmountMessage(locale));
    return;
  }

  if (classified.kind === "tron_address") {
    if (options.checkSmartContractAddress) {
      const smartContractOutcome = normalizeSmartContractCheckOutcome(await options.checkSmartContractAddress({
        address: classified.value,
        telegramUserId: options.telegramUserId ?? null,
        locale
      }).catch((error) => ({
        kind: "unavailable" as const,
        error: error instanceof Error ? error.message : String(error)
      })));
      if (smartContractOutcome.kind === "report") {
        await sendMessage(ctx, formatSmartContractCheckReport(smartContractOutcome.report, { runtimeLabel: options.runtimeLabel, locale }));
        return;
      }
      if (smartContractOutcome.kind === "unavailable") {
        await sendMessage(ctx, formatSmartContractCheckUnavailable(classified.value, {
          runtimeLabel: options.runtimeLabel,
          locale,
          error: smartContractOutcome.error
        }));
        return;
      }
    }

    const result = await checkAddress(classified.value, {
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      getRiskSignalsForAddress: getAddressRiskSignalsForAddress,
      recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation)
    });
    const forensicWindowEnd = new Date();
    const forensicWindowStart = new Date(forensicWindowEnd.getTime() - ADDRESS_PROFILE_HISTORY_MS);
    const queueInput = {
      subjectAddress: classified.value,
      chatId: ctx.chat?.id === undefined ? null : String(ctx.chat.id),
      requestedBy: options.telegramUserId ?? null,
      requestedAmountRaw: parsedInput.requestedAmountRaw,
      windowStart: forensicWindowStart,
      windowEnd: forensicWindowEnd,
      fastRiskSnapshot: {
        score: result.report.score,
        level: result.report.level,
        reasons: result.report.reasons
      },
      locale
    };
    const [whereJobResult, deepJobResult] = await Promise.allSettled([
      options.queueWhereIsMoneyJob?.({ ...queueInput, mode: "wallet_profile" }) ?? Promise.resolve(null),
      options.queueDeepForensicJob?.(queueInput) ?? Promise.resolve(null)
    ]);
    const whereIsMoneyJob = whereJobResult.status === "fulfilled" ? whereJobResult.value : null;
    const deepJob = deepJobResult.status === "fulfilled" ? deepJobResult.value : null;
    const resultWindowStart = forensicWindowStart.toISOString();
    const resultWindowEnd = forensicWindowEnd.toISOString();
    await options.saveAddressFastCheckJob?.({
      subjectAddress: result.subjectAddress,
      status: result.missingChecks.length > 0 ? "partial" : "completed",
      windowStart: forensicWindowStart,
      windowEnd: forensicWindowEnd,
      chatId: queueInput.chatId,
      requestedBy: queueInput.requestedBy,
      progressJson: {
        locale,
        fastRiskSnapshot: queueInput.fastRiskSnapshot,
        ...(parsedInput.requestedAmountRaw ? { requestedAmountRaw: parsedInput.requestedAmountRaw } : {})
      },
      resultJson: {
        subjectAddress: result.subjectAddress,
        windowStart: resultWindowStart,
        windowEnd: resultWindowEnd,
        fastRiskReport: result.report,
        fastCounterpartyTopsProfile: result.fastCounterpartyTopsProfile ?? {
          subjectAddress: result.subjectAddress,
          windowStart: resultWindowStart,
          windowEnd: resultWindowEnd,
          incomingVolumeRaw: "0",
          outgoingVolumeRaw: "0",
          incomingTxCount: 0,
          outgoingTxCount: 0,
          topIncomingCounterparties: [],
          topOutgoingCounterparties: [],
          topServiceCounterparties: [],
          categoryBreakdown: []
        },
        missingChecks: result.missingChecks,
        followUpJobs: {
          whereIsMoneyJobId: whereIsMoneyJob?.id ?? null,
          deepJobId: deepJob?.id ?? null
        }
      },
      rawEvidenceIds: result.rawEvidence.map((evidence) => evidence.id),
      observationIds: result.observations.map((observation) => observation.id),
      lastError: null
    }).catch((error) => {
      console.error("Address fast check admin job save failed", error);
      return null;
    });
    await sendMessage(
      ctx,
      formatAddressCheckStarted(result, { whereIsMoneyJob, deepJob, runtimeLabel: options.runtimeLabel, locale }),
      addressCheckResultKeyboard(classified.value, locale)
    );
    return;
  }

  if (classified.kind === "tron_tx") {
    try {
      let transactionInfo: unknown;
      let transactionInfoLoaded = false;
      const getTransactionInfo = async () => {
        if (!transactionInfoLoaded) {
          transactionInfo = await tronClient.getTransaction(classified.value);
          transactionInfoLoaded = true;
        }
        return transactionInfo;
      };
      const whereIsMoneyJob = await runTransactionOriginCheck<ForensicCheckJob | null>({
        txHash: classified.value,
        loadTransfer: async (txHash) => {
          const raw = txHash === classified.value ? await getTransactionInfo() : await tronClient.getTransaction(txHash);
          const seed = extractUsdtTransferSeedFromTransaction(txHash, raw);
          if (!seed) throw new Error(`Could not extract an official TRC20 USDT transfer seed from transaction: ${txHash}`);
          return seed;
        },
        runWhereCore: async (args) => {
          const seedTimestamp = new Date(args.seedTransfers[0]?.timestamp ?? "");
          const windowEnd = Number.isNaN(seedTimestamp.getTime()) ? undefined : seedTimestamp;
          const windowStart = windowEnd ? new Date(windowEnd.getTime() - TRANSACTION_ORIGIN_HISTORY_MS) : undefined;
          return options.queueWhereIsMoneyJob?.({
            subjectAddress: args.subjectAddress,
            chatId: ctx.chat?.id === undefined ? null : String(ctx.chat.id),
            requestedBy: options.telegramUserId ?? null,
            mode: args.mode,
            requestedAmountRaw: args.requestedAmountRaw,
            seedTransfers: args.seedTransfers,
            windowStart,
            windowEnd,
            locale
          }) ?? null;
        }
      }).catch(() => null);
      const transactionDisplay = extractUsdtTransferDisplayContext(classified.value, await getTransactionInfo());
      const result = await checkTransactionHash(classified.value, {
        tronClient: {
          ...tronClient,
          getTransaction: getTransactionInfo
        },
        getLabelsForAddress: (address) => listAddressLabels(db, address),
        recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation)
      });
      await sendMessage(ctx, formatManualReport(result, {
        whereIsMoneyJob,
        transactionOriginRecipientAddress: whereIsMoneyJob?.subjectAddress ?? null,
        transactionDisplay,
        runtimeLabel: options.runtimeLabel,
        locale
      }));
    } catch (error) {
      console.error("Manual transaction check failed", error);
      await ctx.reply(locale === "en" ? "Could not find a TRC20 USDT sender in this transaction." : "Не нашёл отправителя USDT в этой транзакции.");
    }
    return;
  }

  await ctx.reply(checkUsageMessage(locale));
}

function pendingCheckStartedMessage(kind: "address" | "tx", locale: BotLocale): string {
  if (locale === "en") {
    return kind === "address"
      ? "Address check started. I will send the result here. The address will not be added to monitoring."
      : "Tx check started. I will send the result here.";
  }

  return kind === "address"
    ? "Проверка адреса запущена. Результат пришлю сюда. Адрес не будет добавлен в мониторинг."
    : "Проверка tx запущена. Результат пришлю сюда.";
}

function pendingCheckFailedMessage(locale: BotLocale): string {
  return locale === "en"
    ? "Check did not finish because the data provider did not answer. Try again later."
    : "Проверка не завершилась: провайдер данных не ответил. Попробуйте позже.";
}

async function startPendingCheckInBackground(
  input: string,
  kind: "address" | "tx",
  ctx: Context,
  tronClient: TronClient,
  db: Db,
  getAddressRiskSignalsForAddress: ((address: string) => Promise<ManualRiskSignals>) | undefined,
  options: {
    telegramUserId: string;
    queueWhereIsMoneyJob?: CreateBotOptions["queueWhereIsMoneyJob"];
    queueDeepForensicJob?: CreateBotOptions["queueDeepForensicJob"];
    saveAddressFastCheckJob?: CreateBotOptions["saveAddressFastCheckJob"];
    checkSmartContractAddress?: CreateBotOptions["checkSmartContractAddress"];
    runtimeLabel?: string;
    locale: BotLocale;
  }
): Promise<void> {
  const locale = options.locale;
  await ctx.reply(pendingCheckStartedMessage(kind, locale));

  const replyTarget = {
    chat: ctx.chat,
    reply: (text: string, sendOptions?: BotSendOptions) => ctx.reply(text, sendOptions)
  };

  void replyWithCheck(input, replyTarget, tronClient, db, getAddressRiskSignalsForAddress, options).catch(async (error) => {
    console.error("Pending manual check failed", error);
    try {
      await ctx.reply(pendingCheckFailedMessage(locale), { reply_markup: mainMenuKeyboard(locale) });
    } catch (deliveryError) {
      console.error("Pending manual check failure delivery failed", deliveryError);
    }
  });
}

async function getOwnedWallet(db: Db, telegramUserId: string, walletId: string): Promise<WatchedWallet | null> {
  const wallets = await listWatchedWallets(db, telegramUserId);
  return wallets.find((wallet) => wallet.id === walletId) ?? null;
}

async function getOwnedTheftReport(db: Db, telegramUserId: string, reportId: string): Promise<TheftReport | null> {
  const report = await getTheftReport(db, reportId);
  return report && report.telegramUserId === telegramUserId ? report : null;
}

async function showTheftReportMissing(ctx: Context, db: Db, telegramUserId: string, locale: BotLocale): Promise<void> {
  await clearTelegramUserPendingAction(db, telegramUserId);
  await replyOrEdit(ctx, locale === "en" ? "Theft report not found or expired." : "Заявка не найдена или устарела.", mainMenuKeyboard(locale));
}

async function createOrUpdateTheftReportFromTx(
  ctx: Context,
  config: AppConfig,
  db: Db,
  tronClient: TronClient,
  telegramUserId: string,
  txHash: string,
  reportId: string | null,
  locale: BotLocale
): Promise<void> {
  let transfer;
  try {
    transfer = await loadTheftReportTransfer(txHash, tronClient);
  } catch {
    await sendMessage(ctx, theftReportTxParseFailedMessage(locale), cancelKeyboard(locale));
    return;
  }

  const report = await upsertTheftReportDraft(db, {
    id: reportId ?? undefined,
    telegramUserId,
    txHash: transfer.txHash,
    victimAddress: transfer.sender,
    reportedScamAddress: transfer.receiver,
    amountRaw: transfer.amountRaw,
    amountUsdt: transfer.amountUsdt,
    depositAddress: config.theftReportDepositAddress,
    depositAmountUsdt: config.theftReportDepositAmountUsdt
  });
  if (!report) {
    await showTheftReportMissing(ctx, db, telegramUserId, locale);
    return;
  }
  await clearTelegramUserPendingAction(db, telegramUserId);
  await sendMessage(ctx, theftReportCardMessage(report, locale), theftReportCardKeyboard(report.id, locale));
}

async function buildWalletDashboard(
  config: AppConfig,
  db: Db,
  tronClient: TronDashboardClient,
  wallet: WatchedWallet,
  forceRefresh = false
) {
  return getWalletDashboard(
    {
      tronClient,
      config,
      getSnapshot: (watchedWalletId) => getWalletDashboardSnapshot(db, watchedWalletId),
      upsertSnapshot: (snapshot) => upsertWalletDashboardSnapshot(db, snapshot),
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      getPollState: (watchedWalletId) => getWalletPollState(db, watchedWalletId),
      getApprovalSummary: (watchedWalletId) => getWalletApprovalSummary(db, watchedWalletId)
    },
    { wallet, forceRefresh }
  );
}

async function showWalletDashboard(
  ctx: Context,
  config: AppConfig,
  db: Db,
  tronClient: TronDashboardClient,
  wallet: WatchedWallet,
  locale: BotLocale = DEFAULT_BOT_LOCALE,
  forceRefresh = false
): Promise<void> {
  const dashboard = await buildWalletDashboard(config, db, tronClient, wallet, forceRefresh);
  await replyOrEdit(ctx, dashboardMessage(dashboard, new Date(), locale), walletDashboardKeyboard(wallet.id, locale));
}

async function showWalletList(ctx: Context, db: Db, telegramUserId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): Promise<void> {
  const wallets = await listWatchedWallets(db, telegramUserId);
  await replyOrEdit(ctx, walletsMessage(wallets.length, locale), walletsKeyboard(wallets, locale));
}

async function showSettings(ctx: Context, db: Db, telegramUserId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): Promise<void> {
  const recipients = await listCustomerAlertRecipients(db, telegramUserId);
  await replyOrEdit(ctx, settingsMessage(recipients, locale), settingsKeyboard(locale));
}

async function showProfile(ctx: Context, db: Db, telegramUserId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): Promise<void> {
  const wallets = await listWatchedWallets(db, telegramUserId);
  await replyOrEdit(
    ctx,
    profileMessage({
      telegramUserId,
      username: ctx.from?.username ?? null,
      walletCount: wallets.length,
      locale
    }),
    profileKeyboard(locale)
  );
}

async function showAlertAdmins(ctx: Context, db: Db, telegramUserId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): Promise<void> {
  const recipients = await listCustomerAlertRecipients(db, telegramUserId);
  await replyOrEdit(ctx, alertAdminsMessage(recipients, locale), alertAdminsKeyboard(recipients, locale));
}

async function customerAlertRecipientExists(db: Db, ownerTelegramUserId: string, recipientTelegramUserId: string): Promise<boolean> {
  const recipients = await listCustomerAlertRecipients(db, ownerTelegramUserId);
  return recipients.some((recipient) => recipient.recipientTelegramUserId === recipientTelegramUserId);
}

async function addAlertAdminAndShow(
  ctx: Context,
  db: Db,
  ownerTelegramUserId: string,
  text: string,
  defaultMode: CustomerAlertMode = "suspicious_only",
  options: { requireExisting?: boolean; locale?: BotLocale } = {}
): Promise<void> {
  const locale = options.locale ?? DEFAULT_BOT_LOCALE;
  const input = parseAlertAdminInput(text, ownerTelegramUserId, defaultMode);
  if ("error" in input) {
    await setTelegramUserPendingAction(db, { telegramUserId: ownerTelegramUserId, pendingAction: "add_alert_admin" });
    await ctx.reply(input.error, { reply_markup: cancelKeyboard(locale) });
    return;
  }

  if (options.requireExisting && !(await customerAlertRecipientExists(db, ownerTelegramUserId, input.recipientTelegramUserId))) {
    await clearTelegramUserPendingAction(db, ownerTelegramUserId);
    await sendMessage(
      ctx,
      alertAdminNotFoundMessage(input.recipientTelegramUserId, locale),
      alertAdminsKeyboard(await listCustomerAlertRecipients(db, ownerTelegramUserId), locale)
    );
    return;
  }

  await addCustomerAlertRecipient(db, {
    ownerTelegramUserId,
    recipientTelegramUserId: input.recipientTelegramUserId,
    alertMode: input.alertMode
  });
  await clearTelegramUserPendingAction(db, ownerTelegramUserId);
  const recipients = await listCustomerAlertRecipients(db, ownerTelegramUserId);
  await sendMessage(
    ctx,
    combineMessages([
      alertAdminAddedMessage({ telegramUserId: input.recipientTelegramUserId, mode: input.alertMode }, locale),
      alertAdminsMessage(recipients, locale)
    ]),
    alertAdminsKeyboard(recipients, locale)
  );
}

async function removeAlertAdminAndShow(
  ctx: Context,
  db: Db,
  ownerTelegramUserId: string,
  text: string,
  locale: BotLocale = DEFAULT_BOT_LOCALE
): Promise<void> {
  const input = parseAlertAdminRemoveInput(text, ownerTelegramUserId);
  if ("error" in input) {
    await setTelegramUserPendingAction(db, { telegramUserId: ownerTelegramUserId, pendingAction: "remove_alert_admin" });
    await ctx.reply(input.error, { reply_markup: cancelKeyboard(locale) });
    return;
  }

  const removed = await removeCustomerAlertRecipient(db, {
    ownerTelegramUserId,
    recipientTelegramUserId: input.recipientTelegramUserId
  });
  await clearTelegramUserPendingAction(db, ownerTelegramUserId);
  const recipients = await listCustomerAlertRecipients(db, ownerTelegramUserId);
  await sendMessage(
    ctx,
    combineMessages([
      removed ? alertAdminRemovedMessage(input.recipientTelegramUserId, locale) : alertAdminNotFoundMessage(input.recipientTelegramUserId, locale),
      alertAdminsMessage(recipients, locale)
    ]),
    alertAdminsKeyboard(recipients, locale)
  );
}

async function addWalletAndShowDashboard(
  ctx: Context,
  config: AppConfig,
  db: Db,
  tronClient: TronDashboardClient,
  telegramUserId: string,
  address: string,
  locale: BotLocale = DEFAULT_BOT_LOCALE
): Promise<void> {
  const wallet = await addWatchedWallet(db, { telegramUserId, address });
  await clearTelegramUserPendingAction(db, telegramUserId);
  await showWalletDashboard(ctx, config, db, tronClient, wallet, locale);
}

export function createBot(
  config: AppConfig,
  db: Db,
  tronClient: TronDashboardClient & Partial<TronApprovalClient>,
  options: CreateBotOptions = {}
): Bot {
  const bot = new Bot(config.botToken);
  const getAddressRiskSignalsForAddress = options.getAddressRiskSignalsForAddress ?? createAddressExposureRiskSignalProvider({
    tronClient,
    getAddressMetadata: (address, now) => getAddressMetadata(db, address, now),
    upsertAddressMetadata: (metadata) => upsertAddressMetadata(db, metadata),
    getContractIntelligenceProfile: (address, now) => getContractIntelligenceProfile(db, address, now),
    upsertContractIntelligenceProfile: (profile) => upsertContractIntelligenceProfile(db, profile)
  }, {
    pageLimit: config.tronscanPageLimit
  });
  const createQueuedAddressJob = (
    input: QueueAddressForensicJobInput,
    kind: "address_deep_check" | "where_is_money_check",
    priority: number
  ) => {
    const windowEnd = input.windowEnd ?? new Date();
    const fallbackHistoryMs = input.mode === "transaction_check" ? TRANSACTION_ORIGIN_HISTORY_MS : ADDRESS_PROFILE_HISTORY_MS;
    const windowStart = input.windowStart ?? new Date(windowEnd.getTime() - fallbackHistoryMs);
    return createOrReuseForensicCheckJob(db, {
      kind,
      subjectAddress: input.subjectAddress,
      windowStart,
      windowEnd,
      chatId: input.chatId,
      requestedBy: input.requestedBy,
      priority,
      progressJson: {
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.fastRiskSnapshot ? { fastRiskSnapshot: input.fastRiskSnapshot } : {}),
        ...(input.requestedAmountRaw ? { requestedAmountRaw: input.requestedAmountRaw } : {}),
        ...(input.seedTransfers ? { seedTransfers: input.seedTransfers } : {}),
        ...(input.crossChainManualDeepMode ? { crossChainManualDeepMode: true } : {}),
        locale: input.locale ?? DEFAULT_BOT_LOCALE
      }
    });
  };
  const queueWhereIsMoneyJob = options.queueWhereIsMoneyJob ?? ((input: QueueAddressForensicJobInput) =>
    createQueuedAddressJob(input, "where_is_money_check", 120)
  );
  const queueDeepForensicJob = options.queueDeepForensicJob ?? ((input: QueueAddressForensicJobInput) =>
    createQueuedAddressJob(input, "address_deep_check", 100)
  );
  const saveAddressFastCheckJob = options.saveAddressFastCheckJob ?? ((input: AddressFastCheckJobInput) =>
    saveAddressFastCheckJobRecord(db, input)
  );
  const checkSmartContractAddress = options.checkSmartContractAddress;
  const resolveForensicCheckJob = options.getForensicCheckJob ?? ((id: string) => getForensicCheckJob(db, id));

  bot.catch((error) => {
    console.error("Telegram bot update failed", error.error);
  });

  bot.command("start", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    const wallets = await listWatchedWallets(db, id);
    await sendMessage(ctx, homeMessage(wallets.length, locale), mainMenuKeyboard(locale));
  });

  bot.command("help", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await sendMessage(ctx, helpMessage(locale), mainMenuKeyboard(locale));
  });

  bot.command("settings", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showSettings(ctx, db, id, locale);
  });

  bot.command("language", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await sendMessage(
      ctx,
      telegramHtmlMessage([
        bold(locale === "en" ? "Language" : "Язык"),
        `${locale === "en" ? "Current" : "Сейчас"}: ${escapeHtml(languageName(locale))}`
      ]),
      settingsKeyboard(locale)
    );
  });

  bot.command("profile", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showProfile(ctx, db, id, locale);
  });

  bot.command("my_id", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await sendMessage(ctx, myIdMessage({ telegramUserId: id, username: ctx.from?.username ?? null }, locale), mainMenuKeyboard(locale));
  });

  bot.command("alert_admins", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showAlertAdmins(ctx, db, id, locale);
  });

  bot.command("alert_recipients", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showAlertAdmins(ctx, db, id, locale);
  });

  bot.command("add_alert_admin", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    const input = commandText(ctx.match);
    if (!input) {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "add_alert_admin" });
      await sendMessage(ctx, addAlertAdminPrompt("suspicious_only", locale), cancelKeyboard(locale));
      return;
    }
    await addAlertAdminAndShow(ctx, db, id, input, "suspicious_only", { locale });
  });

  bot.command("alert_add", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    const input = commandText(ctx.match);
    if (!input) {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "add_alert_admin" });
      await sendMessage(ctx, addAlertAdminPrompt("suspicious_only", locale), cancelKeyboard(locale));
      return;
    }
    await addAlertAdminAndShow(ctx, db, id, input, "suspicious_only", { locale });
  });

  bot.command("remove_alert_admin", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    const input = commandText(ctx.match);
    if (!input) {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "remove_alert_admin" });
      await sendMessage(ctx, removeAlertAdminPrompt(locale), cancelKeyboard(locale));
      return;
    }
    await removeAlertAdminAndShow(ctx, db, id, input, locale);
  });

  bot.command("alert_remove", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    const input = commandText(ctx.match);
    if (!input) {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "remove_alert_admin" });
      await sendMessage(ctx, removeAlertAdminPrompt(locale), cancelKeyboard(locale));
      return;
    }
    await removeAlertAdminAndShow(ctx, db, id, input, locale);
  });

  bot.command("alert_mode", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    const input = commandText(ctx.match);
    const parts = input.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length !== 2) {
      await clearTelegramUserPendingAction(db, id);
      await ctx.reply("Usage: /alert_mode <telegram-id> <suspicious|suspicious_only|all>", { reply_markup: alertAdminsKeyboard(await listCustomerAlertRecipients(db, id), locale) });
      return;
    }
    await addAlertAdminAndShow(ctx, db, id, input, "suspicious_only", { requireExisting: true, locale });
  });

  bot.command("wallet_mode", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    const input = parseWalletModeInput(commandText(ctx.match), locale);
    if ("error" in input) {
      await ctx.reply(input.error);
      return;
    }

    const wallets = await listWatchedWallets(db, id);
    const wallet = wallets.find((item) => item.address === input.address);
    if (!wallet) {
      await ctx.reply(locale === "en" ? `Wallet not found: ${input.address}` : `Кошелёк не найден: ${input.address}`, { reply_markup: mainMenuKeyboard(locale) });
      return;
    }

    await updateWatchedWalletAlertMode(db, {
      telegramUserId: id,
      address: input.address,
      alertMode: input.alertMode,
      digestIntervalMinutes: input.digestIntervalMinutes
    });
    const updatedWallet = {
      ...wallet,
      alertMode: input.alertMode,
      digestIntervalMinutes: input.digestIntervalMinutes
    };
    await sendMessage(ctx, walletAlertModeUpdatedMessage(updatedWallet, locale), walletAlertModeKeyboard(updatedWallet, locale));
  });

  bot.command("add_wallet", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    const input = classifyInput(commandText(ctx.match));

    if (input.kind !== "tron_address") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "add_wallet" });
      await sendMessage(ctx, addWalletPrompt(locale), cancelKeyboard(locale));
      return;
    }

    await addWalletAndShowDashboard(ctx, config, db, tronClient, id, input.value, locale);
  });

  bot.command("wallets", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showWalletList(ctx, db, id, locale);
  });

  bot.command("remove_wallet", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    const input = classifyInput(commandText(ctx.match));
    if (input.kind !== "tron_address") {
      await ctx.reply(removeWalletUsageMessage(locale));
      return;
    }

    const removed = await removeWatchedWallet(db, { telegramUserId: id, address: input.value });
    await ctx.reply(removed
      ? (locale === "en" ? `Removed wallet: ${input.value}` : `Кошелёк удалён: ${input.value}`)
      : (locale === "en" ? `Wallet not found: ${input.value}` : `Кошелёк не найден: ${input.value}`), {
      reply_markup: mainMenuKeyboard(locale)
    });
  });

  bot.command("check", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await replyWithCheck(commandText(ctx.match), ctx, tronClient, db, getAddressRiskSignalsForAddress, {
      telegramUserId: id,
      checkSmartContractAddress,
      queueWhereIsMoneyJob,
      queueDeepForensicJob,
      saveAddressFastCheckJob,
      runtimeLabel: config.runtimeInstanceLabel,
      locale
    });
  });

  bot.command("version", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await sendMessage(ctx, formatRuntimeStatus(config, locale));
  });

  bot.command("check_status", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    const jobId = commandText(ctx.match);
    if (!jobId) {
      await ctx.reply(locale === "en" ? "Usage: /check_status <deep-job-id>" : "Использование: /check_status <deep-job-id>");
      return;
    }
    const job = await resolveForensicCheckJob(jobId);
    const whereReport = job?.kind === "where_is_money_check"
      ? extractWhereIsMoneyReportFromJob(job, job.subjectAddress)
      : null;
    if (job?.kind === "where_is_money_check" && whereReport) {
      await sendMessage(ctx, formatWhereIsMoneySupportReport(job, whereReport, job.status === "partial" ? "partial" : "completed", {
        runtimeLabel: config.runtimeInstanceLabel,
        locale
      }));
      return;
    }
    await sendMessage(ctx, formatForensicJobStatus(job, { runtimeLabel: config.runtimeInstanceLabel, locale }));
  });

  bot.command("labels", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }
    await ctx.reply(ALLOWED_LABELS.map((label) => `- ${label}`).join("\n"));
  });

  bot.command("admin_users", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }
    const adminIds = [...config.serviceAdminTelegramIds].sort();
    await ctx.reply(adminIds.length ? adminIds.map((adminId) => `- ${adminId}`).join("\n") : "No service admins configured.");
  });

  bot.command("mark", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }

    const args = commandText(ctx.match).split(/\s+/).filter((part) => part.length > 0);
    const [rawAddress, rawLabel] = args;
    const input = classifyInput(rawAddress ?? "");
    const label = rawLabel as RiskLabel;
    if (args.length !== 2 || input.kind !== "tron_address" || !allowedLabelSet.has(label)) {
      await ctx.reply("Usage: /mark <TRON-address> <label>");
      return;
    }

    await saveAddressLabel(db, {
      address: input.value,
      label,
      source: "service_admin",
      createdByTelegramId: id
    });
    await ctx.reply(`Marked ${input.value} as ${label}.`);
  });

  bot.command("recheck_safety", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }

    const args = commandText(ctx.match).split(/\s+/).filter((part) => part.length > 0);
    const walletInput = classifyInput(args[0] ?? "");
    if (args.length < 1 || args.length > 2 || walletInput.kind !== "tron_address") {
      await ctx.reply("Usage: /recheck_safety <wallet_address> [spender_or_approval_tx]");
      return;
    }

    const summary = await runSafetyRecheck({
      db,
      tronClient: tronClient as TronApprovalClient,
      walletAddress: walletInput.value,
      target: parseSafetyRecheckTarget(args[1]),
      pageLimit: config.tronscanPageLimit,
      maxPagesPerWallet: config.tronscanMaxPagesPerWallet
    });
    await ctx.reply(formatSafetyRecheckSummary(summary));
  });

  bot.on("callback_query:data", async (ctx) => {
    const id = telegramId(ctx);
    await answerCallbackQuerySafely(ctx);
    await upsertTelegramUser(db, {
      telegramUserId: id,
      username: ctx.from?.username ?? null
    });
    let locale = await getBotLocale(db, id);

    const callback = parseCallbackData(ctx.callbackQuery.data);
    if (!callback) {
      await replyOrEdit(ctx, locale === "en" ? "Unknown action." : "Неизвестное действие.", mainMenuKeyboard(locale));
      return;
    }

    if (callback.kind === "home") {
      await clearTelegramUserPendingAction(db, id);
      const wallets = await listWatchedWallets(db, id);
      await replyOrEdit(ctx, homeMessage(wallets.length, locale), mainMenuKeyboard(locale));
      return;
    }

    if (callback.kind === "help") {
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, helpMessage(locale), mainMenuKeyboard(locale));
      return;
    }

    if (callback.kind === "profile") {
      await clearTelegramUserPendingAction(db, id);
      await showProfile(ctx, db, id, locale);
      return;
    }

    if (callback.kind === "risk_overview") {
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, riskIntelOverviewMessage(locale), mainMenuKeyboard(locale));
      return;
    }

    if (callback.kind === "wallets_list") {
      await clearTelegramUserPendingAction(db, id);
      await showWalletList(ctx, db, id, locale);
      return;
    }

    if (callback.kind === "wallet_add") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "add_wallet" });
      await replyOrEdit(ctx, addWalletPrompt(locale), cancelKeyboard(locale));
      return;
    }

    if (callback.kind === "check_address") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "check_address" });
      await replyOrEdit(ctx, checkAddressPrompt(locale), cancelKeyboard(locale));
      return;
    }

    if (callback.kind === "check_tx") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "check_tx" });
      await replyOrEdit(ctx, checkTxPrompt(locale), cancelKeyboard(locale));
      return;
    }

    if (
      callback.kind === "theft_start" ||
      callback.kind === "theft_confirm" ||
      callback.kind === "theft_change_tx" ||
      callback.kind === "theft_comment" ||
      callback.kind === "theft_cancel" ||
      callback.kind === "theft_deposit_sent" ||
      callback.kind === "theft_guide" ||
      callback.kind === "theft_admin"
    ) {
      if (callback.kind === "theft_start") {
        await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "report_theft_tx" });
        await replyOrEdit(ctx, theftReportTxPrompt(locale), cancelKeyboard(locale));
        return;
      }

      const report = await getOwnedTheftReport(db, id, callback.reportId);
      if (!report) {
        await showTheftReportMissing(ctx, db, id, locale);
        return;
      }

      if (callback.kind === "theft_confirm") {
        const updated = await markTheftReportAwaitingDeposit(db, { id: report.id, telegramUserId: id });
        if (!updated) {
          await showTheftReportMissing(ctx, db, id, locale);
          return;
        }
        await clearTelegramUserPendingAction(db, id);
        await replyOrEdit(ctx, theftReportDepositMessage(updated, locale), theftReportDepositKeyboard(updated.id, locale));
        return;
      }

      if (callback.kind === "theft_change_tx") {
        await setTelegramUserPendingAction(db, {
          telegramUserId: id,
          pendingAction: "report_theft_tx",
          selectedTheftReportId: report.id
        });
        await replyOrEdit(ctx, theftReportTxPrompt(locale), cancelKeyboard(locale));
        return;
      }

      if (callback.kind === "theft_comment") {
        await setTelegramUserPendingAction(db, {
          telegramUserId: id,
          pendingAction: "report_theft_comment",
          selectedTheftReportId: report.id
        });
        await replyOrEdit(
          ctx,
          locale === "en" ? "Send a comment for this theft report." : "Отправьте комментарий для этой заявки.",
          cancelKeyboard(locale)
        );
        return;
      }

      if (callback.kind === "theft_cancel") {
        const cancelled = await cancelTheftReport(db, { id: report.id, telegramUserId: id });
        if (!cancelled) {
          await showTheftReportMissing(ctx, db, id, locale);
          return;
        }
        await clearTelegramUserPendingAction(db, id);
        const wallets = await listWatchedWallets(db, id);
        await replyOrEdit(ctx, homeMessage(wallets.length, locale), mainMenuKeyboard(locale));
        return;
      }

      if (callback.kind === "theft_deposit_sent") {
        const updated = await confirmTheftReportDeposit(db, { id: report.id, telegramUserId: id });
        if (!updated) {
          await showTheftReportMissing(ctx, db, id, locale);
          return;
        }
        await saveAddressLabel(db, {
          address: updated.victimAddress,
          label: "victim",
          source: "system",
          createdByTelegramId: id
        });
        await saveAddressLabel(db, {
          address: updated.reportedScamAddress,
          label: "reported_scam",
          source: "system",
          createdByTelegramId: id
        });
        await clearTelegramUserPendingAction(db, id);
        await replyOrEdit(ctx, theftReportNextStepsMessage(updated, locale), theftReportNextStepsKeyboard(updated.id, locale));
        return;
      }

      if (callback.kind === "theft_guide") {
        await replyOrEdit(ctx, config.theftReportGuideUrl?.toString() ?? theftReportGuideFallbackMessage(locale), theftReportNextStepsKeyboard(report.id, locale));
        return;
      }

      if (callback.kind === "theft_admin") {
        await replyOrEdit(ctx, theftReportAdminContactMessage(report, config.theftReportAdminContact, locale), theftReportNextStepsKeyboard(report.id, locale));
        return;
      }

      return;
    }

    if (callback.kind === "check_address_value") {
      await clearTelegramUserPendingAction(db, id);
      await replyWithCheck(callback.address, ctx, tronClient, db, getAddressRiskSignalsForAddress, {
        telegramUserId: id,
        checkSmartContractAddress,
        queueWhereIsMoneyJob,
        queueDeepForensicJob,
        saveAddressFastCheckJob,
        runtimeLabel: config.runtimeInstanceLabel,
        locale
      });
      return;
    }

    if (callback.kind === "check_cross_bridge") {
      await clearTelegramUserPendingAction(db, id);
      const windowEnd = new Date();
      const windowStart = new Date(windowEnd.getTime() - ADDRESS_PROFILE_HISTORY_MS);
      const job = await queueWhereIsMoneyJob({
        subjectAddress: callback.address,
        chatId: ctx.chat?.id === undefined ? null : String(ctx.chat.id),
        requestedBy: id,
        mode: "wallet_profile",
        windowStart,
        windowEnd,
        crossChainManualDeepMode: true,
        locale
      });
      await sendMessage(ctx, formatCrossBridgeQueued(job, {
        runtimeLabel: config.runtimeInstanceLabel,
        locale
      }));
      return;
    }

    if (callback.kind === "check_deposit_job") {
      await clearTelegramUserPendingAction(db, id);
      await sendMessage(ctx, formatForensicJobStatus(await resolveForensicCheckJob(callback.jobId), {
        runtimeLabel: config.runtimeInstanceLabel,
        locale
      }));
      return;
    }

    if (callback.kind === "settings") {
      await clearTelegramUserPendingAction(db, id);
      await showSettings(ctx, db, id, locale);
      return;
    }

    if (callback.kind === "settings_language") {
      await updateTelegramUserLocale(db, id, callback.locale);
      locale = callback.locale;
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(
        ctx,
        telegramHtmlMessage([
          bold(locale === "en" ? "Language updated" : "Язык обновлен"),
          `${locale === "en" ? "Current language" : "Текущий язык"}: ${escapeHtml(languageName(locale))}`
        ]),
        settingsKeyboard(locale)
      );
      return;
    }

    if (callback.kind === "settings_alerts") {
      await clearTelegramUserPendingAction(db, id);
      await showAlertAdmins(ctx, db, id, locale);
      return;
    }

    if (callback.kind === "settings_add_admin") {
      const pendingAction =
        callback.alertMode === "all"
          ? "add_alert_admin_all"
          : callback.alertMode === "suspicious_only"
            ? "add_alert_admin_suspicious_only"
            : "add_alert_admin";
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction });
      await replyOrEdit(ctx, addAlertAdminPrompt(callback.alertMode ?? "suspicious_only", locale), cancelKeyboard(locale));
      return;
    }

    if (callback.kind === "settings_remove_admin") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "remove_alert_admin" });
      await replyOrEdit(ctx, removeAlertAdminPrompt(locale), cancelKeyboard(locale));
      return;
    }

    if (callback.kind === "settings_remove_admin_value") {
      await removeAlertAdminAndShow(ctx, db, id, callback.recipientTelegramUserId, locale);
      return;
    }

    if (callback.kind === "cancel") {
      await clearTelegramUserPendingAction(db, id);
      const wallets = await listWatchedWallets(db, id);
      await replyOrEdit(ctx, homeMessage(wallets.length, locale), mainMenuKeyboard(locale));
      return;
    }

    const wallet = await getOwnedWallet(db, id, callback.walletId);
    if (!wallet) {
      await replyOrEdit(ctx, locale === "en" ? "Wallet not found." : "Кошелёк не найден.", mainMenuKeyboard(locale));
      return;
    }

    if (callback.kind === "wallet_view") {
      await clearTelegramUserPendingAction(db, id);
      await showWalletDashboard(ctx, config, db, tronClient, wallet, locale);
      return;
    }

    if (callback.kind === "wallet_refresh") {
      await clearTelegramUserPendingAction(db, id);
      await showWalletDashboard(ctx, config, db, tronClient, wallet, locale, true);
      return;
    }

    if (callback.kind === "wallet_analytics") {
      await clearTelegramUserPendingAction(db, id);
      const dashboard = await buildWalletDashboard(config, db, tronClient, wallet);
      await replyOrEdit(ctx, analyticsMessage(dashboard, new Date(), locale), backToWalletKeyboard(wallet.id, locale));
      return;
    }

    if (callback.kind === "wallet_risk") {
      await clearTelegramUserPendingAction(db, id);
      const dashboard = await buildWalletDashboard(config, db, tronClient, wallet);
      await replyOrEdit(ctx, securityMessage(dashboard, locale), backToWalletKeyboard(wallet.id, locale));
      return;
    }

    if (callback.kind === "wallet_safety") {
      await clearTelegramUserPendingAction(db, id);
      const dashboard = await buildWalletDashboard(config, db, tronClient, wallet);
      await replyOrEdit(ctx, safetyMessage(dashboard, locale), walletSafetyKeyboard(wallet, locale));
      return;
    }

    if (callback.kind === "wallet_alert_mode") {
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, walletAlertModeMessage(wallet, locale), walletAlertModeKeyboard(wallet, locale));
      return;
    }

    if (callback.kind === "wallet_alert_mode_set") {
      await clearTelegramUserPendingAction(db, id);
      const digestIntervalMinutes =
        callback.alertMode === "digest" ? callback.digestIntervalMinutes : wallet.digestIntervalMinutes;
      await updateWatchedWalletAlertMode(db, {
        telegramUserId: id,
        address: wallet.address,
        alertMode: callback.alertMode,
        digestIntervalMinutes
      });
      await showWalletDashboard(ctx, config, db, tronClient, {
        ...wallet,
        alertMode: callback.alertMode,
        digestIntervalMinutes
      }, locale);
      return;
    }

    if (callback.kind === "wallet_remove") {
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, removeConfirmMessage(wallet.address, locale), walletRemoveKeyboard(wallet.id, locale));
      return;
    }

    if (callback.kind === "wallet_remove_confirm") {
      await clearTelegramUserPendingAction(db, id);
      await removeWatchedWallet(db, { telegramUserId: id, address: wallet.address });
      await showWalletList(ctx, db, id, locale);
    }
  });

  bot.on("message:text", async (ctx) => {
    const { id, locale } = await ensureTelegramUserContext(ctx, db);
    const text = ctx.message.text.trim();
    const session = await getTelegramUserSession(db, id);

    if (shouldHandlePendingText(session, text)) {
      const input = classifyInput(text);

      if (session.pendingAction === "add_wallet") {
        if (input.kind !== "tron_address") {
          await ctx.reply(locale === "en" ? "Send a valid TRON wallet address." : "Отправьте корректный TRON-адрес кошелька.", { reply_markup: cancelKeyboard(locale) });
          return;
        }
        await addWalletAndShowDashboard(ctx, config, db, tronClient, id, input.value, locale);
        return;
      }

      if (session.pendingAction === "check_address") {
        if (input.kind !== "tron_address") {
          await ctx.reply(locale === "en" ? "Send a valid TRON address." : "Отправьте корректный TRON-адрес.", { reply_markup: cancelKeyboard(locale) });
          return;
        }
        await clearTelegramUserPendingAction(db, id);
        await startPendingCheckInBackground(input.value, "address", ctx, tronClient, db, getAddressRiskSignalsForAddress, {
          telegramUserId: id,
          checkSmartContractAddress,
          queueWhereIsMoneyJob,
          queueDeepForensicJob,
          saveAddressFastCheckJob,
          runtimeLabel: config.runtimeInstanceLabel,
          locale
        });
        return;
      }

      if (session.pendingAction === "check_tx") {
        if (input.kind !== "tron_tx") {
          await ctx.reply(locale === "en" ? "Send a valid TRON transaction hash." : "Отправьте корректный hash транзакции TRON.", { reply_markup: cancelKeyboard(locale) });
          return;
        }
        await clearTelegramUserPendingAction(db, id);
        await startPendingCheckInBackground(input.value, "tx", ctx, tronClient, db, getAddressRiskSignalsForAddress, {
          telegramUserId: id,
          checkSmartContractAddress,
          queueWhereIsMoneyJob,
          queueDeepForensicJob,
          saveAddressFastCheckJob,
          runtimeLabel: config.runtimeInstanceLabel,
          locale
        });
        return;
      }

      if (session.pendingAction === "report_theft_tx") {
        if (input.kind !== "tron_tx") {
          await sendMessage(ctx, theftReportInvalidTxMessage(locale), cancelKeyboard(locale));
          return;
        }
        await createOrUpdateTheftReportFromTx(
          ctx,
          config,
          db,
          tronClient,
          id,
          input.value,
          session.selectedTheftReportId,
          locale
        );
        return;
      }

      if (session.pendingAction === "report_theft_comment") {
        if (!session.selectedTheftReportId) {
          await showTheftReportMissing(ctx, db, id, locale);
          return;
        }
        const report = await updateTheftReportComment(db, {
          id: session.selectedTheftReportId,
          telegramUserId: id,
          comment: text
        });
        if (!report) {
          await showTheftReportMissing(ctx, db, id, locale);
          return;
        }
        await clearTelegramUserPendingAction(db, id);
        await sendMessage(ctx, theftReportCardMessage(report, locale), theftReportCardKeyboard(report.id, locale));
        return;
      }

      if (session.pendingAction === "add_alert_admin") {
        await addAlertAdminAndShow(ctx, db, id, text, "suspicious_only", { locale });
        return;
      }

      if (session.pendingAction === "add_alert_admin_all") {
        await addAlertAdminAndShow(ctx, db, id, text, "all", { locale });
        return;
      }

      if (session.pendingAction === "add_alert_admin_suspicious_only") {
        await addAlertAdminAndShow(ctx, db, id, text, "suspicious_only", { locale });
        return;
      }

      if (session.pendingAction === "remove_alert_admin") {
        await removeAlertAdminAndShow(ctx, db, id, text, locale);
        return;
      }
    }

    const input = classifyInput(text);
    if (input.kind === "tron_address") {
      await addWalletAndShowDashboard(ctx, config, db, tronClient, id, input.value, locale);
      return;
    }

    if (input.kind === "tron_tx") {
      await replyWithCheck(input.value, ctx, tronClient, db, getAddressRiskSignalsForAddress, {
        telegramUserId: id,
        checkSmartContractAddress,
        queueWhereIsMoneyJob,
        queueDeepForensicJob,
        saveAddressFastCheckJob,
        runtimeLabel: config.runtimeInstanceLabel,
        locale
      });
      return;
    }

    await ctx.reply(locale === "en" ? "Send a TRON wallet address to monitor it, or use /check <TRON-address-or-tx-hash>." : "Отправьте TRON-адрес кошелька для мониторинга или используйте /check <TRON-адрес или tx-hash>.", {
      reply_markup: mainMenuKeyboard(locale)
    });
  });

  return bot;
}
