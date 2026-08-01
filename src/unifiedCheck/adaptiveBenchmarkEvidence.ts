import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
import {
  createUnifiedDecisionReason,
  type UnifiedDecisionReason
} from "./adaptiveObservability";
import type {
  UnifiedPerformanceBenchmarkManifestV1
} from "./performanceMetrics";

const HASH = /^[0-9a-f]{64}$/u;
const GROUP_STATES = new Set(["healthy", "cooldown", "circuit_open"]);

export type UnifiedProviderGroupAuditEntryV1 = {
  readonly opaqueGroupId: string;
  readonly state: "healthy" | "cooldown" | "circuit_open";
  readonly concurrencyLimit: number;
  readonly independenceEvidenceSha256: string;
};

export type UnifiedProviderGroupAuditV1 = {
  readonly version: "unified-provider-group-audit-v1";
  readonly auditedAt: string;
  readonly groups: readonly UnifiedProviderGroupAuditEntryV1[];
  readonly auditSha256: string;
};

export type UnifiedAdaptiveBenchmarkEvidenceV1 = {
  readonly version: "unified-adaptive-benchmark-evidence-v1";
  readonly scenarioId: string;
  readonly scenarioKind: string;
  readonly completedAt: string;
  readonly mode: "replay" | "live";
  readonly admissionPolicy: "barrier" | "rolling";
  readonly sideEffectPolicy: "authoritative" | "isolated";
  readonly requestedCapacity: number;
  readonly actualAuditedIndependentGroupCapacity: number;
  readonly independentGroupAudit: UnifiedProviderGroupAuditV1 | null;
  readonly performanceManifest: UnifiedPerformanceBenchmarkManifestV1;
  readonly timing: {
    readonly wallTimeMs: number;
    readonly aggregateThroughputPerSecond: number;
  };
  readonly capacity: {
    readonly eligibleDemand: number;
    readonly targetSlots: number;
    readonly actualSlots: number;
    readonly utilization: number;
  };
  readonly provider: {
    readonly rollingRps: number;
    readonly requests: number;
    readonly errors: number;
    readonly rateLimited429: number;
  };
  readonly limiting: {
    readonly reason: UnifiedDecisionReason | null;
    readonly canonicalHeadAgeMs: number | null;
  };
  readonly buffer: {
    readonly readyBytes: number;
    readonly reservedBytes: number;
  };
  readonly database: {
    readonly latencyMs: number | null;
    readonly checkpointLatencyMs: number | null;
    readonly poolWaitMs: number | null;
  };
  readonly memory: {
    readonly rssBytes: number;
    readonly heapUsedBytes: number;
    readonly availableContainerBytes: number;
    readonly availableHostBytes: number;
  };
  readonly repair: {
    readonly maxWaitMs: number;
    readonly maxWaitChunks: number;
  };
  readonly reuse: {
    readonly providerCacheHits: number;
    readonly networkFetches: number;
    readonly addressManifestReuses: number;
    readonly addressHistoryReplaysAvoided: number;
  };
  readonly restartRecovery: {
    readonly restartCount: number;
    readonly recoveryMs: number;
    readonly reconciliationRecoveries: number;
    readonly duplicateCommits: number;
    readonly duplicateSequences: number;
  };
  readonly oracle: {
    readonly replaySha256: string;
    readonly oracleSha256: string;
    readonly receiptSha256: string;
    readonly exactEquivalent: true;
  } | null;
  readonly runtimeObservationArtifactSha256s: readonly string[];
  readonly scenarioSymptomArtifactSha256s: readonly string[];
  readonly liveOutcomes: readonly {
    readonly runId: string;
    readonly subjectAddress: string;
    readonly score: number;
    readonly decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
    readonly evidenceBundleSha256: string;
    readonly traversalClosureSha256: string;
    readonly scoringBundleSha256: string;
    readonly reportSha256: string;
    readonly benchmarkControlSha256: string;
    readonly auditedGroupIds: readonly string[];
    readonly dispatchedGroupIds: readonly string[];
  }[];
  readonly measurement: {
    readonly timing: "observed" | "simulated";
    readonly provider: "observed" | "simulated";
    readonly database: "observed" | "simulated" | "not_applicable";
    readonly memory: "observed";
    readonly lifecycle: "observed" | "simulated";
    readonly delivery: "observed" | "simulated";
  };
  readonly delivery: {
    readonly eligibleRequests: number;
    readonly deliveryIntents: number;
    readonly externalTelegramSends: number;
  };
  readonly evidenceSha256: string;
};

export type UnifiedAdaptiveBenchmarkEvidenceInputV1 = Omit<
  UnifiedAdaptiveBenchmarkEvidenceV1,
  "version" | "evidenceSha256"
>;

function record(
  value: unknown,
  code: string
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(code);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  code: string
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(code);
  }
}

function text(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 512
  ) {
    throw new TypeError(code);
  }
  return value;
}

function iso(value: unknown, code: string): string {
  if (typeof value !== "string") throw new TypeError(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(code);
  }
  return value;
}

function sha(value: unknown, code: string): string {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new TypeError(code);
  }
  return value;
}

function number(value: unknown, integer = false): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new TypeError("unified_benchmark_number_invalid");
  }
  return value;
}

function numberFields<T extends Readonly<Record<string, unknown>>>(
  value: unknown,
  keys: readonly (keyof T & string)[],
  integer: boolean
): T {
  const parsed = record(value, "unified_benchmark_metrics_invalid");
  exactKeys(parsed, keys, "unified_benchmark_metrics_invalid");
  for (const key of keys) number(parsed[key], integer);
  return parsed as T;
}

function nullableNumberFields<T extends Readonly<Record<string, unknown>>>(
  value: unknown,
  keys: readonly (keyof T & string)[]
): T {
  const parsed = record(value, "unified_benchmark_metrics_invalid");
  exactKeys(parsed, keys, "unified_benchmark_metrics_invalid");
  for (const key of keys) {
    if (parsed[key] !== null) number(parsed[key]);
  }
  return parsed as T;
}

function validatePerformanceManifest(
  value: unknown
): UnifiedPerformanceBenchmarkManifestV1 {
  const manifest = record(
    value,
    "unified_benchmark_performance_manifest_invalid"
  );
  exactKeys(manifest, [
    "version",
    "caseId",
    "runId",
    "frozenClockIso",
    "semanticIdentitySha256",
    "executionIdentitySha256"
  ], "unified_benchmark_performance_manifest_invalid");
  if (manifest.version !== "unified-performance-benchmark-manifest-v1") {
    throw new TypeError("unified_benchmark_performance_manifest_invalid");
  }
  return {
    version: "unified-performance-benchmark-manifest-v1",
    caseId: text(
      manifest.caseId,
      "unified_benchmark_performance_manifest_invalid"
    ),
    runId: text(
      manifest.runId,
      "unified_benchmark_performance_manifest_invalid"
    ),
    frozenClockIso: iso(
      manifest.frozenClockIso,
      "unified_benchmark_performance_manifest_invalid"
    ),
    semanticIdentitySha256: sha(
      manifest.semanticIdentitySha256,
      "unified_benchmark_performance_manifest_invalid"
    ),
    executionIdentitySha256: sha(
      manifest.executionIdentitySha256,
      "unified_benchmark_performance_manifest_invalid"
    )
  };
}

