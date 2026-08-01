import { describe, expect, it } from "vitest";
import { OPERATIONAL_REPORT_USAGE, parseOperationalReportCliArgs } from "../../src/forensics/operationalReportCliArgs";

const source = "TUzXY779GY3Tm6UDRYDPqNEojZgZEpY127";

describe("operational forensic report CLI args", () => {
  it("defaults to bounded offline operational search settings", () => {
    const parsed = parseOperationalReportCliArgs([
      "--",
      "--source",
      source,
      "--end",
      "2026-05-26T00:00:00.000Z"
    ]);

    expect(parsed).toMatchObject({
      source,
      days: 30,
      depth: 4,
      beamWidth: 8,
      maxAddressFetches: 60,
      minPreservation: 0.7
    });
    expect(parsed.windowEnd.toISOString()).toBe("2026-05-26T00:00:00.000Z");
    expect(parsed.windowStart.toISOString()).toBe("2026-04-26T00:00:00.000Z");
  });

  it("rejects values that would make operational search too broad", () => {
    expect(() => parseOperationalReportCliArgs([
      "--source",
      source,
      "--depth",
      "7"
    ])).toThrow(/--depth must be an integer between 1 and 4/);

    expect(() => parseOperationalReportCliArgs([
      "--source",
      source,
      "--beam",
      "20"
    ])).toThrow(/--beam must be an integer between 1 and 8/);

    expect(() => parseOperationalReportCliArgs([
      "--source",
      source,
      "--max-addresses",
      "120"
    ])).toThrow(/--max-addresses must be an integer between 1 and 60/);

    expect(() => parseOperationalReportCliArgs([
      "--source",
      source,
      "--min-preservation",
      "1.2"
    ])).toThrow(/--min-preservation must be a number between 0 and 1/);
  });

  it("documents the operational report command and depth cap", () => {
    expect(OPERATIONAL_REPORT_USAGE).toContain("forensic:operational");
    expect(OPERATIONAL_REPORT_USAGE).toContain("--depth 4");
    expect(OPERATIONAL_REPORT_USAGE).toContain("--min-preservation 0.7");
  });
});
