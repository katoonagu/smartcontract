import { classifyInput } from "../tron/address";
import { parseUsdtDecimalToRaw } from "./usdtAmount";

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
  approvalEnrichmentMode: "off" | "triggered" | "always";
  maxApprovalCandidates: number;
  maxContractTransactionInfoFetches: number;
  contractTransactionInfoMinIntervalMs: number;
  crossChainStage2Enabled: boolean;
  crossChainManualDeepMode: boolean;
  crossChainMaxProviderCalls: number | null;
};

export const WHERE_IS_MONEY_DEFAULT_DAYS = 30;
export const WHERE_IS_MONEY_DEFAULT_DEPTH = 20;
export const WHERE_IS_MONEY_MAX_DEPTH = 20;
export const WHERE_IS_MONEY_DEFAULT_BEAM_WIDTH = 8;
export const WHERE_IS_MONEY_MAX_BEAM_WIDTH = 8;
export const WHERE_IS_MONEY_DEFAULT_MAX_ADDRESS_FETCHES = 60;
export const WHERE_IS_MONEY_MAX_ADDRESS_FETCHES = 60;
export const WHERE_IS_MONEY_DEFAULT_MAX_EDGES_PER_ADDRESS = 40;
export const WHERE_IS_MONEY_MAX_EDGES_PER_ADDRESS = 100;
export const WHERE_IS_MONEY_DEFAULT_APPROVAL_ENRICHMENT_MODE = "triggered" as const;
export const WHERE_IS_MONEY_DEFAULT_MAX_APPROVAL_CANDIDATES = 12;
export const WHERE_IS_MONEY_MAX_APPROVAL_CANDIDATES = 100;
export const WHERE_IS_MONEY_DEFAULT_MAX_CONTRACT_TX_INFO = 12;
export const WHERE_IS_MONEY_MAX_CONTRACT_TX_INFO = 100;
export const WHERE_IS_MONEY_DEFAULT_CONTRACT_TX_INFO_DELAY_MS = 15000;
export const WHERE_IS_MONEY_MAX_CONTRACT_TX_INFO_DELAY_MS = 60000;
export const WHERE_IS_MONEY_DEFAULT_CROSS_CHAIN_MAX_PROVIDER_CALLS = 60;
export const WHERE_IS_MONEY_MAX_CROSS_CHAIN_PROVIDER_CALLS = 500;

export const WHERE_IS_MONEY_USAGE = [
  "Usage:",
  "  npm run forensic:where-is-money -- -- --source <TRON-address> [--amount 1000.25] [--days 30] [--depth 20] [--beam 8] [--max-addresses 60] [--max-edges 40] [--approval-mode triggered] [--approval-candidates 12] [--contract-tx-info 12] [--contract-tx-info-delay-ms 15000] [--cross-chain-stage2] [--cross-chain-manual-deep] [--cross-chain-max-provider-calls 60]",
  "  node --import tsx scripts/forensicWhereIsMoney.ts --source <TRON-address> [--amount 1000.25] [--days 30] [--depth 20] [--beam 8] [--max-addresses 60] [--max-edges 40] [--approval-mode triggered] [--approval-candidates 12] [--contract-tx-info 12] [--contract-tx-info-delay-ms 15000] [--cross-chain-stage2] [--cross-chain-manual-deep] [--cross-chain-max-provider-calls 60]"
].join("\n");

const VALUE_FLAGS = new Set([
  "--source",
  "--amount",
  "--days",
  "--depth",
  "--beam",
  "--max-addresses",
  "--max-edges",
  "--approval-mode",
  "--approval-candidates",
  "--contract-tx-info",
  "--contract-tx-info-delay-ms",
  "--cross-chain-max-provider-calls",
  "--start",
  "--end"
]);

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
  const equalsPrefix = `${name}=`;
  return args.includes(name) || args.some((arg) => arg.startsWith(equalsPrefix));
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

function parseApprovalMode(args: readonly string[]): "off" | "triggered" | "always" {
  const value = argValue(args, "--approval-mode");
  if (value === undefined) return WHERE_IS_MONEY_DEFAULT_APPROVAL_ENRICHMENT_MODE;
  if (value === "off" || value === "triggered" || value === "always") return value;
  throw new Error(`--approval-mode must be off, triggered, or always.\n${WHERE_IS_MONEY_USAGE}`);
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
  return parseUsdtDecimalToRaw(value);
}

function parseRequestedAmount(args: readonly string[], positional: readonly string[]): { requestedAmountRaw: string | null; positionalAmountIndex: number | null } {
  const namedValue = argValue(args, "--amount");
  if (namedValue !== undefined) {
    const parsed = parseUsdtAmountToRaw(namedValue);
    if (!parsed) {
      throw new Error(`--amount must be a positive USDT amount with up to 6 decimals.\n${WHERE_IS_MONEY_USAGE}`);
    }
    return { requestedAmountRaw: parsed, positionalAmountIndex: null };
  }

  const nonAddressPositionals = positional
    .map((arg, index) => ({ arg, index }))
    .filter((item) => classifyInput(item.arg).kind !== "tron_address");
  const numericPositionals = nonAddressPositionals.filter((item) => /^\d+(?:\.\d+)?$/.test(item.arg));
  const positionalValue = nonAddressPositionals.find(({ arg }) => {
    if (arg.startsWith("amount:")) return true;
    if (arg.includes(".")) return true;
    if (!/^\d+$/.test(arg)) return false;
    if (numericPositionals.length >= 6 && arg === numericPositionals[0]?.arg) return true;
    return Number(arg) > 365;
  });
  if (positionalValue === undefined) return { requestedAmountRaw: null, positionalAmountIndex: null };
  const amountValue = positionalValue.arg.startsWith("amount:") ? positionalValue.arg.slice("amount:".length) : positionalValue.arg;
  const parsed = parseUsdtAmountToRaw(amountValue);
  if (!parsed) {
    throw new Error(`--amount must be a positive USDT amount with up to 6 decimals.\n${WHERE_IS_MONEY_USAGE}`);
  }
  return { requestedAmountRaw: parsed, positionalAmountIndex: positionalValue.index };
}

