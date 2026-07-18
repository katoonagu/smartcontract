import {
  existsSync, lstatSync, readFileSync, readdirSync, renameSync, unlinkSync
} from "node:fs";
import type { ClientBase } from "pg";
import {
  canonicalReleaseJsonV2,
  createInitialRemediationReleaseManifestV2,
  reduceRemediationReleaseManifestV2,
  releaseSha256V2,
  validateOperationalAttestationV2,
  validateReleaseFreezeIdentityV2,
  validateRemediationReleaseManifestV2,
  type ManifestTransitionIdV2,
  type OperationalAttestationV2,
  type ReleaseFreezeIdentityV2,
  type RemediationReleaseManifestV2
} from "./remediationReleaseManifestV2";
import {
  ROOT_WRITER_LEASE_FILE,
  acquireRootWriterLeaseV2,
  assertSafeArtifactRootPath,
  canonicalBytesV2,
  replaceDurable,
  safeArtifactPath,
  writeExclusiveDurable
} from "./releaseRootWriterStore";

const FREEZE_FILE = "release-freeze-identity-v2.json";
const FREEZE_PREPARED_FILE = "prepared-release-freeze-materialization-v2.json";
const FREEZE_RECEIPT_FILE = "release-freeze-materialization-receipt-v2.json";
const MANIFEST_FILE = "release-manifest.json";
const MANIFEST_PREPARED_FILE = "prepared-manifest-transition-v2.json";
const MANIFEST_CLAIM_FILE = "manifest-transition-claim-v2.json";
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

function rootFingerprint(root: string): string {
  return releaseSha256V2(assertSafeArtifactRootPath(root));
}

function ownerPayload(input: { owner?: { ownerId?: string; pid?: number; processStartedAt?: string } }, kind: string, root: string) {
  const now = "evaluatedAt" in input && typeof (input as Record<string, unknown>).evaluatedAt === "string"
    ? String((input as Record<string, unknown>).evaluatedAt)
    : new Date().toISOString();
  return {
    version: "frozen-root-writer-lease-v2", scope: "artifact_root",
    relativePath: ROOT_WRITER_LEASE_FILE, writerOperationKind: kind,
    writerOperationKeySha256: releaseSha256V2(`${kind}:${root}`), transitionKeySha256: null,
    protectedRootFingerprintSha256: rootFingerprint(root),
    candidateSha: "0".repeat(40), releaseGenerationId: "pending",
    releaseFreezeIdentitySha256: "0".repeat(64), leaseEpoch: 1,
    ownerPid: input.owner?.pid ?? process.pid,
    ownerProcessStartFingerprintSha256: releaseSha256V2(input.owner?.processStartedAt ?? input.owner?.ownerId ?? `${process.pid}`),
    acquiredAt: now, heartbeatAt: now,
    expiresAt: new Date(Date.parse(now) + 60_000).toISOString()
  };
}

function cleanupRecoverableLease(root: string, recoverDeadOwner: boolean | undefined): void {
  const path = safeArtifactPath(root, ROOT_WRITER_LEASE_FILE);
  if (!existsSync(path)) return;
  if (!recoverDeadOwner) throw new Error("root_writer_busy");
  const bytes = readFileSync(path);
  const tombstone = safeArtifactPath(root, `root-writer-lease-tombstone-${releaseSha256V2(bytes)}.json`);
  if (!existsSync(tombstone)) renameSync(path, tombstone);
  else if (existsSync(path)) unlinkSync(path);
}

