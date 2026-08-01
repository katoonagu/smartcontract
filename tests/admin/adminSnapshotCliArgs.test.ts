import { describe, expect, it } from "vitest";
import { parseAdminSnapshotCliArgs } from "../../src/admin/adminSnapshotCliArgs";

describe("parseAdminSnapshotCliArgs", () => {
  it("uses safe defaults for an ad-hoc latest-admin snapshot", () => {
    expect(parseAdminSnapshotCliArgs([])).toEqual({
      address: undefined,
      jobId: undefined,
      limit: 50,
      out: undefined,
      outDir: "artifacts/admin-snapshots"
    });
  });

  it("parses address, job, limit, and output paths", () => {
    expect(parseAdminSnapshotCliArgs([
      "--address", "TSubject111111111111111111111111111111",
      "--limit", "100",
      "--out-dir", "tmp/snaps",
      "--out", "tmp/snapshot.html"
    ])).toEqual({
      address: "TSubject111111111111111111111111111111",
      jobId: undefined,
      limit: 100,
      out: "tmp/snapshot.html",
      outDir: "tmp/snaps"
    });

    expect(parseAdminSnapshotCliArgs(["--job", "job-1"]).jobId).toBe("job-1");
  });

  it("rejects ambiguous or invalid arguments", () => {
    expect(() => parseAdminSnapshotCliArgs(["--address", "TSubject", "--job", "job-1"]))
      .toThrow("Use --address or --job, not both.");
    expect(() => parseAdminSnapshotCliArgs(["--limit", "7"]))
      .toThrow("--limit must be 20, 50, or 100.");
    expect(() => parseAdminSnapshotCliArgs(["--wat"]))
      .toThrow("Unknown argument: --wat");
  });
});
