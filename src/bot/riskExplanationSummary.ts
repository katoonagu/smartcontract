import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import { normalizeNotificationReason } from "../alerts/notificationText";
import type { UnifiedWalletRiskResult } from "../risk/unifiedWalletRisk";
import type {
  ApprovalDrainProvenanceProfile,
  BotLocale,
  BoundaryExposureProfile,
  DirectCounterpartyInteractionProfile,
  RiskLevel,
  RiskReport,
  SourceBundleExposureProfile,
  UserExchangeDecision,
  WhereIsMoneyReport
} from "../types";

export type RiskExplanationDecision = UserExchangeDecision | "NO_FINAL_DECISION";
export type RiskExplanationSource = "fast" | "where" | "deep" | "unified" | "coverage";
export type RiskExplanationMode = "fast" | "where" | "deep";

export type RiskExplanationFactKind =
  | "hard_evidence"
  | "source_policy"
  | "behavior_context"
  | "service_boundary"
  | "coverage_limit"
  | "absent_evidence"
  | "recommendation";

export type RiskExplanationFact = {
  kind: RiskExplanationFactKind;
  source: RiskExplanationSource;
  priority: number;
  dedupeKey: string;
  textRu: string;
  textEn: string;
  detailRu?: string;
  detailEn?: string;
  actionRu?: string;
  actionEn?: string;
};

export type RiskExplanationModeSection = {
  mode: RiskExplanationMode;
  titleRu: string;
  titleEn: string;
  facts: RiskExplanationFact[];
};

export type RiskExplanationSummary = {
  address: string;
  decision: RiskExplanationDecision;
  score: number | null;
  level: RiskLevel | null;
  shortConclusionRu: string;
  shortConclusionEn: string;
  primaryReasons: RiskExplanationFact[];
  modeSections: RiskExplanationModeSection[];
  possibleMeaningsRu: string[];
  possibleMeaningsEn: string[];
  limitationsRu: string[];
  limitationsEn: string[];
  recommendationsRu: string[];
  recommendationsEn: string[];
};

export type RiskExplanationInput = {
  address: string;
  whereReport: WhereIsMoneyReport;
  unifiedRisk: UnifiedWalletRiskResult;
  finalDecision: RiskExplanationDecision;
  fastReport?: RiskReport | null;
  deepReport?: DeepAddressForensicReport | null;
};

export type NoFinalRiskExplanationInput = {
  address: string;
  whereReport: WhereIsMoneyReport;
};

type MutableSections = Record<RiskExplanationMode, RiskExplanationFact[]>;

const highRiskLabels = new Set([
  "scam",
  "reported_scam",
  "stolen_funds",
  "phishing",
  "mixer_like",
  "risky_contract",
  "darknet_exchange"
]);

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function addFact(facts: RiskExplanationFact[], fact: RiskExplanationFact): void {
  const existing = facts.find((item) => item.dedupeKey === fact.dedupeKey);
  if (!existing) {
    facts.push(fact);
    return;
  }
  if (fact.priority < existing.priority) {
    facts[facts.indexOf(existing)] = fact;
  }
}

function sortedFacts(facts: RiskExplanationFact[]): RiskExplanationFact[] {
  return [...facts].sort((left, right) =>
    left.priority - right.priority ||
    left.dedupeKey.localeCompare(right.dedupeKey)
  );
}

function pushFact(
  allFacts: RiskExplanationFact[],
  sections: MutableSections,
  section: RiskExplanationMode,
  fact: RiskExplanationFact
): void {
  addFact(allFacts, fact);
  addFact(sections[section], fact);
}

function unique(lines: string[]): string[] {
  return lines.filter((line, index, all) => line.trim().length > 0 && all.indexOf(line) === index);
}

function exactApprovalDrainProfile(profiles: ApprovalDrainProvenanceProfile[] | undefined): ApprovalDrainProvenanceProfile | null {
  return profiles?.find((profile) => profile.evidenceStrength === "exact_approval_and_transfer_from") ?? null;
}

function approvalDrainText(profile: ApprovalDrainProvenanceProfile | null): { ru: string; en: string } {
  if (!profile || profile.hopDepth === 0) {
    return {
      ru: "Найдена точная drainer-цепочка: approve USDT -> transferFrom -> проверяемый адрес получил средства. Найдена точная approval-drain цепочка.",
      en: "Exact drainer chain found: approve USDT -> transferFrom -> the checked address received funds. Exact approval-drain evidence was found."
    };
  }
  return {
    ru: `Найдена точная drainer-цепочка: после approve и transferFrom средства дошли до проверяемого адреса через ${profile.hopDepth} hop. Найдена точная approval-drain цепочка.`,
    en: `Exact drainer chain found: after approve and transferFrom, funds reached the checked address through ${profile.hopDepth} hop(s). Exact approval-drain evidence was found.`
  };
}

