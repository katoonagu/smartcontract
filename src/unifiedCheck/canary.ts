import { TronWeb } from "tronweb";
import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import type { UnifiedRunPurpose } from "./contracts";
import {
  intakeUnifiedCheck,
  type AnalysisRunRecord,
  type CheckRequestRecord,
  type UnifiedAnalysisVersions,
  type UnifiedInitialTask,
  type UnifiedRequestStore
} from "./requestService";
import {
  UNIFIED_CANARY_SELECTION_QUERY,
  UNIFIED_CANARY_SELECTION_QUERY_VERSION
} from "./repository";
import type { SnapshotSource } from "./snapshot";
import type { UnifiedWatchdogRunV1 } from "./watchdog";
import type {
  UnifiedRollingRolloutStage
} from "./rolloutPolicy";

const EXCLUDED_REGRESSION_ADDRESSES = new Set([
  "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
  "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP"
]);
const CANARY_SIZE = 8;
const DEADLINE_MS = 35 * 60 * 1_000;
const TASK_KINDS = [
  "direct_history",
  "deep_direct",
  "traversal",
  "fast",
  "where",
  "deep"
] as const;

export function parseUnifiedCanaryCli(
  args: readonly string[],
  now = new Date()
): {
  readonly candidateCommit: string;
  readonly cutoffAt: string;
  readonly diagnosticHypothesisPath: string | null;
  readonly resumeBatchIdentitySha256: string | null;
  readonly outputDirectory: string;
} {
  const allowed = new Set([
    "--candidate",
    "--cutoff",
    "--output",
    "--hypothesis",
    "--resume"
  ]);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      name === undefined ||
      !allowed.has(name) ||
      values.has(name) ||
      value === undefined ||
      value.startsWith("--")
    ) {
      throw new Error("unified_canary_cli_invalid");
    }
    values.set(name, value);
  }
  const candidateCommit = values.get("--candidate") ?? "";
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(candidateCommit)) {
    throw new Error("unified_canary_candidate_invalid");
  }
  const cutoffAt = timestamp(
    values.get("--cutoff") ?? now.toISOString(),
    "unified_canary_cutoff_invalid"
  );
  const resumeBatchIdentitySha256 = values.get("--resume") ?? null;
  if (
    resumeBatchIdentitySha256 !== null &&
    (
      !/^[0-9a-f]{64}$/u.test(resumeBatchIdentitySha256) ||
      values.has("--cutoff") ||
      values.has("--hypothesis")
    )
  ) {
    throw new Error("unified_canary_resume_invalid");
  }
  return {
    candidateCommit,
    cutoffAt,
    diagnosticHypothesisPath: values.get("--hypothesis") ?? null,
    resumeBatchIdentitySha256,
    outputDirectory:
      values.get("--output") ?? "artifacts/unified-wallet-canary"
  };
}

export type UnifiedCanarySelectionRowV1 = {
  readonly sourceTable: "unified_check_requests" | "forensic_check_jobs";
  readonly sourceRowId: string;
  readonly subjectAddress: string;
  readonly runPurpose: UnifiedRunPurpose | string;
  readonly locale: "ru" | "en";
  readonly acceptedAt: string | null;
  readonly createdAt: string;
  readonly provenUserOrigin: boolean;
};

export type UnifiedCanarySelectionManifestV1 = {
  readonly version: "unified-canary-selection-manifest-v1";
  readonly schemaVersion: 1;
  readonly cutoffAt: string;
  readonly source: {
    readonly table:
      | "unified_check_requests"
      | "adaptive_benchmark_cli";
    readonly provenLegacyTable: "forensic_check_jobs" | null;
    readonly provenLegacyRule:
      | "address_fast_check+chat_id+telegram_user_requested_by"
      | null;
    readonly databaseSchemaVersion: number;
    readonly databaseSchemaChecksumSha256: string;
    readonly schema032ChecksumSha256: string;
    readonly candidateCommit: string;
    readonly activeGenerationId: string;
    readonly activeGenerationActivatedAt: string;
    readonly queryVersion: string;
    readonly querySha256: string;
  };
  readonly selected: readonly {
    readonly subjectAddress: string;
    readonly locale: "ru" | "en";
    readonly latestAt: string;
    readonly sourceTable:
      "unified_check_requests" | "forensic_check_jobs";
    readonly sourceRowId: string;
    readonly scenarioId?: string;
  }[];
};

