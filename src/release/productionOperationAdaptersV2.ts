import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
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
import { assertNoSecretLikeArtifactValues, validateTask0BReleaseFreezeEvidence } from "./remediationReleaseManifest";
import {
  assertTerminalLegacyPopulationUnchanged,
  snapshotTerminalLegacyPopulation,
  validateTerminalLegacyPopulation
} from "./terminalLegacyPopulation";
import {
  runtimeGenerationDiagnosticPaths,
  runtimeGenerationConsumptionPath,
  runtimeGenerationEvidencePath,
  validateTask0BProductionRuntimeAuthority
} from "../../scripts/manageTask0BRuntime";
import {
  countTask0BRuntimeCandidates,
  observeTask0BProductionDatabase,
  observeWindowsRuntimeProcess,
  readExternalConfig
} from "../../scripts/captureTask0BPreflight";

const execFileAsync = promisify(execFile);
const MAX_CAPTURE_BYTES = 1024 * 1024;
const APPROVED_SCHEMA_032_CHECKSUM = "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d";
const RUNTIME_COMMAND: Readonly<Record<string, "runtime_manager_start_candidate" | "runtime_manager_stop_candidate"
  | "runtime_manager_stop_previous" | "runtime_manager_rollback_previous">> = Object.freeze({
  stop_previous: "runtime_manager_stop_previous",
  start_candidate: "runtime_manager_start_candidate",
  stop_candidate: "runtime_manager_stop_candidate",
  start_previous: "runtime_manager_rollback_previous",
  restart_previous: "runtime_manager_rollback_previous"
});
type RuntimeManagerCommandId = typeof RUNTIME_COMMAND[keyof typeof RUNTIME_COMMAND];

