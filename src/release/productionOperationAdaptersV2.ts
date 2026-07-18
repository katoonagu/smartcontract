import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  ProtectedProductionLeafInputV2,
  ProtectedProductionLeafResultV2,
  ProtectedProductionOperationAdaptersV2,
  ProtectedRollbackWindowV2
} from "./productionReleaseOrchestratorV2";
import {
  canonicalReleaseJsonV2,
  releaseSha256V2,
  validateProductionFailureEvidenceV2,
  validateRemediationReleaseManifestV2,
  validateSchema032ProductionExecutionReceiptV2,
  validateProductionOperationTerminalAbandonedV2,
  validateProductionOperationTerminalCleanupV2,
  validateProductionOrchestrationStepIntentV2,
  validateProductionOrchestrationStepReceiptV2,
  validateReleaseFreezeIdentityV2,
} from "./remediationReleaseManifestV2";
import {
  assertTrustedArtifactRootPathV2,
  canonicalBytesV2,
  safeArtifactPath,
  safeArtifactRelativePath
} from "./releaseRootWriterStore";
import { validateTask0BReleaseFreezeEvidence } from "./remediationReleaseManifest";
import { runtimeGenerationEvidencePath, validateTask0BProductionRuntimeAuthority } from "../../scripts/manageTask0BRuntime";
import { countTask0BRuntimeCandidates, observeWindowsRuntimeProcess } from "../../scripts/captureTask0BPreflight";

const execFileAsync = promisify(execFile);
const MAX_CAPTURE_BYTES = 1024 * 1024;
const RUNTIME_COMMAND: Readonly<Record<string, "runtime_manager_start_candidate" | "runtime_manager_stop_candidate"
  | "runtime_manager_stop_previous" | "runtime_manager_rollback_previous">> = Object.freeze({
  stop_previous: "runtime_manager_stop_previous",
  start_candidate: "runtime_manager_start_candidate",
  stop_candidate: "runtime_manager_stop_candidate",
  start_previous: "runtime_manager_rollback_previous",
  restart_previous: "runtime_manager_rollback_previous"
});

function hash(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readCanonical<T>(root: string, relativePath: string, validator: (value: unknown) => T): {
  value: T; bytes: Buffer; sha256: string;
} {
  const path = relativePath.includes("/")
    ? safeArtifactRelativePath(root, relativePath)
    : safeArtifactPath(root, relativePath);
  const bytes = readFileSync(path);
  if (bytes.length > MAX_CAPTURE_BYTES) throw new Error("production_capture_too_large");
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch (error) { throw new Error("production_capture_json_invalid", { cause: error }); }
  const value = validator(parsed);
  if (!bytes.equals(canonicalBytesV2(value))) throw new Error("production_capture_noncanonical");
  return { value, bytes, sha256: releaseSha256V2(bytes) };
}

function runtimeAuthorities(root: string, commandId: string, includeConsumed: boolean): Array<{
  filename: string; generationId: string; sha256: string;
}> {
  return readdirSync(root).filter((name) => /^runtime-authority-[A-Za-z0-9._-]+\.json$/u.test(name))
    .flatMap((filename) => {
      const bytes = readFileSync(safeArtifactPath(root, filename));
      let parsed: unknown;
      try { parsed = JSON.parse(bytes.toString("utf8")); }
      catch { throw new Error("production_runtime_authority_json_invalid"); }
      const issuedAt = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).issuedAt : undefined;
      const value = validateTask0BProductionRuntimeAuthority(parsed,
        includeConsumed && typeof issuedAt === "string" ? issuedAt : new Date().toISOString());
      if (!bytes.equals(canonicalBytesV2(value))) throw new Error("production_runtime_authority_noncanonical");
      const generationId = value.generationId;
      if (value.commandId !== commandId) return [];
      const consumed = existsSync(safeArtifactPath(root, `runtime-authority-consumed-${generationId}.json`));
      return includeConsumed === consumed ? [{ filename, generationId, sha256: hash(bytes) }] : [];
    });
}

function runtimeEffectIdentity(stepId: string, selected: { filename: string; generationId: string; sha256: string }): string {
  return releaseSha256V2(canonicalBytesV2({ version: "production-runtime-effect-identity-v2",
    stepId, authorityFilename: selected.filename, authoritySha256: selected.sha256,
    generationId: selected.generationId }));
}

