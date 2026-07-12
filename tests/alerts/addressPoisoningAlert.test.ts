import { describe, expect, it } from "vitest";
import {
  ADDRESS_POISONING_ALERT_FORMAT_VERSION,
  addressPoisoningAlertFingerprint,
  addressPoisoningAlertKeyboard,
  formatAddressPoisoningAlert
} from "../../src/alerts/addressPoisoningAlert";
import { tronscanTransactionUrl } from "../../src/alerts/keyboards";
import type { AddressPoisoningCandidateDelivery } from "../../src/types";
import { THJ_POISONING_CASE } from "../fixtures/monitor/addressPoisoningCases";

const CALLBACK_TOKEN = "AbCdEf0123_-xyZ9";

function candidate(overrides: Partial<AddressPoisoningCandidateDelivery> = {}): AddressPoisoningCandidateDelivery {
  return {
    id: "candidate-1",
    callbackToken: CALLBACK_TOKEN,
    watchedWalletId: "wallet-1",
    walletAddress: THJ_POISONING_CASE.watchedWallet,
    telegramUserId: "42",
    locale: "ru",
    alertMode: "realtime",
    tokenContract: THJ_POISONING_CASE.tokenContract,
    tokenSymbol: "USDT",
    tokenDecimals: THJ_POISONING_CASE.tokenDecimals,
    suspiciousIncomingTxHash: THJ_POISONING_CASE.incomingTxHash,
    suspiciousSender: THJ_POISONING_CASE.lookalike,
    suspiciousAmountRaw: THJ_POISONING_CASE.amountRaw,
    suspiciousIncomingAt: THJ_POISONING_CASE.incomingAt,
    matchedOutgoingTxHash: THJ_POISONING_CASE.outgoingTxHash,
    genuineRecipient: THJ_POISONING_CASE.realRecipient,
    matchedOutgoingAmountRaw: THJ_POISONING_CASE.amountRaw,
    matchedOutgoingAt: THJ_POISONING_CASE.outgoingAt,
    rawPrefixLength: 1,
    meaningfulPrefixLength: 0,
    suffixLength: 6,
    classification: "CRITICAL",
    confidence: "high",
    rawEvidenceId: "evidence-1",
    secondaryMatches: [],
    evidenceJson: {
      policyVersion: "address-poisoning-v1",
      coverage: "complete",
      windowStart: "2026-06-30T12:47:42.000Z",
      windowEnd: "2026-07-01T12:47:41.999Z",
      fetchedCount: 37,
      pageCount: 1,
      logicalOffset: 37
    },
    status: "candidate",
    alertFingerprint: "provisional-fingerprint",
    alertStatus: "sending",
    alertAttempts: 1,
    alertLeaseUpdatedAt: new Date("2026-07-01T12:47:43.000Z"),
    alertNextRetryAt: null,
    alertLastError: null,
    telegramChatId: null,
    telegramMessageId: null,
    laterLossTxHash: null,
    laterLossEvidenceJson: null,
    createdAt: new Date("2026-07-01T12:47:42.100Z"),
    updatedAt: new Date("2026-07-01T12:47:43.000Z"),
    resolvedAt: null,
    alertSentAt: null,
    alertAttempt: 1,
    alertLeaseVersion: new Date("2026-07-01T12:47:43.000Z"),
    ...overrides
  };
}

