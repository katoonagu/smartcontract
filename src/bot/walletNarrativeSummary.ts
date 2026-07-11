import type {
  AddressBehaviorProfile,
  ApprovalDrainProvenanceProfile,
  BoundaryExposureProfile,
  DirectCounterpartyInteractionProfile,
  FirstHopBlacklistCoverage,
  FirstHopBlacklistFact,
  FirstHopLabelFact,
  MoneyOriginPath,
  MoneyOriginTraceHistoryCoverage,
  OperationalFlowProfile,
  RiskLabel,
  SourcePolicyEvidence,
  StablecoinRestrictionProfile,
  WhereIsMoneyCoverage,
  WalletRole
} from "../types";
import type { Verify20FingerprintResult } from "../forensics/verify20Fingerprint";

export type WalletNarrativeLocale = "ru" | "en";

export type WalletNarrativeDecision =
  | "ACCEPTABLE"
  | "REVIEW"
  | "DECLINE"
  | "NO_FINAL_DECISION";

export type NarrativeFactKind =
  | "usdt_blacklist"
  | "direct_counterparty_blacklist"
  | "approval_drain"
  | "direct_counterparty_sanction"
  | "direct_counterparty_exact_label"
  | "sanctioned_source"
  | "verify20_template"
  | "bridge_route"
  | "unknown_contract"
  | "risky_counterparty"
  | "cex_source"
  | "collector"
  | "gasfree_fee"
  | "coverage";

export type NarrativeAddressRole =
  | "victim"
  | "verify20_contract"
  | "drainer_spender"
  | "first_receiver"
  | "route_linked"
  | "approval_only"
  | "interaction_only"
  | "collector"
  | "unknown";

export type NarrativeFact = {
  id: string;
  kind: NarrativeFactKind;
  evidenceIds?: string[];
  role?: NarrativeAddressRole | null;
  proofStrength?: "exact" | "strong" | "context" | "limitation";
  priority?: number;
  factTextRu: string;
  factTextEn: string;
};

export type CoverageExplanation = {
  reasonKind?: string;
  textRu: string;
  textEn: string;
  isRiskEvidence: false;
};

export type WalletNarrativeCase = {
  locale: WalletNarrativeLocale;
  decision: WalletNarrativeDecision;
  score: number | null;
  facts: NarrativeFact[];
  preferredFactId?: string | null;
  coverageExplanation: CoverageExplanation | null;
};

const MAX_PART_LENGTH = 280;
const MAX_BODY_LENGTH = 500;
const FORBIDDEN_COPY = /Почему|Что это может значить|Что важно учесть|drain episode|anchor coverage/i;
const KNOWN_INTERNAL_CODES = new Set([
  "approval_drain_exact",
  "approval_drain_proximity",
  "clean_cex_source",
  "drainer_like",
  "edd_sof",
  "forensic_approval_drain_provenance",
  "hard_safety_limit_exceeded",
  "htx_huobi_source",
  "incoming_history_not_fetched",
  "insufficient_coverage",
  "internal_scam_label",
  "llm_contract_suspicion",
  "local_budget_limited",
  "local_index_read_failed",
  "manual_review_required",
  "partial_budget_exhausted",
  "provider_cap_unresolved",
  "provider_error",
  "provider_inconsistent",
  "rate_limited_after_retries",
  "service_boundary",
  "unknown_contract_boundary",
  "unknown_suspicious",
  "usdt_blacklist",
  "whitebit_source"
]);

const factRank: Record<NarrativeFactKind, number> = {
  usdt_blacklist: 0,
  direct_counterparty_blacklist: 1,
  approval_drain: 2,
  direct_counterparty_sanction: 3,
  direct_counterparty_exact_label: 3,
  sanctioned_source: 3,
  verify20_template: 4,
  bridge_route: 5,
  unknown_contract: 5,
  risky_counterparty: 6,
  cex_source: 7,
  collector: 8,
  gasfree_fee: 9,
  coverage: 10
};

const narrativeFactKinds = new Set<string>(Object.keys(factRank));
const narrativeAddressRoles = new Set<string>([
  "victim",
  "verify20_contract",
  "drainer_spender",
  "first_receiver",
  "route_linked",
  "approval_only",
  "interaction_only",
  "collector",
  "unknown"
]);
const narrativeProofStrengths = new Set<string>(["exact", "strong", "context", "limitation"]);
const narrativeDecisions = new Set<string>([
  "ACCEPTABLE",
  "REVIEW",
  "DECLINE",
  "NO_FINAL_DECISION"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsKnownInternalCode(value: string): boolean {
  return (value.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [])
    .some((token) => KNOWN_INTERNAL_CODES.has(token.toLowerCase()));
}

function normalizeCopy(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length > MAX_PART_LENGTH) {
    throw new RangeError(`Wallet narrative parts must not exceed ${MAX_PART_LENGTH} characters.`);
  }
  if (FORBIDDEN_COPY.test(normalized) || containsKnownInternalCode(normalized)) {
    throw new Error("Forbidden normal narrative copy must be translated before formatting.");
  }
  return normalized;
}

export type Verify20NarrativeEvidence = {
  subjectAddress: string;
  role: "verify20_contract" | "approval_only" | "interaction_only";
  fingerprint: Verify20FingerprintResult;
  debitObserved: boolean;
};

export type ApprovalDrainNarrativeEvidence = {
  checkedAddress: string;
  profile: ApprovalDrainProvenanceProfile;
  walletRole?: WalletRole;
};

export type WalletNarrativeEvidenceInput = {
  checkedAddress: string;
  subjectRestriction?: StablecoinRestrictionProfile | null;
  firstHopBlacklistFacts?: FirstHopBlacklistFact[];
  firstHopBlacklistCoverage?: FirstHopBlacklistCoverage | null;
  firstHopLabelFacts?: FirstHopLabelFact[];
  directCounterpartyInteractionProfiles?: DirectCounterpartyInteractionProfile[];
  approvalDrain?: ApprovalDrainNarrativeEvidence | null;
  verify20?: Verify20NarrativeEvidence | null;
  paths?: MoneyOriginPath[];
  sourcePolicyEvidence?: SourcePolicyEvidence[];
  whereCoverage?: WhereIsMoneyCoverage | null;
  traceHistoryCoverage?: MoneyOriginTraceHistoryCoverage[];
  addressBehaviorProfiles?: AddressBehaviorProfile[];
  operationalFlowProfiles?: OperationalFlowProfile[];
  boundaryExposureProfiles?: BoundaryExposureProfile[];
};

export type WalletNarrativeEvidence = {
  facts: NarrativeFact[];
  coverageExplanation: CoverageExplanation | null;
};

function narrativeFact(
  id: string,
  kind: NarrativeFactKind,
  factTextRu: string,
  factTextEn: string,
  role: NarrativeAddressRole | null,
  proofStrength: NonNullable<NarrativeFact["proofStrength"]>,
  evidenceIds: string[] = []
): NarrativeFact {
  return {
    id,
    kind,
    evidenceIds: [...new Set(evidenceIds.filter((id) => id.length > 0))].sort(compareLexical),
    role,
    proofStrength,
    priority: factRank[kind],
    factTextRu: normalizeCopy(factTextRu),
    factTextEn: normalizeCopy(factTextEn)
  };
}

function compareLexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rawAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error("USDT raw amount must contain digits only.");
  return BigInt(value);
}

