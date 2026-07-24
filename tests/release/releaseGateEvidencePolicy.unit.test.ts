import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  PRE_RELEASE_GATE_EVIDENCE_POLICY_V2,
  deriveTask0BProductionGateBindingV2,
  validateGateEvidenceBytesV2,
  validateProductionNestedGateEvidenceV2
} from "../../src/release/releaseGateEvidencePolicy";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import { releaseSha256V2 } from "../../src/release/remediationReleaseManifestV2";
import { deriveProductionGateSourceManifestBindingsV2 } from "../../src/release/remediationReleaseManifestV2";
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
  UNIFIED_RELEASE_COMMANDS
} from "../../src/release/unifiedReleaseGateReceipt";
import {
  buildExecutedReleaseGateV2Fixture,
  buildOperationalAttestationV2Fixture,
  buildReleaseManifestV2Fixture,
  CANDIDATE_SHA,
  COMMAND_TEMPLATE_SHA256,
  buildTask0BReleaseFreezeEvidence,
  RELEASE_V2_FREEZE_IDENTITY,
  RELEASE_V2_FREEZE_SHA256,
  RELEASE_V2_NOW
} from "../fixtures/release/remediationReleaseFixtures";

const SHA = "a".repeat(64);
const SOURCE = "8".repeat(64);
const STARTED = "2026-07-18T10:00:00.000Z";
const FINISHED = "2026-07-18T10:16:00.000Z";
const TASK0B = buildTask0BReleaseFreezeEvidence({ observedAt: RELEASE_V2_NOW });
const TASK0B_BYTES = canonicalBytesV2(TASK0B);
const TASK0B_SHA256 = releaseSha256V2(TASK0B_BYTES);
const PRODUCTION_DATABASE_IDENTITY_SHA256 =
  TASK0B.productionDatabase.approvedIdentityFingerprintSha256;

function bytes(value: unknown): Buffer {
  return canonicalBytesV2(value);
}

function ref(kind: any, relativePath: string, value: Buffer | unknown, schemaVersion?: string) {
  const content = Buffer.isBuffer(value) ? value : bytes(value);
  return {
    ref: {
      kind,
      relativePath,
      sha256: createHash("sha256").update(content).digest("hex"),
      schemaVersion: schemaVersion ?? (Buffer.isBuffer(value)
        ? "opaque-v1" : String((value as { version?: unknown }).version ?? "gate-evidence-v2")),
      candidateSha: CANDIDATE_SHA
    },
    content
  };
}

function gate(id: any, items: ReturnType<typeof ref>[]) {
  return {
    id,
    candidateSha: CANDIDATE_SHA,
    state: "passed" as const,
    commandId: id === "G12_PRODUCTION_BACKUP" ? "production_backup" : "production_migration",
    redactedTemplateSha256: SHA,
    startedAt: STARTED,
    finishedAt: FINISHED,
    exitCode: 0,
    outputSha256: SHA,
    evidence: items.map((item) => item.ref)
  };
}

function expected() {
  return {
    releaseGenerationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
    artifactRootFingerprintSha256: RELEASE_V2_FREEZE_IDENTITY.artifactRootFingerprintSha256,
    artifactRootTrustBoundaryEvidenceSha256:
      RELEASE_V2_FREEZE_IDENTITY.artifactRootTrustBoundaryEvidenceSha256,
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256,
    sourceManifestSha256: SOURCE,
    task0bReleaseFreezeSha256: TASK0B_SHA256,
    productionDatabaseIdentityFingerprintSha256: PRODUCTION_DATABASE_IDENTITY_SHA256
  };
}

it("binds every focused suite report and sidecar to exactly one pre-release gate", () => {
  expect(PRE_RELEASE_GATE_EVIDENCE_POLICY_V2.G01_TRACE.primaryPaths).toEqual([
    "acceptance-trace.json",
    "task8b-historical-red-evidence-v2.json",
    "suite-plan4.vitest.json",
    "suite-plan4.evidence.json"
  ]);
  expect(PRE_RELEASE_GATE_EVIDENCE_POLICY_V2.G01_TRACE.requiredKinds).toEqual([
    "acceptance_trace", "task8b_red", "suite_report", "suite_evidence"
  ]);
  expect(PRE_RELEASE_GATE_EVIDENCE_POLICY_V2.G06_FULL.primaryPaths).toEqual([
    "full-regression-evidence.json",
    "plan-a-gate-receipt-v1.json",
    "unified-wallet-release-gate-receipt-v1.json",
    "suite-plan5.vitest.json",
    "suite-plan5.evidence.json"
  ]);
  expect(PRE_RELEASE_GATE_EVIDENCE_POLICY_V2.G06_FULL.requiredKinds).toEqual([
    "full_regression", "plan_a_gate_receipt", "unified_release_gate_receipt",
    "suite_report", "suite_evidence"
  ]);
  expect(PRE_RELEASE_GATE_EVIDENCE_POLICY_V2.G05_TELEGRAM.allowedKinds).toEqual([
    "manual_telegram_acceptance"
  ]);
  expect(PRE_RELEASE_GATE_EVIDENCE_POLICY_V2.G11_POISONING_REGRESSION.primaryPaths).toEqual([
    "suite-addressPoisoningRegression.vitest.json",
    "suite-addressPoisoningRegression.evidence.json"
  ]);
  const foreignSuite = ref("suite_report", "suite-plan4.vitest.json", Buffer.from("{}"));
  expect(() => validateGateEvidenceBytesV2(
    gate("G05_TELEGRAM", [foreignSuite]) as any,
    new Map([[foreignSuite.ref.relativePath, foreignSuite.content]]),
    expected()
  )).toThrow(/policy_binding/i);
});

