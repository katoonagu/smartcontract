import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, readFileSync, realpathSync } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchema032ReleaseEvidenceV1 } from "../src/release/remediationReleaseManifestV2";
import { canonicalBytesV2 } from "../src/release/releaseRootWriterStore";
import {
  APPROVED_GOLDEN_CASE_CATALOG_SHA256,
  APPROVED_GOLDEN_COMPARATOR_CONTRACT_SHA256,
  APPROVED_GOLDEN_MANIFEST_DESCRIPTOR_SHA256,
  APPROVED_GOLDEN_PROTOCOL_SHA256,
  APPROVED_PLAN_A_LOCK_COMMIT_SHA,
  APPROVED_PLAN_A_LOCK_TREE_SHA,
  APPROVED_PLAN_A_LOCKED_ROOT_TREE_SHA,
  APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256,
  PLAN_A_GATE_RECEIPT_RELATIVE_PATH,
  UNIFIED_RELEASE_COMMANDS,
  validatePlanAGateReceiptV1,
  validateUnifiedReleaseCommandReceiptV1,
  validateUnifiedWalletReleaseGateReceiptV1
} from "../src/release/unifiedReleaseGateReceipt";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GENERATION = /^[a-z0-9][a-z0-9-]{15,63}$/u;
const LOCKED_GOLDEN_ROOT = "docs/audit/2026-07-system-audit/golden-v2/locked";
const MAX_COMMAND_ARTIFACT_BYTES = 100 * 1024 * 1024;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function hashTree(root: string): Promise<string> {
  const physical = resolve(await realpath(root));
  const entries: Array<{ relativePath: string; sha256: string }> = [];
  async function visit(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new Error("unified_release_replay_symlink_forbidden");
      if (metadata.isDirectory()) await visit(path);
      else if (metadata.isFile() && metadata.size > 0) {
        entries.push({
          relativePath: relative(physical, path).replaceAll("\\", "/"),
          sha256: sha256(await readFile(path))
        });
      } else throw new Error("unified_release_replay_entry_invalid");
    }
  }
  await visit(physical);
  if (entries.length !== 24 || entries.some((entry) => !/^[a-z0-9-]+\.json$/u.test(entry.relativePath))) {
    throw new Error("unified_release_replay_set_invalid");
  }
  return sha256(canonicalBytesV2(entries));
}

function sameFileIdentity(
  left: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number },
  right: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function readSafeRegularFile(root: string, relativePath: string): Promise<Buffer> {
  if (!relativePath || isAbsolute(relativePath)) throw new Error("unified_release_artifact_path_invalid");
  const target = resolve(root, relativePath);
  if (relative(root, target).startsWith("..") || target === root) {
    throw new Error("unified_release_artifact_path_invalid");
  }
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_COMMAND_ARTIFACT_BYTES) {
    throw new Error("unified_release_artifact_file_invalid");
  }
  if (resolve(await realpath(target)) !== target) throw new Error("unified_release_artifact_symlink_forbidden");
  const handle = await open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileIdentity(before, opened)) {
      throw new Error("unified_release_artifact_identity_changed");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFileIdentity(opened, after) || bytes.length !== opened.size) {
      throw new Error("unified_release_artifact_identity_changed");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export function repositoryRootPhysicalSha256(): string {
  return sha256(Buffer.from(resolve(realpathSync(repositoryRoot)), "utf8"));
}

export function verifyPlanAApprovedGoldenRoot(
  authorityCommitSha: string
): {
  commitSha: typeof APPROVED_PLAN_A_LOCK_COMMIT_SHA;
  repositoryTreeSha: typeof APPROVED_PLAN_A_LOCK_TREE_SHA;
  lockedRootTreeSha: typeof APPROVED_PLAN_A_LOCKED_ROOT_TREE_SHA;
} {
  if (authorityCommitSha !== APPROVED_PLAN_A_LOCK_COMMIT_SHA) {
    throw new Error("plan_a_approved_authority_commit_invalid");
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", authorityCommitSha, "HEAD"], {
      cwd: repositoryRoot, stdio: "ignore", windowsHide: true
    });
    const repositoryTreeSha = execFileSync(
      "git",
      ["rev-parse", `${authorityCommitSha}^{tree}`],
      { cwd: repositoryRoot, encoding: "utf8", windowsHide: true }
    ).trim();
    const lockedRootTreeSha = execFileSync(
      "git",
      ["rev-parse", `${authorityCommitSha}:${LOCKED_GOLDEN_ROOT}`],
      { cwd: repositoryRoot, encoding: "utf8", windowsHide: true }
    ).trim();
    if (repositoryTreeSha !== APPROVED_PLAN_A_LOCK_TREE_SHA
        || lockedRootTreeSha !== APPROVED_PLAN_A_LOCKED_ROOT_TREE_SHA) {
      throw new Error("plan_a_approved_authority_tree_invalid");
    }
    execFileSync("git", ["diff", "--quiet", authorityCommitSha, "--", LOCKED_GOLDEN_ROOT], {
      cwd: repositoryRoot, stdio: "ignore", windowsHide: true
    });
    const expectedHashes: Array<[string, string]> = [
      ["locked-manifest.json", APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256],
      ["locked-manifest-descriptor.json", APPROVED_GOLDEN_MANIFEST_DESCRIPTOR_SHA256],
      ["control/protocol.json", APPROVED_GOLDEN_PROTOCOL_SHA256],
      ["control/case-catalog.json", APPROVED_GOLDEN_CASE_CATALOG_SHA256],
      ["control/comparator-contract.json", APPROVED_GOLDEN_COMPARATOR_CONTRACT_SHA256]
    ];
    for (const [relativePath, expectedSha256] of expectedHashes) {
      if (sha256(readFileSync(join(repositoryRoot, LOCKED_GOLDEN_ROOT, relativePath))) !== expectedSha256) {
        throw new Error("plan_a_approved_locked_artifact_invalid");
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("plan_a_")) throw error;
    throw new Error("plan_a_approved_authority_or_locked_root_invalid");
  }
  return {
    commitSha: APPROVED_PLAN_A_LOCK_COMMIT_SHA,
    repositoryTreeSha: APPROVED_PLAN_A_LOCK_TREE_SHA,
    lockedRootTreeSha: APPROVED_PLAN_A_LOCKED_ROOT_TREE_SHA
  };
}