function tryRawAmount(value: string): bigint | null {
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

function formatRawSharePercent(
  numeratorRaw: string,
  denominatorRaw: string,
  locale: WalletNarrativeLocale
): string | null {
  const numerator = tryRawAmount(numeratorRaw);
  const denominator = tryRawAmount(denominatorRaw);
  if (numerator === null || denominator === null || denominator === 0n || numerator > denominator) {
    return null;
  }
  const tenths = (numerator * 1000n + denominator / 2n) / denominator;
  const whole = tenths / 10n;
  const fraction = tenths % 10n;
  return fraction === 0n
    ? whole.toString()
    : `${whole}${locale === "ru" ? "," : "."}${fraction}`;
}

function groupWhole(value: string, separator: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

function formatUsdtRaw(value: string, locale: WalletNarrativeLocale): string {
  const raw = rawAmount(value);
  const padded = raw.toString().padStart(7, "0");
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, "");
  const grouped = groupWhole(whole, locale === "ru" ? " " : ",");
  if (!fraction) return grouped;
  return `${grouped}${locale === "ru" ? "," : "."}${fraction}`;
}

function formatPercent(value: number, locale: WalletNarrativeLocale): string {
  if (!Number.isFinite(value)) throw new Error("Percentage must be finite.");
  const percent = Math.round(value * 1000) / 10;
  const text = Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
  return locale === "ru" ? text.replace(".", ",") : text;
}

function checkedPercent(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError("Traced amount percentage must be between 0 and 100.");
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function shortAddress(address: string): string {
  const value = address.trim();
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

function russianDirectTransferCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const noun = mod10 === 1 && mod100 !== 11
    ? "перевод"
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? "перевода"
      : "переводов";
  return `${count} ${noun}`;
}

function englishDirectTransferCount(count: number): string {
  return `${count} ${count === 1 ? "transfer" : "transfers"}`;
}

function durationParts(milliseconds: number): { ru: string; en: string } | null {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const totalMinutes = Math.floor(milliseconds / 60_000);
  if (totalMinutes < 1) return { ru: "менее 1 мин", en: "less than 1 m" };
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return {
    ru: hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`,
    en: hours > 0 ? `${hours} h ${minutes} m` : `${minutes} m`
  };
}

export function subjectBlacklistFact(
  profile: StablecoinRestrictionProfile
): NarrativeFact | null {
  if (profile.evidenceStrength !== "exact_contract_state" || !profile.isBlacklisted) return null;
  return narrativeFact(
    `subject-usdt-blacklist:${profile.subjectAddress}`,
    "usdt_blacklist",
    "Адрес находится в чёрном списке USDT: переводы токена заблокированы, а USDT на адресе заморожен.",
    "The address is on the USDT blacklist: token transfers are blocked and USDT at the address is frozen.",
    null,
    "exact",
    profile.blacklistEventTxHash ? [profile.blacklistEventTxHash] : []
  );
}

function exactApprovalRole(
  input: ApprovalDrainNarrativeEvidence
): "victim" | "drainer_spender" | "first_receiver" | "route_linked" | null {
  const { checkedAddress, profile } = input;
  if (
    profile.evidenceStrength === "route_linked" &&
    checkedAddress === profile.subjectAddress &&
    profile.hopDepth > 0
  ) return "route_linked";
  if (profile.evidenceStrength !== "exact_approval_and_transfer_from") return null;
  if (checkedAddress === profile.victimAddress) return "victim";
  if (checkedAddress === profile.spenderAddress) return "drainer_spender";
  if (checkedAddress === profile.firstReceiverAddress) return "first_receiver";
  if (
    checkedAddress === profile.subjectAddress &&
    (profile.hopDepth > 0 || profile.pathAddresses.includes(checkedAddress))
  ) {
    return "route_linked";
  }
  return null;
}

export function approvalDrainRoleFact(
  input: ApprovalDrainNarrativeEvidence
): NarrativeFact | null {
  if (!input?.profile) return null;
  const role = exactApprovalRole(input);
  if (!role) return null;
  const amountRu = formatUsdtRaw(input.profile.amountRaw, "ru");
  const amountEn = formatUsdtRaw(input.profile.amountRaw, "en");
  const preservedRu = formatPercent(input.profile.amountPreservationRatio, "ru");
  const preservedEn = formatPercent(input.profile.amountPreservationRatio, "en");
  const copy = {
    victim: {
      ru: `С кошелька списали ${amountRu} USDT после разрешения контракту. Проверяемый адрес — жертва списания.`,
      en: `${amountEn} USDT was debited after contract permission. The checked address is the victim of the debit.`
    },
    drainer_spender: {
      ru: `Проверяемый контракт получил доступ к USDT и списал ${amountRu} USDT с другого кошелька. Это контракт-дрейнер.`,
      en: `The checked contract obtained access to USDT and debited ${amountEn} USDT from another wallet. It is the drainer contract.`
    },
    first_receiver: {
      ru: `Кошелёк первым получил ${amountRu} USDT, списанные с другого адреса. Это первый получатель в подтверждённой дрейнер-цепочке.`,
      en: `The wallet was the first to receive ${amountEn} USDT debited from another address. It is the first recipient in a confirmed drainer route.`
    },
    route_linked: {
      ru: `Кошелёк получил деньги дальше по дрейнер-маршруту. До него дошло ${preservedRu}% списанной суммы: это следующее звено цепочки.`,
      en: `The wallet received funds farther along a drainer route. It received ${preservedEn}% of the debited amount as a later link in the chain.`
    }
  }[role];
  return narrativeFact(
    `approval-drain:${input.profile.drainTxHash}:${role}`,
    "approval_drain",
    copy.ru,
    copy.en,
    role,
    role === "route_linked" ? "context" : "exact",
    [input.profile.approvalTxHash, input.profile.drainTxHash, ...input.profile.pathTxHashes]
  );
}

export function verify20RoleFact(input: Verify20NarrativeEvidence): NarrativeFact | null {
  if (!input?.fingerprint?.matched || input.fingerprint.blockedByTrustedService || input.debitObserved) {
    return null;
  }
  const copy = {
    verify20_contract: {
      ru: "В контракте найден полный шаблон Verify20, который часто используют дрейнеры. Он позволяет списывать USDT после разрешения владельца, но не доказывает конкретное списание.",
      en: "The contract has the full Verify20 pattern often used by drainers. It can debit USDT after owner permission, but does not prove a specific debit."
    },
    approval_only: {
      ru: "Кошелёк открыл контракту Verify20 доступ к USDT. Списания пока не было. Отзовите разрешение.",
      en: "The wallet granted Verify20 access to USDT. No debit was seen. Revoke the approval."
    },
    interaction_only: {
      ru: "Кошелёк взаимодействовал с Verify20, но его роль не установлена. Нужна ручная проверка: такое взаимодействие не присваивает дрейнер-роль.",
      en: "The wallet interacted with Verify20, but its role is unknown. Manual review is required; this interaction does not assign a drainer role."
    }
  }[input.role];
  if (!copy) return null;
  return narrativeFact(
    `verify20:${input.role}`,
    input.role === "verify20_contract" ? "verify20_template" : "approval_drain",
    copy.ru,
    copy.en,
    input.role,
    input.role === "verify20_contract" ? "strong" : "context",
    input.fingerprint.selectors.map((selector) => `verify20:${selector}`)
  );
}

type InteractionTransfer = NonNullable<DirectCounterpartyInteractionProfile["transfers"]>[number];

function matchedPrincipalTransfers(
  fact: FirstHopBlacklistFact,
  profiles: DirectCounterpartyInteractionProfile[]
): InteractionTransfer[] {
  const hashes = new Set(fact.transferTxHashes);
  return profiles
    .filter((profile) =>
      profile.counterpartyAddress === fact.counterpartyAddress && profile.direction === fact.direction
    )
    .flatMap((profile) => profile.transfers ?? [])
    .filter((transfer) =>
      hashes.has(transfer.txHash) &&
      !(transfer.economicRole === "service_fee" && transfer.economicProtocol === "tron_gasfree")
    );
}

function selectedChronologyTransfer(
  fact: FirstHopBlacklistFact,
  profiles: DirectCounterpartyInteractionProfile[]
): InteractionTransfer | null {
  const transfers = matchedPrincipalTransfers(fact, profiles);
  return [...transfers].sort((left, right) => {
    const amountOrder = rawAmount(right.amountRaw) > rawAmount(left.amountRaw)
      ? 1
      : rawAmount(right.amountRaw) < rawAmount(left.amountRaw) ? -1 : 0;
    return amountOrder || compareLexical(left.timestamp, right.timestamp) || compareLexical(left.txHash, right.txHash);
  })[0] ?? null;
}

function firstHopChronology(
  fact: FirstHopBlacklistFact,
  profiles: DirectCounterpartyInteractionProfile[]
): { ru: string; en: string } {
  if (fact.temporalRelation === "active_at_transfer") {
    return {
      ru: "Перевод выполнен, когда контрагент уже находился в чёрном списке USDT.",
      en: "The transfer was made while the counterparty was already on the USDT blacklist."
    };
  }
  if (fact.temporalRelation === "mixed") {
    return {
      ru: `До блокировки прошло ${formatUsdtRaw(fact.beforeEffectiveAmountRaw, "ru")} USDT, после блокировки — ${formatUsdtRaw(fact.activeAmountRaw, "ru")} USDT.`,
      en: `${formatUsdtRaw(fact.beforeEffectiveAmountRaw, "en")} USDT moved before the blacklist took effect and ${formatUsdtRaw(fact.activeAmountRaw, "en")} USDT after it took effect.`
    };
  }
  if (fact.temporalRelation === "unknown") {
    return {
      ru: "На момент проверки контрагент находился в чёрном списке USDT. Дату блокировки установить не удалось.",
      en: "The counterparty was on the USDT blacklist when checked. The listing date could not be established."
    };
  }
  const transfer = selectedChronologyTransfer(fact, profiles);
  const effectiveMs = fact.effectiveAt ? Date.parse(fact.effectiveAt) : Number.NaN;
  const transferMs = transfer ? Date.parse(transfer.timestamp) : Number.NaN;
  const elapsed = durationParts(effectiveMs - transferMs);
  if (!transfer || !elapsed) {
    return {
      ru: "Контрагента внесли в чёрный список USDT после этих переводов.",
      en: "The counterparty was added to the USDT blacklist after these transfers."
    };
  }
  return {
    ru: `Контрагента внесли в список через ${elapsed.ru} после перевода на ${formatUsdtRaw(transfer.amountRaw, "ru")} USDT.`,
    en: `The counterparty was listed ${elapsed.en} after the ${formatUsdtRaw(transfer.amountRaw, "en")} USDT transfer.`
  };
}

export function firstHopBlacklistFacts(
  checkedAddress: string,
  facts: FirstHopBlacklistFact[],
  profiles: DirectCounterpartyInteractionProfile[] = [],
  subjectRestriction: StablecoinRestrictionProfile | null = null
): NarrativeFact[] {
  const subjectKnownClear = subjectRestriction?.evidenceStrength === "exact_contract_state" &&
    subjectRestriction.subjectAddress === checkedAddress &&
    subjectRestriction.isBlacklisted === false;
  return facts
    .filter((fact) =>
      fact.evidenceKind === "usdt_blacklist" &&
      fact.evidenceAuthority === "official_contract" &&
      fact.statusAtCheck === "active"
    )
    .map((fact) => {
      const amountRu = formatUsdtRaw(fact.principalAmountRaw, "ru");
      const amountEn = formatUsdtRaw(fact.principalAmountRaw, "en");
      const address = shortAddress(fact.counterpartyAddress);
      const direction = fact.direction === "inbound"
        ? {
            ru: `Входящий: адрес получил ${amountRu} USDT от контрагента ${address} в чёрном списке USDT (${russianDirectTransferCount(fact.principalTxCount)}).`,
            en: `Inbound: the address received ${amountEn} USDT from blacklisted counterparty ${address} (${englishDirectTransferCount(fact.principalTxCount)}).`
          }
        : {
            ru: `Исходящий: адрес отправил ${amountRu} USDT контрагенту ${address} в чёрном списке USDT (${russianDirectTransferCount(fact.principalTxCount)}).`,
            en: `Outbound: the address sent ${amountEn} USDT to blacklisted counterparty ${address} (${englishDirectTransferCount(fact.principalTxCount)}).`
          };
      const share = fact.shareSemantics === "exact" && fact.directionalPrincipalShare !== null
        ? {
            ru: ` Это ${formatPercent(fact.directionalPrincipalShare, "ru")}% суммы направления.`,
            en: ` This is ${formatPercent(fact.directionalPrincipalShare, "en")}% of that direction's amount.`
          }
        : { ru: "", en: "" };
      const chronology = firstHopChronology(fact, profiles);
      const subjectClear = subjectKnownClear
        ? {
            ru: " Сам проверяемый адрес в чёрный список не внесён.",
            en: " The checked address itself is not on the USDT blacklist."
          }
        : { ru: "", en: "" };
      return narrativeFact(
        `first-hop-blacklist:${fact.direction}:${fact.counterpartyAddress}:${fact.transferTxHashes.slice().sort().join(",")}`,
        "direct_counterparty_blacklist",
        `${direction.ru}${share.ru} ${chronology.ru}${subjectClear.ru}`,
        `${direction.en}${share.en} ${chronology.en}${subjectClear.en}`,
        null,
        "exact",
        fact.transferTxHashes
      );
    });
}

