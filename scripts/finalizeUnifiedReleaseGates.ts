import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, readFileSync, realpathSync } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchema032ReleaseEvidenceV2 } from "../src/release/remediationReleaseManifestV2";
import {
  canonicalizeArtifactJson
} from "../src/forensics/canonicalJson";
import { canonicalBytesV2 } from "../src/release/releaseRootWriterStore";
import {
  APPROVED_GOLDEN_CASE_CATALOG_SHA256,
  APPROVED_GOLDEN_COMPARATOR_CONTRACT_SHA256,
  APPROVED_GOLDEN_MANIFEST_DESCRIPTOR_SHA256,
  APPROVED_GOLDEN_PROTOCOL_SHA256,
  APPROVED_ADAPTIVE_RELEASE_PUBLIC_KEY_SHA256,
  APPROVED_SCHEMA_034_CATALOG_SHA256,
  APPROVED_SCHEMA_034_CHECKSUM,
  APPROVED_SCHEMA_035_CATALOG_SHA256,
  APPROVED_SCHEMA_035_CHECKSUM,
  APPROVED_PLAN_A_LOCK_COMMIT_SHA,
  APPROVED_PLAN_A_LOCK_TREE_SHA,
  APPROVED_PLAN_A_LOCKED_ROOT_TREE_SHA,
  APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256,
  PLAN_A_GATE_RECEIPT_RELATIVE_PATH,
  UNIFIED_RELEASE_COMMANDS,
  canonicalAdaptiveRollingReceiptPayload,
  validatePlanAGateReceiptV1,
  validateUnifiedAdaptiveRollingReleaseReceiptV1,
  validateUnifiedReleaseCommandReceiptV1,
  validateUnifiedWalletReleaseGateReceiptV1,
  type UnifiedAdaptiveRollingReleaseReceiptV1
} from "../src/release/unifiedReleaseGateReceipt";
import {
  parseUnifiedAdaptiveBenchmarkEvidenceV1,
  parseUnifiedAdaptiveLifecycleGateEvidenceV1,
  parseUnifiedMemoryGateEvidenceV1,
  satisfiesUnifiedProductionMemoryGate,
  type UnifiedAdaptiveBenchmarkEvidenceV1
} from "../src/unifiedCheck/adaptiveBenchmarkEvidence";
import {
  parseUnifiedRollingOracleReceiptV1
} from "../src/unifiedCheck/providerReplay";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GENERATION = /^[a-z0-9][a-z0-9-]{15,63}$/u;
const LOCKED_GOLDEN_ROOT = "docs/audit/2026-07-system-audit/golden-v2/locked";
const MAX_COMMAND_ARTIFACT_BYTES = 100 * 1024 * 1024;
const ADAPTIVE_CAPACITIES = [1, 4, 8, 16, 32, 100] as const;
const ADAPTIVE_WALLETS = [
  "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
  "TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr",
  "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd"
] as const;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalArtifactText(bytes: Buffer): string {
  const text = bytes.toString("utf8");
  // ponytail: benchmark writers terminate canonical JSON with one LF; accept
  // only that exact transport suffix rather than normalizing arbitrary input.
  return text.endsWith("\n") && !text.endsWith("\n\n")
    ? text.slice(0, -1)
    : text;
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

export function unifiedReleaseNpmVersion(): string {
  const executable = process.platform === "win32" ? process.execPath : "npm";
  const args = process.platform === "win32"
    ? [resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), "--version"]
    : ["--version"];
  return execFileSync(executable, args, {
    cwd: repositoryRoot, encoding: "utf8", windowsHide: true
  }).trim();
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

export async function readUnifiedAdaptivePromotionReceipt(
  root: string,
  context: {
    candidateSha: string;
    releaseGenerationId: string;
  }
): Promise<{
  receipt: UnifiedAdaptiveRollingReleaseReceiptV1;
  sha256: string;
}> {
  const [receiptBytes, publicKeyBytes] = await Promise.all([
    readSafeRegularFile(
      root,
      "adaptive-rolling-promotion-approval-v1.json"
    ),
    readSafeRegularFile(
      root,
      "adaptive-rolling-authority-public-key.pem"
    )
  ]);
  if (
    sha256(publicKeyBytes) !==
      APPROVED_ADAPTIVE_RELEASE_PUBLIC_KEY_SHA256
  ) {
    throw new Error("unified_adaptive_release_public_key_invalid");
  }
  const receipt = validateUnifiedAdaptiveRollingReleaseReceiptV1(
    JSON.parse(receiptBytes.toString("utf8")),
    context,
    receiptBytes
  );
  return { receipt, sha256: sha256(receiptBytes) };
}

type LoadedAdaptiveIndex = {
  readonly sha256: string;
  readonly index: {
    readonly mode: "replay" | "live";
    readonly requestedCapacities: readonly number[];
    readonly candidateCommit: string;
    readonly executionIdentitySha256: string;
  };
  readonly evidence: readonly UnifiedAdaptiveBenchmarkEvidenceV1[];
};

export async function loadAdaptiveBenchmarkIndexForFinalizer(
  root: string,
  relativePath: string,
  expected: {
    mode: "replay" | "live";
    candidateSha: string;
  }
): Promise<LoadedAdaptiveIndex> {
  const bytes = await readSafeRegularFile(root, relativePath);
  const text = canonicalArtifactText(bytes);
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (canonicalizeArtifactJson(raw) !== text) {
    throw new Error("unified_adaptive_index_noncanonical");
  }
  const indexKeys = [
    "artifacts",
    "candidateCommit",
    "executionIdentitySha256",
    "generatedAt",
    "indexSha256",
    "mode",
    "requestedCapacities",
    "seed",
    "version"
  ];
  if (
    Object.keys(raw).sort().some((key, index) =>
      key !== indexKeys[index]
    ) ||
    Object.keys(raw).length !== indexKeys.length
  ) {
    throw new Error("unified_adaptive_index_invalid");
  }
  const {
    indexSha256,
    ...withoutHash
  } = raw;
  if (
    raw.version !== "unified-adaptive-benchmark-index-v1" ||
    raw.mode !== expected.mode ||
    raw.candidateCommit !== expected.candidateSha ||
    typeof raw.executionIdentitySha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(raw.executionIdentitySha256) ||
    !Number.isSafeInteger(raw.seed) ||
    Number(raw.seed) < 0 ||
    typeof raw.generatedAt !== "string" ||
    new Date(raw.generatedAt).toISOString() !== raw.generatedAt ||
    !Array.isArray(raw.requestedCapacities) ||
    !Array.isArray(raw.artifacts) ||
    indexSha256 !== sha256(
      Buffer.from(canonicalizeArtifactJson(withoutHash), "utf8")
    )
  ) {
    throw new Error("unified_adaptive_index_invalid");
  }
  const evidence: UnifiedAdaptiveBenchmarkEvidenceV1[] = [];
  const scenarioIds = new Set<string>();
  for (const value of raw.artifacts) {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      throw new Error("unified_adaptive_index_artifact_invalid");
    }
    const artifact = value as Record<string, unknown>;
    const artifactKeys = [
      "candidateCommit",
      "evidenceSha256",
      "executionIdentitySha256",
      "relativePath",
      "scenarioId"
    ];
    if (
      Object.keys(artifact).sort().some((key, index) =>
        key !== artifactKeys[index]
      ) ||
      Object.keys(artifact).length !== artifactKeys.length ||
      typeof artifact.scenarioId !== "string" ||
      scenarioIds.has(artifact.scenarioId) ||
      typeof artifact.relativePath !== "string" ||
      typeof artifact.evidenceSha256 !== "string" ||
      artifact.candidateCommit !== expected.candidateSha ||
      typeof artifact.executionIdentitySha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(
        artifact.executionIdentitySha256
      ) ||
      artifact.executionIdentitySha256 ===
        raw.executionIdentitySha256
    ) {
      throw new Error("unified_adaptive_index_artifact_invalid");
    }
    scenarioIds.add(artifact.scenarioId);
    const artifactBytes = await readSafeRegularFile(
      root,
      artifact.relativePath
    );
    const artifactText = canonicalArtifactText(artifactBytes);
    const parsed = parseUnifiedAdaptiveBenchmarkEvidenceV1(
      artifactText
    );
    if (
      parsed.scenarioId !== artifact.scenarioId ||
      parsed.performanceManifest.caseId !== artifact.scenarioId ||
      parsed.mode !== expected.mode ||
      parsed.evidenceSha256 !== artifact.evidenceSha256 ||
      parsed.performanceManifest.executionIdentitySha256 !==
        artifact.executionIdentitySha256 ||
      canonicalizeArtifactJson(parsed) !== artifactText
    ) {
      throw new Error("unified_adaptive_index_artifact_mismatch");
    }
    evidence.push(parsed);
  }
  return {
    sha256: sha256(bytes),
    index: {
      mode: expected.mode,
      requestedCapacities:
        raw.requestedCapacities as readonly number[],
      candidateCommit: expected.candidateSha,
      executionIdentitySha256:
        raw.executionIdentitySha256 as string
    },
    evidence
  };
}