it("binds the Unified release receipt to the exact Plan-A receipt and rollout generation", () => {
  const planA = ref("plan_a_gate_receipt", PLAN_A_GATE_RECEIPT_RELATIVE_PATH, {
    version: "plan-a-gate-receipt-v1",
    candidateSha: CANDIDATE_SHA,
    approvalAuthority: {
      commitSha: APPROVED_PLAN_A_LOCK_COMMIT_SHA,
      repositoryTreeSha: APPROVED_PLAN_A_LOCK_TREE_SHA,
      lockedRootTreeSha: APPROVED_PLAN_A_LOCKED_ROOT_TREE_SHA
    },
    artifacts: {
      caseCatalogSha256: APPROVED_GOLDEN_CASE_CATALOG_SHA256,
      comparatorContractSha256: APPROVED_GOLDEN_COMPARATOR_CONTRACT_SHA256,
      lockedGoldenManifestSha256: APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256,
      lockedManifestDescriptorSha256: APPROVED_GOLDEN_MANIFEST_DESCRIPTOR_SHA256,
      protocolSha256: APPROVED_GOLDEN_PROTOCOL_SHA256
    },
    commands: [
      {
        id: "full_test", command: "npm test", exitCode: 0,
        outputSha256: SHA, provenanceReceiptSha256: SHA
      },
      {
        id: "typecheck", command: "npm run typecheck", exitCode: 0,
        outputSha256: SHA, provenanceReceiptSha256: SHA
      },
      {
        id: "locked_verify",
        command: "node --import tsx scripts/tronUsdtGoldenPilotV2.ts verify --input docs/audit/2026-07-system-audit/golden-v2/locked",
        exitCode: 0,
        outputSha256: SHA,
        provenanceReceiptSha256: SHA
      }
    ],
    recordedAt: STARTED,
    runtime: { nodeVersion: "v22.20.0", npmVersion: "11.6.4" },
    selectedAttributionPolicy: "proportional"
  });
  const unifiedValue = {
    version: "unified-wallet-release-gate-receipt-v1",
    candidateSha: CANDIDATE_SHA,
    releaseGenerationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
    planAGate: { relativePath: PLAN_A_GATE_RECEIPT_RELATIVE_PATH, sha256: planA.ref.sha256 },
    lockedGoldenManifestSha256: APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256,
    versions: {
      analysisManifest: "analysis-manifest-v1", attributionPolicy: "selected-attribution-policy-v1",
      comparator: "unified-wallet-comparator-v1", presentationManifest: "presentation-manifest-v1",
      renderer: "unified-telegram-renderer-v1", schemaVersion: 34,
      scoreAnchor: "score-anchor-v3", scoringPolicy: "scoring-signal-matrix-v4"
    },
    schema033: {
      filename: "033_unified_wallet_check.sql",
      checksumSha256: "d04f2aff20370a78862604c92ccbcb6bf7c8b1024f95e03b4af2c8f018e701f7",
      catalogSha256: "e3f1b6152d488f9a8557085b977b2b548f963046966ff04b88a67c222f1acaa4",
      cleanVerificationReceiptSha256: SHA,
      cloneVerificationReceiptSha256: SHA
    },
    schema034: {
      filename: "034_unified_check_adaptive_planner.sql",
      checksumSha256: "492820d6caade9ee879d73aff6365f911be823258112b39a0f5fbca1d56ec4cb",
      catalogSha256: "891df395c721ff7ac244a011e583e86a33f1364cce435ccb2af383a4f386af57",
      cleanVerificationReceiptSha256: SHA,
      cloneVerificationReceiptSha256: SHA
    },
    replayRootSha256: SHA,
    commands: UNIFIED_RELEASE_COMMANDS.map(({ id, command }) => ({
      id, command, exitCode: 0, outputSha256: SHA, provenanceReceiptSha256: SHA
    })),
    recordedAt: STARTED
  };
  const unified = ref("unified_release_gate_receipt", "unified-wallet-release-gate-receipt-v1.json",
    unifiedValue);
  const legacy = [
    ref("full_regression", "full-regression-evidence.json", { candidateSha: CANDIDATE_SHA }),
    ref("suite_report", "suite-plan5.vitest.json", { success: true }, "vitest-json-report-v1"),
    ref("suite_evidence", "suite-plan5.evidence.json",
      { version: "release-suite-group-evidence-v1", candidateSha: CANDIDATE_SHA })
  ];
  const items = [...legacy, planA, unified];
  expect(() => validateGateEvidenceBytesV2(
    gate("G06_FULL", items) as any,
    new Map(items.map((item) => [item.ref.relativePath, item.content])),
    expected()
  )).not.toThrow();

  const replaced = ref("unified_release_gate_receipt", unified.ref.relativePath, {
    ...unifiedValue,
    planAGate: { ...unifiedValue.planAGate, sha256: "b".repeat(64) }
  });
  const tampered = [...legacy, planA, replaced];
  expect(() => validateGateEvidenceBytesV2(
    gate("G06_FULL", tampered) as any,
    new Map(tampered.map((item) => [item.ref.relativePath, item.content])),
    expected()
  )).toThrow(/plan_a_gate/i);
});

