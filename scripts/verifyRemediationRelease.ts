import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  validateTask0BReleaseRevalidationEvidence,
  type ReleaseArtifactV1,
  type ReleaseGateId,
  type ReleaseGateState,
  validateRemediationReleaseManifest
} from "../src/release/remediationReleaseManifest";
import {
  assertBehavioralRedExecution,
  normalizeAcceptanceTestFile,
  parseVitestJsonReport,
  validateAcceptanceTraceSet
} from "../src/release/acceptanceTrace";
import type {
  AcceptanceTraceDependencies,
  AcceptanceTraceSetV1,
  ParsedAcceptanceExecution
} from "../src/release/acceptanceTrace";
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
  type GateEvidenceKindV2,
  type ReleaseGateIdV2,
  type RemediationReleaseManifestV2
} from "../src/release/remediationReleaseManifestV2";
import type { GateEvidencePayloadV2 } from "../src/release/releaseGateEvidencePolicy";
import { verifyCurrentReleaseManifestChainV2 } from "../src/release/releaseManifestStoreV2";
import {
  PLAN_A_GATE_RECEIPT_RELATIVE_PATH,
  validatePlanAGateReceiptV1,
  validateUnifiedWalletReleaseGateReceiptV1,
  type UnifiedWalletReleaseGateReceiptV1
} from "../src/release/unifiedReleaseGateReceipt";

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
export const NON_VITEST_RELEASE_PROCESS_TIMEOUT_MS = 90 * 60_000;

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
  "docs/knowledge/09-current-decisions.md",
  "docs/knowledge/12-runbooks.md",
  "docs/superpowers/plans/2026-07-17-remediation-end-to-end-acceptance-and-release.md",
  "docs/superpowers/verification/plan5-release/README.md",
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
  "scripts/advanceRemediationReleaseManifest.ts",
  "scripts/executeProductionCanary.ts",
  "scripts/executeProductionRecovery.ts",
  "scripts/executeProductionRollback.ts",
  "scripts/executeProductionRollout.ts",
  "scripts/issueOperationalAttestation.ts",
  "scripts/materializeReleaseFreeze.ts",
  "scripts/productionOperationCliV2.ts",
  "scripts/takeoverCleanupOnlyProductionOperationLease.ts",
  "scripts/takeoverManifestLease.ts",
  "scripts/takeoverProductionOperationLease.ts",
  "scripts/terminalizeExpiredUnclaimedAuthority.ts",
  "src/admin/adminRuntime.ts",
  "src/admin/adminServer.ts",
  "src/approvals/allowanceRefreshWorker.ts",
  "src/forensics/addressIndexWorker.ts",
  "src/forensics/telegramDeliveryWorker.ts",
  "src/release/productionOperationAdaptersV2.ts",
  "src/release/productionOperationStore.ts",
  "src/release/productionReleaseEvidenceV2.ts",
  "src/release/productionReleaseOrchestratorV2.ts",
  "src/release/releaseAuthorityStore.ts",
  "src/release/releaseGateEvidencePolicy.ts",
  "src/release/releaseManifestStore.ts",
  "src/release/releaseManifestStoreV2.ts",
  "src/release/releaseRootWriterStore.ts",
  "src/release/releaseTransitionEvidencePolicy.ts",
  "src/release/remediationReleaseManifestV2.ts",
  "src/release/runtimeEffectReconciliationV2.ts",
  "src/runtime/forensicRuntimeOrchestration.ts",
  "src/runtime/runtimeLiveProof.ts",
  "tests/admin/runtimeProofEndpoint.test.ts",
  "tests/approvals/approvalSafety.postgres.test.ts",
  "tests/approvals/approvalWorker.test.ts",
  "tests/fixtures/telegram/remediationTelegramUxCases.ts",
  "tests/forensics/gasFreeSettlement.test.ts",
  "tests/forensics/moneyOriginOperationalAssessment.test.ts",
  "tests/release/advanceRemediationReleaseManifest.unit.test.ts",
  "tests/release/canaryResumeState.unit.test.ts",
  "tests/release/productionEffectCrashWindow.unit.test.ts",
  "tests/release/productionLiveProof.unit.test.ts",
  "tests/release/productionOperationStore.unit.test.ts",
  "tests/release/productionProtectedOrchestrator.unit.test.ts",
  "tests/release/productionReleaseContractsV2.unit.test.ts",
  "tests/release/productionReleaseEvidence.acceptance.test.ts",
  "tests/release/productionReleaseEvidence.postgres.test.ts",
  "tests/release/recoverySourceIntegrity.unit.test.ts",
  "tests/release/releaseGateEvidencePolicy.unit.test.ts",
  "tests/release/releaseManifestLifecycle.acceptance.test.ts",
  "tests/release/releaseManifestStore.acceptance.test.ts",
  "tests/release/releaseRootWriterStore.unit.test.ts",
  "tests/release/releaseRootWriterTakeoverV2.unit.test.ts",
  "tests/release/remediationReleaseManifestV2.unit.test.ts",
  "tests/release/remediationReleaseManifestV2Bindings.unit.test.ts",
  "tests/release/runtimeAuthorityIdentity.unit.test.ts",
  "tests/release/runtimeEffectReconciliationV2.unit.test.ts",
  "tests/release/runtimeReconciliationIntegration.unit.test.ts",
  "tests/release/runtimeTopologyObserver.unit.test.ts",
  "tests/release/schema032ProductionFailureRoute.unit.test.ts",
  "tests/release/task0bHistoricalManagerLineage.unit.test.ts",
  "tests/runtime/allowanceRefresh.acceptance.test.ts",
  "tests/runtime/runtimeCycleSummaries.test.ts",
  "tests/runtime/runtimeLiveProof.test.ts",
  "tests/runtime/strandedParentRecovery.acceptance.test.ts",
  "tests/runtime/waitReconciliation.acceptance.test.ts",
  "tests/runtime/walletNavigation.acceptance.test.ts",
  "tests/storage/forensicCheckJobs.test.ts",
  "tests/storage/runtimeDelivery.postgres.test.ts",
  "tests/storage/unifiedTelegramCoverage.postgres.test.ts",
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

const UNIFIED_WALLET_CANDIDATE_ALLOWED_PREFIXES = Object.freeze([
  "src/unifiedCheck/",
  "tests/fixtures/golden-v2/",
  "tests/fixtures/unified-check/",
  "tests/golden-v2/",
  "tests/unified-check/",
  "tools/golden-capture-v2/",
  "tools/golden-pilot-v2/"
]);