export async function assertAdaptivePromotionDerivedFromArtifacts(
  root: string,
  receipt: UnifiedAdaptiveRollingReleaseReceiptV1
): Promise<void> {
  const [replay, live, oracleBytes, memoryBytes, recoveryBytes,
    fallbackBytes] = await Promise.all([
    loadAdaptiveBenchmarkIndexForFinalizer(root, "adaptive-replay-index-v1.json", {
      mode: "replay",
      candidateSha: receipt.candidateSha
    }),
    loadAdaptiveBenchmarkIndexForFinalizer(root, "adaptive-live-index-v1.json", {
      mode: "live",
      candidateSha: receipt.candidateSha
    }),
    readSafeRegularFile(
      root,
      "adaptive-rolling-oracle-receipt-v1.json"
    ),
    readSafeRegularFile(
      root,
      "target-linux-memory-gate-evidence-v1.json"
    ),
    readSafeRegularFile(
      root,
      "adaptive-restart-recovery-evidence-v1.json"
    ),
    readSafeRegularFile(
      root,
      "adaptive-barrier-fallback-evidence-v1.json"
    )
  ]);
  if (
    replay.index.executionIdentitySha256 ===
      live.index.executionIdentitySha256 ||
    replay.index.requestedCapacities.length !==
      ADAPTIVE_CAPACITIES.length ||
    replay.index.requestedCapacities.some((capacity, index) =>
      capacity !== ADAPTIVE_CAPACITIES[index]
    ) ||
    live.index.requestedCapacities[0] !== 1 ||
    live.index.requestedCapacities.some((capacity) =>
      capacity !== 1 && capacity !== 4
    )
  ) {
    throw new Error("unified_adaptive_capacity_evidence_invalid");
  }
  const oracle = parseUnifiedRollingOracleReceiptV1(
    canonicalArtifactText(oracleBytes)
  );
  if (
    replay.evidence.some((evidence) =>
      evidence.oracle?.receiptSha256 !== oracle.receiptSha256 ||
      evidence.oracle.exactEquivalent !== true
    )
  ) {
    throw new Error("unified_adaptive_oracle_binding_invalid");
  }
  const memory = parseUnifiedMemoryGateEvidenceV1(
    canonicalArtifactText(memoryBytes)
  );
  if (!satisfiesUnifiedProductionMemoryGate(memory)) {
    throw new Error("unified_adaptive_target_memory_invalid");
  }
  const sourceBytes = await readSafeRegularFile(
    root,
    "target-linux-memory-source-attestation.bin"
  );
  if (
    memory.targetAttestation?.memorySourceArtifactSha256 !==
      sha256(sourceBytes)
  ) {
    throw new Error("unified_adaptive_memory_source_binding_invalid");
  }
  const recovery =
    parseUnifiedAdaptiveLifecycleGateEvidenceV1(
      canonicalArtifactText(recoveryBytes)
    );
  const fallback =
    parseUnifiedAdaptiveLifecycleGateEvidenceV1(
      canonicalArtifactText(fallbackBytes)
    );
  if (
    recovery.kind !== "restart_recovery" ||
    fallback.kind !== "barrier_fallback" ||
    recovery.candidateCommit !== receipt.candidateSha ||
    fallback.candidateCommit !== receipt.candidateSha ||
    recovery.executionIdentitySha256 !==
      replay.index.executionIdentitySha256 ||
    fallback.executionIdentitySha256 !==
      replay.index.executionIdentitySha256
  ) {
    throw new Error("unified_adaptive_lifecycle_binding_invalid");
  }
  const capacity1 = live.evidence.find((evidence) =>
    evidence.requestedCapacity === 1 &&
    evidence.scenarioKind === "one_dense_wallet"
  );
  const capacity4 = live.evidence.find((evidence) =>
    evidence.requestedCapacity === 4 &&
    evidence.scenarioKind === "one_dense_wallet"
  );
  if (!capacity1) {
    throw new Error("unified_adaptive_live_capacity1_invalid");
  }
  const walletOutcomes = ADAPTIVE_WALLETS.map((subjectAddress) => {
    const outcome = live.evidence
      .flatMap((evidence) => evidence.liveOutcomes)
      .find((item) => item.subjectAddress === subjectAddress);
    if (!outcome) {
      throw new Error("unified_adaptive_live_wallet_invalid");
    }
    return {
      subjectAddress,
      score: outcome.score,
      decision: outcome.decision,
      closureComplete: true as const,
      evidenceBundleSha256: outcome.evidenceBundleSha256,
      traversalClosureSha256: outcome.traversalClosureSha256,
      scoringBundleSha256: outcome.scoringBundleSha256,
      reportSha256: outcome.reportSha256
    };
  });
  const capacity4HealthyGroupIds = new Set(
    capacity4?.independentGroupAudit?.groups
      .filter((group) =>
        group.state === "healthy" && group.concurrencyLimit > 0
      )
      .map((group) => group.opaqueGroupId) ?? []
  );
  const capacity4DispatchedGroupIds = new Set(
    capacity4?.liveOutcomes.flatMap((outcome) =>
      outcome.dispatchedGroupIds
    ) ?? []
  );
  const verifiedCapacity4 =
    capacity4HealthyGroupIds.size === 4 &&
    capacity4DispatchedGroupIds.size === 4 &&
    [...capacity4DispatchedGroupIds].every((groupId) =>
      capacity4HealthyGroupIds.has(groupId)
    );
  const expected = {
    ...receipt,
    schema034: {
      checksumSha256: APPROVED_SCHEMA_034_CHECKSUM,
      catalogSha256: APPROVED_SCHEMA_034_CATALOG_SHA256,
      structuralGatePassed: true as const
    },
    schema035: {
      checksumSha256: APPROVED_SCHEMA_035_CHECKSUM,
      catalogSha256: APPROVED_SCHEMA_035_CATALOG_SHA256,
      structuralGatePassed: true as const
    },
    frozenReplay: {
      evidenceIndexSha256: replay.sha256,
      oracleReceiptSha256: sha256(oracleBytes),
      exactEquivalent: true as const,
      logicalCapacities: ADAPTIVE_CAPACITIES
    },
    transactionalRecovery: {
      evidenceSha256: sha256(recoveryBytes),
      retryPassed: true as const,
      restartPassed: true as const,
      duplicateCommits: 0 as const,
      duplicateDeliveryIntents: 0 as const
    },
    live: {
      capacity1EvidenceSha256: capacity1.evidenceSha256,
      capacity4: verifiedCapacity4
        ? {
            status: "verified" as const,
            evidenceSha256: capacity4!.evidenceSha256,
            auditedIndependentGroups: 4 as const
          }
        : {
            status: "unverified" as const,
            reason: "independent_groups_not_audited" as const
          },
      wallets: walletOutcomes,
      externalTelegramSends: 0 as const
    },
    targetLinuxMemory: memory,
    hotFallback: {
      evidenceSha256: sha256(fallbackBytes),
      rollingToBarrierPassed: true as const,
      samePlannerCommitPath: true as const,
      unleasedTailDeAdmitted: true as const,
      leasedChunksFinishedBounded: true as const
    },
    verifiedCapacityCeiling: verifiedCapacity4 ? 4 as const : 1 as const
  };
  const expectedPayload = canonicalAdaptiveRollingReceiptPayload((({
      approval: _approval,
      ...body
    }) => body)(expected));
  const receiptPayload = canonicalAdaptiveRollingReceiptPayload((({
        approval: _approval,
        ...body
      }) => body)(receipt));
  if (
    !Buffer.from(expectedPayload).equals(Buffer.from(receiptPayload))
  ) {
    throw new Error("unified_adaptive_derived_receipt_mismatch");
  }
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
  if (
    argv.length !== 6 ||
    argv[0] !== "--artifact-root" ||
    argv[2] !== "--generation" ||
    argv[4] !== "--plan-a-authority-commit"
  ) {
    throw new Error("unified_release_gate_cli_invalid");
  }
  const artifactRoot = resolve(argv[1]!);
  const generation = argv[3]!;
  const authorityCommitSha = argv[5]!;
  if (!isAbsolute(artifactRoot) || !GENERATION.test(generation)
      || authorityCommitSha !== APPROVED_PLAN_A_LOCK_COMMIT_SHA) {
    throw new Error("unified_release_gate_cli_invalid");
  }
  return {
    artifactRoot,
    generation,
    authorityCommitSha
  };
}