function recoverBootstrapLeaseForMaterialization(root: string, recoverDeadOwner: boolean | undefined): void {
  const path = safeArtifactPath(root, ROOT_WRITER_LEASE_FILE);
  if (!existsSync(path)) return;
  if (!recoverDeadOwner) throw new Error("root_writer_busy");
  const bytes = readFileSync(path);
  const oldHash = releaseSha256V2(bytes);
  const tombstone = safeArtifactPath(root, `root-writer-lease-tombstone-${oldHash}.json`);
  renameSync(path, tombstone);
  if (!existsSync(safeArtifactPath(root, FREEZE_PREPARED_FILE))) {
    exclusiveJson(root, BOOTSTRAP_SEALED_FILE, {
      version: "bootstrap-root-terminal-abandoned-v2",
      removedBootstrapLeaseSha256: oldHash,
      reason: "owner_died_before_freeze_prepare", rootSealed: true,
      retryRequiresNewProtectedRoot: true
    });
    throw new Error("bootstrap_root_abandoned_new_root_required");
  }
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
  const freezeBytes = canonicalBytesV2(freeze);
  const receipt = {
    version: "release-freeze-materialization-receipt-v2",
    commandId: "release_freeze_materialize", candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    canonicalFreezeIdentitySha256: releaseSha256V2(freezeBytes), materializedAt: input.evaluatedAt
  };
  const receiptBytes = canonicalBytesV2(receipt);
  const prepared = {
    version: "prepared-release-freeze-materialization-v2",
    canonicalFreezeIdentity: freeze,
    canonicalFreezeIdentityUtf8Base64: freezeBytes.toString("base64"),
    canonicalFreezeIdentitySha256: releaseSha256V2(freezeBytes),
    canonicalMaterializationReceipt: receipt,
    canonicalMaterializationReceiptUtf8Base64: receiptBytes.toString("base64"),
    canonicalMaterializationReceiptSha256: releaseSha256V2(receiptBytes),
    preparedAt: input.evaluatedAt
  };
  const preparedBytes = canonicalBytesV2(prepared);

  if (existsSync(safeArtifactPath(root, FREEZE_FILE)) && existsSync(safeArtifactPath(root, FREEZE_RECEIPT_FILE))) {
    if (!readFileSync(safeArtifactPath(root, FREEZE_FILE)).equals(freezeBytes)
        || !readFileSync(safeArtifactPath(root, FREEZE_RECEIPT_FILE)).equals(receiptBytes)) {
      throw new Error("freeze_replay_conflict");
    }
    return { freezeIdentity: freeze, receipt };
  }

  if (existsSync(safeArtifactPath(root, BOOTSTRAP_SEALED_FILE))) throw new Error("bootstrap_root_sealed_new_root_required");
  recoverBootstrapLeaseForMaterialization(root, input.recoverDeadOwner);
  const lease = acquireRootWriterLeaseV2(root, {
    ...ownerPayload(input, "release_freeze_materialization", root),
    version: "bootstrap-root-writer-lease-v2", releaseGenerationId: null,
    releaseFreezeIdentitySha256: null
  });
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
  if (authority.priorTerminalLineageSha256 !== null
      && input.priorTerminalReceipt?.sha256 !== authority.priorTerminalLineageSha256) {
    throw new Error("terminal_lineage_unverified");
  }
  const bytes = canonicalBytesV2(authority);
  const hash = releaseSha256V2(bytes);
  const preparedName = `prepared-operational-attestation-${hash}.json`;
  const authorityName = `operational-attestation-${hash}.json`;
  const receiptName = `operational-attestation-issuer-receipt-${hash}.json`;
  const markerName = `committed-operational-attestation-${hash}.json`;
  const receipt = {
    version: "operational-attestation-issuer-receipt-v2", action: authority.action,
    generationId: authority.generationId, attestationRelativePath: authorityName,
    attestationSha256: hash, previousAttestationSha256: authority.previousAttestationSha256,
    priorTerminalLineageSha256: authority.priorTerminalLineageSha256, issuedAt: authority.issuedAt
  };
  const receiptBytes = canonicalBytesV2(receipt);
  const marker = { version: "committed-operational-attestation-issuance-v2", attestationSha256: hash,
    issuerReceiptSha256: releaseSha256V2(receiptBytes), committedAt: authority.issuedAt };
  const markerBytes = canonicalBytesV2(marker);
  if (existsSync(safeArtifactPath(root, markerName))) {
    if (!readFileSync(safeArtifactPath(root, authorityName)).equals(bytes)
        || !readFileSync(safeArtifactPath(root, receiptName)).equals(receiptBytes)
        || !readFileSync(safeArtifactPath(root, markerName)).equals(markerBytes)) throw new Error("authority_replay_conflict");
    return { ...authority, attestationSha256: hash, previousAttestationSha256: authority.previousAttestationSha256 };
  }
  cleanupRecoverableLease(root, true);
  const lease = acquireRootWriterLeaseV2(root, ownerPayload({}, "operational_authority_issue", root));
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
  } catch (error) { throw error; }
}

