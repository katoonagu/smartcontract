import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
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
  safeArtifactRelativePath,
  writeExclusiveDurable
} from "../src/release/releaseRootWriterStore";
import {
  advanceReleaseManifestV2,
  initializeReleaseManifestV2,
  normalizeTrustedPrincipalPolicyV2,
  verifyCurrentReleaseManifestChainV2
} from "../src/release/releaseManifestStoreV2";
import {
  deriveTask0BProductionGateBindingV2,
  validateGateEvidenceBytesV2,
  type GateEvidencePayloadV2
} from "../src/release/releaseGateEvidencePolicy";
import { PRE_RELEASE_GATE_EVIDENCE_POLICY_V2 } from "../src/release/releaseGateEvidencePolicy";
import { RELEASE_TRANSITION_EVIDENCE_POLICY_V2 } from "../src/release/releaseTransitionEvidencePolicy";
import {
  REMEDIATION_PRE_RELEASE_GATE_IDS,
  REMEDIATION_GATE_COMMAND_IDS,
  REMEDIATION_COMMAND_TEMPLATE_SHA256,
  validateTask0BReleaseFreezeEvidence
} from "../src/release/remediationReleaseManifest";
import { inspectProtectedPathChain } from "./captureTask0BPreflight";
import {
  buildReleaseSuiteEnvironment,
  runBoundedReleaseProcess,
  validateOfflineSchemaArtifactSet,
  verifyPreReleaseConcreteEvidenceV2
} from "./verifyRemediationRelease";
import {
  assertBehavioralRedExecution,
  normalizeAcceptanceTestFile,
  parseVitestJsonReport
} from "../src/release/acceptanceTrace";

const execFileAsync = promisify(execFile);
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

type ProducerGraphNodeV2 = {
  path: string;
  producers: string[];
  bindings: readonly ["root", "freeze", "candidate", "lineage"];
  external?: "dedicated_non_production_telegram" | "operator_approved_sanitized_runtime_config";
};

function producerNode(
  path: string,
  producer: string,
  external?: ProducerGraphNodeV2["external"]
): ProducerGraphNodeV2 {
  return { path, producers: [producer], bindings: ["root", "freeze", "candidate", "lineage"],
    ...(external ? { external } : {}) };
}

const OFFICIAL_PRE_RELEASE_PRODUCER_BY_PATH = Object.freeze({
  "task0-baseline.json": "release:trace:prepare",
  "trusted-os-principal-policy-v2.json": "release:evidence:g00",
  "artifact-root-trust-boundary-evidence-v1.json": "release:evidence:g00",
  "release-freeze-materialization-receipt-v2.json": "release:freeze:materialize",
  "release-freeze-identity-v2.json": "release:freeze:materialize",
  "acceptance-trace.json": "release:trace:capture",
  "task8b-historical-red-evidence-v2.json": "release:evidence:task8b-historical-red",
  "suite-plan4.vitest.json": "release:suite:plan4",
  "suite-plan4.evidence.json": "release:suite:plan4",
  "suite-plan1.vitest.json": "release:suite:plan1",
  "suite-plan1.evidence.json": "release:suite:plan1",
  "suite-plan2.vitest.json": "release:suite:plan2",
  "suite-plan2.evidence.json": "release:suite:plan2",
  "suite-plan3.vitest.json": "release:suite:plan3",
  "suite-plan3.evidence.json": "release:suite:plan3",
  "manual-telegram-acceptance.json": "release:telegram:finalize",
  "full-regression-evidence.json": "release:verify:non-vitest",
  "suite-plan5.vitest.json": "release:suite:plan5",
  "suite-plan5.evidence.json": "release:suite:plan5",
  "schema-clean/schema032-release-evidence.json": "release:evidence:g07-promote",
  "schema-production-clone/schema032-release-evidence.json": "release:evidence:g07-promote",
  "runtime-rehearsal.json": "release:runtime:rehearse",
  "schema-runtime-sanitized-evidence.json": "schema:release:sequence",
  "terminal-legacy-population.json": "release:legacy:snapshot",
  "rollback-rehearsal.json": "release:runtime:rehearse",
  "suite-addressPoisoningRegression.vitest.json": "release:suite:addressPoisoningRegression",
  "suite-addressPoisoningRegression.evidence.json": "release:suite:addressPoisoningRegression"
} as const);

const OFFICIAL_SUPPORTING_PRODUCER_BY_PATH = Object.freeze({
  "task8b-historical-red.vitest.json": "release:evidence:task8b-historical-red",
  "task8b-historical-red-cleanup-receipt-v1.json": "release:evidence:task8b-historical-red",
  "task8b-candidate-green.vitest.json": "release:evidence:task8b-historical-red",
  "task8b-frozen-test.patch": "release:evidence:task8b-historical-red",
  "task0b-release-freeze.json": "release:task0b:preflight",
  "runtime-candidate-start-evidence.json": "release:runtime:rehearse",
  "runtime-previous-start-evidence.json": "release:runtime:rehearse",
  "runtime-operational-observation.json": "release:runtime:rehearse",
  "runtime-subprocess-captures.json": "release:runtime:rehearse",
  "runtime-query-captures.json": "release:runtime:rehearse",
  "runtime-operational-config.json": "operator:approved-sanitized-runtime-config"
} as const);

function requiredGatePaths(gateId: keyof typeof PRE_RELEASE_GATE_EVIDENCE_POLICY_V2): readonly string[] {
  const primary = PRE_RELEASE_GATE_EVIDENCE_POLICY_V2[gateId].primaryPaths;
  return gateId === "G08_VERSION_SANITIZED"
    ? [...primary, "schema-runtime-sanitized-evidence.json"]
    : primary;
}

export const RELEASE_EVIDENCE_PRODUCER_GRAPH_V2 = Object.freeze({
  gates: Object.freeze(Object.fromEntries(REMEDIATION_PRE_RELEASE_GATE_IDS.map((gateId) => [
    gateId,
    requiredGatePaths(gateId).map((path) => producerNode(
      path,
      OFFICIAL_PRE_RELEASE_PRODUCER_BY_PATH[path as keyof typeof OFFICIAL_PRE_RELEASE_PRODUCER_BY_PATH],
      gateId === "G05_TELEGRAM" ? "dedicated_non_production_telegram" : undefined
    ))
  ]))),
  transitions: Object.freeze({
    pre_manual: producerNode(
      "verified-manifest-transition-input-pre_manual.json", "release:manifest:prepare:pre_manual"),
    readiness: producerNode(
      "verified-manifest-transition-input-readiness.json", "release:manifest:prepare:readiness")
  }),
  supporting: Object.freeze(Object.entries(OFFICIAL_SUPPORTING_PRODUCER_BY_PATH).map(([path, producer]) =>
    producerNode(path, producer, path === "runtime-operational-config.json"
      ? "operator_approved_sanitized_runtime_config" : undefined)))
});

