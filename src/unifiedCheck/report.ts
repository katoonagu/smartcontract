import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import { SELECTED_ATTRIBUTION_POLICY } from "./selectedAttributionPolicy.generated";
import {
  canonicalizeUnifiedWalletMetrics,
  type WalletAmountAggregate,
  type WalletMetrics
} from "../wallet/metrics";
import type {
  AnalysisManifestV1,
  EvidenceBundleV1,
  ScoringBundleV1,
  TraversalClosureCertificateV1,
  UnifiedWalletReportV1
} from "./contracts";

type FactBound = {
  readonly factIds: readonly string[];
};

export type AmountShareV1 = {
  readonly scope: string;
  readonly amountRaw: string;
  readonly denominatorRaw: string;
  readonly sharePpm: number;
};

type AmountAggregateV1 = FactBound & {
  readonly key: string;
  readonly amount: AmountShareV1;
  readonly transferCount: number;
};

export type UnifiedWalletReportSection =
  | {
      readonly kind: "score_action";
      readonly score: number;
      readonly decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
      readonly action: "proceed" | "review" | "decline";
    }
  | {
      readonly kind: "score_drivers";
      readonly rows: readonly (FactBound & {
        readonly code: string;
        readonly collapsedFactCount: number;
      })[];
    }
  | {
      readonly kind: "balance_formation";
      readonly scope: "current_balance_attribution";
      readonly rows: readonly AmountAggregateV1[];
      readonly denominatorRaw: string;
    }
  | {
      readonly kind: "outgoing_movement";
      readonly scope: "all_direct_outgoing_to_snapshot";
      readonly rows: readonly AmountAggregateV1[];
      readonly denominatorRaw: string;
    }
  | {
      readonly kind: "services_boundaries";
      readonly rows: readonly (FactBound & {
        readonly service: string;
        readonly address: string;
        readonly direction: "incoming" | "outgoing";
        readonly directness: "direct" | "indirect";
        readonly amount: AmountShareV1;
        readonly transferCount: number;
      })[];
      readonly reconciliation: {
        readonly incoming: {
          readonly attributedAmountRaw: string;
          readonly denominatorRaw: string;
        };
        readonly outgoing: {
          readonly attributedAmountRaw: string;
          readonly denominatorRaw: string;
        };
      };
    }
  | {
      readonly kind: "contracts_approvals";
      readonly rows: readonly (FactBound & {
        readonly code: string;
        readonly counterparty: string | null;
        readonly amountRaw: string | null;
      })[];
    }
  | {
      readonly kind: "behavior_connections";
      readonly rows: readonly (FactBound & {
        readonly code: string;
        readonly role: string;
        readonly collapsedFactCount: number;
      })[];
    }
  | {
      readonly kind: "wallet_profile";
      readonly profile: WalletMetrics["profile"];
      readonly asOfBlock: string;
      readonly observedAt: string;
      readonly consistency: WalletMetrics["consistency"];
    }
  | {
      readonly kind: "coverage";
      readonly scoringAuthority: false;
      readonly dimensions: WalletMetrics["coverage"];
    }
  | {
      readonly kind: "conclusion";
      readonly code: "low_risk" | "manual_review" | "decline";
    }
  | {
      readonly kind: "snapshot";
      readonly blockNumber: string;
      readonly blockHash: string;
      readonly timestamp: string;
    };

export type UnifiedWalletDossierV1 = UnifiedWalletReportV1 & {
  readonly dossierVersion: "unified-wallet-dossier-v1";
  readonly selectedAttributionPolicy: "fifo" | "lifo" | "proportional";
  readonly sections: readonly UnifiedWalletReportSection[];
  readonly currentBalanceAttribution: Extract<
    UnifiedWalletReportSection,
    { kind: "balance_formation" }
  >;
  readonly latestPrincipalInboundEventsScope:
    "latest_five_principal_inbound_events";
  readonly latestPrincipalInboundEvents:
    readonly WalletMetrics["principalInboundEvents"][number][];
  readonly negativeFacts: readonly WalletMetrics["negativeFacts"][number][];
  readonly factInventory: {
    readonly version: "report-fact-inventory-v1";
    readonly canonicalFactIds: readonly string[];
    readonly sections: readonly {
      readonly sectionId: UnifiedWalletReportSection["kind"];
      readonly factIds: readonly string[];
      readonly collapsedFactCount: number;
    }[];
  };
};

