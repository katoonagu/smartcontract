export type CustomerPresentationLocale = "ru" | "en";

const RAW_PER_CENT = 10_000n;
const RU_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря"
] as const;
const EN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
] as const;

function groupInteger(value: bigint, locale: CustomerPresentationLocale): string {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
    maximumFractionDigits: 0,
    useGrouping: true
  }).format(value).replace(/[\u00a0\u202f]/gu, " ");
}

export function formatCustomerUsdtRaw(
  raw: string,
  locale: CustomerPresentationLocale
): string {
  if (!/^\d+$/u.test(raw)) {
    throw new Error("unified_customer_format_invalid_raw");
  }
  const value = BigInt(raw);
  if (value === 0n) return "0 USDT";
  if (value < RAW_PER_CENT) {
    return locale === "ru"
      ? "меньше 0,01 USDT"
      : "less than 0.01 USDT";
  }

  const cents = (value + RAW_PER_CENT / 2n) / RAW_PER_CENT;
  const whole = cents / 100n;
  const fraction = cents % 100n;
  const decimal = locale === "ru" ? "," : ".";
  const fractionText = fraction === 0n
    ? ""
    : `${decimal}${fraction.toString().padStart(2, "0").replace(/0$/u, "")}`;
  return `${groupInteger(whole, locale)}${fractionText} USDT`;
}

export function formatCustomerPercent(
  sharePpm: number,
  locale: CustomerPresentationLocale
): string {
  if (
    !Number.isSafeInteger(sharePpm) ||
    sharePpm < 0 ||
    sharePpm > 1_000_000
  ) {
    throw new Error("unified_customer_format_invalid_percent");
  }
  const hundredths = Math.round(sharePpm / 100);
  const whole = Math.floor(hundredths / 100);
  const fraction = hundredths % 100;
  if (fraction === 0) return `${whole}%`;
  const decimal = locale === "ru" ? "," : ".";
  return `${whole}${decimal}${String(fraction).padStart(2, "0").replace(/0$/u, "")}%`;
}

export function formatCustomerUtcDate(
  iso: string | null,
  locale: CustomerPresentationLocale
): string {
  if (iso === null) {
    return locale === "ru"
      ? "не удалось определить"
      : "could not be determined";
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("unified_customer_format_invalid_date");
  }
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = locale === "ru"
    ? RU_MONTHS[date.getUTCMonth()]
    : EN_MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hour}:${minute} UTC`;
}

export function formatCustomerTransferCount(
  count: number,
  locale: CustomerPresentationLocale
): string {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("unified_customer_format_invalid_count");
  }
  if (locale === "en") return `${count} ${count === 1 ? "transfer" : "transfers"}`;

  const lastTwo = count % 100;
  const last = count % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14
    ? "переводов"
    : last === 1
      ? "перевод"
      : last >= 2 && last <= 4
        ? "перевода"
        : "переводов";
  return `${count} ${noun}`;
}
