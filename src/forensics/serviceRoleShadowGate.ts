import { fingerprintCanonicalArtifact } from "./canonicalJson";
import {
  replayOfflineForensicModelCorpusV1,
  type OfflineCorpusV1
} from "./offlineForensicModelReplay";
import {
  maybeBuildServiceRoleShadowArtifactV1,
  type ServiceRoleShadowEventRoleMapV1
} from "../unifiedCheck/serviceRoleShadow";
import { canonicalTronUsdtEventKey } from "./tronAddressAllTimeIndex";
import type { IndexedTronUsdtTransfer } from "../types";

export type StageCCaseEvaluationV1 =
  | "reconstructed_history_replay"
  | "recorded_vector_replay"
  | "partial_observation_replay"
  | "sparse_guard_replay"
  | "expectation_integrity_only"
  | "exact_assertion_replay"
  | "adverse_composition_replay";

export type StageCCaseResultV1 = {
  id: string;
  suite: "service" | "adverse";
  evaluation: StageCCaseEvaluationV1;
  expected: string;
  observed: string;
  matched: boolean;
  sourceSha256: string | null;
  evidenceLimitations: readonly string[];
};

export type ServiceRoleShadowGateReceiptV1 = {
  schemaVersion: "service-role-shadow-gate-v1";
  service: { numerator: number; denominator: 24 };
  adverse: { numerator: number; denominator: 6 };
  cases: readonly StageCCaseResultV1[];
  reconstructedAcceptedHistories: number;
  mismatches: readonly string[];
};

const HASH = "a".repeat(64);
const RECONSTRUCTION_CASE_ID = "reconstructed-accepted-history-v1";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function limitation(evaluation: StageCCaseEvaluationV1, id: string): readonly string[] {
  if (evaluation === "recorded_vector_replay") {
    return ["recorded_calibration_vector_not_raw_pages"];
  }
  if (evaluation === "sparse_guard_replay") return ["checked_subject_guard_only"];
  if (evaluation === "partial_observation_replay") {
    return [id === "txc-vusxvhd-recorded-control"
      ? "partial_73_rows_not_two_windows"
      : "partial_8_rows_not_two_windows"];
  }
  if (evaluation === "expectation_integrity_only") {
    return ["whole_export_not_real_100_plus_100_windows"];
  }
  if (evaluation === "exact_assertion_replay") {
    return ["offline_only_no_runtime_eligibility", id === "exact-htx-label"
      ? "exact_htx_assertion_offline_only"
      : "exact_binance_assertion_offline_only"];
  }
  return ["offline_adverse_composition_only"];
}

function serviceEvaluation(id: string): StageCCaseEvaluationV1 {
  if (id === "w8srl-two-window-calibration") return "recorded_vector_replay";
  if (id === "tqr-d7nzp-recorded-control") return "sparse_guard_replay";
  if (id === "csv-SqPaM9") return "partial_observation_replay";
  if (id === "txc-vusxvhd-recorded-control") return "partial_observation_replay";
  return "expectation_integrity_only";
}

function reconstruct(fixture: unknown): { matched: boolean; mismatch: string | null } {
  const source = record(fixture);
  const spec = source && record(source.eventSpec);
  if (!source || !spec || source.schemaVersion !== "service-role-shadow-reconstruction-v1" ||
    source.caseId !== RECONSTRUCTION_CASE_ID || source.expectedStatus !== "high_inferred_service" ||
    typeof source.sourceSha256 !== "string") return { matched: false, mismatch: "reconstruction_fixture_invalid" };
  const expectedSource = fingerprintCanonicalArtifact({
    schemaVersion: source.schemaVersion,
    caseId: source.caseId,
    expectedStatus: source.expectedStatus,
    eventSpec: spec
  });
  if (source.sourceSha256 !== expectedSource || spec.anchorSeconds === undefined ||
    spec.recentRows !== 100 || spec.historicalRows !== 100 || spec.role !== "ordinary" ||
    spec.authority !== "existing_hash_bound_economic_role_v1") {
    return { matched: false, mismatch: "reconstruction_source_binding_invalid" };
  }
  const anchorSeconds = spec.anchorSeconds;
  if (typeof anchorSeconds !== "number" || !Number.isSafeInteger(anchorSeconds)) {
    return { matched: false, mismatch: "reconstruction_anchor_invalid" };
  }
  const profiledAddress = "TStageCProfile";
  const events: IndexedTronUsdtTransfer[] = [
    ...Array.from({ length: 100 }, (_, index) => indexedEvent(index, anchorSeconds - index, profiledAddress)),
    ...Array.from({ length: 100 }, (_, index) => indexedEvent(index + 100, anchorSeconds - 8 * 86_400 - index, profiledAddress))
  ];
  const map: ServiceRoleShadowEventRoleMapV1 = {
    schemaVersion: "service-role-shadow-event-role-map-v1",
    runId: "stage-c-fixture-run",
    snapshotHash: HASH,
    addressHistoryManifestSha256: "b".repeat(64),
    entries: events.map((event) => ({
      canonicalEventId: canonicalTronUsdtEventKey(event),
      role: "ordinary",
      authority: "existing_hash_bound_economic_role_v1",
      evidenceSha256: "c".repeat(64)
    }))
  };
  const result = maybeBuildServiceRoleShadowArtifactV1({
    mode: "service-role-shadow-100-plus-100-v1",
    runId: map.runId,
    snapshotHash: HASH,
    subjectAddress: "TStageCSubject",
    state: {
      address: profiledAddress,
      direction: "backward",
      anchorTimestamp: events[0]!.blockTimestamp.toISOString(),
      fundingEpisodeId: "stage-c-fixture-episode",
      allocatedAmountRaw: "1",
      sourceEventIds: [canonicalTronUsdtEventKey(events[0]!)]
    },
    acceptedHistory: {
      manifestKey: "stage-c-fixture-manifest",
      manifestSha256: map.addressHistoryManifestSha256,
      pageArtifactHashes: ["d".repeat(64)],
      events
    },
    eventRoleMap: { sha256: fingerprintCanonicalArtifact(map), artifact: map }
  });
  return result?.artifact.result.status === source.expectedStatus
    ? { matched: true, mismatch: null }
    : { matched: false, mismatch: "reconstructed_history_not_matched" };
}