function validateGroupAudit(value: unknown): UnifiedProviderGroupAuditV1 {
  const audit = record(value, "unified_benchmark_group_audit_invalid");
  exactKeys(audit, [
    "version",
    "auditedAt",
    "groups",
    "auditSha256"
  ], "unified_benchmark_group_audit_invalid");
  if (
    audit.version !== "unified-provider-group-audit-v1" ||
    !Array.isArray(audit.groups) ||
    audit.groups.length < 1 ||
    audit.groups.length > 100
  ) {
    throw new TypeError("unified_benchmark_group_audit_invalid");
  }
  const ids = new Set<string>();
  const groups = audit.groups.map((value): UnifiedProviderGroupAuditEntryV1 => {
    const group = record(value, "unified_benchmark_group_audit_invalid");
    exactKeys(group, [
      "opaqueGroupId",
      "state",
      "concurrencyLimit",
      "independenceEvidenceSha256"
    ], "unified_benchmark_group_audit_invalid");
    const opaqueGroupId = text(
      group.opaqueGroupId,
      "unified_benchmark_group_audit_invalid"
    );
    if (ids.has(opaqueGroupId)) {
      throw new TypeError("unified_benchmark_group_audit_invalid");
    }
    ids.add(opaqueGroupId);
    if (
      typeof group.state !== "string" ||
      !GROUP_STATES.has(group.state)
    ) {
      throw new TypeError("unified_benchmark_group_audit_invalid");
    }
    return {
      opaqueGroupId,
      state: group.state as UnifiedProviderGroupAuditEntryV1["state"],
      concurrencyLimit: number(group.concurrencyLimit, true),
      independenceEvidenceSha256: sha(
        group.independenceEvidenceSha256,
        "unified_benchmark_group_audit_invalid"
      )
    };
  });
  if (groups.some((group, index) =>
    index > 0 &&
    groups[index - 1]!.opaqueGroupId.localeCompare(group.opaqueGroupId) > 0
  )) {
    throw new TypeError("unified_benchmark_group_audit_invalid");
  }
  const validated = {
    version: "unified-provider-group-audit-v1" as const,
    auditedAt: iso(
      audit.auditedAt,
      "unified_benchmark_group_audit_invalid"
    ),
    groups
  };
  const auditSha256 = sha(
    audit.auditSha256,
    "unified_benchmark_group_audit_invalid"
  );
  if (fingerprintCanonicalArtifact(validated) !== auditSha256) {
    throw new Error("unified_benchmark_group_audit_hash_mismatch");
  }
  return { ...validated, auditSha256 };
}

export function sealUnifiedProviderGroupAuditV1(input: {
  readonly auditedAt: string;
  readonly groups: readonly UnifiedProviderGroupAuditEntryV1[];
}): {
  readonly envelope: UnifiedProviderGroupAuditV1;
  readonly canonicalJson: string;
} {
  const withoutHash = {
    version: "unified-provider-group-audit-v1" as const,
    auditedAt: input.auditedAt,
    groups: [...input.groups].sort((left, right) =>
      left.opaqueGroupId.localeCompare(right.opaqueGroupId)
    )
  };
  const envelope = validateGroupAudit({
    ...withoutHash,
    auditSha256: fingerprintCanonicalArtifact(withoutHash)
  });
  return {
    envelope,
    canonicalJson: canonicalizeArtifactJson(envelope)
  };
}

export function parseUnifiedProviderGroupAuditV1(
  rawCanonicalJson: string
): UnifiedProviderGroupAuditV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCanonicalJson);
  } catch {
    throw new TypeError("unified_benchmark_group_audit_json_invalid");
  }
  if (canonicalizeArtifactJson(parsed) !== rawCanonicalJson) {
    throw new Error("unified_benchmark_group_audit_noncanonical");
  }
  return validateGroupAudit(parsed);
}

function validateReason(value: unknown): UnifiedDecisionReason | null {
  if (value === null) return null;
  const reason = record(value, "unified_benchmark_reason_invalid");
  exactKeys(
    reason,
    ["scope", "code"],
    "unified_benchmark_reason_invalid"
  );
  try {
    return createUnifiedDecisionReason(
      reason.scope as never,
      reason.code as never
    );
  } catch {
    throw new TypeError("unified_benchmark_reason_invalid");
  }
}

