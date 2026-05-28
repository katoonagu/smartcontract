import { describe, expect, it } from "vitest";
import { parseWhereIsMoneyCliArgs, WHERE_IS_MONEY_USAGE } from "../../src/forensics/whereIsMoneyCliArgs";

const source = "TUzXY779GY3Tm6UDRYDPqNEojZgZEpY127";

describe("where is money CLI args", () => {
  it("defaults to bounded balance-origin search settings", () => {
    const parsed = parseWhereIsMoneyCliArgs([
      "--",
      "--source",
      source,
      "--end",
      "2026-05-26T00:00:00.000Z"
    ]);

    expect(parsed).toMatchObject({
      source,
      days: 30,
      depth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40
    });
    expect(parsed.windowEnd.toISOString()).toBe("2026-05-26T00:00:00.000Z");
    expect(parsed.windowStart.toISOString()).toBe("2026-04-26T00:00:00.000Z");
  });

  it("rejects values that would make the local search too broad", () => {
    expect(() => parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--depth",
      "21"
    ])).toThrow(/--depth must be an integer between 1 and 20/);

    expect(() => parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--beam",
      "20"
    ])).toThrow(/--beam must be an integer between 1 and 8/);

    expect(() => parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--max-addresses",
      "120"
    ])).toThrow(/--max-addresses must be an integer between 1 and 60/);

    expect(() => parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--max-edges",
      "250"
    ])).toThrow(/--max-edges must be an integer between 1 and 100/);
  });

  it("accepts npm-on-Windows positional values when named flags are stripped", () => {
    const parsed = parseWhereIsMoneyCliArgs([
      source,
      "14",
      "6",
      "4",
      "20",
      "25",
      "--end",
      "2026-05-26T00:00:00.000Z"
    ]);

    expect(parsed).toMatchObject({
      source,
      days: 14,
      depth: 6,
      beamWidth: 4,
      maxAddressFetches: 20,
      maxEdgesPerAddress: 25
    });
    expect(parsed.windowStart.toISOString()).toBe("2026-05-12T00:00:00.000Z");
  });

  it("parses optional requested USDT amount into micro-units", () => {
    const parsed = parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--amount",
      "1000.123456"
    ]);

    expect(parsed.requestedAmountRaw).toBe("1000123456");
  });

  it("parses positional decimal requested USDT amount into micro-units", () => {
    const parsed = parseWhereIsMoneyCliArgs([
      source,
      "1000.25",
      "14",
      "--end",
      "2026-05-26T00:00:00.000Z"
    ]);

    expect(parsed.requestedAmountRaw).toBe("1000250000");
    expect(parsed.days).toBe(14);
  });

  it("rejects malformed requested USDT amounts", () => {
    expect(() => parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--amount",
      "1.1234567"
    ])).toThrow(/--amount must be a positive USDT amount with up to 6 decimals/);
  });

  it("documents the where-is-money command", () => {
    expect(WHERE_IS_MONEY_USAGE).toContain("forensic:where-is-money");
    expect(WHERE_IS_MONEY_USAGE).toContain("--amount 1000.25");
    expect(WHERE_IS_MONEY_USAGE).toContain("--depth 7");
    expect(WHERE_IS_MONEY_USAGE).toContain("--max-edges 40");
  });
});