function coverageLine(report: WhereIsMoneyReport, locale: BotLocale): string {
  const coverage = report.coverage;
  const ratio = isFiniteNumber(coverage.coverageRatio)
    ? coverage.coverageRatio
    : isFiniteNumber(coverage.currentBalanceCoverageRatio)
      ? coverage.currentBalanceCoverageRatio
      : 0;
  const count = coverage.selectedInboundTxCount;
  if (coverage.checkedScope === "drain_episode") {
    const episodeRatio = isFiniteNumber(coverage.episodeCoverageRatio)
      ? coverage.episodeCoverageRatio
      : isFiniteNumber(coverage.drainEpisode?.episodeCoverageRatio)
        ? coverage.drainEpisode.episodeCoverageRatio
        : ratio;
    const anchorContext = isFiniteNumber(coverage.anchorCoverageRatio)
      ? locale === "ru"
        ? `; anchor coverage ${formatPercent(coverage.anchorCoverageRatio)}`
        : `; anchor coverage ${formatPercent(coverage.anchorCoverageRatio)}`
      : "";
    return locale === "ru"
      ? `Проверили ${formatPercent(episodeRatio)} выбранного drain episode${anchorContext}.`
      : `Checked ${formatPercent(episodeRatio)} of the selected drain episode${anchorContext}.`;
  }
  if (coverage.checkedScope === "selected_anchor") {
    const anchorRatio = isFiniteNumber(coverage.anchorCoverageRatio) ? coverage.anchorCoverageRatio : ratio;
    return locale === "ru"
      ? `Проверили ${formatPercent(anchorRatio)} выбранного recent-flow anchor across ${count} входящих USDT-перевода.`
      : `Checked ${formatPercent(anchorRatio)} of the selected recent-flow anchor across ${count} inbound USDT transfer(s).`;
  }
  if (coverage.checkedScope === "recent_flow") {
    return locale === "ru"
      ? "Проверили recent-flow контекст кошелька; выбранного outgoing anchor не было."
      : "Checked recent-flow wallet context; no selected outgoing anchor was available.";
  }
  return locale === "ru"
    ? `Проверили ${Math.round(ratio * 100)}% выбранной суммы: ${count} входящих USDT-перевода.`
    : `Checked ${Math.round(ratio * 100)}% of the target amount across ${count} inbound USDT transfer(s).`;
}

function coverageFact(report: WhereIsMoneyReport, priority: number): RiskExplanationFact {
  const ru = coverageLine(report, "ru").replace(/\.$/, "");
  const en = coverageLine(report, "en").replace(/\.$/, "");
  return {
    kind: "coverage_limit",
    source: "coverage",
    priority,
    dedupeKey: `coverage:${report.coverage.checkedScope ?? "amount"}`,
    textRu: `${ru}; это не означает полную историю адреса.`,
    textEn: `${en}; this does not mean the full address history is complete.`
  };
}

function hasSavedApprovalDrainMarker(report: RiskReport | null | undefined): boolean {
  return report?.reasons.some((reason) =>
    reason.code === "internal_label_approval_drain_proximity" ||
    reason.message.toLowerCase().includes("exact upstream approval-drain provenance linked to this address")
  ) === true;
}

function firstBoundary(report: DeepAddressForensicReport | null | undefined): BoundaryExposureProfile | null {
  const profile = report?.boundaryExposureProfiles?.[0] ?? null;
  return profile && profile.contextScore > 0 && profile.flows.length > 0 ? profile : null;
}

function topDirectCounterparty(report: DeepAddressForensicReport | null | undefined): DirectCounterpartyInteractionProfile | null {
  return report?.directCounterpartyInteractionProfiles
    ?.filter((profile) => profile.scoreContribution > 0)
    .sort((left, right) => right.scoreContribution - left.scoreContribution || right.volumeRatio - left.volumeRatio)[0] ?? null;
}

