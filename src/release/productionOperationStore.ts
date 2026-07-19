import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  canonicalReleaseJsonV2,
  releaseFreezeIdentitySha256V2,
  releaseSha256V2,
  rootWriterOwnerProcessIdentitySha256V2,
  validateCleanupOnlyProductionOperationTakeoverV2,
  validateCommittedProductionOperationLeaseTakeoverV2,
  validateOperationalAttestationV2,
  validateOperationalAttestationConsumptionV2,
  validatePreparedCleanupOnlyProductionOperationTakeoverV2,
  validatePreparedProductionOperationLeaseRemovalV2,
  validatePreparedProductionOperationLeaseTakeoverV2,
  validateProductionAuthorityPreclaimValidationV2,
  validateProductionOperationClaimV2,
  validateProductionOperationLeaseRemovalReceiptV2,
  validateProductionOperationLeaseV2,
  validateProductionOperationSettlementV2,
  validateProductionOperationTerminalAbandonedV2,
  validateProductionOperationTerminalCleanupV2,
  validateProductionOrchestrationStepIntentV2,
  validateProductionOrchestrationStepReceiptV2,
  validateProductionPreclaimLeaseLineageV2,
  validateReleaseFreezeIdentityV2,
  validateRemediationReleaseManifestV2,
  type CleanupOnlyProductionOperationTakeoverV2,
  type CommittedProductionOperationLeaseTakeoverV2,
  type OperationalAttestationV2,
  type PreparedCleanupOnlyProductionOperationTakeoverV2,
  type PreparedProductionOperationLeaseRemovalV2,
  type PreparedProductionOperationLeaseTakeoverV2,
  type ProductionAuthorityPreclaimValidationV2,
  type ProductionOperationCapabilityV2,
  type ProductionOperationClaimV2,
  type ProductionOperationKindV2,
  type ProductionOperationLeaseRemovalReceiptV2,
  type ProductionOperationLeaseV2,
  type ProductionOperationSettlementV2,
  type ProductionOperationTerminalAbandonedV2,
  type ProductionOperationTerminalCleanupV2,
  type ProductionOrchestrationStepIntentV2,
  type ProductionOrchestrationStepReceiptV2,
  type ProductionPreclaimLeaseLineageV2
} from "./remediationReleaseManifestV2";
import {
  currentRootWriterOwnerIdentityV2,
  isLeaseOwnerProcessAliveV2,
  selectOperationalAttestationFromStoreV2
} from "./releaseManifestStoreV2";
import {
  ROOT_WRITER_LEASE_FILE,
  assertArtifactRootOutsideRepository,
  assertTrustedArtifactRootPathV2,
  canonicalBytesV2,
  moveNoOverwriteDurable,
  safeArtifactPath,
  safeArtifactRelativePath,
  unlinkDurable,
  writeExclusiveDurable
} from "./releaseRootWriterStore";

export const PRODUCTION_OPERATION_LEASE_FILE_V2 = "production-operation-root.lease.json";
export const PRODUCTION_OPERATION_TAKEOVER_TEMPLATE_SHA256_V2 = createHash("sha256")
  .update("release:production:lease:takeover <expected-old-lease-sha256> <protected-artifact-root>", "utf8")
  .digest("hex");
export const PRODUCTION_OPERATION_CLEANUP_ONLY_TAKEOVER_TEMPLATE_SHA256_V2 = createHash("sha256")
  .update("release:production:lease:cleanup-only-takeover <expected-old-lease-sha256> <protected-artifact-root>", "utf8")
  .digest("hex");

const SHA256 = /^[0-9a-f]{64}$/u;
const OPERATION_ID = /^production-(?:rollout|canary|rollback|recovery)-[0-9a-f]{64}$/u;
const OPERATION_DEADLINE_MS: Readonly<Record<ProductionOperationKindV2, number>> = Object.freeze({
  rollout: 10 * 60_000,
  canary: 35 * 60_000,
  rollback: 15 * 60_000,
  recovery: 5 * 60_000
});
const OPERATION_ACTION = Object.freeze({
  rollout: "g14_rollout_passed",
  canary: "g15_canary_released",
  rollback: "rollback_rolled_back",
  recovery: "production_failed"
} as const);
const OPERATION_CAPABILITY: Readonly<Record<ProductionOperationKindV2,
  "effect_capable" | "recovery_only">> = Object.freeze({
  rollout: "effect_capable", canary: "effect_capable",
  rollback: "effect_capable", recovery: "recovery_only"
});
const ALLOWED_NESTED_ROOTS = new Set([
  "production-preclaim-lease-lineages",
  "production-operation-step-intents",
  "production-operation-steps"
]);

export type ProductionOperationStoreRecordV2 = Readonly<{
  kind: string;
  relativePath: string;
  sha256: string;
  created: boolean;
}>;

export type BeginProductionOperationInputV2 = Readonly<{
  operationKind: ProductionOperationKindV2;
  evaluatedAt: string;
  recoveryFromAbandonedOperationSha256?: string | null;
}>;

export type BegunProductionOperationV2 = Readonly<{
  selectedAuthority: OperationalAttestationV2;
  selectedAuthoritySha256: string;
  selectedAuthorityIssuerReceiptSha256: string;
  lease: ProductionOperationLeaseV2;
  leaseSha256: string;
  preclaim: ProductionAuthorityPreclaimValidationV2;
  preclaimSha256: string;
  lineage: ProductionPreclaimLeaseLineageV2;
  lineageSha256: string;
  claim: ProductionOperationClaimV2;
  claimSha256: string;
}>;

export type ProductionOperationStoreOptionsV2 = Readonly<{
  repositoryRoot?: string;
}>;

type Validator<T> = (value: unknown) => T;

