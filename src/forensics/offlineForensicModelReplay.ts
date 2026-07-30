import {
  runChronologicalProportionalLedgerV1,
  selectLedgerProvenanceV1,
  type LedgerEventV1,
  type LedgerInputV1,
  type LedgerQueryV1,
  type SnapshotBalanceWitnessV1
} from "./chronologicalProportionalLedger";
import {
  classifyServiceBehavior100Plus100V2,
  evaluateServiceWindowPredicateV2,
  type CompleteServiceWindowVectorV2,
  type ServiceWindowVectorV2
} from "./serviceBehaviorResearch";
import { fingerprintCanonicalArtifact } from "./canonicalJson";
import {
  groupDirectPrincipalCounterparties,
  partitionPrincipalTransfersByBlacklistTimeline
} from "./directHardEvidence";
import {
  extractGasFreeSettlement,
  isGasFreeServiceFeeEdge
} from "./gasFreeSettlement";
import { detectVerify20Fingerprint } from "./verify20Fingerprint";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import {
  buildFrozenLabelRecord,
  resolveFrozenLabelAtEventV1,
  type FrozenLabelRecordV1
} from "../unifiedCheck/labelCatalog";
import { matchTronScanCexTagV1 } from "../unifiedCheck/providerServiceBindings";
import type { ForensicRouteEdge, UsdtBlacklistTimelineEvent } from "../types";

export type OfflineEvidenceClassV1 =
  | "exact_frozen_rows"
  | "recorded_calibration_vector"
  | "synthetic_edge_case";

export type OfflineCaseV1 = {
  readonly id: string;
  readonly evidenceClass: OfflineEvidenceClassV1;
  readonly [key: string]: unknown;
};

export type BroadScopeCaseV1 = {
  readonly id: string;
  readonly evidenceClass: OfflineEvidenceClassV1;
  readonly subjectAddress: string;
  readonly directEdges: readonly {
    readonly id: string;
    readonly txHash: string;
    readonly direction: "inbound" | "outbound";
    readonly counterpartyAddress: string;
    readonly amountRaw: string;
    readonly occurredAt: string;
  }[];
  readonly secondHopRedBranches: readonly {
    readonly branchId: string;
    readonly directCounterpartyAddress: string;
    readonly secondHopAddress: string;
    readonly evidenceId: string;
    readonly amountRaw: string;
  }[];
};

export type OfflineCorpusV1 = {
  readonly schemaVersion: string;
  readonly ledgerCases: readonly OfflineCaseV1[];
  readonly serviceCases: readonly OfflineCaseV1[];
  readonly adverseCases: readonly OfflineCaseV1[];
  readonly broadScopeCases?: readonly BroadScopeCaseV1[];
};

export type ExactDrainerCallV1 = {
  readonly txHash: string;
  readonly contractAddress: string;
  readonly selector: string;
  readonly tokenContract: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly receiverAddress: string;
  readonly amountRaw: string;
  readonly confirmed: boolean;
  readonly successful: boolean;
};

export type ExactDrainerMovementV1 = {
  readonly txHash: string;
  readonly tokenContract: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly amountRaw: string;
  readonly confirmed: boolean;
  readonly successful: boolean;
};

export type ExactDrainerSceneInputV1 = {
  readonly methodContractAddress: string;
  readonly methodMap: Readonly<Record<string, string>>;
  readonly topMethods: readonly {
    readonly methodId?: string | null;
    readonly method?: string | null;
    readonly signature?: string | null;
  }[];
  readonly serviceLabel?: string | null;
  readonly relevantCall: ExactDrainerCallV1 | null;
  readonly movement: ExactDrainerMovementV1 | null;
};

export type ExactDrainerSceneResultV1 = {
  readonly classification: "exact_drainer_red" | "context_only";
  readonly red: boolean;
  readonly reason:
    | "exact_call_and_movement_confirmed"
    | "trusted_service_guard"
    | "fingerprint_incomplete"
    | "exact_call_missing"
    | "exact_call_mismatch"
    | "exact_call_not_confirmed"
    | "exact_call_not_successful"
    | "movement_missing"
    | "movement_not_confirmed"
    | "movement_not_successful"
    | "token_not_official_usdt"
    | "spender_contract_invalid"
    | "spender_contract_mismatch"
    | "movement_mismatch";
};

type ReplayCaseResultV1 = {
  readonly id: string;
  readonly evidenceClass: OfflineEvidenceClassV1;
  readonly [key: string]: unknown;
};

export type OfflineReplayResultV1 = {
  readonly schemaVersion: "offline-forensic-model-replay-v1";
  readonly ledgerCases: readonly ReplayCaseResultV1[];
  readonly serviceCases: readonly ReplayCaseResultV1[];
  readonly adverseCases: readonly ReplayCaseResultV1[];
  readonly broadScopeCases: readonly ReplayCaseResultV1[];
  readonly dataGaps: readonly { readonly caseId: string; readonly code: string }[];
};

const AMOUNT_RAW = /^(0|[1-9]\d*)$/u;
const TX_HASH = /^[0-9a-f]{64}$/iu;
const EVIDENCE_CLASSES = new Set<OfflineEvidenceClassV1>([
  "exact_frozen_rows",
  "recorded_calibration_vector",
  "synthetic_edge_case"
]);
const LOCKED_LABEL_EVIDENCE_V1 = {
  rawEvidenceRef:
    "docs/audit/2026-07-system-audit/golden-v2/locked/cases/regression-tqr/neutral-bundle.json",
  rawEvidenceArtifactSha256: "eba27f37c5bd8ad7e97623c26fbf4e6d7717a26041af4aca2c2edfd7c11cff8b",
  labelDatasetSha256: "45ad3d1a1174ded21f53f9f8c354188f4d0e02311422cfd14fe9b56555232ac1",
  rows: {
    "exact-binance-label": {
      frozenRowSha256: "fc6c930e3926a6fb9235007cfd4bc66b13c8ba172849f76fc2b0262cdaad14e0",
      catalogEntryId: "cex:binance"
    },
    "exact-htx-label": {
      frozenRowSha256: "4b921abb32284509f8572b42e80c42e9e8b41232013d79c4c212a068837253c8",
      catalogEntryId: "cex:htx-huobi"
    }
  }
} as const;

function record(value: unknown, code = "offline_corpus_case_invalid"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(code);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, code = "offline_corpus_case_invalid"): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(code);
  return value;
}

function integer(value: unknown, code = "offline_corpus_case_invalid"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new TypeError(code);
  return value;
}

function nonnegativeInteger(value: unknown, code: string): number {
  const result = integer(value, code);
  if (result < 0) throw new TypeError(code);
  return result;
}

function canonicalTxHash(value: unknown, code: string): string {
  const result = string(value, code).trim();
  if (!TX_HASH.test(result)) throw new TypeError(code);
  return result.toLowerCase();
}

