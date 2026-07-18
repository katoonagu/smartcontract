import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { ClientBase } from "pg";
import { validateTask0BReleaseFreezeEvidence } from "./remediationReleaseManifest";
import {
  canonicalReleaseJsonV2,
  createInitialRemediationReleaseManifestV2,
  OPERATIONAL_ATTESTATION_POLICY_V2,
  operationalAttestationTemplateSha256V2,
  reduceRemediationReleaseManifestV2,
  releaseSha256V2,
  releaseFreezeIdentitySha256V2,
  validateCommittedManifestTransitionReceiptV2,
  validateCommittedOperationalAttestationIssuanceV2,
  validateAuthorityTerminalReceiptV2,
  validateManifestCommittedReceiptBindingV2,
  validateManifestTransitionClaimV2,
  validateOperationalAttestationV2,
  validateOperationalAttestationIssuerReceiptV2,
  validatePreparedManifestTransitionV2,
  validatePreparedAuthorityTerminalV2,
  validatePreparedOperationalAttestationIssuanceV2,
  validatePreparedReleaseFreezeMaterializationV2,
  validateReleaseFreezeMaterializationReceiptV2,
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
  safeArtifactRelativePath,
  safeArtifactPath,
  unlinkDurable,
  writeExclusiveDurable
} from "./releaseRootWriterStore";

const FREEZE_FILE = "release-freeze-identity-v2.json";
const FREEZE_PREPARED_FILE = "release-freeze-materialization-prepared-v2.json";
const FREEZE_RECEIPT_FILE = "release-freeze-materialization-receipt-v2.json";
const MANIFEST_FILE = "release-manifest.json";
const ROOT_SEALED_FILE = "release-root-terminal-abandoned.json";
const BOOTSTRAP_SEALED_FILE = "bootstrap-root-terminal-abandoned-v2.json";

const NESTED_LIFECYCLE_ROOTS = new Set([
  "manifest-snapshots",
  "operational-attestation-issuance-prepared",
  "operational-attestations",
  "operational-attestation-issuer-receipts",
  "operational-attestation-issuance-committed",
  "authority-terminal-prepared",
  "authority-terminal-receipts"
]);

function lifecyclePath(root: string, relativePath: string, createParents = false): string {
  const segments = relativePath.split("/");
  if (segments.length === 1) return safeArtifactPath(root, relativePath);
  if (!NESTED_LIFECYCLE_ROOTS.has(segments[0]!)) throw new Error("lifecycle_artifact_directory_forbidden");
  const allowedDirectories = segments.slice(0, -1).map((_, index) =>
    segments.slice(0, index + 1).join("/"));
  return safeArtifactRelativePath(root, relativePath, { createParents, allowedDirectories });
}

function lifecycleArtifactExists(root: string, relativePath: string): boolean {
  try { return existsSync(lifecyclePath(root, relativePath)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT"
        || (error as Error).message === "artifact_parent_missing") return false;
    throw error;
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function exclusiveJson(root: string, filename: string, value: unknown): Buffer {
  const bytes = canonicalBytesV2(value);
  writeExclusiveDurable(lifecyclePath(root, filename, true), bytes);
  return bytes;
}

function exactReplayOrConflict(root: string, filename: string, bytes: Buffer): void {
  const path = lifecyclePath(root, filename, true);
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
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze), leaseEpoch: 1,
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

function releaseCompletedReplayLeaseIfOwned(root: string, payload: Record<string, unknown>): void {
  const path = safeArtifactPath(root, ROOT_WRITER_LEASE_FILE);
  if (!existsSync(path)) return;
  const current = readJson(path) as Record<string, unknown>;
  if (current.writerOperationKind !== payload.writerOperationKind
      || current.writerOperationKeySha256 !== payload.writerOperationKeySha256
      || current.ownerPid !== payload.ownerPid
      || current.ownerProcessStartFingerprintSha256 !== payload.ownerProcessStartFingerprintSha256) return;
  const lease = resumeRootWriterLeaseV2(root, {
    writerOperationKind: String(payload.writerOperationKind),
    writerOperationKeySha256: String(payload.writerOperationKeySha256),
    ownerPid: Number(payload.ownerPid),
    ownerProcessStartFingerprintSha256: String(payload.ownerProcessStartFingerprintSha256)
  });
  lease.release();
}

export async function materializeReleaseFreezeV2(input: {
  artifactRoot: string;
  freezeIdentity: unknown;
  task0BPreflightEvidence: unknown;
  evaluatedAt: string;
  owner?: { ownerId?: string; pid?: number; processStartedAt?: string };
  producerId: "release_freeze_materialize";
  recoverDeadOwner?: boolean;
  faultAt?: string;
}) {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  if (input.producerId !== "release_freeze_materialize") {
    throw new Error("freeze_producer_not_authorized");
  }
  const freeze = validateReleaseFreezeIdentityV2(input.freezeIdentity);
  const preflightPath = safeArtifactPath(root, "task0b-release-freeze.json");
  if (!existsSync(preflightPath)) throw new Error("task0b_preflight_artifact_missing");
  const storedPreflight = readJson(preflightPath);
  if (canonicalReleaseJsonV2(storedPreflight)
      !== canonicalReleaseJsonV2(input.task0BPreflightEvidence)) {
    throw new Error("task0b_preflight_artifact_mismatch");
  }
  const preflight = validateTask0BReleaseFreezeEvidence(
    storedPreflight,
    freeze.candidateSha,
    input.evaluatedAt
  );
  if (!readFileSync(preflightPath).equals(canonicalBytesV2(preflight))) {
    throw new Error("task0b_preflight_artifact_noncanonical");
  }
  if (preflight.artifactRoot.rootFingerprintSha256 !== freeze.artifactRootFingerprintSha256) {
    throw new Error("task0b_artifact_root_binding_invalid");
  }
  const preflightSha256 = releaseSha256V2(canonicalBytesV2(preflight));
  const runtimeIdentitySha256 = releaseSha256V2(canonicalBytesV2(preflight.previousRuntimeIdentity));
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
    runtimeIdentitySha256,
    releaseGenerationId: null, releaseFreezeIdentitySha256: null,
    leaseEpoch: 1, ownerPid: input.owner?.pid ?? process.pid,
    ownerProcessStartFingerprintSha256: releaseSha256V2(input.owner?.processStartedAt ?? input.owner?.ownerId ?? `process:${process.pid}`),
    acquiredAt: input.evaluatedAt, heartbeatAt: input.evaluatedAt,
    expiresAt: new Date(Date.parse(input.evaluatedAt) + 60_000).toISOString()
  };
  const bootstrapLeaseBytes = canonicalBytesV2(bootstrapPayload);
  let freezeBytes = canonicalBytesV2(freeze);
  const materializerTemplateSha256 = releaseSha256V2("release:freeze:materialize <protected-artifact-root>");
  let receipt = {
    version: "release-freeze-materialization-receipt-v2",
    commandId: "release_freeze_materialize",
    redactedTemplateSha256: materializerTemplateSha256,
    task0BPreflightEvidenceSha256: preflightSha256,
    protectedRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    candidateSha: freeze.candidateSha,
    runtimeIdentitySha256,
    bootstrapLeaseSha256: releaseSha256V2(bootstrapLeaseBytes),
    bootstrapLeaseEpoch: 1,
    canonicalFreezeIdentity: freeze,
    canonicalFreezeIdentityUtf8Base64: freezeBytes.toString("base64"),
    canonicalFreezeIdentitySha256: releaseSha256V2(freezeBytes),
    materializedAt: input.evaluatedAt
  };
  let receiptBytes = canonicalBytesV2(receipt);
  let prepared = validatePreparedReleaseFreezeMaterializationV2({
    version: "prepared-release-freeze-materialization-v2",
    commandId: "release_freeze_materialize",
    redactedTemplateSha256: materializerTemplateSha256,
    protectedRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    task0BPreflightEvidenceSha256: preflightSha256,
    candidateSha: freeze.candidateSha,
    runtimeIdentitySha256,
    bootstrapLeaseSha256: releaseSha256V2(bootstrapLeaseBytes),
    bootstrapLeaseEpoch: 1,
    canonicalFreezeIdentity: freeze,
    canonicalFreezeIdentityUtf8Base64: freezeBytes.toString("base64"),
    canonicalFreezeIdentitySha256: releaseSha256V2(freezeBytes),
    canonicalFreezeIdentityRelativePath: FREEZE_FILE,
    canonicalMaterializationReceipt: receipt,
    canonicalMaterializationReceiptUtf8Base64: receiptBytes.toString("base64"),
    canonicalMaterializationReceiptSha256: releaseSha256V2(receiptBytes),
    canonicalMaterializationReceiptRelativePath: FREEZE_RECEIPT_FILE,
    preparedAt: input.evaluatedAt
  });
  let preparedBytes = canonicalBytesV2(prepared);
  const preparedPath = safeArtifactPath(root, FREEZE_PREPARED_FILE);
  if (existsSync(preparedPath)) {
    const stored = validatePreparedReleaseFreezeMaterializationV2(readJson(preparedPath));
    if (canonicalReleaseJsonV2(stored.canonicalFreezeIdentity) !== canonicalReleaseJsonV2(freeze)
        || stored.task0BPreflightEvidenceSha256 !== preflightSha256) {
      throw new Error("prepared_freeze_identity_conflict");
    }
    prepared = stored;
    preparedBytes = readFileSync(preparedPath);
    freezeBytes = Buffer.from(stored.canonicalFreezeIdentityUtf8Base64, "base64");
    receipt = validateReleaseFreezeMaterializationReceiptV2(stored.canonicalMaterializationReceipt);
    receiptBytes = Buffer.from(stored.canonicalMaterializationReceiptUtf8Base64, "base64");
    if (!freezeBytes.equals(canonicalBytesV2(freeze))
        || !receiptBytes.equals(canonicalBytesV2(receipt))
        || releaseSha256V2(receiptBytes) !== stored.canonicalMaterializationReceiptSha256) {
      throw new Error("prepared_freeze_bytes_invalid");
    }
  }
  if (existsSync(safeArtifactPath(root, FREEZE_FILE)) && existsSync(safeArtifactPath(root, FREEZE_RECEIPT_FILE))) {
    if (!readFileSync(safeArtifactPath(root, FREEZE_FILE)).equals(freezeBytes)
        || !readFileSync(safeArtifactPath(root, FREEZE_RECEIPT_FILE)).equals(receiptBytes)) {
      throw new Error("freeze_replay_conflict");
    }
    releaseCompletedReplayLeaseIfOwned(root, bootstrapPayload);
    return { freezeIdentity: freeze, receipt };
  }

  if (existsSync(safeArtifactPath(root, BOOTSTRAP_SEALED_FILE))) throw new Error("bootstrap_root_sealed_new_root_required");
  if (input.recoverDeadOwner) throw new Error("explicit_manifest_lease_takeover_required");
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
    "previousAttestationSha256", "priorTerminalLineageSha256", "issuedAt", "expiresAt"
  ] as const) if (actual[key] !== expected[key]) throw new Error(`operational_attestation_${key}_swapped`);
}

