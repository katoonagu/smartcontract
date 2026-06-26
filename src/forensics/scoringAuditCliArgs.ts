import { classifyInput } from "../tron/address";

export type ScoringAuditFormat = "json" | "markdown" | "both";

export type ParsedScoringAuditCliArgs =
  | {
      mode: "job";
      jobId: string;
      address: null;
      limit: number;
      outDir: string;
      format: ScoringAuditFormat;
    }
  | {
      mode: "latest";
      jobId: null;
      address: string;
      limit: number;
      outDir: string;
      format: ScoringAuditFormat;
    }
  | {
      mode: "all";
      jobId: null;
      address: null;
      limit: number;
      outDir: string;
      format: ScoringAuditFormat;
    };

export const SCORING_AUDIT_DEFAULT_OUT_DIR = "artifacts/scoring-audit";

export const SCORING_AUDIT_USAGE = [
  "Usage:",
  "  npm run forensic:scoring-audit -- --job <jobId> [--out-dir artifacts/scoring-audit] [--format both]",
  "  npm run forensic:scoring-audit -- --address <TRON-address> --latest [--limit 50] [--out-dir artifacts/scoring-audit] [--format both]",
  "  npm run forensic:scoring-audit -- --all [--limit 50] [--out-dir artifacts/scoring-audit] [--format both]",
  "  node --import tsx scripts/scoringAudit.ts --job <jobId> [--out-dir artifacts/scoring-audit] [--format both]",
  "  node --import tsx scripts/scoringAudit.ts --address <TRON-address> --latest [--limit 50] [--out-dir artifacts/scoring-audit] [--format both]",
  "  node --import tsx scripts/scoringAudit.ts --all [--limit 50] [--out-dir artifacts/scoring-audit] [--format both]"
].join("\n");

function normalizeArgs(argv: readonly string[]): string[] {
  const separatorIndex = argv.indexOf("--");
  const args = separatorIndex === -1 ? [...argv] : argv.slice(separatorIndex + 1);
  const first = args[0];
  if (first && !first.startsWith("--") && /\.(?:cjs|mjs|js|ts|tsx)$/i.test(first)) {
    return args.slice(1);
  }
  return args;
}

function argValue(args: readonly string[], name: string): string | undefined {
  const equalsPrefix = `${name}=`;
  const equalsValue = args.find((arg) => arg.startsWith(equalsPrefix));
  if (equalsValue) return equalsValue.slice(equalsPrefix.length);

  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

function parseLimit(args: readonly string[]): number {
  const value = argValue(args, "--limit");
  if (value === undefined) return 50;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`--limit must be a positive integer.\n${SCORING_AUDIT_USAGE}`);
  }
  return parsed;
}

function parseFormat(args: readonly string[]): ScoringAuditFormat {
  const value = argValue(args, "--format");
  if (value === undefined) return "both";
  if (value === "json" || value === "markdown" || value === "both") return value;
  throw new Error(`--format must be json, markdown, or both.\n${SCORING_AUDIT_USAGE}`);
}

export function parseScoringAuditCliArgs(argv: readonly string[]): ParsedScoringAuditCliArgs {
  const args = normalizeArgs(argv);
  const jobId = argValue(args, "--job");
  const address = argValue(args, "--address");
  const all = hasFlag(args, "--all");
  const latest = hasFlag(args, "--latest");
  const limit = parseLimit(args);
  const outDir = argValue(args, "--out-dir") ?? SCORING_AUDIT_DEFAULT_OUT_DIR;
  const format = parseFormat(args);

  if (jobId && (address || all)) {
    throw new Error(`Use either --job, --address --latest, or --all.\n${SCORING_AUDIT_USAGE}`);
  }
  if (all && address) {
    throw new Error(`Use either --job, --address --latest, or --all.\n${SCORING_AUDIT_USAGE}`);
  }
  if (jobId) {
    return {
      mode: "job",
      jobId,
      address: null,
      limit,
      outDir,
      format
    };
  }
  if (address) {
    if (!latest) throw new Error(`--address requires --latest.\n${SCORING_AUDIT_USAGE}`);
    const classified = classifyInput(address);
    if (classified.kind !== "tron_address") {
      throw new Error(`--address must be a valid TRON address.\n${SCORING_AUDIT_USAGE}`);
    }
    return {
      mode: "latest",
      jobId: null,
      address: classified.value,
      limit,
      outDir,
      format
    };
  }
  if (all) {
    return {
      mode: "all",
      jobId: null,
      address: null,
      limit,
      outDir,
      format
    };
  }

  throw new Error(SCORING_AUDIT_USAGE);
}
