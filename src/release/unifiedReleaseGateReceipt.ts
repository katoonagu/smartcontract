import { verify } from "node:crypto";
import { canonicalizeArtifactJson } from "../forensics/canonicalJson";
import {
  parseUnifiedMemoryGateEvidenceV1,
  satisfiesUnifiedProductionMemoryGate,
  type UnifiedMemoryGateEvidenceV1
} from "../unifiedCheck/adaptiveBenchmarkEvidence";
import { canonicalBytesV2 } from "./releaseRootWriterStore";
import {
  UNIFIED_SCHEMA_034_CATALOG_SHA256,
  UNIFIED_SCHEMA_034_MIGRATION_SHA256,
  UNIFIED_SCHEMA_035_CATALOG_SHA256,
  UNIFIED_SCHEMA_035_MIGRATION_SHA256
} from "../storage/schemaMigrations";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const GENERATION = /^[a-z0-9][a-z0-9-]{15,63}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export const APPROVED_PLAN_A_LOCK_COMMIT_SHA =
  "5149573503394815925d771ba33b2733e3248dc3";
export const APPROVED_PLAN_A_LOCK_TREE_SHA =
  "6f748eb72cc136d25e7faeff40fb083cf52e6290";
export const APPROVED_PLAN_A_LOCKED_ROOT_TREE_SHA =
  "9557d4cd662a2ccfbfe53bf1d2b59a823a0aad05";
export const APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256 =
  "4d1f2568d3676cf1ee2e4411bc70e056d1f6fc80997b2919e3da4705811cb407";
export const APPROVED_GOLDEN_PROTOCOL_SHA256 =
  "2b00227d25620a2da8a13bc1a17db2465aaa96f8ba7673c1bbf338583d130865";
export const APPROVED_GOLDEN_CASE_CATALOG_SHA256 =
  "acdcaadc9866dc90c74d9f718774f813e3b4fd71a325322de883202642b041d1";
export const APPROVED_GOLDEN_COMPARATOR_CONTRACT_SHA256 =
  "b6572108512d6349c0bae6ed1365b9146db6661595903141c97160dea58a0b83";
export const APPROVED_GOLDEN_MANIFEST_DESCRIPTOR_SHA256 =
  "f64afca8698f49581ed52893f028996d32807aa8c986c17b948674212f90fe30";
export const PLAN_A_GATE_RECEIPT_RELATIVE_PATH = "plan-a-gate-receipt-v1.json";
export const APPROVED_SCHEMA_033_CHECKSUM =
  "d04f2aff20370a78862604c92ccbcb6bf7c8b1024f95e03b4af2c8f018e701f7";
export const APPROVED_SCHEMA_034_CHECKSUM =
  UNIFIED_SCHEMA_034_MIGRATION_SHA256;
export const APPROVED_SCHEMA_034_CATALOG_SHA256 =
  UNIFIED_SCHEMA_034_CATALOG_SHA256;
export const APPROVED_SCHEMA_035_CHECKSUM =
  UNIFIED_SCHEMA_035_MIGRATION_SHA256;
export const APPROVED_SCHEMA_035_CATALOG_SHA256 =
  UNIFIED_SCHEMA_035_CATALOG_SHA256;
export const APPROVED_ADAPTIVE_RELEASE_KEY_ID =
  "unified-adaptive-release-2026-07";
export const APPROVED_ADAPTIVE_RELEASE_PUBLIC_KEY_PEM =
  "-----BEGIN PUBLIC KEY-----\n" +
  "MCowBQYDK2VwAyEAMEPsvRjjQOGxtEU+9vYdzLcigSZtAVhSpLgtw+PP2+w=\n" +
  "-----END PUBLIC KEY-----\n";
export const APPROVED_ADAPTIVE_RELEASE_PUBLIC_KEY_SHA256 =
  "28675345896e86b6f113bcb3a84a4704fb29328333bc75bc2b7146407aa1b107";

export const UNIFIED_RELEASE_COMMANDS = Object.freeze([
  { id: "full_test", command: "npm test" },
  { id: "typecheck", command: "npm run typecheck" },
  {
    id: "golden_verify",
    command: "node --import tsx scripts/tronUsdtGoldenPilotV2.ts verify --input docs/audit/2026-07-system-audit/golden-v2/locked"
  },
  {
    id: "golden_compare",
    command: "npm run unified:golden:compare -- --golden docs/audit/2026-07-system-audit/golden-v2/locked --candidate artifacts/unified-wallet-replay"
  },
  {
    id: "presentation_acceptance",
    command: "npx vitest run tests/unified-check/presentation.golden.test.ts"
  },
  {
    id: "migration_startup_rehearsal",
    command: "npx vitest run tests/storage/migration034.postgres.test.ts tests/runtime/startupSchemaGate.test.ts tests/unified-check/productionRuntime.postgres.test.ts --maxWorkers=1"
  }
] as const);

