import { TronWeb } from "tronweb";
import {
  TELEGRAM_MESSAGE_LIMIT,
  escapeHtml,
  renderTelegramAddressRef
} from "../alerts/telegramHtml";
import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import { telegramAddressRef } from "../telegram/forensicPresentation";
import type {
  PresentationArtifactV1,
  PresentationCompletenessReceiptV1
} from "./contracts";
import type {
  UnifiedWalletDossierV1,
  UnifiedWalletReportSection
} from "./report";

export type UnifiedPresentationManifestV1 = {
  readonly version: "presentation-manifest-v1";
  readonly schemaVersion: 1;
  readonly reportHash: string;
  readonly rendererVersion: "unified-telegram-renderer-v1";
  readonly templateVersion: "unified-wallet-dossier-template-v1";
  readonly locale: "ru" | "en";
};

type ScopeReceiptV1 = {
  readonly scope: string;
  readonly denominatorRaw: string;
  readonly totalAmountRaw: string;
};

type SectionReceiptV1 = {
  readonly sectionId: UnifiedWalletReportSection["kind"];
  readonly aggregateCount: number;
  readonly collapsedFactCount: number;
  readonly aggregateKeys: readonly string[];
  readonly scopes: readonly ScopeReceiptV1[];
};

export type UnifiedPresentationCompletenessReceiptV1 =
  PresentationCompletenessReceiptV1 & {
    readonly canonicalFactCount: number;
    readonly canonicalFactIdsHash: string;
    readonly riskClasses: readonly string[];
    readonly sections: readonly SectionReceiptV1[];
  };

export type UnifiedPresentationResultV1 = {
  readonly manifest: UnifiedPresentationManifestV1;
  readonly artifact: PresentationArtifactV1;
  readonly receipt: UnifiedPresentationCompletenessReceiptV1;
  readonly receiptBodyHash: string;
  readonly presentationHash: string;
  readonly payload: {
    readonly text: string;
    readonly parseMode: "HTML";
  };
};

type Locale = UnifiedPresentationManifestV1["locale"];
type AmountRow = Extract<
  UnifiedWalletReportSection,
  { kind: "balance_formation" | "outgoing_movement" }
>["rows"][number];

type ServiceAggregate = {
  readonly key: string;
  readonly service: string;
  readonly direction: "incoming" | "outgoing";
  readonly directness: "direct" | "indirect";
  readonly denominatorRaw: string;
  readonly amountRaw: string;
  readonly transferCount: number;
  readonly addresses: readonly string[];
  readonly factIds: readonly string[];
};

type ContractAggregate = {
  readonly key: string;
  readonly code: string;
  readonly amountRaw: string;
  readonly amountObservationCount: number;
  readonly counterparties: readonly string[];
  readonly factIds: readonly string[];
};

type BehaviorAggregate = {
  readonly key: string;
  readonly role: string;
  readonly codes: readonly string[];
  readonly collapsedFactCount: number;
  readonly factIds: readonly string[];
};

type PresentationModel = {
  readonly scoreDrivers: readonly {
    key: string;
    code: string;
    collapsedFactCount: number;
    factIds: readonly string[];
  }[];
  readonly balanceRows: readonly AmountRow[];
  readonly outgoingRows: readonly AmountRow[];
  readonly services: readonly ServiceAggregate[];
  readonly contracts: readonly ContractAggregate[];
  readonly behaviors: readonly BehaviorAggregate[];
  readonly behaviorCodes: readonly string[];
  readonly showExamples: boolean;
  readonly compactProfile: boolean;
};

const SECTION_ORDER: readonly UnifiedWalletReportSection["kind"][] = [
  "score_action",
  "score_drivers",
  "balance_formation",
  "outgoing_movement",
  "services_boundaries",
  "contracts_approvals",
  "behavior_connections",
  "wallet_profile",
  "coverage",
  "conclusion",
  "snapshot"
];

const SEMANTIC_REASON: Readonly<Record<
  string,
  Readonly<Record<Locale, string>>
