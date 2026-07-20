import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, type Dirent } from "node:fs";
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
  validateOperationalAttestationIssuerReceiptV2,
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
  validateProductionCanaryEvidenceV2,
  validateProductionFailureEvidenceV2,
  validateProductionRollbackEvidenceV2,
  validateProductionRolloutEvidenceV2,
  validateProductionOrchestrationStepIntentV2,
  validateProductionOrchestrationStepReceiptV2,
  validateProductionOrchestrationReceiptV2,
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
  type ProductionRollbackOutcomeV2,
  type ProductionOperationSettlementV2,
  type ProductionOperationTerminalAbandonedV2,
  type ProductionOperationTerminalCleanupV2,
  type ProductionOrchestrationStepIntentV2,
  type ProductionOrchestrationStepReceiptV2,
  type ProductionOrchestrationReceiptV2,
  type ProductionPreclaimLeaseLineageV2
} from "./remediationReleaseManifestV2";
import { validateTask0BReleaseFreezeEvidence } from "./remediationReleaseManifest";
import {
  assertRecoveryFailureArtifactBindingsV2,
  assertCommittedOperationalAuthorityRecordV2,
  currentRootWriterOwnerIdentityV2,
  deriveReleaseFreezeIdentityV2,
  isLeaseOwnerProcessAliveV2,
  selectOperationalAttestationFromStoreV2,
  verifyCurrentReleaseManifestChainAtTrustedRootV2
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
  replaceDurable,
  writeExclusiveDurable
} from "./releaseRootWriterStore";

export const PRODUCTION_OPERATION_LEASE_FILE_V2 = "production-operation-root.lease.json";
export type SettledRollbackHistoricalProofVerifierV2 = (input: Readonly<{
  operationId: string;
  operationClaimSha256: string;
  authorityConsumptionSha256: string;
  authorityExpiresAt: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  operationDeadlineAt: string;
  lineageLeaseTips: readonly Readonly<{ sha256: string; epoch: number }>[];
  failureEvidenceSha256: string;
  previousRuntimeIdentitySha256: string;
  outcome: ProductionRollbackOutcomeV2;
}>) => void;
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

export function productionOperationAttemptedExternalEffectV2(
  operationKind: ProductionOperationKindV2,
  hasIntent: boolean,
  receiptExecutionKinds: readonly ("local_validation" | "external_effect")[]
): boolean {
  return operationKind === "canary" || hasIntent
    || receiptExecutionKinds.includes("external_effect");
}
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
const COMPLETE_OPERATION_STEPS: Readonly<Record<ProductionOperationKindV2, readonly string[]>> = Object.freeze({
  rollout: ["verify_g13", "verify_schema", "verify_previous_runtime_identity", "verify_singleton_precondition",
    "stop_previous", "prove_previous_stopped", "start_candidate", "prove_candidate_started",
    "immediate_runtime_checks"],
  canary: ["verify_g14", "observe_cycle_1", "observe_cycle_2", "bounded_runtime_checks"],
  rollback: [],
  recovery: ["verify_abandoned_cleanup", "verify_completed_prefix", "verify_uncertain_step_intent",
    "validate_failure_derivation_inputs"]
});
const ALLOWED_NESTED_ROOTS = new Set([
  "production-preclaim-lease-lineages",
  "production-operation-step-intents",
  "production-operation-steps",
  "production-runtime-effect-reconciliations",
  "production-operation-terminal-artifacts"
]);

type ProductionTerminalArtifactIndexV2 = Readonly<{
  version: "production-terminal-artifact-index-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  operationClaimSha256: string;
  authorityConsumptionSha256: string;
  terminalEvidenceSha256: string;
  orchestrationReceiptSha256: string | null;
  artifacts: readonly Readonly<{
    kind: string;
    operationQualifiedRelativePath: string;
    canonicalRelativePath: string | null;
    sha256: string;
  }>[];
}>;

type ProductionTerminalArtifactPointerV2 = Readonly<{
  version: "production-terminal-artifact-pointer-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  terminalArtifactIndexSha256: string;
  settlementSha256: string;
}>;

type ProductionFailureDraftV2 = Readonly<{
  version: "production-failure-draft-v2";
  operationKind: "rollout" | "canary";
  operationId: string;
  operationClaimSha256: string;
  stepId: string;
  failureCode: string;
  attemptedExternalEffect: boolean;
  completedStepReceiptPrefixSha256: string;
  orchestrationProgressSha256: string;
  observedAt: string;
}>;

function validateProductionFailureDraft(value: unknown): ProductionFailureDraftV2 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("production_failure_draft_invalid");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join("|") !== ["version", "operationKind", "operationId",
    "operationClaimSha256", "stepId", "failureCode", "attemptedExternalEffect",
    "completedStepReceiptPrefixSha256", "orchestrationProgressSha256", "observedAt"].sort().join("|")
      || input.version !== "production-failure-draft-v2"
      || !["rollout", "canary"].includes(String(input.operationKind))
      || typeof input.stepId !== "string" || !/^[a-z][a-z0-9_]*$/u.test(input.stepId)
      || typeof input.failureCode !== "string" || !/^[a-z][a-z0-9_]*$/u.test(input.failureCode)
      || typeof input.attemptedExternalEffect !== "boolean") {
    throw new Error("production_failure_draft_invalid");
  }
  exactOperationId(String(input.operationId));
  exactSha(String(input.operationClaimSha256), "production_failure_draft_claim");
  exactSha(String(input.completedStepReceiptPrefixSha256), "production_failure_draft_prefix");
  exactSha(String(input.orchestrationProgressSha256), "production_failure_draft_progress");
  parseIso(String(input.observedAt), "production_failure_draft_observed_at");
  return value as ProductionFailureDraftV2;
}

function validateTerminalArtifactPointer(value: unknown): ProductionTerminalArtifactPointerV2 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("production_terminal_artifact_pointer_invalid");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join("|") !== ["version", "operationKind", "operationId",
    "terminalArtifactIndexSha256", "settlementSha256"].sort().join("|")
      || input.version !== "production-terminal-artifact-pointer-v2"
      || !["rollout", "canary", "rollback", "recovery"].includes(String(input.operationKind))) {
    throw new Error("production_terminal_artifact_pointer_invalid");
  }
  exactOperationId(String(input.operationId));
  exactSha(String(input.terminalArtifactIndexSha256), "production_terminal_pointer_index");
  exactSha(String(input.settlementSha256), "production_terminal_pointer_settlement");
  return value as ProductionTerminalArtifactPointerV2;
}

const TERMINAL_CANONICAL_PATHS = new Set([
  "production-rollout-orchestration-receipt-v2.json", "production-rollout-query-captures-v2.json",
  "production-rollout-manager-captures-v2.json", "production-rollout-evidence-v2.json",
  "production-canary-orchestration-receipt-v2.json", "production-canary-query-captures-v2.json",
  "production-canary-log-captures-v2.json", "production-canary-evidence-v2.json",
  "production-rollback-orchestration-receipt-v2.json", "production-rollback-query-captures-v2.json",
  "production-rollback-manager-captures-v2.json", "production-rollback-evidence-v2.json",
  "production-recovery-orchestration-receipt-v2.json", "production-recovery-validation-captures-v2.json",
  "production-failure-evidence-v2.json"
]);

function terminalCanonicalPath(operationId: string, kind: string): string | null {
  const fixed: Readonly<Record<string, string>> = Object.freeze({
    rollout_orchestration: "production-rollout-orchestration-receipt-v2.json",
    rollout_captures: "production-rollout-query-captures-v2.json",
    rollout_manager: "production-rollout-manager-captures-v2.json",
    rollout_evidence: "production-rollout-evidence-v2.json",
    canary_orchestration: "production-canary-orchestration-receipt-v2.json",
    canary_captures: "production-canary-query-captures-v2.json",
    canary_logs: "production-canary-log-captures-v2.json",
    canary_evidence: "production-canary-evidence-v2.json",
    rollback_orchestration: "production-rollback-orchestration-receipt-v2.json",
    rollback_captures: "production-rollback-query-captures-v2.json",
    rollback_manager: "production-rollback-manager-captures-v2.json",
    rollback_evidence: "production-rollback-evidence-v2.json",
    recovery_orchestration: "production-recovery-orchestration-receipt-v2.json",
    recovery_captures: "production-recovery-validation-captures-v2.json",
    recovery_failure_evidence: "production-failure-evidence-v2.json",
    failure_evidence: "production-failure-evidence-v2.json"
  });
  return kind === "failure_capture" ? `production-operation-failure-capture-${operationId}.json`
    : fixed[kind] ?? null;
}