export type PlanAGateReceiptV1 = {
  version: "plan-a-gate-receipt-v1";
  candidateSha: string;
  approvalAuthority: {
    commitSha: typeof APPROVED_PLAN_A_LOCK_COMMIT_SHA;
    repositoryTreeSha: typeof APPROVED_PLAN_A_LOCK_TREE_SHA;
    lockedRootTreeSha: typeof APPROVED_PLAN_A_LOCKED_ROOT_TREE_SHA;
  };
  artifacts: {
    caseCatalogSha256: string;
    comparatorContractSha256: string;
    lockedGoldenManifestSha256: string;
    lockedManifestDescriptorSha256: string;
    protocolSha256: string;
  };
  commands: Array<{
    command: string;
    exitCode: 0;
    id: string;
    outputSha256: string;
    provenanceReceiptSha256: string;
  }>;
  recordedAt: string;
  runtime: { nodeVersion: string; npmVersion: string };
  selectedAttributionPolicy: "proportional";
};

export type UnifiedWalletReleaseGateReceiptV1 = {
  version: "unified-wallet-release-gate-receipt-v1";
  candidateSha: string;
  releaseGenerationId: string;
  planAGate: { relativePath: typeof PLAN_A_GATE_RECEIPT_RELATIVE_PATH; sha256: string };
  lockedGoldenManifestSha256: string;
  versions: {
    analysisManifest: "analysis-manifest-v1";
    attributionPolicy: "selected-attribution-policy-v1";
    comparator: "unified-wallet-comparator-v1";
    presentationManifest: "presentation-manifest-v1";
    renderer: "unified-telegram-renderer-v1";
    schemaVersion: 34;
    scoreAnchor: "score-anchor-v3";
    scoringPolicy: "scoring-signal-matrix-v4";
  };
  schema033: {
    filename: "033_unified_wallet_check.sql";
    checksumSha256: string;
    catalogSha256: string;
    cleanVerificationReceiptSha256: string;
    cloneVerificationReceiptSha256: string;
  };
  schema034: {
    filename: "034_unified_check_adaptive_planner.sql";
    checksumSha256: string;
    catalogSha256: string;
    cleanVerificationReceiptSha256: string;
    cloneVerificationReceiptSha256: string;
  };
  replayRootSha256: string;
  commands: Array<{
    id: typeof UNIFIED_RELEASE_COMMANDS[number]["id"];
    command: string;
    exitCode: 0;
    outputSha256: string;
    provenanceReceiptSha256: string;
  }>;
  recordedAt: string;
};

export type UnifiedReleaseCommandReceiptV1 = {
  version: "unified-release-command-receipt-v1";
  candidateSha: string;
  releaseGenerationId: string;
  id: typeof UNIFIED_RELEASE_COMMANDS[number]["id"];
  command: string;
  cwd: ".";
  cwdPhysicalSha256: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  output: {
    relativePath: string;
    sha256: string;
    byteLength: number;
  };
  runtime: {
    nodeVersion: string;
    npmVersion: string;
    platform: NodeJS.Platform;
    arch: string;
  };
};

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(code);
  }
}

function sha(value: unknown, pattern = SHA256, code = "unified_release_sha_invalid"): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(code);
  return value;
}

function validateCommandResults(
  value: unknown,
  expected: readonly { id: string; command: string }[],
  code: string
): Array<{
  id: any;
  command: string;
  exitCode: 0;
  outputSha256: string;
  provenanceReceiptSha256: string;
}> {
  if (!Array.isArray(value) || value.length !== expected.length) throw new Error(`${code}_commands_invalid`);
  return value.map((item, index) => {
    const input = record(item, `${code}_command_invalid`);
    exactKeys(input, [
      "id", "command", "exitCode", "outputSha256", "provenanceReceiptSha256"
    ], `${code}_command_invalid`);
    if (input.id !== expected[index]!.id || input.command !== expected[index]!.command || input.exitCode !== 0) {
      throw new Error(`${code}_commands_invalid`);
    }
    return {
      id: input.id,
      command: input.command,
      exitCode: 0,
      outputSha256: sha(input.outputSha256, SHA256, `${code}_output_sha_invalid`),
      provenanceReceiptSha256: sha(
        input.provenanceReceiptSha256,
        SHA256,
        `${code}_provenance_receipt_sha_invalid`
      )
    };
  });
}