const UNIFIED_WALLET_CANDIDATE_ALLOWED_PATHS = new Set([
  "docs/audit/2026-07-system-audit/golden-v2/README.md",
  "docs/audit/2026-07-system-audit/golden-v2/case-catalog.json",
  "docs/audit/2026-07-system-audit/golden-v2/comparator-contract.json",
  "docs/audit/2026-07-system-audit/golden-v2/protocol.json",
  "docs/knowledge/02-check-modes.md",
  "docs/knowledge/04-data-sources-tronscan-indexing.md",
  "docs/knowledge/11-glossary.md",
  "docs/superpowers/plans/2026-07-23-tron-usdt-golden-pilot-v2.md",
  "docs/superpowers/plans/2026-07-23-unified-wallet-check.md",
  "docs/superpowers/plans/2026-07-24-unified-wallet-check-adaptive-capacity-fairness.md",
  "docs/superpowers/plans/2026-07-24-unified-wallet-check-durable-ordered-planner.md",
  "docs/superpowers/plans/2026-07-24-unified-wallet-check-observability-benchmark-rollout.md",
  "docs/superpowers/plans/2026-07-24-unified-wallet-check-p0-performance.md",
  "docs/superpowers/plans/2026-07-24-unified-wallet-check-p1-boundaries.md",
  "docs/superpowers/plans/2026-07-24-unified-wallet-check-p2-observability-benchmark.md",
  "docs/superpowers/specs/2026-07-23-unified-wallet-check-golden-pilot-v2-design.md",
  "docs/superpowers/specs/2026-07-24-unified-wallet-check-adaptive-rolling-planner-design.md",
  "docs/superpowers/specs/2026-07-24-unified-wallet-check-traversal-performance-design.md",
  "migrations/033_unified_wallet_check.sql",
  "migrations/034_unified_check_adaptive_planner.sql",
  "scripts/adjudicateTronUsdtGoldenV2.ts",
  "scripts/captureTronUsdtGoldenV2.ts",
  "scripts/compareUnifiedWalletGolden.ts",
  "scripts/generateUnifiedGoldenBindings.ts",
  "scripts/finalizeUnifiedReleaseGates.ts",
  "scripts/runUnifiedReleaseGateCommand.ts",
  "scripts/runSchema032ReleaseSequence.ts",
  "scripts/runUnifiedWalletCanary.ts",
  "scripts/tronUsdtGoldenPilotV2.ts",
  "src/admin/adminConsole.ts",
  "src/admin/forensicsGraph.ts",
  "src/forensics/canonicalJson.ts",
  "src/forensics/telegramDelivery.ts",
  "src/forensics/tronAddressAllTimeIndex.ts",
  "src/risk/scoreAnchorV3.ts",
  "src/risk/scoringPolicyV4.generated.ts",
  "src/risk/scoringSignalMatrixV4.ts",
  "src/release/remediationReleaseManifestV2.ts",
  "src/release/releaseGateEvidencePolicy.ts",
  "src/release/unifiedReleaseGateReceipt.ts",
  "src/runtime/startupSchedule.ts",
  "src/runtime/startupSchemaGate.ts",
  "src/runtime/runtimeVersion.ts",
  "src/storage/repositories.ts",
  "src/storage/schemaMigrations.ts",
  "src/tron/tronscanScheduler.ts",
  "src/tron/tronClient.ts",
  "src/wallet/metrics.ts",
  "tests/admin/adminConsole.test.ts",
  "tests/admin/adminServer.test.ts",
  "tests/forensics/canonicalJson.test.ts",
  "tests/risk/scoreAnchorV3.test.ts",
  "tests/risk/scoringSignalMatrixV4.test.ts",
  "tests/release/releaseGateEvidencePolicy.unit.test.ts",
  "tests/release/schema034VersionedArtifacts.unit.test.ts",
  "tests/release/unifiedReleaseGateReceipt.unit.test.ts",
  "tests/runtime/runtimeVersion033.test.ts",
  "tests/runtime/runtimeVersion034.test.ts",
  "tests/runtime/startupSchedule.test.ts",
  "tests/runtime/startupSchemaGate.test.ts",
  "tests/scripts/schema033Compatibility.test.ts",
  "tests/storage/migration032.postgres.test.ts",
  "tests/storage/migration033.postgres.test.ts",
  "tests/storage/migration034.postgres.test.ts",
  "tests/storage/schemaMigrations.test.ts",
  "tests/storage/unifiedCheck.postgres.test.ts",
  "tests/tron/tronClient.test.ts",
  "tests/tron/tronscanScheduler.test.ts",
  "tests/wallet/metrics.test.ts"
]);

const GOLDEN_V2_LOCKED_CASE_IDS = new Set([
  "blind-history-scope", "blind-incoming-deposit-scope", "blind-route-scope",
  "blind-selected-amount-scope", "blind-wallet-scope", "regression-tbl7", "regression-tqr",
  "synthetic-500-pages", "synthetic-ambiguous-delivery", "synthetic-bybit-plus-hard-evidence",
  "synthetic-dangerous-approval-no-debit", "synthetic-dense-wallet",
  "synthetic-direct-blacklist-1pct", "synthetic-duplicates", "synthetic-dust-spam",
  "synthetic-empty-wallet", "synthetic-key-exhaustion", "synthetic-new-no-usdt",
  "synthetic-one-legitimate-transfer", "synthetic-operational-wallet", "synthetic-reorder",
  "synthetic-restart", "synthetic-unknown-no-pattern", "synthetic-victim-debit"
]);

const GOLDEN_V2_LOCKED_CASE_FILES = new Set([
  "adjudication.json", "neutral-bundle.json", "provenance-manifest.json",
  "reviewer-a.json", "reviewer-b.json", "validator-receipt.json"
]);

function isApprovedGoldenV2Path(path: string): boolean {
  const fixed = new Set([
    "docs/audit/2026-07-system-audit/golden-v2/locked/control/case-catalog.json",
    "docs/audit/2026-07-system-audit/golden-v2/locked/control/comparator-contract.json",
    "docs/audit/2026-07-system-audit/golden-v2/locked/control/protocol.json",
    "docs/audit/2026-07-system-audit/golden-v2/locked/locked-manifest-descriptor.json",
    "docs/audit/2026-07-system-audit/golden-v2/locked/locked-manifest.json"
  ]);
  if (fixed.has(path)) return true;
  const match = /^docs\/audit\/2026-07-system-audit\/golden-v2\/locked\/cases\/([^/]+)\/([^/]+)$/u
    .exec(path);
  return match !== null
    && GOLDEN_V2_LOCKED_CASE_IDS.has(match[1]!)
    && GOLDEN_V2_LOCKED_CASE_FILES.has(match[2]!);
}

