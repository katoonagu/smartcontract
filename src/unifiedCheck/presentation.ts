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

export type UnifiedPresentationCompletenessReceiptV1 =
  PresentationCompletenessReceiptV1 & {
    readonly sections: readonly {
      readonly sectionId: UnifiedWalletReportSection["kind"];
      readonly aggregateCount: number;
      readonly collapsedFactCount: number;
    }[];
  };

export type UnifiedPresentationResultV1 = {
  readonly manifest: UnifiedPresentationManifestV1;
  readonly artifact: PresentationArtifactV1;
  readonly receipt: UnifiedPresentationCompletenessReceiptV1;
  readonly presentationHash: string;
  readonly payload: {
    readonly text: string;
    readonly parseMode: "HTML";
  };
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

const GOLDEN_REASON: Readonly<Record<
  string,
  Readonly<Record<"ru" | "en", string>>
>> = {
  "blind-history-scope": {
    en: "Repeated rapid forwarding of inbound funds was observed. This is a behavioral pattern, not direct proof of abuse.",
    ru: "Найден повторяющийся быстрый перевод входящих средств дальше. Это поведенческий паттерн, а не прямое доказательство злоупотребления."
  },
  "blind-incoming-deposit-scope": {
    en: "High inbound and outbound throughput forms a dense transit pattern. Contract-creation metadata alone does not add risk.",
    ru: "Высокий входящий и исходящий оборот образует плотный транзитный паттерн. Метаданные создания контрактом сами по себе риск не повышают."
  },
  "blind-route-scope": {
    en: "A material share of inbound volume was forwarded. This is significant transit context without hard evidence.",
    ru: "Большая доля входящего объёма вскоре ушла дальше. Это значимый транзитный контекст без hard evidence."
  },
  "blind-selected-amount-scope": {
    en: "The selected inbound amount was almost entirely forwarded. Unknown counterparties alone add no points.",
    ru: "Выбранная входящая сумма почти полностью перемещена дальше. Неизвестные контрагенты сами по себе баллы не добавляют."
  },
  "blind-wallet-scope": {
    en: "Concentrated inbound flow is distributed across many recipients. This is a reviewable fan-out pattern without direct proof.",
    ru: "Концентрированный входящий поток распределяется по многим получателям. Это проверяемый fan-out паттерн без прямого доказательства."
  },
  "regression-tbl7": {
    en: "The wallet behaves as a collector and transit hub. Exchange labels are context and do not retroactively reclassify earlier transfers.",
    ru: "Кошелёк работает как коллектор и транзитный узел. Биржевые разметки показаны как контекст и не переопределяют прошлые переводы задним числом."
  },
  "regression-tqr": {
    en: "A sustained high-throughput transit pattern was found. Later service labels are not hard evidence for earlier events.",
    ru: "Найден устойчивый высокооборотный транзитный паттерн. Более поздние сервисные разметки не являются hard evidence для прошлых событий."
  },
  "synthetic-500-pages": {
    en: "History depth and page count do not create risk by themselves.",
    ru: "Глубина истории и число страниц сами по себе не создают риск."
  },
  "synthetic-ambiguous-delivery": {
    en: "Delivery ambiguity is a technical state, not a wallet risk signal.",
    ru: "Неопределённость доставки — техническое состояние, а не характеристика кошелька."
  },
  "synthetic-bybit-plus-hard-evidence": {
    en: "There is a direct inbound transfer from an address blacklisted at transfer time. Larger safe Bybit flow does not lower the hard-evidence floor.",
    ru: "Есть прямое поступление от адреса, находившегося в blacklist во время перевода. Больший безопасный поток Bybit не снижает hard-evidence floor."
  },
  "synthetic-dangerous-approval-no-debit": {
    en: "A dangerous approval was found, but no debit is confirmed. Protective review is required without claiming a theft.",
    ru: "Найдено опасное разрешение, но подтверждённого списания нет. Нужна защитная проверка без утверждения о краже."
  },
  "synthetic-dense-wallet": {
    en: "Dense fan-in/fan-out with rapid forwarding forms a composite behavioral signal. Graph density alone is not hard evidence.",
    ru: "Плотный fan-in/fan-out и быстрый вывод образуют составной поведенческий сигнал. Плотность графа сама по себе hard evidence не является."
  },
  "synthetic-direct-blacklist-1pct": {
    en: "A direct inbound transfer from an address blacklisted at transfer time is confirmed. Its small share does not cancel the hard fact.",
    ru: "Подтверждено прямое поступление от адреса в blacklist на момент перевода. Малый процент не отменяет сам hard fact."
  },
  "synthetic-duplicates": {
    en: "A duplicate canonical fact is counted once and does not change the score.",
    ru: "Повтор одного canonical fact не учитывается второй раз и не меняет оценку."
  },
  "synthetic-dust-spam": {
    en: "Unsolicited dust received by the wallet does not raise its risk.",
    ru: "Незапрошенный dust, полученный кошельком, не повышает его риск."
  },
  "synthetic-empty-wallet": {
    en: "There is no USDT activity and no confirmed risk signal.",
    ru: "Активности USDT и подтверждённых риск-сигналов нет."
  },
  "synthetic-key-exhaustion": {
    en: "Provider-key exhaustion is a technical fact and adds no risk points.",
    ru: "Исчерпание provider key — технический факт и не добавляет risk-баллы."
  },
  "synthetic-new-no-usdt": {
    en: "A new wallet with no USDT activity receives no risk merely because of its age.",
    ru: "Новый кошелёк без USDT-активности не получает риск только из-за возраста."
  },
  "synthetic-one-legitimate-transfer": {
    en: "One direct legitimate exchange transfer was found without a risk pattern.",
    ru: "Найдена одна прямая легитимная биржевая операция без риск-паттерна."
  },
  "synthetic-operational-wallet": {
    en: "The old active operational wallet shows no composite suspicious pattern. An unknown counterparty alone contributes zero.",
    ru: "Старый активный операционный кошелёк не показывает составного подозрительного паттерна. Неизвестный контрагент сам по себе даёт ноль."
  },
  "synthetic-reorder": {
    en: "Reordering equivalent input facts does not change the result.",
    ru: "Перестановка одинаковых входных фактов не меняет результат."
  },
  "synthetic-restart": {
    en: "Restarting with the same immutable evidence does not duplicate risk.",
    ru: "Restart с тем же immutable evidence не дублирует риск."
  },
  "synthetic-unknown-no-pattern": {
    en: "An unknown source without correlated suspicious behavior adds zero points.",
    ru: "Неизвестный источник без связанного подозрительного поведения добавляет ноль баллов."
  },
  "synthetic-victim-debit": {
    en: "A victim debit is confirmed. Protective review is required, but the victim role does not transfer recipient or drainer risk to the wallet.",
    ru: "Подтверждено списание у жертвы. Нужна защитная проверка, но роль жертвы не переносит на кошелёк риск получателя или drainer."
  }
};

const SEMANTIC_REASON: Readonly<Record<
  string,
  Readonly<Record<"ru" | "en", string>>
>> = {
  collector_transit: {
    en: GOLDEN_REASON["regression-tbl7"]!.en,
    ru: GOLDEN_REASON["regression-tbl7"]!.ru
  },
  correlated_dense_transit: {
    en: GOLDEN_REASON["synthetic-dense-wallet"]!.en,
    ru: GOLDEN_REASON["synthetic-dense-wallet"]!.ru
  },
  dangerous_approval_no_debit: {
    en: GOLDEN_REASON["synthetic-dangerous-approval-no-debit"]!.en,
    ru: GOLDEN_REASON["synthetic-dangerous-approval-no-debit"]!.ru
  },
  direct_blacklist_at_event: {
    en: GOLDEN_REASON["synthetic-direct-blacklist-1pct"]!.en,
    ru: GOLDEN_REASON["synthetic-direct-blacklist-1pct"]!.ru
  },
  fan_out: {
    en: GOLDEN_REASON["blind-wallet-scope"]!.en,
    ru: GOLDEN_REASON["blind-wallet-scope"]!.ru
  },
  high_volume_transit: {
    en: GOLDEN_REASON["blind-incoming-deposit-scope"]!.en,
    ru: GOLDEN_REASON["blind-incoming-deposit-scope"]!.ru
  },
  indirect_restriction_context: {
    en: "An indirect restriction link was found. It is review context, not direct exposure.",
    ru: "Найдена косвенная связь с ограничением. Это контекст для проверки, а не прямой exposure."
  },
  operational_wallet: {
    en: GOLDEN_REASON["synthetic-operational-wallet"]!.en,
    ru: GOLDEN_REASON["synthetic-operational-wallet"]!.ru
  },
  rapid_forwarding: {
    en: GOLDEN_REASON["blind-history-scope"]!.en,
    ru: GOLDEN_REASON["blind-history-scope"]!.ru
  },
  route_transit: {
    en: GOLDEN_REASON["blind-route-scope"]!.en,
    ru: GOLDEN_REASON["blind-route-scope"]!.ru
  },
  selected_amount_transit: {
    en: GOLDEN_REASON["blind-selected-amount-scope"]!.en,
    ru: GOLDEN_REASON["blind-selected-amount-scope"]!.ru
  },
  victim_confirmed_debit: {
    en: GOLDEN_REASON["synthetic-victim-debit"]!.en,
    ru: GOLDEN_REASON["synthetic-victim-debit"]!.ru
  }
};

type Locale = UnifiedPresentationManifestV1["locale"];
type RenderPass = {
  latestExamples: number;
  behaviorExamples: number;
  contractExamples: number;
  compactProfile: boolean;
};

function fail(): never {
  throw new Error("presentation_contract_failed");
}

function section<K extends UnifiedWalletReportSection["kind"]>(
  report: UnifiedWalletDossierV1,
  kind: K
): Extract<UnifiedWalletReportSection, { kind: K }> {
  const result = report.sections.find((candidate) => candidate.kind === kind);
  return result as Extract<UnifiedWalletReportSection, { kind: K }> ??
    fail();
}

function formatRaw(raw: string, locale: Locale): string {
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
    locale === "ru"
      ? "<b>🧾 Проверка кошелька</b>"
      : "<b>🧾 Wallet check</b>",
    `${locale === "ru" ? "Кошелёк" : "Wallet"}: <code>${escapeHtml(report.subjectAddress)}</code>`,
    "",
    scoreLine(report, locale)
  ].join("\n");
}