it("accepts byte-bound legacy producer JSON formatting but keeps official Task 8B canonical", () => {
  const rawItem = (kind: any, relativePath: string, value: Record<string, unknown>, schemaVersion: string) => {
    const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    return { content, ref: { kind, relativePath,
      sha256: createHash("sha256").update(content).digest("hex"), schemaVersion,
      candidateSha: CANDIDATE_SHA } };
  };
  const items = [
    rawItem("acceptance_trace", "acceptance-trace.json",
      { version: "acceptance-trace-v1", candidateSha: CANDIDATE_SHA }, "acceptance-trace-v1"),
    ref("task8b_red", "task8b-historical-red-evidence-v2.json",
      { version: "task8b-historical-red-evidence-v2", candidateSha: CANDIDATE_SHA }),
    rawItem("suite_report", "suite-plan4.vitest.json", { success: true }, "vitest-json-report-v1"),
    rawItem("suite_evidence", "suite-plan4.evidence.json",
      { version: "release-suite-group-evidence-v1", candidateSha: CANDIDATE_SHA },
      "release-suite-group-evidence-v1")
  ];
  expect(() => validateGateEvidenceBytesV2(
    gate("G01_TRACE", items as any) as any,
    new Map(items.map((item) => [item.ref.relativePath, item.content])),
    expected()
  )).not.toThrow();
  const noncanonicalTask8b = rawItem("task8b_red", "task8b-historical-red-evidence-v2.json",
    { version: "task8b-historical-red-evidence-v2", candidateSha: CANDIDATE_SHA },
    "task8b-historical-red-evidence-v2");
  const tampered = items.map((item) => item.ref.relativePath === noncanonicalTask8b.ref.relativePath
    ? noncanonicalTask8b : item);
  expect(() => validateGateEvidenceBytesV2(
    gate("G01_TRACE", tampered as any) as any,
    new Map(tampered.map((item) => [item.ref.relativePath, item.content])),
    expected()
  )).toThrow(/canonical/i);
});

it("derives Task0B production binding only from canonical bytes and the approved database identity", () => {
  expect(deriveTask0BProductionGateBindingV2(
    TASK0B_BYTES,
    CANDIDATE_SHA,
    PRODUCTION_DATABASE_IDENTITY_SHA256
  )).toEqual({
    task0bReleaseFreezeSha256: TASK0B_SHA256,
    productionDatabaseIdentityFingerprintSha256: PRODUCTION_DATABASE_IDENTITY_SHA256
  });
  expect(() => deriveTask0BProductionGateBindingV2(
    Buffer.concat([TASK0B_BYTES, Buffer.from("\n")]),
    CANDIDATE_SHA,
    PRODUCTION_DATABASE_IDENTITY_SHA256
  )).toThrow(/noncanonical/i);
  expect(() => deriveTask0BProductionGateBindingV2(
    TASK0B_BYTES,
    CANDIDATE_SHA,
    "f".repeat(64)
  )).toThrow(/database_identity_mismatch/i);
});

it("rejects a G00 trust boundary whose authoritative principal policy hash is substituted", () => {
  const policy = {
    version: "trusted-os-principal-policy-v2",
    policyId: "windows-configured-canonical-set-v1",
    platform: "windows",
    normalizedTrustedPrincipalSetSha256: "1".repeat(64),
    trustedPrincipalCount: 3,
    candidateSha: CANDIDATE_SHA,
    releaseGenerationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
    artifactRootFingerprintSha256: RELEASE_V2_FREEZE_IDENTITY.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256,
    task0BPreflightEvidenceSha256: TASK0B_SHA256,
    ownerIdentityFingerprintSha256: "2".repeat(64),
    accessControlFingerprintSha256: "3".repeat(64),
    authoritativePolicySource: "task0b_allowlisted_writer_principals_v2",
    observedAt: RELEASE_V2_NOW,
    source: "task0b_acl_policy_read_only",
    verified: true
  };
  const policyItem = ref("trusted_os_principal_policy", "trusted-os-principal-policy-v2.json", policy);
  const boundary = {
    version: "artifact-root-trust-boundary-evidence-v1",
    candidateSha: CANDIDATE_SHA,
    releaseGenerationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
    artifactRootFingerprintSha256: RELEASE_V2_FREEZE_IDENTITY.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256,
    task0BPreflightEvidenceSha256: TASK0B_SHA256,
    artifactRootObservationSha256: RELEASE_V2_FREEZE_IDENTITY.artifactRootTrustBoundaryEvidenceSha256,
    trustedOsPrincipalPolicySha256: policyItem.ref.sha256,
    ownerIdentityFingerprintSha256: "2".repeat(64),
    accessControlFingerprintSha256: "3".repeat(64),
    accessControlSource: "windows_acl_direct_read",
    outsideRepository: true,
    noSymlink: true,
    restrictiveAccessVerified: true,
    exclusiveWriteVerified: true,
    observedAt: RELEASE_V2_NOW,
    source: "task0b_protected_root_acl_read_only",
    verified: true
  };
  const items = [
    ref("task0_baseline", "task0-baseline.json", { version: "task0-v1", candidateSha: CANDIDATE_SHA }),
    policyItem,
    ref("release_freeze_materialization", "artifact-root-trust-boundary-evidence-v1.json", boundary),
    ref("release_freeze_materialization", "release-freeze-materialization-receipt-v2.json",
      { version: "freeze-receipt-v2", candidateSha: CANDIDATE_SHA }),
    ref("release_freeze_materialization", "release-freeze-identity-v2.json",
      { version: "freeze-v2", candidateSha: CANDIDATE_SHA })
  ];
  expect(() => validateGateEvidenceBytesV2(gate("G00_BASE", items) as any,
    new Map(items.map((item) => [item.ref.relativePath, item.content])), expected())).not.toThrow();
  const substituted = items.map((item) => item.ref.relativePath === "artifact-root-trust-boundary-evidence-v1.json"
    ? ref(item.ref.kind, item.ref.relativePath, { ...boundary, trustedOsPrincipalPolicySha256: "f".repeat(64) })
    : item);
  expect(() => validateGateEvidenceBytesV2(gate("G00_BASE", substituted) as any,
    new Map(substituted.map((item) => [item.ref.relativePath, item.content])), expected()))
    .toThrow(/trust.*policy|policy.*hash/i);
});

