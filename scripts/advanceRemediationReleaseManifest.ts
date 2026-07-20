import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import { promisify } from "node:util";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MANIFEST_TRANSITIONS_V2,
  createInitialRemediationReleaseManifestV2,
  reduceManifestTransition,
  releaseFreezeIdentitySha256V2,
  releaseSha256V2,
  validateActualRollbackTransitionEvidenceRefV2,
  validateOperationalAttestationV2,
  validateProductionFailureTransitionEvidenceRefV2,
  validateProductionFailureEvidenceV2,
  validateProductionRollbackEvidenceV2,
  validateProductionRollbackOutcomeV2,
  validateReleaseGateV2,
  validateRemediationReleaseManifestV2,
  validateReleaseFreezeIdentityV2,
  type OperationalAttestationV2,
  type ManifestTransitionIdV2,
  type ReleaseGateV2,
  type ManifestTransitionEvidenceRefV2
} from "../src/release/remediationReleaseManifestV2";
import {
  assertArtifactRootOutsideRepository,
  assertSafeArtifactRootPath,
  canonicalBytesV2,
  safeArtifactPath,
  safeArtifactRelativePath
} from "../src/release/releaseRootWriterStore";
import {
  advanceReleaseManifestV2,
  initializeReleaseManifestV2
} from "../src/release/releaseManifestStoreV2";
import {
  deriveTask0BProductionGateBindingV2,
  validateGateEvidenceBytesV2,
  type GateEvidencePayloadV2
} from "../src/release/releaseGateEvidencePolicy";
import { RELEASE_TRANSITION_EVIDENCE_POLICY_V2 } from "../src/release/releaseTransitionEvidencePolicy";

const execFileAsync = promisify(execFile);
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

type VerifiedManifestAdvanceInputV2 = {
  version: "verified-manifest-transition-input-v2";
  transitionId: ManifestTransitionIdV2;
  candidateSha: string;
  releaseGenerationId: string;
  artifactRootFingerprintSha256: string;
  releaseFreezeIdentitySha256: string;
  sourceManifestSha256: string | null;
  sourceManifestRevision: number | null;
  evaluatedAt: string;
  operationalAttestation: OperationalAttestationV2 | null;
  verifiedGateOutputs: ReleaseGateV2[];
  verifiedTransitionEvidence: { refs: ManifestTransitionEvidenceRefV2[]; actualRollbackOutcome: unknown | null };
};

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label}_keys_invalid`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value as Record<string, unknown>;
}

type FileIdentity = { dev: number | bigint; ino: number | bigint };

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function readStableFile(path: string): Buffer {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("manifest_advance_input_not_regular");
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameIdentity(before, opened)) throw new Error("manifest_advance_input_identity_changed");
    const bytes = readFileSync(descriptor);
    const after = lstatSync(path);
    if (!after.isFile() || after.isSymbolicLink() || !sameIdentity(opened, after)) {
      throw new Error("manifest_advance_input_identity_changed");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function readStableGateEvidence(path: string, kind: string): GateEvidencePayloadV2 {
  if (kind !== "production_backup_dump" && kind !== "production_backup_restore_list") {
    return readStableFile(path);
  }
  const maxBytes = kind === "production_backup_dump" ? 1024 ** 4 : 100 * 1024 * 1024;
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > maxBytes) {
    throw new Error("gate_evidence_bytes_invalid");
  }
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameIdentity(before, opened) || opened.size !== before.size) {
      throw new Error("gate_evidence_bytes_invalid");
    }
    const digest = createHash("sha256");
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < opened.size) {
      const bytesRead = readSync(descriptor, chunk, 0, Math.min(chunk.length, opened.size - position), position);
      if (bytesRead <= 0) throw new Error("gate_evidence_bytes_invalid");
      digest.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = fstatSync(descriptor);
    if (!sameIdentity(opened, after) || after.size !== opened.size
        || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new Error("gate_evidence_bytes_invalid");
    }
    return { byteLength: opened.size, sha256: digest.digest("hex") };
  } finally {
    closeSync(descriptor);
  }
}

function readCanonicalJson(root: string, filename: string, label: string): unknown {
  const bytes = readStableFile(safeArtifactPath(root, filename));
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label}_json_invalid`); }
  if (!canonicalBytesV2(value).equals(bytes)) throw new Error(`${label}_canonical_bytes_invalid`);
  return value;
}

