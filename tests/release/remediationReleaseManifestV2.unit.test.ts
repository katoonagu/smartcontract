import { describe, expect, it } from "vitest";
import {
  RELEASE_GATE_IDS_V2,
  REQUIRED_ACCEPTANCE_IDS_V2,
  REQUIRED_REQUIREMENT_IDS_V2,
  canonicalReleaseJsonV2,
  createInitialRemediationReleaseManifestV2,
  reduceManifestTransition,
  releaseManifestSha256V2,
  releaseSha256V2,
  operationalAttestationTemplateSha256V2,
  validateReleaseRootWriterLeaseV2,
  validateRemediationReleaseManifestV2,
  type ExecutedReleaseGateV2,
  type ManifestTransitionIdV2,
  type OperationalAttestationV2,
  type ReleaseCommandIdV2,
  type ReleaseFreezeIdentityV2,
  type ReleaseGateIdV2,
  type RemediationReleaseManifestV2
} from "../../src/release/remediationReleaseManifestV2";

const candidateSha = "c".repeat(40);
const planBaseSha = "b".repeat(40);
const rootSha = "1".repeat(64);
const freeze: ReleaseFreezeIdentityV2 = {
  version: "release-freeze-identity-v2",
  releaseGenerationId: "generation-1",
  candidateSha,
  planBaseSha,
  artifactRootFingerprintSha256: rootSha,
  artifactRootTrustBoundaryEvidenceSha256: "2".repeat(64),
  productionDatabaseIdentityFingerprintSha256: "3".repeat(64),
  postgresToolIdentitySha256: "4".repeat(64),
  previousRuntimeDiscoverySha256: "5".repeat(64),
  rollbackWorktreeIdentitySha256: "6".repeat(64),
  createdAt: "2026-07-18T10:00:00.000Z"
};

const commands: Record<ReleaseGateIdV2, ReleaseCommandIdV2> = {
  G00_BASE: "base_audit",
  G01_TRACE: "acceptance_trace",
  G02_DATA: "plan1_focused",
  G03_SCORING: "plan2_focused",
  G04_RUNTIME: "plan3_focused",
  G05_TELEGRAM: "manual_telegram_acceptance",
  G06_FULL: "full_regression",
  G07_SCHEMA_OFFLINE: "schema_production_clone_rehearsal",
  G08_VERSION_SANITIZED: "runtime_sanitized_rehearsal",
  G09_LEGACY_TERMINAL: "legacy_terminal_population",
  G10_ROLLBACK_REHEARSAL: "rollback_rehearsal",
  G11_POISONING_REGRESSION: "address_poisoning_regression",
  G12_PRODUCTION_BACKUP: "production_backup",
  G13_PRODUCTION_MIGRATION: "production_migration",
  G14_PRODUCTION_ROLLOUT: "production_rollout",
  G15_PRODUCTION_CANARY: "production_canary"
};

function output(id: ReleaseGateIdV2, state: "passed" | "failed" = "passed"): ExecutedReleaseGateV2 {
  return {
    id,
    candidateSha,
    state,
    commandId: commands[id],
    redactedTemplateSha256: "7".repeat(64),
    startedAt: "2026-07-18T10:00:00.000Z",
    finishedAt: "2026-07-18T10:01:00.000Z",
    exitCode: state === "passed" ? 0 : 1,
    outputSha256: "8".repeat(64),
    evidence: [{
      kind: "suite_evidence",
      relativePath: `gates/${id.toLowerCase()}.json`,
      sha256: "9".repeat(64),
      schemaVersion: "gate-evidence-v2",
      candidateSha
    }]
  };
}

function initial(): RemediationReleaseManifestV2 {
  const initialIds = RELEASE_GATE_IDS_V2.filter((_, index) => index <= 4 || (index >= 6 && index <= 11));
  return createInitialRemediationReleaseManifestV2({
    freezeIdentity: freeze,
    evaluatedAt: "2026-07-18T10:02:00.000Z",
    latestCommittedReceiptSha256: "a".repeat(64),
    verifiedGateOutputs: initialIds.map((id) => output(id))
  });
}

