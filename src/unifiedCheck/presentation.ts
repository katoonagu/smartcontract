import { TronWeb } from "tronweb";
import {
  TELEGRAM_MESSAGE_LIMIT,
  escapeHtml,
  renderTelegramAddressRef
} from "../alerts/telegramHtml";
import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import { telegramAddressRef } from "../telegram/forensicPresentation";
import {
  formatCustomerPercent,
  formatCustomerTransferCount,
  formatCustomerUsdtRaw,
  formatCustomerUtcDate
} from "./customerPresentationFormat";
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
  readonly rendererVersion:
    | "unified-telegram-renderer-v1"
    | "unified-telegram-renderer-v2";
  readonly templateVersion:
    | "unified-wallet-dossier-template-v1"
    | "unified-wallet-dossier-template-v2";
  readonly locale: "ru" | "en";
};

const CURRENT_RENDERER_VERSION = "unified-telegram-renderer-v2" as const;
const CURRENT_TEMPLATE_VERSION = "unified-wallet-dossier-template-v2" as const;

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
    en: "The wallet forwards received funds almost immediately. It may be an ordinary transit or service wallet, but extra caution is appropriate before a transaction. This behavior alone does not prove fraud.",
    ru: "Кошелёк почти сразу переводит полученные средства дальше. Это может быть обычный транзитный или сервисный кошелёк, но перед сделкой стоит проявить осторожность. Сам по себе этот признак не доказывает мошенничество."
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

function failCustomerCopy(): never {
  throw new Error("unified_customer_copy_decisive_code_unmapped");
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
    "",
    `<code>${escapeHtml(report.subjectAddress)}</code>`,
    "",
    scoreLine(report, locale)
  ].join("\n");
}

function snapshotLine(report: UnifiedWalletDossierV1, locale: Locale): string {
  return `<i>${locale === "ru" ? "Данные актуальны на блоке" : "Data current at block"} TRON #${escapeHtml(
    section(report, "snapshot").blockNumber
  )}.</i>`;
}

function customerKey(value: string): string {
  return TronWeb.isAddress(value)
    ? renderTelegramAddressRef(telegramAddressRef(value))
    : escapeHtml(value);
}

function customerDirectionCount(
  incoming: number,
  outgoing: number,
  locale: Locale
): string {
  if (locale === "en") {
    return `${incoming} incoming, ${outgoing} outgoing`;
  }
  const adjective = (count: number, singular: string, plural: string) =>
    `${count} ${count === 1 ? singular : plural}`;
  return `${adjective(incoming, "входящий", "входящих")}, ` +
    adjective(outgoing, "исходящий", "исходящих");
}

function customerCounterpartyCount(count: number, locale: Locale): string {
  if (locale === "en") return `${count} ${count === 1 ? "counterparty" : "counterparties"}`;
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14
    ? "контрагентов"
    : last === 1
      ? "контрагент"
      : last >= 2 && last <= 4
        ? "контрагента"
        : "контрагентов";
  return `${count} ${noun}`;
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
    const reason = SEMANTIC_REASON[driver.code]?.[locale] ?? failCustomerCopy();
    return escapeHtml(reason);
  });
}