export function buildUnifiedAdaptiveBenchmarkSelection(input: {
  readonly scenarios: readonly {
    readonly scenarioId: string;
    readonly subjectAddress: string;
    readonly locale: "ru" | "en";
  }[];
  readonly cutoffAt: string;
  readonly candidateCommit: string;
  readonly activeGeneration: {
    readonly generationId: string;
    readonly activatedAt: string;
    readonly runtimeCommit: string;
  };
  readonly databaseSchema: {
    readonly version: number;
    readonly checksumSha256: string;
    readonly schema032ChecksumSha256: string;
  };
}): UnifiedCanarySelectionManifestV1 {
  const cutoffAt = timestamp(
    input.cutoffAt,
    "unified_canary_cutoff_invalid"
  );
  if (
    input.scenarios.length < 1 ||
    input.scenarios.length > 100 ||
    new Set(input.scenarios.map((item) => item.scenarioId)).size !==
      input.scenarios.length ||
    input.scenarios.some((item) =>
      !item.scenarioId.trim() ||
      !TronWeb.isAddress(item.subjectAddress) ||
      !["ru", "en"].includes(item.locale)
    )
  ) {
    throw new TypeError("unified_benchmark_canary_selection_invalid");
  }
  const base = buildUnifiedCanarySelectionProvenance(input);
  const selected = input.scenarios.map((item) => ({
    subjectAddress: item.subjectAddress,
    locale: item.locale,
    latestAt: cutoffAt,
    sourceTable: "unified_check_requests" as const,
    sourceRowId: `adaptive-benchmark:${item.scenarioId}`,
    scenarioId: item.scenarioId
  }));
  const planSha256 = fingerprintCanonicalArtifact({
    version: "unified-adaptive-benchmark-canary-plan-v1",
    selected
  });
  return {
    version: "unified-canary-selection-manifest-v1",
    schemaVersion: 1,
    cutoffAt,
    source: {
      ...base,
      table: "adaptive_benchmark_cli",
      provenLegacyTable: null,
      provenLegacyRule: null,
      queryVersion: "adaptive-benchmark-explicit-v1",
      querySha256: planSha256
    },
    selected
  };
}

function buildUnifiedCanarySelectionProvenance(input: {
  readonly candidateCommit: string;
  readonly activeGeneration: {
    readonly generationId: string;
    readonly activatedAt: string;
    readonly runtimeCommit: string;
  };
  readonly databaseSchema: {
    readonly version: number;
    readonly checksumSha256: string;
    readonly schema032ChecksumSha256: string;
  };
}) {
  if (
    !Number.isSafeInteger(input.databaseSchema.version) ||
    input.databaseSchema.version < 33 ||
    !/^[0-9a-f]{64}$/u.test(input.databaseSchema.checksumSha256) ||
    !/^[0-9a-f]{64}$/u.test(input.databaseSchema.schema032ChecksumSha256)
  ) {
    throw new TypeError("unified_canary_schema_version_invalid");
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(input.candidateCommit)) {
    throw new TypeError("unified_canary_candidate_invalid");
  }
  if (
    !input.activeGeneration.generationId.trim() ||
    timestamp(
      input.activeGeneration.activatedAt,
      "unified_canary_generation_activated_at_invalid"
    ) !== input.activeGeneration.activatedAt ||
    input.activeGeneration.runtimeCommit !== input.candidateCommit
  ) {
    throw new TypeError("unified_canary_active_generation_invalid");
  }
  return {
    databaseSchemaVersion: input.databaseSchema.version,
    databaseSchemaChecksumSha256: input.databaseSchema.checksumSha256,
    schema032ChecksumSha256:
      input.databaseSchema.schema032ChecksumSha256,
    candidateCommit: input.candidateCommit,
    activeGenerationId: input.activeGeneration.generationId,
    activeGenerationActivatedAt: input.activeGeneration.activatedAt
  };
}

function timestamp(value: string, code: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(code);
  }
  return value;
}

function latest(row: UnifiedCanarySelectionRowV1): string {
  const createdAt = timestamp(
    row.createdAt,
    "unified_canary_source_created_at_invalid"
  );
  if (row.acceptedAt === null) return createdAt;
  const acceptedAt = timestamp(
    row.acceptedAt,
    "unified_canary_source_accepted_at_invalid"
  );
  return Date.parse(acceptedAt) >= Date.parse(createdAt)
    ? acceptedAt
    : createdAt;
}

export function buildUnifiedCanarySelection(input: {
  readonly rows: readonly UnifiedCanarySelectionRowV1[];
  readonly cutoffAt: string;
  readonly candidateCommit: string;
  readonly activeGeneration: {
    readonly generationId: string;
    readonly activatedAt: string;
    readonly runtimeCommit: string;
  };
  readonly databaseSchema: {
    readonly version: number;
    readonly checksumSha256: string;
    readonly schema032ChecksumSha256: string;
  };
}): UnifiedCanarySelectionManifestV1 {
  const cutoffAt = timestamp(
    input.cutoffAt,
    "unified_canary_cutoff_invalid"
  );
  const provenance = buildUnifiedCanarySelectionProvenance(input);
  const cutoff = Date.parse(cutoffAt);
  const newestByAddress = new Map<string, {
    row: UnifiedCanarySelectionRowV1;
    latestAt: string;
  }>();
  for (const row of input.rows) {
    if (
      !["unified_check_requests", "forensic_check_jobs"].includes(
        row.sourceTable
      ) ||
      row.runPurpose !== "user_check" ||
      row.provenUserOrigin !== true ||
      !TronWeb.isAddress(row.subjectAddress) ||
      EXCLUDED_REGRESSION_ADDRESSES.has(row.subjectAddress) ||
      !["ru", "en"].includes(row.locale)
    ) continue;
    const latestAt = latest(row);
    if (Date.parse(latestAt) > cutoff) continue;
    const previous = newestByAddress.get(row.subjectAddress);
    if (
      !previous ||
      Date.parse(latestAt) > Date.parse(previous.latestAt) ||
      (
        latestAt === previous.latestAt &&
        row.sourceRowId.localeCompare(previous.row.sourceRowId) < 0
      )
    ) {
      newestByAddress.set(row.subjectAddress, { row, latestAt });
    }
  }
  const selected = [...newestByAddress.values()]
    .sort((left, right) =>
      Date.parse(right.latestAt) - Date.parse(left.latestAt) ||
      left.row.subjectAddress.localeCompare(right.row.subjectAddress)
    )
    .slice(0, CANARY_SIZE)
    .map(({ row, latestAt }) => ({
      subjectAddress: row.subjectAddress,
      locale: row.locale,
      latestAt,
      sourceTable: row.sourceTable,
      sourceRowId: row.sourceRowId
    }));
  if (selected.length !== CANARY_SIZE) {
    throw new Error("unified_canary_requires_exactly_eight_wallets");
  }
  return {
    version: "unified-canary-selection-manifest-v1",
    schemaVersion: 1,
    cutoffAt,
    source: {
      table: "unified_check_requests",
      provenLegacyTable: "forensic_check_jobs",
      provenLegacyRule:
        "address_fast_check+chat_id+telegram_user_requested_by",
      ...provenance,
      queryVersion: UNIFIED_CANARY_SELECTION_QUERY_VERSION,
      querySha256: fingerprintCanonicalArtifact(
        UNIFIED_CANARY_SELECTION_QUERY
      )
    },
    selected
  };
}

