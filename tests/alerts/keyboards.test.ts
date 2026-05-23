import { describe, expect, it } from "vitest";
import { approvalAlertKeyboard } from "../../src/alerts/approvalKeyboards";
import { tronscanAddressUrl, tronscanTransactionUrl, userIncomingAlertKeyboard } from "../../src/alerts/keyboards";

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

  it("builds approval guard alert actions for TronScan links", () => {
    const keyboard = approvalAlertKeyboard({
      txHash: "a".repeat(64),
      spender: "TSpender11111111111111111111111111111",
      wallet: "TWallet111111111111111111111111111111"
    });

    expect(keyboard.inline_keyboard[0][0]).toMatchObject({
      text: "Open approval tx",
      url: tronscanTransactionUrl("a".repeat(64))
    });
    expect(keyboard.inline_keyboard[1][0]).toMatchObject({
      text: "Open spender",
      url: tronscanAddressUrl("TSpender11111111111111111111111111111")
    });
    expect(keyboard.inline_keyboard[1][1]).toMatchObject({
      text: "Open wallet",
      url: tronscanAddressUrl("TWallet111111111111111111111111111111")
    });
  });
});
