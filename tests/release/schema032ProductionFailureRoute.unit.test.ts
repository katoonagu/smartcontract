import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateProductionFailureEvidenceV2,
  validateSchema032ProductionExecutionReceiptV2
} from "../../src/release/remediationReleaseManifestV2";
import {
  persistSchema032ProductionFailureRouteV2
} from "../../scripts/runSchema032ReleaseSequence";

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
const candidateSha = "a".repeat(40);
const digest = (character: string): string => character.repeat(64);
const stages = ["first_migration", "first_verification", "second_migration", "final_verification"] as const;

describe("schema 032 production failure route", () => {
  it.each(stages)("persists %s as exact typed G13 failure evidence bound to immutable bytes", async (failedStep) => {
    const root = mkdtempSync(join(tmpdir(), "plan5-g13-failure-route-"));
    try {
      const completedStages = stages.slice(0, stages.indexOf(failedStep))
        .map((step, index) => ({ step, receiptSha256: digest(String(index + 1)) }));
      const result = await persistSchema032ProductionFailureRouteV2(root, {
        executionReceipt: {
          version: "schema-032-production-execution-receipt-v2",
          candidateSha,
          releaseFreezeIdentitySha256: digest("b"),
          operationalAttestationSha256: digest("c"),
          authorityConsumptionSha256: digest("d"),
          sourceManifestSha256: digest("e"),
          g12TransitionReceiptSha256: digest("f"),
          productionBackupEvidenceSha256: digest("1"),
          advisoryLockKey: 320032500,
          databaseSessionIdentitySha256: digest("2"),
          lockAcquiredAt: "2026-07-19T10:00:00.000Z",
          lockReleasedAt: "2026-07-19T10:00:01.000Z",
          migrationBytesChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
          result: "failed_after_attempt",
          failedStep,
          completedStages
        },
        failureCode: "schema_032_migration_command_failed"
      });

      const stageFailureBytes = readFileSync(join(root, result.executionReceipt.failureArtifact.relativePath));
      const executionReceiptBytes = readFileSync(join(root, "schema032-production-execution-receipt-v2.json"));
      const failureEvidenceBytes = readFileSync(join(root, "production-failure-evidence-v2.json"));

      expect(result.executionReceipt.failureArtifact.evidenceSha256).toBe(sha256(stageFailureBytes));
      expect(result.failureEvidence.failedExecutionEvidenceSha256).toBe(sha256(executionReceiptBytes));
      expect(JSON.parse(failureEvidenceBytes.toString("utf8"))).toEqual(result.failureEvidence);
      expect(validateSchema032ProductionExecutionReceiptV2(result.executionReceipt)).toEqual(result.executionReceipt);
      expect(validateProductionFailureEvidenceV2(result.failureEvidence)).toMatchObject({
        candidateSha,
        releaseFreezeIdentitySha256: digest("b"),
        sourceManifestSha256: digest("e"),
        failedGateId: "G13_PRODUCTION_MIGRATION",
        evidenceKind: "schema032_execution_receipt",
        attemptedExternalEffect: true,
        failureCode: `${failedStep}_failed`
      });
      expect(stageFailureBytes.toString("utf8")).not.toContain(result.executionReceipt.failureArtifact.evidenceSha256);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