type PreparedCanaryRun = {
  readonly request: CheckRequestRecord;
  readonly candidateRun: AnalysisRunRecord;
  readonly reuseAllowed: false;
  readonly initialTasks: readonly UnifiedInitialTask[];
};

export type UnifiedCanaryBatchIdentityV1 = {
  readonly version: "unified-canary-batch-identity-v1";
  readonly schemaVersion: 1;
  readonly selectedSourceSetSha256: string;
  readonly snapshots: readonly {
    readonly subjectAddress: string;
    readonly snapshotSha256: string;
  }[];
  readonly candidateCommit: string;
  readonly activeGenerationId: string;
  readonly labelDatasetSha256: string;
  readonly scoringPolicyVersion: string;
  readonly attributionPolicyVersion: string;
  readonly traversalPolicyVersion: "snapshot-closure-v1";
  readonly providerSchemaVersion: "tronscan-transfer-page-v1";
  readonly providerConfiguration: {
    readonly sha256: string;
    readonly artifact: UnifiedCanaryProviderConfigurationV1;
  };
  readonly databaseSchemaVersion: number;
  readonly databaseSchemaChecksumSha256: string;
  readonly schema032ChecksumSha256: string;
  readonly diagnosticHypothesis: {
    readonly sha256: string;
    readonly artifact: UnifiedCanaryDiagnosticHypothesisV1;
  } | null;
};

export type UnifiedCanaryProviderConfigurationV1 = {
  readonly version: "unified-canary-provider-configuration-v1";
  readonly schemaVersion: 1;
  readonly tronscanBaseUrl: string;
  readonly tronFullNodeBaseUrl: string;
  readonly transferPageSize: 50;
  readonly timeoutMs: number;
  readonly retryAttempts: number;
  readonly retryBaseDelayMs: number;
  readonly rateLimitCooldownMs: number;
  readonly maxInFlight: number;
  readonly maxInFlightPerGroup: number;
  readonly intervalsMs: {
    readonly request: number;
    readonly global: number;
    readonly transfer: number;
    readonly approval: number;
    readonly contract: number;
    readonly fullNode: number;
    readonly tronGrid: number;
    readonly accountGroup: number;
  };
  readonly keyPool: {
    readonly tronscanKeyCount: number;
    readonly fullNodeKeyConfigured: boolean;
    readonly groups: readonly {
      readonly groupId: string;
      readonly keyCount: number;
    }[];
  };
};