function validateVerifiedManifestAdvanceInputV2(
  value: unknown,
  expectedTransition: ManifestTransitionIdV2
): VerifiedManifestAdvanceInputV2 {
  const input = record(value, "verified_manifest_input");
  exactKeys(input, [
    "version", "transitionId", "candidateSha", "releaseGenerationId",
    "artifactRootFingerprintSha256", "releaseFreezeIdentitySha256",
    "sourceManifestSha256", "sourceManifestRevision", "evaluatedAt",
    "operationalAttestation", "verifiedGateOutputs", "verifiedTransitionEvidence"
  ], "verified_manifest_input");
  if (input.version !== "verified-manifest-transition-input-v2"
      || input.transitionId !== expectedTransition
      || typeof input.releaseGenerationId !== "string" || input.releaseGenerationId.length === 0
      || typeof input.candidateSha !== "string" || !SHA40.test(input.candidateSha)
      || typeof input.artifactRootFingerprintSha256 !== "string"
      || !SHA256.test(input.artifactRootFingerprintSha256)
      || typeof input.releaseFreezeIdentitySha256 !== "string"
      || !SHA256.test(input.releaseFreezeIdentitySha256)
      || typeof input.evaluatedAt !== "string" || !ISO.test(input.evaluatedAt)
      || !Number.isFinite(Date.parse(input.evaluatedAt))) {
    throw new Error("verified_manifest_input_invalid");
  }
  if (input.sourceManifestSha256 !== null
      && (typeof input.sourceManifestSha256 !== "string" || !SHA256.test(input.sourceManifestSha256))) {
    throw new Error("verified_manifest_input_source_invalid");
  }
  if (input.sourceManifestRevision !== null
      && (!Number.isSafeInteger(input.sourceManifestRevision) || (input.sourceManifestRevision as number) < 1)) {
    throw new Error("verified_manifest_input_source_revision_invalid");
  }
  if (!Array.isArray(input.verifiedGateOutputs)) throw new Error("verified_manifest_input_gates_invalid");
  input.verifiedGateOutputs.forEach((gate) => validateReleaseGateV2(gate));
  const evidence = record(input.verifiedTransitionEvidence, "verified_manifest_input_transition_evidence");
  exactKeys(evidence, ["refs", "actualRollbackOutcome"], "verified_manifest_input_transition_evidence");
  if (!Array.isArray(evidence.refs)) throw new Error("verified_manifest_input_transition_refs_invalid");
  evidence.refs.forEach((ref) => {
    const kind = record(ref, "verified_manifest_input_transition_ref").kind;
    if (kind === "production_failure_evidence") validateProductionFailureTransitionEvidenceRefV2(ref);
    else if (kind === "actual_rollback_evidence") validateActualRollbackTransitionEvidenceRefV2(ref);
    else throw new Error("verified_manifest_input_transition_ref_invalid");
  });
  if (evidence.actualRollbackOutcome !== null) validateProductionRollbackOutcomeV2(evidence.actualRollbackOutcome);
  if (input.operationalAttestation !== null) validateOperationalAttestationV2(input.operationalAttestation);
  return input as VerifiedManifestAdvanceInputV2;
}

