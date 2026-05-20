import { describe, expect, it } from "vitest";
import { TELEGRAM_MESSAGE_LIMIT, formatAdminSuspiciousAlert, formatUserIncomingAlert } from "../../src/alerts/formatters";

const report = {
  subjectAddress: "TSender111111111111111111111111111111",
  level: "HIGH" as const,
  score: 82,
  reasons: [
    { code: "split_pattern", message: "Repeated split transfers detected", scoreImpact: 30 },
    { code: "risky_1_hop", message: "1-hop connection to risky address", scoreImpact: 35 }
  ]
};

describe("alert formatters", () => {
  it("formats user incoming alert with score and reasons", () => {
    const text = formatUserIncomingAlert({
      amount: "12450",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report
    });

    expect(text).toContain("Incoming USDT: 12450");
    expect(text).toContain("Risk: HIGH - 82/100");
    expect(text).toContain("Repeated split transfers detected");
  });

  it("formats admin alert with Telegram owner identity", () => {
    const text = formatAdminSuspiciousAlert({
      telegramUserId: "123456789",
      telegramUsername: "client_user",
      watchedWallet: "TWallet111111111111111111111111111111",
      amount: "12450",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report
    });

    expect(text).toContain("User: @client_user - tg_id: 123456789");
    expect(text).toContain("Watched wallet: TWallet111111111111111111111111111111");
  });

  it("formats admin alert without username", () => {
    const text = formatAdminSuspiciousAlert({
      telegramUserId: "123456789",
      telegramUsername: null,
      watchedWallet: "TWallet111111111111111111111111111111",
      amount: "12450",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report
    });

    expect(text).toContain("User: tg_id: 123456789");
  });

  it("formats empty reasons with a safe fallback", () => {
    const text = formatUserIncomingAlert({
      amount: "12450",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report: { ...report, reasons: [] }
    });

    expect(text).toContain("- no obvious risk signals found");
  });

  it("normalizes newlines and control characters in user-controlled fields", () => {
    const text = formatUserIncomingAlert({
      amount: "12450\nRisk: LOW",
      sender: "TSender\nTx: fake",
      txHash: "abc123\r\nInjected: yes",
      report: {
        ...report,
        reasons: [{ code: "provider", message: "Line one\nRisk: LOW\t\u0000", scoreImpact: 10 }]
      }
    });

    expect(text).toContain("Incoming USDT: 12450 Risk: LOW");
    expect(text).toContain("From: TSender Tx: fake");
    expect(text).toContain("- Line one Risk: LOW");
    expect(text).not.toContain("\r");
    expect(text).not.toContain("\u0000");
  });

  it("limits visible reasons and keeps messages below Telegram hard limit", () => {
    const manyReasons = Array.from({ length: 40 }, (_, index) => ({
      code: `reason_${index}`,
      message: `Very long provider reason ${index} ${"x".repeat(500)}`,
      scoreImpact: 1
    }));

    const text = formatAdminSuspiciousAlert({
      telegramUserId: "123456789",
      telegramUsername: "client_user",
      watchedWallet: "TWallet111111111111111111111111111111",
      amount: "12450",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report: { ...report, reasons: manyReasons }
    });

    expect(text).toContain("...and 32 more");
    expect(text.length).toBeLessThan(TELEGRAM_MESSAGE_LIMIT);
  });
});
