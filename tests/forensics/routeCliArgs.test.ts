import { describe, expect, it } from "vitest";
import { FORENSIC_ROUTE_USAGE, parseForensicRouteCliArgs } from "../../src/forensics/routeCliArgs";

const source = "TGw88ZRK3tNjUbbk2yxs1i7rJyz7cMv2Ck";
const target = "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe";

describe("forensic route CLI args", () => {
  it("parses named args with defaults", () => {
    const parsed = parseForensicRouteCliArgs(["--source", source, "--target", target]);

    expect(parsed).toMatchObject({
      mode: "route",
      sourceAddress: source,
      targetAddress: target,
      exposureOnly: false,
      amountUsdt: null,
      days: 30,
      maxDepth: 3,
      maxPagesPerAddress: 3,
      limit: 5,
      dryRun: false
    });
  });

  it("parses args after an npm separator and equals-style values", () => {
    const parsed = parseForensicRouteCliArgs([
      "--",
      `--source=${source}`,
      `--target=${target}`,
      "--amount=900000",
      "--days=60",
      "--max-depth=1",
      "--max-pages=1",
      "--limit=2",
      "--dry-run"
    ]);

    expect(parsed).toMatchObject({
      mode: "route",
      sourceAddress: source,
      targetAddress: target,
      exposureOnly: false,
      amountUsdt: "900000",
      days: 60,
      maxDepth: 1,
      maxPagesPerAddress: 1,
      limit: 2,
      dryRun: true
    });
  });

  it("prints npm-safe usage when required args are missing", () => {
    expect(() => parseForensicRouteCliArgs([])).toThrow(FORENSIC_ROUTE_USAGE);
    expect(FORENSIC_ROUTE_USAGE).toContain("npm run forensic:route -- -- --source");
  });

  it("parses exposure-only args without a target when dry-run is set", () => {
    const parsed = parseForensicRouteCliArgs([
      "--",
      `--source=${source}`,
      "--exposure-only",
      "--dry-run"
    ]);

    expect(parsed).toMatchObject({
      mode: "exposure",
      sourceAddress: source,
      targetAddress: null,
      exposureOnly: true,
      amountUsdt: null,
      days: 30,
      maxDepth: 3,
      maxPagesPerAddress: 3,
      limit: 5,
      dryRun: true
    });
  });

  it("still rejects route args without a target", () => {
    expect(() => parseForensicRouteCliArgs(["--source", source])).toThrow(FORENSIC_ROUTE_USAGE);
  });

  it("rejects exposure-only runs unless dry-run is set", () => {
    expect(() => parseForensicRouteCliArgs(["--source", source, "--exposure-only"])).toThrow(
      /report-only.*--dry-run/i
    );
  });

  it("prints an npm-safe exposure-only usage example", () => {
    expect(FORENSIC_ROUTE_USAGE).toContain(
      "npm run forensic:route -- -- --source <address> --exposure-only --dry-run"
    );
  });
});
