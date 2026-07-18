import { createHash } from "node:crypto";

export const RELEASE_GATE_IDS_V2 = [
  "G00_BASE", "G01_TRACE", "G02_DATA", "G03_SCORING", "G04_RUNTIME",
  "G05_TELEGRAM", "G06_FULL", "G07_SCHEMA_OFFLINE", "G08_VERSION_SANITIZED",
  "G09_LEGACY_TERMINAL", "G10_ROLLBACK_REHEARSAL", "G11_POISONING_REGRESSION",
  "G12_PRODUCTION_BACKUP", "G13_PRODUCTION_MIGRATION", "G14_PRODUCTION_ROLLOUT",
  "G15_PRODUCTION_CANARY"
] as const;

export const MANIFEST_TRANSITIONS_V2 = [
  "pre_manual", "readiness", "g12_backup_passed", "g13_migration_passed",
  "g14_rollout_passed", "g15_canary_released", "production_failed",
  "rollback_rolled_back"
] as const;

export type ReleaseGateIdV2 = typeof RELEASE_GATE_IDS_V2[number];
export type ManifestTransitionIdV2 = typeof MANIFEST_TRANSITIONS_V2[number];

export type ReleaseFreezeIdentityV2 = {
  version: "release-freeze-identity-v2";
  releaseGenerationId: string;
  candidateSha: string;
  planBaseSha: string;
  artifactRootFingerprintSha256: string;
  artifactRootTrustBoundaryEvidenceSha256: string;
  productionDatabaseIdentityFingerprintSha256: string;
  postgresToolIdentitySha256: string;
  previousRuntimeDiscoverySha256: string;
  rollbackWorktreeIdentitySha256: string;
  createdAt: string;
};

export type OperationalAttestationV2 = {
  version: "operational-attestation-v2";
  action: ManifestTransitionIdV2;
  generationId: string;
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  commandId: string;
  redactedTemplateSha256: string;
  previousAttestationSha256: string | null;
  priorTerminalLineageSha256: string | null;
  issuedAt: string;
  expiresAt: string;
};

export type PendingReleaseGateV2 = {
  id: ReleaseGateIdV2;
  candidateSha: string;
  state: "pending";
};

export type ExecutedReleaseGateV2 = {
  id: ReleaseGateIdV2;
  candidateSha: string;
  state: "passed" | "failed";
  commandId: string;
  redactedTemplateSha256: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  outputSha256: string;
  evidence: Array<{
    kind: string;
    relativePath: string;
    sha256: string;
    schemaVersion: string;
    candidateSha: string;
  }>;
};

export type BlockedReleaseGateV2 = {
  id: Extract<ReleaseGateIdV2,
    "G12_PRODUCTION_BACKUP" | "G13_PRODUCTION_MIGRATION" |
    "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY">;
  candidateSha: string;
  state: "blocked";
  blockedByGateId: Extract<ReleaseGateIdV2,
    "G12_PRODUCTION_BACKUP" | "G13_PRODUCTION_MIGRATION" |
    "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY">;
  productionFailureEvidence: {
    kind: "production_failure_evidence";
    relativePath: "production-failure-evidence-v2.json";
    sha256: string;
    schemaVersion: "production-failure-evidence-v2";
    candidateSha: string;
    sourceManifestSha256: string;
  };
};

export type ReleaseGateV2 = PendingReleaseGateV2 | ExecutedReleaseGateV2 | BlockedReleaseGateV2;

export type RemediationReleaseManifestV2 = {
  version: "remediation-release-manifest-v2";
  revision: number;
  releaseGenerationId: string;
  candidateSha: string;
  planBaseSha: string;
  releaseFreezeIdentitySha256: string;
  sourceManifestSha256: string | null;
  transitionId: ManifestTransitionIdV2;
  overall: "not_ready" | "ready_for_release" | "released" | "rolled_back";
  gates: ReleaseGateV2[];
  transitionEvidence: unknown[];
  updatedAt: string;
};

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}_invalid`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label}_keys_invalid`);
  }
}

function sha(value: unknown, regex: RegExp, label: string): string {
  if (typeof value !== "string" || !regex.test(value)) throw new Error(`${label}_invalid`);
  return value;
}

function iso(value: unknown, label: string): string {
  if (typeof value !== "string" || !ISO.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

export function canonicalReleaseJsonV2(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalReleaseJsonV2).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalReleaseJsonV2(object[key])}`).join(",")}}`;
}