>> = {
  rapid_forwarding: {
    en: "Repeated rapid forwarding of inbound funds was observed. This is a behavioral pattern, not direct proof of abuse.",
    ru: "Найден повторяющийся быстрый перевод входящих средств дальше. Это поведенческий паттерн, а не прямое доказательство злоупотребления."
  },
  high_volume_transit: {
    en: "High inbound and outbound throughput forms a dense transit pattern. Contract-creation metadata alone does not add risk.",
    ru: "Высокий входящий и исходящий оборот образует плотный транзитный паттерн. Метаданные создания контрактом сами по себе риск не повышают."
  },
  route_transit: {
    en: "A material share of inbound volume was forwarded. This is significant transit context without hard evidence.",
    ru: "Большая доля входящего объёма вскоре ушла дальше. Это значимый транзитный контекст без hard evidence."
  },
  selected_amount_transit: {
    en: "The selected inbound amount was almost entirely forwarded. Unknown counterparties alone add no points.",
    ru: "Выбранная входящая сумма почти полностью перемещена дальше. Неизвестные контрагенты сами по себе баллы не добавляют."
  },
  fan_out: {
    en: "Concentrated inbound flow is distributed across many recipients. This is a reviewable fan-out pattern without direct proof.",
    ru: "Концентрированный входящий поток распределяется по многим получателям. Это проверяемый fan-out паттерн без прямого доказательства."
  },
  collector_transit: {
    en: "The wallet behaves as a collector and transit hub. Exchange labels are context and do not retroactively reclassify earlier transfers.",
    ru: "Кошелёк работает как коллектор и транзитный узел. Биржевые разметки показаны как контекст и не переопределяют прошлые переводы задним числом."
  },
  high_volume_transit_later_labels: {
    en: "A sustained high-throughput transit pattern was found. Later service labels are not hard evidence for earlier events.",
    ru: "Найден устойчивый высокооборотный транзитный паттерн. Более поздние сервисные разметки не являются hard evidence для прошлых событий."
  },
  history_depth_neutral: {
    en: "History depth and page count do not create risk by themselves.",
    ru: "Глубина истории и число страниц сами по себе не создают риск."
  },
  delivery_ambiguity_technical: {
    en: "Delivery ambiguity is a technical state, not a wallet risk signal.",
    ru: "Неопределённость доставки — техническое состояние, а не характеристика кошелька."
  },
  direct_blacklist_with_safe_volume: {
    en: "There is a direct inbound transfer from an address blacklisted at transfer time. Larger safe Bybit flow does not lower the hard-evidence floor.",
    ru: "Есть прямое поступление от адреса, находившегося в blacklist во время перевода. Больший безопасный поток Bybit не снижает hard-evidence floor."
  },
  dangerous_approval_no_debit: {
    en: "A dangerous approval was found, but no debit is confirmed. Protective review is required without claiming a theft.",
    ru: "Найдено опасное разрешение, но подтверждённого списания нет. Нужна защитная проверка без утверждения о краже."
  },
  correlated_dense_transit: {
    en: "Dense fan-in/fan-out with rapid forwarding forms a composite behavioral signal. Graph density alone is not hard evidence.",
    ru: "Плотный fan-in/fan-out и быстрый вывод образуют составной поведенческий сигнал. Плотность графа сама по себе hard evidence не является."
  },
  direct_blacklist_at_event: {
    en: "A direct inbound transfer from an address blacklisted at transfer time is confirmed. Its small share does not cancel the hard fact.",
    ru: "Подтверждено прямое поступление от адреса в blacklist на момент перевода. Малый процент не отменяет сам hard fact."
  },
  duplicate_evidence_neutral: {
    en: "A duplicate canonical fact is counted once and does not change the score.",
    ru: "Повтор одного canonical fact не учитывается второй раз и не меняет оценку."
  },
  dust_spam_neutral: {
    en: "Unsolicited dust received by the wallet does not raise its risk.",
    ru: "Незапрошенный dust, полученный кошельком, не повышает его риск."
  },
  empty_wallet: {
    en: "There is no USDT activity and no confirmed risk signal.",
    ru: "Активности USDT и подтверждённых риск-сигналов нет."
  },
  provider_key_exhaustion: {
    en: "Provider-key exhaustion is a technical fact and adds no risk points.",
    ru: "Исчерпание provider key — технический факт и не добавляет risk-баллы."
  },
  no_usdt_activity: {
    en: "A new wallet with no USDT activity receives no risk merely because of its age.",
    ru: "Новый кошелёк без USDT-активности не получает риск только из-за возраста."
  },
  clean_confirmed_context: {
    en: "One direct legitimate exchange transfer was found without a risk pattern.",
    ru: "Найдена одна прямая легитимная биржевая операция без риск-паттерна."
  },
  operational_wallet: {
    en: "The old active operational wallet shows no composite suspicious pattern. An unknown counterparty alone contributes zero.",
    ru: "Старый активный операционный кошелёк не показывает составного подозрительного паттерна. Неизвестный контрагент сам по себе даёт ноль."
  },
  reorder_invariant: {
    en: "Reordering equivalent input facts does not change the result.",
    ru: "Перестановка одинаковых входных фактов не меняет результат."
  },
  restart_invariant: {
    en: "Restarting with the same immutable evidence does not duplicate risk.",
    ru: "Restart с тем же immutable evidence не дублирует риск."
  },
  unknown_without_risk_pattern: {
    en: "An unknown source without correlated suspicious behavior adds zero points.",
    ru: "Неизвестный источник без связанного подозрительного поведения добавляет ноль баллов."
  },
  victim_confirmed_debit: {
    en: "A victim debit is confirmed. Protective review is required, but the victim role does not transfer recipient or drainer risk to the wallet.",
    ru: "Подтверждено списание у жертвы. Нужна защитная проверка, но роль жертвы не переносит на кошелёк риск получателя или drainer."
  }
};

function fail(): never {
  throw new Error("presentation_contract_failed");
}

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function section<K extends UnifiedWalletReportSection["kind"]>(
  report: UnifiedWalletDossierV1,
  kind: K
): Extract<UnifiedWalletReportSection, { kind: K }> {
  return report.sections.find((candidate) => candidate.kind === kind) as
    Extract<UnifiedWalletReportSection, { kind: K }> ?? fail();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(lexical);
}

function sumRaw(values: readonly string[]): string {
  return values.reduce((sum, value) => sum + BigInt(value), 0n).toString();
}