function validateEvidence(value: unknown): UnifiedAdaptiveBenchmarkEvidenceV1 {
  const evidence = record(value, "unified_benchmark_evidence_invalid");
  exactKeys(evidence, [
    "version",
    "scenarioId",
    "scenarioKind",
    "completedAt",
    "mode",
    "admissionPolicy",
    "sideEffectPolicy",
    "requestedCapacity",
    "actualAuditedIndependentGroupCapacity",
    "independentGroupAudit",
    "performanceManifest",
    "timing",
    "capacity",
    "provider",
    "limiting",
    "buffer",
    "database",
    "memory",
    "repair",
    "reuse",
    "restartRecovery",
    "oracle",
    "runtimeObservationArtifactSha256s",
    "scenarioSymptomArtifactSha256s",
    "liveOutcomes",
    "measurement",
    "delivery",
    "evidenceSha256"
  ], "unified_benchmark_evidence_invalid");
  if (evidence.version !== "unified-adaptive-benchmark-evidence-v1") {
    throw new TypeError("unified_benchmark_evidence_version_invalid");
  }
  if (evidence.mode !== "replay" && evidence.mode !== "live") {
    throw new TypeError("unified_benchmark_mode_invalid");
  }
  if (
    evidence.admissionPolicy !== "barrier" &&
    evidence.admissionPolicy !== "rolling"
  ) {
    throw new TypeError("unified_benchmark_admission_policy_invalid");
  }
  if (
    evidence.sideEffectPolicy !== "authoritative" &&
    evidence.sideEffectPolicy !== "isolated"
  ) {
    throw new TypeError("unified_benchmark_side_effect_policy_invalid");
  }
  const timing = numberFields<UnifiedAdaptiveBenchmarkEvidenceV1["timing"]>(
    evidence.timing,
    ["wallTimeMs", "aggregateThroughputPerSecond"],
    false
  );
  const capacity =
    numberFields<UnifiedAdaptiveBenchmarkEvidenceV1["capacity"]>(
      evidence.capacity,
      ["eligibleDemand", "targetSlots", "actualSlots", "utilization"],
      false
    );
  if (
    !Number.isSafeInteger(capacity.eligibleDemand) ||
    !Number.isSafeInteger(capacity.targetSlots) ||
    !Number.isSafeInteger(capacity.actualSlots) ||
    capacity.utilization > 1 ||
    capacity.actualSlots > capacity.targetSlots
  ) {
    throw new TypeError("unified_benchmark_number_invalid");
  }
  const expectedUtilization = capacity.targetSlots === 0
    ? 0
    : capacity.actualSlots / capacity.targetSlots;
  if (Math.abs(capacity.utilization - expectedUtilization) > Number.EPSILON) {
    throw new TypeError("unified_benchmark_utilization_invalid");
  }
  const provider =
    numberFields<UnifiedAdaptiveBenchmarkEvidenceV1["provider"]>(
      evidence.provider,
      ["rollingRps", "requests", "errors", "rateLimited429"],
      false
    );
  if (
    !Number.isSafeInteger(provider.requests) ||
    !Number.isSafeInteger(provider.errors) ||
    !Number.isSafeInteger(provider.rateLimited429) ||
    provider.errors > provider.requests ||
    provider.rateLimited429 > provider.errors
  ) {
    throw new TypeError("unified_benchmark_number_invalid");
  }
  const limitingRaw = record(
    evidence.limiting,
    "unified_benchmark_limiting_invalid"
  );
  exactKeys(
    limitingRaw,
    ["reason", "canonicalHeadAgeMs"],
    "unified_benchmark_limiting_invalid"
  );
  const limiting = {
    reason: validateReason(limitingRaw.reason),
    canonicalHeadAgeMs: limitingRaw.canonicalHeadAgeMs === null
      ? null
      : number(limitingRaw.canonicalHeadAgeMs)
  };
  const buffer = numberFields<UnifiedAdaptiveBenchmarkEvidenceV1["buffer"]>(
    evidence.buffer,
    ["readyBytes", "reservedBytes"],
    true
  );
  const database =
    nullableNumberFields<UnifiedAdaptiveBenchmarkEvidenceV1["database"]>(
      evidence.database,
      ["latencyMs", "checkpointLatencyMs", "poolWaitMs"]
    );
  const memory = numberFields<UnifiedAdaptiveBenchmarkEvidenceV1["memory"]>(
    evidence.memory,
    [
      "rssBytes",
      "heapUsedBytes",
      "availableContainerBytes",
      "availableHostBytes"
    ],
    true
  );
  const repair = numberFields<UnifiedAdaptiveBenchmarkEvidenceV1["repair"]>(
    evidence.repair,
    ["maxWaitMs", "maxWaitChunks"],
    false
  );
  if (!Number.isSafeInteger(repair.maxWaitChunks)) {
    throw new TypeError("unified_benchmark_number_invalid");
  }
  const reuse = numberFields<UnifiedAdaptiveBenchmarkEvidenceV1["reuse"]>(
    evidence.reuse,
    [
      "providerCacheHits",
      "networkFetches",
      "addressManifestReuses",
      "addressHistoryReplaysAvoided"
    ],
    true
  );
  const restartRecovery =
    numberFields<UnifiedAdaptiveBenchmarkEvidenceV1["restartRecovery"]>(
      evidence.restartRecovery,
      [
        "restartCount",
        "recoveryMs",
        "reconciliationRecoveries",
        "duplicateCommits",
        "duplicateSequences"
      ],
      false
    );
  for (const key of [
    "restartCount",
    "reconciliationRecoveries",
    "duplicateCommits",
    "duplicateSequences"
  ] as const) {
    if (!Number.isSafeInteger(restartRecovery[key])) {
      throw new TypeError("unified_benchmark_number_invalid");
    }
  }
  const delivery =
    numberFields<UnifiedAdaptiveBenchmarkEvidenceV1["delivery"]>(
      evidence.delivery,
      ["eligibleRequests", "deliveryIntents", "externalTelegramSends"],
      true
    );
  if (delivery.externalTelegramSends !== 0) {
    throw new Error("unified_benchmark_external_telegram_forbidden");
  }
  if (
    (
      evidence.sideEffectPolicy === "isolated" &&
      delivery.deliveryIntents !== 0
    ) ||
    (
      evidence.sideEffectPolicy === "authoritative" &&
      delivery.deliveryIntents !== delivery.eligibleRequests
    )
  ) {
    throw new Error("unified_benchmark_delivery_inconsistent");
  }

  const requestedCapacity = number(evidence.requestedCapacity, true);
  const actualAuditedIndependentGroupCapacity = number(
    evidence.actualAuditedIndependentGroupCapacity,
    true
  );
  if (requestedCapacity < 1 || actualAuditedIndependentGroupCapacity < 1) {
    throw new TypeError("unified_benchmark_number_invalid");
  }
  if (
    capacity.actualSlots > capacity.targetSlots ||
    capacity.targetSlots > requestedCapacity ||
    capacity.targetSlots > actualAuditedIndependentGroupCapacity ||
    capacity.targetSlots > capacity.eligibleDemand
  ) {
    throw new Error("unified_benchmark_capacity_inconsistent");
  }
  const independentGroupAudit = evidence.independentGroupAudit === null
    ? null
    : validateGroupAudit(evidence.independentGroupAudit);
  let oracle: UnifiedAdaptiveBenchmarkEvidenceV1["oracle"] = null;
  if (evidence.oracle !== null) {
    const rawOracle = record(
      evidence.oracle,
      "unified_benchmark_oracle_invalid"
    );
    exactKeys(rawOracle, [
      "replaySha256",
      "oracleSha256",
      "receiptSha256",
      "exactEquivalent"
    ], "unified_benchmark_oracle_invalid");
    if (rawOracle.exactEquivalent !== true) {
      throw new TypeError("unified_benchmark_oracle_invalid");
    }
    oracle = {
      replaySha256: sha(
        rawOracle.replaySha256,
        "unified_benchmark_oracle_invalid"
      ),
      oracleSha256: sha(
        rawOracle.oracleSha256,
        "unified_benchmark_oracle_invalid"
      ),
      receiptSha256: sha(
        rawOracle.receiptSha256,
        "unified_benchmark_oracle_invalid"
      ),
      exactEquivalent: true
    };
  }
  if (
    !Array.isArray(evidence.runtimeObservationArtifactSha256s) ||
    evidence.runtimeObservationArtifactSha256s.some((value) =>
      typeof value !== "string" || !HASH.test(value)
    ) ||
    new Set(evidence.runtimeObservationArtifactSha256s).size !==
      evidence.runtimeObservationArtifactSha256s.length ||
    evidence.runtimeObservationArtifactSha256s.some((value, index, values) =>
      index > 0 && String(values[index - 1]).localeCompare(String(value)) > 0
    )
  ) {
    throw new TypeError(
      "unified_benchmark_runtime_observation_provenance_invalid"
    );
  }
  const runtimeObservationArtifactSha256s =
    evidence.runtimeObservationArtifactSha256s as string[];
  const rawScenarioSymptoms = evidence.scenarioSymptomArtifactSha256s;
  if (
    !Array.isArray(rawScenarioSymptoms) ||
    rawScenarioSymptoms.some((value) =>
      typeof value !== "string" || !HASH.test(value)
    ) ||
    new Set(rawScenarioSymptoms).size !== rawScenarioSymptoms.length
  ) {
    throw new TypeError("unified_benchmark_scenario_symptom_invalid");
  }
  const scenarioSymptomArtifactSha256s =
    [...rawScenarioSymptoms as string[]].sort();
  if (
    scenarioSymptomArtifactSha256s.some((value, index) =>
      value !== rawScenarioSymptoms[index]
    )
  ) {
    throw new TypeError("unified_benchmark_scenario_symptom_invalid");
  }
  if (!Array.isArray(evidence.liveOutcomes)) {
    throw new TypeError("unified_benchmark_live_outcome_invalid");
  }
  const liveOutcomes: UnifiedAdaptiveBenchmarkEvidenceV1["liveOutcomes"] =
    evidence.liveOutcomes.map((value) => {
    const rawOutcome = record(
      value,
      "unified_benchmark_live_outcome_invalid"
    );
    exactKeys(rawOutcome, [
      "runId",
      "subjectAddress",
      "score",
      "decision",
      "evidenceBundleSha256",
      "traversalClosureSha256",
      "scoringBundleSha256",
      "reportSha256",
      "benchmarkControlSha256",
      "auditedGroupIds",
      "dispatchedGroupIds"
    ], "unified_benchmark_live_outcome_invalid");
    const score = number(rawOutcome.score, true);
    if (
      score > 100 ||
      !["ACCEPTABLE", "REVIEW", "DECLINE"].includes(
        String(rawOutcome.decision)
      )
    ) {
      throw new TypeError("unified_benchmark_live_outcome_invalid");
    }
    if (
      !Array.isArray(rawOutcome.auditedGroupIds) ||
      rawOutcome.auditedGroupIds.length < 1 ||
      rawOutcome.auditedGroupIds.some((id) =>
        typeof id !== "string" || id.trim().length === 0
      ) ||
      new Set(rawOutcome.auditedGroupIds).size !==
        rawOutcome.auditedGroupIds.length
    ) {
      throw new TypeError("unified_benchmark_live_outcome_invalid");
    }
    if (
      !Array.isArray(rawOutcome.dispatchedGroupIds) ||
      rawOutcome.dispatchedGroupIds.length < 1 ||
      rawOutcome.dispatchedGroupIds.some((id) =>
        typeof id !== "string" || id.trim().length === 0
      ) ||
      new Set(rawOutcome.dispatchedGroupIds).size !==
        rawOutcome.dispatchedGroupIds.length
    ) {
      throw new TypeError("unified_benchmark_live_outcome_invalid");
    }
    return {
      runId: text(
        rawOutcome.runId,
        "unified_benchmark_live_outcome_invalid"
      ),
      subjectAddress: text(
        rawOutcome.subjectAddress,
        "unified_benchmark_live_outcome_invalid"
      ),
      score,
      decision: rawOutcome.decision as
        "ACCEPTABLE" | "REVIEW" | "DECLINE",
      evidenceBundleSha256: sha(
        rawOutcome.evidenceBundleSha256,
        "unified_benchmark_live_outcome_invalid"
      ),
      traversalClosureSha256: sha(
        rawOutcome.traversalClosureSha256,
        "unified_benchmark_live_outcome_invalid"
      ),
      scoringBundleSha256: sha(
        rawOutcome.scoringBundleSha256,
        "unified_benchmark_live_outcome_invalid"
      ),
      reportSha256: sha(
        rawOutcome.reportSha256,
        "unified_benchmark_live_outcome_invalid"
      ),
      benchmarkControlSha256: sha(
        rawOutcome.benchmarkControlSha256,
        "unified_benchmark_live_outcome_invalid"
      ),
      auditedGroupIds: rawOutcome.auditedGroupIds as string[],
      dispatchedGroupIds: rawOutcome.dispatchedGroupIds as string[]
    };
  });
  const rawMeasurement = record(
    evidence.measurement,
    "unified_benchmark_measurement_invalid"
  );
  exactKeys(rawMeasurement, [
    "timing",
    "provider",
    "database",
    "memory",
    "lifecycle",
    "delivery"
  ], "unified_benchmark_measurement_invalid");
  if (
    !["observed", "simulated"].includes(String(rawMeasurement.timing)) ||
    !["observed", "simulated"].includes(String(rawMeasurement.provider)) ||
    !["observed", "simulated", "not_applicable"].includes(
      String(rawMeasurement.database)
    ) ||
    rawMeasurement.memory !== "observed" ||
    !["observed", "simulated"].includes(
      String(rawMeasurement.lifecycle)
    ) ||
    !["observed", "simulated"].includes(String(rawMeasurement.delivery))
  ) {
    throw new TypeError("unified_benchmark_measurement_invalid");
  }
  const measurement =
    rawMeasurement as UnifiedAdaptiveBenchmarkEvidenceV1["measurement"];
  const databaseValues = Object.values(database);
  if (
    (
      measurement.database === "not_applicable" &&
      databaseValues.some((value) => value !== null)
    ) ||
    (
      measurement.database !== "not_applicable" &&
      databaseValues.some((value) => value === null)
    )
  ) {
    throw new Error("unified_benchmark_measurement_inconsistent");
  }
  if (evidence.mode === "live") {
    if (oracle !== null) {
      throw new Error("unified_benchmark_live_oracle_forbidden");
    }
    if (independentGroupAudit === null) {
      throw new Error("unified_benchmark_live_capacity_unaudited");
    }
    if (liveOutcomes.length === 0) {
      throw new Error("unified_benchmark_live_outcome_missing");
    }
    if (runtimeObservationArtifactSha256s.length === 0) {
      throw new Error(
        "unified_benchmark_runtime_observation_provenance_invalid"
      );
    }
    if (
      evidence.admissionPolicy !== "rolling" ||
      evidence.sideEffectPolicy !== "isolated" ||
      scenarioSymptomArtifactSha256s.length === 0 ||
      Object.values(measurement).some((value) => value !== "observed")
    ) {
      throw new Error("unified_benchmark_live_observation_required");
    }
    const auditedHealthyGroups = independentGroupAudit.groups.filter(
      (group) => group.state === "healthy" && group.concurrencyLimit > 0
    );
    const auditedHealthyGroupIds = new Set(auditedHealthyGroups.map(
      (group) => group.opaqueGroupId
    ));
    const benchmarkControlSha256 = liveOutcomes[0]!
      .benchmarkControlSha256;
    const dispatchedGroupIds = new Set(liveOutcomes.flatMap(
      (outcome) => outcome.dispatchedGroupIds
    ));
    if (
      actualAuditedIndependentGroupCapacity !==
        auditedHealthyGroups.length ||
      requestedCapacity > auditedHealthyGroups.length ||
      dispatchedGroupIds.size < requestedCapacity ||
      new Set(liveOutcomes.map((outcome) => outcome.runId)).size !==
        liveOutcomes.length ||
      liveOutcomes.some((outcome) =>
        outcome.benchmarkControlSha256 !== benchmarkControlSha256 ||
        outcome.auditedGroupIds.length < requestedCapacity ||
        new Set(outcome.auditedGroupIds).size !==
          outcome.auditedGroupIds.length ||
        outcome.auditedGroupIds.some((groupId) =>
          !auditedHealthyGroupIds.has(groupId)
        ) ||
        outcome.dispatchedGroupIds.some((groupId) =>
          !auditedHealthyGroupIds.has(groupId) ||
          !outcome.auditedGroupIds.includes(groupId)
        )
      )
    ) {
      throw new Error("unified_benchmark_live_capacity_unaudited");
    }
  } else {
    if (oracle === null) {
      throw new Error("unified_benchmark_replay_oracle_missing");
    }
    if (liveOutcomes.length !== 0) {
      throw new Error("unified_benchmark_replay_live_outcome_forbidden");
    }
    if (runtimeObservationArtifactSha256s.length !== 0) {
      throw new Error(
        "unified_benchmark_runtime_observation_provenance_invalid"
      );
    }
    if (scenarioSymptomArtifactSha256s.length !== 0) {
      throw new Error("unified_benchmark_scenario_symptom_invalid");
    }
  }

  const validatedWithoutHash: Omit<
    UnifiedAdaptiveBenchmarkEvidenceV1,
    "evidenceSha256"
  > = {
    version: "unified-adaptive-benchmark-evidence-v1",
    scenarioId: text(
      evidence.scenarioId,
      "unified_benchmark_scenario_id_invalid"
    ),
    scenarioKind: text(
      evidence.scenarioKind,
      "unified_benchmark_scenario_kind_invalid"
    ),
    completedAt: iso(
      evidence.completedAt,
      "unified_benchmark_completed_at_invalid"
    ),
    mode: evidence.mode,
    admissionPolicy: evidence.admissionPolicy,
    sideEffectPolicy: evidence.sideEffectPolicy,
    requestedCapacity,
    actualAuditedIndependentGroupCapacity,
    independentGroupAudit,
    performanceManifest: validatePerformanceManifest(
      evidence.performanceManifest
    ),
    timing,
    capacity,
    provider,
    limiting,
    buffer,
    database,
    memory,
    repair,
    reuse,
    restartRecovery,
    oracle,
    runtimeObservationArtifactSha256s,
    scenarioSymptomArtifactSha256s,
    liveOutcomes,
    measurement,
    delivery
  };
  const evidenceSha256 = sha(
    evidence.evidenceSha256,
    "unified_benchmark_evidence_hash_invalid"
  );
  if (
    fingerprintCanonicalArtifact(validatedWithoutHash) !== evidenceSha256
  ) {
    throw new Error("unified_benchmark_evidence_hash_mismatch");
  }
  return { ...validatedWithoutHash, evidenceSha256 };
}