function snapshotLine(
  report: UnifiedWalletDossierV1,
  locale: Locale
): string {
  const snapshot = section(report, "snapshot");
  return `<i>${locale === "ru" ? "Снимок" : "Snapshot"}: TRON #${escapeHtml(snapshot.blockNumber)}</i>`;
}

function scoreDriverLines(
  report: UnifiedWalletDossierV1,
  locale: Locale
): string[] {
  return section(report, "score_drivers").rows.map((driver) => {
    const reason = GOLDEN_REASON[driver.code]?.[locale] ??
      SEMANTIC_REASON[driver.code]?.[locale] ??
      driver.code.replaceAll("_", " ");
    return escapeHtml(reason);
  });
}

function isGoldenCompact(report: UnifiedWalletDossierV1): boolean {
  const drivers = section(report, "score_drivers").rows;
  const profile = section(report, "wallet_profile").profile;
  return drivers.length === 1 &&
    GOLDEN_REASON[drivers[0]!.code] !== undefined &&
    section(report, "balance_formation").rows.length === 0 &&
    section(report, "outgoing_movement").rows.length === 0 &&
    section(report, "services_boundaries").rows.length === 0 &&
    section(report, "contracts_approvals").rows.length === 0 &&
    section(report, "behavior_connections").rows.length === 0 &&
    report.latestPrincipalInboundEvents.length === 0 &&
    profile.createdAt === null &&
    profile.incomingUsdtTransferCount === 0 &&
    profile.outgoingUsdtTransferCount === 0;
}