function formatRaw(raw: string, locale: Locale): string {
  if (!/^\d+$/u.test(raw)) fail();
  const padded = raw.padStart(7, "0");
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/u, "");
  const grouped = whole.replace(
    /\B(?=(\d{3})+(?!\d))/gu,
    locale === "ru" ? " " : ","
  );
  return fraction.length === 0 ? grouped : `${grouped}.${fraction}`;
}

function percent(ppm: number, locale: Locale): string {
  if (!Number.isSafeInteger(ppm) || ppm < 0 || ppm > 1_000_000) fail();
  const value = ppm / 10_000;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2)
    .replace(/0+$/u, "")
    .replace(/\.$/u, "");
  return locale === "ru" ? text.replace(".", ",") : text;
}

function scoreLine(report: UnifiedWalletDossierV1, locale: Locale): string {
  const copy = report.decision === "ACCEPTABLE"
    ? { icon: "🟢", ru: "низкий риск", en: "low risk" }
    : report.decision === "REVIEW"
      ? { icon: "🟡", ru: "нужна проверка", en: "review required" }
      : { icon: "🔴", ru: "высокий риск", en: "high risk" };
  return `${copy.icon} <b>${report.score}/100 — ${copy[locale]}</b>`;
}

function header(report: UnifiedWalletDossierV1, locale: Locale): string {
  return [
    locale === "ru" ? "<b>🧾 Проверка кошелька</b>" : "<b>🧾 Wallet check</b>",
    `${locale === "ru" ? "Кошелёк" : "Wallet"}: <code>${escapeHtml(report.subjectAddress)}</code>`,
    "",
    scoreLine(report, locale)
  ].join("\n");
}

function snapshotLine(report: UnifiedWalletDossierV1, locale: Locale): string {
  return `<i>${locale === "ru" ? "Снимок" : "Snapshot"}: TRON #${escapeHtml(
    section(report, "snapshot").blockNumber
  )}</i>`;
}

function aggregateScoreDrivers(
  report: UnifiedWalletDossierV1
): PresentationModel["scoreDrivers"] {
  const groups = new Map<string, {
    collapsedFactCount: number;
    factIds: Set<string>;
  }>();
  for (const row of section(report, "score_drivers").rows) {
    const current = groups.get(row.code) ?? {
      collapsedFactCount: 0,
      factIds: new Set<string>()
    };
    current.collapsedFactCount += row.collapsedFactCount;
    row.factIds.forEach((id) => current.factIds.add(id));
    groups.set(row.code, current);
  }
  return [...groups].sort(([left], [right]) => lexical(left, right))
    .map(([code, value]) => ({
      key: code,
      code,
      collapsedFactCount: value.collapsedFactCount,
      factIds: [...value.factIds].sort(lexical)
    }));
}

function aggregateServices(
  report: UnifiedWalletDossierV1
): ServiceAggregate[] {
  const groups = new Map<string, {
    service: string;
    direction: "incoming" | "outgoing";
    directness: "direct" | "indirect";
    denominatorRaw: string;
    amountRaw: bigint;
    transferCount: number;
    addresses: Set<string>;
    factIds: Set<string>;
  }>();
  for (const row of section(report, "services_boundaries").rows) {
    const key = JSON.stringify([
      row.service,
      row.direction,
      row.directness,
      row.amount.denominatorRaw
    ]);
    const current = groups.get(key) ?? {
      service: row.service,
      direction: row.direction,
      directness: row.directness,
      denominatorRaw: row.amount.denominatorRaw,
      amountRaw: 0n,
      transferCount: 0,
      addresses: new Set<string>(),
      factIds: new Set<string>()
    };
    current.amountRaw += BigInt(row.amount.amountRaw);
    current.transferCount += row.transferCount;
    current.addresses.add(row.address);
    row.factIds.forEach((id) => current.factIds.add(id));
    groups.set(key, current);
  }
  return [...groups].sort(([left], [right]) => lexical(left, right))
    .map(([key, value]) => ({
      key,
      service: value.service,
      direction: value.direction,
      directness: value.directness,
      denominatorRaw: value.denominatorRaw,
      amountRaw: value.amountRaw.toString(),
      transferCount: value.transferCount,
      addresses: [...value.addresses].sort(lexical),
      factIds: [...value.factIds].sort(lexical)
    }));
}

function aggregateContracts(
  report: UnifiedWalletDossierV1
): ContractAggregate[] {
  const groups = new Map<string, {
    amountRaw: bigint;
    amountObservationCount: number;
    counterparties: Set<string>;
    factIds: Set<string>;
  }>();
  for (const row of section(report, "contracts_approvals").rows) {
    const current = groups.get(row.code) ?? {
      amountRaw: 0n,
      amountObservationCount: 0,
      counterparties: new Set<string>(),
      factIds: new Set<string>()
    };
    if (row.amountRaw !== null) {
      current.amountRaw += BigInt(row.amountRaw);
      current.amountObservationCount += 1;
    }
    if (row.counterparty !== null) current.counterparties.add(row.counterparty);
    row.factIds.forEach((id) => current.factIds.add(id));
    groups.set(row.code, current);
  }
  return [...groups].sort(([left], [right]) => lexical(left, right))
    .map(([code, value]) => ({
      key: code,
      code,
      amountRaw: value.amountRaw.toString(),
      amountObservationCount: value.amountObservationCount,
      counterparties: [...value.counterparties].sort(lexical),
      factIds: [...value.factIds].sort(lexical)
    }));
}