function guidanceLines(
  report: UnifiedWalletDossierV1,
  presentation: PresentationModel,
  locale: Locale
): string[] {
  const unknownSource = presentation.behaviorCodes.includes("unknown_source");
  if (report.decision === "ACCEPTABLE") {
    return locale === "ru"
      ? [
          "<b>Что делать перед сделкой</b>",
          "• <b>Если отправляете деньги:</b> существенных риск-сигналов не найдено. Проверьте адрес и владельца кошелька обычным способом.",
          "• <b>Если принимаете деньги:</b> достаточно обычной проверки отправителя и назначения платежа."
        ]
      : [
          "<b>What to do before the transaction</b>",
          "• <b>If you are sending funds:</b> no material risk signal was found. Verify the address and wallet owner as usual.",
          "• <b>If you are receiving funds:</b> ordinary checks of the sender and payment purpose are appropriate."
        ];
  }
  if (report.decision === "DECLINE") {
    return locale === "ru"
      ? [
          "<b>Что делать перед сделкой</b>",
          "• <b>Если отправляете деньги:</b> не отправляйте средства до ручной проверки выявленных рисков.",
          "• <b>Если принимаете деньги:</b> не принимайте перевод до ручной проверки контрагента и происхождения средств."
        ]
      : [
          "<b>What to do before the transaction</b>",
          "• <b>If you are sending funds:</b> do not send funds until the identified risks are reviewed manually.",
          "• <b>If you are receiving funds:</b> do not accept the transfer until the counterparty and source of funds are reviewed manually."
        ];
  }
  if (locale === "ru") {
    return [
      "<b>Что делать перед сделкой</b>",
      "• <b>Если отправляете деньги:</b> явных запрещающих сигналов не найдено. Для крупной суммы сначала проверьте владельца и сделайте небольшой тестовый перевод.",
      unknownSource
        ? "• <b>Если принимаете деньги:</b> попросите контрагента подтвердить происхождение средств — источник поступления определить не удалось."
        : "• <b>Если принимаете деньги:</b> перед крупной сделкой проверьте контрагента и назначение платежа."
    ];
  }
  return [
    "<b>What to do before the transaction</b>",
    "• <b>If you are sending funds:</b> no clear prohibitive signal was found. For a large amount, verify the owner and make a small test transfer first.",
    unknownSource
      ? "• <b>If you are receiving funds:</b> ask the counterparty to confirm the source of funds because the original source could not be determined."
      : "• <b>If you are receiving funds:</b> verify the counterparty and payment purpose before a large transaction."
  ];
}

function moneyLines(
  report: UnifiedWalletDossierV1,
  presentation: PresentationModel,
  locale: Locale
): string[] {
  const latest = report.latestPrincipalInboundEvents;
  const receivedTotal = sumRaw(latest.map((event) => event.amountRaw));
  const outgoingTotal = sumRaw(presentation.outgoingRows.map((row) =>
    row.amount.amountRaw
  ));
  const profile = section(report, "wallet_profile").profile;
  const lines = [
    `<b>${locale === "ru" ? "💰 Движение денег" : "💰 Money movement"}</b>`
  ];

  if (latest.length > 0) {
    if (presentation.showExamples) {
      for (const event of latest) {
        lines.push(
          locale === "ru"
            ? `• Получено: ${formatCustomerUsdtRaw(event.amountRaw, locale)} от ${customerKey(event.fromAddress)}`
            : `• Received: ${formatCustomerUsdtRaw(event.amountRaw, locale)} from ${customerKey(event.fromAddress)}`,
          locale === "ru"
            ? `• Время: ${escapeHtml(formatCustomerUtcDate(event.timestamp, locale))}`
            : `• Time: ${escapeHtml(formatCustomerUtcDate(event.timestamp, locale))}`
        );
      }
    } else {
      lines.push(locale === "ru"
        ? `• Получено: ${formatCustomerUsdtRaw(receivedTotal, locale)}`
        : `• Received: ${formatCustomerUsdtRaw(receivedTotal, locale)}`);
    }
  } else if (presentation.balanceRows.length > 0) {
    for (const row of presentation.balanceRows) {
      lines.push(locale === "ru"
        ? `• В текущем остатке: ${formatCustomerUsdtRaw(row.amount.amountRaw, locale)} от ${customerKey(row.key)}`
        : `• In the current balance: ${formatCustomerUsdtRaw(row.amount.amountRaw, locale)} from ${customerKey(row.key)}`);
    }
  } else {
    lines.push(locale === "ru"
      ? "• Значимых поступлений USDT не найдено."
      : "• No material incoming USDT transfer was found.");
  }

  if (presentation.outgoingRows.length > 0) {
    if (presentation.showExamples) {
      for (const row of presentation.outgoingRows) {
        lines.push(locale === "ru"
          ? `• Отправлено дальше: ${formatCustomerUsdtRaw(row.amount.amountRaw, locale)} на ${customerKey(row.key)} (${formatCustomerTransferCount(row.transferCount, locale)})`
          : `• Sent onward: ${formatCustomerUsdtRaw(row.amount.amountRaw, locale)} to ${customerKey(row.key)} (${formatCustomerTransferCount(row.transferCount, locale)})`);
      }
    } else {
      lines.push(locale === "ru"
        ? `• Отправлено дальше: ${formatCustomerUsdtRaw(outgoingTotal, locale)}`
        : `• Sent onward: ${formatCustomerUsdtRaw(outgoingTotal, locale)}`);
    }
  }
  lines.push(locale === "ru"
    ? `• Остаток: ${formatCustomerUsdtRaw(profile.snapshotUsdtBalanceRaw, locale)}`
    : `• Balance: ${formatCustomerUsdtRaw(profile.snapshotUsdtBalanceRaw, locale)}`);
  return lines;
}