export function validateUnifiedReleaseCommandReceiptV1(
  value: unknown,
  context: {
    candidateSha: string;
    releaseGenerationId: string;
    expected: { id: string; command: string };
    cwdPhysicalSha256: string;
  },
  bytes?: Uint8Array
): UnifiedReleaseCommandReceiptV1 {
  const code = "unified_release_command_receipt";
  const input = record(value, `${code}_invalid`);
  exactKeys(input, [
    "candidateSha", "command", "cwd", "cwdPhysicalSha256", "exitCode",
    "finishedAt", "id", "output", "releaseGenerationId", "runtime",
    "startedAt", "version"
  ], `${code}_invalid`);
  if (input.version !== "unified-release-command-receipt-v1"
      || input.candidateSha !== context.candidateSha || !SHA40.test(context.candidateSha)
      || input.releaseGenerationId !== context.releaseGenerationId
      || !GENERATION.test(context.releaseGenerationId)
      || input.id !== context.expected.id || input.command !== context.expected.command
      || input.cwd !== "."
      || sha(input.cwdPhysicalSha256, SHA256, `${code}_cwd_invalid`) !== context.cwdPhysicalSha256
      || typeof input.startedAt !== "string" || !ISO.test(input.startedAt)
      || typeof input.finishedAt !== "string" || !ISO.test(input.finishedAt)
      || Date.parse(input.finishedAt) < Date.parse(input.startedAt)
      || !Number.isInteger(input.exitCode) || (input.exitCode as number) < 0) {
    throw new Error(`${code}_identity_invalid`);
  }
  const output = record(input.output, `${code}_output_invalid`);
  exactKeys(output, ["byteLength", "relativePath", "sha256"], `${code}_output_invalid`);
  if (output.relativePath !== `${context.expected.id}.log`
      || !Number.isSafeInteger(output.byteLength) || (output.byteLength as number) < 0) {
    throw new Error(`${code}_output_invalid`);
  }
  sha(output.sha256, SHA256, `${code}_output_invalid`);
  const runtime = record(input.runtime, `${code}_runtime_invalid`);
  exactKeys(runtime, ["arch", "nodeVersion", "npmVersion", "platform"], `${code}_runtime_invalid`);
  if (typeof runtime.nodeVersion !== "string" || !/^v\d+\.\d+\.\d+$/u.test(runtime.nodeVersion)
      || typeof runtime.npmVersion !== "string" || !/^\d+\.\d+\.\d+$/u.test(runtime.npmVersion)
      || typeof runtime.platform !== "string" || runtime.platform.length === 0
      || typeof runtime.arch !== "string" || runtime.arch.length === 0) {
    throw new Error(`${code}_runtime_invalid`);
  }
  if (bytes !== undefined && !Buffer.from(bytes).equals(canonicalBytesV2(value))) {
    throw new Error(`${code}_not_canonical`);
  }
  return {
    version: "unified-release-command-receipt-v1",
    candidateSha: input.candidateSha as string,
    releaseGenerationId: input.releaseGenerationId as string,
    id: input.id as UnifiedReleaseCommandReceiptV1["id"],
    command: input.command as string,
    cwd: ".",
    cwdPhysicalSha256: input.cwdPhysicalSha256 as string,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    exitCode: input.exitCode as number,
    output: output as UnifiedReleaseCommandReceiptV1["output"],
    runtime: runtime as UnifiedReleaseCommandReceiptV1["runtime"]
  };
}

export function validatePlanAGateReceiptV1(
  value: unknown,
  context: { candidateSha: string },
  bytes?: Uint8Array
): PlanAGateReceiptV1 {
  const input = record(value, "plan_a_gate_receipt_invalid");
  exactKeys(input, [
    "approvalAuthority", "artifacts", "candidateSha", "commands", "recordedAt", "runtime",
    "selectedAttributionPolicy", "version"
  ], "plan_a_gate_receipt_invalid");
  if (input.version !== "plan-a-gate-receipt-v1"
      || input.selectedAttributionPolicy !== "proportional"
      || typeof input.recordedAt !== "string" || !ISO.test(input.recordedAt)) {
    throw new Error("plan_a_gate_receipt_invalid");
  }
  if (sha(input.candidateSha, SHA40, "plan_a_gate_candidate_invalid") !== context.candidateSha
      || !SHA40.test(context.candidateSha)) {
    throw new Error("plan_a_gate_candidate_invalid");
  }
  const approvalAuthority = record(input.approvalAuthority, "plan_a_gate_approval_authority_invalid");
  exactKeys(approvalAuthority, [
    "commitSha", "lockedRootTreeSha", "repositoryTreeSha"
  ], "plan_a_gate_approval_authority_invalid");
  if (approvalAuthority.commitSha !== APPROVED_PLAN_A_LOCK_COMMIT_SHA
      || approvalAuthority.repositoryTreeSha !== APPROVED_PLAN_A_LOCK_TREE_SHA
      || approvalAuthority.lockedRootTreeSha !== APPROVED_PLAN_A_LOCKED_ROOT_TREE_SHA) {
    throw new Error("plan_a_gate_approval_authority_invalid");
  }
  const artifacts = record(input.artifacts, "plan_a_gate_artifacts_invalid");
  exactKeys(artifacts, [
    "caseCatalogSha256", "comparatorContractSha256", "lockedGoldenManifestSha256",
    "lockedManifestDescriptorSha256", "protocolSha256"
  ], "plan_a_gate_artifacts_invalid");
  for (const [key, artifactSha] of Object.entries(artifacts)) {
    sha(artifactSha, SHA256, `plan_a_gate_${key}_invalid`);
  }
  if (artifacts.lockedGoldenManifestSha256 !== APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256) {
    throw new Error("plan_a_gate_locked_golden_manifest_invalid");
  }
  if (artifacts.protocolSha256 !== APPROVED_GOLDEN_PROTOCOL_SHA256
      || artifacts.caseCatalogSha256 !== APPROVED_GOLDEN_CASE_CATALOG_SHA256
      || artifacts.comparatorContractSha256 !== APPROVED_GOLDEN_COMPARATOR_CONTRACT_SHA256
      || artifacts.lockedManifestDescriptorSha256 !== APPROVED_GOLDEN_MANIFEST_DESCRIPTOR_SHA256) {
    throw new Error("plan_a_gate_artifacts_invalid");
  }
  const runtime = record(input.runtime, "plan_a_gate_runtime_invalid");
  exactKeys(runtime, ["nodeVersion", "npmVersion"], "plan_a_gate_runtime_invalid");
  if (typeof runtime.nodeVersion !== "string" || !/^v\d+\.\d+\.\d+$/u.test(runtime.nodeVersion)
      || typeof runtime.npmVersion !== "string" || !/^\d+\.\d+\.\d+$/u.test(runtime.npmVersion)) {
    throw new Error("plan_a_gate_runtime_invalid");
  }
  const commands = validateCommandResults(input.commands, [
    { id: "full_test", command: "npm test" },
    { id: "typecheck", command: "npm run typecheck" },
    {
      id: "locked_verify",
      command: "node --import tsx scripts/tronUsdtGoldenPilotV2.ts verify --input docs/audit/2026-07-system-audit/golden-v2/locked"
    }
  ], "plan_a_gate");
  if (bytes !== undefined) {
    const canonical = canonicalBytesV2(value);
    if (!Buffer.from(bytes).equals(canonical)) throw new Error("plan_a_gate_receipt_not_canonical");
  }
  return {
    version: "plan-a-gate-receipt-v1",
    candidateSha: input.candidateSha as string,
    approvalAuthority: approvalAuthority as PlanAGateReceiptV1["approvalAuthority"],
    artifacts: artifacts as PlanAGateReceiptV1["artifacts"],
    commands,
    recordedAt: input.recordedAt,
    runtime: runtime as PlanAGateReceiptV1["runtime"],
    selectedAttributionPolicy: "proportional"
  };
}

