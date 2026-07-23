import { describe, expect, it } from "vitest";
import {
  canonicalizeJson,
  fingerprintCanonicalJson
} from "../../src/forensics/telegramDelivery";

describe("canonical JSON compatibility", () => {
  const value = {
    chatId: "1",
    text: "Привет",
    parseMode: "HTML",
    replyMarkup: { inline_keyboard: [[{ text: "A", callback_data: "a" }]] }
  };

  it("preserves the legacy fingerprint fixture", () => {
    expect(fingerprintCanonicalJson(value)).toBe(
      "94e9611fddacf85f3392ade81e5f0a672a20d230220b034125b86d535617ec80"
    );
  });

  it("sorts object keys without sorting arrays", () => {
    const reordered = {
      replyMarkup: { inline_keyboard: [[{ callback_data: "a", text: "A" }]] },
      parseMode: "HTML",
      text: "Привет",
      chatId: "1"
    };
    expect(canonicalizeJson(reordered)).toBe(canonicalizeJson(value));
    expect(fingerprintCanonicalJson(reordered)).toBe(fingerprintCanonicalJson(value));
    expect(fingerprintCanonicalJson({ items: ["a", "b"] }))
      .not.toBe(fingerprintCanonicalJson({ items: ["b", "a"] }));
  });
});