export async function readUnifiedReleaseCommandResult(
  root: string,
  expected: { id: string; command: string },
  context: { candidateSha: string; releaseGenerationId: string; cwdPhysicalSha256: string }
): Promise<{
  id: string;
  command: string;
  exitCode: 0;
  outputSha256: string;
  provenanceReceiptSha256: string;
}> {
  const receiptRelativePath = `${expected.id}.command-receipt-v1.json`;
  const [log, receiptBytes] = await Promise.all([
    readSafeRegularFile(root, `${expected.id}.log`),
    readSafeRegularFile(root, receiptRelativePath)
  ]);
  const receipt = validateUnifiedReleaseCommandReceiptV1(
    JSON.parse(receiptBytes.toString("utf8")),
    { ...context, expected },
    receiptBytes
  );
  if (receipt.exitCode !== 0 || receipt.output.byteLength !== log.length
      || receipt.output.sha256 !== sha256(log)) {
    throw new Error(`unified_release_gate_failed:${expected.id}`);
  }
  return {
    ...expected,
    exitCode: 0,
    outputSha256: receipt.output.sha256,
    provenanceReceiptSha256: sha256(receiptBytes)
  };
}

async function writeExclusive(path: string, value: unknown): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(canonicalBytesV2(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function parseArgs(argv: string[]): {
  artifactRoot: string;
  generation: string;
  authorityCommitSha: string;
} {
  if (argv.length !== 6 || argv[0] !== "--artifact-root" || argv[2] !== "--generation"
      || argv[4] !== "--plan-a-authority-commit") {
    throw new Error("unified_release_gate_cli_invalid");
  }
  const artifactRoot = resolve(argv[1]!);
  const generation = argv[3]!;
  const authorityCommitSha = argv[5]!;
  if (!isAbsolute(artifactRoot) || !GENERATION.test(generation)
      || authorityCommitSha !== APPROVED_PLAN_A_LOCK_COMMIT_SHA) {
    throw new Error("unified_release_gate_cli_invalid");
  }
  return { artifactRoot, generation, authorityCommitSha };
}

export async function finalizeUnifiedReleaseGates(
  artifactRoot: string,
  generation: string,
  authorityCommitSha = APPROVED_PLAN_A_LOCK_COMMIT_SHA
): Promise<{ candidateSha: string; planAGateSha256: string; unifiedGateSha256: string }> {
  if (!GENERATION.test(generation)) throw new Error("unified_release_generation_invalid");
  const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot, encoding: "utf8", windowsHide: true
  }).trim();
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repositoryRoot, encoding: "utf8", windowsHide: true
  });
  if (!/^[a-f0-9]{40}$/u.test(candidateSha) || status !== "") {
    throw new Error("unified_release_candidate_not_clean");
  }
  const physicalRoot = resolve(await realpath(artifactRoot));
  const relativeToRepository = relative(repositoryRoot, physicalRoot);
  if (physicalRoot !== resolve(artifactRoot) || relativeToRepository === ""
      || (!relativeToRepository.startsWith("..") && !isAbsolute(relativeToRepository))) {
    throw new Error("unified_release_artifact_root_invalid");
  }
  const approvalAuthority = verifyPlanAApprovedGoldenRoot(authorityCommitSha);
  const cwdPhysicalSha256 = repositoryRootPhysicalSha256();

  const results = await Promise.all(UNIFIED_RELEASE_COMMANDS.map((command) =>
    readUnifiedReleaseCommandResult(physicalRoot, command, {
      candidateSha,
      releaseGenerationId: generation,
      cwdPhysicalSha256
    })));
  const byId = new Map(results.map((result) => [result.id, result]));
  const recordedAt = new Date().toISOString();
  const planA = {
    version: "plan-a-gate-receipt-v1",
    candidateSha,
    approvalAuthority,
    artifacts: {
      caseCatalogSha256: APPROVED_GOLDEN_CASE_CATALOG_SHA256,
      comparatorContractSha256: APPROVED_GOLDEN_COMPARATOR_CONTRACT_SHA256,
      lockedGoldenManifestSha256: APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256,
      lockedManifestDescriptorSha256: APPROVED_GOLDEN_MANIFEST_DESCRIPTOR_SHA256,
      protocolSha256: APPROVED_GOLDEN_PROTOCOL_SHA256
    },
    commands: ["full_test", "typecheck", "golden_verify"].map((id) => {
      const result = byId.get(id);
      if (!result) throw new Error(`unified_release_gate_missing:${id}`);
      return {
        id: id === "golden_verify" ? "locked_verify" : id,
        command: result.command,
        exitCode: result.exitCode,
        outputSha256: result.outputSha256,
        provenanceReceiptSha256: result.provenanceReceiptSha256
      };
    }),
    recordedAt,
    runtime: {
      nodeVersion: process.version,
      npmVersion: execFileSync("npm", ["--version"], {
        cwd: repositoryRoot, encoding: "utf8", windowsHide: true
      }).trim()
    },
    selectedAttributionPolicy: "proportional"
  };
  validatePlanAGateReceiptV1(planA, { candidateSha });
  const planABytes = canonicalBytesV2(planA);

  const [cleanBytes, cloneBytes] = await Promise.all([
    readFile(join(physicalRoot, "schema-clean", "schema032-release-evidence.json")),
    readFile(join(physicalRoot, "schema-production-clone", "schema032-release-evidence.json"))
  ]);
  const clean = validateSchema032ReleaseEvidenceV1(JSON.parse(cleanBytes.toString("utf8")));
  const clone = validateSchema032ReleaseEvidenceV1(JSON.parse(cloneBytes.toString("utf8")));
  if (clean.candidateSha !== candidateSha || clean.databaseRole !== "clean"
      || clone.candidateSha !== candidateSha || clone.databaseRole !== "production_clone") {
    throw new Error("unified_release_schema033_candidate_binding_invalid");
  }
  const unified = {
    version: "unified-wallet-release-gate-receipt-v1",
    candidateSha,
    releaseGenerationId: generation,
    planAGate: { relativePath: PLAN_A_GATE_RECEIPT_RELATIVE_PATH, sha256: sha256(planABytes) },
    lockedGoldenManifestSha256: APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256,
    versions: {
      analysisManifest: "analysis-manifest-v1",
      attributionPolicy: "selected-attribution-policy-v1",
      comparator: "unified-wallet-comparator-v1",
      presentationManifest: "presentation-manifest-v1",
      renderer: "unified-telegram-renderer-v1",
      schemaVersion: 33,
      scoreAnchor: "score-anchor-v3",
      scoringPolicy: "scoring-signal-matrix-v4"
    },
    schema033: {
      filename: "033_unified_wallet_check.sql",
      checksumSha256: clean.schema033.checksumSha256,
      catalogSha256: clean.schema033.catalogSha256,
      cleanVerificationReceiptSha256: clean.schema033.verificationReceiptSha256,
      cloneVerificationReceiptSha256: clone.schema033.verificationReceiptSha256
    },
    replayRootSha256: await hashTree(join(physicalRoot, "unified-wallet-replay")),
    commands: results,
    recordedAt
  };
  validateUnifiedWalletReleaseGateReceiptV1(unified, {
    candidateSha,
    releaseGenerationId: generation,
    planAGateReceiptSha256: sha256(planABytes)
  });
  const unifiedBytes = canonicalBytesV2(unified);
  await writeExclusive(join(physicalRoot, basename(PLAN_A_GATE_RECEIPT_RELATIVE_PATH)), planA);
  await writeExclusive(join(physicalRoot, "unified-wallet-release-gate-receipt-v1.json"), unified);
  return {
    candidateSha,
    planAGateSha256: sha256(planABytes),
    unifiedGateSha256: sha256(unifiedBytes)
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  finalizeUnifiedReleaseGates(
    options.artifactRoot,
    options.generation,
    options.authorityCommitSha
  )
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "unified_release_gate_failed"}\n`);
      process.exitCode = 1;
    });
}