export function buildUnifiedCanaryProviderConfiguration(input: {
  tronscanBaseUrl: URL;
  tronFullNodeBaseUrl: URL;
  timeoutMs: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
  rateLimitCooldownMs: number;
  maxInFlight: number;
  maxInFlightPerGroup: number;
  requestMinIntervalMs: number;
  globalRequestMinIntervalMs: number;
  transferRequestMinIntervalMs: number;
  approvalRequestMinIntervalMs: number;
  contractRequestMinIntervalMs: number;
  fullNodeRequestMinIntervalMs: number;
  tronGridRequestMinIntervalMs: number;
  accountGroupRequestMinIntervalMs: number;
  tronscanKeyCount: number;
  fullNodeKeyConfigured: boolean;
  groups: readonly { groupId: string; keyCount: number }[];
}): {
  readonly sha256: string;
  readonly artifact: UnifiedCanaryProviderConfigurationV1;
} {
  const artifact: UnifiedCanaryProviderConfigurationV1 = {
    version: "unified-canary-provider-configuration-v1",
    schemaVersion: 1,
    tronscanBaseUrl: input.tronscanBaseUrl.toString(),
    tronFullNodeBaseUrl: input.tronFullNodeBaseUrl.toString(),
    transferPageSize: 50,
    timeoutMs: input.timeoutMs,
    retryAttempts: input.retryAttempts,
    retryBaseDelayMs: input.retryBaseDelayMs,
    rateLimitCooldownMs: input.rateLimitCooldownMs,
    maxInFlight: input.maxInFlight,
    maxInFlightPerGroup: input.maxInFlightPerGroup,
    intervalsMs: {
      request: input.requestMinIntervalMs,
      global: input.globalRequestMinIntervalMs,
      transfer: input.transferRequestMinIntervalMs,
      approval: input.approvalRequestMinIntervalMs,
      contract: input.contractRequestMinIntervalMs,
      fullNode: input.fullNodeRequestMinIntervalMs,
      tronGrid: input.tronGridRequestMinIntervalMs,
      accountGroup: input.accountGroupRequestMinIntervalMs
    },
    keyPool: {
      tronscanKeyCount: input.tronscanKeyCount,
      fullNodeKeyConfigured: input.fullNodeKeyConfigured,
      groups: [...input.groups].sort((left, right) =>
        left.groupId.localeCompare(right.groupId)
      )
    }
  };
  const numericValues = [
    artifact.timeoutMs,
    artifact.retryAttempts,
    artifact.retryBaseDelayMs,
    artifact.rateLimitCooldownMs,
    artifact.maxInFlight,
    artifact.maxInFlightPerGroup,
    ...Object.values(artifact.intervalsMs),
    artifact.keyPool.tronscanKeyCount,
    ...artifact.keyPool.groups.map((group) => group.keyCount)
  ];
  if (
    numericValues.some((value) =>
      !Number.isSafeInteger(value) || value < 0
    ) ||
    artifact.keyPool.groups.some((group) => !group.groupId.trim())
  ) {
    throw new TypeError("unified_canary_provider_configuration_invalid");
  }
  return {
    sha256: fingerprintCanonicalArtifact(artifact),
    artifact
  };
}

export type UnifiedCanaryDiagnosticHypothesisV1 = {
  readonly version: "unified-canary-diagnostic-hypothesis-v1";
  readonly schemaVersion: 1;
  readonly hypothesisId: string;
  readonly reason: string;
  readonly changedInputs: readonly string[];
  readonly createdAt: string;
};

export function verifyUnifiedCanaryDiagnosticHypothesis(
  value: unknown
): {
  readonly sha256: string;
  readonly artifact: UnifiedCanaryDiagnosticHypothesisV1;
} {
  const artifact = value as Partial<UnifiedCanaryDiagnosticHypothesisV1>;
  const keys = value !== null && typeof value === "object" &&
      !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  const expectedKeys = [
    "changedInputs",
    "createdAt",
    "hypothesisId",
    "reason",
    "schemaVersion",
    "version"
  ];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    artifact?.version !== "unified-canary-diagnostic-hypothesis-v1" ||
    artifact.schemaVersion !== 1 ||
    typeof artifact.hypothesisId !== "string" ||
    !artifact.hypothesisId.trim() ||
    typeof artifact.reason !== "string" ||
    !artifact.reason.trim() ||
    !Array.isArray(artifact.changedInputs) ||
    artifact.changedInputs.length === 0 ||
    artifact.changedInputs.some((item) =>
      typeof item !== "string" || !item.trim() || item !== item.trim()
    ) ||
    new Set(artifact.changedInputs).size !== artifact.changedInputs.length ||
    [...artifact.changedInputs].sort((left, right) =>
      left.localeCompare(right)
    ).some((item, index) => item !== artifact.changedInputs![index]) ||
    typeof artifact.createdAt !== "string"
  ) {
    throw new TypeError("unified_canary_hypothesis_invalid");
  }
  timestamp(artifact.createdAt, "unified_canary_hypothesis_invalid");
  const verified = artifact as UnifiedCanaryDiagnosticHypothesisV1;
  return {
    sha256: fingerprintCanonicalArtifact(verified),
    artifact: verified
  };
}

export type UnifiedCanaryBatchRepository = {
  createBatch(input: {
    readonly selectionManifest: UnifiedCanarySelectionManifestV1;
    readonly batchIdentity: UnifiedCanaryBatchIdentityV1;
    readonly runs: readonly PreparedCanaryRun[];
  }): Promise<{
    readonly selectionManifestSha256: string;
    readonly batchIdentitySha256: string;
    readonly runs: readonly {
      readonly id: string;
      readonly createdAt: string;
    }[];
  }>;
};

function acceptedRequest(input: {
  id: string;
  correlationId: string;
  subjectAddress: string;
  locale: "ru" | "en";
  acceptedAt: string;
  batchHash: string;
  selectionManifestSha256: string;
}): CheckRequestRecord {
  return {
    id: input.id,
    requestCorrelationId: input.correlationId,
    subjectAddress: input.subjectAddress,
    chatId: `canary:${input.batchHash}`,
    messageThreadId: input.selectionManifestSha256,
    locale: input.locale,
    runPurpose: "release_canary",
    sideEffectPolicy: "isolated",
    status: "ACCEPTED",
    statusReason: null,
    runId: null,
    readyAt: input.acceptedAt,
    attemptCount: 0,
    acceptedAt: input.acceptedAt
  };
}