function addFastFacts(input: RiskExplanationInput, allFacts: RiskExplanationFact[], sections: MutableSections): void {
  const fast = input.fastReport ?? input.whereReport.fastWalletRisk;
  if (!fast) return;
  if (fast.reasons.some((reason) => reason.code === "stablecoin_usdt_blacklisted")) {
    pushFact(allFacts, sections, "fast", {
      kind: "hard_evidence",
      source: "fast",
      priority: 15,
      dedupeKey: "usdt_blacklist",
      textRu: "Адрес находится в активном TRC20 USDT blacklist.",
      textEn: "The address is in the active TRC20 USDT blacklist.",
      actionRu: "Не принимать депозит автоматически.",
      actionEn: "Do not accept the deposit automatically."
    });
  }
  if (hasSavedApprovalDrainMarker(fast)) {
    pushFact(allFacts, sections, "fast", {
      kind: "hard_evidence",
      source: "fast",
      priority: 12,
      dedupeKey: "approval_drain_saved_marker",
      textRu: "Раньше система уже находила связь этого адреса с точной drainer-цепочкой. Ранее система уже сохраняла этот адрес как связанный с exact approval-drain.",
      textEn: "The system had already found this address linked to an exact drainer chain."
    });
  }
  const otherHardReason = fast.reasons.find((reason) =>
    reason.scoreImpact >= 85 &&
    reason.code !== "stablecoin_usdt_blacklisted" &&
    reason.code !== "internal_label_approval_drain_proximity"
  );
  if (otherHardReason) {
    pushFact(allFacts, sections, "fast", {
      kind: "hard_evidence",
      source: "fast",
      priority: 25,
      dedupeKey: `fast_hard:${otherHardReason.code}`,
      textRu: normalizeNotificationReason(otherHardReason.message, "ru"),
      textEn: `Hard evidence: ${normalizeNotificationReason(otherHardReason.message, "en")}`
    });
  }
  if (fast.score > 0 && !fast.reasons.some((reason) => reason.scoreImpact >= 85)) {
    pushFact(allFacts, sections, "fast", {
      kind: "behavior_context",
      source: "fast",
      priority: 82,
      dedupeKey: "fast_behavior_context",
      textRu: "Быстрая проверка нашла поведенческий риск. Это контекст, не точное доказательство происхождения средств.",
      textEn: "FastCheck found behavioral risk. This is context, not exact source-of-funds proof."
    });
  }
}

function sourceExposureFacts(exposure: SourceBundleExposureProfile | undefined): RiskExplanationFact[] {
  if (!exposure) return [];
  const facts: RiskExplanationFact[] = [];
  if (isFiniteNumber(exposure.htxHuobiShare) && exposure.htxHuobiShare > 0) {
    facts.push({
      kind: "source_policy",
      source: "where",
      priority: 55,
      dedupeKey: "where_htx_huobi_selected_amount",
      textRu: `В выбранной сумме найден источник HTX/Huobi: ${formatPercent(exposure.htxHuobiShare)}.`,
      textEn: `HTX/Huobi funds ${formatPercent(exposure.htxHuobiShare)} of the selected amount.`,
      detailRu: `${formatPercent(exposure.htxHuobiShare)} выбранной суммы связано с HTX/Huobi.`,
      detailEn: `${formatPercent(exposure.htxHuobiShare)} of the selected amount is linked to HTX/Huobi.`
    });
  }
  if (isFiniteNumber(exposure.bridgeRouterDexShare) && exposure.bridgeRouterDexShare > 0) {
    facts.push({
      kind: "source_policy",
      source: "where",
      priority: 56,
      dedupeKey: "where_bridge_router_dex",
      textRu: "Источник выбранной суммы попадает под policy-риск. Это не доказывает кражу, но депозит нельзя принимать автоматически.",
      textEn: "Source-policy evidence reached the decline or manual-review threshold. The selected amount source falls under policy risk. This does not prove theft, but the deposit cannot be accepted automatically.",
      detailRu: `Часть цепочки проходит через bridge, router или DEX: ${formatPercent(exposure.bridgeRouterDexShare)}.`,
      detailEn: `Part of the chain passes through bridge, router, or DEX: ${formatPercent(exposure.bridgeRouterDexShare)}.`
    });
  }
  if (isFiniteNumber(exposure.riskyLabelShare) && exposure.riskyLabelShare > 0) {
    facts.push({
      kind: "source_policy",
      source: "where",
      priority: 57,
      dedupeKey: "where_risky_label_share",
      textRu: `В выбранной сумме есть источник с рискованной меткой: ${formatPercent(exposure.riskyLabelShare)}.`,
      textEn: `A risky-label source is present in the selected amount: ${formatPercent(exposure.riskyLabelShare)}.`
    });
  }
  if (exposure.unresolvedBoundary) {
    facts.push({
      kind: "coverage_limit",
      source: "where",
      priority: 72,
      dedupeKey: `where_unresolved_boundary:${exposure.unresolvedBoundary.kind}`,
      textRu: "Чистый CEX-источник не доказан полностью.",
      textEn: `The graph stopped before resolving a material ${sourceUnresolvedBoundaryLabel(exposure.unresolvedBoundary.kind, "en")}.`,
      detailRu: exposure.unresolvedBoundary.reason,
      detailEn: exposure.unresolvedBoundary.reason
    });
  }
  return facts;
}

