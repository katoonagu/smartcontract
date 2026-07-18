import { createHash } from "node:crypto";
import { fingerprintTelegramMessagePayload } from "../../../src/forensics/telegramDelivery";
import { adaptTelegramForensicResult } from "../../../src/telegram/forensicPresentationAdapters";
import { renderTelegramForensicResult } from "../../../src/telegram/forensicResultRenderer";
import { MANUAL_TELEGRAM_ACCEPTANCE_CASES } from "../../../scripts/renderTelegramUxAcceptance";
import { remediationTelegramUxCase } from "../telegram/remediationTelegramUxCases";

export const CANDIDATE_SHA = "c".repeat(40);
export const PLAN_BASE_SHA = "4761e1453ea03a96845b68039e6d6f4812aae540";
export const PREVIOUS_RUNTIME_SHA = "a".repeat(40);
export const RUNTIME_LABEL = `plan5-${CANDIDATE_SHA.slice(0, 8)}`;
export const PREVIOUS_RUNTIME_LABEL = `previous-${PREVIOUS_RUNTIME_SHA.slice(0, 8)}`;
export const SCHEMA_032_FILENAME = "032_telegram_runtime_forensics_data_contracts.sql";
export const SCHEMA_032_CHECKSUM = "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d";
export const POSTCONDITIONS_SHA256 = "d".repeat(64);
export const SANITIZED_DATABASE_FINGERPRINT = "e".repeat(64);
export const PRODUCTION_CLONE_DATABASE_FINGERPRINT = "f".repeat(64);
export const ROLLBACK_COMMAND_TEMPLATE_SHA256 = "9d98c145698d181dca0e35b3694a501994c7668ba61291687287775cea880f29";
export const RUNTIME_SCHEMA_EVIDENCE_SHA256 = "1".repeat(64);
export const CANDIDATE_START_EVIDENCE_SHA256 = "2".repeat(64);
export const PREVIOUS_START_EVIDENCE_SHA256 = "3".repeat(64);