function indexedEvent(index: number, timestamp: number, address: string): IndexedTronUsdtTransfer {
  return {
    txHash: `stage-c-tx-${index}`,
    blockNumber: 10_000 - index,
    blockTimestamp: new Date(timestamp * 1_000),
    eventIndex: 0,
    fromAddress: `TSender-${index}`,
    toAddress: address,
    amountRaw: "1000000",
    method: "transfer",
    eventType: "Transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    finalResult: "SUCCESS",
    confirmed: true
  };
}

export function replayServiceRoleShadowGateV1(input: {
  corpus: unknown;
  reconstructedFixture: unknown;
}): ServiceRoleShadowGateReceiptV1 {
  const corpus = input.corpus as OfflineCorpusV1;
  const replay = replayOfflineForensicModelCorpusV1(corpus);
  const sources = record(input.corpus);
  const serviceSources = Array.isArray(sources?.serviceCases) ? sources.serviceCases : [];
  const adverseSources = Array.isArray(sources?.adverseCases) ? sources.adverseCases : [];
  const cases: StageCCaseResultV1[] = [];
  for (const result of replay.serviceCases) {
    const source = serviceSources.find((item) => record(item)?.id === result.id);
    const evaluation = serviceEvaluation(result.id);
    const observed = String(result.state ?? "missing");
    const expected = evaluation === "expectation_integrity_only"
      ? fingerprintCanonicalArtifact(source)
      : evaluation === "recorded_vector_replay" ? "high_inferred_service"
        : evaluation === "sparse_guard_replay" || result.id === "csv-SqPaM9"
          ? "expectation_level"
          : "insufficient_data";
    const matched = evaluation === "expectation_integrity_only"
      ? source !== undefined && fingerprintCanonicalArtifact(source) === expected
      : observed === expected;
    cases.push({
      id: result.id, suite: "service", evaluation, expected, observed,
      matched, sourceSha256: source === undefined ? null : fingerprintCanonicalArtifact(source),
      evidenceLimitations: limitation(evaluation, result.id)
    });
  }
  for (const result of replay.adverseCases) {
    const source = adverseSources.find((item) => record(item)?.id === result.id);
    const exact = result.id === "exact-binance-label" || result.id === "exact-htx-label";
    const evaluation: StageCCaseEvaluationV1 = exact ? "exact_assertion_replay" : "adverse_composition_replay";
    const expected = exact ? "service_label" : String(result.kind ?? "missing");
    const observed = String(result.kind ?? "missing");
    cases.push({
      id: result.id, suite: "adverse", evaluation, expected, observed,
      matched: source !== undefined && observed === expected,
      sourceSha256: source === undefined ? null : fingerprintCanonicalArtifact(source),
      evidenceLimitations: limitation(evaluation, result.id)
    });
  }
  const reconstruction = reconstruct(input.reconstructedFixture);
  const unique = new Set(cases.map(({ id }) => id)).size === cases.length;
  const serviceCases = cases.filter(({ suite }) => suite === "service");
  const adverseCases = cases.filter(({ suite }) => suite === "adverse");
  const mismatches = [
    ...cases.filter(({ matched }) => !matched).map(({ id }) => `case_mismatch:${id}`),
    ...(serviceCases.length === 24 ? [] : ["service_case_count_invalid"]),
    ...(adverseCases.length === 6 ? [] : ["adverse_case_count_invalid"]),
    ...(unique ? [] : ["case_ids_not_unique"]),
    ...(reconstruction.matched ? [] : [reconstruction.mismatch!])
  ].sort();
  return {
    schemaVersion: "service-role-shadow-gate-v1",
    service: { numerator: serviceCases.filter(({ matched }) => matched).length, denominator: 24 },
    adverse: { numerator: adverseCases.filter(({ matched }) => matched).length, denominator: 6 },
    cases: [...cases].sort((left, right) => left.id.localeCompare(right.id)),
    reconstructedAcceptedHistories: reconstruction.matched ? 1 : 0,
    mismatches
  };
}