export async function runAdvanceRemediationReleaseManifest(
  args: string[],
  dependencies: { cwd?: string; now?: () => string; stdout?: (line: string) => void } = {}
) {
  if (args.length !== 3) throw new Error("usage: release:manifest:advance <transition> <source-sha|absent> <artifact-root>");
  const [transitionToken, expectedSourceSha, rawRoot] = args;
  if (!MANIFEST_TRANSITIONS_V2.includes(transitionToken as ManifestTransitionIdV2)
      || !(/^[0-9a-f]{64}$/.test(expectedSourceSha) || expectedSourceSha === "absent")) {
    throw new Error("manifest_advance_arguments_invalid");
  }
  const cwd = dependencies.cwd ?? process.cwd();
  const status = await execFileAsync("git", ["status", "--porcelain=v1"], { cwd });
  if (status.stdout.trim().length !== 0) throw new Error("candidate_worktree_dirty");
  if (!isAbsolute(rawRoot)) throw new Error("artifact_root_must_be_absolute");
  const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim().toLowerCase();
  const root = assertSafeArtifactRootPath(rawRoot);
  assertArtifactRootOutsideRepository(root, cwd);
  const freeze = validateReleaseFreezeIdentityV2(readCanonicalJson(
    root, "release-freeze-identity-v2.json", "release_freeze_identity"));
  if (freeze.candidateSha !== head) throw new Error("candidate_head_binding_invalid");
  const task0bBinding = deriveTask0BProductionGateBindingV2(
    readStableFile(safeArtifactPath(root, "task0b-release-freeze.json")),
    freeze.candidateSha,
    freeze.productionDatabaseIdentityFingerprintSha256
  );
  const transitionId = transitionToken as ManifestTransitionIdV2;
  const verifiedInput = validateVerifiedManifestAdvanceInputV2(readCanonicalJson(
    root,
    `verified-manifest-transition-input-${transitionId}.json`,
    "verified_manifest_input"
  ), transitionId);
  if (verifiedInput.candidateSha !== head || verifiedInput.candidateSha !== freeze.candidateSha) {
    throw new Error("verified_manifest_input_candidate_binding_invalid");
  }
  if (verifiedInput.releaseGenerationId !== freeze.releaseGenerationId
      || verifiedInput.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || verifiedInput.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze)) {
    throw new Error("verified_manifest_input_freeze_binding_invalid");
  }
  const manifestPath = safeArtifactPath(root, "release-manifest.json");
  const actualBytes = existsSync(manifestPath) ? readStableFile(manifestPath) : null;
  if (expectedSourceSha === "absent" ? actualBytes !== null : actualBytes === null
      || (actualBytes && releaseSha256V2(actualBytes) !== expectedSourceSha)) {
    throw new Error("manifest_source_cas_conflict");
  }
  const sourceManifest = actualBytes === null ? null
    : validateRemediationReleaseManifestV2(JSON.parse(actualBytes.toString("utf8")));
  if (sourceManifest !== null && (actualBytes === null || !canonicalBytesV2(sourceManifest).equals(actualBytes))) {
    throw new Error("manifest_source_canonical_bytes_invalid");
  }
  const expectedInputSource = expectedSourceSha === "absent" ? null : expectedSourceSha;
  if (verifiedInput.sourceManifestSha256 !== expectedInputSource
      || verifiedInput.sourceManifestRevision !== (sourceManifest?.revision ?? null)
      || (sourceManifest !== null && (sourceManifest.candidateSha !== head
        || sourceManifest.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
        || sourceManifest.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze)))) {
    throw new Error("verified_manifest_input_source_binding_invalid");
  }
  if (transitionId === "pre_manual" && (sourceManifest !== null
      || verifiedInput.operationalAttestation !== null
      || verifiedInput.verifiedTransitionEvidence.refs.length !== 0
      || verifiedInput.verifiedTransitionEvidence.actualRollbackOutcome !== null)) {
    throw new Error("verified_manifest_initial_input_invalid");
  }
  if (verifiedInput.operationalAttestation !== null) {
    validateOperationalAttestationV2(verifiedInput.operationalAttestation, freeze);
  }
  for (const gate of verifiedInput.verifiedGateOutputs) {
    if (gate.state !== "passed" && gate.state !== "failed") continue;
    const evidenceBytes = new Map<string, GateEvidencePayloadV2>();
    for (const ref of gate.evidence) evidenceBytes.set(ref.relativePath,
      readStableGateEvidence(safeArtifactRelativePath(root, ref.relativePath), ref.kind));
    validateGateEvidenceBytesV2(gate, evidenceBytes, {
      releaseGenerationId: freeze.releaseGenerationId,
      artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
      releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
      sourceManifestSha256: expectedInputSource ?? undefined,
      ...task0bBinding
    });
    if (gate.id === "G12_PRODUCTION_BACKUP"
        && existsSync(safeArtifactPath(root, `production-backup-operation-${freeze.releaseGenerationId}.json`))) {
      throw new Error("production_backup_operation_lease_active");
    }
    if ((gate.id === "G14_PRODUCTION_ROLLOUT" || gate.id === "G15_PRODUCTION_CANARY")
        && existsSync(safeArtifactPath(root, "production-operation-root.lease.json"))) {
      throw new Error("production_operation_lease_active");
    }
  }
  for (const ref of verifiedInput.verifiedTransitionEvidence.refs) {
    const policy = ref.kind === "production_failure_evidence"
      ? RELEASE_TRANSITION_EVIDENCE_POLICY_V2.production_failed
      : RELEASE_TRANSITION_EVIDENCE_POLICY_V2.rollback_rolled_back;
    if (ref.relativePath !== policy.relativePath || ref.schemaVersion !== policy.schemaVersion) {
      throw new Error("transition_evidence_policy_binding_invalid");
    }
    const bytes = readStableFile(safeArtifactRelativePath(root, ref.relativePath));
    if (releaseSha256V2(bytes) !== ref.sha256) throw new Error("transition_evidence_bytes_invalid");
    const value = JSON.parse(bytes.toString("utf8"));
    if (!canonicalBytesV2(value).equals(bytes)) throw new Error("transition_evidence_noncanonical");
    if (ref.kind === "production_failure_evidence") validateProductionFailureEvidenceV2(value);
    else validateProductionRollbackEvidenceV2(value);
  }
  if (transitionId === "pre_manual") {
    createInitialRemediationReleaseManifestV2({
      freezeIdentity: freeze,
      evaluatedAt: verifiedInput.evaluatedAt,
      latestCommittedReceiptSha256: "0".repeat(64),
      verifiedGateOutputs: verifiedInput.verifiedGateOutputs
    });
  } else {
    if (sourceManifest === null) throw new Error("verified_manifest_input_source_binding_invalid");
    reduceManifestTransition(sourceManifest, {
      transitionId,
      evaluatedAt: verifiedInput.evaluatedAt,
      latestCommittedReceiptSha256: "0".repeat(64),
      operationalAttestation: verifiedInput.operationalAttestation
    }, verifiedInput.verifiedGateOutputs, verifiedInput.verifiedTransitionEvidence);
  }
  const result = transitionId === "pre_manual"
    ? await initializeReleaseManifestV2({
      artifactRoot: root,
      evaluatedAt: verifiedInput.evaluatedAt,
      verifiedGateOutputs: verifiedInput.verifiedGateOutputs
    })
    : await advanceReleaseManifestV2({ artifactRoot: root,
      sourceManifest,
      transition: {
        transitionId,
        evaluatedAt: verifiedInput.evaluatedAt,
        operationalAttestation: verifiedInput.operationalAttestation
      },
      verifiedGateOutputs: verifiedInput.verifiedGateOutputs,
      verifiedTransitionEvidence: verifiedInput.verifiedTransitionEvidence,
      evaluatedAt: verifiedInput.evaluatedAt
    });
  (dependencies.stdout ?? console.log)(JSON.stringify({ status: "passed", transitionId,
    revision: result.manifest.revision }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runAdvanceRemediationReleaseManifest(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
