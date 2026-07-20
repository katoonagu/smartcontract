import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  REMEDIATION_PRE_RELEASE_GATE_IDS,
  REMEDIATION_PRODUCTION_GATE_IDS,
  REMEDIATION_REQUIRED_SUITE_GROUPS,
  REMEDIATION_COMMAND_TEMPLATE_SHA256,
  PLAN5_APPROVED_BASE_SHA,
  assertNoSecretLikeArtifactValues,
  validateTask0BaselineEvidence,
  validateTask0BReleaseFreezeEvidence,
  type ReleaseArtifactV1,
  type ReleaseGateId,
  type ReleaseGateState,
  validateRemediationReleaseManifest
} from "../src/release/remediationReleaseManifest";
import { validateAcceptanceTraceSet } from "../src/release/acceptanceTrace";
import { parseVitestJsonReport } from "../src/release/acceptanceTrace";
import type { AcceptanceTraceSetV1, ParsedAcceptanceExecution } from "../src/release/acceptanceTrace";
import {
  buildRuntimeRehearsalExpectedFromArtifactBytes,
  deriveControlledRuntimeEvidence,
  validateControlledRuntimeRehearsalProvenance,
  validateControlledRuntimeOperationalConfig,
  validateSchemaEvidenceForRehearsal,
  validateRollbackRehearsalEvidence,
  validateRuntimeRehearsalEvidence
} from "./rehearseRemediationRuntime";
import type { ControlledRuntimeQueryCapturesV1 } from "./rehearseRemediationRuntime";
import {
  assertTerminalLegacyPopulationUnchanged,
  validateTerminalLegacyPopulation
} from "../src/release/terminalLegacyPopulation";
import { MANUAL_TELEGRAM_ACCEPTANCE_CASES } from "./renderTelegramUxAcceptance";
import {
  verifyRemediationReleaseArtifactsV2,
  validateRemediationReleaseManifestV2,
  type RemediationReleaseManifestV2
} from "../src/release/remediationReleaseManifestV2";
import type { GateEvidencePayloadV2 } from "../src/release/releaseGateEvidencePolicy";
import { verifyCurrentReleaseManifestChainV2 } from "../src/release/releaseManifestStoreV2";

export type RemediationSuiteGroupId = keyof typeof REMEDIATION_REQUIRED_SUITE_GROUPS;

export type ReleaseSuiteGroupEvidenceV1 = {
  version: "release-suite-group-evidence-v1";
  candidateSha: string;
  groupId: RemediationSuiteGroupId;
  requiredTestFiles: string[];
  reportSha256: string;
  exitCode: 0;
  executedTestCount: number;
  state: "passed";
};

export const REMEDIATION_RELEASE_MANIFEST_FILE = "release-manifest.json";
export const REMEDIATION_ACCEPTANCE_TRACE_FILE = "acceptance-trace.json";

export type RemediationReleaseVerificationPhase =
  | "manifest"
  | "pre-manual"
  | "readiness"
  | "g12"
  | "g13"
  | "g14"
  | "released"
  | "rolled-back";

type SanitizedVerificationResult = {
  version: "remediation-release-manifest-v2";
  transitionId: RemediationReleaseManifestV2["transitionId"];
  overall: string;
  gates: Array<{ id: ReleaseGateId; state: ReleaseGateState }>;
};

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const SHA40 = /^[0-9a-f]{40}$/;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

export const PLAN5_CANDIDATE_ALLOWED_PATHS = new Set([
  "docs/superpowers/plans/2026-07-17-remediation-end-to-end-acceptance-and-release.md",
  "package.json",
  "scripts/captureTask0BPreflight.ts",
  "scripts/createProductionBackupEvidence.ts",
  "scripts/manageTask0BRuntime.ts",
  "scripts/captureRemediationTestEvidence.ts",
  "scripts/finalizeTelegramAcceptance.ts",
  "scripts/migrate.ts",
  "scripts/rehearseRemediationRuntime.ts",
  "scripts/rehearseRemediationRuntimePreload.ts",
  "scripts/runSchema032ReleaseSequence.ts",
  "scripts/snapshotTerminalLegacyPopulation.ts",
  "scripts/verifyRemediationRelease.ts",
  "scripts/verifySchema032.ts",
  "src/bot/createBot.ts",
  "src/config.ts",
  "src/index.ts",
  "src/release/acceptanceTrace.ts",
  "src/release/remediationReleaseManifest.ts",
  "src/release/schema032MigrationIdentity.ts",
  "src/release/terminalLegacyPopulation.ts",
  "tests/release/task0bRuntimeManager.acceptance.test.ts",
  "src/runtime/runtimeVersion.ts",
  "tests/bot/createBot.test.ts",
  "tests/check/contractDecisionV2.acceptance.test.ts",
  "tests/config/config.test.ts",
  "tests/fixtures/release/remediationReleaseFixtures.ts",
  "tests/forensics/recentFlowProvenanceSelection.test.ts",
  "tests/release/acceptanceTrace.acceptance.test.ts",
  "tests/release/manualTelegramEvidence.acceptance.test.ts",
  "tests/release/remediationReleaseManifest.acceptance.test.ts",
  "tests/release/rollbackRehearsal.acceptance.test.ts",
  "tests/release/runtimeVersion.acceptance.test.ts",
  "tests/release/schema032Release.acceptance.test.ts",
  "tests/release/productionBackup.acceptance.test.ts",
  "tests/release/terminalLegacyPopulation.acceptance.test.ts",
  "tests/runtime/runtimeSchemaGateIntegration.acceptance.test.ts",
  "docs/superpowers/verification/plan5-release/README.md",
  "docs/knowledge/03-job-lifecycle.md",
  "docs/knowledge/05-where-is-money-and-incoming.md",
  "docs/knowledge/06-deepcheck.md",
  "docs/knowledge/07-risk-scoring-matrix.md",
  "docs/knowledge/08-admin-and-bot-ux.md",
  "docs/knowledge/09-current-decisions.md",
  "docs/knowledge/10-open-problems.md",
  "docs/knowledge/12-runbooks.md",
  "docs/knowledge/13-agent-observations.md"
]);

const ADDRESS_POISONING_PROTECTED_PATHS = new Set([
  "src/monitor/addressPoisoning.ts", "src/monitor/addressPoisoningWorker.ts", "src/alerts/addressPoisoningAlert.ts",
  "migrations/031_address_poisoning_monitor.sql", "tests/monitor/addressPoisoning.test.ts",
  "tests/monitor/addressPoisoningWorker.test.ts", "tests/alerts/addressPoisoningAlert.test.ts",
  "tests/fixtures/monitor/addressPoisoningCases.ts",
  "docs/superpowers/specs/2026-07-12-tron-usdt-address-poisoning-monitor-design.md",
  "docs/superpowers/plans/2026-07-12-tron-usdt-address-poisoning-monitor.md"
]);

