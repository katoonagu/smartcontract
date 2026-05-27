import type {
  AddressBehaviorProfile,
  AddressLabel,
  BoundaryExposureProfile,
  CounterpartyRiskProfile,
  DirectCounterpartyInteractionProfile,
  ExtendedProvenanceProfile,
  ForensicRouteEdge,
  InboundProvenanceProfile,
  OperationalFlowProfile,
  RiskLabel,
  ServiceCategory,
  ServiceClassification,
  ServiceExposureProfile,
  WalletRoleProfile
} from "../types";

export type CoverageSkippedReason =
  | "not_loaded"
  | "outside_window"
  | "metadata_cap"
  | "not_top_candidate"
  | "service_boundary_stop"
  | "provider_partial"
  | "no_label"
  | "behavior_only_context"
  | "no_exact_label_or_cached_taint"
  | "not_selected_for_fast_snapshot"
  | "counterparty_behavior_context";

export type CoverageEvidenceClass =
  | "exact_labeled_counterparty"
  | "derived_labeled_counterparty"
  | "counterparty_fast_risk_snapshot"
  | "service_boundary_context"
  | "behavior_only_context"
  | "counterparty_behavior_context"
  | "no_exact_label_or_cached_taint"
  | "provider_partial"
  | "no_label"
  | "legacy_partial";

export type CoverageCachedRisk = "critical" | "high" | "medium" | "low" | "none";

export type CoverageDebugRow = {
  direction: "inbound" | "outbound";
  counterparty: string;
  volumeRaw: string;
  volumeRatio: number;
  txCount: number;
  firstSeen: string;
  lastSeen: string;
  seen: boolean;
  analyzed: boolean;
  expanded: boolean;
  metadataEnriched: boolean;
  label: RiskLabel | null;
  cachedRisk: CoverageCachedRisk;
  serviceCategory: ServiceCategory | null;
  identity: string | null;
  counterpartyRiskScore: number;
  counterpartyRiskLevel: string | null;
  riskSource: string | null;
  interactionWeight: number | null;
  snapshotStatus: "checked" | "partial" | "not_checked";
  snapshotPartialNotes: string[];
  scoreContribution: number;
  evidenceClass: CoverageEvidenceClass;
  skippedReason: CoverageSkippedReason | null;
};

export type CoverageDebugReport = {
  jobId: string | null;
  subjectAddress: string;
  status: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  summary: {
    sourceTransferPages: number;
    transferEdges: number;
    inboundSendersExpanded: number;
    extendedIndexedEdges: number;
    extendedFetchedAddresses: number;
    apiKeyConfigured: boolean | null;
    thirtyDayTransferCount: number | null;
    historicalFallbackTransferCount: number | null;
    historicalFallbackRequestedLimit: number | null;
    directCounterpartyCount: number;
    analyzedCounterpartyCount: number;
    expandedCounterpartyCount: number;
    metadataEnrichedCounterpartyCount: number;
    skippedCounterpartyCount: number;
    legacyPartial: boolean;
  };
  rows: CoverageDebugRow[];
  missingChecks: string[];
  notes: string[];
};

export type BuildCoverageDebugSnapshotInput = {
  jobId?: string | null;
  subjectAddress: string;
  status?: string | null;
  windowStart: Date;
  windowEnd: Date;
  sourceTransferPages: number;
  inboundSendersExpanded: number;
  sourceWindowEdgeCount: number;
  sourceRecentFallbackEdgeCount: number;
  sourceRecentFallbackRequestedLimit: number;
  sourceEdges: ForensicRouteEdge[];
  provenanceEdges: ForensicRouteEdge[];
  expandedAddresses: Iterable<string>;
  labelsByAddress: Map<string, AddressLabel[]>;
  classifications: Map<string, ServiceClassification | null>;
  counterpartyRiskProfiles: CounterpartyRiskProfile[];
  directCounterpartyInteractionProfiles?: DirectCounterpartyInteractionProfile[];
  serviceExposureProfiles: ServiceExposureProfile[];
  addressBehaviorProfiles: AddressBehaviorProfile[];
  inboundProvenanceProfiles: InboundProvenanceProfile[];
  boundaryExposureProfiles: BoundaryExposureProfile[];
  operationalFlowProfiles: OperationalFlowProfile[];
  walletRoleProfiles: WalletRoleProfile[];
  extendedProvenanceProfiles: ExtendedProvenanceProfile[];
  missingChecks: string[];
  apiKeyConfigured?: boolean;
};