export function sealUnifiedAdaptiveBenchmarkEvidenceV1(
  input: UnifiedAdaptiveBenchmarkEvidenceInputV1
): {
  readonly envelope: UnifiedAdaptiveBenchmarkEvidenceV1;
  readonly canonicalJson: string;
} {
  const withoutHash = {
    version: "unified-adaptive-benchmark-evidence-v1" as const,
    ...input
  };
  const envelope = validateEvidence({
    ...withoutHash,
    evidenceSha256: fingerprintCanonicalArtifact(withoutHash)
  });
  return {
    envelope,
    canonicalJson: canonicalizeArtifactJson(envelope)
  };
}

export function parseUnifiedAdaptiveBenchmarkEvidenceV1(
  rawCanonicalJson: string
): UnifiedAdaptiveBenchmarkEvidenceV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCanonicalJson);
  } catch {
    throw new TypeError("unified_benchmark_evidence_json_invalid");
  }
  if (canonicalizeArtifactJson(parsed) !== rawCanonicalJson) {
    throw new Error("unified_benchmark_evidence_noncanonical");
  }
  return validateEvidence(parsed);
}

export type UnifiedMemorySampleV1 = {
  readonly version: "unified-memory-sample-v1";
  readonly phase: "before" | "during" | "after";
  readonly runId: string;
  readonly scenarioId: string;
  readonly capturedAt: string;
  readonly nodePid: number;
  readonly localWslDiagnostic: {
    readonly status: "captured" | "skipped";
    readonly vmmemWslWorkingSetBytes: number | null;
    readonly linuxMemAvailableBytes: number | null;
    readonly linuxSwapTotalBytes: number | null;
    readonly linuxSwapFreeBytes: number | null;
  };
  readonly runtime: {
    readonly rssBytes: number;
    readonly heapUsedBytes: number;
  };
};

