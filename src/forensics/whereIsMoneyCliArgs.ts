import { classifyInput } from "../tron/address";

export type ParsedWhereIsMoneyCliArgs = {
  source: string;
  requestedAmountRaw?: string | null;
  days: number;
  windowStart: Date;
  windowEnd: Date;
  depth: number;
  beamWidth: number;
  maxAddressFetches: number;
  maxEdgesPerAddress: number;
};

export const WHERE_IS_MONEY_DEFAULT_DAYS = 30;
export const WHERE_IS_MONEY_DEFAULT_DEPTH = 7;
export const WHERE_IS_MONEY_MAX_DEPTH = 20;
export const WHERE_IS_MONEY_DEFAULT_BEAM_WIDTH = 8;
export const WHERE_IS_MONEY_MAX_BEAM_WIDTH = 8;
export const WHERE_IS_MONEY_DEFAULT_MAX_ADDRESS_FETCHES = 60;
export const WHERE_IS_MONEY_MAX_ADDRESS_FETCHES = 60;
export const WHERE_IS_MONEY_DEFAULT_MAX_EDGES_PER_ADDRESS = 40;
export const WHERE_IS_MONEY_MAX_EDGES_PER_ADDRESS = 100;

export const WHERE_IS_MONEY_USAGE = [
  "Usage:",
  "  npm run forensic:where-is-money -- -- --source <TRON-address> [--amount 1000.25] [--days 30] [--depth 7] [--beam 8] [--max-addresses 60] [--max-edges 40]",
  "  node --import tsx scripts/forensicWhereIsMoney.ts --source <TRON-address> [--amount 1000.25] [--days 30] [--depth 7] [--beam 8] [--max-addresses 60] [--max-edges 40]"
].join("\n");

const VALUE_FLAGS = new Set([
  "--source",
  "--amount",
  "--days",
  "--depth",
  "--beam",
  "--max-addresses",
  "--max-edges",
  "--start",
  "--end"
]);

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

function positionalArgs(args: readonly string[]): string[] {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (VALUE_FLAGS.has(arg)) index += 1;
      continue;
    }
    positional.push(arg);
  }
  return positional;
}

function parseAddress(args: readonly string[]): string {
  const value = argValue(args, "--source");
  const positionalValue = positionalArgs(args).find((arg) => classifyInput(arg).kind === "tron_address");
  const classified = classifyInput(value ?? positionalValue ?? "");
  if (classified.kind !== "tron_address") {
    throw new Error(`--source must be a valid TRON address.\n${WHERE_IS_MONEY_USAGE}`);
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
    throw new Error(`${input.name} must be an integer between ${input.min} and ${input.max}.\n${WHERE_IS_MONEY_USAGE}`);
  }
  return parsed;
}

function parseOptionalDate(args: readonly string[], name: string): Date | null {
  const value = argValue(args, name);
  if (value === undefined) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${name} must be a valid ISO date.\n${WHERE_IS_MONEY_USAGE}`);
  }
  return parsed;
}

export function parseUsdtAmountToRaw(value: string | null | undefined): string | null {
  if (!value || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const raw = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return raw > 0n ? raw.toString() : null;
}

function parseRequestedAmountRaw(args: readonly string[], positional: readonly string[]): string | null {
  const namedValue = argValue(args, "--amount");
  const nonAddressPositionals = positional.filter((arg) => classifyInput(arg).kind !== "tron_address");
  const numericPositionals = nonAddressPositionals.filter((arg) => /^\d+(?:\.\d+)?$/.test(arg));
  const positionalValue = nonAddressPositionals.find((arg) => {
      if (arg.startsWith("amount:")) return true;
      if (arg.includes(".")) return true;
      if (!/^\d+$/.test(arg)) return false;
      if (numericPositionals.length >= 6 && arg === numericPositionals[0]) return true;
      return Number(arg) > 365;
    });
  const value = namedValue ?? positionalValue;
  if (value === undefined) return null;
  const amountValue = value.startsWith("amount:") ? value.slice("amount:".length) : value;
  const parsed = parseUsdtAmountToRaw(amountValue);
  if (!parsed) {
    throw new Error(`--amount must be a positive USDT amount with up to 6 decimals.\n${WHERE_IS_MONEY_USAGE}`);
  }
  return parsed;
}

export function parseWhereIsMoneyCliArgs(argv: readonly string[]): ParsedWhereIsMoneyCliArgs {
  const args = normalizeArgs(argv);
  const positional = positionalArgs(args);
  const source = parseAddress(args);
  const requestedAmountRaw = parseRequestedAmountRaw(args, positional);
  const positionalNumbers = positional
    .filter((arg) => classifyInput(arg).kind !== "tron_address")
    .filter((arg) => !(requestedAmountRaw && parseUsdtAmountToRaw(arg.startsWith("amount:") ? arg.slice("amount:".length) : arg) === requestedAmountRaw))
    .filter((arg) => /^-?\d+(\.\d+)?$/.test(arg));
  const numberAt = (index: number): string | undefined => positionalNumbers[index];
  const days = parseIntegerInRange({
    args: argValue(args, "--days") === undefined && numberAt(0) !== undefined ? ["--days", numberAt(0) as string] : args,
    name: "--days",
    fallback: WHERE_IS_MONEY_DEFAULT_DAYS,
    min: 1,
    max: 365
  });
  const windowEnd = parseOptionalDate(args, "--end") ?? new Date();
  const windowStart = parseOptionalDate(args, "--start") ?? new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);
  if (windowStart >= windowEnd) {
    throw new Error(`--start must be before --end.\n${WHERE_IS_MONEY_USAGE}`);
  }

  const depth = parseIntegerInRange({
    args: argValue(args, "--depth") === undefined && numberAt(1) !== undefined ? ["--depth", numberAt(1) as string] : args,
    name: "--depth",
    fallback: WHERE_IS_MONEY_DEFAULT_DEPTH,
    min: 1,
    max: WHERE_IS_MONEY_MAX_DEPTH
  });
  const beamWidth = parseIntegerInRange({
    args: argValue(args, "--beam") === undefined && numberAt(2) !== undefined ? ["--beam", numberAt(2) as string] : args,
    name: "--beam",
    fallback: WHERE_IS_MONEY_DEFAULT_BEAM_WIDTH,
    min: 1,
    max: WHERE_IS_MONEY_MAX_BEAM_WIDTH
  });
  const maxAddressFetches = parseIntegerInRange({
    args: argValue(args, "--max-addresses") === undefined && numberAt(3) !== undefined ? ["--max-addresses", numberAt(3) as string] : args,
    name: "--max-addresses",
    fallback: WHERE_IS_MONEY_DEFAULT_MAX_ADDRESS_FETCHES,
    min: 1,
    max: WHERE_IS_MONEY_MAX_ADDRESS_FETCHES
  });
  const maxEdgesPerAddress = parseIntegerInRange({
    args: argValue(args, "--max-edges") === undefined && numberAt(4) !== undefined ? ["--max-edges", numberAt(4) as string] : args,
    name: "--max-edges",
    fallback: WHERE_IS_MONEY_DEFAULT_MAX_EDGES_PER_ADDRESS,
    min: 1,
    max: WHERE_IS_MONEY_MAX_EDGES_PER_ADDRESS
  });

  return {
    source,
    requestedAmountRaw,
    days,
    windowStart,
    windowEnd,
    depth,
    beamWidth,
    maxAddressFetches,
    maxEdgesPerAddress
  };
}
