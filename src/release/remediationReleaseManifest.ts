import { createHash } from "node:crypto";

export const REMEDIATION_REQUIRED_REQUIREMENT_IDS = numberedIds("REQ", 38);
export const REMEDIATION_REQUIRED_ACCEPTANCE_IDS = numberedIds("AC", 41);
export const PLAN5_APPROVED_BASE_SHA = "4761e1453ea03a96845b68039e6d6f4812aae540";

export const REMEDIATION_PRE_RELEASE_GATE_IDS = [
  "G00_BASE",
  "G01_TRACE",
  "G02_DATA",
  "G03_SCORING",
  "G04_RUNTIME",
  "G05_TELEGRAM",
  "G06_FULL",
  "G07_SCHEMA_OFFLINE",
  "G08_VERSION_SANITIZED",
  "G09_LEGACY_TERMINAL",
  "G10_ROLLBACK_REHEARSAL",
  "G11_POISONING_REGRESSION"
] as const;

export const REMEDIATION_PRODUCTION_GATE_IDS = [
  "G12_PRODUCTION_BACKUP",
  "G13_PRODUCTION_MIGRATION",
  "G14_PRODUCTION_ROLLOUT",
  "G15_PRODUCTION_CANARY"
] as const;

export const REMEDIATION_REQUIRED_GATE_IDS = [
  ...REMEDIATION_PRE_RELEASE_GATE_IDS,
  ...REMEDIATION_PRODUCTION_GATE_IDS
] as const;

export const REMEDIATION_GATE_COMMAND_IDS = {
  G00_BASE: "base_audit",
  G01_TRACE: "acceptance_trace",
  G02_DATA: "plan1_focused",
  G03_SCORING: "plan2_focused",
  G04_RUNTIME: "plan3_focused",
  G05_TELEGRAM: "manual_telegram_acceptance",
  G06_FULL: "full_regression",
  G07_SCHEMA_OFFLINE: "schema_production_clone_rehearsal",
  G08_VERSION_SANITIZED: "runtime_sanitized_rehearsal",
  G09_LEGACY_TERMINAL: "legacy_terminal_population",
  G10_ROLLBACK_REHEARSAL: "rollback_rehearsal",
  G11_POISONING_REGRESSION: "address_poisoning_regression",
  G12_PRODUCTION_BACKUP: "production_backup",
  G13_PRODUCTION_MIGRATION: "production_migration",
  G14_PRODUCTION_ROLLOUT: "production_rollout",
  G15_PRODUCTION_CANARY: "production_canary"
} as const;

export const REMEDIATION_REQUIRED_SUITE_GROUPS = {
  plan1: [
    "tests/forensics/forensicCoverageV2.test.ts",
    "tests/forensics/balanceFormingTransfers.test.ts",
    "tests/forensics/recentFlowProvenanceSelection.test.ts",
    "tests/check/whereIsMoneyCheck.test.ts",
    "tests/forensics/incomingDepositJob.test.ts",
    "tests/check/deepForensicCheck.test.ts",
    "tests/forensics/gasFreeSettlement.test.ts",
    "tests/forensics/usddPsmRouteObservation.test.ts",
    "tests/approvals/allowanceState.test.ts",
    "tests/storage/repositories.test.ts",
    "tests/storage/schemaMigrations.test.ts",
    "tests/storage/migration032.postgres.test.ts",
    "tests/runtime/startupSchemaGate.test.ts"
  ],
  plan2: [
    "tests/risk/scoreAnchorV2.acceptance.test.ts",
    "tests/risk/collectorUsddRemediation.acceptance.test.ts",
    "tests/approvals/approvalSafetyV2.acceptance.test.ts",
    "tests/approvals/approvalSafety.postgres.test.ts",
    "tests/check/contractDecisionV2.acceptance.test.ts",
    "tests/forensics/contractLlmIsolation.acceptance.test.ts",
    "tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts",
    "tests/risk/remediationScoringCompatibility.test.ts",
    "tests/risk/finalDisposition.test.ts",
    "tests/risk/scoringSignalMatrix.test.ts",
    "tests/risk/scoringSignalMatrixInputs.test.ts",
    "tests/risk/unifiedWalletRisk.test.ts",
    "tests/forensics/incomingDepositJob.test.ts",
    "tests/forensics/deepForensicJob.test.ts",
    "tests/approvals/allowanceState.test.ts",
    "tests/approvals/approvalRisk.test.ts",
    "tests/approvals/sessionContext.test.ts",
    "tests/approvals/approvalWorker.test.ts",
    "tests/approvals/safetyRecheck.test.ts",
    "tests/forensics/usddPsmRouteObservation.test.ts",
    "tests/forensics/contractLlmVerdict.test.ts",
    "tests/forensics/moneyOriginOperationalAssessment.test.ts",
    "tests/check/smartContractCheck.test.ts",
    "tests/check/whereIsMoneyCheck.test.ts",
    "tests/bot/createBot.test.ts",
    "tests/alerts/formatters.test.ts",
    "tests/tron/tronClient.test.ts",
    "tests/storage/allowanceCausality.postgres.test.ts"
  ],
  plan3: [
    "tests/runtime/waitReconciliation.acceptance.test.ts",
    "tests/runtime/strandedParentRecovery.acceptance.test.ts",
    "tests/runtime/telegramDelivery.acceptance.test.ts",
    "tests/runtime/walletNavigation.acceptance.test.ts",
    "tests/runtime/checkCallbacks.acceptance.test.ts",
    "tests/runtime/allowanceRefresh.acceptance.test.ts",
    "tests/runtime/runtimeSchemaGateIntegration.acceptance.test.ts",
    "tests/storage/runtimeDelivery.postgres.test.ts",
    "tests/storage/forensicCheckJobs.test.ts",
    "tests/forensics/forensicJobProgress.test.ts",
    "tests/forensics/addressIndexWorker.test.ts",
    "tests/forensics/deepForensicJob.test.ts",
    "tests/forensics/deepSecondLayerRefresh.test.ts",
    "tests/forensics/incomingDepositJob.test.ts",
    "tests/approvals/allowanceState.test.ts",
    "tests/approvals/approvalWorker.test.ts",
    "tests/wallet/dashboard.test.ts",
    "tests/bot/createBot.test.ts"
  ],
  plan4: [
    "tests/telegram/forensicPresentationContract.acceptance.test.ts",
    "tests/telegram/unifiedForensicRenderer.acceptance.test.ts",
    "tests/bot/unifiedTelegramModeWiring.acceptance.test.ts",
    "tests/bot/unifiedTelegramProductionPaths.acceptance.test.ts",
    "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts",
    "tests/telegram/manualTelegramAcceptanceManifest.test.ts",
    "tests/storage/unifiedTelegramCoverage.postgres.test.ts"
  ],
  plan5: [
    "tests/release/remediationReleaseManifest.acceptance.test.ts",
    "tests/release/acceptanceTrace.acceptance.test.ts",
    "tests/release/runtimeVersion.acceptance.test.ts",
    "tests/release/schema032Release.acceptance.test.ts",
    "tests/release/manualTelegramEvidence.acceptance.test.ts",
    "tests/release/terminalLegacyPopulation.acceptance.test.ts",
    "tests/release/rollbackRehearsal.acceptance.test.ts"
  ],
  addressPoisoningRegression: [
    "tests/monitor/addressPoisoning.test.ts",
    "tests/monitor/addressPoisoningWorker.test.ts",
    "tests/alerts/addressPoisoningAlert.test.ts"
  ]
} as const;

export type ReleaseGateId = typeof REMEDIATION_REQUIRED_GATE_IDS[number];
export type ReleaseCommandId =
  | "base_audit"
  | "acceptance_trace"
  | "plan1_focused"
  | "plan2_focused"
  | "plan3_focused"
  | "plan4_focused"
  | "full_regression"
  | "schema_clean_rehearsal"
  | "schema_production_clone_rehearsal"
  | "runtime_sanitized_rehearsal"
  | "manual_telegram_acceptance"
  | "legacy_terminal_population"
  | "rollback_rehearsal"
  | "address_poisoning_regression"
  | "production_backup"
  | "production_migration"
  | "production_rollout"
  | "production_canary";