export async function prepareUnifiedCanaryBatch(input: {
  readonly selectionManifest: UnifiedCanarySelectionManifestV1;
  readonly snapshotSource: SnapshotSource;
  readonly versions: UnifiedAnalysisVersions;
  readonly rolloutAuthority?: {
    readonly stage: UnifiedRollingRolloutStage;
    readonly boundedUserCheckBasisPoints: number;
    readonly providerCapacityCeiling: number;
    readonly receiptSha256: string | null;
  };
  readonly repository: UnifiedCanaryBatchRepository;
  readonly createId: () => string;
  readonly providerConfiguration: {
    readonly sha256: string;
    readonly artifact: UnifiedCanaryProviderConfigurationV1;
  };
  readonly diagnosticHypothesis?: {
    readonly sha256: string;
    readonly artifact: UnifiedCanaryDiagnosticHypothesisV1;
  } | null;
  readonly now?: () => Date;
}): Promise<{
  readonly selectionManifestSha256: string;
  readonly batchIdentitySha256: string;
  readonly batchIdentity: UnifiedCanaryBatchIdentityV1;
  readonly runs: readonly {
    readonly id: string;
    readonly createdAt: string;
  }[];
  readonly analysisReuse: "forbid";
  readonly sideEffectPolicy: "isolated";
}> {
  const benchmarkSelection =
    input.selectionManifest.source.table === "adaptive_benchmark_cli";
  const expectedRunCount = benchmarkSelection
    ? input.selectionManifest.selected.length
    : CANARY_SIZE;
  if (
    expectedRunCount < 1 ||
    expectedRunCount > 100 ||
    (!benchmarkSelection && expectedRunCount !== CANARY_SIZE)
  ) {
    throw new Error("unified_canary_requires_exactly_eight_wallets");
  }
  if (
    input.versions.runtimeCommit !==
      input.selectionManifest.source.candidateCommit ||
    input.versions.schemaVersion !==
      input.selectionManifest.source.databaseSchemaVersion
  ) {
    throw new Error("unified_canary_batch_provenance_mismatch");
  }
  const now = input.now ?? (() => new Date());
  const acceptedAt = timestamp(
    now().toISOString(),
    "unified_canary_clock_invalid"
  );
  if (input.diagnosticHypothesis) {
    const verified = verifyUnifiedCanaryDiagnosticHypothesis(
      input.diagnosticHypothesis.artifact
    );
    if (verified.sha256 !== input.diagnosticHypothesis.sha256) {
      throw new TypeError("unified_canary_hypothesis_hash_mismatch");
    }
  }
  if (
    fingerprintCanonicalArtifact(input.providerConfiguration.artifact) !==
      input.providerConfiguration.sha256
  ) {
    throw new TypeError(
      "unified_canary_provider_configuration_hash_mismatch"
    );
  }
  const selectionManifestSha256 = fingerprintCanonicalArtifact(
    input.selectionManifest
  );
  const staged: PreparedCanaryRun[] = [];
  let currentRequest: CheckRequestRecord | null = null;
  const store: UnifiedRequestStore = {
    async createOrGetAcceptedRequest(request) {
      currentRequest = request;
      return request;
    },
    async attachedRun() {
      return null;
    },
    async attach(attachment) {
      if (currentRequest === null || currentRequest.id !== attachment.requestId) {
        throw new Error("unified_canary_staging_request_mismatch");
      }
      if (attachment.reuseAllowed) {
        throw new Error("unified_canary_analysis_reuse_forbidden");
      }
      const attached: CheckRequestRecord = {
        ...currentRequest,
        status: "ATTACHED",
        runId: attachment.candidateRun.id
      };
      staged.push({
        request: attached,
        candidateRun: attachment.candidateRun,
        reuseAllowed: false,
        initialTasks: attachment.initialTasks ?? []
      });
      return {
        request: attached,
        run: attachment.candidateRun,
        reused: false
      };
    },
    async providerWait(_requestId, readyAt) {
      if (currentRequest === null) {
        throw new Error("unified_canary_staging_request_missing");
      }
      return { ...currentRequest, readyAt, attemptCount: 1 };
    },
    async fail(_requestId, reason) {
      if (currentRequest === null) {
        throw new Error("unified_canary_staging_request_missing");
      }
      return {
        ...currentRequest,
        status: "FAILED_TECHNICAL",
        statusReason: reason
      };
    }
  };
  for (const selected of input.selectionManifest.selected) {
    const requestId = input.createId();
    const runId = input.createId();
    const request = acceptedRequest({
      id: requestId,
      correlationId:
        `release-canary-staged:${selectionManifestSha256}:` +
        selected.sourceRowId,
      subjectAddress: selected.subjectAddress,
      locale: selected.locale,
      acceptedAt,
      batchHash: selectionManifestSha256,
      selectionManifestSha256
    });
    const initialTasks = TASK_KINDS.map((kind) => ({
      id: input.createId(),
      kind,
      priorityLane: "background" as const,
      logicalKey: "main"
    }));
    const result = await intakeUnifiedCheck({
      store,
      snapshotSource: input.snapshotSource,
      request,
      candidateRunId: runId,
      initialTasks,
      versions: input.versions,
      rolloutAuthority: input.rolloutAuthority,
      now: () => new Date(acceptedAt)
    });
    if (result.kind !== "attached" || result.reused) {
      throw new Error(`unified_canary_prepare_failed:${result.kind}`);
    }
  }
  if (
    staged.length !== expectedRunCount ||
    new Set(staged.map((item) => item.candidateRun.id)).size !==
      expectedRunCount ||
    (
      !benchmarkSelection &&
      new Set(staged.map((item) =>
        item.candidateRun.analysisKeySha256
      )).size !== expectedRunCount
    )
  ) {
    throw new Error("unified_canary_batch_identity_invalid");
  }
  const selectedSourceSetSha256 = fingerprintCanonicalArtifact({
    version: "unified-canary-selected-source-set-v1",
    selected: input.selectionManifest.selected
  });
  const batchIdentity: UnifiedCanaryBatchIdentityV1 = {
    version: "unified-canary-batch-identity-v1",
    schemaVersion: 1,
    selectedSourceSetSha256,
    snapshots: staged.map((item) => ({
      subjectAddress: item.candidateRun.subjectAddress,
      snapshotSha256: item.candidateRun.snapshotHash
    })).sort((left, right) =>
      left.subjectAddress.localeCompare(right.subjectAddress)
    ),
    candidateCommit: input.selectionManifest.source.candidateCommit,
    activeGenerationId:
      input.selectionManifest.source.activeGenerationId,
    labelDatasetSha256: input.versions.labelDatasetSha256,
    scoringPolicyVersion: input.versions.scoringPolicyVersion,
    attributionPolicyVersion: input.versions.attributionPolicyVersion,
    traversalPolicyVersion: "snapshot-closure-v1",
    providerSchemaVersion: "tronscan-transfer-page-v1",
    providerConfiguration: input.providerConfiguration,
    databaseSchemaVersion: input.versions.schemaVersion,
    databaseSchemaChecksumSha256:
      input.selectionManifest.source.databaseSchemaChecksumSha256,
    schema032ChecksumSha256:
      input.selectionManifest.source.schema032ChecksumSha256,
    diagnosticHypothesis: input.diagnosticHypothesis ?? null
  };
  const batchHash = fingerprintCanonicalArtifact(batchIdentity);
  const persistedRuns = staged.map((item, index) => ({
    ...item,
    request: {
      ...item.request,
      requestCorrelationId:
        `release-canary:${batchHash}:` +
        input.selectionManifest.selected[index]!.sourceRowId,
      chatId: `canary:${batchHash}`,
      messageThreadId: selectionManifestSha256
    }
  }));
  const persisted = await input.repository.createBatch({
    selectionManifest: input.selectionManifest,
    batchIdentity,
    runs: persistedRuns
  });
  if (
    persisted.selectionManifestSha256 !== selectionManifestSha256 ||
    persisted.batchIdentitySha256 !== batchHash ||
    persisted.runs.length !== expectedRunCount
  ) {
    throw new Error("unified_canary_batch_persistence_mismatch");
  }
  return {
    ...persisted,
    batchIdentity,
    analysisReuse: "forbid",
    sideEffectPolicy: "isolated"
  };
}

