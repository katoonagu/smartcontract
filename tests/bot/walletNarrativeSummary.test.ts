import { describe, expect, it } from "vitest";
import {
  buildWalletNarrativeCase,
  formatWalletNarrativeSummary,
  selectNarrativeFacts,
  type NarrativeFact,
  type WalletNarrativeCase
} from "../../src/bot/walletNarrativeSummary";

const primaryFact: NarrativeFact = {
  id: "primary",
  kind: "approval_drain",
  factTextRu: "Кошелёк первым получил 3 857 USDT, списанные с двух других адресов.",
  factTextEn: "The wallet was the first recipient of 3,857 USDT taken from two other addresses."
};

function narrativeCase(
  overrides: Partial<WalletNarrativeCase> = {}
): WalletNarrativeCase {
  return buildWalletNarrativeCase({
    locale: "ru",
    decision: "DECLINE",
    score: 95,
    facts: [primaryFact],
    coverageExplanation: null,
    ...overrides
  });
}

describe("formatWalletNarrativeSummary", () => {
  it.each([
    {
      locale: "ru" as const,
      decision: "ACCEPTABLE" as const,
      score: 25,
      expected: [
        "🟢 25/100 — низкий риск. Можно принять.",
        "",
        "Что нашли",
        primaryFact.factTextRu
      ].join("\n")
    },
    {
      locale: "ru" as const,
      decision: "REVIEW" as const,
      score: 45,
      expected: [
        "🟡 45/100 — средний риск. Поставьте операцию на паузу и проверьте вручную.",
        "",
        "Что нашли",
        primaryFact.factTextRu
      ].join("\n")
    },
    {
      locale: "ru" as const,
      decision: "DECLINE" as const,
      score: 78,
      expected: [
        "🟠 78/100 — высокий риск. Операцию не проводить.",
        "",
        "Что нашли",
        primaryFact.factTextRu
      ].join("\n")
    },
    {
      locale: "ru" as const,
      decision: "NO_FINAL_DECISION" as const,
      score: null,
      expected: [
        "⚪ Итог не рассчитан. Поставьте операцию на паузу до повторной проверки.",
        "",
        "Что нашли",
        primaryFact.factTextRu
      ].join("\n")
    },
    {
      locale: "en" as const,
      decision: "ACCEPTABLE" as const,
      score: 25,
      expected: [
        "🟢 25/100 — low risk. You can proceed.",
        "",
        "Finding",
        primaryFact.factTextEn
      ].join("\n")
    },
    {
      locale: "en" as const,
      decision: "REVIEW" as const,
      score: 45,
      expected: [
        "🟡 45/100 — medium risk. Pause the operation and review it manually.",
        "",
        "Finding",
        primaryFact.factTextEn
      ].join("\n")
    },
    {
      locale: "en" as const,
      decision: "DECLINE" as const,
      score: 78,
      expected: [
        "🟠 78/100 — high risk. Do not proceed.",
        "",
        "Finding",
        primaryFact.factTextEn
      ].join("\n")
    },
    {
      locale: "en" as const,
      decision: "NO_FINAL_DECISION" as const,
      score: null,
      expected: [
        "⚪ No final result. Pause the operation until the check is repeated.",
        "",
        "Finding",
        primaryFact.factTextEn
      ].join("\n")
    }
  ])("formats the exact $decision shape in $locale", ({ locale, decision, score, expected }) => {
    expect(formatWalletNarrativeSummary(narrativeCase({ locale, decision, score }))).toBe(expected);
  });

  it.each([
    [29, "ACCEPTABLE", "🟢 29/100 — низкий риск. Можно принять."],
    [30, "DECLINE", "🟡 30/100 — средний риск. Операцию не проводить."],
    [60, "REVIEW", "🟠 60/100 — высокий риск. Поставьте операцию на паузу и проверьте вручную."],
    [85, "REVIEW", "🔴 85/100 — критический риск. Поставьте операцию на паузу и проверьте вручную."]
  ] as const)("keeps the score band for %s and the canonical %s action", (score, decision, header) => {
    expect(formatWalletNarrativeSummary(narrativeCase({ score, decision })).split("\n")[0]).toBe(header);
  });

  it("shows one primary fact, one nonduplicate context fact, and one coverage limitation", () => {
    const output = formatWalletNarrativeSummary(narrativeCase({
      facts: [
        {
          id: "fee",
          kind: "gasfree_fee",
          factTextRu: "GasFree отдельно удержал 3 USDT как комиссию сервиса.",
          factTextEn: "GasFree separately retained 3 USDT as its service fee."
        },
        {
          id: "blacklist",
          kind: "usdt_blacklist",
          factTextRu: "Адрес находится в чёрном списке USDT: переводы токена заблокированы.",
          factTextEn: "The address is on the USDT blacklist, so token transfers are blocked."
        },
        {
          id: "bridge",
          kind: "bridge_route",
          factTextRu: "83% проверенной суммы пришло через мост UsdtOFT.",
          factTextEn: "83% of the checked amount arrived through the UsdtOFT bridge."
        }
      ],
      coverageExplanation: {
        textRu: "Удалось проследить 83% суммы. Более старые переводы источник данных не отдал.",
        textEn: "We traced 83% of the amount. The data source did not return older transfers.",
        isRiskEvidence: false
      }
    }));

    expect(output).toBe([
      "🔴 95/100 — критический риск. Операцию не проводить.",
      "",
      "Что нашли",
      "Адрес находится в чёрном списке USDT: переводы токена заблокированы.",
      "",
      "Контекст",
      "83% проверенной суммы пришло через мост UsdtOFT.",
      "",
      "Границы проверки",
      "Удалось проследить 83% суммы. Более старые переводы источник данных не отдал."
    ].join("\n"));

    const parts = output.split("\n\n").slice(1);
    expect(parts).toHaveLength(3);
    expect(parts.every((part) => part.split("\n").every((line) => line.trim().length > 0))).toBe(true);
  });

  it("selects facts deterministically and drops repeated sentences", () => {
    const facts: NarrativeFact[] = [
      {
        id: "collector",
        kind: "collector",
        factTextRu: "Кошелёк собирает переводы и выводит их на Bybit.",
        factTextEn: "The wallet collects transfers and sends them to Bybit."
      },
      {
        id: "blacklist-copy",
        kind: "risky_counterparty",
        factTextRu: "Адрес находится в чёрном списке USDT: переводы токена заблокированы.",
        factTextEn: "The address is on the USDT blacklist, so token transfers are blocked."
      },
      {
        id: "blacklist",
        kind: "usdt_blacklist",
        factTextRu: "Адрес находится в чёрном списке USDT: переводы токена заблокированы.",
        factTextEn: "The address is on the USDT blacklist, so token transfers are blocked."
      },
      {
        id: "bridge",
        kind: "bridge_route",
        factTextRu: "83% проверенной суммы пришло через мост UsdtOFT.",
        factTextEn: "83% of the checked amount arrived through the UsdtOFT bridge."
      }
    ];

    const selected = selectNarrativeFacts(narrativeCase({ facts }));
    expect(selected.map((fact) => fact.id)).toEqual(["blacklist", "bridge"]);

    const output = formatWalletNarrativeSummary(narrativeCase({ facts }));
    expect(output.match(/Адрес находится в чёрном списке USDT/g)).toHaveLength(1);
  });

  it("keeps a representative body within the 200–500 character target without boilerplate", () => {
    const output = formatWalletNarrativeSummary(narrativeCase({
      facts: [
        {
          id: "direct-blacklist",
          kind: "direct_counterparty_blacklist",
          factTextRu: "С адреса отправили 1 176 317 USDT прямому получателю TWGC…dTm. Получатель сейчас находится в чёрном списке USDT, но сам проверяемый адрес туда не внесён.",
          factTextEn: "The address sent 1,176,317 USDT directly to TWGC…dTm. The recipient is now on the USDT blacklist, but the checked address is not."
        },
        {
          id: "timing",
          kind: "risky_counterparty",
          factTextRu: "Получателя внесли в список через 2 часа 52 минуты после перевода на 1 176 302 USDT.",
          factTextEn: "The recipient was listed 2 hours 52 minutes after the 1,176,302 USDT transfer."
        }
      ],
      coverageExplanation: {
        textRu: "Проверены все прямые переводы и материальные контрагенты в доступной истории.",
        textEn: "All direct transfers and material counterparties in the available history were checked.",
        isRiskEvidence: false
      }
    }));
    const body = output.split("\n\n").slice(1).join("\n\n");
    expect(body.length).toBeGreaterThanOrEqual(200);
    expect(body.length).toBeLessThanOrEqual(500);
  });

  it("does not pad a short truthful case", () => {
    const output = formatWalletNarrativeSummary(narrativeCase({
      facts: [{
        id: "fee",
        kind: "gasfree_fee",
        factTextRu: "GasFree удержал 3 USDT комиссии.",
        factTextEn: "GasFree retained a 3 USDT fee."
      }]
    }));
    expect(output.split("\n\n").slice(1).join("\n\n").length).toBeLessThan(200);
    expect(output).not.toContain("доступным данным");
  });

  it.each([
    "Почему этот адрес опасен.",
    "Что это может значить для клиента.",
    "Что важно учесть перед операцией.",
    "Found a drain episode.",
    "Incomplete anchor coverage.",
    "provider_cap_unresolved"
  ])("rejects forbidden normal copy: %s", (factTextRu) => {
    expect(() => narrativeCase({
      facts: [{
        id: "forbidden",
        kind: "risky_counterparty",
        factTextRu,
        factTextEn: factTextRu
      }]
    })).toThrow(/normal narrative copy/i);
  });

  it("rejects an oversized fact instead of cutting an amount or address", () => {
    const address = `T${"1".repeat(33)}`;
    const oversized = `The address ${address} received 1,176,302.125 USDT. ${"Context ".repeat(40)}`;
    expect(() => narrativeCase({
      facts: [{
        id: "oversized",
        kind: "risky_counterparty",
        factTextRu: oversized,
        factTextEn: oversized
      }]
    })).toThrow(/280 characters/);
  });

  it("rejects mismatched final-score states", () => {
    expect(() => narrativeCase({ decision: "NO_FINAL_DECISION", score: 45 })).toThrow(/must not have a score/);
    expect(() => narrativeCase({ decision: "REVIEW", score: null })).toThrow(/requires a score/);
    expect(() => narrativeCase({ score: 101 })).toThrow(/between 0 and 100/);
  });
});