const labelCopy: Record<RiskLabel, { ru: string; en: string }> = {
  scam: { ru: "мошенничество", en: "scam" },
  reported_scam: { ru: "сообщение о мошенничестве", en: "reported scam" },
  stolen_funds: { ru: "украденные средства", en: "stolen funds" },
  phishing: { ru: "фишинг", en: "phishing" },
  victim: { ru: "жертва", en: "victim" },
  mule: { ru: "транзитный посредник", en: "mule" },
  collector: { ru: "сборщик", en: "collector" },
  bridge: { ru: "мост", en: "bridge" },
  exchange: { ru: "биржа", en: "exchange" },
  trusted: { ru: "доверенный сервис", en: "trusted service" },
  false_positive: { ru: "ошибочная метка", en: "false positive" },
  needs_review: { ru: "нужна проверка", en: "review required" },
  mixer_like: { ru: "признаки миксера", en: "mixer-like activity" },
  risky_contract: { ru: "рискованный контракт", en: "risky contract" },
  whitebit: { ru: "WhiteBIT", en: "WhiteBIT" },
  darknet_exchange: { ru: "даркнет-биржа", en: "darknet exchange" },
  darknet_exchange_proximity: { ru: "связь с даркнет-биржей", en: "darknet exchange proximity" },
  approval_drain_proximity: { ru: "связь с дрейнер-цепочкой", en: "approval-drain route proximity" }
};

function firstHopLabelNarrative(fact: FirstHopLabelFact): NarrativeFact | null {
  if (fact.labelCode === "false_positive") return null;
  const amountRu = formatUsdtRaw(fact.principalAmountRaw, "ru");
  const amountEn = formatUsdtRaw(fact.principalAmountRaw, "en");
  const label = labelCopy[fact.labelCode];
  const directionRu = fact.direction === "inbound" ? "получил" : "отправил";
  const directionEn = fact.direction === "inbound" ? "received" : "sent";
  const exactAdverse = new Set<RiskLabel>([
    "scam",
    "reported_scam",
    "stolen_funds",
    "phishing",
    "mixer_like",
    "risky_contract",
    "darknet_exchange"
  ]).has(fact.labelCode) && fact.evidenceAuthority === "exact_internal";
  let kind: NarrativeFactKind = exactAdverse
    ? "direct_counterparty_exact_label"
    : "risky_counterparty";
  let role: NarrativeAddressRole | null = null;
  let meaningRu: string;
  let meaningEn: string;

  if (fact.labelCode === "bridge") {
    kind = "bridge_route";
    meaningRu = "Контрагент отмечен как мост; это контекст маршрута между сетями.";
    meaningEn = "The counterparty is labeled as a bridge; this is cross-chain route context.";
  } else if (["exchange", "whitebit", "trusted"].includes(fact.labelCode)) {
    kind = "cex_source";
    meaningRu = `Контрагент отмечен как «${label.ru}»; это сервисный контекст, а не плохая метка.`;
    meaningEn = `The counterparty is labeled “${label.en}”; this is service context, not an adverse label.`;
  } else if (fact.labelCode === "collector" || fact.labelCode === "mule") {
    kind = "collector";
    role = "collector";
    meaningRu = `Контрагент отмечен как «${label.ru}»; это контекст транзитной роли.`;
    meaningEn = `The counterparty is labeled “${label.en}”; this is transit-role context.`;
  } else if (fact.labelCode === "victim") {
    role = "victim";
    meaningRu = "Контрагент отмечен как жертва; это контекст пострадавшей стороны.";
    meaningEn = "The counterparty is labeled as a victim; this is affected-party context.";
  } else if (fact.labelCode === "needs_review") {
    meaningRu = "Контрагенту нужна ручная проверка; метка не подтверждает конкретное нарушение.";
    meaningEn = "The counterparty needs manual review; the label does not confirm a specific violation.";
  } else if (!exactAdverse) {
    meaningRu = `У контрагента есть контекстная метка «${label.ru}»; она сама по себе не доказывает роль адреса.`;
    meaningEn = `The counterparty has the contextual label “${label.en}”; it does not prove the address role by itself.`;
  } else {
    meaningRu = `Контрагент имеет точную неблагоприятную метку «${label.ru}».`;
    meaningEn = `The counterparty has the exact adverse label “${label.en}”.`;
  }
  return narrativeFact(
    `first-hop-label:${fact.direction}:${fact.counterpartyAddress}:${fact.labelCode}:${fact.transferTxHashes.slice().sort().join(",")}`,
    kind,
    `Адрес ${directionRu} ${amountRu} USDT по прямой связи. ${meaningRu}`,
    `The address ${directionEn} ${amountEn} USDT through a direct link. ${meaningEn}`,
    role,
    exactAdverse ? "exact" : "context",
    fact.transferTxHashes
  );
}

function pathEvidenceIds(path: MoneyOriginPath): Set<string> {
  return new Set([
    path.balanceTransferTxHash,
    ...path.txHashes,
    ...path.steps.map((step) => step.txHash)
  ]);
}

function policyMatchesPath(evidence: SourcePolicyEvidence, path: MoneyOriginPath): boolean {
  const ids = pathEvidenceIds(path);
  return evidence.evidenceIds.some((id) => ids.has(id));
}