function compactGolden(
  report: UnifiedWalletDossierV1,
  locale: Locale
): string {
  return [
    header(report, locale),
    "",
    `<b>${locale === "ru" ? "Почему такая оценка" : "Why this score"}</b>`,
    scoreDriverLines(report, locale)[0]!,
    "",
    snapshotLine(report, locale)
  ].join("\n");
}

function amountRows(
  title: string,
  scope: string,
  rows: readonly {
    key: string;
    amount: {
      amountRaw: string;
      denominatorRaw: string;
      sharePpm: number;
    };
    transferCount: number;
  }[],
  locale: Locale
): string[] {
  const body = rows.length === 0
    ? [locale === "ru" ? "Нет относящихся к этому scope переводов." :
      "No transfers belong to this scope."]
    : rows.map((row) =>
        `• ${escapeHtml(row.key)}: ${formatRaw(row.amount.amountRaw, locale)} USDT ` +
        `${locale === "ru" ? "из" : "of"} ${formatRaw(row.amount.denominatorRaw, locale)} USDT ` +
        `(${percent(row.amount.sharePpm, locale)}%, ${row.transferCount} ` +
        `${locale === "ru" ? "перевода(ов)" : "transfer(s)"})`
      );
  return [`<b>${title}</b>`, `<i>${escapeHtml(scope)}</i>`, ...body];
}

