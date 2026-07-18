import { describe, expect, it } from "vitest";
import {
  RELEASE_GATE_IDS_V2,
  canonicalReleaseJsonV2,
  canonicalReleaseFreezeIdentityUtf8V2,
  createInitialRemediationReleaseManifestV2,
  releaseFreezeIdentitySha256V2,
  releaseManifestSha256V2,
  releaseSha256V2,
  validateCommittedManifestTransitionReceiptV2,
  validateCommittedOperationalAttestationIssuanceV2,
  validateAuthorityTerminalReceiptV2,
  validateManifestCommittedReceiptBindingV2,
  validateManifestTransitionClaimV2,
  validateOperationalAttestationV2,
  validateOperationalAttestationIssuerReceiptV2,
  validatePreparedAuthorityTerminalV2,
  validatePreparedManifestTransitionV2,
  validatePreparedOperationalAttestationIssuanceV2,
  validatePreparedReleaseFreezeMaterializationV2,
  validateReleaseFreezeMaterializationReceiptV2,
  validateReleaseRootWriterLeaseV2,
  validateRemediationReleaseManifestV2,
  type CommittedManifestTransitionReceiptV2,
  type ExecutedReleaseGateV2,
  type ReleaseFreezeIdentityV2,
  type ReleaseGateIdV2
} from "../../src/release/remediationReleaseManifestV2";

const candidateSha = "c".repeat(40);
const freeze: ReleaseFreezeIdentityV2 = {
  version: "release-freeze-identity-v2",
  releaseGenerationId: "generation-1",
  candidateSha,
  planBaseSha: "b".repeat(40),
  artifactRootFingerprintSha256: "1".repeat(64),
  artifactRootTrustBoundaryEvidenceSha256: "2".repeat(64),
  productionDatabaseIdentityFingerprintSha256: "3".repeat(64),
  postgresToolIdentitySha256: "4".repeat(64),
  previousRuntimeDiscoverySha256: "5".repeat(64),
  rollbackWorktreeIdentitySha256: "6".repeat(64),
  createdAt: "2026-07-18T10:00:00.000Z"
};