function canonicalTimestamp(value: unknown, code: string): string {
  const result = string(value, code);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) {
    throw new TypeError(code);
  }
  return result;
}

function normalizedIdentity(value: unknown, code: string): string {
  const result = string(value, code).trim();
  if (result === "" || result !== value) throw new TypeError(code);
  return result;
}

function parseAmountRaw(value: unknown): bigint {
  if (typeof value !== "string" || !AMOUNT_RAW.test(value)) {
    throw new TypeError("offline_corpus_amount_raw_invalid");
  }
  return BigInt(value);
}

function validateAmounts(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) validateAmounts(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/amountRaw$/iu.test(key)) parseAmountRaw(child);
    validateAmounts(child);
  }
}

function evidenceClass(value: unknown): OfflineEvidenceClassV1 {
  if (!EVIDENCE_CLASSES.has(value as OfflineEvidenceClassV1)) {
    throw new TypeError("offline_corpus_evidence_class_invalid");
  }
  return value as OfflineEvidenceClassV1;
}

function validateCases(value: unknown): readonly OfflineCaseV1[] {
  if (!Array.isArray(value)) throw new TypeError("offline_corpus_schema_invalid");
  return value.map((item) => {
    const source = record(item);
    const id = string(source.id);
    if (id.trim() !== id) throw new TypeError("offline_corpus_case_invalid");
    evidenceClass(source.evidenceClass);
    return source as OfflineCaseV1;
  });
}

function resultBase(item: OfflineCaseV1): Pick<ReplayCaseResultV1, "id" | "evidenceClass"> {
  return { id: item.id, evidenceClass: item.evidenceClass };
}

function toLedgerEvent(value: unknown): LedgerEventV1 {
  const source = record(value);
  const providerEventIds = source.providerEventIds;
  if (!Array.isArray(providerEventIds) || providerEventIds.some((item) => typeof item !== "string")) {
    throw new TypeError("offline_corpus_ledger_event_invalid");
  }
  const eventIndexAuthority = source.eventIndexAuthority;
  if (eventIndexAuthority !== "receipt_log_index" && eventIndexAuthority !== "provider_synthetic") {
    throw new TypeError("offline_corpus_ledger_event_invalid");
  }
  return {
    canonicalEventId: source.canonicalEventId === null ? null : string(source.canonicalEventId),
    providerEventIds,
    txHash: string(source.txHash),
    blockNumber: integer(source.blockNumber),
    transactionIndex: source.transactionIndex === null ? null : integer(source.transactionIndex),
    eventIndex: source.eventIndex === null ? null : integer(source.eventIndex),
    eventIndexAuthority,
    occurredAtMs: integer(source.occurredAtMs),
    fromAddress: string(source.fromAddress),
    toAddress: string(source.toAddress),
    amountRaw: parseAmountRaw(source.amountRaw)
  };
}

function toLedgerInput(value: unknown): LedgerInputV1 {
  const source = record(value);
  if (!Array.isArray(source.events)) throw new TypeError("offline_corpus_ledger_input_invalid");
  const historyCompleteness = source.historyCompleteness;
  if (historyCompleteness !== "genesis_complete" && historyCompleteness !== "partial") {
    throw new TypeError("offline_corpus_ledger_input_invalid");
  }
  return {
    subjectAddress: string(source.subjectAddress),
    snapshotBlockNumber: integer(source.snapshotBlockNumber),
    snapshotBlockHash: string(source.snapshotBlockHash),
    snapshotEvidenceRef: string(source.snapshotEvidenceRef),
    historyCompleteness,
    openingBalanceRaw: parseAmountRaw(source.openingBalanceRaw),
    events: source.events.map(toLedgerEvent)
  };
}

function toSnapshotWitness(value: unknown): SnapshotBalanceWitnessV1 {
  const source = record(value);
  if (typeof source.pinned !== "boolean" || typeof source.independent !== "boolean") {
    throw new TypeError("offline_corpus_balance_witness_invalid");
  }
  return {
    amountRaw: parseAmountRaw(source.amountRaw),
    pinned: source.pinned,
    independent: source.independent,
    subjectAddress: string(source.subjectAddress),
    snapshotBlockNumber: integer(source.snapshotBlockNumber),
    snapshotBlockHash: string(source.snapshotBlockHash),
    evidenceRef: string(source.evidenceRef)
  };
}

function replayLedgerCase(item: OfflineCaseV1): ReplayCaseResultV1 {
  const source = item as Record<string, unknown>;
  if (source.replayInput !== undefined) {
    const ledger = runChronologicalProportionalLedgerV1(toLedgerInput(source.replayInput));
    const querySource = record(source.query, "offline_corpus_ledger_query_invalid");
    const purpose = querySource.purpose;
    if (purpose !== "current_balance" && purpose !== "amount_only" && purpose !== "exact_episode") {
      throw new TypeError("offline_corpus_ledger_query_invalid");
    }
    const redIds = querySource.exactRedContributorLotIds;
    if (redIds !== undefined && (!Array.isArray(redIds) || redIds.some((id) => typeof id !== "string"))) {
      throw new TypeError("offline_corpus_ledger_query_invalid");
    }
    const query: LedgerQueryV1 = {
      ledger,
      purpose,
      requestedAmountRaw: querySource.requestedAmountRaw === undefined
        ? undefined
        : parseAmountRaw(querySource.requestedAmountRaw),
      exactEventId: querySource.exactEventId === undefined
        ? undefined
        : string(querySource.exactEventId),
      snapshotBalanceWitness: querySource.snapshotBalanceWitness === undefined
        ? undefined
        : toSnapshotWitness(querySource.snapshotBalanceWitness),
      exactRedContributorLotIds: redIds as string[] | undefined
    };
    const selection = selectLedgerProvenanceV1(query);
    return {
      ...resultBase(item),
      state: selection.state,
      reason: selection.reason,
      authoritative: ledger.authoritative,
      targetRaw: selection.targetRaw.toString(),
      coveredRaw: selection.coveredRaw.toString(),
      allocations: selection.allocations.map((allocation) => ({
        lotId: allocation.lotId,
        sourceEventId: allocation.sourceEventId,
        sourceAddress: allocation.sourceAddress,
        amountRaw: allocation.amountRaw.toString(),
        sourceOriginalRaw: allocation.sourceOriginalRaw.toString(),
        sourceUtilizedRaw: allocation.sourceUtilizedRaw.toString()
      })),
      deepSelectedLotIds: selection.deepSelectedLotIds
    };
  }
  const history = source.historyCompleteness;
  if (history !== null && typeof history === "object" && !Array.isArray(history)) {
    const completeness = history as Record<string, unknown>;
    if (completeness.providerExhaustionProven !== true ||
      completeness.zeroOpeningWitnessProven !== true) {
    return {
      ...resultBase(item),
      state: "unresolved",
      reason: "history_incomplete",
      authoritative: false
    };
    }
  }
  return {
    ...resultBase(item),
    state: "expectation_level",
    reason: null,
    authoritative: false
  };
}