const CONTRACT_COPY: Readonly<Record<string, Readonly<Record<Locale, string>>>> = {
  dangerous_approval: {
    ru: "Найдено опасное разрешение на расходование токенов.",
    en: "A dangerous token spending approval was found."
  },
  dangerous_unlimited_approval: {
    ru: "Найдено опасное неограниченное разрешение на расходование токенов.",
    en: "A dangerous unlimited token spending approval was found."
  }
};

function serviceContractLines(
  presentation: PresentationModel,
  locale: Locale
): string[] {
  const lines = [
    `<b>${locale === "ru" ? "🏦 Сервисы и контракты" : "🏦 Services and contracts"}</b>`
  ];
  if (presentation.services.length === 0) {
    lines.push(locale === "ru"
      ? "• Связей с известными биржами, мостами и другими размеченными сервисами не найдено."
      : "• No links to known exchanges, bridges, or other labeled services were found.");
  } else {
    for (const row of presentation.services) {
      const denominator = BigInt(row.denominatorRaw);
      const sharePpm = denominator === 0n
        ? 0
        : Number(BigInt(row.amountRaw) * 1_000_000n / denominator);
      const example = presentation.showExamples && row.addresses[0]
        ? ` · ${customerKey(row.addresses[0])}`
        : "";
      const direction = locale === "ru"
        ? row.direction === "incoming" ? "входящая" : "исходящая"
        : row.direction;
      const directness = locale === "ru"
        ? row.directness === "direct" ? "прямая" : "косвенная"
        : row.directness;
      lines.push(
        locale === "ru"
          ? `• ${direction} ${directness} связь с ${escapeHtml(row.service)}: ${formatCustomerUsdtRaw(row.amountRaw, locale)} (${formatCustomerPercent(sharePpm, locale)}, ${formatCustomerTransferCount(row.transferCount, locale)})${example}`
          : `• ${directness} ${direction} link to ${escapeHtml(row.service)}: ${formatCustomerUsdtRaw(row.amountRaw, locale)} (${formatCustomerPercent(sharePpm, locale)}, ${formatCustomerTransferCount(row.transferCount, locale)})${example}`
      );
    }
  }

  if (presentation.contracts.length === 0) {
    lines.push(locale === "ru"
      ? "• Значимых контрактных рисков и опасных разрешений не найдено."
      : "• No material contract risk or dangerous approval was found.");
  } else {
    for (const row of presentation.contracts) {
      const copy = CONTRACT_COPY[row.code]?.[locale] ?? failCustomerCopy();
      const amount = row.amountObservationCount > 0
        ? ` ${formatCustomerUsdtRaw(row.amountRaw, locale)}`
        : "";
      const example = presentation.showExamples && row.counterparties[0]
        ? ` · ${customerKey(row.counterparties[0])}`
        : "";
      const counterparties = row.counterparties.length > 0
        ? ` · ${customerCounterpartyCount(row.counterparties.length, locale)}`
        : "";
      lines.push(`• ${escapeHtml(copy)}${amount}${counterparties}${example}`);
    }
  }
  return lines;
}

const BEHAVIOR_COPY: Readonly<Record<
  string,
  Readonly<Record<Locale, string>>
