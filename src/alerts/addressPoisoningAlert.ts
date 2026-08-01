import { createHash } from "node:crypto";
import { InlineKeyboard } from "grammy";
import { DEFAULT_BOT_LOCALE } from "../bot/i18n";
import type { AddressPoisoningCandidateDelivery, BotLocale } from "../types";
import { tronscanTransactionUrl } from "./keyboards";
import { code, escapeHtml, telegramHtmlMessage, type TelegramAlertMessage } from "./telegramHtml";

export const ADDRESS_POISONING_ALERT_FORMAT_VERSION = "address-poisoning-alert-v1";

const CALLBACK_TOKEN = /^[A-Za-z0-9_-]{16,24}$/;

function localeOf(candidate: AddressPoisoningCandidateDelivery): BotLocale {
  return candidate.locale ?? DEFAULT_BOT_LOCALE;
}

function formatRawAmount(raw: string, decimals: number, locale: BotLocale): string {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0 ? "" : padded.slice(-decimals).replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return fraction ? `${grouped}${locale === "ru" ? "," : "."}${fraction}` : grouped;
}

function pluralRu(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function friendlyElapsed(milliseconds: number, locale: BotLocale): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) {
    if (locale === "en") return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
    return `${seconds} ${pluralRu(seconds, "секунду", "секунды", "секунд")}`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    if (locale === "en") return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    return `${minutes} ${pluralRu(minutes, "минуту", "минуты", "минут")}`;
  }
  const hours = Math.floor(minutes / 60);
  if (locale === "en") return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours} ${pluralRu(hours, "час", "часа", "часов")}`;
}

function evidenceCoverage(candidate: AddressPoisoningCandidateDelivery): "complete" | "partial" {
  return candidate.evidenceJson.coverage === "complete" ? "complete" : "partial";
}

function evidenceWindowHours(candidate: AddressPoisoningCandidateDelivery): number {
  const start = new Date(String(candidate.evidenceJson.windowStart ?? "")).getTime();
  const end = new Date(String(candidate.evidenceJson.windowEnd ?? "")).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 24;
  return Math.max(1, Math.round((end - start + 1) / 3_600_000));
}

function similarityText(candidate: AddressPoisoningCandidateDelivery, locale: BotLocale): string {
  const parts: string[] = [];
  if (candidate.meaningfulPrefixLength > 0) {
    parts.push(locale === "ru"
      ? `первые ${candidate.meaningfulPrefixLength} ${pluralRu(candidate.meaningfulPrefixLength, "символ", "символа", "символов")} после T`
      : `the first ${candidate.meaningfulPrefixLength} ${candidate.meaningfulPrefixLength === 1 ? "character" : "characters"} after T`);
  }
  if (candidate.suffixLength > 0) {
    parts.push(locale === "ru"
      ? `последние ${candidate.suffixLength} ${pluralRu(candidate.suffixLength, "символ", "символа", "символов")}`
      : `the last ${candidate.suffixLength} ${candidate.suffixLength === 1 ? "character" : "characters"}`);
  }
  if (locale === "ru") return `Адреса похожи: совпадают ${parts.join(" и ")}.`;
  return `The addresses look alike: ${parts.join(" and ")} match.`;
}

export function formatAddressPoisoningAlert(
  candidate: AddressPoisoningCandidateDelivery
): TelegramAlertMessage {
  const locale = localeOf(candidate);
  const coverage = evidenceCoverage(candidate);
  const windowHours = evidenceWindowHours(candidate);
  const amount = formatRawAmount(candidate.suspiciousAmountRaw, candidate.tokenDecimals, locale);
  const previousAmount = formatRawAmount(candidate.matchedOutgoingAmountRaw, candidate.tokenDecimals, locale);
  const elapsed = friendlyElapsed(
    candidate.suspiciousIncomingAt.getTime() - candidate.matchedOutgoingAt.getTime(),
    locale
  );
  const token = escapeHtml(candidate.tokenSymbol);

  if (locale === "en") {
    const history = coverage === "complete"
      ? `not seen in transfers during the checked ${windowHours} hours`
      : `not seen in the checked part of the last ${windowHours} hours of transfer history`;
    return telegramHtmlMessage([
      candidate.classification === "CRITICAL" ? "🔴 Possible address replacement" : "🟠 Possible address replacement",
      `<b>Watched wallet:</b> ${code(candidate.walletAddress)}`,
      [
        "<b>What happened</b>",
        `You received ${escapeHtml(amount)} ${token} from an address ${history}:`,
        code(candidate.suspiciousSender),
        similarityText(candidate, locale),
        code(candidate.genuineRecipient),
        `You sent ${escapeHtml(previousAmount)} ${token} to that address ${escapeHtml(elapsed)} ago.`
      ].join("\n"),
      [
        "<b>What to do</b>",
        "Do not copy the recipient address from transaction history. Get the saved recipient address again and compare every character. Do not transfer funds until the address is verified."
      ].join("\n")
    ]);
  }

  const history = coverage === "complete"
    ? `который не встречался среди переводов за проверенные ${windowHours} часа`
    : `который не встречался в проверенной части истории переводов за последние ${windowHours} часа`;
  return telegramHtmlMessage([
    candidate.classification === "CRITICAL" ? "🔴 Возможна подмена адреса" : "🟠 Возможна подмена адреса",
    `<b>Кошелёк:</b> ${code(candidate.walletAddress)}`,
    [
      "<b>Что произошло</b>",
      `Пришло ${escapeHtml(amount)} ${token} от адреса, ${history}:`,
      code(candidate.suspiciousSender),
      similarityText(candidate, locale),
      code(candidate.genuineRecipient),
      `Этому адресу вы отправили ${escapeHtml(previousAmount)} ${token} ${escapeHtml(elapsed)} назад.`
    ].join("\n"),
    [
      "<b>Что делать</b>",
      "Не копируйте адрес получателя из истории переводов. Возьмите сохранённый адрес заново и сравните каждый символ. Не переводите деньги, пока не проверите адрес."
    ].join("\n")
  ]);
}

export function addressPoisoningAlertKeyboard(input: {
  callbackToken: string;
  incomingTxHash: string;
  outgoingTxHash: string;
  terminal?: boolean;
  locale?: BotLocale;
}): InlineKeyboard {
  if (!CALLBACK_TOKEN.test(input.callbackToken)) throw new Error("Invalid address-poisoning callback token");
  const english = input.locale === "en";
  const keyboard = new InlineKeyboard()
    .url(english ? "Incoming transfer" : "Входящий перевод", tronscanTransactionUrl(input.incomingTxHash))
    .url(english ? "Outgoing transfer" : "Исходящий перевод", tronscanTransactionUrl(input.outgoingTxHash));
  if (!input.terminal) {
    keyboard
      .row()
      .text(english ? "I know this address" : "Это знакомый адрес", `poison:dismiss:${input.callbackToken}`)
      .row()
      .text(english ? "Mark as replacement" : "Пометить как подмену", `poison:confirm:${input.callbackToken}`);
  }
  return keyboard;
}

export function addressPoisoningAlertFingerprint(candidate: AddressPoisoningCandidateDelivery): string {
  const locale = localeOf(candidate);
  const message = formatAddressPoisoningAlert(candidate);
  const keyboard = addressPoisoningAlertKeyboard({
    callbackToken: candidate.callbackToken,
    incomingTxHash: candidate.suspiciousIncomingTxHash,
    outgoingTxHash: candidate.matchedOutgoingTxHash,
    terminal: candidate.status !== "candidate",
    locale
  });
  const facts = {
    policy: ADDRESS_POISONING_ALERT_FORMAT_VERSION,
    locale,
    walletAddress: candidate.walletAddress,
    suspiciousSender: candidate.suspiciousSender,
    genuineRecipient: candidate.genuineRecipient,
    incomingTxHash: candidate.suspiciousIncomingTxHash,
    outgoingTxHash: candidate.matchedOutgoingTxHash,
    suspiciousAmountRaw: candidate.suspiciousAmountRaw,
    matchedOutgoingAmountRaw: candidate.matchedOutgoingAmountRaw,
    tokenContract: candidate.tokenContract,
    tokenSymbol: candidate.tokenSymbol,
    tokenDecimals: candidate.tokenDecimals,
    suspiciousIncomingAt: candidate.suspiciousIncomingAt.toISOString(),
    matchedOutgoingAt: candidate.matchedOutgoingAt.toISOString(),
    elapsedMs: candidate.suspiciousIncomingAt.getTime() - candidate.matchedOutgoingAt.getTime(),
    rawPrefixLength: candidate.rawPrefixLength,
    meaningfulPrefixLength: candidate.meaningfulPrefixLength,
    suffixLength: candidate.suffixLength,
    classification: candidate.classification,
    confidence: candidate.confidence,
    evidence: {
      policyVersion: candidate.evidenceJson.policyVersion ?? null,
      coverage: candidate.evidenceJson.coverage ?? null,
      windowStart: candidate.evidenceJson.windowStart ?? null,
      windowEnd: candidate.evidenceJson.windowEnd ?? null,
      fetchedCount: candidate.evidenceJson.fetchedCount ?? null,
      pageCount: candidate.evidenceJson.pageCount ?? null,
      logicalOffset: candidate.evidenceJson.logicalOffset ?? null,
      oldestFetchedAt: candidate.evidenceJson.oldestFetchedAt ?? null
    },
    rendered: {
      text: message.text,
      parseMode: message.parseMode,
      buttons: keyboard.inline_keyboard
    }
  };
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}
