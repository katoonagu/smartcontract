import { classifyInput } from "../tron/address";

export type ParsedCoverageDebugCliArgs =
  | {
      mode: "job";
      jobId: string;
      address: null;
      outDir: string;
    }
  | {
      mode: "latest";
      jobId: null;
      address: string;
      outDir: string;
    };

export const COVERAGE_DEBUG_DEFAULT_OUT_DIR = "artifacts/forensic-debug";

export const COVERAGE_DEBUG_USAGE = [
  "Usage:",
  "  npm run forensic:debug -- --job <jobId>",
  "  npm run forensic:debug -- --address <TRON-address> --latest",
  "  node --import tsx scripts/forensicCoverageDebug.ts --job <jobId>",
  "  node --import tsx scripts/forensicCoverageDebug.ts --address <TRON-address> --latest"
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

export function parseCoverageDebugCliArgs(argv: readonly string[]): ParsedCoverageDebugCliArgs {
  const args = normalizeArgs(argv);
  const jobId = argValue(args, "--job");
  const address = argValue(args, "--address");
  const outDir = argValue(args, "--out-dir") ?? COVERAGE_DEBUG_DEFAULT_OUT_DIR;
  const latest = hasFlag(args, "--latest");

  if (jobId && address) {
    throw new Error(`Use either --job or --address --latest, not both.\n${COVERAGE_DEBUG_USAGE}`);
  }
  if (jobId) {
    return {
      mode: "job",
      jobId,
      address: null,
      outDir
    };
  }
  if (address) {
    if (!latest) throw new Error(`--address requires --latest.\n${COVERAGE_DEBUG_USAGE}`);
    const classified = classifyInput(address);
    if (classified.kind !== "tron_address") {
      throw new Error(`--address must be a valid TRON address.\n${COVERAGE_DEBUG_USAGE}`);
    }
    return {
      mode: "latest",
      jobId: null,
      address: classified.value,
      outDir
    };
  }

  throw new Error(COVERAGE_DEBUG_USAGE);
}