>> = {
  dense_fan_in_fan_out: {
    ru: "Найден плотный поток от многих отправителей ко многим получателям.",
    en: "A dense flow from many senders to many recipients was found."
  },
  high_volume_inbound_outbound: {
    ru: "Через кошелёк регулярно проходят крупные входящие и исходящие объёмы.",
    en: "Large incoming and outgoing volumes regularly pass through the wallet."
  },
  rapid_forwarding: {
    ru: "Полученные средства вскоре переводились дальше.",
    en: "Received funds were forwarded soon afterward."
  }
};

const COVERAGE_BEHAVIOR_CODES = new Set([
  "direct_activity_observed",
  "history_exhausted_to_account_creation",
  "unknown_source"
]);

function behaviorLines(
  report: UnifiedWalletDossierV1,
  presentation: PresentationModel,
  locale: Locale
): string[] {
  const visibleCodes = presentation.behaviorCodes.filter((code) =>
    !COVERAGE_BEHAVIOR_CODES.has(code)
  );
  const latestTotal = BigInt(sumRaw(report.latestPrincipalInboundEvents.map(
    (event) => event.amountRaw
  )));
  const outgoingTotal = BigInt(sumRaw(presentation.outgoingRows.map((row) =>
    row.amount.amountRaw
  )));
  const almostAllForwarded = latestTotal > 0n &&
    outgoingTotal * 100n >= latestTotal * 90n;
  const sentences = unique(visibleCodes.map((code) => {
    if (code === "rapid_forwarding" && almostAllForwarded) {
      return locale === "ru"
        ? "Почти вся полученная сумма была переведена дальше."
        : "Almost all received funds were forwarded onward.";
    }
    return BEHAVIOR_COPY[code]?.[locale] ?? (locale === "ru"
      ? "Найден дополнительный поведенческий контекст; сам по себе он не доказывает злоупотребление."
      : "Additional behavioral context was found; by itself it does not prove abuse.");
  }));
  return sentences.map((sentence) => escapeHtml(sentence));
}

function profileLines(
  report: UnifiedWalletDossierV1,
  presentation: PresentationModel,
  locale: Locale
): string[] {
  const profile = section(report, "wallet_profile").profile;
  const created = escapeHtml(formatCustomerUtcDate(profile.createdAt, locale));
  const transferCounts = customerDirectionCount(
    profile.incomingUsdtTransferCount,
    profile.outgoingUsdtTransferCount,
    locale
  );
  if (presentation.compactProfile) {
    return [
      `<b>${locale === "ru" ? "👛 Профиль кошелька" : "👛 Wallet profile"}</b>`,
      `• ${locale === "ru" ? "Создан" : "Created"}: ${created}`,
      `• USDT: ${transferCounts}`
    ];
  }
  const first = profile.firstUsdtActivityAt;
  const last = profile.lastUsdtActivityAt;
  let activity: string;
  if (
    first !== null &&
    last !== null &&
    new Date(last).getTime() - new Date(first).getTime() <= 60_000
  ) {
    activity = locale === "ru"
      ? "Активность наблюдалась в течение нескольких секунд."
      : "Activity was observed over a few seconds.";
  } else {
    activity = locale === "ru"
      ? `Активность: ${formatCustomerUtcDate(first, locale)} — ${formatCustomerUtcDate(last, locale)}.`
      : `Activity: ${formatCustomerUtcDate(first, locale)} — ${formatCustomerUtcDate(last, locale)}.`;
  }
  return [
    `<b>${locale === "ru" ? "👛 Профиль кошелька" : "👛 Wallet profile"}</b>`,
    `• ${locale === "ru" ? "Создан" : "Created"}: ${created}`,
    `• ${locale === "ru" ? "Переводы USDT" : "USDT transfers"}: ${transferCounts}`,
    `• ${escapeHtml(activity)}`
  ];
}