function aggregateBehaviors(
  report: UnifiedWalletDossierV1,
  mergeByRole: boolean
): BehaviorAggregate[] {
  const groups = new Map<string, {
    role: string;
    codes: Set<string>;
    collapsedFactCount: number;
    factIds: Set<string>;
  }>();
  for (const row of section(report, "behavior_connections").rows) {
    const key = mergeByRole
      ? row.role
      : JSON.stringify([row.role, row.code]);
    const current = groups.get(key) ?? {
      role: row.role,
      codes: new Set<string>(),
      collapsedFactCount: 0,
      factIds: new Set<string>()
    };
    current.codes.add(row.code);
    current.collapsedFactCount += row.collapsedFactCount;
    row.factIds.forEach((id) => current.factIds.add(id));
    groups.set(key, current);
  }
  return [...groups].sort(([left], [right]) => lexical(left, right))
    .map(([key, value]) => ({
      key,
      role: value.role,
      codes: [...value.codes].sort(lexical),
      collapsedFactCount: value.collapsedFactCount,
      factIds: [...value.factIds].sort(lexical)
    }));
}

function model(
  report: UnifiedWalletDossierV1,
  options: {
    showExamples: boolean;
    mergeBehaviorByRole: boolean;
    compactProfile: boolean;
  }
): PresentationModel {
  const behaviors = aggregateBehaviors(report, options.mergeBehaviorByRole);
  return {
    scoreDrivers: aggregateScoreDrivers(report),
    balanceRows: section(report, "balance_formation").rows,
    outgoingRows: section(report, "outgoing_movement").rows,
    services: aggregateServices(report),
    contracts: aggregateContracts(report),
    behaviors,
    behaviorCodes: unique(behaviors.flatMap((row) => row.codes)),
    showExamples: options.showExamples,
    compactProfile: options.compactProfile
  };
}

function scoreDriverLines(
  presentation: PresentationModel,
  locale: Locale
): string[] {
  return presentation.scoreDrivers.map((driver) => {
    const reason = SEMANTIC_REASON[driver.code]?.[locale] ??
      driver.code.replaceAll("_", " ");
    return escapeHtml(reason);
  });
}

function amountLines(
  title: string,
  scope: string,
  denominatorRaw: string,
  rows: readonly AmountRow[],
  locale: Locale
): string[] {
  const total = sumRaw(rows.map((row) => row.amount.amountRaw));
  const body = rows.length === 0
    ? [locale === "ru" ? "Относящихся переводов нет." : "No transfers in this scope."]
    : rows.map((row) =>
        `• ${escapeHtml(row.key)}: ${formatRaw(row.amount.amountRaw, locale)} USDT ` +
        `(${percent(row.amount.sharePpm, locale)}%, ${row.transferCount} ` +
        `${locale === "ru" ? "перевода(ов)" : "transfer(s)"}, ${row.factIds.length} facts)`
      );
  return [
    `<b>${title}</b>`,
    `<i>${escapeHtml(scope)} · ${formatRaw(total, locale)} / ${formatRaw(denominatorRaw, locale)} USDT</i>`,
    ...body
  ];
}

function serviceLines(
  presentation: PresentationModel,
  locale: Locale
): string[] {
  const body = presentation.services.map((row) => {
    const denominator = BigInt(row.denominatorRaw);
    const sharePpm = denominator === 0n
      ? 0
      : Number(BigInt(row.amountRaw) * 1_000_000n / denominator);
    const example = presentation.showExamples && row.addresses[0]
      ? ` · ${renderTelegramAddressRef(telegramAddressRef(row.addresses[0]))}`
      : "";
    return `• ${escapeHtml(row.service)} · ${row.direction}/${row.directness}: ` +
      `${formatRaw(row.amountRaw, locale)} / ${formatRaw(row.denominatorRaw, locale)} USDT ` +
      `(${percent(sharePpm, locale)}%, ${row.transferCount} ` +
      `${locale === "ru" ? "перевода(ов)" : "transfer(s)"}, ` +
      `${row.addresses.length} address(es), ${row.factIds.length} facts)${example}`;
  });
  return [
    `<b>${locale === "ru" ? "🏦 Сервисы и границы" : "🏦 Services and boundaries"}</b>`,
    ...(body.length === 0
      ? [locale === "ru" ? "Размеченных сервисных связей нет." :
        "No labeled service links were found."]
      : body)
  ];
}

function contractLines(
  presentation: PresentationModel,
  locale: Locale
): string[] {
  const body = presentation.contracts.map((row) => {
    const amount = row.amountObservationCount === 0
      ? locale === "ru" ? "сумма не применима" : "amount not applicable"
      : `${formatRaw(row.amountRaw, locale)} USDT (${row.amountObservationCount} amount fact(s))`;
    const example = presentation.showExamples && row.counterparties[0]
      ? ` · ${renderTelegramAddressRef(telegramAddressRef(row.counterparties[0]))}`
      : "";
    return `• ${escapeHtml(row.code)}: ${amount}, ` +
      `${row.counterparties.length} counterparties, ${row.factIds.length} facts${example}`;
  });
  return [
    `<b>${locale === "ru" ? "🧩 Контракты и разрешения" : "🧩 Contracts and approvals"}</b>`,
    ...(body.length === 0
      ? [locale === "ru" ? "Значимых контрактных фактов нет." :
        "No material contract fact was found."]
      : body)
  ];
}

