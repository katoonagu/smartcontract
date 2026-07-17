export const REMEDIATION_REQUIRED_REQUIREMENT_IDS = numberedIds("REQ", 38);
export const REMEDIATION_REQUIRED_ACCEPTANCE_IDS = numberedIds("AC", 41);

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
export type ReleaseCommandId = typeof REMEDIATION_GATE_COMMAND_IDS[ReleaseGateId];
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

function numberedIds(prefix: "REQ" | "AC", count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`);
}

function normalizedKey(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

function isSecretKey(value: string): boolean {
  const key = normalizedKey(value);
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
      : "ready_for_release";
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