export function validateReleaseEvidenceProducerGraphV2(
  graph: typeof RELEASE_EVIDENCE_PRODUCER_GRAPH_V2 = RELEASE_EVIDENCE_PRODUCER_GRAPH_V2
): { gateCount: number; transitionCount: number; supportingInputCount: number;
  externalProducerCount: number } {
  const expectedGates = [...REMEDIATION_PRE_RELEASE_GATE_IDS];
  const actualGates = Object.keys(graph.gates);
  if (actualGates.length !== expectedGates.length
      || actualGates.some((gateId, index) => gateId !== expectedGates[index])) {
    throw new Error("release_evidence_gate_producer_missing");
  }
  let externalProducerCount = 0;
  for (const gateId of expectedGates) {
    const nodes = graph.gates[gateId];
    const required = requiredGatePaths(gateId);
    if (!Array.isArray(nodes) || nodes.length !== required.length
        || nodes.some((node, index) => node.path !== required[index])) {
      throw new Error("release_evidence_consumer_path_producer_missing");
    }
    for (const node of nodes) {
      if (!Array.isArray(node.producers) || node.producers.length !== 1) {
        throw new Error("release_evidence_producer_count_invalid");
      }
      if (node.bindings.join("|") !== "root|freeze|candidate|lineage") {
        throw new Error("release_evidence_producer_binding_incomplete");
      }
      const official = OFFICIAL_PRE_RELEASE_PRODUCER_BY_PATH[
        node.path as keyof typeof OFFICIAL_PRE_RELEASE_PRODUCER_BY_PATH];
      if (typeof official !== "string" || node.producers[0] !== official) {
        throw new Error("release_evidence_official_producer_identity_invalid");
      }
      if ((node.external === "dedicated_non_production_telegram") !== (gateId === "G05_TELEGRAM")) {
        throw new Error("release_evidence_external_producer_identity_invalid");
      }
      if (node.external !== undefined) externalProducerCount += 1;
    }
  }
  const transitions = graph.transitions as Record<string, ProducerGraphNodeV2>;
  for (const transition of ["pre_manual", "readiness"] as const) {
    const node = transitions[transition];
    if (!node) throw new Error("release_transition_producer_missing");
    if (node.producers.length !== 1) throw new Error("release_transition_producer_count_invalid");
  }
  if (Object.keys(transitions).length !== 2) throw new Error("release_transition_producer_count_invalid");
  const supporting = graph.supporting as ProducerGraphNodeV2[];
  const expectedSupporting = Object.entries(OFFICIAL_SUPPORTING_PRODUCER_BY_PATH);
  if (!Array.isArray(supporting) || supporting.length !== expectedSupporting.length) {
    throw new Error("release_supporting_input_producer_missing");
  }
  supporting.forEach((node, index) => {
    const [path, producer] = expectedSupporting[index]!;
    if (node.path !== path || node.producers.length !== 1 || node.producers[0] !== producer) {
      throw new Error("release_supporting_input_producer_identity_invalid");
    }
    if (node.bindings.join("|") !== "root|freeze|candidate|lineage") {
      throw new Error("release_supporting_input_producer_binding_incomplete");
    }
    const expectedExternal = path === "runtime-operational-config.json"
      ? "operator_approved_sanitized_runtime_config" : undefined;
    if (node.external !== expectedExternal) throw new Error("release_supporting_input_external_identity_invalid");
    if (node.external !== undefined) externalProducerCount += 1;
  });
  return { gateCount: expectedGates.length, transitionCount: 2,
    supportingInputCount: expectedSupporting.length, externalProducerCount };
}

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

async function assertCleanCandidateBinding(cwd: string, candidateSha: string): Promise<void> {
  const status = await execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd });
  if (status.stdout.trim().length !== 0) throw new Error("candidate_worktree_dirty");
  const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim().toLowerCase();
  if (head !== candidateSha) throw new Error("candidate_head_binding_invalid");
}

function assertArtifactRootFingerprintBinding(
  root: string,
  freeze: Pick<ReturnType<typeof validateReleaseFreezeIdentityV2>, "artifactRootFingerprintSha256">
): void {
  const canonical = process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root);
  if (createHash("sha256").update(canonical, "utf8").digest("hex")
      !== freeze.artifactRootFingerprintSha256) {
    throw new Error("artifact_root_fingerprint_binding_invalid");
  }
}

type AuthoritativeTrustObservationV2 = {
  platform: "windows" | "posix";
  principals: string[];
  ownerIdentityFingerprintSha256: string;
  accessControlFingerprintSha256: string;
};

async function observeAuthoritativeTrust(root: string): Promise<AuthoritativeTrustObservationV2> {
  const access = await inspectProtectedPathChain(root);
  if (process.platform === "win32") {
    const result = await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"
    ], { windowsHide: true, timeout: 5_000 });
    const currentSid = result.stdout.trim();
    if (!/^S-1-[0-9-]+$/u.test(currentSid)) throw new Error("trusted_principal_policy_source_invalid");
    return { platform: "windows", principals: [currentSid, "S-1-5-18", "S-1-5-32-544"], ...access };
  }
  if (typeof process.getuid !== "function") throw new Error("trusted_principal_policy_source_invalid");
  return { platform: "posix", principals: [String(process.getuid())], ...access };
}

export async function publishG00TrustArtifacts(
  input: { artifactRoot: string; cwd?: string; evaluatedAt?: string },
  dependencies: { observeAuthoritativeTrust?: (root: string) => Promise<AuthoritativeTrustObservationV2> } = {}
): Promise<{ trustedPolicySha256: string; trustBoundarySha256: string }> {
  if (Object.keys(dependencies).length > 0 && process.env.NODE_ENV !== "test") {
    throw new Error("g00_test_dependency_injection_forbidden");
  }
  const cwd = input.cwd ?? process.cwd();
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  assertArtifactRootOutsideRepository(root, cwd);
  const policyPath = safeArtifactPath(root, "trusted-os-principal-policy-v2.json");
  const boundaryPath = safeArtifactPath(root, "artifact-root-trust-boundary-evidence-v1.json");
  if (existsSync(policyPath) || existsSync(boundaryPath)) throw new Error("g00_trust_artifact_already_exists");
  const freeze = validateReleaseFreezeIdentityV2(readCanonicalJson(
    root, "release-freeze-identity-v2.json", "release_freeze_identity"));
  assertArtifactRootFingerprintBinding(root, freeze);
  await assertCleanCandidateBinding(cwd, freeze.candidateSha);
  const task0bBytes = readStableFile(safeArtifactPath(root, "task0b-release-freeze.json"));
  const task0b = validateTask0BReleaseFreezeEvidence(
    JSON.parse(task0bBytes.toString("utf8")), freeze.candidateSha);
  if (!canonicalBytesV2(task0b).equals(task0bBytes)
      || task0b.artifactRoot.rootFingerprintSha256 !== freeze.artifactRootFingerprintSha256) {
    throw new Error("g00_task0b_freeze_binding_invalid");
  }
  const artifactRootObservationSha256 = createHash("sha256")
    .update(canonicalBytesV2(task0b.artifactRoot)).digest("hex");
  if (artifactRootObservationSha256 !== freeze.artifactRootTrustBoundaryEvidenceSha256) {
    throw new Error("g00_trust_boundary_freeze_binding_invalid");
  }
  const observed = await (dependencies.observeAuthoritativeTrust ?? observeAuthoritativeTrust)(root);
  if (observed.ownerIdentityFingerprintSha256 !== task0b.artifactRoot.ownerIdentityFingerprintSha256
      || observed.accessControlFingerprintSha256 !== task0b.artifactRoot.accessControlFingerprintSha256) {
    throw new Error("g00_authoritative_trust_observation_changed");
  }
  const normalized = normalizeTrustedPrincipalPolicyV2({
    platform: observed.platform,
    principals: observed.principals
  });
  const releaseFreezeIdentitySha256 = releaseFreezeIdentitySha256V2(freeze);
  const task0BPreflightEvidenceSha256 = createHash("sha256").update(task0bBytes).digest("hex");
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  if (!ISO.test(evaluatedAt)) throw new Error("g00_evaluated_at_invalid");
  const policy = {
    ...normalized,
    candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256,
    task0BPreflightEvidenceSha256,
    ownerIdentityFingerprintSha256: observed.ownerIdentityFingerprintSha256,
    accessControlFingerprintSha256: observed.accessControlFingerprintSha256,
    authoritativePolicySource: "task0b_allowlisted_writer_principals_v2",
    observedAt: evaluatedAt,
    source: "task0b_acl_policy_read_only",
    verified: true
  } as const;
  const policyBytes = canonicalBytesV2(policy);
  const trustedPolicySha256 = createHash("sha256").update(policyBytes).digest("hex");
  const boundary = {
    version: "artifact-root-trust-boundary-evidence-v1",
    candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256,
    task0BPreflightEvidenceSha256,
    artifactRootObservationSha256,
    trustedOsPrincipalPolicySha256: trustedPolicySha256,
    ownerIdentityFingerprintSha256: observed.ownerIdentityFingerprintSha256,
    accessControlFingerprintSha256: observed.accessControlFingerprintSha256,
    accessControlSource: task0b.artifactRoot.accessControlSource,
    outsideRepository: task0b.artifactRoot.outsideRepository,
    noSymlink: task0b.artifactRoot.noSymlink,
    restrictiveAccessVerified: task0b.artifactRoot.restrictiveAccessVerified,
    exclusiveWriteVerified: task0b.artifactRoot.exclusiveWriteVerified,
    observedAt: evaluatedAt,
    source: "task0b_protected_root_acl_read_only",
    verified: true
  } as const;
  const boundaryBytes = canonicalBytesV2(boundary);
  writeExclusiveDurable(policyPath, policyBytes);
  writeExclusiveDurable(boundaryPath, boundaryBytes);
  return { trustedPolicySha256,
    trustBoundarySha256: createHash("sha256").update(boundaryBytes).digest("hex") };
}

