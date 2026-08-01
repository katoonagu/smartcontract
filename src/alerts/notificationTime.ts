import type { BotLocale } from "../types";

const MOSCOW_TIME_ZONE = "Europe/Moscow";

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function formatNotificationMskTime(value: Date | null | undefined, locale: BotLocale): string | null {
  if (!value || !isValidDate(value)) return null;

  const formatter = new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: locale === "ru" ? "2-digit" : "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(value);
  const day = datePart(parts, "day");
  const month = datePart(parts, "month");
  const year = datePart(parts, "year");
  const hour = datePart(parts, "hour");
  const minute = datePart(parts, "minute");

  if (locale === "ru") {
    return `${day}.${month}.${year} ${hour}:${minute} MSK`;
  }

  return `${month} ${Number(day)}, ${year} ${hour}:${minute} MSK`;
}