const ADDRESS_POISONING_PROTECTED_PATHS = new Set([
  "src/monitor/addressPoisoning.ts", "src/monitor/addressPoisoningWorker.ts", "src/alerts/addressPoisoningAlert.ts",
  "migrations/031_address_poisoning_monitor.sql", "tests/monitor/addressPoisoning.test.ts",
  "tests/monitor/addressPoisoningWorker.test.ts", "tests/alerts/addressPoisoningAlert.test.ts",
  "tests/fixtures/monitor/addressPoisoningCases.ts",
  "docs/superpowers/specs/2026-07-12-tron-usdt-address-poisoning-monitor-design.md",
  "docs/superpowers/plans/2026-07-12-tron-usdt-address-poisoning-monitor.md"
]);

export function validatePlan5CandidateScope(output: string): string[] {
  if (!output) return [];
  if (!output.endsWith("\0")) throw new Error("Plan 5 candidate path framing is invalid");
  const paths = output.slice(0, -1).split("\0");
  if (paths.some((path) => !path)) throw new Error("Plan 5 candidate path framing is invalid");
  for (const path of paths) {
    if (ADDRESS_POISONING_PROTECTED_PATHS.has(path)) throw new Error(`Address Poisoning path changed: ${path}`);
    const unifiedPath = /^[A-Za-z0-9._/-]+$/u.test(path)
      && !/(?:^|\/)\.\.(?:\/|$)/u.test(path)
      && (
        UNIFIED_WALLET_CANDIDATE_ALLOWED_PATHS.has(path)
        || isApprovedGoldenV2Path(path)
        || UNIFIED_WALLET_CANDIDATE_ALLOWED_PREFIXES.some((prefix) =>
          path.startsWith(prefix)
        )
      );
    if (!PLAN5_CANDIDATE_ALLOWED_PATHS.has(path) && !unifiedPath) {
      throw new Error(`unapproved Plan 5 candidate path: ${path}`);
    }
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

export function assertExactDisposableDatabaseUrl(value: string, envName: string, expectedDatabase: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${envName} is not the exact disposable Plan 5 database`);
  }
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if ((parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") || parsed.search || parsed.hash
      || !new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(parsed.hostname)
      || Number(parsed.port || 5432) === 55_999
      || database !== expectedDatabase) throw new Error(`${envName} is not the exact disposable Plan 5 database`);
}

export function buildReleaseSuiteEnvironment(
  source: NodeJS.ProcessEnv,
  options: { expectedTestDatabase?: string } = {}
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  const allowedSensitive = /^(?:TEST_DATABASE_URL|REQUIRE_PLAN[1-5]_POSTGRES|PLAN[1-4]_TEST_DATABASE_URL|PLAN5_SCHEMA_(?:CLEAN|CLONE|RUNTIME_SANITIZED)_DATABASE_URL|PLAN5_SCHEMA_EXPECTED_(?:ENDPOINT|SYSTEM_IDENTIFIER)|PLAN5_TASK0B_TEST_DATABASE_URL)$/;
  const sensitive = /(?:DATABASE_URL|TELEGRAM|BOT(?:_|$)|SERVICE_ADMIN_TG_IDS|TRONSCAN|TRONGRID|TRON_FULLNODE_BASE_URL|RANGE_BASE_URL|EVM_EXPLORER_BASE_URL|DEEPSEEK|OPENAI|ANTHROPIC|LLM|TOKEN|API_KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|PROVIDER)/i;
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || key === "NODE_OPTIONS") continue;
    if (sensitive.test(key) && !allowedSensitive.test(key)) continue;
    if (key === "TEST_DATABASE_URL") {
      if (!options.expectedTestDatabase) throw new Error("TEST_DATABASE_URL has no disposable suite database binding");
      assertExactDisposableDatabaseUrl(value, key, options.expectedTestDatabase);
    } else if (key === "PLAN5_TASK0B_TEST_DATABASE_URL") {
      assertExactDisposableDatabaseUrl(value, key, "tron_watch");
      if (Number(new URL(value).port || 5432) === 55_999) {
        throw new Error(`${key} is not the exact disposable Plan 5 database`);
      }
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

export type ReleaseProcessResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  error?: Error;
};

export type NonVitestReleaseDependencies = {
  run(
    executable: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    cwd: string
  ): ReleaseProcessResult | Promise<ReleaseProcessResult>;
  postgresCleanup(): Promise<Record<string, string[]>>;
};

async function terminateReleaseChildTree(child: ChildProcess): Promise<Error | undefined> {
  if (!child.pid) return undefined;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return undefined;
    } catch (error) {
      try { child.kill("SIGKILL"); } catch { /* report original process-group failure */ }
      return error instanceof Error ? error : new Error(String(error));
    }
  }
  return await new Promise<Error | undefined>((resolveDone) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(killerTimeout);
      resolveDone(error);
    };
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
      shell: false
    });
    const killerTimeout = setTimeout(() => {
      try { killer.kill("SIGKILL"); } catch { /* best effort */ }
      finish(new Error("taskkill timed out"));
    }, 10_000);
    killer.once("error", (error) => finish(error));
    killer.once("close", (status) => finish(status === 0 ? undefined : new Error(`taskkill exited ${status}`)));
  });
}

export async function runBoundedReleaseProcess(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 60 * 60_000,
  cwd = repositoryRoot
): Promise<ReleaseProcessResult> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("release check timeout is invalid");
  return await new Promise<ReleaseProcessResult>((resolveDone) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let terminalError: Error | undefined;
    let closed = false;
    let terminating = false;
    let terminationComplete = false;
    let settled = false;
    let status: number | null = null;
    let signal: NodeJS.Signals | null = null;
    const child = spawn(executable, [...args], {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const finish = () => {
      if (settled || !closed || (terminating && !terminationComplete)) return;
      settled = true;
      clearTimeout(timeout);
      resolveDone({
        status,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        signal,
        error: terminalError
      });
    };
    const terminate = async (error: Error) => {
      if (terminating || closed) return;
      terminating = true;
      terminalError = error;
      clearTimeout(timeout);
      const treeError = await terminateReleaseChildTree(child);
      if (treeError) {
        terminalError = new Error(`${error.message}; process tree termination failed: ${treeError.message}`);
        try { child.kill("SIGKILL"); } catch { /* result remains failed */ }
      }
      terminationComplete = true;
      finish();
    };
    const append = (target: "stdout" | "stderr", chunk: Buffer | string) => {
      if (terminating) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += bytes.length;
      if (outputBytes > MAX_ARTIFACT_BYTES) {
        void terminate(new Error("release check output exceeded limit"));
        return;
      }
      if (target === "stdout") stdoutChunks.push(bytes);
      else stderrChunks.push(bytes);
    };
    child.stdout?.on("data", (chunk: Buffer | string) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer | string) => append("stderr", chunk));
    child.once("error", (error) => {
      terminalError = error;
      if (!child.pid) {
        closed = true;
        finish();
      }
    });
    child.once("close", (exitStatus, exitSignal) => {
      status = exitStatus;
      signal = exitSignal;
      closed = true;
      finish();
    });
    const timeout = setTimeout(() => {
      void terminate(new Error("release check timed out"));
    }, timeoutMs);
  });
}

function requireDisposableDatabaseUrl(env: NodeJS.ProcessEnv, envName: keyof typeof PLAN5_CLEANUP_DATABASES): string {
  const value = env[envName];
  if (!value) throw new Error(`${envName} is required for PostgreSQL cleanup`);
  const expectedDatabase = PLAN5_CLEANUP_DATABASES[envName];
  assertExactDisposableDatabaseUrl(value, envName, expectedDatabase);
  return value;
}

export function createDefaultNonVitestReleaseDependencies(env: NodeJS.ProcessEnv): NonVitestReleaseDependencies {
  return {
    async run(executable, args, childEnv, cwd) {
      return await runBoundedReleaseProcess(executable, args, childEnv, NON_VITEST_RELEASE_PROCESS_TIMEOUT_MS, cwd);
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
  input: { candidateSha: string; planBaseSha: string; env: NodeJS.ProcessEnv; executionRoot: string },
  dependencies: NonVitestReleaseDependencies = createDefaultNonVitestReleaseDependencies(input.env)
): Promise<NonVitestReleaseEvidenceV1> {
  if (!SHA40.test(input.candidateSha) || input.planBaseSha !== PLAN5_APPROVED_BASE_SHA || input.candidateSha === input.planBaseSha) {
    throw new Error("non-Vitest release base or candidate SHA is invalid");
  }
  if (!isAbsolute(input.executionRoot)) throw new Error("non-Vitest candidate snapshot root is invalid");
  const environment = buildReleaseSuiteEnvironment(input.env);
  environment.DOTENV_CONFIG_PATH = resolve(input.executionRoot, "tests/fixtures/release/plan5-no-dotenv");
  const ancestry = await dependencies.run(
    "git",
    ["merge-base", "--is-ancestor", PLAN5_APPROVED_BASE_SHA, input.candidateSha],
    environment,
    repositoryRoot
  );
  if (ancestry.error || ancestry.signal || ancestry.status !== 0) throw new Error("approved Plan 5 base is not a candidate ancestor");
  const npmExecutable = process.platform === "win32" ? process.execPath : "npm";
  const npmArgs = process.platform === "win32"
    ? [resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")]
    : [];
  const commands: Array<{ checkId: Exclude<NonVitestReleaseCheckId, "postgres_cleanup">; executable: string; args: string[]; requireEmpty: boolean }> = [
    { checkId: "typecheck", executable: npmExecutable, args: [...npmArgs, "run", "typecheck"], requireEmpty: false },
    {
      checkId: "full_test",
      executable: process.execPath,
      args: [
        resolve(input.executionRoot, "node_modules/vitest/vitest.mjs"),
        "run",
        "--configLoader",
        "bundle",
        "--no-file-parallelism",
        "--testTimeout=300000",
        "--hookTimeout=300000"
      ],
      requireEmpty: false
    },
    { checkId: "diff_check", executable: "git", args: ["diff", "--check", `${input.planBaseSha}..${input.candidateSha}`], requireEmpty: true },
    {
      checkId: "forbidden_scope",
      executable: "git",
      args: ["diff", "--name-only", "--no-renames", "-z", `${input.planBaseSha}..${input.candidateSha}`],
      requireEmpty: false
    }
  ];
  const checks: NonVitestReleaseEvidenceV1["checks"] = [];
  for (const command of commands) {
    const cwd = command.checkId === "typecheck" || command.checkId === "full_test"
      ? input.executionRoot
      : repositoryRoot;
    const result = await dependencies.run(command.executable, command.args, environment, cwd);
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
  reportOutputPath: string,
  executionRoot = repositoryRoot
): { executable: string; args: string[] } {
  if (!Object.hasOwn(REMEDIATION_REQUIRED_SUITE_GROUPS, groupId)) throw new Error("suite group is not allowlisted");
  if (!isAbsolute(reportOutputPath)) throw new Error("suite report output path must be absolute");
  return {
    executable: process.execPath,
    args: [
      resolve(executionRoot, "node_modules/vitest/vitest.mjs"),
      "run",
      "--configLoader", "bundle",
      "--no-file-parallelism",
      "--testTimeout=120000",
      "--hookTimeout=120000",
      ...REMEDIATION_REQUIRED_SUITE_GROUPS[groupId],
      "--reporter=json",
      `--outputFile=${reportOutputPath}`
    ]
  };
}

export async function runReleaseSuiteInvocation(
  invocation: Readonly<{ executable: string; args: readonly string[] }>,
  executionRoot: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs = 30 * 60_000
): Promise<number> {
  const result = await runBoundedReleaseProcess(
    invocation.executable, invocation.args, environment, timeoutMs, executionRoot
  );
  if (result.error || result.signal || result.status === null) {
    throw new Error(result.error?.message ?? "suite process did not terminate normally");
  }
  assertNoSecretLikeArtifactValues({ stdout: result.stdout, stderr: result.stderr });
  return result.status;
}

export function assertTraceExecutionsCoveredBySuiteReports(
  traceSet: Pick<AcceptanceTraceSetV1, "traces" | "auxiliaryGreen">,
  suiteExecutions: readonly ParsedAcceptanceExecution[]
): void {
  const statusByKey = new Map<string, Set<string>>();
  for (const execution of suiteExecutions) {
    const key = `${execution.testFile}\0${execution.fullName}`;
    const statuses = statusByKey.get(key) ?? new Set<string>();
    statuses.add(execution.status);
    statusByKey.set(key, statuses);
  }
  const required = [
    ...traceSet.traces.map((trace) => ({ label: trace.acceptanceId, testFile: trace.testFile, fullName: trace.fullName })),
    ...traceSet.auxiliaryGreen.map((trace) => ({ label: "AC-33 auxiliary", testFile: trace.testFile, fullName: trace.fullName }))
  ];
  for (const trace of required) {
    const statuses = statusByKey.get(`${trace.testFile}\0${trace.fullName}`);
    if (!statuses || statuses.size !== 1 || !statuses.has("passed")) {
      throw new Error(`${trace.label} exact file/fullName was not observed passed in executed suite reports`);
    }
  }
}

export function validateAcceptanceTraceEvidenceBundle(
  value: unknown,
  candidateSha: string,
  suiteExecutions: readonly ParsedAcceptanceExecution[],
  dependencies: AcceptanceTraceDependencies
): AcceptanceTraceSetV1 {
  const traceSet = validateAcceptanceTraceSet(value, dependencies);
  if (traceSet.candidateSha !== candidateSha) throw new Error("acceptance trace candidate SHA mismatch");
  assertTraceExecutionsCoveredBySuiteReports(traceSet, suiteExecutions);
  return traceSet;
}

export type ReleaseCandidateWorkspaceDependencies = Readonly<{
  readHead(): string;
  readStatus(): string;
}>;

const defaultReleaseCandidateWorkspaceDependencies: ReleaseCandidateWorkspaceDependencies = {
  readHead: () => execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot, encoding: "utf8", windowsHide: true
  }).trim(),
  readStatus: () => execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repositoryRoot, encoding: "utf8", windowsHide: true
  })
};

export function assertReleaseCandidateWorkspaceClean(
  candidateSha: string,
  dependencies: ReleaseCandidateWorkspaceDependencies = defaultReleaseCandidateWorkspaceDependencies
): void {
  if (!SHA40.test(candidateSha) || dependencies.readHead().trim() !== candidateSha) {
    throw new Error("release candidate SHA is not the checked-out HEAD");
  }
  if (dependencies.readStatus().trim() !== "") {
    throw new Error("release evidence execution requires an exact clean worktree");
  }
}

type ImmutableCandidateExecutionSnapshot = Readonly<{
  root: string;
  dispose(): Promise<void>;
}>;

async function createImmutableCandidateExecutionSnapshot(
  candidateSha: string,
  environment: NodeJS.ProcessEnv
): Promise<ImmutableCandidateExecutionSnapshot> {
  if (!SHA40.test(candidateSha)) throw new Error("candidate snapshot SHA is invalid");
  const controlRoot = await mkdtemp(join(tmpdir(), "plan5-candidate-snapshot-"));
  const snapshotRoot = join(controlRoot, "worktree");
  const requireSuccess = (result: ReleaseProcessResult, label: string): void => {
    if (result.error || result.signal || result.status !== 0) throw new Error(`${label} failed`);
  };
  try {
    requireSuccess(await runBoundedReleaseProcess(
      "git", ["clone", "--no-checkout", "--local", "--no-hardlinks", repositoryRoot, snapshotRoot],
      environment, 10 * 60_000, repositoryRoot
    ), "candidate snapshot clone");
    requireSuccess(await runBoundedReleaseProcess(
      "git", ["checkout", "--detach", candidateSha],
      environment, 5 * 60_000, snapshotRoot
    ), "candidate snapshot checkout");
    const snapshotHead = await runBoundedReleaseProcess(
      "git", ["rev-parse", "HEAD"], environment, 60_000, snapshotRoot
    );
    requireSuccess(snapshotHead, "candidate snapshot identity");
    if (snapshotHead.stdout.trim() !== candidateSha) throw new Error("candidate snapshot SHA mismatch");
    const assertSnapshotClean = async (): Promise<void> => {
      const status = await runBoundedReleaseProcess(
        "git", ["status", "--porcelain=v1", "--untracked-files=all"], environment, 60_000, snapshotRoot
      );
      requireSuccess(status, "candidate snapshot status");
      if (status.stdout.trim() !== "") throw new Error("candidate snapshot is not exact and clean");
    };
    await assertSnapshotClean();
    const npmExecutable = process.platform === "win32" ? process.execPath : "npm";
    const npmArgs = process.platform === "win32"
      ? [resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")]
      : [];
    requireSuccess(await runBoundedReleaseProcess(
      npmExecutable, [...npmArgs, "ci", "--no-audit", "--no-fund"],
      environment, 30 * 60_000, snapshotRoot
    ), "candidate dependency installation");
    await assertSnapshotClean();
    return {
      root: snapshotRoot,
      async dispose() {
        const boundary = relative(tmpdir(), controlRoot);
        if (!boundary || boundary.startsWith("..") || isAbsolute(boundary)) {
          throw new Error("candidate snapshot is outside the temporary root");
        }
        await rm(controlRoot, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await rm(controlRoot, { recursive: true, force: true });
    throw error;
  }
}

type ValidatedSuiteGroup = Readonly<{
  reportSha256: string;
  executions: ParsedAcceptanceExecution[];
}>;

async function readRequiredSuiteGroups(
  root: string,
  candidateSha: string
): Promise<ReadonlyMap<RemediationSuiteGroupId, ValidatedSuiteGroup>> {
  const groups = new Map<RemediationSuiteGroupId, ValidatedSuiteGroup>();
  for (const groupId of Object.keys(REMEDIATION_REQUIRED_SUITE_GROUPS) as RemediationSuiteGroupId[]) {
    const reportBytes = await readSafeArtifactFile(root, `suite-${groupId}.vitest.json`);
    const report = parseJson(reportBytes);
    const evidenceBytes = await readSafeArtifactFile(root, `suite-${groupId}.evidence.json`);
    validateReleaseSuiteGroupEvidence(parseJson(evidenceBytes), { groupId, candidateSha, report, reportBytes });
    groups.set(groupId, {
      reportSha256: createHash("sha256").update(reportBytes).digest("hex"),
      executions: parseVitestJsonReport(report, "passed")
    });
  }
  return groups;
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
  const suiteEnvironment = buildReleaseSuiteEnvironment(process.env, {
    expectedTestDatabase: SUITE_TEST_DATABASES[options.groupId]
  });
  assertReleaseCandidateWorkspaceClean(options.candidateSha);
  const snapshot = await createImmutableCandidateExecutionSnapshot(options.candidateSha, suiteEnvironment);
  let exitCode: number;
  try {
    const invocation = buildReleaseSuiteGroupInvocation(options.groupId, reportPath, snapshot.root);
    const executionEnvironment = {
      ...suiteEnvironment,
      DOTENV_CONFIG_PATH: resolve(snapshot.root, "tests/fixtures/release/plan5-no-dotenv")
    };
    exitCode = await runReleaseSuiteInvocation(invocation, snapshot.root, executionEnvironment);
  } finally {
    await snapshot.dispose();
    assertReleaseCandidateWorkspaceClean(options.candidateSha);
  }
  const reportBytes = await readSafeArtifactFile(root, `suite-${options.groupId}.vitest.json`);
  const report = parseJson(reportBytes);
  const evidence = buildReleaseSuiteGroupEvidence({
    groupId: options.groupId,
    candidateSha: options.candidateSha,
    exitCode,
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
  evaluatedAt: string = new Date().toISOString(),
  currentTask0B?: { evidence: unknown; freeze: unknown }
): void {
  const runtimeSchema = parseJson(bytes.runtimeSchema);
  const productionCloneSchema = parseJson(bytes.productionCloneSchema);
  const candidateStart = parseJson(bytes.candidateStart);
  const previousStart = parseJson(bytes.previousStart);
  const task0b = validateTask0BReleaseFreezeEvidence(
    parseJson(bytes.task0b),
    candidateSha,
    currentTask0B ? undefined : evaluatedAt
  );
  if (currentTask0B) {
    validateTask0BReleaseRevalidationEvidence(
      currentTask0B.evidence,
      task0b,
      currentTask0B.freeze,
      evaluatedAt
    );
  }
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
    const { readCurrentTask0BReleaseRevalidation } = await import("./captureTask0BPreflight");
    const evaluatedAt = new Date().toISOString();
    const currentTask0B = await readCurrentTask0BReleaseRevalidation(root, evaluatedAt);
    if (!runtimeArtifacts.task0b.equals(currentTask0B.frozenBytes)) {
      throw new Error("runtime Task0B artifact differs from current immutable freeze binding");
    }
    validateRuntimeArtifactSet(manifest.candidateSha, runtimeArtifacts, evaluatedAt, currentTask0B);
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
    ["G01_TRACE", "plan4"],
    ["G02_DATA", "plan1"],
    ["G03_SCORING", "plan2"],
    ["G04_RUNTIME", "plan3"],
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

function gateExecuted(manifest: Pick<RemediationReleaseManifestV2, "gates">, gateId: ReleaseGateIdV2): boolean {
  const gate = manifest.gates.find((item) => item.id === gateId);
  return gate?.state === "passed" || gate?.state === "failed";
}

async function readGateEvidenceByKind(
  root: string,
  manifest: Pick<RemediationReleaseManifestV2, "gates">,
  gateId: ReleaseGateIdV2,
  kind: GateEvidenceKindV2,
  expectedRelativePath?: string
): Promise<Buffer> {
  const gate = manifest.gates.find((item) => item.id === gateId);
  const matches = gate && "evidence" in gate ? gate.evidence.filter((ref) => ref.kind === kind) : [];
  if (matches.length !== 1 || (expectedRelativePath !== undefined
      && matches[0]!.relativePath !== expectedRelativePath)) {
    throw new Error(`${gateId} must bind exactly one exact ${kind} artifact`);
  }
  return readSafeArtifactFile(root, matches[0]!.relativePath);
}

export function validateTask8BRedEvidence(value: unknown, report: unknown, reportBytes: Buffer, candidateSha: string): void {
  assertNoSecretLikeArtifactValues(value);
  assertNoSecretLikeArtifactValues(report);
  if (stableJson(parseJson(reportBytes)) !== stableJson(report)) {
    throw new Error("Task 8B RED report bytes do not match the parsed report");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Task 8B RED evidence is invalid");
  }
  const evidence = value as Record<string, unknown>;
  const expectedKeys = [
    "version", "candidateSha", "databaseName", "databasePort", "requirePlan5Postgres",
    "postgresAssertionsExecuted", "skippedPostgresAssertions", "vitestReportSha256", "cleanupDatabaseCount"
  ].sort();
  if (Object.keys(evidence).sort().join("|") !== expectedKeys.join("|")
      || evidence.version !== "task8b-red-evidence-v1"
      || evidence.candidateSha !== candidateSha
      || evidence.databaseName !== "tron_watch_plan5_task8b_red"
      || !Number.isSafeInteger(evidence.databasePort) || Number(evidence.databasePort) <= 0
      || evidence.databasePort === 55999
      || evidence.requirePlan5Postgres !== true
      || !Number.isSafeInteger(evidence.postgresAssertionsExecuted)
      || Number(evidence.postgresAssertionsExecuted) <= 0
      || evidence.skippedPostgresAssertions !== 0
      || evidence.cleanupDatabaseCount !== 0
      || evidence.vitestReportSha256 !== createHash("sha256").update(reportBytes).digest("hex")) {
    throw new Error("Task 8B RED evidence identity or cleanup binding is invalid");
  }
  const executions = parseVitestJsonReport(report, "failed");
  const requiredFiles = [
    "tests/release/releaseManifestLifecycle.acceptance.test.ts",
    "tests/release/releaseManifestStore.acceptance.test.ts",
    "tests/release/productionReleaseEvidence.acceptance.test.ts",
    "tests/release/productionReleaseEvidence.postgres.test.ts"
  ];
  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Task 8B RED report is invalid");
  }
  const rawReport = report as Record<string, unknown>;
  if (!Array.isArray(rawReport.testResults) || rawReport.testResults.length !== requiredFiles.length
      || rawReport.numTotalTests !== executions.length || rawReport.numPendingTests !== 0
      || rawReport.numTodoTests !== 0
      || rawReport.numFailedTests !== executions.filter((execution) => execution.status === "failed").length) {
    throw new Error("Task 8B exact four-file RED report counts are invalid");
  }
  const rawFiles: string[] = [];
  for (const result of rawReport.testResults) {
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("Task 8B exact four-file RED result is invalid");
    }
    const item = result as Record<string, unknown>;
    if (typeof item.name !== "string" || typeof item.message !== "string" || item.message.trim() !== ""
        || !Array.isArray(item.assertionResults) || item.assertionResults.length === 0) {
      throw new Error("Task 8B RED report contains an unclassified suite-level failure");
    }
    rawFiles.push(normalizeAcceptanceTestFile(item.name));
  }
  if (new Set(rawFiles).size !== requiredFiles.length
      || [...requiredFiles].sort().join("|") !== [...rawFiles].sort().join("|")) {
    throw new Error("Task 8B RED report does not contain the exact four-file set");
  }
  if (executions.some((execution) => execution.status === "skipped" || execution.status === "todo"
      || (execution.status !== "failed" && execution.failureMessages.length !== 0))) {
    throw new Error("Task 8B RED report contains skipped, todo, or inconsistent executions");
  }
  const postgresFile = "tests/release/productionReleaseEvidence.postgres.test.ts";
  const postgresExecutions = executions.filter((execution) => execution.testFile === postgresFile);
  if (postgresExecutions.length !== evidence.postgresAssertionsExecuted
      || postgresExecutions.some((execution) => execution.status === "skipped" || execution.status === "todo")) {
    throw new Error("Task 8B PostgreSQL RED execution count or status is invalid");
  }
  const exactFullName = "[REQ-38][TASK8B-PG-RED] runs the frozen PostgreSQL RED case on an exact disposable non-production database with required execution report hash and cleanup";
  const required = postgresExecutions.filter((execution) => execution.fullName === exactFullName);
  if (required.length !== 1 || required[0]!.status !== "failed"
      || required[0]!.failureMessages.length !== 1
      || !/^(?:AssertionError|Error): Plan 5 feature missing:/.test(required[0]!.failureMessages[0]!)) {
    throw new Error("Task 8B exact PostgreSQL behavioral RED is invalid");
  }
  for (const execution of executions.filter((item) => item.status === "failed")) {
    try {
      assertBehavioralRedExecution(execution);
    } catch {
      throw new Error("Task 8B RED report contains an unclassified failure");
    }
    if (execution.failureMessages.length !== 1
        || !/^(?:AssertionError|Error): Plan 5 feature missing:/.test(execution.failureMessages[0]!)) {
      throw new Error("Task 8B RED report contains an unclassified failure");
    }
  }
}

function assertTraceReportBindings(
  traceSet: AcceptanceTraceSetV1,
  groups: ReadonlyMap<RemediationSuiteGroupId, ValidatedSuiteGroup>
): void {
  const allExecutions = [...groups.values()].flatMap((group) => group.executions);
  assertTraceExecutionsCoveredBySuiteReports(traceSet, allExecutions);
  for (const trace of traceSet.traces) {
    const group = groups.get(`plan${trace.ownerPlan}` as RemediationSuiteGroupId);
    if (!group || trace.green.vitestReportSha256 !== group.reportSha256) {
      throw new Error(`${trace.acceptanceId} GREEN report hash is not bound to its exact owner-plan suite`);
    }
    const exact = group.executions.filter((execution) => (
      execution.testFile === trace.testFile && execution.fullName === trace.fullName && execution.status === "passed"
    ));
    if (exact.length !== 1) throw new Error(`${trace.acceptanceId} exact GREEN execution is invalid`);
  }
  const auxiliary = traceSet.auxiliaryGreen[0]!;
  const plan2 = groups.get("plan2");
  if (!plan2 || auxiliary.vitestReportSha256 !== plan2.reportSha256
      || plan2.executions.filter((execution) => execution.testFile === auxiliary.testFile
        && execution.fullName === auxiliary.fullName && execution.status === "passed").length !== 1) {
    throw new Error("AC-33 auxiliary GREEN is not bound to the exact Plan 2 suite report");
  }
}

export async function verifyPreReleaseConcreteEvidenceV2(
  root: string,
  manifest: Pick<RemediationReleaseManifestV2, "candidateSha" | "planBaseSha" | "gates">
): Promise<void> {
  let traceSet: AcceptanceTraceSetV1 | null = null;
  let unifiedRelease: UnifiedWalletReleaseGateReceiptV1 | null = null;
  if (gateExecuted(manifest, "G01_TRACE")) {
    const traceBytes = await readGateEvidenceByKind(
      root, manifest, "G01_TRACE", "acceptance_trace", REMEDIATION_ACCEPTANCE_TRACE_FILE
    );
    const { buildRemediationTestEvidence } = await import("./captureRemediationTestEvidence");
    traceSet = await buildRemediationTestEvidence(root, manifest.candidateSha);
    if (!traceBytes.equals(Buffer.from(`${JSON.stringify(traceSet, null, 2)}\n`, "utf8"))) {
      throw new Error("acceptance trace differs from its concrete capture reports and patches");
    }
    if (traceSet.candidateSha !== manifest.candidateSha) throw new Error("acceptance trace candidate SHA mismatch");
    const task8bBytes = await readGateEvidenceByKind(
      root, manifest, "G01_TRACE", "task8b_red", "task8b-historical-red-evidence-v2.json"
    );
    const task8bReportBytes = await readSafeArtifactFile(root, "task8b-historical-red.vitest.json");
    const task8bReceiptBytes = await readSafeArtifactFile(
      root, "task8b-historical-red-cleanup-receipt-v1.json");
    const task8bGreenBytes = await readSafeArtifactFile(root, "task8b-candidate-green.vitest.json");
    const task8bPatchBytes = await readSafeArtifactFile(root, "task8b-frozen-test.patch");
    const { validateTask8BHistoricalRedEvidenceV2 } = await import("./advanceRemediationReleaseManifest");
    const task8b = validateTask8BHistoricalRedEvidenceV2(parseJson(task8bBytes), {
      candidateSha: manifest.candidateSha,
      redReportBytes: task8bReportBytes,
      historicalReceiptBytes: task8bReceiptBytes,
      greenReportBytes: task8bGreenBytes,
      testPatchBytes: task8bPatchBytes
    });
    if (!isVerifiedGitAncestor(String(task8b.redExecutionSha), String(task8b.frozenTestSha))
        || !isVerifiedGitAncestor(String(task8b.frozenTestSha), String(task8b.ownerCommitSha))
        || !isVerifiedGitAncestor(String(task8b.ownerCommitSha), manifest.candidateSha)) {
      throw new Error("Task 8B historical RED Git lineage is invalid");
    }
    const plan4ReportBytes = await readGateEvidenceByKind(
      root, manifest, "G01_TRACE", "suite_report", "suite-plan4.vitest.json"
    );
    const plan4Report = parseJson(plan4ReportBytes);
    validateReleaseSuiteGroupEvidence(
      parseJson(await readGateEvidenceByKind(
        root, manifest, "G01_TRACE", "suite_evidence", "suite-plan4.evidence.json"
      )),
      { groupId: "plan4", candidateSha: manifest.candidateSha, report: plan4Report, reportBytes: plan4ReportBytes }
    );
  }

  if (gateExecuted(manifest, "G00_BASE")) {
    const { verifyG00TrustArtifactsCurrent } = await import("./advanceRemediationReleaseManifest");
    await verifyG00TrustArtifactsCurrent({ artifactRoot: root });
    validateTask0BaselineEvidence(
      parseJson(await readGateEvidenceByKind(root, manifest, "G00_BASE", "task0_baseline", "task0-baseline.json")),
      manifest.candidateSha,
      { isAncestor: isVerifiedGitAncestor }
    );
  }

  if (gateExecuted(manifest, "G06_FULL")) {
    const planABytes = await readGateEvidenceByKind(
      root, manifest, "G06_FULL", "plan_a_gate_receipt", PLAN_A_GATE_RECEIPT_RELATIVE_PATH
    );
    const planA = validatePlanAGateReceiptV1(parseJson(planABytes), {
      candidateSha: manifest.candidateSha
    }, planABytes);
    for (const [relativePath, expectedSha256] of [
      ["docs/audit/2026-07-system-audit/golden-v2/locked/control/protocol.json",
        planA.artifacts.protocolSha256],
      ["docs/audit/2026-07-system-audit/golden-v2/locked/control/case-catalog.json",
        planA.artifacts.caseCatalogSha256],
      ["docs/audit/2026-07-system-audit/golden-v2/locked/control/comparator-contract.json",
        planA.artifacts.comparatorContractSha256],
      ["docs/audit/2026-07-system-audit/golden-v2/locked/locked-manifest.json",
        planA.artifacts.lockedGoldenManifestSha256],
      ["docs/audit/2026-07-system-audit/golden-v2/locked/locked-manifest-descriptor.json",
        planA.artifacts.lockedManifestDescriptorSha256]
    ] as const) {
      const actual = createHash("sha256").update(await readFile(join(repositoryRoot, relativePath))).digest("hex");
      if (actual !== expectedSha256) throw new Error(`Plan-A locked artifact hash mismatch: ${relativePath}`);
    }
    const unifiedBytes = await readGateEvidenceByKind(
      root, manifest, "G06_FULL", "unified_release_gate_receipt",
      "unified-wallet-release-gate-receipt-v1.json"
    );
    const unifiedValue = parseJson(unifiedBytes) as Record<string, unknown>;
    unifiedRelease = validateUnifiedWalletReleaseGateReceiptV1(unifiedValue, {
      candidateSha: manifest.candidateSha,
      releaseGenerationId: String(unifiedValue.releaseGenerationId ?? ""),
      planAGateReceiptSha256: createHash("sha256").update(planABytes).digest("hex")
    });
    for (const [gateId, groupId] of [
      ["G02_DATA", "plan1"],
      ["G03_SCORING", "plan2"],
      ["G04_RUNTIME", "plan3"],
      ["G11_POISONING_REGRESSION", "addressPoisoningRegression"]
    ] as const) {
      await readGateEvidenceByKind(root, manifest, gateId, "suite_report", `suite-${groupId}.vitest.json`);
      await readGateEvidenceByKind(root, manifest, gateId, "suite_evidence", `suite-${groupId}.evidence.json`);
    }
    await readGateEvidenceByKind(root, manifest, "G06_FULL", "suite_report", "suite-plan5.vitest.json");
    await readGateEvidenceByKind(root, manifest, "G06_FULL", "suite_evidence", "suite-plan5.evidence.json");
    const groups = await readRequiredSuiteGroups(root, manifest.candidateSha);
    if (traceSet === null) throw new Error("full release evidence requires the semantic acceptance trace");
    assertTraceReportBindings(traceSet, groups);
    validateNonVitestReleaseEvidence(
      parseJson(await readGateEvidenceByKind(root, manifest, "G06_FULL", "full_regression", "full-regression-evidence.json")),
      { candidateSha: manifest.candidateSha, planBaseSha: manifest.planBaseSha }
    );
  }

  if (gateExecuted(manifest, "G07_SCHEMA_OFFLINE")) {
    const cleanBytes = await readGateEvidenceByKind(root, manifest, "G07_SCHEMA_OFFLINE", "schema_clean",
      "schema-clean/schema032-release-evidence.json");
    const cloneBytes = await readGateEvidenceByKind(root, manifest, "G07_SCHEMA_OFFLINE", "schema_production_clone",
      "schema-production-clone/schema032-release-evidence.json");
    validateOfflineSchemaArtifactSet(
      manifest.candidateSha,
      cleanBytes,
      cloneBytes
    );
    if (unifiedRelease === null) throw new Error("schema 034 release evidence requires Unified gate receipt");
    const clean = parseJson(cleanBytes) as {
      schema033?: { verificationReceiptSha256?: unknown };
      schema034?: { verificationReceiptSha256?: unknown };
    };
    const clone = parseJson(cloneBytes) as {
      schema033?: { verificationReceiptSha256?: unknown };
      schema034?: { verificationReceiptSha256?: unknown };
    };
    if (clean.schema033?.verificationReceiptSha256
          !== unifiedRelease.schema033.cleanVerificationReceiptSha256
        || clone.schema033?.verificationReceiptSha256
          !== unifiedRelease.schema033.cloneVerificationReceiptSha256
        || clean.schema034?.verificationReceiptSha256
          !== unifiedRelease.schema034.cleanVerificationReceiptSha256
        || clone.schema034?.verificationReceiptSha256
          !== unifiedRelease.schema034.cloneVerificationReceiptSha256) {
      throw new Error("Unified release receipt schema 034 proof mismatch");
    }
  }

  const runtimeBundleComplete = ["G08_VERSION_SANITIZED", "G09_LEGACY_TERMINAL", "G10_ROLLBACK_REHEARSAL"]
    .every((gateId) => gateExecuted(manifest, gateId as ReleaseGateIdV2));
  if (runtimeBundleComplete) {
    const runtimeArtifacts: RuntimeArtifactSetBytes = {
      runtime: await readGateEvidenceByKind(root, manifest,
        "G08_VERSION_SANITIZED", "runtime_rehearsal", "runtime-rehearsal.json"),
      rollback: await readGateEvidenceByKind(root, manifest,
        "G10_ROLLBACK_REHEARSAL", "rollback_rehearsal", "rollback-rehearsal.json"),
      terminal: await readGateEvidenceByKind(root, manifest,
        "G09_LEGACY_TERMINAL", "terminal_legacy_population", "terminal-legacy-population.json"),
      runtimeSchema: await readGateEvidenceByKind(root, manifest,
        "G08_VERSION_SANITIZED", "schema_runtime_sanitized", "schema-runtime-sanitized-evidence.json"),
      productionCloneSchema: await readGateEvidenceByKind(root, manifest,
        "G07_SCHEMA_OFFLINE", "schema_production_clone", "schema-production-clone/schema032-release-evidence.json"),
      candidateStart: await readSafeArtifactFile(root, "runtime-candidate-start-evidence.json"),
      previousStart: await readSafeArtifactFile(root, "runtime-previous-start-evidence.json"),
      task0b: await readSafeArtifactFile(root, "task0b-release-freeze.json"),
      operationalObservation: await readSafeArtifactFile(root, "runtime-operational-observation.json"),
      operationalSubprocessCaptures: await readSafeArtifactFile(root, "runtime-subprocess-captures.json"),
      operationalQueryCaptures: await readSafeArtifactFile(root, "runtime-query-captures.json"),
      operationalConfig: await readSafeArtifactFile(root, "runtime-operational-config.json")
    };
    const { readCurrentTask0BReleaseRevalidation } = await import("./captureTask0BPreflight");
    const evaluatedAt = new Date().toISOString();
    const currentTask0B = await readCurrentTask0BReleaseRevalidation(root, evaluatedAt);
    if (!runtimeArtifacts.task0b.equals(currentTask0B.frozenBytes)) {
      throw new Error("runtime Task0B artifact differs from current immutable freeze binding");
    }
    validateRuntimeArtifactSet(manifest.candidateSha, runtimeArtifacts, evaluatedAt, currentTask0B);
  }

  if (gateExecuted(manifest, "G05_TELEGRAM")) {
    await validateManualTelegramArtifactForRelease(root, manifest.candidateSha);
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
    await verifyPreReleaseConcreteEvidenceV2(root, verified);
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
      assertReleaseCandidateWorkspaceClean(candidateSha);
      const root = await resolveExternalArtifactRoot(artifactRoot);
      const environment = buildReleaseSuiteEnvironment(process.env);
      const snapshot = await createImmutableCandidateExecutionSnapshot(candidateSha, environment);
      let evidence: NonVitestReleaseEvidenceV1;
      try {
        evidence = await runNonVitestReleaseChecks({
          candidateSha,
          planBaseSha,
          env: process.env,
          executionRoot: snapshot.root
        });
      } finally {
        await snapshot.dispose();
      }
      assertReleaseCandidateWorkspaceClean(candidateSha);
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
