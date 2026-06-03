import type { ForensicCheckJob, ForensicCheckJobStatus } from "../storage/repositories";

export type AdminForensicsDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE" | "UNKNOWN";
export type AdminForensicsRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AdminForensicsConfidence = "low" | "medium" | "high";

export type AdminForensicsJobSummary = {
  id: string;
  kind: ForensicCheckJob["kind"];
  status: Extract<ForensicCheckJobStatus, "partial" | "completed" | "failed">;
  subjectAddress: string;
  windowStart: string;
  windowEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  requestedBy: string | null;
};

export type AdminForensicsAddressSummary = {
  address: string;
  displayLabel: string | null;
  knownLabels: string[];
  role: "checked_wallet" | "sender" | "receiver" | "unknown";
};

export type AdminForensicsSummary = {
  decision: AdminForensicsDecision;
  riskScore: number | null;
  riskLevel: AdminForensicsRiskLevel | null;
  confidence: AdminForensicsConfidence | null;
  coverageRatio: number | null;
  checkedScope: string | null;
  anchorCoverageRatio: number | null;
  episodeCoverageRatio: number | null;
  drainEpisode: Record<string, unknown> | null;
  layerSummary: Record<string, unknown> | null;
  selectedAmountRaw: string | null;
  targetAmountRaw: string | null;
  topReasons: string[];
};

export type AdminForensicsNodeDisplayKind =
  | "subject_wallet"
  | "wallet"
  | "bridge"
  | "cex"
  | "smart_contract"
  | "contract_adapter"
  | "contract_router"
  | "dex_contract"
  | "service_boundary"
  | "funding_bundle"
  | "trace_stop";

export type AdminForensicsNode = {
  id: string;
  address: string | null;
  kind: "subject" | "wallet" | "service" | "contract" | "label" | "bundle" | "stop";
  displayKind?: AdminForensicsNodeDisplayKind;
  displayLabel?: string;
  label: string;
  riskLevel: AdminForensicsRiskLevel | null;
  confidence: AdminForensicsConfidence | null;
  weight: number | null;
  metadata: Record<string, unknown>;
};

export type AdminForensicsEdgeDisplayRole =
  | "real_transfer"
  | "allocated_transfer"
  | "profile_context"
  | "inferred_provenance"
  | "stop";

type AdminForensicsStopCategory =
  | "data_quality"
  | "continuity"
  | "terminal_boundary"
  | "service_boundary"
  | "unknown";

type StopDisplaySemantics = {
  category: AdminForensicsStopCategory;
  title: string;
  canvasLabel: string;
  meaning: string;
  scoreLabel: string;
  scoreMeaning: string;
};

export type AdminForensicsEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: "transfer" | "inferred_provenance" | "approval" | "service_boundary" | "stop";
  displayRole?: AdminForensicsEdgeDisplayRole;
  amountRaw: string | null;
  amountShare: number | null;
  txHash: string | null;
  timestamp: string | null;
  weight: number | null;
  verdict: "clean" | "review" | "risk" | "unknown";
  evidenceIds: string[];
  metadata: Record<string, unknown>;
};

export type AdminForensicsPath = {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
  verdict: AdminForensicsDecision;
  riskContribution: number;
  amountRaw: string | null;
  amountShare: number | null;
  timeSpanMs?: number | null;
  stoppedAtNodeId: string | null;
  stopReason: string | null;
  stopReasonLabel?: string | null;
  stopCategory?: AdminForensicsStopCategory | null;
  lastRealEdgeId?: string | null;
  evidenceIds: string[];
};

export type AdminForensicsWeight = {
  id: string;
  source: string;
  label: string;
  value: number;
  direction: "raises_risk" | "lowers_risk" | "context";
  pathId: string | null;
  nodeId: string | null;
  edgeId: string | null;
  explanation: string;
  metadata: Record<string, unknown>;
};

export type AdminForensicsLimitation = {
  code: string;
  label: string;
  severity: "info" | "review" | "blocking";
  pathId: string | null;
  explanation: string;
};

export type AdminForensicsEvidenceRef = {
  id: string;
  source: string;
  label: string;
  nodeIds: string[];
  edgeIds: string[];
  pathIds: string[];
};

export type AdminForensicsGraph = {
  job: AdminForensicsJobSummary;
  subject: AdminForensicsAddressSummary;
  summary: AdminForensicsSummary;
  nodes: AdminForensicsNode[];
  edges: AdminForensicsEdge[];
  paths: AdminForensicsPath[];
  weights: AdminForensicsWeight[];
  limitations: AdminForensicsLimitation[];
  evidence: AdminForensicsEvidenceRef[];
};

export type AdminForensicsProjectionResult =
  | { ok: true; graph: AdminForensicsGraph }
  | { ok: false; status: "not_ready" | "unsupported" | "malformed"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function riskLevelFromScore(score: number | null): AdminForensicsRiskLevel | null {
  if (score === null) return null;
  if (score >= 85) return "CRITICAL";
  if (score >= 65) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

function confidenceFromNumber(value: number | null): AdminForensicsConfidence | null {
  if (value === null) return null;
  if (value >= 70) return "high";
  if (value >= 40) return "medium";
  return "low";
}

function decision(value: unknown): AdminForensicsDecision {
  return value === "ACCEPTABLE" || value === "REVIEW" || value === "DECLINE" ? value : "UNKNOWN";
}

function completedJobSummary(job: ForensicCheckJob): AdminForensicsJobSummary | null {
  if (job.status !== "completed" && job.status !== "partial" && job.status !== "failed") return null;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    subjectAddress: job.subjectAddress,
    windowStart: job.windowStart.toISOString(),
    windowEnd: job.windowEnd.toISOString(),
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
    requestedBy: job.requestedBy
  };
}

function nodeId(address: string): string {
  return `addr:${address}`;
}

function stopNodeId(pathIndex: number, reason: string): string {
  return `stop:${pathIndex}:${reason}`;
}

function bundleNodeId(pathIndex: number, bundleIndex: number): string {
  return `bundle:${pathIndex}:${bundleIndex}`;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  return arrayField(record, key).filter((value): value is string => typeof value === "string" && value.length > 0);
}

function recordArrayField(record: Record<string, unknown>, key: string): Record<string, unknown>[] {
  return arrayField(record, key).filter(isRecord);
}

function shareDetailMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const metadata: Record<string, unknown> = {};
  for (const key of [
    "scope",
    "targetAmountRaw",
    "affectedAmountRaw",
    "rawShare",
    "effectiveShare",
    "sourceSeverity",
    "valueWeightedRaw",
    "pathContextAdjustment",
    "repeatedExposureAdjustment",
    "dataQualityAdjustment",
    "walletRoleAdjustment",
    "shareFloor",
    "shareCap",
    "finalContribution"
  ]) {
    const item = value[key];
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      metadata[key] = item;
    }
  }
  return metadata;
}