it("rejects canonical but untyped G12 consumption and progress artifacts", () => {
  const attestation = buildOperationalAttestationV2Fixture({
    action: "g12_backup_passed",
    commandId: "production_backup",
    sourceManifestSha256: SOURCE
  });
  const items = [
    ref("operational_attestation", "operational-attestation-g12.json", attestation),
    ref("production_backup_authority",
      `production-backup-authority-${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}.json`,
      { version: "production-backup-authority-v1", candidateSha: CANDIDATE_SHA }),
    ref("production_backup_consumption",
      `production-backup-authority-consumed-${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}.json`,
      { version: "production-backup-authority-consumption-v1", candidateSha: CANDIDATE_SHA }),
    ref("production_backup_dump_progress",
      `production-backup-dump-progress-${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}.json`,
      { version: "production-backup-dump-progress-v1", candidateSha: CANDIDATE_SHA }),
    ref("production_backup_list_progress",
      `production-backup-list-progress-${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}.json`,
      { version: "production-backup-list-progress-v1", candidateSha: CANDIDATE_SHA }),
    ref("production_backup_dump", "production-backup.dump", Buffer.from("PGDMPfake")),
    ref("production_backup_restore_list", "production-backup-restore-list.txt", Buffer.from("entry\n")),
    ref("production_backup_evidence", "production-backup-evidence.json",
      { version: "production-backup-evidence-v1", candidateSha: CANDIDATE_SHA })
  ];
  expect(() => validateGateEvidenceBytesV2(
    gate("G12_PRODUCTION_BACKUP", items) as any,
    new Map(items.map((item) => [item.ref.relativePath, item.content])),
    expected()
  )).toThrow(/backup_(?:authority|consumption|dump_progress|evidence)/i);
});

it("rejects canonical but untyped G13 authority and consumption artifacts", () => {
  const attestation = buildOperationalAttestationV2Fixture({
    action: "g13_migration_passed",
    commandId: "production_migration",
    sourceManifestSha256: SOURCE
  });
  const schema = {
    version: "schema-032-production-execution-receipt-v2",
    candidateSha: CANDIDATE_SHA,
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256,
    operationalAttestationSha256: SHA,
    authorityConsumptionSha256: SHA,
    sourceManifestSha256: SOURCE,
    g12TransitionReceiptSha256: SHA,
    productionBackupEvidenceSha256: SHA,
    advisoryLockKey: 320032500,
    databaseSessionIdentitySha256: SHA,
    lockAcquiredAt: STARTED,
    lockReleasedAt: FINISHED,
    migrationBytesChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    migration033BytesChecksumSha256: "d04f2aff20370a78862604c92ccbcb6bf7c8b1024f95e03b4af2c8f018e701f7",
    migration034BytesChecksumSha256: "492820d6caade9ee879d73aff6365f911be823258112b39a0f5fbca1d56ec4cb",
    result: "applied_and_verified",
    completedStages: ["first_migration", "first_verification", "second_migration", "final_verification"]
      .map((step) => ({ step, receiptSha256: SHA })),
    receiptChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    postconditionsSha256: SHA,
    schema033: {
      version: 33,
      migrationFilename: "033_unified_wallet_check.sql",
      checksumSha256: "d04f2aff20370a78862604c92ccbcb6bf7c8b1024f95e03b4af2c8f018e701f7",
      catalogSha256: "e3f1b6152d488f9a8557085b977b2b548f963046966ff04b88a67c222f1acaa4",
      verificationReceiptSha256: SHA
    },
    schema034: {
      version: 34,
      migrationFilename: "034_unified_check_adaptive_planner.sql",
      checksumSha256: "492820d6caade9ee879d73aff6365f911be823258112b39a0f5fbca1d56ec4cb",
      catalogSha256: "891df395c721ff7ac244a011e583e86a33f1364cce435ccb2af383a4f386af57",
      verificationReceiptSha256: SHA
    }
  };
  const items = [
    ref("operational_attestation", "operational-attestation-g13.json", attestation),
    ref("production_migration_authority",
      `schema032-production-authority-${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}.json`,
      { version: "schema-032-production-authority-v1", candidateSha: CANDIDATE_SHA }),
    ref("production_migration_consumption",
      `schema032-production-authority-consumed-${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}.json`,
      { version: "schema-032-production-authority-consumption-v1", candidateSha: CANDIDATE_SHA }),
    ref("production_migration_sequence", "schema032-production-execution-receipt-v2.json", schema)
  ];
  expect(() => validateGateEvidenceBytesV2(
    gate("G13_PRODUCTION_MIGRATION", items) as any,
    new Map(items.map((item) => [item.ref.relativePath, item.content])),
    expected()
  )).toThrow(/production_(?:authority|consumption)/i);
});

