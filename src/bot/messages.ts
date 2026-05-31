import { formatApprovalAllowance } from "../approvals/amounts";
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
import type { CustomerAlertMode, CustomerAlertRecipient, ObservedApprovalDrainEvent, WalletApproval } from "../storage/repositories";
import type { BotLocale, WalletAlertMode, WatchedWallet } from "../types";
import type { WalletDashboard } from "../wallet/dashboard";
import { formatMicroUsdt, formatSunAsTrx } from "../wallet/dashboard";
import { DEFAULT_BOT_LOCALE, customerAlertModeText, languageName, t, walletAlertModeText } from "./i18n";
import { shortAddress } from "./keyboards";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function msg(lines: Array<string | null | undefined>): TelegramHtmlMessage {
  return telegramHtmlMessage(lines);
}

function kv(label: string, value: string): string {
  return `${bold(label)}: ${value}`;
}

function riskBadge(level: WalletDashboard["safety"]["level"], score: number, suffix?: string): string {
  const details = suffix ? `${level}, ${suffix}` : level;
  return `${formatRiskIcon(level)} ${code(`${score}/100`)} (${escapeHtml(details)})`;
}

function formatInteger(value: number | string | null): string {
  if (value === null) return "unknown";
  const text = String(value);
  if (!/^\d+$/.test(text)) return "unknown";
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatDecimal(value: string, minFractionDigits = 2, maxFractionDigits = 2): string {
  const [rawWhole, rawFraction = ""] = value.split(".");
  const whole = (rawWhole.replace(/^0+(?=\d)/, "") || "0").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  let fraction = rawFraction.padEnd(minFractionDigits, "0").slice(0, maxFractionDigits);

  if (maxFractionDigits > minFractionDigits) {
    fraction = fraction.replace(/0+$/, "");
    if (fraction.length < minFractionDigits) fraction = fraction.padEnd(minFractionDigits, "0");
  }

  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

function formatRelativeTime(date: Date | null, now = new Date(), locale: BotLocale = DEFAULT_BOT_LOCALE): string {
  if (!date) return t(locale, "common.never");
  const diff = Math.max(0, now.getTime() - date.getTime());
  if (diff < MS_PER_MINUTE) return t(locale, "common.justNow");
  if (diff < MS_PER_HOUR) return locale === "ru" ? `${Math.floor(diff / MS_PER_MINUTE)} мин назад` : `${Math.floor(diff / MS_PER_MINUTE)} min ago`;
  if (diff < MS_PER_DAY) return locale === "ru" ? `${Math.floor(diff / MS_PER_HOUR)} ч назад` : `${Math.floor(diff / MS_PER_HOUR)} h ago`;
  return locale === "ru" ? `${Math.floor(diff / MS_PER_DAY)} дн назад` : `${Math.floor(diff / MS_PER_DAY)} d ago`;
}

function formatWalletAge(walletCreatedAt: Date | null, now = new Date(), locale: BotLocale = DEFAULT_BOT_LOCALE): string {
  if (!walletCreatedAt) return t(locale, "common.unknown");
  const days = Math.max(0, Math.floor((now.getTime() - walletCreatedAt.getTime()) / MS_PER_DAY));
  if (locale === "ru") return `${days} дн`;
  return days === 1 ? "1 day" : `${days} days`;
}

function formatLastResult(dashboard: WalletDashboard, locale: BotLocale = DEFAULT_BOT_LOCALE): string {
  if (!dashboard.pollState) return t(locale, "common.notCheckedYet");
  if (dashboard.pollState.lastPollError) return t(locale, "common.pollError");
  if (dashboard.pollState.lastPollNewCount > 0) {
    if (locale === "ru") return `${dashboard.pollState.lastPollNewCount} новых переводов`;
    return `${dashboard.pollState.lastPollNewCount} new transfer${dashboard.pollState.lastPollNewCount === 1 ? "" : "s"}`;
  }
  if (dashboard.pollState.lastSuccessfulPollAt) return t(locale, "common.noNewTransfers");
  return t(locale, "common.notCheckedYet");
}

function formatFeeUsd(dashboard: WalletDashboard): string | null {
  if (!dashboard.snapshot.trxUsdPrice) return null;
  const feeTrx = Number(formatSunAsTrx(dashboard.snapshot.thirtyDayFeeSun));
  const trxUsd = Number(dashboard.snapshot.trxUsdPrice);
  if (!Number.isFinite(feeTrx) || !Number.isFinite(trxUsd)) return null;
  return formatDecimal((feeTrx * trxUsd).toFixed(2), 2, 2);
}

function shouldShowEnergyHint(dashboard: WalletDashboard): boolean {
  const feeTrx = Number(formatSunAsTrx(dashboard.snapshot.thirtyDayFeeSun));
  return Number.isFinite(feeTrx) && feeTrx >= 50;
}

function formatRiskReasons(dashboard: WalletDashboard): string {
  return bulletList(
    dashboard.safety.reasons.map((reason) => reason.message),
    "No active risk reasons from connected modules."
  );
}

function formatRiskModules(dashboard: WalletDashboard): string {
  return bulletList(dashboard.safety.modules.map((module) => `${module.label}: ${module.status.replace("_", " ")}`));
}

function formatWalletSafetyStatus(dashboard: WalletDashboard): string {
  if (dashboard.approvalSummary.highRiskDrainObservationCount > 0) {
    return `🔴 warning (${dashboard.approvalSummary.highRiskDrainObservationCount} post-approval outflow${dashboard.approvalSummary.highRiskDrainObservationCount === 1 ? "" : "s"})`;
  }
  if (dashboard.approvalSummary.highRiskApprovalCount > 0) {
    return `🟠 warning (${dashboard.approvalSummary.highRiskApprovalCount} risky approval${dashboard.approvalSummary.highRiskApprovalCount === 1 ? "" : "s"})`;
  }
  if (dashboard.approvalSummary.unlimitedApprovalCount > 0) {
    return `🟡 review (${dashboard.approvalSummary.unlimitedApprovalCount} unlimited approval${dashboard.approvalSummary.unlimitedApprovalCount === 1 ? "" : "s"})`;
  }
  return "🟢 OK";
}

function formatApprovalAge(date: Date | null, locale: BotLocale = DEFAULT_BOT_LOCALE): string {
  return formatRelativeTime(date, new Date(), locale);
}

function formatRiskyApprovalRows(approvals: WalletApproval[]): string {
  if (approvals.length === 0) return "\u2022 none";
  return approvals
    .slice(0, 5)
    .map((approval) => {
      const allowance = formatApprovalAllowance({
        amountRaw: approval.currentAllowanceRaw,
        isUnlimited: approval.isUnlimited
      });
      const allowanceText = approval.isUnlimited ? allowance : `finite ${allowance}`;
      const identity = approval.metadataName ?? approval.metadataTag ?? "unknown";
      const type = approval.metadataIsContract === true
        ? "contract"
        : approval.metadataIsContract === false
          ? "wallet"
          : approval.spenderType;
      const intel = approval.metadataIsContract === true
        ? `\n  ${kv("Intel", `${escapeHtml(approval.contractServiceTag ?? "no service tag")}, ${escapeHtml(approval.contractVerified === true ? "verified" : "not verified")}, ${escapeHtml(approval.contractActivityLevel ?? "unknown")}`)}`
        : "";
      const sessionLinked = approval.riskReasons.some((reason) => reason.code === "approval_temporally_linked_to_known_swap");
      const sessionText = sessionLinked ? `\n  ${kv("Session", "linked to swap/bridge route")}` : "";
      const contextText = formatApprovalContextStatus(approval);
      return [
        `\u2022 ${bold("USDT")} ${escapeHtml(identity)} · ${formatRiskIcon(approval.riskLevel)} ${bold(`${approval.riskLevel} ${approval.riskScore}/100`)}`,
        `  ${kv("Spender", code(approval.spenderAddress))}`,
        `  ${kv("Type", escapeHtml(type))}`,
        `  ${kv("Allowance", code(allowanceText))}`,
        `  ${kv("Last", escapeHtml(formatApprovalAge(approval.lastApprovalAt)))}${intel}${sessionText}${contextText ? `\n  ${contextText}` : ""}`
      ].join("\n");
    })
    .join("\n");
}

function formatApprovalContextStatus(approval: WalletApproval): string | null {
  const status = approval.approvalContextStatus ?? null;
  if (!status || status === "not_needed") return null;
  const result = approval.approvalContextResult && approval.approvalContextResult !== "unknown"
    ? ` / ${approval.approvalContextResult.replace(/_/g, " ")}`
    : "";
  const label = status === "pending"
    ? "⏳ pending"
    : status === "finalizing"
      ? "⏳ finalizing"
      : status === "resolved"
        ? "✅ resolved"
        : "⌛ expired";
  return kv("Context", escapeHtml(`${label}${result}`));
}

function formatContractIntelligenceRows(approvals: WalletApproval[]): string {
  const contractApprovals = approvals.filter((approval) => approval.metadataIsContract === true).slice(0, 3);
  if (contractApprovals.length === 0) return "\u2022 none";
  return contractApprovals
    .map((approval) => {
      const methods = approval.contractTopMethods.slice(0, 2).map((method) => method.method).join(", ");
      const summary = [
        approval.contractServiceTag ?? "no service tag",
        approval.contractVerified === true ? "verified" : "not verified",
        approval.contractActivityLevel ?? "unknown"
      ].join(", ");
      return `\u2022 ${code(approval.spenderAddress)}\n  ${escapeHtml(summary)}${methods ? `\n  ${kv("Methods", code(methods))}` : ""}`;
    })
    .join("\n");
}

function formatApprovalDrainRows(observations: ObservedApprovalDrainEvent[]): string {
  if (observations.length === 0) return "\u2022 none";
  return observations
    .slice(0, 5)
    .map((observation) => {
      const amount = formatApprovalAllowance({ amountRaw: observation.amountRaw, isUnlimited: false });
      return [
        `\u2022 ${bold(`${observation.riskLevel} ${observation.riskScore}/100`)}`,
        `  ${kv("Spender", code(observation.spenderAddress))}`,
        `  ${kv("Receiver", code(observation.receiverAddress))}`,
        `  ${kv("Amount", code(amount))}`,
        `  ${kv("Seen", escapeHtml(formatApprovalAge(observation.transferAt)))}`
      ].join("\n");
    })
    .join("\n");
}

function dataStatus(dashboard: WalletDashboard, locale: BotLocale = DEFAULT_BOT_LOCALE): string | null {
  if (dashboard.source === "cache" || dashboard.source === "fresh") return null;
  if (dashboard.source === "stale") return locale === "ru" ? "Данные дашборда: устарели" : "Dashboard data: stale";
  return locale === "ru" ? "Данные дашборда: недоступны" : "Dashboard data: unavailable";
}

function formatAlertMode(mode: CustomerAlertMode, locale: BotLocale = DEFAULT_BOT_LOCALE): string {
  return customerAlertModeText(locale, mode);
}

export function formatWalletAlertMode(mode: WalletAlertMode, digestIntervalMinutes = 10, locale: BotLocale = DEFAULT_BOT_LOCALE): string {
  return walletAlertModeText(locale, mode, digestIntervalMinutes);
}

export function homeMessage(walletCount: number, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  if (locale === "en") {
    return msg([
      bold("TRON Guard"),
      [
        "Monitors incoming USDT on your wallets.",
        "Checks addresses and transactions, approvals, and origin of funds.",
        kv("Watched wallets", code(String(walletCount))),
        kv("Alerts", "realtime or digest"),
        kv("Language", "English")
      ].join("\n"),
      "The bot is read-only. It does not store keys or sign transactions.",
      "Choose an action below."
    ]);
  }

  if (locale === "ru") {
    return msg([
      bold("TRON Guard"),
      [
        "Следит за входящими USDT на ваших кошельках.",
        "Проверяет адреса и транзакции, approval и происхождение денег.",
        kv("Кошельков под наблюдением", code(String(walletCount))),
        kv("Алерты", "сразу или сводкой"),
        kv("Язык", "русский")
      ].join("\n"),
      "Бот только читает блокчейн. Он не хранит ключи и не подписывает транзакции.",
      "Выберите действие ниже."
    ]);
  }

  return msg([
    bold("TRON Guard"),
    [
      "Monitors incoming USDT on your wallets.",
      "Checks addresses and transactions, approvals, and origin of funds.",
      kv("Watched wallets", code(String(walletCount))),
      kv("Alerts", "realtime or digest"),
      kv("Language", "English")
    ].join("\n"),
    "The bot is read-only. It does not store keys or sign transactions.",
    "Choose an action below."
  ]);
}

export function helpMessage(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  if (locale === "en") {
    return msg([
      bold("TRON Guard help"),
      section("What the bot does", [
        bulletList([
          "monitors incoming USDT",
          "checks sender and deposit context",
          "traces the origin of funds",
          "tracks USDT approvals",
          "shows wallet analytics"
        ])
      ]),
      section("What to know", [
        bulletList([
          "risk assessment helps you decide whether to accept an exchange",
          "policy risk does not always mean scam",
          "exact USDT outflow is shown only with a proven approval -> transferFrom chain"
        ])
      ]),
      "The bot does not store keys or sign transactions.",
      `${bold("Commands")}: ${code("/add_wallet")}, ${code("/wallets")}, ${code("/check")}, ${code("/check_status")}, ${code("/version")}, ${code("/settings")}, ${code("/profile")}, ${code("/my_id")}.`
    ]);
  }

  if (locale === "ru") {
    return msg([
      bold("Помощь TRON Guard"),
      section("Что умеет бот", [
        bulletList([
          "показывает входящие USDT",
          "проверяет отправителя и конкретный депозит",
          "Проверка происхождения денег: ищет источник суммы",
          "проверяет USDT approvals",
          "показывает рабочую аналитику кошелька"
        ])
      ]),
      section("Что важно знать", [
        bulletList([
          "оценка риска помогает принять решение по обмену",
          "риск по правилам сервиса не всегда означает мошенничество",
          "точное списание показываем только когда видно, кто получил разрешение и кто списал USDT"
        ])
      ]),
      "Бот не хранит ключи и не подписывает транзакции.",
      `${bold("Команды")}: ${code("/add_wallet")}, ${code("/wallets")}, ${code("/check")}, ${code("/check_status")}, ${code("/version")}, ${code("/settings")}, ${code("/profile")}, ${code("/my_id")}.`
    ]);
  }

  return msg([
    bold("TRON Guard help"),
    section("What the bot does", [
      bulletList([
        "monitors incoming USDT",
        "checks sender and deposit context",
        "traces the origin of funds",
        "track USDT approvals",
        "show wallet analytics"
      ])
    ]),
    section("What to know", [
      bulletList([
        "risk assessment helps you decide whether to accept an exchange",
        "policy risk does not always mean scam",
        "exact USDT outflow is shown only with a proven approval -> transferFrom chain"
      ])
    ]),
    "The bot does not store keys or sign transactions.",
    `${bold("Commands")}: ${code("/add_wallet")}, ${code("/wallets")}, ${code("/check")}, ${code("/check_status")}, ${code("/version")}, ${code("/settings")}, ${code("/profile")}, ${code("/my_id")}.`
  ]);
}

export function riskIntelOverviewMessage(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  if (locale === "en") {
    return msg([
      bold("🛡 Risk intelligence"),
      section("Active", [
        bulletList(["Internal labels: active", "Incoming monitor: active", "USDT blacklist state: active"])
      ]),
      section("Limited beta", [
        bulletList(["Wallet activity: limited", "USDT approvals: limited", "Forensic route context: limited"])
      ]),
      section("Not connected", [
        bulletList(["External AML providers: not connected"])
      ]),
      "Risk score is limited beta. Provider labels and service boundaries are context unless exact evidence is present."
    ]);
  }

  if (locale === "ru") {
    return msg([
      bold("Риск-модули"),
      section("Что проверяет бот", [
        bulletList([
          "входящие USDT",
          "USDT blacklist state",
          "USDT approval",
          "происхождение денег (beta-контекст)",
          "поведение кошелька (beta-контекст)"
        ])
      ]),
      section("Что пока ограничено", [
        bulletList([
          "часть проверок остаётся beta: происхождение денег и поведение кошелька дают контекст, а не доказательство скама",
          "внешние AML-провайдеры не подключены",
          "часть service boundary остаётся policy-risk, а не доказательством скама"
        ])
      ])
    ]);
  }

  return msg([
    bold("\u{1F6E1} Risk intelligence"),
    section("Active", [
      bulletList(["Internal labels: active", "Incoming monitor: active"])
    ]),
    section("Limited beta", [
      bulletList(["Wallet activity: limited", "USDT approvals: limited"])
    ]),
    section("Planned", [
      bulletList([
        "Hop1/Hop2 graph: planned",
        "Behavioral patterns: planned",
        "Bridge tracing: planned",
        "Case forensics: planned"
      ])
    ]),
    section("Not connected", [
      bulletList(["AML providers: not connected"])
    ]),
    "Risk score is limited beta. Planned modules do not affect score yet."
  ]);
}

export function walletsMessage(walletCount: number, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  if (locale === "en") {
    if (walletCount === 0) {
      return msg([
        bold("📁 My wallets"),
        "No watched wallets yet.",
        "Add a TRON wallet to enable monitoring."
      ]);
    }
    return msg([bold("📁 My wallets"), kv("Watched wallets", code(String(walletCount)))]);
  }

  if (locale === "ru") {
    if (walletCount === 0) {
      return msg([
        bold("📁 Мои кошельки"),
        "Кошельков под наблюдением пока нет.",
        "Добавьте TRON кошелек, чтобы включить мониторинг."
      ]);
    }
    return msg([bold("📁 Мои кошельки"), kv("Кошельков под наблюдением", code(String(walletCount)))]);
  }

  if (walletCount === 0) {
    return msg([
      bold("\u{1F4C1} My wallets"),
      "No watched wallets yet.",
      "Add a TRON wallet to enable monitoring."
    ]);
  }
  return msg([bold("\u{1F4C1} My wallets"), kv("Watched wallets", code(String(walletCount)))]);
}

export function dashboardMessage(dashboard: WalletDashboard, now = new Date(), locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  const statusLine = dataStatus(dashboard, locale);
  const feeUsd = formatFeeUsd(dashboard);
  const feeText = `${formatDecimal(formatSunAsTrx(dashboard.snapshot.thirtyDayFeeSun), 2, 2)} TRX${
    feeUsd ? ` (~$${feeUsd})` : ""
  }`;
  return msg([
    bold(locale === "en" ? "\u{1F4CD} Wallet dashboard" : "\u{1F4CD} Дашборд кошелька"),
    [
      kv(locale === "en" ? "Wallet" : "Кошелёк", `${escapeHtml(shortAddress(dashboard.wallet.address))} ${code(dashboard.wallet.address)}`),
      kv(locale === "en" ? "Monitoring" : "Мониторинг", locale === "en" ? "active" : "активен"),
      kv(locale === "en" ? "Last check" : "Последняя проверка", escapeHtml(formatRelativeTime(dashboard.pollState?.lastSuccessfulPollAt ?? null, now, locale))),
      kv(locale === "en" ? "Last result" : "Результат", escapeHtml(formatLastResult(dashboard, locale))),
      kv(locale === "en" ? "Alerts" : "Алерты", escapeHtml(formatWalletAlertMode(dashboard.wallet.alertMode, dashboard.wallet.digestIntervalMinutes, locale)))
    ].join("\n"),
    [
      kv(locale === "en" ? "Risk" : "Риск", riskBadge(dashboard.safety.level, dashboard.safety.score, "beta")),
      kv(locale === "en" ? "Wallet safety" : "Безопасность", escapeHtml(formatWalletSafetyStatus(dashboard))),
      kv("USDT", code(formatDecimal(formatMicroUsdt(dashboard.snapshot.usdtBalanceMicro), 2, 2))),
      kv("TRX", code(formatDecimal(formatSunAsTrx(dashboard.snapshot.trxBalanceSun), 2, 2)))
    ].join("\n"),
    section(locale === "en" ? "30d flow" : "Поток за 30 дней", [
      bulletList([
        `${locale === "en" ? "In" : "Вход"}: ${formatDecimal(dashboard.snapshot.thirtyDayInUsdt, 2, 2)} USDT`,
        `${locale === "en" ? "Out" : "Выход"}: ${formatDecimal(dashboard.snapshot.thirtyDayOutUsdt, 2, 2)} USDT`,
        `${locale === "en" ? "Gas/fees" : "Комиссии"}: ${feeText}`
      ])
    ]),
    kv(locale === "en" ? "Wallet age" : "Возраст кошелька", escapeHtml(formatWalletAge(dashboard.snapshot.walletCreatedAt, now, locale))),
    dashboard.snapshot.analyticsPartial ? (locale === "en" ? "Analytics: partial" : "Данные обновлены частично") : null,
    statusLine ? escapeHtml(statusLine) : null
  ]);
}

export function analyticsMessage(dashboard: WalletDashboard, now = new Date(), locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  const feeUsd = formatFeeUsd(dashboard);
  return msg([
    bold(locale === "en" ? "\u{1F4CA} Wallet analytics" : "\u{1F4CA} Аналитика кошелька"),
    kv(locale === "en" ? "Wallet" : "Кошелёк", `${escapeHtml(shortAddress(dashboard.wallet.address))} ${code(dashboard.wallet.address)}`),
    section(locale === "en" ? "Balances" : "Балансы", [
      bulletList([
        `USDT: ${formatDecimal(formatMicroUsdt(dashboard.snapshot.usdtBalanceMicro), 2, 2)}`,
        `TRX: ${formatDecimal(formatSunAsTrx(dashboard.snapshot.trxBalanceSun), 2, 2)}`,
        `${locale === "en" ? "Wallet age" : "Возраст кошелька"}: ${formatWalletAge(dashboard.snapshot.walletCreatedAt, now, locale)}`
      ])
    ]),
    section(locale === "en" ? "30d flow" : "Поток за 30 дней", [
      bulletList([
        `${locale === "en" ? "In" : "Вход"}: ${formatDecimal(dashboard.snapshot.thirtyDayInUsdt, 2, 2)} USDT`,
        `${locale === "en" ? "Out" : "Выход"}: ${formatDecimal(dashboard.snapshot.thirtyDayOutUsdt, 2, 2)} USDT`,
        `${locale === "en" ? "Transfers" : "Переводы"}: ${formatInteger(dashboard.snapshot.thirtyDayTransferCount)}`,
        `${locale === "en" ? "Gas/fees" : "Комиссии"}: ${formatDecimal(formatSunAsTrx(dashboard.snapshot.thirtyDayFeeSun), 2, 2)} TRX${feeUsd ? ` (~$${feeUsd})` : ""}`
      ])
    ]),
    section(locale === "en" ? "Tx counts" : "Транзакции", [
      bulletList([
        `${locale === "en" ? "Total" : "Всего"}: ${formatInteger(dashboard.snapshot.totalTxCount)}`,
        `${locale === "en" ? "Incoming" : "Входящие"}: ${formatInteger(dashboard.snapshot.incomingTxCount)}`,
        `${locale === "en" ? "Outgoing" : "Исходящие"}: ${formatInteger(dashboard.snapshot.outgoingTxCount)}`
      ])
    ]),
    [
      kv(locale === "en" ? "Updated" : "Обновлено", escapeHtml(formatRelativeTime(dashboard.snapshot.refreshedAt, now, locale))),
      kv(locale === "en" ? "Data quality" : "Данные", escapeHtml(dashboard.snapshot.analyticsPartial ? (locale === "en" ? "partial" : "частично") : (locale === "en" ? "full" : "полные")))
    ].join("\n"),
    shouldShowEnergyHint(dashboard)
      ? (locale === "en" ? "Energy hint: high 30d fees; TRON energy/bandwidth savings may be worth checking." : "За 30 дней комиссии высокие. Проверьте, можно ли снизить расходы через TRON Energy/Bandwidth.")
      : null
  ]);
}

export function securityMessage(dashboard: WalletDashboard, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([
    bold(locale === "en" ? "\u{1F6E1} Risk intelligence" : "\u{1F6E1} Риск-модули"),
    kv(locale === "en" ? "Wallet" : "Кошелёк", `${escapeHtml(shortAddress(dashboard.wallet.address))} ${code(dashboard.wallet.address)}`),
    [
      kv(locale === "en" ? "Current score" : "Текущий риск", riskBadge(dashboard.safety.level, dashboard.safety.score, "beta")),
      kv(locale === "en" ? "Confidence" : "Покрытие", locale === "en" ? "limited beta" : "ограниченное")
    ].join("\n"),
    section(locale === "en" ? "Reasons" : "Причины", [formatRiskReasons(dashboard)]),
    section(locale === "en" ? "Modules" : "Модули", [formatRiskModules(dashboard)]),
    locale === "en"
      ? "Score includes connected limited-beta modules only. AML, graph proximity, bridge tracing, and case forensics are not connected yet."
      : "Score учитывает только подключенные beta-модули. Если модуль не подключен или покрытие частичное, бот показывает это в ограничениях."
  ]);
}

export function safetyMessage(dashboard: WalletDashboard, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([
    bold(locale === "en" ? "\u{1F6E1} Wallet safety" : "\u{1F6E1} Безопасность кошелька"),
    kv(locale === "en" ? "Wallet" : "Кошелёк", `${escapeHtml(shortAddress(dashboard.wallet.address))} ${code(dashboard.wallet.address)}`),
    [
      kv(locale === "en" ? "Status" : "Статус", escapeHtml(formatWalletSafetyStatus(dashboard))),
      kv("USDT approvals", code(String(dashboard.approvalSummary.usdtApprovalCount))),
      kv(locale === "en" ? "Unlimited approvals" : "Безлимитные approvals", code(String(dashboard.approvalSummary.unlimitedApprovalCount))),
      kv(locale === "en" ? "Risky approvals" : "Рисковые approvals", code(String(dashboard.approvalSummary.highRiskApprovalCount))),
      kv(locale === "en" ? "Post-approval outflows" : "Выводы после approval", code(String(dashboard.approvalSummary.drainObservationCount)))
    ].join("\n"),
    section(locale === "en" ? "Top approvals" : "Главные approvals", [formatRiskyApprovalRows(dashboard.approvalSummary.topRiskyApprovals)]),
    section(locale === "en" ? "Contract intelligence" : "Проверка контрактов", [formatContractIntelligenceRows(dashboard.approvalSummary.topRiskyApprovals)]),
    section(locale === "en" ? "Shadow observations" : "Наблюдения после approval", [formatApprovalDrainRows(dashboard.approvalSummary.topDrainObservations)]),
    section(locale === "en" ? "Revoke guide" : "Как отменить approval", locale === "en"
      ? [
          "1. Open TronScan approvals.",
          "2. Connect TronLink with the watched wallet.",
          "3. Find USDT approval for the spender.",
          "4. Cancel approval if unexpected."
        ]
      : [
          "1. Откройте TronScan approvals.",
          "2. Подключите TronLink с нужным кошельком.",
          "3. Найдите USDT approval для указанного spender/адреса.",
          "4. Отмените approval, если он больше не нужен."
        ]),
    locale === "en"
      ? "\u{1F512} Bot is read-only. It never signs transactions and never asks for seed/private key."
      : "\u{1F512} Бот только читает данные. Он не подписывает транзакции и не спрашивает сид-фразу или приватный ключ."
  ]);
}

export function walletAlertModeMessage(wallet: WatchedWallet, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([
    bold(locale === "en" ? "\u{1F514} Alert mode" : "\u{1F514} Режим алертов"),
    kv(locale === "en" ? "Wallet" : "Кошелёк", `${escapeHtml(shortAddress(wallet.address))} ${code(wallet.address)}`),
    kv(locale === "en" ? "Current" : "Текущий режим", escapeHtml(formatWalletAlertMode(wallet.alertMode, wallet.digestIntervalMinutes, locale))),
    section(locale === "en" ? "Modes" : "Режимы", [
      bulletList(locale === "en"
        ? [
            "Realtime: every incoming transfer.",
            "Risk only: MEDIUM, HIGH, and CRITICAL.",
            "Digest: risky transfers immediately, low risk in a digest.",
            "Paused: save data without owner alerts."
          ]
        : [
            "Сразу: каждое входящее поступление.",
            "Только риск: MEDIUM, HIGH и CRITICAL.",
            "Сводка: рисковые поступления сразу, низкий риск — сводкой.",
            "Пауза: сохраняем данные, но не отправляем алерты владельцу."
          ])
    ])
  ]);
}

export function walletAlertModeUpdatedMessage(wallet: WatchedWallet, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([
    bold(locale === "en" ? "\u{1F514} Alert mode updated" : "\u{1F514} Режим алертов обновлён"),
    `${escapeHtml(shortAddress(wallet.address))} ${code(wallet.address)} -> ${escapeHtml(formatWalletAlertMode(wallet.alertMode, wallet.digestIntervalMinutes, locale))}`
  ]);
}

export function addWalletPrompt(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  if (locale === "en") {
    return msg([
      bold("➕ Add wallet"),
      "Send a TRON wallet address. The bot will start monitoring incoming USDT.",
      `${bold("Format")}: ${code("T...")}`
    ]);
  }
  if (locale === "ru") {
    return msg([
      bold("➕ Добавить кошелёк"),
      "Отправьте TRON-адрес кошелька. Бот начнёт следить за входящими USDT.",
      `${bold("Формат")}: ${code("T...")}`
    ]);
  }

  return msg([
    bold("\u2795 Add wallet"),
    "Send a TRON wallet address. The bot will start monitoring incoming USDT.",
    `${bold("Format")}: ${code("T...")}`
  ]);
}

export function checkAddressPrompt(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  if (locale === "en") {
    return msg([
      bold("🔎 Check address"),
      "Send a TRON address. The bot will check risk and trace the origin of funds.",
      "The address will not be added to monitoring."
    ]);
  }
  if (locale === "ru") {
    return msg([
      bold("🔎 Проверить адрес"),
      "Отправьте TRON-адрес. Бот проверит риск и запустит поиск происхождения денег.",
      "Адрес не будет добавлен в мониторинг."
    ]);
  }

  return msg([
    bold("\u{1F50E} Check address"),
    "Send a TRON address. The bot will check risk and trace the origin of funds.",
    "The address will not be added to monitoring."
  ]);
}

export function checkTxPrompt(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  if (locale === "en") {
    return msg([
      bold("🧾 Check tx"),
      "Send a TRON transaction hash.",
      "The bot will check the sender and origin of the amount in this transaction."
    ]);
  }
  if (locale === "ru") {
    return msg([
      bold("🧾 Проверить tx"),
      "Отправьте hash транзакции TRON.",
      "Бот проверит отправителя и происхождение суммы из этой транзакции."
    ]);
  }

  return msg([
    bold("\u{1F9FE} Check tx"),
    "Send a TRON transaction hash.",
    "The bot will check the sender and origin of the amount in this transaction."
  ]);
}

export function settingsMessage(recipients: CustomerAlertRecipient[] = [], locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  if (locale === "en") {
    return msg([
      bold("⚙️ Settings"),
      [
        kv("Owner alerts", "per-wallet alert mode"),
        kv("Alert admins", code(String(recipients.length))),
        kv("Language", languageName(locale))
      ].join("\n"),
      "The bot is read-only. It does not store keys or sign transactions."
    ]);
  }
  if (locale === "ru") {
    return msg([
      bold("⚙️ Настройки"),
      [
        kv("Алерты владельца", "настраиваются для каждого кошелька"),
        kv("Админы алертов", code(String(recipients.length))),
        kv("Язык", languageName(locale))
      ].join("\n"),
      "Бот только читает блокчейн. Он не хранит ключи и не подписывает транзакции."
    ]);
  }

  return msg([
    bold("\u2699\uFE0F Settings"),
    [
      kv("Owner alerts", "per wallet alert mode"),
      kv("Alert admins", code(String(recipients.length))),
      kv("Language", languageName(locale))
    ].join("\n"),
    "The bot is read-only. It does not store keys or sign transactions."
  ]);
}

export function removeConfirmMessage(address: string, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  if (locale === "en") {
    return msg([
      bold("🗑 Remove wallet"),
      `Stop monitoring for ${code(address)}?`,
      "Saved observations will remain in the database."
    ]);
  }
  if (locale === "ru") {
    return msg([
      bold("🗑 Удалить кошелёк"),
      `Остановить наблюдение за ${code(address)}?`,
      "История проверок останется в базе."
    ]);
  }

  return msg([
    bold("\u{1F5D1} Remove wallet"),
    `Stop monitoring for ${code(address)}?`,
    "Saved observations will remain in the database."
  ]);
}

export function myIdMessage(input: { telegramUserId: string; username: string | null }, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  if (locale === "en") {
    return msg([
      bold("🆔 Your Telegram identity"),
      [
        kv("Telegram ID", code(input.telegramUserId)),
        kv("Username", input.username ? `@${escapeHtml(input.username)}` : "not set")
      ].join("\n"),
      "This ID can be added as a customer alert admin."
    ]);
  }
  if (locale === "ru") {
    return msg([
      bold("🆔 Ваш Telegram ID"),
      [
        kv("Telegram ID", code(input.telegramUserId)),
        kv("Username", input.username ? `@${escapeHtml(input.username)}` : "не указан")
      ].join("\n"),
      "Этот ID можно добавить как админа алертов."
    ]);
  }

  return msg([
    bold("\u{1F194} Your Telegram identity"),
    [
      kv("Telegram ID", code(input.telegramUserId)),
      kv("Username", input.username ? `@${escapeHtml(input.username)}` : "not set")
    ].join("\n"),
    "This ID can be added as a customer alert admin."
  ]);
}

export function profileMessage(input: { telegramUserId: string; username: string | null; walletCount: number; locale?: BotLocale | null }): TelegramHtmlMessage {
  const locale = input.locale ?? DEFAULT_BOT_LOCALE;
  if (locale === "en") {
    return msg([
      bold("👤 Profile"),
      [
        kv("User", input.username ? `@${escapeHtml(input.username)}` : "no username"),
        kv("Telegram ID", code(input.telegramUserId)),
        kv("Watched wallets", code(String(input.walletCount))),
        kv("Language", languageName(locale))
      ].join("\n"),
      `Use ${code("/my_id")} to connect an alert admin.`
    ]);
  }
  if (locale === "ru") {
    return msg([
      bold("👤 Профиль"),
      [
        kv("Пользователь", input.username ? `@${escapeHtml(input.username)}` : "без username"),
        kv("Telegram ID", code(input.telegramUserId)),
        kv("Кошельков под наблюдением", code(String(input.walletCount))),
        kv("Язык", languageName(locale))
      ].join("\n"),
      `Для подключения админа алертов используйте ${code("/my_id")}.`
    ]);
  }

  return msg([
    bold("\u{1F464} Profile"),
    [
      kv("User", input.username ? `@${escapeHtml(input.username)}` : "no username"),
      kv("Telegram ID", code(input.telegramUserId)),
      kv("Watched wallets", code(String(input.walletCount))),
      kv("Language", "RU / EN")
    ].join("\n"),
    `Use ${code("/my_id")} to connect an alert admin.`
  ]);
}

export function alertAdminsMessage(recipients: CustomerAlertRecipient[], locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  if (locale === "en") {
    if (recipients.length === 0) {
      return msg([
        bold("👥 Alert admins"),
        "No customer alert admins configured.",
        "Owner receives alerts by wallet mode. Extra admins receive copies based on their mode."
      ]);
    }

    return msg([
      bold("👥 Alert admins"),
      bulletList(recipients.map((recipient) => `${recipient.recipientTelegramUserId} - ${formatAlertMode(recipient.alertMode, locale)}`)),
      "Owner receives alerts by wallet mode. Extra admins receive copies based on their mode."
    ]);
  }
  if (locale === "ru") {
    if (recipients.length === 0) {
      return msg([
        bold("👥 Админы алертов"),
        "Дополнительные админы алертов не настроены.",
        "Владелец получает алерты по режиму кошелька. Админы получают копии выбранных алертов."
      ]);
    }

    return msg([
      bold("👥 Админы алертов"),
      bulletList(recipients.map((recipient) => `${recipient.recipientTelegramUserId} - ${formatAlertMode(recipient.alertMode, locale)}`)),
      "Владелец получает алерты по режиму кошелька. Админы получают копии выбранных алертов."
    ]);
  }

  if (recipients.length === 0) {
    return msg([
      bold("\u{1F465} Alert admins"),
      "No customer alert admins configured.",
      "Owner receives alerts by wallet mode. Extra admins receive copies based on their mode."
    ]);
  }

  return msg([
    bold("\u{1F465} Alert admins"),
    bulletList(recipients.map((recipient) => `${recipient.recipientTelegramUserId} - ${formatAlertMode(recipient.alertMode)}`)),
    "Owner receives alerts by wallet mode. Extra admins receive copies based on their mode."
  ]);
}

export function addAlertAdminPrompt(defaultMode: CustomerAlertMode = "suspicious_only", locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  if (locale === "en") {
    return msg([
      bold("➕ Add alert admin"),
      "Send the Telegram ID that should receive alert copies.",
      [
        kv("Format", code("<telegram_id> <mode>")),
        kv("Modes", `${code("suspicious")}, ${code("suspicious_only")}, ${code("all")}`),
        kv("Default", code(defaultMode === "all" ? "all" : "suspicious_only"))
      ].join("\n")
    ]);
  }

  if (locale === "ru") {
    return msg([
      bold("➕ Добавить админа алертов"),
      "Отправьте Telegram ID админа, который должен получать копии алертов.",
      [
        kv("Формат", code("<telegram_id> <mode>")),
        kv("Режимы", `${code("suspicious")}, ${code("suspicious_only")}, ${code("all")}`),
        kv("По умолчанию", code(defaultMode === "all" ? "all" : "suspicious_only"))
      ].join("\n")
    ]);
  }

  return msg([
    bold("\u2795 Add alert admin"),
    "Send the Telegram ID that should receive alert copies.",
    [
      kv("Format", code("<telegram_id> <mode>")),
      kv("Modes", `${code("suspicious")}, ${code("suspicious_only")}, ${code("all")}`),
      kv("Default", code(defaultMode === "all" ? "all" : "suspicious_only"))
    ].join("\n")
  ]);
}

export function removeAlertAdminPrompt(locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  if (locale === "en") return msg([bold("➖ Remove alert admin"), "Send the Telegram ID to remove."]);
  if (locale === "ru") return msg([bold("➖ Удалить админа алертов"), "Отправьте Telegram ID админа, которого нужно отключить."]);
  return msg([bold("\u2796 Remove alert admin"), "Send the Telegram ID to remove."]);
}

export function alertAdminAddedMessage(input: { telegramUserId: string; mode: CustomerAlertMode }, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([bold(locale === "en" ? "Alert admin saved" : "Админ алертов сохранен"), `${code(input.telegramUserId)} - ${escapeHtml(formatAlertMode(input.mode, locale))}`]);
}

export function alertAdminRemovedMessage(telegramUserId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([bold(locale === "en" ? "Alert admin removed" : "Админ алертов удален"), code(telegramUserId)]);
}

export function alertAdminNotFoundMessage(telegramUserId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): TelegramHtmlMessage {
  return msg([bold(locale === "en" ? "Customer alert admin not found" : "Админ алертов не найден"), code(telegramUserId)]);
}