function recordedWindowVector(value: unknown, minimumRows = 0): CompleteServiceWindowVectorV2 {
  const code = "offline_corpus_service_vector_invalid";
  const source = record(value, code);
  const largest = record(source.largestCounterparty, code);
  const median = record(source.medianDominantDirectionGapSeconds, code);
  const repeated = record(source.dominantExactAmount, code);
  const dominantDirection = source.dominantDirection;
  if (dominantDirection !== "incoming" && dominantDirection !== "outgoing") {
    throw new TypeError(code);
  }
  const count = (candidate: unknown) => nonnegativeInteger(candidate, code);
  const physicalRowCount = count(source.physicalRowCount);
  const canonicalEventCount = count(source.canonicalEventCount);
  const featureEligibleEventCount = count(source.featureEligibleEventCount);
  const incomingCount = count(source.incomingCount);
  const outgoingCount = count(source.outgoingCount);
  const uniqueSenders = count(source.uniqueSenders);
  const uniqueRecipients = count(source.uniqueRecipients);
  const uniqueCounterparties = count(source.uniqueCounterparties);
  const largestCounterpartyCount = count(largest.count);
  const largestCounterpartyShareDenominator = count(largest.shareDenominator);
  const dominantDirectionCount = count(source.dominantDirectionCount);
  const uniqueDominantCounterparties = count(source.uniqueDominantCounterparties);
  const dominantShareDenominator = count(source.dominantShareDenominator);
  const medianNumerator = count(median.numerator);
  const medianDenominator = integer(median.denominator, code);
  if (medianDenominator !== 1 && medianDenominator !== 2) throw new TypeError(code);
  const maxDominantDirectionEventsPerHour = count(source.maxDominantDirectionEventsPerHour);
  const activeUtcHourOfDayCount = count(source.activeUtcHourOfDayCount);
  const dominantExactAmountCount = count(repeated.count);
  const dominantExactAmountShareDenominator = count(repeated.shareDenominator);
  const observedStartTimestamp = canonicalTimestamp(source.observedStartTimestamp, code);
  const observedEndTimestamp = canonicalTimestamp(source.observedEndTimestamp, code);
  const observedStartSeconds = Date.parse(observedStartTimestamp) / 1_000;
  const observedEndSeconds = Date.parse(observedEndTimestamp) / 1_000;
  const observedWindowDurationSeconds = count(source.observedWindowDurationSeconds);
  const coherent = physicalRowCount >= minimumRows && canonicalEventCount >= minimumRows &&
    physicalRowCount >= canonicalEventCount &&
    featureEligibleEventCount <= canonicalEventCount &&
    incomingCount + outgoingCount === featureEligibleEventCount &&
    uniqueSenders <= incomingCount && uniqueRecipients <= outgoingCount &&
    uniqueCounterparties <= featureEligibleEventCount &&
    uniqueCounterparties >= Math.max(uniqueSenders, uniqueRecipients) &&
    uniqueCounterparties <= uniqueSenders + uniqueRecipients &&
    largestCounterpartyCount <= featureEligibleEventCount &&
    largestCounterpartyShareDenominator === featureEligibleEventCount &&
    (dominantDirection === "incoming" ? incomingCount > outgoingCount : outgoingCount > incomingCount) &&
    dominantDirectionCount === Math.max(incomingCount, outgoingCount) &&
    uniqueDominantCounterparties === (
      dominantDirection === "incoming" ? uniqueSenders : uniqueRecipients
    ) &&
    dominantShareDenominator === featureEligibleEventCount &&
    maxDominantDirectionEventsPerHour <= dominantDirectionCount &&
    activeUtcHourOfDayCount <= 24 && activeUtcHourOfDayCount <= featureEligibleEventCount &&
    dominantExactAmountCount <= dominantDirectionCount &&
    dominantExactAmountShareDenominator === dominantDirectionCount &&
    observedStartSeconds <= observedEndSeconds &&
    observedEndSeconds - observedStartSeconds === observedWindowDurationSeconds;
  if (!coherent) throw new TypeError(code);
  return {
    kind: "complete",
    physicalRowCount,
    canonicalEventCount,
    featureEligibleEventCount,
    invalidPhysicalRowCount: 0,
    collisionPhysicalRowCount: 0,
    duplicatePhysicalRowCount: physicalRowCount - canonicalEventCount,
    poisoningOnlyEventCount: 0,
    gasFreeFeeEventCount: 0,
    gasFreePrincipalEventCount: 0,
    incomingCount,
    outgoingCount,
    uniqueSenders,
    uniqueRecipients,
    uniqueCounterparties,
    largestCounterpartyCount,
    largestCounterpartyShareDenominator,
    dominantDirection,
    dominantDirectionCount,
    uniqueDominantCounterparties,
    dominantShareDenominator,
    medianDominantDirectionGapSeconds: {
      numerator: medianNumerator,
      denominator: medianDenominator
    },
    maxDominantDirectionEventsPerHour,
    activeUtcHourOfDayCount,
    dominantExactAmountRaw: parseAmountRaw(repeated.amountRaw),
    dominantExactAmountCount,
    dominantExactAmountShareDenominator,
    observedStartSeconds,
    observedEndSeconds,
    observedWindowDurationSeconds,
    orderAuthoritative: true
  };
}

function validateRecordedPredicate(
  value: unknown,
  vector: CompleteServiceWindowVectorV2
): boolean {
  const source = record(value, "offline_corpus_service_vector_invalid");
  const computed = evaluateServiceWindowPredicateV2(vector);
  const computedP = computed.C && computed.B && computed.G && (computed.H || computed.R || computed.X);
  if (source.recordedPredicate === undefined) return computedP;
  const recorded = record(source.recordedPredicate, "offline_corpus_service_vector_invalid");
  for (const key of ["C", "B", "G", "H", "R", "X"] as const) {
    if (typeof recorded[key] !== "boolean" || recorded[key] !== computed[key]) {
      throw new TypeError("offline_corpus_service_vector_invalid");
    }
  }
  if (recorded.P !== computedP) throw new TypeError("offline_corpus_service_vector_invalid");
  return computedP;
}

function serviceAnchorTimestamp(source: Record<string, unknown>): string | null {
  if (typeof source.anchorTimestamp === "string") {
    return canonicalTimestamp(source.anchorTimestamp, "offline_corpus_service_anchor_invalid");
  }
  if (source.observedVector !== undefined) {
    const observed = record(source.observedVector, "offline_corpus_service_vector_invalid");
    if (typeof observed.observedEndTimestamp === "string") {
      return canonicalTimestamp(observed.observedEndTimestamp, "offline_corpus_service_anchor_invalid");
    }
  }
  if (Array.isArray(source.windows) && source.windows.length === 2) {
    const ends = source.windows.map((window) =>
      canonicalTimestamp(record(window).observedEndTimestamp, "offline_corpus_service_anchor_invalid")
    );
    return ends.sort().at(-1) ?? null;
  }
  return null;
}