async function runNodeScript(script: string, args: string[]): Promise<Buffer> {
  const result = await execFileAsync(process.execPath, ["--import", "tsx", resolve(process.cwd(), script), ...args], {
    cwd: process.cwd(), windowsHide: true, shell: false, maxBuffer: MAX_CAPTURE_BYTES,
    encoding: "buffer"
  });
  return Buffer.from(result.stdout);
}

async function verifyRoot(root: string): Promise<Buffer> {
  return runNodeScript("scripts/verifyRemediationRelease.ts", [root]);
}

function leafCapture(input: ProtectedProductionLeafInputV2, output: Buffer): ProtectedProductionLeafResultV2 {
  return { inputSha256: input.inputSha256, outputSha256: hash(output),
    observedStateSha256: hash(Buffer.from(canonicalReleaseJsonV2({ stepId: input.stepId,
      outputSha256: hash(output) }), "utf8")) };
}

function valueCapture(input: ProtectedProductionLeafInputV2, value: unknown): ProtectedProductionLeafResultV2 {
  return leafCapture(input, canonicalBytesV2(value));
}

function loadTask0B(root: string) {
  const bytes = readFileSync(safeArtifactPath(root, "task0b-release-freeze.json"));
  return validateTask0BReleaseFreezeEvidence(JSON.parse(bytes.toString("utf8")));
}

async function observeAdmin(root: string) {
  const task0b = loadTask0B(root);
  const base = new URL(task0b.runtimeManager.candidateAdminUrl);
  const admin = await fetch(base, { signal: AbortSignal.timeout(10_000) });
  if (admin.status !== 200) throw new Error("production_runtime_http_check_failed");
  const startEvidence = ["runtime_manager_start_candidate", "runtime_manager_rollback_previous"]
    .map((commandId) => actualRuntimeEvidence(root, commandId)).filter((value) => value !== null);
  let live: Awaited<ReturnType<typeof observeWindowsRuntimeProcess>> | null = null;
  for (const evidence of startEvidence) {
    const parsed = JSON.parse(evidence.bytes.toString("utf8")) as Record<string, unknown>;
    const processId = Number(parsed.processId);
    if (!Number.isSafeInteger(processId) || processId < 1) continue;
    try { live = await observeWindowsRuntimeProcess(processId); break; } catch { /* another issued start may be historical */ }
  }
  if (live === null) throw new Error("production_runtime_identity_unverified");
  if (live.runtimeSha !== task0b.candidateSha && live.runtimeSha !== task0b.previousRuntimeSha) {
    throw new Error("production_runtime_sha_unverified");
  }
  return { adminStatus: admin.status, runtimeSha: live.runtimeSha,
    runtimeLabelSha256: hash(live.runtimeLabel), runtimeProcessCount: await countTask0BRuntimeCandidates() };
}

