import {
  existsSync, lstatSync, readFileSync, readdirSync, unlinkSync
} from "node:fs";
import type { ClientBase } from "pg";
import {
  canonicalReleaseJsonV2,
  createInitialRemediationReleaseManifestV2,
  reduceRemediationReleaseManifestV2,
  releaseSha256V2,
  validateOperationalAttestationV2,
  validateReleaseFreezeIdentityV2,
  validateReleaseRootWriterLeaseV2,
  validateRemediationReleaseManifestV2,
  type ManifestTransitionIdV2,
  type OperationalAttestationV2,
  type ReleaseFreezeIdentityV2,
  type BootstrapRootWriterLeaseV2,
  type FrozenRootWriterLeaseV2,
  type RemediationReleaseManifestV2
} from "./remediationReleaseManifestV2";
import {
  ROOT_WRITER_LEASE_FILE,
  acquireRootWriterLeaseV2,
  assertSafeArtifactRootPath,
  canonicalBytesV2,
  moveNoOverwriteDurable,
  replaceDurable,
  resumeRootWriterLeaseV2,
  safeArtifactPath,
  writeExclusiveDurable
} from "./releaseRootWriterStore";

const FREEZE_FILE = "release-freeze-identity-v2.json";
const FREEZE_PREPARED_FILE = "release-freeze-materialization-prepared-v2.json";
const FREEZE_RECEIPT_FILE = "release-freeze-materialization-receipt-v2.json";
const MANIFEST_FILE = "release-manifest.json";
const ROOT_SEALED_FILE = "release-root-terminal-abandoned-v2.json";
const BOOTSTRAP_SEALED_FILE = "bootstrap-root-terminal-abandoned-v2.json";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function exclusiveJson(root: string, filename: string, value: unknown): Buffer {
  const bytes = canonicalBytesV2(value);
  writeExclusiveDurable(safeArtifactPath(root, filename), bytes);
  return bytes;
}

function exactReplayOrConflict(root: string, filename: string, bytes: Buffer): void {
  const path = safeArtifactPath(root, filename);
  if (!existsSync(path)) writeExclusiveDurable(path, bytes);
  else if (!readFileSync(path).equals(bytes)) throw new Error(`${filename}_conflict`);
}

function injectedFault(name: string | undefined, expected: string): void {
  if (name === expected) throw new Error(`injected_fault_${expected}`);
}

function currentFreeze(root: string): ReleaseFreezeIdentityV2 {
  return validateReleaseFreezeIdentityV2(readJson(safeArtifactPath(root, FREEZE_FILE)));
}

function ownerPayload(input: {
  owner?: { ownerId?: string; pid?: number; processStartedAt?: string };
  evaluatedAt?: string;
}, kind: "manifest_transition" | "operational_authority_issue" | "operational_authority_terminalize",
root: string, freeze: ReleaseFreezeIdentityV2, operationKey: string, transitionKey: string | null = null) {
  const now = input.evaluatedAt ?? new Date().toISOString();
  return {
    version: "frozen-root-writer-lease-v2", scope: "artifact_root",
    relativePath: ROOT_WRITER_LEASE_FILE, writerOperationKind: kind,
    writerOperationKeySha256: operationKey, transitionKeySha256: transitionKey,
    protectedRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    candidateSha: freeze.candidateSha, releaseGenerationId: freeze.releaseGenerationId,
    releaseFreezeIdentitySha256: releaseSha256V2(canonicalBytesV2(freeze)), leaseEpoch: 1,
    ownerPid: input.owner?.pid ?? process.pid,
    ownerProcessStartFingerprintSha256: releaseSha256V2(input.owner?.processStartedAt ?? input.owner?.ownerId ?? `process:${process.pid}`),
    acquiredAt: now, heartbeatAt: now,
    expiresAt: new Date(Date.parse(now) + 60_000).toISOString()
  };
}

function acquireOrResumeFrozenLease(root: string, payload: Record<string, unknown>, preparedExists: boolean) {
  if (!existsSync(safeArtifactPath(root, ROOT_WRITER_LEASE_FILE))) return acquireRootWriterLeaseV2(root, payload);
  if (!preparedExists) throw new Error("root_writer_busy");
  return resumeRootWriterLeaseV2(root, {
    writerOperationKind: String(payload.writerOperationKind),
    writerOperationKeySha256: String(payload.writerOperationKeySha256),
    ownerPid: Number(payload.ownerPid),
    ownerProcessStartFingerprintSha256: String(payload.ownerProcessStartFingerprintSha256)
  });
}