export function validatePlan5CandidateScope(output: string): string[] {
  const paths = output.split(/\r?\n/u).map((value) => value.trim().replaceAll("\\", "/")).filter(Boolean);
  for (const path of paths) {
    if (ADDRESS_POISONING_PROTECTED_PATHS.has(path)) throw new Error(`Address Poisoning path changed: ${path}`);
    if (!PLAN5_CANDIDATE_ALLOWED_PATHS.has(path)) throw new Error(`unapproved Plan 5 candidate path: ${path}`);
  }
  return paths;
}

export const PLAN5_CLEANUP_DATABASES = Object.freeze({
  PLAN1_TEST_DATABASE_URL: "tron_watch_plan1",
  PLAN2_TEST_DATABASE_URL: "tron_watch_plan2",
  PLAN3_TEST_DATABASE_URL: "tron_watch_plan3",
  PLAN4_TEST_DATABASE_URL: "tron_watch_plan4",
  PLAN5_SCHEMA_CLEAN_DATABASE_URL: "tron_watch_plan5_clean",
  PLAN5_SCHEMA_CLONE_DATABASE_URL: "tron_watch_plan5_clone",
  PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL: "tron_watch_plan5_runtime_sanitized"
} as const);

const SUITE_TEST_DATABASES: Partial<Record<RemediationSuiteGroupId, string>> = Object.freeze({
  plan1: "tron_watch_plan1",
  plan2: "tron_watch_plan2",
  plan3: "tron_watch_plan3",
  plan4: "tron_watch_plan4"
});