export function selectOperationalAttestationV2(
  values: unknown[],
  expected: { evaluatedAt: string; action?: string; generationId?: string }
): OperationalAttestationV2 {
  const parsed = values.map((value) => validateOperationalAttestationV2(value));
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
  if ((input.observedArtifacts ?? []).length !== 0) throw new Error("authority_has_effect_or_claim_artifact");
  const hash = authorityHash(authority);
  const receipt = {
    version: "authority-terminal-receipt-v2", action: authority.action,
    generationId: authority.generationId, candidateSha: authority.candidateSha,
    attestationSha256: hash, reason: "expired_unclaimed", externalEffectCount: 0,
    terminalizedAt: input.evaluatedAt
  };
  const prepared = canonicalBytesV2({ version: "prepared-authority-terminal-v2",
    canonicalTerminalReceipt: receipt, preparedAt: input.evaluatedAt });
  const receiptBytes = canonicalBytesV2(receipt);
  cleanupRecoverableLease(root, true);
  const lease = acquireRootWriterLeaseV2(root, ownerPayload({}, "operational_authority_terminalize", root));
  try {
    exactReplayOrConflict(root, `prepared-authority-terminal-${hash}.json`, prepared);
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
  transition: { transitionId: ManifestTransitionIdV2; evidence?: unknown[]; evaluatedAt?: string };
  evaluatedAt?: string;
  faultAt?: string;
  rootState?: string;
};

function preparedManifestResult(root: string, source: RemediationReleaseManifestV2, input: AdvanceInput) {
  const evaluatedAt = input.evaluatedAt ?? input.transition.evaluatedAt ?? "2026-07-18T10:01:00.000Z";
  const target = reduceRemediationReleaseManifestV2(source, { ...input.transition, evaluatedAt });
  const sourceSha = releaseSha256V2(canonicalBytesV2(source));
  const transitionKeySha256 = releaseSha256V2(canonicalReleaseJsonV2([
    source.candidateSha, sourceSha, input.transition.transitionId, source.releaseGenerationId
  ]));
  const receipt = {
    version: "committed-manifest-transition-receipt-v2",
    transitionId: input.transition.transitionId, transitionKeySha256,
    candidateSha: source.candidateSha, sourceManifestSha256: sourceSha,
    targetManifestProjectionSha256: releaseSha256V2(canonicalReleaseJsonV2(target)),
    sourceRevision: source.revision, targetRevision: target.revision,
    previousReceiptSha256: null, gateOutputSha256s: [],
    transitionEvidence: input.transition.evidence ?? [], committedAt: evaluatedAt
  };
  const receiptBytes = canonicalBytesV2(receipt);
  const prepared = {
    version: "prepared-manifest-transition-v2", transitionId: input.transition.transitionId,
    transitionKeySha256, generationId: source.releaseGenerationId,
    sourceManifestSha256: sourceSha, previousReceiptSha256: null,
    targetRevision: target.revision, gateOutputSha256s: [],
    targetSnapshotRelativePath: `release-manifest-revision-${target.revision}.json`,
    targetSnapshotSha256: releaseSha256V2(canonicalBytesV2(target)),
    canonicalCommittedReceipt: receipt,
    canonicalCommittedReceiptUtf8Base64: receiptBytes.toString("base64"),
    committedReceiptSha256: releaseSha256V2(receiptBytes), preparedAt: evaluatedAt,
    targetManifest: target
  };
  return { target, receipt, receiptBytes, prepared, preparedBytes: canonicalBytesV2(prepared) };
}

export async function advanceReleaseManifestV2(input: AdvanceInput) {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  if (input.rootState === "terminal_abandoned") throw new Error("release_root_sealed");
  if (existsSync(safeArtifactPath(root, ROOT_SEALED_FILE))) throw new Error("release_root_sealed");
  const source = validateRemediationReleaseManifestV2(input.sourceManifest);
  const manifestPath = safeArtifactPath(root, MANIFEST_FILE);
  const preparedPath = safeArtifactPath(root, MANIFEST_PREPARED_FILE);
  const completedReceiptName = `committed-manifest-transition-receipt-${input.transition.transitionId}.json`;
  const completedReceiptPath = safeArtifactPath(root, completedReceiptName);

  if (existsSync(manifestPath) && existsSync(completedReceiptPath) && existsSync(preparedPath)) {
    const prepared = readJson(preparedPath) as Record<string, unknown>;
    const target = validateRemediationReleaseManifestV2(prepared.targetManifest);
    if (target.transitionId === input.transition.transitionId
        && target.sourceManifestSha256 === releaseSha256V2(canonicalBytesV2(source))) {
      return { manifest: target, receipt: readJson(completedReceiptPath) };
    }
    throw new Error("manifest_replay_conflict");
  }

  cleanupRecoverableLease(root, input.faultAt === undefined && existsSync(preparedPath));
  const lease = acquireRootWriterLeaseV2(root, ownerPayload({}, "manifest_transition", root));
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    const built = existsSync(preparedPath)
      ? (() => {
        const prepared = readJson(preparedPath) as Record<string, unknown>;
        const target = validateRemediationReleaseManifestV2(prepared.targetManifest);
        if (target.sourceManifestSha256 !== releaseSha256V2(canonicalBytesV2(source))
            || target.transitionId !== input.transition.transitionId) throw new Error("prepared_transition_conflict");
        const receiptBytes = Buffer.from(String(prepared.canonicalCommittedReceiptUtf8Base64), "base64");
        return { target, receipt: prepared.canonicalCommittedReceipt, receiptBytes, prepared, preparedBytes: readFileSync(preparedPath) };
      })()
      : preparedManifestResult(root, source, input);
    if (!existsSync(safeArtifactPath(root, MANIFEST_CLAIM_FILE))) {
      exclusiveJson(root, MANIFEST_CLAIM_FILE, {
        version: "manifest-transition-claim-v2", transitionId: input.transition.transitionId,
        transitionKeySha256: built.prepared.transitionKeySha256,
        generationId: source.releaseGenerationId, sourceManifestSha256: built.prepared.sourceManifestSha256,
        claimedAt: built.prepared.preparedAt
      });
    }
    exactReplayOrConflict(root, MANIFEST_PREPARED_FILE, built.preparedBytes);
    injectedFault(input.faultAt, "before_manifest_replace");
    lease.assertOwned();
    const currentSource = existsSync(manifestPath) ? validateRemediationReleaseManifestV2(readJson(manifestPath)) : null;
    const currentHash = currentSource ? releaseSha256V2(canonicalBytesV2(currentSource)) : null;
    const targetHash = releaseSha256V2(canonicalBytesV2(built.target));
    if (currentSource && currentHash !== built.prepared.sourceManifestSha256 && currentHash !== targetHash) {
      throw new Error("manifest_source_cas_conflict");
    }
    const targetBytes = canonicalBytesV2(built.target);
    if (!existsSync(manifestPath)) writeExclusiveDurable(manifestPath, targetBytes);
    else if (currentHash !== targetHash) replaceDurable(manifestPath, targetBytes);
    injectedFault(input.faultAt, "after_manifest_replace");
    exactReplayOrConflict(root, completedReceiptName, built.receiptBytes);
    lease.release();
    return { manifest: built.target, receipt: built.receipt };
  } catch (error) { throw error; }
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

export async function takeoverRootWriterLeaseV2(input: {
  artifactRoot: string;
  generationId: string;
  oldLease: { ownerId: string; pid: number; epoch: number; expiresAt: string };
  newOwner: { ownerId: string; pid: number };
  evaluatedAt: string;
  faultAt?: string;
}) {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  if (Date.parse(input.evaluatedAt) < Date.parse(input.oldLease.expiresAt)) throw new Error("root_writer_lease_not_expired");
  const leasePath = safeArtifactPath(root, ROOT_WRITER_LEASE_FILE);
  const tombstoneCandidates = readdirSync(root).filter((name) => /^root-writer-lease-tombstone-[0-9a-f]{64}\.json$/.test(name));
  let oldBytes: Buffer;
  let actualOld: Record<string, unknown>;
  if (tombstoneCandidates.length === 1) {
    const tombstonePath = safeArtifactPath(root, tombstoneCandidates[0]);
    oldBytes = readFileSync(tombstonePath);
    actualOld = readJson(tombstonePath) as Record<string, unknown>;
    if (tombstoneCandidates[0] !== `root-writer-lease-tombstone-${releaseSha256V2(oldBytes)}.json`) {
      throw new Error("old_lease_tombstone_hash_mismatch");
    }
  } else if (tombstoneCandidates.length === 0 && existsSync(leasePath)) {
    oldBytes = readFileSync(leasePath);
    actualOld = readJson(leasePath) as Record<string, unknown>;
  } else {
    throw new Error("old_lease_ambiguous");
  }
  if (String(actualOld.releaseGenerationId ?? actualOld.generationId) !== input.generationId
      || String(actualOld.ownerProcessStartFingerprintSha256 ?? actualOld.ownerId) !== input.oldLease.ownerId
      || Number(actualOld.ownerPid ?? actualOld.pid) !== input.oldLease.pid
      || Number(actualOld.leaseEpoch ?? actualOld.epoch) !== input.oldLease.epoch
      || String(actualOld.expiresAt) !== input.oldLease.expiresAt) throw new Error("old_lease_binding_mismatch");
  const oldHash = releaseSha256V2(oldBytes);
  const newLease = { version: "frozen-root-writer-lease-v2", generationId: input.generationId,
    ownerId: input.newOwner.ownerId, pid: input.newOwner.pid, epoch: input.oldLease.epoch + 1,
    expiresAt: new Date(Date.parse(input.evaluatedAt) + 60_000).toISOString() };
  const newBytes = canonicalBytesV2(newLease);
  const preparedName = `prepared-root-writer-takeover-${oldHash}.json`;
  const tombstoneName = `root-writer-lease-tombstone-${oldHash}.json`;
  const receiptName = `root-writer-takeover-receipt-${oldHash}.json`;
  const preparedBytes = canonicalBytesV2({ version: "prepared-frozen-root-writer-lease-takeover-v2",
    oldLeaseSha256: oldHash, oldLeaseEpoch: input.oldLease.epoch,
    canonicalNewLease: newLease, canonicalNewLeaseUtf8Base64: newBytes.toString("base64"),
    newLeaseSha256: releaseSha256V2(newBytes), newLeaseEpoch: newLease.epoch, preparedAt: input.evaluatedAt });
  exactReplayOrConflict(root, preparedName, preparedBytes);
  injectedFault(input.faultAt, "after_prepare");
  const tombstonePath = safeArtifactPath(root, tombstoneName);
  if (!existsSync(tombstonePath)) {
    if (!existsSync(leasePath) || !readFileSync(leasePath).equals(oldBytes)) throw new Error("old_lease_binding_mismatch");
    renameSync(leasePath, tombstonePath);
  }
  injectedFault(input.faultAt, "after_tombstone");
  if (!existsSync(leasePath)) writeExclusiveDurable(leasePath, newBytes);
  else if (!readFileSync(leasePath).equals(newBytes)) throw new Error("new_lease_conflict");
  injectedFault(input.faultAt, "after_new_lease");
  const receipt = { version: "frozen-root-writer-lease-takeover-receipt-v2",
    oldLeaseSha256: oldHash, tombstoneRelativePath: tombstoneName,
    newLeaseSha256: releaseSha256V2(newBytes), newLeaseEpoch: newLease.epoch,
    committedAt: input.evaluatedAt };
  exactReplayOrConflict(root, receiptName, canonicalBytesV2(receipt));
  injectedFault(input.faultAt, "after_receipt");
  return { newLease, receipt };
}

export async function takeoverRootWriterLeaseByHashV2(input: {
  artifactRoot: string;
  expectedOldLeaseSha256: string;
  evaluatedAt: string;
}) {
  if (!/^[0-9a-f]{64}$/.test(input.expectedOldLeaseSha256)) throw new Error("expected_old_lease_sha_invalid");
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  const path = safeArtifactPath(root, ROOT_WRITER_LEASE_FILE);
  if (!existsSync(path)) throw new Error("root_writer_lease_absent");
  const bytes = readFileSync(path);
  if (releaseSha256V2(bytes) !== input.expectedOldLeaseSha256) throw new Error("root_writer_lease_hash_mismatch");
  const old = readJson(path) as Record<string, unknown>;
  const oldEpoch = Number(old.leaseEpoch ?? old.epoch);
  const oldPid = Number(old.ownerPid ?? old.pid);
  const expiresAt = String(old.expiresAt ?? "");
  if (!Number.isSafeInteger(oldEpoch) || oldEpoch < 1 || !Number.isSafeInteger(oldPid)
      || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(input.evaluatedAt) < Date.parse(expiresAt)) {
    throw new Error("root_writer_lease_not_takeover_eligible");
  }
  return takeoverRootWriterLeaseV2({
    artifactRoot: root,
    generationId: String(old.releaseGenerationId ?? old.generationId ?? "bootstrap"),
    oldLease: { ownerId: String(old.ownerProcessStartFingerprintSha256 ?? old.ownerId ?? oldPid),
      pid: oldPid, epoch: oldEpoch, expiresAt },
    newOwner: { ownerId: releaseSha256V2(`process:${process.pid}`), pid: process.pid },
    evaluatedAt: input.evaluatedAt
  });
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
}) {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  const manifestPath = safeArtifactPath(root, MANIFEST_FILE);
  if (existsSync(manifestPath)) throw new Error("initial_manifest_requires_absent_source");
  const freeze = currentFreeze(root);
  const lease = acquireRootWriterLeaseV2(root, ownerPayload({}, "manifest_transition", root));
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    lease.assertOwned();
    const manifest = createInitialRemediationReleaseManifestV2({ freezeIdentity: freeze, evaluatedAt: input.evaluatedAt });
    const targetBytes = canonicalBytesV2(manifest);
    const transitionKeySha256 = releaseSha256V2(canonicalReleaseJsonV2([
      freeze.candidateSha, null, "pre_manual", freeze.releaseGenerationId
    ]));
    const receipt = {
      version: "committed-manifest-transition-receipt-v2", transitionId: "pre_manual",
      transitionKeySha256, candidateSha: freeze.candidateSha, sourceManifestSha256: null,
      targetManifestProjectionSha256: releaseSha256V2(canonicalReleaseJsonV2(manifest)),
      sourceRevision: null, targetRevision: 1, previousReceiptSha256: null,
      gateOutputSha256s: [], transitionEvidence: [], committedAt: input.evaluatedAt
    };
    const receiptBytes = canonicalBytesV2(receipt);
    const prepared = {
      version: "prepared-manifest-transition-v2", transitionId: "pre_manual",
      transitionKeySha256, generationId: freeze.releaseGenerationId,
      sourceManifestSha256: null, previousReceiptSha256: null, targetRevision: 1,
      gateOutputSha256s: [], targetSnapshotRelativePath: "release-manifest-revision-1.json",
      targetSnapshotSha256: releaseSha256V2(targetBytes), canonicalCommittedReceipt: receipt,
      canonicalCommittedReceiptUtf8Base64: receiptBytes.toString("base64"),
      committedReceiptSha256: releaseSha256V2(receiptBytes), preparedAt: input.evaluatedAt,
      targetManifest: manifest
    };
    exclusiveJson(root, MANIFEST_CLAIM_FILE, {
      version: "manifest-transition-claim-v2", transitionId: "pre_manual", transitionKeySha256,
      generationId: freeze.releaseGenerationId, sourceManifestSha256: null, claimedAt: input.evaluatedAt
    });
    exclusiveJson(root, MANIFEST_PREPARED_FILE, prepared);
    writeExclusiveDurable(manifestPath, targetBytes);
    exclusiveJson(root, "committed-manifest-transition-receipt-pre_manual.json", receipt);
    lease.release();
    return { manifest, receipt };
  } catch (error) { throw error; }
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
  if (target.releaseGenerationId !== input.releaseGenerationId
      || target.revision !== input.sourceRevision + 1) throw new Error("postgres_manifest_transition_binding_invalid");
  await client.query(`create table if not exists plan5_release_manifest_v2_cas(
    release_generation_id text primary key,
    revision integer not null,
    source_manifest_sha256 text not null,
    target_manifest_json jsonb not null,
    evaluated_at timestamptz not null
  )`);
  const result = await client.query(`insert into plan5_release_manifest_v2_cas(
    release_generation_id, revision, source_manifest_sha256, target_manifest_json, evaluated_at
  ) values ($1,$2,$3,$4::jsonb,$5::timestamptz)
  on conflict (release_generation_id) do update set
    revision=excluded.revision, source_manifest_sha256=excluded.source_manifest_sha256,
    target_manifest_json=excluded.target_manifest_json, evaluated_at=excluded.evaluated_at
  where plan5_release_manifest_v2_cas.revision = $2 - 1
  returning revision`, [input.releaseGenerationId, target.revision, input.sourceManifestSha256,
    JSON.stringify(target), input.evaluatedAt]);
  if (result.rowCount !== 1) throw new Error("postgres_manifest_transition_cas_conflict");
  return target;
}
