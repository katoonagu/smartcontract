import { classifyInput } from "../tron/address";

type ParsedForensicRouteCliArgsBase = {
  sourceAddress: string;
  amountUsdt: string | null;
  days: number;
  maxDepth: number;
  maxPagesPerAddress: number;
  limit: number;
  dryRun: boolean;
};

export type ParsedForensicRouteCliArgs =
  | (ParsedForensicRouteCliArgsBase & {
      mode: "route";
      targetAddress: string;
      exposureOnly: false;
    })
  | (ParsedForensicRouteCliArgsBase & {
      mode: "exposure";
      targetAddress: null;
      exposureOnly: true;
    });

export const FORENSIC_ROUTE_USAGE = [
  "Usage:",
  "  npm run forensic:route -- -- --source <address> --target <address> [--amount 320000] [--days 30] [--dry-run]",
  "  npm run forensic:route -- -- --source <address> --exposure-only --dry-run",
  "  node --import tsx scripts/forensicRouteSearch.ts --source <address> --target <address> [--amount 320000] [--days 30] [--dry-run]"
].join("\n");

function normalizeArgs(argv: readonly string[]): string[] {
  const separatorIndex = argv.indexOf("--");
  return separatorIndex === -1 ? [...argv] : argv.slice(separatorIndex + 1);
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

function parsePositiveInteger(args: readonly string[], name: string, fallback: number): number {
  const value = argValue(args, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.\n${FORENSIC_ROUTE_USAGE}`);
  }
  return parsed;
}

function parseAddress(args: readonly string[], name: string): string {
  const value = argValue(args, name);
  if (!value) throw new Error(FORENSIC_ROUTE_USAGE);
  const classified = classifyInput(value);
  if (classified.kind !== "tron_address") {
    throw new Error(`${name} must be a valid TRON address.\n${FORENSIC_ROUTE_USAGE}`);
  }
  return classified.value;
}

export function parseForensicRouteCliArgs(argv: readonly string[]): ParsedForensicRouteCliArgs {
  const args = normalizeArgs(argv);
  const dryRun = hasFlag(args, "--dry-run");
  const base = {
    sourceAddress: parseAddress(args, "--source"),
    amountUsdt: argValue(args, "--amount") ?? null,
    days: parsePositiveInteger(args, "--days", 30),
    maxDepth: parsePositiveInteger(args, "--max-depth", 3),
    maxPagesPerAddress: parsePositiveInteger(args, "--max-pages", 3),
    limit: parsePositiveInteger(args, "--limit", 5),
    dryRun
  };

  if (hasFlag(args, "--exposure-only")) {
    if (!dryRun) {
      throw new Error(`Exposure-only mode is report-only and requires --dry-run.\n${FORENSIC_ROUTE_USAGE}`);
    }

    return {
      ...base,
      mode: "exposure",
      targetAddress: null,
      exposureOnly: true
    };
  }

  return {
    ...base,
    mode: "route",
    targetAddress: parseAddress(args, "--target"),
    exposureOnly: false
  };
}