export type UnifiedCanaryExecutionBlockedV1 = {
  readonly version: "canary-execution-blocked-v1";
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly subjectAddress: string;
  readonly deadlineAt: string;
  readonly observedAt: string;
  readonly phase: string;
  readonly heartbeatAt: string | null;
  readonly providerState: "ready" | "waiting" | "unavailable";
  readonly queueAgeMs: number;
  readonly logs: readonly string[];
};

export type UnifiedCanaryIsolationAuditV1 = {
  readonly version: "unified-canary-isolation-audit-v1";
  readonly writerPolicyVersion: "unified-write-policy-v1";
  readonly auditedRunCount: number;
  readonly auditedRequestCount: number;
  readonly policyViolationCount: number;
  readonly authoritativeNamespaceWriteCount: number;
  readonly deliveryIntentWriteCount: number;
  readonly deliveryOwnershipWriteCount: number;
  readonly authoritativePresentationArtifactCount: number;
  readonly namespacedArtifactCount: number;
  readonly authoritativeNamespaces: readonly [
    "unified_check_deliveries",
    "unified_wallet_delivery_ownership",
    "authoritative_presentation_artifacts"
  ];
};

type CompletedPresentation = {
  readonly html: string;
  readonly htmlHash: string;
  readonly evidenceAggregates: readonly unknown[];
  readonly scoreReasons: readonly string[];
};