function fail(code: string): never {
  throw new Error(code);
}

function sumRaw(values: readonly string[]): string {
  return values.reduce((sum, value) => sum + BigInt(value), 0n).toString();
}

function share(
  scope: string,
  amountRaw: string,
  denominatorRaw: string,
  invalidCode = "unified_report_amount_scope_invalid"
): AmountShareV1 {
  const amount = BigInt(amountRaw);
  const denominator = BigInt(denominatorRaw);
  if (amount < 0n || denominator < 0n || amount > denominator) {
    fail(invalidCode);
  }
  return {
    scope,
    amountRaw,
    denominatorRaw,
    sharePpm: denominator === 0n
      ? 0
      : Number(amount * 1_000_000n / denominator)
  };
}

function sortedFactIds(
  factIds: readonly string[],
  allowed: ReadonlySet<string>
): string[] {
  const result = [...new Set(factIds)].sort();
  if (result.length === 0 || result.some((id) => !allowed.has(id))) {
    fail("unified_report_fact_binding_invalid");
  }
  return result;
}

function amountRows(
  rows: readonly WalletAmountAggregate[],
  scope: string,
  denominatorRaw: string,
  allowedFacts: ReadonlySet<string>
): AmountAggregateV1[] {
  const total = BigInt(sumRaw(rows.map((row) => row.amountRaw)));
  if (total > BigInt(denominatorRaw)) {
    fail("unified_report_amount_total_exceeds_scope");
  }
  return [...rows]
    .sort((left, right) =>
      left.key.localeCompare(right.key) ||
      left.amountRaw.localeCompare(right.amountRaw)
    )
    .map((row) => ({
      key: row.key,
      amount: share(scope, row.amountRaw, denominatorRaw),
      transferCount: row.transferCount,
      factIds: sortedFactIds(row.factIds, allowedFacts)
    }));
}

function sectionFacts(section: UnifiedWalletReportSection): string[] {
  if (
    section.kind === "score_action" ||
    section.kind === "wallet_profile" ||
    section.kind === "coverage" ||
    section.kind === "conclusion" ||
    section.kind === "snapshot"
  ) {
    return [];
  }
  return [...new Set(section.rows.flatMap((row) => row.factIds))].sort();
}

function collapsedCount(section: UnifiedWalletReportSection): number {
  if (
    section.kind === "score_drivers" ||
    section.kind === "behavior_connections"
  ) {
    return section.rows.reduce(
      (sum, row) => sum + row.collapsedFactCount,
      0
    );
  }
  if (
    section.kind === "score_action" ||
    section.kind === "wallet_profile" ||
    section.kind === "coverage" ||
    section.kind === "conclusion" ||
    section.kind === "snapshot"
  ) {
    return 0;
  }
  return section.rows.length;
}