async function validateFixedStep(root: string, input: ProtectedProductionLeafInputV2): Promise<ProtectedProductionLeafResultV2> {
  if (input.stepId === "verify_g13" || input.stepId === "verify_g14" || input.stepId === "verify_failure") {
    const manifest = readCanonical(root, "release-manifest.json", validateRemediationReleaseManifestV2);
    const expected = input.stepId === "verify_g13" ? "g13_migration_passed"
      : input.stepId === "verify_g14" ? "g14_rollout_passed" : "production_failed";
    if (manifest.value.transitionId !== expected) throw new Error(`production_manifest_phase_invalid:${input.stepId}`);
    return valueCapture(input, { manifestSha256: manifest.sha256, transitionId: manifest.value.transitionId });
  }
  if (input.stepId === "verify_schema") {
    const receipt = readCanonical(root, "schema032-production-execution-receipt-v2.json",
      validateSchema032ProductionExecutionReceiptV2);
    if (receipt.value.result !== "applied_and_verified") throw new Error("production_schema_not_verified");
    return valueCapture(input, { schemaReceiptSha256: receipt.sha256, result: receipt.value.result });
  }
  if (input.stepId === "verify_previous_runtime_identity") {
    const task0b = loadTask0B(root);
    const observation = await observeWindowsRuntimeProcess(task0b.previousRuntimeIdentity.processId);
    if (observation.runtimeSha !== task0b.previousRuntimeSha || observation.runtimeProcessCount !== 1) {
      throw new Error("production_previous_runtime_identity_changed");
    }
    return valueCapture(input, observation);
  }
  if (input.stepId === "verify_singleton_precondition" || input.stepId === "prove_previous_healthy") {
    const count = await countTask0BRuntimeCandidates();
    if (count !== 1) throw new Error("production_runtime_singleton_invalid");
    return valueCapture(input, { runtimeProcessCount: count });
  }
  if (input.stepId === "prove_previous_stopped") {
    const evidence = actualRuntimeEvidence(root, "runtime_manager_stop_previous");
    const count = await countTask0BRuntimeCandidates();
    if (!evidence || count !== 0) throw new Error("production_previous_runtime_stop_unverified");
    return valueCapture(input, { evidenceSha256: evidence.sha256, runtimeProcessCount: count });
  }
  if (input.stepId === "prove_candidate_started") {
    const evidence = actualRuntimeEvidence(root, "runtime_manager_start_candidate");
    const count = await countTask0BRuntimeCandidates();
    if (!evidence || count !== 1) throw new Error("production_candidate_start_unverified");
    return valueCapture(input, { evidenceSha256: evidence.sha256, runtimeProcessCount: count });
  }
  if (input.stepId === "prove_no_previous_stop") {
    if (actualRuntimeEvidence(root, "runtime_manager_stop_previous")) throw new Error("production_previous_stop_detected");
    return valueCapture(input, { previousStopEvidenceCount: 0, runtimeProcessCount: await countTask0BRuntimeCandidates() });
  }
  if (input.stepId === "prove_no_candidate_start") {
    if (actualRuntimeEvidence(root, "runtime_manager_start_candidate")) throw new Error("production_candidate_start_detected");
    return valueCapture(input, { candidateStartEvidenceCount: 0, runtimeProcessCount: await countTask0BRuntimeCandidates() });
  }
  if (["immediate_runtime_checks", "observe_cycle_1", "observe_cycle_2", "bounded_runtime_checks",
    "rollback_runtime_checks"].includes(input.stepId)) {
    const observation = await observeAdmin(root);
    if (observation.runtimeProcessCount !== 1) throw new Error("production_runtime_singleton_invalid");
    return valueCapture(input, observation);
  }
  if (input.operationKind === "recovery") {
    return valueCapture(input, { sourceManifestSha256: readCanonical(root, "release-manifest.json",
      validateRemediationReleaseManifestV2).sha256, stepId: input.stepId });
  }
  return leafCapture(input, await verifyRoot(root));
}

function actualRuntimeEvidence(root: string, commandId: string, exactStepId?: string): { sha256: string; bytes: Buffer;
  effectIdentitySha256: string } | null {
  const matches = runtimeAuthorities(root, commandId, true);
  if (matches.length !== 1) return null;
  const action = commandId.includes("start") || commandId.includes("rollback") ? "start" : "stop";
  const filename = runtimeGenerationEvidencePath(action, matches[0]!.generationId);
  if (!existsSync(safeArtifactPath(root, filename))) return null;
  const bytes = readFileSync(safeArtifactPath(root, filename));
  const reverseStep = exactStepId ?? Object.entries(RUNTIME_COMMAND).find(([, command]) => command === commandId)?.[0];
  if (!reverseStep) throw new Error("production_runtime_effect_step_forbidden");
  return { bytes, sha256: hash(bytes), effectIdentitySha256: runtimeEffectIdentity(reverseStep, matches[0]!) };
}

async function executeRuntimeEffect(root: string, input: ProtectedProductionLeafInputV2): Promise<ProtectedProductionLeafResultV2> {
  const commandId = RUNTIME_COMMAND[input.stepId];
  if (!commandId) throw new Error("production_runtime_effect_step_forbidden");
  const matches = runtimeAuthorities(root, commandId, false);
  if (matches.length !== 1) throw new Error("production_runtime_authority_selection_ambiguous");
  if (input.intendedExternalEffectSha256 !== runtimeEffectIdentity(input.stepId, matches[0]!)) {
    throw new Error("production_runtime_effect_identity_changed");
  }
  const action = commandId.includes("start") || commandId.includes("rollback") ? "start" : "stop";
  const output = await runNodeScript("scripts/manageTask0BRuntime.ts", [action, root, matches[0]!.filename]);
  return leafCapture(input, output);
}

