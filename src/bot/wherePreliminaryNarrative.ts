import type {
  RiskLayerScore,
  SourcePolicyEvidence,
  WhereIsMoneyAgeSignal,
  WhereIsMoneyHardBadEvidence,
  WhereIsMoneyReport
} from "../types";
import {
  approvalDrainRoleFact,
  buildPreliminaryNarrativeSections,
  canonicalNarrativeFacts,
  coverageExplanationFor,
  fastNarrativeCopy,
  gasFreeFeeFactFromBalanceTransfers,
  sourceAndRouteFacts,
  verify20RoleFact,
  type CoverageExplanation,
  type NarrativeFact,
  type PreliminaryNarrativeSections,
  type Verify20NarrativeEvidence,
  type WalletNarrativeLocale
} from "./walletNarrativeSummary";

export type WherePreliminaryDiagnosticCode =
  | "where_preliminary_score_without_structured_fact";

export type WherePreliminaryNarrative = {
  score: number | null;
  sections: PreliminaryNarrativeSections;
  preferredFactId: string | null;
  diagnosticCode: WherePreliminaryDiagnosticCode | null;
};

type WhereNarrativeDriver = {
  score: number;
  evidenceIds: string[];
  signalKeys: string[];
};

function stableKeys(...values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
    .sort((left, right) => left.localeCompare(right));
}

function layerDriver(layer: RiskLayerScore): WhereNarrativeDriver {
  return {
    score: layer.score,
    evidenceIds: [...layer.evidenceIds],
    signalKeys: stableKeys(
      layer.kind,
      layer.sourceExposureKind,
      layer.evidenceClass,
      layer.sourceExposureKind ? `source_policy:${layer.sourceExposureKind}` : undefined
    )
  };
}

function hardDriver(item: WhereIsMoneyHardBadEvidence): WhereNarrativeDriver {
  return { score: item.score, evidenceIds: [...item.evidenceIds], signalKeys: stableKeys(item.kind) };
}

function sourceDriver(item: SourcePolicyEvidence): WhereNarrativeDriver {
  return {
    score: item.score,
    evidenceIds: [...item.evidenceIds],
    signalKeys: stableKeys(item.kind, "source_policy", `source_policy:${item.kind}`)
  };
}

function driverKey(driver: WhereNarrativeDriver): string {
  return `${driver.signalKeys.join("\u0000")}\u0001${driver.evidenceIds.slice().sort().join("\u0000")}`;
}

function driverFromReport(report: WhereIsMoneyReport): WhereNarrativeDriver | null {
  if (report.assessment.dominantRiskLayer) return layerDriver(report.assessment.dominantRiskLayer);
  const candidates = [
    ...report.assessment.hardBadEvidence.map(hardDriver),
    ...report.assessment.sourcePolicyEvidence.map(sourceDriver),
    ...report.assessment.contractSuspicionEvidence.map(layerDriver),
    ...report.assessment.unknownOriginEvidence.map(layerDriver)
  ];
  return candidates.sort((left, right) =>
    right.score - left.score || driverKey(left).localeCompare(driverKey(right))
  )[0] ?? null;
}

function plainFact(input: {
  id: string;
  kind: NarrativeFact["kind"];
  ru: string;
  en: string;
  meaningRu?: string;
  meaningEn?: string;
  evidenceIds?: string[];
  signalKeys?: string[];
  proofStrength?: NarrativeFact["proofStrength"];
}): NarrativeFact {
  return {
    id: input.id,
    kind: input.kind,
    evidenceIds: [...new Set(input.evidenceIds ?? [])].sort(),
    scoreSignalKeys: stableKeys(...(input.signalKeys ?? [])),
    role: null,
    proofStrength: input.proofStrength ?? "context",
    factTextRu: input.ru,
    factTextEn: input.en,
    ...(input.meaningRu ? { meaningTextRu: input.meaningRu } : {}),
    ...(input.meaningEn ? { meaningTextEn: input.meaningEn } : {})
  };
}

function fastFacts(report: WhereIsMoneyReport): NarrativeFact[] {
  const fast = report.fastWalletRisk;
  if (!fast || fast.subjectAddress !== report.subjectAddress) return [];
  return fast.reasons.flatMap((reason) => {
    const copy = fastNarrativeCopy(reason.code, fast, { presentation: "preliminary" });
    if (!copy) return [];
    return [plainFact({
      id: `fast-subject:${reason.code}`,
      kind: copy.kind,
      ru: copy.ru,
      en: copy.en,
      evidenceIds: reason.evidenceRef ? [reason.evidenceRef] : [],
      signalKeys: [reason.code],
      proofStrength: copy.proofStrength
    })];
  });
}

