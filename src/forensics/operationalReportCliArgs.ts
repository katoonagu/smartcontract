import { classifyInput } from "../tron/address";

export type ParsedOperationalReportCliArgs = {
  source: string;
  days: number;
  windowStart: Date;
  windowEnd: Date;
  depth: number;
  beamWidth: number;
  maxAddressFetches: number;
  minPreservation: number;
};

export const OPERATIONAL_REPORT_DEFAULT_DAYS = 30;
export const OPERATIONAL_REPORT_DEFAULT_DEPTH = 4;
export const OPERATIONAL_REPORT_MAX_DEPTH = 4;
export const OPERATIONAL_REPORT_DEFAULT_BEAM_WIDTH = 8;
export const OPERATIONAL_REPORT_MAX_BEAM_WIDTH = 8;
export const OPERATIONAL_REPORT_DEFAULT_MAX_ADDRESS_FETCHES = 60;
export const OPERATIONAL_REPORT_MAX_ADDRESS_FETCHES = 60;
export const OPERATIONAL_REPORT_DEFAULT_MIN_PRESERVATION = 0.7;

export const OPERATIONAL_REPORT_USAGE = [
  "Usage:",
  "  npm run forensic:operational -- --source <TRON-address> [--days 30] [--depth 4] [--beam 8] [--max-addresses 60] [--min-preservation 0.7]",
  "  node --import tsx scripts/forensicOperationalReport.ts --source <TRON-address> [--days 30] [--depth 4] [--beam 8] [--max-addresses 60] [--min-preservation 0.7]"
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

function parseAddress(args: readonly string[]): string {
  const value = argValue(args, "--source");
  if (!value) throw new Error(OPERATIONAL_REPORT_USAGE);
  const classified = classifyInput(value);
  if (classified.kind !== "tron_address") {
    throw new Error(`--source must be a valid TRON address.\n${OPERATIONAL_REPORT_USAGE}`);
  }
  return classified.value;
}

function parseIntegerInRange(input: {
  args: readonly string[];
  name: string;
  fallback: number;
  min: number;
  max: number;
}): number {
  const value = argValue(input.args, input.name);
  if (value === undefined) return input.fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < input.min || parsed > input.max) {
    throw new Error(`${input.name} must be an integer between ${input.min} and ${input.max}.\n${OPERATIONAL_REPORT_USAGE}`);
  }
  return parsed;
}

function parseNumberInRange(input: {
  args: readonly string[];
  name: string;
  fallback: number;
  min: number;
  max: number;
}): number {
  const value = argValue(input.args, input.name);
  if (value === undefined) return input.fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < input.min || parsed > input.max) {
    throw new Error(`${input.name} must be a number between ${input.min} and ${input.max}.\n${OPERATIONAL_REPORT_USAGE}`);
  }
  return parsed;
}

function parseOptionalDate(args: readonly string[], name: string): Date | null {
  const value = argValue(args, name);
  if (value === undefined) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${name} must be a valid ISO date.\n${OPERATIONAL_REPORT_USAGE}`);
  }
  return parsed;
}

export function parseOperationalReportCliArgs(argv: readonly string[]): ParsedOperationalReportCliArgs {
  const args = normalizeArgs(argv);
  const source = parseAddress(args);
  const days = parseIntegerInRange({
    args,
    name: "--days",
    fallback: OPERATIONAL_REPORT_DEFAULT_DAYS,
    min: 1,
    max: 365
  });
  const windowEnd = parseOptionalDate(args, "--end") ?? new Date();
  const windowStart = parseOptionalDate(args, "--start") ?? new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);
  if (windowStart >= windowEnd) {
    throw new Error(`--start must be before --end.\n${OPERATIONAL_REPORT_USAGE}`);
  }

  const depth = parseIntegerInRange({
    args,
    name: "--depth",
    fallback: OPERATIONAL_REPORT_DEFAULT_DEPTH,
    min: 1,
    max: OPERATIONAL_REPORT_MAX_DEPTH
  });
  const beamWidth = parseIntegerInRange({
    args,
    name: "--beam",
    fallback: OPERATIONAL_REPORT_DEFAULT_BEAM_WIDTH,
    min: 1,
    max: OPERATIONAL_REPORT_MAX_BEAM_WIDTH
  });
  const maxAddressFetches = parseIntegerInRange({
    args,
    name: "--max-addresses",
    fallback: OPERATIONAL_REPORT_DEFAULT_MAX_ADDRESS_FETCHES,
    min: 1,
    max: OPERATIONAL_REPORT_MAX_ADDRESS_FETCHES
  });
  const minPreservation = parseNumberInRange({
    args,
    name: "--min-preservation",
    fallback: OPERATIONAL_REPORT_DEFAULT_MIN_PRESERVATION,
    min: 0,
    max: 1
  });

  return {
    source,
    days,
    windowStart,
    windowEnd,
    depth,
    beamWidth,
    maxAddressFetches,
    minPreservation
  };
}