function hash(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type ProductionLiveProofSnapshotV2 = Readonly<{
  schemaState: "legacy_031" | "schema_032_verified";
  schemaChecksumSha256: string | null;
  runtimeSha: string;
  adminStatus: number;
  runtimeProcessCount: number;
  workerScheduleCount: number;
  botStartedCount: number;
  fatalLogCount: number;
  secretDetected: boolean;
  deliveryInvariantViolationCount: number;
  terminalLegacyUnchanged: boolean;
  reconciliationStrandedCount: number;
  navigationStatus: number;
  allowanceMirrorMismatchCount: number;
  queueGrowthCount: number;
  honestLimitViolationCount: number;
  sentFingerprintDuplicateCount: number;
}>;

type ProductionLiveProofKindV2 = "rollout" | "canary" | "rollback";

const VERIFIED_CHECKS = Object.freeze({
  rollout: ["schema", "version", "admin", "singleton", "workers", "logs", "delivery", "legacy"],
  canary: ["schema", "version", "admin", "singleton", "reconciliation", "delivery", "navigation",
    "allowance", "legacy", "secrets", "queues", "honest_limits"],
  rollback: ["schema032_retained", "previous_version", "admin", "singleton", "allowance", "legacy", "sent",
    "no_duplicate_send"]
} as const);

function requireLiveProof(condition: boolean, code: string): void {
  if (!condition) throw new Error(code);
}

export function deriveVerifiedProductionChecksV2(
  kind: ProductionLiveProofKindV2,
  proof: ProductionLiveProofSnapshotV2,
  expected: Readonly<{ candidateSha: string; previousSha: string }>
): readonly string[] {
  requireLiveProof(proof.schemaState === "schema_032_verified"
    && proof.schemaChecksumSha256 === APPROVED_SCHEMA_032_CHECKSUM, "production_schema_verification_failed");
  requireLiveProof(proof.runtimeSha === (kind === "rollback" ? expected.previousSha : expected.candidateSha),
    "production_runtime_sha_version_mismatch");
  requireLiveProof(proof.adminStatus === 200, "production_admin_unhealthy");
  requireLiveProof(proof.runtimeProcessCount === 1, "production_runtime_singleton_violation");
  requireLiveProof(proof.allowanceMirrorMismatchCount === 0, "production_allowance_invariant_failed");
  requireLiveProof(proof.terminalLegacyUnchanged, "production_legacy_population_changed");
  requireLiveProof(proof.sentFingerprintDuplicateCount === 0, "production_duplicate_sent_fingerprint_detected");
  if (kind === "rollout") {
    requireLiveProof(proof.workerScheduleCount === 1, "production_worker_schedule_unverified");
    requireLiveProof(proof.botStartedCount === 1, "production_bot_start_unverified");
    requireLiveProof(proof.fatalLogCount === 0, "production_logs_fatal_detected");
    requireLiveProof(proof.deliveryInvariantViolationCount === 0, "production_delivery_invariant_failed");
  }
  if (kind === "canary") {
    requireLiveProof(proof.reconciliationStrandedCount === 0, "production_reconciliation_failed");
    requireLiveProof(proof.deliveryInvariantViolationCount === 0, "production_delivery_invariant_failed");
    requireLiveProof(proof.navigationStatus === 200, "production_navigation_invariant_failed");
    requireLiveProof(!proof.secretDetected, "production_secret_detected");
    requireLiveProof(proof.queueGrowthCount === 0, "production_queue_growth_detected");
    requireLiveProof(proof.honestLimitViolationCount === 0, "production_honest_limit_misreported");
  }
  return VERIFIED_CHECKS[kind];
}

export function inspectRuntimeDiagnosticLogsV2(stdout: string, stderr: string): Readonly<{
  workerScheduleCount: number;
  botStartedCount: number;
  fatalLogCount: number;
  secretDetected: false;
}> {
  try { assertNoSecretLikeArtifactValues({ stdout, stderr }); }
  catch (error) { throw new Error("production_runtime_log_secret_detected", { cause: error }); }
  const records = `${stdout}${stderr}`.split(/\r?\n/u).filter(Boolean).map((line) => {
    let parsed: unknown;
    try { parsed = JSON.parse(line); }
    catch (error) { throw new Error("production_runtime_log_non_json", { cause: error }); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("production_runtime_log_record_invalid");
    }
    const record = parsed as Record<string, unknown>;
    if (!new Set(["info", "warn", "error"]).has(String(record.level))
        || typeof record.event !== "string" || typeof record.timestamp !== "string") {
      throw new Error("production_runtime_log_record_invalid");
    }
    return record;
  });
  const fatalLogCount = records.filter((record) => record.level === "error").length;
  if (fatalLogCount > 0) throw new Error("production_runtime_log_fatal_detected");
  const scheduleRecords = records.filter((record) => record.event === "startup_work_schedule_started");
  const expectedSchedule = ["poll", "where_forensic", "incoming_deposit", "deep_forensic", "address_index",
    "address_poisoning"];
  for (const record of scheduleRecords) {
    const schedule = Array.isArray(record.schedule) ? record.schedule : [];
    const labels = schedule.map((item) => item && typeof item === "object" && !Array.isArray(item)
      ? String((item as Record<string, unknown>).label) : "");
    if (labels.length !== expectedSchedule.length || labels.some((label, index) => label !== expectedSchedule[index])) {
      throw new Error("production_runtime_worker_schedule_invalid");
    }
  }
  return {
    workerScheduleCount: scheduleRecords.length,
    botStartedCount: records.filter((record) => record.event === "bot_started").length,
    fatalLogCount,
    secretDetected: false
  };
}

type ProductionRuntimeQueryableV2 = Readonly<{
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}>;

function exactProbeCount(result: { rows: unknown[] }, label: string): number {
  const row = result.rows[0];
  const count = row && typeof row === "object" && !Array.isArray(row)
    ? Number((row as Record<string, unknown>).count) : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`production_${label}_count_invalid`);
  return count;
}