function sourceUnresolvedBoundaryLabel(
  kind: NonNullable<SourceBundleExposureProfile["unresolvedBoundary"]>["kind"],
  locale: BotLocale
): string {
  switch (kind) {
    case "htx_huobi":
      return locale === "en" ? "HTX/Huobi source boundary" : "граница источника HTX/Huobi";
    case "bridge_router_dex":
      return locale === "en" ? "bridge/router/DEX boundary" : "граница bridge/router/DEX";
    case "unknown_contract":
      return locale === "en" ? "unknown contract boundary" : "граница неизвестного контракта";
    case "unknown":
      return locale === "en" ? "unknown source boundary" : "неизвестная граница источника";
    case "clean_cex":
    default:
      return locale === "en" ? "source boundary" : "граница источника";
  }
}

function addWhereFacts(input: RiskExplanationInput, allFacts: RiskExplanationFact[], sections: MutableSections): void {
  const report = input.whereReport;
  const exactDrain = exactApprovalDrainProfile(report.approvalDrainProvenanceProfiles);
  const hasApprovalDrain = report.assessment.hardBadEvidence.some((evidence) => evidence.kind === "approval_drain") ||
    exactDrain !== null;
  if (hasApprovalDrain) {
    const text = approvalDrainText(exactDrain);
    pushFact(allFacts, sections, "where", {
      kind: "hard_evidence",
      source: "where",
      priority: 10,
      dedupeKey: "approval_drain_exact",
      textRu: text.ru,
      textEn: text.en,
      actionRu: "Не принимать депозит автоматически.",
      actionEn: "Do not accept the deposit automatically."
    });
  }

  for (const evidence of report.assessment.hardBadEvidence) {
    if (evidence.kind === "approval_drain") continue;
    if (evidence.kind === "sanctioned_service") {
      pushFact(allFacts, sections, "where", {
        kind: "hard_evidence",
        source: "where",
        priority: 20,
        dedupeKey: `sanctioned:${evidence.message}`,
        textRu: "Найдена связь с сервисом из санкционного списка. Такой источник нельзя принимать автоматически.",
        textEn: "A sanctioned-service link was found. This source cannot be accepted automatically.",
        detailRu: normalizeNotificationReason(evidence.message, "ru"),
        detailEn: normalizeNotificationReason(evidence.message, "en")
      });
      continue;
    }
    if (evidence.kind === "scam_or_blacklist") {
      pushFact(allFacts, sections, "where", {
        kind: "hard_evidence",
        source: "where",
        priority: 25,
        dedupeKey: `hard:${evidence.kind}:${evidence.message}`,
        textRu: normalizeNotificationReason(evidence.message, "ru"),
        textEn: normalizeNotificationReason(evidence.message, "en")
      });
      continue;
    }
    pushFact(allFacts, sections, "where", {
      kind: "behavior_context",
      source: "where",
      priority: 58,
      dedupeKey: `where_context:${evidence.kind}:${evidence.message}`,
      textRu: normalizeNotificationReason(evidence.message, "ru"),
      textEn: normalizeNotificationReason(evidence.message, "en")
    });
  }

  for (const fact of sourceExposureFacts(report.sourceBundleExposure)) {
    pushFact(allFacts, sections, "where", fact);
  }

  if (report.subjectExposureProfile?.htxHuobiIncomingShare && report.subjectExposureProfile.htxHuobiIncomingShare > 0) {
    pushFact(allFacts, sections, "where", {
      kind: "behavior_context",
      source: "where",
      priority: 65,
      dedupeKey: "where_historical_htx_huobi",
      textRu: "Историческая связь с HTX/Huobi есть, но это не доказывает источник выбранной суммы.",
      textEn: "Historical HTX/Huobi exposure is context, not selected-amount source proof."
    });
  }

  if (report.subjectExposureProfile && (
    report.subjectExposureProfile.bridgeRouterDexVolumeShare > 0 ||
    report.subjectExposureProfile.unknownContractVolumeShare > 0
  )) {
    pushFact(allFacts, sections, "where", {
      kind: "behavior_context",
      source: "where",
      priority: 66,
      dedupeKey: "where_historical_service_boundary",
      textRu: "Историческая сервисная граница есть, но это контекст.",
      textEn: "Historical service-boundary exposure exists but is contextual."
    });
  }

  const rawReasons = [...report.decisionReasons, ...report.assessment.reasons].join(" | ").toLowerCase();
  if (rawReasons.includes("clean cex origin is not fully proven") || rawReasons.includes("clean_source_not_fully_proven")) {
    pushFact(allFacts, sections, "where", {
      kind: "coverage_limit",
      source: "where",
      priority: 52,
      dedupeKey: "clean_cex_not_fully_proven",
      textRu: "Чистый CEX-источник не доказан полностью.",
      textEn: "Clean CEX origin is not fully proven.",
      actionRu: "Запросить подтверждение происхождения средств.",
      actionEn: "Request source-of-funds evidence."
    });
  }

  const contractSuspicion = report.assessment.contractSuspicionEvidence[0] ?? null;
  if (contractSuspicion) {
    const fallback = `AI contract verdict: ${contractSuspicion.kind}`;
    pushFact(allFacts, sections, "where", {
      kind: "behavior_context",
      source: "where",
      priority: 58,
      dedupeKey: `contract_suspicion:${contractSuspicion.kind}`,
      textRu: normalizeNotificationReason(contractSuspicion.reasons[0] ?? fallback, "ru"),
      textEn: normalizeNotificationReason(contractSuspicion.reasons[0] ?? fallback, "en")
    });
  }

  const materiality = report.sourceProvenanceMateriality ?? report.assessment.sourceProvenanceMateriality ?? null;
  if (materiality?.outcome === "residual_unresolved_below_materiality") {
    pushFact(allFacts, sections, "where", {
      kind: "coverage_limit",
      source: "where",
      priority: 52,
      dedupeKey: "source_provenance_materiality_residual",
      textRu: `Остаточные пробелы в происхождении ниже materiality (${materiality.unresolvedAmountUsdt} USDT). Это caveat, не финальный блок покрытия.`,
      textEn: `residual source-provenance gaps remain below materiality (${materiality.unresolvedAmountUsdt} USDT). They are shown as a caveat, not a final coverage block.`
    });
  }
  if (materiality?.outcome === "dense_hop_unresolved_below_materiality") {
    pushFact(allFacts, sections, "where", {
      kind: "coverage_limit",
      source: "where",
      priority: 52,
      dedupeKey: "source_provenance_materiality_dense",
      textRu: `Небольшой dense-hop хвост источника остался неразрешённым (${materiality.unresolvedAmountUsdt} USDT). Он ниже materiality и не использован как доказательство чистоты или риска.`,
      textEn: `Small dense-hop source tail remains unresolved (${materiality.unresolvedAmountUsdt} USDT). It is below materiality and was not used as clean or bad evidence.`
    });
  }

  pushFact(allFacts, sections, "where", coverageFact(report, report.coverage.partial ? 70 : 88));
}

