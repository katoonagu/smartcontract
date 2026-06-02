import { describe, expect, it } from "vitest";
import { approvalAlertKeyboard } from "../../src/alerts/approvalKeyboards";
import { tronscanAddressUrl, tronscanApprovalsUrl, tronscanTransactionUrl, userIncomingAlertKeyboard, userIncomingDepositRiskKeyboard } from "../../src/alerts/keyboards";

describe("alert keyboards", () => {
  it("builds incoming alert actions for sender checks and TronScan links", () => {
    const keyboard = userIncomingAlertKeyboard({
      sender: "TSender111111111111111111111111111111",
      txHash: "a".repeat(64)
    });

    const markup = keyboard.inline_keyboard;
    expect(markup[0][0]).toMatchObject({
      text: "🔍 Check sender",
      callback_data: "check:addr:TSender111111111111111111111111111111"
    });
    expect(markup[1][0]).toMatchObject({
      text: "🔗 Open tx",
      url: tronscanTransactionUrl("a".repeat(64))
    });
    expect(markup[1][1]).toMatchObject({
      text: "👤 Open sender",
      url: tronscanAddressUrl("TSender111111111111111111111111111111")
    });
  });

  it("uses deposit job id for contextual incoming deposit actions", () => {
    const keyboard = userIncomingDepositRiskKeyboard({
      jobId: "42a0a912-dc6a-45b5-b281-a2f0c7ac034e",
      sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      txHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b"
    });

    expect(JSON.stringify(keyboard.inline_keyboard)).toContain("check:deposit:42a0a912-dc6a-45b5-b281-a2f0c7ac034e");
    expect(keyboard.inline_keyboard[1][0]).toMatchObject({
      text: "🔗 Open tx",
      url: tronscanTransactionUrl("48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b")
    });
    expect(keyboard.inline_keyboard[1][1]).toMatchObject({
      text: "👤 Open sender",
      url: tronscanAddressUrl("TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs")
    });
  });

  it("builds approval guard alert actions for TronScan links", () => {
    const keyboard = approvalAlertKeyboard({
      txHash: "a".repeat(64),
      spender: "TSpender11111111111111111111111111111",
      wallet: "TWallet111111111111111111111111111111"
    });

    expect(keyboard.inline_keyboard[0][0]).toMatchObject({
      text: "Open approvals / revoke",
      url: tronscanApprovalsUrl("TWallet111111111111111111111111111111")
    });
    expect(keyboard.inline_keyboard[1][0]).toMatchObject({
      text: "Approval tx",
      url: tronscanTransactionUrl("a".repeat(64))
    });
    expect(keyboard.inline_keyboard[2][0]).toMatchObject({
      text: "Open spender",
      url: tronscanAddressUrl("TSpender11111111111111111111111111111")
    });
    expect(keyboard.inline_keyboard[2][1]).toMatchObject({
      text: "Open wallet",
      url: tronscanAddressUrl("TWallet111111111111111111111111111111")
    });
  });

  it("localizes approval guard alert actions in Russian", () => {
    const keyboard = approvalAlertKeyboard({
      txHash: "a".repeat(64),
      spender: "TSpender11111111111111111111111111111",
      wallet: "TWallet111111111111111111111111111111",
      locale: "ru"
    });

    expect(keyboard.inline_keyboard[0][0]).toMatchObject({
      text: "Открыть approvals / revoke",
      url: tronscanApprovalsUrl("TWallet111111111111111111111111111111")
    });
    expect(keyboard.inline_keyboard[2][1]).toMatchObject({
      text: "Открыть кошелёк",
      url: tronscanAddressUrl("TWallet111111111111111111111111111111")
    });
  });
});
