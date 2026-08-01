import { describe, expect, it } from "vitest";
import {
  checkedOriginLabel,
  decisionLabel,
  displayDecisionFromRiskScore,
  normalizeNotificationReason,
  riskObjectLabel,
  senderRoleText
} from "../../src/alerts/notificationText";

describe("notification text helpers", () => {
  it("localizes decision and risk object labels", () => {
    expect(decisionLabel("ru")).toBe("Решение");
    expect(decisionLabel("en")).toBe("Decision");
    expect(riskObjectLabel("deposit", "ru")).toBe("Риск депозита");
    expect(riskObjectLabel("tx", "en")).toBe("Tx risk");
    expect(displayDecisionFromRiskScore(44)).toBe("ACCEPTABLE");
    expect(displayDecisionFromRiskScore(45)).toBe("REVIEW");
    expect(displayDecisionFromRiskScore(59)).toBe("REVIEW");
    expect(displayDecisionFromRiskScore(60)).toBe("DECLINE");
  });

  it("declines non-finite risk scores", () => {
    expect(displayDecisionFromRiskScore(Number.NaN)).toBe("DECLINE");
    expect(displayDecisionFromRiskScore(Number.POSITIVE_INFINITY)).toBe("DECLINE");
    expect(displayDecisionFromRiskScore(Number.NEGATIVE_INFINITY)).toBe("DECLINE");
  });

  it("formats checked-origin coverage for users", () => {
    expect(checkedOriginLabel(1, "ru")).toBe("Проверено происхождение: 100% суммы");
    expect(checkedOriginLabel(0.76, "en")).toBe("Checked origin: 76% of amount");
  });

  it("translates operational sender role", () => {
    expect(senderRoleText("operational_liquidity_wallet", "ru")).toBe("рабочий ликвидный кошелёк");
    expect(senderRoleText("operational_liquidity_wallet", "en")).toBe("operational liquidity wallet");
  });

  it("translates partial CEX sender context before broad clean CEX roles", () => {
    expect(senderRoleText("partial_cex_context_wallet", "ru")).toBe("есть частичный маршрут к CEX");
    expect(senderRoleText("partial_cex_context_wallet", "en")).toBe("partial CEX route context");
    expect(senderRoleText("partial_cex_context_wallet_clean_cex", "en")).toBe("partial CEX route context");
  });

  it("normalizes common internal reason text", () => {
    expect(normalizeNotificationReason("clean_source_not_fully_proven", "ru")).toBe("Чистый источник денег доказан не полностью, поэтому риск не нулевой.");
    expect(normalizeNotificationReason("15% checked funds came from HTX", "ru")).toBe("15% проверенной суммы пришло от HTX.");
    expect(normalizeNotificationReason("Найдена связь с санкционной биржей/криптосервисом EXMO: доля 15% проверяемого происхождения; орган: UK; дата включения: 2026-05-26. Решение по политике: DECLINE; это санкционный/source-policy risk, не доказательство scam/drain. EN: Balance-forming path reaches sanctioned crypto service EXMO (15% of selected provenance target); designated by UK on 2026-05-26. This is sanctions/source-policy risk, not direct scam or approval-drain proof.", "ru")).toBe("Найдена связь с санкционной биржей/криптосервисом EXMO: доля 15%, UK, дата включения 2026-05-26. Это санкционный policy-риск; это не доказательство scam/drain.");
    expect(normalizeNotificationReason("EDD_SOF", "ru")).toBe("Нужна расширенная проверка источника средств (EDD/SOF): запросить подтверждение происхождения денег перед решением.");
    expect(normalizeNotificationReason("EDD_SOF", "en")).toBe("Enhanced due diligence is required: request source-of-funds evidence before deciding.");
    expect(normalizeNotificationReason("service_boundary_reached", "ru")).toBe("Маршрут дошёл до сервисной границы. Через биржу/сервис нельзя надёжно продолжать on-chain трассировку.");
    expect(normalizeNotificationReason("provider_cap_unresolved", "ru")).toBe("Проверка уперлась в лимит данных провайдера; финальный риск нельзя считать полностью доказанным.");
    expect(normalizeNotificationReason("manual review required", "en")).toBe("Additional context was found, but no exact bad evidence was proven.");
    expect(normalizeNotificationReason("Balance-forming path reaches service boundary bridge; manual review required.", "en")).not.toContain("manual review required");
    expect(normalizeNotificationReason("Balance-forming path reaches service boundary bridge; manual review required.", "ru")).not.toContain("manual review required");
  });

  it("normalizes local Incoming coverage failures", () => {
    expect(normalizeNotificationReason("local_budget_limited", "ru")).toBe(
      "Достигнут локальный лимит чтения истории; итоговый риск не опубликован."
    );
    expect(normalizeNotificationReason("local_budget_limited", "en")).toBe(
      "The local history read limit was reached; no final risk score was published."
    );
    expect(normalizeNotificationReason("local_index_read_failed", "ru")).toBe(
      "Локальную индексированную историю не удалось прочитать; итоговый риск не опубликован."
    );
    expect(normalizeNotificationReason("local_index_read_failed", "en")).toBe(
      "The local indexed history could not be read; no final risk score was published."
    );
    expect(normalizeNotificationReason("local_data_error", "ru")).toBe(
      "Локальные данные происхождения средств временно недоступны."
    );
    expect(normalizeNotificationReason("local_data_error", "en")).toBe(
      "Local provenance data is temporarily unavailable."
    );
  });

  it("normalizes approval-drain evidence for Russian user text", () => {
    expect(normalizeNotificationReason("Exact approval-drain provenance reaches checked wallet via 0 hop(s).", "ru")).toBe(
      "Найдена точная approval-drain цепочка: после approve USDT были списаны через transferFrom, а проверяемый адрес стал первым получателем средств."
    );
    expect(normalizeNotificationReason("Derived high-risk marker: exact upstream approval-drain provenance linked to this address.", "ru")).toBe(
      "По адресу есть сохранённое exact approval-drain доказательство: ранее система находила цепочку approve → transferFrom → получатель средств."
    );
  });

  it("normalizes incoming deposit coverage and exposure reasons for Russian user text", () => {
    expect(normalizeNotificationReason(
      "Final incoming-deposit scoring is blocked until mandatory hop history is covered: partial_budget_exhausted.",
      "ru"
    )).toBe(
      "Финальный вывод по депозиту пока заблокирован: нужно покрыть обязательную историю одного из hop-адресов. Проверка уперлась в локальный бюджет загрузки истории; финальный вывод требует догрузки данных."
    );
    expect(normalizeNotificationReason(
      "Observed unknown source paths account for 100% of checked-deposit source share.",
      "ru"
    )).toBe("100% проверенного источника депозита осталось в неизвестных ветках происхождения.");
    expect(normalizeNotificationReason(
      "Sender history includes unknown counterparty volume at 88% of total sender-related volume.",
      "ru"
    )).toBe("В истории отправителя 88% связанного объёма приходится на неизвестных контрагентов.");
    expect(normalizeNotificationReason(
      "Sender has both incoming and outgoing volume inside the exposure window.",
      "ru"
    )).toBe("У отправителя были и входящие, и исходящие переводы внутри окна анализа: это похоже на рабочий/ликвидный транзитный кошелёк.");
  });

  it("normalizes common contract verdict reasons for Russian user text", () => {
    expect(normalizeNotificationReason(
      "Exact approval-drain profile with transferFrom root evidence from victim to spender contract.",
      "ru"
    )).toBe("Найден точный approval-drain профиль: после approve контракт списал USDT через transferFrom у исходного владельца.");
    expect(normalizeNotificationReason(
      "Unknown contract funded sender shortly before deposit.",
      "ru"
    )).toBe("Отправитель получил средства от неизвестного смарт-контракта незадолго до депозита.");
  });

  it("normalizes clean CEX and source-boundary caveats", () => {
    expect(normalizeNotificationReason("Clean CEX origin is not fully proven; wallet looks like an operational/liquidity wallet and no hard bad evidence was found.", "ru")).toBe(
      "Чистый CEX-источник не доказан полностью. Кошелёк похож на операционный или ликвидный, жёстких плохих доказательств нет."
    );
    expect(normalizeNotificationReason("The graph stopped before resolving a material unknown source boundary.", "ru")).toBe(
      "Граф остановился на существенной неизвестной границе источника."
    );
  });

  it("leaves positive clean-source text unchanged", () => {
    expect(normalizeNotificationReason("clean source proven, not suspicious", "en")).toBe("clean source proven, not suspicious");
  });
});