export type UnifiedMemoryGateEvidenceV1 = {
  readonly version: "unified-memory-gate-evidence-v1";
  readonly scope:
    | "local_wsl_diagnostic"
    | "target_linux_cgroup_gate";
  readonly gateStatus: "passed" | "failed" | "skipped";
  readonly runId: string;
  readonly scenarioId: string;
  readonly completedAt: string;
  readonly samples: readonly UnifiedMemorySampleV1[];
  readonly database: {
    readonly latencyMs: number | null;
    readonly checkpointLatencyMs: number | null;
  };
  readonly availableMemorySource: "cgroup" | "host" | null;
  readonly availableMemoryBytes: number | null;
  readonly targetAttestation: {
    readonly platform: "linux";
    readonly measurement: "observed";
    readonly processPid: number;
    readonly processStartTimeTicks: string;
    readonly executableSha256: string;
    readonly memorySourcePath: string;
    readonly memorySourceArtifactSha256: string;
  } | null;
  readonly evidenceSha256: string;
};

export type UnifiedMemoryGateEvidenceInputV1 = Omit<
  UnifiedMemoryGateEvidenceV1,
  "version" | "gateStatus" | "evidenceSha256"
>;

function optionalSafeBytes(value: unknown, code: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(code);
  }
  return Number(value);
}

