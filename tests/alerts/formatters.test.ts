import { describe, expect, it } from "vitest";
import { formatAdminSuspiciousAlert, formatUserIncomingAlert } from "../../src/alerts/formatters";

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
});
