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
import { addressHistoryManifestKey } from "../unifiedCheck/addressHistory";
import type { TraversalStateV1 } from "../unifiedCheck/traversal";

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
  reconstructionEvidenceLimitations: readonly string[];
  mismatches: readonly string[];
};

const SHA256 = /^[0-9a-f]{64}$/u;
const RECONSTRUCTION_CASE_ID = "synthetic-accepted-history-reconstruction-v1";
const SYNTHETIC_RECONSTRUCTION_LIMITATIONS = [
  "synthetic_addresses_not_calibration_or_blind",
  "synthetic_offline_fixture_not_real_db_history"
] as const;

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

function fixtureEvent(value: unknown): IndexedTronUsdtTransfer | null {
  const source = record(value);
  if (!source || typeof source.txHash !== "string" ||
    !Number.isSafeInteger(source.blockNumber) || !Number.isSafeInteger(source.eventIndex) ||
    typeof source.blockTimestamp !== "string" ||
    new Date(source.blockTimestamp).toISOString() !== source.blockTimestamp ||
    typeof source.fromAddress !== "string" || typeof source.toAddress !== "string" ||
    typeof source.amountRaw !== "string" || !/^(0|[1-9][0-9]*)$/u.test(source.amountRaw) ||
    (source.method !== "transfer" && source.method !== "transferFrom") ||
    !(source.callerAddress === null || typeof source.callerAddress === "string") ||
    !(source.contractRet === null || typeof source.contractRet === "string") ||
    typeof source.confirmed !== "boolean") return null;
  return {
    txHash: source.txHash,
    blockNumber: source.blockNumber as number,
    blockTimestamp: new Date(source.blockTimestamp),
    eventIndex: source.eventIndex as number,
    fromAddress: source.fromAddress,
    toAddress: source.toAddress,
    amountRaw: source.amountRaw,
    method: source.method,
    callerAddress: source.callerAddress,
    contractRet: source.contractRet,
    confirmed: source.confirmed
  };
}

