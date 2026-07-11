import { describe, expect, it, vi } from "vitest";
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

  it("shows one primary fact, one nonduplicate conclusion, and one coverage limitation", () => {
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
      "Вывод",
      "83% проверенной суммы пришло через мост UsdtOFT.",
      "",
      "Границы проверки",
      "Удалось проследить 83% суммы. Более старые переводы источник данных не отдал."
    ].join("\n"));

    const parts = output.split("\n\n").slice(1);
    expect(parts).toHaveLength(3);
    expect(parts.every((part) => part.split("\n").every((line) => line.trim().length > 0))).toBe(true);
  });

  it.each([
    {
      locale: "ru" as const,
      expected: [
        "🔴 95/100 — критический риск. Операцию не проводить.",
        "",
        "Что нашли",
        "Адрес находится в чёрном списке USDT: переводы токена заблокированы.",
        "",
        "Вывод",
        "83% проверенной суммы пришло через мост UsdtOFT."
      ].join("\n")
    },
    {
      locale: "en" as const,
      expected: [
        "🔴 95/100 — critical risk. Do not proceed.",
        "",
        "Finding",
        "The address is on the USDT blacklist, so token transfers are blocked.",
        "",
        "Conclusion",
        "83% of the checked amount arrived through the UsdtOFT bridge."
      ].join("\n")
    }
  ])("uses the canonical conclusion heading in $locale", ({ locale, expected }) => {
    expect(formatWalletNarrativeSummary(narrativeCase({
      locale,
      facts: [
        {
          id: "bridge",
          kind: "bridge_route",
          factTextRu: "83% проверенной суммы пришло через мост UsdtOFT.",
          factTextEn: "83% of the checked amount arrived through the UsdtOFT bridge."
        },
        {
          id: "blacklist",
          kind: "usdt_blacklist",
          factTextRu: "Адрес находится в чёрном списке USDT: переводы токена заблокированы.",
          factTextEn: "The address is on the USDT blacklist, so token transfers are blocked."
        }
      ]
    }))).toBe(expected);
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

  it("deduplicates Turkish I sentences without depending on the default locale", () => {
    const original = String.prototype.toLocaleLowerCase;
    const localeSpy = vi.spyOn(String.prototype, "toLocaleLowerCase")
      .mockImplementation(function (this: string) {
        return original.call(this, "tr");
      });
    const upper: NarrativeFact = {
      id: "upper",
      kind: "usdt_blacklist",
      factTextRu: "DIRECT I ROUTE.",
      factTextEn: "DIRECT I ROUTE."
    };
    const lower: NarrativeFact = {
      id: "lower",
      kind: "bridge_route",
      factTextRu: "direct i route.",
      factTextEn: "direct i route."
    };

    try {
      const forward = narrativeCase({ facts: [upper, lower] });
      const reversed = narrativeCase({ facts: [lower, upper] });
      expect(selectNarrativeFacts(forward).map((fact) => fact.id)).toEqual(["upper"]);
      expect(formatWalletNarrativeSummary(forward)).toBe(formatWalletNarrativeSummary(reversed));
    } finally {
      localeSpy.mockRestore();
    }
  });

  it("canonicalizes duplicate episode ids independently of input order", () => {
    const first: NarrativeFact = {
      id: "episode-1",
      kind: "bridge_route",
      factTextRu: "Сумма прошла через мост Alpha.",
      factTextEn: "The amount passed through the Alpha bridge."
    };
    const second: NarrativeFact = {
      id: "episode-1",
      kind: "bridge_route",
      factTextRu: "Сумма прошла через мост Beta.",
      factTextEn: "The amount passed through the Beta bridge."
    };

    const forward = narrativeCase({ facts: [first, second] });
    const reversed = narrativeCase({ facts: [second, first] });
    expect(selectNarrativeFacts(forward).map((fact) => fact.id)).toEqual(["episode-1"]);
    expect(selectNarrativeFacts(reversed).map((fact) => fact.id)).toEqual(["episode-1"]);
    expect(formatWalletNarrativeSummary(forward)).toBe(formatWalletNarrativeSummary(reversed));
  });

  it("reserves the 500-character body budget for coverage before the optional conclusion", () => {
    const primary = `Главный факт ${"а".repeat(225)}`;
    const secondary = `Дополнительный вывод ${"б".repeat(215)}`;
    const limitation = `Не проверена старая история ${"в".repeat(170)}`;
    const output = formatWalletNarrativeSummary(narrativeCase({
      facts: [
        { id: "primary", kind: "usdt_blacklist", factTextRu: primary, factTextEn: primary },
        { id: "secondary", kind: "bridge_route", factTextRu: secondary, factTextEn: secondary }
      ],
      coverageExplanation: {
        textRu: limitation,
        textEn: limitation,
        isRiskEvidence: false
      }
    }));
    const body = output.split("\n\n").slice(1).join("\n\n");

    expect(body.length).toBeLessThanOrEqual(500);
    expect(output).toContain(primary);
    expect(output).toContain(limitation);
    expect(output).not.toContain(secondary);
    expect(output).not.toContain("Вывод\n");
  });

  it("keeps a coverage limitation instead of a conclusion with the same sentence", () => {
    const repeated = "Более старые переводы источник данных не отдал.";
    const output = formatWalletNarrativeSummary(narrativeCase({
      facts: [
        { ...primaryFact, id: "primary" },
        { id: "secondary", kind: "bridge_route", factTextRu: repeated, factTextEn: repeated }
      ],
      coverageExplanation: {
        textRu: repeated,
        textEn: repeated,
        isRiskEvidence: false
      }
    }));

    expect(output).toContain(`Границы проверки\n${repeated}`);
    expect(output).not.toContain("Вывод\n");
  });

  it("keeps the worst accepted input body within 500 characters without empty headings", () => {
    const maxPart = (prefix: string, fill: string) => `${prefix}${fill.repeat(280 - prefix.length)}`;
    const output = formatWalletNarrativeSummary(narrativeCase({
      facts: [
        {
          id: "primary",
          kind: "usdt_blacklist",
          factTextRu: maxPart("Главный факт: ", "а"),
          factTextEn: maxPart("Primary fact: ", "a")
        },
        {
          id: "secondary",
          kind: "bridge_route",
          factTextRu: maxPart("Дополнительный вывод: ", "б"),
          factTextEn: maxPart("Additional conclusion: ", "b")
        }
      ],
      coverageExplanation: {
        textRu: maxPart("Ограничение данных: ", "в"),
        textEn: maxPart("Coverage limitation: ", "c"),
        isRiskEvidence: false
      }
    }));
    const body = output.split("\n\n").slice(1).join("\n\n");

    expect(body.length).toBeLessThanOrEqual(500);
    expect(body).toContain("Главный факт:");
    expect(body.split("\n").every((line) => line.trim().length > 0)).toBe(true);
  });

  it("counts the separator after the header in the 500-character body budget", () => {
    const primary = `Факт ${"а".repeat(230)}`;
    const limitation = `Предел ${"б".repeat(229)}`;
    const output = formatWalletNarrativeSummary(narrativeCase({
      facts: [{ id: "primary", kind: "usdt_blacklist", factTextRu: primary, factTextEn: primary }],
      coverageExplanation: {
        textRu: limitation,
        textEn: limitation,
        isRiskEvidence: false
      }
    }));
    const headerEnd = output.indexOf("\n\n");
    const completeBody = headerEnd < 0 ? "" : output.slice(headerEnd);

    expect(completeBody.length).toBeLessThanOrEqual(500);
    expect(output).toContain(primary);
    expect(output).not.toContain(limitation);
  });

  it("uses a fitting conclusion when the preferred coverage limitation cannot fit", () => {
    const primary = `Главный факт ${"а".repeat(225)}`;
    const secondary = "Источник данных не отдал старые переводы.";
    const limitation = `${secondary} ${"б".repeat(230)}`;
    const output = formatWalletNarrativeSummary(narrativeCase({
      facts: [
        { id: "primary", kind: "usdt_blacklist", factTextRu: primary, factTextEn: primary },
        { id: "secondary", kind: "bridge_route", factTextRu: secondary, factTextEn: secondary }
      ],
      coverageExplanation: {
        textRu: limitation,
        textEn: limitation,
        isRiskEvidence: false
      }
    }));

    expect(output).toContain(`Вывод\n${secondary}`);
    expect(output).not.toContain("Границы проверки\n");
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
    "provider_cap_unresolved",
    "PROVIDER_CAP_UNRESOLVED",
    "Provider_Cap_Unresolved",
    "approval_drain_exact",
    "INSUFFICIENT_COVERAGE",
    "EDD_SOF"
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

  it("allows legitimate display labels that contain underscores", () => {
    const output = formatWalletNarrativeSummary(narrativeCase({
      facts: [{
        id: "service",
        kind: "cex_source",
        factTextRu: "Сумма пришла через SUN_IO V2.",
        factTextEn: "The amount arrived through SUN_IO V2."
      }]
    }));

    expect(output).toContain("SUN_IO V2");
  });

  it.each([
    {
      name: "locale",
      value: { locale: "tr" },
      error: /locale must be "ru" or "en"/
    },
    {
      name: "decision",
      value: { decision: "UNKNOWN" },
      error: /decision is invalid/
    },
    {
      name: "facts array",
      value: { facts: {} },
      error: /facts must be an array/
    },
    {
      name: "fact kind",
      value: { facts: [{ ...primaryFact, kind: "bridge" }] },
      error: /fact kind is invalid/
    },
    {
      name: "fact id",
      value: { facts: [{ ...primaryFact, id: 42 }] },
      error: /fact id must be a string/
    },
    {
      name: "fact text",
      value: { facts: [{ ...primaryFact, factTextRu: 42 }] },
      error: /fact texts must be strings/
    },
    {
      name: "coverage object",
      value: { coverageExplanation: [] },
      error: /coverage must be an object or null/
    },
    {
      name: "coverage text",
      value: {
        coverageExplanation: { textRu: 42, textEn: "Coverage.", isRiskEvidence: false }
      },
      error: /coverage texts must be strings/
    },
    {
      name: "coverage evidence flag",
      value: {
        coverageExplanation: { textRu: "Ограничение.", textEn: "Coverage.", isRiskEvidence: true }
      },
      error: /coverage must be a limitation/
    },
    {
      name: "score type",
      value: { score: "95" },
      error: /score must be an integer between 0 and 100/
    }
  ])("formatter fails closed with a controlled validation error for invalid $name", ({ value, error }) => {
    const invalid = {
      ...narrativeCase(),
      ...value
    } as unknown as WalletNarrativeCase;
    expect(() => formatWalletNarrativeSummary(invalid)).toThrow(error);
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