const commandByGate: Record<ReleaseGateIdV2, ExecutedReleaseGateV2["commandId"]> = {
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

function gate(id: ReleaseGateIdV2): ExecutedReleaseGateV2 {
  return {
    id,
    candidateSha,
    state: "passed",
    commandId: commandByGate[id],
    redactedTemplateSha256: "7".repeat(64),
    startedAt: "2026-07-18T10:00:00.000Z",
    finishedAt: "2026-07-18T10:01:00.000Z",
    exitCode: 0,
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

const initialOutputs = RELEASE_GATE_IDS_V2
  .filter((_, index) => index <= 4 || (index >= 6 && index <= 11))
  .map(gate);

function initial(latestCommittedReceiptSha256: string) {
  return createInitialRemediationReleaseManifestV2({
    freezeIdentity: freeze,
    evaluatedAt: "2026-07-18T10:02:00.000Z",
    latestCommittedReceiptSha256,
    verifiedGateOutputs: initialOutputs
  });
}

function projectionSha(manifest: ReturnType<typeof initial>): string {
  const { latestCommittedReceiptSha256: _omitted, ...projection } = manifest;
  return releaseSha256V2(canonicalReleaseJsonV2(projection));
}

function initialReceipt(targetProjectionSha256: string): CommittedManifestTransitionReceiptV2 {
  return {
    version: "committed-manifest-transition-receipt-v2",
    transitionId: "pre_manual",
    transitionKeySha256: "a".repeat(64),
    candidateSha,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
    sourceManifestSha256: null,
    previousReceiptSha256: null,
    targetManifestProjectionSha256: targetProjectionSha256,
    sourceRevision: null,
    targetRevision: 1,
    gateOutputSha256s: initialOutputs.map((output) =>
      releaseSha256V2(`${canonicalReleaseJsonV2(output)}\n`)),
    transitionEvidence: [],
    committedAt: "2026-07-18T10:02:00.000Z"
  };
}

describe("RemediationReleaseManifestV2 receipt and freeze bindings", () => {
  it("hashes the exact canonical freeze file bytes including its LF", () => {
    const expectedBytes = Buffer.from(`${canonicalReleaseJsonV2(freeze)}\n`, "utf8");
    expect(canonicalReleaseFreezeIdentityUtf8V2(freeze)).toEqual(expectedBytes);
    expect(releaseFreezeIdentitySha256V2(freeze)).toBe(releaseSha256V2(expectedBytes));
    expect(releaseFreezeIdentitySha256V2(freeze)).not.toBe(
      releaseSha256V2(canonicalReleaseJsonV2(freeze))
    );

    const valid = {
      version: "operational-attestation-v2",
      action: "readiness",
      generationId: freeze.releaseGenerationId,
      candidateSha,
      releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
      sourceManifestSha256: "d".repeat(64),
      artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
      commandId: "manual_telegram_acceptance",
      redactedTemplateSha256: "e".repeat(64),
      previousAttestationSha256: null,
      priorTerminalLineageSha256: null,
      issuedAt: "2026-07-18T10:02:00.000Z",
      expiresAt: "2026-07-18T10:03:00.000Z"
    };
    expect(validateOperationalAttestationV2(valid, freeze)).toEqual(valid);
    expect(() => validateOperationalAttestationV2({
      ...valid,
      releaseFreezeIdentitySha256: releaseSha256V2(canonicalReleaseJsonV2(freeze))
    }, freeze)).toThrow("operational_attestation_freeze_binding_invalid");
  });

  it("requires a receipt hash even on revision one", () => {
    const manifest = initial("f".repeat(64));
    expect(manifest.latestCommittedReceiptSha256).toBe("f".repeat(64));
    expect(manifest.releaseFreezeIdentitySha256).toBe(releaseFreezeIdentitySha256V2(freeze));
    expect(() => validateRemediationReleaseManifestV2({
      ...manifest,
      latestCommittedReceiptSha256: null
    })).toThrow("latest_committed_receipt_sha_invalid");
  });

  it("validates the exact committed receipt and binds it to the target manifest", () => {
    const provisional = initial("0".repeat(64));
    const receipt = initialReceipt(projectionSha(provisional));
    const receiptSha = releaseSha256V2(`${canonicalReleaseJsonV2(receipt)}\n`);
    const manifest = initial(receiptSha);

    expect(validateCommittedManifestTransitionReceiptV2(receipt)).toEqual(receipt);
    expect(validateManifestCommittedReceiptBindingV2(manifest, receipt)).toEqual({ manifest, receipt });
    const wrongProjectionReceipt = {
      ...receipt,
      targetManifestProjectionSha256: "f".repeat(64)
    };
    expect(() => validateManifestCommittedReceiptBindingV2({
      ...manifest,
      latestCommittedReceiptSha256: releaseSha256V2(
        `${canonicalReleaseJsonV2(wrongProjectionReceipt)}\n`
      )
    }, wrongProjectionReceipt)).toThrow("manifest_receipt_projection_invalid");
    expect(() => validateManifestCommittedReceiptBindingV2({
      ...manifest,
      latestCommittedReceiptSha256: "e".repeat(64)
    }, receipt)).toThrow("manifest_receipt_hash_invalid");
    const wrongGateOutputsReceipt = {
      ...receipt,
      gateOutputSha256s: ["e".repeat(64)]
    };
    expect(() => validateManifestCommittedReceiptBindingV2({
      ...manifest,
      latestCommittedReceiptSha256: releaseSha256V2(
        `${canonicalReleaseJsonV2(wrongGateOutputsReceipt)}\n`
      )
    }, wrongGateOutputsReceipt)).toThrow("manifest_receipt_gate_output_binding_invalid");
  });

  it("rejects a claim that is not the exact bounded two-minute contract", () => {
    const claim = {
      version: "manifest-transition-claim-v2",
      transitionId: "pre_manual",
      transitionKeySha256: "a".repeat(64),
      generationId: freeze.releaseGenerationId,
      sourceManifestSha256: null,
      claimedAt: "2026-07-18T10:00:00.000Z",
      expiresAt: "2026-07-18T10:02:00.000Z",
      claimantPid: 123,
      claimantProcessStartFingerprintSha256: "b".repeat(64)
    };
    expect(validateManifestTransitionClaimV2(claim)).toEqual(claim);
    expect(() => validateManifestTransitionClaimV2({
      ...claim,
      expiresAt: "2026-07-18T10:02:00.001Z"
    })).toThrow("manifest_transition_claim_ttl_invalid");
    expect(() => validateManifestTransitionClaimV2({
      ...claim,
      sourceManifestSha256: "c".repeat(64)
    })).toThrow("manifest_transition_claim_source_invalid");
  });

  it("validates prepared receipt bytes and all duplicated bindings exactly", () => {
    const provisional = initial("0".repeat(64));
    const receipt = initialReceipt(projectionSha(provisional));
    const receiptBytes = Buffer.from(`${canonicalReleaseJsonV2(receipt)}\n`, "utf8");
    const prepared = {
      version: "prepared-manifest-transition-v2",
      transitionId: "pre_manual",
      transitionKeySha256: receipt.transitionKeySha256,
      generationId: freeze.releaseGenerationId,
      sourceManifestSha256: null,
      previousReceiptSha256: null,
      targetRevision: 1,
      gateOutputSha256s: receipt.gateOutputSha256s,
      targetSnapshotRelativePath: "release-manifest-r1-test.json",
      targetSnapshotSha256: "d".repeat(64),
      canonicalCommittedReceipt: receipt,
      canonicalCommittedReceiptUtf8Base64: receiptBytes.toString("base64"),
      committedReceiptSha256: releaseSha256V2(receiptBytes),
      preparedAt: receipt.committedAt
    };
    expect(validatePreparedManifestTransitionV2(prepared)).toEqual(prepared);
    expect(() => validatePreparedManifestTransitionV2({
      ...prepared,
      canonicalCommittedReceiptUtf8Base64: Buffer.from("{}\n").toString("base64")
    })).toThrow("prepared_manifest_receipt_bytes_invalid");
    expect(() => validatePreparedManifestTransitionV2({
      ...prepared,
      previousReceiptSha256: "e".repeat(64)
    })).toThrow("prepared_manifest_receipt_binding_invalid");
  });

  it("enforces the bootstrap root-writer rolling and absolute lease bounds", () => {
    const lease = {
      version: "bootstrap-root-writer-lease-v2",
      scope: "artifact_root",
      relativePath: "manifest-transition-root.lease.json",
      writerOperationKind: "release_freeze_materialization",
      writerOperationKeySha256: "a".repeat(64),
      protectedRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
      task0BPreflightEvidenceSha256: "b".repeat(64),
      candidateSha,
      runtimeIdentitySha256: "c".repeat(64),
      releaseGenerationId: null,
      releaseFreezeIdentitySha256: null,
      leaseEpoch: 1,
      ownerPid: 123,
      ownerProcessStartFingerprintSha256: "d".repeat(64),
      acquiredAt: "2026-07-18T10:00:00.000Z",
      heartbeatAt: "2026-07-18T10:04:30.000Z",
      expiresAt: "2026-07-18T10:05:30.000Z"
    };
    expect(() => validateReleaseRootWriterLeaseV2(lease)).toThrow(
      "bootstrap_root_writer_lease_absolute_ttl_invalid"
    );
    expect(() => validateReleaseRootWriterLeaseV2({
      ...lease,
      heartbeatAt: "2026-07-18T10:00:00.000Z",
      expiresAt: "2026-07-18T10:01:00.001Z"
    })).toThrow("bootstrap_root_writer_lease_rolling_ttl_invalid");
  });

  it("keeps manifest hashes LF-bound as the receipt source chain input", () => {
    const manifest = initial("f".repeat(64));
    expect(releaseManifestSha256V2(manifest)).toBe(
      releaseSha256V2(`${canonicalReleaseJsonV2(manifest)}\n`)
    );
  });

  it("validates the exact freeze materialization bundle and rejects swapped paths", () => {
    const freezeBytes = canonicalReleaseFreezeIdentityUtf8V2(freeze);
    const freezeSha = releaseSha256V2(freezeBytes);
    const receipt = {
      version: "release-freeze-materialization-receipt-v2",
      commandId: "release_freeze_materialize",
      redactedTemplateSha256: "a".repeat(64),
      task0BPreflightEvidenceSha256: "b".repeat(64),
      protectedRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
      candidateSha,
      runtimeIdentitySha256: "c".repeat(64),
      bootstrapLeaseSha256: "d".repeat(64),
      bootstrapLeaseEpoch: 1,
      canonicalFreezeIdentity: freeze,
      canonicalFreezeIdentityUtf8Base64: freezeBytes.toString("base64"),
      canonicalFreezeIdentitySha256: freezeSha,
      materializedAt: "2026-07-18T10:00:00.000Z"
    };
    const receiptBytes = Buffer.from(`${canonicalReleaseJsonV2(receipt)}\n`, "utf8");
    const prepared = {
      version: "prepared-release-freeze-materialization-v2",
      commandId: "release_freeze_materialize",
      redactedTemplateSha256: receipt.redactedTemplateSha256,
      protectedRootFingerprintSha256: receipt.protectedRootFingerprintSha256,
      task0BPreflightEvidenceSha256: receipt.task0BPreflightEvidenceSha256,
      candidateSha,
      runtimeIdentitySha256: receipt.runtimeIdentitySha256,
      bootstrapLeaseSha256: receipt.bootstrapLeaseSha256,
      bootstrapLeaseEpoch: 1,
      canonicalFreezeIdentity: freeze,
      canonicalFreezeIdentityUtf8Base64: freezeBytes.toString("base64"),
      canonicalFreezeIdentitySha256: freezeSha,
      canonicalFreezeIdentityRelativePath: "release-freeze-identity-v2.json",
      canonicalMaterializationReceipt: receipt,
      canonicalMaterializationReceiptUtf8Base64: receiptBytes.toString("base64"),
      canonicalMaterializationReceiptSha256: releaseSha256V2(receiptBytes),
      canonicalMaterializationReceiptRelativePath: "release-freeze-materialization-receipt-v2.json",
      preparedAt: receipt.materializedAt
    };

    expect(validateReleaseFreezeMaterializationReceiptV2(receipt)).toEqual(receipt);
    expect(validatePreparedReleaseFreezeMaterializationV2(prepared)).toEqual(prepared);
    expect(() => validateReleaseFreezeMaterializationReceiptV2({ ...receipt, extra: true }))
      .toThrow("release_freeze_materialization_receipt_keys_invalid");
    expect(() => validatePreparedReleaseFreezeMaterializationV2({
      ...prepared,
      canonicalFreezeIdentityRelativePath: "swapped.json"
    })).toThrow("prepared_release_freeze_materialization_invalid");
  });

  it("validates exact authority issuance and terminal bundles", () => {
    const authority = {
      version: "operational-attestation-v2",
      action: "readiness",
      generationId: freeze.releaseGenerationId,
      candidateSha,
      releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
      sourceManifestSha256: "d".repeat(64),
      artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
      commandId: "manual_telegram_acceptance",
      redactedTemplateSha256: "e".repeat(64),
      previousAttestationSha256: null,
      priorTerminalLineageSha256: null,
      issuedAt: "2026-07-18T10:02:00.000Z",
      expiresAt: "2026-07-18T10:03:00.000Z"
    };
    const authorityBytes = Buffer.from(`${canonicalReleaseJsonV2(authority)}\n`, "utf8");
    const authoritySha = releaseSha256V2(authorityBytes);
    const issuerReceipt = {
      version: "operational-attestation-issuer-receipt-v2",
      commandId: "operational_authority_issue",
      redactedTemplateSha256: "f".repeat(64),
      action: "readiness",
      generationId: freeze.releaseGenerationId,
      sequence: 1,
      previousIssuerReceiptSha256: null,
      attestationRelativePath: `operational-attestations/readiness/${freeze.releaseGenerationId}/${authoritySha}.json`,
      attestationSha256: authoritySha,
      previousAttestationSha256: null,
      priorTerminalLineageSha256: null,
      issuedAt: authority.issuedAt
    };
    const issuerBytes = Buffer.from(`${canonicalReleaseJsonV2(issuerReceipt)}\n`, "utf8");
    const issuerSha = releaseSha256V2(issuerBytes);
    const committed = {
      version: "committed-operational-attestation-issuance-v2",
      commandId: "operational_authority_issue",
      redactedTemplateSha256: issuerReceipt.redactedTemplateSha256,
      action: "readiness",
      generationId: freeze.releaseGenerationId,
      issuanceIntentSha256: releaseSha256V2(canonicalReleaseJsonV2([
        "readiness", freeze.releaseGenerationId, authoritySha, issuerSha
      ])),
      attestationSha256: authoritySha,
      issuerReceiptSha256: issuerSha,
      committedAt: authority.issuedAt
    };
    const committedBytes = Buffer.from(`${canonicalReleaseJsonV2(committed)}\n`, "utf8");
    const prepared = {
      version: "prepared-operational-attestation-issuance-v2",
      commandId: "operational_authority_issue",
      redactedTemplateSha256: issuerReceipt.redactedTemplateSha256,
      action: "readiness",
      generationId: freeze.releaseGenerationId,
      sequence: 1,
      previousIssuerReceiptSha256: null,
      canonicalAttestation: authority,
      canonicalAttestationUtf8Base64: authorityBytes.toString("base64"),
      canonicalAttestationSha256: authoritySha,
      canonicalAttestationRelativePath: issuerReceipt.attestationRelativePath,
      canonicalIssuerReceipt: issuerReceipt,
      canonicalIssuerReceiptUtf8Base64: issuerBytes.toString("base64"),
      canonicalIssuerReceiptSha256: issuerSha,
      canonicalIssuerReceiptRelativePath: `operational-attestation-issuer-receipts/readiness/${freeze.releaseGenerationId}/${issuerSha}.json`,
      canonicalCommittedIssuance: committed,
      canonicalCommittedIssuanceUtf8Base64: committedBytes.toString("base64"),
      canonicalCommittedIssuanceSha256: releaseSha256V2(committedBytes),
      canonicalCommittedIssuanceRelativePath: `operational-attestation-issuance-committed/readiness/${freeze.releaseGenerationId}/${issuerSha}.json`,
      previousAttestationSha256: null,
      priorTerminalLineageSha256: null,
      preparedAt: authority.issuedAt
    };

    expect(validateOperationalAttestationIssuerReceiptV2(issuerReceipt)).toEqual(issuerReceipt);
    expect(validateCommittedOperationalAttestationIssuanceV2(committed)).toEqual(committed);
    expect(validatePreparedOperationalAttestationIssuanceV2(prepared)).toEqual(prepared);
    expect(() => validatePreparedOperationalAttestationIssuanceV2({
      ...prepared,
      canonicalAttestationRelativePath: "operational-attestations/readiness/swapped.json"
    })).toThrow("prepared_operational_attestation_binding_invalid");

    const terminal = {
      version: "authority-terminal-receipt-v2",
      commandId: "operational_authority_terminalize",
      redactedTemplateSha256: "1".repeat(64),
      action: "readiness",
      generationId: freeze.releaseGenerationId,
      candidateSha,
      releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
      sourceManifestSha256: authority.sourceManifestSha256,
      artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
      attestationSha256: authoritySha,
      issuerReceiptSha256: issuerSha,
      previousIssuerReceiptSha256: null,
      reason: "expired_unclaimed",
      preclaimAbsent: true,
      claimAbsent: true,
      consumptionAbsent: true,
      actionLeaseAbsent: true,
      g13BoundSessionAbsent: true,
      g13AdvisoryLockAbsent: true,
      operationAbsent: true,
      externalEffectCount: 0,
      terminalizedAt: "2026-07-18T10:04:00.000Z"
    };
    const terminalBytes = Buffer.from(`${canonicalReleaseJsonV2(terminal)}\n`, "utf8");
    const terminalSha = releaseSha256V2(terminalBytes);
    const preparedTerminal = {
      version: "prepared-authority-terminal-v2",
      commandId: "operational_authority_terminalize",
      redactedTemplateSha256: terminal.redactedTemplateSha256,
      canonicalTerminalReceipt: terminal,
      canonicalTerminalReceiptUtf8Base64: terminalBytes.toString("base64"),
      canonicalTerminalReceiptSha256: terminalSha,
      canonicalTerminalReceiptRelativePath: `authority-terminal-receipts/readiness/${freeze.releaseGenerationId}/${terminalSha}.json`,
      preparedAt: terminal.terminalizedAt
    };
    expect(validateAuthorityTerminalReceiptV2(terminal)).toEqual(terminal);
    expect(validatePreparedAuthorityTerminalV2(preparedTerminal)).toEqual(preparedTerminal);
    expect(() => validateAuthorityTerminalReceiptV2({ ...terminal, externalEffectCount: 1 }))
      .toThrow("authority_terminal_receipt_invalid");
    expect(() => validatePreparedAuthorityTerminalV2({
      ...preparedTerminal,
      canonicalTerminalReceiptRelativePath: "authority-terminal-receipts/readiness/swapped.json"
    })).toThrow("prepared_authority_terminal_binding_invalid");
  });
});