export type ReleaseGateState = "pending" | "passed" | "failed" | "blocked";
export type ReleaseOverall = "not_ready" | "ready_for_release" | "released" | "rolled_back";

export type ReleaseArtifactV1 = {
  id: ReleaseGateId;
  candidateSha: string;
  commandId: ReleaseCommandId;
  redactedTemplateSha256: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  outputSha256: string;
  state: ReleaseGateState;
};

export type RemediationReleaseManifestV1 = {
  version: "remediation-release-manifest-v1";
  candidateSha: string;
  planBaseSha: string;
  requiredRequirementIds: string[];
  requiredAcceptanceIds: string[];
  gates: ReleaseArtifactV1[];
  manualTelegramEvidenceSha256: string | null;
  migrationEvidenceSha256: string | null;
  rollbackEvidenceSha256: string | null;
  overall: ReleaseOverall;
};

export type Task0BaselineEvidenceV1 = {
  schemaVersion: "plan5-task0-local-baseline-v2";
  generatedAt: string;
  candidate: Record<string, unknown>;
  userState: Record<string, unknown>;
  migration: Record<string, unknown>;
  disposableDatabases: string[];
  runtimeSnapshot: Record<string, unknown>;
  postgresToolsSnapshot: Record<string, unknown>;
  ownerPlans: Array<Record<string, unknown>>;
  traceCoverage: Record<string, unknown>;
  operationalPreflight: Record<string, unknown>;
  secretHandling: Record<string, unknown>;
};

export type Task0BaselineAncestry = {
  isAncestor(ancestorSha: string, candidateSha: string): boolean;
};

export type Task0BReleaseFreezeEvidenceV1 = {
  version: "task0b-release-freeze-evidence-v1";
  candidateSha: string;
  observedAt: string;
  freezeCutoff: string;
  expiresAt: string;
  source: "task0b_direct_operational_preflight";
  operatorConfig: {
    filename: "task0b-preflight-config.json";
    contentSha256: string;
    fileIdentitySha256: string;
    configExpiresAt: string;
    source: "protected_file_handle_direct_read";
    verified: true;
  };
  candidateWorktree: {
    headBeforeSha: string;
    headAfterSha: string;
    worktreePathFingerprintSha256: string;
    cleanBefore: true;
    cleanAfter: true;
    source: "git_direct_read_before_and_after";
    verified: true;
  };
  previousRuntimeSha: string;
  previousRuntimeLabel: string;
  previousRuntimeSource: "runtime_manager_attestation_and_process_direct_read";
  previousRuntimeVerified: true;
  previousRuntimeIdentity: {
    generationId: string;
    runtimeSha: string;
    runtimeLabel: string;
    processId: number;
    processStartedAt: string;
    commandLineSha256: string;
    executablePathSha256: string;
    workingDirectoryFingerprintSha256: string;
    entrypointPathFingerprintSha256: string;
    managerExecutableSha256: string;
    attestedAt: string;
    producerId: "task0b_repo_runtime_manager_v1";
    liveRecheckSha256: string;
    startEvidenceSha256: string;
    commandId: "runtime_manager_previous_identity";
    templateSha256: string;
    exitCode: 0;
    source: "repo_runtime_manager_start_evidence_and_process_direct_read";
    verified: true;
  };
  databaseRole: "runtime_sanitized";
  databaseName: "tron_watch_plan5_runtime_sanitized";
  databaseFingerprintSha256: string;
  operationalConfigPath: "runtime-operational-config.json";
  operationalConfigSha256: string;
  candidateStartCommandId: "runtime_sanitized_rehearsal";
  candidateStartTemplateSha256: string;
  candidateStopCommandId: "runtime_sanitized_stop";
  candidateStopTemplateSha256: string;
  previousStartCommandId: "rollback_rehearsal";
  previousStartTemplateSha256: string;
  previousStopCommandId: "rollback_stop";
  previousStopTemplateSha256: string;
  runtimeManager: {
    source: "repo_owned_runtime_manager_registry_verified";
    executorPath: "scripts/manageTask0BRuntime.ts";
    executorSha256: string;
    producerId: "task0b_repo_runtime_manager_v1";
    candidateAdminUrl: string;
    candidateAdminUrlFingerprintSha256: string;
    startCandidateCommandId: "runtime_manager_start_candidate";
    startCandidateTemplateSha256: string;
    stopCandidateCommandId: "runtime_manager_stop_candidate";
    stopCandidateTemplateSha256: string;
    stopPreviousCommandId: "runtime_manager_stop_previous";
    stopPreviousTemplateSha256: string;
    rollbackPreviousCommandId: "runtime_manager_rollback_previous";
    rollbackPreviousTemplateSha256: string;
    verified: true;
  };
  productionDatabase: {
    name: "tron_watch";
    endpointHostClass: "loopback";
    endpointPort: number;
    endpointFingerprintSha256: string;
    connectedServerPort: number;
    connectedServerAddressFingerprintSha256: string;
    clusterFingerprintSha256: string;
    databaseOidFingerprintSha256: string;
    approvedIdentityFingerprintSha256: string;
    identityMatchedApprovedConfig: true;
    serverVersion: string;
    serverVersionNum: string;
    schemaState: "legacy_031" | "schema_032_verified";
    schema032ReceiptPrestate: {
      state: "absent" | "verified";
      version: 32;
      filename: "032_telegram_runtime_forensics_data_contracts.sql";
      checksumSha256: string | null;
    };
    schemaReceiptSet: {
      count: 0 | 1;
      maxVersion: null | 32;
      aggregateSha256: string;
      source: "postgresql_direct_read_only";
    };
    source: "protected_config_bound_postgresql_direct_read_only";
    verified: true;
  };
  rollbackWorktree: {
    previousRuntimeSha: string;
    headSha: string;
    worktreePathFingerprintSha256: string;
    clean: true;
    source: "git_direct_read";
    verified: true;
  };
  postgresTools: {
    source: "pinned_docker_image_direct_probe";
    verified: true;
    provider: {
      kind: "docker_pinned_image";
      immutableImageId: string;
      immutableImageIdSha256: string;
      networkMode: "none";
      pullAllowed: false;
      source: "external_allowlisted_config_verified";
    };
    pgDump: {
      executableIdentitySha256: string;
      version: string;
      versionProbeExitCode: 0;
      commandId: "postgres_tool_pg_dump_attest";
      templateSha256: string;
    };
    pgRestore: {
      executableIdentitySha256: string;
      version: string;
      versionProbeExitCode: 0;
      commandId: "postgres_tool_pg_restore_attest";
      templateSha256: string;
    };
  };
  artifactRoot: {
    rootFingerprintSha256: string;
    outsideRepository: true;
    noSymlink: true;
    ownerIdentityFingerprintSha256: string;
    accessControlFingerprintSha256: string;
    accessControlSource: "windows_acl_direct_read" | "posix_mode_direct_read";
    restrictiveAccessVerified: true;
    exclusiveWriteVerified: true;
    exclusiveWriteFingerprintSha256: string;
    source: "filesystem_direct_probe";
    verified: true;
  };
  candidatePort: {
    host: "127.0.0.1";
    port: number;
    available: true;
    adminUrlFingerprintSha256: string;
    bindingSource: "protected_runtime_operational_config";
    source: "loopback_bind_probe";
    verified: true;
  };
  observedEffects: {
    runtimeStopCount: 0;
    runtimeStartCount: 0;
    databaseMigrationCount: 0;
    telegramSendCount: 0;
    readOnlyOperationCount: number;
    operationIds: string[];
    operationSequenceSha256: string;
    source: "instrumented_read_only_operation_ledger";
  };
};

type JsonRecord = Record<string, unknown>;

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RELEASE_GATE_STATES = new Set<ReleaseGateState>(["pending", "passed", "failed", "blocked"]);
const RELEASE_OVERALL_STATES = new Set<ReleaseOverall>(["not_ready", "ready_for_release", "released", "rolled_back"]);
const SECRET_ASSIGNMENT = /(?:bot|telegram|api|tronscan|database)?[_\s-]*(?:token|api[_\s-]*key|secret|password|passwd|credential|database[_\s-]*url)\s*[:=]\s*\S+/i;
const RAW_ACTOR_ID = /(?:chat|user)[_\s-]*id\s*[:=]\s*-?\d{5,}/i;
const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;
const TELEGRAM_TOKEN = /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/;
const COMMON_TOKEN = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/;

