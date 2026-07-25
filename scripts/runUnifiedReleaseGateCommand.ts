import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalBytesV2 } from "../src/release/releaseRootWriterStore";
import {
  APPROVED_PLAN_A_LOCK_COMMIT_SHA,
  UNIFIED_RELEASE_COMMANDS,
  validateUnifiedReleaseCommandReceiptV1
} from "../src/release/unifiedReleaseGateReceipt";
import {
  repositoryRootPhysicalSha256,
  unifiedReleaseNpmVersion,
  verifyPlanAApprovedGoldenRoot
} from "./finalizeUnifiedReleaseGates";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GENERATION = /^[a-z0-9][a-z0-9-]{15,63}$/u;

export function unifiedReleaseCommandInvocation(
  id: typeof UNIFIED_RELEASE_COMMANDS[number]["id"]
): {
  executable: string;
  args: string[];
} {
  const npm = process.platform === "win32"
    ? {
        executable: process.execPath,
        prefix: [resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")]
      }
    : { executable: "npm", prefix: [] };
  const npx = process.platform === "win32"
    ? {
        executable: process.execPath,
        prefix: [resolve(dirname(process.execPath), "node_modules/npm/bin/npx-cli.js")]
      }
    : { executable: "npx", prefix: [] };
  if (id === "full_test") return { executable: npm.executable, args: [...npm.prefix, "test"] };
  if (id === "typecheck") {
    return { executable: npm.executable, args: [...npm.prefix, "run", "typecheck"] };
  }
  if (id === "golden_verify") {
    return {
      executable: process.execPath,
      args: [
        "--import", "tsx", "scripts/tronUsdtGoldenPilotV2.ts", "verify",
        "--input", "docs/audit/2026-07-system-audit/golden-v2/locked"
      ]
    };
  }
  if (id === "golden_compare") {
    return {
      executable: npm.executable,
      args: [
        ...npm.prefix, "run", "unified:golden:compare", "--",
        "--golden", "docs/audit/2026-07-system-audit/golden-v2/locked",
        "--candidate", "artifacts/unified-wallet-replay"
      ]
    };
  }
  if (id === "presentation_acceptance") {
    return {
      executable: npx.executable,
      args: [...npx.prefix, "vitest", "run", "tests/unified-check/presentation.golden.test.ts"]
    };
  }
  return {
    executable: npx.executable,
    args: [
      ...npx.prefix, "vitest", "run",
      "tests/storage/migration034.postgres.test.ts",
      "tests/runtime/startupSchemaGate.test.ts",
      "tests/unified-check/productionRuntime.postgres.test.ts",
      "--maxWorkers=1"
    ]
  };
}

function parseArgs(argv: string[]): {
  artifactRoot: string;
  generation: string;
  commandId: typeof UNIFIED_RELEASE_COMMANDS[number]["id"];
  authorityCommitSha: string;
} {
  if (argv.length !== 8 || argv[0] !== "--artifact-root" || argv[2] !== "--generation"
      || argv[4] !== "--command" || argv[6] !== "--plan-a-authority-commit") {
    throw new Error("unified_release_command_cli_invalid");
  }
  const artifactRoot = resolve(argv[1]!);
  const generation = argv[3]!;
  const commandId = argv[5] as typeof UNIFIED_RELEASE_COMMANDS[number]["id"];
  const authorityCommitSha = argv[7]!;
  if (!isAbsolute(artifactRoot) || !GENERATION.test(generation)
      || !UNIFIED_RELEASE_COMMANDS.some(({ id }) => id === commandId)
      || authorityCommitSha !== APPROVED_PLAN_A_LOCK_COMMIT_SHA) {
    throw new Error("unified_release_command_cli_invalid");
  }
  return { artifactRoot, generation, commandId, authorityCommitSha };
}

export async function runUnifiedReleaseGateCommand(options: {
  artifactRoot: string;
  generation: string;
  commandId: typeof UNIFIED_RELEASE_COMMANDS[number]["id"];
  authorityCommitSha: string;
}): Promise<void> {
  const physicalRoot = resolve(await realpath(options.artifactRoot));
  const relativeToRepository = relative(repositoryRoot, physicalRoot);
  if (physicalRoot !== resolve(options.artifactRoot) || relativeToRepository === ""
      || (!relativeToRepository.startsWith("..") && !isAbsolute(relativeToRepository))) {
    throw new Error("unified_release_command_artifact_root_invalid");
  }
  const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot, encoding: "utf8", windowsHide: true
  }).trim();
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repositoryRoot, encoding: "utf8", windowsHide: true
  });
  if (!/^[a-f0-9]{40}$/u.test(candidateSha) || status !== "") {
    throw new Error("unified_release_command_candidate_not_clean");
  }
  verifyPlanAApprovedGoldenRoot(options.authorityCommitSha);
  const expected = UNIFIED_RELEASE_COMMANDS.find(({ id }) => id === options.commandId)!;
  const logPath = resolve(physicalRoot, `${expected.id}.log`);
  const receiptPath = resolve(physicalRoot, `${expected.id}.command-receipt-v1.json`);
  const receiptHandle = await open(receiptPath, "wx", 0o600);
  const logHandle = await open(logPath, "wx", 0o600);
  const startedAt = new Date().toISOString();
  const outputHash = createHash("sha256");
  let byteLength = 0;
  let writes = Promise.resolve();
  const append = (chunk: Buffer): void => {
    outputHash.update(chunk);
    byteLength += chunk.length;
    writes = writes.then(async () => {
      await logHandle.write(chunk);
    });
  };
  const command = unifiedReleaseCommandInvocation(expected.id);
  const exitCode = await new Promise<number>((resolveExit) => {
    const child = spawn(command.executable, command.args, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      append(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      append(chunk);
    });
    child.once("error", (error) => {
      const chunk = Buffer.from(`${error.message}\n`, "utf8");
      process.stderr.write(chunk);
      append(chunk);
      resolveExit(127);
    });
    child.once("close", (code, signal) => {
      resolveExit(code ?? (signal ? 128 : 1));
    });
  });
  await writes;
  await logHandle.sync();
  await logHandle.close();
  const finishedAt = new Date().toISOString();
  const receipt = {
    version: "unified-release-command-receipt-v1",
    candidateSha,
    releaseGenerationId: options.generation,
    id: expected.id,
    command: expected.command,
    cwd: ".",
    cwdPhysicalSha256: repositoryRootPhysicalSha256(),
    startedAt,
    finishedAt,
    exitCode,
    output: {
      relativePath: `${expected.id}.log`,
      sha256: outputHash.digest("hex"),
      byteLength
    },
    runtime: {
      nodeVersion: process.version,
      npmVersion: unifiedReleaseNpmVersion(),
      platform: process.platform,
      arch: process.arch
    }
  };
  validateUnifiedReleaseCommandReceiptV1(receipt, {
    candidateSha,
    releaseGenerationId: options.generation,
    expected,
    cwdPhysicalSha256: repositoryRootPhysicalSha256()
  });
  await receiptHandle.writeFile(canonicalBytesV2(receipt));
  await receiptHandle.sync();
  await receiptHandle.close();
  if (exitCode !== 0) throw new Error(`unified_release_command_failed:${expected.id}:${exitCode}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runUnifiedReleaseGateCommand(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "unified_release_command_failed"}\n`);
    process.exitCode = 1;
  });
}
