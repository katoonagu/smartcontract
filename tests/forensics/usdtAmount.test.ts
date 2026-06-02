import { describe, expect, it } from "vitest";
import { parseUsdtDecimalToRaw } from "../../src/forensics/usdtAmount";

describe("parseUsdtDecimalToRaw", () => {
  it("parses positive USDT decimals to six-decimal raw units", () => {
    expect(parseUsdtDecimalToRaw("1")).toBe("1000000");
    expect(parseUsdtDecimalToRaw("1.25")).toBe("1250000");
    expect(parseUsdtDecimalToRaw("100000")).toBe("100000000000");
    expect(parseUsdtDecimalToRaw("1000.123456")).toBe("1000123456");
  });

  it("rejects zero, negative values, malformed values, and more than six decimals", () => {
    expect(parseUsdtDecimalToRaw("0")).toBeNull();
    expect(parseUsdtDecimalToRaw("-1")).toBeNull();
    expect(parseUsdtDecimalToRaw("1.1234567")).toBeNull();
    expect(parseUsdtDecimalToRaw("abc")).toBeNull();
  });
});