export async function materializeReleaseFreezeV2(input: {
  artifactRoot: string;
  freezeIdentity: unknown;
  task0BPreflightEvidence: unknown;
  evaluatedAt: string;
  owner?: { ownerId?: string; pid?: number; processStartedAt?: string };
  producerId?: string;
  recoverDeadOwner?: boolean;
  faultAt?: string;
}) {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  if (input.producerId !== undefined && input.producerId !== "release_freeze_materialize") {
    throw new Error("freeze_producer_not_authorized");
  }
  const freeze = validateReleaseFreezeIdentityV2(input.freezeIdentity);
  const preflight = input.task0BPreflightEvidence as Record<string, unknown>;
  if (preflight?.version !== "task0b-release-freeze-evidence-v1" || preflight.verified !== true) {
    throw new Error("task0b_preflight_unverified");
  }
  let freezeBytes = canonicalBytesV2(freeze);
  let receipt = {
    version: "release-freeze-materialization-receipt-v2",
    commandId: "release_freeze_materialize", candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    canonicalFreezeIdentitySha256: releaseSha256V2(freezeBytes), materializedAt: input.evaluatedAt
  };
  let receiptBytes = canonicalBytesV2(receipt);
  let prepared = {
    version: "prepared-release-freeze-materialization-v2",
    canonicalFreezeIdentity: freeze,
    canonicalFreezeIdentityUtf8Base64: freezeBytes.toString("base64"),
    canonicalFreezeIdentitySha256: releaseSha256V2(freezeBytes),
    canonicalMaterializationReceipt: receipt,
    canonicalMaterializationReceiptUtf8Base64: receiptBytes.toString("base64"),
    canonicalMaterializationReceiptSha256: releaseSha256V2(receiptBytes),
    preparedAt: input.evaluatedAt
  };
  let preparedBytes = canonicalBytesV2(prepared);
  const preparedPath = safeArtifactPath(root, FREEZE_PREPARED_FILE);
  if (existsSync(preparedPath)) {
    const stored = readJson(preparedPath) as typeof prepared;
    if (canonicalReleaseJsonV2(stored.canonicalFreezeIdentity) !== canonicalReleaseJsonV2(freeze)) {
      throw new Error("prepared_freeze_identity_conflict");
    }
    prepared = stored;
    preparedBytes = readFileSync(preparedPath);
    freezeBytes = Buffer.from(stored.canonicalFreezeIdentityUtf8Base64, "base64");
    receipt = stored.canonicalMaterializationReceipt as typeof receipt;
    receiptBytes = Buffer.from(stored.canonicalMaterializationReceiptUtf8Base64, "base64");
  }

  if (existsSync(safeArtifactPath(root, FREEZE_FILE)) && existsSync(safeArtifactPath(root, FREEZE_RECEIPT_FILE))) {
    if (!readFileSync(safeArtifactPath(root, FREEZE_FILE)).equals(freezeBytes)
        || !readFileSync(safeArtifactPath(root, FREEZE_RECEIPT_FILE)).equals(receiptBytes)) {
      throw new Error("freeze_replay_conflict");
    }
    return { freezeIdentity: freeze, receipt };
  }

  if (existsSync(safeArtifactPath(root, BOOTSTRAP_SEALED_FILE))) throw new Error("bootstrap_root_sealed_new_root_required");
  if (input.recoverDeadOwner) throw new Error("explicit_manifest_lease_takeover_required");
  const preflightSha256 = releaseSha256V2(canonicalBytesV2(preflight));
  const operationKey = releaseSha256V2(canonicalReleaseJsonV2([
    "release_freeze_materialization", freeze.candidateSha,
    freeze.artifactRootFingerprintSha256, preflightSha256
  ]));
  const bootstrapPayload = {
    version: "bootstrap-root-writer-lease-v2", scope: "artifact_root",
    relativePath: ROOT_WRITER_LEASE_FILE,
    writerOperationKind: "release_freeze_materialization",
    writerOperationKeySha256: operationKey,
    protectedRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    task0BPreflightEvidenceSha256: preflightSha256,
    candidateSha: freeze.candidateSha,
    runtimeIdentitySha256: releaseSha256V2(canonicalReleaseJsonV2(preflight.runtimeIdentity ?? preflight)),
    releaseGenerationId: null, releaseFreezeIdentitySha256: null,
    leaseEpoch: 1, ownerPid: input.owner?.pid ?? process.pid,
    ownerProcessStartFingerprintSha256: releaseSha256V2(input.owner?.processStartedAt ?? input.owner?.ownerId ?? `process:${process.pid}`),
    acquiredAt: input.evaluatedAt, heartbeatAt: input.evaluatedAt,
    expiresAt: new Date(Date.parse(input.evaluatedAt) + 60_000).toISOString()
  };
  const lease = acquireOrResumeFrozenLease(root, bootstrapPayload, existsSync(safeArtifactPath(root, FREEZE_PREPARED_FILE)));
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    injectedFault(input.faultAt, "after_lease");
    exactReplayOrConflict(root, FREEZE_PREPARED_FILE, preparedBytes);
    injectedFault(input.faultAt, "after_prepare");
    lease.assertOwned();
    exactReplayOrConflict(root, FREEZE_FILE, freezeBytes);
    injectedFault(input.faultAt, "after_identity");
    exactReplayOrConflict(root, FREEZE_RECEIPT_FILE, receiptBytes);
    lease.release();
    return { freezeIdentity: freeze, receipt };
  } catch (error) {
    throw error;
  }
}

export function assertOperationalAttestationBindingV2(actualValue: unknown, expectedValue: unknown): void {
  const actual = validateOperationalAttestationV2(actualValue);
  const expected = validateOperationalAttestationV2(expectedValue);
  for (const key of [
    "action", "generationId", "candidateSha", "releaseFreezeIdentitySha256", "sourceManifestSha256",
    "artifactRootFingerprintSha256", "commandId", "redactedTemplateSha256",
    "previousAttestationSha256", "priorTerminalLineageSha256"
  ] as const) if (actual[key] !== expected[key]) throw new Error(`operational_attestation_${key}_swapped`);
}

function authorityHash(authority: OperationalAttestationV2): string {
  return releaseSha256V2(canonicalBytesV2(authority));
}

export async function issueOperationalAttestationV2(input: {
  artifactRoot: string;
  attestation: unknown;
  priorTerminalReceipt?: { sha256: string };
  faultAt?: string;
}) {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  const freeze = currentFreeze(root);
  const authority = validateOperationalAttestationV2(input.attestation, freeze);
  if (authority.priorTerminalLineageSha256 === null) {
    if (input.priorTerminalReceipt !== undefined) throw new Error("unexpected_terminal_lineage");
  } else {
    if (authority.previousAttestationSha256 === null
        || input.priorTerminalReceipt?.sha256 !== authority.priorTerminalLineageSha256) {
      throw new Error("terminal_lineage_unverified");
    }
    const matchingTerminalReceipts = readdirSync(root)
      .filter((name) => /^authority-terminal-receipt-[0-9a-f]{64}\.json$/.test(name))
      .map((name) => {
        const path = safeArtifactPath(root, name);
        return { bytes: readFileSync(path), receipt: readJson(path) as Record<string, unknown> };
      })
      .filter(({ bytes }) => releaseSha256V2(bytes) === authority.priorTerminalLineageSha256);
    if (matchingTerminalReceipts.length !== 1
        || matchingTerminalReceipts[0].receipt.attestationSha256 !== authority.previousAttestationSha256
        || matchingTerminalReceipts[0].receipt.reason !== "expired_unclaimed"
        || matchingTerminalReceipts[0].receipt.externalEffectCount !== 0) {
      throw new Error("terminal_lineage_unverified");
    }
  }
  const bytes = canonicalBytesV2(authority);
  const hash = releaseSha256V2(bytes);
  const preparedName = `prepared-operational-attestation-${hash}.json`;
  const authorityName = `operational-attestation-${hash}.json`;
  const receiptName = `operational-attestation-issuer-receipt-${hash}.json`;
  const markerName = `committed-operational-attestation-${hash}.json`;
  if (existsSync(safeArtifactPath(root, markerName))) {
    const marker = readJson(safeArtifactPath(root, markerName)) as Record<string, unknown>;
    const receiptBytes = readFileSync(safeArtifactPath(root, receiptName));
    if (!readFileSync(safeArtifactPath(root, authorityName)).equals(bytes)
        || marker.attestationSha256 !== hash
        || marker.issuerReceiptSha256 !== releaseSha256V2(receiptBytes)) throw new Error("authority_replay_conflict");
    return { ...authority, attestationSha256: hash, previousAttestationSha256: authority.previousAttestationSha256 };
  }
  const committedNames = readdirSync(root).filter((name) => /^committed-operational-attestation-[0-9a-f]{64}\.json$/.test(name));
  const committedAuthorities = committedNames.map((name) => {
    const marker = readJson(safeArtifactPath(root, name)) as Record<string, unknown>;
    const attestationHash = String(marker.attestationSha256 ?? "");
    if (!/^[0-9a-f]{64}$/.test(attestationHash)) throw new Error("authority_marker_invalid");
    const attestationPath = safeArtifactPath(root, `operational-attestation-${attestationHash}.json`);
    if (!existsSync(attestationPath) || releaseSha256V2(readFileSync(attestationPath)) !== attestationHash) {
      throw new Error("authority_chain_bytes_invalid");
    }
    return { hash: attestationHash, authority: validateOperationalAttestationV2(readJson(attestationPath), freeze), marker };
  });
  if (authority.previousAttestationSha256 === null) {
    if (committedAuthorities.length !== 0) throw new Error("authority_chain_previous_required");
  } else {
    const previous = committedAuthorities.filter((item) => item.hash === authority.previousAttestationSha256);
    if (previous.length !== 1 || committedAuthorities.some((item) =>
      item.authority.previousAttestationSha256 === authority.previousAttestationSha256)) {
      throw new Error("authority_chain_branch_or_gap");
    }
  }
  const receipt = {
    version: "operational-attestation-issuer-receipt-v2", action: authority.action,
    generationId: authority.generationId, sequence: committedAuthorities.length + 1,
    previousIssuerReceiptSha256: authority.previousAttestationSha256 === null ? null
      : releaseSha256V2(readFileSync(safeArtifactPath(root,
        `operational-attestation-issuer-receipt-${authority.previousAttestationSha256}.json`))),
    attestationRelativePath: authorityName,
    attestationSha256: hash, previousAttestationSha256: authority.previousAttestationSha256,
    priorTerminalLineageSha256: authority.priorTerminalLineageSha256, issuedAt: authority.issuedAt
  };
  const receiptBytes = canonicalBytesV2(receipt);
  const marker = { version: "committed-operational-attestation-issuance-v2", attestationSha256: hash,
    issuerReceiptSha256: releaseSha256V2(receiptBytes), committedAt: authority.issuedAt };
  const markerBytes = canonicalBytesV2(marker);
  const operationKey = releaseSha256V2(canonicalReleaseJsonV2([
    "operational_authority_issue", authority.action, authority.generationId, hash
  ]));
  const leasePayload = ownerPayload({ evaluatedAt: authority.issuedAt }, "operational_authority_issue",
    root, freeze, operationKey);
  const lease = acquireOrResumeFrozenLease(root, leasePayload,
    existsSync(safeArtifactPath(root, preparedName)));
  try {
    exactReplayOrConflict(root, preparedName, canonicalBytesV2({
      version: "prepared-operational-attestation-issuance-v2", canonicalAttestation: authority,
      canonicalAttestationUtf8Base64: bytes.toString("base64"), canonicalAttestationSha256: hash,
      canonicalIssuerReceipt: receipt, canonicalIssuerReceiptUtf8Base64: receiptBytes.toString("base64"),
      canonicalIssuerReceiptSha256: releaseSha256V2(receiptBytes),
      canonicalCommittedIssuance: marker, canonicalCommittedIssuanceUtf8Base64: markerBytes.toString("base64"),
      canonicalCommittedIssuanceSha256: releaseSha256V2(markerBytes), preparedAt: authority.issuedAt
    }));
    injectedFault(input.faultAt, "after_prepare");
    lease.assertOwned(); exactReplayOrConflict(root, authorityName, bytes);
    injectedFault(input.faultAt, "after_attestation");
    exactReplayOrConflict(root, receiptName, receiptBytes);
    injectedFault(input.faultAt, "after_receipt");
    exactReplayOrConflict(root, markerName, markerBytes);
    lease.release();
    return { ...authority, attestationSha256: hash, previousAttestationSha256: authority.previousAttestationSha256 };
  } catch (error) {
    if (!existsSync(safeArtifactPath(root, preparedName)) && existsSync(lease.path)) lease.release();
    throw error;
  }
}