const contractCopies: Partial<Record<string, Pick<NarrativeFact, "factTextRu" | "factTextEn" | "meaningTextRu" | "meaningTextEn">>> = {
  drainer_like: {
    factTextRu: "Контракт похож на шаблон списания USDT после разрешения владельца.",
    factTextEn: "The contract resembles a pattern that can debit USDT after owner permission.",
    meaningTextRu: "Точное списание в этой проверке не подтверждено.",
    meaningTextEn: "An exact debit was not confirmed in this check."
  },
  unknown_suspicious: {
    factTextRu: "Обнаружен подозрительный контракт неизвестного назначения.",
    factTextEn: "A suspicious contract of unknown purpose was found.",
    meaningTextRu: "Точное списание в этой проверке не подтверждено.",
    meaningTextEn: "An exact debit was not confirmed in this check."
  }
};

function contractFacts(report: WhereIsMoneyReport): NarrativeFact[] {
  return report.assessment.contractSuspicionEvidence.flatMap((layer) => {
    const copy = contractCopies[layer.kind];
    if (!copy) return [];
    return [plainFact({
      id: `where-contract:${layer.kind}:${layer.evidenceIds.slice().sort().join(",")}`,
      kind: "contract_suspicion",
      ru: copy.factTextRu,
      en: copy.factTextEn,
      meaningRu: copy.meaningTextRu,
      meaningEn: copy.meaningTextEn,
      evidenceIds: layer.evidenceIds,
      signalKeys: [layer.kind, layer.evidenceClass],
      proofStrength: "context"
    })];
  });
}

function unknownOriginFacts(report: WhereIsMoneyReport): NarrativeFact[] {
  return report.assessment.unknownOriginEvidence.flatMap((layer) => {
    if (layer.kind !== "unresolved_origin" && layer.kind !== "operational_unknown_origin") return [];
    return [plainFact({
      id: `where-unknown:${layer.kind}:${layer.evidenceIds.slice().sort().join(",")}`,
      kind: "unknown_source",
      ru: "Происхождение части проверяемой суммы не установлено.",
      en: "The origin of part of the checked amount could not be established.",
      meaningRu: "Эта неопределённость сама по себе не определяет риск источника.",
      meaningEn: "This uncertainty alone does not classify the source risk.",
      evidenceIds: layer.evidenceIds,
      signalKeys: [layer.kind, layer.evidenceClass]
    })];
  });
}

const ageCopies: Partial<Record<WhereIsMoneyAgeSignal["code"], { ru: string; en: string; meaningRu: string; meaningEn: string }>> = {
  subject_new_large_wallet: {
    ru: "Новый кошелёк получил крупную сумму.",
    en: "A new wallet received a large amount.",
    meaningRu: "Короткая история адреса повышает неопределённость происхождения.",
    meaningEn: "The address's short history increases origin uncertainty."
  },
  relationship_new: {
    ru: "Основной отправитель — новый контрагент для этого кошелька.",
    en: "The main sender is new to this wallet.",
    meaningRu: "У связи ещё нет длительной подтверждённой истории.",
    meaningEn: "The relationship does not yet have a long established history."
  },
  dormancy_gap: {
    ru: "Перед переводом был долгий период неактивности.",
    en: "There was a long inactive period before the transfer.",
    meaningRu: "Длительный разрыв активности повышает неопределённость временного контекста.",
    meaningEn: "The long inactivity gap increases timing uncertainty."
  },
  relationship_repeated: {
    ru: "С отправителем есть устоявшаяся повторная история переводов.",
    en: "The sender has an established repeated transfer history with this wallet.",
    meaningRu: "Повторяющаяся связь снижает неопределённость, но не отменяет другие факты риска.",
    meaningEn: "The repeated relationship reduces uncertainty but does not override other risk facts."
  }
};

function ageFacts(report: WhereIsMoneyReport): NarrativeFact[] {
  return (report.assessment.ageSignals?.signals ?? []).flatMap((signal) => {
    const copy = ageCopies[signal.code];
    if (!copy) return [];
    return [plainFact({
      id: `where-age:${signal.code}:${signal.evidenceIds.slice().sort().join(",")}`,
      kind: "risky_counterparty",
      ru: copy.ru,
      en: copy.en,
      meaningRu: copy.meaningRu,
      meaningEn: copy.meaningEn,
      evidenceIds: signal.evidenceIds,
      signalKeys: [signal.code]
    })];
  });
}

function whereFacts(report: WhereIsMoneyReport, verify20?: Verify20NarrativeEvidence | null): NarrativeFact[] {
  const facts: NarrativeFact[] = sourceAndRouteFacts({
    paths: report.originPaths,
    sourcePolicyEvidence: report.assessment.sourcePolicyEvidence
  });
  for (const profile of report.approvalDrainProvenanceProfiles) {
    const fact = approvalDrainRoleFact({ checkedAddress: report.subjectAddress, profile });
    if (fact) facts.push(fact);
  }
  if (verify20?.subjectAddress === report.subjectAddress && verify20.role === "verify20_contract") {
    const fact = verify20RoleFact(verify20);
    if (fact) facts.push(fact);
  }
  facts.push(...fastFacts(report), ...contractFacts(report), ...unknownOriginFacts(report), ...ageFacts(report));
  const fee = gasFreeFeeFactFromBalanceTransfers(report.balanceFormingTransfers);
  if (fee) facts.push(fee);
  return canonicalNarrativeFacts(facts);
}

