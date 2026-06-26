import { describe, expect, it } from "vitest";
import {
  parseScoringAuditCliArgs,
  SCORING_AUDIT_DEFAULT_OUT_DIR,
  SCORING_AUDIT_USAGE
} from "../../src/forensics/scoringAuditCliArgs";

const address = "TNNkKmEj5ax48ZuJfWpRpkxzzwXWTNH45J";

describe("scoring audit CLI args", () => {
  it("parses job mode with defaults", () => {
    expect(parseScoringAuditCliArgs(["--job", "job-1"])).toEqual({
      mode: "job",
      jobId: "job-1",
      address: null,
      limit: 50,
      outDir: SCORING_AUDIT_DEFAULT_OUT_DIR,
      format: "both"
    });
  });

  it("parses latest address mode with optional settings", () => {
    expect(parseScoringAuditCliArgs([
      "--address",
      address,
      "--latest",
      "--limit",
      "25",
      "--out-dir",
      "tmp/audit",
      "--format",
      "json"
    ])).toEqual({
      mode: "latest",
      jobId: null,
      address,
      limit: 25,
      outDir: "tmp/audit",
      format: "json"
    });
  });

  it("parses all mode with optional settings", () => {
    expect(parseScoringAuditCliArgs([
      "--all",
      "--limit=10",
      "--format=markdown"
    ])).toEqual({
      mode: "all",
      jobId: null,
      address: null,
      limit: 10,
      outDir: SCORING_AUDIT_DEFAULT_OUT_DIR,
      format: "markdown"
    });
  });

  it("rejects an invalid address", () => {
    expect(() => parseScoringAuditCliArgs([
      "--address",
      "not-a-tron-address",
      "--latest"
    ])).toThrow("--address must be a valid TRON address");
  });

  it("rejects address mode without --latest", () => {
    expect(() => parseScoringAuditCliArgs([
      "--address",
      address
    ])).toThrow("--address requires --latest");
  });

  it("rejects invalid format", () => {
    expect(() => parseScoringAuditCliArgs([
      "--all",
      "--format",
      "text"
    ])).toThrow("--format must be json, markdown, or both");
  });

  it("rejects invalid limit", () => {
    expect(() => parseScoringAuditCliArgs([
      "--all",
      "--limit",
      "0"
    ])).toThrow("--limit must be a positive integer");

    expect(() => parseScoringAuditCliArgs([
      "--all",
      "--limit",
      "1.5"
    ])).toThrow("--limit must be a positive integer");
  });

  it("rejects mutually exclusive modes", () => {
    expect(() => parseScoringAuditCliArgs([
      "--job",
      "job-1",
      "--address",
      address,
      "--latest"
    ])).toThrow("Use either --job, --address --latest, or --all");

    expect(() => parseScoringAuditCliArgs([
      "--all",
      "--address",
      address,
      "--latest"
    ])).toThrow("Use either --job, --address --latest, or --all");
  });

  it("documents the scoring audit command", () => {
    expect(SCORING_AUDIT_USAGE).toContain("forensic:scoring-audit");
    expect(SCORING_AUDIT_USAGE).toContain("--job <jobId>");
    expect(SCORING_AUDIT_USAGE).toContain("--address <TRON-address> --latest");
    expect(SCORING_AUDIT_USAGE).toContain("--all");
  });
});
