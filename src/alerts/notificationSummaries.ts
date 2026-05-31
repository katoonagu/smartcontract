import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import type { BotLocale, WhereIsMoneyReport } from "../types";
import { checkedOriginLabel, normalizeNotificationReason, senderRoleText } from "./notificationText";

export function whereCompactReasonLines(report: WhereIsMoneyReport, locale: BotLocale): string[] {
  const normalized = report.decisionReasons
    .slice(0, 3)
    .map((reason) => normalizeNotificationReason(reason, locale));

  if (normalized.length > 0) return normalized;

  if (report.assessment.operationalLiquidityScore >= 70) {
    return [locale === "en"
      ? "Wallet looks like an operational liquidity wallet."
      : "Кошелёк похож на рабочий ликвидный кошелёк."];
  }

  return [locale === "en"
    ? "No exact bad evidence was found in the checked origin paths."
    : "В проверенных путях происхождения точное плохое доказательство не найдено."];
}

export function whereCoverageLine(report: WhereIsMoneyReport, locale: BotLocale): string {
  const ratio = report.coverage.coverageRatio ?? report.coverage.currentBalanceCoverageRatio ?? 0;
  return checkedOriginLabel(ratio, locale);
}

export function whereWalletRoleLine(report: WhereIsMoneyReport, locale: BotLocale): string {
  return locale === "en"
    ? `Wallet role: ${senderRoleText(report.assessment.walletRole, locale)}`
    : `Роль кошелька: ${senderRoleText(report.assessment.walletRole, locale)}`;
}

export function deepCompactMeaningLines(_report: DeepAddressForensicReport, locale: BotLocale): string[] {
  return locale === "en"
    ? [
        "This is behavior context, not scam proof.",
        "Use “Where is money” as the primary exchange decision."
      ]
    : [
        "Это контекст поведения, не доказательство скама.",
        "Решение по обмену берём из “Откуда деньги”."
      ];
}