function reconstruct(fixture: unknown): { matched: boolean; mismatch: string | null } {
  try {
    const source = record(fixture);
    const stateSource = source && record(source.state);
    const accepted = source && record(source.acceptedHistory);
    const manifestRef = accepted && record(accepted.manifest);
    const manifest = manifestRef && record(manifestRef.artifact);
    const roleRef = source && record(source.eventRoleMap);
    const roleArtifact = roleRef && record(roleRef.artifact);
    if (!source || !stateSource || !accepted || !manifestRef || !manifest || !roleRef || !roleArtifact ||
      source.schemaVersion !== "service-role-shadow-reconstruction-v1" ||
      source.caseId !== RECONSTRUCTION_CASE_ID || source.expectedStatus !== "high_inferred_service" ||
      source.fixtureIdentity !== "synthetic-offline-accepted-history-control-v1" ||
      source.evidenceClass !== "synthetic_edge_case" ||
      !Array.isArray(source.evidenceLimitations) ||
      fingerprintCanonicalArtifact(source.evidenceLimitations) !==
        fingerprintCanonicalArtifact(SYNTHETIC_RECONSTRUCTION_LIMITATIONS) ||
      typeof source.runId !== "string" || typeof source.snapshotHash !== "string" ||
      !SHA256.test(source.snapshotHash) || typeof source.subjectAddress !== "string" ||
      typeof manifestRef.sha256 !== "string" || !SHA256.test(manifestRef.sha256) ||
      fingerprintCanonicalArtifact(manifest) !== manifestRef.sha256 ||
      typeof roleRef.sha256 !== "string" || !SHA256.test(roleRef.sha256) ||
      fingerprintCanonicalArtifact(roleArtifact) !== roleRef.sha256 || !Array.isArray(accepted.pages)) {
      return { matched: false, mismatch: "reconstruction_fixture_invalid" };
    }
    const state: TraversalStateV1 = {
      address: String(stateSource.address),
      direction: stateSource.direction as TraversalStateV1["direction"],
      anchorTimestamp: String(stateSource.anchorTimestamp),
      fundingEpisodeId: String(stateSource.fundingEpisodeId),
      allocatedAmountRaw: String(stateSource.allocatedAmountRaw),
      sourceEventIds: Array.isArray(stateSource.sourceEventIds) &&
        stateSource.sourceEventIds.every((id) => typeof id === "string")
        ? stateSource.sourceEventIds : []
    };
    if ((state.direction !== "backward" && state.direction !== "forward") ||
      new Date(state.anchorTimestamp).toISOString() !== state.anchorTimestamp ||
      state.sourceEventIds.length === 0) {
      return { matched: false, mismatch: "reconstruction_anchor_invalid" };
    }
    const pageHashes: string[] = [];
    const events: IndexedTronUsdtTransfer[] = [];
    for (const item of accepted.pages) {
      const pageRef = record(item);
      const page = pageRef && record(pageRef.artifact);
      if (!pageRef || !page || typeof pageRef.sha256 !== "string" ||
        !SHA256.test(pageRef.sha256) || fingerprintCanonicalArtifact(page) !== pageRef.sha256 ||
        page.version !== "unified-address-history-page-v1" || page.schemaVersion !== 1 ||
        page.runId !== source.runId || page.manifestKey !== manifest.key ||
        typeof page.providerPageHash !== "string" || !SHA256.test(page.providerPageHash) ||
        !Array.isArray(page.events) || page.rawRowCount !== page.events.length) {
        return { matched: false, mismatch: "reconstruction_page_binding_invalid" };
      }
      const parsed = page.events.map(fixtureEvent);
      if (parsed.some((event) => event === null)) {
        return { matched: false, mismatch: "reconstruction_page_event_invalid" };
      }
      pageHashes.push(pageRef.sha256);
      events.push(...parsed as IndexedTronUsdtTransfer[]);
    }
    const canonical = new Map<string, string>();
    for (const event of events) {
      const id = canonicalTronUsdtEventKey(event);
      const bytes = fingerprintCanonicalArtifact({
        ...event,
        blockTimestamp: event.blockTimestamp.toISOString()
      });
      if (canonical.has(id) && canonical.get(id) !== bytes) {
        return { matched: false, mismatch: "reconstruction_event_conflict" };
      }
      canonical.set(id, bytes);
    }
    const canonicalIds = [...canonical.keys()].sort();
    const expectedManifestKey = addressHistoryManifestKey({
      chain: "tron",
      snapshotHash: source.snapshotHash,
      tokenContract: String(manifest.tokenContract),
      address: state.address,
      providerRequestVersion: String(manifest.providerRequestVersion)
    });
    if (manifest.version !== "unified-address-history-manifest-v1" || manifest.schemaVersion !== 1 ||
      manifest.key !== expectedManifestKey || manifest.snapshotHash !== source.snapshotHash ||
      manifest.address !== state.address || manifest.rawRowCount !== events.length ||
      manifest.canonicalEventCount !== canonicalIds.length || manifest.duplicateCount !== events.length - canonicalIds.length ||
      !Array.isArray(manifest.pageArtifactHashes) ||
      fingerprintCanonicalArtifact(manifest.pageArtifactHashes) !== fingerprintCanonicalArtifact(pageHashes) ||
      manifest.eventInventorySha256 !== fingerprintCanonicalArtifact(canonicalIds)) {
      return { matched: false, mismatch: "reconstruction_manifest_binding_invalid" };
    }
    const map = roleArtifact as ServiceRoleShadowEventRoleMapV1;
    const result = maybeBuildServiceRoleShadowArtifactV1({
      mode: "service-role-shadow-100-plus-100-v1",
      runId: source.runId,
      snapshotHash: source.snapshotHash,
      subjectAddress: source.subjectAddress,
      state,
      acceptedHistory: {
        manifestKey: expectedManifestKey,
        manifestSha256: manifestRef.sha256,
        pageArtifactHashes: pageHashes,
        events
      },
      eventRoleMap: { sha256: roleRef.sha256, artifact: map }
    });
    return result?.artifact.result.status === source.expectedStatus
      ? { matched: true, mismatch: null }
      : { matched: false, mismatch: "reconstructed_history_not_matched" };
  } catch {
    return { matched: false, mismatch: "reconstruction_fixture_invalid" };
  }
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
    reconstructionEvidenceLimitations: SYNTHETIC_RECONSTRUCTION_LIMITATIONS,
    mismatches
  };
}
