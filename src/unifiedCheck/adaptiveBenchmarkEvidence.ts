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
    if (
      actualAuditedIndependentGroupCapacity !==
        auditedHealthyGroups.length ||
      requestedCapacity > auditedHealthyGroups.length ||
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
          !auditedHealthyGroupIds.has(groupId)
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
