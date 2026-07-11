import type {
  ApprovalDrainProvenanceProfile,
  DirectCounterpartyInteractionProfile,
  FirstHopBlacklistCoverage,
  FirstHopBlacklistFact,
  FirstHopLabelFact,
  RiskLabel,
  StablecoinRestrictionProfile,
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
  role: "verify20_contract" | "approval_only" | "interaction_only";
  fingerprint: Verify20FingerprintResult;
  debitObserved: boolean;
};

export type NarrativeSourceRouteEvidence = {
  kind:
    | "sanctioned_service"
    | "bridge"
    | "cex"
    | "service_boundary"
    | "unknown_contract"
    | "collector"
    | "risky_counterparty";
  identity: string | null;
  direction: "inbound" | "outbound";
  amountRaw: string;
  share: number | null;
  txCount: number;
  repeated?: boolean;
  uniqueCounterpartyCount?: number;
  linkedToSelectedProvenance?: boolean;
  occurredAt?: string | null;
  sanctionsAuthority?: "UK" | "unknown";
  designationDate?: "2026-05-26" | null;
  untracedReason?:
    | "history_before_contract_unavailable"
    | "pooled_service_history"
    | "provider_failed"
    | "history_partial"
    | null;
};

export type NarrativeTraceCoverage = {
  status: "exact" | "partial" | "unavailable";
  direction: "inbound" | "outbound";
  checkedTransferCount: number | null;
  tracedAmountPercent: number | null;
  untracedReason:
    | "older_history_unavailable"
    | "provider_failed"
    | "budget_exhausted"
    | "history_partial"
    | "running"
    | null;
};

export type ApprovalDrainNarrativeEvidence = {
  checkedAddress: string;
  profile: ApprovalDrainProvenanceProfile;
  walletRole?: WalletRole;
};

export type WalletNarrativeEvidenceInput = {
  subjectRestriction?: StablecoinRestrictionProfile | null;
  firstHopBlacklistFacts?: FirstHopBlacklistFact[];
  firstHopBlacklistCoverage?: FirstHopBlacklistCoverage | null;
  firstHopLabelFacts?: FirstHopLabelFact[];
  directCounterpartyInteractionProfiles?: DirectCounterpartyInteractionProfile[];
  approvalDrain?: ApprovalDrainNarrativeEvidence | null;
  verify20?: Verify20NarrativeEvidence | null;
  routes?: NarrativeSourceRouteEvidence[];
  traceCoverage?: NarrativeTraceCoverage | null;
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
  proofStrength: NonNullable<NarrativeFact["proofStrength"]>
): NarrativeFact {
  return {
    id,
    kind,
    role,
    proofStrength,
    priority: factRank[kind],
    factTextRu: normalizeCopy(factTextRu),
    factTextEn: normalizeCopy(factTextEn)
  };
}

function rawAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error("USDT raw amount must contain digits only.");
  return BigInt(value);
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

function russianTransferCount(count: number): string {
  if (count === 1) return "одном переводе";
  if (count === 2) return "двух переводах";
  if (count === 4) return "четырёх переводах";
  if (count === 10) return "10 переводах";
  return `${count} переводах`;
}

function englishTransferCount(count: number): string {
  if (count === 1) return "one transfer";
  if (count === 2) return "two transfers";
  if (count === 4) return "four transfers";
  return `${count} transfers`;
}

function durationParts(milliseconds: number): { ru: string; en: string } | null {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  let seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  return {
    ru: `${hours} ч ${minutes} мин ${seconds} с`,
    en: `${hours} h ${minutes} m ${seconds} s`
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
    "exact"
  );
}