function validG12Items() {
  const template = COMMAND_TEMPLATE_SHA256.production_backup;
  const attestation = buildOperationalAttestationV2Fixture({ action: "g12_backup_passed",
    commandId: "production_backup", redactedTemplateSha256: template, sourceManifestSha256: SOURCE });
  const authority = ref("production_backup_authority",
    `production-backup-authority-${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}.json`, {
      version: "production-backup-authority-v1", scope: "production_backup",
      source: "operator_protected_one_shot_production_go",
      generationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId, commandId: "production_backup",
      commandTemplateSha256: template, issuedAt: STARTED, expiresAt: "2026-07-18T10:10:00.000Z",
      candidateSha: CANDIDATE_SHA, databaseRole: "production",
      databaseIdentityFingerprintSha256: PRODUCTION_DATABASE_IDENTITY_SHA256,
      task0bEvidencePath: "task0b-release-freeze.json",
      task0bEvidenceSha256: TASK0B_SHA256, releaseManifestPath: "release-manifest.json",
      releaseManifestSha256: SOURCE, releaseManifestOverall: "ready_for_release",
      artifactRootFingerprintSha256: RELEASE_V2_FREEZE_IDENTITY.artifactRootFingerprintSha256,
      explicitGo: true
    });
  const consumptionValue = {
    version: "production-backup-authority-consumption-v1",
    generationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
    authoritySha256: authority.ref.sha256, candidateSha: CANDIDATE_SHA,
    databaseIdentityFingerprintSha256: PRODUCTION_DATABASE_IDENTITY_SHA256,
    artifactRootFingerprintSha256: RELEASE_V2_FREEZE_IDENTITY.artifactRootFingerprintSha256,
    claimedAt: STARTED, expiresAt: "2026-07-18T10:10:00.000Z"
  };
  const consumption = ref("production_backup_consumption",
    `production-backup-authority-consumed-${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}.json`,
    consumptionValue);
  const dump = ref("production_backup_dump", "production-backup.dump", Buffer.from("PGDMPpayload"));
  const dumpProgressValue = {
    version: "production-backup-dump-progress-v1", generationId: consumptionValue.generationId,
    authoritySha256: consumptionValue.authoritySha256, claimSha256: consumption.ref.sha256,
    candidateSha: CANDIDATE_SHA, databaseIdentityFingerprintSha256: consumptionValue.databaseIdentityFingerprintSha256,
    artifactRootFingerprintSha256: consumptionValue.artifactRootFingerprintSha256,
    expiresAt: consumptionValue.expiresAt, operationId: "backup-operation-1", recordedAt: STARTED,
    backupFilename: "production-backup.dump", backupBytes: dump.content.length,
    backupSha256: dump.ref.sha256, backupPathFingerprintSha256: "3".repeat(64)
  };
  const dumpProgress = ref("production_backup_dump_progress",
    `production-backup-dump-progress-${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}.json`, dumpProgressValue);
  const restoreList = ref("production_backup_restore_list", "production-backup-restore-list.txt",
    Buffer.from("TABLE public.wallets\n"));
  const listProgressValue = {
    version: "production-backup-list-progress-v1", generationId: consumptionValue.generationId,
    authoritySha256: consumptionValue.authoritySha256, claimSha256: consumption.ref.sha256,
    candidateSha: CANDIDATE_SHA, databaseIdentityFingerprintSha256: consumptionValue.databaseIdentityFingerprintSha256,
    artifactRootFingerprintSha256: consumptionValue.artifactRootFingerprintSha256,
    expiresAt: consumptionValue.expiresAt, operationId: "backup-operation-1", recordedAt: STARTED,
    dumpProgressSha256: dumpProgress.ref.sha256, restoreListFilename: "production-backup-restore-list.txt",
    restoreListBytes: restoreList.content.length, restoreListSha256: restoreList.ref.sha256,
    restoreListEntryCount: 1
  };
  const listProgress = ref("production_backup_list_progress",
    `production-backup-list-progress-${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}.json`, listProgressValue);
  const evidence = ref("production_backup_evidence", "production-backup-evidence.json", {
    version: "production-backup-evidence-v1", candidateSha: CANDIDATE_SHA,
    gateId: "G12_PRODUCTION_BACKUP", commandId: "production_backup", redactedTemplateSha256: template,
    databaseIdentityFingerprintSha256: consumptionValue.databaseIdentityFingerprintSha256,
    backupFilename: "production-backup.dump", backupBytes: dump.content.length, backupSha256: dump.ref.sha256,
    backupPathFingerprintSha256: dumpProgressValue.backupPathFingerprintSha256,
    restoreListFilename: "production-backup-restore-list.txt", restoreListBytes: restoreList.content.length,
    restoreListSha256: restoreList.ref.sha256, restoreListEntryCount: 1, state: "passed"
  });
  return [ref("operational_attestation", "operational-attestation-g12.json", attestation), authority, consumption,
    dumpProgress, listProgress, dump, restoreList, evidence];
}

