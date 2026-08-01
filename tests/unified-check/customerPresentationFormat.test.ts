import { afterEach, describe, expect, it } from "vitest";
import {
  formatCustomerPercent,
  formatCustomerTransferCount,
  formatCustomerUsdtRaw,
  formatCustomerUtcDate
} from "../../src/unifiedCheck/customerPresentationFormat";

const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
});

describe("customer presentation formatting", () => {
  it("formats exact raw USDT values for Russian customer copy", () => {
    expect(formatCustomerUsdtRaw("0", "ru")).toBe("0 USDT");
    expect(formatCustomerUsdtRaw("1", "ru")).toBe("меньше 0,01 USDT");
    expect(formatCustomerUsdtRaw("9999", "ru")).toBe("меньше 0,01 USDT");
    expect(formatCustomerUsdtRaw("10000", "ru")).toBe("0,01 USDT");
    expect(formatCustomerUsdtRaw("10000000", "ru")).toBe("10 USDT");
    expect(formatCustomerUsdtRaw("10000001", "ru")).toBe("10 USDT");
    expect(formatCustomerUsdtRaw("12500000", "ru")).toBe("12,5 USDT");
    expect(formatCustomerUsdtRaw("123456789", "ru")).toBe("123,46 USDT");
    expect(formatCustomerUsdtRaw("9007199254740993000000", "ru"))
      .toBe("9 007 199 254 740 993 USDT");
  });

  it("formats exact raw USDT values for English customer copy", () => {
    expect(formatCustomerUsdtRaw("1", "en")).toBe("less than 0.01 USDT");
    expect(formatCustomerUsdtRaw("10000", "en")).toBe("0.01 USDT");
    expect(formatCustomerUsdtRaw("12500000", "en")).toBe("12.5 USDT");
    expect(formatCustomerUsdtRaw("123456789", "en")).toBe("123.46 USDT");
    expect(formatCustomerUsdtRaw("9007199254740993000000", "en"))
      .toBe("9,007,199,254,740,993 USDT");
  });

  it.each(["", "-1", "1.0", "abc", " 1"])(
    "rejects invalid raw USDT value %j",
    (raw) => {
      expect(() => formatCustomerUsdtRaw(raw, "ru"))
        .toThrow("unified_customer_format_invalid_raw");
    }
  );

  it("formats percentages without binary floating point artifacts", () => {
    expect(formatCustomerPercent(0, "ru")).toBe("0%");
    expect(formatCustomerPercent(333_333, "ru")).toBe("33,33%");
    expect(formatCustomerPercent(500_000, "en")).toBe("50%");
    expect(formatCustomerPercent(1_000_000, "en")).toBe("100%");
    expect(() => formatCustomerPercent(-1, "ru"))
      .toThrow("unified_customer_format_invalid_percent");
    expect(() => formatCustomerPercent(1_000_001, "ru"))
      .toThrow("unified_customer_format_invalid_percent");
  });

  it("formats UTC dates independently of the host timezone", () => {
    process.env.TZ = "Pacific/Honolulu";
    const honolulu = formatCustomerUtcDate(
      "2026-07-20T13:53:09.000Z",
      "ru"
    );
    process.env.TZ = "Asia/Tokyo";
    const tokyo = formatCustomerUtcDate(
      "2026-07-20T13:53:09.000Z",
      "ru"
    );

    expect(honolulu).toBe("20 июля 2026, 13:53 UTC");
    expect(tokyo).toBe(honolulu);
    expect(formatCustomerUtcDate("2026-07-20T13:53:09.000Z", "en"))
      .toBe("20 Jul 2026, 13:53 UTC");
  });

  it("localizes a missing date and rejects an invalid non-null date", () => {
    expect(formatCustomerUtcDate(null, "ru")).toBe("не удалось определить");
    expect(formatCustomerUtcDate(null, "en"))
      .toBe("could not be determined");
    expect(() => formatCustomerUtcDate("not-a-date", "ru"))
      .toThrow("unified_customer_format_invalid_date");
  });

  it.each([
    [1, "1 перевод"],
    [2, "2 перевода"],
    [5, "5 переводов"],
    [11, "11 переводов"],
    [21, "21 перевод"],
    [22, "22 перевода"]
  ] as const)("formats Russian transfer count %i", (count, expected) => {
    expect(formatCustomerTransferCount(count, "ru")).toBe(expected);
  });

  it("formats English transfer counts and rejects invalid counts", () => {
    expect(formatCustomerTransferCount(1, "en")).toBe("1 transfer");
    expect(formatCustomerTransferCount(2, "en")).toBe("2 transfers");
    expect(() => formatCustomerTransferCount(-1, "ru"))
      .toThrow("unified_customer_format_invalid_count");
    expect(() => formatCustomerTransferCount(1.5, "ru"))
      .toThrow("unified_customer_format_invalid_count");
  });
});
