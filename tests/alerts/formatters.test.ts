import { describe, expect, it } from "vitest";
import {
  TELEGRAM_MESSAGE_LIMIT,
  formatAdminApprovalAlert,
  formatAdminSuspiciousAlert,
  formatDigestAlert,
  formatUserApprovalAlert,
  formatUserApprovalContextResultAlert,
  formatUserApprovalPendingAlert,
  formatUserIncomingAlert
} from "../../src/alerts/formatters";
import { escapeHtml, formatRiskLine } from "../../src/alerts/telegramHtml";

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
  it("formats user incoming alert with score, HTML parse mode, and reasons", () => {
    const message = formatUserIncomingAlert({
      amount: "12450",
      watchedWallet: "TWallet111111111111111111111111111111",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("<b>Incoming USDT</b>");
    expect(message.text).toContain("<b>Watched wallet</b>: <code>TWallet111111111111111111111111111111</code>");
    expect(message.text).toContain("<b>High risk</b>");
    expect(message.text).toContain("<code>82/100</code>");
    expect(message.text).toContain("Repeated split transfers detected");
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
    }).text;

    expect(text).toContain("<b>User</b>: @client_user - tg_id: <code>123456789</code>");
    expect(text).toContain("<b>Watched wallet</b>: <code>TWallet111111111111111111111111111111</code>");
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
    }).text;

    expect(text).toContain("<b>User</b>: tg_id: <code>123456789</code>");
  });

  it("formats read-only approval guard alerts", () => {
    const message = formatUserApprovalAlert({
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

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("Approval Guard");
    expect(message.text).toContain("<b>Spender</b>: <code>TSpender11111111111111111111111111111</code>");
    expect(message.text).toContain("<b>Identity</b>: <code>unknown</code>");
    expect(message.text).toContain("<b>Type</b>: wallet (EOA, not smart contract)");
    expect(message.text).toContain("<b>Allowance</b>: <code>unlimited</code>");
    expect(message.text).toContain("<b>On-chain</b>: <code>2026-05-06T19:06:15Z</code>");
    expect(message.text).toContain("<b>Signed</b>: <code>2026-05-04T15:06:28.559Z</code>");
    expect(message.text).toContain("<b>Expires</b>: <code>2026-05-06T21:07:27Z</code>");
    expect(message.text).toContain("<b>High risk</b>");
    expect(message.text).toContain("<code>82/100</code>");
    expect(message.text).toContain("This is not proof of theft");
    expect(message.text).toContain("Read-only");
    expect(message.text).toContain("bot never signs transactions");
    expect(message.text).toContain("Connect TronLink with this exact wallet");
  });

  it("formats service-linked approval guard alerts with route context", () => {
    const text = formatUserApprovalAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "contract",
      spenderIdentity: "tokenApprove",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalTxHash: "approval-tx",
      report: {
        ...report,
        level: "MEDIUM",
        score: 35,
        reasons: [
          {
            code: "approval_temporally_linked_to_known_swap",
            message: "Approval appears linked to a nearby swap/bridge route through service or adapter infrastructure",
            scoreImpact: -35
          }
        ]
      }
    }).text;

    expect(text).toContain("This approval appears connected to a swap/bridge route");
    expect(text).toContain("Review/revoke if unexpected or no longer needed.");
  });

  it("formats pending approval context alerts", () => {
    const message = formatUserApprovalPendingAlert({
      watchedWallet: "TWallet<owner>",
      token: "USDT",
      spender: "TSpender&helper",
      spenderType: "contract",
      spenderIdentity: "tokenApprove",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalAt: new Date("2026-05-05T13:42:21.000Z"),
      contextDeadlineAt: new Date("2026-05-05T13:52:21.000Z"),
      approvalTxHash: "approval-tx",
      report: {
        ...report,
        level: "HIGH",
        score: 70,
        reasons: [{ code: "approval_context_pending", message: "Waiting for route context <pending>", scoreImpact: 10 }]
      }
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("pending context");
    expect(message.text).toContain("⏳ 🟠 <b>Risk</b>");
    expect(message.text).toContain("Waiting up to 10 min for related swap/bridge route context");
    expect(message.text).toContain("This is not proof of theft yet");
    expect(message.text).toContain("<code>TWallet&lt;owner&gt;</code>");
    expect(message.text).toContain("<code>TSpender&amp;helper</code>");
    expect(message.text).toContain("Waiting for route context &lt;pending&gt;");
  });

  it("formats approval context result follow-up alerts", () => {
    const message = formatUserApprovalContextResultAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "contract",
      spenderIdentity: "tokenApprove",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalAt: new Date("2026-05-05T13:42:21.000Z"),
      approvalTxHash: "approval-tx",
      initialReport: {
        ...report,
        level: "HIGH",
        score: 70,
        reasons: [{ code: "approval_context_pending", message: "Pending route context", scoreImpact: 10 }]
      },
      finalReport: {
        ...report,
        level: "MEDIUM",
        score: 35,
        reasons: [
          {
            code: "approval_temporally_linked_to_known_swap",
            message: "Linked to nearby Bridgers/SunSwap route",
            scoreImpact: -35
          }
        ]
      },
      result: "linked_swap_route",
      linkedRouteTxHash: "route-tx",
      routeServiceTags: ["Bridgers", "SunSwap"]
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("Approval Guard result");
    expect(message.text).toContain("Initial status was");
    expect(message.text).toContain("🟡 <b>Risk</b>");
    expect(message.text).toContain("⏳ 🟠 HIGH review, pending context");
    expect(message.text).toContain("HIGH review, pending context");
    expect(message.text).toContain("linked to Bridgers / SunSwap");
    expect(message.text).toContain("<code>35/100</code>");
    expect(message.text).toContain("Review/revoke if unexpected or no longer needed");
    expect(message.text).toContain("<b>Linked route tx</b>: <code>route-tx</code>");
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
    }).text;

    expect(text).toContain("<b>Allowance</b>: <code>finite 111,111 USDT</code>");
    expect(text).toContain("<b>Identity</b>: <code>Bridgers</code>");
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
    }).text;

    expect(text).toContain("HIGH approval event");
    expect(text).toContain("<b>User</b>: @client_user - tg_id: <code>123456789</code>");
    expect(text).toContain("Spender type");
    expect(text).toContain("<b>Approval tx</b>: <code>approval-tx</code>");
  });

  it("formats empty reasons with a safe fallback", () => {
    const text = formatUserIncomingAlert({
      amount: "12450",
      watchedWallet: "TWallet111111111111111111111111111111",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report: { ...report, reasons: [] }
    }).text;

    expect(text).toContain("• no obvious risk signals found");
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
    }).text;

    expect(text).toContain("<b>Amount</b>: <code>12450 Risk: LOW USDT</code>");
    expect(text).toContain("<b>Watched wallet</b>: <code>TWallet Injected: no</code>");
    expect(text).toContain("<b>From</b>: <code>TSender Tx: fake</code>");
    expect(text).toContain("• Line one Risk: LOW");
    expect(text).not.toContain("\r");
    expect(text).not.toContain("\u0000");
  });

  it("escapes HTML in dynamic fields", () => {
    const text = formatUserIncomingAlert({
      amount: "1 < 2 & ok",
      watchedWallet: "TWallet<bad>",
      sender: "TSender&bad",
      txHash: "tx\"quote'",
      report: {
        ...report,
        reasons: [{ code: "html", message: "Reason <script> & \"quote\"", scoreImpact: 1 }]
      }
    }).text;

    expect(text).toContain("1 &lt; 2 &amp; ok USDT");
    expect(text).toContain("TWallet&lt;bad&gt;");
    expect(text).toContain("TSender&amp;bad");
    expect(text).toContain("tx&quot;quote&#39;");
    expect(text).toContain("Reason &lt;script&gt; &amp; &quot;quote&quot;");
    expect(text).not.toContain("<script>");
  });

  it("formats risk lines by level", () => {
    expect(formatRiskLine({ ...report, level: "LOW", score: 0 })).toContain("🟢 <b>Low risk</b>");
    expect(formatRiskLine({ ...report, level: "MEDIUM", score: 35 })).toContain("🟡 <b>Medium risk</b>");
    expect(formatRiskLine({ ...report, level: "HIGH", score: 80 })).toContain("🟠 <b>High risk</b>");
    expect(formatRiskLine({ ...report, level: "CRITICAL", score: 95 })).toContain("🔴 <b>Critical risk</b>");
  });

  it("exports a reusable HTML escaper", () => {
    expect(escapeHtml("<>&\"'")).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("formats digest alerts with risky summary", () => {
    const message = formatDigestAlert({
      walletAddress: "TWallet111111111111111111111111111111",
      intervalMinutes: 10,
      transactionCount: 23,
      totalUsdt: "81 240",
      uniqueSenderCount: 19,
      riskyTransactionCount: 1,
      riskySenderCount: 1,
      topRisky: { level: "HIGH", score: 80, sender: "TRisky111111111111111111111111111111" }
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("<b>USDT digest</b>");
    expect(message.text).toContain("<b>Incoming</b>: <code>23 tx</code>");
    expect(message.text).toContain("<b>Total</b>: <code>81 240 USDT</code>");
    expect(message.text).toContain("<b>Risky</b>: <code>1 tx / 1 sender</code>");
    expect(message.text).toContain("High-risk tx were alerted immediately");
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
    }).text;

    expect(text).toContain("...and 32 more");
    expect(text.length).toBeLessThan(TELEGRAM_MESSAGE_LIMIT);
    expect(text).not.toContain("<code>Very long");
  });
});
