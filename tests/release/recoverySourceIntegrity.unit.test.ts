import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRecoverySource } from "../../src/release/productionOperationAdaptersV2";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import {
  releaseSha256V2,
  rootWriterOwnerProcessIdentitySha256V2
} from "../../src/release/remediationReleaseManifestV2";
import { PRODUCTION_OPERATION_CLEANUP_ONLY_TAKEOVER_TEMPLATE_SHA256_V2 }
  from "../../src/release/productionOperationStore";

const OPERATION_ID = `production-rollout-${"1".repeat(64)}`;
const NOW = "2026-07-19T00:00:00.000Z";
const ABANDONED_AT = "2026-07-19T00:30:00.000Z";
const DEADLINE = "2026-07-19T00:30:00.000Z";
const STEPS = ["verify_g13", "verify_schema", "verify_previous_runtime_identity",
  "verify_singleton_precondition"] as const;

function protectedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "plan5-recovery-integrity-"));
  if (process.platform === "win32") {
    const sid = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { encoding: "utf8" }).trim();
    execFileSync("icacls.exe", [root, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  }
  return root;
}

function save(root: string, relativePath: string, value: unknown): string {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  const bytes = canonicalBytesV2(value);
  writeFileSync(path, bytes);
  return releaseSha256V2(bytes);
}

