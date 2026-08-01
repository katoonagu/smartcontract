import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import type {
  MoneyOriginPath,
  NarrativeFactV2,
  OperationalFlowProfile,
  RecentFlowPrincipalTransferV1,
  UsddPsmRouteObservationV1,
  WhereIsMoneyReport
} from "../types";
import { calculateHistoricalTransitBreakdown } from "../forensics/historicalTransitScore";
import {
  collectUsddPsmRouteObservations,
  USDD_PSM_USDT_RESERVE_ADDRESSES
} from "../forensics/usddPsmRouteObservation";
import { buildUsddPsmExposure } from "../risk/usddPsmExposure";
import { telegramAddressRef } from "./forensicPresentation";

export type WherePresentationRouteV1 = {
  routeId: string;
  direction: "inbound" | "outbound";
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  asset: "USDT";
  share: number | null;
  transferCount: number;
  evidenceIds: string[];
};

export type WhereTelegramPresentationV1 = {
  facts: NarrativeFactV2[];
  routes: WherePresentationRouteV1[];
  trueNoActivity: boolean;
};

function positiveRaw(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}

function exactShare(amountRaw: string, selectedAmountRaw: string): number | null {
  if (!positiveRaw(amountRaw) || !positiveRaw(selectedAmountRaw)) return null;
  const amount = BigInt(amountRaw);
  const selected = BigInt(selectedAmountRaw);
  if (amount > selected) return null;
  return Number(amount * 1_000_000n / selected) / 1_000_000;
}

function txHash(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function sourceEvidenceIds(report: WhereIsMoneyReport): Set<string> {
  return new Set((report.scoringEvidenceV2 ?? [])
    .filter((row) => row.subjectAddress === report.subjectAddress)
    .flatMap((row) => row.sourceEvidenceIds));
}

function sameEvidenceIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length || new Set(left).size !== left.length || new Set(right).size !== right.length) {
    return false;
  }
  const expected = new Set(left);
  return right.every((id) => expected.has(id));
}

function subjectBoundPsmPath(
  report: WhereIsMoneyReport,
  path: MoneyOriginPath,
  observation: UsddPsmRouteObservationV1,
  boundSourceEvidence: ReadonlySet<string>
): boolean {
  const selectedEvidenceId = path.balanceTransferEvidenceId;
  if (!selectedEvidenceId || !boundSourceEvidence.has(selectedEvidenceId) || path.steps.length === 0) return false;
  const first = path.steps[0]!;
  const last = path.steps.at(-1)!;
  const subjectBound = observation.direction === "inbound_from_psm"
    ? last.toAddress === report.subjectAddress && last.txHash === path.balanceTransferTxHash
    : first.fromAddress === report.subjectAddress;
  if (!subjectBound) return false;
  const expected = collectUsddPsmRouteObservations({
    mode: observation.mode,
    selectedAmountRaw: observation.selectedAmountRaw,
    paths: [path]
  }).find((candidate) =>
    candidate.direction === observation.direction &&
    candidate.serviceAddress === observation.serviceAddress
  );
  return expected !== undefined && expected.amountRaw === observation.amountRaw &&
    expected.selectedAmountRaw === observation.selectedAmountRaw && expected.hopCount === observation.hopCount &&
    expected.serviceIdentityExact === observation.serviceIdentityExact &&
    expected.amountContinuityExact === observation.amountContinuityExact &&
    expected.scoringEligible === observation.scoringEligible &&
    expected.ineligibilityReason === observation.ineligibilityReason &&
    sameEvidenceIds(expected.evidenceIds, observation.evidenceIds);
}