export async function verifyG00TrustArtifactsCurrent(
  input: { artifactRoot: string },
  dependencies: { observeAuthoritativeTrust?: (root: string) => Promise<AuthoritativeTrustObservationV2> } = {}
): Promise<void> {
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  const freeze = validateReleaseFreezeIdentityV2(readCanonicalJson(
    root, "release-freeze-identity-v2.json", "release_freeze_identity"));
  assertArtifactRootFingerprintBinding(root, freeze);
  const task0bBytes = readStableFile(safeArtifactPath(root, "task0b-release-freeze.json"));
  const task0b = validateTask0BReleaseFreezeEvidence(JSON.parse(task0bBytes.toString("utf8")), freeze.candidateSha);
  if (!canonicalBytesV2(task0b).equals(task0bBytes)
      || task0b.artifactRoot.rootFingerprintSha256 !== freeze.artifactRootFingerprintSha256) {
    throw new Error("g00_task0b_freeze_binding_invalid");
  }
  const policyBytes = readStableFile(safeArtifactPath(root, "trusted-os-principal-policy-v2.json"));
  const boundaryBytes = readStableFile(safeArtifactPath(root, "artifact-root-trust-boundary-evidence-v1.json"));
  const policy = record(JSON.parse(policyBytes.toString("utf8")), "g00_trusted_principal_policy");
  const boundary = record(JSON.parse(boundaryBytes.toString("utf8")), "g00_trust_boundary");
  if (!canonicalBytesV2(policy).equals(policyBytes) || !canonicalBytesV2(boundary).equals(boundaryBytes)
      || typeof policy.observedAt !== "string" || !ISO.test(policy.observedAt)
      || boundary.observedAt !== policy.observedAt) {
    throw new Error("g00_trust_artifact_canonical_binding_invalid");
  }
  const observed = await (dependencies.observeAuthoritativeTrust ?? observeAuthoritativeTrust)(root);
  if (observed.ownerIdentityFingerprintSha256 !== task0b.artifactRoot.ownerIdentityFingerprintSha256
      || observed.accessControlFingerprintSha256 !== task0b.artifactRoot.accessControlFingerprintSha256) {
    throw new Error("g00_authoritative_trust_observation_changed");
  }
  const releaseFreezeIdentitySha256 = releaseFreezeIdentitySha256V2(freeze);
  const task0BPreflightEvidenceSha256 = createHash("sha256").update(task0bBytes).digest("hex");
  const expectedPolicy = {
    ...normalizeTrustedPrincipalPolicyV2({ platform: observed.platform, principals: observed.principals }),
    candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256,
    task0BPreflightEvidenceSha256,
    ownerIdentityFingerprintSha256: observed.ownerIdentityFingerprintSha256,
    accessControlFingerprintSha256: observed.accessControlFingerprintSha256,
    authoritativePolicySource: "task0b_allowlisted_writer_principals_v2",
    observedAt: policy.observedAt,
    source: "task0b_acl_policy_read_only",
    verified: true
  } as const;
  const expectedPolicyBytes = canonicalBytesV2(expectedPolicy);
  const expectedBoundary = {
    version: "artifact-root-trust-boundary-evidence-v1",
    candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256,
    task0BPreflightEvidenceSha256,
    artifactRootObservationSha256: createHash("sha256")
      .update(canonicalBytesV2(task0b.artifactRoot)).digest("hex"),
    trustedOsPrincipalPolicySha256: createHash("sha256").update(expectedPolicyBytes).digest("hex"),
    ownerIdentityFingerprintSha256: observed.ownerIdentityFingerprintSha256,
    accessControlFingerprintSha256: observed.accessControlFingerprintSha256,
    accessControlSource: task0b.artifactRoot.accessControlSource,
    outsideRepository: task0b.artifactRoot.outsideRepository,
    noSymlink: task0b.artifactRoot.noSymlink,
    restrictiveAccessVerified: task0b.artifactRoot.restrictiveAccessVerified,
    exclusiveWriteVerified: task0b.artifactRoot.exclusiveWriteVerified,
    observedAt: policy.observedAt,
    source: "task0b_protected_root_acl_read_only",
    verified: true
  } as const;
  if (!expectedPolicyBytes.equals(policyBytes) || !canonicalBytesV2(expectedBoundary).equals(boundaryBytes)
      || expectedBoundary.artifactRootObservationSha256 !== freeze.artifactRootTrustBoundaryEvidenceSha256) {
    throw new Error("g00_authoritative_trust_policy_binding_invalid");
  }
}

export async function promoteG07SchemaEvidence(
  input: {
    artifactRoot: string;
    cleanSequenceRoot?: string;
    productionCloneSequenceRoot?: string;
    cwd?: string;
  }
): Promise<{ cleanSha256: string; productionCloneSha256: string }> {
  const cwd = input.cwd ?? process.cwd();
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  assertArtifactRootOutsideRepository(root, cwd);
  const cleanSequenceRoot = assertSafeArtifactRootPath(
    input.cleanSequenceRoot ?? process.env.PLAN5_SCHEMA_CLEAN_SEQUENCE_ROOT ?? "");
  const cloneSequenceRoot = assertSafeArtifactRootPath(
    input.productionCloneSequenceRoot ?? process.env.PLAN5_SCHEMA_CLONE_SEQUENCE_ROOT ?? "");
  assertArtifactRootOutsideRepository(cleanSequenceRoot, cwd);
  assertArtifactRootOutsideRepository(cloneSequenceRoot, cwd);
  if (new Set([root.toLowerCase(), cleanSequenceRoot.toLowerCase(), cloneSequenceRoot.toLowerCase()]).size !== 3) {
    throw new Error("g07_sequence_root_identity_invalid");
  }
  const freeze = validateReleaseFreezeIdentityV2(readCanonicalJson(
    root, "release-freeze-identity-v2.json", "release_freeze_identity"));
  assertArtifactRootFingerprintBinding(root, freeze);
  await assertCleanCandidateBinding(cwd, freeze.candidateSha);
  const cleanBytes = readStableFile(safeArtifactPath(cleanSequenceRoot, "schema032-release-evidence.json"));
  const cloneBytes = readStableFile(safeArtifactPath(cloneSequenceRoot, "schema032-release-evidence.json"));
  for (const [label, bytes] of [["clean", cleanBytes], ["production_clone", cloneBytes]] as const) {
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); }
    catch { throw new Error(`g07_${label}_json_invalid`); }
    if (!canonicalBytesV2(value).equals(bytes)) throw new Error(`g07_${label}_canonical_bytes_invalid`);
  }
  validateOfflineSchemaArtifactSet(freeze.candidateSha, cleanBytes, cloneBytes);
  const cleanRelative = "schema-clean/schema032-release-evidence.json";
  const cloneRelative = "schema-production-clone/schema032-release-evidence.json";
  if (existsSync(resolve(root, cleanRelative)) || existsSync(resolve(root, cloneRelative))) {
    throw new Error("g07_canonical_destination_already_exists");
  }
  const cleanDestination = safeArtifactRelativePath(root, cleanRelative, {
    createParents: true, allowedDirectories: ["schema-clean"]
  });
  const cloneDestination = safeArtifactRelativePath(root, cloneRelative, {
    createParents: true, allowedDirectories: ["schema-production-clone"]
  });
  writeExclusiveDurable(cleanDestination, cleanBytes);
  writeExclusiveDurable(cloneDestination, cloneBytes);
  if (!readStableFile(cleanDestination).equals(cleanBytes)
      || !readStableFile(cloneDestination).equals(cloneBytes)) {
    throw new Error("g07_promoted_bytes_mismatch");
  }
  return {
    cleanSha256: createHash("sha256").update(cleanBytes).digest("hex"),
    productionCloneSha256: createHash("sha256").update(cloneBytes).digest("hex")
  };
}

