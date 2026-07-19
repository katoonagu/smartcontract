import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  deriveTask0BProductionGateBindingV2,
  validateGateEvidenceBytesV2,
  validateProductionNestedGateEvidenceV2
} from "../../src/release/releaseGateEvidencePolicy";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import { releaseSha256V2 } from "../../src/release/remediationReleaseManifestV2";
import { deriveProductionGateSourceManifestBindingsV2 } from "../../src/release/remediationReleaseManifestV2";
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
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256,
    sourceManifestSha256: SOURCE,
    task0bReleaseFreezeSha256: TASK0B_SHA256,
    productionDatabaseIdentityFingerprintSha256: PRODUCTION_DATABASE_IDENTITY_SHA256
  };
}

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
    result: "applied_and_verified",
    completedStages: ["first_migration", "first_verification", "second_migration", "final_verification"]
      .map((step) => ({ step, receiptSha256: SHA })),
    receiptChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    postconditionsSha256: SHA
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
      version: "schema-032-production-authority-consumption-v1",
      generationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId, authoritySha256: authority.ref.sha256,
      candidateSha: CANDIDATE_SHA,
      databaseIdentityFingerprintSha256: authorityValue.databaseIdentityFingerprintSha256,
      claimedAt: STARTED, resumeExpiresAt: authorityValue.expiresAt
    });
  const receipt = ref("production_migration_sequence", "schema032-production-execution-receipt-v2.json", {
    version: "schema-032-production-execution-receipt-v2", candidateSha: CANDIDATE_SHA,
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256, operationalAttestationSha256: authority.ref.sha256,
    authorityConsumptionSha256: consumption.ref.sha256, sourceManifestSha256: SOURCE,
    g12TransitionReceiptSha256: "5".repeat(64),
    productionBackupEvidenceSha256: authorityValue.backupEvidenceSha256, advisoryLockKey: 320032500,
    databaseSessionIdentitySha256: "6".repeat(64), lockAcquiredAt: STARTED, lockReleasedAt: FINISHED,
    migrationBytesChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    result: "applied_and_verified",
    completedStages: ["first_migration", "first_verification", "second_migration", "final_verification"]
      .map((step) => ({ step, receiptSha256: SHA })),
    receiptChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    postconditionsSha256: "7".repeat(64)
  });
  return [attestation, authority, consumption, receipt];
}

it("accepts a G13 standalone authority chain and rejects a swapped consumption authority", () => {
  const items = validG13Items();
  const validGate = { ...gate("G13_PRODUCTION_MIGRATION", items),
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.production_migration };
  expect(validateGateEvidenceBytesV2(validGate as any,
    new Map(items.map((item) => [item.ref.relativePath, item.content])), expected())).toHaveLength(4);
  const forged = JSON.parse(items[2]!.content.toString("utf8"));
  forged.authoritySha256 = "f".repeat(64);
  const forgedItem = ref(items[2]!.ref.kind, items[2]!.ref.relativePath, forged);
  const forgedItems = [items[0]!, items[1]!, forgedItem, items[3]!];
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