function exactPsmObservation(
  report: WhereIsMoneyReport,
  boundSourceEvidence: ReadonlySet<string>
): UsddPsmRouteObservationV1 | null {
  const expectedMode = report.coverageV2?.scope === "recent_flow" ? "recent_flow" : "where";
  return (report.usddPsmRouteObservations ?? []).find((observation) =>
    buildUsddPsmExposure(observation) !== null &&
    observation.mode === expectedMode &&
    observation.selectedAmountRaw === report.coverageV2?.selectedAmountRaw &&
    (report.originPaths ?? []).some((path) => subjectBoundPsmPath(report, path, observation, boundSourceEvidence))
  ) ?? null;
}

function exactGenericBridgeFact(
  report: WhereIsMoneyReport,
  path: MoneyOriginPath,
  boundSourceEvidence: ReadonlySet<string>
): NarrativeFactV2 | null {
  if (path.sourceExposureKind !== "bridge_router_dex" && path.sourceExposureKind !== "cross_chain_boundary") return null;
  if (path.steps.some((step) =>
    USDD_PSM_USDT_RESERVE_ADDRESSES.has(step.fromAddress) || USDD_PSM_USDT_RESERVE_ADDRESSES.has(step.toAddress)
  )) return null;
  const selectedEvidenceId = path.balanceTransferEvidenceId;
  const first = path.steps[0];
  const last = path.steps.at(-1);
  if (!selectedEvidenceId || !boundSourceEvidence.has(selectedEvidenceId) || !first || !last ||
    path.amountPreservationRatio !== 1 || last.toAddress !== report.subjectAddress ||
    last.txHash !== path.balanceTransferTxHash || path.rootSourceAddress !== first.fromAddress ||
    telegramAddressRef(first.fromAddress).url === null || telegramAddressRef(report.subjectAddress).url === null ||
    !path.steps.every((step, index) => txHash(step.txHash) && positiveRaw(step.amountRaw) &&
      path.txHashes.includes(step.txHash) && (index === 0 || path.steps[index - 1]!.toAddress === step.fromAddress))) {
    return null;
  }
  const amountRaw = path.amountUsage === null || path.amountUsage === undefined
    ? last.amountRaw
    : path.amountUsage.originalAmountRaw === last.amountRaw && positiveRaw(path.amountUsage.usedAmountRaw) &&
        BigInt(path.amountUsage.usedAmountRaw) <= BigInt(last.amountRaw)
      ? path.amountUsage.usedAmountRaw
      : null;
  const selectedAmountRaw = report.coverageV2?.selectedAmountRaw ?? null;
  const share = amountRaw && selectedAmountRaw ? exactShare(amountRaw, selectedAmountRaw) : null;
  if (!amountRaw || share === null) return null;
  const evidenceIds = unique([selectedEvidenceId, ...path.steps.map((step) => step.txHash)]);
  return {
    id: `telegram:bridge-path:${selectedEvidenceId}`,
    subjectAddress: report.subjectAddress,
    mode: "where",
    kind: "bridge_shared_liquidity",
    role: null,
    section: "money_origin",
    evidenceIds,
    isScoreDriver: false,
    direction: "incoming",
    amountRaw,
    share,
    txCount: path.steps.length,
    addresses: [telegramAddressRef(first.fromAddress), telegramAddressRef(report.subjectAddress)],
    txHashes: path.steps.map((step) => step.txHash),
    factTextKey: "bridge_shared_liquidity_inbound",
    meaningTextKey: null
  };
}

function psmFact(
  report: WhereIsMoneyReport,
  observation: UsddPsmRouteObservationV1
): NarrativeFactV2 | null {
  const share = exactShare(observation.amountRaw, observation.selectedAmountRaw);
  const service = observation.serviceAddress;
  if (share === null || service === null || observation.hopCount === null) return null;
  const inbound = observation.direction === "inbound_from_psm";
  const hashes = observation.evidenceIds.filter(txHash);
  return {
    id: `telegram:usdd-psm:${observation.evidenceIds.join(":")}`,
    subjectAddress: report.subjectAddress,
    mode: "where",
    kind: "usdd_psm_route",
    role: null,
    section: "money_origin",
    evidenceIds: unique(observation.evidenceIds),
    isScoreDriver: false,
    direction: inbound ? "incoming" : "outgoing",
    amountRaw: observation.amountRaw,
    share,
    txCount: observation.hopCount,
    addresses: inbound
      ? [telegramAddressRef(service), telegramAddressRef(report.subjectAddress)]
      : [telegramAddressRef(report.subjectAddress), telegramAddressRef(service)],
    txHashes: hashes,
    factTextKey: inbound
      ? "usdd_psm_inbound_shared_liquidity"
      : "usdd_psm_outbound_shared_liquidity",
    meaningTextKey: null
  };
}