function fixture(options: { orphanSequence?: 5 | 7; includeSecondOrphan?: boolean } = {}) {
  const root = protectedRoot();
  const candidateSha = "a".repeat(40);
  const releaseGenerationId = "generation-123456";
  const sourceManifestSha256 = "b".repeat(64);
  const artifactRootFingerprintSha256 = "c".repeat(64);
  const operationalAttestationSha256 = "d".repeat(64);
  const issuerReceiptSha256 = "e".repeat(64);
  const ownerFingerprint = "f".repeat(64);
  const ownerIdentity = rootWriterOwnerProcessIdentitySha256V2(1234, ownerFingerprint);
  const originalLease = {
    version: "production-operation-lease-v2" as const,
    scope: "artifact_root_production_operation" as const,
    relativePath: "production-operation-root.lease.json" as const,
    operationKind: "rollout" as const, operationId: OPERATION_ID, candidateSha,
    releaseGenerationId, sourceManifestSha256, artifactRootFingerprintSha256,
    operationalAttestationSha256, recoveryFromAbandonedOperationSha256: null,
    capability: "effect_capable" as const, leaseEpoch: 1, ownerPid: 1234,
    ownerProcessStartFingerprintSha256: ownerFingerprint,
    acquiredAt: NOW, heartbeatAt: NOW, expiresAt: "2026-07-19T00:01:00.000Z",
    operationDeadlineAt: DEADLINE
  };
  const leaseSha256 = releaseSha256V2(canonicalBytesV2(originalLease));
  const preclaim = {
    version: "production-authority-preclaim-validation-v2" as const,
    operationKind: "rollout" as const, operationId: OPERATION_ID, candidateSha,
    releaseGenerationId, sourceManifestSha256, artifactRootFingerprintSha256,
    operationalAttestationSha256, operationalAttestationIssuerReceiptSha256: issuerReceiptSha256,
    recoveryFromAbandonedOperationSha256: null, commandId: "production_rollout" as const,
    redactedTemplateSha256: "1".repeat(64), originalLeaseSha256: leaseSha256,
    originalLeaseEpoch: 1, originalLeaseOwnerProcessIdentitySha256: ownerIdentity,
    checkedAt: NOW, expiresAt: "2026-07-19T01:00:00.000Z", operationDeadlineAt: DEADLINE,
    minimumRequiredValidityMs: 1, status: "fresh_compatible_unconsumed" as const
  };
  const preclaimSha256 = save(root, `production-authority-preclaim-${OPERATION_ID}.json`, preclaim);
  const lineagePath = `production-preclaim-lease-lineages/${OPERATION_ID}/${leaseSha256}.json`;
  const lineage = {
    version: "production-preclaim-lease-lineage-v2" as const,
    operationId: OPERATION_ID, relativePath: lineagePath,
    preclaimValidationSha256: preclaimSha256, previousLineageSha256: null,
    originalLeaseSha256: leaseSha256, originalLeaseEpoch: 1,
    originalLeaseOwnerProcessIdentitySha256: ownerIdentity,
    committedTakeoverReceiptSuffixSha256s: [] as [], currentTipLeaseSha256: leaseSha256,
    currentTipLeaseEpoch: 1, currentTipLeaseOwnerProcessIdentitySha256: ownerIdentity,
    lineageStartedAt: NOW, resolvedAt: NOW
  };
  const lineageSha256 = save(root, lineagePath, lineage);
  const consumption = {
    version: "operational-attestation-consumption-v2" as const,
    operationKind: "rollout" as const, operationId: OPERATION_ID, candidateSha,
    releaseGenerationId, sourceManifestSha256, artifactRootFingerprintSha256,
    operationalAttestationSha256, operationalAttestationIssuerReceiptSha256: issuerReceiptSha256,
    recoveryFromAbandonedOperationSha256: null, preclaimValidationSha256: preclaimSha256,
    preclaimLeaseLineageRelativePath: lineagePath, preclaimLeaseLineageSha256: lineageSha256,
    preclaimLeaseLineageCurrentTipSha256: leaseSha256, commandId: "production_rollout" as const,
    redactedTemplateSha256: "1".repeat(64), leaseSha256AtConsumption: leaseSha256,
    leaseEpochAtConsumption: 1, consumedAt: NOW, expiresAt: "2026-07-19T01:00:00.000Z",
    operationDeadlineAt: DEADLINE
  };
  const consumptionSha256 = releaseSha256V2(canonicalBytesV2(consumption));
  const claim = {
    version: "production-operation-claim-v2" as const,
    operationKind: "rollout" as const, operationId: OPERATION_ID, candidateSha,
    releaseGenerationId, sourceManifestSha256, artifactRootFingerprintSha256,
    operationalAttestationSha256, operationalAttestationIssuerReceiptSha256: issuerReceiptSha256,
    recoveryFromAbandonedOperationSha256: null, authorityConsumption: consumption,
    authorityConsumptionSha256: consumptionSha256, preclaimLeaseLineageRelativePath: lineagePath,
    preclaimLeaseLineageSha256: lineageSha256, preclaimLeaseLineageCurrentTipSha256: leaseSha256,
    capability: "effect_capable" as const, leaseEpochAtConsumption: 1,
    operationDeadlineAt: DEADLINE, claimedAt: NOW, claimantPid: 1234,
    claimantProcessStartFingerprintSha256: ownerFingerprint
  };
  const claimSha256 = save(root,
    `production-operation-claim-${operationalAttestationSha256}.json`, claim);
  const refs = STEPS.map((stepId, index) => {
    const sequence = index + 1;
    const receipt = {
      version: "production-orchestration-step-receipt-v2" as const,
      operationId: OPERATION_ID, operationClaimSha256: claimSha256,
      authorityConsumptionSha256: consumptionSha256, operationLeaseSha256: leaseSha256,
      operationLeaseEpoch: 1, operationDeadlineAt: DEADLINE,
      inputSha256: "5".repeat(64), outputSha256: "6".repeat(64),
      observedStateSha256: "7".repeat(64), sequence, startedAt: NOW, finishedAt: NOW,
      recoveredAfterCrash: false, verifiedChecks: null, result: "completed" as const,
      capability: "effect_capable" as const, commandId: "production_rollout" as const,
      redactedTemplateSha256: "8".repeat(64), executionKind: "local_validation" as const,
      stepIntentRelativePath: null, stepIntentSha256: null, orchestration: "rollout" as const, stepId
    };
    const relativePath = `production-operation-steps/${OPERATION_ID}/${sequence}-${stepId}-v2.json`;
    return { relativePath, sha256: save(root, relativePath, receipt), receipt };
  });
  const orphan = (sequence: 5 | 7) => {
    const stepId = sequence === 5 ? "stop_previous" as const : "start_candidate" as const;
    const relativePath = `production-operation-step-intents/${OPERATION_ID}/${sequence}-${stepId}-1-v2.json`;
    const intent = {
      version: "production-orchestration-step-intent-v2" as const, capability: "effect_capable" as const,
      orchestration: "rollout" as const, operationId: OPERATION_ID, operationClaimSha256: claimSha256,
      authorityConsumptionSha256: consumptionSha256, sequence, stepId, attempt: 1 as const, relativePath,
      currentOperationLeaseSha256: leaseSha256, currentOperationLeaseEpoch: 1,
      commandId: "production_rollout" as const, redactedTemplateSha256: "8".repeat(64),
      inputSha256: "5".repeat(64), intendedExternalEffectSha256: "9".repeat(64), preparedAt: NOW
    };
    save(root, relativePath, intent);
    return { relativePath, intent };
  };
  const orphanRecord = options.orphanSequence ? orphan(options.orphanSequence) : null;
  if (options.includeSecondOrphan) orphan(7);
  const cleanupLease = { ...originalLease, capability: "cleanup_only" as const, leaseEpoch: 2,
    acquiredAt: ABANDONED_AT, heartbeatAt: ABANDONED_AT,
    expiresAt: "2026-07-19T00:31:00.000Z" };
  const cleanupLeaseBytes = canonicalBytesV2(cleanupLease);
  const cleanupLeaseSha256 = releaseSha256V2(cleanupLeaseBytes);
  const preparedCleanup = {
    version: "prepared-cleanup-only-production-operation-takeover-v2" as const,
    commandId: "production_operation_cleanup_only_takeover" as const,
    redactedTemplateSha256: PRODUCTION_OPERATION_CLEANUP_ONLY_TAKEOVER_TEMPLATE_SHA256_V2,
    capability: "cleanup_only" as const, operationKind: "rollout" as const,
    operationId: OPERATION_ID, candidateSha, releaseGenerationId, sourceManifestSha256,
    artifactRootFingerprintSha256, authorityConsumptionSha256: consumptionSha256,
    terminalReason: "operation_deadline_reached" as const, oldLeaseSha256: leaseSha256,
    oldLeaseEpoch: 1, oldOwnerProcessIdentitySha256: ownerIdentity,
    canonicalNewLease: cleanupLease, canonicalNewLeaseUtf8Base64: cleanupLeaseBytes.toString("base64"),
    newLeaseSha256: cleanupLeaseSha256, newLeaseEpoch: 2, operationDeadlineAt: DEADLINE,
    preparedAt: ABANDONED_AT
  };
  const preparedCleanupSha256 = save(root,
    `production-operation-root.lease-cleanup-only-prepared-${leaseSha256}.json`, preparedCleanup);
  save(root, `production-operation-root.lease-tombstone-${leaseSha256}.json`, originalLease);
  const cleanupTakeover = {
    version: "cleanup-only-production-operation-takeover-v2" as const,
    commandId: "production_operation_cleanup_only_takeover" as const,
    redactedTemplateSha256: PRODUCTION_OPERATION_CLEANUP_ONLY_TAKEOVER_TEMPLATE_SHA256_V2,
    capability: "cleanup_only" as const, operationKind: "rollout" as const,
    operationId: OPERATION_ID, candidateSha, releaseGenerationId, sourceManifestSha256,
    artifactRootFingerprintSha256, authorityConsumptionSha256: consumptionSha256,
    terminalReason: "operation_deadline_reached" as const,
    preparedTakeoverSha256: preparedCleanupSha256, oldLeaseSha256: leaseSha256,
    tombstoneRelativePath: `production-operation-root.lease-tombstone-${leaseSha256}.json`,
    newLeaseSha256: cleanupLeaseSha256, newLeaseEpoch: 2, operationDeadlineAt: DEADLINE,
    committedAt: ABANDONED_AT
  };
  const cleanupTakeoverBytes = canonicalBytesV2(cleanupTakeover);
  const cleanupTakeoverSha256 = releaseSha256V2(cleanupTakeoverBytes);
  save(root, `production-operation-root.lease-cleanup-only-committed-${cleanupTakeoverSha256}.json`,
    cleanupTakeover);
  const terminal = {
    version: "production-operation-terminal-abandoned-v2" as const,
    operationKind: "rollout" as const, operationId: OPERATION_ID, candidateSha,
    releaseGenerationId, sourceManifestSha256,
    claimSha256, authorityConsumptionSha256: consumptionSha256,
    capability: "cleanup_only" as const, cleanupOnlyTakeoverSha256: cleanupTakeoverSha256,
    finalLeaseSha256: cleanupLeaseSha256, finalLeaseEpoch: 2,
    completedStepReceiptSetSha256: releaseSha256V2(canonicalBytesV2(
      refs.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })))),
    attemptedExternalEffect: options.orphanSequence !== undefined,
    reason: "operation_deadline_reached" as const, abandonedAt: ABANDONED_AT
  };
  const terminalPath = `production-operation-terminal-abandoned-${OPERATION_ID}.json`;
  const terminalSha256 = save(root, terminalPath, terminal);
  const cleanup = {
    version: "production-operation-terminal-cleanup-v2" as const,
    operationKind: "rollout" as const, operationId: OPERATION_ID,
    terminalStateSha256: terminalSha256, capability: "cleanup_only" as const,
    preparedRemovalSha256: "d".repeat(64), leaseRemovalReceiptSha256: "e".repeat(64),
    removedLeaseSha256: cleanupLeaseSha256, cleanedAt: ABANDONED_AT
  };
  const cleanupPath = `production-operation-terminal-cleanup-${OPERATION_ID}.json`;
  save(root, cleanupPath, cleanup);
  return { root, refs, terminal, terminalPath, cleanup, cleanupPath, orphanRecord,
    claim, claimPath: `production-operation-claim-${operationalAttestationSha256}.json`,
    preclaim, preclaimPath: `production-authority-preclaim-${OPERATION_ID}.json`,
    lineage, lineagePath };
}