function validateTerminalArtifactIndex(value: unknown): ProductionTerminalArtifactIndexV2 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("production_terminal_artifact_index_invalid");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join("|") !== ["artifacts", "authorityConsumptionSha256", "operationClaimSha256",
    "operationId", "operationKind", "orchestrationReceiptSha256", "terminalEvidenceSha256", "version"]
    .sort().join("|") || input.version !== "production-terminal-artifact-index-v2"
      || !["rollout", "canary", "rollback", "recovery"].includes(String(input.operationKind))) {
    throw new Error("production_terminal_artifact_index_invalid");
  }
  const operationId = exactOperationId(String(input.operationId));
  for (const field of ["operationClaimSha256", "authorityConsumptionSha256", "terminalEvidenceSha256"] as const) {
    exactSha(String(input[field]), `production_terminal_index_${field}`);
  }
  if (input.orchestrationReceiptSha256 !== null) {
    exactSha(String(input.orchestrationReceiptSha256), "production_terminal_index_orchestration");
  }
  if (!Array.isArray(input.artifacts) || input.artifacts.length < 1 || input.artifacts.length > 5) {
    throw new Error("production_terminal_artifact_index_entries_invalid");
  }
  const seenQualified = new Set<string>();
  const seenCanonical = new Set<string>();
  const seenKinds = new Set<string>();
  for (const raw of input.artifacts) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("production_terminal_artifact_index_entry_invalid");
    }
    const entry = raw as Record<string, unknown>;
    if (Object.keys(entry).sort().join("|") !== ["canonicalRelativePath", "kind",
      "operationQualifiedRelativePath", "sha256"].sort().join("|")
        || typeof entry.kind !== "string" || !/^[a-z][a-z0-9_]*$/u.test(entry.kind)) {
      throw new Error("production_terminal_artifact_index_entry_invalid");
    }
    if (seenKinds.has(String(entry.kind))) throw new Error("production_terminal_artifact_kind_duplicate");
    seenKinds.add(String(entry.kind));
    const qualified = String(entry.operationQualifiedRelativePath);
    if (!qualified.startsWith(`production-operation-terminal-artifacts/${operationId}/`)
        || !/^[a-z0-9/_-]+\.json$/u.test(qualified) || seenQualified.has(qualified)) {
      throw new Error("production_terminal_artifact_index_path_invalid");
    }
    seenQualified.add(qualified);
    if (entry.canonicalRelativePath === null) {
      throw new Error("production_terminal_artifact_canonical_path_invalid");
    } else {
      const canonical = String(entry.canonicalRelativePath);
      if ((!TERMINAL_CANONICAL_PATHS.has(canonical)
          && canonical !== `production-operation-failure-capture-${operationId}.json`)
          || canonical !== terminalCanonicalPath(operationId, String(entry.kind))
          || seenCanonical.has(canonical)) {
        throw new Error("production_terminal_artifact_canonical_path_invalid");
      }
      seenCanonical.add(canonical);
    }
    exactSha(String(entry.sha256), "production_terminal_artifact_sha");
  }
  const bundle = [...seenKinds].sort().join("|");
  const expectedBundles: Readonly<Record<string, readonly string[]>> = Object.freeze({
    rollout: ["rollout_captures|rollout_evidence|rollout_manager|rollout_orchestration",
      "failure_capture|failure_evidence"],
    canary: ["canary_captures|canary_evidence|canary_logs|canary_orchestration",
      "failure_capture|failure_evidence"],
    rollback: ["rollback_captures|rollback_evidence|rollback_manager|rollback_orchestration"],
    recovery: ["recovery_captures|recovery_failure_evidence|recovery_orchestration"]
  });
  if (!expectedBundles[String(input.operationKind)]?.includes(bundle)) {
    throw new Error("production_terminal_artifact_bundle_invalid");
  }
  const artifacts = input.artifacts as ProductionTerminalArtifactIndexV2["artifacts"];
  const evidence = artifacts.find((artifact) => artifact.kind.endsWith("_evidence"));
  const orchestration = artifacts.find((artifact) => artifact.kind.endsWith("_orchestration"));
  if (evidence?.sha256 !== input.terminalEvidenceSha256
      || (orchestration?.sha256 ?? null) !== input.orchestrationReceiptSha256) {
    throw new Error("production_terminal_artifact_terminal_refs_invalid");
  }
  return value as ProductionTerminalArtifactIndexV2;
}

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
    let verified: ReturnType<typeof verifyCurrentReleaseManifestChainAtTrustedRootV2>;
    try {
      verified = verifyCurrentReleaseManifestChainAtTrustedRootV2(this.#root);
    } catch (error) {
      if ((error as Error).message === "release_freeze_materialization_preflight_binding_invalid") {
        throw new Error("production_operation_task0b_release_freeze_binding_invalid", { cause: error });
      }
      throw error;
    }
    const freeze = verified.freeze;
    return {
      candidateSha: freeze.candidateSha,
      releaseGenerationId: freeze.releaseGenerationId,
      artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
      sourceManifestSha256: verified.manifestSha256
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

  loadOrPersistFailureDraft(input: Omit<ProductionFailureDraftV2, "version" | "observedAt">,
    evaluatedAt: string): Readonly<{ value: ProductionFailureDraftV2; sha256: string }> {
    const current = this.assertOwnedAndWithinBounds(input.operationId, evaluatedAt);
    if (input.operationKind !== current.lease.operationKind
        || input.operationClaimSha256 !== current.claimSha256) {
      throw new Error("production_failure_draft_operation_binding_invalid");
    }
    const relativePath = `production-operation-failure-draft-${input.operationId}.json`;
    const path = this.#path(relativePath);
    if (existsSync(path)) {
      const stored = readCanonical(path, validateProductionFailureDraft, "production_failure_draft");
      const expected = { ...input };
      const actual = { operationKind: stored.value.operationKind, operationId: stored.value.operationId,
        operationClaimSha256: stored.value.operationClaimSha256, stepId: stored.value.stepId,
        failureCode: stored.value.failureCode,
        attemptedExternalEffect: stored.value.attemptedExternalEffect,
        completedStepReceiptPrefixSha256: stored.value.completedStepReceiptPrefixSha256,
        orchestrationProgressSha256: stored.value.orchestrationProgressSha256 };
      if (!canonicalBytesV2(actual).equals(canonicalBytesV2(expected))) {
        throw new Error("production_failure_draft_replay_conflict");
      }
      return { value: stored.value, sha256: stored.sha256 };
    }
    const draft = validateProductionFailureDraft({ version: "production-failure-draft-v2",
      ...input, observedAt: evaluatedAt });
    const record = this.persistExclusive("production_failure_draft", relativePath, draft);
    return { value: draft, sha256: record.sha256 };
  }

  loadFailureDraft(operationId: string, evaluatedAt: string): null | Readonly<{
    value: ProductionFailureDraftV2; sha256: string }> {
    exactOperationId(operationId);
    const current = this.assertOwnedAndWithinBounds(operationId, evaluatedAt);
    const path = this.#path(`production-operation-failure-draft-${operationId}.json`);
    if (!existsSync(path)) return null;
    const stored = readCanonical(path, validateProductionFailureDraft, "production_failure_draft");
    if (stored.value.operationId !== operationId
        || stored.value.operationKind !== current.lease.operationKind
        || stored.value.operationClaimSha256 !== current.claimSha256) {
      throw new Error("production_failure_draft_operation_binding_invalid");
    }
    return { value: stored.value, sha256: stored.sha256 };
  }

  persistTerminalArtifactIndex(value: unknown, evaluatedAt: string): ProductionOperationStoreRecordV2 {
    const index = validateTerminalArtifactIndex(value);
    const current = this.assertOwnedAndWithinBounds(index.operationId, evaluatedAt);
    if (index.operationKind !== current.lease.operationKind
        || index.operationClaimSha256 !== current.claimSha256
        || index.authorityConsumptionSha256 !== current.claim.authorityConsumptionSha256) {
      throw new Error("production_terminal_artifact_index_operation_binding_invalid");
    }
    for (const artifact of index.artifacts) {
      const bytes = readFileSync(this.#path(artifact.operationQualifiedRelativePath));
      if (releaseSha256V2(bytes) !== artifact.sha256) {
        throw new Error("production_terminal_artifact_index_hash_invalid");
      }
    }
    return this.persistExclusive("production_terminal_artifact_index",
      `production-terminal-artifact-index-${index.operationId}.json`, index);
  }

  publishTerminalArtifacts(operationId: string): void {
    exactOperationId(operationId);
    const index = readCanonical(this.#path(`production-terminal-artifact-index-${operationId}.json`),
      validateTerminalArtifactIndex, "production_terminal_artifact_index");
    const settlement = readCanonical(this.#path(`production-operation-settlement-${operationId}.json`),
      validateProductionOperationSettlementV2, "production_operation_settlement");
    if (index.value.operationId !== operationId
        || index.value.operationKind !== settlement.value.operationKind
        || index.value.operationClaimSha256 !== settlement.value.claimSha256
        || index.value.authorityConsumptionSha256 !== settlement.value.authorityConsumptionSha256
        || index.value.terminalEvidenceSha256 !== settlement.value.terminalEvidenceSha256
        || index.value.orchestrationReceiptSha256 !== settlement.value.orchestrationReceiptSha256) {
      throw new Error("production_terminal_artifact_index_settlement_binding_invalid");
    }
    const pointerValue = validateTerminalArtifactPointer({
      version: "production-terminal-artifact-pointer-v2",
      operationKind: index.value.operationKind,
      operationId,
      terminalArtifactIndexSha256: index.sha256,
      settlementSha256: settlement.sha256
    });
    const pointerPath = this.#path(
      `production-terminal-artifact-pointer-${index.value.operationKind}-v2.json`);
    let priorPointer: { value: ProductionTerminalArtifactPointerV2; sha256: string } | null = null;
    let priorArtifacts = new Map<string, string>();
    if (existsSync(pointerPath)) {
      const storedPointer = readCanonical(pointerPath, validateTerminalArtifactPointer,
        "production_terminal_artifact_pointer");
      priorPointer = { value: storedPointer.value, sha256: storedPointer.sha256 };
      if (storedPointer.value.operationKind !== index.value.operationKind) {
        throw new Error("production_terminal_artifact_pointer_kind_invalid");
      }
      const priorIndex = readCanonical(this.#path(
        `production-terminal-artifact-index-${storedPointer.value.operationId}.json`),
      validateTerminalArtifactIndex, "production_terminal_artifact_index");
      const priorSettlement = readCanonical(this.#path(
        `production-operation-settlement-${storedPointer.value.operationId}.json`),
      validateProductionOperationSettlementV2, "production_operation_settlement");
      if (priorIndex.sha256 !== storedPointer.value.terminalArtifactIndexSha256
          || priorSettlement.sha256 !== storedPointer.value.settlementSha256
          || priorIndex.value.operationId !== storedPointer.value.operationId
          || priorIndex.value.operationKind !== storedPointer.value.operationKind
          || priorSettlement.value.operationId !== storedPointer.value.operationId
          || priorSettlement.value.operationKind !== storedPointer.value.operationKind
          || priorIndex.value.operationClaimSha256 !== priorSettlement.value.claimSha256
          || priorIndex.value.authorityConsumptionSha256
            !== priorSettlement.value.authorityConsumptionSha256) {
        throw new Error("production_terminal_artifact_pointer_binding_invalid");
      }
      if (storedPointer.value.operationId !== operationId) {
        const priorCleanup = readCanonical(this.#path(
          `production-operation-terminal-cleanup-${storedPointer.value.operationId}.json`),
        validateProductionOperationTerminalCleanupV2, "production_operation_terminal_cleanup");
        if (priorCleanup.value.operationId !== storedPointer.value.operationId
            || priorCleanup.value.terminalStateSha256 !== priorSettlement.sha256) {
          throw new Error("production_terminal_artifact_pointer_cleanup_invalid");
        }
      }
      priorArtifacts = new Map(priorIndex.value.artifacts.flatMap((artifact) =>
        artifact.canonicalRelativePath === null ? [] : [[artifact.canonicalRelativePath, artifact.sha256]]));
    }
    const publications = index.value.artifacts.map((artifact) => {
      const source = readFileSync(this.#path(artifact.operationQualifiedRelativePath));
      if (releaseSha256V2(source) !== artifact.sha256) {
        throw new Error("production_terminal_artifact_publication_hash_invalid");
      }
      if (artifact.canonicalRelativePath === null) return { artifact, source, target: null };
      const target = this.#path(artifact.canonicalRelativePath);
      if (existsSync(target)) {
        const actualSha = releaseSha256V2(readFileSync(target));
        const priorSha = priorArtifacts.get(artifact.canonicalRelativePath);
        if (actualSha !== artifact.sha256 && actualSha !== priorSha) {
          throw new Error("production_terminal_artifact_publication_conflict");
        }
      }
      return { artifact, source, target };
    });
    for (const publication of publications) {
      if (publication.target === null) continue;
      if (!existsSync(publication.target)) {
        exactReplayOrConflict(publication.target, publication.source,
          "production_terminal_artifact_publication_conflict");
      } else if (releaseSha256V2(readFileSync(publication.target)) !== publication.artifact.sha256) {
        replaceDurable(publication.target, publication.source);
      }
    }
    const pointerBytes = canonicalBytesV2(pointerValue);
    if (priorPointer === null) writeExclusiveDurable(pointerPath, pointerBytes);
    else if (priorPointer.value.operationId !== operationId
        || priorPointer.value.terminalArtifactIndexSha256 !== index.sha256
        || priorPointer.value.settlementSha256 !== settlement.sha256) {
      replaceDurable(pointerPath, pointerBytes);
    } else if (!readFileSync(pointerPath).equals(pointerBytes)) {
      throw new Error("production_terminal_artifact_pointer_conflict");
    }
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

  #verifyStoredPreclaimLineage(
    preclaim: { value: ProductionAuthorityPreclaimValidationV2; sha256: string },
    tip: { value: ProductionPreclaimLeaseLineageV2; sha256: string }
  ): void {
    const visited = new Set<string>();
    let current = tip;
    while (true) {
      if (visited.has(current.sha256)) throw new Error("production_preclaim_lineage_cycle");
      visited.add(current.sha256);
      const value = current.value;
      if (value.operationId !== preclaim.value.operationId
          || value.preclaimValidationSha256 !== preclaim.sha256
          || value.relativePath
            !== `production-preclaim-lease-lineages/${preclaim.value.operationId}/${value.currentTipLeaseSha256}.json`
          || value.lineageStartedAt !== preclaim.value.checkedAt) {
        throw new Error("production_preclaim_lineage_binding_invalid");
      }
      if (value.previousLineageSha256 === null) {
        if (value.originalLeaseSha256 !== preclaim.value.originalLeaseSha256
            || value.originalLeaseEpoch !== preclaim.value.originalLeaseEpoch
            || value.originalLeaseOwnerProcessIdentitySha256
              !== preclaim.value.originalLeaseOwnerProcessIdentitySha256
            || value.currentTipLeaseSha256 !== preclaim.value.originalLeaseSha256
            || value.currentTipLeaseEpoch !== preclaim.value.originalLeaseEpoch
            || value.currentTipLeaseOwnerProcessIdentitySha256
              !== preclaim.value.originalLeaseOwnerProcessIdentitySha256
            || value.committedTakeoverReceiptSuffixSha256s.length !== 0) {
          throw new Error("production_preclaim_lineage_root_invalid");
        }
        return;
      }
      if (value.committedTakeoverReceiptSuffixSha256s.length !== 1) {
        throw new Error("production_preclaim_lineage_suffix_invalid");
      }
      const previous = readCanonical(this.#path(
        `production-preclaim-lease-lineages/${preclaim.value.operationId}/${value.originalLeaseSha256}.json`),
      validateProductionPreclaimLeaseLineageV2, "production_preclaim_lease_lineage");
      if (previous.sha256 !== value.previousLineageSha256
          || previous.value.currentTipLeaseSha256 !== value.originalLeaseSha256
          || previous.value.currentTipLeaseEpoch !== value.originalLeaseEpoch
          || previous.value.currentTipLeaseOwnerProcessIdentitySha256
            !== value.originalLeaseOwnerProcessIdentitySha256) {
        throw new Error("production_preclaim_lineage_previous_invalid");
      }
      const receiptSha256 = value.committedTakeoverReceiptSuffixSha256s[0]!;
      let prepared!: { value: PreparedProductionOperationLeaseTakeoverV2; sha256: string };
      const receipt = readCanonical(this.#path(
        `production-operation-root.lease-takeover-committed-${receiptSha256}.json`),
      (raw) => {
        prepared = readCanonical(this.#path(
          `production-operation-root.lease-takeover-prepared-${value.originalLeaseSha256}.json`),
        validatePreparedProductionOperationLeaseTakeoverV2, "prepared_production_operation_takeover");
        return validateCommittedProductionOperationLeaseTakeoverV2(raw, prepared.value);
      },
      "committed_production_operation_takeover");
      const tombstone = readCanonical(this.#path(receipt.value.tombstoneRelativePath),
        validateProductionOperationLeaseV2, "production_operation_tombstone");
      if (receipt.sha256 !== receiptSha256 || receipt.value.oldLeaseSha256 !== value.originalLeaseSha256
          || receipt.value.newLeaseSha256 !== value.currentTipLeaseSha256
          || receipt.value.newLeaseEpoch !== value.currentTipLeaseEpoch
          || tombstone.sha256 !== value.originalLeaseSha256
          || operationOwnerSha(prepared.value.canonicalNewLease)
            !== value.currentTipLeaseOwnerProcessIdentitySha256) {
        throw new Error("production_preclaim_lineage_takeover_invalid");
      }
      current = previous;
    }
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
    return this.#verifyNormalTakeoverChainToTip(claim, {
      sha256: currentLease.sha256,
      epoch: currentLease.value.leaseEpoch
    });
  }

  #verifyNormalTakeoverChainToTip(
    claim: ProductionOperationClaimV2,
    currentTip: Readonly<{ sha256: string; epoch: number }>
  ): Readonly<{ sha256: string; leaseTips: readonly Readonly<{ sha256: string; epoch: number }>[] }> {
    let tipSha = claim.authorityConsumption.leaseSha256AtConsumption;
    let tipEpoch = claim.authorityConsumption.leaseEpochAtConsumption;
    const leaseTips: Array<Readonly<{ sha256: string; epoch: number }>> = [
      { sha256: tipSha, epoch: tipEpoch }
    ];
    const receipts = this.#normalTakeoverReceipts();
    const visited = new Set<string>();
    const receiptSha256s: string[] = [];
    while (tipSha !== currentTip.sha256) {
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
    if (tipEpoch !== currentTip.epoch) throw new Error("production_operation_takeover_tip_invalid");
    return { sha256: releaseSha256V2(canonicalBytesV2(receiptSha256s)), leaseTips };
  }

  verifyAbandonedRecoverySourceLineage(
    terminalInput: unknown,
    allowedOperationKinds: readonly ProductionOperationKindV2[] = ["rollout", "canary"]
  ): Readonly<{ claimSha256: string; authorityConsumptionSha256: string;
    leaseTips: ReadonlySet<string> }> {
    const terminal = validateProductionOperationTerminalAbandonedV2(terminalInput);
    if (terminal.claimSha256 === null || terminal.authorityConsumptionSha256 === null
        || terminal.capability !== "cleanup_only" || terminal.cleanupOnlyTakeoverSha256 === null
        || !allowedOperationKinds.includes(terminal.operationKind)) {
      throw new Error("production_recovery_terminal_claim_missing");
    }
    const claimEntries = readdirSync(this.#root, { withFileTypes: true }).filter((entry) =>
      entry.name.startsWith("production-operation-claim-") && entry.name.endsWith(".json"));
    if (claimEntries.some((entry) => !entry.isFile()
        || !/^production-operation-claim-[0-9a-f]{64}\.json$/u.test(entry.name))) {
      throw new Error("production_recovery_claim_artifact_invalid");
    }
    const matchingClaims = claimEntries.map((entry) => {
      const record = readCanonical(this.#path(entry.name), validateProductionOperationClaimV2,
        "production_operation_claim");
      if (entry.name !== `production-operation-claim-${record.value.operationalAttestationSha256}.json`) {
        throw new Error("production_recovery_claim_filename_invalid");
      }
      return record;
    }).filter((record) => record.sha256 === terminal.claimSha256);
    if (matchingClaims.length !== 1) throw new Error("production_recovery_claim_missing_or_ambiguous");
    const claim = matchingClaims[0]!;
    if (claim.value.operationKind !== terminal.operationKind
        || claim.value.operationId !== terminal.operationId
        || claim.value.candidateSha !== terminal.candidateSha
        || claim.value.releaseGenerationId !== terminal.releaseGenerationId
        || claim.value.sourceManifestSha256 !== terminal.sourceManifestSha256
        || claim.value.authorityConsumptionSha256 !== terminal.authorityConsumptionSha256
        || claim.value.capability !== "effect_capable"
        || releaseSha256V2(canonicalBytesV2(claim.value.authorityConsumption))
          !== terminal.authorityConsumptionSha256) {
      throw new Error("production_recovery_claim_binding_invalid");
    }
    const preclaim = readCanonical(this.#path(`production-authority-preclaim-${terminal.operationId}.json`),
      validateProductionAuthorityPreclaimValidationV2, "production_authority_preclaim");
    const lineage = readCanonical(this.#path(claim.value.preclaimLeaseLineageRelativePath),
      validateProductionPreclaimLeaseLineageV2, "production_preclaim_lease_lineage");
    if (preclaim.sha256 !== claim.value.authorityConsumption.preclaimValidationSha256
        || preclaim.value.operationId !== terminal.operationId
        || preclaim.value.operationKind !== terminal.operationKind
        || preclaim.value.candidateSha !== terminal.candidateSha
        || preclaim.value.releaseGenerationId !== terminal.releaseGenerationId
        || preclaim.value.sourceManifestSha256 !== terminal.sourceManifestSha256
        || lineage.sha256 !== claim.value.preclaimLeaseLineageSha256
        || lineage.value.operationId !== terminal.operationId
        || lineage.value.preclaimValidationSha256 !== preclaim.sha256
        || lineage.value.currentTipLeaseSha256 !== claim.value.preclaimLeaseLineageCurrentTipSha256
        || lineage.value.currentTipLeaseEpoch !== claim.value.leaseEpochAtConsumption) {
      throw new Error("production_recovery_preclaim_lineage_binding_invalid");
    }
    this.#verifyStoredPreclaimLineage(preclaim, lineage);

    const action = OPERATION_ACTION[terminal.operationKind];
    const freeze = readCanonical(this.#path("release-freeze-identity-v2.json"),
      validateReleaseFreezeIdentityV2, "release_freeze_identity");
    const attestation = readCanonical(safeArtifactRelativePath(this.#root,
      `operational-attestations/${action}/${terminal.releaseGenerationId}/${claim.value.operationalAttestationSha256}.json`),
    validateOperationalAttestationV2, "production_abandoned_operational_attestation");
    const issuerReceipt = readCanonical(safeArtifactRelativePath(this.#root,
      `operational-attestation-issuer-receipts/${action}/${terminal.releaseGenerationId}/${claim.value.operationalAttestationIssuerReceiptSha256}.json`),
    validateOperationalAttestationIssuerReceiptV2, "production_abandoned_operational_attestation_issuer_receipt");
    if (attestation.sha256 !== claim.value.operationalAttestationSha256
        || attestation.value.action !== action
        || attestation.value.generationId !== terminal.releaseGenerationId
        || attestation.value.candidateSha !== terminal.candidateSha
        || attestation.value.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze.value)
        || attestation.value.sourceManifestSha256 !== terminal.sourceManifestSha256
        || attestation.value.artifactRootFingerprintSha256 !== claim.value.artifactRootFingerprintSha256
        || attestation.value.commandId !== claim.value.authorityConsumption.commandId
        || attestation.value.redactedTemplateSha256
          !== claim.value.authorityConsumption.redactedTemplateSha256
        || freeze.value.releaseGenerationId !== terminal.releaseGenerationId
        || freeze.value.candidateSha !== terminal.candidateSha
        || freeze.value.artifactRootFingerprintSha256 !== claim.value.artifactRootFingerprintSha256
        || issuerReceipt.sha256 !== claim.value.operationalAttestationIssuerReceiptSha256
        || issuerReceipt.value.attestationSha256 !== attestation.sha256
        || issuerReceipt.value.action !== action
        || issuerReceipt.value.generationId !== terminal.releaseGenerationId) {
      throw new Error("production_abandoned_authority_binding_invalid");
    }
    assertCommittedOperationalAuthorityRecordV2(this.#root, freeze.value, {
      attestationSha256: attestation.sha256, issuerReceiptSha256: issuerReceipt.sha256
    });

    const cleanupTakeover = readCanonical(this.#path(
      `production-operation-root.lease-cleanup-only-committed-${terminal.cleanupOnlyTakeoverSha256}.json`),
    (raw) => {
      const candidate = raw as { oldLeaseSha256?: unknown };
      if (typeof candidate.oldLeaseSha256 !== "string") {
        throw new Error("production_recovery_cleanup_takeover_invalid");
      }
      const prepared = readCanonical(this.#path(
        `production-operation-root.lease-cleanup-only-prepared-${candidate.oldLeaseSha256}.json`),
      validatePreparedCleanupOnlyProductionOperationTakeoverV2,
      "prepared_cleanup_only_production_operation_takeover");
      return validateCleanupOnlyProductionOperationTakeoverV2(raw, prepared.value);
    }, "cleanup_only_production_operation_takeover");
    if (cleanupTakeover.sha256 !== terminal.cleanupOnlyTakeoverSha256
        || cleanupTakeover.value.operationKind !== terminal.operationKind
        || cleanupTakeover.value.operationId !== terminal.operationId
        || cleanupTakeover.value.candidateSha !== terminal.candidateSha
        || cleanupTakeover.value.releaseGenerationId !== terminal.releaseGenerationId
        || cleanupTakeover.value.sourceManifestSha256 !== terminal.sourceManifestSha256
        || cleanupTakeover.value.authorityConsumptionSha256 !== terminal.authorityConsumptionSha256
        || cleanupTakeover.value.newLeaseSha256 !== terminal.finalLeaseSha256
        || cleanupTakeover.value.newLeaseEpoch !== terminal.finalLeaseEpoch) {
      throw new Error("production_recovery_cleanup_takeover_binding_invalid");
    }
    const cleanupPrepared = readCanonical(this.#path(
      `production-operation-root.lease-cleanup-only-prepared-${cleanupTakeover.value.oldLeaseSha256}.json`),
    validatePreparedCleanupOnlyProductionOperationTakeoverV2,
    "prepared_cleanup_only_production_operation_takeover");
    const cleanupTombstone = readCanonical(this.#path(cleanupTakeover.value.tombstoneRelativePath),
      validateProductionOperationLeaseV2, "production_operation_tombstone");
    if (cleanupPrepared.sha256 !== cleanupTakeover.value.preparedTakeoverSha256
        || cleanupPrepared.value.oldLeaseSha256 !== cleanupTakeover.value.oldLeaseSha256
        || cleanupTombstone.sha256 !== cleanupTakeover.value.oldLeaseSha256
        || cleanupTombstone.value.leaseEpoch !== cleanupPrepared.value.oldLeaseEpoch
        || cleanupTombstone.value.operationId !== terminal.operationId
        || cleanupTombstone.value.capability !== "effect_capable") {
      throw new Error("production_recovery_cleanup_tombstone_binding_invalid");
    }
    const normal = this.#verifyNormalTakeoverChainToTip(claim.value, {
      sha256: cleanupTakeover.value.oldLeaseSha256,
      epoch: cleanupPrepared.value.oldLeaseEpoch
    });
    const storedTerminal = readCanonical(this.#path(
      `production-operation-terminal-abandoned-${terminal.operationId}.json`),
    validateProductionOperationTerminalAbandonedV2, "production_operation_terminal_abandoned");
    const terminalBytes = canonicalBytesV2(terminal);
    const terminalSha256 = releaseSha256V2(terminalBytes);
    const preparedRemoval = readCanonical(this.#path(
      `production-operation-lease-removal-prepared-${terminal.operationId}.json`),
    validatePreparedProductionOperationLeaseRemovalV2, "prepared_production_operation_lease_removal");
    const removalReceipt = readCanonical(this.#path(
      `production-operation-lease-removal-${terminal.operationId}.json`),
    validateProductionOperationLeaseRemovalReceiptV2, "production_operation_lease_removal_receipt");
    const cleanup = readCanonical(this.#path(
      `production-operation-terminal-cleanup-${terminal.operationId}.json`),
    validateProductionOperationTerminalCleanupV2, "production_operation_terminal_cleanup");
    if (storedTerminal.sha256 !== terminalSha256 || !storedTerminal.bytes.equals(terminalBytes)
        || preparedRemoval.value.operationId !== terminal.operationId
        || preparedRemoval.value.operationKind !== terminal.operationKind
        || preparedRemoval.value.terminalStateKind !== "terminal_abandoned"
        || preparedRemoval.value.terminalStateSha256 !== terminalSha256
        || preparedRemoval.value.capability !== "cleanup_only"
        || preparedRemoval.value.exactCurrentLeaseSha256 !== terminal.finalLeaseSha256
        || preparedRemoval.value.exactCurrentLeaseEpoch !== terminal.finalLeaseEpoch
        || removalReceipt.sha256 !== preparedRemoval.value.canonicalRemovalReceiptSha256
        || !removalReceipt.bytes.equals(Buffer.from(
          preparedRemoval.value.canonicalRemovalReceiptUtf8Base64, "base64"))
        || removalReceipt.value.operationId !== terminal.operationId
        || removalReceipt.value.operationKind !== terminal.operationKind
        || removalReceipt.value.terminalStateKind !== "terminal_abandoned"
        || removalReceipt.value.terminalStateSha256 !== terminalSha256
        || removalReceipt.value.capability !== "cleanup_only"
        || removalReceipt.value.removedLeaseSha256 !== terminal.finalLeaseSha256
        || removalReceipt.value.removedLeaseEpoch !== terminal.finalLeaseEpoch
        || cleanup.value.operationId !== terminal.operationId
        || cleanup.value.operationKind !== terminal.operationKind
        || cleanup.value.terminalStateSha256 !== terminalSha256
        || cleanup.value.capability !== "cleanup_only"
        || cleanup.value.preparedRemovalSha256 !== preparedRemoval.sha256
        || cleanup.value.leaseRemovalReceiptSha256 !== removalReceipt.sha256
        || cleanup.value.removedLeaseSha256 !== terminal.finalLeaseSha256
        || cleanup.value.cleanedAt !== preparedRemoval.value.preparedAt) {
      throw new Error("production_abandoned_cleanup_bundle_invalid");
    }
    return { claimSha256: claim.sha256,
      authorityConsumptionSha256: claim.value.authorityConsumptionSha256,
      leaseTips: new Set(normal.leaseTips.map((tip) => `${tip.epoch}:${tip.sha256}`)) };
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
    const identity = this.#readFreezeAndManifest();
    const lease = this.#readLease();
    if (lease.value.operationId !== operationId) throw new Error("production_operation_lineage_operation_invalid");
    if (lease.value.candidateSha !== identity.candidateSha
        || lease.value.releaseGenerationId !== identity.releaseGenerationId
        || lease.value.sourceManifestSha256 !== identity.sourceManifestSha256
        || lease.value.artifactRootFingerprintSha256 !== identity.artifactRootFingerprintSha256) {
      throw new Error("production_operation_manifest_lineage_changed");
    }
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

  loadStepIntent(operationId: string, sequence: number, stepId: string, evaluatedAt: string): null | Readonly<{
    relativePath: string;
    sha256: string;
    intent: ProductionOrchestrationStepIntentV2;
  }> {
    if (!Number.isSafeInteger(sequence) || sequence < 1 || !/^[a-z][a-z0-9_]*$/u.test(stepId)) {
      throw new Error("production_step_intent_lookup_invalid");
    }
    const current = this.assertOwnedAndWithinBounds(operationId, evaluatedAt);
    const relativePath = `production-operation-step-intents/${operationId}/${sequence}-${stepId}-1-v2.json`;
    let path: string;
    try { path = this.#path(relativePath); }
    catch (error) {
      if ((error as Error).message === "artifact_parent_missing") return null;
      throw error;
    }
    if (!existsSync(path)) return null;
    const stored = readCanonical(path, validateProductionOrchestrationStepIntentV2,
      "production_step_intent");
    const leaseIsVerifiedAncestor = current.lineageLeaseTips.some((tip) =>
      tip.sha256 === stored.value.currentOperationLeaseSha256
      && tip.epoch === stored.value.currentOperationLeaseEpoch);
    if (stored.value.relativePath !== relativePath || stored.value.operationId !== operationId
        || stored.value.operationClaimSha256 !== current.claimSha256
        || stored.value.authorityConsumptionSha256 !== current.claim.authorityConsumptionSha256
        || stored.value.sequence !== sequence || stored.value.stepId !== stepId
        || stored.value.orchestration !== current.lease.operationKind || !leaseIsVerifiedAncestor) {
      throw new Error("production_step_intent_ancestor_binding_invalid");
    }
    return { relativePath, sha256: stored.sha256, intent: stored.value };
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

  loadCompletedStepPrefix(operationId: string, evaluatedAt: string): readonly Readonly<{
    relativePath: string;
    sha256: string;
    receipt: ProductionOrchestrationStepReceiptV2;
  }>[] {
    const current = this.assertOwnedAndWithinBounds(operationId, evaluatedAt);
    const relativeDirectory = `production-operation-steps/${operationId}`;
    let directory: string;
    try { directory = dirname(this.#path(`${relativeDirectory}/probe.json`)); }
    catch (error) {
      if ((error as Error).message === "artifact_parent_missing") return [];
      throw error;
    }
    const names = readdirSync(directory).filter((name) => name.endsWith(".json"));
    if (names.some((name) => !/^\d+-[a-z][a-z0-9_]*-v2\.json$/u.test(name))) {
      throw new Error("production_step_receipt_prefix_artifact_invalid");
    }
    const records = names.map((name) => {
      const read = readCanonical(this.#path(`${relativeDirectory}/${name}`),
        validateProductionOrchestrationStepReceiptV2, "production_step_receipt");
      if (name !== `${read.value.sequence}-${read.value.stepId}-v2.json`) {
        throw new Error("production_step_receipt_prefix_filename_invalid");
      }
      return { relativePath: `${relativeDirectory}/${name}`, sha256: read.sha256, receipt: read.value };
    }).sort((left, right) => left.receipt.sequence - right.receipt.sequence);
    records.forEach((record, index) => {
      const receipt = record.receipt;
      const receiptLeaseIsVerifiedAncestor = current.lineageLeaseTips.some((tip) =>
        tip.sha256 === receipt.operationLeaseSha256 && tip.epoch === receipt.operationLeaseEpoch);
      if (receipt.sequence !== index + 1 || receipt.operationId !== operationId
          || receipt.operationClaimSha256 !== current.claimSha256
          || receipt.authorityConsumptionSha256 !== current.claim.authorityConsumptionSha256
          || receipt.operationDeadlineAt !== current.lease.operationDeadlineAt
          || receipt.capability !== current.lease.capability
          || receipt.orchestration !== current.lease.operationKind
          || !receiptLeaseIsVerifiedAncestor) {
        throw new Error("production_step_receipt_prefix_binding_invalid");
      }
      if (receipt.executionKind === "external_effect") {
        const intent = readCanonical(this.#path(receipt.stepIntentRelativePath),
          validateProductionOrchestrationStepIntentV2, "production_step_intent");
        const intentLeaseIsVerifiedAncestor = current.lineageLeaseTips.some((tip) =>
          tip.sha256 === intent.value.currentOperationLeaseSha256
          && tip.epoch === intent.value.currentOperationLeaseEpoch);
        if (intent.sha256 !== receipt.stepIntentSha256 || intent.value.operationId !== operationId
            || intent.value.operationClaimSha256 !== current.claimSha256
            || intent.value.authorityConsumptionSha256 !== current.claim.authorityConsumptionSha256
            || intent.value.sequence !== receipt.sequence || intent.value.stepId !== receipt.stepId
            || intent.value.inputSha256 !== receipt.inputSha256 || !intentLeaseIsVerifiedAncestor) {
          throw new Error("production_step_receipt_prefix_intent_invalid");
        }
      }
    });
    return records;
  }

  loadCompletedOrchestrationReceipt(operationId: string, evaluatedAt: string): null | Readonly<{
    relativePath: string;
    sha256: string;
    receipt: ProductionOrchestrationReceiptV2;
  }> {
    const current = this.assertOwnedAndWithinBounds(operationId, evaluatedAt);
    const relativePath = {
      rollout: "production-rollout-orchestration-receipt-v2.json",
      canary: "production-canary-orchestration-receipt-v2.json",
      rollback: "production-rollback-orchestration-receipt-v2.json",
      recovery: "production-recovery-orchestration-receipt-v2.json"
    }[current.lease.operationKind];
    const qualifiedRelativePath = `production-operation-terminal-artifacts/${operationId}/${relativePath}`;
    let qualifiedPath: string | null = null;
    try { qualifiedPath = this.#path(qualifiedRelativePath); }
    catch (error) {
      if ((error as Error).message !== "artifact_parent_missing") throw error;
    }
    const path = qualifiedPath !== null && existsSync(qualifiedPath) ? qualifiedPath : this.#path(relativePath);
    if (!existsSync(path)) return null;
    const stored = readCanonical(path, validateProductionOrchestrationReceiptV2,
      "production_orchestration_receipt");
    const finalLeaseIsVerifiedAncestor = current.lineageLeaseTips.some((tip) =>
      tip.sha256 === stored.value.finalOperationLeaseSha256
      && tip.epoch === stored.value.finalOperationLeaseEpoch);
    const prefix = this.loadCompletedStepPrefix(operationId, evaluatedAt);
    if (stored.value.operationId !== operationId || stored.value.orchestration !== current.lease.operationKind
        || stored.value.capability !== current.lease.capability
        || stored.value.operationClaimSha256 !== current.claimSha256
        || stored.value.operationalAttestationConsumptionSha256
          !== current.claim.authorityConsumptionSha256
        || stored.value.operationDeadlineAt !== current.lease.operationDeadlineAt
        || !finalLeaseIsVerifiedAncestor
        || stored.value.completedStepReceipts.length !== prefix.length
        || stored.value.completedStepReceipts.some((entry, index) =>
          entry.relativePath !== prefix[index]?.relativePath || entry.sha256 !== prefix[index]?.sha256)) {
      throw new Error("production_completed_orchestration_binding_invalid");
    }
    return { relativePath: qualifiedPath !== null && existsSync(qualifiedPath) ? qualifiedRelativePath : relativePath,
      sha256: stored.sha256, receipt: stored.value };
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
      const intentLeaseIsVerifiedAncestor = current.lineageLeaseTips.some((tip) =>
        tip.sha256 === intent.value.currentOperationLeaseSha256
        && tip.epoch === intent.value.currentOperationLeaseEpoch);
      if (intent.sha256 !== receipt.stepIntentSha256
          || intent.value.operationId !== receipt.operationId
          || intent.value.sequence !== receipt.sequence
          || intent.value.stepId !== receipt.stepId
          || intent.value.inputSha256 !== receipt.inputSha256
          || !intentLeaseIsVerifiedAncestor) {
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

  #verifySettlementTerminalBundle(
    settlement: Readonly<{ value: ProductionOperationSettlementV2; sha256: string }>,
    claim: Readonly<{ value: ProductionOperationClaimV2; bytes: Buffer; sha256: string }>,
    takeover: Readonly<{ sha256: string; leaseTips: readonly Readonly<{ sha256: string; epoch: number }>[] }>,
    verifySettledRollbackHistoricalProofs?: SettledRollbackHistoricalProofVerifierV2
  ): Readonly<{
    orchestration: Readonly<{ value: ProductionOrchestrationReceiptV2; bytes: Buffer; sha256: string }> | null;
    completedStepReceipts: readonly Readonly<{
      relativePath: string; sha256: string; receipt: ProductionOrchestrationStepReceiptV2;
    }>[];
  }> {
    const state = settlement.value;
    if (state.operationId !== claim.value.operationId || state.operationKind !== claim.value.operationKind
        || state.candidateSha !== claim.value.candidateSha
        || state.releaseGenerationId !== claim.value.releaseGenerationId
        || state.sourceManifestSha256 !== claim.value.sourceManifestSha256
        || state.claimSha256 !== claim.sha256
        || state.authorityConsumptionSha256 !== claim.value.authorityConsumptionSha256
        || state.operationDeadlineAt !== claim.value.operationDeadlineAt
        || state.capability !== claim.value.capability
        || !takeover.leaseTips.some((tip) => tip.sha256 === state.finalLeaseSha256
          && tip.epoch === state.finalLeaseEpoch)
        || Date.parse(state.authorityRevalidatedAt) >= Date.parse(claim.value.authorityConsumption.expiresAt)
        || Date.parse(state.deadlineRevalidatedAt) >= Date.parse(state.operationDeadlineAt)) {
      throw new Error("production_terminal_bundle_settlement_binding_invalid");
    }
    const index = readCanonical(this.#path(`production-terminal-artifact-index-${state.operationId}.json`),
      validateTerminalArtifactIndex, "production_terminal_artifact_index");
    if (index.value.operationId !== state.operationId || index.value.operationKind !== state.operationKind
        || index.value.operationClaimSha256 !== claim.sha256
        || index.value.authorityConsumptionSha256 !== claim.value.authorityConsumptionSha256
        || index.value.terminalEvidenceSha256 !== state.terminalEvidenceSha256
        || index.value.orchestrationReceiptSha256 !== state.orchestrationReceiptSha256) {
      throw new Error("production_terminal_bundle_index_binding_invalid");
    }
    const artifact = <T>(kind: string, validator: Validator<T>, label: string) => {
      const matches = index.value.artifacts.filter((entry) => entry.kind === kind);
      if (matches.length !== 1) throw new Error("production_terminal_bundle_artifact_missing");
      const entry = matches[0]!;
      const stored = readCanonical(this.#path(entry.operationQualifiedRelativePath), validator, label);
      if (stored.sha256 !== entry.sha256) throw new Error("production_terminal_bundle_artifact_hash_invalid");
      return stored;
    };
    const relativeDirectory = `production-operation-steps/${state.operationId}`;
    let receiptEntries: Dirent<string>[] = [];
    try {
      receiptEntries = readdirSync(dirname(this.#path(`${relativeDirectory}/probe.json`)), { withFileTypes: true });
    } catch (error) {
      if ((error as Error).message !== "artifact_parent_missing") throw error;
    }
    if (receiptEntries.some((entry) => !entry.isFile() || !/^\d+-[a-z][a-z0-9_]*-v2\.json$/u.test(entry.name))) {
      throw new Error("production_terminal_bundle_step_artifact_invalid");
    }
    const receipts = receiptEntries.map((entry) => {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      const stored = readCanonical(this.#path(relativePath), validateProductionOrchestrationStepReceiptV2,
        "production_terminal_bundle_step_receipt");
      return { relativePath, sha256: stored.sha256, bytes: stored.bytes, receipt: stored.value,
        filename: entry.name };
    }).sort((left, right) => left.receipt.sequence - right.receipt.sequence);
    const commandId = claim.value.authorityConsumption.commandId;
    receipts.forEach((entry, indexValue) => {
      const receipt = entry.receipt;
      const expectedInputSha256 = releaseSha256V2(canonicalBytesV2({ version: "production-leaf-input-v2",
        operationId: state.operationId, operationKind: state.operationKind,
        sequence: indexValue + 1, stepId: receipt.stepId }));
      if (entry.filename !== `${receipt.sequence}-${receipt.stepId}-v2.json`
          || receipt.sequence !== indexValue + 1 || receipt.operationId !== state.operationId
          || receipt.operationClaimSha256 !== claim.sha256
          || receipt.authorityConsumptionSha256 !== claim.value.authorityConsumptionSha256
          || receipt.operationDeadlineAt !== state.operationDeadlineAt
          || receipt.capability !== state.capability || receipt.orchestration !== state.operationKind
          || receipt.commandId !== commandId
          || receipt.redactedTemplateSha256 !== claim.value.authorityConsumption.redactedTemplateSha256
          || receipt.inputSha256 !== expectedInputSha256
          || !takeover.leaseTips.some((tip) => tip.sha256 === receipt.operationLeaseSha256
            && tip.epoch === receipt.operationLeaseEpoch)) {
        throw new Error("production_terminal_bundle_step_binding_invalid");
      }
    });
    const intentDirectory = `production-operation-step-intents/${state.operationId}`;
    let intentEntries: Dirent<string>[] = [];
    try {
      intentEntries = readdirSync(dirname(this.#path(`${intentDirectory}/probe.json`)), { withFileTypes: true });
    } catch (error) {
      if ((error as Error).message !== "artifact_parent_missing") throw error;
    }
    if (intentEntries.some((entry) => !entry.isFile() || !/^\d+-[a-z][a-z0-9_]*-1-v2\.json$/u.test(entry.name))) {
      throw new Error("production_terminal_bundle_intent_artifact_invalid");
    }
    const intents = intentEntries.map((entry) => {
      const relativePath = `${intentDirectory}/${entry.name}`;
      const stored = readCanonical(this.#path(relativePath), validateProductionOrchestrationStepIntentV2,
        "production_terminal_bundle_step_intent");
      const matchingReceipt = receipts.find((receipt) => receipt.receipt.sequence === stored.value.sequence
        && receipt.receipt.stepId === stored.value.stepId);
      if (entry.name !== `${stored.value.sequence}-${stored.value.stepId}-1-v2.json`
          || stored.value.relativePath !== relativePath || stored.value.operationId !== state.operationId
          || stored.value.operationClaimSha256 !== claim.sha256
          || stored.value.authorityConsumptionSha256 !== claim.value.authorityConsumptionSha256
          || stored.value.orchestration !== state.operationKind || stored.value.commandId !== commandId
          || stored.value.redactedTemplateSha256 !== claim.value.authorityConsumption.redactedTemplateSha256
          || !takeover.leaseTips.some((tip) => tip.sha256 === stored.value.currentOperationLeaseSha256
            && tip.epoch === stored.value.currentOperationLeaseEpoch)
          || (matchingReceipt !== undefined && (matchingReceipt.receipt.executionKind !== "external_effect"
            || matchingReceipt.receipt.stepIntentRelativePath !== relativePath
            || matchingReceipt.receipt.stepIntentSha256 !== stored.sha256
            || matchingReceipt.receipt.inputSha256 !== stored.value.inputSha256))) {
        throw new Error("production_terminal_bundle_intent_binding_invalid");
      }
      return { relativePath, sha256: stored.sha256, intent: stored.value, matchingReceipt };
    });
    if (receipts.some((entry) => entry.receipt.executionKind === "external_effect"
        && !intents.some((intent) => intent.sha256 === entry.receipt.stepIntentSha256))) {
      throw new Error("production_terminal_bundle_receipt_intent_missing");
    }
    const completedStepReceipts = receipts.map(({ relativePath, sha256, receipt }) =>
      ({ relativePath, sha256, receipt }));
    const captures = receipts.map(({ receipt }) => ({ stepId: receipt.stepId, sequence: receipt.sequence,
      executionKind: receipt.executionKind, outputSha256: receipt.outputSha256,
      observedStateSha256: receipt.observedStateSha256,
      ...(receipt.verifiedChecks === null ? {} : { verifiedChecks: [...receipt.verifiedChecks] }) }));
    const captureKind = `${state.operationKind}_captures`;
    const captureArtifact = state.orchestrationReceiptSha256 === null ? null
      : artifact(captureKind, (value) => value, "production_terminal_bundle_query_captures");
    const expectedCaptureBundle = { version: "production-orchestration-captures-v2",
      operationId: state.operationId, captures };
    if (captureArtifact !== null && !captureArtifact.bytes.equals(canonicalBytesV2(expectedCaptureBundle))) {
      throw new Error("production_terminal_bundle_capture_binding_invalid");
    }
    const freeze = readCanonical(this.#path("release-freeze-identity-v2.json"), validateReleaseFreezeIdentityV2,
      "production_terminal_bundle_freeze");
    const task0b = readCanonical(this.#path("task0b-release-freeze.json"),
      validateTask0BReleaseFreezeEvidence, "production_terminal_bundle_task0b");
    if (canonicalReleaseJsonV2(deriveReleaseFreezeIdentityV2(task0b.value))
        !== canonicalReleaseJsonV2(freeze.value)) {
      throw new Error("production_terminal_bundle_task0b_freeze_binding_invalid");
    }
    const action = OPERATION_ACTION[state.operationKind];
    const attestation = readCanonical(safeArtifactRelativePath(this.#root,
      `operational-attestations/${action}/${state.releaseGenerationId}/${claim.value.operationalAttestationSha256}.json`),
    validateOperationalAttestationV2, "production_terminal_bundle_attestation");
    const issuerReceipt = readCanonical(safeArtifactRelativePath(this.#root,
      `operational-attestation-issuer-receipts/${action}/${state.releaseGenerationId}/${claim.value.operationalAttestationIssuerReceiptSha256}.json`),
    validateOperationalAttestationIssuerReceiptV2, "production_terminal_bundle_issuer_receipt");
    if (freeze.value.releaseGenerationId !== state.releaseGenerationId
        || freeze.value.candidateSha !== state.candidateSha
        || freeze.value.artifactRootFingerprintSha256 !== claim.value.artifactRootFingerprintSha256
        || attestation.sha256 !== claim.value.operationalAttestationSha256
        || attestation.value.action !== action
        || attestation.value.generationId !== state.releaseGenerationId
        || attestation.value.candidateSha !== state.candidateSha
        || attestation.value.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze.value)
        || attestation.value.sourceManifestSha256 !== state.sourceManifestSha256
        || attestation.value.artifactRootFingerprintSha256 !== claim.value.artifactRootFingerprintSha256
        || attestation.value.commandId !== claim.value.authorityConsumption.commandId
        || attestation.value.redactedTemplateSha256 !== claim.value.authorityConsumption.redactedTemplateSha256
        || issuerReceipt.sha256 !== claim.value.operationalAttestationIssuerReceiptSha256
        || issuerReceipt.value.attestationSha256 !== attestation.sha256
        || issuerReceipt.value.action !== action
        || issuerReceipt.value.generationId !== state.releaseGenerationId) {
      throw new Error("production_terminal_bundle_authority_binding_invalid");
    }
    assertCommittedOperationalAuthorityRecordV2(this.#root, freeze.value, {
      attestationSha256: attestation.sha256, issuerReceiptSha256: issuerReceipt.sha256
    });
    let orchestration: Readonly<{
      value: ProductionOrchestrationReceiptV2; bytes: Buffer; sha256: string;
    }> | null = null;
    if (state.orchestrationReceiptSha256 !== null) {
      orchestration = artifact(`${state.operationKind}_orchestration`, validateProductionOrchestrationReceiptV2,
        "production_terminal_bundle_orchestration");
      const value = orchestration.value;
      if (orchestration.sha256 !== state.orchestrationReceiptSha256
          || value.operationId !== state.operationId || value.orchestration !== state.operationKind
          || value.operationClaimSha256 !== claim.sha256
          || value.operationalAttestationConsumptionSha256 !== claim.value.authorityConsumptionSha256
          || value.candidateSha !== state.candidateSha || value.releaseGenerationId !== state.releaseGenerationId
          || value.sourceManifestSha256 !== state.sourceManifestSha256
          || value.finalOperationLeaseSha256 !== state.finalLeaseSha256
          || value.finalOperationLeaseEpoch !== state.finalLeaseEpoch
          || value.operationDeadlineAt !== state.operationDeadlineAt || value.capability !== state.capability
          || value.operationLeaseTakeoverChainSha256 !== takeover.sha256
          || value.redactedTemplateSha256 !== claim.value.authorityConsumption.redactedTemplateSha256
          || value.completedStepReceipts.length !== receipts.length
          || value.completedStepReceipts.some((ref, indexValue) =>
            ref.relativePath !== receipts[indexValue]?.relativePath || ref.sha256 !== receipts[indexValue]?.sha256
            || !canonicalBytesV2(ref.receipt).equals(receipts[indexValue]!.bytes))) {
        throw new Error("production_terminal_bundle_orchestration_binding_invalid");
      }
      if (intents.some((intent) => intent.matchingReceipt === undefined)) {
        throw new Error("production_terminal_bundle_unresolved_intent_invalid");
      }
    } else if (state.result !== "failed" || !["rollout", "canary"].includes(state.operationKind)) {
      throw new Error("production_terminal_bundle_orchestration_missing");
    }
    const terminalChecks = Object.fromEntries((receipts.at(-1)?.receipt.verifiedChecks ?? [])
      .map((check) => [check, true]));
    if (state.result === "failed" && orchestration === null) {
      const steps = COMPLETE_OPERATION_STEPS[state.operationKind];
      if (receipts.some((entry, indexValue) => entry.receipt.stepId !== steps[indexValue])
          || receipts.length >= steps.length) {
        throw new Error("production_terminal_bundle_failure_prefix_invalid");
      }
      const expectedFailedStep = steps[receipts.length]!;
      if (intents.some((intent) => intent.matchingReceipt === undefined
          && (intent.intent.sequence !== receipts.length + 1 || intent.intent.stepId !== expectedFailedStep))
          || intents.filter((intent) => intent.matchingReceipt === undefined).length > 1) {
        throw new Error("production_terminal_bundle_unresolved_intent_invalid");
      }
      const draft = readCanonical(this.#path(`production-operation-failure-draft-${state.operationId}.json`),
        validateProductionFailureDraft, "production_terminal_bundle_failure_draft");
      const prefixSha256 = releaseSha256V2(canonicalBytesV2(completedStepReceipts));
      const progressSha256 = releaseSha256V2(canonicalBytesV2({ completedStepReceipts, captures }));
      const attemptedExternalEffect = state.operationKind === "canary"
        || receipts.some((entry) => entry.receipt.executionKind === "external_effect")
        || intents.some((intent) => intent.matchingReceipt === undefined);
      if (draft.value.operationKind !== state.operationKind || draft.value.operationId !== state.operationId
          || draft.value.operationClaimSha256 !== claim.sha256 || draft.value.stepId !== expectedFailedStep
          || draft.value.attemptedExternalEffect !== attemptedExternalEffect
          || draft.value.completedStepReceiptPrefixSha256 !== prefixSha256
          || draft.value.orchestrationProgressSha256 !== progressSha256
          || ("attemptedExternalEffect" in state && state.attemptedExternalEffect !== attemptedExternalEffect)) {
        throw new Error("production_terminal_bundle_failure_draft_binding_invalid");
      }
      const failureCapture = artifact("failure_capture", (value) => value,
        "production_terminal_bundle_failure_capture");
      const expectedFailureCapture = { version: "production-operation-failure-capture-v2",
        operationKind: state.operationKind, operationId: state.operationId, operationClaimSha256: claim.sha256,
        stepId: expectedFailedStep, failureCode: draft.value.failureCode, attemptedExternalEffect,
        completedStepReceiptPrefixSha256: prefixSha256, orchestrationProgressSha256: progressSha256,
        observedAt: draft.value.observedAt };
      if (!failureCapture.bytes.equals(canonicalBytesV2(expectedFailureCapture))) {
        throw new Error("production_terminal_bundle_failure_capture_binding_invalid");
      }
      const evidence = artifact("failure_evidence", validateProductionFailureEvidenceV2,
        "production_terminal_bundle_failure_evidence");
      if (evidence.sha256 !== state.terminalEvidenceSha256
          || evidence.value.candidateSha !== state.candidateSha
          || evidence.value.releaseFreezeIdentitySha256 !== freeze.sha256
          || evidence.value.sourceManifestSha256 !== state.sourceManifestSha256
          || evidence.value.failedExecutionEvidenceSha256 !== failureCapture.sha256
          || evidence.value.observedAt !== draft.value.observedAt
          || evidence.value.failureCode !== draft.value.failureCode
          || !("attemptedExternalEffect" in evidence.value)
          || evidence.value.attemptedExternalEffect !== attemptedExternalEffect
          || ("orchestrationProgressSha256" in evidence.value
            && evidence.value.orchestrationProgressSha256 !== progressSha256)
          || ("preEffectValidationReceiptsSha256" in evidence.value
            && evidence.value.preEffectValidationReceiptsSha256 !== prefixSha256)) {
        throw new Error("production_terminal_bundle_failure_evidence_binding_invalid");
      }
      return { orchestration: null, completedStepReceipts };
    }
    if (orchestration === null) throw new Error("production_terminal_bundle_orchestration_missing");
    if (state.operationKind === "rollout") {
      const manager = artifact("rollout_manager", (value) => value, "production_terminal_bundle_manager");
      const expectedManager = { version: "production-manager-captures-v2", operationId: state.operationId,
        captures: captures.filter((capture) => capture.executionKind === "external_effect") };
      if (!manager.bytes.equals(canonicalBytesV2(expectedManager))) {
        throw new Error("production_terminal_bundle_manager_binding_invalid");
      }
      const evidence = artifact("rollout_evidence", validateProductionRolloutEvidenceV2,
        "production_terminal_bundle_rollout_evidence");
      if (evidence.sha256 !== state.terminalEvidenceSha256 || evidence.value.candidateSha !== state.candidateSha
          || evidence.value.releaseFreezeIdentitySha256 !== freeze.sha256
          || evidence.value.operationalAttestationConsumptionSha256 !== claim.value.authorityConsumptionSha256
          || evidence.value.sourceManifestSha256 !== state.sourceManifestSha256
          || evidence.value.previousStopEvidenceSha256
            !== captures.find((capture) => capture.stepId === "stop_previous")?.outputSha256
          || evidence.value.candidateStartEvidenceSha256
            !== captures.find((capture) => capture.stepId === "start_candidate")?.outputSha256
          || evidence.value.managerCapturesSha256 !== manager.sha256
          || evidence.value.queryCapturesSha256 !== captureArtifact!.sha256
          || evidence.value.orchestrationReceiptSha256 !== orchestration.sha256
          || !canonicalBytesV2(evidence.value.checks).equals(canonicalBytesV2(terminalChecks))) {
        throw new Error("production_terminal_bundle_rollout_evidence_binding_invalid");
      }
    } else if (state.operationKind === "canary") {
      const logs = artifact("canary_logs", (value) => value, "production_terminal_bundle_canary_logs");
      const expectedLogs = { version: "production-canary-log-captures-v2", operationId: state.operationId,
        captureSha256s: captures.map((capture) => capture.outputSha256) };
      if (!logs.bytes.equals(canonicalBytesV2(expectedLogs))) {
        throw new Error("production_terminal_bundle_canary_logs_binding_invalid");
      }
      const evidence = artifact("canary_evidence", validateProductionCanaryEvidenceV2,
        "production_terminal_bundle_canary_evidence");
      if (evidence.sha256 !== state.terminalEvidenceSha256 || evidence.value.candidateSha !== state.candidateSha
          || evidence.value.releaseFreezeIdentitySha256 !== freeze.sha256
          || evidence.value.operationalAttestationConsumptionSha256 !== claim.value.authorityConsumptionSha256
          || evidence.value.sourceManifestSha256 !== state.sourceManifestSha256
          || evidence.value.observationStartedAt !== receipts[0]?.receipt.startedAt
          || evidence.value.observationFinishedAt !== receipts.at(-1)?.receipt.finishedAt
          || evidence.value.completedPollingCycles !== 2
          || evidence.value.queryCapturesSha256 !== captureArtifact!.sha256
          || evidence.value.logCapturesSha256 !== logs.sha256
          || evidence.value.orchestrationReceiptSha256 !== orchestration.sha256
          || !canonicalBytesV2(evidence.value.checks).equals(canonicalBytesV2(terminalChecks))) {
        throw new Error("production_terminal_bundle_canary_evidence_binding_invalid");
      }
    } else if (state.operationKind === "rollback") {
      const manager = artifact("rollback_manager", (value) => value, "production_terminal_bundle_manager");
      const expectedManager = { version: "production-manager-captures-v2", operationId: state.operationId,
        captures: captures.filter((capture) => capture.executionKind === "external_effect") };
      if (!manager.bytes.equals(canonicalBytesV2(expectedManager))) {
        throw new Error("production_terminal_bundle_manager_binding_invalid");
      }
      const evidence = artifact("rollback_evidence", validateProductionRollbackEvidenceV2,
        "production_terminal_bundle_rollback_evidence");
      const priorFailure = readCanonical(this.#path("production-failure-evidence-v2.json"),
        validateProductionFailureEvidenceV2, "production_terminal_bundle_prior_failure");
      const output = (stepId: string) => captures.find((capture) => capture.stepId === stepId)?.outputSha256;
      const outcome = evidence.value.outcome;
      if (verifySettledRollbackHistoricalProofs === undefined) {
        throw new Error("production_terminal_bundle_rollback_historical_proof_verifier_missing");
      }
      verifySettledRollbackHistoricalProofs({ operationId: state.operationId,
        operationClaimSha256: claim.sha256,
        authorityConsumptionSha256: claim.value.authorityConsumptionSha256,
        authorityExpiresAt: claim.value.authorityConsumption.expiresAt,
        candidateSha: state.candidateSha, releaseGenerationId: state.releaseGenerationId,
        sourceManifestSha256: state.sourceManifestSha256,
        operationDeadlineAt: state.operationDeadlineAt, lineageLeaseTips: takeover.leaseTips,
        failureEvidenceSha256: priorFailure.sha256,
        previousRuntimeIdentitySha256: evidence.value.previousRuntimeIdentitySha256, outcome });
      const actionBindingInvalid = (outcome.kind === "previous_runtime_retained"
          && (outcome.previousRuntimeHealthEvidenceSha256 !== output("prove_previous_healthy")
            || outcome.noPreviousStopEvidenceSha256 !== output("prove_no_previous_stop")
            || outcome.noCandidateStartEvidenceSha256 !== output("prove_no_candidate_start")))
        || (outcome.kind === "previous_runtime_restarted_without_candidate"
          && ((output("restart_previous") !== undefined
              && outcome.previousStartEvidenceSha256 !== output("restart_previous"))
            || outcome.noCandidateStartEvidenceSha256
              !== (output("prove_no_candidate_start") ?? output("prove_no_candidate_running"))))
        || (outcome.kind === "candidate_replaced_with_previous"
          && ((output("stop_candidate") !== undefined
              && outcome.candidateStopEvidenceSha256 !== output("stop_candidate"))
            || (output("start_previous") !== undefined
              && outcome.previousStartEvidenceSha256 !== output("start_previous"))));
      if (evidence.sha256 !== state.terminalEvidenceSha256 || evidence.value.candidateSha !== state.candidateSha
          || evidence.value.releaseFreezeIdentitySha256 !== freeze.sha256
          || evidence.value.artifactRootFingerprintSha256 !== claim.value.artifactRootFingerprintSha256
          || evidence.value.sourceManifestSha256 !== state.sourceManifestSha256
          || evidence.value.failureEvidenceSha256 !== priorFailure.sha256
          || evidence.value.operationalAttestationSha256 !== claim.value.operationalAttestationSha256
          || evidence.value.operationalAttestationConsumptionSha256 !== claim.value.authorityConsumptionSha256
          || evidence.value.redactedTemplateSha256 !== claim.value.authorityConsumption.redactedTemplateSha256
          || evidence.value.queryCapturesSha256 !== captureArtifact!.sha256
          || evidence.value.orchestrationReceiptSha256 !== orchestration.sha256
          || !canonicalBytesV2(evidence.value.checks).equals(canonicalBytesV2(terminalChecks))
          || actionBindingInvalid) {
        throw new Error("production_terminal_bundle_rollback_evidence_binding_invalid");
      }
    } else {
      const evidence = artifact("recovery_failure_evidence", validateProductionFailureEvidenceV2,
        "production_terminal_bundle_recovery_evidence");
      if (evidence.value.evidenceKind !== "abandoned_operation_recovery"
          || evidence.sha256 !== state.terminalEvidenceSha256
          || evidence.value.candidateSha !== state.candidateSha
          || evidence.value.releaseFreezeIdentitySha256 !== freeze.sha256
          || evidence.value.sourceManifestSha256 !== state.sourceManifestSha256
          || evidence.value.failedExecutionEvidenceSha256 !== orchestration.sha256
          || evidence.value.recoveryOrchestrationReceiptSha256 !== orchestration.sha256
          || evidence.value.recoveryOperationalAttestationSha256 !== claim.value.operationalAttestationSha256
          || evidence.value.recoveryProductionLeaseSha256
            !== claim.value.authorityConsumption.leaseSha256AtConsumption
          || evidence.value.recoveryOperationClaimSha256 !== claim.sha256
          || evidence.value.recoveryAuthorityConsumptionSha256 !== claim.value.authorityConsumptionSha256
          || evidence.value.recoveryAttemptedExternalEffect !== false
          || !("recoveryAttemptedExternalEffect" in state) || state.recoveryAttemptedExternalEffect !== false
          || evidence.value.priorAttemptedExternalEffect !== state.priorAttemptedExternalEffect) {
        throw new Error("production_terminal_bundle_recovery_evidence_binding_invalid");
      }
      assertRecoveryFailureArtifactBindingsV2({
        root: this.#root,
        freeze: freeze.value,
        sourceManifestSha256: state.sourceManifestSha256,
        evidence: evidence.value,
        consumption: claim.value.authorityConsumption,
        consumptionBytes: canonicalBytesV2(claim.value.authorityConsumption),
        claim: claim.value,
        claimBytes: claim.bytes,
        recoveryOrchestrationReceiptBytes: orchestration.bytes
      });
    }
    return { orchestration, completedStepReceipts };
  }

  verifyFailedSettledRolloutForRecovery(
    operationIdInput: string,
    operationClaimSha256Input: string
  ): Readonly<{
    operationId: string;
    operationClaimSha256: string;
    authorityConsumptionSha256: string;
    releaseGenerationId: string;
    sourceManifestSha256: string;
    releaseFreezeIdentitySha256: string;
    lineageLeaseTips: readonly Readonly<{ sha256: string; epoch: number }>[];
    completedStepReceipts: readonly Readonly<{
      relativePath: string; sha256: string; receipt: ProductionOrchestrationStepReceiptV2;
    }>[];
  }> {
    const operationId = exactOperationId(operationIdInput);
    const expectedClaimSha256 = exactSha(operationClaimSha256Input,
      "production_failed_rollout_claim_sha256");
    const settlement = readCanonical(this.#path(`production-operation-settlement-${operationId}.json`),
      validateProductionOperationSettlementV2, "production_failed_rollout_settlement");
    if (settlement.value.operationKind !== "rollout" || settlement.value.result !== "failed"
        || settlement.value.operationId !== operationId
        || settlement.value.claimSha256 !== expectedClaimSha256
        || settlement.value.orchestrationReceiptSha256 !== null) {
      throw new Error("production_failed_rollout_settlement_binding_invalid");
    }
    const claimEntries = readdirSync(this.#root, { withFileTypes: true }).filter((entry) =>
      entry.name.startsWith("production-operation-claim-") && entry.name.endsWith(".json"));
    if (claimEntries.some((entry) => !entry.isFile()
        || !/^production-operation-claim-[0-9a-f]{64}\.json$/u.test(entry.name))) {
      throw new Error("production_failed_rollout_claim_artifact_invalid");
    }
    const claims = claimEntries.map((entry) => {
      const record = readCanonical(this.#path(entry.name), validateProductionOperationClaimV2,
        "production_failed_rollout_claim");
      if (entry.name !== `production-operation-claim-${record.value.operationalAttestationSha256}.json`) {
        throw new Error("production_failed_rollout_claim_filename_invalid");
      }
      return record;
    }).filter((record) => record.sha256 === expectedClaimSha256);
    if (claims.length !== 1) throw new Error("production_failed_rollout_claim_missing_or_ambiguous");
    const claim = claims[0]!;
    if (claim.value.operationKind !== "rollout" || claim.value.operationId !== operationId
        || claim.value.authorityConsumptionSha256 !== settlement.value.authorityConsumptionSha256
        || claim.value.candidateSha !== settlement.value.candidateSha
        || claim.value.releaseGenerationId !== settlement.value.releaseGenerationId
        || claim.value.sourceManifestSha256 !== settlement.value.sourceManifestSha256) {
      throw new Error("production_failed_rollout_claim_binding_invalid");
    }
    const preclaim = readCanonical(this.#path(`production-authority-preclaim-${operationId}.json`),
      validateProductionAuthorityPreclaimValidationV2, "production_failed_rollout_preclaim");
    const lineage = readCanonical(this.#path(claim.value.preclaimLeaseLineageRelativePath),
      validateProductionPreclaimLeaseLineageV2, "production_failed_rollout_preclaim_lineage");
    if (preclaim.sha256 !== claim.value.authorityConsumption.preclaimValidationSha256
        || preclaim.value.operationKind !== "rollout" || preclaim.value.operationId !== operationId
        || lineage.sha256 !== claim.value.preclaimLeaseLineageSha256
        || lineage.value.operationId !== operationId
        || lineage.value.preclaimValidationSha256 !== preclaim.sha256
        || lineage.value.currentTipLeaseSha256 !== claim.value.preclaimLeaseLineageCurrentTipSha256
        || lineage.value.currentTipLeaseEpoch !== claim.value.leaseEpochAtConsumption) {
      throw new Error("production_failed_rollout_preclaim_lineage_binding_invalid");
    }
    this.#verifyStoredPreclaimLineage(preclaim, lineage);
    const takeover = this.#verifyNormalTakeoverChainToTip(claim.value, {
      sha256: settlement.value.finalLeaseSha256, epoch: settlement.value.finalLeaseEpoch
    });
    const freeze = readCanonical(this.#path("release-freeze-identity-v2.json"),
      validateReleaseFreezeIdentityV2, "production_failed_rollout_freeze");
    const attestation = readCanonical(safeArtifactRelativePath(this.#root,
      `operational-attestations/g14_rollout_passed/${claim.value.releaseGenerationId}/${claim.value.operationalAttestationSha256}.json`),
    validateOperationalAttestationV2, "production_failed_rollout_attestation");
    const issuerReceipt = readCanonical(safeArtifactRelativePath(this.#root,
      `operational-attestation-issuer-receipts/g14_rollout_passed/${claim.value.releaseGenerationId}/${claim.value.operationalAttestationIssuerReceiptSha256}.json`),
    validateOperationalAttestationIssuerReceiptV2, "production_failed_rollout_issuer_receipt");
    if (freeze.value.releaseGenerationId !== claim.value.releaseGenerationId
        || freeze.value.candidateSha !== claim.value.candidateSha
        || freeze.value.artifactRootFingerprintSha256 !== claim.value.artifactRootFingerprintSha256
        || attestation.sha256 !== claim.value.operationalAttestationSha256
        || attestation.value.action !== "g14_rollout_passed"
        || attestation.value.releaseFreezeIdentitySha256 !== freeze.sha256
        || attestation.value.sourceManifestSha256 !== claim.value.sourceManifestSha256
        || attestation.value.commandId !== claim.value.authorityConsumption.commandId
        || attestation.value.redactedTemplateSha256 !== claim.value.authorityConsumption.redactedTemplateSha256
        || issuerReceipt.sha256 !== claim.value.operationalAttestationIssuerReceiptSha256
        || issuerReceipt.value.attestationSha256 !== attestation.sha256) {
      throw new Error("production_failed_rollout_authority_binding_invalid");
    }
    assertCommittedOperationalAuthorityRecordV2(this.#root, freeze.value, {
      attestationSha256: attestation.sha256, issuerReceiptSha256: issuerReceipt.sha256
    });
    const verified = this.#verifySettlementTerminalBundle(settlement, claim, takeover);
    if (verified.orchestration !== null) {
      throw new Error("production_failed_rollout_orchestration_unexpected");
    }
    const preparedRemoval = readCanonical(this.#path(
      `production-operation-lease-removal-prepared-${operationId}.json`),
    validatePreparedProductionOperationLeaseRemovalV2, "production_failed_rollout_prepared_removal");
    const removalReceipt = readCanonical(this.#path(`production-operation-lease-removal-${operationId}.json`),
      validateProductionOperationLeaseRemovalReceiptV2, "production_failed_rollout_removal_receipt");
    const cleanup = readCanonical(this.#path(`production-operation-terminal-cleanup-${operationId}.json`),
      validateProductionOperationTerminalCleanupV2, "production_failed_rollout_terminal_cleanup");
    if (preparedRemoval.value.operationKind !== "rollout" || preparedRemoval.value.operationId !== operationId
        || preparedRemoval.value.terminalStateKind !== "settlement"
        || preparedRemoval.value.terminalStateSha256 !== settlement.sha256
        || preparedRemoval.value.capability !== settlement.value.capability
        || preparedRemoval.value.exactCurrentLeaseSha256 !== settlement.value.finalLeaseSha256
        || preparedRemoval.value.exactCurrentLeaseEpoch !== settlement.value.finalLeaseEpoch
        || removalReceipt.sha256 !== preparedRemoval.value.canonicalRemovalReceiptSha256
        || !removalReceipt.bytes.equals(Buffer.from(
          preparedRemoval.value.canonicalRemovalReceiptUtf8Base64, "base64"))
        || removalReceipt.value.operationKind !== "rollout" || removalReceipt.value.operationId !== operationId
        || removalReceipt.value.terminalStateKind !== "settlement"
        || removalReceipt.value.terminalStateSha256 !== settlement.sha256
        || removalReceipt.value.capability !== settlement.value.capability
        || removalReceipt.value.removedLeaseSha256 !== settlement.value.finalLeaseSha256
        || removalReceipt.value.removedLeaseEpoch !== settlement.value.finalLeaseEpoch
        || cleanup.value.operationKind !== "rollout" || cleanup.value.operationId !== operationId
        || cleanup.value.terminalStateSha256 !== settlement.sha256
        || cleanup.value.capability !== settlement.value.capability
        || cleanup.value.preparedRemovalSha256 !== preparedRemoval.sha256
        || cleanup.value.leaseRemovalReceiptSha256 !== removalReceipt.sha256
        || cleanup.value.removedLeaseSha256 !== settlement.value.finalLeaseSha256
        || cleanup.value.cleanedAt !== preparedRemoval.value.preparedAt) {
      throw new Error("production_failed_rollout_cleanup_binding_invalid");
    }
    return { operationId, operationClaimSha256: claim.sha256,
      authorityConsumptionSha256: claim.value.authorityConsumptionSha256,
      releaseGenerationId: claim.value.releaseGenerationId,
      sourceManifestSha256: claim.value.sourceManifestSha256,
      releaseFreezeIdentitySha256: freeze.sha256,
      lineageLeaseTips: takeover.leaseTips,
      completedStepReceipts: verified.completedStepReceipts };
  }

  resumeCompletedSettlementBeforeBegin(
    operationKind: ProductionOperationKindV2,
    evaluatedAt: string,
    verifySettledRollbackHistoricalProofs?: SettledRollbackHistoricalProofVerifierV2
  ): null | Readonly<{
    result: "passed" | "failed";
    operationId: string;
    finalLeaseEpoch: number;
    orchestrationReceipt: ProductionOrchestrationReceiptV2 | null;
    orchestrationReceiptSha256: string | null;
  }> {
    parseIso(evaluatedAt, "production_operation_prebegin_resume_at");
    const liveLease = existsSync(this.#path(PRODUCTION_OPERATION_LEASE_FILE_V2))
      ? this.#readLease() : null;
    const identity = this.#readFreezeAndManifest();
    const entries = readdirSync(this.#root, { withFileTypes: true }).filter((entry) =>
      entry.name.startsWith("production-operation-settlement-") && entry.name.endsWith(".json"));
    if (entries.some((entry) => !entry.isFile()
        || !/^production-operation-settlement-production-(?:rollout|canary|rollback|recovery)-[0-9a-f]{64}\.json$/u
          .test(entry.name))) {
      throw new Error("production_prebegin_settlement_artifact_invalid");
    }
    const parsedSettlements = entries.map((entry) => {
      const record = readCanonical(this.#path(entry.name),
        validateProductionOperationSettlementV2, "production_operation_settlement");
      exactOperationId(record.value.operationId);
      if (entry.name !== `production-operation-settlement-${record.value.operationId}.json`) {
        throw new Error("production_prebegin_settlement_filename_invalid");
      }
      return record;
    });
    const candidates = parsedSettlements.filter(({ value }) => value.operationKind === operationKind
      && value.candidateSha === identity.candidateSha
      && value.releaseGenerationId === identity.releaseGenerationId
      && value.sourceManifestSha256 === identity.sourceManifestSha256);
    if (candidates.length === 0) return null;
    if (candidates.length !== 1) throw new Error("production_prebegin_settlement_ambiguous");
    const settlement = candidates[0]!;
    const claims = readdirSync(this.#root, { withFileTypes: true }).filter((entry) =>
      entry.name.startsWith("production-operation-claim-") && entry.name.endsWith(".json"));
    if (claims.some((entry) => !entry.isFile()
        || !/^production-operation-claim-[0-9a-f]{64}\.json$/u.test(entry.name))) {
      throw new Error("production_prebegin_claim_artifact_invalid");
    }
    const matchingClaims = claims.map((entry) => {
      const record = readCanonical(this.#path(entry.name), validateProductionOperationClaimV2,
        "production_operation_claim");
      if (entry.name !== `production-operation-claim-${record.value.operationalAttestationSha256}.json`) {
        throw new Error("production_prebegin_claim_filename_invalid");
      }
      return record;
    })
      .filter((claim) => claim.sha256 === settlement.value.claimSha256);
    if (matchingClaims.length !== 1) throw new Error("production_prebegin_claim_missing");
    const claim = matchingClaims[0]!;
    if (claim.value.operationId !== settlement.value.operationId
        || claim.value.operationKind !== operationKind
        || claim.value.authorityConsumptionSha256 !== settlement.value.authorityConsumptionSha256
        || claim.value.candidateSha !== identity.candidateSha
        || claim.value.releaseGenerationId !== identity.releaseGenerationId
        || claim.value.sourceManifestSha256 !== identity.sourceManifestSha256
        || claim.value.preclaimLeaseLineageCurrentTipSha256
          !== claim.value.authorityConsumption.preclaimLeaseLineageCurrentTipSha256) {
      throw new Error("production_prebegin_claim_binding_invalid");
    }
    if (liveLease !== null && (liveLease.value.operationId !== settlement.value.operationId
          || liveLease.value.operationKind !== operationKind
          || liveLease.value.candidateSha !== identity.candidateSha
          || liveLease.value.releaseGenerationId !== identity.releaseGenerationId
          || liveLease.value.sourceManifestSha256 !== identity.sourceManifestSha256
          || liveLease.value.operationDeadlineAt !== settlement.value.operationDeadlineAt
          || liveLease.value.capability !== settlement.value.capability
          || liveLease.sha256 !== settlement.value.finalLeaseSha256
          || liveLease.value.leaseEpoch !== settlement.value.finalLeaseEpoch)) {
      throw new Error("production_prebegin_settlement_live_lease_binding_invalid");
    }
    if (liveLease !== null) {
      const owner = currentRootWriterOwnerIdentityV2();
      const ownerMatches = liveLease.value.ownerPid === owner.pid
        && liveLease.value.ownerProcessStartFingerprintSha256 === owner.processStartFingerprintSha256;
      if (!ownerMatches && isLeaseOwnerProcessAliveV2(liveLease.value.ownerPid,
        liveLease.value.ownerProcessStartFingerprintSha256)) {
        throw new Error("production_prebegin_settlement_live_owner_active");
      }
    }
    const preclaim = readCanonical(this.#path(`production-authority-preclaim-${settlement.value.operationId}.json`),
      validateProductionAuthorityPreclaimValidationV2, "production_authority_preclaim");
    const lineage = readCanonical(this.#path(claim.value.preclaimLeaseLineageRelativePath),
      validateProductionPreclaimLeaseLineageV2, "production_preclaim_lease_lineage");
    if (preclaim.sha256 !== claim.value.authorityConsumption.preclaimValidationSha256
        || preclaim.value.operationId !== settlement.value.operationId
        || lineage.sha256 !== claim.value.preclaimLeaseLineageSha256
        || lineage.value.operationId !== settlement.value.operationId
        || lineage.value.preclaimValidationSha256 !== preclaim.sha256
        || lineage.value.currentTipLeaseSha256 !== claim.value.preclaimLeaseLineageCurrentTipSha256
        || lineage.value.currentTipLeaseEpoch !== claim.value.leaseEpochAtConsumption) {
      throw new Error("production_prebegin_lineage_binding_invalid");
    }
    this.#verifyStoredPreclaimLineage(preclaim, lineage);
    const takeover = this.#verifyNormalTakeoverChainToTip(claim.value, {
      sha256: settlement.value.finalLeaseSha256,
      epoch: settlement.value.finalLeaseEpoch
    });
    const action = OPERATION_ACTION[operationKind];
    const attestationPath = safeArtifactRelativePath(this.#root,
      `operational-attestations/${action}/${identity.releaseGenerationId}/${claim.value.operationalAttestationSha256}.json`);
    const attestation = readCanonical(attestationPath, validateOperationalAttestationV2,
      "operational_attestation");
    const issuerReceiptPath = safeArtifactRelativePath(this.#root,
      `operational-attestation-issuer-receipts/${action}/${identity.releaseGenerationId}/${claim.value.operationalAttestationIssuerReceiptSha256}.json`);
    const issuerReceipt = readCanonical(issuerReceiptPath, validateOperationalAttestationIssuerReceiptV2,
      "operational_attestation_issuer_receipt");
    if (attestation.sha256 !== claim.value.operationalAttestationSha256
        || attestation.value.action !== action
        || attestation.value.generationId !== identity.releaseGenerationId
        || attestation.value.sourceManifestSha256 !== identity.sourceManifestSha256
        || issuerReceipt.sha256 !== claim.value.operationalAttestationIssuerReceiptSha256
        || issuerReceipt.value.attestationSha256 !== attestation.sha256
        || issuerReceipt.value.action !== action
        || issuerReceipt.value.generationId !== identity.releaseGenerationId) {
      throw new Error("production_prebegin_authority_binding_invalid");
    }
    const verifiedBundle = this.#verifySettlementTerminalBundle(settlement, claim, takeover,
      verifySettledRollbackHistoricalProofs);
    const orchestration = verifiedBundle.orchestration;
    const preparedPath = this.#path(
      `production-operation-lease-removal-prepared-${settlement.value.operationId}.json`);
    const prepared = existsSync(preparedPath)
      ? readCanonical(preparedPath, validatePreparedProductionOperationLeaseRemovalV2,
        "prepared_production_operation_lease_removal") : null;
    if (prepared === null) {
      if (liveLease === null) throw new Error("production_prebegin_settlement_prepared_missing");
    } else if (prepared.value.operationId !== settlement.value.operationId
        || prepared.value.operationKind !== operationKind
        || prepared.value.terminalStateKind !== "settlement"
        || prepared.value.terminalStateSha256 !== settlement.sha256
        || prepared.value.capability !== settlement.value.capability
        || prepared.value.exactCurrentLeaseSha256 !== settlement.value.finalLeaseSha256
        || prepared.value.exactCurrentLeaseEpoch !== settlement.value.finalLeaseEpoch) {
      throw new Error("production_prebegin_settlement_prepared_binding_invalid");
    }
    this.publishTerminalArtifacts(settlement.value.operationId);
    this.completeTerminal({ operationId: settlement.value.operationId, terminalStateKind: "settlement",
      terminalStateSha256: settlement.sha256, evaluatedAt });
    return { result: settlement.value.result, operationId: settlement.value.operationId,
      finalLeaseEpoch: settlement.value.finalLeaseEpoch,
      orchestrationReceipt: orchestration?.value ?? null,
      orchestrationReceiptSha256: orchestration?.sha256 ?? null };
  }

  resumeCompletedSettlement(operationId: string, evaluatedAt: string,
    verifySettledRollbackHistoricalProofs?: SettledRollbackHistoricalProofVerifierV2): null | Readonly<{
    settlement: ProductionOperationSettlementV2;
    orchestrationReceipt: ProductionOrchestrationReceiptV2 | null;
    orchestrationReceiptSha256: string | null;
  }> {
    exactOperationId(operationId);
    parseIso(evaluatedAt, "production_operation_resume_at");
    const settlementPath = this.#path(`production-operation-settlement-${operationId}.json`);
    if (!existsSync(settlementPath)) return null;
    const settlement = readCanonical(settlementPath, validateProductionOperationSettlementV2,
      "production_operation_settlement");
    const lease = this.#readLease();
    const claim = this.#claimForLease(lease.value);
    const owner = currentRootWriterOwnerIdentityV2();
    if (claim === null || lease.value.operationId !== operationId
        || lease.value.ownerPid !== owner.pid
        || lease.value.ownerProcessStartFingerprintSha256 !== owner.processStartFingerprintSha256
        || settlement.value.operationId !== operationId
        || settlement.value.operationKind !== lease.value.operationKind
        || settlement.value.claimSha256 !== claim.sha256
        || settlement.value.authorityConsumptionSha256 !== claim.value.authorityConsumptionSha256
        || settlement.value.finalLeaseSha256 !== lease.sha256
        || settlement.value.finalLeaseEpoch !== lease.value.leaseEpoch
        || settlement.value.operationDeadlineAt !== lease.value.operationDeadlineAt) {
      throw new Error("production_completed_settlement_binding_invalid");
    }
    const takeover = this.#verifyNormalTakeoverChain(claim.value, lease);
    const orchestration = this.#verifySettlementTerminalBundle(settlement, claim, takeover,
      verifySettledRollbackHistoricalProofs).orchestration;
    this.publishTerminalArtifacts(operationId);
    this.completeTerminal({ operationId, terminalStateKind: "settlement",
      terminalStateSha256: settlement.sha256, evaluatedAt });
    return { settlement: settlement.value, orchestrationReceipt: orchestration?.value ?? null,
      orchestrationReceiptSha256: orchestration?.sha256 ?? null };
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
      const resumableDeadSettlement = input.terminalStateKind === "settlement"
        && lease.value.capability !== "cleanup_only"
        && terminalState.capability === lease.value.capability
        && terminalState.finalLeaseSha256 === lease.sha256
        && terminalState.finalLeaseEpoch === lease.value.leaseEpoch
        && !isLeaseOwnerProcessAliveV2(lease.value.ownerPid,
          lease.value.ownerProcessStartFingerprintSha256);
      if (lease.value.operationId !== input.operationId
          || (!ownerMatches && !resumableDeadCleanup && !resumableDeadSettlement)
          || terminalState.operationKind !== lease.value.operationKind
          || terminalState.capability !== lease.value.capability
          || terminalState.finalLeaseSha256 !== lease.sha256
          || terminalState.finalLeaseEpoch !== lease.value.leaseEpoch) {
        throw new Error("production_terminal_lease_binding_invalid");
      }
      if (resumableDeadCleanup && input.terminalStateKind === "terminal_abandoned") {
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
    if (replay !== null) {
      const live = this.#readLease();
      const claim = this.#claimForLease(live.value);
      if (claim === null || live.value.operationId !== replay.operationId) {
        throw new Error("production_operation_takeover_replay_live_tip_invalid");
      }
      const lineage = this.#verifyNormalTakeoverChain(claim.value, live);
      if (!lineage.leaseTips.some((tip) => tip.sha256 === replay.newLeaseSha256
          && tip.epoch === replay.newLeaseEpoch)) {
        throw new Error("production_operation_takeover_replay_not_ancestor");
      }
      return replay;
    }
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

  #completedStepState(operationId: string, operationKind: ProductionOperationKindV2): {
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
      attemptedExternalEffect: productionOperationAttemptedExternalEffectV2(
        operationKind, hasIntent, receipts.map((receipt) => receipt.executionKind)
      )
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
    const settlementPath = this.#path(
      `production-operation-settlement-${oldLease.value.operationId}.json`);
    if (existsSync(settlementPath)) throw new Error("production_operation_settlement_resume_required");
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
    const stepState = this.#completedStepState(oldLease.value.operationId, oldLease.value.operationKind);
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