export function selectOperationalAttestationV2(
  values: unknown[],
  expected: { evaluatedAt: string; action?: string; generationId?: string }
): OperationalAttestationV2 {
  const parsed = values.map((value) => validateOperationalAttestationV2(value));
  const hashes = new Set(parsed.map(authorityHash));
  for (const value of parsed) {
    if (value.previousAttestationSha256 !== null && !hashes.has(value.previousAttestationSha256)) {
      throw new Error("operational_authority_chain_gap");
    }
    if (parsed.filter((candidate) => candidate.previousAttestationSha256 === authorityHash(value)).length > 1) {
      throw new Error("operational_authority_chain_branch");
    }
  }
  const compatible = parsed.filter((value) => (!expected.action || value.action === expected.action)
    && (!expected.generationId || value.generationId === expected.generationId)
    && Date.parse(value.issuedAt) <= Date.parse(expected.evaluatedAt)
    && Date.parse(expected.evaluatedAt) < Date.parse(value.expiresAt));
  if (compatible.length !== 1) throw new Error("operational_authority_tip_ambiguous");
  return compatible[0];
}

export async function terminalizeExpiredOperationalAttestationV2(input: {
  artifactRoot: string;
  authority: unknown;
  evaluatedAt: string;
  observedArtifacts?: string[];
}) {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  const authority = validateOperationalAttestationV2(input.authority);
  if (Date.parse(input.evaluatedAt) < Date.parse(authority.expiresAt)) throw new Error("authority_not_expired");
  if (input.observedArtifacts !== undefined && input.observedArtifacts.length !== 0) {
    throw new Error("caller_supplied_authority_observation_forbidden");
  }
  const hash = authorityHash(authority);
  const authorityPath = safeArtifactPath(root, `operational-attestation-${hash}.json`);
  const committedPath = safeArtifactPath(root, `committed-operational-attestation-${hash}.json`);
  if (!existsSync(authorityPath) || !existsSync(committedPath)
      || !readFileSync(authorityPath).equals(canonicalBytesV2(authority))) {
    throw new Error("authority_not_issued");
  }
  const committed = readJson(committedPath) as Record<string, unknown>;
  if (committed.attestationSha256 !== hash) throw new Error("authority_issue_marker_invalid");
  const forbiddenArtifact = readdirSync(root).find((name) => name.startsWith("production-"));
  if (forbiddenArtifact) throw new Error("authority_has_effect_or_claim_artifact");
  const receipt = {
    version: "authority-terminal-receipt-v2", action: authority.action,
    generationId: authority.generationId, candidateSha: authority.candidateSha,
    attestationSha256: hash, reason: "expired_unclaimed", externalEffectCount: 0,
    terminalizedAt: input.evaluatedAt
  };
  const prepared = canonicalBytesV2({ version: "prepared-authority-terminal-v2",
    canonicalTerminalReceipt: receipt, preparedAt: input.evaluatedAt });
  const receiptBytes = canonicalBytesV2(receipt);
  const freeze = currentFreeze(root);
  validateOperationalAttestationV2(authority, freeze);
  const operationKey = releaseSha256V2(canonicalReleaseJsonV2([
    "operational_authority_terminalize", authority.action, authority.generationId, hash
  ]));
  const preparedName = `prepared-authority-terminal-${hash}.json`;
  const leasePayload = ownerPayload({ evaluatedAt: input.evaluatedAt }, "operational_authority_terminalize",
    root, freeze, operationKey);
  const lease = acquireOrResumeFrozenLease(root, leasePayload,
    existsSync(safeArtifactPath(root, preparedName)));
  try {
    exactReplayOrConflict(root, preparedName, prepared);
    exactReplayOrConflict(root, `authority-terminal-receipt-${hash}.json`, receiptBytes);
    lease.release();
    return receipt;
  } catch (error) { throw error; }
}