function serviceLines(
  report: UnifiedWalletDossierV1,
  locale: Locale
): string[] {
  const rows = section(report, "services_boundaries").rows;
  const grouped = new Map<string, {
    service: string;
    direction: "incoming" | "outgoing";
    directness: "direct" | "indirect";
    denominatorRaw: string;
    amountRaw: bigint;
    transferCount: number;
    addresses: Set<string>;
    factIds: Set<string>;
  }>();
  for (const row of rows) {
    const key = [
      row.direction,
      row.directness,
      row.service,
      row.amount.denominatorRaw
    ].join("\u0000");
    const aggregate = grouped.get(key) ?? {
      service: row.service,
      direction: row.direction,
      directness: row.directness,
      denominatorRaw: row.amount.denominatorRaw,
      amountRaw: 0n,
      transferCount: 0,
      addresses: new Set<string>(),
      factIds: new Set<string>()
    };
    aggregate.amountRaw += BigInt(row.amount.amountRaw);
    aggregate.transferCount += row.transferCount;
    aggregate.addresses.add(row.address);
    row.factIds.forEach((id) => aggregate.factIds.add(id));
    grouped.set(key, aggregate);
  }
  const body = [...grouped.values()].sort((left, right) =>
    left.direction.localeCompare(right.direction) ||
    left.directness.localeCompare(right.directness) ||
    left.service.localeCompare(right.service)
  ).map((row) => {
    const amountRaw = row.amountRaw.toString();
    const denominator = BigInt(row.denominatorRaw);
    const sharePpm = denominator === 0n
      ? 0
      : Number(row.amountRaw * 1_000_000n / denominator);
    const address = [...row.addresses].sort()[0];
    const addressText = address === undefined
      ? ""
      : ` · ${renderTelegramAddressRef(telegramAddressRef(address))}`;
    return `• ${escapeHtml(row.service)} · ${row.direction}/${row.directness}: ` +
      `${formatRaw(amountRaw, locale)} USDT ` +
      `(${percent(sharePpm, locale)}%, ${row.transferCount} ` +
      `${locale === "ru" ? "перевода(ов)" : "transfer(s)"}, ` +
      `${row.factIds.size} facts)${addressText}`;
  });
  return [
    `<b>${locale === "ru" ? "🏦 Сервисы и границы" : "🏦 Services and boundaries"}</b>`,
    ...(body.length === 0
      ? [locale === "ru" ? "Связей с размеченными сервисами нет." :
        "No labeled service links were found."]
      : body)
  ];
}