const TASK8B_RELEASE_TEST_FILES = Object.freeze([
  "tests/release/releaseManifestLifecycle.acceptance.test.ts",
  "tests/release/releaseManifestStore.acceptance.test.ts",
  "tests/release/productionReleaseEvidence.acceptance.test.ts",
  "tests/release/productionReleaseEvidence.postgres.test.ts"
] as const);
const TASK8B_POSTGRES_FULL_NAME = "[REQ-38][TASK8B-PG-RED] runs the frozen PostgreSQL RED case on an exact disposable non-production database with required execution report hash and cleanup";
const TASK8B_TEST_PATCH_BASE_SHA = "8bdc92350608c0c149d1b6f8e96c2f863fd531d5";
const TASK8B_FROZEN_TEST_SHA = "9f9f5310fbe894c2feb0e49305bccdc00f4d70a7";
const TASK8B_RED_EXECUTION_SHA = TASK8B_TEST_PATCH_BASE_SHA;
const TASK8B_OWNER_COMMIT_SHA = "d289021d2280539fa994e00916f36326a408fa9b";
const TASK8B_TEST_PATCH_SHA256 = "accc3a077979ef57c65f5bc637a452659d9ce42c1b434a0423a3365c4bce6559";
const TASK8B_HISTORICAL_RED_REPORT_SHA256 = "250c6876425fe24cc9345eb1dac2f0e592ffaee97cdea8ddad1a018820eec32f";
const TASK8B_HISTORICAL_RED_RECEIPT_SHA256 = "9f6d14e8873140894cea99a08f6720a287006db64442e120aabb0bde4fb06175";
const TASK8B_DATABASE_NAME = "tron_watch_plan5_task8b_red" as const;
const TASK8B_PATCH_FILES = Object.freeze([
  "tests/fixtures/release/remediationReleaseFixtures.ts",
  ...TASK8B_RELEASE_TEST_FILES
] as const);

type Task8BHistoricalCaptureV2 = {
  frozenTestSha: string;
  redExecutionSha: string;
  ownerCommitSha: string;
  testPatchBaseSha: string;
  testPatchBytes: Buffer;
  redReportBytes: Buffer;
  historicalReceiptBytes: Buffer;
  greenReportBytes: Buffer;
  redDatabaseName: "tron_watch_plan5_task8b_red";
  greenDatabaseName: "tron_watch_plan5_task8b_red";
  redDatabasePort: number;
  greenDatabasePort: number;
  redCleanupDatabaseCount: 0;
  greenCleanupDatabaseCount: 0;
};

function parseTask8BReportBytes(bytes: Buffer, expected: "failed" | "passed") {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`task8b_${expected}_report_json_invalid`); }
  const executions = parseVitestJsonReport(value, expected);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`task8b_${expected}_report_invalid`);
  }
  const report = value as Record<string, unknown>;
  if (!Array.isArray(report.testResults) || report.testResults.length !== TASK8B_RELEASE_TEST_FILES.length
      || report.numPendingTests !== 0 || report.numTodoTests !== 0) {
    throw new Error(`task8b_${expected}_report_counts_invalid`);
  }
  const files = report.testResults.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)
        || typeof (item as Record<string, unknown>).name !== "string"
        || typeof (item as Record<string, unknown>).message !== "string"
        || String((item as Record<string, unknown>).message).trim() !== "") {
      throw new Error(`task8b_${expected}_suite_failure_invalid`);
    }
    return normalizeAcceptanceTestFile(String((item as Record<string, unknown>).name));
  });
  if ([...files].sort().join("|") !== [...TASK8B_RELEASE_TEST_FILES].sort().join("|")) {
    throw new Error(`task8b_${expected}_file_set_invalid`);
  }
  const keys = executions.map((execution) => `${execution.testFile}\0${execution.fullName}`);
  if (new Set(keys).size !== keys.length) throw new Error(`task8b_${expected}_execution_duplicate`);
  if (expected === "failed") {
    const failures = executions.filter((execution) => execution.status === "failed");
    if (failures.length === 0 || failures.length !== executions.length) {
      throw new Error("task8b_historical_red_execution_set_invalid");
    }
    for (const execution of failures) {
      try { assertBehavioralRedExecution(execution); }
      catch { throw new Error("task8b_historical_red_unclassified"); }
      if (execution.failureMessages.length !== 1
          || !/^(?:AssertionError|Error): Plan 5 feature missing:/u.test(execution.failureMessages[0]!)) {
        throw new Error("task8b_historical_red_unclassified");
      }
    }
    const postgres = executions.filter((execution) => execution.testFile === TASK8B_RELEASE_TEST_FILES[3]
      && execution.fullName === TASK8B_POSTGRES_FULL_NAME);
    if (postgres.length !== 1 || postgres[0]!.status !== "failed") {
      throw new Error("task8b_historical_postgres_red_invalid");
    }
  } else if (executions.some((execution) => execution.status !== "passed")) {
    throw new Error("task8b_candidate_green_not_green");
  }
  return { value, executions, keys: [...keys].sort() };
}

function parseTask8BHistoricalReceipt(
  bytes: Buffer,
  expected: { reportSha256: string; redExecutionSha: string; executionCount: number }
): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/u, "")); }
  catch { throw new Error("task8b_historical_cleanup_receipt_json_invalid"); }
  const receipt = record(value, "task8b_historical_cleanup_receipt");
  exactKeys(receipt, ["version", "candidateSha", "databaseName", "databaseHost", "databasePort",
    "toolProvider", "toolIdentitySha256", "requirePlan5Postgres", "postgresAssertionsExecuted",
    "totalAssertionsExecuted", "skippedPostgresAssertions", "vitestReportSha256", "cleanupDatabaseCount"],
  "task8b_historical_cleanup_receipt");
  if (receipt.version !== "task8b-red-evidence-v1" || receipt.candidateSha !== expected.redExecutionSha
      || receipt.databaseName !== TASK8B_DATABASE_NAME || receipt.databaseHost !== "127.0.0.1"
      || !Number.isSafeInteger(receipt.databasePort) || Number(receipt.databasePort) <= 0
      || Number(receipt.databasePort) === 55_999 || receipt.toolProvider !== "docker-exec"
      || typeof receipt.toolIdentitySha256 !== "string" || !SHA256.test(receipt.toolIdentitySha256)
      || receipt.requirePlan5Postgres !== true || receipt.postgresAssertionsExecuted !== 1
      || receipt.totalAssertionsExecuted !== expected.executionCount || receipt.skippedPostgresAssertions !== 0
      || receipt.vitestReportSha256 !== expected.reportSha256 || receipt.cleanupDatabaseCount !== 0) {
    throw new Error("task8b_historical_cleanup_receipt_invalid");
  }
  return receipt;
}