function replayServiceCase(
  item: OfflineCaseV1,
  exactLabels: ReadonlyMap<string, readonly FrozenLabelRecordV1[]>
): ReplayCaseResultV1 {
  const source = item as Record<string, unknown>;
  if (source.windows !== undefined && (!Array.isArray(source.windows) || source.windows.length !== 2)) {
    throw new TypeError("offline_corpus_service_vector_invalid");
  }
  let windowVectors: { recent: ServiceWindowVectorV2; historical: ServiceWindowVectorV2 } | null = null;
  if (Array.isArray(source.windows)) {
    const vectors = new Map<string, ServiceWindowVectorV2>();
    for (const window of source.windows) {
      const windowSource = record(window, "offline_corpus_service_vector_invalid");
      if (windowSource.kind !== "recent" && windowSource.kind !== "historical" ||
        vectors.has(windowSource.kind)) {
        throw new TypeError("offline_corpus_service_vector_invalid");
      }
      const vector = recordedWindowVector(window, 100);
      validateRecordedPredicate(window, vector);
      vectors.set(windowSource.kind, vector);
    }
    const recent = vectors.get("recent");
    const historical = vectors.get("historical");
    if (recent === undefined || historical === undefined) {
      throw new TypeError("offline_corpus_service_vector_invalid");
    }
    windowVectors = { recent, historical };
  }
  if (source.observedVector !== undefined) {
    const observed = record(source.observedVector, "offline_corpus_service_vector_invalid");
    if (observed.recordedPredicate !== undefined) {
      const vector = recordedWindowVector(observed);
      validateRecordedPredicate(observed, vector);
    }
  }
  const address = typeof source.address === "string" ? source.address : null;
  const labels = address === null ? [] : exactLabels.get(address) ?? [];
  const anchorTimestamp = serviceAnchorTimestamp(source);
  const eligibleLabels = anchorTimestamp === null
    ? []
    : labels.filter((label) => resolveFrozenLabelAtEventV1({ label, eventTimestamp: anchorTimestamp }).kind === "eligible");
  const exactRoles = new Set(eligibleLabels.map(({ catalogEntryId }) => catalogEntryId));
  const behavior = windowVectors === null
    ? null
    : classifyServiceBehavior100Plus100V2({
      ...windowVectors,
      exactRoleConflict: exactRoles.size > 1
    });
  if (exactRoles.size > 1) {
    return {
      ...resultBase(item),
      state: "role_conflict",
      exactRoleResolution: "role_conflict",
      inferredClassifierBypassed: false,
      replayAuthority: "exact_frozen_rows",
      authoritative: false
    };
  }
  if (exactRoles.size === 1) {
    return {
      ...resultBase(item),
      state: "exact_service_role",
      serviceRole: [...exactRoles][0],
      inferredClassifierBypassed: true,
      replayAuthority: "exact_frozen_rows"
    };
  }
  const exactRoleResolution = labels.length === 0
    ? null
    : anchorTimestamp === null
        ? "anchor_missing"
        : "label_not_valid_at_event";
  const evidenceGap = item.evidenceClass === "recorded_calibration_vector" && source.rawProviderPagesFrozen === false
    ? source.behaviorClassification === "insufficient_data"
      ? "insufficient_service_windows"
      : "recorded_partial_vector"
    : null;
  if (behavior !== null) {
    return {
      ...resultBase(item),
      state: behavior.status,
      replayAuthority: "recorded_vector",
      authoritative: false,
      exactRoleResolution,
      dataGapCode: evidenceGap
    };
  }
  if (source.behaviorClassification === "insufficient_data") {
    return {
      ...resultBase(item),
      state: "insufficient_data",
      replayAuthority: "recorded_partial_vector",
      authoritative: false,
      exactRoleResolution,
      dataGapCode: evidenceGap
    };
  }
  return {
    ...resultBase(item),
    state: "expectation_level",
    replayAuthority: "recorded_vector",
    authoritative: false,
    exactRoleResolution,
    dataGapCode: evidenceGap
  };
}

function providerLabelResult(item: OfflineCaseV1): ReplayCaseResultV1 {
  const source = item as Record<string, unknown>;
  const manifestBinding = LOCKED_LABEL_EVIDENCE_V1.rows[
    item.id as keyof typeof LOCKED_LABEL_EVIDENCE_V1.rows
  ];
  const frozenValue = source.frozenRow;
  const frozen = frozenValue !== null && typeof frozenValue === "object" && !Array.isArray(frozenValue)
    ? frozenValue as Record<string, unknown>
    : null;
  const validFromValue = frozen?.validFrom;
  let computedFrozenRowSha256: string | null = null;
  try {
    computedFrozenRowSha256 = frozen === null ? null : fingerprintCanonicalArtifact(frozen);
  } catch {
    computedFrozenRowSha256 = null;
  }
  const catalogEntryId = typeof frozen?.label === "string"
    ? matchTronScanCexTagV1(frozen.label)
    : null;
  const exactAuthority = item.evidenceClass === "exact_frozen_rows" &&
    manifestBinding !== undefined &&
    source.rawEvidenceRef === LOCKED_LABEL_EVIDENCE_V1.rawEvidenceRef &&
    source.rawEvidenceArtifactSha256 === LOCKED_LABEL_EVIDENCE_V1.rawEvidenceArtifactSha256 &&
    source.labelDatasetSha256 === LOCKED_LABEL_EVIDENCE_V1.labelDatasetSha256 &&
    source.frozenRowHashConvention === "sha256(canonicalizeArtifactJson(frozenRow))" &&
    source.frozenRowSha256 === manifestBinding.frozenRowSha256 &&
    computedFrozenRowSha256 === manifestBinding.frozenRowSha256 &&
    catalogEntryId === manifestBinding.catalogEntryId &&
    frozen !== null && frozen.authority === "tronscan-metadata" &&
    frozen.category === "service_metadata" && frozen.validTo === null &&
    typeof frozen.address === "string" && frozen.address.trim() !== "" &&
    frozen.address.trim() === frozen.address &&
    typeof frozen.label === "string" && frozen.label.trim() !== "" &&
    typeof validFromValue === "string" && Number.isFinite(Date.parse(validFromValue)) &&
    new Date(validFromValue).toISOString() === validFromValue;
  if (!exactAuthority) {
    return {
      ...resultBase(item),
      kind: "service_label",
      authoritative: false,
      inferredClassifierBypassed: false,
      providerAssertionReplay: "raw_provider_assertion_not_replayed",
      dataGapCode: "provider_label_authority_missing"
    };
  }
  const address = string(frozen.address);
  const validFrom = string(frozen.validFrom);
  const label = buildFrozenLabelRecord({
    address,
    classifierHint: null,
    exactRegistryBinding: null,
    verifiedProviderBinding: {
      catalogEntryId: catalogEntryId!,
      authority: "tronscan_verified_metadata",
      sourcePayloadSha256: string(source.labelDatasetSha256),
      validFrom,
      validTo: null
    }
  });
  const atStart = resolveFrozenLabelAtEventV1({ label, eventTimestamp: validFrom });
  const before = resolveFrozenLabelAtEventV1({
    label,
    eventTimestamp: new Date(Date.parse(validFrom) - 1).toISOString()
  });
  return {
    ...resultBase(item),
    kind: "service_label",
    authoritative: true,
    providerAssertionReplay: "raw_provider_assertion_not_replayed",
    address,
    serviceRole: catalogEntryId,
    inferredClassifierBypassed: true,
    adverse: catalogEntryId === "cex:htx-huobi",
    frozenLabel: label,
    atValidityStart: atStart.kind,
    beforeValidityStart: before.kind
  };
}

