import { describe, expect, it } from "vitest";
import { LOCAL_BEAM_SEARCH_USAGE, parseLocalBeamSearchCliArgs } from "../../src/forensics/localBeamSearchCliArgs";

const source = "TUzXY779GY3Tm6UDRYDPqNEojZgZEpY127";

describe("local temporal beam search CLI args", () => {
  it("defaults to bounded offline/deep search settings", () => {
    const parsed = parseLocalBeamSearchCliArgs([
      "--",
      "--source",
      source,
      "--start",
      "2026-05-01T00:00:00.000Z",
      "--end",
      "2026-05-26T00:00:00.000Z"
    ]);

    expect(parsed).toMatchObject({
      source,
      direction: "inbound",
      depth: 4,
      beamWidth: 8,
      maxAddressFetches: 60
    });
    expect(parsed.start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(parsed.end.toISOString()).toBe("2026-05-26T00:00:00.000Z");
  });

  it("rejects explicit depth above the 4-hop offline cap", () => {
    expect(() => parseLocalBeamSearchCliArgs([
      "--source",
      source,
      "--depth",
      "7"
    ])).toThrow(/--depth must be an integer between 1 and 4/);
    expect(LOCAL_BEAM_SEARCH_USAGE).toContain("--depth 4");
  });

  it("keeps beam and address budgets bounded", () => {
    expect(() => parseLocalBeamSearchCliArgs([
      `--source=${source}`,
      "--beam=10"
    ])).toThrow(/--beam must be an integer between 1 and 8/);

    expect(() => parseLocalBeamSearchCliArgs([
      `--source=${source}`,
      "--max-addresses=150"
    ])).toThrow(/--max-addresses must be an integer between 1 and 60/);
  });
});
