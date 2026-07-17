import type { NarrativeFactV2 } from "../types";
import { escapeHtml, renderTelegramAddressRef, safeTruncateHtml } from "../alerts/telegramHtml";
import type {
  ApprovalPresentationV1,
  TelegramAssessmentPresentationV1,
  TelegramForensicResultV1,
  TelegramRoutePresentationV1
} from "./forensicPresentation";

function formatRaw(raw: string, locale: "ru" | "en"): string {
  const padded = BigInt(raw).toString().padStart(7, "0");
  const whole = padded.slice(0, -6).replace(/\B(?=(\d{3})+(?!\d))/g, locale === "ru" ? " " : ",");
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}${locale === "ru" ? "," : "."}${fraction}` : whole;
}

function percent(share: number, locale: "ru" | "en"): string {
  const value = Math.round(share * 1_000) / 10;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return locale === "ru" ? text.replace(".", ",") : text;
}

function russianTransfers(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  return `${count} ${mod100 >= 11 && mod100 <= 14 ? "переводов" : mod10 === 1 ? "перевод" : mod10 >= 2 && mod10 <= 4 ? "перевода" : "переводов"}`;
}

function transferCount(count: number, locale: "ru" | "en"): string {
  return locale === "ru" ? russianTransfers(count) : `${count} ${count === 1 ? "transfer" : "transfers"}`;
}

function linked(ref: TelegramForensicResultV1["checkedWallet"]): string {
  return renderTelegramAddressRef(ref);
}

function title(result: TelegramForensicResultV1): string {
  if (result.kind === "where_preliminary") return "🧾 <b>Откуда деньги — предварительный результат</b>";
  if (result.kind === "contract_safety") return "🧾 <b>Проверка контракта</b>";
  if (result.kind === "approval_safety") return "🛡 <b>Проверка доступа к USDT</b>";
  if (result.kind === "incoming_deposit") return "🧾 <b>Проверка входящего перевода</b>";
  return "🧾 <b>Проверка кошелька</b>";
}

function walletLine(result: TelegramForensicResultV1): string {
  return result.kind === "approval_safety"
    ? `Проверяемый кошелёк — кошелёк, который выдал доступ к USDT: ${linked(result.checkedWallet)}`
    : `Кошелёк: ${linked(result.checkedWallet)}`;
}

function riskHeading(assessment: TelegramAssessmentPresentationV1): string {
  if (assessment.kind === "wallet_safety") {
    if (assessment.score === null) return "⚪ <b>Текущий риск для кошелька не рассчитан</b>";
    if (assessment.score === 0) return "🟢 <b>0/100 — разрешение больше не активно</b>";
    const label = assessment.level === "LOW" ? "низкий" : assessment.level === "MEDIUM" ? "средний" : assessment.level === "HIGH" ? "высокий" : "критический";
    return `${assessment.indicator} <b>${assessment.score}/100 — ${label} риск для кошелька</b>`;
  }
  const label = assessment.level === "LOW" ? "низкий риск" : assessment.level === "MEDIUM" ? "требуется проверка" : assessment.level === "HIGH" ? "высокий риск" : "критический риск";
  const suffix = assessment.kind === "contract_risk" ? " контракта" : "";
  return `${assessment.indicator} <b>${assessment.score}/100 — ${label}${suffix}</b>`;
}

function routeLine(route: TelegramRoutePresentationV1, locale: "ru" | "en"): string {
  const details: string[] = [];
  if (route.share !== null) details.push(`${percent(route.share, locale)}%`);
  if (route.transferCount !== null) details.push(transferCount(route.transferCount, locale));
  const amount = route.asset === "USDT" || route.asset === "TRX"
    ? `${formatRaw(route.amountRaw, locale)} ${route.asset}`
    : locale === "ru"
      ? `${route.asset === "other" ? "неизвестный токен" : route.asset} — точный формат суммы не подтверждён`
      : `${route.asset === "other" ? "unknown token" : route.asset} — exact amount formatting is not confirmed`;
  return `${linked(route.from)} → ${linked(route.to)}: ${amount}${details.length ? ` (${details.join(", ")})` : ""}.`;
}

function sortedRoutes(routes: TelegramRoutePresentationV1[]): TelegramRoutePresentationV1[] {
  return routes
    .map((route, index) => ({ route, index }))
    .sort((left, right) => {
      if (left.route.share !== null && right.route.share !== null && left.route.share !== right.route.share) {
        return right.route.share - left.route.share;
      }
      if (left.route.asset === right.route.asset) {
        const amount = BigInt(right.route.amountRaw) - BigInt(left.route.amountRaw);
        if (amount !== 0n) return amount > 0n ? 1 : -1;
      }
      return left.index - right.index;
    })
    .map(({ route }) => route);
}

function routeLines(result: TelegramForensicResultV1): string[] {
  const routes = sortedRoutes(result.routes);
  const lines = routes.slice(0, 2).map((route) => routeLine(route, result.locale));
  if (routes.length > 2) {
    const rest = routes.slice(2);
    const assets = new Set(rest.map((route) => route.asset));
    if (assets.size === 1 && (rest[0]!.asset === "USDT" || rest[0]!.asset === "TRX")) {
      const total = rest.reduce((sum, route) => sum + BigInt(route.amountRaw), 0n);
      const asset = rest[0]!.asset;
      lines.push(result.locale === "ru"
        ? `Ещё ${rest.length} маршрут: ${formatRaw(total.toString(), result.locale)} ${asset}.`
        : `${rest.length} more ${rest.length === 1 ? "route" : "routes"}: ${formatRaw(total.toString(), result.locale)} ${asset}.`);
    } else if (assets.size === 1) {
      const asset = rest[0]!.asset === "other" ? (result.locale === "ru" ? "неизвестном токене" : "an unknown token") : rest[0]!.asset;
      lines.push(result.locale === "ru"
        ? `Ещё ${rest.length} маршрута в ${asset}; точный формат суммы не подтверждён.`
        : `${rest.length} more routes in ${asset}; exact amount formatting is not confirmed.`);
    } else {
      lines.push(result.locale === "ru"
        ? `Ещё ${rest.length} маршрута с разными активами.`
        : `${rest.length} more routes with different assets.`);
    }
  }
  return lines;
}

function scoreFactReason(fact: NarrativeFactV2, locale: "ru" | "en"): string | null {
  if (!fact.factTextKey.startsWith("score.")) return null;
  const row = fact.factTextKey.split(".")[1];
  const ru: Record<string, string> = {
    subject_restriction: "Контракт USDT подтверждает: проверяемый кошелёк находится в чёрном списке, USDT на нём заблокированы.",
    direct_counterparty_policy: "Найдена прямая связь с адресом, который сейчас находится в чёрном списке USDT.",
    hard_proof: "Найдено точное on-chain подтверждение опасной операции или связи с известной мошеннической инфраструктурой.",
    source_policy: "Основная часть проверяемой суммы пришла из источника с повышенным AML-риском.",
    incoming_deposit_source_policy: "Источник входящего перевода относится к категории с повышенным AML-риском.",
    service_linked_pattern: "Найдена подтверждённая последовательность переводов через сервисную инфраструктуру с повышенным риском.",
    route_linked_approval_pattern: "Маршрут денег связан с опасным разрешением на управление USDT.",
    asset_continuation: "После смены актива сохранилась подтверждённая связь с тем же рискованным маршрутом.",
    typology_subgraph_pattern: "Найдена подтверждённая схема быстрого транзита и объединения переводов.",
    contract_suspicion: "У контракта найден подтверждённый шаблон опасного списания средств.",
    counterparty_context: "Найдена значимая связь с рискованным контрагентом.",
    behavior_only_prior: "Поведение кошелька похоже на транзит или сбор средств и требует дополнительной проверки.",
    coverage_uncertainty: "Данных недостаточно, чтобы надёжно подтвердить происхождение всей проверяемой суммы.",
    clean_or_operational: "Проверенная часть маршрута соответствует обычной сервисной или операционной активности."
  };
  const en: Record<string, string> = {
    subject_restriction: "The official USDT contract confirms that the checked wallet is blacklisted and its USDT is blocked.",
    direct_counterparty_policy: "A direct link to an address currently blacklisted by USDT was found.",
    hard_proof: "Exact on-chain evidence of a dangerous transfer or known scam infrastructure was found.",
    source_policy: "Most of the checked amount came from a source with elevated AML risk.",
    incoming_deposit_source_policy: "The incoming transfer came from a source category with elevated AML risk.",
    service_linked_pattern: "A confirmed transfer sequence through higher-risk service infrastructure was found.",
    route_linked_approval_pattern: "The money route is linked to dangerous USDT spending access.",
    asset_continuation: "A confirmed risky route continued after the asset was changed.",
    typology_subgraph_pattern: "A confirmed rapid transit and transfer-consolidation pattern was found.",
    contract_suspicion: "The contract has a confirmed dangerous debit pattern.",
    counterparty_context: "A material connection to a risky counterparty was found.",
    behavior_only_prior: "The wallet behaves like a transit or collection wallet and needs further review.",
    coverage_uncertainty: "There is not enough data to confirm the source of the entire checked amount.",
    clean_or_operational: "The traced route is consistent with ordinary service or operational activity."
  };
  return (locale === "ru" ? ru : en)[row ?? ""] ?? null;
}

function preliminaryFactLines(fact: NarrativeFactV2, locale: "ru" | "en"): string[] | null {
  const scoreReason = scoreFactReason(fact, locale);
  if (scoreReason) return [scoreReason];
  const ru = locale === "ru";
  if (fact.factTextKey === "where_preliminary_bridge_shared_liquidity" && fact.share !== null) {
    return ru
      ? [
        `${percent(fact.share, locale)}% выбранной суммы пришло через кроссчейн-мост с общей ликвидностью.`,
        "После такого сервиса более ранний источник сложнее отделить от переводов других клиентов."
      ]
      : [
        `${percent(fact.share, locale)}% of the selected amount came through a cross-chain bridge with shared liquidity.`,
        "After a shared-liquidity service, the earlier source is harder to separate from other clients' transfers."
      ];
  }
  if (fact.factTextKey === "bridge_shared_liquidity_inbound" && fact.share !== null) {
    return ru
      ? [
        `${percent(fact.share, locale)}% проверяемой суммы поступило через мост или обменный сервис с общей ликвидностью.`,
        "После общего пула более ранний источник сложнее отделить от переводов других клиентов."
      ]
      : [
        `${percent(fact.share, locale)}% of the checked amount came through a bridge or exchange service with shared liquidity.`,
        "After the shared pool, the earlier source is harder to separate from other clients' transfers."
      ];
  }
  if (
    fact.factTextKey === "outgoing_blacklisted_counterparty_later_frozen" &&
    fact.amountRaw !== null && fact.share !== null && fact.txCount !== null && fact.addresses[1]
  ) {
    return ru
      ? [
        `Кошелёк отправил ${formatRaw(fact.amountRaw, locale)} USDT на ${linked(fact.addresses[1])} — ${percent(fact.share, locale)}% исходящей суммы, ${russianTransfers(fact.txCount)}.`,
        "Сейчас этот получатель находится в чёрном списке USDT; его заблокировали после этих переводов."
      ]
      : [
        `The wallet sent ${formatRaw(fact.amountRaw, locale)} USDT to ${linked(fact.addresses[1])} — ${percent(fact.share, locale)}% of outgoing value across ${transferCount(fact.txCount, locale)}.`,
        "The recipient is now on the USDT blacklist; it was blocked after these transfers."
      ];
  }
  if (fact.factTextKey === "usdd_psm_inbound_shared_liquidity" && fact.share !== null) {
    return ru
      ? [
        `${percent(fact.share, locale)}% проверяемой суммы пришло из USDD PSM — децентрализованного сервиса обмена USDT и USDD с общей ликвидностью.`,
        "После общего пула более ранний источник сложнее отделить от переводов других пользователей."
      ]
      : [
        `${percent(fact.share, locale)}% of the checked amount came from the decentralized USDD PSM shared-liquidity service.`,
        "After the shared pool, the earlier source is harder to separate from other users' transfers."
      ];
  }
  if (fact.factTextKey === "usdd_psm_outbound_shared_liquidity" && fact.share !== null) {
    return [ru
      ? `${percent(fact.share, locale)}% суммы направлено через USDD PSM — децентрализованный сервис обмена USDT и USDD.`
      : `${percent(fact.share, locale)}% of the checked amount was sent through the decentralized USDD PSM service.`];
  }
  if (
    fact.factTextKey === "htx_historical_policy_context" &&
    fact.amountRaw !== null && fact.share !== null && fact.txCount !== null
  ) {
    return [ru
      ? `Найдена историческая связь с HTX/Huobi: ${formatRaw(fact.amountRaw, locale)} USDT — ${percent(fact.share, locale)}% суммы, ${russianTransfers(fact.txCount)}.`
      : `A historical HTX/Huobi connection covers ${formatRaw(fact.amountRaw, locale)} USDT — ${percent(fact.share, locale)}% of the amount across ${transferCount(fact.txCount, locale)}.`];
  }
  if (fact.factTextKey === "collector_context_only" && fact.txCount !== null) {
    return [ru
      ? `Кошелёк работает как коллектор: собирает переводы и перемещает их дальше (${russianTransfers(fact.txCount)}).`
      : `The wallet collects incoming transfers and moves them onward across ${transferCount(fact.txCount, locale)}.`];
  }
  if (fact.factTextKey === "collector_disjoint_independent_signal") {
    return [ru
      ? "Кроме коллекторского поведения найден отдельный независимый риск-сигнал."
      : "A separate independent risk signal was found in addition to the collector behavior."];
  }
  if (fact.factTextKey === "contract_exact_debit_confirmed") {
    return [ru
      ? "Подтверждено списание USDT через проверяемый контракт. Сохранённые данные не указывают сумму, кошелёк-источник или получателя."
      : "A USDT debit through the checked contract was confirmed. The saved evidence does not identify an amount, source wallet, or receiver."];
  }
  if (fact.factTextKey === "low_balance_latest_five_principal" && fact.amountRaw !== null && fact.txCount !== null) {
    return [ru
      ? `Проверены последние ${fact.txCount} движений основной суммы; общий объём — ${formatRaw(fact.amountRaw, locale)} USDT.`
      : `The latest ${fact.txCount} principal movements total ${formatRaw(fact.amountRaw, locale)} USDT.`];
  }
  if (fact.factTextKey === "approval_drain_roles_distinct" && fact.addresses[0] && fact.addresses[1] && fact.addresses[2]) {
    return ru
      ? [
        `Кошелёк ${linked(fact.addresses[0])} выдал доступ к USDT.`,
        `Контракт ${linked(fact.addresses[1])} получил доступ, а ${linked(fact.addresses[2])} — первый получатель списанных средств.`
      ]
      : ["A wallet granted USDT access to a contract, and the checked wallet was the first recipient of the transferred funds."];
  }
  if (fact.factTextKey === "principal_transfer_context" && fact.amountRaw !== null && fact.txCount !== null) {
    return [ru
      ? `Проверено ${russianTransfers(fact.txCount)} основной суммы на ${formatRaw(fact.amountRaw, locale)} USDT.`
      : `${transferCount(fact.txCount, locale)} of principal movement totaling ${formatRaw(fact.amountRaw, locale)} USDT were checked.`];
  }
  if (fact.factTextKey === "true_no_principal_activity") {
    return [ru
      ? "В проверенном периоде нет входящих переводов основной суммы, происхождение которых можно оценить."
      : "No incoming principal transfers that can be assessed were found in the checked period."];
  }
  if (fact.factTextKey === "gasfree_account_structural") {
    return [ru
      ? "Это сервисный GasFree Account. Его переводы учитываются как обычное движение денег."
      : "This is a GasFree Account service contract. Its transfers remain ordinary AML money flows."];
  }
  if (fact.factTextKey === "official_usdt_registry_contract") {
    return [ru ? "Это официальный контракт USDT в сети TRON." : "This is the official TRON USDT contract."];
  }
  if (fact.factTextKey === "fast_behavior_context") {
    return [ru
      ? "Быстрая проверка нашла поведенческий контекст, который требует дополнительной проверки."
      : "The quick check found behavioral context that requires additional review."];
  }
  return null;
}

function standardCoverage(result: TelegramForensicResultV1): string[] {
  const coverage = result.coverage;
  if (!coverage) {
    if (result.legacyCoverage) {
      const selected = result.legacyCoverage.selectedCount;
      return [
        "<b>Покрытие</b>",
        ...(selected === null ? [] : [`К проверяемой сумме отобрано ${selected} входящих переводов.`]),
        "Общее число доступных переводов в этом результате не сохранено."
      ];
    }
    return [];
  }
  if (coverage.availableInboundTxCount !== null) {
    const lines = [
      "<b>Покрытие</b>",
      `Доступно ${coverage.availableInboundTxCount} входящих перевода. К выбранной сумме относятся ${coverage.selectedInboundTxCount}.`
    ];
    if (coverage.excludedInboundTxCount && coverage.excludedInboundTxCount > 0) {
      const gasFree = coverage.exclusions.some((item) => item.reason === "exact_gasfree_service_fee");
      lines.push(`Ещё ${coverage.excludedInboundTxCount} проверены, но исключены${gasFree ? ": это подтверждённые технические GasFree-комиссии" : ""}.`);
    }
    return lines;
  }
  if (coverage.tracedShare !== null) {
    const traced = percent(coverage.tracedShare, result.locale);
    return [
      "<b>Покрытие</b>",
      `К выбранной сумме относятся ${coverage.selectedInboundTxCount} входящих переводов; прослежено ${traced}% суммы.`,
      ...(coverage.unresolvedShare && coverage.unresolvedShare > 0
        ? [`Оставшиеся ${percent(coverage.unresolvedShare, result.locale)}% не удалось связать с подтверждённым источником.`]
        : [])
    ];
  }
  return ["<b>Покрытие</b>", `К выбранной сумме относятся ${coverage.selectedInboundTxCount} входящих переводов.`];
}

function technicalContextLines(result: TelegramForensicResultV1): string[] {
  const fact = result.primaryFact ?? result.secondaryFacts[0] ?? null;
  if (!fact) return [];
  if (fact.factTextKey === "low_balance_latest_five_principal" && fact.amountRaw !== null && fact.txCount !== null) {
    return [`Проверены последние ${fact.txCount} движений основной суммы; общий объём — ${formatRaw(fact.amountRaw, result.locale)} USDT.`];
  }
  if (fact.factTextKey === "collector_context_only" && fact.txCount !== null) {
    return [`Кошелёк работает как коллектор: собирает переводы и перемещает их дальше (${russianTransfers(fact.txCount)}).`];
  }
  if (fact.factTextKey === "htx_historical_policy_context") {
    return ["Найдена историческая связь с HTX/Huobi. Для итоговой оценки не хватает подтверждённого покрытия выбранной суммы."];
  }
  if (fact.factTextKey === "usdd_psm_outbound_shared_liquidity" && fact.share !== null) {
    return [`${percent(fact.share, result.locale)}% суммы направлено через USDD PSM — децентрализованный сервис обмена USDT и USDD.`];
  }
  if (fact.factTextKey === "usdd_psm_inbound_shared_liquidity" && fact.share !== null) {
    return [`${percent(fact.share, result.locale)}% суммы пришло из USDD PSM — децентрализованного сервиса обмена USDT и USDD.`];
  }
  if (fact.factTextKey === "principal_transfer_context") return ["Найдено подтверждённое движение основной суммы."];
  return [];
}

function technicalReasonText(key: string | null, locale: "ru" | "en"): string {
  const ru: Record<string, string> = {
    insufficient_coverage: "Недостаточно подтверждённого покрытия, чтобы рассчитать итоговую оценку.",
    partial_budget_exhausted: "Проверка достигла лимита обработки до завершения необходимой истории.",
    local_budget_limited: "Локальный лимит обработки не позволил проверить необходимую историю переводов.",
    local_index_read_failed: "Локальный индекс переводов не удалось прочитать.",
    provider_error: "Источник данных завершил проверку с ошибкой.",
    rate_limited_after_retries: "Источник данных ограничил запросы даже после повторных попыток.",
    provider_inconsistent: "Источник данных вернул противоречивую историю переводов.",
    provider_cap_unresolved: "Источник данных не отдал всю необходимую историю в доступном диапазоне.",
    hard_safety_limit_exceeded: "Проверка остановлена на предельном объёме данных, установленном для безопасности системы.",
    budget_limited: "Проверка достигла общего лимита обработки до завершения необходимой истории.",
    local_data_error: "Локальные данные проверки недоступны или повреждены.",
    provider_limited: "Источник данных не отдал всю необходимую историю переводов.",
    provider_history_unavailable: "Источник данных не отдал старые переводы, необходимые для расчёта."
  };
  const en: Record<string, string> = {
    insufficient_coverage: "There is not enough confirmed coverage to calculate a final score.",
    partial_budget_exhausted: "The check reached its processing budget before the required history was complete.",
    local_budget_limited: "A local processing limit prevented the required transfer history from being checked.",
    local_index_read_failed: "The local transfer index could not be read.",
    provider_error: "The data source ended the check with an error.",
    rate_limited_after_retries: "The data source still limited requests after retries.",
    provider_inconsistent: "The data source returned an inconsistent transfer history.",
    provider_cap_unresolved: "The data source did not return all required history within its available range.",
    hard_safety_limit_exceeded: "The check stopped at the maximum data volume allowed by the system safety limit.",
    budget_limited: "The check reached its overall processing limit before the required history was complete.",
    local_data_error: "Local check data is unavailable or corrupted.",
    provider_limited: "The data source did not return all required transfer history.",
    provider_history_unavailable: "The data source did not return older transfers required for the calculation."
  };
  return (locale === "ru" ? ru : en)[key ?? ""] ?? (locale === "ru"
    ? "Данных недостаточно для итоговой оценки."
    : "There is not enough validated data for a final score.");
}

function renderTechnical(result: TelegramForensicResultV1): string {
  const context = technicalContextLines(result);
  const routes = routeLines(result);
  const savedCoverage = standardCoverage(result);
  const lines = [
    title(result),
    walletLine(result),
    "",
    "⚪ <b>Итоговая оценка не рассчитана</b>",
    "",
    "🔎 <b>Что произошло</b>",
    technicalReasonText(result.technicalLimitTextKey, "ru"),
    ...(context.length ? ["", "<b>Что нашли</b>", ...context] : []),
    ...(routes.length ? ["", "💸 <b>Движение денег</b>", ...routes] : []),
    ...(savedCoverage.length ? ["", ...savedCoverage] : []),
    ...(result.technicalLimitTextKey ? ["До повторной проверки не проводите операцию."] : [])
  ];
  return lines.join("\n");
}

function renderNoActivity(result: TelegramForensicResultV1): string {
  return [
    title(result),
    walletLine(result),
    "",
    "⚪ <b>Оценка не рассчитана</b>",
    "",
    "🔎 <b>Что нашли</b>",
    "В проверенном периоде нет входящих переводов основной суммы, происхождение которых можно оценить.",
    "Технические комиссии не считаются движением основной суммы."
  ].join("\n");
}

function approvalAllowanceLine(approval: ApprovalPresentationV1): string {
  if (approval.allowanceState === "confirmed_zero") return "Разрешение на управление USDT сейчас: 0 USDT; подтверждено напрямую в официальном контракте USDT.";
  if (approval.allowanceState === "confirmed_active") {
    if (approval.confirmedAllowanceRaw === null) return "Разрешение на управление USDT сейчас: подтвердить не удалось; нельзя считать его активным или отозванным.";
    const amount = approval.isUnlimited ? "активное, безлимитное" : `активное, ${formatRaw(approval.confirmedAllowanceRaw, "ru")} USDT`;
    return `Разрешение на управление USDT сейчас: ${amount}; подтверждено напрямую в официальном контракте USDT.`;
  }
  return "Разрешение на управление USDT сейчас: подтвердить не удалось; нельзя считать его активным или отозванным.";
}

function renderApproval(result: TelegramForensicResultV1): string {
  const approval = result.approval!;
  const assessment = result.assessment?.kind === "wallet_safety" ? result.assessment : null;
  const session = approval.serviceSession;
  const bridgers = session?.authoritativeServiceId === "bridgers";
  const debit = approval.debitState === "confirmed" && approval.debitAmountRaw !== null
    ? `Фактическое списание через этот контракт: подтверждено, ${formatRaw(approval.debitAmountRaw, "ru")} USDT.`
    : approval.debitState === "not_found"
      ? "Фактическое списание через этот контракт: не найдено."
      : "Ранее кошелёк выдавал этому контракту доступ к USDT. Текущее списание через него не подтверждено.";
  const bridgersDebit = session && (approval.allowanceState === "confirmed_active" || approval.allowanceState === "confirmed_zero")
    ? `Списание через этот контракт: ${formatRaw(session.movedAmountRaw, "ru")} USDT в ${approval.allowanceState === "confirmed_zero" ? "ранее подтверждённом обмене" : "подтверждённом swap"}.`
    : debit;
  const common = [
    title(result),
    walletLine(result),
    `Контракт, получивший доступ к USDT: ${linked(approval.spender)}`,
    approvalAllowanceLine(approval),
    bridgers ? bridgersDebit : debit,
    ""
  ];

  if (!assessment || assessment.score === null) return [
    ...common,
    "⚪ <b>Текущий риск для кошелька не рассчитан</b>",
    "",
    "🔎 <b>Почему</b>",
    "Прямой запрос разрешения к официальному контракту USDT завершился ошибкой.",
    "",
    "🧭 <b>Что делать</b>",
    approval.audienceContext === "external_address_check"
      ? "Если вы проверяете чужой кошелёк — попросите владельца подтвердить текущее разрешение на управление USDT."
      : "Если это ваш кошелёк — проверьте текущее разрешение напрямую в официальном контракте USDT."
  ].join("\n");

  if (bridgers && approval.allowanceState === "confirmed_zero") return [
    ...common,
    riskHeading(assessment),
    "",
    "🔎 <b>Вывод</b>",
    "Обмен через Bridgers объяснён. Разрешение на управление USDT равно нулю, действий не требуется."
  ].join("\n");

  if (bridgers && session) return [
    ...common,
    riskHeading(assessment),
    "",
    "🔎 <b>Почему такая оценка</b>",
    `Кошелёк сам запустил успешный обмен через Bridgers через ${Math.round(session.delayMs / 1_000)} секунд после выдачи доступа; сумма совпала.`,
    "",
    "🧭 <b>Что делать</b>",
    "Swap объяснён. Если это ваш кошелёк, неиспользуемое разрешение можно отозвать как цифровую гигиену."
  ].join("\n");

  if (!approval.exactVerify20) {
    const action = approval.audienceContext === "watched_wallet"
      ? "Если это ваш кошелёк — отзовите неиспользуемое разрешение на управление USDT."
      : "Если вы проверяете чужой кошелёк — попросите владельца объяснить и отозвать неиспользуемое разрешение.";
    return [
      ...common,
      riskHeading(assessment),
      "",
      "🔎 <b>Почему такая оценка</b>",
      "Контракт относится к известному сервису, но точную связанную операцию подтвердить не удалось.",
      "Активное разрешение на управление USDT остаётся техническим риском для кошелька.",
      "",
      "🧭 <b>Что делать</b>",
      action
    ].join("\n");
  }

  const verifyReason = approval.debitState === "confirmed"
    ? "Найдена точная Verify20-цепочка и списание USDT через этот контракт."
    : "Контракт имеет точный Verify20-шаблон массовых списаний с множества кошельков.";
  const context = approval.debitState === "confirmed"
    ? "Это подтверждает движение средств, но само по себе не доказывает кражу и не показывает, кто управлял операцией."
    : approval.campaignEvidenceIds.length > 0
      ? "Связи кампании и BTTOLD-последовательность — контекст, а не доказательство кражи."
      : "Фактическое списание с проверяемого кошелька не найдено.";
  const permissionUnknown = approval.allowanceState === "failed" || approval.allowanceState === "stale";
  const action = permissionUnknown
    ? approval.audienceContext === "watched_wallet"
      ? "Списание подтверждено. Если это ваш кошелёк — проверьте текущее разрешение напрямую в официальном контракте USDT и до этого не пополняйте кошелёк."
      : "Списание подтверждено. Если вы проверяете чужой кошелёк — не переводите на него деньги, пока владелец не подтвердит текущее разрешение."
    : approval.audienceContext === "watched_wallet"
      ? "На отслеживаемом кошельке найдено активное разрешение. Если это ваш кошелёк — отзовите разрешение на управление USDT и до этого не пополняйте его."
      : "Если вы проверяете чужой кошелёк — не переводите на него деньги, пока владелец не объяснит и не отзовёт опасное разрешение.";
  return [
    ...common,
    riskHeading(assessment),
    "",
    "🔎 <b>Почему такая оценка</b>",
    verifyReason,
    ...(approval.balanceAtRiskRaw && approval.allowanceState === "confirmed_active"
      ? [`Контракту доступен текущий баланс: ${formatRaw(approval.balanceAtRiskRaw, "ru")} USDT.`]
      : []),
    context,
    "",
    "🧭 <b>Что делать</b>",
    action
  ].join("\n");
}

function renderContract(result: TelegramForensicResultV1): string {
  const assessment = result.assessment;
  const gasFree = result.primaryFact?.factTextKey === "gasfree_account_structural";
  const official = result.primaryFact?.factTextKey === "official_usdt_registry_contract";
  const authority = result.contractDecision?.deterministic.authority ?? null;
  const registeredService = authority === "official_registry" && !official;
  const knownServiceAction = authority === "known_service_session";
  const finding = gasFree
    ? "Это GasFree Account — сервисный контракт для переводов USDT с оплатой комиссии через провайдера."
    : official
      ? "Это официальный контракт USDT в сети TRON."
      : authority === "verify20_fingerprint"
        ? "У контракта найден точный Verify20-шаблон массовых списаний с множества кошельков."
        : authority === "exact_debit"
          ? "Подтверждено списание USDT через проверяемый контракт. Сохранённые данные не указывают сумму, кошелёк-источник или получателя."
          : authority === "provider_risk"
            ? "Провайдер пометил контракт как рискованный; эта метка подтверждена сохранёнными данными."
            : knownServiceAction
              ? "Подтверждена успешная операция через известный сервис, которую кошелёк выполнил после выдачи доступа к USDT."
              : registeredService
                ? "Адрес подтверждён в реестре как известный сервис."
                : "Найден только подтверждённый контекст контракта без точного опасного действия.";
  const conclusion = gasFree
    ? "Сам GasFree-статус не повышает AML-риск. Переводы этого адреса продолжают оцениваться как обычные денежные потоки."
    : official
      ? "Адрес подтверждён официальным реестром."
      : registeredService
        ? "Контракт относится к подтверждённому сервису."
        : knownServiceAction
          ? "Операция объяснена подтверждённым действием через известный сервис."
      : assessment?.kind === "contract_risk" && assessment.decision === "DECLINE"
        ? "Не взаимодействуйте с этим контрактом."
        : assessment?.kind === "contract_risk" && assessment.decision === "REVIEW"
          ? "Перед взаимодействием проверьте подтверждённые данные о контракте вручную."
          : "Дополнительных действий по этой проверке не требуется.";
  return [
    title(result),
    walletLine(result),
    "",
    assessment ? riskHeading(assessment) : "⚪ <b>Оценка контракта не рассчитана</b>",
    "",
    "🔎 <b>Что нашли</b>",
    finding,
    gasFree ? "Точных признаков Verify20, опасного разрешения на управление USDT или списания USDT не найдено." : "",
    "",
    "🧭 <b>Вывод</b>",
    conclusion
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n").trim();
}

function renderWherePreliminary(result: TelegramForensicResultV1): string {
  const assessment = result.assessment;
  const fact = result.primaryFact;
  const reasons = fact ? preliminaryFactLines(fact, "ru") : null;
  if (!assessment || assessment.kind !== "aml_risk" || !fact || !reasons) return renderTechnical(result);
  const lines = [
    title(result),
    walletLine(result),
    "",
    `${assessment.indicator} <b>Предварительный риск: ${assessment.score}/100</b>`,
    "",
    "🔎 <b>Почему такая оценка</b>",
    ...reasons
  ];
  if (result.routes.length > 0) lines.push("", "💸 <b>Движение денег</b>", ...routeLines(result));
  const coverage = standardCoverage(result);
  if (coverage.length > 0) lines.push("", ...coverage);
  return lines.join("\n");
}

function renderFinalAml(result: TelegramForensicResultV1): string {
  const assessment = result.assessment;
  const primary = result.primaryFact;
  if (!assessment || assessment.kind !== "aml_risk" || !primary) return renderTechnical(result);
  const secondary = result.secondaryFacts[0] ?? null;
  const lines = [title(result), walletLine(result), "", riskHeading(assessment)];
  if (assessment.kind === "aml_risk" && assessment.decision === "DECLINE") lines.push("Операцию не проводить.");
  else if (
    assessment.kind === "aml_risk" && assessment.decision === "REVIEW" &&
    assessment.actionTextKey === "manual_review" && primary.factTextKey !== "usdd_psm_inbound_shared_liquidity"
  ) {
    lines.push("Поставьте операцию на паузу и проверьте вручную.");
  }

  lines.push("", "🔎 <b>Почему такая оценка</b>");
  if (primary.factTextKey === "outgoing_blacklisted_counterparty_later_frozen") {
    if (primary.amountRaw === null || primary.share === null || primary.txCount === null || !primary.addresses[1]) return renderTechnical(result);
    lines.push(
      `Кошелёк отправил ${formatRaw(primary.amountRaw, result.locale)} USDT на ${linked(primary.addresses[1])} — ${percent(primary.share, result.locale)}% исходящей суммы, ${russianTransfers(primary.txCount)}.`,
      "Сейчас этот получатель находится в чёрном списке USDT; его заблокировали после этих переводов."
    );
  } else if (primary.factTextKey === "usdd_psm_inbound_shared_liquidity") {
    if (primary.share === null) return renderTechnical(result);
    lines.push(
      `${percent(primary.share, result.locale)}% проверяемой суммы пришло из USDD PSM — децентрализованного сервиса обмена USDT и USDD с общей ликвидностью.`,
      "После общего пула более ранний источник сложнее отделить от переводов других пользователей."
    );
  } else if (primary.factTextKey === "usdd_psm_outbound_shared_liquidity") {
    if (primary.share === null) return renderTechnical(result);
    lines.push(`${percent(primary.share, result.locale)}% суммы направлено через USDD PSM — децентрализованный сервис обмена USDT и USDD.`);
  } else if (primary.factTextKey === "htx_historical_policy_context") {
    lines.push("Найдена историческая связь с HTX/Huobi. Такой источник может потребовать дополнительной проверки происхождения средств.");
  } else if (primary.factTextKey === "collector_context_only") {
    if (primary.txCount === null) return renderTechnical(result);
    lines.push(`Кошелёк работает как коллектор: собирает переводы и перемещает их дальше (${russianTransfers(primary.txCount)}).`);
  } else if (primary.factTextKey === "collector_disjoint_independent_signal") {
    lines.push("Кроме коллекторского поведения найден отдельный независимый риск-сигнал.");
  } else if (primary.factTextKey === "low_balance_latest_five_principal") {
    if (primary.amountRaw === null) return renderTechnical(result);
    lines.push(`Проверены последние 5 движений основной суммы; общий объём — ${formatRaw(primary.amountRaw, result.locale)} USDT.`);
  } else if (primary.factTextKey === "approval_drain_roles_distinct") {
    const [victim, spender, receiver] = primary.addresses;
    if (!victim || !spender || !receiver) return renderTechnical(result);
    lines.push(
      `Кошелёк ${linked(victim)} выдал доступ к USDT.`,
      `Контракт ${linked(spender)} получил доступ, а ${linked(receiver)} — первый получатель списанных средств.`
    );
  } else if (scoreFactReason(primary, "ru")) {
    lines.push(scoreFactReason(primary, "ru")!);
  } else if (primary.factTextKey === "principal_transfer_context" && primary.amountRaw !== null && primary.txCount !== null) {
    lines.push(`Проверено ${russianTransfers(primary.txCount)} основной суммы на ${formatRaw(primary.amountRaw, result.locale)} USDT.`);
  } else if (primary.factTextKey === "gasfree_account_structural") {
    lines.push("Это сервисный GasFree Account. Его переводы учитываются как обычное движение денег.");
  } else if (primary.factTextKey === "official_usdt_registry_contract") {
    lines.push("Это официальный контракт USDT в сети TRON.");
  } else if (primary.factTextKey === "fast_behavior_context") {
    lines.push("Быстрая проверка нашла поведенческий контекст, который требует дополнительной проверки.");
  } else {
    return renderTechnical(result);
  }

  if (result.routes.length > 0) {
    lines.push("", "💸 <b>Движение денег</b>", ...routeLines(result));
  }
  if (secondary?.factTextKey === "bridge_shared_liquidity_inbound") {
    if (secondary.share !== null) lines.push(`${percent(secondary.share, result.locale)}% проверяемой суммы поступило через мост или обменный сервис; до общего пула источник не разделяется по клиентам.`);
  }
  const coverage = standardCoverage(result).filter((line) =>
    primary.factTextKey !== "usdd_psm_inbound_shared_liquidity" || !line.startsWith("Оставшиеся ")
  );
  if (coverage.length > 0) lines.push("", ...coverage);
  return lines.join("\n");
}

function englishTitle(result: TelegramForensicResultV1): string {
  if (result.kind === "where_preliminary") return "🧾 <b>Where Is Money — preliminary result</b>";
  if (result.kind === "contract_safety") return "🧾 <b>Contract check</b>";
  if (result.kind === "approval_safety") return "🛡 <b>USDT access check</b>";
  if (result.kind === "incoming_deposit") return "🧾 <b>Incoming transfer check</b>";
  return "🧾 <b>Wallet check</b>";
}

function englishRiskHeading(assessment: TelegramAssessmentPresentationV1): string {
  if (assessment.score === null) return "⚪ <b>Current wallet risk was not calculated</b>";
  if (assessment.kind === "wallet_safety" && assessment.score === 0) return "🟢 <b>0/100 — USDT access is no longer active</b>";
  const level = assessment.level === "LOW" ? "low" : assessment.level === "MEDIUM" ? "medium" : assessment.level === "HIGH" ? "high" : "critical";
  const subject = assessment.kind === "wallet_safety" ? "wallet" : assessment.kind === "contract_risk" ? "contract" : "AML";
  return `${assessment.indicator} <b>${assessment.score}/100 — ${level} ${subject} risk</b>`;
}

function englishCoverage(result: TelegramForensicResultV1): string[] {
  const value = result.coverage;
  if (!value) {
    if (!result.legacyCoverage) return [];
    return [
      "<b>Coverage</b>",
      ...(result.legacyCoverage.selectedCount === null ? [] : [`${result.legacyCoverage.selectedCount} incoming transfers were selected for the checked amount.`]),
      "The total number of available transfers was not saved in this result."
    ];
  }
  if (value.availableInboundTxCount !== null) {
    const lines = [
      "<b>Coverage</b>",
      `${value.availableInboundTxCount} incoming transfers were available; ${value.selectedInboundTxCount} belong to the selected amount.`
    ];
    if (value.excludedInboundTxCount && value.excludedInboundTxCount > 0) {
      const gasFree = value.exclusions.some((item) => item.reason === "exact_gasfree_service_fee");
      lines.push(`${value.excludedInboundTxCount} more were checked and excluded${gasFree ? " as confirmed technical GasFree fees" : ""}.`);
    }
    return lines;
  }
  if (value.tracedShare !== null) {
    return [
      "<b>Coverage</b>",
      `${value.selectedInboundTxCount} incoming transfers belong to the selected amount; ${percent(value.tracedShare, "en")}% of the amount was traced.`,
      ...(value.unresolvedShare && value.unresolvedShare > 0
        ? [`The remaining ${percent(value.unresolvedShare, "en")}% could not be linked to a confirmed source.`]
        : [])
    ];
  }
  return ["<b>Coverage</b>", `${value.selectedInboundTxCount} incoming transfers belong to the selected amount.`];
}

function englishFact(fact: NarrativeFactV2): string | null {
  const lines = preliminaryFactLines(fact, "en");
  return lines?.join(" ") ?? null;
}

function renderEnglishApproval(result: TelegramForensicResultV1): string {
  const approval = result.approval;
  const assessment = result.assessment?.kind === "wallet_safety" ? result.assessment : null;
  if (!approval) return renderEnglishTechnical(result);
  const state = approval.allowanceState === "confirmed_zero" ? "0 USDT, confirmed directly through the official USDT contract"
    : approval.allowanceState === "confirmed_active" && approval.confirmedAllowanceRaw !== null ? `${approval.isUnlimited ? "active and unlimited" : `active for ${formatRaw(approval.confirmedAllowanceRaw, "en")} USDT`}, confirmed directly through the official USDT contract`
      : "could not be confirmed and must not be described as active or revoked";
  const debit = approval.debitState === "confirmed" && approval.debitAmountRaw !== null
    ? `A transfer through this contract was confirmed: ${formatRaw(approval.debitAmountRaw, "en")} USDT.`
    : approval.debitState === "not_found" ? "No transfer through this contract was found." : "A current transfer through this contract could not be confirmed.";
  const action = !assessment || assessment.score === null
    ? "Confirm the current USDT access directly through the official USDT contract."
    : approval.allowanceState === "confirmed_zero"
      ? "No action is required because current USDT access is zero."
      : approval.audienceContext === "watched_wallet"
        ? "If this is your wallet, remove unused USDT access before adding funds."
        : "If you are checking someone else's wallet, do not send funds until the owner explains and removes dangerous USDT access.";
  const lines = [
    englishTitle(result),
    `Checked wallet — wallet that granted USDT access: ${linked(approval.owner)}`,
    `Contract that received USDT access: ${linked(approval.spender)}`,
    `Current USDT access: ${state}.`,
    debit,
    "",
    assessment ? englishRiskHeading(assessment) : "⚪ <b>Current wallet risk was not calculated</b>",
    "",
    "🔎 <b>What was found</b>",
    approval.exactVerify20 ? "The contract has the exact Verify20 mass-transfer pattern." : approval.serviceSession ? "A successful wallet-initiated service action explains the access." : "The current state requires confirmation.",
    "",
    "🧭 <b>What to do</b>",
    action
  ];
  return lines.join("\n");
}

function renderEnglishTechnical(result: TelegramForensicResultV1): string {
  const fact = result.primaryFact ?? result.secondaryFacts[0] ?? null;
  const factCopy = fact ? englishFact(fact) : null;
  const lines = [
    englishTitle(result),
    `Wallet: ${linked(result.checkedWallet)}`,
    "",
    "⚪ <b>Final score was not calculated</b>",
    "",
    "🔎 <b>What happened</b>",
    technicalReasonText(result.technicalLimitTextKey, "en"),
    ...(factCopy ? ["", "<b>Validated context</b>", factCopy] : []),
    ...(result.routes.length ? ["", "💸 <b>Money movement</b>", ...routeLines(result)] : []),
    ...(englishCoverage(result).length ? ["", ...englishCoverage(result)] : [])
  ];
  return lines.join("\n");
}

function renderEnglish(result: TelegramForensicResultV1): string {
  if (result.kind === "approval_safety" && result.approval) return renderEnglishApproval(result);
  const facts = [result.primaryFact, ...result.secondaryFacts].filter((fact): fact is NarrativeFactV2 => Boolean(fact));
  if (result.resultState === "no_final" || result.resultState === "technical_limit" || !result.assessment) return renderEnglishTechnical(result);
  const primary = result.primaryFact;
  const preliminaryReasons = result.kind === "where_preliminary" && primary
    ? preliminaryFactLines(primary, "en")
    : null;
  if (result.kind === "where_preliminary" && !preliminaryReasons) return renderEnglishTechnical(result);
  const factCopy = primary ? englishFact(primary) : facts[0] ? englishFact(facts[0]) : null;
  if (primary && !factCopy) return renderEnglishTechnical(result);
  const action = result.kind === "where_preliminary" ? []
    : result.assessment.kind === "aml_risk" && result.assessment.decision === "DECLINE"
      ? ["", "🧭 <b>What to do</b>", "Do not proceed with the operation."]
      : result.assessment.kind === "aml_risk" && result.assessment.decision === "REVIEW"
        ? ["", "🧭 <b>What to do</b>", "Pause the operation and review the evidence manually."]
        : result.assessment.kind === "contract_risk" && result.assessment.decision === "DECLINE"
          ? ["", "🧭 <b>What to do</b>", "Do not interact with this contract."]
          : result.assessment.kind === "contract_risk" && result.assessment.decision === "REVIEW"
            ? ["", "🧭 <b>What to do</b>", "Review the contract evidence before interacting."]
            : ["", "🧭 <b>Conclusion</b>", "No additional action is required by this check."];
  const lines = [
    englishTitle(result),
    `Wallet: ${linked(result.checkedWallet)}`,
    "",
    result.kind === "where_preliminary" && result.assessment.kind === "aml_risk"
      ? `${result.assessment.indicator} <b>Preliminary risk: ${result.assessment.score}/100</b>`
      : englishRiskHeading(result.assessment),
    "",
    "🔎 <b>Why</b>",
    ...(preliminaryReasons ?? [factCopy ?? "Only validated deterministic context is shown."]),
    ...(result.routes.length ? ["", "💸 <b>Money movement</b>", ...routeLines(result)] : []),
    ...(englishCoverage(result).length ? ["", ...englishCoverage(result)] : []),
    ...action
  ];
  return lines.join("\n");
}

export function renderTelegramForensicResult(result: TelegramForensicResultV1): string {
  if (result.version !== "telegram-forensic-result-v1") throw new Error("unsupported_telegram_forensic_result");
  if (result.locale === "en") return safeTruncateHtml(renderEnglish(result));
  if (result.kind === "approval_safety" && result.approval) return safeTruncateHtml(renderApproval(result));
  const facts = [result.primaryFact, ...result.secondaryFacts].filter((fact): fact is NarrativeFactV2 => Boolean(fact));
  if (
    result.resultState === "no_final" && !result.assessment && !result.primaryFact?.isScoreDriver &&
    facts.some((fact) => fact.factTextKey === "true_no_principal_activity")
  ) {
    return safeTruncateHtml(renderNoActivity(result));
  }
  if (result.technicalLimitTextKey || result.resultState === "technical_limit" || result.resultState === "no_final" || !result.assessment) {
    return safeTruncateHtml(renderTechnical(result));
  }
  if (result.kind === "contract_safety") return safeTruncateHtml(renderContract(result));
  if (result.kind === "where_preliminary") return safeTruncateHtml(renderWherePreliminary(result));
  return safeTruncateHtml(renderFinalAml(result));
}