const REDACTED_COMMAND_TEMPLATES: Record<ReleaseCommandId, string> = {
  base_audit: "release:base-audit <candidate-sha> <plan-base-sha>",
  acceptance_trace: "release:trace:verify <artifact-root>",
  plan1_focused: "release:suite plan1 <artifact-root>",
  plan2_focused: "release:suite plan2 <artifact-root>",
  plan3_focused: "release:suite plan3 <artifact-root>",
  plan4_focused: "release:suite plan4 <artifact-root>",
  full_regression: "npm test && npm run typecheck && git diff --check && release:scope-audit && release:postgres-cleanup",
  schema_clean_rehearsal: "release:schema clean <database-fingerprint>",
  schema_production_clone_rehearsal: "release:schema production_clone <database-fingerprint>",
  runtime_sanitized_rehearsal: "release:runtime runtime_sanitized recording_disabled",
  manual_telegram_acceptance: "release:telegram:manual <artifact-root>",
  legacy_terminal_population: "release:legacy:snapshot <cutoff> <database-fingerprint>",
  rollback_rehearsal: "rollback:start-previous-runtime --db <runtime_sanitized> --telegram recording_disabled",
  address_poisoning_regression: "release:suite addressPoisoningRegression <artifact-root>",
  production_backup: "release:production:backup <database-fingerprint> <protected-artifact-root>",
  production_migration: "release:production:migrate schema-032 <database-fingerprint>",
  production_rollout: "release:production:rollout <candidate-sha> <runtime-label>",
  production_canary: "release:production:canary <candidate-sha> <runtime-label>"
};

export const REMEDIATION_COMMAND_TEMPLATE_SHA256 = Object.freeze(Object.fromEntries(
  Object.entries(REDACTED_COMMAND_TEMPLATES).map(([commandId, template]) => [
    commandId,
    createHash("sha256").update(template, "utf8").digest("hex")
  ])
)) as Readonly<Record<ReleaseCommandId, string>>;

export const REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256 = Object.freeze({
  runtime_sanitized_stop: createHash("sha256").update("release:runtime:stop <candidate-sha> <runtime-label>", "utf8").digest("hex"),
  rollback_stop: createHash("sha256").update("rollback:stop-previous-runtime <previous-sha> <runtime-label>", "utf8").digest("hex")
});

export const TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256 = Object.freeze({
  runtime_manager_start_candidate: createHash("sha256")
    .update("release:task0b:runtime-manager start <artifact-root> <production-go-authority-file>", "utf8").digest("hex"),
  runtime_manager_stop_candidate: createHash("sha256")
    .update("release:task0b:runtime-manager stop <artifact-root> <production-go-authority-file>", "utf8").digest("hex"),
  runtime_manager_stop_previous: createHash("sha256")
    .update("release:task0b:runtime-manager stop <artifact-root> <production-go-authority-file>", "utf8").digest("hex"),
  runtime_manager_rollback_previous: createHash("sha256")
    .update("release:task0b:runtime-manager start <artifact-root> <production-go-authority-file>", "utf8").digest("hex"),
  runtime_manager_previous_identity: createHash("sha256")
    .update("task0b_repo_runtime_manager_v1 start-attestation <pid> <process-started-at> <absolute-entrypoint> <worktree-fingerprint> <sha> <label>", "utf8").digest("hex"),
  postgres_tool_pg_dump_attest: createHash("sha256")
    .update("postgres-tool:attest pg_dump <provider-kind> <immutable-provider-identity>", "utf8").digest("hex"),
  postgres_tool_pg_restore_attest: createHash("sha256")
    .update("postgres-tool:attest pg_restore <provider-kind> <immutable-provider-identity>", "utf8").digest("hex")
});

export const TASK0B_READ_ONLY_OPERATION_IDS = Object.freeze([
  "operator_config_read",
  "candidate_state_read_before",
  "previous_runtime_read_before",
  "sanitized_runtime_binding_read",
  "runtime_manager_registry_read",
  "production_database_read_only",
  "rollback_worktree_read",
  "postgres_tools_read_only",
  "artifact_root_probe",
  "candidate_port_probe",
  "candidate_state_read_after",
  "previous_runtime_read_after"
] as const);

function numberedIds(prefix: "REQ" | "AC", count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`);
}

function normalizedKey(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

function isSecretKey(value: string): boolean {
  const key = normalizedKey(value);
  if (new Set([
    "secret_handling", "secret_values_recorded", "credentials_recorded", "tokens_recorded",
    "api_keys_recorded", "database_url_env"
  ]).has(key)) return false;
  return /(?:^|_)(?:bot_token|telegram_token|api_token|api_key|tronscan_api_key|secret|password|passwd|credential|database_url|chat_id|user_id)(?:_|$)/.test(key);
}

function isSecretString(value: string): boolean {
  return SECRET_ASSIGNMENT.test(value)
    || RAW_ACTOR_ID.test(value)
    || URL_CREDENTIALS.test(value)
    || TELEGRAM_TOKEN.test(value)
    || COMMON_TOKEN.test(value);
}

export function assertNoSecretLikeArtifactValues(value: unknown): void {
  const seen = new WeakSet<object>();
  const visit = (current: unknown, path: string): void => {
    if (typeof current === "string") {
      if (isSecretString(current)) throw new Error(`secret-like value rejected at ${path}`);
      return;
    }
    if (current === null || typeof current !== "object") return;
    if (seen.has(current)) throw new Error(`artifact cycle rejected at ${path}`);
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, item] of Object.entries(current)) {
      if (isSecretKey(key)) throw new Error(`secret-like field rejected at ${path}`);
      visit(item, `${path}.${key}`);
    }
  };
  visit(value, "artifact");
}

function expectRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function expectExactKeys(record: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields do not match the approved contract`);
  }
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function expectSha40(value: unknown, label: string): string {
  const sha = expectString(value, label);
  if (!SHA40.test(sha)) throw new Error(`${label} must be a full lowercase commit SHA`);
  return sha;
}

function expectSha256(value: unknown, label: string): string {
  const hash = expectString(value, label);
  if (!SHA256.test(hash)) throw new Error(`${label} must be a full lowercase SHA-256`);
  return hash;
}

function expectOptionalSha256(value: unknown, label: string): string | null {
  return value === null ? null : expectSha256(value, label);
}

function expectIsoTime(value: unknown, label: string): string {
  const timestamp = expectString(value, label);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new Error(`${label} must be an exact UTC ISO timestamp`);
  }
  return timestamp;
}

function expectRuntimeLabel(value: unknown, sha: string, label: string): string {
  const runtimeLabel = expectString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runtimeLabel) || !runtimeLabel.includes(sha.slice(0, 8))) {
    throw new Error(`${label} does not bind its runtime SHA`);
  }
  return runtimeLabel;
}