function assertExactDisposableDatabaseUrl(value: string, envName: string, expectedDatabase: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${envName} is not the exact disposable Plan 5 database`);
  }
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if ((parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") || parsed.search || parsed.hash
      || !new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname)
      || database !== expectedDatabase) throw new Error(`${envName} is not the exact disposable Plan 5 database`);
}

export function buildReleaseSuiteEnvironment(
  source: NodeJS.ProcessEnv,
  options: { expectedTestDatabase?: string } = {}
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  const allowedSensitive = /^(?:TEST_DATABASE_URL|REQUIRE_PLAN[1-5]_POSTGRES|PLAN[1-4]_TEST_DATABASE_URL|PLAN5_SCHEMA_(?:CLEAN|CLONE|RUNTIME_SANITIZED)_DATABASE_URL|PLAN5_SCHEMA_EXPECTED_(?:ENDPOINT|SYSTEM_IDENTIFIER))$/;
  const sensitive = /(?:DATABASE_URL|TELEGRAM|BOT(?:_|$)|TRONSCAN|TRONGRID|DEEPSEEK|OPENAI|ANTHROPIC|LLM|TOKEN|API_KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|PROVIDER)/i;
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || key === "NODE_OPTIONS") continue;
    if (sensitive.test(key) && !allowedSensitive.test(key)) continue;
    if (key === "TEST_DATABASE_URL") {
      if (!options.expectedTestDatabase) throw new Error("TEST_DATABASE_URL has no disposable suite database binding");
      assertExactDisposableDatabaseUrl(value, key, options.expectedTestDatabase);
    } else if (Object.hasOwn(PLAN5_CLEANUP_DATABASES, key)) {
      assertExactDisposableDatabaseUrl(
        value,
        key,
        PLAN5_CLEANUP_DATABASES[key as keyof typeof PLAN5_CLEANUP_DATABASES]
      );
    }
    result[key] = value;
  }
  result.DOTENV_CONFIG_PATH = resolve(repositoryRoot, "tests/fixtures/release/plan5-no-dotenv");
  return result;
}

export type NonVitestReleaseCheckId = "typecheck" | "full_test" | "diff_check" | "forbidden_scope" | "postgres_cleanup";
export type NonVitestReleaseEvidenceV1 = {
  version: "non-vitest-release-evidence-v1";
  candidateSha: string;
  planBaseSha: string;
  commandId: "full_regression";
  redactedTemplateSha256: string;
  checks: Array<{
    checkId: NonVitestReleaseCheckId;
    exitCode: 0;
    outputSha256: string;
    state: "passed";
  }>;
};

type ReleaseProcessResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  error?: Error;
};

export type NonVitestReleaseDependencies = {
  run(executable: string, args: readonly string[], env: NodeJS.ProcessEnv): ReleaseProcessResult;
  postgresCleanup(): Promise<Record<string, string[]>>;
};

function requireDisposableDatabaseUrl(env: NodeJS.ProcessEnv, envName: keyof typeof PLAN5_CLEANUP_DATABASES): string {
  const value = env[envName];
  if (!value) throw new Error(`${envName} is required for PostgreSQL cleanup`);
  const expectedDatabase = PLAN5_CLEANUP_DATABASES[envName];
  assertExactDisposableDatabaseUrl(value, envName, expectedDatabase);
  return value;
}

export function createDefaultNonVitestReleaseDependencies(env: NodeJS.ProcessEnv): NonVitestReleaseDependencies {
  return {
    run(executable, args, childEnv) {
      const result = spawnSync(executable, [...args], {
        cwd: repositoryRoot,
        env: childEnv,
        encoding: "utf8",
        windowsHide: true,
        shell: false,
        timeout: 45 * 60_000,
        maxBuffer: MAX_ARTIFACT_BYTES
      });
      return {
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        signal: result.signal,
        error: result.error
      };
    },
    async postgresCleanup() {
      const cleanup: Record<string, string[]> = {};
      for (const [envName, expectedDatabase] of Object.entries(PLAN5_CLEANUP_DATABASES) as Array<[
        keyof typeof PLAN5_CLEANUP_DATABASES,
        string
      ]>) {
        const client = new Client({
          connectionString: requireDisposableDatabaseUrl(env, envName),
          connectionTimeoutMillis: 5_000,
          query_timeout: 15_000,
          statement_timeout: 15_000,
          application_name: "plan5_release_cleanup_audit"
        });
        await client.connect();
        try {
          const identity = await client.query<{ database_name: string }>("SELECT current_database() AS database_name");
          if (identity.rows.length !== 1 || identity.rows[0].database_name !== expectedDatabase) {
            throw new Error(`${envName} connected to the wrong disposable database`);
          }
          const result = await client.query<{ schema_name: string }>(
            "SELECT nspname AS schema_name FROM pg_namespace WHERE nspname ~ '^plan[1-5]_' ORDER BY nspname"
          );
          cleanup[expectedDatabase] = result.rows.map((row) => row.schema_name);
        } finally {
          await client.end();
        }
      }
      return cleanup;
    }
  };
}

export async function runNonVitestReleaseChecks(
  input: { candidateSha: string; planBaseSha: string; env: NodeJS.ProcessEnv },
  dependencies: NonVitestReleaseDependencies = createDefaultNonVitestReleaseDependencies(input.env)
): Promise<NonVitestReleaseEvidenceV1> {
  if (!SHA40.test(input.candidateSha) || input.planBaseSha !== PLAN5_APPROVED_BASE_SHA || input.candidateSha === input.planBaseSha) {
    throw new Error("non-Vitest release base or candidate SHA is invalid");
  }
  const environment = buildReleaseSuiteEnvironment(input.env);
  const ancestry = dependencies.run("git", ["merge-base", "--is-ancestor", PLAN5_APPROVED_BASE_SHA, input.candidateSha], environment);
  if (ancestry.error || ancestry.signal || ancestry.status !== 0) throw new Error("approved Plan 5 base is not a candidate ancestor");
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const commands: Array<{ checkId: Exclude<NonVitestReleaseCheckId, "postgres_cleanup">; executable: string; args: string[]; requireEmpty: boolean }> = [
    { checkId: "typecheck", executable: npmExecutable, args: ["run", "typecheck"], requireEmpty: false },
    { checkId: "full_test", executable: npmExecutable, args: ["test"], requireEmpty: false },
    { checkId: "diff_check", executable: "git", args: ["diff", "--check", `${input.planBaseSha}..${input.candidateSha}`], requireEmpty: true },
    {
      checkId: "forbidden_scope",
      executable: "git",
      args: ["diff", "--name-only", `${input.planBaseSha}..${input.candidateSha}`],
      requireEmpty: false
    }
  ];
  const checks: NonVitestReleaseEvidenceV1["checks"] = [];
  for (const command of commands) {
    const result = dependencies.run(command.executable, command.args, environment);
    if (result.error || result.signal || result.status !== 0) throw new Error(`${command.checkId} failed`);
    assertNoSecretLikeArtifactValues({ stdout: result.stdout, stderr: result.stderr });
    if (command.checkId === "forbidden_scope") validatePlan5CandidateScope(result.stdout);
    if (command.requireEmpty && `${result.stdout}${result.stderr}`.trim()) throw new Error(`${command.checkId} produced forbidden output`);
    checks.push({
      checkId: command.checkId,
      exitCode: 0,
      outputSha256: createHash("sha256").update(stableJson({ stdout: result.stdout, stderr: result.stderr })).digest("hex"),
      state: "passed"
    });
  }
  const cleanup = await dependencies.postgresCleanup();
  const exactDatabases = Object.values(PLAN5_CLEANUP_DATABASES);
  if (Object.keys(cleanup).sort().join("|") !== [...exactDatabases].sort().join("|")
      || exactDatabases.some((database) => !Array.isArray(cleanup[database]) || cleanup[database].length !== 0)) {
    throw new Error("PostgreSQL release cleanup failed");
  }
  checks.push({
    checkId: "postgres_cleanup",
    exitCode: 0,
    outputSha256: createHash("sha256").update(stableJson(cleanup)).digest("hex"),
    state: "passed"
  });
  return {
    version: "non-vitest-release-evidence-v1",
    candidateSha: input.candidateSha,
    planBaseSha: input.planBaseSha,
    commandId: "full_regression",
    redactedTemplateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256.full_regression,
    checks
  };
}

export function validateNonVitestReleaseEvidence(
  value: unknown,
  expected: { candidateSha: string; planBaseSha: string }
): NonVitestReleaseEvidenceV1 {
  assertNoSecretLikeArtifactValues(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("non-Vitest evidence is invalid");
  const evidence = value as Record<string, unknown>;
  const keys = ["version", "candidateSha", "planBaseSha", "commandId", "redactedTemplateSha256", "checks"].sort();
  if (Object.keys(evidence).sort().join("|") !== keys.join("|")) throw new Error("non-Vitest evidence fields are invalid");
  if (evidence.version !== "non-vitest-release-evidence-v1"
      || evidence.candidateSha !== expected.candidateSha
      || expected.planBaseSha !== PLAN5_APPROVED_BASE_SHA
      || evidence.planBaseSha !== PLAN5_APPROVED_BASE_SHA
      || evidence.commandId !== "full_regression"
      || evidence.redactedTemplateSha256 !== REMEDIATION_COMMAND_TEMPLATE_SHA256.full_regression) {
    throw new Error("non-Vitest evidence identity is invalid");
  }
  if (!Array.isArray(evidence.checks) || evidence.checks.length !== 5) throw new Error("non-Vitest evidence checks are invalid");
  const expectedIds: NonVitestReleaseCheckId[] = ["typecheck", "full_test", "diff_check", "forbidden_scope", "postgres_cleanup"];
  for (let index = 0; index < expectedIds.length; index += 1) {
    const check = evidence.checks[index];
    if (check === null || typeof check !== "object" || Array.isArray(check)) throw new Error("non-Vitest check is invalid");
    const record = check as Record<string, unknown>;
    if (Object.keys(record).sort().join("|") !== ["checkId", "exitCode", "outputSha256", "state"].sort().join("|")
        || record.checkId !== expectedIds[index] || record.exitCode !== 0 || record.state !== "passed"
        || typeof record.outputSha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.outputSha256)) {
      throw new Error("non-Vitest check is invalid");
    }
  }
  return value as NonVitestReleaseEvidenceV1;
}

function stableJson(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("suite report contains a non-finite number");
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value !== "object") throw new Error("suite report contains an unsupported value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function buildReleaseSuiteGroupEvidence(input: {
  groupId: RemediationSuiteGroupId;
  candidateSha: string;
  exitCode: number;
  report: unknown;
  reportBytes?: Buffer;
}): ReleaseSuiteGroupEvidenceV1 {
  if (!Object.hasOwn(REMEDIATION_REQUIRED_SUITE_GROUPS, input.groupId)) throw new Error("suite group is not allowlisted");
  if (!SHA40.test(input.candidateSha)) throw new Error("suite candidate SHA is invalid");
  if (input.exitCode !== 0) throw new Error("suite process did not exit successfully");
  assertNoSecretLikeArtifactValues(input.report);
  const executions = parseVitestJsonReport(input.report, "passed");
  if (executions.some((execution) => execution.status !== "passed")) throw new Error("suite contains skipped, todo, or failed execution");
  const report = input.report as Record<string, unknown>;
  for (const counter of ["numPendingTests", "numTodoTests"] as const) {
    if (report[counter] !== undefined && report[counter] !== 0) throw new Error("suite contains pending, skipped, or todo tests");
  }
  if (report.numTotalTests !== undefined && report.numTotalTests !== executions.length) {
    throw new Error("suite report is filtered or incomplete");
  }
  const requiredTestFiles: string[] = [...REMEDIATION_REQUIRED_SUITE_GROUPS[input.groupId]];
  const executedFiles = [...new Set(executions.map((execution) => execution.testFile))].sort();
  if (executedFiles.length !== requiredTestFiles.length
      || requiredTestFiles.some((file) => !executedFiles.includes(file))
      || executedFiles.some((file) => !requiredTestFiles.includes(file))) {
    throw new Error("suite report does not contain the exact required test-file set");
  }
  const executionKeys = executions.map((execution) => `${execution.testFile}\0${execution.fullName}`);
  if (new Set(executionKeys).size !== executionKeys.length) throw new Error("suite report contains duplicate test executions");
  return {
    version: "release-suite-group-evidence-v1",
    candidateSha: input.candidateSha,
    groupId: input.groupId,
    requiredTestFiles,
    reportSha256: createHash("sha256")
      .update(input.reportBytes ?? Buffer.from(stableJson(input.report), "utf8"))
      .digest("hex"),
    exitCode: 0,
    executedTestCount: executions.length,
    state: "passed"
  };
}

export function validateReleaseSuiteGroupEvidence(
  value: unknown,
  input: { groupId: RemediationSuiteGroupId; candidateSha: string; report: unknown; reportBytes: Buffer }
): ReleaseSuiteGroupEvidenceV1 {
  assertNoSecretLikeArtifactValues(value);
  const expected = buildReleaseSuiteGroupEvidence({ ...input, exitCode: 0 });
  if (value === null || typeof value !== "object" || Array.isArray(value)
      || stableJson(value) !== stableJson(expected)) throw new Error(`${input.groupId} suite evidence is invalid`);
  return value as ReleaseSuiteGroupEvidenceV1;
}

export type ReleaseGateOutputV1 = {
  version: "release-gate-output-v1";
  gateId: ReleaseGateId;
  candidateSha: string;
  commandId: string;
  redactedTemplateSha256: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  state: ReleaseGateState;
  evidenceSha256s: string[];
};

export function validateReleaseGateOutput(bytes: Buffer, gate: ReleaseArtifactV1): ReleaseGateOutputV1 {
  if (createHash("sha256").update(bytes).digest("hex") !== gate.outputSha256) {
    throw new Error(`${gate.id} concrete output hash mismatch`);
  }
  const value = parseJson(bytes);
  assertNoSecretLikeArtifactValues(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${gate.id} output is invalid`);
  const output = value as Record<string, unknown>;
  const keys = [
    "version", "gateId", "candidateSha", "commandId", "redactedTemplateSha256", "startedAt", "finishedAt",
    "exitCode", "state", "evidenceSha256s"
  ].sort();
  if (Object.keys(output).sort().join("|") !== keys.join("|")) throw new Error(`${gate.id} output fields are invalid`);
  for (const field of ["gateId", "candidateSha", "commandId", "redactedTemplateSha256", "startedAt", "finishedAt", "exitCode", "state"] as const) {
    const expected = field === "gateId" ? gate.id : gate[field];
    if (output[field] !== expected) throw new Error(`${gate.id} output ${field} mismatch`);
  }
  if (output.version !== "release-gate-output-v1") throw new Error(`${gate.id} output version is invalid`);
  if (!Array.isArray(output.evidenceSha256s) || output.evidenceSha256s.length === 0
      || new Set(output.evidenceSha256s).size !== output.evidenceSha256s.length
      || output.evidenceSha256s.some((hash) => typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash))) {
    throw new Error(`${gate.id} evidence hashes are invalid`);
  }
  return output as unknown as ReleaseGateOutputV1;
}