function overlaps(left: string[] | undefined, right: string[]): boolean {
  if (!left?.length || right.length === 0) return false;
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function preferredFactId(
  facts: NarrativeFact[],
  driver: WhereNarrativeDriver | null,
  report: WhereIsMoneyReport
): string | null {
  const eligible = facts.filter((fact) =>
    fact.kind !== "gasfree_fee" &&
    (fact.kind !== "cex_source" || fact.sourceIdentityKnown === true)
  );
  if (driver) {
    const evidence = eligible.find((fact) => overlaps(fact.evidenceIds, driver.evidenceIds));
    if (evidence) return evidence.id;
    const signal = eligible.find((fact) => overlaps(fact.scoreSignalKeys, driver.signalKeys));
    if (signal) return signal.id;
  }
  if (!driver && report.riskScore < 30) {
    const namedSource = eligible.find((fact) =>
      fact.kind === "cex_source" && fact.sourceIdentityKnown === true
    );
    if (namedSource) return namedSource.id;
  }
  return null;
}

const technicalCoverageCopy: Record<string, CoverageExplanation> = {
  provider_cap_unresolved: {
    reasonKind: "provider_cap_unresolved",
    textRu: "Источник данных не вернул достаточно старую историю, поэтому предварительный риск не рассчитан.",
    textEn: "The data provider did not return enough older history, so preliminary risk was not calculated.",
    isRiskEvidence: false
  },
  insufficient_coverage: {
    reasonKind: "insufficient_coverage",
    textRu: "Данных недостаточно, чтобы рассчитать предварительный риск.",
    textEn: "There is not enough data to calculate preliminary risk.",
    isRiskEvidence: false
  },
  local_budget_limited: {
    reasonKind: "local_budget_limited",
    textRu: "Проверка остановилась на локальном техническом лимите, поэтому предварительный риск не рассчитан.",
    textEn: "The check reached a local technical limit, so preliminary risk was not calculated.",
    isRiskEvidence: false
  },
  local_index_read_failed: {
    reasonKind: "local_index_read_failed",
    textRu: "Локальный индекс истории не удалось прочитать, поэтому предварительный риск не рассчитан.",
    textEn: "The local history index could not be read, so preliminary risk was not calculated.",
    isRiskEvidence: false
  }
};

const neutralCoverage: CoverageExplanation = {
  textRu: "Данных недостаточно, чтобы рассчитать предварительный риск.",
  textEn: "There is not enough data to calculate preliminary risk.",
  isRiskEvidence: false
};

function reportCoverage(report: WhereIsMoneyReport, forceTechnical: boolean): CoverageExplanation | null {
  const pathCoverage = coverageExplanationFor({
    whereCoverage: report.coverage,
    traceHistoryCoverage: report.originPaths.flatMap((path) => path.historyCoverage ?? [])
  });
  if (!forceTechnical) return pathCoverage;
  const hasPathReason = report.originPaths.some((path) =>
    path.stoppedReason === "incoming_history_not_fetched" ||
    (path.historyCoverage ?? []).some((item) =>
      item.coverageComplete === false || item.providerCapHit || item.budgetExhausted ||
      item.providerInconsistent || item.localMaterializationStatus === "local_limit" ||
      item.localMaterializationStatus === "read_failed"
    )
  );
  if (hasPathReason && pathCoverage) return pathCoverage;
  const code = report.scoreBlockedReason ?? report.assessment.scoreBlockedReason ??
    report.technicalStatus ?? report.assessment.technicalStatus ?? "";
  return technicalCoverageCopy[code] ?? neutralCoverage;
}

export function buildWherePreliminaryNarrative(
  report: WhereIsMoneyReport,
  options: { locale: WalletNarrativeLocale; verify20?: Verify20NarrativeEvidence | null }
): WherePreliminaryNarrative {
  const scoreValid = (report.scoreValid ?? report.assessment.scoreValid) === true;
  const facts = whereFacts(report, options.verify20);
  const driver = driverFromReport(report);
  const preferred = preferredFactId(facts, driver, report);
  const publishScore = scoreValid && preferred !== null;
  const coverage = reportCoverage(report, !publishScore);
  const sections = buildPreliminaryNarrativeSections({
    locale: options.locale,
    facts: publishScore ? facts : [],
    preferredFactId: publishScore ? preferred : null,
    coverageExplanation: coverage
  });
  return {
    score: publishScore ? report.riskScore : null,
    sections,
    preferredFactId: publishScore ? preferred : null,
    diagnosticCode: scoreValid && preferred === null
      ? "where_preliminary_score_without_structured_fact"
      : null
  };
}