export function buildUnifiedWalletReport(input: {
  manifest: AnalysisManifestV1;
  evidence: EvidenceBundleV1;
  closure: TraversalClosureCertificateV1;
  scoring: ScoringBundleV1;
  walletMetrics: WalletMetrics;
  selectedAttributionPolicy: "fifo" | "lifo" | "proportional";
}): UnifiedWalletDossierV1 {
  const manifestHash = fingerprintCanonicalArtifact(input.manifest);
  const evidenceHash = fingerprintCanonicalArtifact(input.evidence);
  const closureHash = fingerprintCanonicalArtifact(input.closure);
  const scoringHash = fingerprintCanonicalArtifact(input.scoring);
  if (
    input.evidence.analysisManifestHash !== manifestHash ||
    input.closure.analysisManifestHash !== manifestHash ||
    input.closure.snapshotHash !== input.manifest.snapshotHash ||
    input.scoring.evidenceBundleHash !== evidenceHash ||
    input.scoring.traversalClosureHash !== closureHash ||
    input.scoring.policyVersion !== "scoring-signal-matrix-v4"
  ) {
    fail("unified_report_hash_chain_mismatch");
  }
  if (
    input.selectedAttributionPolicy !==
      SELECTED_ATTRIBUTION_POLICY.policy
  ) {
    fail("unified_report_attribution_policy_mismatch");
  }
  const metrics = canonicalizeUnifiedWalletMetrics(input.walletMetrics);
  if (
    metrics.asOfBlock !== input.manifest.confirmedBlockNumber ||
    metrics.observedAt !== input.manifest.confirmedBlockTimestamp
  ) {
    fail("unified_report_metric_snapshot_mismatch");
  }
  const canonicalFactIds = [...input.evidence.canonicalFactIds];
  const canonical = [...new Set(canonicalFactIds)].sort();
  if (
    canonical.length === 0 ||
    JSON.stringify(canonical) !== JSON.stringify(canonicalFactIds)
  ) {
    fail("unified_report_evidence_inventory_invalid");
  }
  const allowedFacts = new Set(canonical);

  const scoreAction: UnifiedWalletReportSection = {
    kind: "score_action",
    score: input.scoring.score,
    decision: input.scoring.decision,
    action: input.scoring.decision === "ACCEPTABLE"
      ? "proceed"
      : input.scoring.decision === "REVIEW"
        ? "review"
        : "decline"
  };
  const scoreDrivers: UnifiedWalletReportSection = {
    kind: "score_drivers",
    rows: [...metrics.scoreDrivers]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((driver) => ({
        code: driver.code,
        factIds: sortedFactIds(driver.factIds, allowedFacts),
        collapsedFactCount: driver.collapsedFactCount
      }))
  };
  const balanceFormation: Extract<
    UnifiedWalletReportSection,
    { kind: "balance_formation" }
  > = {
    kind: "balance_formation",
    scope: metrics.currentBalanceAttribution.scope,
    denominatorRaw: metrics.currentBalanceAttribution.denominatorRaw,
    rows: amountRows(
      metrics.currentBalanceAttribution.rows,
      metrics.currentBalanceAttribution.scope,
      metrics.currentBalanceAttribution.denominatorRaw,
      allowedFacts
    )
  };
  const outgoingMovement: UnifiedWalletReportSection = {
    kind: "outgoing_movement",
    scope: metrics.outgoingMovement.scope,
    denominatorRaw: metrics.outgoingMovement.denominatorRaw,
    rows: amountRows(
      metrics.outgoingMovement.rows,
      metrics.outgoingMovement.scope,
      metrics.outgoingMovement.denominatorRaw,
      allowedFacts
    )
  };

  const serviceRows = [...metrics.serviceLinks]
    .sort((left, right) =>
      left.direction.localeCompare(right.direction) ||
      left.directness.localeCompare(right.directness) ||
      left.service.localeCompare(right.service) ||
      left.address.localeCompare(right.address)
    )
    .map((service) => ({
      service: service.service,
      address: service.address,
      direction: service.direction,
      directness: service.directness,
      amount: share(
        `${service.direction}_service_links`,
        service.amountRaw,
        service.denominatorRaw,
        "unified_report_service_total_exceeds_scope"
      ),
      transferCount: service.transferCount,
      factIds: sortedFactIds(service.factIds, allowedFacts)
    }));
  const reconciliation = (direction: "incoming" | "outgoing") => {
    const rows = serviceRows.filter((row) => row.direction === direction);
    const denominators = [...new Set(rows.map((row) =>
      row.amount.denominatorRaw
    ))];
    if (denominators.length > 1) {
      fail("unified_report_service_denominator_conflict");
    }
    const attributedAmountRaw = sumRaw(rows.map((row) =>
      row.amount.amountRaw
    ));
    const denominatorRaw = denominators[0] ?? "0";
    if (BigInt(attributedAmountRaw) > BigInt(denominatorRaw)) {
      fail("unified_report_service_total_exceeds_scope");
    }
    return { attributedAmountRaw, denominatorRaw };
  };
  const services: UnifiedWalletReportSection = {
    kind: "services_boundaries",
    rows: serviceRows,
    reconciliation: {
      incoming: reconciliation("incoming"),
      outgoing: reconciliation("outgoing")
    }
  };
  const contracts: UnifiedWalletReportSection = {
    kind: "contracts_approvals",
    rows: [...metrics.contractsAndApprovals]
      .sort((left, right) =>
        left.code.localeCompare(right.code) ||
        (left.counterparty ?? "").localeCompare(right.counterparty ?? "")
      )
      .map((item) => ({
        code: item.code,
        counterparty: item.counterparty,
        amountRaw: item.amountRaw,
        factIds: sortedFactIds(item.factIds, allowedFacts)
      }))
  };
  const behavior: UnifiedWalletReportSection = {
    kind: "behavior_connections",
    rows: [...metrics.behaviorAndConnections]
      .sort((left, right) =>
        left.code.localeCompare(right.code) ||
        left.role.localeCompare(right.role)
      )
      .map((item) => ({
        code: item.code,
        role: item.role,
        collapsedFactCount: item.collapsedFactCount,
        factIds: sortedFactIds(item.factIds, allowedFacts)
      }))
  };
  const profile: UnifiedWalletReportSection = {
    kind: "wallet_profile",
    profile: metrics.profile,
    asOfBlock: metrics.asOfBlock,
    observedAt: metrics.observedAt,
    consistency: metrics.consistency
  };
  const coverage: UnifiedWalletReportSection = {
    kind: "coverage",
    scoringAuthority: false,
    dimensions: [...metrics.coverage].sort((left, right) =>
      left.direction.localeCompare(right.direction)
    )
  };
  const conclusion: UnifiedWalletReportSection = {
    kind: "conclusion",
    code: input.scoring.decision === "ACCEPTABLE"
      ? "low_risk"
      : input.scoring.decision === "REVIEW"
        ? "manual_review"
        : "decline"
  };
  const snapshot: UnifiedWalletReportSection = {
    kind: "snapshot",
    blockNumber: input.manifest.confirmedBlockNumber,
    blockHash: input.manifest.confirmedBlockHash,
    timestamp: input.manifest.confirmedBlockTimestamp
  };
  const sections = [
    scoreAction,
    scoreDrivers,
    balanceFormation,
    outgoingMovement,
    services,
    contracts,
    behavior,
    profile,
    coverage,
    conclusion,
    snapshot
  ] as const;
  const factInventory = {
    version: "report-fact-inventory-v1" as const,
    canonicalFactIds: canonical,
    sections: sections.map((section) => ({
      sectionId: section.kind,
      factIds: sectionFacts(section),
      collapsedFactCount: collapsedCount(section)
    }))
  };
  const latestPrincipalInboundEvents = [...metrics.principalInboundEvents]
    .sort((left, right) =>
      right.timestamp.localeCompare(left.timestamp) ||
      left.eventId.localeCompare(right.eventId)
    )
    .slice(0, 5)
    .map((event) => ({
      ...event,
      factIds: sortedFactIds(event.factIds, allowedFacts)
    }));
  const negativeFacts = metrics.negativeFacts
    .filter((fact) => fact.scopeStatus === "COMPLETED")
    .sort((left, right) =>
      left.scope.localeCompare(right.scope) ||
      left.code.localeCompare(right.code)
    )
    .map((fact) => ({
      ...fact,
      factIds: sortedFactIds(fact.factIds, allowedFacts)
    }));

  return {
    version: "unified-wallet-report-v1",
    schemaVersion: 1,
    dossierVersion: "unified-wallet-dossier-v1",
    analysisManifestHash: manifestHash,
    evidenceBundleHash: evidenceHash,
    traversalClosureHash: closureHash,
    scoringBundleHash: scoringHash,
    subjectAddress: input.manifest.subjectAddress,
    score: input.scoring.score,
    decision: input.scoring.decision,
    factInventoryHash: fingerprintCanonicalArtifact(factInventory),
    selectedAttributionPolicy: input.selectedAttributionPolicy,
    sections,
    currentBalanceAttribution: balanceFormation,
    latestPrincipalInboundEventsScope:
      "latest_five_principal_inbound_events",
    latestPrincipalInboundEvents,
    negativeFacts,
    factInventory
  };
}