export function validateTask0BaselineEvidence(
  value: unknown,
  candidateSha: string,
  ancestry: Task0BaselineAncestry
): Task0BaselineEvidenceV1 {
  assertNoSecretLikeArtifactValues(value);
  const evidence = expectRecord(value, "Task0 baseline evidence");
  expectExactKeys(evidence, [
    "schemaVersion", "generatedAt", "candidate", "userState", "migration", "disposableDatabases",
    "runtimeSnapshot", "postgresToolsSnapshot", "ownerPlans", "traceCoverage", "operationalPreflight",
    "secretHandling"
  ], "Task0 baseline evidence");
  if (evidence.schemaVersion !== "plan5-task0-local-baseline-v2") throw new Error("Task0 baseline schema is invalid");
  const generatedAt = expectString(evidence.generatedAt, "Task0 generatedAt");
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("Task0 generatedAt is invalid");
  const candidate = expectRecord(evidence.candidate, "Task0 candidate");
  expectExactKeys(candidate, [
    "branch", "plan5BaseSha", "branchConfigVerified", "plan4FinalSha", "plan4FinalAncestor",
    "approvedPlan5Commit", "approvedAmendmentCommit", "approvedAmendmentAtHead"
  ], "Task0 candidate");
  const approvedBase = "4761e1453ea03a96845b68039e6d6f4812aae540";
  if (candidate.branch !== "codex/remediation-end-to-end-release"
      || expectSha40(candidate.plan5BaseSha, "Task0 Plan5 base SHA") !== approvedBase
      || candidate.branchConfigVerified !== true
      || expectSha40(candidate.plan4FinalSha, "Task0 Plan4 final SHA") !== "547d86cd6c478ca56e5b85d2ccb31cdbce2ddc17"
      || candidate.plan4FinalAncestor !== true
      || expectSha40(candidate.approvedPlan5Commit, "Task0 approved Plan5 commit") !== "37274b0b5fa1b77c8d87a22856ca903895f9af8c"
      || expectSha40(candidate.approvedAmendmentCommit, "Task0 approved amendment") !== approvedBase
      || candidate.approvedAmendmentAtHead !== true) throw new Error("Task0 candidate binding is invalid");
  expectSha40(candidateSha, "Task0 final candidate SHA");
  if (!ancestry.isAncestor(approvedBase, candidateSha)) throw new Error("Task0 baseline is not an ancestor of candidate");

  const userState = expectRecord(evidence.userState, "Task0 user state");
  expectExactKeys(userState, [
    "canonicalization", "mainStatusCount", "mainManifestSha256", "stashCount", "stashManifestSha256",
    "stashShas", "modified"
  ], "Task0 user state");
  if (userState.canonicalization !== "git-status-short-lines-lf-and-stash-object-shas-lf"
      || userState.mainStatusCount !== 13 || userState.stashCount !== 4 || userState.modified !== false
      || !Array.isArray(userState.stashShas) || userState.stashShas.length !== 4) {
    throw new Error("Task0 user state is invalid");
  }
  expectSha256(userState.mainManifestSha256, "Task0 main manifest");
  expectSha256(userState.stashManifestSha256, "Task0 stash manifest");
  userState.stashShas.forEach((sha, index) => expectSha40(sha, `Task0 stash SHA ${index}`));

  const migration = expectRecord(evidence.migration, "Task0 migration");
  expectExactKeys(migration, ["file", "sha256", "approvedMatch", "migration033OrLater", "uncommittedMigrationChanges"], "Task0 migration");
  if (migration.file !== "032_telegram_runtime_forensics_data_contracts.sql"
      || migration.sha256 !== "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d"
      || migration.approvedMatch !== true || !Array.isArray(migration.migration033OrLater)
      || migration.migration033OrLater.length !== 0 || !Array.isArray(migration.uncommittedMigrationChanges)
      || migration.uncommittedMigrationChanges.length !== 0) throw new Error("Task0 migration is invalid");
  if (JSON.stringify(evidence.disposableDatabases) !== JSON.stringify([
    "tron_watch_plan5_clean", "tron_watch_plan5_clone", "tron_watch_plan5_runtime_sanitized"
  ])) throw new Error("Task0 disposable databases are invalid");

  const runtime = expectRecord(evidence.runtimeSnapshot, "Task0 runtime snapshot");
  expectExactKeys(runtime, [
    "purpose", "previousRuntimeSha", "previousRuntimeShaExistsLocally", "previousRuntimeShaIsCandidateAncestor",
    "runtimeLabel", "databaseName", "databaseHostClass", "databasePort", "databaseListenerObserved",
    "databaseSchemaState", "schema032ReceiptState", "databaseStateSource", "adminUrl", "adminHttpStatus",
    "runtimeProcessObserved", "runtimeCommandShape", "telegramMode", "telegramModeSource",
    "runtimeStoppedOrStartedByTask0", "databaseMutatedByTask0", "telegramMessageSentByTask0",
    "requiresTask0BReverification"
  ], "Task0 runtime snapshot");
  if (runtime.purpose !== "task0a_observation_not_release_preflight"
      || expectSha40(runtime.previousRuntimeSha, "Task0 previous runtime SHA") !== "0172978845ec74373bd245098ee8c075e0c39acf"
      || runtime.runtimeLabel !== "master-01729788" || runtime.databaseName !== "tron_watch"
      || runtime.databaseHostClass !== "loopback" || runtime.databasePort !== 55999
      || runtime.databaseSchemaState !== "legacy_031" || runtime.schema032ReceiptState !== "absent"
      || runtime.adminHttpStatus !== 200 || runtime.telegramMode !== "long_polling"
      || runtime.runtimeStoppedOrStartedByTask0 !== false || runtime.databaseMutatedByTask0 !== false
      || runtime.telegramMessageSentByTask0 !== false || runtime.requiresTask0BReverification !== true) {
    throw new Error("Task0 runtime snapshot is invalid");
  }
  const postgresTools = expectRecord(evidence.postgresToolsSnapshot, "Task0 PostgreSQL tools");
  expectExactKeys(postgresTools, [
    "hostPgDump", "hostPgRestore", "dockerAvailable", "dockerImageId", "pgDumpVersion", "pgRestoreVersion",
    "releaseCommandIdsVerified", "releaseCommandVerificationDeferredTo"
  ], "Task0 PostgreSQL tools");
  if (postgresTools.hostPgDump !== null || postgresTools.hostPgRestore !== null
      || postgresTools.dockerAvailable !== true || typeof postgresTools.dockerImageId !== "string"
      || !/^sha256:[0-9a-f]{64}$/.test(postgresTools.dockerImageId)
      || typeof postgresTools.pgDumpVersion !== "string" || typeof postgresTools.pgRestoreVersion !== "string"
      || postgresTools.releaseCommandIdsVerified !== false
      || postgresTools.releaseCommandVerificationDeferredTo !== "task0b_before_task9") {
    throw new Error("Task0 PostgreSQL tools are invalid");
  }
  if (!Array.isArray(evidence.ownerPlans) || evidence.ownerPlans.length !== 4
      || evidence.ownerPlans.some((plan, index) => plan.plan !== index + 1 || plan.verifiedAncestor !== true)) {
    throw new Error("Task0 owner plans are invalid");
  }
  for (const plan of evidence.ownerPlans) {
    expectExactKeys(plan, ["plan", "base", "test", "implementation", "acceptance", "verifiedAncestor"], "Task0 owner plan");
    for (const key of ["base", "test", "implementation"] as const) expectSha40(plan[key], `Task0 owner plan ${key}`);
    if (typeof plan.acceptance !== "string" || !plan.acceptance) throw new Error("Task0 owner plan acceptance is invalid");
    if (new Set([plan.base, plan.test, plan.implementation, candidateSha]).size !== 4) {
      throw new Error(`Task0 owner plan ${plan.plan} commit order is invalid`);
    }
    if (!ancestry.isAncestor(plan.base, plan.test)
        || !ancestry.isAncestor(plan.test, plan.implementation)
        || !ancestry.isAncestor(plan.implementation, candidateSha)) {
      throw new Error(`Task0 owner plan ${plan.plan} ancestor chain is invalid`);
    }
  }
  const trace = expectRecord(evidence.traceCoverage, "Task0 trace coverage");
  expectExactKeys(trace, [
    "priorAcceptanceIds", "priorPlanCommitTriplesResolvedAtPlanLevel", "exactPerAcRedGreenTrace",
    "ac41Ownership", "ac41RedGreenTrace", "task0aPass"
  ], "Task0 trace coverage");
  if (trace.priorAcceptanceIds !== 40 || trace.priorPlanCommitTriplesResolvedAtPlanLevel !== 40
      || trace.exactPerAcRedGreenTrace !== "pending_tasks_1_through_6" || trace.ac41Ownership !== "plan5"
      || trace.ac41RedGreenTrace !== "pending_tasks_1_through_6" || trace.task0aPass !== true) {
    throw new Error("Task0 trace coverage is invalid");
  }
  const preflight = expectRecord(evidence.operationalPreflight, "Task0 operational preflight");
  expectExactKeys(preflight, [
    "requiredImmediatelyBefore", "status", "requiredFields", "missingAnyFieldBlocksTask9",
    "missingAnyFieldBlocksReadyForRelease"
  ], "Task0 operational preflight");
  if (preflight.requiredImmediatelyBefore !== "task9" || preflight.status !== "pending_not_blocking_tasks_1_through_8"
      || !Array.isArray(preflight.requiredFields) || preflight.requiredFields.length === 0
      || preflight.requiredFields.some((field) => typeof field !== "string" || !field)
      || preflight.missingAnyFieldBlocksTask9 !== true || preflight.missingAnyFieldBlocksReadyForRelease !== true) {
    throw new Error("Task0 operational preflight is invalid");
  }
  const secretHandling = expectRecord(evidence.secretHandling, "Task0 secret handling");
  expectExactKeys(secretHandling, [
    "secretValuesRecorded", "credentialsRecorded", "tokensRecorded", "apiKeysRecorded"
  ], "Task0 secret handling");
  if (Object.values(secretHandling).some((item) => item !== false)) throw new Error("Task0 secret handling is invalid");
  return evidence as Task0BaselineEvidenceV1;
}