function addDeepFacts(input: RiskExplanationInput, allFacts: RiskExplanationFact[], sections: MutableSections): void {
  const report = input.deepReport;
  if (!report) return;
  const exactDrain = exactApprovalDrainProfile(report.approvalDrainProvenanceProfiles);
  if (exactDrain) {
    const text = approvalDrainText(exactDrain);
    pushFact(allFacts, sections, "deep", {
      kind: "hard_evidence",
      source: "deep",
      priority: 10,
      dedupeKey: "approval_drain_exact",
      textRu: text.ru,
      textEn: text.en,
      actionRu: "Не принимать депозит автоматически.",
      actionEn: "Do not accept the deposit automatically."
    });
  }
  if (report.stablecoinRestrictionProfiles?.some((profile) => profile.isBlacklisted)) {
    pushFact(allFacts, sections, "deep", {
      kind: "hard_evidence",
      source: "deep",
      priority: 15,
      dedupeKey: "usdt_blacklist",
      textRu: "Адрес находится в активном TRC20 USDT blacklist.",
      textEn: "The address is in the active TRC20 USDT blacklist."
    });
  }
  if (report.approvalDrainProvenanceProfiles.some((profile) => profile.evidenceStrength === "route_linked")) {
    pushFact(allFacts, sections, "deep", {
      kind: "behavior_context",
      source: "deep",
      priority: 40,
      dedupeKey: "route_linked_approval_pattern",
      textRu: "Есть связь с approval-drain маршрутом, но точного доказательства списания через transferFrom до этого адреса нет.",
      textEn: "Route-linked approval-drain context found without exact approval-drain proof. There is approval-drain route context, but no exact transferFrom proof to this address."
    });
  }
  if (report.inboundProvenanceProfiles.some((profile) =>
    profile.score > 0 && profile.paths.some((path) => highRiskLabels.has(path.label))
  )) {
    pushFact(allFacts, sections, "deep", {
      kind: "hard_evidence",
      source: "deep",
      priority: 30,
      dedupeKey: "deep_high_risk_inbound",
      textRu: "DeepCheck нашёл точную on-chain связь с высокорисковым источником.",
      textEn: "Deep Research found deterministic high-risk inbound provenance. DeepCheck found an exact on-chain link to a high-risk source."
    });
  }
  if (report.extendedProvenanceProfiles?.some((profile) =>
    profile.paths.some((path) => path.evidenceStrength === "exact_labeled_path" && highRiskLabels.has(path.label ?? ""))
  )) {
    pushFact(allFacts, sections, "deep", {
      kind: "hard_evidence",
      source: "deep",
      priority: 35,
      dedupeKey: "deep_high_risk_extended",
      textRu: "DeepCheck нашёл более длинную точную on-chain связь с высокорисковым источником.",
      textEn: "Deep Research found exact high-risk extended provenance. DeepCheck found a longer exact on-chain link to a high-risk source."
    });
  }
  if (input.unifiedRisk.assetContinuationFloor > 0 || report.assetContinuationProfiles?.some((profile) => profile.score >= 65)) {
    pushFact(allFacts, sections, "deep", {
      kind: "source_policy",
      source: "deep",
      priority: 42,
      dedupeKey: "asset_continuation_floor",
      textRu: "Найдена cross-chain или asset-continuation связь с рискованным направлением.",
      textEn: "Cross-chain or asset-continuation link to a risky destination was found."
    });
  }
  if (firstBoundary(report)) {
    pushFact(allFacts, sections, "deep", {
      kind: "service_boundary",
      source: "deep",
      priority: 70,
      dedupeKey: "service_boundary",
      textRu: "Цепочка дошла до биржи или сервиса. Дальше публичная on-chain трассировка ограничена.",
      textEn: "The chain reached an exchange or service. Public on-chain tracing is limited after that point."
    });
  }
  const role = report.walletRoleProfiles?.[0]?.primaryRole;
  if (role === "treasury_like") {
    pushFact(allFacts, sections, "deep", {
      kind: "behavior_context",
      source: "deep",
      priority: 78,
      dedupeKey: "wallet_role_treasury",
      textRu: "Адрес похож на кошелёк для сбора ликвидности.",
      textEn: "The address looks like a liquidity collection wallet."
    });
  } else if (report.operationalFlowProfiles?.some((profile) => profile.operationalScore > 0)) {
    pushFact(allFacts, sections, "deep", {
      kind: "behavior_context",
      source: "deep",
      priority: 78,
      dedupeKey: "operational_wallet",
      textRu: "Адрес похож на рабочий кошелёк: принимает USDT, собирает ликвидность и переводит средства дальше.",
      textEn: "The address looks like an operational wallet: it receives USDT, collects liquidity, and sends funds onward."
    });
  }
  if (topDirectCounterparty(report)) {
    pushFact(allFacts, sections, "deep", {
      kind: "behavior_context",
      source: "deep",
      priority: 79,
      dedupeKey: "risky_direct_counterparty",
      textRu: "Есть поведенческий риск по крупному контрагенту с высоким риском. Это контекст, не доказательство грязного происхождения.",
      textEn: "Behavior warning: there is a major high-risk counterparty. This is context, not proof of dirty origin."
    });
  }
}