function shaFromTask0B(root: string, field: "previousRuntimeIdentity"): string {
  const bytes = readFileSync(safeArtifactPath(root, "task0b-release-freeze.json"));
  const value = validateTask0BReleaseFreezeEvidence(JSON.parse(bytes.toString("utf8")));
  return releaseSha256V2(canonicalBytesV2(value[field]));
}

function deriveRollbackContext(root: string) {
  const failure = readCanonical(root, "production-failure-evidence-v2.json", validateProductionFailureEvidenceV2);
  let window: ProtectedRollbackWindowV2;
  const attemptedExternalEffect = "attemptedExternalEffect" in failure.value
    ? failure.value.attemptedExternalEffect : failure.value.priorAttemptedExternalEffect;
  if (failure.value.failedGateId === "G13_PRODUCTION_MIGRATION"
      || (failure.value.failedGateId === "G14_PRODUCTION_ROLLOUT" && !attemptedExternalEffect)) {
    window = { kind: "previous_runtime_retained", failedGateId: failure.value.failedGateId };
  } else {
    const candidateStart = actualRuntimeEvidence(root, "runtime_manager_start_candidate");
    if (candidateStart) {
      window = { kind: "candidate_replaced_with_previous", failedGateId: failure.value.failedGateId,
        candidateStartEvidenceSha256: candidateStart.sha256 };
    } else {
      const previousStop = actualRuntimeEvidence(root, "runtime_manager_stop_previous");
      if (!previousStop) throw new Error("production_rollback_window_uncertain");
      window = { kind: "previous_runtime_restarted_without_candidate", failedGateId: "G14_PRODUCTION_ROLLOUT",
        previousStopEvidenceSha256: previousStop.sha256 };
    }
  }
  return { window, failureEvidenceSha256: failure.sha256,
    previousRuntimeIdentitySha256: shaFromTask0B(root, "previousRuntimeIdentity") };
}

function loadRecoverySource(root: string) {
  const terminalFiles = readdirSync(root).filter((name) => /^production-operation-terminal-abandoned-production-(?:rollout|canary)-[0-9a-f]{64}\.json$/u.test(name));
  if (terminalFiles.length !== 1) throw new Error("production_recovery_source_ambiguous");
  const abandoned = readCanonical(root, terminalFiles[0]!, validateProductionOperationTerminalAbandonedV2);
  if (abandoned.value.reason === "ownership_protocol_failure") throw new Error("production_recovery_reason_forbidden");
  const cleanupFile = `production-operation-terminal-cleanup-${abandoned.value.operationId}.json`;
  const cleanup = readCanonical(root, cleanupFile, validateProductionOperationTerminalCleanupV2);
  if (cleanup.value.terminalStateSha256 !== abandoned.sha256) throw new Error("production_recovery_cleanup_binding_invalid");
  const directory = `production-operation-steps/${abandoned.value.operationId}`;
  let stepRoot: string;
  try { stepRoot = dirname(safeArtifactRelativePath(root, `${directory}/probe.json`)); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("artifact_parent_missing")) throw error;
    stepRoot = resolve(root, "__missing_production_step_directory__");
  }
  const receipts = existsSync(stepRoot) ? readdirSync(stepRoot).filter((name) => /^\d+-[a-z0-9_]+-v2\.json$/u.test(name)) : [];
  const completedStepReceiptPrefix = receipts.map((name) => {
    const receipt = readCanonical(root, `${directory}/${name}`, validateProductionOrchestrationStepReceiptV2);
    return { sequence: receipt.value.sequence, stepId: receipt.value.stepId, receiptSha256: receipt.sha256 };
  }).sort((left, right) => left.sequence - right.sequence);
  const prefixSha = releaseSha256V2(canonicalBytesV2(completedStepReceiptPrefix));
  const nextSequence = completedStepReceiptPrefix.length + 1;
  const intentDirectory = `production-operation-step-intents/${abandoned.value.operationId}`;
  let intentRoot: string;
  try { intentRoot = dirname(safeArtifactRelativePath(root, `${intentDirectory}/probe.json`)); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("artifact_parent_missing")) throw error;
    intentRoot = resolve(root, "__missing_production_intent_directory__");
  }
  const intentNames = existsSync(intentRoot) ? readdirSync(intentRoot).filter((name) => name.startsWith(`${nextSequence}-`)) : [];
  if (intentNames.length > 1) throw new Error("production_recovery_uncertain_marker_ambiguous");
  let uncertainStepMarker = null;
  let uncertainStepMarkerSha256 = null;
  if (intentNames.length === 1) {
    const intent = readCanonical(root, `${intentDirectory}/${intentNames[0]!}`, validateProductionOrchestrationStepIntentV2);
    uncertainStepMarker = { sequence: intent.value.sequence, stepId: intent.value.stepId, attempt: 1 as const,
      stepIntentRelativePath: intent.value.relativePath, stepIntentSha256: intent.sha256,
      externalEffectMayHaveStarted: true as const, observedOutcome: "unknown" as const };
    uncertainStepMarkerSha256 = releaseSha256V2(canonicalBytesV2(uncertainStepMarker));
  }
  return {
    priorOperationKind: abandoned.value.operationKind as "rollout" | "canary",
    priorOperationId: abandoned.value.operationId,
    priorTerminalAbandonedSha256: abandoned.sha256,
    priorTerminalCleanupSha256: cleanup.sha256,
    completedStepReceiptPrefix,
    completedStepReceiptPrefixSha256: prefixSha,
    uncertainStepMarker,
    uncertainStepMarkerSha256,
    failedGateId: abandoned.value.operationKind === "rollout" ? "G14_PRODUCTION_ROLLOUT" as const : "G15_PRODUCTION_CANARY" as const,
    failureCode: abandoned.value.reason,
    priorAttemptedExternalEffect: abandoned.value.attemptedExternalEffect
  };
}