export function buildReleaseSuiteGroupInvocation(
  groupId: RemediationSuiteGroupId,
  reportOutputPath: string
): { executable: string; args: string[] } {
  if (!Object.hasOwn(REMEDIATION_REQUIRED_SUITE_GROUPS, groupId)) throw new Error("suite group is not allowlisted");
  if (!isAbsolute(reportOutputPath)) throw new Error("suite report output path must be absolute");
  return {
    executable: process.execPath,
    args: [
      resolve(repositoryRoot, "node_modules/vitest/vitest.mjs"),
      "run",
      "--configLoader", "bundle",
      ...REMEDIATION_REQUIRED_SUITE_GROUPS[groupId],
      "--reporter=json",
      `--outputFile=${reportOutputPath}`
    ]
  };
}

export function assertTraceExecutionsCoveredBySuiteReports(
  traceSet: Pick<AcceptanceTraceSetV1, "traces">,
  suiteExecutions: readonly ParsedAcceptanceExecution[]
): void {
  const statusByKey = new Map<string, Set<string>>();
  for (const execution of suiteExecutions) {
    const key = `${execution.testFile}\0${execution.fullName}`;
    const statuses = statusByKey.get(key) ?? new Set<string>();
    statuses.add(execution.status);
    statusByKey.set(key, statuses);
  }
  for (const trace of traceSet.traces) {
    const statuses = statusByKey.get(`${trace.testFile}\0${trace.fullName}`);
    if (!statuses || statuses.size !== 1 || !statuses.has("passed")) {
      throw new Error(`${trace.acceptanceId} exact file/fullName was not observed passed in executed suite reports`);
    }
  }
}

async function readRequiredSuiteExecutions(root: string, candidateSha: string): Promise<ParsedAcceptanceExecution[]> {
  const executions: ParsedAcceptanceExecution[] = [];
  for (const groupId of Object.keys(REMEDIATION_REQUIRED_SUITE_GROUPS) as RemediationSuiteGroupId[]) {
    const reportBytes = await readSafeArtifactFile(root, `suite-${groupId}.vitest.json`);
    const report = parseJson(reportBytes);
    const evidenceBytes = await readSafeArtifactFile(root, `suite-${groupId}.evidence.json`);
    validateReleaseSuiteGroupEvidence(parseJson(evidenceBytes), { groupId, candidateSha, report, reportBytes });
    executions.push(...parseVitestJsonReport(report, "passed"));
  }
  return executions;
}