export function parseWhereIsMoneyCliArgs(argv: readonly string[]): ParsedWhereIsMoneyCliArgs {
  const args = normalizeArgs(argv);
  const positional = positionalArgs(args);
  const source = parseAddress(args);
  const { requestedAmountRaw, positionalAmountIndex } = parseRequestedAmount(args, positional);
  const positionalNumbers = positional
    .filter((_arg, index) => index !== positionalAmountIndex)
    .filter((arg) => classifyInput(arg).kind !== "tron_address")
    .filter((arg) => /^-?\d+(\.\d+)?$/.test(arg));
  let positionalSettingIndex = 0;
  const nextPositionalSetting = (flagName: string): string | undefined => {
    if (argValue(args, flagName) !== undefined) return undefined;
    const value = positionalNumbers[positionalSettingIndex];
    if (value !== undefined) positionalSettingIndex += 1;
    return value;
  };
  const positionalDays = nextPositionalSetting("--days");
  const days = parseIntegerInRange({
    args: positionalDays !== undefined ? ["--days", positionalDays] : args,
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

  const positionalDepth = nextPositionalSetting("--depth");
  const depth = parseIntegerInRange({
    args: positionalDepth !== undefined ? ["--depth", positionalDepth] : args,
    name: "--depth",
    fallback: WHERE_IS_MONEY_DEFAULT_DEPTH,
    min: 1,
    max: WHERE_IS_MONEY_MAX_DEPTH
  });
  const positionalBeam = nextPositionalSetting("--beam");
  const beamWidth = parseIntegerInRange({
    args: positionalBeam !== undefined ? ["--beam", positionalBeam] : args,
    name: "--beam",
    fallback: WHERE_IS_MONEY_DEFAULT_BEAM_WIDTH,
    min: 1,
    max: WHERE_IS_MONEY_MAX_BEAM_WIDTH
  });
  const positionalMaxAddresses = nextPositionalSetting("--max-addresses");
  const maxAddressFetches = parseIntegerInRange({
    args: positionalMaxAddresses !== undefined ? ["--max-addresses", positionalMaxAddresses] : args,
    name: "--max-addresses",
    fallback: WHERE_IS_MONEY_DEFAULT_MAX_ADDRESS_FETCHES,
    min: 1,
    max: WHERE_IS_MONEY_MAX_ADDRESS_FETCHES
  });
  const positionalMaxEdges = nextPositionalSetting("--max-edges");
  const maxEdgesPerAddress = parseIntegerInRange({
    args: positionalMaxEdges !== undefined ? ["--max-edges", positionalMaxEdges] : args,
    name: "--max-edges",
    fallback: WHERE_IS_MONEY_DEFAULT_MAX_EDGES_PER_ADDRESS,
    min: 1,
    max: WHERE_IS_MONEY_MAX_EDGES_PER_ADDRESS
  });
  const approvalEnrichmentMode = parseApprovalMode(args);
  const maxApprovalCandidates = parseIntegerInRange({
    args,
    name: "--approval-candidates",
    fallback: WHERE_IS_MONEY_DEFAULT_MAX_APPROVAL_CANDIDATES,
    min: 0,
    max: WHERE_IS_MONEY_MAX_APPROVAL_CANDIDATES
  });
  const maxContractTransactionInfoFetches = parseIntegerInRange({
    args,
    name: "--contract-tx-info",
    fallback: WHERE_IS_MONEY_DEFAULT_MAX_CONTRACT_TX_INFO,
    min: 0,
    max: WHERE_IS_MONEY_MAX_CONTRACT_TX_INFO
  });
  const contractTransactionInfoMinIntervalMs = parseIntegerInRange({
    args,
    name: "--contract-tx-info-delay-ms",
    fallback: WHERE_IS_MONEY_DEFAULT_CONTRACT_TX_INFO_DELAY_MS,
    min: 0,
    max: WHERE_IS_MONEY_MAX_CONTRACT_TX_INFO_DELAY_MS
  });
  const crossChainStage2Enabled = args.includes("--cross-chain-stage2");
  const crossChainManualDeepMode = args.includes("--cross-chain-manual-deep");
  const hasCrossChainMaxProviderCalls = hasFlag(args, "--cross-chain-max-provider-calls");
  if (hasCrossChainMaxProviderCalls && argValue(args, "--cross-chain-max-provider-calls") === undefined) {
    throw new Error(`--cross-chain-max-provider-calls must be an integer between 1 and ${WHERE_IS_MONEY_MAX_CROSS_CHAIN_PROVIDER_CALLS}.\n${WHERE_IS_MONEY_USAGE}`);
  }
  const crossChainMaxProviderCalls = !hasCrossChainMaxProviderCalls
    ? null
    : parseIntegerInRange({
        args,
        name: "--cross-chain-max-provider-calls",
        fallback: WHERE_IS_MONEY_DEFAULT_CROSS_CHAIN_MAX_PROVIDER_CALLS,
        min: 1,
        max: WHERE_IS_MONEY_MAX_CROSS_CHAIN_PROVIDER_CALLS
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
    maxEdgesPerAddress,
    approvalEnrichmentMode,
    maxApprovalCandidates,
    maxContractTransactionInfoFetches,
    contractTransactionInfoMinIntervalMs,
    crossChainStage2Enabled,
    crossChainManualDeepMode,
    crossChainMaxProviderCalls
  };
}