export type BuildCoverageDebugFromJobInput = {
  id: string;
  subjectAddress: string;
  status: string;
  windowStart: Date;
  windowEnd: Date;
  progressJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  lastError?: string | null;
};

function parseAmount(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function rawToString(value: bigint): string {
  return value.toString();
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function firstLabel(labels: AddressLabel[] | undefined): RiskLabel | null {
  return labels?.[0]?.label ?? null;
}

function cachedRiskForLabel(label: RiskLabel | null): CoverageCachedRisk {
  if (label === "darknet_exchange" || label === "whitebit" || label === "scam" || label === "stolen_funds" || label === "phishing" || label === "risky_contract") {
    return "critical";
  }
  if (label === "darknet_exchange_proximity" || label === "approval_drain_proximity") return "high";
  if (label) return "medium";
  return "none";
}

function metadataEnriched(classification: ServiceClassification | null | undefined): boolean {
  if (!classification) return false;
  return classification.category !== "none" || classification.identity !== null || classification.evidence.length > 0;
}

function behaviorOnlyCounterparties(profiles: AddressBehaviorProfile[]): Set<string> {
  const result = new Set<string>();
  for (const profile of profiles) {
    if (profile.topOutgoingCounterpartyAddress) result.add(profile.topOutgoingCounterpartyAddress);
  }
  return result;
}

function evidenceClassFor(input: {
  label: RiskLabel | null;
  serviceCategory: ServiceCategory | null;
  scoreContribution: number;
  behaviorOnly: boolean;
  interactionProfile: DirectCounterpartyInteractionProfile | null;
}): CoverageEvidenceClass {
  if (input.interactionProfile) return input.interactionProfile.evidenceClass;
  if (input.scoreContribution > 0 || input.label === "darknet_exchange" || input.label === "whitebit" || input.label === "darknet_exchange_proximity" || input.label === "approval_drain_proximity") {
    return "exact_labeled_counterparty";
  }
  if (input.serviceCategory !== null) return "service_boundary_context";
  if (input.behaviorOnly) return "behavior_only_context";
  return "no_exact_label_or_cached_taint";
}

function skippedReasonFor(input: {
  evidenceClass: CoverageEvidenceClass;
  scoreContribution: number;
  metadataEnriched: boolean;
  missingChecks: string[];
}): CoverageSkippedReason | null {
  if (input.scoreContribution > 0) return null;
  if (input.missingChecks.some((check) => check.toLowerCase().includes("provider") || check.toLowerCase().includes("aborted"))) {
    return "provider_partial";
  }
  if (input.evidenceClass === "service_boundary_context") return "service_boundary_stop";
  if (input.evidenceClass === "behavior_only_context") return "behavior_only_context";
  if (input.evidenceClass === "counterparty_behavior_context" || input.evidenceClass === "counterparty_fast_risk_snapshot") return "counterparty_behavior_context";
  if (input.evidenceClass === "provider_partial") return "provider_partial";
  if (input.evidenceClass === "no_exact_label_or_cached_taint") return "no_exact_label_or_cached_taint";
  if (input.evidenceClass === "no_label") return "no_label";
  return "not_top_candidate";
}

function directCounterpartyGroups(subjectAddress: string, edges: ForensicRouteEdge[]): Array<{
  direction: "inbound" | "outbound";
  counterparty: string;
  edges: ForensicRouteEdge[];
  directionalVolumeRaw: bigint;
}> {
  const inbound = edges.filter((edge) => edge.toAddress === subjectAddress);
  const outbound = edges.filter((edge) => edge.fromAddress === subjectAddress);
  const inboundVolume = inbound.reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
  const outboundVolume = outbound.reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
  const groups = new Map<string, { direction: "inbound" | "outbound"; counterparty: string; edges: ForensicRouteEdge[]; directionalVolumeRaw: bigint }>();

  for (const edge of inbound) {
    const key = `inbound:${edge.fromAddress}`;
    const current = groups.get(key) ?? { direction: "inbound", counterparty: edge.fromAddress, edges: [], directionalVolumeRaw: inboundVolume };
    current.edges.push(edge);
    groups.set(key, current);
  }
  for (const edge of outbound) {
    const key = `outbound:${edge.toAddress}`;
    const current = groups.get(key) ?? { direction: "outbound", counterparty: edge.toAddress, edges: [], directionalVolumeRaw: outboundVolume };
    current.edges.push(edge);
    groups.set(key, current);
  }

  return [...groups.values()];
}

export function buildCoverageDebugSnapshot(input: BuildCoverageDebugSnapshotInput): CoverageDebugReport {
  const expanded = new Set(input.expandedAddresses);
  const profileByDirectionAndAddress = new Map<string, CounterpartyRiskProfile>();
  for (const profile of input.counterpartyRiskProfiles) {
    profileByDirectionAndAddress.set(`${profile.direction}:${profile.counterpartyAddress}`, profile);
  }
  const interactionByDirectionAndAddress = new Map<string, DirectCounterpartyInteractionProfile>();
  for (const profile of input.directCounterpartyInteractionProfiles ?? []) {
    interactionByDirectionAndAddress.set(`${profile.direction}:${profile.counterpartyAddress}`, profile);
  }
  const behaviorOnly = behaviorOnlyCounterparties(input.addressBehaviorProfiles);

  const rows = directCounterpartyGroups(input.subjectAddress, input.sourceEdges)
    .map((group): CoverageDebugRow => {
      const amountRaw = group.edges.reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
      const sorted = [...group.edges].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const labels = input.labelsByAddress.get(group.counterparty);
      const label = firstLabel(labels);
      const classification = input.classifications.get(group.counterparty) ?? null;
      const serviceCategory = classification?.category && classification.category !== "none" ? classification.category : null;
      const counterpartyProfile = profileByDirectionAndAddress.get(`${group.direction}:${group.counterparty}`) ?? null;
      const interactionProfile = interactionByDirectionAndAddress.get(`${group.direction}:${group.counterparty}`) ?? null;
      const enriched = metadataEnriched(classification);
      const evidenceClass = evidenceClassFor({
        label,
        serviceCategory,
        scoreContribution: interactionProfile?.scoreContribution ?? counterpartyProfile?.score ?? 0,
        behaviorOnly: behaviorOnly.has(group.counterparty),
        interactionProfile
      });
      const scoreContribution = interactionProfile?.scoreContribution ?? counterpartyProfile?.score ?? 0;
      const snapshot = interactionProfile?.snapshot ?? null;
      return {
        direction: group.direction,
        counterparty: group.counterparty,
        volumeRaw: rawToString(amountRaw),
        volumeRatio: ratio(amountRaw, group.directionalVolumeRaw),
        txCount: group.edges.length,
        firstSeen: sorted[0]?.timestamp.toISOString() ?? input.windowStart.toISOString(),
        lastSeen: sorted.at(-1)?.timestamp.toISOString() ?? input.windowEnd.toISOString(),
        seen: true,
        analyzed: true,
        expanded: expanded.has(group.counterparty),
        metadataEnriched: enriched,
        label,
        cachedRisk: cachedRiskForLabel(label),
        serviceCategory,
        identity: classification?.identity ?? null,
        counterpartyRiskScore: snapshot?.riskScore ?? counterpartyProfile?.score ?? 0,
        counterpartyRiskLevel: snapshot?.riskLevel ?? null,
        riskSource: snapshot?.source ?? (counterpartyProfile ? "exact_label" : null),
        interactionWeight: interactionProfile?.interactionWeight ?? null,
        snapshotStatus: snapshot?.evidenceClass === "provider_partial" ? "partial" : snapshot ? "checked" : "not_checked",
        snapshotPartialNotes: snapshot?.partialNotes ?? [],
        scoreContribution,
        evidenceClass,
        skippedReason: skippedReasonFor({
          evidenceClass,
          scoreContribution,
          metadataEnriched: enriched,
          missingChecks: input.missingChecks
        })
      };
    })
    .sort((left, right) => {
      const leftAmount = parseAmount(left.volumeRaw);
      const rightAmount = parseAmount(right.volumeRaw);
      if (left.scoreContribution !== right.scoreContribution) return right.scoreContribution - left.scoreContribution;
      if (leftAmount === rightAmount) return left.counterparty.localeCompare(right.counterparty);
      return leftAmount > rightAmount ? -1 : 1;
    });

  return {
    jobId: input.jobId ?? null,
    subjectAddress: input.subjectAddress,
    status: input.status ?? null,
    windowStart: input.windowStart.toISOString(),
    windowEnd: input.windowEnd.toISOString(),
    summary: {
      sourceTransferPages: input.sourceTransferPages,
      transferEdges: input.provenanceEdges.length,
      inboundSendersExpanded: input.inboundSendersExpanded,
      extendedIndexedEdges: input.extendedProvenanceProfiles.reduce((sum, profile) => sum + profile.paths.length, 0),
      extendedFetchedAddresses: input.extendedProvenanceProfiles.reduce((sum, profile) => sum + profile.coverage.fetchedAddressCount, 0),
      apiKeyConfigured: input.apiKeyConfigured ?? null,
      thirtyDayTransferCount: input.sourceWindowEdgeCount,
      historicalFallbackTransferCount: input.sourceRecentFallbackEdgeCount,
      historicalFallbackRequestedLimit: input.sourceRecentFallbackRequestedLimit,
      directCounterpartyCount: rows.length,
      analyzedCounterpartyCount: rows.filter((row) => row.analyzed).length,
      expandedCounterpartyCount: rows.filter((row) => row.expanded).length,
      metadataEnrichedCounterpartyCount: rows.filter((row) => row.metadataEnriched).length,
      skippedCounterpartyCount: rows.filter((row) => row.skippedReason !== null).length,
      legacyPartial: false
    },
    rows,
    missingChecks: [...input.missingChecks],
    notes: []
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseSparseFallback(checks: string[]): {
  thirtyDayTransferCount: number | null;
  historicalFallbackTransferCount: number | null;
  historicalFallbackRequestedLimit: number | null;
} {
  for (const check of checks) {
    const match = /30d window had (\d+) USDT transfers .* added latest (\d+)\/(\d+) historical USDT transfers/.exec(check);
    if (match) {
      return {
        thirtyDayTransferCount: Number(match[1]),
        historicalFallbackTransferCount: Number(match[2]),
        historicalFallbackRequestedLimit: Number(match[3])
      };
    }
  }
  return {
    thirtyDayTransferCount: null,
    historicalFallbackTransferCount: null,
    historicalFallbackRequestedLimit: null
  };
}

function isCoverageDebugReport(value: unknown): value is CoverageDebugReport {
  const record = asRecord(value);
  return Array.isArray(record.rows) && typeof record.subjectAddress === "string" && typeof record.summary === "object";
}

export function buildCoverageDebugReportFromJob(input: BuildCoverageDebugFromJobInput): CoverageDebugReport {
  if (isCoverageDebugReport(input.resultJson.coverageDebug)) {
    return {
      ...input.resultJson.coverageDebug,
      jobId: input.id,
      status: input.status
    };
  }

  const coverage = asRecord(input.resultJson.coverage);
  const missingChecks = asStringArray(input.resultJson.missingChecks);
  const sparse = parseSparseFallback(missingChecks);
  const notes = [
    "Legacy job has no coverageDebug object; direct counterparty table is partial.",
    input.lastError ? `Job last error: ${input.lastError}` : null
  ].filter((note): note is string => Boolean(note));

  return {
    jobId: input.id,
    subjectAddress: typeof input.resultJson.subjectAddress === "string" ? input.resultJson.subjectAddress : input.subjectAddress,
    status: input.status,
    windowStart: typeof input.resultJson.windowStart === "string" ? input.resultJson.windowStart : input.windowStart.toISOString(),
    windowEnd: typeof input.resultJson.windowEnd === "string" ? input.resultJson.windowEnd : input.windowEnd.toISOString(),
    summary: {
      sourceTransferPages: asNumber(coverage.sourceTransferPages ?? input.progressJson.sourceTransferPages),
      transferEdges: asNumber(coverage.transferEdges ?? input.progressJson.transferEdges),
      inboundSendersExpanded: asNumber(coverage.inboundSendersExpanded ?? input.progressJson.inboundSendersExpanded),
      extendedIndexedEdges: asNumber(coverage.extendedIndexedEdges ?? input.progressJson.extendedIndexedEdges),
      extendedFetchedAddresses: asNumber(coverage.extendedFetchedAddresses ?? input.progressJson.extendedFetchedAddresses),
      apiKeyConfigured: typeof coverage.apiKeyConfigured === "boolean" ? coverage.apiKeyConfigured : null,
      ...sparse,
      directCounterpartyCount: 0,
      analyzedCounterpartyCount: 0,
      expandedCounterpartyCount: 0,
      metadataEnrichedCounterpartyCount: 0,
      skippedCounterpartyCount: 0,
      legacyPartial: true
    },
    rows: [],
    missingChecks,
    notes
  };
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function rawUsdt(value: string): string {
  const raw = parseAmount(value);
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

export function formatCoverageDebugSummary(report: CoverageDebugReport): string {
  const lines = [
    `Job: ${report.jobId ?? "n/a"} (${report.status ?? "unknown"})`,
    `Subject: ${report.subjectAddress}`,
    `Window: ${report.windowStart ?? "n/a"} -> ${report.windowEnd ?? "n/a"}`,
    `Transfers: ${report.summary.transferEdges} edges, ${report.summary.sourceTransferPages} source pages`,
    `Sparse fallback: ${report.summary.thirtyDayTransferCount ?? "n/a"} in 30d, ${report.summary.historicalFallbackTransferCount ?? 0}/${report.summary.historicalFallbackRequestedLimit ?? 0} historical`,
    `Direct counterparties: ${report.summary.directCounterpartyCount} seen, ${report.summary.analyzedCounterpartyCount} analyzed, ${report.summary.expandedCounterpartyCount} expanded, ${report.summary.metadataEnrichedCounterpartyCount} enriched, ${report.summary.skippedCounterpartyCount} skipped`,
    `Extended search: ${report.summary.extendedIndexedEdges} indexed paths, ${report.summary.extendedFetchedAddresses} addresses fetched`,
    `API key configured: ${report.summary.apiKeyConfigured === null ? "unknown" : String(report.summary.apiKeyConfigured)}`
  ];
  if (report.summary.legacyPartial) lines.push("Legacy partial: coverageDebug was not stored in this job.");
  if (report.notes.length > 0) lines.push(...report.notes.map((note) => `Note: ${note}`));
  if (report.missingChecks.length > 0) lines.push(...report.missingChecks.map((check) => `Missing check: ${check}`));
  return lines.join("\n");
}

export function formatCoverageDebugTable(report: CoverageDebugReport): string {
  const rows = report.rows.map((row) => ({
    direction: row.direction,
    counterparty: shortAddress(row.counterparty),
    volume: rawUsdt(row.volumeRaw),
    share: pct(row.volumeRatio),
    txs: String(row.txCount),
    seen: row.seen ? "yes" : "no",
    analyzed: row.analyzed ? "yes" : "no",
    expanded: row.expanded ? "yes" : "no",
    enriched: row.metadataEnriched ? "yes" : "no",
    label: row.label ?? "-",
    cachedRisk: row.cachedRisk,
    service: row.serviceCategory ?? "-",
    identity: row.identity ?? "-",
    counterpartyRisk: String(row.counterpartyRiskScore ?? 0),
    riskLevel: row.counterpartyRiskLevel ?? "-",
    riskSource: row.riskSource ?? "-",
    interactionWeight: row.interactionWeight === null || row.interactionWeight === undefined ? "-" : String(row.interactionWeight),
    snapshotStatus: row.snapshotStatus ?? "not_checked",
    score: String(row.scoreContribution),
    evidence: row.evidenceClass,
    skippedReason: row.skippedReason ?? "-"
  }));
  const columns = [
    "direction",
    "counterparty",
    "volume",
    "share",
    "txs",
    "seen",
    "analyzed",
    "expanded",
    "enriched",
    "label",
    "cachedRisk",
    "service",
    "identity",
    "counterpartyRisk",
    "riskLevel",
    "riskSource",
    "interactionWeight",
    "snapshotStatus",
    "score",
    "evidence",
    "skippedReason"
  ] as const;
  const widths = new Map<string, number>();
  for (const column of columns) {
    widths.set(column, Math.max(column.length, ...rows.map((row) => row[column].length)));
  }
  const render = (values: Record<typeof columns[number], string>): string =>
    columns.map((column) => values[column].padEnd(widths.get(column) ?? column.length)).join("  ");
  const header = render(Object.fromEntries(columns.map((column) => [column, column])) as Record<typeof columns[number], string>);
  const divider = columns.map((column) => "-".repeat(widths.get(column) ?? column.length)).join("  ");
  if (rows.length === 0) return `${header}\n${divider}\n(no direct counterparty rows available)`;
  return [header, divider, ...rows.map(render)].join("\n");
}