export async function executeReleaseSuiteGroup(options: {
  groupId: RemediationSuiteGroupId;
  candidateSha: string;
  artifactRoot: string;
}): Promise<ReleaseSuiteGroupEvidenceV1> {
  const root = await resolveExternalArtifactRoot(options.artifactRoot);
  const reportPath = join(root, `suite-${options.groupId}.vitest.json`);
  try {
    await lstat(reportPath);
    throw new Error("suite report output already exists");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const invocation = buildReleaseSuiteGroupInvocation(options.groupId, reportPath);
  const suiteEnvironment = buildReleaseSuiteEnvironment(process.env, {
    expectedTestDatabase: SUITE_TEST_DATABASES[options.groupId]
  });
  const child = spawnSync(invocation.executable, invocation.args, {
    cwd: repositoryRoot,
    env: suiteEnvironment,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 30 * 60_000,
    maxBuffer: MAX_ARTIFACT_BYTES
  });
  if (child.error || child.signal || child.status === null) throw new Error("suite process did not terminate normally");
  const reportBytes = await readSafeArtifactFile(root, `suite-${options.groupId}.vitest.json`);
  const report = parseJson(reportBytes);
  const evidence = buildReleaseSuiteGroupEvidence({
    groupId: options.groupId,
    candidateSha: options.candidateSha,
    exitCode: child.status,
    report,
    reportBytes
  });
  await writeFile(join(root, `suite-${options.groupId}.evidence.json`), `${JSON.stringify(evidence)}\n`, { flag: "wx" });
  return evidence;
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function sameArtifactPath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

type ArtifactFileStat = {
  isFile(): boolean;
  isSymbolicLink?: () => boolean;
  size: number;
  dev?: number | bigint;
  ino?: number | bigint;
};

export type ArtifactReadDependencies = {
  lstat(path: string): Promise<ArtifactFileStat>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: number): Promise<{
    stat(): Promise<ArtifactFileStat>;
    readFile(): Promise<Buffer>;
    close(): Promise<void>;
  }>;
};

const defaultArtifactReadDependencies: ArtifactReadDependencies = { lstat, realpath, open };

function sameFileIdentity(left: ArtifactFileStat, right: ArtifactFileStat): boolean {
  return left.dev !== undefined && left.ino !== undefined && right.dev !== undefined && right.ino !== undefined
    && left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

export async function resolveExternalArtifactRoot(input: string): Promise<string> {
  if (!input.trim()) throw new Error("artifact root is required");
  const requested = resolve(input);
  const metadata = await lstat(requested);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("artifact root must be a real directory");
  const physical = resolve(await realpath(requested));
  if (!sameArtifactPath(physical, requested)) throw new Error("artifact root cannot traverse a symlink");
  if (isInside(repositoryRoot, physical)) throw new Error("artifact root must be outside the repository");
  return physical;
}

export async function readSafeArtifactFile(root: string, relativePath: string): Promise<Buffer> {
  return readSafeArtifactFileWithDependencies(root, relativePath, defaultArtifactReadDependencies);
}

async function readSafeGateEvidenceFile(
  root: string,
  relativePath: string,
  kind: string
): Promise<GateEvidencePayloadV2> {
  if (kind !== "production_backup_dump" && kind !== "production_backup_restore_list") {
    return readSafeArtifactFile(root, relativePath);
  }
  if (!relativePath || isAbsolute(relativePath)) throw new Error("artifact path must be relative");
  const target = resolve(root, relativePath);
  if (!isInside(root, target) || target === root) throw new Error("artifact path escapes its root");
  const maxBytes = kind === "production_backup_dump" ? 1024 ** 4 : 100 * 1024 * 1024;
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > maxBytes) {
    throw new Error("artifact must be a bounded regular file");
  }
  const physical = resolve(await realpath(target));
  if (!isInside(root, physical) || !sameArtifactPath(physical, target)) {
    throw new Error("artifact path traverses a symlink or escapes its root");
  }
  const handle = await open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileIdentity(metadata, opened) || opened.size !== metadata.size) {
      throw new Error("artifact identity changed before read");
    }
    const digest = createHash("sha256");
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < opened.size) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, opened.size - position), position);
      if (bytesRead <= 0) throw new Error("artifact identity changed during read");
      digest.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (!sameFileIdentity(opened, after) || after.size !== opened.size
        || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new Error("artifact identity changed during read");
    }
    return { byteLength: opened.size, sha256: digest.digest("hex") };
  } finally {
    await handle.close();
  }
}

export async function readSafeArtifactFileWithDependencies(
  root: string,
  relativePath: string,
  dependencies: ArtifactReadDependencies
): Promise<Buffer> {
  if (!relativePath || isAbsolute(relativePath)) throw new Error("artifact path must be relative");
  const target = resolve(root, relativePath);
  if (!isInside(root, target) || target === root) throw new Error("artifact path escapes its root");
  const metadata = await dependencies.lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink?.()) throw new Error("artifact must be a regular file");
  if (metadata.size > MAX_ARTIFACT_BYTES) throw new Error("artifact exceeds the size limit");
  const physical = resolve(await dependencies.realpath(target));
  if (!isInside(root, physical) || !sameArtifactPath(physical, target)) {
    throw new Error("artifact path traverses a symlink or escapes its root");
  }
  const handle = await dependencies.open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileIdentity(metadata, opened) || opened.size > MAX_ARTIFACT_BYTES) {
      throw new Error("artifact identity changed before read");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFileIdentity(opened, after) || bytes.length !== after.size) throw new Error("artifact identity changed during read");
    return bytes;
  } finally {
    await handle.close();
  }
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("artifact is not valid JSON");
  }
}

async function artifactHash(root: string, relativePath: string): Promise<string> {
  return createHash("sha256").update(await readSafeArtifactFile(root, relativePath)).digest("hex");
}

export function validateOfflineSchemaArtifactSet(candidateSha: string, cleanBytes: Buffer, cloneBytes: Buffer): void {
  const clean = parseJson(cleanBytes);
  const clone = parseJson(cloneBytes);
  const cleanFingerprint = requiredStringField(clean, "databaseFingerprintSha256");
  const cloneFingerprint = requiredStringField(clone, "databaseFingerprintSha256");
  if (cleanFingerprint === cloneFingerprint) throw new Error("clean and clone schema fingerprints must differ");
  validateSchemaEvidenceForRehearsal(clean, {
    candidateSha,
    databaseRole: "clean",
    databaseFingerprintSha256: cleanFingerprint
  });
  validateSchemaEvidenceForRehearsal(clone, {
    candidateSha,
    databaseRole: "production_clone",
    databaseFingerprintSha256: cloneFingerprint
  });
}

type RuntimeArtifactSetBytes = {
  runtime: Buffer;
  rollback: Buffer;
  terminal: Buffer;
  runtimeSchema: Buffer;
  productionCloneSchema: Buffer;
  candidateStart: Buffer;
  previousStart: Buffer;
  task0b: Buffer;
  operationalObservation: Buffer;
  operationalSubprocessCaptures: Buffer;
  operationalQueryCaptures: Buffer;
  operationalConfig: Buffer;
};