function routeFromFact(fact: NarrativeFactV2): WherePresentationRouteV1 | null {
  const [from, to] = fact.addresses;
  if (!from || !to || fact.amountRaw === null || fact.txCount === null || fact.evidenceIds.length === 0 ||
    (fact.direction !== "incoming" && fact.direction !== "outgoing")) return null;
  return {
    routeId: `typed-${fact.id}`,
    direction: fact.direction === "incoming" ? "inbound" : "outbound",
    fromAddress: from.address,
    toAddress: to.address,
    amountRaw: fact.amountRaw,
    asset: "USDT",
    share: fact.share,
    transferCount: fact.txCount,
    evidenceIds: [...fact.evidenceIds]
  };
}

function exactRecentTransfer(
  transfer: RecentFlowPrincipalTransferV1,
  subjectAddress: string
): boolean {
  if (!txHash(transfer.txHash) || !positiveRaw(transfer.amountRaw) || transfer.economicRole !== "principal") return false;
  if (transfer.direction === "incoming") {
    return transfer.toAddress === subjectAddress && telegramAddressRef(transfer.fromAddress).url !== null;
  }
  return transfer.fromAddress === subjectAddress && telegramAddressRef(transfer.toAddress).url !== null;
}

function recentFlowFact(report: WhereIsMoneyReport): { fact: NarrativeFactV2; routes: WherePresentationRouteV1[] } | null {
  if (report.coverageV2?.scope !== "recent_flow" || report.recentFlowPrincipalTransfers === undefined) return null;
  const transfers = report.recentFlowPrincipalTransfers.filter((transfer) => exactRecentTransfer(transfer, report.subjectAddress));
  if (transfers.length === 0 || transfers.length !== report.recentFlowPrincipalTransfers.length) return null;
  const evidenceIds = transfers.map((transfer) => transfer.txHash);
  const fact: NarrativeFactV2 = {
    id: `telegram:recent-flow:${evidenceIds.join(":")}`,
    subjectAddress: report.subjectAddress,
    mode: "where",
    kind: "recent_flow_principal",
    role: null,
    section: "money_movement",
    evidenceIds,
    isScoreDriver: false,
    direction: null,
    amountRaw: transfers.reduce((sum, transfer) => sum + BigInt(transfer.amountRaw), 0n).toString(),
    share: null,
    txCount: transfers.length,
    addresses: [],
    txHashes: evidenceIds,
    factTextKey: "low_balance_latest_five_principal",
    meaningTextKey: null
  };
  return {
    fact,
    routes: transfers.map((transfer) => ({
      routeId: `recent-${transfer.txHash.toLowerCase()}`,
      direction: transfer.direction === "incoming" ? "inbound" : "outbound",
      fromAddress: transfer.fromAddress,
      toAddress: transfer.toAddress,
      amountRaw: transfer.amountRaw,
      asset: "USDT",
      share: null,
      transferCount: 1,
      evidenceIds: [transfer.txHash]
    }))
  };
}

function trueNoActivity(report: WhereIsMoneyReport): boolean {
  const value = report.coverageV2;
  return report.recentFlowPrincipalTransfers !== undefined && report.recentFlowPrincipalTransfers.length === 0 &&
    value?.scope === "recent_flow" && value.completeness === "complete" && value.limitations.length === 0 &&
    value.availableInboundTxCount === 0 && value.selectedInboundTxCount === 0;
}