function parseLastInteger(
  value: unknown,
  code: string
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new TypeError(code);
  const matches = value.match(/\d+/gu);
  if (!matches || matches.length === 0) return null;
  const parsed = Number(matches.at(-1));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(code);
  }
  return parsed;
}

function parseMeminfoBytes(
  raw: unknown,
  field: string
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    throw new TypeError("unified_memory_meminfo_invalid");
  }
  const match = new RegExp(
    `^${field}:\\s+(\\d+)\\s+kB\\s*$`,
    "imu"
  ).exec(raw);
  if (!match) return null;
  const kibibytes = Number(match[1]);
  const bytes = kibibytes * 1024;
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new TypeError("unified_memory_meminfo_invalid");
  }
  return bytes;
}

function validateUnifiedMemorySample(
  value: unknown
): UnifiedMemorySampleV1 {
  const input = record(value, "unified_memory_sample_invalid");
  exactKeys(input, [
    "capturedAt",
    "localWslDiagnostic",
    "nodePid",
    "phase",
    "runId",
    "runtime",
    "scenarioId",
    "version"
  ], "unified_memory_sample_invalid");
  if (
    input.version !== "unified-memory-sample-v1" ||
    !["before", "during", "after"].includes(String(input.phase)) ||
    !Number.isSafeInteger(input.nodePid) ||
    Number(input.nodePid) < 1
  ) {
    throw new TypeError("unified_memory_sample_invalid");
  }
  const local = record(
    input.localWslDiagnostic,
    "unified_memory_wsl_diagnostic_invalid"
  );
  exactKeys(local, [
    "linuxMemAvailableBytes",
    "linuxSwapFreeBytes",
    "linuxSwapTotalBytes",
    "status",
    "vmmemWslWorkingSetBytes"
  ], "unified_memory_wsl_diagnostic_invalid");
  const validatedLocal = {
    status: local.status as "captured" | "skipped",
    vmmemWslWorkingSetBytes: optionalSafeBytes(
      local.vmmemWslWorkingSetBytes,
      "unified_memory_wsl_diagnostic_invalid"
    ),
    linuxMemAvailableBytes: optionalSafeBytes(
      local.linuxMemAvailableBytes,
      "unified_memory_wsl_diagnostic_invalid"
    ),
    linuxSwapTotalBytes: optionalSafeBytes(
      local.linuxSwapTotalBytes,
      "unified_memory_wsl_diagnostic_invalid"
    ),
    linuxSwapFreeBytes: optionalSafeBytes(
      local.linuxSwapFreeBytes,
      "unified_memory_wsl_diagnostic_invalid"
    )
  };
  const hasCompleteLocal = Object.entries(validatedLocal)
    .filter(([key]) => key !== "status")
    .every(([_key, item]) => item !== null);
  if (
    !["captured", "skipped"].includes(String(local.status)) ||
    (local.status === "captured") !== hasCompleteLocal ||
    (
      validatedLocal.linuxSwapFreeBytes !== null &&
      validatedLocal.linuxSwapTotalBytes !== null &&
      validatedLocal.linuxSwapFreeBytes >
        validatedLocal.linuxSwapTotalBytes
    )
  ) {
    throw new TypeError("unified_memory_wsl_diagnostic_invalid");
  }
  const runtime = record(
    input.runtime,
    "unified_memory_runtime_invalid"
  );
  exactKeys(
    runtime,
    ["heapUsedBytes", "rssBytes"],
    "unified_memory_runtime_invalid"
  );
  const rssBytes = optionalSafeBytes(
    runtime.rssBytes,
    "unified_memory_runtime_invalid"
  );
  const heapUsedBytes = optionalSafeBytes(
    runtime.heapUsedBytes,
    "unified_memory_runtime_invalid"
  );
  if (
    rssBytes === null ||
    heapUsedBytes === null ||
    rssBytes < 1 ||
    heapUsedBytes < 1 ||
    heapUsedBytes > rssBytes
  ) {
    throw new TypeError("unified_memory_runtime_invalid");
  }
  return {
    version: "unified-memory-sample-v1",
    phase: input.phase as UnifiedMemorySampleV1["phase"],
    runId: text(input.runId, "unified_memory_run_id_invalid"),
    scenarioId: text(
      input.scenarioId,
      "unified_memory_scenario_id_invalid"
    ),
    capturedAt: iso(
      input.capturedAt,
      "unified_memory_captured_at_invalid"
    ),
    nodePid: Number(input.nodePid),
    localWslDiagnostic: validatedLocal,
    runtime: { rssBytes, heapUsedBytes }
  };
}

export function parseUnifiedWslMemorySampleV1(input: {
  readonly phase: "before" | "during" | "after";
  readonly runId: string;
  readonly scenarioId: string;
  readonly capturedAt: string;
  readonly nodePid: number;
  readonly vmmemWslOutput: string | null;
  readonly linuxMeminfo: string | null;
  readonly runtimeSnapshot: {
    readonly rssBytes: number;
    readonly heapUsedBytes: number;
  };
}): UnifiedMemorySampleV1 {
  const vmmemWslWorkingSetBytes = parseLastInteger(
    input.vmmemWslOutput,
    "unified_memory_vmmem_output_invalid"
  );
  const linuxMemAvailableBytes = parseMeminfoBytes(
    input.linuxMeminfo,
    "MemAvailable"
  );
  const linuxSwapTotalBytes = parseMeminfoBytes(
    input.linuxMeminfo,
    "SwapTotal"
  );
  const linuxSwapFreeBytes = parseMeminfoBytes(
    input.linuxMeminfo,
    "SwapFree"
  );
  const captured = [
    vmmemWslWorkingSetBytes,
    linuxMemAvailableBytes,
    linuxSwapTotalBytes,
    linuxSwapFreeBytes
  ].every((value) => value !== null);
  return validateUnifiedMemorySample({
    version: "unified-memory-sample-v1",
    phase: input.phase,
    runId: input.runId,
    scenarioId: input.scenarioId,
    capturedAt: input.capturedAt,
    nodePid: input.nodePid,
    localWslDiagnostic: {
      status: captured ? "captured" : "skipped",
      vmmemWslWorkingSetBytes: captured
        ? vmmemWslWorkingSetBytes
        : null,
      linuxMemAvailableBytes: captured
        ? linuxMemAvailableBytes
        : null,
      linuxSwapTotalBytes: captured
        ? linuxSwapTotalBytes
        : null,
      linuxSwapFreeBytes: captured
        ? linuxSwapFreeBytes
        : null
    },
    runtime: input.runtimeSnapshot
  });
}