function routeEdge(input: {
  id: string;
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  occurredAt: string;
  economicProtocol?: "tron_gasfree";
  economicRole?: "principal" | "service_fee";
}): ForensicRouteEdge {
  return {
    id: input.id,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    txHash: input.txHash,
    amountRaw: parseAmountRaw(input.amountRaw).toString(),
    timestamp: new Date(input.occurredAt),
    method: "transfer",
    edgeType: "normal_transfer",
    economicProtocol: input.economicProtocol,
    economicRole: input.economicRole
  };
}

type ValidatedTimelineEvent = UsdtBlacklistTimelineEvent & {
  readonly subjectAddress: string;
  readonly confirmed: true;
  readonly successful: true;
  readonly transactionIndex?: number;
};

function validTimelineEvent(value: unknown, listedAddress: string): ValidatedTimelineEvent {
  const code = "offline_corpus_blacklist_timeline_invalid";
  const source = record(value, code);
  const kind = source.eventKind;
  if (kind !== "added" && kind !== "removed" ||
    source.tokenContract !== TRON_USDT_CONTRACT_ADDRESS ||
    normalizedIdentity(source.subjectAddress, code) !== listedAddress ||
    source.confirmed !== true || source.successful !== true) {
    throw new TypeError(code);
  }
  const blockNumber = source.blockNumber === undefined || source.blockNumber === null
    ? null
    : nonnegativeInteger(source.blockNumber, code);
  const transactionIndex = source.transactionIndex === undefined
    ? undefined
    : nonnegativeInteger(source.transactionIndex, code);
  return {
    eventKind: kind,
    occurredAt: canonicalTimestamp(source.occurredAt, code),
    txHash: canonicalTxHash(source.txHash, code),
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    blockNumber,
    logIndex: nonnegativeInteger(source.logIndex, code),
    verification: "verified_contract_log",
    subjectAddress: string(source.subjectAddress, code),
    confirmed: true,
    successful: true,
    ...(transactionIndex === undefined ? {} : { transactionIndex })
  };
}

type ParsedBlacklistTransfer = {
  readonly identity: string;
  readonly txHash: string;
  readonly logIndex: number;
  readonly occurredAt: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly direction: "inbound" | "outbound";
  readonly counterparty: string;
  readonly amountRaw: string;
};