function pathAmountRaw(path: MoneyOriginPath): string {
  return path.amountUsage?.usedAmountRaw ?? path.steps.at(-1)?.amountRaw ?? "0";
}

function sumRaw(values: string[]): string {
  return values.reduce((sum, value) => sum + rawAmount(value), 0n).toString();
}

function sourceShareText(
  share: number | null,
  amountRaw: string,
  locale: WalletNarrativeLocale
): string {
  return share === null
    ? `${formatUsdtRaw(amountRaw, locale)} USDT`
    : `${formatPercent(share, locale)}%`;
}

function sourceAmountAndShareText(
  share: number,
  amountRaw: string,
  locale: WalletNarrativeLocale
): string {
  return `${formatUsdtRaw(amountRaw, locale)} USDT (${formatPercent(share, locale)}%)`;
}

function isHtxName(value: string): boolean {
  return /(?:^|[^a-z])(?:htx|huobi)(?:[^a-z]|$)/i.test(value);
}

function aggregateSourceIdentity(
  paths: MoneyOriginPath[],
  copy: {
    multipleRu: string;
    multipleEn: string;
    unnamedRu: string;
    unnamedEn: string;
  }
): {
  ru: string;
  en: string;
  named: boolean;
  multiple: boolean;
} {
  const labels = paths.map((path) => path.exposureSourceLabel?.trim() || null);
  const names = [...new Set(labels.filter((label): label is string => label !== null))]
    .sort(compareLexical);
  if (labels.every((label) => label !== null) && names.length === 1) {
    return { ru: names[0]!, en: names[0]!, named: true, multiple: false };
  }
  if (paths.length > 1 || names.length > 1) {
    return {
      ru: copy.multipleRu,
      en: copy.multipleEn,
      named: false,
      multiple: true
    };
  }
  return {
    ru: copy.unnamedRu,
    en: copy.unnamedEn,
    named: false,
    multiple: false
  };
}

function sanctionedSourceFacts(paths: MoneyOriginPath[], evidence: SourcePolicyEvidence[]): NarrativeFact[] {
  const sanctionedPaths = paths.filter((path) => path.sourceExposureKind === "sanctioned_service");
  if (sanctionedPaths.length === 0) return [];
  const matchedPaths = new Set<MoneyOriginPath>();
  const selected = evidence.filter((item) =>
    item.kind === "sanctioned_service" &&
    item.proofLevel === "exchange_policy_decline" &&
    item.shareDetail !== undefined
  ).flatMap((item) => {
    const matching = sanctionedPaths.filter((path) => policyMatchesPath(item, path));
    if (matching.length === 0) return [];
    matching.forEach((path) => matchedPaths.add(path));
    const identity = aggregateSourceIdentity(matching, {
      multipleRu: "нескольких санкционных сервисов",
      multipleEn: "multiple sanctioned services",
      unnamedRu: "санкционного сервиса без установленного названия",
      unnamedEn: "an unnamed sanctioned service"
    });
    const share = item.shareDetail!.rawShare;
    const amountRaw = item.shareDetail!.affectedAmountRaw;
    const ids = [...new Set([...item.evidenceIds, ...matching.flatMap((path) => [...pathEvidenceIds(path)])])]
      .sort(compareLexical);
    const sourceRu = identity.named ? `с ${identity.ru}` : `от ${identity.ru}`;
    const sourceEn = `from ${identity.en}`;
    const htx = identity.named && isHtxName(identity.ru);
    return [narrativeFact(
      `sanctioned-source:${ids.join(",")}`,
      "sanctioned_source",
      htx
        ? `${sourceAmountAndShareText(share, amountRaw, "ru")} пришло ${sourceRu}. HTX/Huobi под санкциями Великобритании с 26 мая 2026 года. Это санкционный источник. Операцию не проводить.`
        : `${sourceAmountAndShareText(share, amountRaw, "ru")} пришло ${sourceRu}. Это подтверждённый санкционный источник. Операцию не проводить.`,
      htx
        ? `${sourceAmountAndShareText(share, amountRaw, "en")} came ${sourceEn}. HTX/Huobi has been under UK sanctions since 26 May 2026. This is a sanctioned source. Do not proceed.`
        : `${sourceAmountAndShareText(share, amountRaw, "en")} came ${sourceEn}. This is a confirmed sanctioned source. Do not proceed.`,
      null,
      "exact",
      ids
    )];
  });
  const unmatched = sanctionedPaths.filter((path) => !matchedPaths.has(path)).map((path) => {
    const nameRu = path.exposureSourceLabel?.trim() || "санкционным сервисом без установленного названия";
    const nameEn = path.exposureSourceLabel?.trim() || "an unnamed sanctioned service";
    const ids = [...pathEvidenceIds(path)].sort(compareLexical);
    return narrativeFact(
      `sanctioned-source-context:${ids.join(",")}`,
      "direct_counterparty_sanction",
      `Входящая связь с ${nameRu} есть в истории, но не подтверждена как источник выбранной суммы. Нужна ручная проверка.`,
      `The inbound link to ${nameEn} is present in history but is not confirmed as a source of the selected amount. Manual review is required.`,
      null,
      "context",
      ids
    );
  });
  return [...selected, ...unmatched];
}

function htxContextFacts(paths: MoneyOriginPath[]): NarrativeFact[] {
  return paths.filter((path) => path.sourceExposureKind === "htx_huobi").map((path) => {
    const name = path.exposureSourceLabel?.trim() || "HTX/Huobi";
    const ids = [...pathEvidenceIds(path)].sort(compareLexical);
    return narrativeFact(
      `htx-context:${ids.join(",")}`,
      "direct_counterparty_sanction",
      `Входящий перевод с ${name} — исторический контекст, а не подтверждённый санкционный источник выбранной суммы.`,
      `The inbound transfer from ${name} is historical context, not a confirmed sanctioned source of the selected amount.`,
      null,
      "context",
      ids
    );
  });
}

function outboundHtxFacts(profiles: OperationalFlowProfile[]): NarrativeFact[] {
  return profiles.flatMap((profile) => profile.topOutgoingCounterparties
    .filter((row) => row.isHtxHuobi)
    .map((row) => narrativeFact(
      `htx-outbound:${row.address}`,
      "direct_counterparty_sanction",
      `Исходящий: адрес отправил ${formatUsdtRaw(row.volumeRaw, "ru")} USDT на ${row.identity ?? shortAddress(row.address)} (${russianDirectTransferCount(row.txCount)}). Это прямая историческая связь.`,
      `Outbound: the address sent ${formatUsdtRaw(row.volumeRaw, "en")} USDT to ${row.identity ?? shortAddress(row.address)} (${englishDirectTransferCount(row.txCount)}). This is a direct historical link.`,
      null,
      "context"
    )));
}

function routeEvidenceIds(paths: MoneyOriginPath[], policy?: SourcePolicyEvidence): string[] {
  return [...new Set([
    ...paths.flatMap((path) => [...pathEvidenceIds(path)]),
    ...(policy?.evidenceIds ?? [])
  ])].sort(compareLexical);
}

function policyForRoute(
  kind: SourcePolicyEvidence["kind"],
  paths: MoneyOriginPath[],
  evidence: SourcePolicyEvidence[]
): SourcePolicyEvidence | undefined {
  return evidence
    .filter((item) => item.kind === kind && paths.some((path) => policyMatchesPath(item, path)))
    .sort((left, right) => compareLexical(left.evidenceIds.slice().sort(compareLexical).join(","), right.evidenceIds.slice().sort(compareLexical).join(",")))[0];
}

function crossChainFacts(paths: MoneyOriginPath[], evidence: SourcePolicyEvidence[]): NarrativeFact[] {
  const routePaths = paths.filter((path) => path.sourceExposureKind === "cross_chain_boundary");
  if (routePaths.length === 0) return [];
  const policy = policyForRoute("cross_chain_boundary", routePaths, evidence);
  const share = policy?.shareDetail?.rawShare ?? policy?.aggregateShare ??
    routePaths.reduce((sum, path) => sum + (path.balanceShare ?? 0), 0);
  const amountRaw = policy?.shareDetail?.affectedAmountRaw ?? sumRaw(routePaths.map(pathAmountRaw));
  const identity = aggregateSourceIdentity(routePaths, {
    multipleRu: "несколько cross-chain сервисов",
    multipleEn: "multiple cross-chain services",
    unnamedRu: "cross-chain сервис без установленного названия",
    unnamedEn: "an unnamed cross-chain service"
  });
  const txHashes = [...new Set(routePaths.map((path) => path.balanceTransferTxHash))].sort(compareLexical);
  const count = txHashes.length;
  const repeatedRu = count > 1 ? ` в ${count} переводах` : "";
  const repeatedEn = count > 1 ? ` in ${count} transfers` : "";
  const historyRu = identity.multiple ? "История до этих сервисов" : "История до этого сервиса";
  const historyEn = identity.multiple ? "History before these services" : "History before this service";
  const ids = routeEvidenceIds(routePaths, policy);
  return [narrativeFact(
    `cross-chain:${ids.join(",")}`,
    "bridge_route",
    `${sourceShareText(share, amountRaw, "ru")} проверяемой суммы пришло через ${identity.ru}${repeatedRu}. ${historyRu} находится в другой сети и не видна в TRON. Такие маршруты подходят для обычных обменов и сокрытия происхождения; маршрут${count > 1 ? " нетипичен для депозита и" : ""} повышает AML-риск.`,
    `${sourceShareText(share, amountRaw, "en")} of the checked amount came through ${identity.en}${repeatedEn}. ${historyEn} is on another chain and not visible on TRON. Such routes support ordinary swaps and can hide origin; this route${count > 1 ? " is unusual for a deposit and" : ""} increases AML risk.`,
    null,
    count > 1 ? "strong" : "context",
    ids
  )];
}