describe("address poisoning Telegram alert", () => {
  it("renders the exact THJ warning in concise Russian with full escaped addresses", () => {
    const message = formatAddressPoisoningAlert(candidate());

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("🔴 Возможна подмена адреса");
    expect(message.text).toContain(`<code>${THJ_POISONING_CASE.watchedWallet}</code>`);
    expect(message.text).toContain("Пришло 10 USDT от адреса, который не встречался среди переводов за проверенные 24 часа");
    expect(message.text).toContain(`<code>${THJ_POISONING_CASE.lookalike}</code>`);
    expect(message.text).toContain(`<code>${THJ_POISONING_CASE.realRecipient}</code>`);
    expect(message.text).toContain("последние 6 символов");
    expect(message.text).toContain("45 секунд назад");
    expect(message.text).toContain("Не копируйте адрес получателя из истории переводов");
    expect(message.text).toContain("Не переводите деньги, пока не проверите адрес");
    expect(message.text).not.toMatch(/\b(?:AML|score|риск \d|краж[а-я]*)\b/i);
  });

  it("uses a concise English fallback and truthful partial-coverage wording", () => {
    const message = formatAddressPoisoningAlert(candidate({
      locale: "en",
      classification: "HIGH",
      evidenceJson: {
        ...candidate().evidenceJson,
        coverage: "partial",
        fetchedCount: 100
      }
    }));

    expect(message.text).toContain("🟠 Possible address replacement");
    expect(message.text).toContain("the checked part of the last 24 hours of transfer history");
    expect(message.text).not.toContain("not seen in transfers during the checked 24 hours");
    expect(message.text).toContain("Do not copy the recipient address from transaction history");
  });

  it("formats raw bigint token amounts without floating point and uses friendly time plurals", () => {
    const message = formatAddressPoisoningAlert(candidate({
      suspiciousAmountRaw: "9007199254740993123456",
      matchedOutgoingAmountRaw: "9007199254740993123456",
      suspiciousIncomingAt: new Date(THJ_POISONING_CASE.outgoingAt.getTime() + 61_000)
    }));

    expect(message.text).toContain("9 007 199 254 740 993,123456 USDT");
    expect(message.text).toContain("1 минуту назад");
  });

  it("escapes untrusted formatter fields before placing them in HTML", () => {
    const message = formatAddressPoisoningAlert(candidate({
      walletAddress: "TWallet<script>&'\"",
      suspiciousSender: "TSender<script>&'\"",
      genuineRecipient: "TRecipient<script>&'\"",
      tokenSymbol: "<USDT&>"
    }));

    expect(message.text).not.toContain("<script>");
    expect(message.text).toContain("&lt;script&gt;&amp;&#39;&quot;");
    expect(message.text).toContain("&lt;USDT&amp;&gt;");
  });

  it("builds two transaction links and two compact mutation callbacks", () => {
    const keyboard = addressPoisoningAlertKeyboard({
      callbackToken: CALLBACK_TOKEN,
      incomingTxHash: THJ_POISONING_CASE.incomingTxHash,
      outgoingTxHash: THJ_POISONING_CASE.outgoingTxHash
    });
    const buttons = keyboard.inline_keyboard.flat();

    expect(buttons).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "Входящий перевод", url: tronscanTransactionUrl(THJ_POISONING_CASE.incomingTxHash) }),
      expect.objectContaining({ text: "Исходящий перевод", url: tronscanTransactionUrl(THJ_POISONING_CASE.outgoingTxHash) }),
      expect.objectContaining({ text: "Это знакомый адрес", callback_data: `poison:dismiss:${CALLBACK_TOKEN}` }),
      expect.objectContaining({ text: "Пометить как подмену", callback_data: `poison:confirm:${CALLBACK_TOKEN}` })
    ]));
    for (const button of buttons) {
      if ("callback_data" in button && button.callback_data) {
        expect(Buffer.byteLength(button.callback_data, "utf8")).toBeLessThan(64);
      }
    }
  });

  it("keeps only both transaction links for terminal alerts and rejects malformed callback tokens", () => {
    const terminal = addressPoisoningAlertKeyboard({
      callbackToken: CALLBACK_TOKEN,
      incomingTxHash: THJ_POISONING_CASE.incomingTxHash,
      outgoingTxHash: THJ_POISONING_CASE.outgoingTxHash,
      terminal: true
    });
    expect(terminal.inline_keyboard.flat()).toHaveLength(2);
    expect(terminal.inline_keyboard.flat().every((button) => "url" in button)).toBe(true);
    expect(() => addressPoisoningAlertKeyboard({
      callbackToken: "short:unsafe",
      incomingTxHash: THJ_POISONING_CASE.incomingTxHash,
      outgoingTxHash: THJ_POISONING_CASE.outgoingTxHash
    })).toThrow("callback token");
  });

  it("localizes every English keyboard label while preserving URLs and callbacks", () => {
    const keyboard = addressPoisoningAlertKeyboard({
      callbackToken: CALLBACK_TOKEN,
      incomingTxHash: THJ_POISONING_CASE.incomingTxHash,
      outgoingTxHash: THJ_POISONING_CASE.outgoingTxHash,
      locale: "en"
    });
    const buttons = keyboard.inline_keyboard.flat();
    expect(buttons.map((button) => button.text)).toEqual([
      "Incoming transfer",
      "Outgoing transfer",
      "I know this address",
      "Mark as replacement"
    ]);
    expect(buttons.every((button) => !/[А-Яа-яЁё]/.test(button.text))).toBe(true);
    expect(buttons).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: tronscanTransactionUrl(THJ_POISONING_CASE.incomingTxHash) }),
      expect.objectContaining({ url: tronscanTransactionUrl(THJ_POISONING_CASE.outgoingTxHash) }),
      expect.objectContaining({ callback_data: `poison:dismiss:${CALLBACK_TOKEN}` }),
      expect.objectContaining({ callback_data: `poison:confirm:${CALLBACK_TOKEN}` })
    ]));

    const terminal = addressPoisoningAlertKeyboard({
      callbackToken: CALLBACK_TOKEN,
      incomingTxHash: THJ_POISONING_CASE.incomingTxHash,
      outgoingTxHash: THJ_POISONING_CASE.outgoingTxHash,
      terminal: true,
      locale: "en"
    });
    expect(terminal.inline_keyboard.flat().map((button) => button.text))
      .toEqual(["Incoming transfer", "Outgoing transfer"]);
  });

  it("fingerprints the policy, locale, immutable evidence facts, rendered text, and buttons", () => {
    const base = candidate();
    const first = addressPoisoningAlertFingerprint(base);
    const second = addressPoisoningAlertFingerprint({ ...base });

    expect(ADDRESS_POISONING_ALERT_FORMAT_VERSION).toMatch(/^address-poisoning-alert-v\d+$/);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(addressPoisoningAlertFingerprint(candidate({ locale: "en" }))).not.toBe(first);
    expect(addressPoisoningAlertFingerprint(candidate({ suffixLength: 7 }))).not.toBe(first);
    expect(addressPoisoningAlertFingerprint(candidate({ suspiciousAmountRaw: "10000001" }))).not.toBe(first);
    expect(addressPoisoningAlertFingerprint(candidate({
      evidenceJson: { ...base.evidenceJson, coverage: "partial" }
    }))).not.toBe(first);
  });
});