function blacklistResult(item: OfflineCaseV1): ReplayCaseResultV1 {
  const source = item as Record<string, unknown>;
  if (!Array.isArray(source.principalTransfers) || !Array.isArray(source.timelineEvents)) {
    throw new TypeError("offline_corpus_blacklist_invalid");
  }
  const subjectAddress = normalizedIdentity(
    source.subjectAddress,
    "offline_corpus_blacklist_subject_invalid"
  );
  const listedAddress = normalizedIdentity(
    source.listedAddress,
    "offline_corpus_blacklist_subject_invalid"
  );
  if (subjectAddress === listedAddress) {
    throw new TypeError("offline_corpus_blacklist_subject_invalid");
  }
  const transfersByIdentity = new Map<string, ParsedBlacklistTransfer>();
  for (const value of source.principalTransfers) {
    const transfer = record(value, "offline_corpus_blacklist_transfer_invalid");
    const code = "offline_corpus_blacklist_transfer_invalid";
    if (transfer.tokenContract !== TRON_USDT_CONTRACT_ADDRESS ||
      transfer.confirmed !== true || transfer.successful !== true) throw new TypeError(code);
    const txHash = canonicalTxHash(transfer.txHash, code);
    const logIndex = nonnegativeInteger(transfer.logIndex, code);
    const fromAddress = normalizedIdentity(transfer.fromAddress, code);
    const toAddress = normalizedIdentity(transfer.toAddress, code);
    const fromIsSubject = fromAddress === subjectAddress;
    const toIsSubject = toAddress === subjectAddress;
    if (fromIsSubject === toIsSubject) {
      throw new TypeError("offline_corpus_blacklist_subject_invalid");
    }
    const direction = toIsSubject ? "inbound" as const : "outbound" as const;
    const counterparty = direction === "inbound" ? fromAddress : toAddress;
    const amountRaw = parseAmountRaw(transfer.amountRaw).toString();
    const occurredAt = transfer.occurredAt === null || transfer.occurredAt === undefined
      ? ""
      : canonicalTimestamp(transfer.occurredAt, code);
    const identity = `${txHash}:${logIndex}`;
    const parsed = {
      identity,
      txHash,
      logIndex,
      occurredAt,
      fromAddress,
      toAddress,
      direction,
      counterparty,
      amountRaw
    } satisfies ParsedBlacklistTransfer;
    const previous = transfersByIdentity.get(identity);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(parsed)) {
      throw new TypeError("offline_corpus_blacklist_identity_invalid");
    }
    transfersByIdentity.set(identity, previous ?? parsed);
  }
  const eventsByIdentity = new Map<string, ValidatedTimelineEvent>();
  for (const value of source.timelineEvents) {
    const event = validTimelineEvent(value, listedAddress);
    const identity = `${event.txHash}:${event.logIndex}`;
    const previous = eventsByIdentity.get(identity);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(event)) {
      throw new TypeError("offline_corpus_blacklist_timeline_invalid");
    }
    eventsByIdentity.set(identity, previous ?? event);
  }
  const transfers = [...transfersByIdentity.values()];
  const events = [...eventsByIdentity.values()]
    .sort((left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      (left.blockNumber ?? Number.MAX_SAFE_INTEGER) - (right.blockNumber ?? Number.MAX_SAFE_INTEGER) ||
      (left.transactionIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.transactionIndex ?? Number.MAX_SAFE_INTEGER) ||
      (left.logIndex ?? Number.MAX_SAFE_INTEGER) - (right.logIndex ?? Number.MAX_SAFE_INTEGER) ||
      left.txHash.localeCompare(right.txHash)
    );
  const transferByGroupingIdentity = new Map(transfers.map((transfer) => [
    JSON.stringify([
      transfer.identity,
      transfer.direction,
      transfer.counterparty,
      transfer.amountRaw
    ]),
    transfer
  ]));
  const groups = groupDirectPrincipalCounterparties({
    subjectAddress,
    edges: [...transferByGroupingIdentity].map(([groupingIdentity, transfer]) => routeEdge({
      id: groupingIdentity,
      txHash: groupingIdentity,
      fromAddress: transfer.fromAddress,
      toAddress: transfer.toAddress,
      amountRaw: transfer.amountRaw,
      // ponytail: the grouping helper requires a valid Date; exact timestamps
      // are rebound below before any temporal interpretation.
      occurredAt: transfer.occurredAt || "1970-01-01T00:00:00.000Z"
    })),
    directTransferCoverage: "complete"
  });
  const reboundGroupingIdentities = new Set<string>();
  const reboundGroups = groups.map((group) => {
    const principalTransfers = group.principalTransfers.map((transfer) => {
      const sourceTransfer = transferByGroupingIdentity.get(transfer.txHash);
      if (sourceTransfer === undefined || sourceTransfer.direction !== group.direction ||
        sourceTransfer.counterparty !== group.address ||
        BigInt(sourceTransfer.amountRaw) !== transfer.amountRaw ||
        reboundGroupingIdentities.has(transfer.txHash)) {
        throw new TypeError("offline_corpus_blacklist_group_binding_invalid");
      }
      reboundGroupingIdentities.add(transfer.txHash);
      return {
        txHash: sourceTransfer.txHash,
        amountRaw: transfer.amountRaw,
        occurredAt: sourceTransfer.occurredAt
      };
    });
    if (principalTransfers.reduce((sum, transfer) => sum + transfer.amountRaw, 0n) !==
      group.principalAmountRaw) {
      throw new TypeError("offline_corpus_blacklist_group_binding_invalid");
    }
    return { ...group, principalTransfers };
  });
  const amounts = { before: 0n, active: 0n, unknown: 0n };
  const unmatchedCounterpartyAmountRaw = reboundGroups
    .filter(({ address }) => address !== listedAddress)
    .reduce((sum, group) => sum + group.principalAmountRaw, 0n);
  for (const group of reboundGroups.filter(({ address }) => address === listedAddress)) {
    const selected = group.principalTransfers;
    const addition = events[0];
    const removal = events[1];
    const blockOrderValid = addition !== undefined && removal !== undefined &&
      addition.blockNumber !== null && removal.blockNumber !== null
      ? addition.blockNumber < removal.blockNumber || addition.blockNumber === removal.blockNumber && (
        addition.transactionIndex !== undefined && removal.transactionIndex !== undefined
          ? addition.transactionIndex < removal.transactionIndex ||
            addition.transactionIndex === removal.transactionIndex && addition.logIndex! < removal.logIndex!
          : addition.txHash === removal.txHash && addition.logIndex! < removal.logIndex!
      )
      : true;
    const supportedLifecycle = events.length >= 1 && events.length <= 2 &&
      addition?.eventKind === "added" &&
      (removal === undefined || removal.eventKind === "removed" &&
        Date.parse(addition.occurredAt) < Date.parse(removal.occurredAt) && blockOrderValid);
    if (!supportedLifecycle) {
      amounts.unknown += selected.reduce((sum, transfer) => sum + transfer.amountRaw, 0n);
      continue;
    }
    const byTxHash = new Map<string, typeof selected>();
    for (const transfer of selected) {
      const sameTransaction = byTxHash.get(transfer.txHash) ?? [];
      sameTransaction.push(transfer);
      byTxHash.set(transfer.txHash, sameTransaction);
    }
    const helperTransfers: typeof selected = [];
    for (const sameTransaction of byTxHash.values()) {
      const timestamps = new Set(sameTransaction.map(({ occurredAt }) => occurredAt));
      const occurredAt = timestamps.size === 1 ? sameTransaction[0]!.occurredAt : "";
      const occurredAtMs = Date.parse(occurredAt);
      const transactionAmountRaw = sameTransaction.reduce((sum, transfer) => sum + transfer.amountRaw, 0n);
      if (!Number.isFinite(occurredAtMs) ||
        removal !== undefined && occurredAtMs >= Date.parse(removal.occurredAt)) {
        amounts.unknown += transactionAmountRaw;
      } else {
        helperTransfers.push(...sameTransaction);
      }
    }
    const partition = partitionPrincipalTransfersByBlacklistTimeline({
      principalTransfers: helperTransfers,
      timeline: {
        // ponytail: the shared helper is current-active scoped; explicit
        // segmentation above removes post-removal and ambiguous transactions.
        events: [addition],
        pagination: "complete",
        failureReason: null
      }
    });
    amounts.before += partition.before.amountRaw;
    amounts.active += partition.active.amountRaw;
    amounts.unknown += partition.unknown.amountRaw;
  }
  return {
    ...resultBase(item),
    kind: "blacklist_timeline",
    beforeEventAmountRaw: amounts.before.toString(),
    beforeActivationAmountRaw: amounts.before.toString(),
    activeAtEventAmountRaw: amounts.active.toString(),
    unknownAmountRaw: amounts.unknown.toString(),
    hardEvidenceAmountRaw: amounts.active.toString(),
    unmatchedCounterpartyAmountRaw: unmatchedCounterpartyAmountRaw.toString(),
    timelineEvents: events,
    partitions: {
      before_event: amounts.before.toString(),
      active_at_event: amounts.active.toString(),
      unknown: amounts.unknown.toString()
    }
  };
}