export function validateTask8BHistoricalRedEvidenceV2(
  value: unknown,
  inputs: {
    candidateSha: string;
    redReportBytes: Buffer;
    historicalReceiptBytes: Buffer;
    greenReportBytes: Buffer;
    testPatchBytes: Buffer;
    historicalContract?: { redReportSha256: string; cleanupReceiptSha256: string };
  }
) {
  const evidence = record(value, "task8b_historical_red");
  exactKeys(evidence, [
    "version", "candidateSha", "releaseGenerationId", "artifactRootFingerprintSha256",
    "releaseFreezeIdentitySha256", "frozenTestSha", "redExecutionSha", "ownerCommitSha",
    "testPatch", "redReport", "historicalCleanupReceipt", "candidateGreenReport", "requiredTestFiles", "fullNames",
    "requiredPostgresFullName", "lineage", "cleanup", "finalCandidateWasRed", "source", "verified"
  ], "task8b_historical_red");
  if (evidence.version !== "task8b-historical-red-evidence-v2"
      || evidence.candidateSha !== inputs.candidateSha || evidence.finalCandidateWasRed !== false
      || evidence.frozenTestSha !== TASK8B_FROZEN_TEST_SHA
      || evidence.redExecutionSha !== TASK8B_RED_EXECUTION_SHA
      || evidence.ownerCommitSha !== TASK8B_OWNER_COMMIT_SHA
      || evidence.source !== "frozen_red_execution_and_exact_candidate_green"
      || evidence.verified !== true) throw new Error("task8b_historical_red_identity_invalid");
  for (const key of ["candidateSha", "frozenTestSha", "redExecutionSha", "ownerCommitSha"] as const) {
    if (typeof evidence[key] !== "string" || !SHA40.test(evidence[key] as string)) {
      throw new Error("task8b_historical_red_sha_invalid");
    }
  }
  if (evidence.candidateSha === evidence.redExecutionSha) {
    throw new Error("task8b_final_candidate_cannot_be_red_execution");
  }
  for (const key of ["artifactRootFingerprintSha256", "releaseFreezeIdentitySha256"] as const) {
    if (typeof evidence[key] !== "string" || !SHA256.test(evidence[key] as string)) {
      throw new Error("task8b_historical_binding_invalid");
    }
  }
  const patch = record(evidence.testPatch, "task8b_test_patch");
  exactKeys(patch, ["baseSha", "testSha", "relativePath", "sha256"], "task8b_test_patch");
  if (patch.testSha !== evidence.frozenTestSha || patch.baseSha !== TASK8B_TEST_PATCH_BASE_SHA
      || patch.relativePath !== "task8b-frozen-test.patch"
      || patch.sha256 !== TASK8B_TEST_PATCH_SHA256
      || patch.sha256 !== createHash("sha256").update(inputs.testPatchBytes).digest("hex")) {
    throw new Error("task8b_test_patch_binding_invalid");
  }
  const red = parseTask8BReportBytes(inputs.redReportBytes, "failed");
  const green = parseTask8BReportBytes(inputs.greenReportBytes, "passed");
  const historicalContract = inputs.historicalContract ?? {
    redReportSha256: TASK8B_HISTORICAL_RED_REPORT_SHA256,
    cleanupReceiptSha256: TASK8B_HISTORICAL_RED_RECEIPT_SHA256
  };
  if (!SHA256.test(historicalContract.redReportSha256)
      || !SHA256.test(historicalContract.cleanupReceiptSha256)
      || createHash("sha256").update(inputs.redReportBytes).digest("hex")
        !== historicalContract.redReportSha256
      || createHash("sha256").update(inputs.historicalReceiptBytes).digest("hex")
        !== historicalContract.cleanupReceiptSha256) {
    throw new Error("task8b_historical_source_hash_invalid");
  }
  const historicalReceipt = parseTask8BHistoricalReceipt(inputs.historicalReceiptBytes, {
    reportSha256: historicalContract.redReportSha256,
    redExecutionSha: TASK8B_RED_EXECUTION_SHA,
    executionCount: red.executions.length
  });
  const greenKeys = new Set(green.keys);
  if (red.keys.some((key) => !greenKeys.has(key))) {
    throw new Error("task8b_historical_full_name_not_green_on_candidate");
  }
  for (const [field, relativePath, bytes, executedAtSha] of [
    ["redReport", "task8b-historical-red.vitest.json", inputs.redReportBytes, evidence.redExecutionSha],
    ["candidateGreenReport", "task8b-candidate-green.vitest.json", inputs.greenReportBytes, evidence.candidateSha]
  ] as const) {
    const report = record(evidence[field], `task8b_${field}`);
    exactKeys(report, ["relativePath", "sha256", "executedAtSha", "executedTestCount"], `task8b_${field}`);
    if (report.relativePath !== relativePath || report.executedAtSha !== executedAtSha
        || report.sha256 !== createHash("sha256").update(bytes).digest("hex")
        || report.executedTestCount !== (field === "redReport" ? red.executions.length : green.executions.length)) {
      throw new Error(field === "redReport" ? "task8b_red_report_hash_invalid" : "task8b_green_report_hash_invalid");
    }
  }
  const receipt = record(evidence.historicalCleanupReceipt, "task8b_historical_cleanup_receipt_ref");
  exactKeys(receipt, ["relativePath", "sha256", "sourceVersion"], "task8b_historical_cleanup_receipt_ref");
  if (receipt.relativePath !== "task8b-historical-red-cleanup-receipt-v1.json"
      || receipt.sha256 !== historicalContract.cleanupReceiptSha256
      || receipt.sourceVersion !== "task8b-red-evidence-v1") {
    throw new Error("task8b_historical_cleanup_receipt_binding_invalid");
  }
  if (!Array.isArray(evidence.requiredTestFiles)
      || evidence.requiredTestFiles.join("|") !== TASK8B_RELEASE_TEST_FILES.join("|")
      || !Array.isArray(evidence.fullNames) || evidence.fullNames.join("|")
        !== red.executions.map((execution) => execution.fullName).sort().join("|")
      || evidence.requiredPostgresFullName !== TASK8B_POSTGRES_FULL_NAME) {
    throw new Error("task8b_historical_test_identity_invalid");
  }
  const lineage = record(evidence.lineage, "task8b_lineage");
  exactKeys(lineage, ["redExecutionToFrozenTest", "frozenTestToOwner", "ownerToCandidate"], "task8b_lineage");
  if (Object.values(lineage).some((item) => item !== true)) throw new Error("task8b_lineage_invalid");
  const cleanup = record(evidence.cleanup, "task8b_cleanup");
  exactKeys(cleanup, [
    "databaseHostClass", "historicalRedDatabasePort", "candidateGreenDatabasePort",
    "redDatabaseName", "candidateGreenDatabaseName",
    "requirePlan5Postgres", "redDatabaseCount", "candidateGreenDatabaseCount"
  ], "task8b_cleanup");
  if (cleanup.databaseHostClass !== "loopback" || !Number.isSafeInteger(cleanup.historicalRedDatabasePort)
      || Number(cleanup.historicalRedDatabasePort) !== Number(historicalReceipt.databasePort)
      || !Number.isSafeInteger(cleanup.candidateGreenDatabasePort)
      || Number(cleanup.candidateGreenDatabasePort) <= 0 || cleanup.candidateGreenDatabasePort === 55999
      || cleanup.redDatabaseName !== "tron_watch_plan5_task8b_red"
      || cleanup.candidateGreenDatabaseName !== "tron_watch_plan5_task8b_red"
      || cleanup.requirePlan5Postgres !== true || cleanup.redDatabaseCount !== 0
      || cleanup.candidateGreenDatabaseCount !== 0) throw new Error("task8b_cleanup_invalid");
  return evidence;
}

function task8bAdminDatabaseUrl(): URL {
  const raw = process.env.PLAN5_TASK0B_TEST_DATABASE_URL;
  if (!raw) throw new Error("task8b_disposable_admin_database_url_missing");
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error("task8b_disposable_admin_database_url_invalid"); }
  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:")
      || url.hostname !== "127.0.0.1" || !url.port || Number(url.port) <= 0
      || Number(url.port) === 55_999 || decodeURIComponent(url.pathname.slice(1)) !== "tron_watch"
      || url.search.length !== 0 || url.hash.length !== 0) {
    throw new Error("task8b_disposable_admin_database_url_invalid");
  }
  return url;
}

function task8bChildEnvironment(databaseUrl: string, executionRoot: string): NodeJS.ProcessEnv {
  const result = buildReleaseSuiteEnvironment(process.env);
  for (const key of Object.keys(result)) {
    if (key.endsWith("DATABASE_URL") || key.startsWith("REQUIRE_PLAN")) delete result[key];
  }
  result.CI = "1";
  result.REQUIRE_PLAN5_POSTGRES = "1";
  result.TEST_DATABASE_URL = databaseUrl;
  result.DOTENV_CONFIG_PATH = resolve(executionRoot, "tests/fixtures/release/plan5-no-dotenv");
  return result;
}

async function requireTask8BProcess(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  cwd: string,
  label: string
): Promise<void> {
  const result = await runBoundedReleaseProcess(executable, args, env, timeoutMs, cwd);
  if (result.error || result.signal || result.status !== 0) throw new Error(`${label}_failed`);
}