export function releaseSha256V2(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function validateReleaseFreezeIdentityV2(value: unknown): ReleaseFreezeIdentityV2 {
  const input = record(value, "release_freeze_identity");
  exactKeys(input, [
    "version", "releaseGenerationId", "candidateSha", "planBaseSha",
    "artifactRootFingerprintSha256", "artifactRootTrustBoundaryEvidenceSha256",
    "productionDatabaseIdentityFingerprintSha256", "postgresToolIdentitySha256",
    "previousRuntimeDiscoverySha256", "rollbackWorktreeIdentitySha256", "createdAt"
  ], "release_freeze_identity");
  if (input.version !== "release-freeze-identity-v2" || typeof input.releaseGenerationId !== "string"
      || input.releaseGenerationId.length === 0) throw new Error("release_freeze_identity_invalid");
  sha(input.candidateSha, SHA40, "candidate_sha");
  sha(input.planBaseSha, SHA40, "plan_base_sha");
  for (const key of [
    "artifactRootFingerprintSha256", "artifactRootTrustBoundaryEvidenceSha256",
    "productionDatabaseIdentityFingerprintSha256", "postgresToolIdentitySha256",
    "previousRuntimeDiscoverySha256", "rollbackWorktreeIdentitySha256"
  ]) sha(input[key], SHA256, key);
  iso(input.createdAt, "created_at");
  return input as ReleaseFreezeIdentityV2;
}

export function validateOperationalAttestationV2(
  value: unknown,
  freeze?: ReleaseFreezeIdentityV2
): OperationalAttestationV2 {
  const input = record(value, "operational_attestation");
  exactKeys(input, [
    "version", "action", "generationId", "candidateSha", "releaseFreezeIdentitySha256",
    "sourceManifestSha256", "artifactRootFingerprintSha256", "commandId",
    "redactedTemplateSha256", "previousAttestationSha256", "priorTerminalLineageSha256",
    "issuedAt", "expiresAt"
  ], "operational_attestation");
  if (input.version !== "operational-attestation-v2"
      || !MANIFEST_TRANSITIONS_V2.includes(input.action as ManifestTransitionIdV2)
      || typeof input.generationId !== "string" || input.generationId.length === 0
      || typeof input.commandId !== "string" || input.commandId.length === 0) {
    throw new Error("operational_attestation_invalid");
  }
  sha(input.candidateSha, SHA40, "candidate_sha");
  for (const key of ["releaseFreezeIdentitySha256", "sourceManifestSha256", "artifactRootFingerprintSha256", "redactedTemplateSha256"]) {
    sha(input[key], SHA256, key);
  }
  for (const key of ["previousAttestationSha256", "priorTerminalLineageSha256"]) {
    if (input[key] !== null) sha(input[key], SHA256, key);
  }
  const issued = iso(input.issuedAt, "issued_at");
  const expires = iso(input.expiresAt, "expires_at");
  if (Date.parse(expires) <= Date.parse(issued)) throw new Error("operational_attestation_expiry_invalid");
  if (freeze && (input.generationId !== freeze.releaseGenerationId
      || input.candidateSha !== freeze.candidateSha
      || input.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256)) {
    throw new Error("operational_attestation_freeze_binding_invalid");
  }
  return input as OperationalAttestationV2;
}

export function validateReleaseGateV2(value: unknown): ReleaseGateV2 {
  const gate = record(value, "release_gate");
  if (!RELEASE_GATE_IDS_V2.includes(gate.id as ReleaseGateIdV2)) throw new Error("release_gate_id_invalid");
  sha(gate.candidateSha, SHA40, "release_gate_candidate_sha");
  if (gate.state === "pending") {
    exactKeys(gate, ["id", "candidateSha", "state"], "pending_release_gate");
    return gate as PendingReleaseGateV2;
  }
  if (gate.state === "blocked") {
    exactKeys(gate, ["id", "candidateSha", "state", "blockedByGateId", "productionFailureEvidence"], "blocked_release_gate");
    if (!String(gate.id).startsWith("G1") || !String(gate.blockedByGateId).startsWith("G1")) {
      throw new Error("blocked_release_gate_id_invalid");
    }
    const evidence = record(gate.productionFailureEvidence, "production_failure_evidence");
    exactKeys(evidence, ["kind", "relativePath", "sha256", "schemaVersion", "candidateSha", "sourceManifestSha256"], "production_failure_evidence");
    if (evidence.kind !== "production_failure_evidence"
        || evidence.relativePath !== "production-failure-evidence-v2.json"
        || evidence.schemaVersion !== "production-failure-evidence-v2"
        || evidence.candidateSha !== gate.candidateSha) throw new Error("production_failure_evidence_invalid");
    sha(evidence.sha256, SHA256, "production_failure_evidence_sha");
    sha(evidence.sourceManifestSha256, SHA256, "production_failure_source_sha");
    return gate as BlockedReleaseGateV2;
  }
  if (gate.state === "passed" || gate.state === "failed") {
    exactKeys(gate, [
      "id", "candidateSha", "state", "commandId", "redactedTemplateSha256",
      "startedAt", "finishedAt", "exitCode", "outputSha256", "evidence"
    ], "executed_release_gate");
    if (typeof gate.commandId !== "string" || gate.commandId.length === 0
        || !Number.isSafeInteger(gate.exitCode)
        || (gate.state === "passed" ? gate.exitCode !== 0 : gate.exitCode === 0)
        || !Array.isArray(gate.evidence)) throw new Error("executed_release_gate_invalid");
    sha(gate.redactedTemplateSha256, SHA256, "redacted_template_sha");
    sha(gate.outputSha256, SHA256, "output_sha");
    if (Date.parse(iso(gate.finishedAt, "finished_at")) < Date.parse(iso(gate.startedAt, "started_at"))) {
      throw new Error("release_gate_time_invalid");
    }
    for (const rawRef of gate.evidence) {
      const ref = record(rawRef, "gate_evidence_ref");
      exactKeys(ref, ["kind", "relativePath", "sha256", "schemaVersion", "candidateSha"], "gate_evidence_ref");
      if (typeof ref.kind !== "string" || typeof ref.relativePath !== "string"
          || typeof ref.schemaVersion !== "string" || ref.candidateSha !== gate.candidateSha) {
        throw new Error("gate_evidence_ref_invalid");
      }
      sha(ref.sha256, SHA256, "gate_evidence_sha");
    }
    return gate as ExecutedReleaseGateV2;
  }
  throw new Error("release_gate_state_invalid");
}

export function validateRemediationReleaseManifestV2(value: unknown): RemediationReleaseManifestV2 {
  const manifest = record(value, "release_manifest_v2");
  exactKeys(manifest, [
    "version", "revision", "releaseGenerationId", "candidateSha", "planBaseSha",
    "releaseFreezeIdentitySha256", "sourceManifestSha256", "transitionId", "overall",
    "gates", "transitionEvidence", "updatedAt"
  ], "release_manifest_v2");
  if (manifest.version !== "remediation-release-manifest-v2"
      || !Number.isSafeInteger(manifest.revision) || Number(manifest.revision) < 1
      || typeof manifest.releaseGenerationId !== "string" || manifest.releaseGenerationId.length === 0
      || !MANIFEST_TRANSITIONS_V2.includes(manifest.transitionId as ManifestTransitionIdV2)
      || !["not_ready", "ready_for_release", "released", "rolled_back"].includes(String(manifest.overall))
      || !Array.isArray(manifest.gates) || !Array.isArray(manifest.transitionEvidence)) {
    throw new Error("release_manifest_v2_invalid");
  }
  sha(manifest.candidateSha, SHA40, "candidate_sha");
  sha(manifest.planBaseSha, SHA40, "plan_base_sha");
  sha(manifest.releaseFreezeIdentitySha256, SHA256, "freeze_identity_sha");
  if (manifest.sourceManifestSha256 !== null) sha(manifest.sourceManifestSha256, SHA256, "source_manifest_sha");
  iso(manifest.updatedAt, "updated_at");
  const gates = manifest.gates.map(validateReleaseGateV2);
  if (gates.length !== RELEASE_GATE_IDS_V2.length
      || new Set(gates.map((gate) => gate.id)).size !== RELEASE_GATE_IDS_V2.length
      || RELEASE_GATE_IDS_V2.some((id) => !gates.some((gate) => gate.id === id))) {
    throw new Error("release_manifest_gate_set_invalid");
  }
  if (gates.some((gate) => gate.candidateSha !== manifest.candidateSha)) throw new Error("release_manifest_gate_candidate_invalid");
  return { ...manifest, gates } as RemediationReleaseManifestV2;
}

const TRANSITION_ORDER: Record<ManifestTransitionIdV2, ManifestTransitionIdV2 | null> = {
  pre_manual: null,
  readiness: "pre_manual",
  g12_backup_passed: "readiness",
  g13_migration_passed: "g12_backup_passed",
  g14_rollout_passed: "g13_migration_passed",
  g15_canary_released: "g14_rollout_passed",
  production_failed: null,
  rollback_rolled_back: "production_failed"
};

function passedGate(id: ReleaseGateIdV2, candidateSha: string, evaluatedAt: string): ExecutedReleaseGateV2 {
  const outputSha256 = releaseSha256V2(canonicalReleaseJsonV2([id, candidateSha, evaluatedAt]));
  return {
    id, candidateSha, state: "passed", commandId: `manifest_${id.toLowerCase()}`,
    redactedTemplateSha256: releaseSha256V2(`template:${id}`),
    startedAt: evaluatedAt, finishedAt: evaluatedAt, exitCode: 0, outputSha256,
    evidence: [{ kind: "transition_evidence", relativePath: `gates/${id.toLowerCase()}.json`,
      sha256: outputSha256, schemaVersion: "gate-evidence-v2", candidateSha }]
  };
}

function gateForTransition(transition: ManifestTransitionIdV2): ReleaseGateIdV2 | null {
  return ({ readiness: "G05_TELEGRAM", g12_backup_passed: "G12_PRODUCTION_BACKUP",
    g13_migration_passed: "G13_PRODUCTION_MIGRATION", g14_rollout_passed: "G14_PRODUCTION_ROLLOUT",
    g15_canary_released: "G15_PRODUCTION_CANARY" } as Partial<Record<ManifestTransitionIdV2, ReleaseGateIdV2>>)[transition] ?? null;
}

export function createInitialRemediationReleaseManifestV2(input: {
  freezeIdentity: unknown;
  sourceManifest?: unknown;
  evaluatedAt: string;
}): RemediationReleaseManifestV2 {
  if (input.sourceManifest !== undefined) throw new Error("initial_manifest_requires_absent_source");
  const freeze = validateReleaseFreezeIdentityV2(input.freezeIdentity);
  const evaluatedAt = iso(input.evaluatedAt, "evaluated_at");
  const pending = new Set<ReleaseGateIdV2>([
    "G05_TELEGRAM", "G12_PRODUCTION_BACKUP", "G13_PRODUCTION_MIGRATION",
    "G14_PRODUCTION_ROLLOUT", "G15_PRODUCTION_CANARY"
  ]);
  return {
    version: "remediation-release-manifest-v2", revision: 1,
    releaseGenerationId: freeze.releaseGenerationId, candidateSha: freeze.candidateSha,
    planBaseSha: freeze.planBaseSha,
    releaseFreezeIdentitySha256: releaseSha256V2(canonicalReleaseJsonV2(freeze)),
    sourceManifestSha256: null, transitionId: "pre_manual", overall: "not_ready",
    gates: RELEASE_GATE_IDS_V2.map((id) => pending.has(id)
      ? { id, candidateSha: freeze.candidateSha, state: "pending" }
      : passedGate(id, freeze.candidateSha, evaluatedAt)),
    transitionEvidence: [], updatedAt: evaluatedAt
  };
}

export function reduceRemediationReleaseManifestV2(
  currentValue: unknown,
  transition: { transitionId: ManifestTransitionIdV2; evidence?: unknown[]; evaluatedAt?: string }
): RemediationReleaseManifestV2 {
  const current = validateRemediationReleaseManifestV2(currentValue);
  if (!MANIFEST_TRANSITIONS_V2.includes(transition.transitionId)
      || TRANSITION_ORDER[transition.transitionId] !== current.transitionId) {
    throw new Error("manifest_transition_order_invalid");
  }
  const evaluatedAt = iso(transition.evaluatedAt ?? current.updatedAt, "evaluated_at");
  const gateId = gateForTransition(transition.transitionId);
  const gates = current.gates.map((gate) => gate.id === gateId
    ? passedGate(gate.id, current.candidateSha, evaluatedAt)
    : gate);
  const target: RemediationReleaseManifestV2 = {
    ...current,
    revision: current.revision + 1,
    sourceManifestSha256: releaseSha256V2(Buffer.from(`${canonicalReleaseJsonV2(current)}\n`, "utf8")),
    transitionId: transition.transitionId,
    overall: transition.transitionId === "g15_canary_released"
      ? "released"
      : transition.transitionId === "readiness" ? "ready_for_release" : "not_ready",
    gates,
    transitionEvidence: transition.evidence ?? [],
    updatedAt: evaluatedAt
  };
  return validateRemediationReleaseManifestV2(target);
}

export function validateManifestGateEvidenceV2(): never {
  throw new Error("gate_evidence_policy_not_implemented");
}

export async function verifyRemediationReleaseArtifactsV2(): Promise<never> {
  throw new Error("gate_evidence_policy_not_implemented");
}

export function assertProductionMutatorAuthorityV2(): never {
  throw new Error("production_mutator_authority_unverified");
}