function gasFreeResult(item: OfflineCaseV1): ReplayCaseResultV1 {
  const source = item as Record<string, unknown>;
  const settlement = extractGasFreeSettlement(source.transactionInfo);
  if (!settlement || !Array.isArray(source.replayEdges)) {
    throw new TypeError("offline_corpus_gasfree_invalid");
  }
  const movementKey = (movement: {
    role: string;
    fromAddress: string;
    toAddress: string;
    amountRaw: string;
  }) => [
    movement.role,
    movement.fromAddress,
    movement.toAddress,
    movement.amountRaw
  ].join("|");
  const replayMovements = source.replayEdges.map((value) => {
    const edge = record(value);
    const economicRole = edge.economicRole;
    if ((economicRole !== "principal" && economicRole !== "service_fee") ||
      edge.economicProtocol !== "tron_gasfree") {
      throw new TypeError("offline_corpus_gasfree_invalid");
    }
    return {
      role: economicRole,
      fromAddress: normalizedIdentity(edge.fromAddress, "offline_corpus_gasfree_invalid"),
      toAddress: normalizedIdentity(edge.toAddress, "offline_corpus_gasfree_invalid"),
      amountRaw: parseAmountRaw(edge.amountRaw).toString()
    };
  });
  const supplied = replayMovements.map(movementKey).sort();
  const extracted = settlement.movements.map(movementKey).sort();
  if (supplied.length !== extracted.length || supplied.some((value, index) => value !== extracted[index])) {
    throw new TypeError("offline_corpus_gasfree_edges_invalid");
  }
  const edges = [...settlement.movements]
    .sort((left, right) => movementKey(left).localeCompare(movementKey(right)))
    .map((movement) => {
    return routeEdge({
      id: `gasfree:${movementKey(movement)}`,
      txHash: `gasfree:${movement.role}`,
      fromAddress: movement.fromAddress,
      toAddress: movement.toAddress,
      amountRaw: movement.amountRaw,
      occurredAt: "1970-01-01T00:00:00.000Z",
      economicProtocol: "tron_gasfree",
      economicRole: movement.role
    });
  });
  const groups = groupDirectPrincipalCounterparties({
    subjectAddress: settlement.accountAddress,
    edges,
    directTransferCoverage: "complete"
  });
  return {
    ...resultBase(item),
    kind: "gasfree_settlement",
    settlementDetected: true,
    ledgerExecuted: false,
    principalAmountRaw: settlement.principalAmountRaw,
    serviceFeeAmountRaw: settlement.serviceFeeAmountRaw,
    principalRole: "aml_money_path",
    serviceFeeRole: "accounting_only_consumption",
    principalFeatureEligible: edges
      .filter((edge) => edge.economicRole === "principal")
      .every((edge) => !isGasFreeServiceFeeEdge(edge)),
    serviceFeeFeatureEligible: edges
      .filter((edge) => edge.economicRole === "service_fee")
      .some((edge) => !isGasFreeServiceFeeEdge(edge)),
    principalCounterparties: groups.map((group) => ({
      address: group.address,
      direction: group.direction,
      amountRaw: group.principalAmountRaw.toString()
    }))
  };
}

function drainerInput(item: OfflineCaseV1): ExactDrainerSceneInputV1 {
  const source = item as Record<string, unknown>;
  const methodEvidence = record(source.methodEvidence);
  if (!Array.isArray(methodEvidence.methodMap)) throw new TypeError("offline_corpus_drainer_invalid");
  const methodMap: Record<string, string> = {};
  for (const value of methodEvidence.methodMap) {
    const method = record(value);
    const selector = string(method.selector).trim().replace(/^0x/iu, "").toLowerCase();
    const signature = string(method.signature).trim();
    if (!/^[0-9a-f]{8}$/u.test(selector) || signature === "") {
      throw new TypeError("offline_corpus_drainer_invalid");
    }
    const previous = methodMap[selector];
    if (previous !== undefined && previous !== signature) {
      throw new TypeError("offline_corpus_drainer_method_map_conflict");
    }
    methodMap[selector] = signature;
  }
  const call = source.transferFromCall === null ? null : record(source.transferFromCall);
  const movement = source.movement === null ? null : record(source.movement);
  return {
    methodContractAddress: string(methodEvidence.contractAddress),
    methodMap,
    topMethods: [],
    serviceLabel: null,
    relevantCall: call === null ? null : {
      txHash: string(call.txHash),
      contractAddress: string(call.contractAddress),
      selector: string(call.selector),
      tokenContract: string(call.tokenContract),
      fromAddress: string(call.fromAddress),
      toAddress: string(call.toAddress),
      receiverAddress: string(call.receiverAddress),
      amountRaw: string(call.amountRaw),
      confirmed: call.confirmed === true,
      successful: call.successful === true
    },
    movement: movement === null ? null : {
      txHash: string(movement.txHash),
      tokenContract: string(movement.tokenContract),
      fromAddress: string(movement.fromAddress),
      toAddress: string(movement.toAddress),
      amountRaw: string(movement.amountRaw),
      confirmed: movement.confirmed === true,
      successful: movement.successful === true
    }
  };
}

function replayAdverseCase(item: OfflineCaseV1): ReplayCaseResultV1 {
  if (item.id === "exact-binance-label" || item.id === "exact-htx-label") {
    return providerLabelResult(item);
  }
  if (item.id === "event-time-blacklist-partitions") return blacklistResult(item);
  if (item.id === "gasfree-principal-fee-classification") return gasFreeResult(item);
  if (item.id === "drainer-method-only" || item.id === "drainer-complete-evidence") {
    return { ...resultBase(item), kind: "drainer_scene", ...evaluateExactDrainerSceneV1(drainerInput(item)) };
  }
  throw new TypeError("offline_corpus_adverse_case_unknown");
}

function replayBroadScopeCase(item: BroadScopeCaseV1): ReplayCaseResultV1 {
  if (!Array.isArray(item.directEdges) || !Array.isArray(item.secondHopRedBranches)) {
    throw new TypeError("offline_corpus_broad_case_invalid");
  }
  normalizedIdentity(item.subjectAddress, "offline_corpus_broad_case_invalid");
  const directCounterparties = new Set(item.directEdges.map((edge) => {
    const code = "offline_corpus_broad_case_invalid";
    string(edge.id, code);
    string(edge.txHash, code);
    if (edge.direction !== "inbound" && edge.direction !== "outbound") throw new TypeError(code);
    parseAmountRaw(edge.amountRaw);
    canonicalTimestamp(edge.occurredAt, code);
    return normalizedIdentity(edge.counterpartyAddress, code);
  }));
  for (const branch of item.secondHopRedBranches) {
    string(branch.branchId, "offline_corpus_broad_case_invalid");
    string(branch.secondHopAddress, "offline_corpus_broad_case_invalid");
    string(branch.evidenceId, "offline_corpus_broad_case_invalid");
    if (!directCounterparties.has(normalizedIdentity(
      branch.directCounterpartyAddress,
      "offline_corpus_broad_case_invalid"
    ))) throw new TypeError("offline_corpus_broad_red_branch_unbound");
  }
  const edges = item.directEdges.map((edge) => routeEdge({
    id: edge.id,
    txHash: edge.txHash,
    fromAddress: edge.direction === "inbound" ? edge.counterpartyAddress : item.subjectAddress,
    toAddress: edge.direction === "inbound" ? item.subjectAddress : edge.counterpartyAddress,
    amountRaw: edge.amountRaw,
    occurredAt: edge.occurredAt
  }));
  const groups = groupDirectPrincipalCounterparties({
    subjectAddress: item.subjectAddress,
    edges,
    directTransferCoverage: "complete"
  });
  const byAddress = new Map<string, { amountRaw: bigint; directions: Set<"inbound" | "outbound"> }>();
  for (const group of groups) {
    const current = byAddress.get(group.address) ?? { amountRaw: 0n, directions: new Set() };
    current.amountRaw += group.principalAmountRaw;
    current.directions.add(group.direction);
    byAddress.set(group.address, current);
  }
  return {
    id: item.id,
    evidenceClass: item.evidenceClass,
    shallowProbe: [...byAddress]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([address, value]) => ({
        address,
        directions: [...value.directions].sort(),
        amountRaw: value.amountRaw.toString()
      })),
    secondHopRedBranches: item.secondHopRedBranches.map((branch) => ({
      branchId: branch.branchId,
      directCounterpartyAddress: branch.directCounterpartyAddress,
      secondHopAddress: branch.secondHopAddress,
      evidenceId: branch.evidenceId,
      amountRaw: parseAmountRaw(branch.amountRaw).toString()
    }))
  };
}