function bridgeRouterDexFacts(paths: MoneyOriginPath[], evidence: SourcePolicyEvidence[]): NarrativeFact[] {
  const routePaths = paths.filter((path) => path.sourceExposureKind === "bridge_router_dex");
  if (routePaths.length === 0) return [];
  const policy = policyForRoute("bridge_router_dex", routePaths, evidence);
  const share = policy?.shareDetail?.rawShare ?? policy?.aggregateShare ??
    routePaths.reduce((sum, path) => sum + (path.balanceShare ?? 0), 0);
  const amountRaw = policy?.shareDetail?.affectedAmountRaw ?? sumRaw(routePaths.map(pathAmountRaw));
  const identity = aggregateSourceIdentity(routePaths, {
    multipleRu: "несколько DEX/router-сервисов",
    multipleEn: "multiple DEX/router services",
    unnamedRu: "DEX/router-сервис без установленного названия",
    unnamedEn: "an unnamed DEX/router service"
  });
  const nameRu = identity.named ? `${identity.ru}, DEX/router-сервис` : identity.ru;
  const nameEn = identity.named ? `${identity.en}, a DEX/router service` : identity.en;
  const ids = routeEvidenceIds(routePaths, policy);
  return [narrativeFact(
    `dex-router:${ids.join(",")}`,
    "bridge_route",
    `${sourceShareText(share, amountRaw, "ru")} проверяемой суммы прошло через ${nameRu}. Такие сервисы используют для обычных обменов и сокрытия происхождения; маршрут повышает AML-риск.`,
    `${sourceShareText(share, amountRaw, "en")} of the checked amount passed through ${nameEn}. These services support ordinary swaps and can hide origin; the route increases AML risk.`,
    null,
    "context",
    ids
  )];
}

function cexFacts(paths: MoneyOriginPath[]): NarrativeFact[] {
  const groups = new Map<string, MoneyOriginPath[]>();
  for (const path of paths) {
    if (path.sourceExposureKind !== "allowlisted_cex" && path.rootSourceType !== "allowlist_cex") continue;
    const name = path.exposureSourceLabel?.trim() || "";
    groups.set(name, [...(groups.get(name) ?? []), path]);
  }
  return [...groups.entries()].map(([name, group]) => {
    const nameRu = name || "биржевого сервиса без установленного названия";
    const nameEn = name || "an unnamed exchange service";
    const share = group.reduce((sum, path) => sum + (path.balanceShare ?? 0), 0);
    const txHashes = [...new Set(group.map((path) => path.balanceTransferTxHash))].sort();
    return narrativeFact(
      `cex:${name}:${txHashes.join(",")}`,
      "cex_source",
      `${formatPercent(share, "ru")}% проверяемой суммы пришло с ${nameRu} (${russianDirectTransferCount(txHashes.length)}). Это похоже на вывод средств с биржи.`,
      `${formatPercent(share, "en")}% of the checked amount came from ${nameEn} (${englishDirectTransferCount(txHashes.length)}). This looks like an exchange withdrawal.`,
      null,
      "context",
      txHashes
    );
  });
}

function traceStopText(path: MoneyOriginPath): { ru: string; en: string } | null {
  const coverage = path.historyCoverage ?? [];
  if (path.stoppedReason !== "incoming_history_not_fetched" && coverage.length === 0) return null;
  if (coverage.some((item) => item.budgetExhausted || item.statusReason === "partial_budget_exhausted")) {
    return { ru: "Дальше не проследили: проверка остановилась на техническом лимите.", en: "The trace stopped there because the check reached a technical limit." };
  }
  if (coverage.some((item) => item.providerInconsistent || item.statusReason === "partial_provider_inconsistent")) {
    return { ru: "Дальше не проследили: источник данных вернул противоречивую историю.", en: "The trace stopped there because the provider returned inconsistent history." };
  }
  if (coverage.some((item) => item.providerCapHit || item.statusReason === "partial_provider_cap")) {
    return { ru: "Дальше не проследили: более старые переводы не получены от источника данных.", en: "The trace stopped there because the provider did not return older transfers." };
  }
  if (coverage.some((item) => item.statusReason === "failed_retryable" || item.statusReason === "failed_terminal")) {
    return { ru: "Дальше не проследили: запрос истории завершился ошибкой источника данных.", en: "The trace stopped there because the provider history request failed." };
  }
  return path.stoppedReason === "incoming_history_not_fetched"
    ? { ru: "Дальше не проследили: более старая история переводов недоступна.", en: "The trace stopped there because older transfer history is unavailable." }
    : null;
}

function unknownContractFacts(paths: MoneyOriginPath[]): NarrativeFact[] {
  return paths.filter((path) => path.sourceExposureKind === "unknown_contract").map((path) => {
    const stop = traceStopText(path);
    const nameRu = path.exposureSourceLabel?.trim() || "контракт без названия";
    const nameEn = path.exposureSourceLabel?.trim() || "an unnamed contract";
    return narrativeFact(
      `unknown-contract:${path.txHashes.slice().sort().join(",")}`,
      "unknown_contract",
      `Часть суммы пришла через ${nameRu}.${stop ? ` ${stop.ru}` : ""}`,
      `Part of the amount came through ${nameEn}.${stop ? ` ${stop.en}` : ""}`,
      null,
      stop ? "limitation" : "context",
      [...pathEvidenceIds(path)]
    );
  });
}

function serviceBoundaryFacts(profiles: BoundaryExposureProfile[]): NarrativeFact[] {
  return profiles.flatMap((profile) => profile.topBoundaryEntities.map((entity) => {
    const txHashes = profile.flows
      .filter((flow) => flow.boundaryAddress === entity.address)
      .flatMap((flow) => [flow.subjectTxHash, flow.boundaryTxHash]);
    const name = entity.identity ?? shortAddress(entity.address);
    return narrativeFact(
      `service:${entity.address}:${[...new Set(txHashes)].sort().join(",")}`,
      entity.category === "cex" ? "cex_source" : "unknown_contract",
      `${name} — сервис с общей ликвидностью. Источник до сервиса не прослеживается, потому что здесь объединяются переводы разных клиентов.`,
      `${name} is a pooled liquidity service. The source before the service cannot be traced because transfers from different clients merge there.`,
      null,
      "limitation",
      txHashes
    );
  }));
}

function collectorFacts(
  behaviorProfiles: AddressBehaviorProfile[],
  operationalProfiles: OperationalFlowProfile[]
): NarrativeFact[] {
  return behaviorProfiles.flatMap((behavior) => {
    if (behavior.transitScore <= 0 || behavior.uniqueIncomingCounterparties < 2) return [];
    const operational = operationalProfiles.find((profile) => profile.subjectAddress === behavior.subjectAddress);
    if (!operational) return [];
    const destination = operational.topOutgoingCounterparties
      .filter((row) => row.isTerminalLiquidity === true && tryRawAmount(row.volumeRaw) !== null)
      .sort((left, right) => {
        const leftVolume = rawAmount(left.volumeRaw);
        const rightVolume = rawAmount(right.volumeRaw);
        return rightVolume > leftVolume ? 1 : rightVolume < leftVolume ? -1 : compareLexical(left.address, right.address);
      })[0];
    if (!destination) return [];
    const shareRu = formatRawSharePercent(destination.volumeRaw, operational.incomingVolumeRaw, "ru");
    const shareEn = formatRawSharePercent(destination.volumeRaw, operational.incomingVolumeRaw, "en");
    const destinationName = destination.identity ?? shortAddress(destination.address);
    const flowRu = shareRu === null
      ? `отправляет ${formatUsdtRaw(destination.volumeRaw, "ru")} USDT на ${destinationName}`
      : `отправляет ${shareRu}% поступлений на ${destinationName}`;
    const flowEn = shareEn === null
      ? `sends ${formatUsdtRaw(destination.volumeRaw, "en")} USDT to ${destinationName}`
      : `sends ${shareEn}% of inflows to ${destinationName}`;
    return [narrativeFact(
      `collector:${behavior.subjectAddress}:${destination.address}`,
      "collector",
      `Кошелёк собирает переводы от ${behavior.uniqueIncomingCounterparties} адресов и ${flowRu}. Это транзитный кошелёк-сборщик ликвидности.`,
      `The wallet collects transfers from ${behavior.uniqueIncomingCounterparties} addresses and ${flowEn}. It is a transit liquidity collector wallet.`,
      "collector",
      "context"
    )];
  });
}

