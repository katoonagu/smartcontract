import { describe, expect, it } from "vitest";
import {
  TELEGRAM_MESSAGE_LIMIT,
  formatAdminApprovalAlert,
  formatAdminSuspiciousAlert,
  formatUserApprovalAlert,
  formatUserIncomingAlert
} from "../../src/alerts/formatters";

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
      watchedWallet: "TWallet111111111111111111111111111111",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report
    });

    expect(text).toContain("Incoming USDT: 12450");
    expect(text).toContain("Watched wallet: TWallet111111111111111111111111111111");
    expect(text).toContain("Risk score: 82/100 (HIGH)");
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

  it("formats read-only approval guard alerts", () => {
    const text = formatUserApprovalAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "eoa",
      spenderIdentity: "unknown",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalAt: new Date("2026-05-06T19:06:15.000Z"),
      signedAt: new Date("2026-05-04T15:06:28.559Z"),
      expirationAt: new Date("2026-05-06T21:07:27.000Z"),
      approvalTxHash: "approval-tx",
      report
    });

    expect(text).toContain("Approval Guard");
    expect(text).toContain("Spender: TSpender11111111111111111111111111111");
    expect(text).toContain("Identity: unknown");
    expect(text).toContain("Spender type: wallet (EOA, not smart contract)");
    expect(text).toContain("Allowance: unlimited");
    expect(text).toContain("On-chain time: 2026-05-06T19:06:15Z");
    expect(text).toContain("Signed time: 2026-05-04T15:06:28.559Z");
    expect(text).toContain("Expiration: 2026-05-06T21:07:27Z");
    expect(text).toContain("Risk score: 82/100 (HIGH)");
    expect(text).toContain("This is not proof of theft");
    expect(text).toContain("Read-only alert");
    expect(text).toContain("The bot never signs transactions and never asks for seed/private key");
    expect(text).toContain("To revoke: open TronScan approvals, connect TronLink with this exact wallet, find USDT approval for this spender, and cancel it.");
  });

  it("formats finite approval allowance as decoded USDT", () => {
    const text = formatUserApprovalAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "eoa",
      spenderIdentity: "Bridgers",
      allowanceType: "finite",
      allowanceAmount: "111,111 USDT",
      approvalTxHash: "approval-tx",
      report
    });

    expect(text).toContain("Allowance: finite 111,111 USDT");
    expect(text).toContain("Identity: Bridgers");
  });

  it("formats service-admin approval alerts", () => {
    const text = formatAdminApprovalAlert({
      telegramUserId: "123456789",
      telegramUsername: "client_user",
      watchedWallet: "TWallet111111111111111111111111111111",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "eoa",
      spenderIdentity: "unknown",
      approvalTxHash: "approval-tx",
      report
    });

    expect(text).toContain("HIGH approval event");
    expect(text).toContain("User: @client_user - tg_id: 123456789");
    expect(text).toContain("Spender type: wallet (EOA, not smart contract)");
    expect(text).toContain("Approval tx: approval-tx");
  });

  it("formats empty reasons with a safe fallback", () => {
    const text = formatUserIncomingAlert({
      amount: "12450",
      watchedWallet: "TWallet111111111111111111111111111111",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report: { ...report, reasons: [] }
    });

    expect(text).toContain("- no obvious risk signals found");
  });

  it("normalizes newlines and control characters in user-controlled fields", () => {
    const text = formatUserIncomingAlert({
      amount: "12450\nRisk: LOW",
      watchedWallet: "TWallet\nInjected: no",
      sender: "TSender\nTx: fake",
      txHash: "abc123\r\nInjected: yes",
      report: {
        ...report,
        reasons: [{ code: "provider", message: "Line one\nRisk: LOW\t\u0000", scoreImpact: 10 }]
      }
    });

    expect(text).toContain("Incoming USDT: 12450 Risk: LOW");
    expect(text).toContain("Watched wallet: TWallet Injected: no");
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