describe("abandoned production recovery source integrity", () => {
  it("accepts one exact contiguous receipt prefix and one exact next uncertain intent", () => {
    const value = fixture({ orphanSequence: 5 });
    expect(loadRecoverySource(value.root)).toMatchObject({
      priorOperationId: OPERATION_ID,
      completedStepReceiptPrefix: value.refs.map(({ receipt, sha256 }) => ({
        sequence: receipt.sequence, stepId: receipt.stepId, receiptSha256: sha256
      })),
      uncertainStepMarker: { sequence: 5, stepId: "stop_previous" }
    });
  });

  it.each(["forged_claim", "foreign_receipt_lease", "foreign_intent_lease", "cleanup_lease",
    "aggregate_hash", "foreign_operation", "claim_artifact", "preclaim", "lineage",
    "embedded_consumption"] as const)(
    "rejects %s instead of deriving recovery authority",
    (mutation) => {
      const value = fixture({ orphanSequence: 5 });
      if (mutation === "cleanup_lease") save(value.root, value.cleanupPath,
        { ...value.cleanup, removedLeaseSha256: "f".repeat(64) });
      else if (mutation === "aggregate_hash") save(value.root, value.terminalPath,
        { ...value.terminal, completedStepReceiptSetSha256: "f".repeat(64) });
      else if (mutation === "claim_artifact") save(value.root, value.claimPath,
        { ...value.claim, authorityConsumptionSha256: "0".repeat(64) });
      else if (mutation === "preclaim") save(value.root, value.preclaimPath,
        { ...value.preclaim, originalLeaseSha256: "0".repeat(64) });
      else if (mutation === "lineage") save(value.root, value.lineagePath,
        { ...value.lineage, currentTipLeaseSha256: "0".repeat(64) });
      else if (mutation === "embedded_consumption") save(value.root, value.claimPath,
        { ...value.claim, authorityConsumption: { ...value.claim.authorityConsumption,
          leaseSha256AtConsumption: "0".repeat(64) } });
      else if (mutation === "foreign_intent_lease") {
        save(value.root, value.orphanRecord!.relativePath, {
          ...value.orphanRecord!.intent,
          currentOperationLeaseSha256: "f".repeat(64)
        });
      } else {
        const first = value.refs[0]!;
        save(value.root, first.relativePath, { ...first.receipt,
          ...(mutation === "forged_claim" ? { operationClaimSha256: "f".repeat(64) }
            : mutation === "foreign_receipt_lease" ? { operationLeaseSha256: "f".repeat(64) }
            : { operationId: `production-rollout-${"f".repeat(64)}` }) });
      }
      expect(() => loadRecoverySource(value.root)).toThrow(/recovery|binding|cleanup|step|completed/i);
    }
  );

  it("rejects a later orphan intent and two orphan intents", () => {
    const later = fixture({ orphanSequence: 7 });
    expect(() => loadRecoverySource(later.root)).toThrow(/uncertain|ambiguous/i);
    const two = fixture({ orphanSequence: 5, includeSecondOrphan: true });
    expect(() => loadRecoverySource(two.root)).toThrow(/uncertain|ambiguous/i);
    rmSync(later.root, { recursive: true, force: true });
    rmSync(two.root, { recursive: true, force: true });
  }, 20_000);
});