function behaviorLines(
  presentation: PresentationModel,
  locale: Locale
): string[] {
  const body = presentation.behaviors.map((row) => {
    const label = row.codes.length === 1
      ? row.codes[0]!
      : `${row.codes.length} ${locale === "ru" ? "класса" : "classes"}`;
    return `• ${escapeHtml(row.role)} · ${escapeHtml(label)}: ` +
      `${row.collapsedFactCount} collapsed facts, ${row.factIds.length} evidence facts`;
  });
  const total = presentation.behaviors.reduce(
    (sum, row) => sum + row.collapsedFactCount,
    0
  );
  return [
    `<b>${locale === "ru" ? "🧠 Поведение и связи" : "🧠 Behavior and connections"}</b>`,
    `<i>${presentation.behaviorCodes.length} risk/context classes · ${total} collapsed facts</i>`,
    ...(body.length === 0
      ? [locale === "ru" ? "Составных поведенческих сигналов нет." :
        "No composite behavior signal was found."]
      : body)
  ];
}

function profileLines(
  report: UnifiedWalletDossierV1,
  presentation: PresentationModel,
  locale: Locale
): string[] {
  const profile = section(report, "wallet_profile").profile;
  if (presentation.compactProfile) {
    return [
      `<b>${locale === "ru" ? "👛 Профиль" : "👛 Wallet profile"}</b>`,
      `${formatRaw(profile.snapshotUsdtBalanceRaw, locale)} USDT · ` +
      `${profile.incomingUsdtTransferCount}/${profile.outgoingUsdtTransferCount} in/out`
    ];
  }
  return [
    `<b>${locale === "ru" ? "👛 Профиль кошелька" : "👛 Wallet profile"}</b>`,
    `${locale === "ru" ? "Создан" : "Created"}: ${escapeHtml(profile.createdAt ?? "—")}`,
    `${locale === "ru" ? "Баланс" : "Balance"}: ${formatRaw(profile.snapshotUsdtBalanceRaw, locale)} USDT`,
    `USDT in/out: ${profile.incomingUsdtTransferCount}/${profile.outgoingUsdtTransferCount}`,
    `${locale === "ru" ? "Первая/последняя активность" : "First/last activity"}: ` +
      `${escapeHtml(profile.firstUsdtActivityAt ?? "—")} / ${escapeHtml(profile.lastUsdtActivityAt ?? "—")}`
  ];
}

function coverageLines(
  report: UnifiedWalletDossierV1,
  locale: Locale
): string[] {
  const rows = section(report, "coverage").dimensions;
  return [
    `<b>${locale === "ru" ? "📐 Покрытие анализа" : "📐 Analysis coverage"}</b>`,
    ...(rows.length === 0
      ? [locale === "ru" ? "Нет применимых денежных направлений." :
        "No applicable money-flow direction."]
      : rows.map((row) =>
          `• ${row.direction}: selection ${percent(row.selectionPpm, locale)}% · ` +
          `trace ${percent(row.tracePpm, locale)}% · ` +
          `identified ${percent(row.identifiedPpm, locale)}% · ` +
          `unknown ${percent(row.unknownBoundaryPpm, locale)}% · ` +
          `untraced ${percent(row.untracedPpm, locale)}%`
        ))
  ];
}

function isCompactSummary(
  report: UnifiedWalletDossierV1,
  presentation: PresentationModel
): boolean {
  const profile = section(report, "wallet_profile").profile;
  return presentation.scoreDrivers.length === 1 &&
    presentation.balanceRows.length === 0 &&
    presentation.outgoingRows.length === 0 &&
    presentation.services.length === 0 &&
    presentation.contracts.length === 0 &&
    presentation.behaviors.length === 0 &&
    report.latestPrincipalInboundEvents.length === 0 &&
    profile.createdAt === null &&
    profile.incomingUsdtTransferCount === 0 &&
    profile.outgoingUsdtTransferCount === 0;
}