function noActivityFact(report: WhereIsMoneyReport): NarrativeFactV2 {
  return {
    id: "telegram:recent-flow:no-principal-activity",
    subjectAddress: report.subjectAddress,
    mode: "where",
    kind: "no_principal_activity",
    role: null,
    section: "coverage",
    evidenceIds: ["coverage:recent-flow:complete-zero"],
    isScoreDriver: false,
    direction: null,
    amountRaw: null,
    share: null,
    txCount: null,
    addresses: [],
    txHashes: [],
    factTextKey: "true_no_principal_activity",
    meaningTextKey: null
  };
}

function exactDeepFacts(report: DeepAddressForensicReport | null | undefined): NarrativeFactV2[] {
  if (!report) return [];
  return (report.directCounterpartyInteractionProfiles ?? []).flatMap((profile) =>
    (profile.transfers ?? []).flatMap((transfer) => {
      const incoming = profile.direction === "inbound";
      const exact = profile.subjectAddress === report.subjectAddress && profile.txHashes.includes(transfer.txHash) &&
        txHash(transfer.txHash) && positiveRaw(transfer.amountRaw) && transfer.economicRole === "principal" &&
        (incoming
          ? transfer.fromAddress === profile.counterpartyAddress && transfer.toAddress === report.subjectAddress
          : transfer.fromAddress === report.subjectAddress && transfer.toAddress === profile.counterpartyAddress);
      if (!exact) return [];
      const exactSingleTransferAggregate = profile.txCount === 1 && profile.txHashes.length === 1 &&
        profile.transfers?.length === 1 && profile.txHashes[0] === transfer.txHash && profile.volumeRaw === transfer.amountRaw;
      return [{
        id: `deep-principal:${transfer.txHash.toLowerCase()}`,
        subjectAddress: report.subjectAddress,
        mode: "deep" as const,
        kind: "principal_transfer",
        role: null,
        section: "money_movement" as const,
        evidenceIds: [transfer.txHash],
        isScoreDriver: false,
        direction: incoming ? "incoming" as const : "outgoing" as const,
        amountRaw: transfer.amountRaw,
        share: exactSingleTransferAggregate && Number.isFinite(profile.volumeRatio) &&
          profile.volumeRatio >= 0 && profile.volumeRatio <= 1
          ? profile.volumeRatio
          : null,
        txCount: 1,
        addresses: incoming
          ? [telegramAddressRef(profile.counterpartyAddress), telegramAddressRef(report.subjectAddress)]
          : [telegramAddressRef(report.subjectAddress), telegramAddressRef(profile.counterpartyAddress)],
        txHashes: [transfer.txHash],
        factTextKey: "principal_transfer_context",
        meaningTextKey: null
      } satisfies NarrativeFactV2];
    })
  );
}