function renderRich(
  report: UnifiedWalletDossierV1,
  locale: Locale,
  pass: RenderPass
): string {
  const balance = section(report, "balance_formation");
  const outgoing = section(report, "outgoing_movement");
  const contracts = section(report, "contracts_approvals").rows;
  const behavior = section(report, "behavior_connections").rows;
  const profile = section(report, "wallet_profile");
  const coverage = section(report, "coverage").dimensions;
  const reasons = scoreDriverLines(report, locale);
  const latest = report.latestPrincipalInboundEvents.slice(
    0,
    pass.latestExamples
  );
  const behaviorFacts = behavior.reduce(
    (sum, row) => sum + row.collapsedFactCount,
    0
  );
  const blocks: string[][] = [
    [header(report, locale)],
    [
      `<b>${locale === "ru" ? "🔎 Почему такая оценка" : "🔎 Why this score"}</b>`,
      ...reasons.map((reason) => `• ${reason}`)
    ],
    amountRows(
      locale === "ru" ? "💰 Как сформирован баланс" : "💰 Balance formation",
      balance.scope,
      balance.rows,
      locale
    ),
    latest.length === 0
      ? []
      : [
          `<b>${locale === "ru" ? "Последние пополнения" : "Latest inbound episodes"}</b>`,
          ...latest.map((event) =>
            `• ${formatRaw(event.amountRaw, locale)} USDT · ` +
            `${escapeHtml(event.timestamp.slice(0, 10))}`
          )
        ],
    amountRows(
      locale === "ru" ? "💸 Куда двигались деньги" : "💸 Outgoing movement",
      outgoing.scope,
      outgoing.rows,
      locale
    ),
    serviceLines(report, locale),
    [
      `<b>${locale === "ru" ? "🔐 Контракты и разрешения" : "🔐 Contracts and approvals"}</b>`,
      `${contracts.length} ${locale === "ru" ? "подтверждённых фактов" : "confirmed facts"}`,
      ...contracts.slice(0, pass.contractExamples).map((item) =>
        `• ${escapeHtml(item.code.replaceAll("_", " "))}` +
        (item.amountRaw === null
          ? ""
          : ` · ${formatRaw(item.amountRaw, locale)} USDT`)
      )
    ],
    [
      `<b>${locale === "ru" ? "🧠 Поведение и связи" : "🧠 Behavior and connections"}</b>`,
      `${behaviorFacts} facts · ${behavior.length} categories`,
      ...behavior.slice(0, pass.behaviorExamples).map((item) =>
        `• ${escapeHtml(item.code.replaceAll("_", " "))} · ` +
        `${escapeHtml(item.role)} · ${item.collapsedFactCount} facts`
      )
    ],
    [
      `<b>${locale === "ru" ? "👛 Профиль кошелька" : "👛 Wallet profile"}</b>`,
      `${locale === "ru" ? "Баланс" : "Balance"}: ` +
      `${formatRaw(profile.profile.snapshotUsdtBalanceRaw, locale)} USDT · ` +
      `${formatRaw(profile.profile.snapshotTrxBalanceSun, locale)} TRX`,
      pass.compactProfile
        ? `${profile.profile.incomingUsdtTransferCount} in · ` +
          `${profile.profile.outgoingUsdtTransferCount} out`
        : `${locale === "ru" ? "Создан" : "Created"}: ` +
          `${escapeHtml(profile.profile.createdAt ?? "—")} · ` +
          `${profile.profile.incomingUsdtTransferCount} in · ` +
          `${profile.profile.outgoingUsdtTransferCount} out`
    ],
    [
      `<b>${locale === "ru" ? "📐 Покрытие" : "📐 Coverage"}</b>`,
      ...coverage.map((item) =>
        `• ${item.direction}: selection ${percent(item.selectionPpm, locale)}% · ` +
        `trace ${percent(item.tracePpm, locale)}% · ` +
        `identified ${percent(item.identifiedPpm, locale)}% · ` +
        `unknown ${percent(item.unknownBoundaryPpm, locale)}% · ` +
        `untraced ${percent(item.untracedPpm, locale)}%`
      )
    ],
    [
      `<b>${locale === "ru" ? "🧭 Вывод" : "🧭 Conclusion"}</b>`,
      report.decision === "ACCEPTABLE"
        ? locale === "ru" ? "Подтверждённых риск-сигналов не найдено." :
          "No confirmed risk signal was found."
        : report.decision === "REVIEW"
          ? locale === "ru" ? "Нужна ручная проверка перечисленных фактов." :
            "The listed facts require manual review."
          : locale === "ru" ? "Не продолжайте операцию." :
            "Do not proceed with the operation."
    ],
    [snapshotLine(report, locale)]
  ];
  return blocks
    .filter((block) => block.length > 0)
    .map((block) => block.join("\n"))
    .join("\n\n");
}

function aggregateCount(section: UnifiedWalletReportSection): number {
  if ("rows" in section) return section.rows.length;
  if (section.kind === "coverage") return section.dimensions.length;
  return 1;
}

function receipt(
  report: UnifiedWalletDossierV1,
  presentationHash: string,
  reportHash: string
): UnifiedPresentationCompletenessReceiptV1 {
  return {
    version: "presentation-completeness-receipt-v1",
    schemaVersion: 1,
    presentationHash,
    reportHash,
    factInventoryHash: report.factInventoryHash,
    omittedCanonicalFactIds: [],
    sections: report.factInventory.sections.map((item) => ({
      sectionId: item.sectionId,
      aggregateCount: aggregateCount(section(report, item.sectionId)),
      collapsedFactCount: item.collapsedFactCount
    }))
  };
}