function parseIso(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label}_invalid`);
  }
  return parsed;
}

function exactSha(value: string, label: string): string {
  if (!SHA256.test(value)) throw new Error(`${label}_invalid`);
  return value;
}

function exactOperationId(value: string): string {
  if (!OPERATION_ID.test(value)) throw new Error("production_operation_id_invalid");
  return value;
}

function injectedFault(name: string | undefined, expected: string): void {
  if (name === expected) throw new Error(`injected_fault_${expected}`);
}

function exactReplayOrConflict(path: string, bytes: Buffer, conflict: string): void {
  if (existsSync(path)) {
    if (!readFileSync(path).equals(bytes)) throw new Error(conflict);
    return;
  }
  writeExclusiveDurable(path, bytes);
}

function readCanonical<T>(path: string, validator: Validator<T>, label: string): { value: T; bytes: Buffer; sha256: string } {
  const bytes = readFileSync(path);
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch (error) { throw new Error(`${label}_json_invalid`, { cause: error }); }
  const value = validator(parsed);
  if (!bytes.equals(canonicalBytesV2(value))) throw new Error(`${label}_noncanonical`);
  return { value, bytes, sha256: releaseSha256V2(bytes) };
}

function operationOwnerSha(lease: ProductionOperationLeaseV2): string {
  return rootWriterOwnerProcessIdentitySha256V2(
    lease.ownerPid,
    lease.ownerProcessStartFingerprintSha256
  );
}

export function deriveProductionOperationIdV2(input: {
  operationKind: ProductionOperationKindV2;
  candidateSha: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  releaseGenerationId: string;
  commandId: string;
  redactedTemplateSha256: string;
  operationalAttestationSha256: string;
  recoveryFromAbandonedOperationSha256: string | null;
}): string {
  return `production-${input.operationKind}-${releaseSha256V2(canonicalReleaseJsonV2([
    "production-operation-v2", input.operationKind, input.candidateSha,
    input.sourceManifestSha256, input.artifactRootFingerprintSha256,
    input.releaseGenerationId, input.commandId, input.redactedTemplateSha256,
    input.operationalAttestationSha256, input.recoveryFromAbandonedOperationSha256
  ]))}`;
}

export class ProductionOperationStoreV2 {
  readonly #root: string;

  constructor(root: string, options: ProductionOperationStoreOptionsV2 = {}) {
    this.#root = assertTrustedArtifactRootPathV2(root);
    assertArtifactRootOutsideRepository(this.#root, resolve(options.repositoryRoot ?? process.cwd()));
  }

  get artifactRoot(): string { return this.#root; }

  #path(relativePath: string, createParents = false): string {
    const segments = relativePath.split("/");
    if (segments.length === 1) return safeArtifactPath(this.#root, relativePath);
    if (!ALLOWED_NESTED_ROOTS.has(segments[0]!)) throw new Error("production_operation_directory_forbidden");
    const allowedDirectories = segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
    return safeArtifactRelativePath(this.#root, relativePath, { createParents, allowedDirectories });
  }

  #assertManifestWriterAbsent(): void {
    if (existsSync(safeArtifactPath(this.#root, ROOT_WRITER_LEASE_FILE))) {
      throw new Error("manifest_root_writer_lease_active");
    }
  }

  #readLease(): { value: ProductionOperationLeaseV2; bytes: Buffer; sha256: string } {
    return readCanonical(this.#path(PRODUCTION_OPERATION_LEASE_FILE_V2),
      validateProductionOperationLeaseV2, "production_operation_lease");
  }

  #assertLeaseBinding(lease: ProductionOperationLeaseV2, expected: {
    operationId: string;
    candidateSha: string;
    releaseGenerationId: string;
    sourceManifestSha256: string;
    artifactRootFingerprintSha256: string;
    operationalAttestationSha256: string;
    recoveryFromAbandonedOperationSha256: string | null;
  }): void {
    if (lease.operationId !== expected.operationId || lease.candidateSha !== expected.candidateSha
        || lease.releaseGenerationId !== expected.releaseGenerationId
        || lease.sourceManifestSha256 !== expected.sourceManifestSha256
        || lease.artifactRootFingerprintSha256 !== expected.artifactRootFingerprintSha256
        || lease.operationalAttestationSha256 !== expected.operationalAttestationSha256
        || lease.recoveryFromAbandonedOperationSha256 !== expected.recoveryFromAbandonedOperationSha256) {
      throw new Error("production_operation_lease_binding_invalid");
    }
  }

  #readFreezeAndManifest(): {
    candidateSha: string;
    releaseGenerationId: string;
    artifactRootFingerprintSha256: string;
    sourceManifestSha256: string;
  } {
    const freeze = readCanonical(this.#path("release-freeze-identity-v2.json"),
      validateReleaseFreezeIdentityV2, "release_freeze_identity").value;
    const manifest = readCanonical(this.#path("release-manifest.json"),
      validateRemediationReleaseManifestV2, "release_manifest");
    if (manifest.value.candidateSha !== freeze.candidateSha
        || manifest.value.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
        || manifest.value.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze)) {
      throw new Error("production_operation_manifest_freeze_binding_invalid");
    }
    return {
      candidateSha: freeze.candidateSha,
      releaseGenerationId: freeze.releaseGenerationId,
      artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
      sourceManifestSha256: manifest.sha256
    };
  }

  persistExclusive(kind: string, relativePath: string, value: unknown): ProductionOperationStoreRecordV2 {
    if (!kind) throw new Error("production_operation_artifact_kind_invalid");
    const path = this.#path(relativePath, true);
    const bytes = canonicalBytesV2(value);
    const created = !existsSync(path);
    exactReplayOrConflict(path, bytes, "production_operation_artifact_conflict");
    return { kind, relativePath, sha256: releaseSha256V2(bytes), created };
  }

  acquireLease(value: unknown): ProductionOperationStoreRecordV2 {
    const lease = validateProductionOperationLeaseV2(value);
    const owner = currentRootWriterOwnerIdentityV2();
    if (lease.ownerPid !== owner.pid
        || lease.ownerProcessStartFingerprintSha256 !== owner.processStartFingerprintSha256) {
      throw new Error("production_operation_owner_identity_invalid");
    }
    const rollingMs = parseIso(lease.expiresAt, "production_operation_lease_expires_at")
      - parseIso(lease.heartbeatAt, "production_operation_lease_heartbeat_at");
    if (rollingMs > 60_000) throw new Error("production_operation_lease_ttl_invalid");
    this.#assertManifestWriterAbsent();
    const record = this.persistExclusive("production_operation_lease", PRODUCTION_OPERATION_LEASE_FILE_V2, lease);
    try { this.#assertManifestWriterAbsent(); }
    catch (error) {
      if (existsSync(this.#path(PRODUCTION_OPERATION_LEASE_FILE_V2))
          && releaseSha256V2(readFileSync(this.#path(PRODUCTION_OPERATION_LEASE_FILE_V2))) === record.sha256) {
        unlinkDurable(this.#path(PRODUCTION_OPERATION_LEASE_FILE_V2));
      }
      throw error;
    }
    return record;
  }

  releaseLease(expectedSha256: string): void {
    const path = this.#path(PRODUCTION_OPERATION_LEASE_FILE_V2);
    if (!existsSync(path)) throw new Error("production_operation_lease_missing");
    const lease = this.#readLease();
    const owner = currentRootWriterOwnerIdentityV2();
    if (lease.value.ownerPid !== owner.pid
        || lease.value.ownerProcessStartFingerprintSha256 !== owner.processStartFingerprintSha256) {
      throw new Error("production_operation_owner_identity_invalid");
    }
    if (lease.sha256 !== exactSha(expectedSha256, "production_operation_expected_lease_sha")) {
      throw new Error("production_operation_lease_fence_invalid");
    }
    unlinkDurable(path);
  }

  #resolveLineage(
    preclaim: ProductionAuthorityPreclaimValidationV2,
    currentLease: { value: ProductionOperationLeaseV2; sha256: string },
    resolvedAt: string
  ): { value: ProductionPreclaimLeaseLineageV2; sha256: string } {
    const firstPath = `production-preclaim-lease-lineages/${preclaim.operationId}/${preclaim.originalLeaseSha256}.json`;
    const first = validateProductionPreclaimLeaseLineageV2({
      version: "production-preclaim-lease-lineage-v2",
      operationId: preclaim.operationId,
      relativePath: firstPath,
      preclaimValidationSha256: releaseSha256V2(canonicalBytesV2(preclaim)),
      previousLineageSha256: null,
      originalLeaseSha256: preclaim.originalLeaseSha256,
      originalLeaseEpoch: preclaim.originalLeaseEpoch,
      originalLeaseOwnerProcessIdentitySha256: preclaim.originalLeaseOwnerProcessIdentitySha256,
      committedTakeoverReceiptSuffixSha256s: [],
      currentTipLeaseSha256: preclaim.originalLeaseSha256,
      currentTipLeaseEpoch: preclaim.originalLeaseEpoch,
      currentTipLeaseOwnerProcessIdentitySha256: preclaim.originalLeaseOwnerProcessIdentitySha256,
      lineageStartedAt: preclaim.checkedAt,
      resolvedAt: preclaim.checkedAt
    });
    this.persistExclusive("production_preclaim_lease_lineage", firstPath, first);
    let current = { value: first, sha256: releaseSha256V2(canonicalBytesV2(first)) };
    if (currentLease.sha256 === preclaim.originalLeaseSha256) return current;

    const receipts = this.#normalTakeoverReceipts();
    let tipSha = preclaim.originalLeaseSha256;
    let tipEpoch = preclaim.originalLeaseEpoch;
    let tipOwner = preclaim.originalLeaseOwnerProcessIdentitySha256;
    const visited = new Set<string>();
    while (tipSha !== currentLease.sha256) {
      if (visited.has(tipSha)) throw new Error("production_preclaim_lineage_cycle");
      visited.add(tipSha);
      const matches = receipts.filter((receipt) => receipt.value.oldLeaseSha256 === tipSha);
      if (matches.length !== 1) throw new Error("production_preclaim_takeover_chain_invalid");
      const next = matches[0]!;
      if (next.value.newLeaseEpoch !== tipEpoch + 1) throw new Error("production_preclaim_takeover_epoch_invalid");
      const tombstone = readCanonical(this.#path(next.value.tombstoneRelativePath),
        validateProductionOperationLeaseV2, "production_operation_tombstone");
      if (tombstone.sha256 !== tipSha || tombstone.value.leaseEpoch !== tipEpoch) {
        throw new Error("production_preclaim_takeover_tombstone_invalid");
      }
      const nextLease = next.value.newLeaseSha256 === currentLease.sha256
        ? currentLease.value
        : this.#leaseFromPrepared(next.value.oldLeaseSha256);
      const nextOwner = operationOwnerSha(nextLease);
      const path = `production-preclaim-lease-lineages/${preclaim.operationId}/${next.value.newLeaseSha256}.json`;
      const lineage = validateProductionPreclaimLeaseLineageV2({
        version: "production-preclaim-lease-lineage-v2",
        operationId: preclaim.operationId,
        relativePath: path,
        preclaimValidationSha256: releaseSha256V2(canonicalBytesV2(preclaim)),
        previousLineageSha256: current.sha256,
        // The strict V2 validator models each append as previous-tip -> next-tip.
        originalLeaseSha256: tipSha,
        originalLeaseEpoch: tipEpoch,
        originalLeaseOwnerProcessIdentitySha256: tipOwner,
        committedTakeoverReceiptSuffixSha256s: [next.sha256],
        currentTipLeaseSha256: next.value.newLeaseSha256,
        currentTipLeaseEpoch: next.value.newLeaseEpoch,
        currentTipLeaseOwnerProcessIdentitySha256: nextOwner,
        lineageStartedAt: current.value.lineageStartedAt,
        resolvedAt
      });
      this.persistExclusive("production_preclaim_lease_lineage", path, lineage);
      current = { value: lineage, sha256: releaseSha256V2(canonicalBytesV2(lineage)) };
      tipSha = next.value.newLeaseSha256;
      tipEpoch = next.value.newLeaseEpoch;
      tipOwner = nextOwner;
    }
    return current;
  }

  #leaseFromPrepared(oldLeaseSha256: string): ProductionOperationLeaseV2 {
    const path = this.#path(`production-operation-root.lease-takeover-prepared-${oldLeaseSha256}.json`);
    return readCanonical(path, validatePreparedProductionOperationLeaseTakeoverV2,
      "prepared_production_operation_takeover").value.canonicalNewLease;
  }

  #normalTakeoverReceipts(): Array<{ value: CommittedProductionOperationLeaseTakeoverV2; sha256: string }> {
    return readdirSync(this.#root).filter((name) =>
      name.startsWith("production-operation-root.lease-takeover-committed-") && name.endsWith(".json"))
      .map((name) => {
        const parsed = readCanonical(this.#path(name), validateCommittedProductionOperationLeaseTakeoverV2,
          "committed_production_operation_takeover");
        if (name !== `production-operation-root.lease-takeover-committed-${parsed.sha256}.json`) {
          throw new Error("production_operation_takeover_committed_filename_invalid");
        }
        return { value: parsed.value, sha256: parsed.sha256 };
      });
  }

  async beginOperation(input: BeginProductionOperationInputV2): Promise<BegunProductionOperationV2> {
    const evaluatedAtMs = parseIso(input.evaluatedAt, "production_operation_evaluated_at");
    const operationKind = input.operationKind;
    if (!(operationKind in OPERATION_ACTION)) throw new Error("production_operation_kind_invalid");
    const recoveryFrom = input.recoveryFromAbandonedOperationSha256 ?? null;
    if ((operationKind === "recovery") !== (recoveryFrom !== null)) {
      throw new Error("production_operation_recovery_lineage_invalid");
    }
    if (recoveryFrom !== null) exactSha(recoveryFrom, "production_operation_recovery_lineage");
    const identity = this.#readFreezeAndManifest();
    const action = OPERATION_ACTION[operationKind];
    const deadlineMs = OPERATION_DEADLINE_MS[operationKind];
    const existingLease = existsSync(this.#path(PRODUCTION_OPERATION_LEASE_FILE_V2))
      ? this.#readLease() : null;
    if (existingLease !== null
        && (existingLease.value.operationKind !== operationKind
          || existingLease.value.candidateSha !== identity.candidateSha
          || existingLease.value.releaseGenerationId !== identity.releaseGenerationId
          || existingLease.value.sourceManifestSha256 !== identity.sourceManifestSha256
          || existingLease.value.artifactRootFingerprintSha256 !== identity.artifactRootFingerprintSha256
          || existingLease.value.recoveryFromAbandonedOperationSha256 !== recoveryFrom
          || existingLease.value.capability !== OPERATION_CAPABILITY[operationKind])) {
      throw new Error("production_operation_existing_lease_conflict");
    }
    const operationDeadlineAt = existingLease?.value.operationDeadlineAt
      ?? new Date(evaluatedAtMs + deadlineMs).toISOString();
    const remainingOperationMs = Date.parse(operationDeadlineAt) - evaluatedAtMs;
    if (remainingOperationMs <= 0) throw new Error("production_operation_deadline_reached");
    const selected = selectOperationalAttestationFromStoreV2({
      artifactRoot: this.#root,
      action,
      expectedSourceManifestSha256: identity.sourceManifestSha256,
      evaluatedAt: input.evaluatedAt,
      minimumRemainingValidityMs: existingLease === null ? deadlineMs : remainingOperationMs,
      expectedConsumedAttestationSha256: existingLease?.value.operationalAttestationSha256
    });
    const authority = selected.authority;
    if (Date.parse(authority.expiresAt) < Date.parse(operationDeadlineAt)) {
      throw new Error("production_authority_insufficient_validity");
    }
    if (existingLease !== null
        && existingLease.value.operationalAttestationSha256 !== selected.attestationSha256) {
      throw new Error("production_operation_existing_authority_conflict");
    }
    const operationId = deriveProductionOperationIdV2({
      operationKind,
      ...identity,
      commandId: authority.commandId,
      redactedTemplateSha256: authority.redactedTemplateSha256,
      operationalAttestationSha256: selected.attestationSha256,
      recoveryFromAbandonedOperationSha256: recoveryFrom
    });
    const binding = {
      operationId,
      candidateSha: identity.candidateSha,
      releaseGenerationId: identity.releaseGenerationId,
      sourceManifestSha256: identity.sourceManifestSha256,
      artifactRootFingerprintSha256: identity.artifactRootFingerprintSha256,
      operationalAttestationSha256: selected.attestationSha256,
      recoveryFromAbandonedOperationSha256: recoveryFrom
    };
    const preclaimPath = `production-authority-preclaim-${operationId}.json`;
    const claimPath = `production-operation-claim-${selected.attestationSha256}.json`;
    if (existingLease === null
        && (existsSync(this.#path(preclaimPath)) || existsSync(this.#path(claimPath))
          || existsSync(this.#path(`production-operation-settlement-${operationId}.json`))
          || existsSync(this.#path(`production-operation-terminal-abandoned-${operationId}.json`))
          || existsSync(this.#path(`production-operation-terminal-cleanup-${operationId}.json`)))) {
      throw new Error("production_operation_orphaned_or_terminal_state");
    }
    const owner = currentRootWriterOwnerIdentityV2();
    let lease: { value: ProductionOperationLeaseV2; bytes: Buffer; sha256: string };
    if (existingLease !== null) {
      lease = existingLease;
      this.#assertLeaseBinding(lease.value, binding);
      if (lease.value.ownerPid !== owner.pid
          || lease.value.ownerProcessStartFingerprintSha256 !== owner.processStartFingerprintSha256) {
        throw new Error("production_operation_lease_owned_by_other_process");
      }
    } else {
      const leaseValue = validateProductionOperationLeaseV2({
        version: "production-operation-lease-v2",
        scope: "artifact_root_production_operation",
        relativePath: PRODUCTION_OPERATION_LEASE_FILE_V2,
        operationKind,
        operationId,
        candidateSha: identity.candidateSha,
        releaseGenerationId: identity.releaseGenerationId,
        sourceManifestSha256: identity.sourceManifestSha256,
        artifactRootFingerprintSha256: identity.artifactRootFingerprintSha256,
        operationalAttestationSha256: selected.attestationSha256,
        recoveryFromAbandonedOperationSha256: recoveryFrom,
        capability: OPERATION_CAPABILITY[operationKind],
        leaseEpoch: 1,
        ownerPid: owner.pid,
        ownerProcessStartFingerprintSha256: owner.processStartFingerprintSha256,
        acquiredAt: input.evaluatedAt,
        heartbeatAt: input.evaluatedAt,
        expiresAt: new Date(Math.min(evaluatedAtMs + 60_000,
          Date.parse(authority.expiresAt), Date.parse(operationDeadlineAt))).toISOString(),
        operationDeadlineAt
      });
      const record = this.acquireLease(leaseValue);
      lease = { value: leaseValue, bytes: canonicalBytesV2(leaseValue), sha256: record.sha256 };
    }
    this.#assertManifestWriterAbsent();

    if (!existsSync(this.#path(preclaimPath))) {
      const originalLease = lease.value.leaseEpoch === 1
        ? { sha256: lease.sha256, ownerSha256: operationOwnerSha(lease.value) }
        : this.#originalLeaseForOperation(operationId);
      const preclaimValue = validateProductionAuthorityPreclaimValidationV2({
        version: "production-authority-preclaim-validation-v2",
        operationKind,
        operationId,
        candidateSha: identity.candidateSha,
        releaseGenerationId: identity.releaseGenerationId,
        sourceManifestSha256: identity.sourceManifestSha256,
        artifactRootFingerprintSha256: identity.artifactRootFingerprintSha256,
        operationalAttestationSha256: selected.attestationSha256,
        operationalAttestationIssuerReceiptSha256: selected.issuerReceiptSha256,
        recoveryFromAbandonedOperationSha256: recoveryFrom,
        commandId: authority.commandId,
        redactedTemplateSha256: authority.redactedTemplateSha256,
        originalLeaseSha256: originalLease.sha256,
        originalLeaseEpoch: 1,
        originalLeaseOwnerProcessIdentitySha256: originalLease.ownerSha256,
        checkedAt: input.evaluatedAt,
        expiresAt: authority.expiresAt,
        operationDeadlineAt,
        minimumRequiredValidityMs: remainingOperationMs,
        status: "fresh_compatible_unconsumed"
      });
      this.persistExclusive("production_authority_preclaim", preclaimPath, preclaimValue);
    }
    const storedPreclaim = readCanonical(this.#path(preclaimPath), validateProductionAuthorityPreclaimValidationV2,
      "production_authority_preclaim");
    if (storedPreclaim.value.operationId !== operationId
        || storedPreclaim.value.originalLeaseEpoch !== 1
        || storedPreclaim.value.operationalAttestationSha256 !== selected.attestationSha256
        || storedPreclaim.value.operationalAttestationIssuerReceiptSha256 !== selected.issuerReceiptSha256
        || storedPreclaim.value.operationDeadlineAt !== operationDeadlineAt) {
      throw new Error("production_authority_preclaim_binding_invalid");
    }
    if (existsSync(this.#path(claimPath))) {
      const claim = readCanonical(this.#path(claimPath), validateProductionOperationClaimV2,
        "production_operation_claim");
      if (claim.value.operationId !== operationId
          || claim.value.authorityConsumption.preclaimValidationSha256 !== storedPreclaim.sha256
          || evaluatedAtMs >= Date.parse(claim.value.authorityConsumption.expiresAt)
          || evaluatedAtMs >= Date.parse(claim.value.operationDeadlineAt)) {
        throw new Error("production_operation_claim_conflict");
      }
      this.#verifyNormalTakeoverChain(claim.value, lease);
      const lineage = readCanonical(this.#path(claim.value.preclaimLeaseLineageRelativePath),
        validateProductionPreclaimLeaseLineageV2, "production_preclaim_lease_lineage");
      return {
        selectedAuthority: authority,
        selectedAuthoritySha256: selected.attestationSha256,
        selectedAuthorityIssuerReceiptSha256: selected.issuerReceiptSha256,
        lease: lease.value,
        leaseSha256: lease.sha256,
        preclaim: storedPreclaim.value,
        preclaimSha256: storedPreclaim.sha256,
        lineage: lineage.value,
        lineageSha256: lineage.sha256,
        claim: claim.value,
        claimSha256: claim.sha256
      };
    }
    const selectedAgain = selectOperationalAttestationFromStoreV2({
      artifactRoot: this.#root,
      action,
      expectedSourceManifestSha256: identity.sourceManifestSha256,
      evaluatedAt: input.evaluatedAt,
      minimumRemainingValidityMs: remainingOperationMs
    });
    if (selectedAgain.attestationSha256 !== selected.attestationSha256
        || selectedAgain.issuerReceiptSha256 !== selected.issuerReceiptSha256) {
      throw new Error("production_authority_selection_changed");
    }
    const currentLease = this.#readLease();
    this.#assertLeaseBinding(currentLease.value, binding);
    if (currentLease.value.ownerPid !== owner.pid
        || currentLease.value.ownerProcessStartFingerprintSha256 !== owner.processStartFingerprintSha256
        || evaluatedAtMs >= Date.parse(authority.expiresAt)
        || evaluatedAtMs >= Date.parse(operationDeadlineAt)) {
      throw new Error("production_operation_claim_fence_invalid");
    }
    const lineage = this.#resolveLineage(storedPreclaim.value, currentLease, input.evaluatedAt);
    const consumption = validateOperationalAttestationConsumptionV2({
      version: "operational-attestation-consumption-v2",
      operationKind,
      operationId,
      candidateSha: identity.candidateSha,
      releaseGenerationId: identity.releaseGenerationId,
      sourceManifestSha256: identity.sourceManifestSha256,
      artifactRootFingerprintSha256: identity.artifactRootFingerprintSha256,
      operationalAttestationSha256: selected.attestationSha256,
      operationalAttestationIssuerReceiptSha256: selected.issuerReceiptSha256,
      recoveryFromAbandonedOperationSha256: recoveryFrom,
      preclaimValidationSha256: storedPreclaim.sha256,
      preclaimLeaseLineageRelativePath: lineage.value.relativePath,
      preclaimLeaseLineageSha256: lineage.sha256,
      preclaimLeaseLineageCurrentTipSha256: currentLease.sha256,
      commandId: authority.commandId,
      redactedTemplateSha256: authority.redactedTemplateSha256,
      leaseSha256AtConsumption: currentLease.sha256,
      leaseEpochAtConsumption: currentLease.value.leaseEpoch,
      consumedAt: input.evaluatedAt,
      expiresAt: authority.expiresAt,
      operationDeadlineAt
    });
    const consumptionSha256 = releaseSha256V2(canonicalBytesV2(consumption));
    const claimValue = validateProductionOperationClaimV2({
      version: "production-operation-claim-v2",
      operationKind,
      operationId,
      candidateSha: identity.candidateSha,
      releaseGenerationId: identity.releaseGenerationId,
      sourceManifestSha256: identity.sourceManifestSha256,
      artifactRootFingerprintSha256: identity.artifactRootFingerprintSha256,
      operationalAttestationSha256: selected.attestationSha256,
      operationalAttestationIssuerReceiptSha256: selected.issuerReceiptSha256,
      recoveryFromAbandonedOperationSha256: recoveryFrom,
      authorityConsumption: consumption,
      authorityConsumptionSha256: consumptionSha256,
      preclaimLeaseLineageRelativePath: lineage.value.relativePath,
      preclaimLeaseLineageSha256: lineage.sha256,
      preclaimLeaseLineageCurrentTipSha256: currentLease.sha256,
      capability: OPERATION_CAPABILITY[operationKind],
      leaseEpochAtConsumption: currentLease.value.leaseEpoch,
      operationDeadlineAt,
      claimedAt: input.evaluatedAt,
      claimantPid: owner.pid,
      claimantProcessStartFingerprintSha256: owner.processStartFingerprintSha256
    });
    const claimRecord = this.persistExclusive("production_operation_claim", claimPath, claimValue);
    return {
      selectedAuthority: authority,
      selectedAuthoritySha256: selected.attestationSha256,
      selectedAuthorityIssuerReceiptSha256: selected.issuerReceiptSha256,
      lease: currentLease.value,
      leaseSha256: currentLease.sha256,
      preclaim: storedPreclaim.value,
      preclaimSha256: storedPreclaim.sha256,
      lineage: lineage.value,
      lineageSha256: lineage.sha256,
      claim: claimValue,
      claimSha256: claimRecord.sha256
    };
  }

  #claimForLease(lease: ProductionOperationLeaseV2): {
    value: ProductionOperationClaimV2; bytes: Buffer; sha256: string;
  } | null {
    const path = this.#path(`production-operation-claim-${lease.operationalAttestationSha256}.json`);
    if (!existsSync(path)) return null;
    const claim = readCanonical(path, validateProductionOperationClaimV2, "production_operation_claim");
    if (claim.value.operationId !== lease.operationId
        || claim.value.operationKind !== lease.operationKind
        || claim.value.candidateSha !== lease.candidateSha
        || claim.value.releaseGenerationId !== lease.releaseGenerationId
        || claim.value.sourceManifestSha256 !== lease.sourceManifestSha256
        || claim.value.artifactRootFingerprintSha256 !== lease.artifactRootFingerprintSha256
        || claim.value.operationalAttestationSha256 !== lease.operationalAttestationSha256
        || claim.value.recoveryFromAbandonedOperationSha256 !== lease.recoveryFromAbandonedOperationSha256
        || claim.value.operationDeadlineAt !== lease.operationDeadlineAt
        || claim.value.capability !== (lease.operationKind === "recovery" ? "recovery_only" : "effect_capable")
        || releaseSha256V2(canonicalBytesV2(claim.value.authorityConsumption))
          !== claim.value.authorityConsumptionSha256) {
      throw new Error("production_operation_claim_binding_invalid");
    }
    return claim;
  }

  #preclaimForLease(lease: ProductionOperationLeaseV2): {
    value: ProductionAuthorityPreclaimValidationV2; bytes: Buffer; sha256: string;
  } {
    const preclaim = readCanonical(
      this.#path(`production-authority-preclaim-${lease.operationId}.json`),
      validateProductionAuthorityPreclaimValidationV2,
      "production_authority_preclaim"
    );
    if (preclaim.value.operationId !== lease.operationId
        || preclaim.value.operationKind !== lease.operationKind
        || preclaim.value.candidateSha !== lease.candidateSha
        || preclaim.value.releaseGenerationId !== lease.releaseGenerationId
        || preclaim.value.sourceManifestSha256 !== lease.sourceManifestSha256
        || preclaim.value.artifactRootFingerprintSha256 !== lease.artifactRootFingerprintSha256
        || preclaim.value.operationalAttestationSha256 !== lease.operationalAttestationSha256
        || preclaim.value.recoveryFromAbandonedOperationSha256 !== lease.recoveryFromAbandonedOperationSha256
        || preclaim.value.operationDeadlineAt !== lease.operationDeadlineAt) {
      throw new Error("production_authority_preclaim_binding_invalid");
    }
    return preclaim;
  }

  #verifyNormalTakeoverChain(
    claim: ProductionOperationClaimV2,
    currentLease: { value: ProductionOperationLeaseV2; sha256: string }
  ): Readonly<{ sha256: string; leaseTips: readonly Readonly<{ sha256: string; epoch: number }>[] }> {
    let tipSha = claim.authorityConsumption.leaseSha256AtConsumption;
    let tipEpoch = claim.authorityConsumption.leaseEpochAtConsumption;
    const leaseTips: Array<Readonly<{ sha256: string; epoch: number }>> = [
      { sha256: tipSha, epoch: tipEpoch }
    ];
    const receipts = this.#normalTakeoverReceipts();
    const visited = new Set<string>();
    const receiptSha256s: string[] = [];
    while (tipSha !== currentLease.sha256) {
      if (visited.has(tipSha)) throw new Error("production_operation_takeover_chain_cycle");
      visited.add(tipSha);
      // Every old lease hash has one global successor. Filtering a foreign receipt first
      // would hide a branch and let a forged identity switch out and back into the claim.
      const matches = receipts.filter(({ value }) => value.oldLeaseSha256 === tipSha);
      if (matches.length !== 1) throw new Error("production_operation_takeover_chain_invalid");
      const receipt = matches[0]!.value;
      if (receipt.operationKind !== claim.operationKind
          || receipt.operationId !== claim.operationId
          || receipt.candidateSha !== claim.candidateSha
          || receipt.releaseGenerationId !== claim.releaseGenerationId
          || receipt.sourceManifestSha256 !== claim.sourceManifestSha256
          || receipt.artifactRootFingerprintSha256 !== claim.artifactRootFingerprintSha256
          || receipt.authorityConsumptionSha256 !== claim.authorityConsumptionSha256
          || receipt.capability !== claim.capability
          || receipt.operationDeadlineAt !== claim.operationDeadlineAt
          || receipt.redactedTemplateSha256 !== PRODUCTION_OPERATION_TAKEOVER_TEMPLATE_SHA256_V2) {
        throw new Error("production_operation_takeover_claim_binding_invalid");
      }
      if (receipt.newLeaseEpoch !== tipEpoch + 1) throw new Error("production_operation_takeover_epoch_invalid");
      const prepared = readCanonical(
        this.#path(`production-operation-root.lease-takeover-prepared-${tipSha}.json`),
        validatePreparedProductionOperationLeaseTakeoverV2,
        "prepared_production_operation_takeover"
      );
      validateCommittedProductionOperationLeaseTakeoverV2(receipt, prepared.value);
      const tombstone = readCanonical(this.#path(receipt.tombstoneRelativePath),
        validateProductionOperationLeaseV2, "production_operation_tombstone");
      const nextLease = prepared.value.canonicalNewLease;
      if (tombstone.sha256 !== tipSha || tombstone.value.leaseEpoch !== tipEpoch
          || prepared.value.oldOwnerProcessIdentitySha256 !== operationOwnerSha(tombstone.value)
          || tombstone.value.operationKind !== claim.operationKind
          || tombstone.value.operationId !== claim.operationId
          || tombstone.value.candidateSha !== claim.candidateSha
          || tombstone.value.releaseGenerationId !== claim.releaseGenerationId
          || tombstone.value.sourceManifestSha256 !== claim.sourceManifestSha256
          || tombstone.value.artifactRootFingerprintSha256 !== claim.artifactRootFingerprintSha256
          || tombstone.value.operationalAttestationSha256 !== claim.operationalAttestationSha256
          || tombstone.value.recoveryFromAbandonedOperationSha256
            !== claim.recoveryFromAbandonedOperationSha256
          || tombstone.value.capability !== claim.capability
          || tombstone.value.operationDeadlineAt !== claim.operationDeadlineAt
          || nextLease.operationKind !== claim.operationKind
          || nextLease.operationId !== claim.operationId
          || nextLease.candidateSha !== claim.candidateSha
          || nextLease.releaseGenerationId !== claim.releaseGenerationId
          || nextLease.sourceManifestSha256 !== claim.sourceManifestSha256
          || nextLease.artifactRootFingerprintSha256 !== claim.artifactRootFingerprintSha256
          || nextLease.operationalAttestationSha256 !== claim.operationalAttestationSha256
          || nextLease.recoveryFromAbandonedOperationSha256
            !== claim.recoveryFromAbandonedOperationSha256
          || nextLease.capability !== claim.capability
          || nextLease.operationDeadlineAt !== claim.operationDeadlineAt) {
        throw new Error("production_operation_takeover_tombstone_invalid");
      }
      receiptSha256s.push(matches[0]!.sha256);
      tipSha = receipt.newLeaseSha256;
      tipEpoch = receipt.newLeaseEpoch;
      leaseTips.push({ sha256: tipSha, epoch: tipEpoch });
    }
    if (tipEpoch !== currentLease.value.leaseEpoch) throw new Error("production_operation_takeover_tip_invalid");
    return { sha256: releaseSha256V2(canonicalBytesV2(receiptSha256s)), leaseTips };
  }

  verifyImmutableAuthorityLineage(operationId: string, evaluatedAt: string): {
    lease: ProductionOperationLeaseV2; leaseSha256: string;
    claim: ProductionOperationClaimV2; claimSha256: string;
    takeoverChainSha256: string;
    lineageLeaseTips: readonly Readonly<{ sha256: string; epoch: number }>[];
  } {
    exactOperationId(operationId);
    const evaluatedAtMs = parseIso(evaluatedAt, "production_operation_evaluated_at");
    this.#assertManifestWriterAbsent();
    const lease = this.#readLease();
    if (lease.value.operationId !== operationId) throw new Error("production_operation_lineage_operation_invalid");
    if (existsSync(this.#path(`production-operation-settlement-${operationId}.json`))
        || existsSync(this.#path(`production-operation-terminal-abandoned-${operationId}.json`))) {
      throw new Error("production_operation_already_terminal");
    }
    if (evaluatedAtMs >= Date.parse(lease.value.expiresAt)) {
      throw new Error("production_operation_lease_expired");
    }
    if (lease.value.capability === "cleanup_only") throw new Error("cleanup_only_operation_forbidden");
    const claim = this.#claimForLease(lease.value);
    if (claim === null) throw new Error("production_operation_claim_missing");
    if (evaluatedAtMs >= Date.parse(claim.value.authorityConsumption.expiresAt)) {
      throw new Error("production_operation_authority_bound_reached");
    }
    if (evaluatedAtMs >= Date.parse(lease.value.operationDeadlineAt)) {
      throw new Error("production_operation_deadline_reached");
    }
    const takeover = this.#verifyNormalTakeoverChain(claim.value, lease);
    this.#assertManifestWriterAbsent();
    return { lease: lease.value, leaseSha256: lease.sha256,
      claim: claim.value, claimSha256: claim.sha256, takeoverChainSha256: takeover.sha256,
      lineageLeaseTips: takeover.leaseTips };
  }

  assertOwnedAndWithinBounds(operationId: string, evaluatedAt: string): {
    lease: ProductionOperationLeaseV2; leaseSha256: string;
    claim: ProductionOperationClaimV2; claimSha256: string;
    takeoverChainSha256: string;
    lineageLeaseTips: readonly Readonly<{ sha256: string; epoch: number }>[];
  } {
    const verified = this.verifyImmutableAuthorityLineage(operationId, evaluatedAt);
    const owner = currentRootWriterOwnerIdentityV2();
    if (verified.lease.ownerPid !== owner.pid
        || verified.lease.ownerProcessStartFingerprintSha256 !== owner.processStartFingerprintSha256) {
      throw new Error("production_operation_owner_fence_invalid");
    }
    this.#assertManifestWriterAbsent();
    return verified;
  }

  heartbeat(operationId: string, evaluatedAt: string): {
    lease: ProductionOperationLeaseV2; leaseSha256: string;
  } {
    exactOperationId(operationId);
    const evaluatedAtMs = parseIso(evaluatedAt, "production_operation_heartbeat_at");
    const oldLease = this.#readLease();
    const owned = this.assertOwnedAndWithinBounds(operationId, evaluatedAt);
    const owner = currentRootWriterOwnerIdentityV2();
    if (evaluatedAtMs - Date.parse(oldLease.value.heartbeatAt) > 10_000) {
      throw new Error("production_operation_heartbeat_interval_exceeded");
    }
    const newLease = validateProductionOperationLeaseV2({
      ...oldLease.value,
      leaseEpoch: oldLease.value.leaseEpoch + 1,
      acquiredAt: evaluatedAt,
      heartbeatAt: evaluatedAt,
      expiresAt: new Date(Math.min(evaluatedAtMs + 60_000,
        Date.parse(owned.claim.authorityConsumption.expiresAt),
        Date.parse(oldLease.value.operationDeadlineAt))).toISOString()
    }) as ProductionOperationLeaseV2 & { capability: "effect_capable" | "recovery_only" };
    const newLeaseBytes = canonicalBytesV2(newLease);
    const prepared = validatePreparedProductionOperationLeaseTakeoverV2({
      version: "prepared-production-operation-lease-takeover-v2",
      commandId: "production_operation_lease_takeover",
      redactedTemplateSha256: PRODUCTION_OPERATION_TAKEOVER_TEMPLATE_SHA256_V2,
      capability: oldLease.value.capability,
      operationKind: oldLease.value.operationKind,
      operationId: oldLease.value.operationId,
      candidateSha: oldLease.value.candidateSha,
      releaseGenerationId: oldLease.value.releaseGenerationId,
      sourceManifestSha256: oldLease.value.sourceManifestSha256,
      artifactRootFingerprintSha256: oldLease.value.artifactRootFingerprintSha256,
      authorityConsumptionSha256: owned.claim.authorityConsumptionSha256,
      oldLeaseSha256: oldLease.sha256,
      oldLeaseEpoch: oldLease.value.leaseEpoch,
      oldOwnerProcessIdentitySha256: operationOwnerSha(oldLease.value),
      canonicalNewLease: newLease,
      canonicalNewLeaseUtf8Base64: newLeaseBytes.toString("base64"),
      newLeaseSha256: releaseSha256V2(newLeaseBytes),
      newLeaseEpoch: newLease.leaseEpoch,
      operationDeadlineAt: oldLease.value.operationDeadlineAt,
      preparedAt: evaluatedAt
    });
    const preparedPath = this.#path(
      `production-operation-root.lease-takeover-prepared-${oldLease.sha256}.json`);
    const preparedBytes = canonicalBytesV2(prepared);
    writeExclusiveDurable(preparedPath, preparedBytes);
    const leasePath = this.#path(PRODUCTION_OPERATION_LEASE_FILE_V2);
    const tombstonePath = this.#path(`production-operation-root.lease-tombstone-${oldLease.sha256}.json`);
    moveNoOverwriteDurable(leasePath, tombstonePath);
    exactReplayOrConflict(leasePath, newLeaseBytes, "production_operation_heartbeat_lease_conflict");
    const committed = validateCommittedProductionOperationLeaseTakeoverV2({
      version: "committed-production-operation-lease-takeover-v2",
      commandId: "production_operation_lease_takeover",
      redactedTemplateSha256: PRODUCTION_OPERATION_TAKEOVER_TEMPLATE_SHA256_V2,
      capability: prepared.capability,
      operationKind: prepared.operationKind,
      operationId: prepared.operationId,
      candidateSha: prepared.candidateSha,
      releaseGenerationId: prepared.releaseGenerationId,
      sourceManifestSha256: prepared.sourceManifestSha256,
      artifactRootFingerprintSha256: prepared.artifactRootFingerprintSha256,
      authorityConsumptionSha256: prepared.authorityConsumptionSha256,
      preparedTakeoverSha256: releaseSha256V2(preparedBytes),
      oldLeaseSha256: prepared.oldLeaseSha256,
      tombstoneRelativePath: `production-operation-root.lease-tombstone-${prepared.oldLeaseSha256}.json`,
      newLeaseSha256: prepared.newLeaseSha256,
      newLeaseEpoch: prepared.newLeaseEpoch,
      operationDeadlineAt: prepared.operationDeadlineAt,
      committedAt: evaluatedAt
    }, prepared);
    const committedBytes = canonicalBytesV2(committed);
    writeExclusiveDurable(this.#path(
      `production-operation-root.lease-takeover-committed-${releaseSha256V2(committedBytes)}.json`),
    committedBytes);
    this.#assertManifestWriterAbsent();
    return { lease: newLease, leaseSha256: releaseSha256V2(newLeaseBytes) };
  }

  persistStepIntent(value: unknown): ProductionOperationStoreRecordV2 {
    const intent = validateProductionOrchestrationStepIntentV2(value);
    const current = this.assertOwnedAndWithinBounds(intent.operationId, intent.preparedAt);
    if (current.lease.capability !== "effect_capable"
        || current.claimSha256 !== intent.operationClaimSha256
        || current.claim.authorityConsumptionSha256 !== intent.authorityConsumptionSha256
        || current.leaseSha256 !== intent.currentOperationLeaseSha256
        || current.lease.leaseEpoch !== intent.currentOperationLeaseEpoch
        || current.lease.operationKind !== intent.orchestration) {
      throw new Error("production_step_intent_operation_binding_invalid");
    }
    return this.persistExclusive("production_orchestration_step_intent", intent.relativePath, intent);
  }

  hasUnresolvedStepIntent(input: { operationId: string; sequence: number; stepId: string }): boolean {
    exactOperationId(input.operationId);
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 1 || !/^[a-z][a-z0-9_]*$/u.test(input.stepId)) {
      throw new Error("production_step_intent_lookup_invalid");
    }
    const intentPath = this.#path(
      `production-operation-step-intents/${input.operationId}/${input.sequence}-${input.stepId}-1-v2.json`);
    if (!existsSync(intentPath)) return false;
    const intent = readCanonical(intentPath, validateProductionOrchestrationStepIntentV2,
      "production_step_intent");
    if (intent.value.operationId !== input.operationId || intent.value.sequence !== input.sequence
        || intent.value.stepId !== input.stepId || intent.value.attempt !== 1) {
      throw new Error("production_step_intent_lookup_binding_invalid");
    }
    const receiptPath = this.#path(
      `production-operation-steps/${input.operationId}/${input.sequence}-${input.stepId}-v2.json`);
    if (!existsSync(receiptPath)) return true;
    const receipt = readCanonical(receiptPath, validateProductionOrchestrationStepReceiptV2,
      "production_step_receipt");
    if (receipt.value.operationId !== input.operationId || receipt.value.sequence !== input.sequence
        || receipt.value.stepId !== input.stepId || receipt.value.executionKind !== "external_effect"
        || receipt.value.stepIntentRelativePath !== intent.value.relativePath
        || receipt.value.stepIntentSha256 !== intent.sha256) {
      throw new Error("production_step_receipt_intent_binding_invalid");
    }
    return false;
  }

  persistStepReceipt(value: unknown): ProductionOperationStoreRecordV2 {
    const receipt = validateProductionOrchestrationStepReceiptV2(value);
    const current = this.assertOwnedAndWithinBounds(receipt.operationId, receipt.finishedAt);
    if (current.claimSha256 !== receipt.operationClaimSha256
        || current.claim.authorityConsumptionSha256 !== receipt.authorityConsumptionSha256
        || current.leaseSha256 !== receipt.operationLeaseSha256
        || current.lease.leaseEpoch !== receipt.operationLeaseEpoch
        || current.lease.operationDeadlineAt !== receipt.operationDeadlineAt
        || current.lease.capability !== receipt.capability
        || current.lease.operationKind !== receipt.orchestration) {
      throw new Error("production_step_receipt_operation_binding_invalid");
    }
    if (receipt.executionKind === "external_effect") {
      const intent = readCanonical(this.#path(receipt.stepIntentRelativePath),
        validateProductionOrchestrationStepIntentV2, "production_step_intent");
      if (intent.sha256 !== receipt.stepIntentSha256
          || intent.value.operationId !== receipt.operationId
          || intent.value.sequence !== receipt.sequence
          || intent.value.stepId !== receipt.stepId
          || intent.value.inputSha256 !== receipt.inputSha256
          || intent.value.currentOperationLeaseSha256 !== receipt.operationLeaseSha256
          || intent.value.currentOperationLeaseEpoch !== receipt.operationLeaseEpoch) {
        throw new Error("production_step_receipt_intent_binding_invalid");
      }
    }
    const relativePath = `production-operation-steps/${receipt.operationId}/${receipt.sequence}-${receipt.stepId}-v2.json`;
    return this.persistExclusive("production_orchestration_step_receipt", relativePath, receipt);
  }

  persistSettlement(value: unknown): ProductionOperationStoreRecordV2 {
    const settlement = validateProductionOperationSettlementV2(value);
    const current = this.assertOwnedAndWithinBounds(settlement.operationId, settlement.settledAt);
    if (settlement.candidateSha !== current.lease.candidateSha
        || settlement.releaseGenerationId !== current.lease.releaseGenerationId
        || settlement.sourceManifestSha256 !== current.lease.sourceManifestSha256
        || settlement.claimSha256 !== current.claimSha256
        || settlement.authorityConsumptionSha256 !== current.claim.authorityConsumptionSha256
        || settlement.finalLeaseSha256 !== current.leaseSha256
        || settlement.finalLeaseEpoch !== current.lease.leaseEpoch
        || settlement.operationDeadlineAt !== current.lease.operationDeadlineAt
        || settlement.capability !== current.lease.capability
        || Date.parse(settlement.authorityRevalidatedAt) >= Date.parse(current.claim.authorityConsumption.expiresAt)
        || Date.parse(settlement.deadlineRevalidatedAt) >= Date.parse(current.lease.operationDeadlineAt)) {
      throw new Error("production_operation_settlement_binding_invalid");
    }
    const relativePath = `production-operation-settlement-${settlement.operationId}.json`;
    return this.persistExclusive("production_operation_settlement", relativePath, settlement);
  }

  #terminalState(input: {
    operationId: string;
    terminalStateKind: "settlement" | "terminal_abandoned";
    terminalStateSha256: string;
  }): ProductionOperationSettlementV2 | ProductionOperationTerminalAbandonedV2 {
    const relativePath = input.terminalStateKind === "settlement"
      ? `production-operation-settlement-${input.operationId}.json`
      : `production-operation-terminal-abandoned-${input.operationId}.json`;
    const state = input.terminalStateKind === "settlement"
      ? readCanonical(this.#path(relativePath), validateProductionOperationSettlementV2,
        "production_operation_settlement")
      : readCanonical(this.#path(relativePath), validateProductionOperationTerminalAbandonedV2,
        "production_operation_terminal_abandoned");
    if (state.sha256 !== exactSha(input.terminalStateSha256, "production_terminal_state_sha")
        || state.value.operationId !== input.operationId) {
      throw new Error("production_terminal_state_binding_invalid");
    }
    return state.value;
  }

  completeTerminal(input: {
    operationId: string;
    terminalStateKind: "settlement" | "terminal_abandoned";
    terminalStateSha256: string;
    evaluatedAt: string;
    faultAt?: string;
  }): {
    prepared: PreparedProductionOperationLeaseRemovalV2;
    receipt: ProductionOperationLeaseRemovalReceiptV2;
    cleanup: ProductionOperationTerminalCleanupV2;
  } {
    exactOperationId(input.operationId);
    parseIso(input.evaluatedAt, "production_operation_terminal_evaluated_at");
    const terminalState = this.#terminalState(input);
    const preparedPath = this.#path(`production-operation-lease-removal-prepared-${input.operationId}.json`);
    let prepared: PreparedProductionOperationLeaseRemovalV2;
    let preparedSha256: string;
    if (existsSync(preparedPath)) {
      const stored = readCanonical(preparedPath, validatePreparedProductionOperationLeaseRemovalV2,
        "prepared_production_operation_lease_removal");
      prepared = stored.value;
      preparedSha256 = stored.sha256;
      if (prepared.operationId !== input.operationId
          || prepared.terminalStateKind !== input.terminalStateKind
          || prepared.terminalStateSha256 !== input.terminalStateSha256) {
        throw new Error("prepared_production_operation_lease_removal_conflict");
      }
    } else {
      this.#assertManifestWriterAbsent();
      const lease = this.#readLease();
      const owner = currentRootWriterOwnerIdentityV2();
      const ownerMatches = lease.value.ownerPid === owner.pid
        && lease.value.ownerProcessStartFingerprintSha256 === owner.processStartFingerprintSha256;
      const resumableDeadCleanup = input.terminalStateKind === "terminal_abandoned"
        && lease.value.capability === "cleanup_only"
        && !isLeaseOwnerProcessAliveV2(lease.value.ownerPid,
          lease.value.ownerProcessStartFingerprintSha256);
      if (lease.value.operationId !== input.operationId
          || (!ownerMatches && !resumableDeadCleanup)
          || terminalState.operationKind !== lease.value.operationKind
          || terminalState.capability !== lease.value.capability
          || terminalState.finalLeaseSha256 !== lease.sha256
          || terminalState.finalLeaseEpoch !== lease.value.leaseEpoch) {
        throw new Error("production_terminal_lease_binding_invalid");
      }
      if (resumableDeadCleanup) {
        const abandoned = terminalState as ProductionOperationTerminalAbandonedV2;
        if (abandoned.cleanupOnlyTakeoverSha256 === null) {
          throw new Error("cleanup_only_takeover_terminal_binding_invalid");
        }
        const committed = readCanonical(this.#path(
          `production-operation-root.lease-cleanup-only-committed-${abandoned.cleanupOnlyTakeoverSha256}.json`),
        validateCleanupOnlyProductionOperationTakeoverV2, "cleanup_only_production_operation_takeover");
        if (committed.sha256 !== abandoned.cleanupOnlyTakeoverSha256
            || committed.value.operationId !== lease.value.operationId
            || committed.value.newLeaseSha256 !== lease.sha256
            || committed.value.newLeaseEpoch !== lease.value.leaseEpoch) {
          throw new Error("cleanup_only_takeover_terminal_binding_invalid");
        }
      }
      const receipt = validateProductionOperationLeaseRemovalReceiptV2({
        version: "production-operation-lease-removal-receipt-v2",
        operationKind: lease.value.operationKind,
        operationId: lease.value.operationId,
        terminalStateKind: input.terminalStateKind,
        terminalStateSha256: input.terminalStateSha256,
        capability: lease.value.capability,
        removedLeaseSha256: lease.sha256,
        removedLeaseEpoch: lease.value.leaseEpoch,
        removedAt: input.evaluatedAt
      });
      const receiptBytes = canonicalBytesV2(receipt);
      prepared = validatePreparedProductionOperationLeaseRemovalV2({
        version: "prepared-production-operation-lease-removal-v2",
        operationKind: lease.value.operationKind,
        operationId: lease.value.operationId,
        terminalStateKind: input.terminalStateKind,
        terminalStateSha256: input.terminalStateSha256,
        capability: lease.value.capability,
        exactCurrentLeaseSha256: lease.sha256,
        exactCurrentLeaseEpoch: lease.value.leaseEpoch,
        canonicalRemovalReceipt: receipt,
        canonicalRemovalReceiptUtf8Base64: receiptBytes.toString("base64"),
        canonicalRemovalReceiptSha256: releaseSha256V2(receiptBytes),
        preparedAt: input.evaluatedAt
      });
      const preparedBytes = canonicalBytesV2(prepared);
      writeExclusiveDurable(preparedPath, preparedBytes);
      preparedSha256 = releaseSha256V2(preparedBytes);
    }
    injectedFault(input.faultAt, "after_removal_prepare");
    const leasePath = this.#path(PRODUCTION_OPERATION_LEASE_FILE_V2);
    if (existsSync(leasePath)) {
      const current = this.#readLease();
      if (current.sha256 !== prepared.exactCurrentLeaseSha256
          || current.value.leaseEpoch !== prepared.exactCurrentLeaseEpoch
          || current.value.operationId !== input.operationId) {
        throw new Error("production_operation_lease_removal_fence_invalid");
      }
      unlinkDurable(leasePath);
    }
    injectedFault(input.faultAt, "after_lease_removal");
    const receiptPath = this.#path(`production-operation-lease-removal-${input.operationId}.json`);
    const receiptBytes = Buffer.from(prepared.canonicalRemovalReceiptUtf8Base64, "base64");
    if (releaseSha256V2(receiptBytes) !== prepared.canonicalRemovalReceiptSha256) {
      throw new Error("production_operation_removal_receipt_bytes_invalid");
    }
    exactReplayOrConflict(receiptPath, receiptBytes, "production_operation_removal_receipt_conflict");
    injectedFault(input.faultAt, "after_removal_receipt");
    const cleanup = validateProductionOperationTerminalCleanupV2({
      version: "production-operation-terminal-cleanup-v2",
      operationKind: prepared.operationKind,
      operationId: prepared.operationId,
      terminalStateSha256: prepared.terminalStateSha256,
      capability: prepared.capability,
      preparedRemovalSha256: preparedSha256,
      leaseRemovalReceiptSha256: prepared.canonicalRemovalReceiptSha256,
      removedLeaseSha256: prepared.exactCurrentLeaseSha256,
      cleanedAt: prepared.preparedAt
    });
    this.persistExclusive("production_operation_terminal_cleanup",
      `production-operation-terminal-cleanup-${input.operationId}.json`, cleanup);
    injectedFault(input.faultAt, "after_terminal_cleanup");
    return { prepared, receipt: prepared.canonicalRemovalReceipt, cleanup };
  }

  #oldLeaseForTakeover(expectedOldLeaseSha256: string): {
    value: ProductionOperationLeaseV2; bytes: Buffer; sha256: string;
  } {
    const expected = exactSha(expectedOldLeaseSha256, "production_operation_expected_old_lease_sha");
    const livePath = this.#path(PRODUCTION_OPERATION_LEASE_FILE_V2);
    if (existsSync(livePath)) {
      const live = this.#readLease();
      if (live.sha256 === expected) return live;
    }
    const tombstonePath = this.#path(`production-operation-root.lease-tombstone-${expected}.json`);
    if (!existsSync(tombstonePath)) throw new Error("production_operation_old_lease_hash_mismatch");
    const tombstone = readCanonical(tombstonePath, validateProductionOperationLeaseV2,
      "production_operation_tombstone");
    if (tombstone.sha256 !== expected) throw new Error("production_operation_old_lease_hash_mismatch");
    return tombstone;
  }

  #takeoverAuthorityContext(oldLease: ProductionOperationLeaseV2): {
    claim: { value: ProductionOperationClaimV2; sha256: string } | null;
    authorityConsumptionSha256: string | null;
    authorityExpiresAt: string;
  } {
    const claim = this.#claimForLease(oldLease);
    const preclaimPath = this.#path(`production-authority-preclaim-${oldLease.operationId}.json`);
    if (!existsSync(preclaimPath)) {
      if (claim !== null) throw new Error("production_operation_claim_without_preclaim");
      const action = OPERATION_ACTION[oldLease.operationKind];
      const authorityPath = safeArtifactRelativePath(this.#root,
        `operational-attestations/${action}/${oldLease.releaseGenerationId}/${oldLease.operationalAttestationSha256}.json`);
      const authority = readCanonical(authorityPath, (value) => validateOperationalAttestationV2(value),
        "operational_attestation");
      if (authority.sha256 !== oldLease.operationalAttestationSha256
          || authority.value.action !== action
          || authority.value.candidateSha !== oldLease.candidateSha
          || authority.value.generationId !== oldLease.releaseGenerationId
          || authority.value.sourceManifestSha256 !== oldLease.sourceManifestSha256
          || authority.value.artifactRootFingerprintSha256 !== oldLease.artifactRootFingerprintSha256) {
        throw new Error("production_operation_lease_authority_binding_invalid");
      }
      return { claim: null, authorityConsumptionSha256: null,
        authorityExpiresAt: authority.value.expiresAt };
    }
    const preclaim = this.#preclaimForLease(oldLease);
    if (claim !== null) {
      if (claim.value.authorityConsumption.preclaimValidationSha256 !== preclaim.sha256
          || claim.value.authorityConsumption.expiresAt !== preclaim.value.expiresAt
          || claim.value.authorityConsumption.operationDeadlineAt !== oldLease.operationDeadlineAt) {
        throw new Error("production_operation_consumption_preclaim_binding_invalid");
      }
      this.#verifyNormalTakeoverChain(claim.value, { value: oldLease,
        sha256: releaseSha256V2(canonicalBytesV2(oldLease)) });
    }
    return {
      claim: claim === null ? null : { value: claim.value, sha256: claim.sha256 },
      authorityConsumptionSha256: claim?.value.authorityConsumptionSha256 ?? null,
      authorityExpiresAt: claim?.value.authorityConsumption.expiresAt ?? preclaim.value.expiresAt
    };
  }

  #assertTakeoverEligible(
    oldLease: { value: ProductionOperationLeaseV2; sha256: string },
    evaluatedAt: string
  ): { evaluatedAtMs: number; authorityExpiresAt: string;
    claim: { value: ProductionOperationClaimV2; sha256: string } | null;
    authorityConsumptionSha256: string | null } {
    const evaluatedAtMs = parseIso(evaluatedAt, "production_operation_takeover_evaluated_at");
    const identity = this.#readFreezeAndManifest();
    if (oldLease.value.candidateSha !== identity.candidateSha
        || oldLease.value.releaseGenerationId !== identity.releaseGenerationId
        || oldLease.value.sourceManifestSha256 !== identity.sourceManifestSha256
        || oldLease.value.artifactRootFingerprintSha256 !== identity.artifactRootFingerprintSha256) {
      throw new Error("production_operation_takeover_root_binding_invalid");
    }
    if (oldLease.sha256 !== releaseSha256V2(canonicalBytesV2(oldLease.value))) {
      throw new Error("production_operation_old_lease_noncanonical");
    }
    if (evaluatedAtMs < Date.parse(oldLease.value.expiresAt)) {
      throw new Error("production_operation_lease_not_expired");
    }
    if (isLeaseOwnerProcessAliveV2(oldLease.value.ownerPid,
      oldLease.value.ownerProcessStartFingerprintSha256)) {
      throw new Error("production_operation_owner_still_alive");
    }
    const authority = this.#takeoverAuthorityContext(oldLease.value);
    return { evaluatedAtMs, ...authority };
  }

  #committedTakeoverForOld(oldLeaseSha256: string): CommittedProductionOperationLeaseTakeoverV2 | null {
    const matches = this.#normalTakeoverReceipts().filter(({ value }) => value.oldLeaseSha256 === oldLeaseSha256);
    if (matches.length > 1) throw new Error("production_operation_takeover_receipt_ambiguous");
    if (matches.length === 0) return null;
    const prepared = readCanonical(
      this.#path(`production-operation-root.lease-takeover-prepared-${oldLeaseSha256}.json`),
      validatePreparedProductionOperationLeaseTakeoverV2,
      "prepared_production_operation_takeover"
    );
    validateCommittedProductionOperationLeaseTakeoverV2(matches[0]!.value, prepared.value);
    const tombstone = readCanonical(this.#path(matches[0]!.value.tombstoneRelativePath),
      validateProductionOperationLeaseV2, "production_operation_tombstone");
    if (tombstone.sha256 !== oldLeaseSha256) throw new Error("production_operation_tombstone_conflict");
    return matches[0]!.value;
  }

  #cleanupTakeoverReceipts(): Array<{ value: CleanupOnlyProductionOperationTakeoverV2; sha256: string }> {
    return readdirSync(this.#root).filter((name) =>
      name.startsWith("production-operation-root.lease-cleanup-only-committed-") && name.endsWith(".json"))
      .map((name) => {
        const receipt = readCanonical(this.#path(name), validateCleanupOnlyProductionOperationTakeoverV2,
          "cleanup_only_production_operation_takeover");
        if (name !== `production-operation-root.lease-cleanup-only-committed-${receipt.sha256}.json`) {
          throw new Error("cleanup_only_takeover_committed_filename_invalid");
        }
        return { value: receipt.value, sha256: receipt.sha256 };
      });
  }

  #committedCleanupTakeoverForOld(oldLeaseSha256: string): {
    value: CleanupOnlyProductionOperationTakeoverV2; sha256: string;
  } | null {
    const matches = this.#cleanupTakeoverReceipts().filter(({ value }) => value.oldLeaseSha256 === oldLeaseSha256);
    if (matches.length > 1) throw new Error("cleanup_only_takeover_receipt_ambiguous");
    if (matches.length === 0) return null;
    const prepared = readCanonical(
      this.#path(`production-operation-root.lease-cleanup-only-prepared-${oldLeaseSha256}.json`),
      validatePreparedCleanupOnlyProductionOperationTakeoverV2,
      "prepared_cleanup_only_production_operation_takeover"
    );
    validateCleanupOnlyProductionOperationTakeoverV2(matches[0]!.value, prepared.value);
    const tombstone = readCanonical(this.#path(matches[0]!.value.tombstoneRelativePath),
      validateProductionOperationLeaseV2, "production_operation_tombstone");
    if (tombstone.sha256 !== oldLeaseSha256) throw new Error("production_operation_tombstone_conflict");
    return matches[0]!;
  }

  async takeoverEffectCapable(input: {
    expectedOldLeaseSha256: string; evaluatedAt: string; faultAt?: string;
  }): Promise<CommittedProductionOperationLeaseTakeoverV2> {
    const expectedOldLeaseSha256 = exactSha(input.expectedOldLeaseSha256,
      "production_operation_expected_old_lease_sha");
    const replay = this.#committedTakeoverForOld(expectedOldLeaseSha256);
    if (replay !== null) return replay;
    this.#assertManifestWriterAbsent();
    const oldLease = this.#oldLeaseForTakeover(expectedOldLeaseSha256);
    if (oldLease.value.capability === "cleanup_only") throw new Error("effect_capable_takeover_cleanup_lease_forbidden");
    const preparedPath = this.#path(
      `production-operation-root.lease-takeover-prepared-${expectedOldLeaseSha256}.json`);
    const existingPrepared = existsSync(preparedPath)
      ? readCanonical(preparedPath, validatePreparedProductionOperationLeaseTakeoverV2,
        "prepared_production_operation_takeover") : null;
    const context = this.#assertTakeoverEligible(oldLease, input.evaluatedAt);
    const protocolAt = existingPrepared?.value.preparedAt ?? input.evaluatedAt;
    if (context.evaluatedAtMs >= Date.parse(context.authorityExpiresAt)) {
      throw new Error("production_operation_authority_bound_reached");
    }
    if (context.evaluatedAtMs >= Date.parse(oldLease.value.operationDeadlineAt)) {
      throw new Error("production_operation_deadline_reached");
    }
    let prepared: PreparedProductionOperationLeaseTakeoverV2;
    let preparedSha256: string;
    if (existingPrepared !== null) {
      prepared = existingPrepared.value;
      preparedSha256 = existingPrepared.sha256;
      if (prepared.oldLeaseSha256 !== expectedOldLeaseSha256
          || prepared.oldLeaseEpoch !== oldLease.value.leaseEpoch
          || prepared.oldOwnerProcessIdentitySha256 !== operationOwnerSha(oldLease.value)
          || prepared.authorityConsumptionSha256 !== context.authorityConsumptionSha256) {
        throw new Error("prepared_production_operation_takeover_conflict");
      }
    } else {
      if (existsSync(this.#path(
        `production-operation-root.lease-cleanup-only-prepared-${expectedOldLeaseSha256}.json`))) {
        throw new Error("production_operation_takeover_capability_conflict");
      }
      const owner = currentRootWriterOwnerIdentityV2();
      const newLease = validateProductionOperationLeaseV2({
        ...oldLease.value,
        leaseEpoch: oldLease.value.leaseEpoch + 1,
        ownerPid: owner.pid,
        ownerProcessStartFingerprintSha256: owner.processStartFingerprintSha256,
        acquiredAt: protocolAt,
        heartbeatAt: protocolAt,
        expiresAt: new Date(Math.min(context.evaluatedAtMs + 60_000,
          Date.parse(context.authorityExpiresAt), Date.parse(oldLease.value.operationDeadlineAt))).toISOString()
      }) as ProductionOperationLeaseV2 & { capability: "effect_capable" | "recovery_only" };
      const newLeaseBytes = canonicalBytesV2(newLease);
      prepared = validatePreparedProductionOperationLeaseTakeoverV2({
        version: "prepared-production-operation-lease-takeover-v2",
        commandId: "production_operation_lease_takeover",
        redactedTemplateSha256: PRODUCTION_OPERATION_TAKEOVER_TEMPLATE_SHA256_V2,
        capability: oldLease.value.capability,
        operationKind: oldLease.value.operationKind,
        operationId: oldLease.value.operationId,
        candidateSha: oldLease.value.candidateSha,
        releaseGenerationId: oldLease.value.releaseGenerationId,
        sourceManifestSha256: oldLease.value.sourceManifestSha256,
        artifactRootFingerprintSha256: oldLease.value.artifactRootFingerprintSha256,
        authorityConsumptionSha256: context.authorityConsumptionSha256,
        oldLeaseSha256: oldLease.sha256,
        oldLeaseEpoch: oldLease.value.leaseEpoch,
        oldOwnerProcessIdentitySha256: operationOwnerSha(oldLease.value),
        canonicalNewLease: newLease,
        canonicalNewLeaseUtf8Base64: newLeaseBytes.toString("base64"),
        newLeaseSha256: releaseSha256V2(newLeaseBytes),
        newLeaseEpoch: newLease.leaseEpoch,
        operationDeadlineAt: oldLease.value.operationDeadlineAt,
        preparedAt: protocolAt
      });
      const preparedBytes = canonicalBytesV2(prepared);
      writeExclusiveDurable(preparedPath, preparedBytes);
      preparedSha256 = releaseSha256V2(preparedBytes);
    }
    injectedFault(input.faultAt, "after_prepare");
    const leasePath = this.#path(PRODUCTION_OPERATION_LEASE_FILE_V2);
    const tombstonePath = this.#path(`production-operation-root.lease-tombstone-${expectedOldLeaseSha256}.json`);
    if (existsSync(leasePath) && releaseSha256V2(readFileSync(leasePath)) === expectedOldLeaseSha256) {
      moveNoOverwriteDurable(leasePath, tombstonePath);
    } else {
      const tombstone = readCanonical(tombstonePath, validateProductionOperationLeaseV2,
        "production_operation_tombstone");
      if (tombstone.sha256 !== expectedOldLeaseSha256) throw new Error("production_operation_tombstone_conflict");
    }
    injectedFault(input.faultAt, "after_tombstone");
    this.#assertManifestWriterAbsent();
    const newLeaseBytes = Buffer.from(prepared.canonicalNewLeaseUtf8Base64, "base64");
    exactReplayOrConflict(leasePath, newLeaseBytes, "production_operation_new_lease_conflict");
    this.#assertManifestWriterAbsent();
    injectedFault(input.faultAt, "after_lease");
    injectedFault(input.faultAt, "after_new_lease");
    const committed = validateCommittedProductionOperationLeaseTakeoverV2({
      version: "committed-production-operation-lease-takeover-v2",
      commandId: "production_operation_lease_takeover",
      redactedTemplateSha256: PRODUCTION_OPERATION_TAKEOVER_TEMPLATE_SHA256_V2,
      capability: prepared.capability,
      operationKind: prepared.operationKind,
      operationId: prepared.operationId,
      candidateSha: prepared.candidateSha,
      releaseGenerationId: prepared.releaseGenerationId,
      sourceManifestSha256: prepared.sourceManifestSha256,
      artifactRootFingerprintSha256: prepared.artifactRootFingerprintSha256,
      authorityConsumptionSha256: prepared.authorityConsumptionSha256,
      preparedTakeoverSha256: preparedSha256,
      oldLeaseSha256: prepared.oldLeaseSha256,
      tombstoneRelativePath: `production-operation-root.lease-tombstone-${prepared.oldLeaseSha256}.json`,
      newLeaseSha256: prepared.newLeaseSha256,
      newLeaseEpoch: prepared.newLeaseEpoch,
      operationDeadlineAt: prepared.operationDeadlineAt,
      committedAt: prepared.preparedAt
    }, prepared);
    const committedBytes = canonicalBytesV2(committed);
    exactReplayOrConflict(this.#path(
      `production-operation-root.lease-takeover-committed-${releaseSha256V2(committedBytes)}.json`),
    committedBytes, "production_operation_takeover_committed_conflict");
    injectedFault(input.faultAt, "after_committed");
    return committed;
  }

  #completedStepState(operationId: string): {
    completedStepReceiptSetSha256: string;
    attemptedExternalEffect: boolean;
  } {
    const receipts: Array<{ relativePath: string; sha256: string; sequence: number;
      executionKind: "local_validation" | "external_effect" }> = [];
    let receiptDirectory: string | null = null;
    try {
      receiptDirectory = dirname(this.#path(
        `production-operation-steps/${operationId}/probe.json`));
    } catch (error) {
      if ((error as Error).message !== "artifact_parent_missing") throw error;
    }
    if (receiptDirectory !== null) {
      for (const name of readdirSync(receiptDirectory).filter((value) => value.endsWith("-v2.json"))) {
        const relativePath = `production-operation-steps/${operationId}/${name}`;
        const receipt = readCanonical(this.#path(relativePath),
          validateProductionOrchestrationStepReceiptV2, "production_step_receipt");
        if (receipt.value.operationId !== operationId
            || name !== `${receipt.value.sequence}-${receipt.value.stepId}-v2.json`) {
          throw new Error("production_completed_step_filename_invalid");
        }
        receipts.push({ relativePath, sha256: receipt.sha256, sequence: receipt.value.sequence,
          executionKind: receipt.value.executionKind });
      }
    }
    receipts.sort((left, right) => left.sequence - right.sequence);
    if (receipts.some((receipt, index) => receipt.sequence !== index + 1)) {
      throw new Error("production_completed_step_prefix_invalid");
    }
    let hasIntent = false;
    try {
      const intentDirectory = dirname(this.#path(
        `production-operation-step-intents/${operationId}/probe.json`));
      hasIntent = readdirSync(intentDirectory).some((value) => value.endsWith("-v2.json"));
    } catch (error) {
      if ((error as Error).message !== "artifact_parent_missing") throw error;
    }
    const refs = receipts.map(({ relativePath, sha256 }) => ({ relativePath, sha256 }));
    return {
      completedStepReceiptSetSha256: releaseSha256V2(canonicalBytesV2(refs)),
      attemptedExternalEffect: hasIntent
        || receipts.some((receipt) => receipt.executionKind === "external_effect")
    };
  }

  async takeoverCleanupOnly(input: {
    expectedOldLeaseSha256: string; evaluatedAt: string; faultAt?: string;
  }): Promise<{
    takeover: CleanupOnlyProductionOperationTakeoverV2;
    abandoned: ProductionOperationTerminalAbandonedV2;
    cleanup: ProductionOperationTerminalCleanupV2;
  }> {
    const expectedOldLeaseSha256 = exactSha(input.expectedOldLeaseSha256,
      "production_operation_expected_old_lease_sha");
    this.#assertManifestWriterAbsent();
    const oldLease = this.#oldLeaseForTakeover(expectedOldLeaseSha256);
    const preparedPath = this.#path(
      `production-operation-root.lease-cleanup-only-prepared-${expectedOldLeaseSha256}.json`);
    const existingPrepared = existsSync(preparedPath)
      ? readCanonical(preparedPath, validatePreparedCleanupOnlyProductionOperationTakeoverV2,
        "prepared_cleanup_only_production_operation_takeover") : null;
    const protocolAt = existingPrepared?.value.preparedAt ?? input.evaluatedAt;
    const context = this.#assertTakeoverEligible(oldLease, protocolAt);
    const authorityExpired = context.evaluatedAtMs >= Date.parse(context.authorityExpiresAt);
    const deadlineReached = context.evaluatedAtMs >= Date.parse(oldLease.value.operationDeadlineAt);
    if (!authorityExpired && !deadlineReached) throw new Error("cleanup_only_takeover_bound_not_reached");
    const terminalReason = deadlineReached ? "operation_deadline_reached"
      : context.claim === null ? "authority_expired_before_claim" : "authority_expired_after_claim";
    let prepared: PreparedCleanupOnlyProductionOperationTakeoverV2;
    let preparedSha256: string;
    const replay = this.#committedCleanupTakeoverForOld(expectedOldLeaseSha256);
    if (existingPrepared !== null) {
      prepared = existingPrepared.value;
      preparedSha256 = existingPrepared.sha256;
      if (prepared.oldLeaseSha256 !== expectedOldLeaseSha256
          || prepared.oldLeaseEpoch !== oldLease.value.leaseEpoch
          || prepared.oldOwnerProcessIdentitySha256 !== operationOwnerSha(oldLease.value)
          || prepared.authorityConsumptionSha256 !== context.authorityConsumptionSha256
          || prepared.terminalReason !== terminalReason) {
        throw new Error("prepared_cleanup_only_takeover_conflict");
      }
    } else {
      if (existsSync(this.#path(
        `production-operation-root.lease-takeover-prepared-${expectedOldLeaseSha256}.json`))) {
        throw new Error("production_operation_takeover_capability_conflict");
      }
      const owner = currentRootWriterOwnerIdentityV2();
      const newLease = validateProductionOperationLeaseV2({
        ...oldLease.value,
        capability: "cleanup_only",
        leaseEpoch: oldLease.value.leaseEpoch + 1,
        ownerPid: owner.pid,
        ownerProcessStartFingerprintSha256: owner.processStartFingerprintSha256,
        acquiredAt: protocolAt,
        heartbeatAt: protocolAt,
        expiresAt: new Date(context.evaluatedAtMs + 60_000).toISOString()
      }) as ProductionOperationLeaseV2 & { capability: "cleanup_only" };
      const newLeaseBytes = canonicalBytesV2(newLease);
      prepared = validatePreparedCleanupOnlyProductionOperationTakeoverV2({
        version: "prepared-cleanup-only-production-operation-takeover-v2",
        commandId: "production_operation_cleanup_only_takeover",
        redactedTemplateSha256: PRODUCTION_OPERATION_CLEANUP_ONLY_TAKEOVER_TEMPLATE_SHA256_V2,
        capability: "cleanup_only",
        operationKind: oldLease.value.operationKind,
        operationId: oldLease.value.operationId,
        candidateSha: oldLease.value.candidateSha,
        releaseGenerationId: oldLease.value.releaseGenerationId,
        sourceManifestSha256: oldLease.value.sourceManifestSha256,
        artifactRootFingerprintSha256: oldLease.value.artifactRootFingerprintSha256,
        authorityConsumptionSha256: context.authorityConsumptionSha256,
        terminalReason,
        oldLeaseSha256: oldLease.sha256,
        oldLeaseEpoch: oldLease.value.leaseEpoch,
        oldOwnerProcessIdentitySha256: operationOwnerSha(oldLease.value),
        canonicalNewLease: newLease,
        canonicalNewLeaseUtf8Base64: newLeaseBytes.toString("base64"),
        newLeaseSha256: releaseSha256V2(newLeaseBytes),
        newLeaseEpoch: newLease.leaseEpoch,
        operationDeadlineAt: oldLease.value.operationDeadlineAt,
        preparedAt: protocolAt
      });
      const preparedBytes = canonicalBytesV2(prepared);
      writeExclusiveDurable(preparedPath, preparedBytes);
      preparedSha256 = releaseSha256V2(preparedBytes);
    }
    injectedFault(input.faultAt, "after_prepare");
    let takeover: CleanupOnlyProductionOperationTakeoverV2;
    let takeoverSha256: string;
    if (replay !== null) {
      takeover = replay.value;
      takeoverSha256 = replay.sha256;
    } else {
      const leasePath = this.#path(PRODUCTION_OPERATION_LEASE_FILE_V2);
      const tombstonePath = this.#path(
        `production-operation-root.lease-tombstone-${expectedOldLeaseSha256}.json`);
      if (existsSync(leasePath) && releaseSha256V2(readFileSync(leasePath)) === expectedOldLeaseSha256) {
        moveNoOverwriteDurable(leasePath, tombstonePath);
      } else {
        const tombstone = readCanonical(tombstonePath, validateProductionOperationLeaseV2,
          "production_operation_tombstone");
        if (tombstone.sha256 !== expectedOldLeaseSha256) throw new Error("production_operation_tombstone_conflict");
      }
      injectedFault(input.faultAt, "after_tombstone");
      this.#assertManifestWriterAbsent();
      const newLeaseBytes = Buffer.from(prepared.canonicalNewLeaseUtf8Base64, "base64");
      exactReplayOrConflict(leasePath, newLeaseBytes, "production_operation_new_lease_conflict");
      this.#assertManifestWriterAbsent();
      injectedFault(input.faultAt, "after_lease");
      injectedFault(input.faultAt, "after_new_lease");
      takeover = validateCleanupOnlyProductionOperationTakeoverV2({
        version: "cleanup-only-production-operation-takeover-v2",
        commandId: "production_operation_cleanup_only_takeover",
        redactedTemplateSha256: PRODUCTION_OPERATION_CLEANUP_ONLY_TAKEOVER_TEMPLATE_SHA256_V2,
        capability: "cleanup_only",
        operationKind: prepared.operationKind,
        operationId: prepared.operationId,
        candidateSha: prepared.candidateSha,
        releaseGenerationId: prepared.releaseGenerationId,
        sourceManifestSha256: prepared.sourceManifestSha256,
        artifactRootFingerprintSha256: prepared.artifactRootFingerprintSha256,
        authorityConsumptionSha256: prepared.authorityConsumptionSha256,
        terminalReason: prepared.terminalReason,
        preparedTakeoverSha256: preparedSha256,
        oldLeaseSha256: prepared.oldLeaseSha256,
        tombstoneRelativePath: `production-operation-root.lease-tombstone-${prepared.oldLeaseSha256}.json`,
        newLeaseSha256: prepared.newLeaseSha256,
        newLeaseEpoch: prepared.newLeaseEpoch,
        operationDeadlineAt: prepared.operationDeadlineAt,
        committedAt: prepared.preparedAt
      }, prepared);
      const takeoverBytes = canonicalBytesV2(takeover);
      takeoverSha256 = releaseSha256V2(takeoverBytes);
      exactReplayOrConflict(this.#path(
        `production-operation-root.lease-cleanup-only-committed-${takeoverSha256}.json`),
      takeoverBytes, "cleanup_only_takeover_committed_conflict");
    }
    injectedFault(input.faultAt, "after_committed");
    const stepState = this.#completedStepState(oldLease.value.operationId);
    const abandoned = validateProductionOperationTerminalAbandonedV2({
      version: "production-operation-terminal-abandoned-v2",
      operationKind: oldLease.value.operationKind,
      operationId: oldLease.value.operationId,
      candidateSha: oldLease.value.candidateSha,
      releaseGenerationId: oldLease.value.releaseGenerationId,
      sourceManifestSha256: oldLease.value.sourceManifestSha256,
      claimSha256: context.claim?.sha256 ?? null,
      authorityConsumptionSha256: context.authorityConsumptionSha256,
      capability: "cleanup_only",
      cleanupOnlyTakeoverSha256: takeoverSha256,
      finalLeaseSha256: prepared.newLeaseSha256,
      finalLeaseEpoch: prepared.newLeaseEpoch,
      completedStepReceiptSetSha256: stepState.completedStepReceiptSetSha256,
      attemptedExternalEffect: stepState.attemptedExternalEffect,
      reason: prepared.terminalReason,
      abandonedAt: prepared.preparedAt
    });
    const abandonedRecord = this.persistExclusive("production_operation_terminal_abandoned",
      `production-operation-terminal-abandoned-${oldLease.value.operationId}.json`, abandoned);
    injectedFault(input.faultAt, "after_terminal_abandoned");
    const terminal = this.completeTerminal({
      operationId: oldLease.value.operationId,
      terminalStateKind: "terminal_abandoned",
      terminalStateSha256: abandonedRecord.sha256,
      evaluatedAt: prepared.preparedAt,
      faultAt: input.faultAt
    });
    return { takeover, abandoned, cleanup: terminal.cleanup };
  }

  #originalLeaseForOperation(operationId: string): { sha256: string; ownerSha256: string } {
    const preclaimPath = this.#path(`production-authority-preclaim-${operationId}.json`);
    if (existsSync(preclaimPath)) {
      const preclaim = readCanonical(preclaimPath, validateProductionAuthorityPreclaimValidationV2,
        "production_authority_preclaim").value;
      return { sha256: preclaim.originalLeaseSha256,
        ownerSha256: preclaim.originalLeaseOwnerProcessIdentitySha256 };
    }
    const candidates = readdirSync(this.#root)
      .filter((name) => name.startsWith("production-operation-root.lease-tombstone-")
        && name.endsWith(".json"))
      .map((name) => readCanonical(this.#path(name), validateProductionOperationLeaseV2,
        "production_operation_tombstone"))
      .filter(({ value }) => value.operationId === operationId && value.leaseEpoch === 1);
    if (candidates.length === 1) {
      return { sha256: candidates[0]!.sha256, ownerSha256: operationOwnerSha(candidates[0]!.value) };
    }
    throw new Error("production_operation_original_lease_unverified");
  }
}

export async function takeoverProductionOperationLeaseV2(input: {
  artifactRoot: string;
  expectedOldLeaseSha256: string;
  evaluatedAt: string;
  faultAt?: string;
}): Promise<CommittedProductionOperationLeaseTakeoverV2> {
  return new ProductionOperationStoreV2(input.artifactRoot).takeoverEffectCapable(input);
}

export async function takeoverCleanupOnlyProductionOperationLeaseV2(input: {
  artifactRoot: string;
  expectedOldLeaseSha256: string;
  evaluatedAt: string;
  faultAt?: string;
}): Promise<{
  takeover: CleanupOnlyProductionOperationTakeoverV2;
  abandoned: ProductionOperationTerminalAbandonedV2;
  cleanup: ProductionOperationTerminalCleanupV2;
}> {
  return new ProductionOperationStoreV2(input.artifactRoot).takeoverCleanupOnly(input);
}
