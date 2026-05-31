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
    expect(displayDecisionFromRiskScore(59)).toBe("ACCEPTABLE");
    expect(displayDecisionFromRiskScore(60)).toBe("DECLINE");
  });

  it("formats checked-origin coverage for users", () => {
    expect(checkedOriginLabel(1, "ru")).toBe("Проверено происхождение: 100% суммы");
    expect(checkedOriginLabel(0.76, "en")).toBe("Checked origin: 76% of amount");
  });

  it("translates operational sender role", () => {
    expect(senderRoleText("operational_liquidity_wallet", "ru")).toBe("рабочий ликвидный кошелёк");
    expect(senderRoleText("operational_liquidity_wallet", "en")).toBe("operational liquidity wallet");
  });

  it("normalizes common internal reason text", () => {
    expect(normalizeNotificationReason("clean_source_not_fully_proven", "ru")).toBe("Чистый источник денег доказан не полностью, поэтому риск не нулевой.");
    expect(normalizeNotificationReason("15% checked funds came from HTX", "ru")).toBe("15% проверенной суммы пришло от HTX.");
    expect(normalizeNotificationReason("manual review required", "en")).toBe("Additional context was found, but no exact bad evidence was proven.");
  });
});