function blocker(
  run: UnifiedWatchdogRunV1,
  observedAt: string
): UnifiedCanaryExecutionBlockedV1 {
  const statusRank = new Map([
    ["LEASED", 0],
    ["WAITING_RETRY", 1],
    ["BLOCKED_ADMIN", 2],
    ["FAILED_TECHNICAL", 3],
    ["QUEUED", 4],
    ["CANCELLED", 5],
    ["COMPLETED", 6]
  ]);
  const kindRank = new Map(TASK_KINDS.map((kind, index) => [kind, index]));
  const active = run.tasks.filter((task) =>
    task.status !== "COMPLETED" && task.status !== "CANCELLED"
  ).sort((left, right) =>
    (statusRank.get(left.status) ?? 99) -
      (statusRank.get(right.status) ?? 99) ||
    (kindRank.get(left.kind as typeof TASK_KINDS[number]) ?? 99) -
      (kindRank.get(right.kind as typeof TASK_KINDS[number]) ?? 99) ||
    left.id.localeCompare(right.id)
  )[0];
  const observedMs = Date.parse(observedAt);
  return {
    version: "canary-execution-blocked-v1",
    schemaVersion: 1,
    runId: run.id,
    subjectAddress: run.subjectAddress,
    deadlineAt: run.canaryDeadlineAt ??
      new Date(Date.parse(run.createdAt) + DEADLINE_MS).toISOString(),
    observedAt,
    phase: active?.kind ?? "finalization",
    heartbeatAt: active?.heartbeatAt ?? null,
    providerState: active?.providerState ?? "ready",
    queueAgeMs: active?.status === "QUEUED" ||
        (
          active?.status === "WAITING_RETRY" &&
          Date.parse(active.readyAt) <= observedMs
        )
      ? Math.max(0, observedMs - Date.parse(active.readyAt))
      : 0,
    logs: run.tasks.map((task) => [
      task.kind,
      task.status,
      task.providerState,
      task.lastError ?? "no_error"
    ].join(":"))
  };
}

export type UnifiedCanaryBatchReportV1 = {
  readonly version: "unified-canary-batch-report-v1";
  readonly schemaVersion: 1;
  readonly selectionManifestSha256: string;
  readonly batchIdentitySha256: string;
  readonly candidateCommit: string;
  readonly activeGeneration: {
    readonly generationId: string;
    readonly activatedAt: string;
  };
  readonly generatedAt: string;
  readonly deliveryIntentCount: number;
  readonly authoritativeDerivedWriteCount: number;
  readonly isolationReceipt: UnifiedCanaryIsolationAuditV1;
  readonly results: readonly {
    readonly runId: string;
    readonly subjectAddress: string;
    readonly outcome:
      | "COMPLETED"
      | "FAILED_TECHNICAL"
      | "canary_execution_blocked";
    readonly parentDurationMs: number;
    readonly childDurations: readonly {
      readonly taskId: string;
      readonly kind: string;
      readonly status: UnifiedWatchdogRunV1["tasks"][number]["status"];
      readonly queueMs: number;
      readonly providerMs: number;
      readonly computeMs: number;
    }[];
    readonly childAttempts: readonly (
      UnifiedWatchdogRunV1["tasks"][number]["attemptDurations"][number] & {
        readonly taskId: string;
        readonly kind: string;
      }
    )[];
    readonly score: number | null;
    readonly decision: "ACCEPTABLE" | "REVIEW" | "DECLINE" | null;
    readonly html: string | null;
    readonly htmlHash: string | null;
    readonly evidenceAggregates: readonly unknown[];
    readonly scoreReasons: readonly string[];
    readonly invariantViolations: readonly string[];
    readonly blocker: UnifiedCanaryExecutionBlockedV1 | null;
    readonly technicalFailure: {
      readonly reason: string;
      readonly taskDiagnostics: readonly string[];
    } | null;
  }[];
};