function attestation(
  current: RemediationReleaseManifestV2,
  action: ManifestTransitionIdV2,
  commandId: ReleaseCommandIdV2
): OperationalAttestationV2 {
  return {
    version: "operational-attestation-v2",
    action,
    generationId: freeze.releaseGenerationId,
    candidateSha,
    releaseFreezeIdentitySha256: current.releaseFreezeIdentitySha256,
    sourceManifestSha256: releaseManifestSha256V2(current),
    artifactRootFingerprintSha256: rootSha,
    commandId,
    redactedTemplateSha256: operationalAttestationTemplateSha256V2(
      action as Parameters<typeof operationalAttestationTemplateSha256V2>[0]
    ),
    previousAttestationSha256: null,
    priorTerminalLineageSha256: null,
    issuedAt: "2026-07-18T10:02:30.000Z",
    expiresAt: "2026-07-18T10:30:00.000Z"
  };
}

function advance(
  current: RemediationReleaseManifestV2,
  transitionId: Exclude<ManifestTransitionIdV2, "pre_manual" | "production_failed" | "rollback_rolled_back">,
  gateId: ReleaseGateIdV2,
  commandId: ReleaseCommandIdV2
) {
  return reduceManifestTransition(current, {
    transitionId,
    evaluatedAt: "2026-07-18T10:03:00.000Z",
    latestCommittedReceiptSha256: releaseSha256V2(`receipt:${transitionId}`),
    operationalAttestation: transitionId === "readiness" ? null : attestation(current, transitionId, commandId)
  }, [output(gateId)], { refs: [], actualRollbackOutcome: null });
}