function validateUnifiedMemoryGateEvidence(
  value: unknown
): UnifiedMemoryGateEvidenceV1 {
  const input = record(value, "unified_memory_gate_evidence_invalid");
  exactKeys(input, [
    "availableMemoryBytes",
    "availableMemorySource",
    "completedAt",
    "database",
    "evidenceSha256",
    "gateStatus",
    "runId",
    "samples",
    "scenarioId",
    "scope",
    "targetAttestation",
    "version"
  ], "unified_memory_gate_evidence_invalid");
  if (
    input.version !== "unified-memory-gate-evidence-v1" ||
    ![
      "local_wsl_diagnostic",
      "target_linux_cgroup_gate"
    ].includes(String(input.scope))
  ) {
    throw new TypeError("unified_memory_gate_evidence_invalid");
  }
  if (!Array.isArray(input.samples) || input.samples.length === 0) {
    throw new TypeError("unified_memory_samples_invalid");
  }
  const samples = input.samples.map(validateUnifiedMemorySample);
  const runId = text(input.runId, "unified_memory_run_id_invalid");
  const scenarioId = text(
    input.scenarioId,
    "unified_memory_scenario_id_invalid"
  );
  if (samples.some((sample) =>
    sample.runId !== runId || sample.scenarioId !== scenarioId
  )) {
    throw new Error("unified_memory_sample_identity_mismatch");
  }
  const database = record(
    input.database,
    "unified_memory_database_invalid"
  );
  exactKeys(database, [
    "checkpointLatencyMs",
    "latencyMs"
  ], "unified_memory_database_invalid");
  const validatedDatabase = {
    latencyMs: optionalSafeBytes(
      database.latencyMs,
      "unified_memory_database_invalid"
    ),
    checkpointLatencyMs: optionalSafeBytes(
      database.checkpointLatencyMs,
      "unified_memory_database_invalid"
    )
  };
  const availableMemoryBytes = optionalSafeBytes(
    input.availableMemoryBytes,
    "unified_memory_available_invalid"
  );
  const scope = input.scope as UnifiedMemoryGateEvidenceV1["scope"];
  const localCaptured = samples.some((sample) =>
    sample.localWslDiagnostic.status === "captured"
  );
  let gateStatus: UnifiedMemoryGateEvidenceV1["gateStatus"];
  if (scope === "local_wsl_diagnostic") {
    if (
      input.availableMemorySource !== null ||
      availableMemoryBytes !== null ||
      input.targetAttestation !== null ||
      validatedDatabase.latencyMs !== null ||
      validatedDatabase.checkpointLatencyMs !== null
    ) {
      throw new Error("unified_memory_local_scope_invalid");
    }
    gateStatus = localCaptured ? "passed" : "skipped";
  } else {
    const phases = new Set(samples.map((sample) => sample.phase));
    const targetAttestation = record(
      input.targetAttestation,
      "unified_memory_target_attestation_invalid"
    );
    exactKeys(targetAttestation, [
      "executableSha256",
      "measurement",
      "memorySourceArtifactSha256",
      "memorySourcePath",
      "platform",
      "processPid",
      "processStartTimeTicks"
    ], "unified_memory_target_attestation_invalid");
    const before = samples.find((sample) => sample.phase === "before");
    const after = samples.find((sample) => sample.phase === "after");
    const processPid = Number(targetAttestation.processPid);
    const memorySourcePath = String(targetAttestation.memorySourcePath);
    if (
      phases.size !== 3 ||
      !["before", "during", "after"].every((phase) =>
        phases.has(phase as UnifiedMemorySampleV1["phase"])
      ) ||
      !["cgroup", "host"].includes(String(input.availableMemorySource)) ||
      availableMemoryBytes === null ||
      availableMemoryBytes < 1 ||
      validatedDatabase.latencyMs === null ||
      validatedDatabase.checkpointLatencyMs === null ||
      targetAttestation.platform !== "linux" ||
      targetAttestation.measurement !== "observed" ||
      !Number.isSafeInteger(processPid) ||
      processPid < 1 ||
      samples.some((sample) => sample.nodePid !== processPid) ||
      typeof targetAttestation.processStartTimeTicks !== "string" ||
      !/^[1-9][0-9]*$/u.test(targetAttestation.processStartTimeTicks) ||
      !HASH.test(String(targetAttestation.executableSha256)) ||
      !HASH.test(String(targetAttestation.memorySourceArtifactSha256)) ||
      (
        input.availableMemorySource === "cgroup" &&
        !memorySourcePath.startsWith("/sys/fs/cgroup/")
      ) ||
      (
        input.availableMemorySource === "host" &&
        memorySourcePath !== "/proc/meminfo"
      ) ||
      before === undefined ||
      after === undefined ||
      after.runtime.rssBytes >
        before.runtime.rssBytes + 67_108_864
    ) {
      throw new Error("unified_memory_target_gate_failed");
    }
    gateStatus = "passed";
  }
  if (input.gateStatus !== gateStatus) {
    throw new Error("unified_memory_gate_status_invalid");
  }
  const withoutHash = {
    version: "unified-memory-gate-evidence-v1" as const,
    scope,
    gateStatus,
    runId,
    scenarioId,
    completedAt: iso(
      input.completedAt,
      "unified_memory_completed_at_invalid"
    ),
    samples,
    database: validatedDatabase,
    availableMemorySource: input.availableMemorySource as
      UnifiedMemoryGateEvidenceV1["availableMemorySource"],
    availableMemoryBytes,
    targetAttestation: input.targetAttestation as
      UnifiedMemoryGateEvidenceV1["targetAttestation"]
  };
  const evidenceSha256 = sha(
    input.evidenceSha256,
    "unified_memory_evidence_sha_invalid"
  );
  if (
    fingerprintCanonicalArtifact(withoutHash) !== evidenceSha256
  ) {
    throw new Error("unified_memory_evidence_hash_mismatch");
  }
  return { ...withoutHash, evidenceSha256 };
}

export function sealUnifiedMemoryGateEvidenceV1(
  input: UnifiedMemoryGateEvidenceInputV1 | UnifiedMemoryGateEvidenceV1
): {
  readonly envelope: UnifiedMemoryGateEvidenceV1;
  readonly canonicalJson: string;
} {
  const scope = input.scope;
  const localCaptured = input.samples.some((sample) =>
    sample.localWslDiagnostic.status === "captured"
  );
  const gateStatus = scope === "target_linux_cgroup_gate"
    ? "passed"
    : localCaptured
      ? "passed"
      : "skipped";
  const withoutHash = {
    version: "unified-memory-gate-evidence-v1" as const,
    scope,
    gateStatus,
    runId: input.runId,
    scenarioId: input.scenarioId,
    completedAt: input.completedAt,
    samples: input.samples,
    database: input.database,
    availableMemorySource: input.availableMemorySource,
    availableMemoryBytes: input.availableMemoryBytes,
    targetAttestation: input.targetAttestation
  };
  const envelope = validateUnifiedMemoryGateEvidence({
    ...withoutHash,
    evidenceSha256: fingerprintCanonicalArtifact(withoutHash)
  });
  return {
    envelope,
    canonicalJson: canonicalizeArtifactJson(envelope)
  };
}