export async function queryProductionRuntimeInvariantsV2(db: ProductionRuntimeQueryableV2): Promise<Readonly<{
  allowanceMirrorMismatchCount: number;
  deliveryInvariantViolationCount: number;
  reconciliationStrandedCount: number;
  queuePopulationCount: number;
  honestLimitViolationCount: number;
  sentFingerprintDuplicateCount: number;
}>> {
  const allowance = await db.query(`with assessed as (
    select case
      when allowance_check_status = 'confirmed_active' then allowance_confirmed_raw is not null
        and allowance_confirmed_raw <> '0' and current_allowance_raw = allowance_confirmed_raw
        and is_unlimited = (allowance_confirmed_raw = '115792089237316195423570985008687907853269984665640564039457584007913129639935')
        and status = 'active'
      when allowance_check_status = 'confirmed_zero' then allowance_confirmed_raw = '0'
        and current_allowance_raw = '0' and is_unlimited = false and status = 'revoked'
      when allowance_check_status in ('failed', 'stale') then current_allowance_raw = '0'
        and is_unlimited = false and status = 'unknown'
      else false end as mirror_valid
    from public.wallet_approvals
  ) select count(*) filter (where mirror_valid is not true)::int as count from assessed`);
  const delivery = await db.query(`select count(*)::int as count /* delivery_invalid */
    from public.forensic_check_jobs
    where progress_json ? 'telegramDelivery' and not (
      progress_json#>>'{telegramDelivery,version}' = 'forensic-telegram-delivery-v1'
      and progress_json#>>'{telegramDelivery,state,status}' in ('pending','retryable','sent','failed')
      and coalesce(progress_json#>>'{telegramDelivery,state,attemptCount}','') ~ '^[0-4]$'
      and (progress_json#>>'{telegramDelivery,state,status}' not in ('sent','failed')
        or progress_json#>'{telegramDelivery,claim}' = 'null'::jsonb)
      and (progress_json#>>'{telegramDelivery,state,status}' <> 'sent'
        or coalesce(progress_json#>>'{telegramDelivery,state,messageFingerprint}','') ~ '^[0-9a-f]{64}$')
    )`);
  const reconciliation = await db.query(`select count(*)::int as count /* reconciliation_stranded */
    from public.forensic_check_jobs job
    where job.status = 'queued' and job.kind in ('where_is_money_check','incoming_deposit_check')
      and job.progress_json->>'jobPhase' = 'waiting_for_targeted_index'
      and exists (select 1 from public.forensic_job_waits wait where wait.job_id = job.id)
      and not exists (select 1 from public.forensic_job_waits wait
        where wait.job_id = job.id and wait.status = 'waiting')`);
  const queues = await db.query(`select count(*)::int as count /* queue_population */
    from public.forensic_check_jobs job
    where job.status in ('queued','running')
      or job.progress_json#>>'{telegramDelivery,state,status}' in ('pending','retryable')
      or job.progress_json#>>'{telegramDeliveryIntent,preparationStatus}' in ('pending','retryable')`);
  const honestLimits = await db.query(`select count(*)::int as count /* honest_limit_invalid */
    from public.forensic_check_jobs job
    where job.result_json::text like '%hard_safety_limit_exceeded%'
      and (coalesce(job.result_json#>>'{assessment,riskScore}', job.result_json->>'riskScore',
        job.result_json->>'risk_score') is not null
        or coalesce(job.result_json#>>'{assessment,decision}', job.result_json->>'decision') is not null)`);
  const duplicateSent = await db.query(`select count(*)::int as count /* sent_fingerprint_duplicate */
    from (select progress_json#>>'{telegramDelivery,state,messageFingerprint}' as fingerprint
      from public.forensic_check_jobs
      where progress_json#>>'{telegramDelivery,state,status}' = 'sent'
      group by progress_json#>>'{telegramDelivery,state,messageFingerprint}' having count(*) > 1) duplicates`);
  return {
    allowanceMirrorMismatchCount: exactProbeCount(allowance, "allowance_mirror_mismatch"),
    deliveryInvariantViolationCount: exactProbeCount(delivery, "delivery_invariant"),
    reconciliationStrandedCount: exactProbeCount(reconciliation, "reconciliation_stranded"),
    queuePopulationCount: exactProbeCount(queues, "queue_population"),
    honestLimitViolationCount: exactProbeCount(honestLimits, "honest_limit"),
    sentFingerprintDuplicateCount: exactProbeCount(duplicateSent, "sent_fingerprint_duplicate")
  };
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

function runtimeAuthorities(root: string, commandId: RuntimeManagerCommandId, includeConsumed: boolean): Array<{
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
      const consumed = existsSync(safeArtifactPath(root,
        runtimeGenerationConsumptionPath(generationId, value.commandId, hash(bytes))));
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

function valueCapture(
  input: ProtectedProductionLeafInputV2,
  value: unknown,
  verifiedChecks?: readonly string[]
): ProtectedProductionLeafResultV2 {
  return { ...leafCapture(input, canonicalBytesV2(value)), ...(verifiedChecks === undefined
    ? {} : { verifiedChecks: [...verifiedChecks] }) };
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
  const adminToken = process.env.ADMIN_DASHBOARD_TOKEN;
  if (!adminToken) throw new Error("production_navigation_authority_missing");
  const navigation = await fetch(new URL("/admin/api/forensic-jobs?limit=1", base), {
    headers: { authorization: `Bearer ${adminToken}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (navigation.status !== 200) throw new Error("production_navigation_invariant_failed");
  const startEvidence = (["runtime_manager_start_candidate", "runtime_manager_rollback_previous"] as const)
    .map((commandId) => actualRuntimeEvidence(root, commandId)).filter((value) => value !== null);
  let live: Awaited<ReturnType<typeof observeWindowsRuntimeProcess>> | null = null;
  let runtimeGenerationId: string | null = null;
  let runtimeStartCommandId: "runtime_manager_start_candidate" | "runtime_manager_rollback_previous" | null = null;
  let runtimeAuthoritySha256: string | null = null;
  for (const evidence of startEvidence) {
    const parsed = JSON.parse(evidence.bytes.toString("utf8")) as Record<string, unknown>;
    const processId = Number(parsed.processId);
    if (!Number.isSafeInteger(processId) || processId < 1) continue;
    try {
      live = await observeWindowsRuntimeProcess(processId);
      if (parsed.runtimeSha !== live.runtimeSha || parsed.runtimeLabel !== live.runtimeLabel) {
        throw new Error("production_runtime_start_evidence_mismatch");
      }
      runtimeGenerationId = evidence.generationId;
      if (evidence.commandId !== "runtime_manager_start_candidate"
          && evidence.commandId !== "runtime_manager_rollback_previous") continue;
      runtimeStartCommandId = evidence.commandId;
      runtimeAuthoritySha256 = evidence.authoritySha256;
      break;
    } catch { /* another issued start may be historical */ }
  }
  if (live === null) {
    try { live = await observeWindowsRuntimeProcess(task0b.previousRuntimeIdentity.processId); }
    catch { throw new Error("production_runtime_identity_unverified"); }
    if (live.runtimeSha !== task0b.previousRuntimeSha || live.runtimeLabel !== task0b.previousRuntimeLabel) {
      throw new Error("production_previous_runtime_identity_changed");
    }
  }
  if (live.runtimeSha !== task0b.candidateSha && live.runtimeSha !== task0b.previousRuntimeSha) {
    throw new Error("production_runtime_sha_unverified");
  }
  return { adminStatus: admin.status, runtimeSha: live.runtimeSha,
    runtimeLabelSha256: hash(live.runtimeLabel), runtimeProcessCount: await countTask0BRuntimeCandidates(),
    navigationStatus: navigation.status, runtimeGenerationId, runtimeStartCommandId, runtimeAuthoritySha256 };
}

async function observeProductionLiveProof(
  root: string,
  kind: ProductionLiveProofKindV2,
  queueBaseline: number | null
): Promise<{ proof: ProductionLiveProofSnapshotV2; queuePopulationCount: number }> {
  const [admin, database] = await Promise.all([observeAdmin(root), observeProductionDatabaseRuntime(root)]);
  const diagnostics = kind === "rollback"
    ? { workerScheduleCount: 0, botStartedCount: 0, fatalLogCount: 0, secretDetected: false as const }
    : admin.runtimeGenerationId === null || admin.runtimeStartCommandId === null || admin.runtimeAuthoritySha256 === null
      ? (() => { throw new Error("production_runtime_log_generation_unverified"); })()
      : await observeRuntimeDiagnostics(root, admin.runtimeGenerationId, admin.runtimeStartCommandId,
        admin.runtimeAuthoritySha256, admin.runtimeSha);
  const queuePopulationCount = database.invariants.queuePopulationCount;
  return {
    proof: {
      schemaState: database.identity.schemaState,
      schemaChecksumSha256: database.identity.schema032ReceiptPrestate.checksumSha256,
      runtimeSha: admin.runtimeSha,
      adminStatus: admin.adminStatus,
      runtimeProcessCount: admin.runtimeProcessCount,
      workerScheduleCount: diagnostics.workerScheduleCount,
      botStartedCount: diagnostics.botStartedCount,
      fatalLogCount: diagnostics.fatalLogCount,
      secretDetected: diagnostics.secretDetected,
      deliveryInvariantViolationCount: database.invariants.deliveryInvariantViolationCount,
      terminalLegacyUnchanged: database.terminalLegacyUnchanged,
      reconciliationStrandedCount: database.invariants.reconciliationStrandedCount,
      navigationStatus: admin.navigationStatus,
      allowanceMirrorMismatchCount: database.invariants.allowanceMirrorMismatchCount,
      queueGrowthCount: queueBaseline === null ? 0 : Math.max(0, queuePopulationCount - queueBaseline),
      honestLimitViolationCount: database.invariants.honestLimitViolationCount,
      sentFingerprintDuplicateCount: database.invariants.sentFingerprintDuplicateCount
    },
    queuePopulationCount
  };
}

function readRuntimeLogBinding(
  root: string,
  generationId: string,
  commandId: "runtime_manager_start_candidate" | "runtime_manager_rollback_previous",
  authoritySha256: string,
  runtimeSha: string
): void {
  const paths = runtimeGenerationDiagnosticPaths(generationId, commandId, authoritySha256);
  const binding = readCanonical(root, paths.binding, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("production_runtime_log_binding_invalid");
    }
    const record = value as Record<string, unknown>;
    const expectedKeys = ["version", "generationId", "commandId", "authoritySha256", "targetRuntimeSha", "stdoutPath",
      "stderrPath", "createdAt"].sort();
    if (Object.keys(record).sort().join("|") !== expectedKeys.join("|")
        || record.version !== "runtime-manager-log-binding-v1"
        || record.generationId !== generationId
        || record.commandId !== commandId || record.authoritySha256 !== authoritySha256
        || record.targetRuntimeSha !== runtimeSha
        || record.stdoutPath !== paths.stdout || record.stderrPath !== paths.stderr
        || typeof record.createdAt !== "string" || new Date(record.createdAt).toISOString() !== record.createdAt) {
      throw new Error("production_runtime_log_binding_invalid");
    }
    return record;
  });
  void binding;
}

async function observeRuntimeDiagnostics(
  root: string,
  generationId: string,
  commandId: "runtime_manager_start_candidate" | "runtime_manager_rollback_previous",
  authoritySha256: string,
  runtimeSha: string
) {
  readRuntimeLogBinding(root, generationId, commandId, authoritySha256, runtimeSha);
  const paths = runtimeGenerationDiagnosticPaths(generationId, commandId, authoritySha256);
  let lastError: unknown = new Error("production_runtime_logs_not_ready");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const stdout = readFileSync(safeArtifactPath(root, paths.stdout));
      const stderr = readFileSync(safeArtifactPath(root, paths.stderr));
      if (stdout.length > MAX_CAPTURE_BYTES || stderr.length > MAX_CAPTURE_BYTES) {
        throw new Error("production_runtime_log_too_large");
      }
      const proof = inspectRuntimeDiagnosticLogsV2(stdout.toString("utf8"), stderr.toString("utf8"));
      if (proof.workerScheduleCount > 1 || proof.botStartedCount > 1) {
        throw new Error("production_runtime_log_duplicate_startup");
      }
      if (proof.workerScheduleCount === 1 && proof.botStartedCount === 1) return proof;
      lastError = new Error("production_runtime_logs_not_ready");
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "";
      if (/secret|fatal|duplicate|too_large|binding|schedule_invalid/iu.test(message)) throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("production_runtime_logs_unverified", { cause: lastError });
}

async function observeProductionDatabaseRuntime(root: string) {
  const external = await readExternalConfig(root);
  const databaseUrl = process.env[external.config.databaseConnectionEnvName];
  if (!databaseUrl) throw new Error("production_database_binding_missing");
  const identity = await observeTask0BProductionDatabase(external.config);
  if (process.env[external.config.databaseConnectionEnvName] !== databaseUrl) {
    throw new Error("production_database_binding_changed");
  }
  if (identity.schemaState !== "schema_032_verified"
      || identity.schema032ReceiptPrestate.checksumSha256 !== APPROVED_SCHEMA_032_CHECKSUM) {
    throw new Error("production_schema_verification_failed");
  }
  const terminal = readCanonical(root, "terminal-legacy-population.json", validateTerminalLegacyPopulation).value;
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000, query_timeout: 15_000, application_name: "plan5_production_live_proof" });
  await client.connect();
  let transactionStarted = false;
  try {
    await client.query("begin isolation level repeatable read read only");
    transactionStarted = true;
    const current = await client.query(`select current_database() as database_name,
      inet_server_port() as server_port,
      current_setting('server_version_num') as server_version_num,
      (select oid::text from pg_database where datname = current_database()) as database_oid`);
    const control = await client.query("select system_identifier::text as system_identifier from pg_control_system()");
    const expected = external.config.productionDatabaseExpected;
    if (current.rows.length !== 1 || current.rows[0]?.database_name !== "tron_watch"
        || Number(current.rows[0]?.server_port) !== expected.connectedServerPort
        || String(current.rows[0]?.server_version_num) !== expected.serverVersionNum
        || String(current.rows[0]?.database_oid) !== expected.databaseOid
        || String(control.rows[0]?.system_identifier) !== expected.systemIdentifier) {
      throw new Error("production_database_identity_changed");
    }
    const invariants = await queryProductionRuntimeInvariantsV2({
      query: (text, values) => client.query(text, values).then((result) => ({ rows: result.rows }))
    });
    const currentTerminal = await snapshotTerminalLegacyPopulation(client, terminal);
    assertTerminalLegacyPopulationUnchanged(terminal, currentTerminal);
    await client.query("commit");
    transactionStarted = false;
    return { identity, invariants, terminalLegacyUnchanged: true as const };
  } catch (error) {
    if (transactionStarted) {
      try { await client.query("rollback"); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], "production_live_proof_rollback_failed"); }
    }
    throw error;
  } finally {
    await client.end();
  }
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
    const executionReceipt = readCanonical(root, "schema032-production-execution-receipt-v2.json",
      validateSchema032ProductionExecutionReceiptV2);
    if (executionReceipt.value.result !== "applied_and_verified") throw new Error("production_schema_not_verified");
    const external = await readExternalConfig(root);
    const live = await observeTask0BProductionDatabase(external.config);
    if (live.schemaState !== "schema_032_verified"
        || live.schema032ReceiptPrestate.checksumSha256 !== APPROVED_SCHEMA_032_CHECKSUM) {
      throw new Error("production_schema_not_verified");
    }
    return valueCapture(input, { executionReceiptSha256: executionReceipt.sha256,
      schemaState: live.schemaState, checksumSha256: live.schema032ReceiptPrestate.checksumSha256,
      approvedIdentityFingerprintSha256: live.approvedIdentityFingerprintSha256 });
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
    return valueCapture(input, { stepId: input.stepId });
  }
  if (input.operationKind === "recovery") {
    return valueCapture(input, { sourceManifestSha256: readCanonical(root, "release-manifest.json",
      validateRemediationReleaseManifestV2).sha256, stepId: input.stepId });
  }
  return leafCapture(input, await verifyRoot(root));
}

function actualRuntimeEvidence(root: string, commandId: RuntimeManagerCommandId, exactStepId?: string): { sha256: string; bytes: Buffer;
  effectIdentitySha256: string; generationId: string; commandId: string; authoritySha256: string } | null {
  const matches = runtimeAuthorities(root, commandId, true);
  if (matches.length !== 1) return null;
  const action = commandId.includes("start") || commandId.includes("rollback") ? "start" : "stop";
  const filename = runtimeGenerationEvidencePath(action, matches[0]!.generationId, commandId, matches[0]!.sha256);
  if (!existsSync(safeArtifactPath(root, filename))) return null;
  const bytes = readFileSync(safeArtifactPath(root, filename));
  const reverseStep = exactStepId ?? Object.entries(RUNTIME_COMMAND).find(([, command]) => command === commandId)?.[0];
  if (!reverseStep) throw new Error("production_runtime_effect_step_forbidden");
  return { bytes, sha256: hash(bytes), effectIdentitySha256: runtimeEffectIdentity(reverseStep, matches[0]!),
    generationId: matches[0]!.generationId, commandId, authoritySha256: matches[0]!.sha256 };
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
  let canaryQueueBaseline: number | null = null;
  let selectedRollbackWindow: ProtectedRollbackWindowV2 | null = null;
  return {
    now: () => new Date().toISOString(),
    async loadReleaseContext(root) {
      if (root !== artifactRoot) throw new Error("production_artifact_root_changed");
      const freeze = readCanonical(root, "release-freeze-identity-v2.json", validateReleaseFreezeIdentityV2);
      return { releaseFreezeIdentitySha256: freeze.sha256 };
    },
    async validateStep(input) {
      if (input.artifactRoot !== artifactRoot) throw new Error("production_artifact_root_changed");
      if (input.operationKind === "canary" && input.stepId === "verify_g14") {
        canaryStartedAt = Date.now();
        canaryQueueBaseline = null;
      }
      if (input.operationKind === "canary" && input.stepId === "observe_cycle_2") {
        if (canaryStartedAt === null) throw new Error("production_canary_cycle_order_invalid");
        while (Date.now() - canaryStartedAt < 15 * 60_000) {
          await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(30_000,
          15 * 60_000 - (Date.now() - canaryStartedAt!))));
        }
      }
      const basic = await validateFixedStep(artifactRoot, input);
      const isRolloutTerminal = input.operationKind === "rollout" && input.stepId === "immediate_runtime_checks";
      const isCanaryObservation = input.operationKind === "canary"
        && new Set(["observe_cycle_1", "observe_cycle_2", "bounded_runtime_checks"]).has(input.stepId);
      const isCanaryTerminal = input.operationKind === "canary" && input.stepId === "bounded_runtime_checks";
      const isRollbackTerminal = input.operationKind === "rollback" && (
        (selectedRollbackWindow?.kind === "previous_runtime_retained" && input.stepId === "prove_no_candidate_start")
        || (selectedRollbackWindow?.kind !== "previous_runtime_retained" && input.stepId === "rollback_runtime_checks")
      );
      const liveKind = isRolloutTerminal ? "rollout" : isCanaryObservation ? "canary"
        : isRollbackTerminal ? "rollback" : null;
      if (liveKind === null) return basic;
      const observed = await observeProductionLiveProof(artifactRoot, liveKind,
        liveKind === "canary" ? canaryQueueBaseline : null);
      if (input.stepId === "observe_cycle_1") canaryQueueBaseline = observed.queuePopulationCount;
      const task0b = loadTask0B(artifactRoot);
      const verifiedChecks = isRolloutTerminal || isCanaryTerminal || isRollbackTerminal
        ? deriveVerifiedProductionChecksV2(liveKind, observed.proof, {
          candidateSha: task0b.candidateSha,
          previousSha: task0b.previousRuntimeSha
        }) : undefined;
      return valueCapture(input, { basicOutputSha256: basic.outputSha256, proof: observed.proof }, verifiedChecks);
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
      const context = deriveRollbackContext(root);
      selectedRollbackWindow = context.window;
      return context;
    },
    async loadRecoveryContext(root) {
      if (root !== artifactRoot) throw new Error("production_artifact_root_changed");
      return loadRecoverySource(root);
    }
  };
}