function riskyCounterpartyFacts(profiles: DirectCounterpartyInteractionProfile[]): NarrativeFact[] {
  return profiles.flatMap((profile) => {
    if (profile.snapshot.riskLevel !== "HIGH" && profile.snapshot.riskLevel !== "CRITICAL") return [];
    const transfers = (profile.transfers ?? []).filter((transfer) =>
      !(transfer.economicRole === "service_fee" && transfer.economicProtocol === "tron_gasfree")
    );
    if (transfers.length === 0) return [];
    const amountRaw = sumRaw(transfers.map((transfer) => transfer.amountRaw));
    const address = shortAddress(profile.counterpartyAddress);
    const exactShare = rawAmount(profile.volumeRaw) === rawAmount(amountRaw);
    const consequence = exactShare
      ? {
          ru: `Это ${formatPercent(profile.volumeRatio, "ru")}% объёма направления; повышенный риск относится к этой части суммы.`,
          en: `This is ${formatPercent(profile.volumeRatio, "en")}% of that direction's volume; the elevated risk applies to that share.`
        }
      : {
          ru: "Повышенный риск относится к этой части суммы.",
          en: "The elevated risk applies to that share."
        };
    const direction = profile.direction === "inbound"
      ? {
          ru: `Входящий: адрес получил ${formatUsdtRaw(amountRaw, "ru")} USDT от адреса ${address} с высоким риском (${russianDirectTransferCount(transfers.length)}). ${consequence.ru}`,
          en: `Inbound: the address received ${formatUsdtRaw(amountRaw, "en")} USDT from high-risk address ${address} (${englishDirectTransferCount(transfers.length)}). ${consequence.en}`
        }
      : {
          ru: `Исходящий: адрес отправил ${formatUsdtRaw(amountRaw, "ru")} USDT адресу ${address} с высоким риском (${russianDirectTransferCount(transfers.length)}). ${consequence.ru}`,
          en: `Outbound: the address sent ${formatUsdtRaw(amountRaw, "en")} USDT to high-risk address ${address} (${englishDirectTransferCount(transfers.length)}). ${consequence.en}`
        };
    return [narrativeFact(
      `risky-counterparty:${profile.direction}:${profile.counterpartyAddress}:${transfers.map((transfer) => transfer.txHash).sort().join(",")}`,
      "risky_counterparty",
      direction.ru,
      direction.en,
      null,
      "context",
      transfers.map((transfer) => transfer.txHash)
    )];
  });
}

export function sourceAndRouteFacts(input: {
  paths?: MoneyOriginPath[];
  sourcePolicyEvidence?: SourcePolicyEvidence[];
  firstHopLabelFacts?: FirstHopLabelFact[];
  directCounterpartyInteractionProfiles?: DirectCounterpartyInteractionProfile[];
  addressBehaviorProfiles?: AddressBehaviorProfile[];
  operationalFlowProfiles?: OperationalFlowProfile[];
  boundaryExposureProfiles?: BoundaryExposureProfile[];
}): NarrativeFact[] {
  const paths = input.paths ?? [];
  const policy = input.sourcePolicyEvidence ?? [];
  const facts = [
    ...sanctionedSourceFacts(paths, policy),
    ...htxContextFacts(paths),
    ...outboundHtxFacts(input.operationalFlowProfiles ?? []),
    ...crossChainFacts(paths, policy),
    ...bridgeRouterDexFacts(paths, policy),
    ...cexFacts(paths),
    ...unknownContractFacts(paths),
    ...serviceBoundaryFacts(input.boundaryExposureProfiles ?? []),
    ...collectorFacts(input.addressBehaviorProfiles ?? [], input.operationalFlowProfiles ?? []),
    ...riskyCounterpartyFacts(input.directCounterpartyInteractionProfiles ?? []),
    ...(input.firstHopLabelFacts ?? []).flatMap((fact) => firstHopLabelNarrative(fact) ?? [])
  ];
  return canonicalFacts(facts);
}

export function gasFreeFeeFact(
  profiles: DirectCounterpartyInteractionProfile[]
): NarrativeFact | null {
  const fees = new Map<string, bigint>();
  for (const profile of profiles) {
    for (const transfer of profile.transfers ?? []) {
      if (
        transfer.economicRole !== "service_fee" ||
        transfer.economicProtocol !== "tron_gasfree"
      ) continue;
      const key = `${transfer.txHash}:${transfer.fromAddress}:${transfer.toAddress}:${transfer.amountRaw}`;
      if (!fees.has(key)) fees.set(key, rawAmount(transfer.amountRaw));
    }
  }
  const total = [...fees.values()].reduce((sum, value) => sum + value, 0n);
  if (total === 0n) return null;
  const txHashes = [...new Set([...fees.keys()].map((key) => key.slice(0, key.indexOf(":"))))]
    .sort(compareLexical);
  return narrativeFact(
    `gasfree-fee:${[...fees.keys()].sort().join(",")}`,
    "gasfree_fee",
    `GasFree удержал ${formatUsdtRaw(total.toString(), "ru")} USDT перед переводом. Это комиссия сервиса, а не основная сумма перевода.`,
    `GasFree retained ${formatUsdtRaw(total.toString(), "en")} USDT before the transfer. This is a service fee, not transfer principal.`,
    null,
    "exact",
    txHashes
  );
}

function traceHistoryReason(
  coverage: MoneyOriginTraceHistoryCoverage[]
): { ru: string; en: string } | null {
  if (coverage.some((item) => item.budgetExhausted || item.statusReason === "partial_budget_exhausted")) {
    return { ru: "проверка остановилась на техническом лимите", en: "the check stopped at a technical limit" };
  }
  if (coverage.some((item) => item.providerInconsistent || item.statusReason === "partial_provider_inconsistent")) {
    return { ru: "источник данных вернул противоречивую историю", en: "the data provider returned inconsistent history" };
  }
  if (coverage.some((item) => item.providerCapHit || item.statusReason === "partial_provider_cap")) {
    return { ru: "источник данных не отдал старые переводы", en: "the provider did not return older transfers" };
  }
  if (coverage.some((item) =>
    item.statusReason === "failed_retryable" ||
    item.statusReason === "failed_terminal" ||
    item.statusReason === "partial_rate_limited"
  )) {
    return { ru: "источник данных завершил запрос истории с ошибкой", en: "the data provider history request failed" };
  }
  return null;
}

function whereCoverageText(
  coverage: WhereIsMoneyCoverage | null | undefined,
  history: MoneyOriginTraceHistoryCoverage[]
): { ru: string; en: string } | null {
  if (!coverage) return null;
  const ratio = coverage.coverageRatio ?? coverage.currentBalanceCoverageRatio;
  const reason = traceHistoryReason(history);
  if (coverage.partial && coverage.selectedInboundTxCount === 0 && reason) {
    return {
      ru: `Происхождение суммы не удалось проследить: ${reason.ru}.`,
      en: `We could not trace the source of the amount because ${reason.en}.`
    };
  }
  const percent = checkedPercent(Math.max(0, Math.min(1, ratio)) * 100);
  const base = {
    ru: `Проверено ${coverage.selectedInboundTxCount} входящих переводов; прослежено ${percent.replace(".", ",")}% суммы.`,
    en: `Checked ${coverage.selectedInboundTxCount} inbound transfers; traced ${percent}% of the amount.`
  };
  if (!coverage.partial || ratio >= 1 || !reason) return base;
  const remaining = checkedPercent((1 - Math.max(0, ratio)) * 100);
  return {
    ru: `${base.ru} Остальные ${remaining.replace(".", ",")}% не прослежены: ${reason.ru}.`,
    en: `${base.en} The remaining ${remaining}% is untraced: ${reason.en}.`
  };
}