export function createProtectedProductionOperationAdaptersV2(artifactRootInput: string): ProtectedProductionOperationAdaptersV2 {
  const artifactRoot = assertTrustedArtifactRootPathV2(artifactRootInput);
  let canaryStartedAt: number | null = null;
  return {
    now: () => new Date().toISOString(),
    async loadReleaseContext(root) {
      if (root !== artifactRoot) throw new Error("production_artifact_root_changed");
      const freeze = readCanonical(root, "release-freeze-identity-v2.json", validateReleaseFreezeIdentityV2);
      return { releaseFreezeIdentitySha256: freeze.sha256 };
    },
    async validateStep(input) {
      if (input.artifactRoot !== artifactRoot) throw new Error("production_artifact_root_changed");
      if (input.operationKind === "canary" && input.stepId === "verify_g14") canaryStartedAt = Date.now();
      if (input.operationKind === "canary" && input.stepId === "observe_cycle_2") {
        if (canaryStartedAt === null) throw new Error("production_canary_cycle_order_invalid");
        while (Date.now() - canaryStartedAt < 15 * 60_000) {
          await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(30_000,
            15 * 60_000 - (Date.now() - canaryStartedAt!))));
        }
      }
      return validateFixedStep(artifactRoot, input);
    },
    async prepareEffect(input) {
      const commandId = RUNTIME_COMMAND[input.stepId];
      if (!commandId) throw new Error("production_runtime_effect_step_forbidden");
      const matches = runtimeAuthorities(artifactRoot, commandId, false);
      if (matches.length !== 1) throw new Error("production_runtime_authority_selection_ambiguous");
      return runtimeEffectIdentity(input.stepId, matches[0]!);
    },
    executeEffect: (input) => executeRuntimeEffect(artifactRoot, input),
    async reconcileEffect(input) {
      const commandId = RUNTIME_COMMAND[input.stepId];
      if (!commandId) throw new Error("production_runtime_effect_step_forbidden");
      const evidence = actualRuntimeEvidence(artifactRoot, commandId, input.stepId);
      if (evidence === null || evidence.effectIdentitySha256 !== input.intent.intendedExternalEffectSha256) return null;
      return leafCapture(input, evidence.bytes);
    },
    async resolveRollbackContext(root) {
      if (root !== artifactRoot) throw new Error("production_artifact_root_changed");
      return deriveRollbackContext(root);
    },
    async loadRecoveryContext(root) {
      if (root !== artifactRoot) throw new Error("production_artifact_root_changed");
      return loadRecoverySource(root);
    }
  };
}