export function validateUnifiedWalletReleaseGateReceiptV1(
  value: unknown,
  context: { candidateSha: string; releaseGenerationId: string; planAGateReceiptSha256: string }
): UnifiedWalletReleaseGateReceiptV1 {
  const input = record(value, "unified_release_gate_receipt_invalid");
  exactKeys(input, [
    "candidateSha", "commands", "lockedGoldenManifestSha256", "planAGate", "recordedAt",
    "releaseGenerationId", "replayRootSha256", "schema033", "schema034", "version", "versions"
  ], "unified_release_gate_receipt_invalid");
  if (input.version !== "unified-wallet-release-gate-receipt-v1"
      || input.candidateSha !== context.candidateSha || !SHA40.test(context.candidateSha)
      || input.releaseGenerationId !== context.releaseGenerationId || !GENERATION.test(context.releaseGenerationId)
      || typeof input.recordedAt !== "string" || !ISO.test(input.recordedAt)) {
    throw new Error("unified_release_gate_identity_invalid");
  }
  if (input.lockedGoldenManifestSha256 !== APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256) {
    throw new Error("unified_release_locked_golden_manifest_invalid");
  }
  const planA = record(input.planAGate, "unified_release_plan_a_gate_invalid");
  exactKeys(planA, ["relativePath", "sha256"], "unified_release_plan_a_gate_invalid");
  if (planA.relativePath !== PLAN_A_GATE_RECEIPT_RELATIVE_PATH
      || planA.sha256 !== context.planAGateReceiptSha256
      || !SHA256.test(context.planAGateReceiptSha256)) {
    throw new Error("unified_release_plan_a_gate_invalid");
  }
  const versions = record(input.versions, "unified_release_versions_invalid");
  const expectedVersions = {
    analysisManifest: "analysis-manifest-v1",
    attributionPolicy: "selected-attribution-policy-v1",
    comparator: "unified-wallet-comparator-v1",
    presentationManifest: "presentation-manifest-v1",
    renderer: "unified-telegram-renderer-v1",
    schemaVersion: 34,
    scoreAnchor: "score-anchor-v3",
    scoringPolicy: "scoring-signal-matrix-v4"
  } as const;
  exactKeys(versions, Object.keys(expectedVersions), "unified_release_versions_invalid");
  if (Object.entries(expectedVersions).some(([key, expected]) => versions[key] !== expected)) {
    throw new Error("unified_release_versions_invalid");
  }
  const schema033 = record(input.schema033, "unified_release_schema033_invalid");
  exactKeys(schema033, [
    "catalogSha256", "checksumSha256", "cleanVerificationReceiptSha256",
    "cloneVerificationReceiptSha256", "filename"
  ], "unified_release_schema033_invalid");
  if (schema033.filename !== "033_unified_wallet_check.sql"
      || schema033.checksumSha256 !== APPROVED_SCHEMA_033_CHECKSUM
      || schema033.catalogSha256
        !== "e3f1b6152d488f9a8557085b977b2b548f963046966ff04b88a67c222f1acaa4") {
    throw new Error("unified_release_schema033_invalid");
  }
  sha(schema033.cleanVerificationReceiptSha256, SHA256, "unified_release_schema033_receipt_invalid");
  sha(schema033.cloneVerificationReceiptSha256, SHA256, "unified_release_schema033_receipt_invalid");
  const schema034 = record(input.schema034, "unified_release_schema034_invalid");
  exactKeys(schema034, [
    "catalogSha256", "checksumSha256", "cleanVerificationReceiptSha256",
    "cloneVerificationReceiptSha256", "filename"
  ], "unified_release_schema034_invalid");
  if (schema034.filename !== "034_unified_check_adaptive_planner.sql"
      || schema034.checksumSha256 !== APPROVED_SCHEMA_034_CHECKSUM
      || schema034.catalogSha256 !== APPROVED_SCHEMA_034_CATALOG_SHA256) {
    throw new Error("unified_release_schema034_invalid");
  }
  sha(schema034.cleanVerificationReceiptSha256, SHA256, "unified_release_schema034_receipt_invalid");
  sha(schema034.cloneVerificationReceiptSha256, SHA256, "unified_release_schema034_receipt_invalid");
  sha(input.replayRootSha256, SHA256, "unified_release_replay_root_invalid");
  const commands = validateCommandResults(input.commands, UNIFIED_RELEASE_COMMANDS, "unified_release");
  return {
    version: "unified-wallet-release-gate-receipt-v1",
    candidateSha: input.candidateSha as string,
    releaseGenerationId: input.releaseGenerationId as string,
    planAGate: planA as UnifiedWalletReleaseGateReceiptV1["planAGate"],
    lockedGoldenManifestSha256: input.lockedGoldenManifestSha256 as string,
    versions: versions as UnifiedWalletReleaseGateReceiptV1["versions"],
    schema033: schema033 as UnifiedWalletReleaseGateReceiptV1["schema033"],
    schema034: schema034 as UnifiedWalletReleaseGateReceiptV1["schema034"],
    replayRootSha256: input.replayRootSha256 as string,
    commands,
    recordedAt: input.recordedAt
  };
}

