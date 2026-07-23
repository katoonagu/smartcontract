import process from "node:process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { canonicalJson } from "../tools/golden-pilot-v2/canonicalJson";
import { compareUnifiedWalletGoldenRoot } from "../src/unifiedCheck/comparator";

function argumentsFor(values: readonly string[]): {
  goldenRoot: string;
  candidateRoot: string;
} {
  if (
    values.length === 2 &&
    values.every((value) => !value.startsWith("--"))
  ) {
    return {
      goldenRoot: resolve(values[0]!),
      candidateRoot: resolve(values[1]!)
    };
  }
  let goldenRoot: string | null = null;
  let candidateRoot: string | null = null;
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!value || (flag !== "--golden" && flag !== "--candidate")) {
      throw new TypeError("unified_golden_comparator_arguments_invalid");
    }
    if (flag === "--golden" && goldenRoot === null) goldenRoot = value;
    else if (flag === "--candidate" && candidateRoot === null) {
      candidateRoot = value;
    } else {
      throw new TypeError("unified_golden_comparator_arguments_invalid");
    }
  }
  if (goldenRoot === null || candidateRoot === null) {
    throw new TypeError("unified_golden_comparator_arguments_invalid");
  }
  return {
    goldenRoot: resolve(goldenRoot),
    candidateRoot: resolve(candidateRoot)
  };
}

export async function runUnifiedWalletGoldenComparatorCli(
  args: readonly string[],
  write: (value: string) => void = (value) => process.stdout.write(value)
): Promise<0 | 1> {
  const paths = argumentsFor(args);
  const result = await compareUnifiedWalletGoldenRoot(paths);
  write(`${canonicalJson(result)}\n`);
  return result.passed ? 0 : 1;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  runUnifiedWalletGoldenComparatorCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    });
}