it("accepts a G12 standalone consumption chain and rejects a forged progress claim hash", () => {
  const items = validG12Items();
  const validGate = { ...gate("G12_PRODUCTION_BACKUP", items),
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.production_backup };
  expect(validateGateEvidenceBytesV2(validGate as any,
    new Map(items.map((item) => [item.ref.relativePath, item.content])), expected())).toHaveLength(8);
  const forged = structuredClone(JSON.parse(items[3]!.content.toString("utf8")));
  forged.claimSha256 = "f".repeat(64);
  const forgedItem = ref(items[3]!.ref.kind, items[3]!.ref.relativePath, forged);
  const forgedItems = [...items.slice(0, 3), forgedItem, ...items.slice(4)];
  expect(() => validateGateEvidenceBytesV2({ ...validGate,
    evidence: forgedItems.map((item) => item.ref) } as any,
  new Map(forgedItems.map((item) => [item.ref.relativePath, item.content])), expected()))
    .toThrow(/backup_artifact_binding/i);
});

it("accepts bounded-memory descriptors for large G12 binary artifacts", () => {
  const items = validG12Items();
  const payloads = new Map(items.map((item) => [item.ref.relativePath, item.content] as const));
  for (const index of [5, 6]) {
    const item = items[index]!;
    payloads.set(item.ref.relativePath, { byteLength: item.content.length, sha256: item.ref.sha256 } as any);
  }
  const validGate = { ...gate("G12_PRODUCTION_BACKUP", items),
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.production_backup };
  expect(validateGateEvidenceBytesV2(validGate as any, payloads, expected())).toHaveLength(8);
});

it.each([
  ["Task0B hash", { task0bReleaseFreezeSha256: "f".repeat(64) }],
  ["production DB identity", { productionDatabaseIdentityFingerprintSha256: "f".repeat(64) }]
])("rejects G12 authority bound to the wrong %s", (_label, override) => {
  const items = validG12Items();
  const validGate = { ...gate("G12_PRODUCTION_BACKUP", items),
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.production_backup };
  expect(() => validateGateEvidenceBytesV2(validGate as any,
    new Map(items.map((item) => [item.ref.relativePath, item.content])),
    { ...expected(), ...override })).toThrow(/backup_artifact_binding/i);
});

function validG13Items() {
  const template = COMMAND_TEMPLATE_SHA256.production_migration;
  const attestation = ref("operational_attestation", "operational-attestation-g13.json",
    buildOperationalAttestationV2Fixture({ action: "g13_migration_passed", commandId: "production_migration",
      redactedTemplateSha256: template, sourceManifestSha256: SOURCE }));
  const authority = ref("production_migration_authority",
    `schema032-production-authority-${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}.json`, {
      version: "schema-032-production-authority-v1", scope: "schema_032_production_migration",
      source: "operator_protected_one_shot_production_go",
      generationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId, commandId: "production_migration",
      commandTemplateSha256: template, issuedAt: STARTED, expiresAt: "2026-07-18T10:10:00.000Z",
      candidateSha: CANDIDATE_SHA, databaseRole: "production",
      databaseIdentityFingerprintSha256: PRODUCTION_DATABASE_IDENTITY_SHA256,
      task0bEvidenceSha256: TASK0B_SHA256,
      releaseManifestPath: "release-manifest.json", releaseManifestSha256: SOURCE,
      releaseManifestOverall: "not_ready", backupEvidencePath: "production-backup-evidence.json",
      backupEvidenceSha256: "4".repeat(64), explicitGo: true
    });
  const authorityValue = JSON.parse(authority.content.toString("utf8"));
  const consumption = ref("production_migration_consumption",
    `schema032-production-authority-consumed-${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}.json`, {
      version: "schema-032-production-authority-consumption-v2",
      generationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId, authoritySha256: authority.ref.sha256,
      operationalAttestationSha256: attestation.ref.sha256,
      operationalAttestationIssuerReceiptSha256: "8".repeat(64),
      candidateSha: CANDIDATE_SHA,
      databaseIdentityFingerprintSha256: authorityValue.databaseIdentityFingerprintSha256,
      claimedAt: STARTED, resumeExpiresAt: authorityValue.expiresAt
    });
  const receiptCore = {
    version: "schema-032-production-execution-receipt-v2", candidateSha: CANDIDATE_SHA,
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256, operationalAttestationSha256: attestation.ref.sha256,
    operationalAttestationIssuerReceiptSha256: "8".repeat(64),
    authorityConsumptionSha256: consumption.ref.sha256, sourceManifestSha256: SOURCE,
    g12TransitionReceiptSha256: "5".repeat(64),
    productionBackupEvidenceSha256: authorityValue.backupEvidenceSha256, advisoryLockKey: 320032500,
    executionAttemptRelativePath: "",
    executionAttemptSha256: "",
    databaseSessionIdentitySha256: "6".repeat(64), lockAcquiredAt: STARTED,
    migrationBytesChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    migration033BytesChecksumSha256: "d04f2aff20370a78862604c92ccbcb6bf7c8b1024f95e03b4af2c8f018e701f7",
    migration034BytesChecksumSha256: "492820d6caade9ee879d73aff6365f911be823258112b39a0f5fbca1d56ec4cb",
    result: "applied_and_verified",
    completedStages: ["first_migration", "first_verification", "second_migration", "final_verification"]
      .map((step) => ({ step, receiptSha256: SHA })),
    receiptChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    postconditionsSha256: "7".repeat(64),
    schema033: {
      version: 33,
      migrationFilename: "033_unified_wallet_check.sql",
      checksumSha256: "d04f2aff20370a78862604c92ccbcb6bf7c8b1024f95e03b4af2c8f018e701f7",
      catalogSha256: "e3f1b6152d488f9a8557085b977b2b548f963046966ff04b88a67c222f1acaa4",
      verificationReceiptSha256: SHA
    },
    schema034: {
      version: 34,
      migrationFilename: "034_unified_check_adaptive_planner.sql",
      checksumSha256: "492820d6caade9ee879d73aff6365f911be823258112b39a0f5fbca1d56ec4cb",
      catalogSha256: "891df395c721ff7ac244a011e583e86a33f1364cce435ccb2af383a4f386af57",
      verificationReceiptSha256: SHA
    }
  };
  const attempt = ref("production_migration_attempt",
    "schema032-production-attempt-placeholder.json", {
      version: "schema-032-production-execution-attempt-v2",
      generationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
      candidateSha: CANDIDATE_SHA,
      authorityConsumptionSha256: consumption.ref.sha256,
      attemptOrdinal: 1,
      previousAttemptSha256: null,
      advisoryLockKey: 320032500,
      databaseSessionIdentitySha256: receiptCore.databaseSessionIdentitySha256,
      lockAcquiredAt: receiptCore.lockAcquiredAt
    });
  attempt.ref.relativePath = `schema032-production-attempt-${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}-${attempt.ref.sha256}.json`;
  receiptCore.executionAttemptRelativePath = attempt.ref.relativePath;
  receiptCore.executionAttemptSha256 = attempt.ref.sha256;
  const prepared = ref("production_migration_prepared_settlement",
    "schema032-production-settlement-prepared-placeholder.json", {
      version: "prepared-schema-032-production-settlement-v2", preparedAt: STARTED,
      executionReceiptCore: receiptCore
    });
  prepared.ref.relativePath = `schema032-production-settlement-prepared-${prepared.ref.sha256}.json`;
  const receipt = ref("production_migration_sequence", "schema032-production-execution-receipt-v2.json", {
    ...receiptCore,
    lockReleasedAt: FINISHED,
    preparedSettlementRelativePath: prepared.ref.relativePath,
    preparedSettlementSha256: prepared.ref.sha256
  });
  return [attestation, authority, consumption, attempt, prepared, receipt];
}