function render(
  report: UnifiedWalletDossierV1,
  presentation: PresentationModel,
  locale: Locale
): string {
  if (isCompactSummary(report, presentation)) {
    return [
      header(report, locale),
      "",
      `<b>${locale === "ru" ? "Почему такая оценка" : "Why this score"}</b>`,
      scoreDriverLines(presentation, locale)[0]!,
      "",
      snapshotLine(report, locale)
    ].join("\n");
  }
  const balance = section(report, "balance_formation");
  const outgoing = section(report, "outgoing_movement");
  const latest = report.latestPrincipalInboundEvents;
  const latestLines = [
    `<b>${locale === "ru" ? "Последние значимые пополнения" : "Latest principal inbound events"}</b>`,
    `<i>${escapeHtml(report.latestPrincipalInboundEventsScope)} · ${latest.length} event(s)</i>`,
    ...(presentation.showExamples
      ? latest.map((event) =>
          `• ${escapeHtml(event.timestamp)} · ${formatRaw(event.amountRaw, locale)} USDT · ` +
          `${event.factIds.length} facts`
        )
      : [])
  ];
  const conclusion = report.decision === "ACCEPTABLE"
    ? locale === "ru" ? "Подтверждённых риск-сигналов не найдено." :
      "No confirmed risk signal was found."
    : report.decision === "REVIEW"
      ? locale === "ru" ? "Нужна ручная проверка перечисленных фактов." :
        "The listed facts require manual review."
      : locale === "ru" ? "Не продолжайте операцию." :
        "Do not proceed with the operation.";
  const blocks = [
    [header(report, locale)],
    [
      `<b>${locale === "ru" ? "Почему такая оценка" : "Why this score"}</b>`,
      ...scoreDriverLines(presentation, locale)
    ],
    amountLines(
      locale === "ru" ? "💰 Как сформировался баланс" : "💰 Balance formation",
      balance.scope,
      balance.denominatorRaw,
      presentation.balanceRows,
      locale
    ),
    latestLines,
    amountLines(
      locale === "ru" ? "💸 Куда двигались деньги" : "💸 Outgoing movement",
      outgoing.scope,
      outgoing.denominatorRaw,
      presentation.outgoingRows,
      locale
    ),
    serviceLines(presentation, locale),
    contractLines(presentation, locale),
    behaviorLines(presentation, locale),
    profileLines(report, presentation, locale),
    coverageLines(report, locale),
    [`<b>${locale === "ru" ? "🧭 Вывод" : "🧭 Conclusion"}</b>`, conclusion],
    [snapshotLine(report, locale)]
  ];
  return blocks.map((block) => block.join("\n")).join("\n\n");
}

function sectionFactIds(sectionValue: UnifiedWalletReportSection): string[] {
  if (!("rows" in sectionValue)) return [];
  return unique(sectionValue.rows.flatMap((row) =>
    "factIds" in row ? row.factIds : []
  ));
}

function sectionCollapsedCount(sectionValue: UnifiedWalletReportSection): number {
  if (
    sectionValue.kind === "score_drivers" ||
    sectionValue.kind === "behavior_connections"
  ) {
    return sectionValue.rows.reduce(
      (sum, row) => sum + row.collapsedFactCount,
      0
    );
  }
  if ("rows" in sectionValue) return sectionValue.rows.length;
  return 0;
}

function validateMoney(
  rows: readonly AmountRow[],
  denominatorRaw: string
): void {
  const denominator = BigInt(denominatorRaw);
  const total = rows.reduce(
    (sum, row) => sum + BigInt(row.amount.amountRaw),
    0n
  );
  if (
    denominator < 0n ||
    total < 0n ||
    total > denominator ||
    rows.some((row) =>
      row.amount.denominatorRaw !== denominatorRaw ||
      BigInt(row.amount.amountRaw) < 0n
    )
  ) {
    fail();
  }
}

function validateReport(report: UnifiedWalletDossierV1): void {
  if (
    report.version !== "unified-wallet-report-v1" ||
    report.dossierVersion !== "unified-wallet-dossier-v1" ||
    !TronWeb.isAddress(report.subjectAddress) ||
    report.score < 0 ||
    report.score > 100 ||
    fingerprintCanonicalArtifact(report.factInventory) !==
      report.factInventoryHash ||
    JSON.stringify(report.sections.map((item) => item.kind)) !==
      JSON.stringify(SECTION_ORDER) ||
    JSON.stringify(report.factInventory.sections.map((item) =>
      item.sectionId
    )) !== JSON.stringify(SECTION_ORDER) ||
    JSON.stringify(unique(report.factInventory.canonicalFactIds)) !==
      JSON.stringify(report.factInventory.canonicalFactIds)
  ) {
    fail();
  }
  const bound = new Set<string>();
  for (const item of report.factInventory.sections) {
    const sectionValue = section(report, item.sectionId);
    const actualIds = sectionFactIds(sectionValue);
    if (
      JSON.stringify(actualIds) !== JSON.stringify(item.factIds) ||
      sectionCollapsedCount(sectionValue) !== item.collapsedFactCount
    ) {
      fail();
    }
    actualIds.forEach((id) => bound.add(id));
  }
  if (
    JSON.stringify([...bound].sort(lexical)) !==
      JSON.stringify(report.factInventory.canonicalFactIds)
  ) {
    fail();
  }
  const balance = section(report, "balance_formation");
  const outgoing = section(report, "outgoing_movement");
  validateMoney(balance.rows, balance.denominatorRaw);
  validateMoney(outgoing.rows, outgoing.denominatorRaw);
  const services = section(report, "services_boundaries");
  for (const direction of ["incoming", "outgoing"] as const) {
    const rows = services.rows.filter((row) => row.direction === direction);
    const total = sumRaw(rows.map((row) => row.amount.amountRaw));
    const denominators = unique(rows.map((row) => row.amount.denominatorRaw));
    const reconciliation = services.reconciliation[direction];
    if (
      total !== reconciliation.attributedAmountRaw ||
      denominators.length > 1 ||
      (denominators[0] ?? "0") !== reconciliation.denominatorRaw ||
      BigInt(total) > BigInt(reconciliation.denominatorRaw)
    ) {
      fail();
    }
  }
}

