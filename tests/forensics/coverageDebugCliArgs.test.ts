import { describe, expect, it } from "vitest";
import { parseCoverageDebugCliArgs } from "../../src/forensics/coverageDebugCliArgs";

describe("coverage debug CLI args", () => {
  it("parses job lookup mode", () => {
    expect(parseCoverageDebugCliArgs(["--job", "job-1"])).toEqual({
      mode: "job",
      jobId: "job-1",
      address: null,
      outDir: "artifacts/forensic-debug"
    });
  });

  it("parses latest job by address mode", () => {
    expect(parseCoverageDebugCliArgs(["--address", "TNNkKmEj5ax48ZuJfWpRpkxzzwXWTNH45J", "--latest"])).toEqual({
      mode: "latest",
      jobId: null,
      address: "TNNkKmEj5ax48ZuJfWpRpkxzzwXWTNH45J",
      outDir: "artifacts/forensic-debug"
    });
  });

  it("rejects address mode without --latest", () => {
    expect(() => parseCoverageDebugCliArgs(["--address", "TNNkKmEj5ax48ZuJfWpRpkxzzwXWTNH45J"])).toThrow("--address requires --latest");
  });
});
