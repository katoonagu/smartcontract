import { describe, expect, it } from "vitest";
import {
  whereIsMoneyIndexedFetchLimit,
  whereIsMoneyLatestFallbackCacheKey,
  whereIsMoneyLiveFallbackLimit
} from "../../src/forensics/whereIsMoneyFetchLimits";
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
      days: 90,
      depth: 20,
      beamWidth: 12,
      maxAddressFetches: 150,
      maxEdgesPerAddress: 100,
      approvalEnrichmentMode: "triggered",
      maxApprovalCandidates: 30,
      maxContractTransactionInfoFetches: 30,
      contractTransactionInfoMinIntervalMs: 15000,
      crossChainStage2Enabled: false,
      crossChainManualDeepMode: false,
      // Null lets the CLI runner apply config.crossChainStage2MaxProviderCalls.
      crossChainMaxProviderCalls: null
    });
    expect(parsed.windowEnd.toISOString()).toBe("2026-05-26T00:00:00.000Z");
    expect(parsed.windowStart.toISOString()).toBe("2026-02-25T00:00:00.000Z");
  });

  it("ignores the script path when called with process.argv.slice(1)", () => {
    const parsed = parseWhereIsMoneyCliArgs([
      "scripts/forensicWhereIsMoney.ts",
      "--source",
      source,
      "--days",
      "30",
      "--depth",
      "7",
      "--beam",
      "8",
      "--max-addresses",
      "60",
      "--max-edges",
      "60",
      "--end",
      "2026-05-26T00:00:00.000Z"
    ]);

    expect(parsed.requestedAmountRaw).toBeNull();
    expect(parsed).toMatchObject({
      source,
      days: 30,
      depth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 60
    });
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
      "13"
    ])).toThrow(/--beam must be an integer between 1 and 12/);

    expect(() => parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--max-addresses",
      "151"
    ])).toThrow(/--max-addresses must be an integer between 1 and 150/);

    expect(() => parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--max-edges",
      "151"
    ])).toThrow(/--max-edges must be an integer between 1 and 150/);
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

  it("parses approval enrichment controls", () => {
    const parsed = parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--approval-mode",
      "always",
      "--approval-candidates",
      "40",
      "--contract-tx-info",
      "25",
      "--contract-tx-info-delay-ms",
      "1500"
    ]);

    expect(parsed.approvalEnrichmentMode).toBe("always");
    expect(parsed.maxApprovalCandidates).toBe(40);
    expect(parsed.maxContractTransactionInfoFetches).toBe(25);
    expect(parsed.contractTransactionInfoMinIntervalMs).toBe(1500);
  });

  it("parses cross-chain Stage 2 controls", () => {
    expect(parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--cross-chain-stage2"
    ]).crossChainStage2Enabled).toBe(true);

    expect(parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--cross-chain-manual-deep"
    ]).crossChainManualDeepMode).toBe(true);

    expect(parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--cross-chain-max-provider-calls",
      "30"
    ]).crossChainMaxProviderCalls).toBe(30);
  });

  it("rejects a cross-chain provider-call flag without a value", () => {
    expect(() => parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--cross-chain-max-provider-calls"
    ])).toThrow(/--cross-chain-max-provider-calls must be an integer between 1 and 500/);

    expect(() => parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--cross-chain-max-provider-calls",
      "--depth",
      "5"
    ])).toThrow(/--cross-chain-max-provider-calls must be an integer between 1 and 500/);
  });

  it("accepts the documented contract transaction-info delay default when passed explicitly", () => {
    const parsed = parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--contract-tx-info-delay-ms",
      "15000"
    ]);

    expect(parsed.contractTransactionInfoMinIntervalMs).toBe(15000);
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

  it("parses positional whole requested USDT amount when followed by positional days", () => {
    const parsed = parseWhereIsMoneyCliArgs([
      source,
      "1000",
      "14",
      "--end",
      "2026-05-26T00:00:00.000Z"
    ]);

    expect(parsed.requestedAmountRaw).toBe("1000000000");
    expect(parsed.days).toBe(14);
  });

  it("preserves legacy positional days and search settings", () => {
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

    expect(parsed.requestedAmountRaw).toBeNull();
    expect(parsed.days).toBe(14);
    expect(parsed.depth).toBe(6);
    expect(parsed.beamWidth).toBe(4);
    expect(parsed.maxAddressFetches).toBe(20);
    expect(parsed.maxEdgesPerAddress).toBe(25);
  });

  it("parses whole requested amount before the legacy positional settings", () => {
    const parsed = parseWhereIsMoneyCliArgs([
      source,
      "100",
      "14",
      "6",
      "4",
      "20",
      "25",
      "--end",
      "2026-05-26T00:00:00.000Z"
    ]);

    expect(parsed.requestedAmountRaw).toBe("100000000");
    expect(parsed.days).toBe(14);
    expect(parsed.depth).toBe(6);
    expect(parsed.beamWidth).toBe(4);
    expect(parsed.maxAddressFetches).toBe(20);
    expect(parsed.maxEdgesPerAddress).toBe(25);
  });

  it("removes only the selected positional amount token when amount and days have the same value", () => {
    const parsed = parseWhereIsMoneyCliArgs([
      source,
      "14",
      "14",
      "6",
      "4",
      "20",
      "25",
      "--end",
      "2026-05-26T00:00:00.000Z"
    ]);

    expect(parsed.requestedAmountRaw).toBe("14000000");
    expect(parsed.days).toBe(14);
    expect(parsed.depth).toBe(6);
    expect(parsed.beamWidth).toBe(4);
    expect(parsed.maxAddressFetches).toBe(20);
    expect(parsed.maxEdgesPerAddress).toBe(25);
  });

  it("keeps positional settings when amount is provided by named flag", () => {
    const parsed = parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--amount",
      "14",
      "14",
      "6",
      "4",
      "20",
      "25",
      "--end",
      "2026-05-26T00:00:00.000Z"
    ]);

    expect(parsed.requestedAmountRaw).toBe("14000000");
    expect(parsed.days).toBe(14);
    expect(parsed.depth).toBe(6);
    expect(parsed.beamWidth).toBe(4);
    expect(parsed.maxAddressFetches).toBe(20);
    expect(parsed.maxEdgesPerAddress).toBe(25);
  });

  it("keeps positional settings aligned when days is provided by named flag", () => {
    const parsed = parseWhereIsMoneyCliArgs([
      "--source",
      source,
      "--days",
      "14",
      "6",
      "4",
      "20",
      "25",
      "--end",
      "2026-05-26T00:00:00.000Z"
    ]);

    expect(parsed.requestedAmountRaw).toBeNull();
    expect(parsed.days).toBe(14);
    expect(parsed.depth).toBe(6);
    expect(parsed.beamWidth).toBe(4);
    expect(parsed.maxAddressFetches).toBe(20);
    expect(parsed.maxEdgesPerAddress).toBe(25);
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
    expect(WHERE_IS_MONEY_USAGE).toContain("[--days 90] [--depth 20] [--beam 12] [--max-addresses 150] [--max-edges 100] [--approval-candidates 30] [--contract-tx-info 30] [--cross-chain-max-provider-calls 200]");
    expect(WHERE_IS_MONEY_USAGE).toContain("--contract-tx-info-delay-ms 15000");
  });
});

describe("where is money manual CLI fetch limits", () => {
  it("uses the queued-runner indexed default unless the live cap is higher", () => {
    expect(whereIsMoneyIndexedFetchLimit(100)).toBe(150);
    expect(whereIsMoneyIndexedFetchLimit(150)).toBe(150);
  });

  it("caps latest fallback live fetches and keys them by requested and live limits", () => {
    const liveLimit = whereIsMoneyLiveFallbackLimit(150, 100);

    expect(liveLimit).toBe(100);
    expect(whereIsMoneyLiveFallbackLimit(80, 100)).toBe(80);
    expect(whereIsMoneyLatestFallbackCacheKey(source, 150, liveLimit)).toBe(`${source}:150:100`);
  });
});