function exactApprovalRole(
  input: ApprovalDrainNarrativeEvidence
): "victim" | "drainer_spender" | "first_receiver" | "route_linked" | null {
  const { checkedAddress, profile, walletRole } = input;
  if (
    profile.evidenceStrength === "route_linked" &&
    checkedAddress === profile.subjectAddress &&
    profile.hopDepth > 0
  ) return "route_linked";
  if (profile.evidenceStrength !== "exact_approval_and_transfer_from") return null;
  if (walletRole === "victim" || checkedAddress === profile.victimAddress) return "victim";
  if (walletRole === "drainer_spender" || checkedAddress === profile.spenderAddress) {
    return "drainer_spender";
  }
  if (walletRole === "first_receiver" || checkedAddress === profile.firstReceiverAddress) {
    return "first_receiver";
  }
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
    role === "route_linked" ? "context" : "exact"
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
    input.role === "verify20_contract" ? "strong" : "context"
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
    return amountOrder || left.timestamp.localeCompare(right.timestamp) || left.txHash.localeCompare(right.txHash);
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
  facts: FirstHopBlacklistFact[],
  profiles: DirectCounterpartyInteractionProfile[] = [],
  subjectRestriction: StablecoinRestrictionProfile | null = null
): NarrativeFact[] {
  const subjectKnownClear = subjectRestriction?.evidenceStrength === "exact_contract_state" &&
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
            ru: `Входящий: адрес получил ${amountRu} USDT от контрагента ${address} в чёрном списке USDT.`,
            en: `Inbound: the address received ${amountEn} USDT from blacklisted counterparty ${address}.`
          }
        : {
            ru: `Исходящий: адрес отправил ${amountRu} USDT контрагенту ${address} в чёрном списке USDT.`,
            en: `Outbound: the address sent ${amountEn} USDT to blacklisted counterparty ${address}.`
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
        "exact"
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

function firstHopLabelNarrative(fact: FirstHopLabelFact): NarrativeFact {
  const amountRu = formatUsdtRaw(fact.principalAmountRaw, "ru");
  const amountEn = formatUsdtRaw(fact.principalAmountRaw, "en");
  const label = labelCopy[fact.labelCode];
  const directionRu = fact.direction === "inbound" ? "получил" : "отправил";
  const directionEn = fact.direction === "inbound" ? "received" : "sent";
  const authorityRu = fact.evidenceAuthority === "exact_internal"
    ? `Контрагент имеет точную внутреннюю метку «${label.ru}».`
    : `У контрагента есть контекстная метка «${label.ru}»; она сама по себе не доказывает роль адреса.`;
  const authorityEn = fact.evidenceAuthority === "exact_internal"
    ? `The counterparty has the exact internal label “${label.en}”.`
    : `The counterparty has the contextual label “${label.en}”; it does not prove the address role by itself.`;
  return narrativeFact(
    `first-hop-label:${fact.direction}:${fact.counterpartyAddress}:${fact.labelCode}`,
    fact.evidenceAuthority === "exact_internal"
      ? "direct_counterparty_exact_label"
      : "risky_counterparty",
    `Адрес ${directionRu} ${amountRu} USDT по прямой связи. ${authorityRu}`,
    `The address ${directionEn} ${amountEn} USDT through a direct link. ${authorityEn}`,
    null,
    fact.evidenceAuthority === "exact_internal" ? "exact" : "context"
  );
}

const HTX_DESIGNATION_START_MS = Date.parse("2026-05-26T00:00:00.000Z");

function routeIdentity(route: NarrativeSourceRouteEvidence): string {
  return route.identity?.trim() || "";
}

function routeFact(route: NarrativeSourceRouteEvidence): NarrativeFact {
  const identity = routeIdentity(route);
  const shareRu = route.share === null ? null : formatPercent(route.share, "ru");
  const shareEn = route.share === null ? null : formatPercent(route.share, "en");
  const amountRu = formatUsdtRaw(route.amountRaw, "ru");
  const amountEn = formatUsdtRaw(route.amountRaw, "en");
  const id = [
    "source-route",
    route.kind,
    route.direction,
    identity,
    route.amountRaw,
    route.share ?? "unavailable",
    route.txCount,
    route.occurredAt ?? "unknown"
  ].join(":");

  if (route.kind === "sanctioned_service") {
    const occurredMs = route.occurredAt ? Date.parse(route.occurredAt) : Number.NaN;
    const normalizedIdentity = identity.toLowerCase().replace(/[^a-z]/g, "");
    const isHtxHuobi = normalizedIdentity === "htx" ||
      normalizedIdentity === "huobi" ||
      normalizedIdentity === "htxhuobi";
    const policyApplies = route.direction === "inbound" &&
      route.linkedToSelectedProvenance === true &&
      route.sanctionsAuthority === "UK" &&
      route.designationDate === "2026-05-26" &&
      isHtxHuobi &&
      Number.isFinite(occurredMs) && occurredMs >= HTX_DESIGNATION_START_MS;
    const name = identity || "сервис без установленного названия";
    const amount = shareRu === null
      ? { ru: `${amountRu} USDT`, en: `${amountEn} USDT` }
      : { ru: `${shareRu}% проверяемой суммы`, en: `${shareEn}% of the checked amount` };
    return narrativeFact(
      id,
      policyApplies ? "sanctioned_source" : "direct_counterparty_sanction",
      policyApplies
        ? `${amount.ru} пришло с ${name}. Великобритания ввела санкции 26 мая 2026 года: это санкционный источник. Операцию не проводить.`
        : `${amount.ru} связано с ${name}. Эта историческая или исходящая связь требует ручной проверки, но не применяет политику санкционного входящего источника.`,
      policyApplies
        ? `${amount.en} came from ${name}. The UK designated it on 26 May 2026, so this is a sanctioned source. Do not proceed.`
        : `${amount.en} is linked to ${name}. This historical or outbound link needs manual review but does not apply the sanctioned inbound-source policy.`,
      null,
      policyApplies ? "exact" : "context"
    );
  }

  if (route.kind === "bridge") {
    const nameRu = identity ? ` ${identity}` : "";
    const nameEn = identity ? ` ${identity}` : "";
    const amount = shareRu === null
      ? { ru: `${amountRu} USDT`, en: `${amountEn} USDT` }
      : { ru: `${shareRu}% проверяемой суммы`, en: `${shareEn}% of the checked amount` };
    if (route.repeated || route.txCount > 1) {
      return narrativeFact(
        id,
        "bridge_route",
        `${amount.ru} пришло через мост${nameRu} в ${russianTransferCount(route.txCount)}. Маршрут усложняет отслеживание и нетипичен для обычного депозита.`,
        `${amount.en} arrived through the${nameEn} bridge in ${englishTransferCount(route.txCount)}. This route is harder to trace and unusual for an ordinary deposit.`,
        null,
        "strong"
      );
    }
    return narrativeFact(
      id,
      "bridge_route",
      `${amount.ru} пришло через мост${nameRu}. История до моста находится в другой сети и не видна в TRON. Мосты служат для обычного обмена, но также скрывают происхождение, поэтому повышают AML-риск.`,
      `${amount.en} arrived through the${nameEn} bridge. History before it is on another chain and not visible on TRON. Bridges serve ordinary swaps and can hide origin, increasing AML risk.`,
      null,
      "strong"
    );
  }

  if (route.kind === "cex") {
    const sourceRu = identity ? identity : "биржевого сервиса без установленного названия";
    const sourceEn = identity ? identity : "an exchange service whose identity was not resolved";
    return narrativeFact(
      id,
      "cex_source",
      `${shareRu !== null ? shareRu + "%" : amountRu + " USDT"} проверяемой суммы пришло с ${sourceRu} в ${russianTransferCount(route.txCount)}. Это похоже на вывод средств с биржи.`,
      `${shareEn !== null ? shareEn + "%" : amountEn + " USDT"} of the checked amount came from ${sourceEn} in ${englishTransferCount(route.txCount)}. This looks like an exchange withdrawal.`,
      null,
      "context"
    );
  }

  if (route.kind === "unknown_contract") {
    return narrativeFact(
      id,
      "unknown_contract",
      "Часть денег пришла через контракт без названия. Источник до контракта не установлен: доступная трассировка закончилась на этой границе.",
      "Part of the funds came through an unnamed contract. The source before the contract could not be traced because the available trace ended there.",
      null,
      "limitation"
    );
  }

  if (route.kind === "service_boundary") {
    const openingRu = identity
      ? `${identity} — сервис с общей ликвидностью.`
      : "Это сервис с общей ликвидностью.";
    const openingEn = identity
      ? `${identity} is a pooled-liquidity service.`
      : "This is a pooled-liquidity service.";
    return narrativeFact(
      id,
      "unknown_contract",
      `${openingRu} Источник до сервиса не удалось проследить: здесь история объединяется с переводами других клиентов.`,
      `${openingEn} The source before the service could not be traced because client transfers merge there.`,
      null,
      "limitation"
    );
  }

  if (route.kind === "collector") {
    const destinations = route.uniqueCounterpartyCount ?? route.txCount;
    const name = identity || "ликвидный сервис";
    return narrativeFact(
      id,
      "collector",
      `Кошелёк собирает переводы от ${destinations} адресов и отправляет ${shareRu === null ? "часть" : shareRu + "%"} поступлений на ${name}. Это транзитный кошелёк-сборщик ликвидности.`,
      `The wallet collects transfers from ${destinations} addresses and sends ${shareEn === null ? "part" : shareEn + "%"} of inflows to ${name}. It is a transit liquidity collector wallet.`,
      "collector",
      "context"
    );
  }

  return narrativeFact(
    id,
    "risky_counterparty",
    `${shareRu !== null ? shareRu + "%" : amountRu + " USDT"} проверяемой суммы пришло от адреса с высоким риском. Повышенный риск относится только к этой части суммы.`,
    `${shareEn !== null ? shareEn + "%" : amountEn + " USDT"} of the checked amount came from a high-risk address. The elevated risk applies only to that share.`,
    null,
    "context"
  );
}

export function sourceAndRouteFacts(input: {
  routes?: NarrativeSourceRouteEvidence[];
  firstHopLabelFacts?: FirstHopLabelFact[];
}): NarrativeFact[] {
  const routeFacts = (input.routes ?? []).map(routeFact);
  const labelFacts = (input.firstHopLabelFacts ?? []).map(firstHopLabelNarrative);
  return [...routeFacts, ...labelFacts];
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
  return narrativeFact(
    `gasfree-fee:${[...fees.keys()].sort().join(",")}`,
    "gasfree_fee",
    `GasFree удержал ${formatUsdtRaw(total.toString(), "ru")} USDT перед переводом. Это комиссия сервиса, а не основная сумма перевода.`,
    `GasFree retained ${formatUsdtRaw(total.toString(), "en")} USDT before the transfer. This is a service fee, not transfer principal.`,
    null,
    "exact"
  );
}

function traceCoverageText(trace: NarrativeTraceCoverage): { ru: string; en: string } {
  if (trace.status === "unavailable") {
    const reason = trace.untracedReason === "provider_failed"
      ? {
          ru: "источник данных не отдал нужную историю переводов",
          en: "the data provider did not return the required transfer history"
        }
      : {
          ru: "нужная история переводов недоступна",
          en: "the required transfer history is unavailable"
        };
    return {
      ru: `Происхождение суммы не удалось проследить: ${reason.ru}.`,
      en: `We could not trace the source of the amount because ${reason.en}.`
    };
  }

  const parts = {
    ru: [] as string[],
    en: [] as string[]
  };
  if (trace.checkedTransferCount !== null) {
    const directionRu = trace.direction === "inbound" ? "входящих" : "исходящих";
    const directionEn = trace.direction === "inbound" ? "inbound" : "outbound";
    parts.ru.push(`Мы проверили ${trace.checkedTransferCount} ${directionRu} переводов`);
    parts.en.push(`We checked ${trace.checkedTransferCount} ${directionEn} transfers`);
  }
  if (trace.tracedAmountPercent !== null) {
    const percent = checkedPercent(trace.tracedAmountPercent);
    parts.ru.push(`проследили ${percent.replace(".", ",")}% суммы`);
    parts.en.push(`traced ${percent}% of the amount`);
  }
  if (parts.ru.length === 0) {
    return {
      ru: "Данных о числе проверенных переводов и доле прослеженной суммы нет.",
      en: "The checked transfer count and traced amount share are unavailable."
    };
  }
  const base = {
    ru: `${parts.ru.join(" и ")}.`,
    en: `${parts.en.join(" and ")}.`
  };
  if (
    trace.status !== "partial" ||
    trace.tracedAmountPercent === null ||
    trace.tracedAmountPercent >= 100 ||
    trace.untracedReason === null
  ) return base;
  const remaining = checkedPercent(100 - trace.tracedAmountPercent);
  const reason = {
    older_history_unavailable: {
      ru: "источник данных не отдал более старые переводы",
      en: "the data provider did not return older transfers"
    },
    provider_failed: {
      ru: "источник данных завершил запрос с ошибкой",
      en: "the data provider request failed"
    },
    budget_exhausted: {
      ru: "проверка остановилась на техническом лимите",
      en: "the check stopped at a technical limit"
    },
    history_partial: {
      ru: "доступна только часть истории переводов",
      en: "only part of the transfer history is available"
    },
    running: {
      ru: "система ещё загружает историю переводов",
      en: "the system is still loading transfer history"
    }
  }[trace.untracedReason];
  return {
    ru: `${base.ru} Оставшиеся ${remaining.replace(".", ",")}% не удалось проследить: ${reason.ru}.`,
    en: `${base.en} The remaining ${remaining}% could not be traced because ${reason.en}.`
  };
}

function firstHopCoverageText(
  coverage: FirstHopBlacklistCoverage
): { ru: string; en: string } | null {
  if (coverage.blacklistCheckCoverage === "complete") return null;
  if (coverage.blacklistCheckCoverage === "running") {
    return {
      ru: "Проверка остальных прямых контрагентов ещё продолжается.",
      en: "The remaining direct counterparties are still being checked."
    };
  }
  if (coverage.blacklistCheckCoverage === "provider_failed") {
    return {
      ru: "Не удалось проверить часть прямых контрагентов. Нужен повторный запуск.",
      en: "We could not check some direct counterparties. Run the check again."
    };
  }
  if (coverage.blacklistCheckCoverage === "budget_exhausted") {
    return {
      ru: "Проверка остановилась на техническом лимите. Часть контрагентов не проверена.",
      en: "The check stopped at a technical limit. Some counterparties were not checked."
    };
  }
  return {
    ru: "Доступна только часть истории прямых переводов.",
    en: "Only part of the direct transfer history is available."
  };
}

export function coverageExplanationFor(input: {
  firstHopCoverage: FirstHopBlacklistCoverage;
  traceCoverage?: NarrativeTraceCoverage | null;
}): CoverageExplanation | null {
  const trace = input.traceCoverage ? traceCoverageText(input.traceCoverage) : null;
  const firstHop = firstHopCoverageText(input.firstHopCoverage);
  if (!trace && !firstHop) return null;
  const textRu = [trace?.ru, firstHop?.ru].filter(Boolean).join(" ");
  const textEn = [trace?.en, firstHop?.en].filter(Boolean).join(" ");
  return {
    reasonKind: input.firstHopCoverage.blacklistCheckCoverage,
    textRu: normalizeCopy(textRu),
    textEn: normalizeCopy(textEn),
    isRiskEvidence: false
  };
}

function neutralCoverageFact(scope: FirstHopBlacklistCoverage["scope"]): NarrativeFact {
  return narrativeFact(
    `coverage-neutral:${scope}`,
    "coverage",
    scope === "all_time"
      ? "Во всей проверенной истории материальных неблагоприятных фактов не найдено."
      : "В проверенном окне материальных неблагоприятных фактов не найдено.",
    scope === "all_time"
      ? "No material adverse facts were found in the complete checked history."
      : "No material adverse facts were found in the checked window.",
    null,
    "context"
  );
}

function canonicalFacts(facts: NarrativeFact[]): NarrativeFact[] {
  const ordered = [...facts].sort((left, right) =>
    factRank[left.kind] - factRank[right.kind] ||
    left.id.localeCompare(right.id) ||
    left.factTextRu.localeCompare(right.factTextRu) ||
    left.factTextEn.localeCompare(right.factTextEn)
  );
  const byId = new Map<string, NarrativeFact>();
  for (const fact of ordered) {
    if (!byId.has(fact.id)) byId.set(fact.id, fact);
  }
  return [...byId.values()];
}

export function buildWalletNarrativeEvidence(
  input: WalletNarrativeEvidenceInput
): WalletNarrativeEvidence {
  const profiles = input.directCounterpartyInteractionProfiles ?? [];
  const facts: NarrativeFact[] = [];
  if (input.subjectRestriction) {
    const subject = subjectBlacklistFact(input.subjectRestriction);
    if (subject) facts.push(subject);
  }
  facts.push(...firstHopBlacklistFacts(
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
    routes: input.routes,
    firstHopLabelFacts: input.firstHopLabelFacts
  }));
  const fee = gasFreeFeeFact(profiles);
  if (fee) facts.push(fee);

  const coverageExplanation = input.firstHopBlacklistCoverage
    ? coverageExplanationFor({
        firstHopCoverage: input.firstHopBlacklistCoverage,
        traceCoverage: input.traceCoverage
      })
    : null;
  const complete = input.firstHopBlacklistCoverage?.blacklistCheckCoverage === "complete" &&
    input.firstHopBlacklistCoverage.directPrincipalTransferCoverage === "complete" &&
    (!input.traceCoverage || input.traceCoverage.status === "exact");
  if (facts.length === 0 && complete && input.firstHopBlacklistCoverage) {
    facts.push(neutralCoverageFact(input.firstHopBlacklistCoverage.scope));
  }
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

  for (const fact of facts) {
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