async function createTask8BSnapshot(
  cwd: string,
  commitSha: string
): Promise<{ root: string; controlRoot: string }> {
  const controlRoot = await mkdtemp(join(tmpdir(), "plan5-task8b-historical-"));
  const root = join(controlRoot, "worktree");
  const env = task8bChildEnvironment("postgresql://127.0.0.1:1/unused", root);
  try {
    await requireTask8BProcess("git", ["clone", "--no-checkout", "--local", "--no-hardlinks", cwd, root],
      env, 10 * 60_000, cwd, "task8b_snapshot_clone");
    await requireTask8BProcess("git", ["checkout", "--detach", commitSha], env,
      5 * 60_000, root, "task8b_snapshot_checkout");
    const npmExecutable = process.platform === "win32" ? process.execPath : "npm";
    const npmArgs = process.platform === "win32"
      ? [resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")]
      : [];
    await requireTask8BProcess(npmExecutable, [...npmArgs, "ci", "--no-audit", "--no-fund"], env,
      30 * 60_000, root, "task8b_snapshot_npm_ci");
    return { root, controlRoot };
  } catch (error) {
    await rm(controlRoot, { recursive: true, force: true });
    throw error;
  }
}

async function executeTask8BTests(
  cwd: string,
  commitSha: string,
  databaseUrl: string,
  expectedExit: "failed" | "passed"
): Promise<Buffer> {
  const snapshot = await createTask8BSnapshot(cwd, commitSha);
  const reportPath = join(snapshot.controlRoot, `task8b-${expectedExit}.vitest.json`);
  try {
    const env = task8bChildEnvironment(databaseUrl, snapshot.root);
    const result = await runBoundedReleaseProcess(process.execPath, [
      resolve(snapshot.root, "node_modules/vitest/vitest.mjs"), "run", "--configLoader", "bundle",
      "--no-file-parallelism", "--testTimeout=300000", "--hookTimeout=300000",
      ...TASK8B_RELEASE_TEST_FILES, "--reporter=json", `--outputFile=${reportPath}`
    ], env, 60 * 60_000, snapshot.root);
    if (result.error || result.signal || result.status === null
        || (expectedExit === "failed" ? result.status === 0 : result.status !== 0)) {
      throw new Error(`task8b_${expectedExit}_execution_exit_invalid`);
    }
    return readStableFile(reportPath);
  } finally {
    await rm(snapshot.controlRoot, { recursive: true, force: true });
  }
}

async function defaultTask8BCapture(cwd: string, candidateSha: string): Promise<Task8BHistoricalCaptureV2> {
  const historicalReportPath = process.env.PLAN5_TASK8B_HISTORICAL_RED_REPORT;
  const historicalReceiptPath = process.env.PLAN5_TASK8B_HISTORICAL_RED_RECEIPT;
  if (!historicalReportPath || !historicalReceiptPath
      || !isAbsolute(historicalReportPath) || !isAbsolute(historicalReceiptPath)) {
    throw new Error("task8b_historical_source_paths_missing");
  }
  const redReportBytes = readStableFile(resolve(historicalReportPath));
  const historicalReceiptBytes = readStableFile(resolve(historicalReceiptPath));
  if (createHash("sha256").update(redReportBytes).digest("hex") !== TASK8B_HISTORICAL_RED_REPORT_SHA256
      || createHash("sha256").update(historicalReceiptBytes).digest("hex")
        !== TASK8B_HISTORICAL_RED_RECEIPT_SHA256) {
    throw new Error("task8b_historical_source_hash_invalid");
  }
  const red = parseTask8BReportBytes(redReportBytes, "failed");
  const historicalReceipt = parseTask8BHistoricalReceipt(historicalReceiptBytes, {
    reportSha256: TASK8B_HISTORICAL_RED_REPORT_SHA256,
    redExecutionSha: TASK8B_RED_EXECUTION_SHA,
    executionCount: red.executions.length
  });
  const adminUrl = task8bAdminDatabaseUrl();
  const databaseUrl = new URL(adminUrl.href);
  databaseUrl.pathname = `/${TASK8B_DATABASE_NAME}`;
  const admin = new pg.Client({ connectionString: adminUrl.href });
  const databaseName = TASK8B_DATABASE_NAME;
  const databaseIdentity = async (): Promise<{ count: number; oid: string | null }> => {
    const result = await admin.query<{ oid: string }>(
      "select oid::text as oid from pg_database where datname = $1", [databaseName]);
    return { count: result.rows.length, oid: result.rows[0]?.oid ?? null };
  };
  const createDatabase = async (): Promise<string> => {
    if ((await databaseIdentity()).count !== 0) throw new Error("task8b_disposable_database_already_exists");
    await admin.query(`create database "${databaseName}" template template0 encoding 'UTF8'`);
    const created = await databaseIdentity();
    if (created.count !== 1 || created.oid === null) throw new Error("task8b_disposable_database_create_unverified");
    return created.oid;
  };
  const cleanupDatabase = async (expectedOid: string): Promise<0> => {
    const current = await databaseIdentity();
    if (current.count !== 1 || current.oid !== expectedOid) {
      throw new Error("task8b_disposable_database_cleanup_identity_changed");
    }
    await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [databaseName]);
    await admin.query(`drop database if exists "${databaseName}"`);
    if ((await databaseIdentity()).count !== 0) throw new Error("task8b_disposable_database_cleanup_failed");
    return 0;
  };
  let greenReportBytes: Buffer;
  let greenCleanupDatabaseCount: 0 = 0;
  let greenDatabaseCreated = false;
  let greenDatabaseOid = "";
  await admin.connect();
  try {
    const identity = await admin.query<{ database_name: string }>("select current_database()::text as database_name");
    if (identity.rows.length !== 1 || identity.rows[0]?.database_name !== "tron_watch") {
      throw new Error("task8b_disposable_admin_database_identity_invalid");
    }
    try {
      greenDatabaseOid = await createDatabase();
      greenDatabaseCreated = true;
      greenReportBytes = await executeTask8BTests(cwd, candidateSha, databaseUrl.href, "passed");
    } finally {
      if (greenDatabaseCreated) greenCleanupDatabaseCount = await cleanupDatabase(greenDatabaseOid);
    }
    parseTask8BReportBytes(greenReportBytes!, "passed");
  } finally {
    await admin.end();
  }
  const patch = await runBoundedReleaseProcess("git", ["diff", "--binary", TASK8B_TEST_PATCH_BASE_SHA,
    TASK8B_FROZEN_TEST_SHA, "--", ...TASK8B_PATCH_FILES], task8bChildEnvironment(databaseUrl.href, cwd),
  60_000, cwd);
  if (patch.error || patch.signal || patch.status !== 0) throw new Error("task8b_test_patch_capture_failed");
  const testPatchBytes = Buffer.from(patch.stdout, "utf8");
  if (createHash("sha256").update(testPatchBytes).digest("hex") !== TASK8B_TEST_PATCH_SHA256) {
    throw new Error("task8b_test_patch_identity_invalid");
  }
  return {
    frozenTestSha: TASK8B_FROZEN_TEST_SHA,
    redExecutionSha: TASK8B_RED_EXECUTION_SHA,
    ownerCommitSha: TASK8B_OWNER_COMMIT_SHA,
    testPatchBaseSha: TASK8B_TEST_PATCH_BASE_SHA,
    testPatchBytes,
    redReportBytes,
    historicalReceiptBytes,
    greenReportBytes: greenReportBytes!,
    redDatabaseName: databaseName,
    greenDatabaseName: databaseName,
    redDatabasePort: Number(historicalReceipt.databasePort),
    greenDatabasePort: Number(adminUrl.port),
    redCleanupDatabaseCount: 0,
    greenCleanupDatabaseCount
  };
}