export function normalizeTrustedPrincipalPolicyV2(input: { platform: string; principals: string[] }) {
  if (!new Set(["windows", "posix"]).has(input.platform) || !Array.isArray(input.principals)) {
    throw new Error("trusted_principal_policy_unsupported");
  }
  const normalized = [...new Set(input.principals.map((value) => value.trim().toLowerCase()))].sort();
  if (normalized.some((value) => value === "everyone" || value === "builtin\\users" || value.includes("foreign"))) {
    throw new Error("untrusted_write_principal");
  }
  return {
    version: "trusted-os-principal-policy-v2",
    policyId: input.platform === "windows" ? "windows-configured-canonical-set-v1" : "posix-owner-only-v1",
    platform: input.platform,
    normalizedTrustedPrincipalSetSha256: releaseSha256V2(canonicalReleaseJsonV2(normalized)),
    trustedPrincipalCount: normalized.length
  };
}

export async function verifyArtifactRootTrustV2(input: {
  artifactRoot: string;
  principalPolicyId: string;
  pathKind: string;
}) {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  const allowed = process.platform === "win32"
    ? new Set(["windows-service-localsystem-administrators-v1", "windows-configured-canonical-set-v1"])
    : new Set(["posix-owner-only-v1"]);
  if (!allowed.has(input.principalPolicyId) || input.pathKind !== "regular" || lstatSync(root).isSymbolicLink()) {
    throw new Error("artifact_root_trust_rejected");
  }
  return { canonicalRootPathSha256: releaseSha256V2(root), trusted: true };
}

type AdvanceInput = {
  artifactRoot: string;
  sourceManifest: unknown;
  transition: {
    transitionId: ManifestTransitionIdV2;
    evaluatedAt?: string;
    operationalAttestation?: OperationalAttestationV2 | null;
  };
  verifiedGateOutputs: unknown;
  verifiedTransitionEvidence: unknown;
  evaluatedAt?: string;
  faultAt?: string;
  rootState?: string;
};

function manifestProjectionV2(manifest: RemediationReleaseManifestV2): Record<string, unknown> {
  const { latestCommittedReceiptSha256: _omitted, ...projection } = manifest;
  return projection;
}

function verifiedGateOutputHashes(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("verified_gate_outputs_invalid");
  return value.map((gate) => releaseSha256V2(canonicalBytesV2(gate)));
}

function preparedManifestResult(
  source: RemediationReleaseManifestV2,
  freeze: ReleaseFreezeIdentityV2,
  transitionKeySha256: string,
  input: AdvanceInput
) {
  const evaluatedAt = input.evaluatedAt ?? input.transition.evaluatedAt ?? "2026-07-18T10:01:00.000Z";
  const sourceSha = releaseSha256V2(canonicalBytesV2(source));
  const gateOutputSha256s = verifiedGateOutputHashes(input.verifiedGateOutputs);
  const provisional = reduceRemediationReleaseManifestV2(source, {
    ...input.transition,
    evaluatedAt,
    latestCommittedReceiptSha256: "0".repeat(64),
    operationalAttestation: input.transition.operationalAttestation ?? null
  }, input.verifiedGateOutputs, input.verifiedTransitionEvidence);
  const receipt = {
    version: "committed-manifest-transition-receipt-v2",
    transitionId: input.transition.transitionId, transitionKeySha256,
    candidateSha: source.candidateSha,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: source.releaseFreezeIdentitySha256,
    sourceManifestSha256: sourceSha,
    previousReceiptSha256: source.latestCommittedReceiptSha256,
    targetManifestProjectionSha256: releaseSha256V2(canonicalReleaseJsonV2(manifestProjectionV2(provisional))),
    sourceRevision: source.revision, targetRevision: provisional.revision,
    gateOutputSha256s,
    transitionEvidence: provisional.transitionEvidence,
    committedAt: evaluatedAt
  };
  const receiptBytes = canonicalBytesV2(receipt);
  const committedReceiptSha256 = releaseSha256V2(receiptBytes);
  const target = reduceRemediationReleaseManifestV2(source, {
    ...input.transition,
    evaluatedAt,
    latestCommittedReceiptSha256: committedReceiptSha256,
    operationalAttestation: input.transition.operationalAttestation ?? null
  }, input.verifiedGateOutputs, input.verifiedTransitionEvidence);
  if (receipt.targetManifestProjectionSha256
      !== releaseSha256V2(canonicalReleaseJsonV2(manifestProjectionV2(target)))) {
    throw new Error("target_manifest_projection_changed");
  }
  const targetBytes = canonicalBytesV2(target);
  const targetSnapshotRelativePath = `release-manifest-r${target.revision}-${releaseSha256V2(targetBytes)}.json`;
  const prepared = {
    version: "prepared-manifest-transition-v2", transitionId: input.transition.transitionId,
    transitionKeySha256, generationId: freeze.releaseGenerationId,
    sourceManifestSha256: sourceSha, previousReceiptSha256: source.latestCommittedReceiptSha256,
    targetRevision: target.revision, gateOutputSha256s,
    targetSnapshotRelativePath,
    targetSnapshotSha256: releaseSha256V2(targetBytes),
    canonicalCommittedReceipt: receipt,
    canonicalCommittedReceiptUtf8Base64: receiptBytes.toString("base64"),
    committedReceiptSha256, preparedAt: evaluatedAt,
    targetManifest: target
  };
  return { target, targetBytes, receipt, receiptBytes, prepared, preparedBytes: canonicalBytesV2(prepared) };
}