const ADAPTIVE_WALLETS = [
  "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
  "TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr",
  "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd"
] as const;
const ADAPTIVE_CAPACITIES = [1, 4, 8, 16, 32, 100] as const;
const BINARY_ROLLBACK_STEPS = [
  "close_generation_to_new_claims",
  "drain_or_block_active_rolling_runs",
  "stop_new_runtime",
  "start_old_binary",
  "retain_migration_034"
] as const;

export type UnifiedAdaptiveRollingReleaseReceiptV1 = {
  readonly version: "unified-adaptive-rolling-release-receipt-v1";
  readonly candidateSha: string;
  readonly releaseGenerationId: string;
  readonly authorizedStage:
    | "global_barrier"
    | "isolated_rolling"
    | "bounded_user_check"
    | "rolling_default";
  readonly recordedAt: string;
  readonly schema034: {
    readonly checksumSha256: string;
    readonly catalogSha256: string;
    readonly structuralGatePassed: true;
  };
  readonly schema035: {
    readonly checksumSha256: string;
    readonly catalogSha256: string;
    readonly structuralGatePassed: true;
  };
  readonly frozenReplay: {
    readonly evidenceIndexSha256: string;
    readonly oracleReceiptSha256: string;
    readonly exactEquivalent: true;
    readonly logicalCapacities: typeof ADAPTIVE_CAPACITIES;
  };
  readonly transactionalRecovery: {
    readonly evidenceSha256: string;
    readonly retryPassed: true;
    readonly restartPassed: true;
    readonly duplicateCommits: 0;
    readonly duplicateDeliveryIntents: 0;
  };
  readonly live: {
    readonly capacity1EvidenceSha256: string;
    readonly capacity4:
      | {
          readonly status: "verified";
          readonly evidenceSha256: string;
          readonly auditedIndependentGroups: 4;
        }
      | {
          readonly status: "unverified";
          readonly reason: "independent_groups_not_audited";
        };
    readonly wallets: readonly {
      readonly subjectAddress: typeof ADAPTIVE_WALLETS[number];
      readonly score: number;
      readonly decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
      readonly closureComplete: true;
      readonly evidenceBundleSha256: string;
      readonly traversalClosureSha256: string;
      readonly scoringBundleSha256: string;
      readonly reportSha256: string;
    }[];
    readonly externalTelegramSends: 0;
  };
  readonly targetLinuxMemory: UnifiedMemoryGateEvidenceV1;
  readonly hotFallback: {
    readonly evidenceSha256: string;
    readonly rollingToBarrierPassed: true;
    readonly samePlannerCommitPath: true;
    readonly unleasedTailDeAdmitted: true;
    readonly leasedChunksFinishedBounded: true;
  };
  readonly binaryRollback: {
    readonly pre034BinaryHot: false;
    readonly retainSchema034: true;
    readonly destructiveDownMigration: false;
    readonly orderedSteps: typeof BINARY_ROLLBACK_STEPS;
  };
  readonly verifiedCapacityCeiling: 1 | 4;
  readonly approval: {
    readonly algorithm: "ed25519";
    readonly keyId: string;
    readonly signatureBase64: string;
  };
};