export async function publishTask8BHistoricalRedEvidence(
  input: { artifactRoot: string; cwd?: string },
  dependencies: {
    capture?: () => Promise<Task8BHistoricalCaptureV2>;
    isAncestor?: (ancestor: string, descendant: string) => Promise<boolean>;
    historicalContract?: { redReportSha256: string; cleanupReceiptSha256: string };
  } = {}
) {
  if (Object.keys(dependencies).length > 0 && process.env.NODE_ENV !== "test") {
    throw new Error("task8b_test_dependency_injection_forbidden");
  }
  const cwd = input.cwd ?? process.cwd();
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  assertArtifactRootOutsideRepository(root, cwd);
  const names = [
    "task8b-historical-red.vitest.json", "task8b-candidate-green.vitest.json",
    "task8b-frozen-test.patch", "task8b-historical-red-cleanup-receipt-v1.json",
    "task8b-historical-red-evidence-v2.json"
  ];
  if (names.some((name) => existsSync(safeArtifactPath(root, name)))) {
    throw new Error("task8b_historical_artifact_already_exists");
  }
  const freeze = validateReleaseFreezeIdentityV2(readCanonicalJson(
    root, "release-freeze-identity-v2.json", "release_freeze_identity"));
  assertArtifactRootFingerprintBinding(root, freeze);
  await assertCleanCandidateBinding(cwd, freeze.candidateSha);
  const captured = await (dependencies.capture ?? (() => defaultTask8BCapture(cwd, freeze.candidateSha)))();
  const isAncestor = dependencies.isAncestor ?? (async (ancestor: string, descendant: string) => {
    try {
      await execFileAsync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd });
      return true;
    } catch { return false; }
  });
  const lineage = {
    redExecutionToFrozenTest: await isAncestor(captured.redExecutionSha, captured.frozenTestSha),
    frozenTestToOwner: await isAncestor(captured.frozenTestSha, captured.ownerCommitSha),
    ownerToCandidate: await isAncestor(captured.ownerCommitSha, freeze.candidateSha)
  };
  if (Object.values(lineage).some((item) => item !== true)) throw new Error("task8b_lineage_invalid");
  const evidence = {
    version: "task8b-historical-red-evidence-v2",
    candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
    frozenTestSha: captured.frozenTestSha,
    redExecutionSha: captured.redExecutionSha,
    ownerCommitSha: captured.ownerCommitSha,
    testPatch: { baseSha: captured.testPatchBaseSha, testSha: captured.frozenTestSha,
      relativePath: "task8b-frozen-test.patch",
      sha256: createHash("sha256").update(captured.testPatchBytes).digest("hex") },
    redReport: { relativePath: "task8b-historical-red.vitest.json",
      sha256: createHash("sha256").update(captured.redReportBytes).digest("hex"),
      executedAtSha: captured.redExecutionSha,
      executedTestCount: parseTask8BReportBytes(captured.redReportBytes, "failed").executions.length },
    historicalCleanupReceipt: {
      relativePath: "task8b-historical-red-cleanup-receipt-v1.json",
      sha256: createHash("sha256").update(captured.historicalReceiptBytes).digest("hex"),
      sourceVersion: "task8b-red-evidence-v1"
    },
    candidateGreenReport: { relativePath: "task8b-candidate-green.vitest.json",
      sha256: createHash("sha256").update(captured.greenReportBytes).digest("hex"),
      executedAtSha: freeze.candidateSha,
      executedTestCount: parseTask8BReportBytes(captured.greenReportBytes, "passed").executions.length },
    requiredTestFiles: [...TASK8B_RELEASE_TEST_FILES],
    fullNames: parseTask8BReportBytes(captured.redReportBytes, "failed")
      .executions.map((execution) => execution.fullName).sort(),
    requiredPostgresFullName: TASK8B_POSTGRES_FULL_NAME,
    lineage,
    cleanup: { databaseHostClass: "loopback",
      historicalRedDatabasePort: captured.redDatabasePort,
      candidateGreenDatabasePort: captured.greenDatabasePort,
      redDatabaseName: captured.redDatabaseName, candidateGreenDatabaseName: captured.greenDatabaseName,
      requirePlan5Postgres: true, redDatabaseCount: captured.redCleanupDatabaseCount,
      candidateGreenDatabaseCount: captured.greenCleanupDatabaseCount },
    finalCandidateWasRed: false,
    source: "frozen_red_execution_and_exact_candidate_green",
    verified: true
  } as const;
  validateTask8BHistoricalRedEvidenceV2(evidence, { candidateSha: freeze.candidateSha,
    redReportBytes: captured.redReportBytes, historicalReceiptBytes: captured.historicalReceiptBytes,
    greenReportBytes: captured.greenReportBytes, testPatchBytes: captured.testPatchBytes,
    historicalContract: dependencies.historicalContract });
  writeExclusiveDurable(safeArtifactPath(root, "task8b-historical-red.vitest.json"), captured.redReportBytes);
  writeExclusiveDurable(safeArtifactPath(root, "task8b-historical-red-cleanup-receipt-v1.json"),
    captured.historicalReceiptBytes);
  writeExclusiveDurable(safeArtifactPath(root, "task8b-candidate-green.vitest.json"), captured.greenReportBytes);
  writeExclusiveDurable(safeArtifactPath(root, "task8b-frozen-test.patch"), captured.testPatchBytes);
  writeExclusiveDurable(safeArtifactPath(root, "task8b-historical-red-evidence-v2.json"), canonicalBytesV2(evidence));
  return evidence;
}

const GATE_EVIDENCE_KIND_BY_PATH = Object.freeze({
  "task0-baseline.json": "task0_baseline",
  "trusted-os-principal-policy-v2.json": "trusted_os_principal_policy",
  "artifact-root-trust-boundary-evidence-v1.json": "release_freeze_materialization",
  "release-freeze-materialization-receipt-v2.json": "release_freeze_materialization",
  "release-freeze-identity-v2.json": "release_freeze_materialization",
  "acceptance-trace.json": "acceptance_trace",
  "task8b-historical-red-evidence-v2.json": "task8b_red",
  "suite-plan4.vitest.json": "suite_report",
  "suite-plan4.evidence.json": "suite_evidence",
  "suite-plan1.vitest.json": "suite_report",
  "suite-plan1.evidence.json": "suite_evidence",
  "suite-plan2.vitest.json": "suite_report",
  "suite-plan2.evidence.json": "suite_evidence",
  "suite-plan3.vitest.json": "suite_report",
  "suite-plan3.evidence.json": "suite_evidence",
  "manual-telegram-acceptance.json": "manual_telegram_acceptance",
  "full-regression-evidence.json": "full_regression",
  "suite-plan5.vitest.json": "suite_report",
  "suite-plan5.evidence.json": "suite_evidence",
  "schema-clean/schema032-release-evidence.json": "schema_clean",
  "schema-production-clone/schema032-release-evidence.json": "schema_production_clone",
  "runtime-rehearsal.json": "runtime_rehearsal",
  "schema-runtime-sanitized-evidence.json": "schema_runtime_sanitized",
  "terminal-legacy-population.json": "terminal_legacy_population",
  "rollback-rehearsal.json": "rollback_rehearsal",
  "suite-addressPoisoningRegression.vitest.json": "suite_report",
  "suite-addressPoisoningRegression.evidence.json": "suite_evidence"
} as const);

function schemaVersionForEvidence(bytes: Buffer, kind: string): string {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("manifest_input_evidence_json_invalid"); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("manifest_input_evidence_object_invalid");
  }
  const object = value as Record<string, unknown>;
  if (typeof object.version === "string" && object.version.length > 0) return object.version;
  if (typeof object.schemaVersion === "string" && object.schemaVersion.length > 0) return object.schemaVersion;
  return kind === "suite_report" ? "vitest-json-report-v1" : `${kind.replaceAll("_", "-")}-v1`;
}

async function collectVerifiedGateOutputsFromArtifacts(input: {
  transitionId: "pre_manual" | "readiness";
  root: string;
  freeze: ReturnType<typeof validateReleaseFreezeIdentityV2>;
  evaluatedAt: string;
  task0bBinding: ReturnType<typeof deriveTask0BProductionGateBindingV2>;
  sourceManifestSha256: string | null;
}): Promise<ReleaseGateV2[]> {
  const gateIds = input.transitionId === "pre_manual"
    ? REMEDIATION_PRE_RELEASE_GATE_IDS.filter((gateId) => gateId !== "G05_TELEGRAM")
    : ["G05_TELEGRAM"] as const;
  const gates: ReleaseGateV2[] = [];
  for (const gateId of gateIds) {
    const policy = PRE_RELEASE_GATE_EVIDENCE_POLICY_V2[gateId];
    const relativePaths = [...policy.primaryPaths];
    if (gateId === "G08_VERSION_SANITIZED") relativePaths.push("schema-runtime-sanitized-evidence.json");
    const evidence = relativePaths.map((relativePath) => {
      const kind = GATE_EVIDENCE_KIND_BY_PATH[relativePath as keyof typeof GATE_EVIDENCE_KIND_BY_PATH];
      if (kind === undefined || !policy.allowedKinds.includes(kind)) {
        throw new Error(`manifest_input_evidence_producer_mapping_invalid:${relativePath}`);
      }
      const bytes = readStableFile(safeArtifactRelativePath(input.root, relativePath));
      return { kind, relativePath, sha256: createHash("sha256").update(bytes).digest("hex"),
        schemaVersion: schemaVersionForEvidence(bytes, kind), candidateSha: input.freeze.candidateSha };
    });
    const commandId = REMEDIATION_GATE_COMMAND_IDS[gateId];
    const gate = {
      id: gateId,
      candidateSha: input.freeze.candidateSha,
      state: "passed" as const,
      commandId,
      redactedTemplateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256[commandId],
      startedAt: input.evaluatedAt,
      finishedAt: input.evaluatedAt,
      exitCode: 0,
      outputSha256: createHash("sha256").update(canonicalBytesV2({
        version: "verified-gate-evidence-bundle-v2", gateId,
        candidateSha: input.freeze.candidateSha, evidence
      })).digest("hex"),
      evidence
    };
    const bytesByPath = new Map<string, GateEvidencePayloadV2>(evidence.map((ref) => [
      ref.relativePath,
      readStableGateEvidence(safeArtifactRelativePath(input.root, ref.relativePath), ref.kind)
    ]));
    validateGateEvidenceBytesV2(gate, bytesByPath, {
      releaseGenerationId: input.freeze.releaseGenerationId,
      artifactRootFingerprintSha256: input.freeze.artifactRootFingerprintSha256,
      artifactRootTrustBoundaryEvidenceSha256: input.freeze.artifactRootTrustBoundaryEvidenceSha256,
      releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(input.freeze),
      sourceManifestSha256: input.sourceManifestSha256 ?? undefined,
      ...input.task0bBinding
    });
    gates.push(gate);
  }
  return gates;
}