function collectorFact(profile: OperationalFlowProfile, subjectAddress: string): NarrativeFactV2 | null {
  if (profile.subjectAddress !== subjectAddress) return null;
  const calculated = calculateHistoricalTransitBreakdown({
    incomingVolumeRaw: profile.incomingVolumeRaw,
    outgoingVolumeRaw: profile.outgoingVolumeRaw,
    inflowToOutflowRatio: profile.inflowToOutflowRatio,
    bridgeDexRouterOutgoingRatio: profile.bridgeDexRouterOutgoingRatio,
    unknownContractOutgoingRatio: profile.unknownContractOutgoingRatio
  });
  const storedBreakdown = profile.historicalTransitBreakdown;
  const storedScore = Number.isFinite(profile.historicalTransitScore) ? profile.historicalTransitScore : calculated.score;
  const breakdownScore = storedBreakdown?.eligible && Number.isFinite(storedBreakdown.score) ? storedBreakdown.score : 0;
  if (!calculated.eligible || Math.min(calculated.score, storedScore, breakdownScore) < 60) return null;
  const destination = [...(Array.isArray(profile.topOutgoingCounterparties) ? profile.topOutgoingCounterparties : [])]
    .filter((row) => row.direction === "outgoing" && row.isTerminalLiquidity && positiveRaw(row.volumeRaw) &&
      Number.isSafeInteger(row.txCount) && row.txCount > 0 && telegramAddressRef(row.address).url !== null)
    .sort((left, right) => {
      const amount = BigInt(right.volumeRaw) - BigInt(left.volumeRaw);
      return amount > 0n ? 1 : amount < 0n ? -1 : left.address.localeCompare(right.address);
    })[0];
  if (!destination) return null;
  const share = exactShare(destination.volumeRaw, profile.incomingVolumeRaw);
  if (share === null) return null;
  const evidenceId = `operational_flow:${subjectAddress}`;
  return {
    id: `telegram:collector:${subjectAddress}:${destination.address}`,
    subjectAddress,
    mode: "deep",
    kind: "collector_context",
    role: null,
    section: "money_movement",
    evidenceIds: [evidenceId],
    isScoreDriver: false,
    direction: "outgoing",
    amountRaw: destination.volumeRaw,
    share,
    txCount: destination.txCount,
    addresses: [telegramAddressRef(subjectAddress), telegramAddressRef(destination.address)],
    txHashes: [],
    factTextKey: "collector_context_only",
    meaningTextKey: null
  };
}

function exactCollectorFacts(report: DeepAddressForensicReport | null | undefined): NarrativeFactV2[] {
  if (!report) return [];
  return (report.operationalFlowProfiles ?? [])
    .map((profile) => collectorFact(profile, report.subjectAddress))
    .filter((fact): fact is NarrativeFactV2 => fact !== null);
}

export function buildWhereTelegramPresentation(
  report: WhereIsMoneyReport,
  deepReport?: DeepAddressForensicReport | null
): WhereTelegramPresentationV1 {
  const facts = (report.narrativeFactsV2 ?? []).map((fact) => ({ ...fact }));
  const routes: WherePresentationRouteV1[] = [];
  const boundSourceEvidence = sourceEvidenceIds(report);
  const psm = exactPsmObservation(report, boundSourceEvidence);
  if (psm) {
    const fact = psmFact(report, psm);
    if (fact) {
      facts.push(fact);
      const route = routeFromFact(fact);
      if (route) routes.push(route);
      const preferredId = report.scoreAnchorV2?.preferredFactId;
      const preferred = facts.find((candidate) => candidate.id === preferredId && candidate.factTextKey.startsWith("score."));
      if (preferred && preferred.evidenceIds.some((id) =>
        (report.scoringEvidenceV2 ?? []).some((row) => row.id === id && row.sourceEvidenceIds.some((sourceId) => psm.evidenceIds.includes(sourceId)))
      )) {
        preferred.amountRaw = fact.amountRaw;
        preferred.share = fact.share;
        preferred.txCount = fact.txCount;
        preferred.direction = fact.direction;
        preferred.addresses = fact.addresses;
        preferred.txHashes = fact.txHashes;
      }
    }
  }

  for (const path of report.originPaths ?? []) {
    const fact = exactGenericBridgeFact(report, path, boundSourceEvidence);
    if (!fact) continue;
    facts.push(fact);
    const route = routeFromFact(fact);
    if (route) routes.push(route);
  }

  const recent = recentFlowFact(report);
  if (recent) {
    facts.push(recent.fact);
    routes.push(...recent.routes);
  }
  const noActivity = trueNoActivity(report);
  if (noActivity) facts.push(noActivityFact(report));

  const deepFacts = [...exactCollectorFacts(deepReport), ...exactDeepFacts(deepReport)];
  facts.push(...deepFacts);
  for (const fact of deepFacts) {
    const route = routeFromFact(fact);
    if (route) routes.push(route);
  }
  return { facts, routes, trueNoActivity: noActivity };
}