function firstHopCoverageParts(
  coverage: FirstHopBlacklistCoverage
): Array<{ ru: string; en: string }> {
  const parts: Array<{ ru: string; en: string }> = [];
  if (coverage.directPrincipalTransferCoverage === "partial") {
    parts.push({
      ru: "История прямых переводов неполна.",
      en: "The direct transfer history is partial."
    });
  }
  if (coverage.blacklistCheckCoverage === "running") {
    parts.push({
      ru: "Проверка остальных прямых контрагентов продолжается.",
      en: "The remaining direct counterparties are still being checked."
    });
  } else if (coverage.blacklistCheckCoverage === "provider_failed") {
    parts.push({
      ru: "Часть прямых контрагентов не проверена: сбой источника.",
      en: "Some direct counterparties were not checked: provider failure."
    });
  } else if (coverage.blacklistCheckCoverage === "budget_exhausted") {
    parts.push({
      ru: "Часть прямых контрагентов не проверена: технический лимит.",
      en: "Some direct counterparties were not checked: technical limit."
    });
  } else if (coverage.blacklistCheckCoverage === "history_partial" && coverage.directPrincipalTransferCoverage !== "partial") {
    parts.push({
      ru: "История прямых переводов неполна.",
      en: "The direct transfer history is partial."
    });
  }
  if (coverage.partialTimelineFactCount > 0) {
    parts.push({
      ru: `У ${coverage.partialTimelineFactCount} связей дата блокировки подтверждена не полностью.`,
      en: `Blacklist timing is incomplete for ${coverage.partialTimelineFactCount} links.`
    });
  }
  return parts;
}

export function coverageExplanationFor(input: {
  firstHopCoverage: FirstHopBlacklistCoverage;
  whereCoverage?: WhereIsMoneyCoverage | null;
  traceHistoryCoverage?: MoneyOriginTraceHistoryCoverage[];
}): CoverageExplanation | null {
  const trace = whereCoverageText(input.whereCoverage, input.traceHistoryCoverage ?? []);
  const parts = firstHopCoverageParts(input.firstHopCoverage);
  if (trace) parts.unshift(trace);
  if (parts.length === 0) return null;
  const textRu = parts.map((part) => part.ru).join(" ");
  const textEn = parts.map((part) => part.en).join(" ");
  return {
    reasonKind: input.firstHopCoverage.blacklistCheckCoverage,
    textRu: normalizeCopy(textRu),
    textEn: normalizeCopy(textEn),
    isRiskEvidence: false
  };
}

function canonicalFacts(facts: NarrativeFact[]): NarrativeFact[] {
  const proofRank: Record<NonNullable<NarrativeFact["proofStrength"]>, number> = {
    exact: 0,
    strong: 1,
    context: 2,
    limitation: 3
  };
  const ordered = [...facts].sort((left, right) =>
    factRank[left.kind] - factRank[right.kind] ||
    (right.evidenceIds?.length ?? 0) - (left.evidenceIds?.length ?? 0) ||
    right.factTextRu.length - left.factTextRu.length ||
    proofRank[left.proofStrength ?? "context"] - proofRank[right.proofStrength ?? "context"] ||
    compareLexical(left.id, right.id) ||
    compareLexical(left.factTextRu, right.factTextRu) ||
    compareLexical(left.factTextEn, right.factTextEn)
  );
  const selected: NarrativeFact[] = [];
  for (const fact of ordered) {
    if (selected.some((existing) => existing.id === fact.id)) continue;
    const ids = new Set(fact.evidenceIds ?? []);
    const overlapsSameKind = ids.size > 0 && selected.some((existing) =>
      existing.kind === fact.kind && existing.evidenceIds?.some((id) => ids.has(id))
    );
    if (!overlapsSameKind) selected.push(fact);
  }
  return selected;
}

function assertSubjectBinding(
  checkedAddress: string,
  subjectAddress: string,
  source: string
): void {
  if (subjectAddress !== checkedAddress) {
    throw new Error(`${source} subject does not match checkedAddress.`);
  }
}

function validateEvidenceSubjectBindings(input: WalletNarrativeEvidenceInput): void {
  if (typeof input.checkedAddress !== "string" || input.checkedAddress.trim().length === 0) {
    throw new Error("Wallet narrative checkedAddress is required.");
  }
  if (input.subjectRestriction) {
    assertSubjectBinding(input.checkedAddress, input.subjectRestriction.subjectAddress, "subjectRestriction");
  }
  for (const profile of input.directCounterpartyInteractionProfiles ?? []) {
    assertSubjectBinding(input.checkedAddress, profile.subjectAddress, "directCounterpartyInteractionProfile");
  }
  for (const profile of input.addressBehaviorProfiles ?? []) {
    assertSubjectBinding(input.checkedAddress, profile.subjectAddress, "addressBehaviorProfile");
  }
  for (const profile of input.operationalFlowProfiles ?? []) {
    assertSubjectBinding(input.checkedAddress, profile.subjectAddress, "operationalFlowProfile");
  }
  for (const profile of input.boundaryExposureProfiles ?? []) {
    assertSubjectBinding(input.checkedAddress, profile.subjectAddress, "boundaryExposureProfile");
  }
  if (input.approvalDrain) {
    assertSubjectBinding(input.checkedAddress, input.approvalDrain.checkedAddress, "approvalDrain");
    assertSubjectBinding(input.checkedAddress, input.approvalDrain.profile.subjectAddress, "approvalDrainProfile");
  }
  if (input.verify20) {
    assertSubjectBinding(input.checkedAddress, input.verify20.subjectAddress, "verify20");
  }
}

export function buildWalletNarrativeEvidence(
  input: WalletNarrativeEvidenceInput
): WalletNarrativeEvidence {
  validateEvidenceSubjectBindings(input);
  const profiles = input.directCounterpartyInteractionProfiles ?? [];
  const facts: NarrativeFact[] = [];
  if (input.subjectRestriction) {
    const subject = subjectBlacklistFact(input.subjectRestriction);
    if (subject) facts.push(subject);
  }
  facts.push(...firstHopBlacklistFacts(
    input.checkedAddress,
    input.firstHopBlacklistFacts ?? [],
    profiles,
    input.subjectRestriction
  ));
  if (input.approvalDrain) {
    const approval = approvalDrainRoleFact(input.approvalDrain);
    if (approval) facts.push(approval);
  }
  if (input.verify20) {
    const verify20 = verify20RoleFact(input.verify20);
    if (verify20) facts.push(verify20);
  }
  facts.push(...sourceAndRouteFacts({
    paths: input.paths,
    sourcePolicyEvidence: input.sourcePolicyEvidence,
    firstHopLabelFacts: input.firstHopLabelFacts,
    directCounterpartyInteractionProfiles: profiles,
    addressBehaviorProfiles: input.addressBehaviorProfiles,
    operationalFlowProfiles: input.operationalFlowProfiles,
    boundaryExposureProfiles: input.boundaryExposureProfiles
  }));
  const fee = gasFreeFeeFact(profiles);
  if (fee) facts.push(fee);

  const coverageExplanation = input.firstHopBlacklistCoverage
      ? coverageExplanationFor({
        firstHopCoverage: input.firstHopBlacklistCoverage,
        whereCoverage: input.whereCoverage,
        traceHistoryCoverage: input.traceHistoryCoverage
      })
    : null;
  return { facts: canonicalFacts(facts), coverageExplanation };
}

function localizedFactText(fact: NarrativeFact, locale: WalletNarrativeLocale): string {
  return locale === "en" ? fact.factTextEn : fact.factTextRu;
}

function localizedCoverageText(
  coverage: CoverageExplanation,
  locale: WalletNarrativeLocale
): string {
  return locale === "en" ? coverage.textEn : coverage.textRu;
}

function sentenceKeys(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim().toLowerCase())
    .filter(Boolean);
}

function validateScore(decision: WalletNarrativeDecision, score: number | null): void {
  if (decision === "NO_FINAL_DECISION") {
    if (score !== null) throw new Error("NO_FINAL_DECISION must not have a score.");
    return;
  }
  if (score === null) throw new Error(`${decision} requires a score.`);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new RangeError("Wallet narrative score must be an integer between 0 and 100.");
  }
}