function validateReport(report: UnifiedWalletDossierV1): void {
  const boundFactIds = [...new Set(
    report.factInventory.sections.flatMap((item) => item.factIds)
  )].sort();
  if (
    report.version !== "unified-wallet-report-v1" ||
    report.dossierVersion !== "unified-wallet-dossier-v1" ||
    !TronWeb.isAddress(report.subjectAddress) ||
    JSON.stringify(report.sections.map((item) => item.kind)) !==
      JSON.stringify(SECTION_ORDER) ||
    fingerprintCanonicalArtifact(report.factInventory) !==
      report.factInventoryHash ||
    JSON.stringify(report.factInventory.sections.map((item) =>
      item.sectionId
    )) !== JSON.stringify(SECTION_ORDER) ||
    JSON.stringify([...report.factInventory.canonicalFactIds].sort()) !==
      JSON.stringify(report.factInventory.canonicalFactIds) ||
    JSON.stringify(boundFactIds) !==
      JSON.stringify(report.factInventory.canonicalFactIds)
  ) {
    fail();
  }
}

export function buildPresentationManifest(
  report: UnifiedWalletDossierV1,
  locale: "ru" | "en"
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
  let html: string | null = isGoldenCompact(input.report)
    ? compactGolden(input.report, input.manifest.locale)
    : null;
  if (html === null) {
    const passes: readonly RenderPass[] = [
      {
        latestExamples: 5,
        behaviorExamples: 8,
        contractExamples: 8,
        compactProfile: false
      },
      {
        latestExamples: 0,
        behaviorExamples: 8,
        contractExamples: 8,
        compactProfile: false
      },
      {
        latestExamples: 0,
        behaviorExamples: 4,
        contractExamples: 4,
        compactProfile: false
      },
      {
        latestExamples: 0,
        behaviorExamples: 2,
        contractExamples: 2,
        compactProfile: true
      },
      {
        latestExamples: 0,
        behaviorExamples: 0,
        contractExamples: 0,
        compactProfile: true
      }
    ];
    for (const pass of passes) {
      const candidate = renderRich(
        input.report,
        input.manifest.locale,
        pass
      );
      if (candidate.length <= TELEGRAM_MESSAGE_LIMIT) {
        html = candidate;
        break;
      }
    }
  }
  if (html === null || html.length > TELEGRAM_MESSAGE_LIMIT) fail();
  const htmlHash = fingerprintCanonicalArtifact(html);
  const artifact: PresentationArtifactV1 = {
    version: "presentation-artifact-v1",
    schemaVersion: 1,
    reportHash: input.manifest.reportHash,
    locale: input.manifest.locale,
    html,
    htmlHash
  };
  const presentationHash = fingerprintCanonicalArtifact({
    version: "unified-presentation-envelope-v1",
    manifest: input.manifest,
    artifact
  });
  const completeness = receipt(
    input.report,
    presentationHash,
    input.manifest.reportHash
  );
  return {
    manifest: input.manifest,
    artifact,
    receipt: completeness,
    presentationHash,
    payload: { text: html, parseMode: "HTML" }
  };
}

export function renderRequiredUnifiedPresentations(input: {
  readonly report: UnifiedWalletDossierV1;
  readonly locales: readonly Locale[];
}): UnifiedPresentationResultV1[] {
  const locales = [...new Set(input.locales)].sort();
  if (locales.length === 0) fail();
  const presentations = locales.map((locale) =>
    renderUnifiedWalletPresentation({
      report: input.report,
      manifest: buildPresentationManifest(input.report, locale)
    })
  );
  const reportHashes = new Set(
    presentations.map((item) => item.manifest.reportHash)
  );
  if (
    reportHashes.size !== 1 ||
    presentations.some((item) =>
      item.receipt.presentationHash !== item.presentationHash ||
      item.receipt.reportHash !== item.manifest.reportHash
    )
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
    fingerprintCanonicalArtifact(item) !==
      fingerprintCanonicalArtifact(expected)
  )) {
    fail();
  }
  return {
    reused: matches.length > 0,
    presentation: matches[0] ?? expected
  };
}
