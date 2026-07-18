import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { dirname, relative, resolve } from "node:path";
import type { ClientBase } from "pg";
import {
  PLAN5_APPROVED_BASE_SHA,
  validateTask0BReleaseFreezeEvidence,
  type Task0BReleaseFreezeEvidenceV1
} from "./remediationReleaseManifest";
import {
  canonicalReleaseJsonV2,
  createInitialRemediationReleaseManifestV2,
  MANIFEST_LEASE_TAKEOVER_TEMPLATE_SHA256_V2,
  OPERATIONAL_ATTESTATION_POLICY_V2,
  operationalAttestationTemplateSha256V2,
  reduceRemediationReleaseManifestV2,
  releaseSha256V2,
  releaseFreezeIdentitySha256V2,
  rootWriterOwnerProcessIdentitySha256V2,
  validateCommittedManifestTransitionReceiptV2,
  validateCommittedOperationalAttestationIssuanceV2,
  validateBootstrapRootWriterLeaseTakeoverReceiptV2,
  validateAuthorityTerminalReceiptV2,
  validateFrozenRootWriterLeaseTakeoverReceiptV2,
  validateManifestCommittedReceiptBindingV2,
  validateManifestTransitionClaimV2,
  validateOperationalAttestationConsumptionV2,
  validateOperationalAttestationV2,
  validateOperationalAttestationIssuerReceiptV2,
  validatePreparedManifestTransitionV2,
  validatePreparedAuthorityTerminalV2,
  validatePreparedBootstrapRootWriterLeaseTakeoverV2,
  validatePreparedFrozenRootWriterLeaseTakeoverV2,
  validatePreparedOperationalAttestationIssuanceV2,
  validatePreparedReleaseFreezeMaterializationV2,
  validateVerifiedManifestTransitionEvidenceV2,
  validateReleaseFreezeMaterializationReceiptV2,
  validateReleaseFreezeIdentityV2,
  validateReleaseGateV2,
  validateReleaseRootWriterLeaseV2,
  validateRemediationReleaseManifestV2,
  validateProductionAuthorityPreclaimValidationV2,
  validateProductionOperationClaimV2,
  validateProductionOperationTerminalAbandonedV2,
  validateProductionOperationTerminalCleanupV2,
  validateProductionOrchestrationReceiptV2,
  validateProductionOrchestrationStepIntentV2,
  validateProductionOrchestrationStepReceiptV2,
  validateProductionRecoveryInputV2,
  type ManifestTransitionIdV2,
  type OperationalAttestationV2,
  type ProductionFailureEvidenceV2,
  type OperationalAttestationConsumptionV2,
  type ProductionOperationClaimV2,
  type ReleaseFreezeIdentityV2,
  type ReleaseRootWriterLeaseV2,
  type BootstrapRootWriterLeaseV2,
  type FrozenRootWriterLeaseV2,
  type PreparedBootstrapRootWriterLeaseTakeoverV2,
  type PreparedFrozenRootWriterLeaseTakeoverV2,
  type RemediationReleaseManifestV2
} from "./remediationReleaseManifestV2";
import { validateGateEvidenceBytesV2 } from "./releaseGateEvidencePolicy";
import {
  ROOT_WRITER_LEASE_FILE,
  acquireRootWriterLeaseV2,
  assertTrustedArtifactRootPathV2,
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

function observedProcessStartIdentityV2(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    if (process.platform === "win32") {
      const startedAt = execFileSync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('O')`
      ], { encoding: "utf8", timeout: 3_000, windowsHide: true }).trim();
      return startedAt ? `windows:${pid}:${startedAt}` : null;
    }
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const fields = stat.slice(close + 1).trim().split(/\s+/u);
      const startTicks = fields[19];
      if (!startTicks) return null;
      let bootId = "unknown-boot";
      try { bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(); }
      catch { /* fail-closed liveness still uses the per-boot process start tick */ }
      return `linux:${bootId}:${pid}:${startTicks}`;
    }
    const startedAt = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8", timeout: 3_000
    }).trim();
    return startedAt ? `${process.platform}:${pid}:${startedAt}` : null;
  } catch {
    return null;
  }
}

const CURRENT_PROCESS_START_FINGERPRINT_SHA256 = (() => {
  const observed = observedProcessStartIdentityV2(process.pid);
  if (observed) return releaseSha256V2(observed);
  // ponytail: fallback is process-local only; unknown external identities remain fail-closed alive.
  const approximateStartedAt = Math.round(Date.now() - process.uptime() * 1_000);
  return releaseSha256V2(`fallback:${process.pid}:${process.execPath}:${approximateStartedAt}`);
})();

export type RootWriterProcessRuntimeV2 = {
  currentOwnerIdentity(): { pid: number; processStartFingerprintSha256: string };
  isOwnerAlive(pid: number, processStartFingerprintSha256: string): boolean;
};

const ROOT_WRITER_PROCESS_RUNTIME_V2 = new AsyncLocalStorage<RootWriterProcessRuntimeV2>();

export function currentRootWriterOwnerIdentityV2(): { pid: number; processStartFingerprintSha256: string } {
  const injected = ROOT_WRITER_PROCESS_RUNTIME_V2.getStore()?.currentOwnerIdentity();
  const identity = injected ?? {
    pid: process.pid,
    processStartFingerprintSha256: CURRENT_PROCESS_START_FINGERPRINT_SHA256
  };
  if (!Number.isSafeInteger(identity.pid) || identity.pid < 1
      || !/^[0-9a-f]{64}$/u.test(identity.processStartFingerprintSha256)) {
    throw new Error("root_writer_current_process_identity_invalid");
  }
  return identity;
}

export function runWithRootWriterProcessRuntimeForTestsV2<T>(
  runtime: RootWriterProcessRuntimeV2,
  action: () => T
): T {
  if (process.env.NODE_ENV !== "test") throw new Error("root_writer_process_runtime_test_seam_forbidden");
  return ROOT_WRITER_PROCESS_RUNTIME_V2.run(runtime, action);
}

function validateBoundedRootWriterLeaseV2(value: unknown): ReleaseRootWriterLeaseV2 {
  const lease = validateReleaseRootWriterLeaseV2(value);
  const rollingMs = Date.parse(lease.expiresAt) - Date.parse(lease.heartbeatAt);
  const absoluteMs = Date.parse(lease.expiresAt) - Date.parse(lease.acquiredAt);
  if (rollingMs > 60_000) throw new Error("root_writer_lease_rolling_ttl_invalid");
  if (absoluteMs > 300_000) throw new Error("root_writer_lease_absolute_ttl_invalid");
  return lease;
}

function observedProcessStartFingerprintSha256V2(pid: number): string | null {
  if (pid === process.pid) return CURRENT_PROCESS_START_FINGERPRINT_SHA256;
  const observed = observedProcessStartIdentityV2(pid);
  return observed === null ? null : releaseSha256V2(observed);
}

const NESTED_LIFECYCLE_ROOTS = new Set([
  "manifest-snapshots",
  "operational-attestation-issuance-prepared",
  "operational-attestations",
  "operational-attestation-issuer-receipts",
  "operational-attestation-issuance-committed",
  "authority-terminal-prepared",
  "authority-terminal-receipts",
  "production-operation-step-intents",
  "production-operation-steps"
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

function readCanonicalLifecycleArtifactV2<T>(
  root: string,
  relativePath: string,
  expectedSha256: string,
  validator: (value: unknown) => T,
  label: string
): { value: T; bytes: Buffer } {
  const path = lifecyclePath(root, relativePath);
  if (!existsSync(path)) throw new Error(`${label}_missing`);
  const bytes = readFileSync(path);
  const value = validator(JSON.parse(bytes.toString("utf8")));
  if (!bytes.equals(canonicalBytesV2(value)) || releaseSha256V2(bytes) !== expectedSha256) {
    throw new Error(`${label}_canonical_binding_invalid`);
  }
  return { value, bytes };
}

function injectedFault(name: string | undefined, expected: string): void {
  if (name === expected) throw new Error(`injected_fault_${expected}`);
}

const MATERIALIZER_TEMPLATE_SHA256 = releaseSha256V2(
  "release:freeze:materialize <protected-artifact-root>"
);

function currentArtifactRootFingerprintSha256V2(root: string): string {
  const absolute = resolve(root);
  const canonicalPathKey = process.platform === "win32" ? absolute.toLowerCase() : absolute;
  return releaseSha256V2(canonicalPathKey);
}

function currentVerifiedFreeze(root: string): ReleaseFreezeIdentityV2 {
  const preflightPath = safeArtifactPath(root, "task0b-release-freeze.json");
  const preparedPath = safeArtifactPath(root, FREEZE_PREPARED_FILE);
  const receiptPath = safeArtifactPath(root, FREEZE_RECEIPT_FILE);
  const freezePath = safeArtifactPath(root, FREEZE_FILE);
  for (const [path, label] of [
    [preflightPath, "preflight"],
    [preparedPath, "prepared"],
    [receiptPath, "receipt"],
    [freezePath, "identity"]
  ] as const) {
    if (!existsSync(path)) throw new Error(`release_freeze_materialization_${label}_missing`);
  }

  const preflightBytes = readFileSync(preflightPath);
  const preflight = validateTask0BReleaseFreezeEvidence(JSON.parse(preflightBytes.toString("utf8")));
  if (!preflightBytes.equals(canonicalBytesV2(preflight))) {
    throw new Error("release_freeze_materialization_preflight_noncanonical");
  }
  if (preflight.artifactRoot.rootFingerprintSha256
      !== currentArtifactRootFingerprintSha256V2(root)) {
    throw new Error("release_freeze_artifact_root_fingerprint_mismatch");
  }
  const derivedFreeze = deriveReleaseFreezeIdentityV2(preflight);

  const freezeBytes = readFileSync(freezePath);
  const freeze = validateReleaseFreezeIdentityV2(JSON.parse(freezeBytes.toString("utf8")));
  if (!freezeBytes.equals(canonicalBytesV2(freeze))) {
    throw new Error("release_freeze_identity_noncanonical");
  }
  if (!freezeBytes.equals(canonicalBytesV2(derivedFreeze))) {
    throw new Error("release_freeze_materialization_preflight_binding_invalid");
  }

  const preparedBytes = readFileSync(preparedPath);
  const prepared = validatePreparedReleaseFreezeMaterializationV2(
    JSON.parse(preparedBytes.toString("utf8"))
  );
  if (!preparedBytes.equals(canonicalBytesV2(prepared))) {
    throw new Error("release_freeze_materialization_prepared_noncanonical");
  }
  const receiptBytes = readFileSync(receiptPath);
  const receipt = validateReleaseFreezeMaterializationReceiptV2(
    JSON.parse(receiptBytes.toString("utf8"))
  );
  if (!receiptBytes.equals(canonicalBytesV2(receipt))) {
    throw new Error("release_freeze_materialization_receipt_noncanonical");
  }

  const embeddedFreezeBytes = Buffer.from(prepared.canonicalFreezeIdentityUtf8Base64, "base64");
  const embeddedReceiptBytes = Buffer.from(
    prepared.canonicalMaterializationReceiptUtf8Base64,
    "base64"
  );
  const preflightSha256 = releaseSha256V2(preflightBytes);
  const runtimeIdentitySha256 = releaseSha256V2(canonicalBytesV2(preflight.previousRuntimeIdentity));
  if (prepared.commandId !== "release_freeze_materialize"
      || receipt.commandId !== "release_freeze_materialize"
      || prepared.redactedTemplateSha256 !== MATERIALIZER_TEMPLATE_SHA256
      || receipt.redactedTemplateSha256 !== MATERIALIZER_TEMPLATE_SHA256
      || prepared.task0BPreflightEvidenceSha256 !== preflightSha256
      || receipt.task0BPreflightEvidenceSha256 !== preflightSha256
      || prepared.protectedRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || receipt.protectedRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || prepared.candidateSha !== freeze.candidateSha
      || receipt.candidateSha !== freeze.candidateSha
      || prepared.runtimeIdentitySha256 !== runtimeIdentitySha256
      || receipt.runtimeIdentitySha256 !== runtimeIdentitySha256
      || prepared.bootstrapLeaseEpoch !== 1
      || receipt.bootstrapLeaseEpoch !== 1
      || prepared.bootstrapLeaseSha256 !== receipt.bootstrapLeaseSha256
      || prepared.preparedAt !== receipt.materializedAt
      || prepared.canonicalFreezeIdentitySha256 !== releaseSha256V2(freezeBytes)
      || receipt.canonicalFreezeIdentitySha256 !== releaseSha256V2(freezeBytes)
      || prepared.canonicalMaterializationReceiptSha256 !== releaseSha256V2(receiptBytes)
      || !embeddedFreezeBytes.equals(freezeBytes)
      || !embeddedReceiptBytes.equals(receiptBytes)
      || canonicalReleaseJsonV2(prepared.canonicalFreezeIdentity)
        !== canonicalReleaseJsonV2(freeze)
      || canonicalReleaseJsonV2(receipt.canonicalFreezeIdentity)
        !== canonicalReleaseJsonV2(freeze)
      || canonicalReleaseJsonV2(prepared.canonicalMaterializationReceipt)
        !== canonicalReleaseJsonV2(receipt)) {
    throw new Error("release_freeze_materialization_bundle_binding_invalid");
  }

  const leasePath = safeArtifactPath(root, ROOT_WRITER_LEASE_FILE);
  if (existsSync(leasePath)) {
    const leaseBytes = readFileSync(leasePath);
    const lease = validateBoundedRootWriterLeaseV2(JSON.parse(leaseBytes.toString("utf8")));
    if (!leaseBytes.equals(canonicalBytesV2(lease))) {
      throw new Error("release_freeze_materialization_lease_noncanonical");
    }
    if (lease.version === "bootstrap-root-writer-lease-v2") {
      throw new Error("release_freeze_materialization_lease_not_released");
    }
    if (lease.candidateSha !== freeze.candidateSha
        || lease.protectedRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
        || lease.releaseGenerationId !== freeze.releaseGenerationId
        || lease.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze)) {
      throw new Error("release_freeze_frozen_lease_binding_invalid");
    }
  }
  return freeze;
}

export function deriveReleaseFreezeIdentityV2(
  preflight: Task0BReleaseFreezeEvidenceV1
): ReleaseFreezeIdentityV2 {
  const preflightBytes = canonicalBytesV2(preflight);
  const generationDigest = releaseSha256V2(canonicalReleaseJsonV2([
    "release-freeze-generation-v2",
    preflight.candidateSha,
    preflight.artifactRoot.rootFingerprintSha256,
    releaseSha256V2(preflightBytes)
  ]));
  return validateReleaseFreezeIdentityV2({
    version: "release-freeze-identity-v2",
    releaseGenerationId: `release-generation-${generationDigest.slice(0, 32)}`,
    candidateSha: preflight.candidateSha,
    planBaseSha: PLAN5_APPROVED_BASE_SHA,
    artifactRootFingerprintSha256: preflight.artifactRoot.rootFingerprintSha256,
    artifactRootTrustBoundaryEvidenceSha256: releaseSha256V2(canonicalBytesV2(preflight.artifactRoot)),
    productionDatabaseIdentityFingerprintSha256:
      preflight.productionDatabase.approvedIdentityFingerprintSha256,
    postgresToolIdentitySha256: releaseSha256V2(canonicalBytesV2(preflight.postgresTools)),
    previousRuntimeDiscoverySha256: releaseSha256V2(canonicalBytesV2(preflight.previousRuntimeIdentity)),
    rollbackWorktreeIdentitySha256: releaseSha256V2(canonicalBytesV2(preflight.rollbackWorktree)),
    createdAt: preflight.freezeCutoff
  });
}

function ownerPayload(input: {
  evaluatedAt?: string;
}, kind: "manifest_transition" | "operational_authority_issue" | "operational_authority_terminalize",
root: string, freeze: ReleaseFreezeIdentityV2, operationKey: string, transitionKey: string | null = null) {
  const now = input.evaluatedAt ?? new Date().toISOString();
  const owner = currentRootWriterOwnerIdentityV2();
  return {
    version: "frozen-root-writer-lease-v2", scope: "artifact_root",
    relativePath: ROOT_WRITER_LEASE_FILE, writerOperationKind: kind,
    writerOperationKeySha256: operationKey, transitionKeySha256: transitionKey,
    protectedRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    candidateSha: freeze.candidateSha, releaseGenerationId: freeze.releaseGenerationId,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze), leaseEpoch: 1,
    ownerPid: owner.pid,
    ownerProcessStartFingerprintSha256: owner.processStartFingerprintSha256,
    acquiredAt: now, heartbeatAt: now,
    expiresAt: new Date(Date.parse(now) + 60_000).toISOString()
  };
}

function exactLeaseBindingMatchesV2(
  actual: BootstrapRootWriterLeaseV2 | FrozenRootWriterLeaseV2,
  expected: BootstrapRootWriterLeaseV2 | FrozenRootWriterLeaseV2
): boolean {
  if (actual.version !== expected.version
      || actual.scope !== expected.scope
      || actual.relativePath !== expected.relativePath
      || actual.writerOperationKind !== expected.writerOperationKind
      || actual.writerOperationKeySha256 !== expected.writerOperationKeySha256
      || actual.protectedRootFingerprintSha256 !== expected.protectedRootFingerprintSha256
      || actual.candidateSha !== expected.candidateSha
      || actual.releaseGenerationId !== expected.releaseGenerationId
      || actual.releaseFreezeIdentitySha256 !== expected.releaseFreezeIdentitySha256
      || actual.ownerPid !== expected.ownerPid
      || actual.ownerProcessStartFingerprintSha256 !== expected.ownerProcessStartFingerprintSha256) return false;
  if (actual.version === "bootstrap-root-writer-lease-v2"
      && expected.version === "bootstrap-root-writer-lease-v2") {
    return actual.task0BPreflightEvidenceSha256 === expected.task0BPreflightEvidenceSha256
      && actual.runtimeIdentitySha256 === expected.runtimeIdentitySha256;
  }
  return actual.version === "frozen-root-writer-lease-v2"
    && expected.version === "frozen-root-writer-lease-v2"
    && actual.transitionKeySha256 === expected.transitionKeySha256;
}

function readCanonicalRootWriterLeaseV2(root: string): BootstrapRootWriterLeaseV2 | FrozenRootWriterLeaseV2 {
  const bytes = readFileSync(safeArtifactPath(root, ROOT_WRITER_LEASE_FILE));
  const lease = validateBoundedRootWriterLeaseV2(JSON.parse(bytes.toString("utf8")));
  if (!bytes.equals(canonicalBytesV2(lease))) throw new Error("root_writer_lease_bytes_noncanonical");
  return lease;
}

function assertCommittedRootWriterTakeoverLineageV2(
  root: string,
  currentLease: BootstrapRootWriterLeaseV2 | FrozenRootWriterLeaseV2
): void {
  let lease = currentLease;
  let leaseBytes = canonicalBytesV2(lease);
  const visitedLeaseHashes = new Set<string>();

  // ponytail: takeover chains are bounded by the small lease epoch; replace the
  // directory scan with an index only if release operations ever create many epochs.
  while (lease.leaseEpoch > 1) {
    const currentLeaseSha256 = releaseSha256V2(leaseBytes);
    if (visitedLeaseHashes.has(currentLeaseSha256)) throw new Error("root_writer_takeover_lineage_cycle");
    visitedLeaseHashes.add(currentLeaseSha256);
    const bootstrap = lease.version === "bootstrap-root-writer-lease-v2";
    const preparedPrefix = bootstrap
      ? "manifest-transition-root.bootstrap-takeover-prepared-"
      : "manifest-transition-root.frozen-takeover-prepared-";
    const preparedMatches = readdirSync(root).filter((name) => name.startsWith(preparedPrefix)
        && name.endsWith(".json"))
      .map((name) => {
        const bytes = readFileSync(safeArtifactPath(root, name));
        const parsed = JSON.parse(bytes.toString("utf8"));
        const prepared = bootstrap
          ? validatePreparedBootstrapRootWriterLeaseTakeoverV2(parsed)
          : validatePreparedFrozenRootWriterLeaseTakeoverV2(parsed);
        if (!bytes.equals(canonicalBytesV2(prepared))) {
          throw new Error("root_writer_takeover_prepared_noncanonical");
        }
        return { name, prepared };
      }).filter(({ prepared }) => prepared.newLeaseSha256 === currentLeaseSha256);
    if (preparedMatches.length !== 1) throw new Error("root_writer_takeover_prepared_lineage_unverified");
    const { prepared } = preparedMatches[0]!;
    const embeddedNewLeaseBytes = Buffer.from(prepared.canonicalNewLeaseUtf8Base64, "base64");
    if (!embeddedNewLeaseBytes.equals(leaseBytes)
        || prepared.newLeaseEpoch !== lease.leaseEpoch) {
      throw new Error("root_writer_takeover_current_tip_invalid");
    }

    const tombstoneName = `manifest-transition-root.lease-tombstone-${prepared.oldLeaseSha256}.json`;
    const tombstoneBytes = readFileSync(safeArtifactPath(root, tombstoneName));
    if (releaseSha256V2(tombstoneBytes) !== prepared.oldLeaseSha256) {
      throw new Error("root_writer_takeover_tombstone_hash_invalid");
    }
    const oldLease = validateBoundedRootWriterLeaseV2(JSON.parse(tombstoneBytes.toString("utf8")));
    const oldOwnerProcessIdentitySha256 = rootWriterOwnerProcessIdentitySha256V2(
      oldLease.ownerPid,
      oldLease.ownerProcessStartFingerprintSha256
    );
    if (!tombstoneBytes.equals(canonicalBytesV2(oldLease))
        || oldLease.version !== lease.version
        || oldLease.leaseEpoch !== prepared.oldLeaseEpoch
        || oldLease.leaseEpoch + 1 !== lease.leaseEpoch
        || oldOwnerProcessIdentitySha256 !== prepared.oldOwnerProcessIdentitySha256
        || oldLease.writerOperationKind !== lease.writerOperationKind
        || oldLease.writerOperationKeySha256 !== lease.writerOperationKeySha256
        || oldLease.candidateSha !== prepared.candidateSha) {
      throw new Error("root_writer_takeover_tombstone_binding_invalid");
    }
    if (bootstrap) {
      const bootstrapPrepared = validatePreparedBootstrapRootWriterLeaseTakeoverV2(prepared);
      if (oldLease.version !== "bootstrap-root-writer-lease-v2"
          || oldLease.protectedRootFingerprintSha256 !== bootstrapPrepared.protectedRootFingerprintSha256
          || oldLease.task0BPreflightEvidenceSha256 !== bootstrapPrepared.task0BPreflightEvidenceSha256
          || oldLease.runtimeIdentitySha256 !== bootstrapPrepared.runtimeIdentitySha256) {
        throw new Error("bootstrap_root_writer_takeover_tombstone_binding_invalid");
      }
    } else {
      const frozenPrepared = validatePreparedFrozenRootWriterLeaseTakeoverV2(prepared);
      if (oldLease.version !== "frozen-root-writer-lease-v2"
          || oldLease.protectedRootFingerprintSha256 !== frozenPrepared.artifactRootFingerprintSha256
          || oldLease.writerOperationKind !== frozenPrepared.writerOperationKind
          || oldLease.writerOperationKeySha256 !== frozenPrepared.writerOperationKeySha256
          || oldLease.transitionKeySha256 !== frozenPrepared.transitionKeySha256
          || oldLease.releaseGenerationId !== frozenPrepared.releaseGenerationId
          || oldLease.releaseFreezeIdentitySha256 !== frozenPrepared.releaseFreezeIdentitySha256) {
        throw new Error("frozen_root_writer_takeover_tombstone_binding_invalid");
      }
    }

    const receiptPrefix = bootstrap
      ? "manifest-transition-root.bootstrap-takeover-receipt-"
      : "manifest-transition-root.frozen-takeover-receipt-";
    const receipts = readdirSync(root).filter((name) => name.startsWith(receiptPrefix)
        && name.endsWith(".json"))
      .map((name) => {
        const bytes = readFileSync(safeArtifactPath(root, name));
        if (name !== `${receiptPrefix}${releaseSha256V2(bytes)}.json`) {
          throw new Error("root_writer_takeover_receipt_filename_invalid");
        }
        const parsed = JSON.parse(bytes.toString("utf8"));
        const receipt = bootstrap
          ? validateBootstrapRootWriterLeaseTakeoverReceiptV2(parsed)
          : validateFrozenRootWriterLeaseTakeoverReceiptV2(parsed);
        if (!bytes.equals(canonicalBytesV2(receipt))) {
          throw new Error("root_writer_takeover_receipt_noncanonical");
        }
        return receipt;
      }).filter((receipt) => receipt.oldLeaseSha256 === prepared.oldLeaseSha256
        && receipt.newLeaseSha256 === currentLeaseSha256);
    if (receipts.length !== 1
        || receipts[0]!.tombstoneRelativePath !== tombstoneName) {
      throw new Error("root_writer_takeover_receipt_lineage_unverified");
    }
    if (bootstrap) {
      validateBootstrapRootWriterLeaseTakeoverReceiptV2(
        receipts[0], validatePreparedBootstrapRootWriterLeaseTakeoverV2(prepared));
    } else {
      validateFrozenRootWriterLeaseTakeoverReceiptV2(
        receipts[0], validatePreparedFrozenRootWriterLeaseTakeoverV2(prepared));
    }
    lease = oldLease;
    leaseBytes = tombstoneBytes;
  }
}

function resumeBoundRootWriterLeaseV2(root: string, expectedValue: Record<string, unknown>) {
  const expected = validateBoundedRootWriterLeaseV2(expectedValue);
  const current = readCanonicalRootWriterLeaseV2(root);
  if (!exactLeaseBindingMatchesV2(current, expected)) throw new Error("root_writer_lease_not_owned");
  const observedFingerprint = observedProcessStartFingerprintSha256V2(current.ownerPid);
  if (observedFingerprint === null
      || observedFingerprint !== current.ownerProcessStartFingerprintSha256) {
    throw new Error("root_writer_owner_process_identity_mismatch");
  }
  assertCommittedRootWriterTakeoverLineageV2(root, current);
  return resumeRootWriterLeaseV2(root, current, currentRootWriterOwnerIdentityV2);
}

function acquireOrResumeFrozenLease(root: string, payload: Record<string, unknown>, preparedExists: boolean) {
  const expected = validateBoundedRootWriterLeaseV2(payload);
  if (!existsSync(safeArtifactPath(root, ROOT_WRITER_LEASE_FILE))) {
    return acquireRootWriterLeaseV2(root, payload, currentRootWriterOwnerIdentityV2);
  }
  if (!preparedExists) throw new Error("root_writer_busy");
  return resumeBoundRootWriterLeaseV2(root, expected as unknown as Record<string, unknown>);
}

function releaseCompletedReplayLeaseIfOwned(
  root: string,
  payload: Record<string, unknown>,
  evaluatedAt: string
): void {
  const path = safeArtifactPath(root, ROOT_WRITER_LEASE_FILE);
  if (!existsSync(path)) return;
  const current = readCanonicalRootWriterLeaseV2(root);
  const expected = validateBoundedRootWriterLeaseV2(payload);
  if (!exactLeaseBindingMatchesV2(current, expected)) throw new Error("completed_replay_foreign_root_writer_lease");
  if (Date.parse(evaluatedAt) >= Date.parse(current.expiresAt)) {
    throw new Error("completed_replay_stale_root_writer_lease");
  }
  const lease = resumeBoundRootWriterLeaseV2(root, payload);
  lease.release();
}

export async function materializeReleaseFreezeV2(input: {
  artifactRoot: string;
  freezeIdentity?: unknown;
  task0BPreflightEvidence: unknown;
  evaluatedAt: string;
  producerId: "release_freeze_materialize";
  recoverDeadOwner?: boolean;
  faultAt?: string;
}) {
  if (Object.prototype.hasOwnProperty.call(input, "owner")) {
    throw new Error("caller_supplied_root_writer_process_identity_forbidden");
  }
  const root = assertTrustedArtifactRootPathV2(input.artifactRoot);
  if (input.producerId !== "release_freeze_materialize") {
    throw new Error("freeze_producer_not_authorized");
  }
  const preflightPath = safeArtifactPath(root, "task0b-release-freeze.json");
  if (!existsSync(preflightPath)) throw new Error("task0b_preflight_artifact_missing");
  const storedPreflight = readJson(preflightPath);
  if (canonicalReleaseJsonV2(storedPreflight)
      !== canonicalReleaseJsonV2(input.task0BPreflightEvidence)) {
    throw new Error("task0b_preflight_artifact_mismatch");
  }
  const preflight = validateTask0BReleaseFreezeEvidence(storedPreflight);
  if (!readFileSync(preflightPath).equals(canonicalBytesV2(preflight))) {
    throw new Error("task0b_preflight_artifact_noncanonical");
  }
  if (preflight.artifactRoot.rootFingerprintSha256
      !== currentArtifactRootFingerprintSha256V2(root)) {
    throw new Error("release_freeze_artifact_root_fingerprint_mismatch");
  }
  const freeze = deriveReleaseFreezeIdentityV2(preflight);
  if (input.freezeIdentity !== undefined
      && canonicalReleaseJsonV2(validateReleaseFreezeIdentityV2(input.freezeIdentity))
        !== canonicalReleaseJsonV2(freeze)) {
    throw new Error("caller_supplied_freeze_identity_mismatch");
  }
  const preparedPath = safeArtifactPath(root, FREEZE_PREPARED_FILE);
  if (!existsSync(preparedPath)) {
    validateTask0BReleaseFreezeEvidence(storedPreflight, freeze.candidateSha, input.evaluatedAt);
  }
  const preflightSha256 = releaseSha256V2(canonicalBytesV2(preflight));
  const runtimeIdentitySha256 = releaseSha256V2(canonicalBytesV2(preflight.previousRuntimeIdentity));
  const operationKey = releaseSha256V2(canonicalReleaseJsonV2([
    "release_freeze_materialization", freeze.candidateSha,
    freeze.artifactRootFingerprintSha256, preflightSha256
  ]));
  const bootstrapOwner = currentRootWriterOwnerIdentityV2();
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
    leaseEpoch: 1, ownerPid: bootstrapOwner.pid,
    ownerProcessStartFingerprintSha256: bootstrapOwner.processStartFingerprintSha256,
    acquiredAt: input.evaluatedAt, heartbeatAt: input.evaluatedAt,
    expiresAt: new Date(Date.parse(input.evaluatedAt) + 60_000).toISOString()
  };
  const bootstrapLeaseBytes = canonicalBytesV2(bootstrapPayload);
  let freezeBytes = canonicalBytesV2(freeze);
  const materializerTemplateSha256 = MATERIALIZER_TEMPLATE_SHA256;
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
    releaseCompletedReplayLeaseIfOwned(root, bootstrapPayload, input.evaluatedAt);
    return { freezeIdentity: currentVerifiedFreeze(root), receipt };
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
    return { freezeIdentity: currentVerifiedFreeze(root), receipt };
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

function readCanonicalManifestHeadV2(
  root: string,
  freeze: ReleaseFreezeIdentityV2
): { manifest: RemediationReleaseManifestV2; bytes: Buffer } {
  const manifestPath = safeArtifactPath(root, MANIFEST_FILE);
  if (!existsSync(manifestPath)) throw new Error("release_manifest_missing");
  const currentBytes = readFileSync(manifestPath);
  const current = validateRemediationReleaseManifestV2(JSON.parse(currentBytes.toString("utf8")));
  if (!currentBytes.equals(canonicalBytesV2(current))) {
    throw new Error("release_manifest_bytes_noncanonical");
  }
  if (current.candidateSha !== freeze.candidateSha
      || current.planBaseSha !== freeze.planBaseSha
      || current.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || current.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze)) {
    throw new Error("release_manifest_freeze_binding_invalid");
  }

  return { manifest: current, bytes: currentBytes };
}

function validateCanonicalManifestChainHeadV2(
  root: string,
  freeze: ReleaseFreezeIdentityV2,
  head: { manifest: RemediationReleaseManifestV2; bytes: Buffer }
): void {
  let manifest = head.manifest;
  while (true) {
    const receiptPath = safeArtifactPath(root,
      `manifest-transition-receipt-${manifest.latestCommittedReceiptSha256}.json`);
    const receiptBytes = readFileSync(receiptPath);
    if (releaseSha256V2(receiptBytes) !== manifest.latestCommittedReceiptSha256) {
      throw new Error("release_manifest_latest_receipt_hash_invalid");
    }
    const receipt = validateCommittedManifestTransitionReceiptV2(
      JSON.parse(receiptBytes.toString("utf8")));
    if (!receiptBytes.equals(canonicalBytesV2(receipt))) {
      throw new Error("release_manifest_receipt_noncanonical");
    }
    const preparedPath = safeArtifactPath(root,
      `manifest-transition-prepared-${receipt.transitionKeySha256}.json`);
    const preparedBytes = readFileSync(preparedPath);
    const prepared = validatePreparedManifestTransitionV2(
      JSON.parse(preparedBytes.toString("utf8")));
    const embeddedReceiptBytes = Buffer.from(prepared.canonicalCommittedReceiptUtf8Base64, "base64");
    const manifestBytes = canonicalBytesV2(manifest);
    const manifestSha256 = releaseSha256V2(manifestBytes);
    const expectedTargetSnapshotRelativePath =
      `manifest-snapshots/release-manifest-r${manifest.revision}-${manifestSha256}.json`;
    if (!preparedBytes.equals(canonicalBytesV2(prepared))
        || prepared.committedReceiptSha256 !== manifest.latestCommittedReceiptSha256
        || prepared.targetRevision !== manifest.revision
        || prepared.targetSnapshotSha256 !== manifestSha256
        || prepared.targetSnapshotRelativePath !== expectedTargetSnapshotRelativePath
        || !embeddedReceiptBytes.equals(receiptBytes)) {
      throw new Error("release_manifest_prepared_receipt_binding_invalid");
    }
    const targetSnapshotBytes = readFileSync(lifecyclePath(
      root, prepared.targetSnapshotRelativePath));
    if (!targetSnapshotBytes.equals(manifestBytes)) {
      throw new Error("release_manifest_prepared_target_snapshot_binding_invalid");
    }
    const claimPath = safeArtifactPath(root,
      `manifest-transition-claim-${receipt.transitionKeySha256}.json`);
    const claimBytes = readFileSync(claimPath);
    const claim = validateManifestTransitionClaimV2(JSON.parse(claimBytes.toString("utf8")));
    if (!claimBytes.equals(canonicalBytesV2(claim))
        || claim.transitionId !== receipt.transitionId
        || claim.generationId !== freeze.releaseGenerationId
        || claim.sourceManifestSha256 !== receipt.sourceManifestSha256) {
      throw new Error("release_manifest_claim_binding_invalid");
    }
    let source: RemediationReleaseManifestV2 | undefined;
    if (manifest.revision > 1) {
      const sourcePath = lifecyclePath(root,
        `manifest-snapshots/release-manifest-r${manifest.revision - 1}-${manifest.previousManifestSha256}.json`);
      const sourceBytes = readFileSync(sourcePath);
      if (releaseSha256V2(sourceBytes) !== manifest.previousManifestSha256) {
        throw new Error("release_manifest_source_snapshot_hash_invalid");
      }
      source = validateRemediationReleaseManifestV2(JSON.parse(sourceBytes.toString("utf8")));
      if (!sourceBytes.equals(canonicalBytesV2(source))) {
        throw new Error("release_manifest_source_snapshot_noncanonical");
      }
    }
    validateManifestCommittedReceiptBindingV2(manifest, receipt, source);
    if (!source) break;
    manifest = source;
  }
}

function validateCanonicalCurrentManifestChainV2(
  root: string,
  freeze: ReleaseFreezeIdentityV2
): { manifest: RemediationReleaseManifestV2; bytes: Buffer } {
  const head = readCanonicalManifestHeadV2(root, freeze);
  validateCanonicalManifestChainHeadV2(root, freeze, head);
  return head;
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
      const committedBytes = readFileSync(committedPath);
      const committed = validateCommittedOperationalAttestationIssuanceV2(
        JSON.parse(committedBytes.toString("utf8")));
      if (committed.version !== "committed-operational-attestation-issuance-v2"
          || committed.commandId !== "operational_authority_issue"
          || committed.redactedTemplateSha256 !== ISSUER_TEMPLATE_SHA256
          || committed.action !== action
          || committed.generationId !== freeze.releaseGenerationId
          || committed.issuerReceiptSha256 !== issuerReceiptSha256) {
        throw new Error("authority_committed_invalid");
      }
      if (!committedBytes.equals(canonicalBytesV2(committed))) {
        throw new Error("authority_committed_noncanonical");
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
          || !attestationBytes.equals(canonicalBytesV2(authority))
          || !receiptBytes.equals(canonicalBytesV2(issuerReceipt))
          || authority.previousAttestationSha256 !== issuerReceipt.previousAttestationSha256
          || authority.priorTerminalLineageSha256 !== issuerReceipt.priorTerminalLineageSha256
          || issuerReceipt.issuedAt !== authority.issuedAt
          || committed.attestationSha256 !== attestationSha256
          || committed.issuerReceiptSha256 !== issuerReceiptSha256
          || committed.committedAt !== authority.issuedAt
          || committed.issuanceIntentSha256 !== releaseSha256V2(canonicalReleaseJsonV2([
            action, freeze.releaseGenerationId, attestationSha256, issuerReceiptSha256
          ]))) {
        throw new Error("authority_chain_binding_invalid");
      }
      const preparedPath = lifecyclePath(root,
        exactAuthorityRelativePath("prepared", authority, issuerReceiptSha256));
      const preparedBytes = readFileSync(preparedPath);
      const prepared = validatePreparedOperationalAttestationIssuanceV2(
        JSON.parse(preparedBytes.toString("utf8")));
      if (!preparedBytes.equals(canonicalBytesV2(prepared))
          || prepared.canonicalAttestationSha256 !== attestationSha256
          || prepared.canonicalIssuerReceiptSha256 !== issuerReceiptSha256
          || prepared.canonicalCommittedIssuanceSha256 !== releaseSha256V2(canonicalBytesV2(committed))) {
        throw new Error("authority_prepared_bundle_invalid");
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
      || receipt.previousIssuerReceiptSha256 !== previous.issuerReceipt.previousIssuerReceiptSha256
      || receipt.action !== previous.authority.action
      || receipt.generationId !== previous.authority.generationId
      || receipt.candidateSha !== previous.authority.candidateSha
      || receipt.releaseFreezeIdentitySha256 !== previous.authority.releaseFreezeIdentitySha256
      || receipt.sourceManifestSha256 !== previous.authority.sourceManifestSha256
      || receipt.artifactRootFingerprintSha256 !== previous.authority.artifactRootFingerprintSha256
      || receipt.reason !== "expired_unclaimed"
      || receipt.externalEffectCount !== 0) {
    throw new Error("terminal_lineage_unverified");
  }
  return receipt;
}

function objectBindsAuthorityV2(value: unknown, record: CommittedAuthorityRecordV2): boolean {
  if (Array.isArray(value)) return value.some((item) => objectBindsAuthorityV2(item, record));
  if (value === null || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  if ((object.operationalAttestationSha256 === record.attestationSha256
      || object.attestationSha256 === record.attestationSha256)
      && (object.releaseGenerationId === undefined
        || object.releaseGenerationId === record.authority.generationId)
      && (object.candidateSha === undefined || object.candidateSha === record.authority.candidateSha)) {
    return true;
  }
  return Object.values(object).some((item) => objectBindsAuthorityV2(item, record));
}

function authorityUseArtifactPresentV2(root: string, record: CommittedAuthorityRecordV2): boolean {
  const exactConsumption = safeArtifactPath(root,
    `operational-attestation-consumption-${record.attestationSha256}.json`);
  if (existsSync(exactConsumption)) return true;
  return readdirSync(root, { recursive: true, withFileTypes: true }).some((entry) => {
    if (!entry.isFile()) return false;
    const parent = "parentPath" in entry ? String(entry.parentPath) : "";
    const parentRelative = parent ? relative(root, parent).replace(/\\/gu, "/") : "";
    const artifactRelativePath = parentRelative && parentRelative !== "."
      ? `${parentRelative}/${entry.name}` : entry.name;
    if (!artifactRelativePath.split("/").some((segment) => segment.startsWith("production-"))) return false;
    let parsed: unknown;
    try { parsed = readJson(lifecyclePath(root, artifactRelativePath)); }
    catch (error) {
      throw new Error("authority_use_artifact_unverifiable", { cause: error });
    }
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("authority_use_artifact_schema_invalid");
    }
    return objectBindsAuthorityV2(parsed, record);
  });
}

type OperationalAttestationActionV2 = keyof typeof OPERATIONAL_ATTESTATION_POLICY_V2;

const OPERATIONAL_ATTESTATION_TTL_MS_V2: Readonly<Record<OperationalAttestationActionV2, number>> = Object.freeze({
  g12_backup_passed: 60 * 60_000,
  g13_migration_passed: 30 * 60_000,
  g14_rollout_passed: 15 * 60_000,
  g15_canary_released: 40 * 60_000,
  production_failed: 15 * 60_000,
  rollback_rolled_back: 20 * 60_000
});

function exactIssuerInputV2(value: unknown): {
  artifactRoot: string;
  action: OperationalAttestationActionV2;
  faultAt?: string;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("operational_authority_issuer_input_invalid");
  }
  const input = value as Record<string, unknown>;
  exactRecordKeys(input, ["artifactRoot", "action", ...(Object.hasOwn(input, "faultAt") ? ["faultAt"] : [])],
    "operational_authority_issuer_input");
  if (typeof input.artifactRoot !== "string" || typeof input.action !== "string"
      || !(input.action in OPERATIONAL_ATTESTATION_POLICY_V2)
      || (input.faultAt !== undefined
        && !["after_prepare", "after_attestation", "after_receipt"].includes(String(input.faultAt)))) {
    throw new Error("operational_authority_issuer_input_invalid");
  }
  return input as { artifactRoot: string; action: OperationalAttestationActionV2; faultAt?: string };
}

function exactTerminalLineageForAuthorityV2(root: string, record: CommittedAuthorityRecordV2): string | null {
  let directory: string;
  try {
    directory = dirname(lifecyclePath(root,
      exactAuthorityRelativePath("terminal_receipt", record.authority, "0".repeat(64))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT"
        || (error as Error).message === "artifact_parent_missing") return null;
    throw error;
  }
  const matches = readdirSync(directory).sort().filter((filename) => {
    if (!/^[0-9a-f]{64}\.json$/u.test(filename)) throw new Error("terminal_lineage_filename_invalid");
    const sha256 = filename.slice(0, 64);
    try { exactTerminalReceiptV2(root, record, sha256); return true; }
    catch (error) {
      if ((error as Error).message === "terminal_lineage_unverified") return false;
      throw error;
    }
  });
  if (matches.length > 1) throw new Error("terminal_lineage_ambiguous");
  return matches.length === 1 ? matches[0]!.slice(0, 64) : null;
}

type PreparedAuthorityIssuanceV2 = ReturnType<typeof validatePreparedOperationalAttestationIssuanceV2>;

function unresolvedPreparedAuthorityV2(
  root: string,
  freeze: ReleaseFreezeIdentityV2,
  action: OperationalAttestationActionV2,
  sourceManifestSha256: string,
  actionRecords: CommittedAuthorityRecordV2[]
): PreparedAuthorityIssuanceV2 | null {
  const probe = { action, generationId: freeze.releaseGenerationId } as OperationalAttestationV2;
  let directory: string;
  try {
    directory = dirname(lifecyclePath(root, exactAuthorityRelativePath("prepared", probe, "0".repeat(64))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT"
        || (error as Error).message === "artifact_parent_missing") return null;
    throw error;
  }
  const unresolved: PreparedAuthorityIssuanceV2[] = [];
  for (const filename of readdirSync(directory).sort()) {
    if (!/^[0-9a-f]{64}\.json$/u.test(filename)) throw new Error("authority_prepared_filename_invalid");
    const preparedPath = lifecyclePath(root,
      exactAuthorityRelativePath("prepared", probe, filename.slice(0, 64)));
    const preparedBytes = readFileSync(preparedPath);
    const prepared = validatePreparedOperationalAttestationIssuanceV2(JSON.parse(preparedBytes.toString("utf8")));
    if (!preparedBytes.equals(canonicalBytesV2(prepared))) throw new Error("authority_prepared_noncanonical");
    if (lifecycleArtifactExists(root, prepared.canonicalCommittedIssuanceRelativePath)) continue;
    const authority = validateOperationalAttestationV2(prepared.canonicalAttestation, freeze);
    const policy = OPERATIONAL_ATTESTATION_POLICY_V2[action];
    const previous = actionRecords.at(-1) ?? null;
    const terminalSha256 = previous === null ? null : exactTerminalLineageForAuthorityV2(root, previous);
    if (prepared.action !== action || prepared.generationId !== freeze.releaseGenerationId
        || prepared.canonicalIssuerReceiptSha256 !== filename.slice(0, 64)
        || authority.action !== action || authority.sourceManifestSha256 !== sourceManifestSha256
        || authority.commandId !== policy.commandId
        || authority.redactedTemplateSha256 !== operationalAttestationTemplateSha256V2(action)
        || authority.previousAttestationSha256 !== (previous?.attestationSha256 ?? null)
        || authority.priorTerminalLineageSha256 !== terminalSha256
        || (previous !== null && terminalSha256 === null)) {
      throw new Error("authority_prepared_incompatible");
    }
    unresolved.push(prepared);
  }
  if (unresolved.length > 1) throw new Error("authority_prepared_ambiguous");
  return unresolved[0] ?? null;
}

function preparedAuthorityLeasePayloadV2(
  root: string,
  freeze: ReleaseFreezeIdentityV2,
  prepared: PreparedAuthorityIssuanceV2
) {
  return ownerPayload({ evaluatedAt: prepared.preparedAt }, "operational_authority_issue", root, freeze,
    releaseSha256V2(canonicalReleaseJsonV2([
      "operational_authority_issue", prepared.action, prepared.generationId, prepared.canonicalAttestationSha256
    ])));
}

function publishPreparedOperationalAttestationV2(
  root: string,
  freeze: ReleaseFreezeIdentityV2,
  prepared: PreparedAuthorityIssuanceV2,
  expectedChain: { length: number; lastIssuerReceiptSha256: string | null },
  faultAt?: string
) {
  const authority = validateOperationalAttestationV2(prepared.canonicalAttestation, freeze);
  const preparedName = exactAuthorityRelativePath("prepared", authority, prepared.canonicalIssuerReceiptSha256);
  const lease = acquireOrResumeFrozenLease(root, preparedAuthorityLeasePayloadV2(root, freeze, prepared),
    lifecycleArtifactExists(root, preparedName));
  try {
    const lockedActionRecords = committedAuthorityRecordsV2(root, freeze)
      .filter((record) => record.authority.action === authority.action);
    if (lockedActionRecords.length !== expectedChain.length
        || (lockedActionRecords.at(-1)?.issuerReceiptSha256 ?? null) !== expectedChain.lastIssuerReceiptSha256) {
      throw new Error("authority_chain_changed_before_prepare");
    }
    exactReplayOrConflict(root, preparedName, canonicalBytesV2(prepared));
    injectedFault(faultAt, "after_prepare");
    lease.assertOwned();
    exactReplayOrConflict(root, prepared.canonicalAttestationRelativePath,
      Buffer.from(prepared.canonicalAttestationUtf8Base64, "base64"));
    injectedFault(faultAt, "after_attestation");
    exactReplayOrConflict(root, prepared.canonicalIssuerReceiptRelativePath,
      Buffer.from(prepared.canonicalIssuerReceiptUtf8Base64, "base64"));
    injectedFault(faultAt, "after_receipt");
    exactReplayOrConflict(root, prepared.canonicalCommittedIssuanceRelativePath,
      Buffer.from(prepared.canonicalCommittedIssuanceUtf8Base64, "base64"));
    lease.release();
    return { ...authority, attestationSha256: prepared.canonicalAttestationSha256 };
  } catch (error) {
    if (!lifecycleArtifactExists(root, preparedName) && existsSync(lease.path)) lease.release();
    throw error;
  }
}

export async function issueOperationalAttestationV2(input: {
  artifactRoot: string;
  action: OperationalAttestationActionV2;
  faultAt?: string;
}) {
  const exactInput = exactIssuerInputV2(input);
  const root = assertTrustedArtifactRootPathV2(exactInput.artifactRoot);
  const freeze = currentVerifiedFreeze(root);
  const { bytes: currentManifestBytes } = validateCanonicalCurrentManifestChainV2(root, freeze);
  const records = committedAuthorityRecordsV2(root, freeze);
  const actionRecords = records.filter((record) => record.authority.action === exactInput.action);
  const sourceManifestSha256 = releaseSha256V2(currentManifestBytes);
  const unresolved = unresolvedPreparedAuthorityV2(
    root, freeze, exactInput.action, sourceManifestSha256, actionRecords
  );
  if (unresolved !== null) {
    return publishPreparedOperationalAttestationV2(root, freeze, unresolved, {
      length: actionRecords.length,
      lastIssuerReceiptSha256: actionRecords.at(-1)?.issuerReceiptSha256 ?? null
    }, exactInput.faultAt);
  }
  const previous = actionRecords.at(-1) ?? null;
  const priorTerminalLineageSha256 = previous === null ? null : exactTerminalLineageForAuthorityV2(root, previous);
  if (previous !== null && priorTerminalLineageSha256 === null) {
    const bareConsumptionPath = safeArtifactPath(root,
      `operational-attestation-consumption-${previous.attestationSha256}.json`);
    if (existsSync(bareConsumptionPath)) throw new Error("previous_authority_terminal_settlement_required");
    const replayPayload = ownerPayload({ evaluatedAt: previous.authority.issuedAt },
      "operational_authority_issue", root, freeze,
      releaseSha256V2(canonicalReleaseJsonV2([
        "operational_authority_issue", previous.authority.action,
        previous.authority.generationId, previous.attestationSha256
      ])));
    releaseCompletedReplayLeaseIfOwned(root, replayPayload, new Date().toISOString());
    return { ...previous.authority, attestationSha256: previous.attestationSha256 };
  }
  const issuedAt = new Date().toISOString();
  const policy = OPERATIONAL_ATTESTATION_POLICY_V2[exactInput.action];
  const authority = validateOperationalAttestationV2({
    version: "operational-attestation-v2",
    action: exactInput.action,
    generationId: freeze.releaseGenerationId,
    candidateSha: freeze.candidateSha,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
    sourceManifestSha256,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    commandId: policy.commandId,
    redactedTemplateSha256: operationalAttestationTemplateSha256V2(exactInput.action),
    previousAttestationSha256: previous?.attestationSha256 ?? null,
    priorTerminalLineageSha256,
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + OPERATIONAL_ATTESTATION_TTL_MS_V2[exactInput.action]).toISOString()
  }, freeze);
  const bytes = canonicalBytesV2(authority);
  const hash = releaseSha256V2(bytes);
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
  return publishPreparedOperationalAttestationV2(root, freeze, prepared, {
    length: actionRecords.length,
    lastIssuerReceiptSha256: actionRecords.at(-1)?.issuerReceiptSha256 ?? null
  }, exactInput.faultAt);
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
  expectedConsumedAttestationSha256?: string;
}) {
  const root = assertTrustedArtifactRootPathV2(input.artifactRoot);
  const freeze = currentVerifiedFreeze(root);
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
      const atomicClaimPath = safeArtifactPath(root,
        `production-operation-claim-${record.attestationSha256}.json`);
      const replayingExpectedClaim = input.expectedConsumedAttestationSha256 === record.attestationSha256
        && existsSync(atomicClaimPath) && !existsSync(consumptionPath);
      if ((!replayingExpectedClaim && (existsSync(consumptionPath) || existsSync(atomicClaimPath)))
          || terminalReceiptHashesForAuthorityV2(root, record).length !== 0) return false;
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
  if (input.expectedConsumedAttestationSha256 !== undefined
      && selected.attestationSha256 !== input.expectedConsumedAttestationSha256) {
    throw new Error("operational_authority_replay_mismatch");
  }
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

type AbandonedRecoveryEvidenceV2 = Extract<
  ProductionFailureEvidenceV2,
  { evidenceKind: "abandoned_operation_recovery" }
>;

export function assertRecoveryFailureArtifactBindingsV2(input: {
  root: string;
  freeze: ReleaseFreezeIdentityV2;
  sourceManifestSha256: string;
  evidence: AbandonedRecoveryEvidenceV2;
  consumption: OperationalAttestationConsumptionV2;
  consumptionBytes: Buffer;
  claim: ProductionOperationClaimV2;
  claimBytes: Buffer;
}): void {
  const { root, freeze, sourceManifestSha256, evidence, consumption, consumptionBytes, claim, claimBytes } = input;
  const freezeSha256 = releaseFreezeIdentitySha256V2(freeze);
  const consumptionSha256 = releaseSha256V2(consumptionBytes);
  const claimSha256 = releaseSha256V2(claimBytes);
  if (evidence.candidateSha !== freeze.candidateSha
      || evidence.releaseFreezeIdentitySha256 !== freezeSha256
      || evidence.sourceManifestSha256 !== sourceManifestSha256
      || evidence.recoveryAuthorityConsumptionSha256 !== consumptionSha256
      || evidence.recoveryOperationClaimSha256 !== claimSha256
      || evidence.recoveryOperationalAttestationSha256 !== consumption.operationalAttestationSha256) {
    throw new Error("production_recovery_primary_artifact_binding_invalid");
  }

  const preclaim = readCanonicalLifecycleArtifactV2(root,
    `production-authority-preclaim-${claim.operationId}.json`,
    evidence.recoveryAuthorityPreclaimSha256,
    validateProductionAuthorityPreclaimValidationV2,
    "production_recovery_preclaim").value;
  if (preclaim.operationKind !== "recovery" || preclaim.operationId !== claim.operationId
      || preclaim.candidateSha !== freeze.candidateSha
      || preclaim.releaseGenerationId !== freeze.releaseGenerationId
      || preclaim.sourceManifestSha256 !== sourceManifestSha256
      || preclaim.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || preclaim.operationalAttestationSha256 !== evidence.recoveryOperationalAttestationSha256
      || preclaim.recoveryFromAbandonedOperationSha256 !== evidence.priorTerminalAbandonedSha256) {
    throw new Error("production_recovery_preclaim_binding_invalid");
  }

  const recoveryInput = readCanonicalLifecycleArtifactV2(root,
    "production-recovery-input-v2.json", evidence.recoveryInputSha256,
    validateProductionRecoveryInputV2, "production_recovery_input").value;
  if (recoveryInput.recoveryOperationalAttestationSha256 !== evidence.recoveryOperationalAttestationSha256
      || recoveryInput.recoveryProductionLeaseSha256 !== evidence.recoveryProductionLeaseSha256
      || recoveryInput.recoveryAuthorityPreclaimSha256 !== evidence.recoveryAuthorityPreclaimSha256
      || recoveryInput.recoveryOperationClaimSha256 !== evidence.recoveryOperationClaimSha256
      || recoveryInput.recoveryAuthorityConsumptionSha256 !== evidence.recoveryAuthorityConsumptionSha256
      || recoveryInput.priorTerminalAbandonedSha256 !== evidence.priorTerminalAbandonedSha256
      || recoveryInput.priorTerminalCleanupSha256 !== evidence.priorTerminalCleanupSha256
      || recoveryInput.completedStepReceiptPrefixSha256 !== evidence.completedStepReceiptPrefixSha256
      || recoveryInput.uncertainStepMarkerSha256 !== evidence.uncertainStepMarkerSha256) {
    throw new Error("production_recovery_input_evidence_binding_invalid");
  }

  const abandoned = readCanonicalLifecycleArtifactV2(root,
    `production-operation-terminal-abandoned-${recoveryInput.priorOperationId}.json`,
    evidence.priorTerminalAbandonedSha256,
    validateProductionOperationTerminalAbandonedV2,
    "production_recovery_prior_abandoned").value;
  const cleanup = readCanonicalLifecycleArtifactV2(root,
    `production-operation-terminal-cleanup-${recoveryInput.priorOperationId}.json`,
    evidence.priorTerminalCleanupSha256,
    validateProductionOperationTerminalCleanupV2,
    "production_recovery_prior_cleanup").value;
  if (abandoned.operationKind !== recoveryInput.priorOperationKind
      || abandoned.operationId !== recoveryInput.priorOperationId
      || abandoned.candidateSha !== freeze.candidateSha
      || abandoned.releaseGenerationId !== freeze.releaseGenerationId
      || abandoned.sourceManifestSha256 !== sourceManifestSha256
      || abandoned.attemptedExternalEffect !== evidence.priorAttemptedExternalEffect
      || abandoned.reason !== evidence.failureCode
      || cleanup.operationKind !== abandoned.operationKind
      || cleanup.operationId !== abandoned.operationId
      || cleanup.terminalStateSha256 !== evidence.priorTerminalAbandonedSha256) {
    throw new Error("production_recovery_prior_terminal_binding_invalid");
  }

  recoveryInput.completedStepReceiptPrefix.forEach((prefix) => {
    const relativePath = `production-operation-steps/${recoveryInput.priorOperationId}/${prefix.sequence}-${prefix.stepId}-v2.json`;
    const receipt = readCanonicalLifecycleArtifactV2(root, relativePath, prefix.receiptSha256,
      validateProductionOrchestrationStepReceiptV2, "production_recovery_prior_step").value;
    if (receipt.operationId !== recoveryInput.priorOperationId
        || receipt.sequence !== prefix.sequence || receipt.stepId !== prefix.stepId
        || receipt.orchestration !== recoveryInput.priorOperationKind) {
      throw new Error("production_recovery_prior_step_binding_invalid");
    }
  });
  if (recoveryInput.uncertainStepMarker !== null) {
    const marker = recoveryInput.uncertainStepMarker;
    const intent = readCanonicalLifecycleArtifactV2(root, marker.stepIntentRelativePath,
      marker.stepIntentSha256, validateProductionOrchestrationStepIntentV2,
      "production_recovery_uncertain_step_intent").value;
    if (intent.operationId !== recoveryInput.priorOperationId
        || intent.orchestration !== recoveryInput.priorOperationKind
        || intent.sequence !== marker.sequence || intent.stepId !== marker.stepId) {
      throw new Error("production_recovery_uncertain_step_intent_binding_invalid");
    }
  }

  const recoveryReceipt = readCanonicalLifecycleArtifactV2(root,
    "production-recovery-orchestration-receipt-v2.json",
    evidence.recoveryOrchestrationReceiptSha256,
    validateProductionOrchestrationReceiptV2,
    "production_recovery_orchestration_receipt").value;
  if (evidence.failedExecutionEvidenceSha256 !== evidence.recoveryOrchestrationReceiptSha256
      || recoveryReceipt.orchestration !== "recovery"
      || recoveryReceipt.operationId !== claim.operationId
      || recoveryReceipt.operationClaimSha256 !== claimSha256
      || recoveryReceipt.operationalAttestationConsumptionSha256 !== consumptionSha256
      || recoveryReceipt.recoveryInputSha256 !== evidence.recoveryInputSha256
      || recoveryReceipt.finalOperationLeaseSha256 !== evidence.recoveryProductionLeaseSha256
      || recoveryReceipt.priorAttemptedExternalEffect !== evidence.priorAttemptedExternalEffect
      || recoveryReceipt.priorCompletedStepReceiptPrefixSha256 !== evidence.completedStepReceiptPrefixSha256
      || recoveryReceipt.priorUncertainStepMarkerSha256 !== evidence.uncertainStepMarkerSha256) {
    throw new Error("production_recovery_orchestration_evidence_binding_invalid");
  }
  recoveryReceipt.completedStepReceipts.forEach((entry) => {
    const actual = readCanonicalLifecycleArtifactV2(root, entry.relativePath, entry.sha256,
      validateProductionOrchestrationStepReceiptV2, "production_recovery_step_receipt").value;
    if (canonicalReleaseJsonV2(actual) !== canonicalReleaseJsonV2(entry.receipt)) {
      throw new Error("production_recovery_step_receipt_embedding_invalid");
    }
  });
}

function consumedAuthorityHashForTransitionV2(
  root: string,
  freeze: ReleaseFreezeIdentityV2,
  sourceManifestSha256: string,
  transition: AdvanceInput["transition"],
  verifiedTransitionEvidenceValue: unknown,
  verifiedGateOutputsValue: unknown
): string | null {
  const transitionEvidence = validateVerifiedManifestTransitionEvidenceV2(
    verifiedTransitionEvidenceValue
  );
  const recoveryEvidence = transitionEvidence.productionFailureEvidence;
  const isRecoveryFailure = transition.transitionId === "production_failed"
    && recoveryEvidence?.evidenceKind === "abandoned_operation_recovery";
  const policy = transition.transitionId === "production_failed" && !isRecoveryFailure
    ? undefined
    : OPERATIONAL_ATTESTATION_POLICY_V2[
      transition.transitionId as keyof typeof OPERATIONAL_ATTESTATION_POLICY_V2
    ];
  if (!policy) {
    if (transition.operationalAttestation !== undefined
        && transition.operationalAttestation !== null) {
      throw new Error("operational_authority_forbidden_for_transition");
    }
    return null;
  }
  if (transition.operationalAttestation === undefined || transition.operationalAttestation === null) {
    throw new Error("operational_authority_required_for_transition");
  }
  const authority = validateOperationalAttestationV2(transition.operationalAttestation, freeze);
  const hash = authorityHash(authority);
  const records = committedAuthorityRecordsV2(root, freeze)
    .filter((record) => record.authority.action === transition.transitionId);
  const record = records.find((candidate) => candidate.attestationSha256 === hash);
  if (!record || records.at(-1)?.attestationSha256 !== hash
      || authority.sourceManifestSha256 !== sourceManifestSha256
      || authority.commandId !== policy.commandId
      || authority.redactedTemplateSha256
        !== operationalAttestationTemplateSha256V2(
          transition.transitionId as keyof typeof OPERATIONAL_ATTESTATION_POLICY_V2)
      || terminalReceiptHashesForAuthorityV2(root, record).length !== 0) {
    throw new Error("operational_authority_not_committed_transition_tip");
  }
  const standaloneGateId = transition.transitionId === "g12_backup_passed"
    ? "G12_PRODUCTION_BACKUP" : transition.transitionId === "g13_migration_passed"
      ? "G13_PRODUCTION_MIGRATION" : null;
  if (standaloneGateId !== null) {
    if (!Array.isArray(verifiedGateOutputsValue) || verifiedGateOutputsValue.length !== 1) {
      throw new Error("standalone_production_gate_output_invalid");
    }
    const gate = validateReleaseGateV2(verifiedGateOutputsValue[0]);
    if (gate.id !== standaloneGateId || (gate.state !== "passed" && gate.state !== "failed")) {
      throw new Error("standalone_production_gate_output_invalid");
    }
    const bytesByRelativePath = new Map<string, Buffer>();
    for (const ref of gate.evidence) {
      bytesByRelativePath.set(ref.relativePath,
        readFileSync(safeArtifactRelativePath(root, ref.relativePath)));
    }
    validateGateEvidenceBytesV2(gate, bytesByRelativePath, {
      releaseGenerationId: freeze.releaseGenerationId,
      artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
      releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
      sourceManifestSha256
    });
    const attestation = gate.evidence.find((ref) => ref.kind === "operational_attestation");
    if (!attestation || attestation.sha256 !== hash) {
      throw new Error("standalone_production_authority_binding_invalid");
    }
    const genericConsumptionPath = safeArtifactPath(root,
      `operational-attestation-consumption-${hash}.json`);
    const genericClaimPath = safeArtifactPath(root, `production-operation-claim-${hash}.json`);
    if (existsSync(genericConsumptionPath) || existsSync(genericClaimPath)) {
      throw new Error("standalone_production_consumption_conflict");
    }
    return hash;
  }
  const consumptionPath = safeArtifactPath(root,
    `operational-attestation-consumption-${hash}.json`);
  const claimPath = safeArtifactPath(root, `production-operation-claim-${hash}.json`);
  if (!existsSync(claimPath)) {
    throw new Error("operational_authority_not_atomically_consumed");
  }
  const claimBytes = readFileSync(claimPath);
  const claim = validateProductionOperationClaimV2(JSON.parse(claimBytes.toString("utf8")));
  const consumption = validateOperationalAttestationConsumptionV2(claim.authorityConsumption);
  const consumptionBytes = canonicalBytesV2(consumption);
  if (existsSync(consumptionPath) && !readFileSync(consumptionPath).equals(consumptionBytes)) {
    throw new Error("operational_attestation_consumption_conflict");
  }
  if (consumption.candidateSha !== freeze.candidateSha
      || consumption.releaseGenerationId !== freeze.releaseGenerationId
      || consumption.sourceManifestSha256 !== sourceManifestSha256
      || consumption.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || consumption.operationalAttestationSha256 !== hash
      || consumption.operationalAttestationIssuerReceiptSha256 !== record.issuerReceiptSha256
      || consumption.commandId !== policy.commandId
      || consumption.redactedTemplateSha256 !== authority.redactedTemplateSha256
      || !consumptionBytes.equals(canonicalBytesV2(consumption))) {
    throw new Error("operational_attestation_consumption_binding_invalid");
  }
  if (claim.operationId !== consumption.operationId
      || claim.candidateSha !== freeze.candidateSha
      || claim.releaseGenerationId !== freeze.releaseGenerationId
      || claim.sourceManifestSha256 !== sourceManifestSha256
      || claim.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || claim.operationalAttestationSha256 !== hash
      || claim.operationalAttestationIssuerReceiptSha256 !== record.issuerReceiptSha256
      || canonicalReleaseJsonV2(claim.authorityConsumption) !== canonicalReleaseJsonV2(consumption)
      || claim.authorityConsumptionSha256 !== releaseSha256V2(consumptionBytes)
      || !claimBytes.equals(canonicalBytesV2(claim))) {
    throw new Error("production_operation_claim_binding_invalid");
  }
  if (isRecoveryFailure) {
    if (recoveryEvidence === undefined
        || claim.capability !== "recovery_only"
        || consumption.operationKind !== "recovery"
        || consumption.commandId !== "production_recovery"
        || recoveryEvidence.recoveryOperationalAttestationSha256 !== hash) {
      throw new Error("production_recovery_operation_binding_invalid");
    }
    const failureRefs = transitionEvidence.refs.filter(
      (ref) => ref.kind === "production_failure_evidence"
    );
    const recoveryBytes = canonicalBytesV2(recoveryEvidence);
    if (failureRefs.length !== 1
        || failureRefs[0]!.relativePath !== "production-failure-evidence-v2.json"
        || failureRefs[0]!.sha256 !== releaseSha256V2(recoveryBytes)) {
      throw new Error("production_recovery_failure_ref_binding_invalid");
    }
    const evidencePath = lifecyclePath(root, failureRefs[0]!.relativePath);
    if (!existsSync(evidencePath) || !readFileSync(evidencePath).equals(recoveryBytes)) {
      throw new Error("production_recovery_failure_evidence_bytes_invalid");
    }
    assertRecoveryFailureArtifactBindingsV2({
      root, freeze, sourceManifestSha256, evidence: recoveryEvidence,
      consumption, consumptionBytes, claim, claimBytes
    });
  }
  return hash;
}

export async function terminalizeExpiredOperationalAttestationV2(input: {
  artifactRoot: string;
  authority: unknown;
  evaluatedAt: string;
  observedArtifacts?: string[];
}) {
  const root = assertTrustedArtifactRootPathV2(input.artifactRoot);
  const freeze = currentVerifiedFreeze(root);
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
  if (authority.action === "g13_migration_passed") {
    throw new Error("g13_terminalization_database_absence_unverified");
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
    if (authorityUseArtifactPresentV2(root, record)) {
      throw new Error("authority_has_effect_or_claim_artifact");
    }
    exactReplayOrConflict(root, preparedName, prepared);
    lease.assertOwned();
    if (authorityUseArtifactPresentV2(root, record)) {
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
}) {
  const allowed = process.platform === "win32"
    ? new Set(["windows-service-localsystem-administrators-v1", "windows-configured-canonical-set-v1"])
    : new Set(["posix-owner-only-v1"]);
  if (!allowed.has(input.principalPolicyId)) {
    throw new Error("artifact_root_trust_rejected");
  }
  const root = assertTrustedArtifactRootPathV2(input.artifactRoot);
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
  const expectedTargetSnapshotRelativePath =
    `manifest-snapshots/release-manifest-r${prepared.targetRevision}-${prepared.targetSnapshotSha256}.json`;
  if (prepared.targetSnapshotRelativePath !== expectedTargetSnapshotRelativePath) {
    throw new Error("prepared_transition_target_snapshot_path_invalid");
  }
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
  const root = assertTrustedArtifactRootPathV2(input.artifactRoot);
  if (input.rootState === "terminal_abandoned") throw new Error("release_root_sealed");
  if (existsSync(safeArtifactPath(root, ROOT_SEALED_FILE))) throw new Error("release_root_sealed");
  const source = validateRemediationReleaseManifestV2(input.sourceManifest);
  const manifestPath = safeArtifactPath(root, MANIFEST_FILE);
  const freeze = currentVerifiedFreeze(root);
  if (freeze.candidateSha !== source.candidateSha
      || freeze.artifactRootFingerprintSha256 !== source.artifactRootFingerprintSha256
      || releaseFreezeIdentitySha256V2(freeze) !== source.releaseFreezeIdentitySha256) {
    throw new Error("manifest_freeze_binding_invalid");
  }
  const sourceShaForKey = releaseSha256V2(canonicalBytesV2(source));
  if (!existsSync(manifestPath)) throw new Error("manifest_source_absent");
  const currentHeadBeforeClaim = readCanonicalManifestHeadV2(root, freeze);
  const currentManifestBeforeClaim = currentHeadBeforeClaim.manifest;
  const currentManifestShaBeforeClaim = releaseSha256V2(currentHeadBeforeClaim.bytes);
  const operationalAuthoritySha256 = consumedAuthorityHashForTransitionV2(
    root, freeze, sourceShaForKey, input.transition, input.verifiedTransitionEvidence,
    input.verifiedGateOutputs);
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

  if (currentManifestShaBeforeClaim === sourceShaForKey) {
    validateCanonicalManifestChainHeadV2(root, freeze, currentHeadBeforeClaim);
  } else if (existsSync(preparedPath)) {
    const sourceSnapshotPath = lifecyclePath(root,
      `manifest-snapshots/release-manifest-r${source.revision}-${sourceShaForKey}.json`);
    const sourceSnapshotBytes = readFileSync(sourceSnapshotPath);
    if (!sourceSnapshotBytes.equals(canonicalBytesV2(source))) {
      throw new Error("manifest_source_snapshot_noncanonical");
    }
    validateCanonicalManifestChainHeadV2(root, freeze, {
      manifest: source,
      bytes: sourceSnapshotBytes
    });
  }

  if (existsSync(preparedPath)) {
    const built = loadPreparedManifestResult(root, preparedPath, source, freeze, transitionKey, input);
    if (currentManifestShaBeforeClaim !== sourceShaForKey
        && (!currentHeadBeforeClaim.bytes.equals(built.targetBytes)
          || currentManifestShaBeforeClaim !== built.prepared.targetSnapshotSha256)) {
      throw new Error("prepared_transition_current_head_target_mismatch");
    }
    const receiptName = `manifest-transition-receipt-${String(built.prepared.committedReceiptSha256)}.json`;
    const completedReceiptPath = safeArtifactPath(root, receiptName);
    if (existsSync(manifestPath) && existsSync(completedReceiptPath)
        && currentManifestShaBeforeClaim === releaseSha256V2(built.targetBytes)
        && readFileSync(completedReceiptPath).equals(built.receiptBytes)) {
      validateCanonicalCurrentManifestChainV2(root, freeze);
      releaseCompletedReplayLeaseIfOwned(root, leasePayload,
        input.evaluatedAt ?? input.transition.evaluatedAt ?? new Date().toISOString());
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
        claimantProcessStartFingerprintSha256: CURRENT_PROCESS_START_FINGERPRINT_SHA256
      });
    }
    exactReplayOrConflict(root, String(built.prepared.targetSnapshotRelativePath), built.targetBytes);
    exactReplayOrConflict(root, preparedName, built.preparedBytes);
    injectedFault(input.faultAt, "before_manifest_replace");
    lease.assertOwned();
    if (existsSync(safeArtifactPath(root, "production-operation-root.lease.json"))) {
      throw new Error("production_operation_lease_active");
    }
    const currentHead = existsSync(manifestPath)
      ? readCanonicalManifestHeadV2(root, freeze) : null;
    const currentSource = currentHead?.manifest ?? null;
    const currentHash = currentHead ? releaseSha256V2(currentHead.bytes) : null;
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
  const root = assertTrustedArtifactRootPathV2(input.artifactRoot);
  const freeze = currentVerifiedFreeze(root);
  if (freeze.releaseGenerationId !== input.expectedGenerationId) throw new Error("release_generation_mismatch");
  if (existsSync(safeArtifactPath(root, ROOT_SEALED_FILE))) throw new Error("release_root_sealed");
  const manifestPath = safeArtifactPath(root, MANIFEST_FILE);
  const leasePath = safeArtifactPath(root, ROOT_WRITER_LEASE_FILE);
  let leaseState: "absent" | "live" | "expired" = "absent";
  if (existsSync(leasePath)) {
    const lease = validateBoundedRootWriterLeaseV2(readJson(leasePath));
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
  const parsedOldLease = validateBoundedRootWriterLeaseV2(JSON.parse(input.oldBytes.toString("utf8")));
  if (!input.oldBytes.equals(canonicalBytesV2(parsedOldLease))) {
    throw new Error("frozen_old_lease_noncanonical");
  }
  const oldLease = parsedOldLease as FrozenRootWriterLeaseV2;
  if (oldLease.version !== "frozen-root-writer-lease-v2") throw new Error("frozen_lease_required");
  const freeze = currentVerifiedFreeze(input.root);
  const freezeSha256 = releaseFreezeIdentitySha256V2(freeze);
  if (oldLease.releaseGenerationId !== freeze.releaseGenerationId
      || oldLease.candidateSha !== freeze.candidateSha
      || oldLease.protectedRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || oldLease.releaseFreezeIdentitySha256 !== freezeSha256) {
    throw new Error("old_lease_freeze_binding_mismatch");
  }
  if (Date.parse(input.evaluatedAt) < Date.parse(oldLease.expiresAt)) throw new Error("root_writer_lease_not_expired");
  if (isLeaseOwnerProcessAliveV2(oldLease.ownerPid, oldLease.ownerProcessStartFingerprintSha256)) {
    throw new Error("root_writer_owner_still_alive");
  }
  const operationPrepared = hasExactPreparedOperationForLease(input.root, oldLease);

  const oldHash = releaseSha256V2(input.oldBytes);
  if (oldHash !== input.expectedOldLeaseSha256) throw new Error("root_writer_lease_hash_mismatch");
  const preparedName = `manifest-transition-root.frozen-takeover-prepared-${oldHash}.json`;
  const tombstoneName = `manifest-transition-root.lease-tombstone-${oldHash}.json`;
  const preparedPath = safeArtifactPath(input.root, preparedName);
  let newLease: typeof oldLease;
  let newBytes: Buffer;
  let preparedBytes: Buffer;
  let prepared: PreparedFrozenRootWriterLeaseTakeoverV2;
  if (existsSync(preparedPath)) {
    prepared = validatePreparedFrozenRootWriterLeaseTakeoverV2(readJson(preparedPath));
    if (prepared.oldLeaseSha256 !== oldHash
        || prepared.oldLeaseEpoch !== oldLease.leaseEpoch
        || prepared.oldOwnerProcessIdentitySha256 !== rootWriterOwnerProcessIdentitySha256V2(
          oldLease.ownerPid, oldLease.ownerProcessStartFingerprintSha256)
        || prepared.writerOperationKind !== oldLease.writerOperationKind
        || prepared.writerOperationKeySha256 !== oldLease.writerOperationKeySha256
        || prepared.transitionKeySha256 !== oldLease.transitionKeySha256
        || prepared.artifactRootFingerprintSha256 !== oldLease.protectedRootFingerprintSha256
        || prepared.candidateSha !== oldLease.candidateSha
        || prepared.releaseGenerationId !== oldLease.releaseGenerationId
        || prepared.releaseFreezeIdentitySha256 !== oldLease.releaseFreezeIdentitySha256) {
      throw new Error("prepared_takeover_old_lease_conflict");
    }
    newBytes = Buffer.from(prepared.canonicalNewLeaseUtf8Base64, "base64");
    newLease = prepared.canonicalNewLease;
    preparedBytes = readFileSync(preparedPath);
    if (!preparedBytes.equals(canonicalBytesV2(prepared))) {
      throw new Error("prepared_takeover_noncanonical");
    }
  } else {
    const currentOwner = currentRootWriterOwnerIdentityV2();
    newLease = validateBoundedRootWriterLeaseV2({
      ...oldLease,
      leaseEpoch: oldLease.leaseEpoch + 1,
      ownerPid: currentOwner.pid,
      ownerProcessStartFingerprintSha256: currentOwner.processStartFingerprintSha256,
      acquiredAt: input.evaluatedAt,
      heartbeatAt: input.evaluatedAt,
      expiresAt: new Date(Date.parse(input.evaluatedAt) + 60_000).toISOString()
    }) as FrozenRootWriterLeaseV2;
    newBytes = canonicalBytesV2(newLease);
    prepared = validatePreparedFrozenRootWriterLeaseTakeoverV2({
      version: "prepared-frozen-root-writer-lease-takeover-v2",
      commandId: "manifest_lease_takeover",
      redactedTemplateSha256: MANIFEST_LEASE_TAKEOVER_TEMPLATE_SHA256_V2,
      candidateSha: oldLease.candidateSha,
      releaseGenerationId: oldLease.releaseGenerationId,
      releaseFreezeIdentitySha256: oldLease.releaseFreezeIdentitySha256,
      artifactRootFingerprintSha256: oldLease.protectedRootFingerprintSha256,
      writerOperationKind: oldLease.writerOperationKind,
      writerOperationKeySha256: oldLease.writerOperationKeySha256,
      transitionKeySha256: oldLease.transitionKeySha256,
      oldLeaseSha256: oldHash,
      oldLeaseEpoch: oldLease.leaseEpoch,
      oldOwnerProcessIdentitySha256: rootWriterOwnerProcessIdentitySha256V2(
        oldLease.ownerPid, oldLease.ownerProcessStartFingerprintSha256),
      canonicalNewLease: newLease,
      canonicalNewLeaseUtf8Base64: newBytes.toString("base64"),
      newLeaseSha256: releaseSha256V2(newBytes),
      newLeaseEpoch: newLease.leaseEpoch,
      preparedAt: input.evaluatedAt
    });
    preparedBytes = canonicalBytesV2(prepared);
    writeExclusiveDurable(preparedPath, preparedBytes);
  }
  const existingTakeoverReceipts = readdirSync(input.root)
    .filter((name) => name.startsWith("manifest-transition-root.frozen-takeover-receipt-"))
    .map((name) => {
      const receiptBytes = readFileSync(safeArtifactPath(input.root, name));
      const receipt = validateFrozenRootWriterLeaseTakeoverReceiptV2(
        JSON.parse(receiptBytes.toString("utf8"))
      );
      if (!receiptBytes.equals(canonicalBytesV2(receipt))
          || name !== `manifest-transition-root.frozen-takeover-receipt-${releaseSha256V2(receiptBytes)}.json`) {
        throw new Error("frozen_takeover_receipt_noncanonical");
      }
      return { name, receipt };
    })
    .filter(({ receipt }) => receipt.oldLeaseSha256 === oldHash);
  for (const item of existingTakeoverReceipts) {
    validateFrozenRootWriterLeaseTakeoverReceiptV2(item.receipt, prepared);
  }
  if (existingTakeoverReceipts.length > 1) throw new Error("frozen_takeover_receipt_ambiguous");
  if (existingTakeoverReceipts.length === 1) {
    const leasePath = safeArtifactPath(input.root, ROOT_WRITER_LEASE_FILE);
    if (existsSync(leasePath) && !readFileSync(leasePath).equals(newBytes)) throw new Error("new_lease_conflict");
    const replayReceipt = existingTakeoverReceipts[0]!.receipt;
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
        observedAt: replayReceipt.committedAt
      }));
      if (existsSync(leasePath)) unlinkDurable(leasePath);
      return {
        newLease, receipt: replayReceipt,
        preparedSha256: releaseSha256V2(preparedBytes), sealed: true
      };
    }
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
        newLease, receipt: replayReceipt,
        preparedSha256: releaseSha256V2(preparedBytes), sealed: true
      };
    }
    return {
      newLease,
      receipt: replayReceipt,
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
  } else {
    if (!readFileSync(tombstonePath).equals(input.oldBytes)) throw new Error("old_lease_tombstone_conflict");
    if (existsSync(leasePath) && readFileSync(leasePath).equals(input.oldBytes)) {
      moveNoOverwriteDurable(leasePath, tombstonePath);
    }
  }
  injectedFault(input.faultAt, "after_tombstone");

  if (!existsSync(leasePath)) writeExclusiveDurable(leasePath, newBytes);
  else if (!readFileSync(leasePath).equals(newBytes)) throw new Error("new_lease_conflict");
  injectedFault(input.faultAt, "after_new_lease");
  const receipt = validateFrozenRootWriterLeaseTakeoverReceiptV2({
    version: "frozen-root-writer-lease-takeover-receipt-v2",
    commandId: "manifest_lease_takeover",
    redactedTemplateSha256: MANIFEST_LEASE_TAKEOVER_TEMPLATE_SHA256_V2,
    candidateSha: oldLease.candidateSha,
    releaseGenerationId: oldLease.releaseGenerationId,
    releaseFreezeIdentitySha256: oldLease.releaseFreezeIdentitySha256,
    artifactRootFingerprintSha256: oldLease.protectedRootFingerprintSha256,
    writerOperationKind: oldLease.writerOperationKind,
    writerOperationKeySha256: oldLease.writerOperationKeySha256,
    transitionKeySha256: oldLease.transitionKeySha256,
    preparedTakeoverSha256: releaseSha256V2(preparedBytes),
    oldLeaseSha256: oldHash,
    tombstoneRelativePath: tombstoneName,
    newLeaseSha256: releaseSha256V2(newBytes),
    newLeaseEpoch: newLease.leaseEpoch,
    committedAt: input.evaluatedAt
  }, prepared);
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
  const root = assertTrustedArtifactRootPathV2(input.artifactRoot);
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
  const parsedLease = validateBoundedRootWriterLeaseV2(old);
  if (!bytes.equals(canonicalBytesV2(parsedLease))) {
    throw new Error("old_root_writer_lease_noncanonical");
  }
  const oldEpoch = Number(old.leaseEpoch ?? old.epoch);
  const oldPid = Number(old.ownerPid ?? old.pid);
  const expiresAt = String(old.expiresAt ?? "");
  if (!Number.isSafeInteger(oldEpoch) || oldEpoch < 1 || !Number.isSafeInteger(oldPid)
      || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(input.evaluatedAt) < Date.parse(expiresAt)) {
    throw new Error("root_writer_lease_not_takeover_eligible");
  }
  const oldOwnerFingerprint = String(old.ownerProcessStartFingerprintSha256 ?? "");
  if (isLeaseOwnerProcessAliveV2(oldPid, oldOwnerFingerprint)) {
    throw new Error("root_writer_owner_still_alive");
  }
  if (old.version === "bootstrap-root-writer-lease-v2") {
    const parsedOld = validateBoundedRootWriterLeaseV2(old) as BootstrapRootWriterLeaseV2;
    if (!bytes.equals(canonicalBytesV2(parsedOld))) {
      throw new Error("bootstrap_old_lease_noncanonical");
    }
    const oldHash = releaseSha256V2(bytes);
    const preparedName = `manifest-transition-root.bootstrap-takeover-prepared-${oldHash}.json`;
    const tombstoneName = `manifest-transition-root.lease-tombstone-${oldHash}.json`;
    const preparedPath = safeArtifactPath(root, preparedName);
    const preparedFreezeExists = existsSync(safeArtifactPath(root, FREEZE_PREPARED_FILE));
    const preparedFreezeMaterializationSha256 = preparedFreezeExists
      ? releaseSha256V2(readFileSync(safeArtifactPath(root, FREEZE_PREPARED_FILE))) : null;
    let newLease: BootstrapRootWriterLeaseV2;
    let newBytes: Buffer;
    let prepared: PreparedBootstrapRootWriterLeaseTakeoverV2;
    if (existsSync(preparedPath)) {
      prepared = validatePreparedBootstrapRootWriterLeaseTakeoverV2(readJson(preparedPath));
      if (prepared.oldLeaseSha256 !== oldHash
          || prepared.oldLeaseEpoch !== parsedOld.leaseEpoch
          || prepared.oldOwnerProcessIdentitySha256 !== rootWriterOwnerProcessIdentitySha256V2(
            parsedOld.ownerPid, parsedOld.ownerProcessStartFingerprintSha256)
          || prepared.protectedRootFingerprintSha256 !== parsedOld.protectedRootFingerprintSha256
          || prepared.task0BPreflightEvidenceSha256 !== parsedOld.task0BPreflightEvidenceSha256
          || prepared.candidateSha !== parsedOld.candidateSha
          || prepared.runtimeIdentitySha256 !== parsedOld.runtimeIdentitySha256
          || prepared.preparedFreezeMaterializationSha256 !== preparedFreezeMaterializationSha256) {
        throw new Error("prepared_bootstrap_takeover_conflict");
      }
      newBytes = Buffer.from(prepared.canonicalNewLeaseUtf8Base64, "base64");
      newLease = prepared.canonicalNewLease;
      if (!readFileSync(preparedPath).equals(canonicalBytesV2(prepared))) {
        throw new Error("prepared_bootstrap_takeover_noncanonical");
      }
    } else {
      const currentOwner = currentRootWriterOwnerIdentityV2();
      newLease = validateBoundedRootWriterLeaseV2({
        ...parsedOld,
        leaseEpoch: oldEpoch + 1,
        ownerPid: currentOwner.pid,
        ownerProcessStartFingerprintSha256: currentOwner.processStartFingerprintSha256,
        acquiredAt: input.evaluatedAt,
        heartbeatAt: input.evaluatedAt,
        expiresAt: new Date(Date.parse(input.evaluatedAt) + 60_000).toISOString()
      }) as BootstrapRootWriterLeaseV2;
      newBytes = canonicalBytesV2(newLease);
      prepared = validatePreparedBootstrapRootWriterLeaseTakeoverV2({
        version: "prepared-bootstrap-root-writer-lease-takeover-v2",
        commandId: "manifest_lease_takeover",
        redactedTemplateSha256: MANIFEST_LEASE_TAKEOVER_TEMPLATE_SHA256_V2,
        protectedRootFingerprintSha256: parsedOld.protectedRootFingerprintSha256,
        task0BPreflightEvidenceSha256: parsedOld.task0BPreflightEvidenceSha256,
        candidateSha: parsedOld.candidateSha,
        runtimeIdentitySha256: parsedOld.runtimeIdentitySha256,
        preparedFreezeMaterializationSha256,
        oldLeaseSha256: oldHash,
        oldLeaseEpoch: oldEpoch,
        oldOwnerProcessIdentitySha256: rootWriterOwnerProcessIdentitySha256V2(
          parsedOld.ownerPid, parsedOld.ownerProcessStartFingerprintSha256),
        canonicalNewLease: newLease,
        canonicalNewLeaseUtf8Base64: newBytes.toString("base64"),
        newLeaseSha256: releaseSha256V2(newBytes),
        newLeaseEpoch: oldEpoch + 1,
        preparedAt: input.evaluatedAt
      });
      exactReplayOrConflict(root, preparedName, canonicalBytesV2(prepared));
    }
    const bootstrapTakeoverReceipts = readdirSync(root)
      .filter((name) => name.startsWith("manifest-transition-root.bootstrap-takeover-receipt-"))
      .map((name) => {
        const receiptBytes = readFileSync(safeArtifactPath(root, name));
        const receipt = validateBootstrapRootWriterLeaseTakeoverReceiptV2(
          JSON.parse(receiptBytes.toString("utf8"))
        );
        if (!receiptBytes.equals(canonicalBytesV2(receipt))
            || name !== `manifest-transition-root.bootstrap-takeover-receipt-${releaseSha256V2(receiptBytes)}.json`) {
          throw new Error("bootstrap_takeover_receipt_noncanonical");
        }
        return receipt;
      })
      .filter((receipt) => receipt.oldLeaseSha256 === oldHash);
    for (const receipt of bootstrapTakeoverReceipts) {
      validateBootstrapRootWriterLeaseTakeoverReceiptV2(receipt, prepared);
    }
    if (bootstrapTakeoverReceipts.length > 1) throw new Error("bootstrap_takeover_receipt_ambiguous");
    if (bootstrapTakeoverReceipts.length === 1) {
      if (existsSync(path) && !readFileSync(path).equals(newBytes)) throw new Error("new_lease_conflict");
      const receipt = bootstrapTakeoverReceipts[0]!;
      if (!preparedFreezeExists) {
        exactReplayOrConflict(root, BOOTSTRAP_SEALED_FILE, canonicalBytesV2({
          version: "bootstrap-root-terminal-abandoned-v2",
          protectedRootFingerprintSha256: parsedOld.protectedRootFingerprintSha256,
          task0BPreflightEvidenceSha256: parsedOld.task0BPreflightEvidenceSha256,
          candidateSha: parsedOld.candidateSha,
          runtimeIdentitySha256: parsedOld.runtimeIdentitySha256,
          bootstrapTakeoverReceiptSha256: releaseSha256V2(canonicalBytesV2(receipt)),
          preparedFreezeMaterializationSha256: null,
          removedBootstrapLeaseSha256: oldHash,
          removedBootstrapLeaseEpoch: oldEpoch,
          reason: "owner_died_before_freeze_prepare", rootSealed: true,
          retryRequiresNewProtectedRoot: true, abandonedAt: receipt.committedAt
        }));
        if (existsSync(path)) unlinkDurable(path);
      }
      return {
        sealed: !preparedFreezeExists,
        newLease,
        receipt
      };
    }
    injectedFault(input.faultAt, "after_prepare");
    const tombstonePath = safeArtifactPath(root, tombstoneName);
    if (!existsSync(tombstonePath)) {
      if (!existsSync(path) || !readFileSync(path).equals(bytes)) throw new Error("old_lease_binding_mismatch");
      moveNoOverwriteDurable(path, tombstonePath);
    } else {
      if (!readFileSync(tombstonePath).equals(bytes)) throw new Error("old_lease_tombstone_conflict");
      if (existsSync(path) && readFileSync(path).equals(bytes)) moveNoOverwriteDurable(path, tombstonePath);
    }
    injectedFault(input.faultAt, "after_tombstone");
    if (!existsSync(path)) writeExclusiveDurable(path, newBytes);
    else if (!readFileSync(path).equals(newBytes)) throw new Error("new_lease_conflict");
    injectedFault(input.faultAt, "after_new_lease");
    const preparedBytes = canonicalBytesV2(prepared);
    const receipt = validateBootstrapRootWriterLeaseTakeoverReceiptV2({
      version: "bootstrap-root-writer-lease-takeover-receipt-v2",
      commandId: "manifest_lease_takeover",
      redactedTemplateSha256: MANIFEST_LEASE_TAKEOVER_TEMPLATE_SHA256_V2,
      protectedRootFingerprintSha256: parsedOld.protectedRootFingerprintSha256,
      task0BPreflightEvidenceSha256: parsedOld.task0BPreflightEvidenceSha256,
      candidateSha: parsedOld.candidateSha,
      runtimeIdentitySha256: parsedOld.runtimeIdentitySha256,
      preparedFreezeMaterializationSha256,
      preparedTakeoverSha256: releaseSha256V2(preparedBytes),
      oldLeaseSha256: oldHash,
      tombstoneRelativePath: tombstoneName,
      newLeaseSha256: releaseSha256V2(newBytes), newLeaseEpoch: oldEpoch + 1,
      committedAt: input.evaluatedAt
    }, prepared);
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

export function isLeaseOwnerProcessAliveV2(pid: number, expectedStartFingerprintSha256: string): boolean {
  const injected = ROOT_WRITER_PROCESS_RUNTIME_V2.getStore();
  if (injected) return injected.isOwnerAlive(pid, expectedStartFingerprintSha256);
  try { process.kill(pid, 0); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
  const observed = observedProcessStartFingerprintSha256V2(pid);
  // An alive PID with an unreadable identity is not safe to take over.
  return observed === null || observed === expectedStartFingerprintSha256;
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
    assertTrustedArtifactRootPathV2(artifactRoot);
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
  const expectedTargetSnapshotRelativePath =
    `manifest-snapshots/release-manifest-r${prepared.targetRevision}-${prepared.targetSnapshotSha256}.json`;
  if (prepared.targetSnapshotRelativePath !== expectedTargetSnapshotRelativePath) {
    throw new Error("initial_prepared_target_snapshot_path_invalid");
  }
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
  const root = assertTrustedArtifactRootPathV2(input.artifactRoot);
  const manifestPath = safeArtifactPath(root, MANIFEST_FILE);
  const freeze = currentVerifiedFreeze(root);
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
      releaseCompletedReplayLeaseIfOwned(root, leasePayload, input.evaluatedAt);
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
      claimantProcessStartFingerprintSha256: CURRENT_PROCESS_START_FINGERPRINT_SHA256
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
  const freeze = currentVerifiedFreeze(root);
  const files = readdirSync(root).sort();
  return { releaseGenerationId: freeze.releaseGenerationId, files };
}

export async function persistPostgresManifestTransitionV2(
  client: ClientBase,
  input: {
    artifactRoot: string;
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
  if (Object.prototype.hasOwnProperty.call(input, "releaseGenerationId")) {
    throw new Error("postgres_manifest_caller_generation_forbidden");
  }
  const root = assertTrustedArtifactRootPathV2(input.artifactRoot);
  const freeze = currentVerifiedFreeze(root);
  const releaseGenerationId = freeze.releaseGenerationId;
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
      from plan5_release_manifest_v2_cas where release_generation_id=$1`, [releaseGenerationId]);
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
  if (source.candidateSha !== freeze.candidateSha
      || source.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || source.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze)) {
    throw new Error("postgres_manifest_freeze_binding_invalid");
  }
  const target = reduceRemediationReleaseManifestV2(source, input.transition,
    input.verifiedGateOutputs, input.verifiedTransitionEvidence);
  const targetBytes = canonicalBytesV2(target);
  const result = await client.query(`update plan5_release_manifest_v2_cas set
    revision=$2, current_manifest_sha256=$4, current_manifest_json=$5::jsonb,
    current_manifest_utf8_base64=$6, evaluated_at=$7::timestamptz
  where release_generation_id=$1 and revision=$3 and current_manifest_sha256=$8
  returning revision`, [releaseGenerationId, target.revision, input.sourceRevision,
    releaseSha256V2(targetBytes), JSON.stringify(target), targetBytes.toString("base64"),
    input.evaluatedAt, input.sourceManifestSha256]);
  if (result.rowCount !== 1) throw new Error("postgres_manifest_transition_cas_conflict");
  return target;
}

export async function initializePostgresManifestStateV2(
  client: ClientBase,
  input: { artifactRoot: string; sourceManifestBytes: Buffer; evaluatedAt: string }
) {
  if (Object.prototype.hasOwnProperty.call(input, "releaseGenerationId")) {
    throw new Error("postgres_manifest_caller_generation_forbidden");
  }
  const root = assertTrustedArtifactRootPathV2(input.artifactRoot);
  const freeze = currentVerifiedFreeze(root);
  const releaseGenerationId = freeze.releaseGenerationId;
  const source = validateRemediationReleaseManifestV2(JSON.parse(input.sourceManifestBytes.toString("utf8")));
  if (!input.sourceManifestBytes.equals(canonicalBytesV2(source))) throw new Error("postgres_manifest_source_noncanonical");
  if (source.candidateSha !== freeze.candidateSha
      || source.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || source.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze)) {
    throw new Error("postgres_manifest_freeze_binding_invalid");
  }
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
    releaseGenerationId, source.revision, sourceSha256, JSON.stringify(source),
    input.sourceManifestBytes.toString("base64"), input.evaluatedAt
  ]);
  if (result.rowCount !== 1) throw new Error("postgres_manifest_source_already_initialized");
  return { source, sourceSha256 };
}