function sourcePolicyEvidenceMetadata(evidence: Record<string, unknown>): Record<string, unknown> {
  const metadata = shareDetailMetadata(evidence["shareDetail"]);
  for (const key of ["aggregateShare", "effectiveShare", "pathCount", "score"]) {
    const value = numberField(evidence, key);
    if (value !== null) metadata[key] = value;
  }
  for (const key of ["kind", "proofLevel", "riskBand"]) {
    const value = stringField(evidence, key);
    if (value !== null) metadata[key] = value;
  }
  return metadata;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-6)}` : address;
}

function edgeVerdict(value: unknown): AdminForensicsEdge["verdict"] {
  if (value === "ACCEPTABLE" || value === "clean") return "clean";
  if (value === "REVIEW" || value === "review") return "review";
  if (value === "DECLINE" || value === "risk") return "risk";
  return "unknown";
}

function firstNumber(...values: Array<number | null>): number | null {
  return values.find((value): value is number => value !== null) ?? null;
}

function firstString(...values: Array<string | null>): string | null {
  return values.find((value): value is string => value !== null) ?? null;
}

function allocateRawByShare(amountRaw: string | null, share: number | null): string | null {
  if (!amountRaw || share === null || !Number.isFinite(share) || share <= 0) return null;
  if (!/^\d+$/.test(amountRaw)) return null;
  const scaledShare = BigInt(Math.round(Math.min(1, share) * 1_000_000));
  if (scaledShare <= 0n) return null;
  return ((BigInt(amountRaw) * scaledShare) / 1_000_000n).toString();
}

function rawBigInt(value: string | null): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function sumRaw(values: string[]): string | null {
  let total = 0n;
  let seen = false;
  values.forEach((value) => {
    const parsed = rawBigInt(value);
    if (parsed === null) return;
    total += parsed;
    seen = true;
  });
  return seen ? total.toString() : null;
}

function compareRawDesc(left: string, right: string): number {
  const leftRaw = rawBigInt(left) ?? 0n;
  const rightRaw = rawBigInt(right) ?? 0n;
  if (leftRaw === rightRaw) return 0;
  return leftRaw > rightRaw ? -1 : 1;
}

function bundleTopFundersFromMembers(members: Record<string, unknown>[]): {
  topFunders: Array<{ address: string; amountRaw: string; txHashes: string[]; memberCount: number }>;
  smallTailAmountRaw: string | null;
  smallTailCount: number;
  funderCount: number;
} {
  const grouped = new Map<string, { amountRaw: bigint; txHashes: string[]; memberCount: number }>();
  members.forEach((member) => {
    const address = stringField(member, "fromAddress");
    if (!address) return;
    const amountRaw = firstString(
      stringField(member, "usedAmountRaw"),
      stringField(member, "coveredAmountRaw"),
      stringField(member, "originalAmountRaw")
    );
    const parsed = rawBigInt(amountRaw);
    const current = grouped.get(address) ?? { amountRaw: 0n, txHashes: [], memberCount: 0 };
    if (parsed !== null) current.amountRaw += parsed;
    const txHash = stringField(member, "txHash");
    if (txHash && !current.txHashes.includes(txHash)) current.txHashes.push(txHash);
    current.memberCount += 1;
    grouped.set(address, current);
  });
  const funders = [...grouped.entries()]
    .map(([address, funder]) => ({
      address,
      amountRaw: funder.amountRaw.toString(),
      txHashes: funder.txHashes,
      memberCount: funder.memberCount
    }))
    .sort((left, right) => compareRawDesc(left.amountRaw, right.amountRaw));
  const topFunders = funders.slice(0, 3);
  const tail = funders.slice(3);
  return {
    topFunders,
    smallTailAmountRaw: sumRaw(tail.map((item) => item.amountRaw)),
    smallTailCount: tail.length,
    funderCount: funders.length
  };
}

function bundleTopFundersFromIncomingFunders(funders: Record<string, unknown>[]): {
  topFunders: Array<{ address: string; amountRaw: string; txHashes: string[]; memberCount: number }>;
  smallTailAmountRaw: string | null;
  smallTailCount: number;
  funderCount: number;
} {
  const allFunders = funders
    .map((funder) => ({
      address: stringField(funder, "address"),
      amountRaw: stringField(funder, "amountRaw"),
      txHashes: stringArrayField(funder, "txHashes")
    }))
    .filter((funder): funder is { address: string; amountRaw: string; txHashes: string[] } =>
      !!funder.address && !!funder.amountRaw)
    .map((funder) => ({ ...funder, memberCount: funder.txHashes.length }))
    .sort((left, right) => compareRawDesc(left.amountRaw, right.amountRaw));
  const topFunders = allFunders.slice(0, 3);
  const tail = allFunders.slice(3);
  return {
    topFunders,
    smallTailAmountRaw: sumRaw(tail.map((item) => item.amountRaw)),
    smallTailCount: tail.length,
    funderCount: allFunders.length
  };
}

function daysBetweenIso(left: string | null, right: string | null): number | null {
  if (!left || !right) return null;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null;
  return Math.abs(rightTime - leftTime) / 86_400_000;
}

function stopDisplaySemantics(reason: string | null): StopDisplaySemantics {
  switch (reason) {
    case "incoming_history_not_fetched":
      return {
        category: "data_quality",
        title: "History not fully fetched",
        canvasLabel: "History incomplete",
        meaning: "Fetched incoming history did not reach the required hop time, so source provenance remains unproven.",
        scoreLabel: "Path uncertainty penalty",
        scoreMeaning: "This is not wallet risk. It is a conservative path contribution because source provenance was not proven."
      };
    case "data_budget_exhausted":
      return {
        category: "data_quality",
        title: "Search budget exhausted",
        canvasLabel: "Budget stop",
        meaning: "The trace hit a configured search budget before reaching a terminal source.",
        scoreLabel: "Path uncertainty penalty",
        scoreMeaning: "This is not wallet risk. It is a conservative path contribution because source provenance was not proven."
      };
    case "no_previous_transfer":
      return {
        category: "continuity",
        title: "No prior inbound found",
        canvasLabel: "No prior input",
        meaning: "Fetched history reached the required time, but no earlier inbound USDT transfer was found for this hop.",
        scoreLabel: "Continuity penalty",
        scoreMeaning: "Prior transfer evidence was absent or did not meet amount/time continuity."
      };
    case "no_incoming_transfers_seen":
      return {
        category: "continuity",
        title: "No previous incoming",
        canvasLabel: "No incoming",
        meaning: "Fetched history reached the required time and no inbound USDT transfers were seen.",
        scoreLabel: "Continuity penalty",
        scoreMeaning: "Prior transfer evidence was absent or did not meet amount/time continuity."
      };
    case "incoming_seen_but_below_continuity":
      return {
        category: "continuity",
        title: "Prior inputs do not match",
        canvasLabel: "Inputs mismatch",
        meaning: "Prior inbound transfers exist, but none match amount/time continuity thresholds.",
        scoreLabel: "Continuity penalty",
        scoreMeaning: "Prior transfer evidence was absent or did not meet amount/time continuity."
      };
    case "weak_amount_or_time_continuity":
      return {
        category: "continuity",
        title: "Weak continuity",
        canvasLabel: "Weak continuity",
        meaning: "A possible connection exists, but amount or time continuity is too weak to prove provenance.",
        scoreLabel: "Continuity penalty",
        scoreMeaning: "Prior transfer evidence was absent or did not meet amount/time continuity."
      };
    case "unlabeled_service_boundary":
    case "service_boundary":
      return {
        category: "service_boundary",
        title: "Service boundary",
        canvasLabel: "Service boundary",
        meaning: "The trace reached a service or contract boundary where normal wallet-to-wallet provenance should stop.",
        scoreLabel: "Boundary contribution",
        scoreMeaning: "This contribution is scoped to the reached service boundary."
      };
    case "allowlist_cex_reached":
      return {
        category: "terminal_boundary",
        title: "Allowlisted CEX reached",
        canvasLabel: "Allowlisted CEX",
        meaning: "The trace reached a known allowlisted centralized exchange source.",
        scoreLabel: "Boundary contribution",
        scoreMeaning: "This contribution is scoped to the reached terminal boundary."
      };
    case "decline_boundary_reached":
      return {
        category: "terminal_boundary",
        title: "Decline boundary reached",
        canvasLabel: "Risk boundary",
        meaning: "The trace reached a policy boundary that can raise risk.",
        scoreLabel: "Boundary contribution",
        scoreMeaning: "This contribution is scoped to the reached terminal boundary."
      };
    case "risky_label_reached":
    case "risky_source_wallet":
      return {
        category: "terminal_boundary",
        title: "Risky label reached",
        canvasLabel: "Risky label",
        meaning: "The trace reached a known risky label.",
        scoreLabel: "Boundary contribution",
        scoreMeaning: "This contribution is scoped to the reached terminal boundary."
      };
    default:
      return {
        category: "unknown",
        title: reason ? reason.replace(/_/g, " ") : "Trace stop",
        canvasLabel: "Trace stop",
        meaning: "The trace stopped before reaching a complete provenance source.",
        scoreLabel: "Path contribution",
        scoreMeaning: "This contribution belongs to the stopped path, not to a wallet by itself."
      };
  }
}

function stopDiagnostics(input: {
  path: Record<string, unknown>;
  pathId: string;
  stopReason: string;
  riskContribution: number;
}): Record<string, unknown> {
  const historyCoverage = recordArrayField(input.path, "historyCoverage");
  const latestCoverage = historyCoverage[historyCoverage.length - 1] ?? null;
  const totalFetchedTransferCount = historyCoverage.reduce((sum, coverage) =>
    sum + (numberField(coverage, "fetchedTransferCount") ?? 0), 0);
  const totalFetchedPageCount = historyCoverage.reduce((sum, coverage) =>
    sum + (numberField(coverage, "fetchedPageCount") ?? 0), 0);
  const targetTimestamp = latestCoverage ? stringField(latestCoverage, "targetTimestamp") : null;
  const oldestFetchedTransferAt = latestCoverage ? stringField(latestCoverage, "oldestFetchedTransferAt") : null;
  return {
    stopReason: input.stopReason,
    pathId: input.pathId,
    riskContribution: input.riskContribution,
    reason: stringArrayField(input.path, "reasons")[0] ?? null,
    timeSpanMs: numberField(input.path, "timeSpanMs"),
    amountPreservationRatio: numberField(input.path, "amountPreservationRatio"),
    historyCoverage,
    historyCoverageCount: historyCoverage.length,
    totalFetchedTransferCount,
    hadIncomingTransfers: totalFetchedTransferCount > 0,
    reachedTargetHop: latestCoverage ? latestCoverage["reachedTargetHop"] === true : null,
    targetTimestamp,
    oldestFetchedTransferAt,
    historyDaysChecked: daysBetweenIso(oldestFetchedTransferAt, targetTimestamp),
    historySource: latestCoverage ? stringField(latestCoverage, "source") : null,
    pagesChecked: historyCoverage.length > 0 ? totalFetchedPageCount : null,
    rejectedCandidates: recordArrayField(input.path, "rejectedCandidates").slice(0, 5)
  };
}

function transferBaseLookupKey(txHash: string | null, fromAddress: string | null, toAddress: string | null): string | null {
  return txHash && fromAddress && toAddress ? `${txHash}\u0000${fromAddress}\u0000${toAddress}` : null;
}

function transferAmountLookupKey(
  txHash: string | null,
  fromAddress: string | null,
  toAddress: string | null,
  amountRaw: string | null
): string | null {
  const baseKey = transferBaseLookupKey(txHash, fromAddress, toAddress);
  return baseKey && amountRaw ? `${baseKey}\u0000${amountRaw}` : null;
}

function transferAmountTimestampLookupKey(
  txHash: string | null,
  fromAddress: string | null,
  toAddress: string | null,
  amountRaw: string | null,
  timestamp: string | null
): string | null {
  const amountKey = transferAmountLookupKey(txHash, fromAddress, toAddress, amountRaw);
  return amountKey && timestamp ? `${amountKey}\u0000${timestamp}` : null;
}

function whereIsMoneyResultFromJob(job: ForensicCheckJob): Record<string, unknown> | null {
  if (!isRecord(job.resultJson)) return null;
  const nested = job.resultJson["whereIsMoneyReport"];
  return isRecord(nested) ? nested : job.resultJson;
}

function evidenceRefs(
  allEvidenceIds: string[],
  paths: AdminForensicsPath[],
  edges: AdminForensicsEdge[]
): AdminForensicsEvidenceRef[] {
  const refs = new Map<string, AdminForensicsEvidenceRef>();
  const ensureRef = (id: string): AdminForensicsEvidenceRef => {
    const existing = refs.get(id);
    if (existing) return existing;
    const ref = {
      id,
      source: "raw_evidence",
      label: id,
      nodeIds: [],
      edgeIds: [],
      pathIds: []
    };
    refs.set(id, ref);
    return ref;
  };
  const appendUnique = (target: string[], values: string[]): void => {
    values.forEach((value) => {
      if (!target.includes(value)) target.push(value);
    });
  };

  allEvidenceIds.forEach((id) => ensureRef(id));
  paths.forEach((path) => {
    path.evidenceIds.forEach((evidenceId) => {
      const ref = ensureRef(evidenceId);
      appendUnique(ref.pathIds, [path.id]);
      appendUnique(ref.nodeIds, path.nodeIds);
      appendUnique(ref.edgeIds, path.edgeIds);
    });
  });
  edges.forEach((edge) => {
    edge.evidenceIds.forEach((evidenceId) => {
      const ref = ensureRef(evidenceId);
      appendUnique(ref.edgeIds, [edge.id]);
      appendUnique(ref.nodeIds, [edge.fromNodeId, edge.toNodeId]);
    });
  });

  return Array.from(refs.values());
}

function edgeTimestampMs(edge: AdminForensicsEdge): number | null {
  if (!edge.timestamp) return null;
  const value = new Date(edge.timestamp).getTime();
  return Number.isFinite(value) ? value : null;
}

function appendUniqueValue<T>(values: T[], value: T): void {
  if (!values.includes(value)) values.push(value);
}

function addRaw(map: Map<string, bigint>, nodeId: string, amountRaw: string | null): void {
  const parsed = rawBigInt(amountRaw);
  if (parsed === null) return;
  map.set(nodeId, (map.get(nodeId) ?? 0n) + parsed);
}

function textMarker(...values: unknown[]): string {
  return values
    .filter((value) => value !== null && value !== undefined && String(value).length > 0)
    .map((value) => String(value).toLowerCase())
    .join(" ");
}

function nodeDisplayKind(node: AdminForensicsNode): AdminForensicsNodeDisplayKind {
  const marker = textMarker(
    node.kind,
    node.label,
    node.metadata.category,
    node.metadata.serviceCategory,
    node.metadata.serviceType,
    node.metadata.identity,
    node.metadata.sourceExposureKind,
    node.metadata.exposureSourceKey,
    node.metadata.rootSourceType,
    node.metadata.source,
    node.metadata.stopReasons
  );

  if (node.kind === "subject") return "subject_wallet";
  if (node.kind === "bundle") return "funding_bundle";
  if (node.kind === "stop") return "trace_stop";
  if (Array.isArray(node.metadata.stopReasons) && node.metadata.stopReasons.length > 0) return "service_boundary";
  if (marker.includes("bridge")) return "bridge";
  if (marker.includes("cex") || marker.includes("exchange")) return "cex";
  if (marker.includes("adapter")) return "contract_adapter";
  if (marker.includes("router")) return "contract_router";
  if (marker.includes("dex")) return "dex_contract";
  if (marker.includes("contract")) return "smart_contract";
  if (node.kind === "service") return "service_boundary";
  if (node.kind === "contract") return "smart_contract";
  return "wallet";
}

function nodeDisplayLabel(node: AdminForensicsNode): string {
  if (node.kind === "stop") {
    return firstString(
      stringField(node.metadata, "stopCanvasLabel"),
      stringField(node.metadata, "stopTitle"),
      node.label
    ) ?? node.id;
  }
  return firstString(
    stringField(node.metadata, "identity"),
    stringField(node.metadata, "exposureSourceLabel"),
    node.label,
    node.address
  ) ?? node.id;
}

function rawString(value: unknown): string | null {
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function hasPartialAllocation(edge: AdminForensicsEdge): boolean {
  const original = rawString(edge.metadata.originalAmountRaw);
  const used = rawString(edge.metadata.usedAmountRaw);
  return original !== null && used !== null && original !== used;
}

function edgeDisplayRole(edge: AdminForensicsEdge, jobKind: ForensicCheckJob["kind"]): AdminForensicsEdgeDisplayRole {
  if (edge.type === "stop") return "stop";
  if (
    jobKind === "address_deep_check" &&
    (
      edge.metadata.source === "directCounterpartyInteractionProfile" ||
      String(edge.metadata.pathId ?? "").startsWith("path:direct_counterparty:")
    )
  ) {
    return "profile_context";
  }
  if (hasPartialAllocation(edge)) return "allocated_transfer";
  if (edge.type === "inferred_provenance") return "inferred_provenance";
  return "real_transfer";
}

function lastRealEdgeForPath(edgeIds: string[], edges: AdminForensicsEdge[]): AdminForensicsEdge | null {
  for (let index = edgeIds.length - 1; index >= 0; index -= 1) {
    const edge = edges.find((item) => item.id === edgeIds[index]);
    if (edge && edge.type !== "stop") return edge;
  }
  return null;
}

function stopDisplayMetadata(input: {
  reason: string;
  pathId: string;
  diagnostics: Record<string, unknown>;
  lastRealEdge: AdminForensicsEdge | null;
}): Record<string, unknown> {
  const semantics = stopDisplaySemantics(input.reason);
  return {
    reason: input.reason,
    pathId: input.pathId,
    stopDetails: [input.diagnostics],
    stopCategory: semantics.category,
    stopTitle: semantics.title,
    stopCanvasLabel: semantics.canvasLabel,
    stopMeaning: semantics.meaning,
    scoreLabel: semantics.scoreLabel,
    scoreMeaning: semantics.scoreMeaning,
    stopAmountLabel: "not a transfer",
    lastRealEdgeId: input.lastRealEdge?.id ?? null,
    lastRealHopAmountRaw: input.lastRealEdge?.amountRaw ?? null,
    lastRealHopTimestamp: input.lastRealEdge?.timestamp ?? null,
    lastRealHopTxHash: input.lastRealEdge?.txHash ?? null
  };
}

function annotateGraphDerivedMetrics(
  nodesById: Map<string, AdminForensicsNode>,
  edges: AdminForensicsEdge[],
  paths: AdminForensicsPath[],
  weights: AdminForensicsWeight[],
  jobKind: ForensicCheckJob["kind"]
): void {
  const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
  const relatedEdgeIdsByNode = new Map<string, string[]>();
  const relatedPathIdsByNode = new Map<string, string[]>();
  const relatedWeightsByNode = new Map<string, AdminForensicsWeight[]>();
  const incomingRawByNode = new Map<string, bigint>();
  const outgoingRawByNode = new Map<string, bigint>();
  const maxRiskByNode = new Map<string, number>();

  edges.forEach((edge) => {
    edge.displayRole = edgeDisplayRole(edge, jobKind);
  });

  const bumpRisk = (nodeId: string | null | undefined, score: number | null | undefined): void => {
    if (!nodeId || score === null || score === undefined || !Number.isFinite(score)) return;
    maxRiskByNode.set(nodeId, Math.max(maxRiskByNode.get(nodeId) ?? 0, score));
  };

  const appendRelatedEdge = (nodeId: string, edgeId: string): void => {
    const related = relatedEdgeIdsByNode.get(nodeId) ?? [];
    appendUniqueValue(related, edgeId);
    relatedEdgeIdsByNode.set(nodeId, related);
  };

  const appendRelatedPath = (nodeId: string, pathId: string): void => {
    const related = relatedPathIdsByNode.get(nodeId) ?? [];
    appendUniqueValue(related, pathId);
    relatedPathIdsByNode.set(nodeId, related);
  };

  edges.forEach((edge) => {
    appendRelatedEdge(edge.fromNodeId, edge.id);
    appendRelatedEdge(edge.toNodeId, edge.id);
    addRaw(outgoingRawByNode, edge.fromNodeId, edge.amountRaw);
    addRaw(incomingRawByNode, edge.toNodeId, edge.amountRaw);
    bumpRisk(edge.fromNodeId, edge.weight);
    bumpRisk(edge.toNodeId, edge.weight);
  });

  paths.forEach((path) => {
    let previousTimestampMs: number | null = null;
    let firstTimestampMs: number | null = null;
    let lastTimestampMs: number | null = null;
    path.nodeIds.forEach((nodeId) => {
      appendRelatedPath(nodeId, path.id);
      bumpRisk(nodeId, path.riskContribution);
    });
    path.edgeIds.forEach((edgeId) => {
      const edge = edgesById.get(edgeId);
      if (!edge) return;
      appendRelatedPath(edge.fromNodeId, path.id);
      appendRelatedPath(edge.toNodeId, path.id);
      bumpRisk(edge.fromNodeId, path.riskContribution);
      bumpRisk(edge.toNodeId, path.riskContribution);
      const timestampMs = edgeTimestampMs(edge);
      if (timestampMs === null) return;
      edge.metadata = {
        ...edge.metadata,
        txGapMs: previousTimestampMs === null ? null : Math.abs(timestampMs - previousTimestampMs)
      };
      previousTimestampMs = timestampMs;
      firstTimestampMs = firstTimestampMs === null ? timestampMs : Math.min(firstTimestampMs, timestampMs);
      lastTimestampMs = lastTimestampMs === null ? timestampMs : Math.max(lastTimestampMs, timestampMs);
    });
    path.timeSpanMs = firstTimestampMs !== null && lastTimestampMs !== null
      ? Math.abs(lastTimestampMs - firstTimestampMs)
      : null;
  });

  weights.forEach((weight) => {
    const nodeIds = new Set<string>();
    if (weight.nodeId) nodeIds.add(weight.nodeId);
    if (weight.edgeId) {
      const edge = edgesById.get(weight.edgeId);
      if (edge) {
        nodeIds.add(edge.fromNodeId);
        nodeIds.add(edge.toNodeId);
      }
    }
    if (weight.pathId) {
      paths.find((path) => path.id === weight.pathId)?.nodeIds.forEach((nodeId) => nodeIds.add(nodeId));
    }
    nodeIds.forEach((nodeId) => {
      const related = relatedWeightsByNode.get(nodeId) ?? [];
      related.push(weight);
      relatedWeightsByNode.set(nodeId, related);
      bumpRisk(nodeId, weight.value);
    });
  });

  nodesById.forEach((node, nodeId) => {
    const maxRisk = maxRiskByNode.get(nodeId);
    const incoming = incomingRawByNode.get(nodeId);
    const outgoing = outgoingRawByNode.get(nodeId);
    const relatedEdgeIds = relatedEdgeIdsByNode.get(nodeId) ?? [];
    const relatedPathIds = relatedPathIdsByNode.get(nodeId) ?? [];
    const relatedWeights = relatedWeightsByNode.get(nodeId) ?? [];
    if (node.kind !== "subject" && node.kind !== "stop" && maxRisk !== undefined) {
      node.weight = maxRisk;
      node.riskLevel = riskLevelFromScore(maxRisk);
    }
    node.metadata = {
      ...node.metadata,
      ...(relatedEdgeIds.length > 0 ? { relatedEdgeIds } : {}),
      ...(relatedPathIds.length > 0 ? { relatedPathIds } : {}),
      ...(relatedWeights.length > 0 ? { relatedWeights } : {}),
      ...(incoming !== undefined ? { incomingAmountRaw: incoming.toString() } : {}),
      ...(outgoing !== undefined ? { outgoingAmountRaw: outgoing.toString() } : {})
    };
    node.displayKind = nodeDisplayKind(node);
    node.displayLabel = nodeDisplayLabel(node);
  });
}

function projectWhereIsMoneyJob(
  job: ForensicCheckJob,
  summary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  const topLevelResult = isRecord(job.resultJson) ? job.resultJson : null;
  const result = whereIsMoneyResultFromJob(job);
  if (!result) {
    return {
      ok: false,
      status: "malformed",
      message: "Forensic graph cannot be projected from malformed job result JSON."
    };
  }

  const assessment = isRecord(result["assessment"]) ? result["assessment"] : {};
  const coverage = isRecord(result["coverage"]) ? result["coverage"] : {};
  const subjectAddress = stringField(result, "subjectAddress") ?? (topLevelResult ? stringField(topLevelResult, "subjectAddress") : null) ?? job.subjectAddress;
  const riskScore = firstNumber(numberField(result, "riskScore"), numberField(assessment, "riskScore"));
  const confidence = confidenceFromNumber(firstNumber(
    numberField(assessment, "provenanceConfidence"),
    numberField(result, "provenanceConfidence")
  ));
  const coverageRatio = firstNumber(
    numberField(coverage, "coverageRatio"),
    numberField(coverage, "currentBalanceCoverageRatio")
  );
  const originPaths = recordArrayField(result, "originPaths");
  const evidenceIds = job.rawEvidenceIds;

  const nodesById = new Map<string, AdminForensicsNode>();
  const edges: AdminForensicsEdge[] = [];
  const paths: AdminForensicsPath[] = [];
  const weights: AdminForensicsWeight[] = [];
  const limitations: AdminForensicsLimitation[] = [];

  const upsertAddressNode = (
    address: string,
    kind: AdminForensicsNode["kind"],
    metadata: Record<string, unknown> = {}
  ): string => {
    const id = nodeId(address);
    const existing = nodesById.get(id);
    if (existing) {
      if (existing.kind !== "subject" && kind === "subject") existing.kind = "subject";
      existing.metadata = { ...existing.metadata, ...metadata };
      return id;
    }
    nodesById.set(id, {
      id,
      address,
      kind,
      label: shortAddress(address),
      riskLevel: kind === "subject" ? riskLevelFromScore(riskScore) : null,
      confidence: kind === "subject" ? confidence : null,
      weight: null,
      metadata
    });
    return id;
  };

  const subjectNodeId = upsertAddressNode(subjectAddress, "subject");

  originPaths.forEach((item, pathIndex) => {
    const pathId = `path:${pathIndex}`;
    const pathEvidenceIds = stringArrayField(item, "evidenceIds");
    const steps = recordArrayField(item, "steps");
    const addresses = stringArrayField(item, "addresses");
    const pathAddresses = stringArrayField(item, "pathAddresses");
    const rootSourceAddress = stringField(item, "rootSourceAddress");
    const addressChain = addresses.length > 0
      ? addresses
      : pathAddresses.length > 0
        ? pathAddresses
        : [
            ...(rootSourceAddress ? [rootSourceAddress] : []),
            ...steps.flatMap((step) => [
              stringField(step, "fromAddress"),
              stringField(step, "toAddress")
            ]).filter((address): address is string => address !== null)
          ];
    const uniqueAddressChain = Array.from(new Set(addressChain.length > 0 ? addressChain : [subjectAddress]));
    const pathNodeIds = uniqueAddressChain.map((address) =>
      upsertAddressNode(address, address === subjectAddress ? "subject" : "wallet")
    );
    const txHashes = stringArrayField(item, "txHashes");
    const pathEdgeIds: string[] = [];
    const amountRaw = firstString(stringField(item, "amountRaw"), stringField(item, "selectedAmountRaw"));
    const amountShare = firstNumber(numberField(item, "balanceShare"), numberField(item, "amountShare"));
    const pathAllocatedAmountRaw = firstString(
      stringField(item, "usedAmountRaw"),
      stringField(item, "selectedAmountRaw"),
      allocateRawByShare(firstString(stringField(coverage, "selectedAmountRaw"), stringField(coverage, "targetAmountRaw")), amountShare)
    );
    const verdict = decision(item["verdict"]);
    const riskContribution = numberField(item, "riskScoreContribution") ?? 0;
    const fundingBundles = recordArrayField(item, "fundingBundles");
    const fundingBundleByHopTxHash = new Map<string, Record<string, unknown>>();
    const fundingBundleMembersByAmountTimestampKey = new Map<string, Record<string, unknown>[]>();
    const fundingBundleMembersByAmountKey = new Map<string, Record<string, unknown>[]>();
    const fundingBundleMembersByBaseKey = new Map<string, Record<string, unknown>[]>();
    const fundingBundleMembersByTxHash = new Map<string, Record<string, unknown>[]>();
    const bundleNodeIds: string[] = [];
    const appendMember = (
      map: Map<string, Record<string, unknown>[]>,
      key: string | null,
      member: Record<string, unknown>
    ): void => {
      if (!key) return;
      const members = map.get(key) ?? [];
      members.push(member);
      map.set(key, members);
    };
    const singleMember = (members: Record<string, unknown>[] | undefined): Record<string, unknown> | undefined =>
      members?.length === 1 ? members[0] : undefined;
    fundingBundles.forEach((bundle) => {
      const hopTxHash = stringField(bundle, "hopTxHash");
      if (hopTxHash) fundingBundleByHopTxHash.set(hopTxHash, bundle);
      recordArrayField(bundle, "members").forEach((member) => {
        const memberTxHash = stringField(member, "txHash");
        const memberFromAddress = stringField(member, "fromAddress");
        const memberToAddress = stringField(member, "toAddress");
        const memberUsedAmountRaw = firstString(stringField(member, "usedAmountRaw"), stringField(member, "coveredAmountRaw"));
        const memberTimestamp = stringField(member, "timestamp");
        appendMember(
          fundingBundleMembersByAmountTimestampKey,
          transferAmountTimestampLookupKey(memberTxHash, memberFromAddress, memberToAddress, memberUsedAmountRaw, memberTimestamp),
          member
        );
        appendMember(
          fundingBundleMembersByAmountKey,
          transferAmountLookupKey(memberTxHash, memberFromAddress, memberToAddress, memberUsedAmountRaw),
          member
        );
        appendMember(
          fundingBundleMembersByBaseKey,
          transferBaseLookupKey(memberTxHash, memberFromAddress, memberToAddress),
          member
        );
        if (memberTxHash) {
          const members = fundingBundleMembersByTxHash.get(memberTxHash) ?? [];
          members.push(member);
          fundingBundleMembersByTxHash.set(memberTxHash, members);
        }
      });
    });

    if (fundingBundles.length > 0) {
      limitations.push({
        code: "multi_input_bundle_used",
        label: "Multi-input bundle used",
        severity: "info",
        pathId,
        explanation: "This path used multiple inbound transfers to explain one outgoing hop."
      });
      fundingBundles.forEach((bundle, bundleIndex) => {
        const members = recordArrayField(bundle, "members");
        const funderSummary = bundleTopFundersFromMembers(members);
        const bundleId = bundleNodeId(pathIndex, bundleIndex);
        const hopAddress = stringField(bundle, "hopAddress");
        const hopNodeId = hopAddress
          ? upsertAddressNode(hopAddress, hopAddress === subjectAddress ? "subject" : "wallet")
          : pathNodeIds[pathNodeIds.length - 1] ?? subjectNodeId;
        const hopTxHash = stringField(bundle, "hopTxHash");
        const expectedAmountRaw = stringField(bundle, "expectedAmountRaw");
        const coveredAmountRaw = stringField(bundle, "coveredAmountRaw");
        const relatedEdgeIds: string[] = [];

        funderSummary.topFunders.forEach((funder, funderIndex) => {
          const funderNodeId = upsertAddressNode(funder.address, funder.address === subjectAddress ? "subject" : "wallet");
          const edgeId = `edge:${pathIndex}:bundle:${bundleIndex}:funder:${funderIndex}`;
          edges.push({
            id: edgeId,
            fromNodeId: funderNodeId,
            toNodeId: bundleId,
            type: "inferred_provenance",
            amountRaw: funder.amountRaw,
            amountShare: null,
            txHash: null,
            timestamp: null,
            weight: riskContribution,
            verdict: "review",
            evidenceIds: pathEvidenceIds,
            metadata: {
              pathId,
              bundleIndex,
              bundleNodeId: bundleId,
              bundleRole: "top_funder",
              txHashes: funder.txHashes,
              memberCount: funder.memberCount,
              originalAmountRaw: funder.amountRaw,
              usedAmountRaw: funder.amountRaw,
              anchorAmountRaw: expectedAmountRaw,
              amountRole: "bundle_top_funder"
            }
          });
          relatedEdgeIds.push(edgeId);
        });

        const bundleHopEdgeId = `edge:${pathIndex}:bundle:${bundleIndex}:hop`;
        edges.push({
          id: bundleHopEdgeId,
          fromNodeId: bundleId,
          toNodeId: hopNodeId,
          type: "inferred_provenance",
          amountRaw: coveredAmountRaw ?? expectedAmountRaw,
          amountShare: numberField(bundle, "coverageRatio"),
          txHash: null,
          timestamp: null,
          weight: riskContribution,
          verdict: "review",
          evidenceIds: pathEvidenceIds,
          metadata: {
            pathId,
            bundleIndex,
            bundleNodeId: bundleId,
            bundleRole: "bundle_to_hop",
            hopTxHash,
            originalAmountRaw: sumRaw(members.map((member) => firstString(
              stringField(member, "originalAmountRaw"),
              stringField(member, "usedAmountRaw"),
              stringField(member, "coveredAmountRaw")
            )).filter((value): value is string => value !== null)),
            usedAmountRaw: coveredAmountRaw,
            anchorAmountRaw: expectedAmountRaw,
            amountRole: "bundle_coverage"
          }
        });
        relatedEdgeIds.push(bundleHopEdgeId);

        nodesById.set(bundleId, {
          id: bundleId,
          address: null,
          kind: "bundle",
          label: "Funding bundle",
          riskLevel: riskLevelFromScore(riskContribution),
          confidence: null,
          weight: riskContribution,
          metadata: {
            pathId,
            relatedPathIds: [pathId],
            relatedEdgeIds,
            bundleIndex,
            bundleKind: "money_origin_funding_bundle",
            hopTxHash,
            hopAddress,
            expectedAmountRaw,
            coveredAmountRaw,
            coverageRatio: numberField(bundle, "coverageRatio"),
            memberCount: members.length,
            funderCount: funderSummary.funderCount,
            topFunders: funderSummary.topFunders,
            smallTailAmountRaw: funderSummary.smallTailAmountRaw,
            smallTailCount: funderSummary.smallTailCount
          }
        });
        bundleNodeIds.push(bundleId);
      });
    }

    if (steps.length > 0) {
      steps.forEach((step, stepIndex) => {
        const fromAddress = stringField(step, "fromAddress");
        const toAddress = stringField(step, "toAddress");
        if (!fromAddress || !toAddress) return;
        const fromNodeId = upsertAddressNode(fromAddress, fromAddress === subjectAddress ? "subject" : "wallet");
        const toNodeId = upsertAddressNode(toAddress, toAddress === subjectAddress ? "subject" : "wallet");
        const edgeId = `edge:${pathIndex}:${stepIndex}`;
        const stepTxHash = stringField(step, "txHash") ?? txHashes[stepIndex] ?? null;
        const stepAmountRaw = stringField(step, "amountRaw") ?? amountRaw;
        const stepTimestamp = stringField(step, "timestamp");
        const amountUsage = isRecord(step["amountUsage"]) ? step["amountUsage"] : {};
        const fundingBundle = stepTxHash ? fundingBundleByHopTxHash.get(stepTxHash) : undefined;
        const stepAmountTimestampLookupKey = transferAmountTimestampLookupKey(stepTxHash, fromAddress, toAddress, stepAmountRaw, stepTimestamp);
        const stepAmountLookupKey = transferAmountLookupKey(stepTxHash, fromAddress, toAddress, stepAmountRaw);
        const stepBaseLookupKey = transferBaseLookupKey(stepTxHash, fromAddress, toAddress);
        const fundingBundleMember = singleMember(stepAmountTimestampLookupKey
          ? fundingBundleMembersByAmountTimestampKey.get(stepAmountTimestampLookupKey)
          : undefined)
          ?? singleMember(stepAmountLookupKey ? fundingBundleMembersByAmountKey.get(stepAmountLookupKey) : undefined)
          ?? singleMember(stepBaseLookupKey ? fundingBundleMembersByBaseKey.get(stepBaseLookupKey) : undefined)
          ?? (stepTxHash && fundingBundleMembersByTxHash.get(stepTxHash)?.length === 1
            ? fundingBundleMembersByTxHash.get(stepTxHash)?.[0]
            : undefined);
        edges.push({
          id: edgeId,
          fromNodeId,
          toNodeId,
          type: "transfer",
          amountRaw: stepAmountRaw,
          amountShare,
          txHash: stepTxHash,
          timestamp: stepTimestamp,
          weight: riskContribution,
          verdict: edgeVerdict(item["verdict"]),
          evidenceIds: pathEvidenceIds,
          metadata: {
            pathId,
            originalAmountRaw: stringField(amountUsage, "originalAmountRaw") ?? (fundingBundleMember ? stringField(fundingBundleMember, "originalAmountRaw") : null) ?? stepAmountRaw,
            usedAmountRaw: stringField(amountUsage, "usedAmountRaw")
              ?? (fundingBundleMember ? firstString(stringField(fundingBundleMember, "usedAmountRaw"), stringField(fundingBundleMember, "coveredAmountRaw")) : null)
              ?? (fundingBundle ? stringField(fundingBundle, "coveredAmountRaw") : null)
              ?? pathAllocatedAmountRaw
              ?? stepAmountRaw,
            anchorAmountRaw: stringField(amountUsage, "anchorAmountRaw")
              ?? (fundingBundleMember ? firstString(stringField(fundingBundleMember, "anchorAmountRaw"), stringField(fundingBundleMember, "expectedAmountRaw"), stringField(fundingBundleMember, "coveredAmountRaw")) : null)
              ?? (fundingBundle ? stringField(fundingBundle, "expectedAmountRaw") : null)
              ?? stringField(coverage, "targetAmountRaw"),
            amountRole: stringField(amountUsage, "role") ?? "funding_candidate"
          }
        });
        pathEdgeIds.push(edgeId);
      });
    } else {
      for (let index = 0; index < uniqueAddressChain.length - 1; index += 1) {
        const edgeId = `edge:${pathIndex}:${index}`;
        const fallbackOriginalAmountRaw = stringField(item, "originalAmountRaw") ?? amountRaw;
        const fallbackUsedAmountRaw = pathAllocatedAmountRaw ?? amountRaw;
        const fallbackAnchorAmountRaw = stringField(item, "anchorAmountRaw") ?? stringField(coverage, "targetAmountRaw");
        edges.push({
          id: edgeId,
          fromNodeId: nodeId(uniqueAddressChain[index]),
          toNodeId: nodeId(uniqueAddressChain[index + 1]),
          type: "transfer",
          amountRaw,
          amountShare,
          txHash: txHashes[index] ?? null,
          timestamp: null,
          weight: riskContribution,
          verdict: edgeVerdict(item["verdict"]),
          evidenceIds: pathEvidenceIds,
          metadata: {
            pathId,
            originalAmountRaw: fallbackOriginalAmountRaw,
            usedAmountRaw: fallbackUsedAmountRaw,
            anchorAmountRaw: fallbackAnchorAmountRaw,
            amountRole: stringField(item, "amountRole") ?? "funding_candidate"
          }
        });
        pathEdgeIds.push(edgeId);
      }
    }

    const stoppedReason = stringField(item, "stoppedReason");
    let stoppedAtNodeId: string | null = null;
    let stopReasonLabel: string | null = null;
    let stopCategory: AdminForensicsStopCategory | null = null;
    let lastRealEdgeId: string | null = null;
    if (stoppedReason) {
      const diagnostics = stopDiagnostics({ path: item, pathId, stopReason: stoppedReason, riskContribution });
      const lastRealEdge = lastRealEdgeForPath(pathEdgeIds, edges);
      const stopMetadata = stopDisplayMetadata({
        reason: stoppedReason,
        pathId,
        diagnostics,
        lastRealEdge
      });
      const stopSemantics = stopDisplaySemantics(stoppedReason);
      stopReasonLabel = stopSemantics.title;
      stopCategory = stopSemantics.category;
      lastRealEdgeId = lastRealEdge?.id ?? null;
      stoppedAtNodeId = stopNodeId(pathIndex, stoppedReason);
      nodesById.set(stoppedAtNodeId, {
        id: stoppedAtNodeId,
        address: null,
        kind: "stop",
        label: stoppedReason,
        riskLevel: riskLevelFromScore(riskContribution),
        confidence: null,
        weight: riskContribution,
        metadata: stopMetadata
      });
      const priorNodeId = pathNodeIds[pathNodeIds.length - 1] ?? subjectNodeId;
      const edgeId = `edge:${pathIndex}:stop`;
      edges.push({
        id: edgeId,
        fromNodeId: priorNodeId,
        toNodeId: stoppedAtNodeId,
        type: "stop",
        amountRaw: null,
        amountShare: null,
        txHash: null,
        timestamp: null,
        weight: riskContribution,
        verdict: edgeVerdict(item["verdict"]),
        evidenceIds: pathEvidenceIds,
        metadata: stopMetadata
      });
      pathEdgeIds.push(edgeId);
      limitations.push({
        code: stoppedReason,
        label: stopSemantics.title,
        severity: verdict === "DECLINE" ? "blocking" : "review",
        pathId,
        explanation: `Origin path stopped at ${stoppedReason}; fetched ${diagnostics.totalFetchedTransferCount} prior transfer(s), history source ${diagnostics.historySource ?? "n/a"}.`
      });
      if (stoppedReason === "no_previous_transfer") {
        limitations.push({
          code: "legacy_no_previous_transfer",
          label: "Legacy no_previous_transfer stop",
          severity: "review",
          pathId,
          explanation: "Old reports used no_previous_transfer for several conditions. Rerun recommended for precise stop classification."
        });
        if (diagnostics.hadIncomingTransfers === true) {
          limitations.push({
            code: "previous_transfers_found_but_not_matching",
            label: "Previous transfers found but not matching",
            severity: "review",
            pathId,
            explanation: `Prior incoming transfers were found (${diagnostics.totalFetchedTransferCount}), but none met the amount/time continuity threshold.`
          });
        }
      }
      if (stoppedReason === "incoming_seen_but_below_continuity") {
        limitations.push({
          code: "previous_transfers_found_but_not_matching",
          label: "Previous transfers found but not matching",
          severity: "review",
          pathId,
          explanation: `Prior incoming transfers were found (${diagnostics.totalFetchedTransferCount}), but none met the amount/time continuity threshold.`
        });
      }
    }

    weights.push({
      id: `weight:${pathIndex}:risk`,
      source: "origin_path",
      label: "Path risk contribution",
      value: riskContribution,
      direction: riskContribution > 0 ? "raises_risk" : "context",
      pathId,
      nodeId: stoppedAtNodeId,
      edgeId: pathEdgeIds[0] ?? null,
      explanation: stringArrayField(item, "reasons")[0] ?? "Origin path risk contribution.",
      metadata: {}
    });
    paths.push({
      id: pathId,
      nodeIds: stoppedAtNodeId ? [...pathNodeIds, ...bundleNodeIds, stoppedAtNodeId] : [...pathNodeIds, ...bundleNodeIds],
      edgeIds: pathEdgeIds,
      verdict,
      riskContribution,
      amountRaw,
      amountShare,
      stoppedAtNodeId,
      stopReason: stoppedReason,
      stopReasonLabel,
      stopCategory,
      lastRealEdgeId,
      evidenceIds: pathEvidenceIds
    });
  });

  recordArrayField(assessment, "sourcePolicyEvidence").forEach((evidence, index) => {
    const score = numberField(evidence, "score") ?? 0;
    weights.push({
      id: `weight:source_policy:${index}`,
      source: "source_policy",
      label: stringField(evidence, "kind") ?? "Source policy",
      value: score,
      direction: score >= 45 ? "raises_risk" : "context",
      pathId: null,
      nodeId: subjectNodeId,
      edgeId: null,
      explanation: stringArrayField(evidence, "reasons")[0] ?? "Source-policy amount-weighted contribution.",
      metadata: sourcePolicyEvidenceMetadata(evidence)
    });
  });

  annotateGraphDerivedMetrics(nodesById, edges, paths, weights, job.kind);

  return {
    ok: true,
    graph: {
      job: summary,
      subject: {
        address: subjectAddress,
        displayLabel: null,
        knownLabels: [],
        role: "checked_wallet"
      },
      summary: {
        decision: decision(result["decision"] ?? assessment["decision"]),
        riskScore,
        riskLevel: riskLevelFromScore(riskScore),
        confidence,
        coverageRatio,
        checkedScope: stringField(coverage, "checkedScope"),
        anchorCoverageRatio: numberField(coverage, "anchorCoverageRatio"),
        episodeCoverageRatio: numberField(coverage, "episodeCoverageRatio"),
        drainEpisode: recordField(coverage, "drainEpisode"),
        layerSummary: recordField(result, "layerSummary"),
        selectedAmountRaw: stringField(coverage, "selectedAmountRaw"),
        targetAmountRaw: stringField(coverage, "targetAmountRaw"),
        topReasons: stringArrayField(assessment, "reasons")
      },
      nodes: Array.from(nodesById.values()),
      edges,
      paths,
      weights,
      limitations,
      evidence: evidenceRefs(evidenceIds, paths, edges)
    }
  };
}

function projectAddressDeepJob(
  job: ForensicCheckJob,
  summary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  const result = isRecord(job.resultJson) ? job.resultJson : null;
  if (!result) {
    return {
      ok: false,
      status: "malformed",
      message: "Forensic graph cannot be projected from malformed job result JSON."
    };
  }

  const subjectAddress = stringField(result, "subjectAddress") ?? job.subjectAddress;
  const coverage = isRecord(result["coverage"]) ? result["coverage"] : {};
  const counterpartyProfiles = recordArrayField(result, "counterpartyRiskProfiles");
  const directCounterpartyProfiles = recordArrayField(result, "directCounterpartyInteractionProfiles");
  const inboundProfiles = recordArrayField(result, "inboundProvenanceProfiles");
  const serviceProfiles = recordArrayField(result, "serviceExposureProfiles");

  const nodesById = new Map<string, AdminForensicsNode>();
  const edges: AdminForensicsEdge[] = [];
  const paths: AdminForensicsPath[] = [];
  const weights: AdminForensicsWeight[] = [];
  const limitations: AdminForensicsLimitation[] = [];

  const upsertNode = (
    address: string,
    kind: AdminForensicsNode["kind"],
    metadata: Record<string, unknown> = {}
  ): string => {
    const id = nodeId(address);
    const existing = nodesById.get(id);
    if (existing) {
      if (existing.kind !== "subject" && kind === "subject") existing.kind = "subject";
      existing.metadata = { ...existing.metadata, ...metadata };
      return id;
    }
    nodesById.set(id, {
      id,
      address,
      kind,
      label: shortAddress(address),
      riskLevel: null,
      confidence: null,
      weight: null,
      metadata
    });
    return id;
  };

  const subjectNodeId = upsertNode(subjectAddress, "subject");

  counterpartyProfiles.forEach((profile, index) => {
    const counterpartyAddress = stringField(profile, "counterpartyAddress") ?? stringField(profile, "address");
    if (!counterpartyAddress) return;

    const score = numberField(profile, "score") ?? 0;
    const profileEvidenceIds = stringArrayField(profile, "evidenceIds");
    const counterpartyNodeId = upsertNode(counterpartyAddress, "wallet", {
      label: stringField(profile, "label"),
      direction: stringField(profile, "direction"),
      score
    });
    const direction = stringField(profile, "direction");
    const fromNodeId = direction === "outbound" ? subjectNodeId : counterpartyNodeId;
    const toNodeId = direction === "outbound" ? counterpartyNodeId : subjectNodeId;
    const pathId = `path:counterparty:${index}`;
    const edgeId = `edge:counterparty:${index}`;

    edges.push({
      id: edgeId,
      fromNodeId,
      toNodeId,
      type: "inferred_provenance",
      amountRaw: stringField(profile, "amountRaw"),
      amountShare: numberField(profile, "amountShare"),
      txHash: stringField(profile, "txHash"),
      timestamp: stringField(profile, "timestamp"),
      weight: score,
      verdict: edgeVerdict(profile["verdict"]),
      evidenceIds: profileEvidenceIds,
      metadata: {
        label: stringField(profile, "label"),
        direction
      }
    });
    paths.push({
      id: pathId,
      nodeIds: [fromNodeId, toNodeId],
      edgeIds: [edgeId],
      verdict: decision(profile["verdict"]),
      riskContribution: score,
      amountRaw: stringField(profile, "amountRaw"),
      amountShare: numberField(profile, "amountShare"),
      stoppedAtNodeId: null,
      stopReason: null,
      evidenceIds: profileEvidenceIds
    });
    weights.push({
      id: `weight:counterparty:${index}`,
      source: "counterparty_risk_profile",
      label: stringField(profile, "label") ?? "Counterparty risk profile",
      value: score,
      direction: score > 0 ? "raises_risk" : "context",
      pathId,
      nodeId: counterpartyNodeId,
      edgeId,
      explanation: stringField(profile, "label") ?? "Counterparty risk profile.",
      metadata: {}
    });
  });

  directCounterpartyProfiles.forEach((profile, index) => {
    const counterpartyAddress = stringField(profile, "counterpartyAddress") ?? stringField(profile, "address");
    if (!counterpartyAddress) return;

    const score = numberField(profile, "scoreContribution") ?? numberField(profile, "interactionWeight") ?? 0;
    const profileEvidenceIds = stringArrayField(profile, "evidenceIds");
    const direction = stringField(profile, "direction");
    const counterpartyNodeId = upsertNode(counterpartyAddress, "wallet", {
      source: "directCounterpartyInteractionProfile",
      direction,
      volumeRaw: stringField(profile, "volumeRaw"),
      volumeRatio: numberField(profile, "volumeRatio"),
      txCount: numberField(profile, "txCount"),
      evidenceClass: stringField(profile, "evidenceClass"),
      skippedReason: stringField(profile, "skippedReason"),
      serviceCategory: stringField(profile, "serviceCategory"),
      identity: stringField(profile, "identity")
    });
    const counterpartyNode = nodesById.get(counterpartyNodeId);
    if (counterpartyNode) {
      counterpartyNode.weight = score;
      counterpartyNode.riskLevel = riskLevelFromScore(score);
    }

    const fromNodeId = direction === "inbound" ? counterpartyNodeId : subjectNodeId;
    const toNodeId = direction === "inbound" ? subjectNodeId : counterpartyNodeId;
    const pathId = `path:direct_counterparty:${index}`;
    const edgeId = `edge:direct_counterparty:${index}`;
    const txHashes = stringArrayField(profile, "txHashes");

    edges.push({
      id: edgeId,
      fromNodeId,
      toNodeId,
      type: "inferred_provenance",
      amountRaw: stringField(profile, "volumeRaw"),
      amountShare: numberField(profile, "volumeRatio"),
      txHash: txHashes.length === 1 ? txHashes[0] : null,
      timestamp: firstString(stringField(profile, "lastSeen"), stringField(profile, "firstSeen")),
      weight: score,
      verdict: score > 0 ? "review" : "unknown",
      evidenceIds: profileEvidenceIds,
      metadata: {
        source: "directCounterpartyInteractionProfile",
        pathId,
        direction,
        txHashes,
        txCount: numberField(profile, "txCount"),
        evidenceClass: stringField(profile, "evidenceClass"),
        skippedReason: stringField(profile, "skippedReason")
      }
    });
    paths.push({
      id: pathId,
      nodeIds: [fromNodeId, toNodeId],
      edgeIds: [edgeId],
      verdict: score > 0 ? "REVIEW" : "UNKNOWN",
      riskContribution: score,
      amountRaw: stringField(profile, "volumeRaw"),
      amountShare: numberField(profile, "volumeRatio"),
      stoppedAtNodeId: null,
      stopReason: null,
      evidenceIds: profileEvidenceIds
    });
    weights.push({
      id: `weight:direct_counterparty:${index}`,
      source: "direct_counterparty_interaction",
      label: stringField(profile, "evidenceClass") ?? "Direct counterparty interaction",
      value: score,
      direction: score > 0 ? "raises_risk" : "context",
      pathId,
      nodeId: counterpartyNodeId,
      edgeId,
      explanation: stringField(profile, "evidenceClass") ?? "Direct counterparty interaction context.",
      metadata: {}
    });
  });

  inboundProfiles.forEach((profile, profileIndex) => {
    const profileScore = numberField(profile, "score") ?? 0;
    recordArrayField(profile, "paths").forEach((path, pathIndex) => {
      const sourceAddress = stringField(path, "sourceAddress");
      if (!sourceAddress) return;
      const viaAddresses = stringArrayField(path, "viaAddresses");
      const addressChain = [sourceAddress, ...viaAddresses, subjectAddress];
      const pathId = `path:inbound_provenance:${profileIndex}:${pathIndex}`;
      const pathNodeIds = addressChain.map((address) =>
        upsertNode(address, address === subjectAddress ? "subject" : "wallet", {
          source: "inboundProvenanceProfile",
          label: stringField(path, "label")
        })
      );
      const txHashes = stringArrayField(path, "txHashes");
      const pathEdgeIds: string[] = [];

      for (let edgeIndex = 0; edgeIndex < addressChain.length - 1; edgeIndex += 1) {
        const edgeId = `edge:inbound_provenance:${profileIndex}:${pathIndex}:${edgeIndex}`;
        edges.push({
          id: edgeId,
          fromNodeId: pathNodeIds[edgeIndex],
          toNodeId: pathNodeIds[edgeIndex + 1],
          type: "inferred_provenance",
          amountRaw: stringField(path, "amountRaw"),
          amountShare: numberField(path, "amountPreservationRatio"),
          txHash: txHashes[edgeIndex] ?? null,
          timestamp: edgeIndex === 0 ? stringField(path, "firstTransferAt") : stringField(path, "lastTransferAt"),
          weight: profileScore,
          verdict: profileScore > 0 ? "review" : "unknown",
          evidenceIds: stringArrayField(path, "evidenceIds"),
          metadata: {
            source: "inboundProvenanceProfile",
            pathId,
            label: stringField(path, "label"),
            amountPreservationRatio: numberField(path, "amountPreservationRatio")
          }
        });
        pathEdgeIds.push(edgeId);
      }

      paths.push({
        id: pathId,
        nodeIds: pathNodeIds,
        edgeIds: pathEdgeIds,
        verdict: profileScore > 0 ? "REVIEW" : "UNKNOWN",
        riskContribution: profileScore,
        amountRaw: stringField(path, "amountRaw"),
        amountShare: numberField(path, "amountPreservationRatio"),
        stoppedAtNodeId: null,
        stopReason: null,
        evidenceIds: stringArrayField(path, "evidenceIds")
      });
      weights.push({
        id: `weight:inbound_provenance:${profileIndex}:${pathIndex}`,
        source: "inbound_provenance",
        label: stringField(path, "label") ?? "Inbound provenance",
        value: profileScore,
        direction: profileScore > 0 ? "raises_risk" : "context",
        pathId,
        nodeId: pathNodeIds[0] ?? null,
        edgeId: pathEdgeIds[0] ?? null,
        explanation: stringField(path, "label") ?? "Inbound provenance path.",
        metadata: {}
      });
    });
  });

  serviceProfiles.forEach((profile, index) => {
    const score = firstNumber(numberField(profile, "exposureScore"), numberField(profile, "score")) ?? 0;
    const serviceNodeIds: string[] = [];
    const upsertServiceNode = (
      address: string | null,
      category: string | null,
      identity: string | null,
      metadata: Record<string, unknown>
    ): void => {
      if (!address) return;
      const serviceNodeId = upsertNode(address, "service", {
        ...metadata,
        category,
        identity,
        score
      });
      const node = nodesById.get(serviceNodeId);
      if (node) node.label = identity ?? category ?? shortAddress(address);
      serviceNodeIds.push(serviceNodeId);
    };

    upsertServiceNode(
      stringField(profile, "serviceAddress") ?? stringField(profile, "address"),
      stringField(profile, "serviceType"),
      stringField(profile, "identity"),
      { source: "serviceExposureProfile" }
    );
    recordArrayField(profile, "topServiceCounterparties").forEach((counterparty) => {
      upsertServiceNode(
        stringField(counterparty, "address"),
        stringField(counterparty, "category"),
        stringField(counterparty, "identity"),
        {
          source: "topServiceCounterparties",
          volumeRaw: stringField(counterparty, "volumeRaw"),
          txCount: numberField(counterparty, "txCount")
        }
      );
    });
    recordArrayField(profile, "topMergedServiceFlows").forEach((flow) => {
      upsertServiceNode(
        stringField(flow, "serviceAddress"),
        stringField(flow, "category"),
        stringField(flow, "identity"),
        {
          source: "topMergedServiceFlows",
          intermediateAddress: stringField(flow, "intermediateAddress"),
          incomingRaw: stringField(flow, "incomingRaw"),
          outgoingServiceRaw: stringField(flow, "outgoingServiceRaw"),
          sourceTxCount: numberField(flow, "sourceTxCount"),
          serviceTxCount: numberField(flow, "serviceTxCount")
        }
      );
    });

    weights.push({
      id: `weight:service:${index}`,
      source: "service_exposure_profile",
      label: stringField(profile, "serviceType") ?? stringField(profile, "dominantCategory") ?? "Service exposure",
      value: score,
      direction: "context",
      pathId: null,
      nodeId: serviceNodeIds[0] ?? null,
      edgeId: null,
      explanation: stringField(profile, "serviceType") ?? stringField(profile, "dominantCategory")
        ? `Exposure to ${stringField(profile, "serviceType") ?? stringField(profile, "dominantCategory")}.`
        : "Service exposure profile.",
      metadata: {}
    });
  });

  if ((numberField(coverage, "transferEdges") ?? 0) > 0 && edges.length === 0) {
    limitations.push({
      code: "deep_profiles_without_projected_connections",
      label: "Deep transfer context was collected but no graphable profile edges were emitted",
      severity: "review",
      pathId: null,
      explanation: "The deep job fetched transfers, but the persisted risk/profile arrays contain no address-to-address paths for the admin graph."
    });
  }

  annotateGraphDerivedMetrics(nodesById, edges, paths, weights, job.kind);

  return {
    ok: true,
    graph: {
      job: summary,
      subject: {
        address: subjectAddress,
        displayLabel: null,
        knownLabels: [],
        role: "checked_wallet"
      },
      summary: {
        decision: "UNKNOWN",
        riskScore: null,
        riskLevel: null,
        confidence: null,
        coverageRatio: numberField(coverage, "coverageRatio"),
        checkedScope: null,
        anchorCoverageRatio: null,
        episodeCoverageRatio: null,
        drainEpisode: null,
        layerSummary: {
          deepCoverage: coverage,
          projectedProfiles: {
            counterpartyRiskProfiles: counterpartyProfiles.length,
            directCounterpartyInteractionProfiles: directCounterpartyProfiles.length,
            inboundProvenancePaths: inboundProfiles.reduce((sum, profile) => sum + recordArrayField(profile, "paths").length, 0),
            serviceExposureProfiles: serviceProfiles.length
          }
        },
        selectedAmountRaw: null,
        targetAmountRaw: null,
        topReasons: stringArrayField(result, "missingChecks")
      },
      nodes: Array.from(nodesById.values()),
      edges,
      paths,
      weights,
      limitations,
      evidence: evidenceRefs(job.rawEvidenceIds, paths, edges)
    }
  };
}

function projectIncomingDepositJob(
  job: ForensicCheckJob,
  summary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  const progress = isRecord(job.progressJson) ? job.progressJson : {};
  const result = isRecord(job.resultJson) ? job.resultJson : {};
  const senderAddress = stringField(progress, "sender") ?? job.subjectAddress;
  const receiverAddress = firstString(
    stringField(progress, "watchedWallet"),
    stringField(progress, "receiver")
  );
  if (!senderAddress || !receiverAddress) {
    return {
      ok: false,
      status: "malformed",
      message: "Incoming deposit graph requires both sender and receiver wallet addresses."
    };
  }
  const riskScore = firstNumber(numberField(result, "depositRiskScore"), numberField(result, "riskScore"));
  const originPaths = recordArrayField(result, "originPaths");
  const nodesById = new Map<string, AdminForensicsNode>();
  const edges: AdminForensicsEdge[] = [];
  const paths: AdminForensicsPath[] = [];
  const limitations: AdminForensicsLimitation[] = [];
  const weights: AdminForensicsWeight[] = [
    {
      id: "weight:deposit:risk",
      source: "incoming_deposit",
      label: "Deposit risk score",
      value: riskScore ?? 0,
      direction: riskScore !== null && riskScore > 0 ? "raises_risk" : "context",
      pathId: originPaths.length > 0 ? null : "path:deposit:0",
      nodeId: nodeId(senderAddress),
      edgeId: originPaths.length > 0 ? null : "edge:deposit:0",
      explanation: "Incoming deposit risk score.",
      metadata: {}
    }
  ];

  const upsertNode = (
    address: string,
    kind: AdminForensicsNode["kind"],
    metadata: Record<string, unknown> = {}
  ): string => {
    const id = nodeId(address);
    const existing = nodesById.get(id);
    if (existing) {
      if (existing.kind !== "subject" && kind === "subject") existing.kind = "subject";
      existing.metadata = { ...existing.metadata, ...metadata };
      return id;
    }
    nodesById.set(id, {
      id,
      address,
      kind,
      label: shortAddress(address),
      riskLevel: kind === "subject" ? riskLevelFromScore(riskScore) : null,
      confidence: kind === "subject" ? confidenceFromNumber(riskScore) : null,
      weight: kind === "subject" ? riskScore : null,
      metadata
    });
    return id;
  };

  const senderNodeId = upsertNode(senderAddress, "subject", { role: "sender" });
  const receiverNodeId = upsertNode(
    receiverAddress,
    receiverAddress === senderAddress ? "subject" : "wallet",
    { role: "receiver" }
  );

  if (originPaths.length > 0) {
    originPaths.forEach((path, pathIndex) => {
      const pathId = `path:origin:${pathIndex}`;
      const pathEvidenceIds = stringArrayField(path, "evidenceIds");
      const steps = recordArrayField(path, "steps");
      const txHashes = stringArrayField(path, "txHashes");
      const pathAddresses = stringArrayField(path, "pathAddresses");
      const addressChain = pathAddresses.length > 0
        ? pathAddresses
        : [
            ...steps.flatMap((step) => [
              stringField(step, "fromAddress"),
              stringField(step, "toAddress")
            ]).filter((address): address is string => address !== null)
          ];
      const uniqueAddressChain = Array.from(new Set(addressChain.length > 0 ? addressChain : [senderAddress, receiverAddress]));
      const pathNodeIds = uniqueAddressChain.map((address) =>
        upsertNode(address, address === senderAddress ? "subject" : "wallet", {
          source: "incomingDepositOriginPath"
        })
      );
      const pathEdgeIds: string[] = [];
      const bundleNodeIds: string[] = [];
      const pathScore = numberField(path, "score") ?? 0;
      const amountShare = numberField(path, "amountCoverageRatio");
      const sourcePolicyShareMetadata = shareDetailMetadata(path["sourcePolicyShareDetail"]);

      if (steps.length > 0) {
        steps.forEach((step, stepIndex) => {
          const fromAddress = stringField(step, "fromAddress");
          const toAddress = stringField(step, "toAddress");
          if (!fromAddress || !toAddress) return;
          const fromNodeId = upsertNode(fromAddress, fromAddress === senderAddress ? "subject" : "wallet");
          const toNodeId = upsertNode(toAddress, toAddress === senderAddress ? "subject" : "wallet");
          const edgeId = `edge:origin:${pathIndex}:${stepIndex}`;
          edges.push({
            id: edgeId,
            fromNodeId,
            toNodeId,
            type: "transfer",
            amountRaw: stringField(step, "amountRaw"),
            amountShare,
            txHash: stringField(step, "txHash") ?? txHashes[stepIndex] ?? null,
            timestamp: stringField(step, "timestamp"),
            weight: pathScore,
            verdict: edgeVerdict(path["verdict"]),
            evidenceIds: pathEvidenceIds,
            metadata: {
              pathId,
              source: "incomingDepositOriginPath",
              sourcePolicy: stringField(path, "sourcePolicy"),
              amountContinuity: stringField(path, "amountContinuity"),
              proximityHops: numberField(path, "proximityHops"),
              ...sourcePolicyShareMetadata
            }
          });
          pathEdgeIds.push(edgeId);
        });
      } else {
        for (let index = 0; index < uniqueAddressChain.length - 1; index += 1) {
          const edgeId = `edge:origin:${pathIndex}:${index}`;
          edges.push({
            id: edgeId,
            fromNodeId: pathNodeIds[index],
            toNodeId: pathNodeIds[index + 1],
            type: "transfer",
            amountRaw: stringField(progress, "amountRaw"),
            amountShare,
            txHash: txHashes[index] ?? null,
            timestamp: null,
            weight: pathScore,
            verdict: edgeVerdict(path["verdict"]),
            evidenceIds: pathEvidenceIds,
            metadata: {
              pathId,
              source: "incomingDepositOriginPath",
              sourcePolicy: stringField(path, "sourcePolicy"),
              amountContinuity: stringField(path, "amountContinuity"),
              ...sourcePolicyShareMetadata
            }
          });
          pathEdgeIds.push(edgeId);
        }
      }

      recordArrayField(path, "fundingBundles").forEach((bundle, bundleIndex) => {
        const funderSummary = bundleTopFundersFromIncomingFunders(recordArrayField(bundle, "fundingFunders"));
        const bundleId = bundleNodeId(pathIndex, bundleIndex);
        const targetFromAddress = stringField(bundle, "targetFromAddress");
        const targetNodeId = targetFromAddress
          ? upsertNode(targetFromAddress, targetFromAddress === senderAddress ? "subject" : "wallet")
          : pathNodeIds[0] ?? senderNodeId;
        const targetTxHash = stringField(bundle, "targetTxHash");
        const targetAmountRaw = stringField(bundle, "targetAmountRaw");
        const bundleAmountRaw = stringField(bundle, "bundleAmountRaw");
        const relatedEdgeIds: string[] = [];

        funderSummary.topFunders.forEach((funder, funderIndex) => {
          const funderNodeId = upsertNode(funder.address, funder.address === senderAddress ? "subject" : "wallet");
          const edgeId = `edge:origin:${pathIndex}:bundle:${bundleIndex}:funder:${funderIndex}`;
          edges.push({
            id: edgeId,
            fromNodeId: funderNodeId,
            toNodeId: bundleId,
            type: "inferred_provenance",
            amountRaw: funder.amountRaw,
            amountShare: null,
            txHash: null,
            timestamp: null,
            weight: pathScore,
            verdict: "review",
            evidenceIds: pathEvidenceIds,
            metadata: {
              pathId,
              bundleIndex,
              bundleNodeId: bundleId,
              bundleRole: "top_funder",
              txHashes: funder.txHashes,
              memberCount: funder.memberCount,
              originalAmountRaw: funder.amountRaw,
              usedAmountRaw: funder.amountRaw,
              anchorAmountRaw: targetAmountRaw,
              amountRole: "bundle_top_funder"
            }
          });
          relatedEdgeIds.push(edgeId);
        });

        const bundleTargetEdgeId = `edge:origin:${pathIndex}:bundle:${bundleIndex}:target`;
        edges.push({
          id: bundleTargetEdgeId,
          fromNodeId: bundleId,
          toNodeId: targetNodeId,
          type: "inferred_provenance",
          amountRaw: bundleAmountRaw ?? targetAmountRaw,
          amountShare: numberField(bundle, "bundleCoverageRatio"),
          txHash: null,
          timestamp: stringField(bundle, "windowEnd"),
          weight: pathScore,
          verdict: "review",
          evidenceIds: pathEvidenceIds,
          metadata: {
            pathId,
            bundleIndex,
            bundleNodeId: bundleId,
            bundleRole: "bundle_to_target",
            targetTxHash,
            originalAmountRaw: bundleAmountRaw,
            usedAmountRaw: bundleAmountRaw,
            anchorAmountRaw: targetAmountRaw,
            amountRole: "bundle_coverage"
          }
        });
        relatedEdgeIds.push(bundleTargetEdgeId);

        nodesById.set(bundleId, {
          id: bundleId,
          address: null,
          kind: "bundle",
          label: "Funding bundle",
          riskLevel: riskLevelFromScore(pathScore),
          confidence: null,
          weight: pathScore,
          metadata: {
            pathId,
            relatedPathIds: [pathId],
            relatedEdgeIds,
            bundleIndex,
            bundleKind: "incoming_deposit_funding_bundle",
            targetTxHash,
            targetFromAddress,
            targetToAddress: stringField(bundle, "targetToAddress"),
            targetAmountRaw,
            bundleAmountRaw,
            coverageRatio: numberField(bundle, "bundleCoverageRatio"),
            windowStart: stringField(bundle, "windowStart"),
            windowEnd: stringField(bundle, "windowEnd"),
            fundingTxHashes: stringArrayField(bundle, "fundingTxHashes"),
            fundingAddresses: stringArrayField(bundle, "fundingAddresses"),
            memberCount: stringArrayField(bundle, "fundingTxHashes").length,
            funderCount: funderSummary.funderCount,
            topFunders: funderSummary.topFunders,
            smallTailAmountRaw: funderSummary.smallTailAmountRaw,
            smallTailCount: funderSummary.smallTailCount,
            deepExpansion: recordField(bundle, "deepExpansion")
          }
        });
        bundleNodeIds.push(bundleId);
        limitations.push({
          code: "incoming_funding_bundle",
          label: "Incoming funding bundle used",
          severity: "info",
          pathId,
          explanation: `Funding bundle ${bundleIndex + 1} covered ${bundleAmountRaw ?? "unknown"} raw USDT for target ${targetTxHash ?? "unknown tx"}.`
        });
      });

      let stoppedAtNodeId: string | null = null;
      const stoppedReason = stringField(path, "stoppedReason");
      if (stoppedReason) {
        const diagnostics = stopDiagnostics({ path, pathId, stopReason: stoppedReason, riskContribution: pathScore });
        stoppedAtNodeId = `stop:origin:${pathIndex}:${stoppedReason}`;
        nodesById.set(stoppedAtNodeId, {
          id: stoppedAtNodeId,
          address: null,
          kind: "stop",
          label: stoppedReason,
          riskLevel: riskLevelFromScore(pathScore),
          confidence: null,
          weight: pathScore,
          metadata: { reason: stoppedReason, pathId, stopPosition: "upstream_source", stopDetails: [diagnostics] }
        });
        const edgeId = `edge:origin:${pathIndex}:stop`;
        edges.push({
          id: edgeId,
          fromNodeId: stoppedAtNodeId,
          toNodeId: pathNodeIds[0] ?? senderNodeId,
          type: "stop",
          amountRaw: null,
          amountShare: null,
          txHash: null,
          timestamp: null,
          weight: pathScore,
          verdict: edgeVerdict(path["verdict"]),
          evidenceIds: pathEvidenceIds,
          metadata: { reason: stoppedReason, pathId, stopPosition: "upstream_source", stopDetails: [diagnostics] }
        });
        pathEdgeIds.unshift(edgeId);
        limitations.push({
          code: stoppedReason,
          label: stoppedReason,
          severity: path["verdict"] === "DECLINE" ? "blocking" : "review",
          pathId,
          explanation: `Incoming deposit origin path stopped at ${stoppedReason}; fetched ${diagnostics.totalFetchedTransferCount} prior transfer(s), history source ${diagnostics.historySource ?? "n/a"}.`
        });
        if (stoppedReason === "no_previous_transfer") {
          limitations.push({
            code: "legacy_no_previous_transfer",
            label: "Legacy no_previous_transfer stop",
            severity: "review",
            pathId,
            explanation: "Incoming deposit reports still expose no_previous_transfer; rerun or inspect path context before treating it as no history."
          });
          if (diagnostics.hadIncomingTransfers === true) {
            limitations.push({
              code: "previous_transfers_found_but_not_matching",
              label: "Previous transfers found but not matching",
              severity: "review",
              pathId,
              explanation: `Prior incoming transfers were found (${diagnostics.totalFetchedTransferCount}), but none met the amount/time continuity threshold.`
            });
          }
        }
        if (stoppedReason === "incoming_seen_but_below_continuity") {
          limitations.push({
            code: "previous_transfers_found_but_not_matching",
            label: "Previous transfers found but not matching",
            severity: "review",
            pathId,
            explanation: `Prior incoming transfers were found (${diagnostics.totalFetchedTransferCount}), but none met the amount/time continuity threshold.`
          });
        }
      }

      paths.push({
        id: pathId,
        nodeIds: stoppedAtNodeId ? [stoppedAtNodeId, ...pathNodeIds, ...bundleNodeIds] : [...pathNodeIds, ...bundleNodeIds],
        edgeIds: pathEdgeIds,
        verdict: decision(path["verdict"]),
        riskContribution: pathScore,
        amountRaw: stringField(progress, "amountRaw"),
        amountShare,
        stoppedAtNodeId,
        stopReason: stoppedReason,
        evidenceIds: pathEvidenceIds
      });
      weights.push({
        id: `weight:incoming_origin:${pathIndex}`,
        source: "incoming_deposit_origin_path",
        label: stringArrayField(path, "reasons")[0] ?? "Incoming deposit origin path",
        value: pathScore,
        direction: pathScore > 0 ? "raises_risk" : "context",
        pathId,
        nodeId: stoppedAtNodeId ?? pathNodeIds[0] ?? null,
        edgeId: pathEdgeIds[0] ?? null,
        explanation: stringArrayField(path, "reasons")[0] ?? "Incoming deposit origin path.",
        metadata: sourcePolicyShareMetadata
      });

    });
  } else {
    const edgeId = "edge:deposit:0";
    const pathId = "path:deposit:0";
    edges.push({
      id: edgeId,
      fromNodeId: senderNodeId,
      toNodeId: receiverNodeId,
      type: "transfer",
      amountRaw: stringField(progress, "amountRaw"),
      amountShare: null,
      txHash: stringField(progress, "depositTxHash") ?? stringField(progress, "txHash"),
      timestamp: stringField(progress, "timestamp"),
      weight: riskScore,
      verdict: edgeVerdict(result["decision"]),
      evidenceIds: [],
      metadata: {}
    });
    paths.push({
      id: pathId,
      nodeIds: [senderNodeId, receiverNodeId],
      edgeIds: [edgeId],
      verdict: decision(result["decision"]),
      riskContribution: riskScore ?? 0,
      amountRaw: stringField(progress, "amountRaw"),
      amountShare: null,
      stoppedAtNodeId: null,
      stopReason: null,
      evidenceIds: []
    });
  }

  recordArrayField(result, "sourcePolicyEvidence").forEach((evidence, index) => {
    const score = numberField(evidence, "score") ?? 0;
    weights.push({
      id: `weight:incoming_source_policy:${index}`,
      source: "source_policy",
      label: stringField(evidence, "kind") ?? "Source policy",
      value: score,
      direction: score >= 45 ? "raises_risk" : "context",
      pathId: null,
      nodeId: senderNodeId,
      edgeId: null,
      explanation: stringArrayField(evidence, "reasons")[0] ?? "Incoming deposit source-policy amount-weighted contribution.",
      metadata: sourcePolicyEvidenceMetadata(evidence)
    });
  });

  const layerSummary = {
    fundingCoverage: recordField(result, "fundingCoverage"),
    corridorSummary: recordField(result, "corridorSummary"),
    fastSenderRisk: recordField(result, "fastSenderRisk"),
    originPathCount: originPaths.length
  };

  annotateGraphDerivedMetrics(nodesById, edges, paths, weights, job.kind);

  return {
    ok: true,
    graph: {
      job: summary,
      subject: {
        address: senderAddress,
        displayLabel: null,
        knownLabels: [],
        role: "sender"
      },
      summary: {
        decision: decision(result["decision"]),
        riskScore,
        riskLevel: riskLevelFromScore(riskScore),
        confidence: confidenceFromNumber(riskScore),
        coverageRatio: numberField(result, "originCoverage"),
        checkedScope: originPaths.length > 0 ? "incoming_deposit_origin" : null,
        anchorCoverageRatio: null,
        episodeCoverageRatio: null,
        drainEpisode: null,
        layerSummary,
        selectedAmountRaw: stringField(progress, "amountRaw"),
        targetAmountRaw: null,
        topReasons: stringArrayField(result, "reasons")
      },
      nodes: Array.from(nodesById.values()),
      edges,
      paths,
      weights,
      limitations,
      evidence: evidenceRefs(job.rawEvidenceIds, paths, edges)
    }
  };
}

export function projectForensicJobGraph(job: ForensicCheckJob): AdminForensicsProjectionResult {
  const summary = completedJobSummary(job);
  if (!summary) {
    return {
      ok: false,
      status: "not_ready",
      message: "Forensic graph is available after the job completes."
    };
  }
  if (job.kind === "where_is_money_check") {
    return projectWhereIsMoneyJob(job, summary);
  }
  if (job.kind === "address_deep_check") {
    return projectAddressDeepJob(job, summary);
  }
  if (job.kind === "incoming_deposit_check") {
    return projectIncomingDepositJob(job, summary);
  }
  return {
    ok: false,
    status: "unsupported",
    message: `Graph projection is not implemented for ${job.kind}.`
  };
}