it("accepts a G13 standalone authority chain and rejects a swapped consumption authority", () => {
  const items = validG13Items();
  const validGate = { ...gate("G13_PRODUCTION_MIGRATION", items),
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.production_migration };
  expect(validateGateEvidenceBytesV2(validGate as any,
    new Map(items.map((item) => [item.ref.relativePath, item.content])), expected())).toHaveLength(6);
  const forged = JSON.parse(items[2]!.content.toString("utf8"));
  forged.authoritySha256 = "f".repeat(64);
  const forgedItem = ref(items[2]!.ref.kind, items[2]!.ref.relativePath, forged);
  const forgedItems = [items[0]!, items[1]!, forgedItem, items[3]!, items[4]!, items[5]!];
  expect(() => validateGateEvidenceBytesV2({ ...validGate,
    evidence: forgedItems.map((item) => item.ref) } as any,
  new Map(forgedItems.map((item) => [item.ref.relativePath, item.content])), expected()))
    .toThrow(/migration_artifact_binding/i);
});

it.each([
  ["Task0B hash", { task0bReleaseFreezeSha256: "f".repeat(64) }],
  ["production DB identity", { productionDatabaseIdentityFingerprintSha256: "f".repeat(64) }]
])("rejects G13 authority bound to the wrong %s", (_label, override) => {
  const items = validG13Items();
  const validGate = { ...gate("G13_PRODUCTION_MIGRATION", items),
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.production_migration };
  expect(() => validateGateEvidenceBytesV2(validGate as any,
    new Map(items.map((item) => [item.ref.relativePath, item.content])),
    { ...expected(), ...override })).toThrow(/migration_artifact_binding/i);
});

function orchestration(kind: "rollout" | "canary") {
  const steps = kind === "rollout"
    ? ["verify_g13", "verify_schema", "verify_previous_runtime_identity", "verify_singleton_precondition",
      "stop_previous", "prove_previous_stopped", "start_candidate", "prove_candidate_started",
      "immediate_runtime_checks"]
    : ["verify_g14", "observe_cycle_1", "observe_cycle_2", "bounded_runtime_checks"];
  const operationId = `production-${kind}-operation`;
  const commandId = `production_${kind}`;
  const completedStepReceipts = steps.map((stepId, index) => {
    const external = stepId === "stop_previous" || stepId === "start_candidate";
    const receipt = {
      version: "production-orchestration-step-receipt-v2",
      operationId,
      operationClaimSha256: "b".repeat(64),
      authorityConsumptionSha256: "c".repeat(64),
      operationLeaseSha256: "d".repeat(64),
      operationLeaseEpoch: 1,
      operationDeadlineAt: "2026-07-18T10:30:00.000Z",
      inputSha256: "e".repeat(64),
      outputSha256: String(index + 1).repeat(64).slice(0, 64),
      observedStateSha256: String(index + 2).repeat(64).slice(0, 64),
      sequence: index + 1,
      startedAt: `2026-07-18T10:${String(index).padStart(2, "0")}:00.000Z`,
      finishedAt: `2026-07-18T10:${String(index).padStart(2, "0")}:01.000Z`,
      recoveredAfterCrash: false,
      verifiedChecks: null,
      result: "completed",
      capability: "effect_capable",
      commandId,
      redactedTemplateSha256: "f".repeat(64),
      executionKind: external ? "external_effect" : "local_validation",
      stepIntentRelativePath: external
        ? `production-operation-step-intents/${operationId}/${index + 1}-${stepId}-1-v2.json` : null,
      stepIntentSha256: external ? "9".repeat(64) : null,
      orchestration: kind,
      stepId
    };
    return {
      relativePath: `production-operation-step-receipts/${operationId}/${index + 1}-${stepId}-v2.json`,
      sha256: releaseSha256V2(bytes(receipt)),
      receipt
    };
  });
  const receipt = {
    version: "production-orchestration-receipt-v2",
    candidateSha: CANDIDATE_SHA,
    releaseGenerationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
    sourceManifestSha256: SOURCE,
    operationId,
    operationClaimSha256: "b".repeat(64),
    finalOperationLeaseSha256: "d".repeat(64),
    finalOperationLeaseEpoch: 1,
    operationDeadlineAt: "2026-07-18T10:30:00.000Z",
    operationLeaseTakeoverChainSha256: "1".repeat(64),
    operationalAttestationConsumptionSha256: "c".repeat(64),
    redactedTemplateSha256: "f".repeat(64),
    result: "completed",
    orchestration: kind,
    capability: "effect_capable",
    commandId,
    recoveryInputSha256: null,
    completedStepReceipts
  };
  const captures = completedStepReceipts.map(({ receipt: item }) => ({
    stepId: item.stepId,
    sequence: item.sequence,
    executionKind: item.executionKind,
    outputSha256: item.outputSha256,
    observedStateSha256: item.observedStateSha256
  }));
  return { receipt, captures, operationId };
}