function addUnifiedFacts(input: RiskExplanationInput, allFacts: RiskExplanationFact[], sections: MutableSections): void {
  const result = input.unifiedRisk;
  if (result.coverageLevel !== "complete") {
    const fact: RiskExplanationFact = {
      kind: "coverage_limit",
      source: "coverage",
      priority: 89,
      dedupeKey: "unified_coverage_incomplete",
      textRu: "Проверка относится к выбранной сумме и доступным данным, а не ко всей истории адреса.",
      textEn: "The check applies to the selected amount and available data, not the address's full history."
    };
    addFact(allFacts, fact);
    addFact(sections.where, fact);
  }
  if (result.reasons.some((reason) => reason.code === "where_source_policy_floor")) {
    const fact: RiskExplanationFact = {
      kind: "source_policy",
      source: "unified",
      priority: 60,
      dedupeKey: "where_source_policy_floor",
      textRu: "Источник выбранной суммы попадает под policy-риск. Это не доказывает кражу, но депозит нельзя принимать автоматически.",
      textEn: "Source-policy evidence reached the decline or manual-review threshold. The selected amount source falls under policy risk. This does not prove theft, but the deposit cannot be accepted automatically."
    };
    addFact(allFacts, fact);
    addFact(sections.where, fact);
  }
  if (result.matrixScore.winningRow === "behavior_only_prior") {
    const fact: RiskExplanationFact = {
      kind: "behavior_context",
      source: "unified",
      priority: 80,
      dedupeKey: "behavior_only_prior",
      textRu: "Адрес похож на транзитный кошелёк: быстро получает и переводит USDT дальше.",
      textEn: "The address looks like a transit wallet: it quickly receives and sends USDT onward."
    };
    addFact(allFacts, fact);
    addFact(sections.deep, fact);
  }
  if (result.hardEvidenceFloor === 0) {
    const fact: RiskExplanationFact = {
      kind: "absent_evidence",
      source: "unified",
      priority: 95,
      dedupeKey: "absent_hard_evidence",
      textRu: "Точных признаков кражи, drainer-цепочки или USDT blacklist не найдено. Жёстких плохих доказательств не найдено.",
      textEn: "No exact theft, drainer-chain, or USDT blacklist signal was found. No deterministic bad evidence was found.",
      detailRu: "Exact approval-drain не найден. USDT blacklist не найден.",
      detailEn: "Exact approval-drain was not found. USDT blacklist was not found."
    };
    addFact(allFacts, fact);
    addFact(sections.fast, fact);
  }
}