function loadPreparedManifestResult(
  root: string,
  preparedPath: string,
  source: RemediationReleaseManifestV2,
  freeze: ReleaseFreezeIdentityV2,
  transitionKeySha256: string,
  input: AdvanceInput
) {
  const preparedBytes = readFileSync(preparedPath);
  const prepared = JSON.parse(preparedBytes.toString("utf8")) as Record<string, unknown>;
  const sourceSha256 = releaseSha256V2(canonicalBytesV2(source));
  const expectedGateOutputSha256s = verifiedGateOutputHashes(input.verifiedGateOutputs);
  if (prepared.version !== "prepared-manifest-transition-v2"
      || prepared.transitionId !== input.transition.transitionId
      || prepared.transitionKeySha256 !== transitionKeySha256
      || prepared.generationId !== freeze.releaseGenerationId
      || prepared.sourceManifestSha256 !== sourceSha256
      || prepared.previousReceiptSha256 !== source.latestCommittedReceiptSha256
      || canonicalReleaseJsonV2(prepared.gateOutputSha256s) !== canonicalReleaseJsonV2(expectedGateOutputSha256s)) {
    throw new Error("prepared_transition_conflict");
  }
  const receiptBytes = Buffer.from(String(prepared.canonicalCommittedReceiptUtf8Base64), "base64");
  if (releaseSha256V2(receiptBytes) !== prepared.committedReceiptSha256
      || !canonicalBytesV2(prepared.canonicalCommittedReceipt).equals(receiptBytes)) {
    throw new Error("prepared_receipt_bytes_invalid");
  }
  const receipt = JSON.parse(receiptBytes.toString("utf8")) as Record<string, unknown>;
  const target = validateRemediationReleaseManifestV2(prepared.targetManifest);
  const targetBytes = canonicalBytesV2(target);
  if (target.previousManifestSha256 !== sourceSha256
      || target.latestCommittedReceiptSha256 !== prepared.committedReceiptSha256
      || target.revision !== source.revision + 1
      || target.revision !== prepared.targetRevision
      || prepared.targetSnapshotSha256 !== releaseSha256V2(targetBytes)
      || receipt.transitionKeySha256 !== transitionKeySha256
      || receipt.sourceManifestSha256 !== sourceSha256
      || receipt.previousReceiptSha256 !== source.latestCommittedReceiptSha256
      || receipt.candidateSha !== source.candidateSha
      || receipt.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || receipt.releaseFreezeIdentitySha256 !== source.releaseFreezeIdentitySha256
      || receipt.targetManifestProjectionSha256
        !== releaseSha256V2(canonicalReleaseJsonV2(manifestProjectionV2(target)))
      || canonicalReleaseJsonV2(receipt.gateOutputSha256s)
        !== canonicalReleaseJsonV2(expectedGateOutputSha256s)
      || canonicalReleaseJsonV2(receipt.transitionEvidence)
        !== canonicalReleaseJsonV2(target.transitionEvidence)) {
    throw new Error("prepared_transition_binding_invalid");
  }
  const snapshotPath = safeArtifactPath(root, String(prepared.targetSnapshotRelativePath));
  if (!existsSync(snapshotPath) || !readFileSync(snapshotPath).equals(targetBytes)) {
    throw new Error("prepared_transition_snapshot_invalid");
  }
  return { target, targetBytes, receipt, receiptBytes, prepared, preparedBytes };
}

export async function advanceReleaseManifestV2(input: AdvanceInput) {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  if (input.rootState === "terminal_abandoned") throw new Error("release_root_sealed");
  if (existsSync(safeArtifactPath(root, ROOT_SEALED_FILE))) throw new Error("release_root_sealed");
  const source = validateRemediationReleaseManifestV2(input.sourceManifest);
  const manifestPath = safeArtifactPath(root, MANIFEST_FILE);
  const freeze = currentFreeze(root);
  if (freeze.candidateSha !== source.candidateSha
      || freeze.artifactRootFingerprintSha256 !== source.artifactRootFingerprintSha256
      || releaseSha256V2(canonicalReleaseJsonV2(freeze)) !== source.releaseFreezeIdentitySha256) {
    throw new Error("manifest_freeze_binding_invalid");
  }
  const sourceShaForKey = releaseSha256V2(canonicalBytesV2(source));
  if (!existsSync(manifestPath)) throw new Error("manifest_source_absent");
  const currentManifestBeforeClaim = validateRemediationReleaseManifestV2(readJson(manifestPath));
  const currentManifestShaBeforeClaim = releaseSha256V2(canonicalBytesV2(currentManifestBeforeClaim));
  const operationalAuthoritySha256 = input.transition.operationalAttestation === undefined
    || input.transition.operationalAttestation === null
    ? null
    : authorityHash(validateOperationalAttestationV2(input.transition.operationalAttestation, freeze));
  const transitionKey = releaseSha256V2(canonicalReleaseJsonV2([
    source.candidateSha, sourceShaForKey, input.transition.transitionId,
    freeze.releaseGenerationId, freeze.artifactRootFingerprintSha256,
    source.releaseFreezeIdentitySha256, operationalAuthoritySha256
  ]));
  const claimName = `manifest-transition-claim-${transitionKey}.json`;
  const preparedName = `manifest-transition-prepared-${transitionKey}.json`;
  const preparedPath = safeArtifactPath(root, preparedName);

  if (existsSync(preparedPath)) {
    const built = loadPreparedManifestResult(root, preparedPath, source, freeze, transitionKey, input);
    const receiptName = `manifest-transition-receipt-${String(built.prepared.committedReceiptSha256)}.json`;
    const completedReceiptPath = safeArtifactPath(root, receiptName);
    if (existsSync(manifestPath) && existsSync(completedReceiptPath)
        && currentManifestShaBeforeClaim === releaseSha256V2(built.targetBytes)
        && readFileSync(completedReceiptPath).equals(built.receiptBytes)) {
      return { manifest: built.target, receipt: built.receipt };
    }
  }
  if (currentManifestShaBeforeClaim !== sourceShaForKey
      && !existsSync(preparedPath)) throw new Error("manifest_source_cas_conflict");

  const leasePayload = ownerPayload({ evaluatedAt: input.evaluatedAt ?? input.transition.evaluatedAt },
    "manifest_transition", root, freeze, transitionKey, transitionKey);
  const lease = acquireOrResumeFrozenLease(root, leasePayload, existsSync(preparedPath));
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    if (existsSync(safeArtifactPath(root, "production-operation-root.lease.json"))) {
      throw new Error("production_operation_lease_active");
    }
    const built = existsSync(preparedPath)
      ? loadPreparedManifestResult(root, preparedPath, source, freeze, transitionKey, input)
      : preparedManifestResult(source, freeze, transitionKey, input);
    if (!existsSync(safeArtifactPath(root, claimName))) {
      exclusiveJson(root, claimName, {
        version: "manifest-transition-claim-v2", transitionId: input.transition.transitionId,
        transitionKeySha256: built.prepared.transitionKeySha256,
        generationId: freeze.releaseGenerationId, sourceManifestSha256: built.prepared.sourceManifestSha256,
        claimedAt: built.prepared.preparedAt
      });
    }
    exactReplayOrConflict(root, preparedName, built.preparedBytes);
    exactReplayOrConflict(root, String(built.prepared.targetSnapshotRelativePath), built.targetBytes);
    injectedFault(input.faultAt, "before_manifest_replace");
    lease.assertOwned();
    if (existsSync(safeArtifactPath(root, "production-operation-root.lease.json"))) {
      throw new Error("production_operation_lease_active");
    }
    const currentSource = existsSync(manifestPath) ? validateRemediationReleaseManifestV2(readJson(manifestPath)) : null;
    const currentHash = currentSource ? releaseSha256V2(canonicalBytesV2(currentSource)) : null;
    const targetHash = releaseSha256V2(canonicalBytesV2(built.target));
    if (currentSource && currentHash !== built.prepared.sourceManifestSha256 && currentHash !== targetHash) {
      throw new Error("manifest_source_cas_conflict");
    }
    const targetBytes = built.targetBytes;
    if (!existsSync(manifestPath)) writeExclusiveDurable(manifestPath, targetBytes);
    else if (currentHash !== targetHash) replaceDurable(manifestPath, targetBytes);
    injectedFault(input.faultAt, "after_manifest_replace");
    const completedReceiptName = `manifest-transition-receipt-${String(built.prepared.committedReceiptSha256)}.json`;
    exactReplayOrConflict(root, completedReceiptName, built.receiptBytes);
    lease.release();
    return { manifest: built.target, receipt: built.receipt };
  } catch (error) {
    if (!existsSync(preparedPath) && !existsSync(safeArtifactPath(root, claimName))
        && existsSync(lease.path)) lease.release();
    throw error;
  }
}