export function validateTask0BReleaseFreezeEvidence(
  value: unknown,
  candidateSha?: string,
  evaluatedAt?: string
): Task0BReleaseFreezeEvidenceV1 {
  assertNoSecretLikeArtifactValues(value);
  const evidence = expectRecord(value, "Task0B release freeze evidence");
  expectExactKeys(evidence, [
    "version", "candidateSha", "observedAt", "freezeCutoff", "expiresAt", "source", "operatorConfig", "previousRuntimeSha",
    "previousRuntimeLabel",
    "candidateWorktree", "previousRuntimeSource", "previousRuntimeVerified", "previousRuntimeIdentity",
    "databaseRole", "databaseName", "databaseFingerprintSha256", "operationalConfigPath", "operationalConfigSha256", "candidateStartCommandId",
    "candidateStartTemplateSha256", "candidateStopCommandId", "candidateStopTemplateSha256",
    "previousStartCommandId", "previousStartTemplateSha256", "previousStopCommandId", "previousStopTemplateSha256",
    "runtimeManager", "productionDatabase", "rollbackWorktree", "postgresTools", "artifactRoot", "candidatePort", "observedEffects"
  ], "Task0B release freeze evidence");
  const observedCandidateSha = expectSha40(evidence.candidateSha, "Task0B candidate SHA");
  if (candidateSha !== undefined && observedCandidateSha !== candidateSha) throw new Error("Task0B candidate SHA mismatch");
  const previousSha = expectSha40(evidence.previousRuntimeSha, "Task0B previous runtime SHA");
  expectRuntimeLabel(evidence.previousRuntimeLabel, previousSha, "Task0B previous runtime label");
  expectIsoTime(evidence.observedAt, "Task0B observedAt");
  const cutoff = expectIsoTime(evidence.freezeCutoff, "Task0B freezeCutoff");
  const expiresAt = expectIsoTime(evidence.expiresAt, "Task0B expiresAt");
  const observedAtMs = Date.parse(evidence.observedAt as string);
  if (Date.parse(cutoff) < observedAtMs || Date.parse(expiresAt) < Date.parse(cutoff)
      || Date.parse(expiresAt) - observedAtMs > 15 * 60_000) throw new Error("Task0B validity window is invalid");
  if (evaluatedAt !== undefined) {
    const evaluatedAtMs = Date.parse(expectIsoTime(evaluatedAt, "Task0B evaluatedAt"));
    if (evaluatedAtMs < observedAtMs || evaluatedAtMs > Date.parse(expiresAt)) throw new Error("Task0B release freeze is stale");
  }
  if (evidence.version !== "task0b-release-freeze-evidence-v1"
      || evidence.source !== "task0b_direct_operational_preflight"
      || evidence.previousRuntimeSource !== "runtime_manager_attestation_and_process_direct_read"
      || evidence.previousRuntimeVerified !== true) {
    throw new Error("Task0B direct source is missing or unverified");
  }
  const operatorConfig = expectRecord(evidence.operatorConfig, "Task0B operator config");
  expectExactKeys(operatorConfig, [
    "filename", "contentSha256", "fileIdentitySha256", "configExpiresAt", "source", "verified"
  ], "Task0B operator config");
  if (operatorConfig.filename !== "task0b-preflight-config.json"
      || operatorConfig.source !== "protected_file_handle_direct_read" || operatorConfig.verified !== true
      || Date.parse(expectIsoTime(operatorConfig.configExpiresAt, "Task0B operator config expiry")) < Date.parse(expiresAt)) {
    throw new Error("Task0B operator config binding is unverified or stale");
  }
  expectSha256(operatorConfig.contentSha256, "Task0B operator config content hash");
  expectSha256(operatorConfig.fileIdentitySha256, "Task0B operator config file identity");
  const candidateWorktree = expectRecord(evidence.candidateWorktree, "Task0B candidate worktree");
  expectExactKeys(candidateWorktree, [
    "headBeforeSha", "headAfterSha", "worktreePathFingerprintSha256", "cleanBefore", "cleanAfter", "source", "verified"
  ], "Task0B candidate worktree");
  if (expectSha40(candidateWorktree.headBeforeSha, "Task0B candidate HEAD before") !== observedCandidateSha
      || expectSha40(candidateWorktree.headAfterSha, "Task0B candidate HEAD after") !== observedCandidateSha
      || candidateWorktree.cleanBefore !== true || candidateWorktree.cleanAfter !== true
      || candidateWorktree.source !== "git_direct_read_before_and_after" || candidateWorktree.verified !== true) {
    throw new Error("Task0B candidate worktree is dirty or changed during preflight");
  }
  expectSha256(candidateWorktree.worktreePathFingerprintSha256, "Task0B candidate worktree fingerprint");

  const runtimeIdentity = expectRecord(evidence.previousRuntimeIdentity, "Task0B previous runtime identity");
  expectExactKeys(runtimeIdentity, [
    "generationId", "runtimeSha", "runtimeLabel", "processId", "processStartedAt", "commandLineSha256", "executablePathSha256", "workingDirectoryFingerprintSha256",
    "entrypointPathFingerprintSha256", "managerExecutableSha256", "attestedAt", "producerId", "liveRecheckSha256",
    "startEvidenceSha256", "commandId", "templateSha256", "exitCode", "source", "verified"
  ], "Task0B previous runtime identity");
  if (typeof runtimeIdentity.generationId !== "string" || !/^[a-z0-9][a-z0-9-]{15,63}$/u.test(runtimeIdentity.generationId)
      || expectSha40(runtimeIdentity.runtimeSha, "Task0B previous runtime identity SHA") !== previousSha
      || runtimeIdentity.runtimeLabel !== evidence.previousRuntimeLabel
      || !Number.isSafeInteger(runtimeIdentity.processId) || (runtimeIdentity.processId as number) < 1
      || runtimeIdentity.commandId !== "runtime_manager_previous_identity"
      || runtimeIdentity.templateSha256 !== TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256.runtime_manager_previous_identity
      || runtimeIdentity.producerId !== "task0b_repo_runtime_manager_v1"
      || runtimeIdentity.exitCode !== 0
      || runtimeIdentity.source !== "repo_runtime_manager_start_evidence_and_process_direct_read"
      || runtimeIdentity.verified !== true) {
    throw new Error("Task0B previous runtime identity is unverified");
  }
  expectIsoTime(runtimeIdentity.processStartedAt, "Task0B previous runtime processStartedAt");
  const runtimeAttestedAt = expectIsoTime(runtimeIdentity.attestedAt, "Task0B previous runtime attestedAt");
  if (Date.parse(runtimeAttestedAt) < Date.parse(runtimeIdentity.processStartedAt as string)
      || Date.parse(runtimeAttestedAt) - Date.parse(runtimeIdentity.processStartedAt as string) > 2 * 60_000) {
    throw new Error("Task0B previous runtime attestation was not created by the start wrapper");
  }
  for (const [field, label] of [
    [runtimeIdentity.commandLineSha256, "command line"],
    [runtimeIdentity.executablePathSha256, "executable path"],
    [runtimeIdentity.workingDirectoryFingerprintSha256, "working directory"],
    [runtimeIdentity.entrypointPathFingerprintSha256, "entrypoint path"],
    [runtimeIdentity.managerExecutableSha256, "manager executable"],
    [runtimeIdentity.liveRecheckSha256, "live recheck"],
    [runtimeIdentity.startEvidenceSha256, "start evidence"],
    [runtimeIdentity.templateSha256, "identity template"]
  ] as const) expectSha256(field, `Task0B previous runtime ${label}`);
  if (evidence.databaseRole !== "runtime_sanitized"
      || evidence.databaseName !== "tron_watch_plan5_runtime_sanitized"
      || evidence.operationalConfigPath !== "runtime-operational-config.json"
      || evidence.candidateStartCommandId !== "runtime_sanitized_rehearsal"
      || evidence.candidateStartTemplateSha256 !== REMEDIATION_COMMAND_TEMPLATE_SHA256.runtime_sanitized_rehearsal
      || evidence.candidateStopCommandId !== "runtime_sanitized_stop"
      || evidence.candidateStopTemplateSha256 !== REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.runtime_sanitized_stop
      || evidence.previousStartCommandId !== "rollback_rehearsal"
      || evidence.previousStartTemplateSha256 !== REMEDIATION_COMMAND_TEMPLATE_SHA256.rollback_rehearsal
      || evidence.previousStopCommandId !== "rollback_stop"
      || evidence.previousStopTemplateSha256 !== REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.rollback_stop) {
    throw new Error("Task0B command or database binding is invalid");
  }
  expectSha256(evidence.databaseFingerprintSha256, "Task0B database fingerprint");
  expectSha256(evidence.operationalConfigSha256, "Task0B operational config hash");

  const runtimeManager = expectRecord(evidence.runtimeManager, "Task0B runtime manager");
  expectExactKeys(runtimeManager, [
    "source", "executorPath", "executorSha256", "producerId", "candidateAdminUrl", "candidateAdminUrlFingerprintSha256",
    "startCandidateCommandId", "startCandidateTemplateSha256", "stopCandidateCommandId", "stopCandidateTemplateSha256", "stopPreviousCommandId",
    "stopPreviousTemplateSha256", "rollbackPreviousCommandId", "rollbackPreviousTemplateSha256", "verified"
  ], "Task0B runtime manager");
  if (runtimeManager.source !== "repo_owned_runtime_manager_registry_verified" || runtimeManager.verified !== true
      || runtimeManager.executorPath !== "scripts/manageTask0BRuntime.ts"
      || runtimeManager.producerId !== "task0b_repo_runtime_manager_v1"
      || expectSha256(runtimeManager.executorSha256, "Task0B runtime manager executable") !== runtimeIdentity.managerExecutableSha256
      || typeof runtimeManager.candidateAdminUrl !== "string"
      || expectSha256(runtimeManager.candidateAdminUrlFingerprintSha256, "Task0B runtime manager candidate Admin URL")
        !== createHash("sha256").update(runtimeManager.candidateAdminUrl, "utf8").digest("hex")
      || runtimeManager.startCandidateCommandId !== "runtime_manager_start_candidate"
      || runtimeManager.startCandidateTemplateSha256 !== TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256.runtime_manager_start_candidate
      || runtimeManager.stopCandidateCommandId !== "runtime_manager_stop_candidate"
      || runtimeManager.stopCandidateTemplateSha256 !== TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256.runtime_manager_stop_candidate
      || runtimeManager.stopPreviousCommandId !== "runtime_manager_stop_previous"
      || runtimeManager.stopPreviousTemplateSha256 !== TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256.runtime_manager_stop_previous
      || runtimeManager.rollbackPreviousCommandId !== "runtime_manager_rollback_previous"
      || runtimeManager.rollbackPreviousTemplateSha256 !== TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256.runtime_manager_rollback_previous) {
    throw new Error("Task0B runtime manager is not the verified allowlisted configuration");
  }
  let runtimeManagerAdminUrl: URL;
  try {
    runtimeManagerAdminUrl = new URL(runtimeManager.candidateAdminUrl as string);
  } catch {
    throw new Error("Task0B runtime manager candidate Admin URL is invalid");
  }
  if (runtimeManagerAdminUrl.protocol !== "http:" || runtimeManagerAdminUrl.hostname !== "127.0.0.1"
      || !runtimeManagerAdminUrl.port || runtimeManagerAdminUrl.pathname !== "/" || runtimeManagerAdminUrl.search
      || runtimeManagerAdminUrl.hash || runtimeManagerAdminUrl.username || runtimeManagerAdminUrl.password) {
    throw new Error("Task0B runtime manager candidate Admin URL is invalid");
  }

  const productionDatabase = expectRecord(evidence.productionDatabase, "Task0B production database");
  expectExactKeys(productionDatabase, [
    "name", "endpointHostClass", "endpointPort", "endpointFingerprintSha256", "connectedServerPort",
    "connectedServerAddressFingerprintSha256", "clusterFingerprintSha256", "databaseOidFingerprintSha256",
    "approvedIdentityFingerprintSha256", "identityMatchedApprovedConfig",
    "serverVersion", "serverVersionNum", "schemaState", "schema032ReceiptPrestate", "schemaReceiptSet", "source", "verified"
  ], "Task0B production database");
  if (productionDatabase.name !== "tron_watch" || productionDatabase.endpointHostClass !== "loopback"
      || !Number.isSafeInteger(productionDatabase.endpointPort) || (productionDatabase.endpointPort as number) < 1
      || (productionDatabase.endpointPort as number) > 65_535
      || !Number.isSafeInteger(productionDatabase.connectedServerPort) || (productionDatabase.connectedServerPort as number) < 1
      || (productionDatabase.connectedServerPort as number) > 65_535
      || typeof productionDatabase.serverVersion !== "string" || !/^\d+(?:\.\d+)+/.test(productionDatabase.serverVersion)
      || typeof productionDatabase.serverVersionNum !== "string" || !/^\d{5,6}$/.test(productionDatabase.serverVersionNum)
      || productionDatabase.identityMatchedApprovedConfig !== true
      || productionDatabase.source !== "protected_config_bound_postgresql_direct_read_only" || productionDatabase.verified !== true) {
    throw new Error("Task0B production database direct identity is invalid");
  }
  const receiptPrestate = expectRecord(productionDatabase.schema032ReceiptPrestate, "Task0B schema 032 receipt pre-state");
  expectExactKeys(receiptPrestate, ["state", "version", "filename", "checksumSha256"], "Task0B schema 032 receipt pre-state");
  if (receiptPrestate.version !== 32 || receiptPrestate.filename !== "032_telegram_runtime_forensics_data_contracts.sql"
      || !((productionDatabase.schemaState === "legacy_031" && receiptPrestate.state === "absent"
        && receiptPrestate.checksumSha256 === null)
      || (productionDatabase.schemaState === "schema_032_verified" && receiptPrestate.state === "verified"
        && expectSha256(receiptPrestate.checksumSha256, "Task0B schema 032 receipt checksum")
          === "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d"))) {
    throw new Error("Task0B production schema pre-state is invalid");
  }
  const receiptSet = expectRecord(productionDatabase.schemaReceiptSet, "Task0B schema receipt set");
  expectExactKeys(receiptSet, ["count", "maxVersion", "aggregateSha256", "source"], "Task0B schema receipt set");
  const emptyReceiptSetSha256 = createHash("sha256").update("[]", "utf8").digest("hex");
  const schema032ReceiptSetSha256 = createHash("sha256").update(JSON.stringify([{
    version: 32,
    filename: "032_telegram_runtime_forensics_data_contracts.sql",
    checksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d"
  }]), "utf8").digest("hex");
  if (receiptSet.source !== "postgresql_direct_read_only"
      || !((productionDatabase.schemaState === "legacy_031" && receiptSet.count === 0
        && receiptSet.maxVersion === null && receiptSet.aggregateSha256 === emptyReceiptSetSha256)
      || (productionDatabase.schemaState === "schema_032_verified" && receiptSet.count === 1
        && receiptSet.maxVersion === 32 && receiptSet.aggregateSha256 === schema032ReceiptSetSha256))) {
    throw new Error("Task0B complete schema receipt set is invalid");
  }
  expectSha256(productionDatabase.endpointFingerprintSha256, "Task0B production endpoint fingerprint");
  expectSha256(productionDatabase.connectedServerAddressFingerprintSha256, "Task0B connected server address fingerprint");
  expectSha256(productionDatabase.clusterFingerprintSha256, "Task0B production cluster fingerprint");
  expectSha256(productionDatabase.databaseOidFingerprintSha256, "Task0B production database OID fingerprint");
  expectSha256(productionDatabase.approvedIdentityFingerprintSha256, "Task0B approved production identity fingerprint");
  const observedServerMajor = Number.parseInt(String(productionDatabase.serverVersion).split(".")[0] ?? "", 10);
  const observedServerVersionNumMajor = Math.floor(Number(productionDatabase.serverVersionNum) / 10_000);
  if (!Number.isSafeInteger(observedServerMajor) || observedServerMajor !== observedServerVersionNumMajor) {
    throw new Error("Task0B production server version identity is inconsistent");
  }

  const rollback = expectRecord(evidence.rollbackWorktree, "Task0B rollback worktree");
  expectExactKeys(rollback, [
    "previousRuntimeSha", "headSha", "worktreePathFingerprintSha256", "clean", "source", "verified"
  ], "Task0B rollback worktree");
  if (expectSha40(rollback.previousRuntimeSha, "Task0B rollback previous SHA") !== previousSha
      || expectSha40(rollback.headSha, "Task0B rollback HEAD") !== previousSha || rollback.clean !== true
      || rollback.source !== "git_direct_read" || rollback.verified !== true) {
    throw new Error("Task0B rollback worktree is not the clean exact previous runtime");
  }
  expectSha256(rollback.worktreePathFingerprintSha256, "Task0B rollback worktree path fingerprint");
  if (runtimeIdentity.workingDirectoryFingerprintSha256 !== rollback.worktreePathFingerprintSha256) {
    throw new Error("Task0B previous runtime is not bound to the exact rollback worktree");
  }

  const tools = expectRecord(evidence.postgresTools, "Task0B PostgreSQL tools");
  expectExactKeys(tools, ["source", "verified", "provider", "pgDump", "pgRestore"], "Task0B PostgreSQL tools");
  if (tools.source !== "pinned_docker_image_direct_probe" || tools.verified !== true) {
    throw new Error("Task0B PostgreSQL tools are unverified");
  }
  const provider = expectRecord(tools.provider, "Task0B PostgreSQL tool provider");
  expectExactKeys(provider, [
    "kind", "immutableImageId", "immutableImageIdSha256", "networkMode", "pullAllowed", "source"
  ], "Task0B PostgreSQL tool provider");
  if (provider.kind !== "docker_pinned_image" || provider.pullAllowed !== false
      || provider.source !== "external_allowlisted_config_verified"
      || !/^sha256:[0-9a-f]{64}$/.test(String(provider.immutableImageId))
      || expectSha256(provider.immutableImageIdSha256, "Task0B PostgreSQL image ID hash")
        !== createHash("sha256").update(String(provider.immutableImageId), "utf8").digest("hex")
      || provider.networkMode !== "none") {
    throw new Error("Task0B PostgreSQL tool provider is unverified");
  }
  const postgresToolVersions: string[] = [];
  for (const name of ["pgDump", "pgRestore"] as const) {
    const tool = expectRecord(tools[name], `Task0B ${name}`);
    expectExactKeys(tool, [
      "executableIdentitySha256", "version", "versionProbeExitCode", "commandId", "templateSha256"
    ], `Task0B ${name}`);
    expectSha256(tool.executableIdentitySha256, `Task0B ${name} executable identity`);
    const expectedCommandId = name === "pgDump" ? "postgres_tool_pg_dump_attest" : "postgres_tool_pg_restore_attest";
    if (typeof tool.version !== "string" || !/^pg_(?:dump|restore) \(PostgreSQL\) \d+(?:\.\d+)+$/.test(tool.version)
        || tool.versionProbeExitCode !== 0 || tool.commandId !== expectedCommandId
        || tool.templateSha256 !== TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256[expectedCommandId]) {
      throw new Error(`Task0B ${name} version is invalid`);
    }
    postgresToolVersions.push(tool.version.replace(/^pg_(?:dump|restore) /, ""));
  }
  if (new Set(postgresToolVersions).size !== 1) throw new Error("Task0B PostgreSQL tool versions do not match");
  const toolMajor = Number.parseInt(/^\(PostgreSQL\) (\d+)/.exec(postgresToolVersions[0] ?? "")?.[1] ?? "", 10);
  const serverMajor = Number.parseInt(String(productionDatabase.serverVersion).split(".")[0] ?? "", 10);
  if (!Number.isSafeInteger(toolMajor) || !Number.isSafeInteger(serverMajor) || toolMajor < serverMajor) {
    throw new Error("Task0B pg_dump/pg_restore toolset is incompatible with the production server major");
  }

  const artifactRoot = expectRecord(evidence.artifactRoot, "Task0B artifact root");
  expectExactKeys(artifactRoot, [
    "rootFingerprintSha256", "outsideRepository", "noSymlink", "ownerIdentityFingerprintSha256",
    "accessControlFingerprintSha256", "accessControlSource", "restrictiveAccessVerified", "exclusiveWriteVerified",
    "exclusiveWriteFingerprintSha256", "source", "verified"
  ], "Task0B artifact root");
  if (artifactRoot.outsideRepository !== true || artifactRoot.noSymlink !== true
      || artifactRoot.restrictiveAccessVerified !== true
      || !new Set(["windows_acl_direct_read", "posix_mode_direct_read"]).has(String(artifactRoot.accessControlSource))
      || artifactRoot.exclusiveWriteVerified !== true || artifactRoot.source !== "filesystem_direct_probe"
      || artifactRoot.verified !== true) throw new Error("Task0B protected artifact root is unverified");
  expectSha256(artifactRoot.rootFingerprintSha256, "Task0B artifact root fingerprint");
  expectSha256(artifactRoot.ownerIdentityFingerprintSha256, "Task0B artifact root owner fingerprint");
  expectSha256(artifactRoot.accessControlFingerprintSha256, "Task0B artifact root access-control fingerprint");
  expectSha256(artifactRoot.exclusiveWriteFingerprintSha256, "Task0B artifact exclusive-write fingerprint");

  const candidatePort = expectRecord(evidence.candidatePort, "Task0B candidate port");
  expectExactKeys(candidatePort, [
    "host", "port", "available", "adminUrlFingerprintSha256", "bindingSource", "source", "verified"
  ], "Task0B candidate port");
  if (candidatePort.host !== "127.0.0.1" || !Number.isSafeInteger(candidatePort.port)
      || (candidatePort.port as number) < 1 || (candidatePort.port as number) > 65_535
      || candidatePort.port === productionDatabase.endpointPort || candidatePort.available !== true
      || candidatePort.bindingSource !== "protected_runtime_operational_config"
      || candidatePort.source !== "loopback_bind_probe" || candidatePort.verified !== true) {
    throw new Error("Task0B isolated candidate port is invalid or unavailable");
  }
  expectSha256(candidatePort.adminUrlFingerprintSha256, "Task0B candidate Admin URL fingerprint");
  if (candidatePort.adminUrlFingerprintSha256 !== runtimeManager.candidateAdminUrlFingerprintSha256) {
    throw new Error("Task0B candidate port is not bound to the runtime manager launch configuration");
  }
  if (Number(runtimeManagerAdminUrl.port) !== candidatePort.port) {
    throw new Error("Task0B candidate port does not match the runtime manager candidate Admin URL");
  }

  const effects = expectRecord(evidence.observedEffects, "Task0B observed effects");
  expectExactKeys(effects, [
    "runtimeStopCount", "runtimeStartCount", "databaseMigrationCount", "telegramSendCount", "readOnlyOperationCount",
    "operationIds", "operationSequenceSha256", "source"
  ], "Task0B observed effects");
  if (effects.runtimeStopCount !== 0 || effects.runtimeStartCount !== 0 || effects.databaseMigrationCount !== 0
      || effects.telegramSendCount !== 0 || effects.source !== "instrumented_read_only_operation_ledger"
      || effects.readOnlyOperationCount !== TASK0B_READ_ONLY_OPERATION_IDS.length
      || !Array.isArray(effects.operationIds)
      || effects.operationIds.length !== TASK0B_READ_ONLY_OPERATION_IDS.length
      || effects.operationIds.some((operationId, index) => operationId !== TASK0B_READ_ONLY_OPERATION_IDS[index])
      || effects.operationSequenceSha256 !== createHash("sha256")
        .update(JSON.stringify(TASK0B_READ_ONLY_OPERATION_IDS), "utf8").digest("hex")) {
    throw new Error("Task0B preflight caused or reported a forbidden side effect");
  }
  return evidence as Task0BReleaseFreezeEvidenceV1;
}