export async function prepareVerifiedManifestTransitionInput(
  input: {
    transitionId: "pre_manual" | "readiness";
    expectedSourceSha: string;
    artifactRoot: string;
    cwd?: string;
    evaluatedAt?: string;
  },
  dependencies: {
    collectVerifiedGateOutputs?: (input: {
      transitionId: "pre_manual" | "readiness";
      root: string;
      freeze: ReturnType<typeof validateReleaseFreezeIdentityV2>;
      evaluatedAt: string;
      task0bBinding: ReturnType<typeof deriveTask0BProductionGateBindingV2>;
      sourceManifestSha256: string | null;
    }) => Promise<ReleaseGateV2[]>;
    verifyConcrete?: (root: string, manifest: ReturnType<typeof validateRemediationReleaseManifestV2>) => Promise<void>;
  } = {}
): Promise<VerifiedManifestAdvanceInputV2> {
  if (Object.keys(dependencies).length > 0 && process.env.NODE_ENV !== "test") {
    throw new Error("verified_manifest_test_dependency_injection_forbidden");
  }
  if ((input.transitionId === "pre_manual" && input.expectedSourceSha !== "absent")
      || (input.transitionId === "readiness" && !SHA256.test(input.expectedSourceSha))) {
    throw new Error("manifest_input_prepare_arguments_invalid");
  }
  const cwd = input.cwd ?? process.cwd();
  const root = assertSafeArtifactRootPath(input.artifactRoot);
  assertArtifactRootOutsideRepository(root, cwd);
  const outputPath = safeArtifactPath(root,
    `verified-manifest-transition-input-${input.transitionId}.json`);
  if (existsSync(outputPath)) throw new Error("verified_manifest_input_already_exists");
  const freeze = validateReleaseFreezeIdentityV2(readCanonicalJson(
    root, "release-freeze-identity-v2.json", "release_freeze_identity"));
  assertArtifactRootFingerprintBinding(root, freeze);
  await assertCleanCandidateBinding(cwd, freeze.candidateSha);
  const manifestPath = safeArtifactPath(root, "release-manifest.json");
  const sourceBytes = existsSync(manifestPath) ? readStableFile(manifestPath) : null;
  const sourceSha = sourceBytes === null ? null : releaseSha256V2(sourceBytes);
  if (input.expectedSourceSha === "absent" ? sourceBytes !== null : sourceSha !== input.expectedSourceSha) {
    throw new Error("manifest_input_source_cas_conflict");
  }
  const sourceManifest = sourceBytes === null ? null
    : validateRemediationReleaseManifestV2(JSON.parse(sourceBytes.toString("utf8")));
  if (sourceManifest !== null && !canonicalBytesV2(sourceManifest).equals(sourceBytes!)) {
    throw new Error("manifest_input_source_noncanonical");
  }
  if (input.transitionId === "pre_manual") {
    if (sourceManifest !== null) throw new Error("pre_manual_requires_absent_source");
    if (existsSync(safeArtifactPath(root, "manual-telegram-acceptance.json"))) {
      throw new Error("pre_manual_future_manual_artifact_present");
    }
  } else if (sourceManifest?.revision !== 1 || sourceManifest.transitionId !== "pre_manual") {
    throw new Error("readiness_predecessor_lineage_invalid");
  }
  const task0bBinding = deriveTask0BProductionGateBindingV2(
    readStableFile(safeArtifactPath(root, "task0b-release-freeze.json")),
    freeze.candidateSha,
    freeze.productionDatabaseIdentityFingerprintSha256
  );
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  if (!ISO.test(evaluatedAt)) throw new Error("manifest_input_evaluated_at_invalid");
  const collect = dependencies.collectVerifiedGateOutputs ?? collectVerifiedGateOutputsFromArtifacts;
  const verifiedGateOutputs = await collect({ transitionId: input.transitionId, root, freeze,
    evaluatedAt, task0bBinding, sourceManifestSha256: sourceSha });
  verifiedGateOutputs.forEach((gate) => validateReleaseGateV2(gate));
  const provisional = input.transitionId === "pre_manual"
    ? createInitialRemediationReleaseManifestV2({ freezeIdentity: freeze, evaluatedAt,
      latestCommittedReceiptSha256: "0".repeat(64), verifiedGateOutputs })
    : reduceManifestTransition(sourceManifest, { transitionId: "readiness", evaluatedAt,
      latestCommittedReceiptSha256: "0".repeat(64), operationalAttestation: null },
    verifiedGateOutputs, { refs: [], actualRollbackOutcome: null });
  await (dependencies.verifyConcrete ?? verifyPreReleaseConcreteEvidenceV2)(root, provisional);
  if (sourceManifest !== null) {
    const verifiedHead = verifyCurrentReleaseManifestChainV2(root);
    if (verifiedHead.manifestSha256 !== sourceSha
        || verifiedHead.manifest.revision !== sourceManifest.revision) {
      throw new Error("manifest_input_source_lineage_changed");
    }
  }
  const prepared = validateVerifiedManifestAdvanceInputV2({
    version: "verified-manifest-transition-input-v2",
    transitionId: input.transitionId,
    candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
    sourceManifestSha256: sourceSha,
    sourceManifestRevision: sourceManifest?.revision ?? null,
    evaluatedAt,
    operationalAttestation: null,
    verifiedGateOutputs,
    verifiedTransitionEvidence: { refs: [], actualRollbackOutcome: null }
  }, input.transitionId);
  writeExclusiveDurable(outputPath, canonicalBytesV2(prepared));
  return prepared;
}

export async function runPrepareRemediationReleaseEvidence(args: string[]): Promise<unknown> {
  if (args.length < 2) throw new Error("usage: release:evidence:prepare <g00|task8b|g07|pre_manual|readiness> <artifact-root> [source-sha]");
  const [mode, artifactRoot, sourceSha] = args;
  if (mode === "g00") return publishG00TrustArtifacts({ artifactRoot });
  if (mode === "task8b") return publishTask8BHistoricalRedEvidence({ artifactRoot });
  if (mode === "g07") return promoteG07SchemaEvidence({ artifactRoot });
  if (mode === "pre_manual" && args.length === 2) return prepareVerifiedManifestTransitionInput({
    transitionId: "pre_manual", expectedSourceSha: "absent", artifactRoot
  });
  if (mode === "readiness" && args.length === 3 && sourceSha) return prepareVerifiedManifestTransitionInput({
    transitionId: "readiness", expectedSourceSha: sourceSha, artifactRoot
  });
  throw new Error("release_evidence_prepare_mode_invalid");
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
  dependencies: {
    cwd?: string;
    now?: () => string;
    stdout?: (line: string) => void;
    verifyConcrete?: (root: string, manifest: ReturnType<typeof validateRemediationReleaseManifestV2>) => Promise<void>;
  } = {}
) {
  if (dependencies.verifyConcrete !== undefined && process.env.NODE_ENV !== "test") {
    throw new Error("manifest_advance_test_verifier_injection_forbidden");
  }
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
  assertArtifactRootFingerprintBinding(root, freeze);
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
      artifactRootTrustBoundaryEvidenceSha256: freeze.artifactRootTrustBoundaryEvidenceSha256,
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
  const projected = transitionId === "pre_manual"
    ? createInitialRemediationReleaseManifestV2({
      freezeIdentity: freeze,
      evaluatedAt: verifiedInput.evaluatedAt,
      latestCommittedReceiptSha256: "0".repeat(64),
      verifiedGateOutputs: verifiedInput.verifiedGateOutputs
    })
    : sourceManifest === null ? null : reduceManifestTransition(sourceManifest, {
      transitionId,
      evaluatedAt: verifiedInput.evaluatedAt,
      latestCommittedReceiptSha256: "0".repeat(64),
      operationalAttestation: verifiedInput.operationalAttestation
    }, verifiedInput.verifiedGateOutputs, verifiedInput.verifiedTransitionEvidence);
  if (projected === null) throw new Error("verified_manifest_input_source_binding_invalid");
  if (transitionId === "pre_manual" || transitionId === "readiness") {
    await (dependencies.verifyConcrete ?? verifyPreReleaseConcreteEvidenceV2)(root, projected);
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
  const args = process.argv.slice(2);
  const command = args[0] === "--prepare"
    ? runPrepareRemediationReleaseEvidence(args.slice(1)).then(() => {
      console.log(JSON.stringify({ status: "passed", producer: args[1] }));
    })
    : runAdvanceRemediationReleaseManifest(args).then(() => undefined);
  command.catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