function validateWalletNarrativeCase(input: unknown): asserts input is WalletNarrativeCase {
  if (!isRecord(input)) throw new Error("Wallet narrative case must be an object.");
  if (input.locale !== "ru" && input.locale !== "en") {
    throw new Error('Wallet narrative locale must be "ru" or "en".');
  }
  if (typeof input.decision !== "string" || !narrativeDecisions.has(input.decision)) {
    throw new Error("Wallet narrative decision is invalid.");
  }
  validateScore(input.decision as WalletNarrativeDecision, input.score as number | null);
  if (
    input.preferredFactId !== undefined &&
    input.preferredFactId !== null &&
    typeof input.preferredFactId !== "string"
  ) {
    throw new Error("Wallet narrative preferred fact id must be a string or null.");
  }
  if (!Array.isArray(input.facts)) throw new Error("Wallet narrative facts must be an array.");
  input.facts.forEach((fact, index) => {
    if (!isRecord(fact)) throw new Error(`Wallet narrative fact at index ${index} must be an object.`);
    if (typeof fact.id !== "string") throw new Error("Wallet narrative fact id must be a string.");
    if (typeof fact.kind !== "string" || !narrativeFactKinds.has(fact.kind)) {
      throw new Error("Wallet narrative fact kind is invalid.");
    }
    if (typeof fact.factTextRu !== "string" || typeof fact.factTextEn !== "string") {
      throw new Error("Wallet narrative fact texts must be strings.");
    }
    if (
      fact.role !== undefined &&
      fact.role !== null &&
      (typeof fact.role !== "string" || !narrativeAddressRoles.has(fact.role))
    ) {
      throw new Error("Wallet narrative fact role is invalid.");
    }
    if (
      fact.proofStrength !== undefined &&
      (typeof fact.proofStrength !== "string" || !narrativeProofStrengths.has(fact.proofStrength))
    ) {
      throw new Error("Wallet narrative fact proof strength is invalid.");
    }
    if (fact.priority !== undefined && !Number.isInteger(fact.priority)) {
      throw new Error("Wallet narrative fact priority must be an integer.");
    }
    if (fact.evidenceIds !== undefined && !Array.isArray(fact.evidenceIds)) {
      throw new Error("Wallet narrative fact evidence ids must be an array.");
    }
    if (
      Array.isArray(fact.evidenceIds) &&
      fact.evidenceIds.some((id) => typeof id !== "string" || id.length === 0)
    ) {
      throw new Error("Wallet narrative fact evidence ids must contain non-empty strings.");
    }
  });
  if (input.coverageExplanation === null) return;
  if (!isRecord(input.coverageExplanation)) {
    throw new Error("Wallet narrative coverage must be an object or null.");
  }
  if (
    typeof input.coverageExplanation.textRu !== "string" ||
    typeof input.coverageExplanation.textEn !== "string"
  ) {
    throw new Error("Wallet narrative coverage texts must be strings.");
  }
  if (input.coverageExplanation.isRiskEvidence !== false) {
    throw new Error("Wallet narrative coverage must be a limitation, not risk evidence.");
  }
  if (
    input.coverageExplanation.reasonKind !== undefined &&
    typeof input.coverageExplanation.reasonKind !== "string"
  ) {
    throw new Error("Wallet narrative coverage reason kind must be a string.");
  }
}

export function buildWalletNarrativeCase(input: WalletNarrativeCase): WalletNarrativeCase {
  validateWalletNarrativeCase(input);

  const facts = input.facts.flatMap((fact) => {
    const normalized: NarrativeFact = {
      ...fact,
      id: fact.id.trim(),
      factTextRu: normalizeCopy(fact.factTextRu),
      factTextEn: normalizeCopy(fact.factTextEn)
    };
    return normalized.id && localizedFactText(normalized, input.locale) ? [normalized] : [];
  });

  const coverage = input.coverageExplanation;
  const coverageExplanation = coverage
    ? {
        textRu: normalizeCopy(coverage.textRu),
        textEn: normalizeCopy(coverage.textEn),
        isRiskEvidence: false as const
      }
    : null;

  return {
    locale: input.locale,
    decision: input.decision,
    score: input.score,
    facts,
    preferredFactId: facts.some((fact) => fact.id === input.preferredFactId)
      ? input.preferredFactId
      : null,
    coverageExplanation: coverageExplanation && localizedCoverageText(coverageExplanation, input.locale)
      ? coverageExplanation
      : null
  };
}

export function selectNarrativeFacts(caseData: WalletNarrativeCase): NarrativeFact[] {
  const selected: NarrativeFact[] = [];
  const usedSentences = new Set<string>();
  const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const compareFacts = (left: NarrativeFact, right: NarrativeFact) =>
    factRank[left.kind] - factRank[right.kind] ||
    compareText(left.id, right.id) ||
    compareText(left.kind, right.kind) ||
    compareText(left.factTextRu, right.factTextRu) ||
    compareText(left.factTextEn, right.factTextEn);
  const canonicalById = new Map<string, NarrativeFact>();
  for (const fact of [...caseData.facts].sort(compareFacts)) {
    if (!canonicalById.has(fact.id)) canonicalById.set(fact.id, fact);
  }
  const facts = [...canonicalById.values()].sort(compareFacts);
  const preferred = caseData.preferredFactId ? canonicalById.get(caseData.preferredFactId) : null;
  const orderedFacts = preferred
    ? [preferred, ...facts.filter((fact) => fact.id !== preferred.id)]
    : facts;

  for (const fact of orderedFacts) {
    const sentences = sentenceKeys(localizedFactText(fact, caseData.locale));
    if (sentences.length === 0 || sentences.some((sentence) => usedSentences.has(sentence))) continue;
    selected.push(fact);
    sentences.forEach((sentence) => usedSentences.add(sentence));
    if (selected.length === 2) break;
  }

  return selected;
}

function scoredHeader(caseData: WalletNarrativeCase): string {
  const score = caseData.score as number;
  const band = score >= 85
    ? { icon: "🔴", ru: "критический риск", en: "critical risk" }
    : score >= 60
      ? { icon: "🟠", ru: "высокий риск", en: "high risk" }
      : score >= 30
        ? { icon: "🟡", ru: "средний риск", en: "medium risk" }
        : { icon: "🟢", ru: "низкий риск", en: "low risk" };
  const action = caseData.locale === "en"
    ? {
        ACCEPTABLE: "You can proceed.",
        REVIEW: "Pause the operation and review it manually.",
        DECLINE: "Do not proceed."
      }[caseData.decision as Exclude<WalletNarrativeDecision, "NO_FINAL_DECISION">]
    : {
        ACCEPTABLE: "Можно принять.",
        REVIEW: "Поставьте операцию на паузу и проверьте вручную.",
        DECLINE: "Операцию не проводить."
      }[caseData.decision as Exclude<WalletNarrativeDecision, "NO_FINAL_DECISION">];
  return `${band.icon} ${score}/100 — ${caseData.locale === "en" ? band.en : band.ru}. ${action}`;
}

function header(caseData: WalletNarrativeCase): string {
  if (caseData.decision !== "NO_FINAL_DECISION") return scoredHeader(caseData);
  return caseData.locale === "en"
    ? "⚪ No final result. Pause the operation until the check is repeated."
    : "⚪ Итог не рассчитан. Поставьте операцию на паузу до повторной проверки.";
}

function fitsBody(parts: string[]): boolean {
  return parts.length === 0 || `\n\n${parts.join("\n\n")}`.length <= MAX_BODY_LENGTH;
}

export function formatWalletNarrativeSummary(input: WalletNarrativeCase): string {
  const caseData = buildWalletNarrativeCase(input);
  const selected = selectNarrativeFacts(caseData);
  const factParts = selected.map((fact, index) => [
    caseData.locale === "en"
      ? index === 0 ? "Finding" : "Conclusion"
      : index === 0 ? "Что нашли" : "Вывод",
    localizedFactText(fact, caseData.locale)
  ].join("\n"));

  let coveragePart: string | null = null;
  const coverageSentences = new Set<string>();
  const coverage = caseData.coverageExplanation;
  if (coverage) {
    const coverageText = localizedCoverageText(coverage, caseData.locale);
    const usedSentences = new Set(selected.slice(0, 1).flatMap((fact) =>
      sentenceKeys(localizedFactText(fact, caseData.locale))
    ));
    if (!sentenceKeys(coverageText).some((sentence) => usedSentences.has(sentence))) {
      sentenceKeys(coverageText).forEach((sentence) => coverageSentences.add(sentence));
      coveragePart = [
        caseData.locale === "en" ? "Coverage limits" : "Границы проверки",
        coverageText
      ].join("\n");
    }
  }

  const parts = factParts.slice(0, 1);
  if (coveragePart && fitsBody([...parts, coveragePart])) {
    parts.push(coveragePart);
  } else {
    coveragePart = null;
    coverageSentences.clear();
  }
  const conclusionPart = factParts[1];
  const conclusionIndex = parts.length > 0 ? 1 : 0;
  const conclusionDuplicatesCoverage = selected[1] && sentenceKeys(localizedFactText(selected[1], caseData.locale))
    .some((sentence) => coverageSentences.has(sentence));
  const withConclusion = [...parts.slice(0, conclusionIndex), conclusionPart, ...parts.slice(conclusionIndex)];
  if (conclusionPart && !conclusionDuplicatesCoverage && fitsBody(withConclusion)) {
    parts.splice(conclusionIndex, 0, conclusionPart);
  }

  return [header(caseData), ...parts].join("\n\n");
}