export function parseUnifiedMemoryGateEvidenceV1(
  rawCanonicalJson: string
): UnifiedMemoryGateEvidenceV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCanonicalJson);
  } catch {
    throw new TypeError("unified_memory_evidence_json_invalid");
  }
  if (canonicalizeArtifactJson(parsed) !== rawCanonicalJson) {
    throw new Error("unified_memory_evidence_noncanonical");
  }
  return validateUnifiedMemoryGateEvidence(parsed);
}

export function satisfiesUnifiedProductionMemoryGate(
  evidence: UnifiedMemoryGateEvidenceV1
): boolean {
  return evidence.scope === "target_linux_cgroup_gate" &&
    evidence.gateStatus === "passed" &&
    evidence.targetAttestation?.platform === "linux" &&
    evidence.targetAttestation.measurement === "observed" &&
    evidence.availableMemoryBytes !== null &&
    evidence.availableMemoryBytes > 0 &&
    evidence.database.latencyMs !== null &&
    evidence.database.checkpointLatencyMs !== null;
}

export type UnifiedAdaptiveLifecycleGateEvidenceV1 = {
  readonly version: "unified-adaptive-lifecycle-gate-evidence-v1";
  readonly kind: "restart_recovery" | "barrier_fallback";
  readonly candidateCommit: string;
  readonly executionIdentitySha256: string;
  readonly observedAt: string;
  readonly transitions: readonly string[];
  readonly duplicateCommits: number;
  readonly duplicateDeliveryIntents: number;
  readonly maximumObservedChunkMs: number;
  readonly evidenceSha256: string;
};

const LIFECYCLE_TRANSITIONS = {
  restart_recovery: [
    "acceptance_committed",
    "process_restarted",
    "reconciliation_resumed",
    "ordered_commit_completed"
  ],
  barrier_fallback: [
    "rolling_admission_closed",
    "unleased_tail_de_admitted",
    "leased_chunk_checkpointed",
    "barrier_admission_resumed"
  ]
} as const;

function validateUnifiedAdaptiveLifecycleGateEvidenceV1(
  value: unknown
): UnifiedAdaptiveLifecycleGateEvidenceV1 {
  const input = record(
    value,
    "unified_adaptive_lifecycle_evidence_invalid"
  );
  exactKeys(input, [
    "candidateCommit",
    "duplicateCommits",
    "duplicateDeliveryIntents",
    "evidenceSha256",
    "executionIdentitySha256",
    "kind",
    "maximumObservedChunkMs",
    "observedAt",
    "transitions",
    "version"
  ], "unified_adaptive_lifecycle_evidence_invalid");
  if (
    input.version !==
      "unified-adaptive-lifecycle-gate-evidence-v1" ||
    !["restart_recovery", "barrier_fallback"].includes(
      String(input.kind)
    ) ||
    typeof input.candidateCommit !== "string" ||
    !/^[0-9a-f]{40}$/u.test(input.candidateCommit) ||
    input.duplicateCommits !== 0 ||
    input.duplicateDeliveryIntents !== 0 ||
    !Number.isSafeInteger(input.maximumObservedChunkMs) ||
    Number(input.maximumObservedChunkMs) < 1 ||
    Number(input.maximumObservedChunkMs) > 60_000
  ) {
    throw new TypeError(
      "unified_adaptive_lifecycle_evidence_invalid"
    );
  }
  const kind = input.kind as
    UnifiedAdaptiveLifecycleGateEvidenceV1["kind"];
  const expectedTransitions = LIFECYCLE_TRANSITIONS[kind];
  if (
    !Array.isArray(input.transitions) ||
    input.transitions.length !== expectedTransitions.length ||
    input.transitions.some((transition, index) =>
      transition !== expectedTransitions[index]
    )
  ) {
    throw new Error(
      "unified_adaptive_lifecycle_transition_invalid"
    );
  }
  const withoutHash = {
    version:
      "unified-adaptive-lifecycle-gate-evidence-v1" as const,
    kind,
    candidateCommit: input.candidateCommit,
    executionIdentitySha256: sha(
      input.executionIdentitySha256,
      "unified_adaptive_lifecycle_evidence_invalid"
    ),
    observedAt: iso(
      input.observedAt,
      "unified_adaptive_lifecycle_evidence_invalid"
    ),
    transitions: [...expectedTransitions],
    duplicateCommits: 0,
    duplicateDeliveryIntents: 0,
    maximumObservedChunkMs: Number(input.maximumObservedChunkMs)
  };
  const evidenceSha256 = sha(
    input.evidenceSha256,
    "unified_adaptive_lifecycle_evidence_invalid"
  );
  if (
    fingerprintCanonicalArtifact(withoutHash) !== evidenceSha256
  ) {
    throw new Error(
      "unified_adaptive_lifecycle_evidence_hash_mismatch"
    );
  }
  return { ...withoutHash, evidenceSha256 };
}

export function sealUnifiedAdaptiveLifecycleGateEvidenceV1(
  input: Omit<
    UnifiedAdaptiveLifecycleGateEvidenceV1,
    "version" | "evidenceSha256" | "transitions"
  >
): {
  readonly envelope: UnifiedAdaptiveLifecycleGateEvidenceV1;
  readonly canonicalJson: string;
} {
  const withoutHash = {
    version:
      "unified-adaptive-lifecycle-gate-evidence-v1" as const,
    ...input,
    transitions: [...LIFECYCLE_TRANSITIONS[input.kind]]
  };
  const envelope =
    validateUnifiedAdaptiveLifecycleGateEvidenceV1({
      ...withoutHash,
      evidenceSha256: fingerprintCanonicalArtifact(withoutHash)
    });
  return {
    envelope,
    canonicalJson: canonicalizeArtifactJson(envelope)
  };
}

export function parseUnifiedAdaptiveLifecycleGateEvidenceV1(
  rawCanonicalJson: string
): UnifiedAdaptiveLifecycleGateEvidenceV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCanonicalJson);
  } catch {
    throw new TypeError(
      "unified_adaptive_lifecycle_evidence_json_invalid"
    );
  }
  if (canonicalizeArtifactJson(parsed) !== rawCanonicalJson) {
    throw new Error(
      "unified_adaptive_lifecycle_evidence_noncanonical"
    );
  }
  return validateUnifiedAdaptiveLifecycleGateEvidenceV1(parsed);
}