function requiredStringField(value: unknown, field: string): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} source is invalid`);
  const result = (value as Record<string, unknown>)[field];
  if (typeof result !== "string") throw new Error(`${field} is invalid`);
  return result;
}

export function validateRuntimeArtifactSet(
  candidateSha: string,
  bytes: RuntimeArtifactSetBytes,
  evaluatedAt: string = new Date().toISOString()
): void {
  const runtimeSchema = parseJson(bytes.runtimeSchema);
  const productionCloneSchema = parseJson(bytes.productionCloneSchema);
  const candidateStart = parseJson(bytes.candidateStart);
  const previousStart = parseJson(bytes.previousStart);
  const task0b = validateTask0BReleaseFreezeEvidence(parseJson(bytes.task0b), candidateSha, evaluatedAt);
  validateControlledRuntimeOperationalConfig(bytes.operationalConfig, task0b);
  if (requiredStringField(previousStart, "runtimeSha") !== task0b.previousRuntimeSha
      || requiredStringField(previousStart, "runtimeLabel") !== task0b.previousRuntimeLabel
      || requiredStringField(runtimeSchema, "databaseFingerprintSha256") !== task0b.databaseFingerprintSha256) {
    throw new Error("runtime artifacts do not match Task0B release freeze");
  }
  validateSchemaEvidenceForRehearsal(productionCloneSchema, {
    candidateSha,
    databaseRole: "production_clone",
    databaseFingerprintSha256: requiredStringField(productionCloneSchema, "databaseFingerprintSha256")
  });
  const expected = buildRuntimeRehearsalExpectedFromArtifactBytes({
    candidateSha,
    previousRuntimeSha: requiredStringField(previousStart, "runtimeSha"),
    sanitizedDatabaseFingerprintSha256: requiredStringField(runtimeSchema, "databaseFingerprintSha256"),
    productionCloneDatabaseFingerprintSha256: requiredStringField(productionCloneSchema, "databaseFingerprintSha256"),
    schemaEvidenceBytes: bytes.runtimeSchema,
    candidateStartEvidenceBytes: bytes.candidateStart,
    previousStartEvidenceBytes: bytes.previousStart,
    candidateRuntimeLabel: requiredStringField(candidateStart, "runtimeLabel"),
    previousRuntimeLabel: requiredStringField(previousStart, "runtimeLabel")
  });
  validateControlledRuntimeRehearsalProvenance(parseJson(bytes.operationalObservation), {
    candidateSha,
    previousRuntimeSha: task0b.previousRuntimeSha,
    candidateRuntimeLabel: requiredStringField(candidateStart, "runtimeLabel"),
    previousRuntimeLabel: task0b.previousRuntimeLabel
  }, {
    subprocessCaptureBytes: bytes.operationalSubprocessCaptures,
    queryCaptureBytes: bytes.operationalQueryCaptures
  });
  const derived = deriveControlledRuntimeEvidence(
    expected,
    parseJson(bytes.operationalQueryCaptures) as unknown as ControlledRuntimeQueryCapturesV1
  );
  if (!bytes.runtime.equals(derived.runtimeEvidenceBytes) || !bytes.rollback.equals(derived.rollbackEvidenceBytes)) {
    throw new Error("runtime and rollback evidence must be executor-derived from captured observations");
  }
  const runtime = validateRuntimeRehearsalEvidence(parseJson(bytes.runtime), expected);
  const rollback = validateRollbackRehearsalEvidence(parseJson(bytes.rollback), expected);
  const terminal = validateTerminalLegacyPopulation(parseJson(bytes.terminal));
  if (terminal.candidateSha !== candidateSha || runtime.candidateSha !== candidateSha || rollback.candidateSha !== candidateSha) {
    throw new Error("runtime artifact candidate SHA mismatch");
  }
  const task0bHash = createHash("sha256").update(bytes.task0b).digest("hex");
  if (terminal.cutoff !== task0b.freezeCutoff || terminal.task0bEvidenceSha256 !== task0bHash
      || terminal.databaseFingerprintSha256 !== task0b.databaseFingerprintSha256) {
    throw new Error("terminal legacy population does not match Task0B release freeze");
  }
  assertTerminalLegacyPopulationUnchanged(terminal, rollback.terminalLegacyPopulationBefore);
}

async function verifyConcreteArtifactBindings(
  root: string,
  manifest: ReturnType<typeof validateRemediationReleaseManifest>,
  traceBytes: Buffer
): Promise<void> {
  const outputs = new Map<ReleaseGateId, ReleaseGateOutputV1>();
  for (const gate of manifest.gates) {
    if (gate.state === "pending") continue;
    const bytes = await readSafeArtifactFile(root, `gates/${gate.id}.json`);
    outputs.set(gate.id, validateReleaseGateOutput(bytes, gate));
  }
  const requireEvidence = (gateId: ReleaseGateId, hash: string): void => {
    const output = outputs.get(gateId);
    if (output && !output.evidenceSha256s.includes(hash)) throw new Error(`${gateId} does not bind its concrete evidence`);
  };
  requireEvidence("G01_TRACE", createHash("sha256").update(traceBytes).digest("hex"));

  const linked: Array<[ReleaseGateId, string, string | null]> = [
    ["G05_TELEGRAM", "manual-telegram-acceptance.json", manifest.manualTelegramEvidenceSha256],
    ["G07_SCHEMA_OFFLINE", "schema-production-clone-evidence.json", manifest.migrationEvidenceSha256],
    ["G10_ROLLBACK_REHEARSAL", "rollback-rehearsal.json", manifest.rollbackEvidenceSha256]
  ];
  for (const [gateId, filename, expectedHash] of linked) {
    if (expectedHash === null || !outputs.has(gateId)) continue;
    const actualHash = await artifactHash(root, filename);
    if (actualHash !== expectedHash) throw new Error(`${gateId} linked artifact hash mismatch`);
    requireEvidence(gateId, actualHash);
  }

  if (outputs.has("G05_TELEGRAM")) {
    await validateManualTelegramArtifactForRelease(root, manifest.candidateSha);
  }

  if (outputs.has("G07_SCHEMA_OFFLINE")) {
    const clean = await readSafeArtifactFile(root, "schema-clean-evidence.json");
    const clone = await readSafeArtifactFile(root, "schema-production-clone-evidence.json");
    validateOfflineSchemaArtifactSet(manifest.candidateSha, clean, clone);
    requireEvidence("G07_SCHEMA_OFFLINE", createHash("sha256").update(clean).digest("hex"));
    requireEvidence("G07_SCHEMA_OFFLINE", createHash("sha256").update(clone).digest("hex"));
  }

  const fixedEvidence: Array<[ReleaseGateId, string]> = [
    ["G00_BASE", "task0-baseline.json"],
    ["G06_FULL", "full-regression-evidence.json"],
    ["G08_VERSION_SANITIZED", "runtime-rehearsal.json"],
    ["G09_LEGACY_TERMINAL", "terminal-legacy-population.json"]
  ];
  for (const [gateId, filename] of fixedEvidence) {
    if (!outputs.has(gateId)) continue;
    const bytes = await readSafeArtifactFile(root, filename);
    if (gateId === "G06_FULL") {
      validateNonVitestReleaseEvidence(parseJson(bytes), {
        candidateSha: manifest.candidateSha,
        planBaseSha: manifest.planBaseSha
      });
    }
    if (gateId === "G00_BASE") {
      validateTask0BaselineEvidence(parseJson(bytes), manifest.candidateSha, {
        isAncestor: isVerifiedGitAncestor
      });
    }
    requireEvidence(gateId, createHash("sha256").update(bytes).digest("hex"));
  }

  if (outputs.has("G08_VERSION_SANITIZED") || outputs.has("G09_LEGACY_TERMINAL") || outputs.has("G10_ROLLBACK_REHEARSAL")) {
    const runtimeArtifacts: RuntimeArtifactSetBytes = {
      runtime: await readSafeArtifactFile(root, "runtime-rehearsal.json"),
      rollback: await readSafeArtifactFile(root, "rollback-rehearsal.json"),
      terminal: await readSafeArtifactFile(root, "terminal-legacy-population.json"),
      runtimeSchema: await readSafeArtifactFile(root, "schema-runtime-sanitized-evidence.json"),
      productionCloneSchema: await readSafeArtifactFile(root, "schema-production-clone-evidence.json"),
      candidateStart: await readSafeArtifactFile(root, "runtime-candidate-start-evidence.json"),
      previousStart: await readSafeArtifactFile(root, "runtime-previous-start-evidence.json"),
      task0b: await readSafeArtifactFile(root, "task0b-release-freeze.json"),
      operationalObservation: await readSafeArtifactFile(root, "runtime-operational-observation.json"),
      operationalSubprocessCaptures: await readSafeArtifactFile(root, "runtime-subprocess-captures.json"),
      operationalQueryCaptures: await readSafeArtifactFile(root, "runtime-query-captures.json"),
      operationalConfig: await readSafeArtifactFile(root, "runtime-operational-config.json")
    };
    validateRuntimeArtifactSet(manifest.candidateSha, runtimeArtifacts);
    const support: Array<[ReleaseGateId, Buffer[]]> = [
      ["G08_VERSION_SANITIZED", [runtimeArtifacts.runtime, runtimeArtifacts.runtimeSchema, runtimeArtifacts.productionCloneSchema, runtimeArtifacts.candidateStart, runtimeArtifacts.previousStart, runtimeArtifacts.task0b, runtimeArtifacts.operationalObservation, runtimeArtifacts.operationalSubprocessCaptures, runtimeArtifacts.operationalQueryCaptures, runtimeArtifacts.operationalConfig]],
      ["G09_LEGACY_TERMINAL", [runtimeArtifacts.terminal, runtimeArtifacts.task0b]],
      ["G10_ROLLBACK_REHEARSAL", [runtimeArtifacts.rollback, runtimeArtifacts.runtimeSchema, runtimeArtifacts.candidateStart, runtimeArtifacts.previousStart, runtimeArtifacts.terminal, runtimeArtifacts.task0b, runtimeArtifacts.operationalObservation, runtimeArtifacts.operationalSubprocessCaptures, runtimeArtifacts.operationalQueryCaptures, runtimeArtifacts.operationalConfig]]
    ];
    for (const [gateId, artifacts] of support) {
      if (!outputs.has(gateId)) continue;
      for (const artifact of artifacts) requireEvidence(gateId, createHash("sha256").update(artifact).digest("hex"));
    }
  }

  const suiteGates: Array<[ReleaseGateId, RemediationSuiteGroupId]> = [
    ["G02_DATA", "plan1"],
    ["G03_SCORING", "plan2"],
    ["G04_RUNTIME", "plan3"],
    ["G05_TELEGRAM", "plan4"],
    ["G06_FULL", "plan5"],
    ["G11_POISONING_REGRESSION", "addressPoisoningRegression"]
  ];
  for (const [gateId, groupId] of suiteGates) {
    if (outputs.has(gateId)) {
      requireEvidence(gateId, await artifactHash(root, `suite-${groupId}.vitest.json`));
      requireEvidence(gateId, await artifactHash(root, `suite-${groupId}.evidence.json`));
    }
  }
}

export async function validateManualTelegramArtifactForRelease(
  artifactRoot: string,
  candidateSha: string
): Promise<void> {
  const databaseUrl = process.env.PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL;
  if (!databaseUrl) throw new Error("PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL is required for manual Telegram verification");
  const bytes = await readSafeArtifactFile(artifactRoot, "manual-telegram-acceptance.json");
  const raw = parseJson(bytes) as {
    scenarioSummaries?: Array<{ runtimeLabel?: unknown }>;
  };
  const api = await import("./finalizeTelegramAcceptance");
  const candidateStartBytes = await readSafeArtifactFile(artifactRoot, "runtime-candidate-start-evidence.json");
  const candidateStart = parseJson(candidateStartBytes);
  const runtimeLabel = requiredStringField(candidateStart, "runtimeLabel");
  if (requiredStringField(candidateStart, "runtimeSha") !== candidateSha ||
      raw.scenarioSummaries?.[0]?.runtimeLabel !== runtimeLabel) {
    throw new Error("manual Telegram runtime label does not match candidate start evidence");
  }
  const runBytes = await readSafeArtifactFile(artifactRoot, "manual-telegram-candidate-run.json");
  const run = api.validateManualTelegramCandidateRun(parseJson(runBytes), candidateSha, runtimeLabel);
  const task0bEvidence = parseJson(await readSafeArtifactFile(artifactRoot, "task0b-release-freeze.json"));
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await api.verifyManualTelegramCandidateJobs(db, run, {
      task0bEvidence,
      candidateStartEvidence: candidateStart,
      evaluatedAt: new Date().toISOString(),
      databaseUrl
    });
    await api.finalizeManualTelegramAcceptance(raw, {
      candidateSha,
      runtimeLabel,
      goldenIds: MANUAL_TELEGRAM_ACCEPTANCE_CASES.flatMap((item) => item.goldenIds),
      candidateRun: run,
      artifactRoot
    });
  } finally {
    await db.end().catch(() => undefined);
  }
}

function isVerifiedGitAncestor(ownerCommitSha: string, candidateSha: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ownerCommitSha, candidateSha], {
      cwd: repositoryRoot,
      stdio: "ignore",
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

function gateStates(result: SanitizedVerificationResult): Map<ReleaseGateId, ReleaseGateState> {
  return new Map(result.gates.map((gate) => [gate.id, gate.state]));
}

function requireGateState(
  states: ReadonlyMap<ReleaseGateId, ReleaseGateState>,
  ids: readonly ReleaseGateId[],
  allowed: ReadonlySet<ReleaseGateState>
): void {
  if (ids.some((id) => !allowed.has(states.get(id)!))) throw new Error("required release gate is invalid for this phase");
}

export function assertReleaseVerificationPhaseV2(
  result: SanitizedVerificationResult,
  phase: RemediationReleaseVerificationPhase
): void {
  if (result.version !== "remediation-release-manifest-v2") {
    throw new Error("release verification requires manifest V2");
  }
  if (phase === "manifest") return;
  const states = gateStates(result);
  if (phase === "pre-manual") {
    const automated = REMEDIATION_PRE_RELEASE_GATE_IDS.filter((id) => id !== "G05_TELEGRAM");
    requireGateState(states, automated, new Set(["passed"]));
    requireGateState(states, ["G05_TELEGRAM"], new Set(["pending"]));
    requireGateState(states, REMEDIATION_PRODUCTION_GATE_IDS, new Set(["pending"]));
    if (result.transitionId !== "pre_manual" || result.overall !== "not_ready") {
      throw new Error("pre-manual manifest phase is invalid");
    }
    return;
  }
  if (phase === "readiness") {
    requireGateState(states, REMEDIATION_PRE_RELEASE_GATE_IDS, new Set(["passed"]));
    requireGateState(states, REMEDIATION_PRODUCTION_GATE_IDS, new Set(["pending"]));
    if (result.transitionId !== "readiness" || result.overall !== "ready_for_release") {
      throw new Error("readiness phase is invalid");
    }
    return;
  }
  if (phase === "g12" || phase === "g13" || phase === "g14") {
    const passedProductionCount = phase === "g12" ? 1 : phase === "g13" ? 2 : 3;
    requireGateState(states, REMEDIATION_PRE_RELEASE_GATE_IDS, new Set(["passed"]));
    requireGateState(states, REMEDIATION_PRODUCTION_GATE_IDS.slice(0, passedProductionCount), new Set(["passed"]));
    requireGateState(states, REMEDIATION_PRODUCTION_GATE_IDS.slice(passedProductionCount), new Set(["pending"]));
    const transition = phase === "g12" ? "g12_backup_passed"
      : phase === "g13" ? "g13_migration_passed" : "g14_rollout_passed";
    if (result.transitionId !== transition || result.overall !== "not_ready") {
      throw new Error(`${phase} release phase is invalid`);
    }
    return;
  }
  if (phase === "released") {
    requireGateState(states, [...REMEDIATION_PRE_RELEASE_GATE_IDS, ...REMEDIATION_PRODUCTION_GATE_IDS], new Set(["passed"]));
    if (result.transitionId !== "g15_canary_released" || result.overall !== "released") {
      throw new Error("released phase is invalid");
    }
    return;
  }
  if (result.transitionId !== "rollback_rolled_back" || result.overall !== "rolled_back") {
    throw new Error("rolled-back phase is invalid");
  }
}

export async function verifyRemediationReleaseArtifacts(
  artifactRoot: string,
  phase: RemediationReleaseVerificationPhase = "manifest"
): Promise<SanitizedVerificationResult> {
  const root = await resolveExternalArtifactRoot(artifactRoot);
  const manifestBytes = await readSafeArtifactFile(root, REMEDIATION_RELEASE_MANIFEST_FILE);
  const parsedManifest = parseJson(manifestBytes);
  if ((parsedManifest as { version?: unknown }).version === "remediation-release-manifest-v2") {
    const verifiedStore = verifyCurrentReleaseManifestChainV2(root);
    if (!verifiedStore.manifestBytes.equals(manifestBytes)) {
      throw new Error("release manifest V2 store head changed");
    }
    const manifestV2 = validateRemediationReleaseManifestV2(parsedManifest);
    const freezeIdentityPath = "release-freeze-identity-v2.json";
    const artifacts = new Map<string, GateEvidencePayloadV2>([
      [REMEDIATION_RELEASE_MANIFEST_FILE, manifestBytes],
      [freezeIdentityPath, await readSafeArtifactFile(root, freezeIdentityPath)],
      ["task0b-release-freeze.json", await readSafeArtifactFile(root, "task0b-release-freeze.json")]
    ]);
    let lineageCursor = manifestV2;
    while (lineageCursor.revision > 1) {
      if (typeof lineageCursor.previousManifestSha256 !== "string") {
        throw new Error("release manifest V2 source lineage is incomplete");
      }
      const relativePath = `manifest-snapshots/release-manifest-r${lineageCursor.revision - 1}-${lineageCursor.previousManifestSha256}.json`;
      const snapshotBytes = await readSafeArtifactFile(root, relativePath);
      artifacts.set(relativePath, snapshotBytes);
      lineageCursor = validateRemediationReleaseManifestV2(parseJson(snapshotBytes));
    }
    for (const gate of manifestV2.gates) {
      if (gate.state !== "passed" && gate.state !== "failed") continue;
      for (const ref of gate.evidence) artifacts.set(ref.relativePath,
        await readSafeGateEvidenceFile(root, ref.relativePath, ref.kind));
    }
    for (const ref of manifestV2.transitionEvidence) artifacts.set(ref.relativePath,
      await readSafeArtifactFile(root, ref.relativePath));
    const verified = await verifyRemediationReleaseArtifactsV2(artifacts);
    const result: SanitizedVerificationResult = {
      version: verified.version,
      transitionId: verified.transitionId,
      overall: verified.overall,
      gates: verified.gates.map(({ id, state }) => ({ id, state }))
    };
    assertReleaseVerificationPhaseV2(result, phase);
    return result;
  }
  throw new Error("release verification requires manifest V2");
}

function parseCliArgs(argv: readonly string[]): { artifactRoot: string; phase: RemediationReleaseVerificationPhase } {
  const phases: readonly RemediationReleaseVerificationPhase[] = [
    "manifest",
    "pre-manual",
    "readiness",
    "g12",
    "g13",
    "g14",
    "released",
    "rolled-back"
  ];
  // npm 11 strips unknown option names after `npm run ... --`; keep its value-only argv shape compatible with the approved runbook.
  if (argv.length === 1) return { artifactRoot: argv[0], phase: "manifest" };
  if (argv.length === 2 && phases.includes(argv[0] as RemediationReleaseVerificationPhase)) {
    return { artifactRoot: argv[1], phase: argv[0] as RemediationReleaseVerificationPhase };
  }
  let artifactRoot: string | undefined;
  let phase: RemediationReleaseVerificationPhase = "manifest";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--artifact-root" && artifactRoot === undefined) {
      artifactRoot = argv[++index];
      if (!artifactRoot) throw new Error("artifact root is required");
    } else if (argument === "--phase") {
      const value = argv[++index] as RemediationReleaseVerificationPhase | undefined;
      if (!value || !phases.includes(value)) {
        throw new Error("release verification phase is invalid");
      }
      phase = value;
    } else {
      throw new Error("release verifier accepts one explicit artifact root and one optional phase");
    }
  }
  if (!artifactRoot) throw new Error("artifact root is required");
  return { artifactRoot, phase };
}

async function main(): Promise<void> {
  try {
    if (process.argv[2] === "--suite-group") {
      const groupId = process.argv[3] as RemediationSuiteGroupId | undefined;
      const artifactRoot = process.argv[4];
      const candidateSha = process.env.RELEASE_SHA;
      if (!groupId || !artifactRoot || !candidateSha || process.argv.length !== 5) {
        throw new Error("suite runner requires group, artifact root, and RELEASE_SHA");
      }
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true }).trim();
      if (candidateSha !== head) throw new Error("suite candidate SHA is not the checked-out HEAD");
      const result = await executeReleaseSuiteGroup({ groupId, candidateSha, artifactRoot });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    if (process.argv[2] === "--non-vitest") {
      const artifactRoot = process.argv[3];
      const candidateSha = process.env.RELEASE_SHA;
      const planBaseSha = process.env.PLAN5_BASE_SHA;
      if (!artifactRoot || !candidateSha || !planBaseSha || process.argv.length !== 4) {
        throw new Error("non-Vitest runner requires artifact root, RELEASE_SHA, and PLAN5_BASE_SHA");
      }
      if (planBaseSha !== PLAN5_APPROVED_BASE_SHA) throw new Error("non-Vitest runner Plan 5 base is not approved");
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true }).trim();
      if (candidateSha !== head) throw new Error("non-Vitest candidate SHA is not the checked-out HEAD");
      const root = await resolveExternalArtifactRoot(artifactRoot);
      const evidence = await runNonVitestReleaseChecks({ candidateSha, planBaseSha, env: process.env });
      const bytes = Buffer.from(`${JSON.stringify(evidence)}\n`, "utf8");
      await writeFile(join(root, "full-regression-evidence.json"), bytes, { flag: "wx" });
      process.stdout.write(`${JSON.stringify({
        status: "passed",
        commandId: "full_regression",
        evidenceSha256: createHash("sha256").update(bytes).digest("hex")
      })}\n`);
      return;
    }
    const { artifactRoot, phase } = parseCliArgs(process.argv.slice(2));
    const result = await verifyRemediationReleaseArtifacts(artifactRoot, phase);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("remediation_release_invalid\n");
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) void main();