export function assertExactIdSet(value: unknown, expected: readonly string[], label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array`);
  }
  const ids = value as string[];
  if (ids.length !== expected.length || new Set(ids).size !== ids.length) {
    throw new Error(`${label} must contain every approved ID exactly once`);
  }
  const actualSet = new Set(ids);
  if (expected.some((id) => !actualSet.has(id))) {
    throw new Error(`${label} must contain every approved ID exactly once`);
  }
  return [...ids];
}

function parseGate(value: unknown, manifestCandidateSha: string, index: number): ReleaseArtifactV1 {
  const gate = expectRecord(value, `gates[${index}]`);
  expectExactKeys(gate, [
    "id",
    "candidateSha",
    "commandId",
    "redactedTemplateSha256",
    "startedAt",
    "finishedAt",
    "exitCode",
    "outputSha256",
    "state"
  ], `gates[${index}]`);

  const id = expectString(gate.id, `gates[${index}].id`) as ReleaseGateId;
  if (!(REMEDIATION_REQUIRED_GATE_IDS as readonly string[]).includes(id)) {
    throw new Error(`gates[${index}].id is not allowlisted`);
  }
  const candidateSha = expectSha40(gate.candidateSha, `gates[${index}].candidateSha`);
  if (candidateSha !== manifestCandidateSha) throw new Error(`${id} candidate SHA does not match manifest`);
  const commandId = expectString(gate.commandId, `gates[${index}].commandId`) as ReleaseCommandId;
  if (commandId !== REMEDIATION_GATE_COMMAND_IDS[id]) throw new Error(`${id} command is not allowlisted`);
  const redactedTemplateSha256 = expectSha256(gate.redactedTemplateSha256, `gates[${index}].redactedTemplateSha256`);
  if (redactedTemplateSha256 !== REMEDIATION_COMMAND_TEMPLATE_SHA256[commandId]) {
    throw new Error(`${id} redacted command template hash is not allowlisted`);
  }
  const startedAt = expectIsoTime(gate.startedAt, `gates[${index}].startedAt`);
  const finishedAt = expectIsoTime(gate.finishedAt, `gates[${index}].finishedAt`);
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error(`${id} finishes before it starts`);
  if (!Number.isSafeInteger(gate.exitCode) || (gate.exitCode as number) < 0 || (gate.exitCode as number) > 255) {
    throw new Error(`${id} exitCode must be an integer from 0 through 255`);
  }
  const exitCode = gate.exitCode as number;
  const outputSha256 = expectSha256(gate.outputSha256, `gates[${index}].outputSha256`);
  const state = expectString(gate.state, `gates[${index}].state`) as ReleaseGateState;
  if (!RELEASE_GATE_STATES.has(state)) throw new Error(`${id} state is invalid`);
  if (state === "passed" && exitCode !== 0) throw new Error(`${id} cannot pass with a nonzero exit code`);
  if (state === "failed" && exitCode === 0) throw new Error(`${id} cannot fail with a zero exit code`);

  return {
    id,
    candidateSha,
    commandId,
    redactedTemplateSha256,
    startedAt,
    finishedAt,
    exitCode,
    outputSha256,
    state
  };
}

function assertManifestPhase(manifest: RemediationReleaseManifestV1): void {
  const byId = new Map(manifest.gates.map((gate) => [gate.id, gate]));
  const preRelease = REMEDIATION_PRE_RELEASE_GATE_IDS.map((id) => byId.get(id)!);
  const production = REMEDIATION_PRODUCTION_GATE_IDS.map((id) => byId.get(id)!);
  const preReleasePassed = preRelease.every((gate) => gate.state === "passed" && gate.exitCode === 0);
  const productionPassed = production.every((gate) => gate.state === "passed" && gate.exitCode === 0);
  const productionPending = production.every((gate) => gate.state === "pending");
  const productionFailed = production.some((gate) => gate.state === "failed" || gate.state === "blocked");

  if (manifest.overall === "rolled_back") {
    if (!preReleasePassed || manifest.rollbackEvidenceSha256 === null) {
      throw new Error("rolled_back requires passed G00-G11 and rollback evidence");
    }
    if (!production.some((gate) => gate.state === "failed" || gate.state === "blocked")) {
      throw new Error("rolled_back requires a recorded failed or blocked production gate");
    }
    if (production.some((gate) => gate.state === "pending")) {
      throw new Error("rolled_back production gates must record passed, failed, or blocked state");
    }
    return;
  }

  const derived: Exclude<ReleaseOverall, "rolled_back"> = !preReleasePassed || productionFailed
    ? "not_ready"
    : productionPassed
      ? "released"
      : productionPending
        ? "ready_for_release"
        : "not_ready";
  if (manifest.overall !== derived) {
    throw new Error(`release phase does not match gate state; expected ${derived}`);
  }
}

export function validateRemediationReleaseManifest(value: unknown): RemediationReleaseManifestV1 {
  assertNoSecretLikeArtifactValues(value);
  const manifest = expectRecord(value, "release manifest");
  expectExactKeys(manifest, [
    "version",
    "candidateSha",
    "planBaseSha",
    "requiredRequirementIds",
    "requiredAcceptanceIds",
    "gates",
    "manualTelegramEvidenceSha256",
    "migrationEvidenceSha256",
    "rollbackEvidenceSha256",
    "overall"
  ], "release manifest");
  if (manifest.version !== "remediation-release-manifest-v1") throw new Error("release manifest version is invalid");

  const candidateSha = expectSha40(manifest.candidateSha, "candidateSha");
  const planBaseSha = expectSha40(manifest.planBaseSha, "planBaseSha");
  if (planBaseSha !== PLAN5_APPROVED_BASE_SHA) throw new Error("planBaseSha is not the approved Plan 5 base");
  if (candidateSha === planBaseSha) throw new Error("candidateSha must differ from planBaseSha");
  const requiredRequirementIds = assertExactIdSet(
    manifest.requiredRequirementIds,
    REMEDIATION_REQUIRED_REQUIREMENT_IDS,
    "requiredRequirementIds"
  );
  const requiredAcceptanceIds = assertExactIdSet(
    manifest.requiredAcceptanceIds,
    REMEDIATION_REQUIRED_ACCEPTANCE_IDS,
    "requiredAcceptanceIds"
  );
  if (!Array.isArray(manifest.gates)) throw new Error("gates must be an array");
  const gates = manifest.gates.map((gate, index) => parseGate(gate, candidateSha, index));
  assertExactIdSet(gates.map((gate) => gate.id), REMEDIATION_REQUIRED_GATE_IDS, "gate IDs");

  const manualTelegramEvidenceSha256 = expectOptionalSha256(
    manifest.manualTelegramEvidenceSha256,
    "manualTelegramEvidenceSha256"
  );
  const migrationEvidenceSha256 = expectOptionalSha256(manifest.migrationEvidenceSha256, "migrationEvidenceSha256");
  const rollbackEvidenceSha256 = expectOptionalSha256(manifest.rollbackEvidenceSha256, "rollbackEvidenceSha256");
  const overall = expectString(manifest.overall, "overall") as ReleaseOverall;
  if (!RELEASE_OVERALL_STATES.has(overall)) throw new Error("overall is invalid");

  const parsed: RemediationReleaseManifestV1 = {
    version: "remediation-release-manifest-v1",
    candidateSha,
    planBaseSha,
    requiredRequirementIds,
    requiredAcceptanceIds,
    gates,
    manualTelegramEvidenceSha256,
    migrationEvidenceSha256,
    rollbackEvidenceSha256,
    overall
  };

  const gateById = new Map(gates.map((gate) => [gate.id, gate]));
  if (gateById.get("G05_TELEGRAM")!.state === "passed" && manualTelegramEvidenceSha256 === null) {
    throw new Error("passed G05 requires manual Telegram evidence");
  }
  if (["G07_SCHEMA_OFFLINE", "G13_PRODUCTION_MIGRATION"].some((id) => gateById.get(id as ReleaseGateId)!.state === "passed")
      && migrationEvidenceSha256 === null) {
    throw new Error("passed schema gate requires migration evidence");
  }
  if (gateById.get("G10_ROLLBACK_REHEARSAL")!.state === "passed" && rollbackEvidenceSha256 === null) {
    throw new Error("passed G10 requires rollback evidence");
  }
  assertManifestPhase(parsed);
  return parsed;
}