export async function runUnifiedCanaryHarness(input: {
  readonly runs: readonly {
    readonly id: string;
    readonly subjectAddress: string;
    readonly locale: "ru" | "en";
  }[];
  readonly selectionManifestSha256: string;
  readonly batchIdentitySha256: string;
  readonly candidateCommit: string;
  readonly activeGeneration: {
    readonly generationId: string;
    readonly activatedAt: string;
  };
  readonly now: () => Date;
  readonly inspect: () => Promise<readonly UnifiedWatchdogRunV1[]>;
  readonly advance: () => Promise<void>;
  readonly persistBlocker: (input: {
    runId: string;
    sha256: string;
    artifact: UnifiedCanaryExecutionBlockedV1;
  }) => Promise<
    | { readonly state: "blocked"; readonly artifact: UnifiedCanaryExecutionBlockedV1 }
    | { readonly state: "completed" }
  >;
  readonly isolationAudit: () => Promise<UnifiedCanaryIsolationAuditV1> |
    UnifiedCanaryIsolationAuditV1;
  readonly loadCompletedPresentation: (input: {
    runId: string;
    locale: "ru" | "en";
  }) => Promise<CompletedPresentation>;
  readonly expectedRunCount?: number;
}): Promise<UnifiedCanaryBatchReportV1> {
  const expectedRunCount = input.expectedRunCount ?? CANARY_SIZE;
  if (
    !Number.isSafeInteger(expectedRunCount) ||
    expectedRunCount < 1 ||
    expectedRunCount > 100 ||
    input.runs.length !== expectedRunCount ||
    new Set(input.runs.map((run) => run.id)).size !== expectedRunCount
  ) {
    throw new Error("unified_canary_harness_requires_eight_fresh_runs");
  }
  const expected = new Map(input.runs.map((run) => [run.id, run]));
  const blocked = new Map<string, UnifiedCanaryExecutionBlockedV1>();
  let finalStates: readonly UnifiedWatchdogRunV1[] = [];
  for (;;) {
    const inspected = await input.inspect();
    finalStates = inspected.filter((run) => expected.has(run.id));
    if (
      finalStates.length !== expectedRunCount ||
      finalStates.some((run) =>
        run.runPurpose !== "release_canary" ||
        run.sideEffectPolicy !== "isolated" ||
        run.subjectAddress !== expected.get(run.id)?.subjectAddress
      )
    ) {
      throw new Error("unified_canary_inspection_binding_invalid");
    }
    const observedAt = timestamp(
      input.now().toISOString(),
      "unified_canary_clock_invalid"
    );
    let blockerStateChanged = false;
    for (const run of finalStates) {
      if (
        run.status === "COMPLETED" ||
        run.status === "FAILED_TECHNICAL" ||
        blocked.has(run.id)
      ) continue;
      const deadlineAt = run.canaryDeadlineAt ??
        new Date(Date.parse(run.createdAt) + DEADLINE_MS).toISOString();
      if (Date.parse(observedAt) < Date.parse(deadlineAt)) continue;
      const artifact = blocker(run, observedAt);
      const persisted = await input.persistBlocker({
        runId: run.id,
        sha256: fingerprintCanonicalArtifact(artifact),
        artifact
      });
      blockerStateChanged = true;
      if (persisted.state === "completed") continue;
      blocked.set(run.id, persisted.artifact);
    }
    if (blockerStateChanged) continue;
    if (finalStates.every((run) =>
      run.status === "COMPLETED" ||
      (
        run.status === "FAILED_TECHNICAL" &&
        run.tasks.every((task) => task.status !== "LEASED")
      ) ||
      (
        blocked.has(run.id) &&
        run.tasks.every((task) => task.status !== "LEASED")
      )
    )) break;
    await input.advance();
  }

  const generatedAt = [...finalStates]
    .map((run) => run.completedAt ?? run.updatedAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]!;
  const deliveryIntentCount = finalStates.reduce(
    (sum, run) => sum + run.deliveries.length,
    0
  );
  const results = [];
  for (const run of finalStates) {
    const expectedRun = expected.get(run.id)!;
    const common = {
      runId: run.id,
      subjectAddress: run.subjectAddress,
      parentDurationMs: Math.max(
        0,
        Date.parse(run.completedAt ?? run.updatedAt) -
          Date.parse(run.createdAt)
      ),
      childDurations: run.tasks.map((task) => ({
        taskId: task.id,
        kind: task.kind,
        status: task.status,
        queueMs: task.durationsMs.queue,
        providerMs: task.durationsMs.provider,
        computeMs: task.durationsMs.compute
      })),
      childAttempts: run.tasks.flatMap((task) =>
        task.attemptDurations.map((attempt) => ({
          taskId: task.id,
          kind: task.kind,
          ...attempt
        }))
      ),
      invariantViolations: [
        ...(run.deliveries.length === 0
          ? []
          : ["canary_delivery_intent_created"]),
        ...(run.sideEffectPolicy === "isolated"
          ? []
          : ["canary_side_effect_policy_not_isolated"])
      ]
    };
    if (run.status === "COMPLETED") {
      if (run.finalScore === null || run.finalDecision === null) {
        throw new Error("unified_canary_completed_score_missing");
      }
      const presentation = await input.loadCompletedPresentation({
        runId: run.id,
        locale: expectedRun.locale
      });
      if (
        fingerprintCanonicalArtifact(presentation.html) !==
          presentation.htmlHash
      ) {
        throw new Error("unified_canary_presentation_hash_mismatch");
      }
      results.push({
        ...common,
        outcome: "COMPLETED" as const,
        score: run.finalScore,
        decision: run.finalDecision,
        html: presentation.html,
        htmlHash: presentation.htmlHash,
        evidenceAggregates: presentation.evidenceAggregates,
        scoreReasons: presentation.scoreReasons,
        blocker: null,
        technicalFailure: null
      });
      continue;
    }
    const blockedArtifact = blocked.get(run.id) ?? null;
    results.push({
      ...common,
      outcome: blockedArtifact === null
        ? "FAILED_TECHNICAL" as const
        : "canary_execution_blocked" as const,
      score: null,
      decision: null,
      html: null,
      htmlHash: null,
      evidenceAggregates: [],
      scoreReasons: [],
      blocker: blockedArtifact,
      technicalFailure: blockedArtifact === null
        ? {
          reason: run.statusReason ??
            run.tasks.find((task) =>
              task.status === "FAILED_TECHNICAL"
            )?.lastError ??
            "unified_canary_technical_failure_unspecified",
          taskDiagnostics: run.tasks.map((task) => [
            task.kind,
            task.status,
            task.lastError ?? "no_error"
          ].join(":"))
        }
        : null
    });
  }
  const isolationAudit = await input.isolationAudit();
  if (
    isolationAudit.policyViolationCount !== 0 ||
    isolationAudit.authoritativeNamespaceWriteCount !== 0 ||
    isolationAudit.deliveryIntentWriteCount !== 0
  ) {
    throw new Error("unified_canary_isolation_violation");
  }
  return {
    version: "unified-canary-batch-report-v1",
    schemaVersion: 1,
    selectionManifestSha256: input.selectionManifestSha256,
    batchIdentitySha256: input.batchIdentitySha256,
    candidateCommit: input.candidateCommit,
    activeGeneration: input.activeGeneration,
    generatedAt,
    deliveryIntentCount,
    authoritativeDerivedWriteCount:
      isolationAudit.authoritativeNamespaceWriteCount,
    isolationReceipt: isolationAudit,
    results
  };
}