function receiptBody(
  report: UnifiedWalletDossierV1,
  presentation: PresentationModel,
  reportHash: string
): Omit<UnifiedPresentationCompletenessReceiptV1, "presentationHash"> {
  const balance = section(report, "balance_formation");
  const outgoing = section(report, "outgoing_movement");
  const services = section(report, "services_boundaries");
  const byKind: Record<
    UnifiedWalletReportSection["kind"],
    Omit<SectionReceiptV1, "sectionId">
  > = {
    score_action: {
      aggregateCount: 1,
      collapsedFactCount: 0,
      aggregateKeys: [`${report.score}:${report.decision}`],
      scopes: []
    },
    score_drivers: {
      aggregateCount: presentation.scoreDrivers.length,
      collapsedFactCount: presentation.scoreDrivers.reduce(
        (sum, row) => sum + row.collapsedFactCount,
        0
      ),
      aggregateKeys: presentation.scoreDrivers.map((row) => row.key),
      scopes: []
    },
    balance_formation: {
      aggregateCount: presentation.balanceRows.length,
      collapsedFactCount: presentation.balanceRows.length,
      aggregateKeys: presentation.balanceRows.map((row) => row.key),
      scopes: [{
        scope: balance.scope,
        denominatorRaw: balance.denominatorRaw,
        totalAmountRaw: sumRaw(presentation.balanceRows.map((row) =>
          row.amount.amountRaw
        ))
      }]
    },
    outgoing_movement: {
      aggregateCount: presentation.outgoingRows.length,
      collapsedFactCount: presentation.outgoingRows.length,
      aggregateKeys: presentation.outgoingRows.map((row) => row.key),
      scopes: [{
        scope: outgoing.scope,
        denominatorRaw: outgoing.denominatorRaw,
        totalAmountRaw: sumRaw(presentation.outgoingRows.map((row) =>
          row.amount.amountRaw
        ))
      }]
    },
    services_boundaries: {
      aggregateCount: presentation.services.length,
      collapsedFactCount: services.rows.length,
      aggregateKeys: presentation.services.map((row) => row.key),
      scopes: (["incoming", "outgoing"] as const).map((direction) => ({
        scope: `${direction}_service_links`,
        denominatorRaw: services.reconciliation[direction].denominatorRaw,
        totalAmountRaw: services.reconciliation[direction].attributedAmountRaw
      }))
    },
    contracts_approvals: {
      aggregateCount: presentation.contracts.length,
      collapsedFactCount: section(report, "contracts_approvals").rows.length,
      aggregateKeys: presentation.contracts.map((row) => row.key),
      scopes: [{
        scope: "contract_amount_observations",
        denominatorRaw: sumRaw(presentation.contracts.map((row) =>
          row.amountRaw
        )),
        totalAmountRaw: sumRaw(presentation.contracts.map((row) =>
          row.amountRaw
        ))
      }]
    },
    behavior_connections: {
      aggregateCount: presentation.behaviors.length,
      collapsedFactCount: presentation.behaviors.reduce(
        (sum, row) => sum + row.collapsedFactCount,
        0
      ),
      aggregateKeys: presentation.behaviors.map((row) => row.key),
      scopes: []
    },
    wallet_profile: {
      aggregateCount: 1,
      collapsedFactCount: 0,
      aggregateKeys: [section(report, "wallet_profile").asOfBlock],
      scopes: []
    },
    coverage: {
      aggregateCount: section(report, "coverage").dimensions.length,
      collapsedFactCount: 0,
      aggregateKeys: section(report, "coverage").dimensions.map((row) =>
        row.direction
      ),
      scopes: []
    },
    conclusion: {
      aggregateCount: 1,
      collapsedFactCount: 0,
      aggregateKeys: [section(report, "conclusion").code],
      scopes: []
    },
    snapshot: {
      aggregateCount: 1,
      collapsedFactCount: 0,
      aggregateKeys: [section(report, "snapshot").blockNumber],
      scopes: []
    }
  };
  const canonicalFactIds = report.factInventory.canonicalFactIds;
  return {
    version: "presentation-completeness-receipt-v1",
    schemaVersion: 1,
    reportHash,
    factInventoryHash: report.factInventoryHash,
    omittedCanonicalFactIds: [],
    canonicalFactCount: canonicalFactIds.length,
    canonicalFactIdsHash: fingerprintCanonicalArtifact(canonicalFactIds),
    riskClasses: unique([
      ...presentation.scoreDrivers.map((row) => row.code),
      ...presentation.contracts.map((row) => row.code),
      ...presentation.behaviorCodes
    ]),
    sections: SECTION_ORDER.map((sectionId) => ({
      sectionId,
      ...byKind[sectionId],
      aggregateKeys: [...byKind[sectionId].aggregateKeys].sort(lexical)
    }))
  };
}

export function buildPresentationManifest(
  report: UnifiedWalletDossierV1,
  locale: Locale
): UnifiedPresentationManifestV1 {
  validateReport(report);
  return {
    version: "presentation-manifest-v1",
    schemaVersion: 1,
    reportHash: fingerprintCanonicalArtifact(report),
    rendererVersion: "unified-telegram-renderer-v1",
    templateVersion: "unified-wallet-dossier-template-v1",
    locale
  };
}