export async function finalizeUnifiedReleaseGates(
  artifactRoot: string,
  generation: string,
  authorityCommitSha = APPROVED_PLAN_A_LOCK_COMMIT_SHA
): Promise<{
  candidateSha: string;
  planAGateSha256: string;
  unifiedGateSha256: string;
  adaptiveGateSha256: string;
}> {
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
  const adaptiveGate = await readUnifiedAdaptivePromotionReceipt(
    physicalRoot,
    {
      candidateSha,
      releaseGenerationId: generation
    }
  );
  await assertAdaptivePromotionDerivedFromArtifacts(
    physicalRoot,
    adaptiveGate.receipt
  );

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
      npmVersion: unifiedReleaseNpmVersion()
    },
    selectedAttributionPolicy: "proportional"
  };
  validatePlanAGateReceiptV1(planA, { candidateSha });
  const planABytes = canonicalBytesV2(planA);

  const [cleanBytes, cloneBytes] = await Promise.all([
    readFile(join(physicalRoot, "schema-clean", "schema032-release-evidence.json")),
    readFile(join(physicalRoot, "schema-production-clone", "schema032-release-evidence.json"))
  ]);
  const clean = validateSchema032ReleaseEvidenceV2(JSON.parse(cleanBytes.toString("utf8")));
  const clone = validateSchema032ReleaseEvidenceV2(JSON.parse(cloneBytes.toString("utf8")));
  if (clean.candidateSha !== candidateSha || clean.databaseRole !== "clean"
      || clone.candidateSha !== candidateSha || clone.databaseRole !== "production_clone") {
    throw new Error("unified_release_schema034_candidate_binding_invalid");
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
      schemaVersion: 34,
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
    schema034: {
      filename: "034_unified_check_adaptive_planner.sql",
      checksumSha256: clean.schema034.checksumSha256,
      catalogSha256: clean.schema034.catalogSha256,
      cleanVerificationReceiptSha256: clean.schema034.verificationReceiptSha256,
      cloneVerificationReceiptSha256: clone.schema034.verificationReceiptSha256
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
  await writeExclusive(
    join(
      physicalRoot,
      "adaptive-rolling-release-gate-receipt-v1.json"
    ),
    adaptiveGate.receipt
  );
  return {
    candidateSha,
    planAGateSha256: sha256(planABytes),
    unifiedGateSha256: sha256(unifiedBytes),
    adaptiveGateSha256: adaptiveGate.sha256
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
