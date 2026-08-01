import type { RiskLevel, RiskReport } from "../types";
import { telegramAddressRef, type AddressRefV1 } from "../telegram/forensicPresentation";

export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const SAFE_MESSAGE_LIMIT = 3900;
const MAX_FIELD_LENGTH = 240;
const TRUNCATION_SUFFIX = "\n...[message truncated]";

export type TelegramHtmlMessage = {
  text: string;
  parseMode: "HTML";
};

export type TelegramAlertMessage = TelegramHtmlMessage;

export function sanitizeTelegramText(value: string): string {
  const cleaned = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= MAX_FIELD_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_FIELD_LENGTH - 3)}...`;
}

export function escapeHtml(value: string): string {
  return sanitizeTelegramText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderTelegramAddressRef(ref: AddressRefV1): string {
  const canonical = telegramAddressRef(ref.address);
  if (canonical.url === null) return escapeHtml(canonical.display);
  return `<a href="${escapeHtml(canonical.url)}">${escapeHtml(canonical.display)}</a>`;
}

export function bold(value: string): string {
  return `<b>${escapeHtml(value)}</b>`;
}

export function code(value: string): string {
  return `<code>${escapeHtml(value)}</code>`;
}

export function section(title: string, lines: Array<string | null | undefined>): string {
  const body = lines.filter((line): line is string => Boolean(line && line.trim().length > 0));
  if (body.length === 0) return "";
  return [bold(title), ...body].join("\n");
}

export function bulletList(items: string[], fallback = "no obvious risk signals found"): string {
  if (items.length === 0) return `\u2022 ${escapeHtml(fallback)}`;
  return items.map((item) => `\u2022 ${escapeHtml(item)}`).join("\n");
}

export function formatRiskIcon(level: RiskLevel): string {
  switch (level) {
    case "LOW":
      return "\u{1F7E2}";
    case "MEDIUM":
      return "\u{1F7E1}";
    case "HIGH":
      return "\u{1F7E0}";
    case "CRITICAL":
      return "\u{1F534}";
  }
}

function titleCaseRisk(level: RiskLevel): string {
  return `${level.slice(0, 1)}${level.slice(1).toLowerCase()}`;
}

export function formatRiskLine(report: RiskReport): string {
  return `${formatRiskIcon(report.level)} ${bold(`${titleCaseRisk(report.level)} risk`)} \u00B7 ${code(`${report.score}/100`)}`;
}

function applyTag(stack: string[], token: string): string[] {
  if (token === "<b>") return [...stack, "b"];
  if (token === "<code>") return [...stack, "code"];
  if (token === "</b>") {
    const next = [...stack];
    const index = next.lastIndexOf("b");
    if (index >= 0) next.splice(index, 1);
    return next;
  }
  if (token === "</code>") {
    const next = [...stack];
    const index = next.lastIndexOf("code");
    if (index >= 0) next.splice(index, 1);
    return next;
  }
  return stack;
}

function closingTags(stack: string[]): string {
  return [...stack].reverse().map((tag) => `</${tag}>`).join("");
}

function nextHtmlToken(html: string, start: number): { token: string; nextIndex: number } {
  const char = html[start];
  if (char === "<") {
    const end = html.indexOf(">", start);
    if (end >= start) return { token: html.slice(start, end + 1), nextIndex: end + 1 };
  }
  if (char === "&") {
    const end = html.indexOf(";", start);
    if (end >= start && end - start <= 12) return { token: html.slice(start, end + 1), nextIndex: end + 1 };
  }
  return { token: char, nextIndex: start + 1 };
}

export function safeTruncateHtml(html: string, limit = SAFE_MESSAGE_LIMIT): string {
  if (html.length <= limit) return html;

  let output = "";
  let index = 0;
  let stack: string[] = [];

  while (index < html.length) {
    const { token, nextIndex } = nextHtmlToken(html, index);
    const nextStack = applyTag(stack, token);
    const suffix = closingTags(nextStack) + TRUNCATION_SUFFIX;
    if (output.length + token.length + suffix.length > limit) break;

    output += token;
    stack = nextStack;
    index = nextIndex;
  }

  return `${output}${closingTags(stack)}${TRUNCATION_SUFFIX}`;
}

export function telegramHtmlMessage(lines: Array<string | null | undefined>): TelegramHtmlMessage {
  const text = lines.filter((line): line is string => Boolean(line && line.trim().length > 0)).join("\n\n");
  return {
    text: safeTruncateHtml(text),
    parseMode: "HTML"
  };
}
