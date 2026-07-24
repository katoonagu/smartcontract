import { canonicalBytesV2 } from "./releaseRootWriterStore";
import {
  UNIFIED_SCHEMA_034_CATALOG_SHA256,
  UNIFIED_SCHEMA_034_MIGRATION_SHA256
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