it("rejects G14 evidence whose manager hash names different canonical bytes", () => {
  const built = orchestration("rollout");
  const queries = { version: "production-orchestration-captures-v2", operationId: built.operationId,
    captures: built.captures };
  const manager = { version: "production-manager-captures-v2", operationId: built.operationId,
    captures: built.captures.filter((item) => item.executionKind === "external_effect") };
  const evidence = {
    version: "production-rollout-evidence-v2",
    candidateSha: CANDIDATE_SHA,
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256,
    operationalAttestationConsumptionSha256: "c".repeat(64),
    sourceManifestSha256: SOURCE,
    previousStopEvidenceSha256: built.captures.find((item) => item.stepId === "stop_previous")!.outputSha256,
    candidateStartEvidenceSha256: built.captures.find((item) => item.stepId === "start_candidate")!.outputSha256,
    managerCapturesSha256: "0".repeat(64),
    queryCapturesSha256: releaseSha256V2(bytes(queries)),
    orchestrationReceiptSha256: releaseSha256V2(bytes(built.receipt)),
    checks: { schema: true, version: true, admin: true, singleton: true, workers: true,
      logs: true, delivery: true, legacy: true },
    result: "passed"
  };
  expect(() => validateProductionNestedGateEvidenceV2({
    gateId: "G14_PRODUCTION_ROLLOUT",
    evidence,
    managerCaptures: manager,
    queryCaptures: queries,
    orchestrationReceipt: built.receipt
  })).toThrow(/manager.*hash/i);
});

it("rejects G15 evidence whose log capture set is fabricated", () => {
  const built = orchestration("canary");
  const queries = { version: "production-orchestration-captures-v2", operationId: built.operationId,
    captures: built.captures };
  const logs = { version: "production-canary-log-captures-v2", operationId: built.operationId,
    captureSha256s: ["f".repeat(64)] };
  const evidence = {
    version: "production-canary-evidence-v2",
    candidateSha: CANDIDATE_SHA,
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256,
    operationalAttestationConsumptionSha256: "c".repeat(64),
    sourceManifestSha256: SOURCE,
    observationStartedAt: STARTED,
    observationFinishedAt: FINISHED,
    completedPollingCycles: 2,
    queryCapturesSha256: releaseSha256V2(bytes(queries)),
    logCapturesSha256: releaseSha256V2(bytes(logs)),
    orchestrationReceiptSha256: releaseSha256V2(bytes(built.receipt)),
    checks: { schema: true, version: true, admin: true, singleton: true, reconciliation: true,
      delivery: true, navigation: true, allowance: true, legacy: true, secrets: true, queues: true,
      honest_limits: true },
    result: "passed"
  };
  expect(() => validateProductionNestedGateEvidenceV2({
    gateId: "G15_PRODUCTION_CANARY",
    evidence,
    queryCaptures: queries,
    logCaptures: logs,
    orchestrationReceipt: built.receipt
  })).toThrow(/log.*capture/i);
});

it("derives the expected production source manifest from the canonical offline lineage", () => {
  const source: any = buildReleaseManifestV2Fixture({
    transitionId: "readiness",
    overall: "ready_for_release",
    gates: buildReleaseManifestV2Fixture().gates.map((gate: any, index: number) => index <= 11
      ? gate.state === "passed" ? gate : buildExecutedReleaseGateV2Fixture(gate.id)
      : gate)
  });
  const sourceBytes = bytes(source);
  const sourceSha256 = releaseSha256V2(sourceBytes);
  const target: any = buildReleaseManifestV2Fixture({
    revision: 2,
    previousManifestSha256: sourceSha256,
    transitionId: "g12_backup_passed",
    overall: "not_ready",
    gates: source.gates.map((gate: any) => gate.id === "G12_PRODUCTION_BACKUP"
      ? buildExecutedReleaseGateV2Fixture(gate.id) : gate)
  });
  const path = `manifest-snapshots/release-manifest-r1-${sourceSha256}.json`;
  expect(deriveProductionGateSourceManifestBindingsV2(target, new Map([[path, sourceBytes]])))
    .toEqual({ G12_PRODUCTION_BACKUP: sourceSha256 });
});