function coverageLines(
  report: UnifiedWalletDossierV1,
  presentation: PresentationModel,
  locale: Locale
): string[] {
  const rows = section(report, "coverage").dimensions;
  const lines = [
    `<b>${locale === "ru" ? "🔍 Что удалось проверить" : "🔍 What was checked"}</b>`
  ];
  if (rows.length === 0) {
    lines.push(locale === "ru"
      ? "• Денежных направлений для трассировки нет."
      : "• There is no money-flow direction to trace.");
    return lines;
  }
  if (presentation.behaviorCodes.includes(
    "history_exhausted_to_account_creation"
  )) {
    lines.push(locale === "ru"
      ? "• История входящих и исходящих переводов изучена до момента создания кошелька."
      : "• Incoming and outgoing history was checked back to wallet creation.");
  }
  if (rows.every((row) =>
    row.tracePpm === 1_000_000 && row.untracedPpm === 0
  )) {
    lines.push(locale === "ru"
      ? "• Переводы прослежены полностью."
      : "• Transfers were traced completely.");
  }
  if (
    presentation.behaviorCodes.includes("unknown_source") ||
    rows.some((row) => row.unknownBoundaryPpm > 0)
  ) {
    lines.push(locale === "ru"
      ? "• Первоначальный источник средств определить не удалось."
      : "• The original source of funds could not be determined.");
  }
  for (const row of rows.filter((item) => item.untracedPpm > 0)) {
    const direction = locale === "ru"
      ? row.direction === "backward" ? "входящих" : "исходящих"
      : row.direction === "backward" ? "incoming" : "outgoing";
    lines.push(locale === "ru"
      ? `• Часть ${direction} переводов не прослежена (${formatCustomerPercent(row.untracedPpm, locale)}); вывод ограничен этой неполнотой.`
      : `• Part of the ${direction} transfers is untraced (${formatCustomerPercent(row.untracedPpm, locale)}); this limits the conclusion.`);
  }
  return lines;
}

function conclusionLines(
  report: UnifiedWalletDossierV1,
  presentation: PresentationModel,
  locale: Locale
): string[] {
  let conclusion: string;
  if (report.decision === "ACCEPTABLE") {
    conclusion = locale === "ru"
      ? "В проверенных данных существенных риск-сигналов не найдено. Это не гарантирует безопасность будущей сделки."
      : "No material risk signal was found in the checked data. This does not guarantee the safety of a future transaction.";
  } else if (report.decision === "DECLINE") {
    conclusion = locale === "ru"
      ? "Найдены существенные риск-сигналы. Не продолжайте сделку до ручной проверки."
      : "Material risk signals were found. Do not proceed until a manual review is completed.";
  } else if (presentation.behaviorCodes.includes("rapid_forwarding")) {
    conclusion = locale === "ru"
      ? "Прямых доказательств высокого риска не найдено. Однако кошелёк имеет транзитное поведение, поэтому для крупной сделки рекомендуется дополнительная проверка контрагента."
      : "No direct evidence of high risk was found. However, the wallet shows transit behavior, so additional counterparty checks are recommended for a large transaction.";
  } else {
    conclusion = locale === "ru"
      ? "Перечисленные сигналы требуют ручной проверки перед крупной сделкой."
      : "The listed signals require manual review before a large transaction.";
  }
  return [
    `<b>${locale === "ru" ? "🧭 Вывод" : "🧭 Conclusion"}</b>`,
    escapeHtml(conclusion)
  ];
}

function render(
  report: UnifiedWalletDossierV1,
  presentation: PresentationModel,
  locale: Locale
): string {
  const blocks = [
    [header(report, locale)],
    [
      `<b>${locale === "ru" ? "Почему такая оценка" : "Why this score"}</b>`,
      ...scoreDriverLines(presentation, locale)
    ],
    guidanceLines(report, presentation, locale),
    [
      ...moneyLines(report, presentation, locale),
      ...behaviorLines(report, presentation, locale)
    ],
    serviceContractLines(presentation, locale),
    profileLines(report, presentation, locale),
    coverageLines(report, presentation, locale),
    conclusionLines(report, presentation, locale),
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
    rendererVersion: CURRENT_RENDERER_VERSION,
    templateVersion: CURRENT_TEMPLATE_VERSION,
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
    input.manifest.rendererVersion !== CURRENT_RENDERER_VERSION ||
    input.manifest.templateVersion !== CURRENT_TEMPLATE_VERSION ||
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
    item.manifest.locale === input.locale &&
    item.manifest.rendererVersion === CURRENT_RENDERER_VERSION &&
    item.manifest.templateVersion === CURRENT_TEMPLATE_VERSION
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
