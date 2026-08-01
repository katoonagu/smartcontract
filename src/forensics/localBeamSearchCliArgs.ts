import { classifyInput } from "../tron/address";

export type ParsedLocalBeamSearchCliArgs = {
  source: string;
  direction: "inbound" | "outbound";
  start: Date;
  end: Date;
  depth: number;
  beamWidth: number;
  maxAddressFetches: number;
};

export const LOCAL_BEAM_SEARCH_DEFAULT_DEPTH = 4;
export const LOCAL_BEAM_SEARCH_MAX_DEPTH = 4;
export const LOCAL_BEAM_SEARCH_DEFAULT_BEAM_WIDTH = 8;
export const LOCAL_BEAM_SEARCH_MAX_BEAM_WIDTH = 8;
export const LOCAL_BEAM_SEARCH_DEFAULT_MAX_ADDRESS_FETCHES = 60;
export const LOCAL_BEAM_SEARCH_MAX_ADDRESS_FETCHES = 60;

export const LOCAL_BEAM_SEARCH_USAGE = [
  "Usage:",
  "  npm run forensic:beam -- --source <TRON-address> [--direction inbound|outbound] [--start ISO] [--end ISO] [--depth 4] [--beam 8] [--max-addresses 60]",
  "  node --import tsx scripts/forensicLocalBeamSearch.ts --source <TRON-address> [--direction inbound|outbound] [--start ISO] [--end ISO] [--depth 4] [--beam 8] [--max-addresses 60]"
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
  if (!value) throw new Error(LOCAL_BEAM_SEARCH_USAGE);
  const classified = classifyInput(value);
  if (classified.kind !== "tron_address") {
    throw new Error(`--source must be a valid TRON address.\n${LOCAL_BEAM_SEARCH_USAGE}`);
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
    throw new Error(`${input.name} must be an integer between ${input.min} and ${input.max}.\n${LOCAL_BEAM_SEARCH_USAGE}`);
  }
  return parsed;
}

function parseOptionalDate(args: readonly string[], name: string): Date | null {
  const value = argValue(args, name);
  return value === undefined ? null : new Date(value);
}

export function parseLocalBeamSearchCliArgs(argv: readonly string[]): ParsedLocalBeamSearchCliArgs {
  const args = normalizeArgs(argv);
  const source = parseAddress(args);
  const direction = argValue(args, "--direction") ?? "inbound";
  if (direction !== "inbound" && direction !== "outbound") {
    throw new Error(`--direction must be inbound or outbound.\n${LOCAL_BEAM_SEARCH_USAGE}`);
  }

  const end = parseOptionalDate(args, "--end") ?? new Date();
  const start = parseOptionalDate(args, "--start") ?? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new Error(`--start and --end must be valid dates, and start must be before end.\n${LOCAL_BEAM_SEARCH_USAGE}`);
  }

  const depth = parseIntegerInRange({
    args,
    name: "--depth",
    fallback: LOCAL_BEAM_SEARCH_DEFAULT_DEPTH,
    min: 1,
    max: LOCAL_BEAM_SEARCH_MAX_DEPTH
  });
  const beamWidth = parseIntegerInRange({
    args,
    name: "--beam",
    fallback: LOCAL_BEAM_SEARCH_DEFAULT_BEAM_WIDTH,
    min: 1,
    max: LOCAL_BEAM_SEARCH_MAX_BEAM_WIDTH
  });
  const maxAddressFetches = parseIntegerInRange({
    args,
    name: "--max-addresses",
    fallback: LOCAL_BEAM_SEARCH_DEFAULT_MAX_ADDRESS_FETCHES,
    min: 1,
    max: LOCAL_BEAM_SEARCH_MAX_ADDRESS_FETCHES
  });

  return { source, direction, start, end, depth, beamWidth, maxAddressFetches };
}