type AdaptiveUnsignedReceipt = Omit<
  UnifiedAdaptiveRollingReleaseReceiptV1,
  "approval"
>;

export function canonicalAdaptiveRollingReceiptPayload(
  value: AdaptiveUnsignedReceipt
): Uint8Array {
  return canonicalBytesV2(value);
}

function adaptiveTrue(value: unknown, code: string): true {
  if (value !== true) throw new Error(code);
  return true;
}

function adaptiveZero(value: unknown, code: string): 0 {
  if (value !== 0) throw new Error(code);
  return 0;
}

function validateAdaptiveRollingReleaseReceipt(
  value: unknown,
  context?: {
    candidateSha: string;
    releaseGenerationId: string;
  }
): UnifiedAdaptiveRollingReleaseReceiptV1 {
  const input = record(
    value,
    "unified_adaptive_release_receipt_invalid"
  );
  exactKeys(input, [
    "approval",
    "authorizedStage",
    "binaryRollback",
    "candidateSha",
    "frozenReplay",
    "hotFallback",
    "live",
    "recordedAt",
    "releaseGenerationId",
    "schema034",
    "schema035",
    "targetLinuxMemory",
    "transactionalRecovery",
    "verifiedCapacityCeiling",
    "version"
  ], "unified_adaptive_release_receipt_invalid");
  if (
    input.version !==
      "unified-adaptive-rolling-release-receipt-v1" ||
    ![
      "global_barrier",
      "isolated_rolling",
      "bounded_user_check",
      "rolling_default"
    ].includes(String(input.authorizedStage)) ||
    !SHA40.test(String(input.candidateSha)) ||
    !GENERATION.test(String(input.releaseGenerationId)) ||
    typeof input.recordedAt !== "string" ||
    !ISO.test(input.recordedAt)
  ) {
    throw new Error("unified_adaptive_release_identity_invalid");
  }
  if (
    context &&
    (
      input.candidateSha !== context.candidateSha ||
      input.releaseGenerationId !== context.releaseGenerationId
    )
  ) {
    throw new Error("unified_adaptive_release_identity_invalid");
  }
  const schema034 = record(
    input.schema034,
    "unified_adaptive_schema034_invalid"
  );
  exactKeys(schema034, [
    "catalogSha256",
    "checksumSha256",
    "structuralGatePassed"
  ], "unified_adaptive_schema034_invalid");
  if (
    schema034.checksumSha256 !== APPROVED_SCHEMA_034_CHECKSUM ||
    schema034.catalogSha256 !==
      APPROVED_SCHEMA_034_CATALOG_SHA256
  ) {
    throw new Error("unified_adaptive_schema034_invalid");
  }
  adaptiveTrue(
    schema034.structuralGatePassed,
    "unified_adaptive_schema034_invalid"
  );
  const schema035 = record(
    input.schema035,
    "unified_adaptive_schema035_invalid"
  );
  exactKeys(schema035, [
    "catalogSha256",
    "checksumSha256",
    "structuralGatePassed"
  ], "unified_adaptive_schema035_invalid");
  if (
    schema035.checksumSha256 !== APPROVED_SCHEMA_035_CHECKSUM ||
    schema035.catalogSha256 !==
      APPROVED_SCHEMA_035_CATALOG_SHA256
  ) {
    throw new Error("unified_adaptive_schema035_invalid");
  }
  adaptiveTrue(
    schema035.structuralGatePassed,
    "unified_adaptive_schema035_invalid"
  );
  const frozenReplay = record(
    input.frozenReplay,
    "unified_adaptive_replay_invalid"
  );
  exactKeys(frozenReplay, [
    "evidenceIndexSha256",
    "exactEquivalent",
    "logicalCapacities",
    "oracleReceiptSha256"
  ], "unified_adaptive_replay_invalid");
  sha(
    frozenReplay.evidenceIndexSha256,
    SHA256,
    "unified_adaptive_replay_invalid"
  );
  sha(
    frozenReplay.oracleReceiptSha256,
    SHA256,
    "unified_adaptive_replay_invalid"
  );
  adaptiveTrue(
    frozenReplay.exactEquivalent,
    "unified_adaptive_replay_invalid"
  );
  if (
    !Array.isArray(frozenReplay.logicalCapacities) ||
    frozenReplay.logicalCapacities.length !==
      ADAPTIVE_CAPACITIES.length ||
    frozenReplay.logicalCapacities.some((capacity, index) =>
      capacity !== ADAPTIVE_CAPACITIES[index]
    )
  ) {
    throw new Error("unified_adaptive_replay_invalid");
  }
  const recovery = record(
    input.transactionalRecovery,
    "unified_adaptive_recovery_invalid"
  );
  exactKeys(recovery, [
    "duplicateCommits",
    "duplicateDeliveryIntents",
    "evidenceSha256",
    "restartPassed",
    "retryPassed"
  ], "unified_adaptive_recovery_invalid");
  sha(
    recovery.evidenceSha256,
    SHA256,
    "unified_adaptive_recovery_invalid"
  );
  adaptiveTrue(
    recovery.retryPassed,
    "unified_adaptive_recovery_invalid"
  );
  adaptiveTrue(
    recovery.restartPassed,
    "unified_adaptive_recovery_invalid"
  );
  adaptiveZero(
    recovery.duplicateCommits,
    "unified_adaptive_recovery_invalid"
  );
  adaptiveZero(
    recovery.duplicateDeliveryIntents,
    "unified_adaptive_recovery_invalid"
  );
  const live = record(input.live, "unified_adaptive_live_invalid");
  exactKeys(live, [
    "capacity1EvidenceSha256",
    "capacity4",
    "externalTelegramSends",
    "wallets"
  ], "unified_adaptive_live_invalid");
  sha(
    live.capacity1EvidenceSha256,
    SHA256,
    "unified_adaptive_live_capacity1_invalid"
  );
  adaptiveZero(
    live.externalTelegramSends,
    "unified_adaptive_live_delivery_invalid"
  );
  const capacity4 = record(
    live.capacity4,
    "unified_adaptive_live_capacity4_invalid"
  );
  if (capacity4.status === "verified") {
    exactKeys(capacity4, [
      "auditedIndependentGroups",
      "evidenceSha256",
      "status"
    ], "unified_adaptive_live_capacity4_invalid");
    if (capacity4.auditedIndependentGroups !== 4) {
      throw new Error("unified_adaptive_live_capacity4_invalid");
    }
    sha(
      capacity4.evidenceSha256,
      SHA256,
      "unified_adaptive_live_capacity4_invalid"
    );
  } else {
    exactKeys(
      capacity4,
      ["reason", "status"],
      "unified_adaptive_live_capacity4_invalid"
    );
    if (
      capacity4.status !== "unverified" ||
      capacity4.reason !== "independent_groups_not_audited"
    ) {
      throw new Error("unified_adaptive_live_capacity4_invalid");
    }
  }
  if (
    !Array.isArray(live.wallets) ||
    live.wallets.length !== ADAPTIVE_WALLETS.length
  ) {
    throw new Error("unified_adaptive_live_wallets_invalid");
  }
  const wallets =
    live.wallets.map((value, index) => {
      const wallet = record(
        value,
        "unified_adaptive_live_wallet_invalid"
      );
      exactKeys(wallet, [
        "closureComplete",
        "decision",
        "evidenceBundleSha256",
        "reportSha256",
        "score",
        "scoringBundleSha256",
        "subjectAddress",
        "traversalClosureSha256"
      ], "unified_adaptive_live_wallet_invalid");
      if (
        wallet.subjectAddress !== ADAPTIVE_WALLETS[index] ||
        !Number.isSafeInteger(wallet.score) ||
        Number(wallet.score) < 0 ||
        Number(wallet.score) > 100 ||
        !["ACCEPTABLE", "REVIEW", "DECLINE"].includes(
          String(wallet.decision)
        )
      ) {
        throw new Error("unified_adaptive_live_wallet_invalid");
      }
      adaptiveTrue(
        wallet.closureComplete,
        "unified_adaptive_live_wallet_invalid"
      );
      for (const key of [
        "evidenceBundleSha256",
        "traversalClosureSha256",
        "scoringBundleSha256",
        "reportSha256"
      ] as const) {
        sha(
          wallet[key],
          SHA256,
          "unified_adaptive_live_wallet_invalid"
        );
      }
      return wallet as
        UnifiedAdaptiveRollingReleaseReceiptV1["live"]["wallets"][number];
    });
  const targetLinuxMemory = parseUnifiedMemoryGateEvidenceV1(
    canonicalizeArtifactJson(input.targetLinuxMemory)
  );
  if (!satisfiesUnifiedProductionMemoryGate(targetLinuxMemory)) {
    throw new Error("unified_adaptive_target_memory_invalid");
  }
  const hotFallback = record(
    input.hotFallback,
    "unified_adaptive_hot_fallback_invalid"
  );
  exactKeys(hotFallback, [
    "evidenceSha256",
    "leasedChunksFinishedBounded",
    "rollingToBarrierPassed",
    "samePlannerCommitPath",
    "unleasedTailDeAdmitted"
  ], "unified_adaptive_hot_fallback_invalid");
  sha(
    hotFallback.evidenceSha256,
    SHA256,
    "unified_adaptive_hot_fallback_invalid"
  );
  for (const key of [
    "rollingToBarrierPassed",
    "samePlannerCommitPath",
    "unleasedTailDeAdmitted",
    "leasedChunksFinishedBounded"
  ] as const) {
    adaptiveTrue(
      hotFallback[key],
      "unified_adaptive_hot_fallback_invalid"
    );
  }
  const binaryRollback = record(
    input.binaryRollback,
    "unified_adaptive_binary_rollback_invalid"
  );
  exactKeys(binaryRollback, [
    "destructiveDownMigration",
    "orderedSteps",
    "pre034BinaryHot",
    "retainSchema034"
  ], "unified_adaptive_binary_rollback_invalid");
  if (
    binaryRollback.pre034BinaryHot !== false ||
    binaryRollback.retainSchema034 !== true ||
    binaryRollback.destructiveDownMigration !== false ||
    !Array.isArray(binaryRollback.orderedSteps) ||
    binaryRollback.orderedSteps.length !==
      BINARY_ROLLBACK_STEPS.length ||
    binaryRollback.orderedSteps.some((step, index) =>
      step !== BINARY_ROLLBACK_STEPS[index]
    )
  ) {
    throw new Error("unified_adaptive_binary_rollback_invalid");
  }
  const expectedCeiling =
    capacity4.status === "verified" ? 4 : 1;
  if (input.verifiedCapacityCeiling !== expectedCeiling) {
    throw new Error("unified_adaptive_capacity_ceiling_invalid");
  }
  const approval = record(
    input.approval,
    "unified_adaptive_approval_invalid"
  );
  exactKeys(approval, [
    "algorithm",
    "keyId",
    "signatureBase64"
  ], "unified_adaptive_approval_invalid");
  let signature: Buffer;
  try {
    signature = Buffer.from(String(approval.signatureBase64), "base64");
  } catch {
    throw new Error("unified_adaptive_approval_invalid");
  }
  if (
    approval.algorithm !== "ed25519" ||
    approval.keyId !== APPROVED_ADAPTIVE_RELEASE_KEY_ID ||
    signature.length !== 64 ||
    signature.toString("base64") !== approval.signatureBase64
  ) {
    throw new Error("unified_adaptive_approval_invalid");
  }
  const receipt = {
    version: "unified-adaptive-rolling-release-receipt-v1" as const,
    candidateSha: input.candidateSha as string,
    releaseGenerationId: input.releaseGenerationId as string,
    authorizedStage: input.authorizedStage as
      UnifiedAdaptiveRollingReleaseReceiptV1["authorizedStage"],
    recordedAt: input.recordedAt,
    schema034: schema034 as
      UnifiedAdaptiveRollingReleaseReceiptV1["schema034"],
    schema035: schema035 as
      UnifiedAdaptiveRollingReleaseReceiptV1["schema035"],
    frozenReplay: frozenReplay as
      UnifiedAdaptiveRollingReleaseReceiptV1["frozenReplay"],
    transactionalRecovery: recovery as
      UnifiedAdaptiveRollingReleaseReceiptV1["transactionalRecovery"],
    live: {
      capacity1EvidenceSha256: live.capacity1EvidenceSha256 as string,
      capacity4: capacity4 as
        UnifiedAdaptiveRollingReleaseReceiptV1["live"]["capacity4"],
      wallets,
      externalTelegramSends: 0 as const
    },
    targetLinuxMemory,
    hotFallback: hotFallback as
      UnifiedAdaptiveRollingReleaseReceiptV1["hotFallback"],
    binaryRollback: binaryRollback as
      UnifiedAdaptiveRollingReleaseReceiptV1["binaryRollback"],
    verifiedCapacityCeiling: expectedCeiling as 1 | 4,
    approval: approval as
      UnifiedAdaptiveRollingReleaseReceiptV1["approval"]
  };
  if (
    context &&
    !verify(
      null,
      canonicalAdaptiveRollingReceiptPayload((({
        approval: _approval,
        ...body
      }) => body)(receipt)),
      APPROVED_ADAPTIVE_RELEASE_PUBLIC_KEY_PEM,
      signature
    )
  ) {
    throw new Error("unified_adaptive_approval_signature_invalid");
  }
  return receipt;
}