function materialityLimitations(report: WhereIsMoneyReport): { ru: string[]; en: string[] } {
  const materiality = report.sourceProvenanceMateriality ?? report.assessment.sourceProvenanceMateriality ?? null;
  if (!materiality) return { ru: [], en: [] };
  return {
    ru: ["Проверка относится к выбранной сумме и доступным данным, а не ко всей истории адреса."],
    en: ["The check applies to the selected amount and available data, not the address's full history."]
  };
}

function decisionConclusion(decision: RiskExplanationDecision): { ru: string; en: string } {
  switch (decision) {
    case "DECLINE":
      return {
        ru: "Адрес нельзя принимать автоматически: найден сильный риск.",
        en: "The address cannot be accepted automatically: strong risk was found."
      };
    case "REVIEW":
      return {
        ru: "Нужна ручная проверка: найден контекстный или policy-риск.",
        en: "Manual review is required: contextual or policy risk was found."
      };
    case "ACCEPTABLE":
      return {
        ru: "Сильных риск-сигналов в доступных данных не найдено.",
        en: "No strong risk signals were found in available data."
      };
    case "NO_FINAL_DECISION":
      return {
        ru: "Итоговый риск не опубликован: не хватает данных по происхождению средств.",
        en: "Risk was not published because source-of-funds data is insufficient."
      };
  }
}

function recommendations(decision: RiskExplanationDecision, facts: RiskExplanationFact[]): { ru: string[]; en: string[] } {
  const ru: string[] = [];
  const en: string[] = [];
  if (decision === "DECLINE") {
    ru.push("Не принимать автоматически.");
    ru.push("Не принимать депозит автоматически.");
    en.push("Do not accept the deposit automatically.");
    ru.push("Передать кейс на ручную проверку/compliance.");
    en.push("Send the case to manual compliance review.");
  } else if (decision === "REVIEW") {
    ru.push("Нужна ручная проверка.");
    en.push("Manual review is required.");
    ru.push("Запросить подтверждение происхождения средств.");
    en.push("Request source-of-funds evidence.");
    ru.push("Не принимать автоматически, если сумма существенная.");
    en.push("Do not accept automatically if the amount is material.");
  } else if (decision === "ACCEPTABLE") {
    ru.push("Можно принять автоматически в рамках текущей политики.");
    en.push("Can be accepted automatically under the current policy.");
  } else {
    ru.push("Дождаться индексации или перезапустить проверку.");
    en.push("Wait for indexing or rerun the check.");
  }
  for (const fact of facts) {
    if (fact.actionRu) ru.push(fact.actionRu);
    if (fact.actionEn) en.push(fact.actionEn);
  }
  return { ru: unique(ru).slice(0, 4), en: unique(en).slice(0, 4) };
}

function possibleMeanings(decision: RiskExplanationDecision, facts: RiskExplanationFact[]): { ru: string[]; en: string[] } {
  const ru: string[] = [];
  const en: string[] = [];
  if (facts.some((fact) => fact.kind === "hard_evidence")) {
    ru.push("Это может быть прямое или ранее сохранённое доказательство высокорискового происхождения средств.");
    en.push("This may be direct or previously saved evidence of high-risk source of funds.");
  }
  if (facts.some((fact) => fact.kind === "source_policy")) {
    ru.push("Источник может быть policy-рискованным даже без доказательства кражи.");
    en.push("The source may be policy-risky even without proof of theft.");
  }
  if (facts.some((fact) => fact.kind === "service_boundary")) {
    ru.push("Публичная трассировка могла остановиться на сервисной границе.");
    en.push("Public tracing may have stopped at a service boundary.");
  }
  if (decision === "ACCEPTABLE") {
    ru.push("В доступных данных не видно сильного риска, но это не гарантия чистой истории.");
    en.push("Available data does not show strong risk, but this is not a guarantee of clean history.");
  }
  return { ru: unique(ru).slice(0, 4), en: unique(en).slice(0, 4) };
}