export function evaluateExactDrainerSceneV1(
  input: ExactDrainerSceneInputV1
): ExactDrainerSceneResultV1 {
  const context = (reason: Exclude<ExactDrainerSceneResultV1["reason"], "exact_call_and_movement_confirmed">): ExactDrainerSceneResultV1 => ({
    classification: "context_only",
    red: false,
    reason
  });
  if (input.relevantCall !== null) parseAmountRaw(input.relevantCall.amountRaw);
  if (input.movement !== null) parseAmountRaw(input.movement.amountRaw);
  const methodContractAddress = typeof input.methodContractAddress === "string"
    ? input.methodContractAddress.trim()
    : "";
  const callContractAddress = typeof input.relevantCall?.contractAddress === "string"
    ? input.relevantCall.contractAddress.trim()
    : "";
  if (methodContractAddress === "" || methodContractAddress !== input.methodContractAddress) {
    return context("spender_contract_invalid");
  }
  const fingerprint = detectVerify20Fingerprint({
    methodMap: { ...input.methodMap },
    topMethods: input.topMethods.map((method) => ({
      methodId: method.methodId ?? "",
      method: method.method ?? undefined,
      signature: method.signature ?? null,
      count: 0,
      ratio: null
    })),
    serviceLabel: input.serviceLabel
  });
  if (fingerprint.blockedByTrustedService) return context("trusted_service_guard");
  if (!fingerprint.matched) return context("fingerprint_incomplete");
  const call = input.relevantCall;
  if (!call) return context("exact_call_missing");
  if (callContractAddress === "" || callContractAddress !== call.contractAddress) {
    return context("spender_contract_invalid");
  }
  if (methodContractAddress !== callContractAddress) {
    return context("spender_contract_mismatch");
  }
  if (call.tokenContract !== TRON_USDT_CONTRACT_ADDRESS) {
    return context("token_not_official_usdt");
  }
  if (call.selector.replace(/^0x/iu, "").toLowerCase() !== "5082dd12") {
    return context("exact_call_mismatch");
  }
  if (!call.confirmed) return context("exact_call_not_confirmed");
  if (!call.successful) return context("exact_call_not_successful");
  const movement = input.movement;
  if (!movement) return context("movement_missing");
  if (movement.tokenContract !== TRON_USDT_CONTRACT_ADDRESS) {
    return context("token_not_official_usdt");
  }
  if (!movement.confirmed) return context("movement_not_confirmed");
  if (!movement.successful) return context("movement_not_successful");
  if (
    movement.txHash !== call.txHash ||
    movement.tokenContract !== call.tokenContract ||
    movement.fromAddress !== call.fromAddress ||
    movement.toAddress !== call.toAddress ||
    movement.toAddress !== call.receiverAddress ||
    movement.amountRaw !== call.amountRaw
  ) return context("movement_mismatch");
  return {
    classification: "exact_drainer_red",
    red: true,
    reason: "exact_call_and_movement_confirmed"
  };
}

export function replayOfflineForensicModelCorpusV1(
  corpus: OfflineCorpusV1
): OfflineReplayResultV1 {
  const source = record(corpus, "offline_corpus_schema_invalid");
  if (source.schemaVersion !== "forensic-model-offline-corpus-v1") {
    throw new TypeError("offline_corpus_schema_invalid");
  }
  const ledgerCases = validateCases(source.ledgerCases);
  const serviceCases = validateCases(source.serviceCases);
  const adverseCases = validateCases(source.adverseCases);
  const broadScopeCases = source.broadScopeCases === undefined
    ? []
    : validateCases(source.broadScopeCases) as readonly BroadScopeCaseV1[];
  const ids = [...ledgerCases, ...serviceCases, ...adverseCases, ...broadScopeCases].map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new TypeError("offline_corpus_duplicate_case_id");
  validateAmounts(source);

  const adverseResults = adverseCases.map(replayAdverseCase);
  const exactLabels = new Map<string, FrozenLabelRecordV1[]>();
  for (const item of adverseResults) {
    if (item.authoritative !== true || item.kind !== "service_label" ||
      typeof item.address !== "string" || item.frozenLabel === null ||
      typeof item.frozenLabel !== "object") continue;
    const address = item.address;
    const labels = exactLabels.get(address) ?? [];
    labels.push(item.frozenLabel as FrozenLabelRecordV1);
    labels.sort((left, right) =>
      left.catalogEntryId.localeCompare(right.catalogEntryId) ||
      (left.validFrom ?? "").localeCompare(right.validFrom ?? "") ||
      left.sourcePayloadSha256.localeCompare(right.sourcePayloadSha256)
    );
    exactLabels.set(address, labels);
  }
  const ledgerResults = ledgerCases.map(replayLedgerCase);
  const serviceResults = serviceCases.map((item) => replayServiceCase(item, exactLabels));
  const gapKeys = new Set<string>();
  const addGap = (caseId: string, code: string) => gapKeys.add(`${caseId}\u0000${code}`);
  for (const result of [...ledgerResults, ...serviceResults, ...adverseResults]) {
    if (typeof result.dataGapCode === "string") addGap(result.id, result.dataGapCode);
    if (result.reason === "history_incomplete") addGap(result.id, "history_incomplete");
    if (result.exactRoleResolution === "anchor_missing") {
      addGap(result.id, "exact_service_role_anchor_missing");
    }
    if (result.exactRoleResolution === "role_conflict") {
      addGap(result.id, "exact_service_role_conflict");
    }
  }
  const dataGaps = [...gapKeys]
    .sort()
    .map((key) => {
      const [caseId, code] = key.split("\u0000");
      return { caseId: caseId!, code: code! };
    });
  return {
    schemaVersion: "offline-forensic-model-replay-v1",
    ledgerCases: ledgerResults,
    serviceCases: serviceResults,
    adverseCases: adverseResults,
    broadScopeCases: broadScopeCases.map(replayBroadScopeCase),
    dataGaps
  };
}