export function sealUnifiedAdaptiveRollingReleaseReceiptV1(
  input: UnifiedAdaptiveRollingReleaseReceiptV1
): {
  readonly envelope: UnifiedAdaptiveRollingReleaseReceiptV1;
  readonly canonicalJson: string;
} {
  const envelope = validateAdaptiveRollingReleaseReceipt(input);
  return {
    envelope,
    canonicalJson: canonicalizeArtifactJson(envelope)
  };
}

export function validateUnifiedAdaptiveRollingReleaseReceiptV1(
  value: unknown,
  context: {
    candidateSha: string;
    releaseGenerationId: string;
  },
  bytes?: Uint8Array
): UnifiedAdaptiveRollingReleaseReceiptV1 {
  const receipt = validateAdaptiveRollingReleaseReceipt(value, context);
  if (bytes !== undefined) {
    const canonical = Buffer.from(
      canonicalizeArtifactJson(value),
      "utf8"
    );
    const provided = Buffer.from(bytes);
    if (
      !provided.equals(canonical) &&
      !provided.equals(Buffer.concat([
        canonical,
        Buffer.from("\n", "utf8")
      ]))
    ) {
      throw new Error(
        "unified_adaptive_release_receipt_not_canonical"
      );
    }
  }
  return receipt;
}