export function buildRiskExplanationSummary(input: RiskExplanationInput): RiskExplanationSummary {
  const allFacts: RiskExplanationFact[] = [];
  const sections: MutableSections = { fast: [], where: [], deep: [] };
  addFastFacts(input, allFacts, sections);
  addWhereFacts(input, allFacts, sections);
  addDeepFacts(input, allFacts, sections);
  addUnifiedFacts(input, allFacts, sections);

  const primaryReasons = sortedFacts(allFacts);
  const conclusion = decisionConclusion(input.finalDecision);
  const meanings = possibleMeanings(input.finalDecision, primaryReasons);
  const recs = recommendations(input.finalDecision, primaryReasons);
  const materiality = materialityLimitations(input.whereReport);
  const limitationsRu = unique([
    "Проверка относится к выбранной сумме и доступным данным, а не ко всей истории адреса.",
    ...materiality.ru,
    ...primaryReasons.filter((fact) => fact.kind === "coverage_limit" || fact.kind === "service_boundary").map((fact) => fact.textRu)
  ]).slice(0, 6);
  const limitationsEn = unique([
    "The check applies to the selected amount and available data, not the address's full history.",
    ...materiality.en,
    ...primaryReasons.filter((fact) => fact.kind === "coverage_limit" || fact.kind === "service_boundary").map((fact) => fact.textEn)
  ]).slice(0, 6);

  return {
    address: input.address,
    decision: input.finalDecision,
    score: input.unifiedRisk.finalScore,
    level: input.unifiedRisk.finalLevel,
    shortConclusionRu: conclusion.ru,
    shortConclusionEn: conclusion.en,
    primaryReasons,
    modeSections: [
      { mode: "fast", titleRu: "FastCheck", titleEn: "FastCheck", facts: sortedFacts(sections.fast) },
      { mode: "where", titleRu: "Where Is Money", titleEn: "Where Is Money", facts: sortedFacts(sections.where) },
      { mode: "deep", titleRu: "DeepCheck", titleEn: "DeepCheck", facts: sortedFacts(sections.deep) }
    ],
    possibleMeaningsRu: meanings.ru,
    possibleMeaningsEn: meanings.en,
    limitationsRu,
    limitationsEn,
    recommendationsRu: recs.ru,
    recommendationsEn: recs.en
  };
}

export function buildNoFinalRiskExplanationSummary(input: NoFinalRiskExplanationInput): RiskExplanationSummary {
  const coverage = coverageFact(input.whereReport, 10);
  const conclusion = decisionConclusion("NO_FINAL_DECISION");
  return {
    address: input.address,
    decision: "NO_FINAL_DECISION",
    score: null,
    level: null,
    shortConclusionRu: conclusion.ru,
    shortConclusionEn: conclusion.en,
    primaryReasons: [coverage],
    modeSections: [
      { mode: "fast", titleRu: "FastCheck", titleEn: "FastCheck", facts: [] },
      { mode: "where", titleRu: "Where Is Money", titleEn: "Where Is Money", facts: [coverage] },
      { mode: "deep", titleRu: "DeepCheck", titleEn: "DeepCheck", facts: [] }
    ],
    possibleMeaningsRu: ["Это технический no-final результат, а не финальный отказ."],
    possibleMeaningsEn: ["This is a technical no-final result, not a final decline."],
    limitationsRu: [
      "Итоговый риск не опубликован: не хватает данных по происхождению средств.",
      "Проверка относится к выбранной сумме и доступным данным, а не ко всей истории адреса."
    ],
    limitationsEn: [
      "Risk was not published because source-of-funds data is insufficient.",
      "The check applies to the selected amount and available data, not the address's full history."
    ],
    recommendationsRu: ["Дождаться индексации или перезапустить проверку."],
    recommendationsEn: ["Wait for indexing or rerun the check."]
  };
}

export function factText(fact: RiskExplanationFact, locale: BotLocale): string {
  return locale === "en" ? fact.textEn : fact.textRu;
}

export function factDetail(fact: RiskExplanationFact, locale: BotLocale): string | null {
  return locale === "en" ? fact.detailEn ?? null : fact.detailRu ?? null;
}

export function factAction(fact: RiskExplanationFact, locale: BotLocale): string | null {
  return locale === "en" ? fact.actionEn ?? null : fact.actionRu ?? null;
}

export function modeTitle(section: RiskExplanationModeSection, locale: BotLocale): string {
  return locale === "en" ? section.titleEn : section.titleRu;
}