export async function recoverReleaseManifestStoreV2(input: {
  artifactRoot: string;
  expectedGenerationId: string;
  evaluatedAt: string;
}) {
  const freeze = currentFreeze(assertSafeArtifactRootPath(input.artifactRoot));
  if (freeze.releaseGenerationId !== input.expectedGenerationId) throw new Error("release_generation_mismatch");
  if (existsSync(safeArtifactPath(input.artifactRoot, ROOT_SEALED_FILE))) throw new Error("release_root_sealed");
  return { generationId: freeze.releaseGenerationId, evaluatedAt: input.evaluatedAt };
}

export function assertRootWriterLeaseFenceV2(
  expected: { ownerId: string; epoch: number; leaseSha256: string },
  current: { ownerId: string; epoch: number; leaseSha256: string }
): void {
  if (expected.ownerId !== current.ownerId || expected.epoch !== current.epoch
      || expected.leaseSha256 !== current.leaseSha256) throw new Error("root_writer_lease_fenced");
}

function takeoverFrozenRootWriterLeaseByHashV2(input: {
  root: string;
  oldBytes: Buffer;
  expectedOldLeaseSha256: string;
  evaluatedAt: string;
  faultAt?: string;
}) {
  const parsedOldLease = validateReleaseRootWriterLeaseV2(JSON.parse(input.oldBytes.toString("utf8")));
  const oldLease = parsedOldLease as FrozenRootWriterLeaseV2;
  if (oldLease.version !== "frozen-root-writer-lease-v2") throw new Error("frozen_lease_required");
  const freeze = currentFreeze(input.root);
  const freezeSha256 = releaseSha256V2(canonicalReleaseJsonV2(freeze));
  if (oldLease.releaseGenerationId !== freeze.releaseGenerationId
      || oldLease.candidateSha !== freeze.candidateSha
      || oldLease.protectedRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || oldLease.releaseFreezeIdentitySha256 !== freezeSha256) {
    throw new Error("old_lease_freeze_binding_mismatch");
  }
  if (Date.parse(input.evaluatedAt) < Date.parse(oldLease.expiresAt)) throw new Error("root_writer_lease_not_expired");
  if (isProcessAlive(oldLease.ownerPid)) throw new Error("root_writer_owner_still_alive");

  const oldHash = releaseSha256V2(input.oldBytes);
  if (oldHash !== input.expectedOldLeaseSha256) throw new Error("root_writer_lease_hash_mismatch");
  const preparedName = `manifest-transition-root.frozen-takeover-prepared-${oldHash}.json`;
  const tombstoneName = `manifest-transition-root.lease-tombstone-${oldHash}.json`;
  const preparedPath = safeArtifactPath(input.root, preparedName);
  let newLease: typeof oldLease;
  let newBytes: Buffer;
  let preparedBytes: Buffer;
  if (existsSync(preparedPath)) {
    const prepared = readJson(preparedPath) as Record<string, unknown>;
    if (prepared.oldLeaseSha256 !== oldHash) throw new Error("prepared_takeover_old_lease_conflict");
    newBytes = Buffer.from(String(prepared.canonicalNewLeaseUtf8Base64), "base64");
    newLease = validateReleaseRootWriterLeaseV2(JSON.parse(newBytes.toString("utf8"))) as FrozenRootWriterLeaseV2;
    if (releaseSha256V2(newBytes) !== prepared.newLeaseSha256) throw new Error("prepared_takeover_new_lease_hash_mismatch");
    preparedBytes = readFileSync(preparedPath);
  } else {
    newLease = validateReleaseRootWriterLeaseV2({
      ...oldLease,
      leaseEpoch: oldLease.leaseEpoch + 1,
      ownerPid: process.pid,
      ownerProcessStartFingerprintSha256: releaseSha256V2(`process:${process.pid}`),
      acquiredAt: input.evaluatedAt,
      heartbeatAt: input.evaluatedAt,
      expiresAt: new Date(Date.parse(input.evaluatedAt) + 60_000).toISOString()
    }) as FrozenRootWriterLeaseV2;
    newBytes = canonicalBytesV2(newLease);
    preparedBytes = canonicalBytesV2({
      version: "prepared-frozen-root-writer-lease-takeover-v2",
      oldLeaseSha256: oldHash,
      oldLeaseEpoch: oldLease.leaseEpoch,
      oldOwnerPid: oldLease.ownerPid,
      oldOwnerProcessStartFingerprintSha256: oldLease.ownerProcessStartFingerprintSha256,
      canonicalNewLease: newLease,
      canonicalNewLeaseUtf8Base64: newBytes.toString("base64"),
      newLeaseSha256: releaseSha256V2(newBytes),
      newLeaseEpoch: newLease.leaseEpoch,
      preparedAt: input.evaluatedAt
    });
    writeExclusiveDurable(preparedPath, preparedBytes);
  }
  injectedFault(input.faultAt, "after_prepare");

  const leasePath = safeArtifactPath(input.root, ROOT_WRITER_LEASE_FILE);
  const tombstonePath = safeArtifactPath(input.root, tombstoneName);
  if (!existsSync(tombstonePath)) {
    if (!existsSync(leasePath) || !readFileSync(leasePath).equals(input.oldBytes)) {
      throw new Error("old_lease_binding_mismatch");
    }
    moveNoOverwriteDurable(leasePath, tombstonePath);
  } else if (!readFileSync(tombstonePath).equals(input.oldBytes)) throw new Error("old_lease_tombstone_conflict");
  injectedFault(input.faultAt, "after_tombstone");

  if (!existsSync(leasePath)) writeExclusiveDurable(leasePath, newBytes);
  else if (!readFileSync(leasePath).equals(newBytes)) throw new Error("new_lease_conflict");
  injectedFault(input.faultAt, "after_new_lease");
  const receipt = {
    version: "frozen-root-writer-lease-takeover-receipt-v2",
    oldLeaseSha256: oldHash,
    tombstoneRelativePath: tombstoneName,
    newLeaseSha256: releaseSha256V2(newBytes),
    newLeaseEpoch: newLease.leaseEpoch,
    committedAt: input.evaluatedAt
  };
  const receiptBytes = canonicalBytesV2(receipt);
  const receiptName = `manifest-transition-root.frozen-takeover-receipt-${releaseSha256V2(receiptBytes)}.json`;
  exactReplayOrConflict(input.root, receiptName, receiptBytes);
  injectedFault(input.faultAt, "after_receipt");
  return { newLease, receipt, preparedSha256: releaseSha256V2(preparedBytes) };
}

