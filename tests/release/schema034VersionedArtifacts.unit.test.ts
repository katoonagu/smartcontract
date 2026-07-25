import { expect, it } from "vitest";
import {
  validatePreparedSchema032ProductionSettlementV2,
  validatePreparedSchema032ProductionSettlementV3,
  validatePreparedSchema032ProductionSettlementVersioned,
  validateSchema032ProductionExecutionReceiptV2,
  validateSchema032ProductionExecutionReceiptV3,
  validateSchema032ProductionExecutionReceiptVersioned,
  validateSchema032ReleaseEvidenceV1,
  validateSchema032ReleaseEvidenceV2,
  validateSchema032ReleaseEvidenceVersioned
} from "../../src/release/remediationReleaseManifestV2";
import { UNIFIED_SCHEMA_034_CATALOG_SHA256 } from "../../src/storage/schemaMigrations";

const SHA256 = "a".repeat(64);
const CANDIDATE = "b".repeat(40);
const SCHEMA032 = "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d";
const SCHEMA033 = "d04f2aff20370a78862604c92ccbcb6bf7c8b1024f95e03b4af2c8f018e701f7";
const SCHEMA034 = "492820d6caade9ee879d73aff6365f911be823258112b39a0f5fbca1d56ec4cb";
const T0 = "2026-07-18T10:00:00.000Z";
const T1 = "2026-07-18T10:10:00.000Z";

const schema033 = {
  version: 33 as const,
  migrationFilename: "033_unified_wallet_check.sql" as const,
  checksumSha256: SCHEMA033,
  catalogSha256: "e3f1b6152d488f9a8557085b977b2b548f963046966ff04b88a67c222f1acaa4",
  verificationReceiptSha256: SHA256
};
const schema034 = {
  version: 34 as const,
  migrationFilename: "034_unified_check_adaptive_planner.sql" as const,
  checksumSha256: SCHEMA034,
  catalogSha256: UNIFIED_SCHEMA_034_CATALOG_SHA256,
  verificationReceiptSha256: SHA256
};
const oldEvidence = {
  candidateSha: CANDIDATE,
  databaseRole: "clean" as const,
  databaseFingerprintSha256: SHA256,
  migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql" as const,
  candidateBytesChecksumSha256: SCHEMA032,
  receiptChecksumSha256: SCHEMA032,
  shortChecksum: SCHEMA032.slice(0, 12),
  postconditionsSha256: SHA256,
  schema033,
  firstApply: "applied" as const,
  secondApply: "already_verified" as const
};
const currentEvidence = {
  version: "schema-032-release-evidence-v2" as const,
  ...oldEvidence,
  schema034
};

const receiptCommon = {
  candidateSha: CANDIDATE,
  releaseFreezeIdentitySha256: SHA256,
  operationalAttestationSha256: SHA256,
  authorityConsumptionSha256: SHA256,
  sourceManifestSha256: SHA256,
  g12TransitionReceiptSha256: SHA256,
  productionBackupEvidenceSha256: SHA256,
  executionAttemptRelativePath: `schema032-production-attempt-schema-migration-generation-0001-${SHA256}.json`,
  executionAttemptSha256: SHA256,
  advisoryLockKey: 320032500 as const,
  databaseSessionIdentitySha256: SHA256,
  lockAcquiredAt: T0,
  lockReleasedAt: T1,
  preparedSettlementRelativePath: `schema032-production-settlement-prepared-${SHA256}.json`,
  preparedSettlementSha256: SHA256,
  migrationBytesChecksumSha256: SCHEMA032,
  migration033BytesChecksumSha256: SCHEMA033,
  result: "applied_and_verified" as const,
  completedStages: ["first_migration", "first_verification", "second_migration", "final_verification"]
    .map((step) => ({ step, receiptSha256: SHA256 })),
  receiptChecksumSha256: SCHEMA032,
  postconditionsSha256: SHA256,
  schema033
};
const oldReceipt = {
  version: "schema-032-production-execution-receipt-v2" as const,
  ...receiptCommon
};
const currentReceipt = {
  version: "schema-032-production-execution-receipt-v3" as const,
  ...receiptCommon,
  migration034BytesChecksumSha256: SCHEMA034,
  schema034
};

it("preserves exact historical schema release evidence and accepts current evidence only as V2", () => {
  expect(validateSchema032ReleaseEvidenceV1(oldEvidence)).toEqual(oldEvidence);
  expect(validateSchema032ReleaseEvidenceVersioned(oldEvidence)).toEqual(oldEvidence);
  expect(validateSchema032ReleaseEvidenceV2(currentEvidence)).toEqual(currentEvidence);
  expect(validateSchema032ReleaseEvidenceVersioned(currentEvidence)).toEqual(currentEvidence);
  expect(() => validateSchema032ReleaseEvidenceV1({ ...oldEvidence, schema034 })).toThrow();
  const { schema034: _schema034, ...missingSchema034 } = currentEvidence;
  expect(() => validateSchema032ReleaseEvidenceV2(missingSchema034)).toThrow();
});

it("preserves exact historical production receipt and uses an unambiguous V3 for schema 034", () => {
  expect(validateSchema032ProductionExecutionReceiptV2(oldReceipt)).toEqual(oldReceipt);
  expect(validateSchema032ProductionExecutionReceiptVersioned(oldReceipt)).toEqual(oldReceipt);
  expect(validateSchema032ProductionExecutionReceiptV3(currentReceipt)).toEqual(currentReceipt);
  expect(validateSchema032ProductionExecutionReceiptVersioned(currentReceipt)).toEqual(currentReceipt);
  expect(() => validateSchema032ProductionExecutionReceiptV2({
    ...oldReceipt,
    migration034BytesChecksumSha256: SCHEMA034,
    schema034
  })).toThrow();
  const { schema034: _schema034, ...missingSchema034 } = currentReceipt;
  expect(() => validateSchema032ProductionExecutionReceiptV3(missingSchema034)).toThrow();
});

it("preserves V2 prepared settlements and dispatches current schema 034 settlement bytes as V3", () => {
  const { lockReleasedAt: _oldReleased, preparedSettlementRelativePath: _oldPath,
    preparedSettlementSha256: _oldSha, ...oldCore } = oldReceipt;
  const oldPrepared = {
    version: "prepared-schema-032-production-settlement-v2" as const,
    preparedAt: T1,
    executionReceiptCore: oldCore
  };
  expect(validatePreparedSchema032ProductionSettlementV2(oldPrepared)).toEqual(oldPrepared);
  expect(validatePreparedSchema032ProductionSettlementVersioned(oldPrepared)).toEqual(oldPrepared);

  const { lockReleasedAt: _currentReleased, preparedSettlementRelativePath: _currentPath,
    preparedSettlementSha256: _currentSha, ...currentCore } = currentReceipt;
  const currentPrepared = {
    version: "prepared-schema-032-production-settlement-v3" as const,
    preparedAt: T1,
    executionReceiptCore: currentCore
  };
  expect(validatePreparedSchema032ProductionSettlementV3(currentPrepared)).toEqual(currentPrepared);
  expect(validatePreparedSchema032ProductionSettlementVersioned(currentPrepared)).toEqual(currentPrepared);
});