describe("RemediationReleaseManifestV2 exact lifecycle", () => {
  it("requires verified initial gate outputs and persists exact chain fields without fabricating execution", () => {
    expect(() => createInitialRemediationReleaseManifestV2({
      freezeIdentity: freeze,
      evaluatedAt: "2026-07-18T10:02:00.000Z",
      latestCommittedReceiptSha256: "a".repeat(64)
    })).toThrow("verified_gate_outputs_required");
    const manifest = initial();
    expect(manifest).toMatchObject({
      revision: 1,
      previousManifestSha256: null,
      latestCommittedReceiptSha256: "a".repeat(64),
      artifactRootFingerprintSha256: rootSha,
      requiredRequirementIds: REQUIRED_REQUIREMENT_IDS_V2,
      requiredAcceptanceIds: REQUIRED_ACCEPTANCE_IDS_V2,
      actualRollback: null
    });
    expect(manifest.gates.find((gate) => gate.id === "G00_BASE")).toEqual(output("G00_BASE"));
  });

  it("uses only the supplied gate output and receipt while preserving root/freeze/candidate", () => {
    const current = initial();
    const verified = output("G05_TELEGRAM");
    const next = reduceManifestTransition(current, {
      transitionId: "readiness",
      evaluatedAt: "2026-07-18T10:03:00.000Z",
      latestCommittedReceiptSha256: "d".repeat(64),
      operationalAttestation: null
    }, [verified], { refs: [], actualRollbackOutcome: null });
    expect(next.gates[5]).toEqual(verified);
    expect(next.previousManifestSha256).toBe(releaseManifestSha256V2(current));
    expect(next.latestCommittedReceiptSha256).toBe("d".repeat(64));
    expect(next.artifactRootFingerprintSha256).toBe(current.artifactRootFingerprintSha256);
    expect(() => reduceManifestTransition(current, {
      transitionId: "readiness",
      evaluatedAt: "2026-07-18T10:03:00.000Z",
      latestCommittedReceiptSha256: "d".repeat(64),
      operationalAttestation: null
    }, [], { refs: [], actualRollbackOutcome: null })).toThrow();
  });

  it("derives one failed production gate, blocked suffix, and honest rollback union", () => {
    let current = advance(initial(), "readiness", "G05_TELEGRAM", "manual_telegram_acceptance");
    current = advance(current, "g12_backup_passed", "G12_PRODUCTION_BACKUP", "production_backup");
    const sourceSha = releaseManifestSha256V2(current);
    const failure = {
      kind: "production_failure_evidence" as const,
      relativePath: "production-failure-evidence-v2.json" as const,
      sha256: "e".repeat(64),
      schemaVersion: "production-failure-evidence-v2" as const,
      candidateSha,
      sourceManifestSha256: sourceSha
    };
    const failed = reduceManifestTransition(current, {
      transitionId: "production_failed",
      evaluatedAt: "2026-07-18T10:04:00.000Z",
      latestCommittedReceiptSha256: "f".repeat(64),
      operationalAttestation: null
    }, [output("G13_PRODUCTION_MIGRATION", "failed")], {
      refs: [failure], actualRollbackOutcome: null
    });
    expect(failed.gates[13].state).toBe("failed");
    expect(failed.gates.slice(14).every((gate) => gate.state === "blocked")).toBe(true);

    const rollbackRef = {
      kind: "actual_rollback_evidence" as const,
      relativePath: "production-rollback-evidence-v2.json" as const,
      sha256: "1".repeat(64),
      schemaVersion: "production-rollback-evidence-v2" as const,
      candidateSha,
      sourceManifestSha256: releaseManifestSha256V2(failed)
    };
    const outcome = {
      kind: "previous_runtime_retained" as const,
      failedGateId: "G13_PRODUCTION_MIGRATION" as const,
      previousRuntimeHealthEvidenceSha256: "2".repeat(64),
      noPreviousStopEvidenceSha256: "3".repeat(64),
      noCandidateStartEvidenceSha256: "4".repeat(64)
    };
    const rolledBack = reduceManifestTransition(failed, {
      transitionId: "rollback_rolled_back",
      evaluatedAt: "2026-07-18T10:05:00.000Z",
      latestCommittedReceiptSha256: "5".repeat(64),
      operationalAttestation: attestation(failed, "rollback_rolled_back", "production_rollback")
    }, [], { refs: [failure, rollbackRef], actualRollbackOutcome: outcome });
    expect(rolledBack).toMatchObject({ overall: "rolled_back", actualRollback: { outcome } });
  });

  it("allows production_recovery authority only with exact typed abandoned-operation recovery evidence while direct production_failed remains authority-free", () => {
    let current = advance(initial(), "readiness", "G05_TELEGRAM", "manual_telegram_acceptance");
    current = advance(current, "g12_backup_passed", "G12_PRODUCTION_BACKUP", "production_backup");
    current = advance(current, "g13_migration_passed", "G13_PRODUCTION_MIGRATION", "production_migration");
    const sourceSha = releaseManifestSha256V2(current);
    const recoveryAuthority = attestation(current, "production_failed", "production_recovery");
    const recoveryEvidence = {
      version: "production-failure-evidence-v2" as const,
      candidateSha,
      releaseFreezeIdentitySha256: current.releaseFreezeIdentitySha256,
      sourceManifestSha256: sourceSha,
      failedExecutionEvidenceSha256: "1".repeat(64),
      observedAt: "2026-07-18T10:04:00.000Z",
      failedGateId: "G14_PRODUCTION_ROLLOUT" as const,
      evidenceKind: "abandoned_operation_recovery" as const,
      priorAttemptedExternalEffect: true,
      recoveryAttemptedExternalEffect: false as const,
      recoveryInputSha256: "2".repeat(64),
      recoveryOrchestrationReceiptSha256: "1".repeat(64),
      priorTerminalAbandonedSha256: "3".repeat(64),
      priorTerminalCleanupSha256: "4".repeat(64),
      completedStepReceiptPrefixSha256: "5".repeat(64),
      uncertainStepMarkerSha256: null,
      recoveryOperationalAttestationSha256: releaseSha256V2(
        `${canonicalReleaseJsonV2(recoveryAuthority)}\n`),
      recoveryProductionLeaseSha256: "6".repeat(64),
      recoveryAuthorityPreclaimSha256: "7".repeat(64),
      recoveryOperationClaimSha256: "8".repeat(64),
      recoveryAuthorityConsumptionSha256: "9".repeat(64),
      failureCode: "authority_expired_after_claim" as const
    };
    const failureRef = {
      kind: "production_failure_evidence" as const,
      relativePath: "production-failure-evidence-v2.json" as const,
      sha256: releaseSha256V2(`${canonicalReleaseJsonV2(recoveryEvidence)}\n`),
      schemaVersion: "production-failure-evidence-v2" as const,
      candidateSha,
      sourceManifestSha256: sourceSha
    };
    const transition = {
      transitionId: "production_failed" as const,
      evaluatedAt: "2026-07-18T10:04:00.000Z",
      latestCommittedReceiptSha256: "f".repeat(64),
      operationalAttestation: recoveryAuthority
    };
    const verified = {
      refs: [failureRef], actualRollbackOutcome: null, productionFailureEvidence: recoveryEvidence
    };
    expect(reduceManifestTransition(current, transition,
      [output("G14_PRODUCTION_ROLLOUT", "failed")], verified).transitionId)
      .toBe("production_failed");
    expect(() => reduceManifestTransition(current, transition,
      [output("G14_PRODUCTION_ROLLOUT", "failed")], {
        refs: [failureRef], actualRollbackOutcome: null
      })).toThrow(/unexpected.*attestation|recovery.*evidence/i);
    expect(() => reduceManifestTransition(current, { ...transition, operationalAttestation: null },
      [output("G14_PRODUCTION_ROLLOUT", "failed")], verified))
      .toThrow(/attestation.*required/i);
  });

  it("rejects exact-set drift, free command/evidence kinds, secrets, and bootstrap/frozen confusion", () => {
    const manifest = structuredClone(initial()) as unknown as Record<string, unknown>;
    (manifest.requiredRequirementIds as string[]).pop();
    expect(() => validateRemediationReleaseManifestV2(manifest)).toThrow();
    expect(() => validateRemediationReleaseManifestV2({
      ...initial(), operatorToken: "bot:very-secret-value"
    })).toThrow();
    expect(() => validateRemediationReleaseManifestV2({
      ...initial(),
      gates: initial().gates.map((gate, index) => index === 0
        ? { ...gate, commandId: "shell_anything" }
        : gate)
    })).toThrow();
    expect(() => validateReleaseRootWriterLeaseV2({
      version: "bootstrap-root-writer-lease-v2",
      scope: "artifact_root",
      relativePath: "manifest-transition-root.lease.json",
      writerOperationKind: "release_freeze_materialization",
      writerOperationKeySha256: "6".repeat(64),
      protectedRootFingerprintSha256: rootSha,
      task0BPreflightEvidenceSha256: "7".repeat(64),
      candidateSha,
      runtimeIdentitySha256: "8".repeat(64),
      releaseGenerationId: "forged-generation",
      releaseFreezeIdentitySha256: null,
      leaseEpoch: 1,
      ownerPid: 10,
      ownerProcessStartFingerprintSha256: "9".repeat(64),
      acquiredAt: "2026-07-18T10:00:00.000Z",
      heartbeatAt: "2026-07-18T10:00:01.000Z",
      expiresAt: "2026-07-18T10:01:00.000Z"
    })).toThrow();
    expect(canonicalReleaseJsonV2(initial())).not.toContain("operatorToken");
  });
});