export async function takeoverRootWriterLeaseByHashV2(input: {
  artifactRoot: string;
  expectedOldLeaseSha256: string;
  evaluatedAt: string;
  faultAt?: string;
}) {
  if (!/^[0-9a-f]{64}$/.test(input.expectedOldLeaseSha256)) throw new Error("expected_old_lease_sha_invalid");
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  const path = safeArtifactPath(root, ROOT_WRITER_LEASE_FILE);
  const tombstonePath = safeArtifactPath(root, `manifest-transition-root.lease-tombstone-${input.expectedOldLeaseSha256}.json`);
  const fixedBytes = existsSync(path) ? readFileSync(path) : null;
  const bytes = fixedBytes && releaseSha256V2(fixedBytes) === input.expectedOldLeaseSha256
    ? fixedBytes
    : existsSync(tombstonePath) ? readFileSync(tombstonePath) : null;
  if (bytes === null || releaseSha256V2(bytes) !== input.expectedOldLeaseSha256) {
    throw new Error(fixedBytes === null ? "root_writer_lease_absent" : "root_writer_lease_hash_mismatch");
  }
  const old = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  const oldEpoch = Number(old.leaseEpoch ?? old.epoch);
  const oldPid = Number(old.ownerPid ?? old.pid);
  const expiresAt = String(old.expiresAt ?? "");
  if (!Number.isSafeInteger(oldEpoch) || oldEpoch < 1 || !Number.isSafeInteger(oldPid)
      || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(input.evaluatedAt) < Date.parse(expiresAt)) {
    throw new Error("root_writer_lease_not_takeover_eligible");
  }
  if (isProcessAlive(oldPid)) throw new Error("root_writer_owner_still_alive");
  if (old.version === "bootstrap-root-writer-lease-v2") {
    const parsedOld = validateReleaseRootWriterLeaseV2(old) as BootstrapRootWriterLeaseV2;
    const oldHash = releaseSha256V2(bytes);
    const preparedName = `manifest-transition-root.bootstrap-takeover-prepared-${oldHash}.json`;
    const tombstoneName = `manifest-transition-root.lease-tombstone-${oldHash}.json`;
    const preparedPath = safeArtifactPath(root, preparedName);
    const preparedFreezeExists = existsSync(safeArtifactPath(root, FREEZE_PREPARED_FILE));
    const preparedFreezeMaterializationSha256 = preparedFreezeExists
      ? releaseSha256V2(readFileSync(safeArtifactPath(root, FREEZE_PREPARED_FILE))) : null;
    let newLease: BootstrapRootWriterLeaseV2;
    let newBytes: Buffer;
    if (existsSync(preparedPath)) {
      const prepared = readJson(preparedPath) as Record<string, unknown>;
      if (prepared.oldLeaseSha256 !== oldHash
          || prepared.preparedFreezeMaterializationSha256 !== preparedFreezeMaterializationSha256) {
        throw new Error("prepared_bootstrap_takeover_conflict");
      }
      newBytes = Buffer.from(String(prepared.canonicalNewLeaseUtf8Base64), "base64");
      newLease = validateReleaseRootWriterLeaseV2(JSON.parse(newBytes.toString("utf8"))) as BootstrapRootWriterLeaseV2;
      if (releaseSha256V2(newBytes) !== prepared.newLeaseSha256) {
        throw new Error("prepared_bootstrap_new_lease_hash_mismatch");
      }
    } else {
      newLease = validateReleaseRootWriterLeaseV2({
        ...parsedOld,
        leaseEpoch: oldEpoch + 1,
        ownerPid: process.pid,
        ownerProcessStartFingerprintSha256: releaseSha256V2(`process:${process.pid}`),
        acquiredAt: input.evaluatedAt,
        heartbeatAt: input.evaluatedAt,
        expiresAt: new Date(Date.parse(input.evaluatedAt) + 60_000).toISOString()
      }) as BootstrapRootWriterLeaseV2;
      newBytes = canonicalBytesV2(newLease);
      exactReplayOrConflict(root, preparedName, canonicalBytesV2({
        version: "prepared-bootstrap-root-writer-lease-takeover-v2",
        oldLeaseSha256: oldHash,
        oldLeaseEpoch: oldEpoch,
        oldOwnerPid: parsedOld.ownerPid,
        oldOwnerProcessStartFingerprintSha256: parsedOld.ownerProcessStartFingerprintSha256,
        preparedFreezeMaterializationSha256,
        canonicalNewLease: newLease,
        canonicalNewLeaseUtf8Base64: newBytes.toString("base64"),
        newLeaseSha256: releaseSha256V2(newBytes),
        newLeaseEpoch: oldEpoch + 1,
        preparedAt: input.evaluatedAt
      }));
    }
    injectedFault(input.faultAt, "after_prepare");
    const tombstonePath = safeArtifactPath(root, tombstoneName);
    if (!existsSync(tombstonePath)) {
      if (!existsSync(path) || !readFileSync(path).equals(bytes)) throw new Error("old_lease_binding_mismatch");
      moveNoOverwriteDurable(path, tombstonePath);
    } else if (!readFileSync(tombstonePath).equals(bytes)) throw new Error("old_lease_tombstone_conflict");
    injectedFault(input.faultAt, "after_tombstone");
    if (!existsSync(path)) writeExclusiveDurable(path, newBytes);
    else if (!readFileSync(path).equals(newBytes)) throw new Error("new_lease_conflict");
    injectedFault(input.faultAt, "after_new_lease");
    const receipt = { version: "bootstrap-root-writer-lease-takeover-receipt-v2",
      oldLeaseSha256: oldHash, tombstoneRelativePath: tombstoneName,
      newLeaseSha256: releaseSha256V2(newBytes), newLeaseEpoch: oldEpoch + 1,
      preparedFreezeMaterializationSha256,
      committedAt: input.evaluatedAt };
    const receiptBytes = canonicalBytesV2(receipt);
    const receiptSha256 = releaseSha256V2(receiptBytes);
    const receiptName = `manifest-transition-root.bootstrap-takeover-receipt-${receiptSha256}.json`;
    exactReplayOrConflict(root, receiptName, receiptBytes);
    injectedFault(input.faultAt, "after_receipt");
    if (!preparedFreezeExists) {
      exclusiveJson(root, BOOTSTRAP_SEALED_FILE, {
        version: "bootstrap-root-terminal-abandoned-v2",
        protectedRootFingerprintSha256: parsedOld.protectedRootFingerprintSha256,
        task0BPreflightEvidenceSha256: parsedOld.task0BPreflightEvidenceSha256,
        candidateSha: parsedOld.candidateSha,
        runtimeIdentitySha256: parsedOld.runtimeIdentitySha256,
        bootstrapTakeoverReceiptSha256: receiptSha256,
        preparedFreezeMaterializationSha256: null,
        removedBootstrapLeaseSha256: oldHash,
        removedBootstrapLeaseEpoch: oldEpoch,
        reason: "owner_died_before_freeze_prepare", rootSealed: true,
        retryRequiresNewProtectedRoot: true, abandonedAt: input.evaluatedAt
      });
      unlinkSync(path);
      return { sealed: true, newLease, receipt };
    }
    return { sealed: false, newLease, receipt };
  }
  return takeoverFrozenRootWriterLeaseByHashV2({
    root,
    oldBytes: bytes,
    expectedOldLeaseSha256: input.expectedOldLeaseSha256,
    evaluatedAt: input.evaluatedAt,
    faultAt: input.faultAt
  });
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export class ReleaseManifestStoreV2 {
  constructor(readonly artifactRoot: string) {
    assertSafeArtifactRootPath(artifactRoot);
  }
  advance(input: Omit<AdvanceInput, "artifactRoot">) {
    return advanceReleaseManifestV2({ ...input, artifactRoot: this.artifactRoot });
  }
}

export async function initializeReleaseManifestV2(input: {
  artifactRoot: string;
  evaluatedAt: string;
  verifiedGateOutputs: unknown;
}) {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  const manifestPath = safeArtifactPath(root, MANIFEST_FILE);
  if (existsSync(manifestPath)) throw new Error("initial_manifest_requires_absent_source");
  const freeze = currentFreeze(root);
  const operationKey = releaseSha256V2(canonicalReleaseJsonV2([
    freeze.candidateSha, null, "pre_manual", freeze.releaseGenerationId,
    freeze.artifactRootFingerprintSha256
  ]));
  const initialClaimName = `manifest-transition-claim-${operationKey}.json`;
  const initialPreparedName = `manifest-transition-prepared-${operationKey}.json`;
  const lease = acquireOrResumeFrozenLease(root,
    ownerPayload({ evaluatedAt: input.evaluatedAt }, "manifest_transition", root, freeze,
      operationKey, operationKey), false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    lease.assertOwned();
    const manifest = createInitialRemediationReleaseManifestV2({
      freezeIdentity: freeze,
      evaluatedAt: input.evaluatedAt,
      verifiedGateOutputs: input.verifiedGateOutputs
    });
    const targetBytes = canonicalBytesV2(manifest);
    const transitionKeySha256 = operationKey;
    const gateOutputSha256s = verifiedGateOutputHashes(input.verifiedGateOutputs);
    const receipt = {
      version: "committed-manifest-transition-receipt-v2", transitionId: "pre_manual",
      transitionKeySha256, candidateSha: freeze.candidateSha,
      artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
      releaseFreezeIdentitySha256: releaseSha256V2(canonicalReleaseJsonV2(freeze)),
      sourceManifestSha256: null,
      targetManifestProjectionSha256: releaseSha256V2(canonicalReleaseJsonV2(manifestProjectionV2(manifest))),
      sourceRevision: null, targetRevision: 1, previousReceiptSha256: null,
      gateOutputSha256s, transitionEvidence: [], committedAt: input.evaluatedAt
    };
    const receiptBytes = canonicalBytesV2(receipt);
    const receiptSha256 = releaseSha256V2(receiptBytes);
    const snapshotName = `release-manifest-r1-${releaseSha256V2(targetBytes)}.json`;
    const prepared = {
      version: "prepared-manifest-transition-v2", transitionId: "pre_manual",
      transitionKeySha256, generationId: freeze.releaseGenerationId,
      sourceManifestSha256: null, previousReceiptSha256: null, targetRevision: 1,
      gateOutputSha256s, targetSnapshotRelativePath: snapshotName,
      targetSnapshotSha256: releaseSha256V2(targetBytes), canonicalCommittedReceipt: receipt,
      canonicalCommittedReceiptUtf8Base64: receiptBytes.toString("base64"),
      committedReceiptSha256: receiptSha256, preparedAt: input.evaluatedAt,
      targetManifest: manifest
    };
    exclusiveJson(root, initialClaimName, {
      version: "manifest-transition-claim-v2", transitionId: "pre_manual", transitionKeySha256,
      generationId: freeze.releaseGenerationId, sourceManifestSha256: null, claimedAt: input.evaluatedAt
    });
    exclusiveJson(root, initialPreparedName, prepared);
    exactReplayOrConflict(root, snapshotName, targetBytes);
    writeExclusiveDurable(manifestPath, targetBytes);
    exactReplayOrConflict(root, `manifest-transition-receipt-${receiptSha256}.json`, receiptBytes);
    lease.release();
    return { manifest, receipt };
  } catch (error) {
    if (!existsSync(safeArtifactPath(root, initialClaimName))
        && !existsSync(safeArtifactPath(root, initialPreparedName))
        && existsSync(lease.path)) lease.release();
    throw error;
  }
}

export async function verifyReleaseManifestStoreV2(root: string) {
  const freeze = currentFreeze(root);
  const files = readdirSync(root).sort();
  return { releaseGenerationId: freeze.releaseGenerationId, files };
}

export async function persistPostgresManifestTransitionV2(
  client: ClientBase,
  input: {
    releaseGenerationId: string;
    sourceRevision: number;
    sourceManifestSha256: string;
    targetManifest: unknown;
    evaluatedAt: string;
  }
  ) {
  const target = validateRemediationReleaseManifestV2(input.targetManifest);
  if (!input.releaseGenerationId || target.revision !== input.sourceRevision + 1
      || target.previousManifestSha256 !== input.sourceManifestSha256) {
    throw new Error("postgres_manifest_transition_binding_invalid");
  }
  await client.query(`create table if not exists plan5_release_manifest_v2_cas(
    release_generation_id text primary key,
    revision integer not null,
    current_manifest_sha256 text not null,
    current_manifest_json jsonb not null,
    evaluated_at timestamptz not null
  )`);
  const targetBytes = canonicalBytesV2(target);
  const result = await client.query(`update plan5_release_manifest_v2_cas set
    revision=$2, current_manifest_sha256=$4, current_manifest_json=$5::jsonb,
    evaluated_at=$6::timestamptz
  where release_generation_id=$1 and revision=$3 and current_manifest_sha256=$7
  returning revision`, [input.releaseGenerationId, target.revision, input.sourceRevision,
    releaseSha256V2(targetBytes), JSON.stringify(target), input.evaluatedAt, input.sourceManifestSha256]);
  if (result.rowCount !== 1) throw new Error("postgres_manifest_transition_cas_conflict");
  return target;
}

export async function initializePostgresManifestStateV2(
  client: ClientBase,
  input: { releaseGenerationId: string; sourceManifestBytes: Buffer; evaluatedAt: string }
) {
  if (!input.releaseGenerationId) throw new Error("release_generation_invalid");
  const source = validateRemediationReleaseManifestV2(JSON.parse(input.sourceManifestBytes.toString("utf8")));
  const sourceSha256 = releaseSha256V2(input.sourceManifestBytes);
  await client.query(`create table if not exists plan5_release_manifest_v2_cas(
    release_generation_id text primary key,
    revision integer not null,
    current_manifest_sha256 text not null,
    current_manifest_json jsonb not null,
    evaluated_at timestamptz not null
  )`);
  const result = await client.query(`insert into plan5_release_manifest_v2_cas(
    release_generation_id, revision, current_manifest_sha256, current_manifest_json, evaluated_at
  ) values ($1,$2,$3,$4::jsonb,$5::timestamptz) on conflict do nothing`, [
    input.releaseGenerationId, source.revision, sourceSha256, JSON.stringify(source), input.evaluatedAt
  ]);
  if (result.rowCount !== 1) throw new Error("postgres_manifest_source_already_initialized");
  return { source, sourceSha256 };
}