function authorityHash(authority: OperationalAttestationV2): string {
  return releaseSha256V2(canonicalBytesV2(authority));
}

const ISSUER_TEMPLATE_SHA256 = releaseSha256V2("operational_authority_issue:v2");
const TERMINALIZER_TEMPLATE_SHA256 = releaseSha256V2("operational_authority_terminalize:v2");

function exactRecordKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label}_keys_invalid`);
  }
}

function exactAuthorityRelativePath(
  kind: "prepared" | "attestation" | "receipt" | "committed" | "terminal_prepared" | "terminal_receipt",
  authority: OperationalAttestationV2,
  suffixSha256: string
): string {
  const root = ({
    prepared: "operational-attestation-issuance-prepared",
    attestation: "operational-attestations",
    receipt: "operational-attestation-issuer-receipts",
    committed: "operational-attestation-issuance-committed",
    terminal_prepared: "authority-terminal-prepared",
    terminal_receipt: "authority-terminal-receipts"
  } as const)[kind];
  return `${root}/${authority.action}/${authority.generationId}/${suffixSha256}.json`;
}

type CommittedAuthorityRecordV2 = {
  authority: OperationalAttestationV2;
  attestationSha256: string;
  issuerReceipt: Record<string, unknown>;
  issuerReceiptSha256: string;
  committed: Record<string, unknown>;
};

function committedAuthorityRecordsV2(
  root: string,
  freeze: ReleaseFreezeIdentityV2
): CommittedAuthorityRecordV2[] {
  const records: CommittedAuthorityRecordV2[] = [];
  for (const action of [
    "pre_manual", "readiness", "g12_backup_passed", "g13_migration_passed",
    "g14_rollout_passed", "g15_canary_released", "production_failed", "rollback_rolled_back"
  ] as const) {
    const probeAuthority = { action, generationId: freeze.releaseGenerationId } as OperationalAttestationV2;
    let directory: string;
    try {
      directory = dirname(lifecyclePath(root,
        exactAuthorityRelativePath("committed", probeAuthority, "0".repeat(64))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT"
          || (error as Error).message === "artifact_parent_missing") continue;
      throw error;
    }
    for (const filename of readdirSync(directory).sort()) {
      if (!/^[0-9a-f]{64}\.json$/u.test(filename)) throw new Error("authority_committed_filename_invalid");
      const issuerReceiptSha256 = filename.slice(0, 64);
      const committedPath = lifecyclePath(root,
        exactAuthorityRelativePath("committed", probeAuthority, issuerReceiptSha256));
      const committed = validateCommittedOperationalAttestationIssuanceV2(readJson(committedPath));
      if (committed.version !== "committed-operational-attestation-issuance-v2"
          || committed.commandId !== "operational_authority_issue"
          || committed.redactedTemplateSha256 !== ISSUER_TEMPLATE_SHA256
          || committed.action !== action
          || committed.generationId !== freeze.releaseGenerationId
          || committed.issuerReceiptSha256 !== issuerReceiptSha256) {
        throw new Error("authority_committed_invalid");
      }
      const receiptPath = lifecyclePath(root,
        exactAuthorityRelativePath("receipt", probeAuthority, issuerReceiptSha256));
      const receiptBytes = readFileSync(receiptPath);
      if (releaseSha256V2(receiptBytes) !== issuerReceiptSha256) throw new Error("authority_receipt_hash_invalid");
      const issuerReceipt = validateOperationalAttestationIssuerReceiptV2(
        JSON.parse(receiptBytes.toString("utf8")));
      const attestationSha256 = String(issuerReceipt.attestationSha256 ?? "");
      if (issuerReceipt.version !== "operational-attestation-issuer-receipt-v2"
          || issuerReceipt.commandId !== "operational_authority_issue"
          || issuerReceipt.redactedTemplateSha256 !== ISSUER_TEMPLATE_SHA256
          || issuerReceipt.action !== action
          || issuerReceipt.generationId !== freeze.releaseGenerationId
          || !/^[0-9a-f]{64}$/u.test(attestationSha256)
          || issuerReceipt.attestationRelativePath
            !== exactAuthorityRelativePath("attestation", probeAuthority, attestationSha256)) {
        throw new Error("authority_issuer_receipt_invalid");
      }
      const attestationPath = lifecyclePath(root, String(issuerReceipt.attestationRelativePath));
      const attestationBytes = readFileSync(attestationPath);
      if (releaseSha256V2(attestationBytes) !== attestationSha256) throw new Error("authority_chain_bytes_invalid");
      const authority = validateOperationalAttestationV2(JSON.parse(attestationBytes.toString("utf8")), freeze);
      if (authorityHash(authority) !== attestationSha256
          || authority.previousAttestationSha256 !== issuerReceipt.previousAttestationSha256
          || authority.priorTerminalLineageSha256 !== issuerReceipt.priorTerminalLineageSha256) {
        throw new Error("authority_chain_binding_invalid");
      }
      records.push({ authority, attestationSha256, issuerReceipt, issuerReceiptSha256, committed });
    }
  }
  records.sort((left, right) => left.authority.action.localeCompare(right.authority.action)
    || Number(left.issuerReceipt.sequence) - Number(right.issuerReceipt.sequence));
  for (const action of new Set(records.map((record) => record.authority.action))) {
    const chain = records.filter((record) => record.authority.action === action);
    chain.forEach((record, index) => {
      if (record.issuerReceipt.sequence !== index + 1
          || record.issuerReceipt.previousIssuerReceiptSha256 !== (index === 0 ? null : chain[index - 1]!.issuerReceiptSha256)
          || record.authority.previousAttestationSha256 !== (index === 0 ? null : chain[index - 1]!.attestationSha256)) {
        throw new Error("authority_chain_not_linear");
      }
    });
  }
  return records;
}

function exactTerminalReceiptV2(
  root: string,
  previous: CommittedAuthorityRecordV2,
  terminalReceiptSha256: string
): Record<string, unknown> {
  const path = lifecyclePath(root,
    exactAuthorityRelativePath("terminal_receipt", previous.authority, terminalReceiptSha256));
  const bytes = readFileSync(path);
  if (releaseSha256V2(bytes) !== terminalReceiptSha256) throw new Error("terminal_lineage_hash_invalid");
  const receipt = validateAuthorityTerminalReceiptV2(JSON.parse(bytes.toString("utf8")));
  if (receipt.version !== "authority-terminal-receipt-v2"
      || receipt.commandId !== "operational_authority_terminalize"
      || receipt.redactedTemplateSha256 !== TERMINALIZER_TEMPLATE_SHA256
      || receipt.attestationSha256 !== previous.attestationSha256
      || receipt.issuerReceiptSha256 !== previous.issuerReceiptSha256
      || receipt.reason !== "expired_unclaimed"
      || receipt.externalEffectCount !== 0) {
    throw new Error("terminal_lineage_unverified");
  }
  return receipt;
}

function authorityUseArtifactPresentV2(root: string): boolean {
  return readdirSync(root, { recursive: true, withFileTypes: true }).some((entry) => {
    if (!entry.isFile()) return false;
    const parent = "parentPath" in entry ? String(entry.parentPath) : "";
    const relative = `${parent.replace(root, "").replace(/^[\\/]+/u, "").replace(/\\/gu, "/")}${parent ? "/" : ""}${entry.name}`;
    return relative.split("/").some((segment) => segment.startsWith("production-"));
  });
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
  const manifestPath = safeArtifactPath(root, MANIFEST_FILE);
  if (!existsSync(manifestPath)) throw new Error("operational_authority_manifest_missing");
  const currentManifestBytes = readFileSync(manifestPath);
  const currentManifest = validateRemediationReleaseManifestV2(JSON.parse(currentManifestBytes.toString("utf8")));
  if (!currentManifestBytes.equals(canonicalBytesV2(currentManifest))) {
    throw new Error("operational_authority_manifest_bytes_noncanonical");
  }
  const policy = OPERATIONAL_ATTESTATION_POLICY_V2[
    authority.action as keyof typeof OPERATIONAL_ATTESTATION_POLICY_V2
  ];
  if (!policy || authority.sourceManifestSha256 !== releaseSha256V2(currentManifestBytes)
      || authority.commandId !== policy.commandId
      || authority.redactedTemplateSha256
        !== operationalAttestationTemplateSha256V2(authority.action as keyof typeof OPERATIONAL_ATTESTATION_POLICY_V2)) {
    throw new Error("operational_authority_policy_binding_invalid");
  }
  const records = committedAuthorityRecordsV2(root, freeze);
  const actionRecords = records.filter((record) => record.authority.action === authority.action);
  const bytes = canonicalBytesV2(authority);
  const hash = releaseSha256V2(bytes);
  const alreadyCommitted = records.filter((record) => record.attestationSha256 === hash);
  if (alreadyCommitted.length > 1) throw new Error("authority_replay_ambiguous");
  if (alreadyCommitted.length === 1) {
    if (!readFileSync(lifecyclePath(root,
      exactAuthorityRelativePath("attestation", authority, hash))).equals(bytes)) {
      throw new Error("authority_replay_conflict");
    }
    return { ...authority, attestationSha256: hash };
  }
  if (authority.priorTerminalLineageSha256 === null) {
    if (input.priorTerminalReceipt !== undefined) throw new Error("unexpected_terminal_lineage");
  } else {
    if (authority.previousAttestationSha256 === null
        || input.priorTerminalReceipt?.sha256 !== authority.priorTerminalLineageSha256) {
      throw new Error("terminal_lineage_unverified");
    }
    const previous = actionRecords.find((record) => record.attestationSha256 === authority.previousAttestationSha256);
    if (!previous) throw new Error("terminal_lineage_unverified");
    exactTerminalReceiptV2(root, previous, authority.priorTerminalLineageSha256);
  }
  const operationKey = releaseSha256V2(canonicalReleaseJsonV2([
    "operational_authority_issue", authority.action, authority.generationId, hash
  ]));
  const leasePayload = ownerPayload({ evaluatedAt: authority.issuedAt }, "operational_authority_issue",
    root, freeze, operationKey);
  if (authority.previousAttestationSha256 === null) {
    if (actionRecords.length !== 0) throw new Error("authority_chain_previous_required");
  } else {
    const previous = actionRecords.filter((item) => item.attestationSha256 === authority.previousAttestationSha256);
    if (previous.length !== 1 || actionRecords.at(-1)?.attestationSha256 !== authority.previousAttestationSha256) {
      throw new Error("authority_chain_branch_or_gap");
    }
    if (authority.priorTerminalLineageSha256 === null) {
      const consumptionPath = safeArtifactPath(root,
        `operational-attestation-consumption-${authority.previousAttestationSha256}.json`);
      if (!existsSync(consumptionPath)) throw new Error("previous_authority_not_consumed_or_terminal");
      const consumption = readJson(consumptionPath) as Record<string, unknown>;
      if (consumption.version !== "operational-attestation-consumption-v2"
          || consumption.attestationSha256 !== authority.previousAttestationSha256
          || consumption.generationId !== authority.generationId
          || consumption.candidateSha !== authority.candidateSha) {
        throw new Error("previous_authority_consumption_invalid");
      }
    }
  }
  const receipt = validateOperationalAttestationIssuerReceiptV2({
    version: "operational-attestation-issuer-receipt-v2",
    commandId: "operational_authority_issue", redactedTemplateSha256: ISSUER_TEMPLATE_SHA256,
    action: authority.action, generationId: authority.generationId, sequence: actionRecords.length + 1,
    previousIssuerReceiptSha256: actionRecords.at(-1)?.issuerReceiptSha256 ?? null,
    attestationRelativePath: exactAuthorityRelativePath("attestation", authority, hash),
    attestationSha256: hash, previousAttestationSha256: authority.previousAttestationSha256,
    priorTerminalLineageSha256: authority.priorTerminalLineageSha256, issuedAt: authority.issuedAt
  });
  const receiptBytes = canonicalBytesV2(receipt);
  const issuerReceiptSha256 = releaseSha256V2(receiptBytes);
  const authorityName = exactAuthorityRelativePath("attestation", authority, hash);
  const receiptName = exactAuthorityRelativePath("receipt", authority, issuerReceiptSha256);
  const preparedName = exactAuthorityRelativePath("prepared", authority, issuerReceiptSha256);
  const markerName = exactAuthorityRelativePath("committed", authority, issuerReceiptSha256);
  const marker = {
    version: "committed-operational-attestation-issuance-v2",
    commandId: "operational_authority_issue", redactedTemplateSha256: ISSUER_TEMPLATE_SHA256,
    action: authority.action, generationId: authority.generationId,
    issuanceIntentSha256: releaseSha256V2(canonicalReleaseJsonV2([
      authority.action, authority.generationId, hash, issuerReceiptSha256
    ])),
    attestationSha256: hash, issuerReceiptSha256, committedAt: authority.issuedAt
  };
  const markerBytes = canonicalBytesV2(marker);
  const prepared = validatePreparedOperationalAttestationIssuanceV2({
    version: "prepared-operational-attestation-issuance-v2",
    commandId: "operational_authority_issue", redactedTemplateSha256: ISSUER_TEMPLATE_SHA256,
    action: authority.action, generationId: authority.generationId, sequence: receipt.sequence,
    previousIssuerReceiptSha256: receipt.previousIssuerReceiptSha256,
    canonicalAttestation: authority, canonicalAttestationUtf8Base64: bytes.toString("base64"),
    canonicalAttestationSha256: hash, canonicalAttestationRelativePath: authorityName,
    canonicalIssuerReceipt: receipt, canonicalIssuerReceiptUtf8Base64: receiptBytes.toString("base64"),
    canonicalIssuerReceiptSha256: issuerReceiptSha256, canonicalIssuerReceiptRelativePath: receiptName,
    canonicalCommittedIssuance: marker, canonicalCommittedIssuanceUtf8Base64: markerBytes.toString("base64"),
    canonicalCommittedIssuanceSha256: releaseSha256V2(markerBytes),
    canonicalCommittedIssuanceRelativePath: markerName,
    previousAttestationSha256: authority.previousAttestationSha256,
    priorTerminalLineageSha256: authority.priorTerminalLineageSha256,
    preparedAt: authority.issuedAt
  });
  const preparedBytes = canonicalBytesV2(prepared);
  const lease = acquireOrResumeFrozenLease(root, leasePayload,
    lifecycleArtifactExists(root, preparedName));
  try {
    const lockedActionRecords = committedAuthorityRecordsV2(root, freeze)
      .filter((record) => record.authority.action === authority.action);
    if (lockedActionRecords.length !== actionRecords.length
        || lockedActionRecords.at(-1)?.issuerReceiptSha256 !== actionRecords.at(-1)?.issuerReceiptSha256) {
      throw new Error("authority_chain_changed_before_prepare");
    }
    exactReplayOrConflict(root, preparedName, preparedBytes);
    injectedFault(input.faultAt, "after_prepare");
    lease.assertOwned(); exactReplayOrConflict(root, authorityName, bytes);
    injectedFault(input.faultAt, "after_attestation");
    exactReplayOrConflict(root, receiptName, receiptBytes);
    injectedFault(input.faultAt, "after_receipt");
    exactReplayOrConflict(root, markerName, markerBytes);
    lease.release();
    return { ...authority, attestationSha256: hash, previousAttestationSha256: authority.previousAttestationSha256 };
  } catch (error) {
    if (!lifecycleArtifactExists(root, preparedName) && existsSync(lease.path)) lease.release();
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

function terminalReceiptHashesForAuthorityV2(
  root: string,
  record: CommittedAuthorityRecordV2
): string[] {
  let directory: string;
  try {
    directory = dirname(lifecyclePath(root,
      exactAuthorityRelativePath("terminal_receipt", record.authority, "0".repeat(64))));
  } catch (error) {
    if ((error as Error).message === "artifact_parent_missing"
        || (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return readdirSync(directory).filter((name) => /^[0-9a-f]{64}\.json$/u.test(name))
    .map((name) => name.slice(0, 64))
    .filter((hash) => {
      const receipt = exactTerminalReceiptV2(root, record, hash);
      return receipt.attestationSha256 === record.attestationSha256;
    });
}

export function selectOperationalAttestationFromStoreV2(input: {
  artifactRoot: string;
  action: keyof typeof OPERATIONAL_ATTESTATION_POLICY_V2;
  expectedSourceManifestSha256: string;
  evaluatedAt: string;
  minimumRemainingValidityMs: number;
}) {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  const freeze = currentFreeze(root);
  if (!Number.isSafeInteger(input.minimumRemainingValidityMs) || input.minimumRemainingValidityMs < 0) {
    throw new Error("authority_minimum_validity_invalid");
  }
  const manifestBytes = readFileSync(safeArtifactPath(root, MANIFEST_FILE));
  const manifest = validateRemediationReleaseManifestV2(JSON.parse(manifestBytes.toString("utf8")));
  if (!manifestBytes.equals(canonicalBytesV2(manifest))
      || releaseSha256V2(manifestBytes) !== input.expectedSourceManifestSha256) {
    throw new Error("authority_selector_source_invalid");
  }
  const policy = OPERATIONAL_ATTESTATION_POLICY_V2[input.action];
  const candidates = committedAuthorityRecordsV2(root, freeze)
    .filter((record) => record.authority.action === input.action)
    .filter((record) => {
      const consumptionPath = safeArtifactPath(root,
        `operational-attestation-consumption-${record.attestationSha256}.json`);
      if (existsSync(consumptionPath) || terminalReceiptHashesForAuthorityV2(root, record).length !== 0) return false;
      const authority = record.authority;
      return authority.sourceManifestSha256 === input.expectedSourceManifestSha256
        && authority.commandId === policy.commandId
        && authority.redactedTemplateSha256 === operationalAttestationTemplateSha256V2(input.action)
        && Date.parse(authority.issuedAt) <= Date.parse(input.evaluatedAt)
        && Date.parse(input.evaluatedAt) < Date.parse(authority.expiresAt)
        && Date.parse(authority.expiresAt) - Date.parse(input.evaluatedAt) >= input.minimumRemainingValidityMs;
    });
  if (candidates.length !== 1) throw new Error("operational_authority_tip_ambiguous");
  const selected = candidates[0]!;
  const actionChain = committedAuthorityRecordsV2(root, freeze)
    .filter((record) => record.authority.action === input.action);
  if (actionChain.at(-1)?.attestationSha256 !== selected.attestationSha256) {
    throw new Error("operational_authority_not_chain_tip");
  }
  return {
    authority: selected.authority,
    attestationSha256: selected.attestationSha256,
    issuerReceiptSha256: selected.issuerReceiptSha256
  };
}

export async function terminalizeExpiredOperationalAttestationV2(input: {
  artifactRoot: string;
  authority: unknown;
  evaluatedAt: string;
  observedArtifacts?: string[];
}) {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  const freeze = currentFreeze(root);
  const authority = validateOperationalAttestationV2(input.authority, freeze);
  if (Date.parse(input.evaluatedAt) < Date.parse(authority.expiresAt)) throw new Error("authority_not_expired");
  if (input.observedArtifacts !== undefined && input.observedArtifacts.length !== 0) {
    throw new Error("caller_supplied_authority_observation_forbidden");
  }
  const hash = authorityHash(authority);
  const records = committedAuthorityRecordsV2(root, freeze);
  const record = records.find((item) => item.attestationSha256 === hash);
  if (!record || !readFileSync(lifecyclePath(root,
    exactAuthorityRelativePath("attestation", authority, hash))).equals(canonicalBytesV2(authority))) {
    throw new Error("authority_not_issued");
  }
  let receipt = validateAuthorityTerminalReceiptV2({
    version: "authority-terminal-receipt-v2",
    commandId: "operational_authority_terminalize",
    redactedTemplateSha256: TERMINALIZER_TEMPLATE_SHA256,
    action: authority.action,
    generationId: authority.generationId, candidateSha: authority.candidateSha,
    releaseFreezeIdentitySha256: authority.releaseFreezeIdentitySha256,
    sourceManifestSha256: authority.sourceManifestSha256,
    artifactRootFingerprintSha256: authority.artifactRootFingerprintSha256,
    attestationSha256: hash, issuerReceiptSha256: record.issuerReceiptSha256,
    previousIssuerReceiptSha256: record.issuerReceipt.previousIssuerReceiptSha256,
    reason: "expired_unclaimed", preclaimAbsent: true, claimAbsent: true,
    consumptionAbsent: true, actionLeaseAbsent: true, g13BoundSessionAbsent: true,
    g13AdvisoryLockAbsent: true, operationAbsent: true, externalEffectCount: 0,
    terminalizedAt: input.evaluatedAt
  });
  const operationKey = releaseSha256V2(canonicalReleaseJsonV2([
    "operational_authority_terminalize", authority.action, authority.generationId, hash
  ]));
  const preparedName = exactAuthorityRelativePath("terminal_prepared", authority, hash);
  let receiptBytes = canonicalBytesV2(receipt);
  let terminalReceiptSha256 = releaseSha256V2(receiptBytes);
  let receiptName = exactAuthorityRelativePath("terminal_receipt", authority, terminalReceiptSha256);
  let preparedObject = validatePreparedAuthorityTerminalV2({
      version: "prepared-authority-terminal-v2",
      commandId: "operational_authority_terminalize",
      redactedTemplateSha256: TERMINALIZER_TEMPLATE_SHA256,
      canonicalTerminalReceipt: receipt,
      canonicalTerminalReceiptUtf8Base64: receiptBytes.toString("base64"),
      canonicalTerminalReceiptSha256: terminalReceiptSha256,
      canonicalTerminalReceiptRelativePath: receiptName,
      preparedAt: input.evaluatedAt
    });
  let prepared = canonicalBytesV2(preparedObject);
  if (lifecycleArtifactExists(root, preparedName)) {
    prepared = readFileSync(lifecyclePath(root, preparedName));
    preparedObject = validatePreparedAuthorityTerminalV2(JSON.parse(prepared.toString("utf8")));
    receipt = preparedObject.canonicalTerminalReceipt;
    receiptBytes = Buffer.from(preparedObject.canonicalTerminalReceiptUtf8Base64, "base64");
    terminalReceiptSha256 = preparedObject.canonicalTerminalReceiptSha256;
    receiptName = preparedObject.canonicalTerminalReceiptRelativePath;
    if (receipt.attestationSha256 !== hash || receipt.issuerReceiptSha256 !== record.issuerReceiptSha256) {
      throw new Error("prepared_authority_terminal_conflict");
    }
  }
  const leasePayload = ownerPayload({ evaluatedAt: input.evaluatedAt }, "operational_authority_terminalize",
    root, freeze, operationKey);
  const lease = acquireOrResumeFrozenLease(root, leasePayload,
    lifecycleArtifactExists(root, preparedName));
  try {
    if (authorityUseArtifactPresentV2(root)) {
      throw new Error("authority_has_effect_or_claim_artifact");
    }
    exactReplayOrConflict(root, preparedName, prepared);
    lease.assertOwned();
    if (authorityUseArtifactPresentV2(root)) {
      throw new Error("authority_has_effect_or_claim_artifact");
    }
    exactReplayOrConflict(root, receiptName, receiptBytes);
    lease.release();
    return receipt;
  } catch (error) {
    if (!lifecycleArtifactExists(root, preparedName) && existsSync(lease.path)) lease.release();
    throw error;
  }
}

export function normalizeTrustedPrincipalPolicyV2(input: { platform: string; principals: string[] }) {
  if (!new Set(["windows", "posix"]).has(input.platform) || !Array.isArray(input.principals)) {
    throw new Error("trusted_principal_policy_unsupported");
  }
  const normalized = [...new Set(input.principals.map((value) => value.trim().toLowerCase()))].sort();
  if (normalized.length === 0 || normalized.some((value) => !value
      || value === "everyone" || value === "builtin\\users" || value.includes("foreign"))) {
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
  trustedPrincipals?: string[];
}) {
  const allowed = process.platform === "win32"
    ? new Set(["windows-service-localsystem-administrators-v1", "windows-configured-canonical-set-v1"])
    : new Set(["posix-owner-only-v1"]);
  if (!allowed.has(input.principalPolicyId)) {
    throw new Error("artifact_root_trust_rejected");
  }
  const root = process.platform === "win32"
    ? assertSafeArtifactRootPath(input.artifactRoot, {
      windowsAcl: { allowlistedPrincipals: input.trustedPrincipals ?? [] }
    })
    : assertSafeArtifactRootPath(input.artifactRoot);
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
  const targetSnapshotRelativePath = `manifest-snapshots/release-manifest-r${target.revision}-${releaseSha256V2(targetBytes)}.json`;
  const prepared = {
    version: "prepared-manifest-transition-v2", transitionId: input.transition.transitionId,
    transitionKeySha256, generationId: freeze.releaseGenerationId,
    sourceManifestSha256: sourceSha, previousReceiptSha256: source.latestCommittedReceiptSha256,
    targetRevision: target.revision, gateOutputSha256s,
    targetSnapshotRelativePath,
    targetSnapshotSha256: releaseSha256V2(targetBytes),
    canonicalCommittedReceipt: receipt,
    canonicalCommittedReceiptUtf8Base64: receiptBytes.toString("base64"),
    committedReceiptSha256, preparedAt: evaluatedAt
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
  const prepared = validatePreparedManifestTransitionV2(JSON.parse(preparedBytes.toString("utf8")));
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
  const receipt = validateCommittedManifestTransitionReceiptV2(JSON.parse(receiptBytes.toString("utf8")));
  const snapshotPath = lifecyclePath(root, prepared.targetSnapshotRelativePath);
  if (!existsSync(snapshotPath)) throw new Error("prepared_transition_snapshot_missing");
  const targetBytes = readFileSync(snapshotPath);
  const target = validateRemediationReleaseManifestV2(JSON.parse(targetBytes.toString("utf8")));
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
  validateManifestCommittedReceiptBindingV2(target, receipt, source);
  if (!readFileSync(snapshotPath).equals(canonicalBytesV2(target))) {
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
      || releaseFreezeIdentitySha256V2(freeze) !== source.releaseFreezeIdentitySha256) {
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
  const leasePayload = ownerPayload({ evaluatedAt: input.evaluatedAt ?? input.transition.evaluatedAt },
    "manifest_transition", root, freeze, transitionKey, transitionKey);

  if (existsSync(preparedPath)) {
    const built = loadPreparedManifestResult(root, preparedPath, source, freeze, transitionKey, input);
    const receiptName = `manifest-transition-receipt-${String(built.prepared.committedReceiptSha256)}.json`;
    const completedReceiptPath = safeArtifactPath(root, receiptName);
    if (existsSync(manifestPath) && existsSync(completedReceiptPath)
        && currentManifestShaBeforeClaim === releaseSha256V2(built.targetBytes)
        && readFileSync(completedReceiptPath).equals(built.receiptBytes)) {
      releaseCompletedReplayLeaseIfOwned(root, leasePayload);
      return { manifest: built.target, receipt: built.receipt };
    }
  }
  if (currentManifestShaBeforeClaim !== sourceShaForKey
      && !existsSync(preparedPath)) throw new Error("manifest_source_cas_conflict");

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
        claimedAt: built.prepared.preparedAt,
        expiresAt: new Date(Date.parse(String(built.prepared.preparedAt)) + 120_000).toISOString(),
        claimantPid: process.pid,
        claimantProcessStartFingerprintSha256: releaseSha256V2(`process:${process.pid}`)
      });
    }
    exactReplayOrConflict(root, String(built.prepared.targetSnapshotRelativePath), built.targetBytes);
    exactReplayOrConflict(root, preparedName, built.preparedBytes);
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
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  const freeze = currentFreeze(root);
  if (freeze.releaseGenerationId !== input.expectedGenerationId) throw new Error("release_generation_mismatch");
  if (existsSync(safeArtifactPath(root, ROOT_SEALED_FILE))) throw new Error("release_root_sealed");
  const manifestPath = safeArtifactPath(root, MANIFEST_FILE);
  const leasePath = safeArtifactPath(root, ROOT_WRITER_LEASE_FILE);
  let leaseState: "absent" | "live" | "expired" = "absent";
  if (existsSync(leasePath)) {
    const lease = validateReleaseRootWriterLeaseV2(readJson(leasePath));
    if (lease.version !== "frozen-root-writer-lease-v2"
        || lease.releaseGenerationId !== freeze.releaseGenerationId
        || lease.candidateSha !== freeze.candidateSha
        || lease.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze)
        || lease.protectedRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256) {
      throw new Error("recovery_root_lease_binding_invalid");
    }
    leaseState = Date.parse(input.evaluatedAt) < Date.parse(lease.expiresAt) ? "live" : "expired";
  }
  if (!existsSync(manifestPath)) {
    if (readdirSync(root).some((name) => name.startsWith("manifest-transition-claim-")
        || name.startsWith("manifest-transition-prepared-")
        || name.startsWith("manifest-transition-receipt-"))) {
      throw new Error("recovery_manifest_missing_with_transition_artifacts");
    }
    return {
      generationId: freeze.releaseGenerationId, evaluatedAt: input.evaluatedAt,
      manifestRevision: null, receiptCount: 0, leaseState
    };
  }
  const manifestBytes = readFileSync(manifestPath);
  let manifest = validateRemediationReleaseManifestV2(JSON.parse(manifestBytes.toString("utf8")));
  if (!manifestBytes.equals(canonicalBytesV2(manifest))
      || manifest.candidateSha !== freeze.candidateSha
      || manifest.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || manifest.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze)) {
    throw new Error("recovery_manifest_binding_invalid");
  }
  const latestRevision = manifest.revision;
  let receiptCount = 0;
  while (true) {
    const receiptPath = safeArtifactPath(root,
      `manifest-transition-receipt-${manifest.latestCommittedReceiptSha256}.json`);
    const receiptBytes = readFileSync(receiptPath);
    if (releaseSha256V2(receiptBytes) !== manifest.latestCommittedReceiptSha256) {
      throw new Error("recovery_receipt_hash_invalid");
    }
    const receipt = validateCommittedManifestTransitionReceiptV2(JSON.parse(receiptBytes.toString("utf8")));
    const preparedPath = safeArtifactPath(root,
      `manifest-transition-prepared-${receipt.transitionKeySha256}.json`);
    const prepared = validatePreparedManifestTransitionV2(readJson(preparedPath));
    if (prepared.committedReceiptSha256 !== manifest.latestCommittedReceiptSha256
        || !readFileSync(preparedPath).equals(canonicalBytesV2(prepared))) {
      throw new Error("recovery_prepared_binding_invalid");
    }
    const claim = validateManifestTransitionClaimV2(readJson(safeArtifactPath(root,
      `manifest-transition-claim-${receipt.transitionKeySha256}.json`)));
    if (claim.transitionId !== receipt.transitionId
        || claim.generationId !== freeze.releaseGenerationId
        || claim.sourceManifestSha256 !== receipt.sourceManifestSha256) {
      throw new Error("recovery_claim_binding_invalid");
    }
    let source: RemediationReleaseManifestV2 | undefined;
    if (manifest.revision > 1) {
      const sourceRelativePath = `manifest-snapshots/release-manifest-r${manifest.revision - 1}-${manifest.previousManifestSha256}.json`;
      const sourcePath = lifecyclePath(root, sourceRelativePath);
      const sourceBytes = readFileSync(sourcePath);
      if (releaseSha256V2(sourceBytes) !== manifest.previousManifestSha256) {
        throw new Error("recovery_source_snapshot_hash_invalid");
      }
      source = validateRemediationReleaseManifestV2(JSON.parse(sourceBytes.toString("utf8")));
      if (!sourceBytes.equals(canonicalBytesV2(source))) throw new Error("recovery_source_snapshot_noncanonical");
    }
    validateManifestCommittedReceiptBindingV2(manifest, receipt, source);
    receiptCount += 1;
    if (!source) break;
    manifest = source;
  }
  return {
    generationId: freeze.releaseGenerationId, evaluatedAt: input.evaluatedAt,
    manifestRevision: latestRevision, receiptCount, leaseState
  };
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
  const freezeSha256 = releaseFreezeIdentitySha256V2(freeze);
  if (oldLease.releaseGenerationId !== freeze.releaseGenerationId
      || oldLease.candidateSha !== freeze.candidateSha
      || oldLease.protectedRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || oldLease.releaseFreezeIdentitySha256 !== freezeSha256) {
    throw new Error("old_lease_freeze_binding_mismatch");
  }
  if (Date.parse(input.evaluatedAt) < Date.parse(oldLease.expiresAt)) throw new Error("root_writer_lease_not_expired");
  if (isProcessAlive(oldLease.ownerPid)) throw new Error("root_writer_owner_still_alive");
  const operationPrepared = hasExactPreparedOperationForLease(input.root, oldLease);

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
  const existingTakeoverReceipts = readdirSync(input.root)
    .filter((name) => name.startsWith("manifest-transition-root.frozen-takeover-receipt-"))
    .map((name) => ({ name, receipt: readJson(safeArtifactPath(input.root, name)) as Record<string, unknown> }))
    .filter(({ receipt }) => receipt.oldLeaseSha256 === oldHash);
  if (existingTakeoverReceipts.length > 1) throw new Error("frozen_takeover_receipt_ambiguous");
  if (existingTakeoverReceipts.length === 1) {
    const leasePath = safeArtifactPath(input.root, ROOT_WRITER_LEASE_FILE);
    if (existsSync(leasePath) && !readFileSync(leasePath).equals(newBytes)) throw new Error("new_lease_conflict");
    if (!existsSync(leasePath) && operationPrepared
        && !preparedOperationCommittedForLeaseV2(input.root, oldLease)) {
      const manifestPath = safeArtifactPath(input.root, MANIFEST_FILE);
      const lastTrustedManifestSha256 = existsSync(manifestPath)
        ? releaseSha256V2(readFileSync(manifestPath)) : null;
      exactReplayOrConflict(input.root, ROOT_SEALED_FILE, canonicalBytesV2({
        version: "release-root-terminal-abandoned-v2",
        releaseGenerationId: freeze.releaseGenerationId,
        candidateSha: freeze.candidateSha,
        releaseFreezeIdentitySha256: freezeSha256,
        failedTransitionId: oldLease.writerOperationKind === "manifest_transition"
          ? (validatePreparedManifestTransitionV2(readJson(safeArtifactPath(input.root,
            `manifest-transition-prepared-${oldLease.transitionKeySha256}.json`))).transitionId)
          : "production_failed",
        transitionKeySha256: oldLease.transitionKeySha256 ?? oldLease.writerOperationKeySha256,
        terminalReason: "incompatible_durable_state",
        lastTrustedManifestSha256,
        observedAt: input.evaluatedAt
      }));
      return {
        newLease, receipt: existingTakeoverReceipts[0].receipt,
        preparedSha256: releaseSha256V2(preparedBytes), sealed: true
      };
    }
    return {
      newLease,
      receipt: existingTakeoverReceipts[0].receipt,
      preparedSha256: releaseSha256V2(preparedBytes),
      sealed: existsSync(safeArtifactPath(input.root, ROOT_SEALED_FILE))
    };
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
  if (!operationPrepared) {
    const manifestPath = safeArtifactPath(input.root, MANIFEST_FILE);
    const lastTrustedManifest = existsSync(manifestPath)
      ? validateRemediationReleaseManifestV2(readJson(manifestPath)) : null;
    const nextTransition = lastTrustedManifest === null ? "pre_manual"
      : ({
        pre_manual: "readiness",
        readiness: "g12_backup_passed",
        g12_backup_passed: "g13_migration_passed",
        g13_migration_passed: "g14_rollout_passed",
        g14_rollout_passed: "g15_canary_released",
        g15_canary_released: "g15_canary_released",
        production_failed: "rollback_rolled_back",
        rollback_rolled_back: "rollback_rolled_back"
      } as const)[lastTrustedManifest.transitionId];
    exactReplayOrConflict(input.root, ROOT_SEALED_FILE, canonicalBytesV2({
      version: "release-root-terminal-abandoned-v2",
      releaseGenerationId: freeze.releaseGenerationId,
      candidateSha: freeze.candidateSha,
      releaseFreezeIdentitySha256: freezeSha256,
      failedTransitionId: nextTransition,
      transitionKeySha256: oldLease.transitionKeySha256 ?? oldLease.writerOperationKeySha256,
      terminalReason: "terminal_lifecycle_protocol_failure",
      lastTrustedManifestSha256: lastTrustedManifest === null ? null
        : releaseSha256V2(canonicalBytesV2(lastTrustedManifest)),
      observedAt: input.evaluatedAt
    }));
    unlinkDurable(leasePath);
    return { newLease, receipt, preparedSha256: releaseSha256V2(preparedBytes), sealed: true };
  }
  return { newLease, receipt, preparedSha256: releaseSha256V2(preparedBytes), sealed: false };
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
      unlinkDurable(path);
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

function hasExactPreparedOperationForLease(root: string, lease: FrozenRootWriterLeaseV2): boolean {
  if (lease.writerOperationKind === "manifest_transition") {
    return lease.transitionKeySha256 !== null
      && existsSync(safeArtifactPath(root, `manifest-transition-prepared-${lease.transitionKeySha256}.json`));
  }
  const top = lease.writerOperationKind === "operational_authority_issue"
    ? "operational-attestation-issuance-prepared"
    : "authority-terminal-prepared";
  const candidates = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const parentPath = "parentPath" in entry ? String(entry.parentPath) : root;
      return relative(root, `${parentPath}/${entry.name}`).replace(/\\/gu, "/");
    })
    .filter((name) => name.startsWith(`${top}/`));
  const matches = candidates.filter((name) => {
    const prepared = readJson(lifecyclePath(root, name)) as Record<string, unknown>;
    if (lease.writerOperationKind === "operational_authority_issue") {
      exactRecordKeys(prepared, [
        "version", "commandId", "redactedTemplateSha256", "action", "generationId", "sequence",
        "previousIssuerReceiptSha256", "canonicalAttestation", "canonicalAttestationUtf8Base64",
        "canonicalAttestationSha256", "canonicalAttestationRelativePath", "canonicalIssuerReceipt",
        "canonicalIssuerReceiptUtf8Base64", "canonicalIssuerReceiptSha256",
        "canonicalIssuerReceiptRelativePath", "canonicalCommittedIssuance",
        "canonicalCommittedIssuanceUtf8Base64", "canonicalCommittedIssuanceSha256",
        "canonicalCommittedIssuanceRelativePath", "previousAttestationSha256",
        "priorTerminalLineageSha256", "preparedAt"
      ], "prepared_operational_attestation");
      const authority = validateOperationalAttestationV2(prepared.canonicalAttestation);
      const authorityBytes = Buffer.from(String(prepared.canonicalAttestationUtf8Base64), "base64");
      return prepared.version === "prepared-operational-attestation-issuance-v2"
        && prepared.commandId === "operational_authority_issue"
        && prepared.generationId === lease.releaseGenerationId
        && authority.candidateSha === lease.candidateSha
        && authorityBytes.equals(canonicalBytesV2(authority))
        && releaseSha256V2(authorityBytes) === prepared.canonicalAttestationSha256
        && releaseSha256V2(canonicalReleaseJsonV2([
          "operational_authority_issue", authority.action, authority.generationId,
          prepared.canonicalAttestationSha256
        ])) === lease.writerOperationKeySha256;
    }
    exactRecordKeys(prepared, [
      "version", "commandId", "redactedTemplateSha256", "canonicalTerminalReceipt",
      "canonicalTerminalReceiptUtf8Base64", "canonicalTerminalReceiptSha256",
      "canonicalTerminalReceiptRelativePath", "preparedAt"
    ], "prepared_authority_terminal");
    const receipt = prepared.canonicalTerminalReceipt as Record<string, unknown>;
    const receiptBytes = Buffer.from(String(prepared.canonicalTerminalReceiptUtf8Base64), "base64");
    return prepared.version === "prepared-authority-terminal-v2"
      && prepared.commandId === "operational_authority_terminalize"
      && receipt.generationId === lease.releaseGenerationId
      && receipt.candidateSha === lease.candidateSha
      && receiptBytes.equals(canonicalBytesV2(receipt))
      && releaseSha256V2(receiptBytes) === prepared.canonicalTerminalReceiptSha256
      && releaseSha256V2(canonicalReleaseJsonV2([
        "operational_authority_terminalize", receipt.action, receipt.generationId,
        receipt.attestationSha256
      ])) === lease.writerOperationKeySha256;
  });
  if (matches.length > 1) throw new Error("prepared_operation_ambiguous");
  return matches.length === 1;
}

function preparedOperationCommittedForLeaseV2(root: string, lease: FrozenRootWriterLeaseV2): boolean {
  if (lease.writerOperationKind === "manifest_transition") {
    if (lease.transitionKeySha256 === null) return false;
    const preparedPath = safeArtifactPath(root,
      `manifest-transition-prepared-${lease.transitionKeySha256}.json`);
    if (!existsSync(preparedPath)) return false;
    const prepared = validatePreparedManifestTransitionV2(readJson(preparedPath));
    const receiptPath = safeArtifactPath(root,
      `manifest-transition-receipt-${prepared.committedReceiptSha256}.json`);
    const manifestPath = safeArtifactPath(root, MANIFEST_FILE);
    return existsSync(receiptPath) && existsSync(manifestPath)
      && releaseSha256V2(readFileSync(manifestPath)) === prepared.targetSnapshotSha256
      && releaseSha256V2(readFileSync(receiptPath)) === prepared.committedReceiptSha256;
  }
  const top = lease.writerOperationKind === "operational_authority_issue"
    ? "operational-attestation-issuance-prepared" : "authority-terminal-prepared";
  const preparedNames = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const parentPath = "parentPath" in entry ? String(entry.parentPath) : root;
      return relative(root, `${parentPath}/${entry.name}`).replace(/\\/gu, "/");
    }).filter((name) => name.startsWith(`${top}/`));
  const committed = preparedNames.filter((name) => {
    if (lease.writerOperationKind === "operational_authority_issue") {
      const prepared = validatePreparedOperationalAttestationIssuanceV2(readJson(lifecyclePath(root, name)));
      const operationKey = releaseSha256V2(canonicalReleaseJsonV2([
        "operational_authority_issue", prepared.action, prepared.generationId,
        prepared.canonicalAttestationSha256
      ]));
      return operationKey === lease.writerOperationKeySha256
        && lifecycleArtifactExists(root, prepared.canonicalCommittedIssuanceRelativePath);
    }
    const prepared = validatePreparedAuthorityTerminalV2(readJson(lifecyclePath(root, name)));
    const receipt = prepared.canonicalTerminalReceipt;
    const operationKey = releaseSha256V2(canonicalReleaseJsonV2([
      "operational_authority_terminalize", receipt.action, receipt.generationId,
      receipt.attestationSha256
    ]));
    return operationKey === lease.writerOperationKeySha256
      && lifecycleArtifactExists(root, prepared.canonicalTerminalReceiptRelativePath);
  });
  if (committed.length > 1) throw new Error("committed_operation_ambiguous");
  return committed.length === 1;
}

export class ReleaseManifestStoreV2 {
  constructor(readonly artifactRoot: string) {
    assertSafeArtifactRootPath(artifactRoot);
  }
  advance(input: Omit<AdvanceInput, "artifactRoot">) {
    return advanceReleaseManifestV2({ ...input, artifactRoot: this.artifactRoot });
  }
}

function buildInitialManifestResultV2(
  freeze: ReleaseFreezeIdentityV2,
  transitionKeySha256: string,
  evaluatedAt: string,
  verifiedGateOutputs: unknown
) {
  const gateOutputSha256s = verifiedGateOutputHashes(verifiedGateOutputs);
  const provisionalManifest = createInitialRemediationReleaseManifestV2({
    freezeIdentity: freeze, evaluatedAt, latestCommittedReceiptSha256: "0".repeat(64),
    verifiedGateOutputs
  });
  const receipt = {
    version: "committed-manifest-transition-receipt-v2", transitionId: "pre_manual",
    transitionKeySha256, candidateSha: freeze.candidateSha,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
    sourceManifestSha256: null, previousReceiptSha256: null,
    targetManifestProjectionSha256: releaseSha256V2(canonicalReleaseJsonV2(
      manifestProjectionV2(provisionalManifest))),
    sourceRevision: null, targetRevision: 1, gateOutputSha256s,
    transitionEvidence: [], committedAt: evaluatedAt
  };
  const receiptBytes = canonicalBytesV2(receipt);
  const receiptSha256 = releaseSha256V2(receiptBytes);
  const manifest = createInitialRemediationReleaseManifestV2({
    freezeIdentity: freeze, evaluatedAt, latestCommittedReceiptSha256: receiptSha256,
    verifiedGateOutputs
  });
  validateManifestCommittedReceiptBindingV2(manifest, receipt);
  const targetBytes = canonicalBytesV2(manifest);
  const snapshotName = `manifest-snapshots/release-manifest-r1-${releaseSha256V2(targetBytes)}.json`;
  const prepared = {
    version: "prepared-manifest-transition-v2", transitionId: "pre_manual",
    transitionKeySha256, generationId: freeze.releaseGenerationId,
    sourceManifestSha256: null, previousReceiptSha256: null, targetRevision: 1,
    gateOutputSha256s, targetSnapshotRelativePath: snapshotName,
    targetSnapshotSha256: releaseSha256V2(targetBytes), canonicalCommittedReceipt: receipt,
    canonicalCommittedReceiptUtf8Base64: receiptBytes.toString("base64"),
    committedReceiptSha256: receiptSha256, preparedAt: evaluatedAt
  };
  return {
    manifest, targetBytes, receipt, receiptBytes,
    prepared: validatePreparedManifestTransitionV2(prepared), preparedBytes: canonicalBytesV2(prepared)
  };
}

function loadInitialManifestResultV2(
  root: string,
  preparedPath: string,
  freeze: ReleaseFreezeIdentityV2,
  transitionKeySha256: string,
  verifiedGateOutputs: unknown
) {
  const preparedBytes = readFileSync(preparedPath);
  const prepared = validatePreparedManifestTransitionV2(JSON.parse(preparedBytes.toString("utf8")));
  const gateOutputSha256s = verifiedGateOutputHashes(verifiedGateOutputs);
  if (prepared.transitionId !== "pre_manual" || prepared.transitionKeySha256 !== transitionKeySha256
      || prepared.generationId !== freeze.releaseGenerationId || prepared.sourceManifestSha256 !== null
      || prepared.previousReceiptSha256 !== null || prepared.targetRevision !== 1
      || canonicalReleaseJsonV2(prepared.gateOutputSha256s) !== canonicalReleaseJsonV2(gateOutputSha256s)) {
    throw new Error("initial_prepared_transition_conflict");
  }
  const receiptBytes = Buffer.from(prepared.canonicalCommittedReceiptUtf8Base64, "base64");
  const receipt = validateCommittedManifestTransitionReceiptV2(
    JSON.parse(receiptBytes.toString("utf8")));
  const snapshotPath = lifecyclePath(root, prepared.targetSnapshotRelativePath);
  const targetBytes = readFileSync(snapshotPath);
  const manifest = validateRemediationReleaseManifestV2(JSON.parse(targetBytes.toString("utf8")));
  if (!targetBytes.equals(canonicalBytesV2(manifest))
      || releaseSha256V2(targetBytes) !== prepared.targetSnapshotSha256
      || receipt.transitionKeySha256 !== transitionKeySha256
      || receipt.candidateSha !== freeze.candidateSha
      || receipt.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || receipt.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze)
      || canonicalReleaseJsonV2(receipt.gateOutputSha256s) !== canonicalReleaseJsonV2(gateOutputSha256s)) {
    throw new Error("initial_prepared_transition_binding_invalid");
  }
  validateManifestCommittedReceiptBindingV2(manifest, receipt);
  return { manifest, targetBytes, receipt, receiptBytes, prepared, preparedBytes };
}

export async function initializeReleaseManifestV2(input: {
  artifactRoot: string;
  evaluatedAt: string;
  verifiedGateOutputs: unknown;
  faultAt?: string;
}) {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  const manifestPath = safeArtifactPath(root, MANIFEST_FILE);
  const freeze = currentFreeze(root);
  const operationKey = releaseSha256V2(canonicalReleaseJsonV2([
    freeze.candidateSha, null, "pre_manual", freeze.releaseGenerationId,
    freeze.artifactRootFingerprintSha256
  ]));
  const initialClaimName = `manifest-transition-claim-${operationKey}.json`;
  const initialPreparedName = `manifest-transition-prepared-${operationKey}.json`;
  const initialPreparedPath = safeArtifactPath(root, initialPreparedName);
  const leasePayload = ownerPayload({ evaluatedAt: input.evaluatedAt }, "manifest_transition", root, freeze,
    operationKey, operationKey);
  if (existsSync(initialPreparedPath)) {
    const built = loadInitialManifestResultV2(root, initialPreparedPath, freeze, operationKey,
      input.verifiedGateOutputs);
    const receiptPath = safeArtifactPath(root,
      `manifest-transition-receipt-${built.prepared.committedReceiptSha256}.json`);
    if (existsSync(manifestPath) && existsSync(receiptPath)
        && readFileSync(manifestPath).equals(built.targetBytes)
        && readFileSync(receiptPath).equals(built.receiptBytes)) {
      releaseCompletedReplayLeaseIfOwned(root, leasePayload);
      return { manifest: built.manifest, receipt: built.receipt };
    }
  } else if (existsSync(manifestPath)) throw new Error("initial_manifest_requires_absent_source");
  const lease = acquireOrResumeFrozenLease(root,
    leasePayload, existsSync(initialPreparedPath));
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    lease.assertOwned();
    const built = existsSync(initialPreparedPath)
      ? loadInitialManifestResultV2(root, initialPreparedPath, freeze, operationKey,
        input.verifiedGateOutputs)
      : buildInitialManifestResultV2(freeze, operationKey, input.evaluatedAt,
        input.verifiedGateOutputs);
    exactReplayOrConflict(root, initialClaimName, canonicalBytesV2({
      version: "manifest-transition-claim-v2", transitionId: "pre_manual", transitionKeySha256: operationKey,
      generationId: freeze.releaseGenerationId, sourceManifestSha256: null,
      claimedAt: built.prepared.preparedAt,
      expiresAt: new Date(Date.parse(built.prepared.preparedAt) + 120_000).toISOString(),
      claimantPid: process.pid,
      claimantProcessStartFingerprintSha256: releaseSha256V2(`process:${process.pid}`)
    }));
    exactReplayOrConflict(root, built.prepared.targetSnapshotRelativePath, built.targetBytes);
    exactReplayOrConflict(root, initialPreparedName, built.preparedBytes);
    injectedFault(input.faultAt, "after_prepare");
    lease.assertOwned();
    if (!existsSync(manifestPath)) writeExclusiveDurable(manifestPath, built.targetBytes);
    else if (!readFileSync(manifestPath).equals(built.targetBytes)) throw new Error("initial_manifest_cas_conflict");
    injectedFault(input.faultAt, "after_manifest_replace");
    exactReplayOrConflict(root, `manifest-transition-receipt-${built.prepared.committedReceiptSha256}.json`,
      built.receiptBytes);
    injectedFault(input.faultAt, "after_receipt");
    lease.release();
    return { manifest: built.manifest, receipt: built.receipt };
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
    transition: {
      transitionId: Exclude<ManifestTransitionIdV2, "pre_manual">;
      evaluatedAt: string;
      latestCommittedReceiptSha256: string;
      operationalAttestation: OperationalAttestationV2 | null;
    };
    verifiedGateOutputs: unknown;
    verifiedTransitionEvidence: unknown;
    evaluatedAt: string;
  }
  ) {
  if (!input.releaseGenerationId) throw new Error("postgres_manifest_transition_binding_invalid");
  await client.query(`create table if not exists plan5_release_manifest_v2_cas(
    release_generation_id text primary key,
    revision integer not null,
    current_manifest_sha256 text not null,
    current_manifest_json jsonb not null,
    current_manifest_utf8_base64 text not null,
    evaluated_at timestamptz not null
  )`);
  const currentResult = await client.query<{
    revision: number;
    current_manifest_sha256: string;
    current_manifest_utf8_base64: string;
  }>(`select revision, current_manifest_sha256, current_manifest_utf8_base64
      from plan5_release_manifest_v2_cas where release_generation_id=$1`, [input.releaseGenerationId]);
  if (currentResult.rowCount !== 1) throw new Error("postgres_manifest_source_missing");
  const currentRow = currentResult.rows[0]!;
  const sourceBytes = Buffer.from(currentRow.current_manifest_utf8_base64, "base64");
  if (sourceBytes.toString("base64") !== currentRow.current_manifest_utf8_base64
      || releaseSha256V2(sourceBytes) !== currentRow.current_manifest_sha256
      || currentRow.revision !== input.sourceRevision
      || currentRow.current_manifest_sha256 !== input.sourceManifestSha256) {
    throw new Error("postgres_manifest_transition_cas_conflict");
  }
  const source = validateRemediationReleaseManifestV2(JSON.parse(sourceBytes.toString("utf8")));
  if (!sourceBytes.equals(canonicalBytesV2(source))) throw new Error("postgres_manifest_source_noncanonical");
  const target = reduceRemediationReleaseManifestV2(source, input.transition,
    input.verifiedGateOutputs, input.verifiedTransitionEvidence);
  const targetBytes = canonicalBytesV2(target);
  const result = await client.query(`update plan5_release_manifest_v2_cas set
    revision=$2, current_manifest_sha256=$4, current_manifest_json=$5::jsonb,
    current_manifest_utf8_base64=$6, evaluated_at=$7::timestamptz
  where release_generation_id=$1 and revision=$3 and current_manifest_sha256=$8
  returning revision`, [input.releaseGenerationId, target.revision, input.sourceRevision,
    releaseSha256V2(targetBytes), JSON.stringify(target), targetBytes.toString("base64"),
    input.evaluatedAt, input.sourceManifestSha256]);
  if (result.rowCount !== 1) throw new Error("postgres_manifest_transition_cas_conflict");
  return target;
}

export async function initializePostgresManifestStateV2(
  client: ClientBase,
  input: { releaseGenerationId: string; sourceManifestBytes: Buffer; evaluatedAt: string }
) {
  if (!input.releaseGenerationId) throw new Error("release_generation_invalid");
  const source = validateRemediationReleaseManifestV2(JSON.parse(input.sourceManifestBytes.toString("utf8")));
  if (!input.sourceManifestBytes.equals(canonicalBytesV2(source))) throw new Error("postgres_manifest_source_noncanonical");
  const sourceSha256 = releaseSha256V2(input.sourceManifestBytes);
  await client.query(`create table if not exists plan5_release_manifest_v2_cas(
    release_generation_id text primary key,
    revision integer not null,
    current_manifest_sha256 text not null,
    current_manifest_json jsonb not null,
    current_manifest_utf8_base64 text not null,
    evaluated_at timestamptz not null
  )`);
  const result = await client.query(`insert into plan5_release_manifest_v2_cas(
    release_generation_id, revision, current_manifest_sha256, current_manifest_json,
    current_manifest_utf8_base64, evaluated_at
  ) values ($1,$2,$3,$4::jsonb,$5,$6::timestamptz) on conflict do nothing`, [
    input.releaseGenerationId, source.revision, sourceSha256, JSON.stringify(source),
    input.sourceManifestBytes.toString("base64"), input.evaluatedAt
  ]);
  if (result.rowCount !== 1) throw new Error("postgres_manifest_source_already_initialized");
  return { source, sourceSha256 };
}
