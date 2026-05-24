import { describe, expect, it } from "vitest";
import { FORENSIC_ROUTE_USAGE, parseForensicRouteCliArgs } from "../../src/forensics/routeCliArgs";

const source = "TGw88ZRK3tNjUbbk2yxs1i7rJyz7cMv2Ck";
const target = "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe";

describe("forensic route CLI args", () => {
  it("parses named args with defaults", () => {
    const parsed = parseForensicRouteCliArgs(["--source", source, "--target", target]);

    expect(parsed).toMatchObject({
      sourceAddress: source,
      targetAddress: target,
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
      sourceAddress: source,
      targetAddress: target,
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
});