export function renderUnifiedWalletPresentation(input: {
  readonly report: UnifiedWalletDossierV1;
  readonly manifest: UnifiedPresentationManifestV1;
}): UnifiedPresentationResultV1 {
  validateReport(input.report);
  if (
    input.manifest.version !== "presentation-manifest-v1" ||
    input.manifest.schemaVersion !== 1 ||
    input.manifest.rendererVersion !== "unified-telegram-renderer-v1" ||
    input.manifest.templateVersion !== "unified-wallet-dossier-template-v1" ||
    input.manifest.reportHash !== fingerprintCanonicalArtifact(input.report)
  ) {
    fail();
  }
  const passes = [
    { showExamples: true, mergeBehaviorByRole: false, compactProfile: false },
    { showExamples: false, mergeBehaviorByRole: false, compactProfile: false },
    { showExamples: false, mergeBehaviorByRole: true, compactProfile: false },
    { showExamples: false, mergeBehaviorByRole: true, compactProfile: true }
  ] as const;
  let selected: { html: string; model: PresentationModel } | null = null;
  for (const pass of passes) {
    const candidateModel = model(input.report, pass);
    const html = render(input.report, candidateModel, input.manifest.locale);
    if (html.length <= TELEGRAM_MESSAGE_LIMIT) {
      selected = { html, model: candidateModel };
      break;
    }
  }
  if (selected === null) fail();
  const artifact: PresentationArtifactV1 = {
    version: "presentation-artifact-v1",
    schemaVersion: 1,
    reportHash: input.manifest.reportHash,
    locale: input.manifest.locale,
    html: selected.html,
    htmlHash: fingerprintCanonicalArtifact(selected.html)
  };
  const body = receiptBody(
    input.report,
    selected.model,
    input.manifest.reportHash
  );
  const receiptBodyHash = fingerprintCanonicalArtifact(body);
  const presentationHash = fingerprintCanonicalArtifact({
    version: "unified-presentation-envelope-v1",
    manifest: input.manifest,
    artifact,
    receiptBodyHash
  });
  const receipt: UnifiedPresentationCompletenessReceiptV1 = {
    presentationHash,
    ...body
  };
  return {
    manifest: input.manifest,
    artifact,
    receipt,
    receiptBodyHash,
    presentationHash,
    payload: { text: selected.html, parseMode: "HTML" }
  };
}

export function renderRequiredUnifiedPresentations(input: {
  readonly report: UnifiedWalletDossierV1;
  readonly locales: readonly Locale[];
}): UnifiedPresentationResultV1[] {
  const locales = unique(input.locales) as Locale[];
  if (locales.length === 0) fail();
  const presentations = locales.map((locale) =>
    renderUnifiedWalletPresentation({
      report: input.report,
      manifest: buildPresentationManifest(input.report, locale)
    })
  );
  if (
    new Set(presentations.map((item) => item.manifest.reportHash)).size !== 1
  ) {
    fail();
  }
  return presentations;
}

export function ensurePresentationForRequest(input: {
  readonly report: UnifiedWalletDossierV1;
  readonly locale: Locale;
  readonly existing: readonly UnifiedPresentationResultV1[];
}): {
  readonly reused: boolean;
  readonly presentation: UnifiedPresentationResultV1;
} {
  const expected = renderUnifiedWalletPresentation({
    report: input.report,
    manifest: buildPresentationManifest(input.report, input.locale)
  });
  const matches = input.existing.filter((item) =>
    item.manifest.reportHash === expected.manifest.reportHash &&
    item.manifest.locale === input.locale
  );
  if (matches.some((item) =>
    fingerprintCanonicalArtifact(item) !== fingerprintCanonicalArtifact(expected)
  )) {
    fail();
  }
  return {
    reused: matches.length > 0,
    presentation: matches[0] ?? expected
  };
}

export function buildManualResendWarningPresentation(
  original: UnifiedPresentationResultV1
): UnifiedPresentationResultV1 {
  const warning = original.manifest.locale === "ru"
    ? "<b>⚠️ Ручная повторная отправка после неопределённой доставки</b>"
    : "<b>⚠️ Manual resend after an unknown delivery outcome</b>";
  const html = `${warning}\n\n${original.artifact.html}`;
  if (html.length > TELEGRAM_MESSAGE_LIMIT) fail();
  const artifact: PresentationArtifactV1 = {
    ...original.artifact,
    html,
    htmlHash: fingerprintCanonicalArtifact(html)
  };
  const {
    presentationHash: _presentationHash,
    ...body
  } = original.receipt;
  const receiptBodyHash = fingerprintCanonicalArtifact(body);
  const presentationHash = fingerprintCanonicalArtifact({
    version: "unified-presentation-envelope-v1",
    manifest: original.manifest,
    artifact,
    receiptBodyHash
  });
  return {
    manifest: original.manifest,
    artifact,
    receipt: { ...body, presentationHash },
    receiptBodyHash,
    presentationHash,
    payload: { text: html, parseMode: "HTML" }
  };
}