function numberedIds(prefix: "REQ" | "AC", count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`);
}

export const REQUIRED_REQUIREMENT_IDS = numberedIds("REQ", 38);
export const REQUIRED_ACCEPTANCE_IDS = numberedIds("AC", 41);

export const PRE_RELEASE_GATE_IDS = [
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

export const PRODUCTION_GATE_IDS = [
  "G12_PRODUCTION_BACKUP",
  "G13_PRODUCTION_MIGRATION",
  "G14_PRODUCTION_ROLLOUT",
  "G15_PRODUCTION_CANARY"
] as const;

export const REQUIRED_GATE_IDS = [...PRE_RELEASE_GATE_IDS, ...PRODUCTION_GATE_IDS] as const;

// Immutable Plan 5 Manifest V2 acceptance fixtures. They intentionally remain
// plain JSON so the frozen RED batch does not depend on the future validators.
export const RELEASE_V2_NOW = "2026-07-18T10:00:00.000Z";

function canonicalFixtureJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalFixtureJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalFixtureJson(object[key])}`).join(",")}}`;
}

export function buildOperationalAttestationV2Fixture(overrides: Record<string, unknown> = {}) {
  return {
    version: "operational-attestation-v2",
    action: "pre_manual",
    generationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
    candidateSha: CANDIDATE_SHA,
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256,
    sourceManifestSha256: "8".repeat(64),
    artifactRootFingerprintSha256: RELEASE_V2_FREEZE_IDENTITY.artifactRootFingerprintSha256,
    commandId: "base_audit",
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.base_audit,
    previousAttestationSha256: null,
    priorTerminalLineageSha256: null,
    issuedAt: RELEASE_V2_NOW,
    expiresAt: "2026-07-18T10:15:00.000Z",
    ...overrides
  };
}

export function buildReleaseManifestV2Fixture(overrides: Record<string, unknown> = {}) {
  const gates = REQUIRED_GATE_IDS.map((id) => ({
    id,
    candidateSha: CANDIDATE_SHA,
    state: id === "G05_TELEGRAM" || id.startsWith("G12_") || id.startsWith("G13_") ||
      id.startsWith("G14_") || id.startsWith("G15_") ? "pending" : "passed",
    ...(id === "G05_TELEGRAM" || id.startsWith("G12_") || id.startsWith("G13_") ||
      id.startsWith("G14_") || id.startsWith("G15_") ? {} : {
      commandId: GATE_COMMAND_IDS[id],
      redactedTemplateSha256: COMMAND_TEMPLATE_SHA256[GATE_COMMAND_IDS[id]],
      startedAt: "2026-07-18T09:58:00.000Z",
      finishedAt: "2026-07-18T09:59:00.000Z",
      exitCode: 0,
      outputSha256: "9".repeat(64),
      evidence: [{
        kind: id === "G00_BASE" ? "task0_baseline" : "suite_evidence",
        relativePath: `gates/${id.toLowerCase()}.json`,
        sha256: "a".repeat(64),
        schemaVersion: "gate-evidence-v2",
        candidateSha: CANDIDATE_SHA
      }]
    })
  }));
  const provisional = {
    version: "remediation-release-manifest-v2",
    revision: 1,
    candidateSha: CANDIDATE_SHA,
    planBaseSha: PLAN_BASE_SHA,
    previousManifestSha256: null,
    artifactRootFingerprintSha256: RELEASE_V2_FREEZE_IDENTITY.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256,
    latestCommittedReceiptSha256: "0".repeat(64),
    requiredRequirementIds: Array.from({ length: 38 }, (_, index) => `REQ-${String(index + 1).padStart(2, "0")}`),
    requiredAcceptanceIds: Array.from({ length: 41 }, (_, index) => `AC-${String(index + 1).padStart(2, "0")}`),
    transitionId: "pre_manual",
    overall: "not_ready",
    gates,
    transitionEvidence: [],
    actualRollback: null,
    updatedAt: RELEASE_V2_NOW
  };
  const transitionKeySha256 = createHash("sha256").update(canonicalFixtureJson([
    CANDIDATE_SHA,
    null,
    "pre_manual",
    RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
    RELEASE_V2_FREEZE_IDENTITY.artifactRootFingerprintSha256
  ])).digest("hex");
  const { latestCommittedReceiptSha256: _omitted, ...projection } = provisional;
  const receipt = {
    version: "committed-manifest-transition-receipt-v2",
    transitionId: "pre_manual",
    transitionKeySha256,
    candidateSha: CANDIDATE_SHA,
    artifactRootFingerprintSha256: RELEASE_V2_FREEZE_IDENTITY.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256,
    sourceManifestSha256: null,
    previousReceiptSha256: null,
    targetManifestProjectionSha256: createHash("sha256").update(canonicalFixtureJson(projection)).digest("hex"),
    sourceRevision: null,
    targetRevision: 1,
    gateOutputSha256s: gates.filter((gate) => gate.state === "passed")
      .map((gate) => createHash("sha256").update(`${canonicalFixtureJson(gate)}\n`).digest("hex")),
    transitionEvidence: [],
    committedAt: RELEASE_V2_NOW
  };
  const latestCommittedReceiptSha256 = createHash("sha256")
    .update(`${canonicalFixtureJson(receipt)}\n`).digest("hex");
  return { ...provisional, latestCommittedReceiptSha256, ...overrides };
}

export function buildExecutedReleaseGateV2Fixture(id: typeof REQUIRED_GATE_IDS[number], state: "passed" | "failed" = "passed") {
  return {
    id,
    candidateSha: CANDIDATE_SHA,
    state,
    commandId: GATE_COMMAND_IDS[id],
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256[GATE_COMMAND_IDS[id]],
    startedAt: "2026-07-18T09:58:00.000Z",
    finishedAt: "2026-07-18T09:59:00.000Z",
    exitCode: state === "passed" ? 0 : 1,
    outputSha256: "9".repeat(64),
    evidence: [{
      kind: id === "G00_BASE" ? "task0_baseline" : "suite_evidence",
      relativePath: `gates/${id.toLowerCase()}.json`,
      sha256: "a".repeat(64),
      schemaVersion: "gate-evidence-v2",
      candidateSha: CANDIDATE_SHA
    }]
  };
}

export function buildProductionEvidenceScenarioV2(
  scenario: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    version: "production-release-evidence-bundle-v2",
    scenario,
    candidateSha: CANDIDATE_SHA,
    releaseGenerationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
    freezeIdentitySha256: "7".repeat(64),
    sourceManifestSha256: "8".repeat(64),
    authority: buildOperationalAttestationV2Fixture({ action: "g14_rollout_passed" }),
    operation: {
      operationId: `operation-${scenario}`,
      kind: scenario.includes("canary") ? "canary" : scenario.includes("rollback") ? "rollback" : "rollout",
      capability: "effect_capable",
      leaseEpoch: 1,
      ownerId: "plan5-test-owner",
      operationDeadlineAt: "2026-07-18T10:20:00.000Z"
    },
    receipts: [],
    captures: [],
    attemptedExternalEffect: false,
    evaluatedAt: "2026-07-18T10:05:00.000Z",
    ...overrides
  };
}

export const GATE_COMMAND_IDS = {
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

const REDACTED_COMMAND_TEMPLATES = {
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
} as const;

export const COMMAND_TEMPLATE_SHA256 = Object.fromEntries(Object.entries(REDACTED_COMMAND_TEMPLATES).map(
  ([commandId, template]) => [commandId, createHash("sha256").update(template, "utf8").digest("hex")]
)) as Record<keyof typeof REDACTED_COMMAND_TEMPLATES, string>;

export const TASK0B_COMMAND_TEMPLATE_SHA256 = Object.fromEntries([
  ["runtime_manager_start_candidate", "release:task0b:runtime-manager start <artifact-root> <production-go-authority-file>"],
  ["runtime_manager_stop_candidate", "release:task0b:runtime-manager stop <artifact-root> <production-go-authority-file>"],
  ["runtime_manager_stop_previous", "release:task0b:runtime-manager stop <artifact-root> <production-go-authority-file>"],
  ["runtime_manager_rollback_previous", "release:task0b:runtime-manager start <artifact-root> <production-go-authority-file>"],
  ["runtime_manager_previous_identity", "task0b_repo_runtime_manager_v1 start-attestation <pid> <process-started-at> <absolute-entrypoint> <worktree-fingerprint> <sha> <label>"],
  ["postgres_tool_pg_dump_attest", "postgres-tool:attest pg_dump <provider-kind> <immutable-provider-identity>"],
  ["postgres_tool_pg_restore_attest", "postgres-tool:attest pg_restore <provider-kind> <immutable-provider-identity>"]
].map(([commandId, template]) => [
  commandId,
  createHash("sha256").update(template, "utf8").digest("hex")
])) as Record<string, string>;

export const TASK0B_EXPECTED_PRODUCTION_DATABASE = Object.freeze({
  databaseName: "tron_watch" as const,
  endpointHost: "127.0.0.1" as const,
  endpointPort: 55999,
  connectedServerPort: 5432,
  systemIdentifier: "7390000000000000000",
  databaseOid: "16384",
  serverVersionNum: "160014"
});

export const TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT = createHash("sha256").update(JSON.stringify([
  TASK0B_EXPECTED_PRODUCTION_DATABASE.databaseName,
  TASK0B_EXPECTED_PRODUCTION_DATABASE.endpointHost,
  TASK0B_EXPECTED_PRODUCTION_DATABASE.endpointPort,
  TASK0B_EXPECTED_PRODUCTION_DATABASE.connectedServerPort,
  TASK0B_EXPECTED_PRODUCTION_DATABASE.systemIdentifier,
  TASK0B_EXPECTED_PRODUCTION_DATABASE.databaseOid,
  TASK0B_EXPECTED_PRODUCTION_DATABASE.serverVersionNum
])).digest("hex");

export function buildTask0BReleaseFreezeEvidence(input: {
  candidateSha?: string;
  previousRuntimeSha?: string;
  previousRuntimeLabel?: string;
  observedAt?: string;
  databaseFingerprintSha256?: string;
  operationalConfigSha256?: string;
  artifactRootFingerprintSha256?: string;
} = {}) {
  const candidateSha = input.candidateSha ?? CANDIDATE_SHA;
  const previousRuntimeSha = input.previousRuntimeSha ?? PREVIOUS_RUNTIME_SHA;
  const previousRuntimeLabel = input.previousRuntimeLabel ?? PREVIOUS_RUNTIME_LABEL;
  const observedAt = input.observedAt ?? "2026-07-18T09:00:00.000Z";
  return {
    version: "task0b-release-freeze-evidence-v1",
    candidateSha,
    observedAt,
    freezeCutoff: observedAt,
    expiresAt: new Date(Date.parse(observedAt) + 15 * 60_000).toISOString(),
    source: "task0b_direct_operational_preflight",
    operatorConfig: {
      filename: "task0b-preflight-config.json",
      contentSha256: "1".repeat(64),
      fileIdentitySha256: "2".repeat(64),
      configExpiresAt: new Date(Date.parse(observedAt) + 15 * 60_000).toISOString(),
      source: "protected_file_handle_direct_read",
      verified: true
    },
    candidateWorktree: {
      headBeforeSha: candidateSha,
      headAfterSha: candidateSha,
      worktreePathFingerprintSha256: "0".repeat(64),
      cleanBefore: true,
      cleanAfter: true,
      source: "git_direct_read_before_and_after",
      verified: true
    },
    previousRuntimeSha,
    previousRuntimeLabel,
    previousRuntimeSource: "runtime_manager_attestation_and_process_direct_read",
    previousRuntimeVerified: true,
    previousRuntimeIdentity: {
      generationId: "previous-runtime-generation-0001",
      runtimeSha: previousRuntimeSha,
      runtimeLabel: previousRuntimeLabel,
      processId: 11088,
      processStartedAt: "2026-07-17T19:39:12.000Z",
      commandLineSha256: "a".repeat(64),
      executablePathSha256: "b".repeat(64),
      workingDirectoryFingerprintSha256: "3".repeat(64),
      entrypointPathFingerprintSha256: "c".repeat(64),
      managerExecutableSha256: "6".repeat(64),
      attestedAt: "2026-07-17T19:39:42.000Z",
      producerId: "task0b_repo_runtime_manager_v1",
      liveRecheckSha256: "7".repeat(64),
      startEvidenceSha256: "d".repeat(64),
      commandId: "runtime_manager_previous_identity",
      templateSha256: TASK0B_COMMAND_TEMPLATE_SHA256.runtime_manager_previous_identity,
      exitCode: 0,
      source: "repo_runtime_manager_start_evidence_and_process_direct_read",
      verified: true
    },
    databaseRole: "runtime_sanitized",
    databaseName: "tron_watch_plan5_runtime_sanitized",
    databaseFingerprintSha256: input.databaseFingerprintSha256 ?? SANITIZED_DATABASE_FINGERPRINT,
    operationalConfigPath: "runtime-operational-config.json",
    operationalConfigSha256: input.operationalConfigSha256 ?? "8".repeat(64),
    candidateStartCommandId: "runtime_sanitized_rehearsal",
    candidateStartTemplateSha256: COMMAND_TEMPLATE_SHA256.runtime_sanitized_rehearsal,
    candidateStopCommandId: "runtime_sanitized_stop",
    candidateStopTemplateSha256: createHash("sha256")
      .update("release:runtime:stop <candidate-sha> <runtime-label>", "utf8").digest("hex"),
    previousStartCommandId: "rollback_rehearsal",
    previousStartTemplateSha256: COMMAND_TEMPLATE_SHA256.rollback_rehearsal,
    previousStopCommandId: "rollback_stop",
    previousStopTemplateSha256: createHash("sha256")
      .update("rollback:stop-previous-runtime <previous-sha> <runtime-label>", "utf8").digest("hex"),
    runtimeManager: {
      source: "repo_owned_runtime_manager_registry_verified",
      executorPath: "scripts/manageTask0BRuntime.ts",
      executorSha256: "6".repeat(64),
      producerId: "task0b_repo_runtime_manager_v1",
      candidateAdminUrl: "http://127.0.0.1:18787/",
      candidateAdminUrlFingerprintSha256: createHash("sha256").update("http://127.0.0.1:18787/").digest("hex"),
      startCandidateCommandId: "runtime_manager_start_candidate",
      startCandidateTemplateSha256: TASK0B_COMMAND_TEMPLATE_SHA256.runtime_manager_start_candidate,
      stopCandidateCommandId: "runtime_manager_stop_candidate",
      stopCandidateTemplateSha256: TASK0B_COMMAND_TEMPLATE_SHA256.runtime_manager_stop_candidate,
      stopPreviousCommandId: "runtime_manager_stop_previous",
      stopPreviousTemplateSha256: TASK0B_COMMAND_TEMPLATE_SHA256.runtime_manager_stop_previous,
      rollbackPreviousCommandId: "runtime_manager_rollback_previous",
      rollbackPreviousTemplateSha256: TASK0B_COMMAND_TEMPLATE_SHA256.runtime_manager_rollback_previous,
      verified: true
    },
    productionDatabase: {
      name: "tron_watch",
      endpointHostClass: "loopback",
      endpointPort: 55999,
      endpointFingerprintSha256: "1".repeat(64),
      connectedServerPort: 5432,
      connectedServerAddressFingerprintSha256: "8".repeat(64),
      clusterFingerprintSha256: "2".repeat(64),
      databaseOidFingerprintSha256: "a".repeat(64),
      approvedIdentityFingerprintSha256: TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
      identityMatchedApprovedConfig: true,
      serverVersion: "16.14",
      serverVersionNum: "160014",
      schemaState: "legacy_031",
      schema032ReceiptPrestate: {
        state: "absent",
        version: 32,
        filename: "032_telegram_runtime_forensics_data_contracts.sql",
        checksumSha256: null
      },
      schemaReceiptSet: {
        count: 0,
        maxVersion: null,
        aggregateSha256: createHash("sha256").update("[]").digest("hex"),
        source: "postgresql_direct_read_only"
      },
      source: "protected_config_bound_postgresql_direct_read_only",
      verified: true
    },
    rollbackWorktree: {
      previousRuntimeSha,
      headSha: previousRuntimeSha,
      worktreePathFingerprintSha256: "3".repeat(64),
      clean: true,
      source: "git_direct_read",
      verified: true
    },
    postgresTools: {
      source: "pinned_docker_image_direct_probe",
      verified: true,
      provider: {
        kind: "docker_pinned_image",
        immutableImageId: `sha256:${"9".repeat(64)}`,
        immutableImageIdSha256: createHash("sha256").update(`sha256:${"9".repeat(64)}`).digest("hex"),
        networkMode: "none",
        pullAllowed: false,
        source: "external_allowlisted_config_verified"
      },
      pgDump: {
        executableIdentitySha256: "4".repeat(64),
        version: "pg_dump (PostgreSQL) 16.14",
        versionProbeExitCode: 0,
        commandId: "postgres_tool_pg_dump_attest",
        templateSha256: TASK0B_COMMAND_TEMPLATE_SHA256.postgres_tool_pg_dump_attest
      },
      pgRestore: {
        executableIdentitySha256: "5".repeat(64),
        version: "pg_restore (PostgreSQL) 16.14",
        versionProbeExitCode: 0,
        commandId: "postgres_tool_pg_restore_attest",
        templateSha256: TASK0B_COMMAND_TEMPLATE_SHA256.postgres_tool_pg_restore_attest
      }
    },
    artifactRoot: {
      rootFingerprintSha256: input.artifactRootFingerprintSha256 ?? "1".repeat(64),
      outsideRepository: true,
      noSymlink: true,
      ownerIdentityFingerprintSha256: "e".repeat(64),
      accessControlFingerprintSha256: "f".repeat(64),
      accessControlSource: "windows_acl_direct_read",
      restrictiveAccessVerified: true,
      exclusiveWriteVerified: true,
      exclusiveWriteFingerprintSha256: "7".repeat(64),
      source: "filesystem_direct_probe",
      verified: true
    },
    candidatePort: {
      host: "127.0.0.1",
      port: 18787,
      available: true,
      adminUrlFingerprintSha256: createHash("sha256").update("http://127.0.0.1:18787/").digest("hex"),
      bindingSource: "protected_runtime_operational_config",
      source: "loopback_bind_probe",
      verified: true
    },
    observedEffects: {
      runtimeStopCount: 0,
      runtimeStartCount: 0,
      databaseMigrationCount: 0,
      telegramSendCount: 0,
      readOnlyOperationCount: 12,
      operationIds: [
        "operator_config_read", "candidate_state_read_before", "previous_runtime_read_before",
        "sanitized_runtime_binding_read", "runtime_manager_registry_read", "production_database_read_only",
        "rollback_worktree_read", "postgres_tools_read_only", "artifact_root_probe", "candidate_port_probe",
        "candidate_state_read_after", "previous_runtime_read_after"
      ],
      operationSequenceSha256: createHash("sha256").update(JSON.stringify([
        "operator_config_read", "candidate_state_read_before", "previous_runtime_read_before",
        "sanitized_runtime_binding_read", "runtime_manager_registry_read", "production_database_read_only",
        "rollback_worktree_read", "postgres_tools_read_only", "artifact_root_probe", "candidate_port_probe",
        "candidate_state_read_after", "previous_runtime_read_after"
      ])).digest("hex"),
      source: "instrumented_read_only_operation_ledger"
    }
  };
}

const RELEASE_V2_TASK0B_EVIDENCE = buildTask0BReleaseFreezeEvidence({ observedAt: RELEASE_V2_NOW });
export function buildReleaseFreezeIdentityV2Fixture(
  task0b: ReturnType<typeof buildTask0BReleaseFreezeEvidence>
) {
  const task0BSha256 = createHash("sha256")
    .update(`${canonicalFixtureJson(task0b)}\n`, "utf8").digest("hex");
  const generationSha256 = createHash("sha256").update(canonicalFixtureJson([
    "release-freeze-generation-v2",
    task0b.candidateSha,
    task0b.artifactRoot.rootFingerprintSha256,
    task0BSha256
  ])).digest("hex");
  return {
    version: "release-freeze-identity-v2" as const,
    releaseGenerationId: `release-generation-${generationSha256.slice(0, 32)}`,
    candidateSha: task0b.candidateSha,
    planBaseSha: PLAN_BASE_SHA,
    artifactRootFingerprintSha256: task0b.artifactRoot.rootFingerprintSha256,
  artifactRootTrustBoundaryEvidenceSha256: createHash("sha256")
      .update(`${canonicalFixtureJson(task0b.artifactRoot)}\n`, "utf8").digest("hex"),
  productionDatabaseIdentityFingerprintSha256:
      task0b.productionDatabase.approvedIdentityFingerprintSha256,
  postgresToolIdentitySha256: createHash("sha256")
      .update(`${canonicalFixtureJson(task0b.postgresTools)}\n`, "utf8").digest("hex"),
  previousRuntimeDiscoverySha256: createHash("sha256")
      .update(`${canonicalFixtureJson(task0b.previousRuntimeIdentity)}\n`, "utf8").digest("hex"),
  rollbackWorktreeIdentitySha256: createHash("sha256")
      .update(`${canonicalFixtureJson(task0b.rollbackWorktree)}\n`, "utf8").digest("hex"),
    createdAt: task0b.freezeCutoff
  };
}

export const RELEASE_V2_FREEZE_IDENTITY = Object.freeze(
  buildReleaseFreezeIdentityV2Fixture(RELEASE_V2_TASK0B_EVIDENCE)
);

export const RELEASE_V2_FREEZE_SHA256 = createHash("sha256")
  .update(`${canonicalFixtureJson(RELEASE_V2_FREEZE_IDENTITY)}\n`, "utf8").digest("hex");

export const REQUIRED_SUITE_GROUPS = {
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
    "tests/release/productionBackup.acceptance.test.ts",
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

export type ReleaseGateState = "pending" | "passed" | "failed" | "blocked";
export type ReleaseOverall = "not_ready" | "ready_for_release" | "released" | "rolled_back";

export type ReleaseArtifactV1 = {
  id: string;
  candidateSha: string;
  commandId: string;
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

export function buildReleaseManifest(overall: ReleaseOverall = "ready_for_release"): RemediationReleaseManifestV1 {
  const productionState: ReleaseGateState = overall === "released" ? "passed" : "pending";
  return {
    version: "remediation-release-manifest-v1",
    candidateSha: CANDIDATE_SHA,
    planBaseSha: PLAN_BASE_SHA,
    requiredRequirementIds: [...REQUIRED_REQUIREMENT_IDS],
    requiredAcceptanceIds: [...REQUIRED_ACCEPTANCE_IDS],
    gates: REQUIRED_GATE_IDS.map((id, index) => ({
      id,
      candidateSha: CANDIDATE_SHA,
      commandId: GATE_COMMAND_IDS[id],
      redactedTemplateSha256: COMMAND_TEMPLATE_SHA256[GATE_COMMAND_IDS[id]],
      startedAt: `2026-07-17T10:${String(index).padStart(2, "0")}:00.000Z`,
      finishedAt: `2026-07-17T10:${String(index).padStart(2, "0")}:30.000Z`,
      exitCode: 0,
      outputSha256: (index + 101).toString(16).padStart(64, "0"),
      state: index < PRE_RELEASE_GATE_IDS.length ? "passed" : productionState
    })),
    manualTelegramEvidenceSha256: "1".repeat(64),
    migrationEvidenceSha256: "2".repeat(64),
    rollbackEvidenceSha256: "3".repeat(64),
    overall
  };
}

export const PRIMARY_AC_FULL_NAMES = [
  "[AC-01] caps collector-only evidence at REVIEW 35",
  "[AC-02] allows collector 55 only with an independent eligible AML signal",
  "[AC-03] scores 2 percent outbound USDD PSM with direction adjustment",
  "[AC-04] scores 83 percent direct inbound USDD PSM at top tier",
  "[AC-05] halves historical Deep USDD PSM and caps modifier at 12",
  "[AC-06] keeps label-only or discontinuous USDD PSM unscored",
  "[AC-07] renders the active non-Fast score anchor first",
  "[AC-08] links the checked wallet in every Telegram result type",
  "[AC-09] safely shortens and links every valid TRON address",
  "[AC-10][REQ-30] selects the synthetic TKg latest-five principal slice including the 305 pair",
  "[AC-11][REQ-02][REQ-30] excludes exact GasFree fee before taking five principal rows",
  "[AC-12] distinguishes true no-activity from small principal flow",
  "[AC-13] persists and renders available selected and excluded counts",
  "[AC-14] reconciles and claims an all-ready parent exactly once",
  "[AC-15] resumes mixed ready-terminal waits through technical path",
  "[AC-16] retries Telegram delivery without duplicating sent fingerprint",
  "[AC-17] keeps normal navigation cache-only and refresh explicit",
  "[AC-18] returns check callbacks before slow work completes",
  "[AC-19] scores confirmed unlimited Verify20 approval at CRITICAL 90",
  "[AC-20] shows confirmed balance at risk and no debit found",
  "[AC-21] keeps campaign counts and BTTOLD sequence as context only",
  "[AC-22] caps one selector or provider name at review context",
  "[AC-23] removes active threat after confirmed zero allowance",
  "[AC-24] reports failed allowance check as unconfirmed current state",
  "[AC-25] recognizes exact Bridgers 66-second 91.103009 session as LOW 10",
  "[AC-26] refuses service-session dampener for tag-only evidence",
  "[AC-27] omits transaction expiration from approval Telegram copy",
  "[AC-28] removes transaction expiration from approval risk",
  "[AC-29] resolves official TRON USDT at LOW 0 without LLM",
  "[AC-30] resolves GasFree Account at LOW 10 without LLM and keeps flows eligible",
  "[AC-31] keeps exact Bridgers approval session LOW instead of decline",
  "[AC-32] keeps known-service unlimited approval without session at REVIEW 45",
  "[AC-33] prevents service-context dampening of provider risk Verify20 or debit proof",
  "[AC-34][LLM-DISABLED] ignores every fresh LLM score payload",
  "[AC-35][LLM-DISABLED] ignores every verdict and recommendation payload",
  "[AC-36][LLM-LEGACY] keeps cached citations as audit-only payload",
  "[AC-37][LLM-DISABLED] keeps risky or uncited legacy verdict out of fresh decisions",
  "[AC-38][LLM-NOCALL] makes zero provider calls for timeout JSON and schema scenarios",
  "[AC-39][LEGACY-LLM-INCOMING] excludes live-like and cached model fields from the real Incoming formatter",
  "[AC-40] bypasses Flash and Pro for every fresh contract case",
  "[AC-41] validates the release regression manifest and required suite set"
] as const;

const PRIMARY_AC_TEST_FILES = [
  ...Array(6).fill("tests/risk/collectorUsddRemediation.acceptance.test.ts"),
  ...Array(3).fill("tests/telegram/unifiedForensicRenderer.acceptance.test.ts"),
  ...Array(2).fill("tests/forensics/recentFlowProvenanceSelection.test.ts"),
  "tests/telegram/unifiedForensicRenderer.acceptance.test.ts",
  "tests/storage/unifiedTelegramCoverage.postgres.test.ts",
  ...Array(2).fill("tests/runtime/waitReconciliation.acceptance.test.ts"),
  "tests/runtime/telegramDelivery.acceptance.test.ts",
  "tests/runtime/walletNavigation.acceptance.test.ts",
  "tests/runtime/checkCallbacks.acceptance.test.ts",
  "tests/approvals/approvalSafetyV2.acceptance.test.ts",
  "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts",
  "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts",
  "tests/approvals/approvalSafetyV2.acceptance.test.ts",
  "tests/approvals/approvalSafetyV2.acceptance.test.ts",
  "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts",
  "tests/approvals/approvalSafetyV2.acceptance.test.ts",
  "tests/approvals/approvalSafetyV2.acceptance.test.ts",
  "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts",
  "tests/approvals/approvalSafetyV2.acceptance.test.ts",
  ...Array(5).fill("tests/check/contractDecisionV2.acceptance.test.ts"),
  ...Array(5).fill("tests/forensics/contractLlmIsolation.acceptance.test.ts"),
  "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts",
  "tests/check/contractDecisionV2.acceptance.test.ts",
  "tests/release/remediationReleaseManifest.acceptance.test.ts"
];

export type AcceptanceTraceV1 = {
  acceptanceId: string;
  requirementIds: string[];
  ownerPlan: 1 | 2 | 3 | 4 | 5;
  ownerCommitSha: string;
  testFile: string;
  fullName: string;
  primary: boolean;
  red: {
    baseSha: string;
    testPatchSha256: string;
    vitestReportSha256: string;
    expectedFailureFingerprint: string;
    status: "failed_as_expected";
  };
  green: {
    candidateSha: string;
    vitestReportSha256: string;
    status: "passed";
  };
};

export type AcceptanceExecutionV1 = {
  testFile: string;
  fullName: string;
  status: "passed" | "failed" | "skipped" | "todo";
};

export type AcceptanceTraceSetV1 = {
  version: "acceptance-trace-set-v1";
  candidateSha: string;
  requiredRequirementIds: string[];
  requiredAcceptanceIds: string[];
  traces: AcceptanceTraceV1[];
  executions: AcceptanceExecutionV1[];
  ancestorCommitShas: string[];
};

export function buildAcceptanceTraceSet(): AcceptanceTraceSetV1 {
  const traces = REQUIRED_ACCEPTANCE_IDS.map((acceptanceId, index): AcceptanceTraceV1 => {
    const ownerPlan = (index === 40 ? 5 : index < 6 ? 2 : index < 13 ? 4 : index < 18 ? 3 : index < 33 ? 2 : 4) as 1 | 2 | 3 | 4 | 5;
    const ownerCommitSha = String(ownerPlan).repeat(40);
    return {
      acceptanceId,
      requirementIds: [REQUIRED_REQUIREMENT_IDS[index % REQUIRED_REQUIREMENT_IDS.length]],
      ownerPlan,
      ownerCommitSha,
      testFile: PRIMARY_AC_TEST_FILES[index],
      fullName: PRIMARY_AC_FULL_NAMES[index],
      primary: true,
      red: {
        baseSha: PLAN_BASE_SHA,
        testPatchSha256: (index + 201).toString(16).padStart(64, "0"),
        vitestReportSha256: (index + 301).toString(16).padStart(64, "0"),
        expectedFailureFingerprint: `expected_behavioral_assertion_${acceptanceId.toLowerCase()}`,
        status: "failed_as_expected"
      },
      green: {
        candidateSha: CANDIDATE_SHA,
        vitestReportSha256: (index + 401).toString(16).padStart(64, "0"),
        status: "passed"
      }
    };
  });
  return {
    version: "acceptance-trace-set-v1",
    candidateSha: CANDIDATE_SHA,
    requiredRequirementIds: [...REQUIRED_REQUIREMENT_IDS],
    requiredAcceptanceIds: [...REQUIRED_ACCEPTANCE_IDS],
    traces,
    executions: traces.map(({ testFile, fullName }) => ({ testFile, fullName, status: "passed" })),
    ancestorCommitShas: [...new Set(traces.map((trace) => trace.ownerCommitSha))]
  };
}

export type RuntimeVersionV1 = {
  version: "runtime-version-v1";
  gitCommitSha: string;
  runtimeInstanceLabel: string;
  scoringPolicyVersion: "scoring-signal-matrix-v3";
  resultSchemaVersion: "score-anchor-v2+forensic-coverage-v2";
  narrativeVersion: "telegram-forensic-result-v1";
  migration: {
    verified: true;
    version: 32;
    filename: typeof SCHEMA_032_FILENAME;
    checksumSha256: string;
    shortChecksum: string;
  };
};

export function buildRuntimeVersion(): RuntimeVersionV1 {
  return {
    version: "runtime-version-v1",
    gitCommitSha: CANDIDATE_SHA,
    runtimeInstanceLabel: RUNTIME_LABEL,
    scoringPolicyVersion: "scoring-signal-matrix-v3",
    resultSchemaVersion: "score-anchor-v2+forensic-coverage-v2",
    narrativeVersion: "telegram-forensic-result-v1",
    migration: {
      verified: true,
      version: 32,
      filename: SCHEMA_032_FILENAME,
      checksumSha256: SCHEMA_032_CHECKSUM,
      shortChecksum: SCHEMA_032_CHECKSUM.slice(0, 12)
    }
  };
}

export type Schema032ReleaseEvidenceV1 = {
  candidateSha: string;
  databaseRole: "clean" | "production_clone" | "runtime_sanitized" | "production";
  databaseFingerprintSha256: string;
  migrationFilename: typeof SCHEMA_032_FILENAME;
  candidateBytesChecksumSha256: string;
  receiptChecksumSha256: string;
  shortChecksum: string;
  postconditionsSha256: string;
  firstApply: "applied" | "already_verified";
  secondApply: "already_verified";
};

export function buildSchema032ReleaseEvidence(): Schema032ReleaseEvidenceV1 {
  return {
    candidateSha: CANDIDATE_SHA,
    databaseRole: "runtime_sanitized",
    databaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT,
    migrationFilename: SCHEMA_032_FILENAME,
    candidateBytesChecksumSha256: SCHEMA_032_CHECKSUM,
    receiptChecksumSha256: SCHEMA_032_CHECKSUM,
    shortChecksum: SCHEMA_032_CHECKSUM.slice(0, 12),
    postconditionsSha256: POSTCONDITIONS_SHA256,
    firstApply: "applied",
    secondApply: "already_verified"
  };
}

export const MANUAL_SCENARIO_IDS = [
  "GOLDEN_FINAL_AML",
  "GOLDEN_WHERE_PRELIMINARY",
  "GOLDEN_NO_FINAL_TECHNICAL",
  "GOLDEN_TRUE_NO_ACTIVITY",
  "GOLDEN_VERIFY20_ACTIVE_NO_DEBIT",
  "GOLDEN_VERIFY20_EXACT_DEBIT",
  "GOLDEN_BRIDGERS_ACTIVE",
  "GOLDEN_BRIDGERS_ZERO",
  "GOLDEN_BRIDGERS_ALLOWANCE_UNKNOWN",
  "GOLDEN_USDD_PSM",
  "GOLDEN_GASFREE_ACCOUNT",
  "THJ_COLLECTOR_VARIANTS",
  "TKG_LOW_BALANCE_AND_COVERAGE",
  "OFFICIAL_USDT_AND_PSM_OUTBOUND",
  "INCOMING_FAIL_CLOSED"
] as const;

export const MANUAL_GOLDEN_IDS = MANUAL_SCENARIO_IDS.slice(0, 11);

export type ManualTelegramMessageRecordV1 = {
  id: string;
  scenarioId: string;
  candidateSha: string;
  runtimeLabel: string;
  checkedWallet: string;
  jobId: string;
  telegramMessageId: number;
  payloadSha256: string;
  screenshotFilename: string;
  screenshotSha256: string;
  requirementIds: string[];
  result: "pass" | "fail";
};

export type ManualTelegramScenarioSummaryV1 = {
  scenarioId: string;
  candidateSha: string;
  runtimeLabel: string;
  messageRecordIds: string[];
  fixtureIds: string[];
  goldenIds: string[];
  requirementIds: string[];
  reviewer: string;
  reviewedAt: string;
  result: "pass" | "fail";
};

export type ManualTelegramAcceptanceV1 = {
  version: "manual-telegram-acceptance-v1";
  candidateSha: string;
  messageRecords: ManualTelegramMessageRecordV1[];
  scenarioSummaries: ManualTelegramScenarioSummaryV1[];
};

export function buildManualTelegramAcceptance(): ManualTelegramAcceptanceV1 {
  const messageRecords: ManualTelegramMessageRecordV1[] = [];
  const scenarioSummaries = MANUAL_TELEGRAM_ACCEPTANCE_CASES.map((definition, scenarioIndex): ManualTelegramScenarioSummaryV1 => {
    const scenarioId = definition.artifactId;
    const messageRecordIds: string[] = [];
    for (const fixtureId of definition.fixtureIds) {
      const sequence = messageRecords.length + 1;
      const id = `message-${String(sequence).padStart(2, "0")}`;
      const fixture = remediationTelegramUxCase(fixtureId);
      const rendered = renderTelegramForensicResult(adaptTelegramForensicResult(fixture.source));
      const payloadSha256 = fingerprintTelegramMessagePayload({
        version: "telegram-message-payload-v1",
        chatId: "recording_disabled",
        text: rendered,
        parseMode: "HTML",
        replyMarkup: null
      });
      messageRecordIds.push(id);
      messageRecords.push({
        id,
        scenarioId,
        candidateSha: CANDIDATE_SHA,
        runtimeLabel: RUNTIME_LABEL,
        checkedWallet: fixture.source.checkedWalletAddress,
        jobId: `synthetic-job-${String(sequence).padStart(2, "0")}`,
        telegramMessageId: 1000 + sequence,
        payloadSha256,
        screenshotFilename: `${id}.png`,
        screenshotSha256: (sequence + 100).toString(16).padStart(64, "0"),
        requirementIds: [...definition.expectedRequirementIds],
        result: "pass"
      });
    }
    return {
      scenarioId,
      candidateSha: CANDIDATE_SHA,
      runtimeLabel: RUNTIME_LABEL,
      messageRecordIds,
      fixtureIds: [...definition.fixtureIds],
      goldenIds: [...definition.goldenIds],
      requirementIds: [...definition.expectedRequirementIds],
      reviewer: "release-reviewer",
      reviewedAt: `2026-07-17T12:${String(scenarioIndex).padStart(2, "0")}:00.000Z`,
      result: "pass"
    };
  });
  return {
    version: "manual-telegram-acceptance-v1",
    candidateSha: CANDIDATE_SHA,
    messageRecords,
    scenarioSummaries
  };
}

export type TerminalLegacyPopulationV1 = {
  candidateSha: string;
  cutoff: string;
  cutoffSource: "task0b_release_freeze";
  task0bEvidenceSha256: string;
  databaseRole: "runtime_sanitized";
  databaseName: "tron_watch_plan5_runtime_sanitized";
  databaseFingerprintSha256: string;
  terminalStatuses: ["completed", "failed", "cancelled"];
  populationCount: number;
  sortedJobIdSetSha256: string;
  aggregateImmutableResultSha256: string;
  sentFingerprintSetSha256: string;
  queryTemplateSha256: string;
};

export function buildTerminalLegacyPopulation(): TerminalLegacyPopulationV1 {
  return {
    candidateSha: CANDIDATE_SHA,
    cutoff: "2026-07-18T00:00:00.000Z",
    cutoffSource: "task0b_release_freeze",
    task0bEvidenceSha256: "a".repeat(64),
    databaseRole: "runtime_sanitized",
    databaseName: "tron_watch_plan5_runtime_sanitized",
    databaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT,
    terminalStatuses: ["completed", "failed", "cancelled"],
    populationCount: 37,
    sortedJobIdSetSha256: "4".repeat(64),
    aggregateImmutableResultSha256: "5".repeat(64),
    sentFingerprintSetSha256: "6".repeat(64),
    queryTemplateSha256: "93d1a73f335b1b80f805f16fb9619fc4740e523cd76f4140d6480bc254bcfab3"
  };
}

export type RollbackRehearsalEvidenceV1 = {
  candidateSha: string;
  previousRuntimeSha: string;
  previousRuntimeLabel: string;
  startCommandId: "rollback_rehearsal";
  startCommandTemplateSha256: string;
  schemaEvidenceSha256: string;
  previousStartEvidenceSha256: string;
  migratedSanitizedDatabaseFingerprintSha256: string;
  schemaVerification: RuntimeVersionV1["migration"];
  telegramTransport: "recording_disabled";
  outboundSendCount: 0;
  previousRuntimeStarted: true;
  adminHealthStatus: 200;
  runtimeInstanceCount: 1;
  workerScheduleCount: 1;
  observedPreviousVersionSha: string;
  observedPreviousVersionLabel: string;
  conservativeAllowanceMirrorsVerified: true;
  terminalLegacyPopulationBefore: TerminalLegacyPopulationV1;
  terminalLegacyPopulationAfter: TerminalLegacyPopulationV1;
  completedResultsSha256Before: string;
  completedResultsSha256After: string;
  sentFingerprintSetSha256Before: string;
  sentFingerprintSetSha256After: string;
  remainingProcessCount: 0;
  remainingAdvisoryLockCount: 0;
};

export function buildRollbackRehearsalEvidence(): RollbackRehearsalEvidenceV1 {
  const terminalLegacyPopulationBefore = buildTerminalLegacyPopulation();
  return {
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL,
    startCommandId: "rollback_rehearsal",
    startCommandTemplateSha256: ROLLBACK_COMMAND_TEMPLATE_SHA256,
    schemaEvidenceSha256: RUNTIME_SCHEMA_EVIDENCE_SHA256,
    previousStartEvidenceSha256: PREVIOUS_START_EVIDENCE_SHA256,
    migratedSanitizedDatabaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT,
    schemaVerification: buildRuntimeVersion().migration,
    telegramTransport: "recording_disabled",
    outboundSendCount: 0,
    previousRuntimeStarted: true,
    adminHealthStatus: 200,
    runtimeInstanceCount: 1,
    workerScheduleCount: 1,
    observedPreviousVersionSha: PREVIOUS_RUNTIME_SHA,
    observedPreviousVersionLabel: PREVIOUS_RUNTIME_LABEL,
    conservativeAllowanceMirrorsVerified: true,
    terminalLegacyPopulationBefore,
    terminalLegacyPopulationAfter: structuredClone(terminalLegacyPopulationBefore),
    completedResultsSha256Before: "8".repeat(64),
    completedResultsSha256After: "8".repeat(64),
    sentFingerprintSetSha256Before: "9".repeat(64),
    sentFingerprintSetSha256After: "9".repeat(64),
    remainingProcessCount: 0,
    remainingAdvisoryLockCount: 0
  };
}

export type RuntimeRehearsalEvidenceV1 = {
  version: "runtime-rehearsal-evidence-v1";
  candidateSha: string;
  previousRuntimeSha: string;
  databaseRole: "runtime_sanitized";
  sanitizedDatabaseFingerprintSha256: string;
  productionCloneDatabaseFingerprintSha256: string;
  schemaEvidenceSha256: string;
  candidateStartEvidenceSha256: string;
  previousStartEvidenceSha256: string;
  telegramTransport: "recording_disabled";
  outboundSendCount: 0;
  candidate: {
    observedSha: string;
    observedLabel: string;
    startCommandId: "runtime_sanitized_rehearsal";
    startCommandTemplateSha256: string;
    startEvidenceSha256: string;
    adminHealthStatus: 200;
    runtimeInstanceCount: 1;
    workerScheduleCount: 1;
  };
  previous: {
    observedSha: string;
    observedLabel: string;
    startCommandId: "rollback_rehearsal";
    startCommandTemplateSha256: string;
    startEvidenceSha256: string;
    adminHealthStatus: 200;
    runtimeInstanceCount: 1;
    workerScheduleCount: 1;
  };
};

export function buildRuntimeRehearsalEvidence(): RuntimeRehearsalEvidenceV1 {
  return {
    version: "runtime-rehearsal-evidence-v1",
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    databaseRole: "runtime_sanitized",
    sanitizedDatabaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT,
    productionCloneDatabaseFingerprintSha256: PRODUCTION_CLONE_DATABASE_FINGERPRINT,
    schemaEvidenceSha256: RUNTIME_SCHEMA_EVIDENCE_SHA256,
    candidateStartEvidenceSha256: CANDIDATE_START_EVIDENCE_SHA256,
    previousStartEvidenceSha256: PREVIOUS_START_EVIDENCE_SHA256,
    telegramTransport: "recording_disabled",
    outboundSendCount: 0,
    candidate: {
      observedSha: CANDIDATE_SHA,
      observedLabel: RUNTIME_LABEL,
      startCommandId: "runtime_sanitized_rehearsal",
      startCommandTemplateSha256: COMMAND_TEMPLATE_SHA256.runtime_sanitized_rehearsal,
      startEvidenceSha256: CANDIDATE_START_EVIDENCE_SHA256,
      adminHealthStatus: 200,
      runtimeInstanceCount: 1,
      workerScheduleCount: 1
    },
    previous: {
      observedSha: PREVIOUS_RUNTIME_SHA,
      observedLabel: PREVIOUS_RUNTIME_LABEL,
      startCommandId: "rollback_rehearsal",
      startCommandTemplateSha256: COMMAND_TEMPLATE_SHA256.rollback_rehearsal,
      startEvidenceSha256: PREVIOUS_START_EVIDENCE_SHA256,
      adminHealthStatus: 200,
      runtimeInstanceCount: 1,
      workerScheduleCount: 1
    }
  };
}

export function cloneFixture<T>(value: T): T {
  return structuredClone(value);
}
