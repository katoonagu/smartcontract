import { describe, expect, it, vi } from "vitest";
import * as walletNarrativeSummary from "../../src/bot/walletNarrativeSummary";
import {
  buildPreliminaryNarrativeSections,
  buildWalletNarrativeCase,
  formatWalletNarrativeSummary,
  selectNarrativeFacts,
  type NarrativeFact,
  type WalletNarrativeCase
} from "../../src/bot/walletNarrativeSummary";
import type {
  AddressBehaviorProfile,
  ApprovalDrainProvenanceProfile,
  BalanceFormingTransfer,
  BoundaryExposureProfile,
  DirectCounterpartyInteractionProfile,
  FirstHopBlacklistCoverage,
  FirstHopBlacklistFact,
  FirstHopLabelFact,
  MoneyOriginPath,
  MoneyOriginTraceHistoryCoverage,
  OperationalFlowProfile,
  SourcePolicyEvidence,
  StablecoinRestrictionProfile,
  WhereIsMoneyCoverage
} from "../../src/types";
import {
  TGYT_DIRECT_BLACKLIST_CASE,
  tgytBridgePath,
  tgytBridgePolicyEvidence,
  tgytDirectInteractionProfiles,
  tgytFirstHopBlacklistFact,
  tgytFirstHopCoverage,
  tgytSubjectRestriction
} from "../fixtures/forensics/directBlacklistCases";
import { SANCTIONED_CRYPTO_SERVICES } from "../../src/forensics/sanctionedServiceRegistry";

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
  it("uses the preferred primary finding and its meaning in preliminary sections", () => {
    const sections = buildPreliminaryNarrativeSections({
      locale: "ru",
      facts: [
        {
          id: "cex",
          kind: "cex_source",
          factTextRu: "17% суммы пришло с Binance.",
          factTextEn: "17% of the amount came from Binance.",
          meaningTextRu: "Второй факт не должен определять вывод.",
          meaningTextEn: "The second fact must not define the conclusion."
        },
        {
          id: "bridge",
          kind: "bridge_route",
          factTextRu: "83% проверяемой суммы пришло через мост UsdtOFT.",
          factTextEn: "83% of the checked amount came through the UsdtOFT bridge.",
          meaningTextRu: "Мост мог использоваться для обмена между сетями или чтобы затруднить проверку происхождения денег.",
          meaningTextEn: "The bridge may have been used for a cross-chain swap or to make origin checks harder."
        },
        {
          id: "collector",
          kind: "collector",
          factTextRu: "Третий факт не должен попасть в краткий отчёт.",
          factTextEn: "The third fact must not appear in the compact report."
        }
      ],
      preferredFactId: "bridge",
      coverageExplanation: {
        textRu: "Оставшиеся 17% суммы не удалось проследить.",
        textEn: "The remaining 17% of the amount could not be traced.",
        isRiskEvidence: false
      }
    });

    expect(sections).toEqual({
      findings: [
        "83% проверяемой суммы пришло через мост UsdtOFT.",
        "17% суммы пришло с Binance."
      ],
      conclusion: "Мост мог использоваться для обмена между сетями или чтобы затруднить проверку происхождения денег.",
      coverage: "Оставшиеся 17% суммы не удалось проследить."
    });
  });

  it("normalizes meaning and score keys and resolves duplicate ties deterministically", () => {
    const tieA: NarrativeFact = {
      id: "tie",
      kind: "bridge_route",
      factTextRu: "  Одинаковый   факт. ",
      factTextEn: "  Same   finding. ",
      meaningTextRu: "  Alpha   meaning. ",
      meaningTextEn: "  Primary   meaning. ",
      scoreSignalKeys: [" zeta ", "", "alpha", "zeta", "   "]
    };
    const tieB: NarrativeFact = {
      ...tieA,
      meaningTextRu: "Beta meaning.",
      meaningTextEn: "Secondary meaning.",
      scoreSignalKeys: ["beta"]
    };
    const buildAndSelect = (facts: NarrativeFact[]) => selectNarrativeFacts(buildWalletNarrativeCase({
      locale: "ru",
      decision: "DECLINE",
      score: 95,
      facts,
      coverageExplanation: null
    }));

    const forward = buildAndSelect([tieA, tieB]);
    const reversed = buildAndSelect([tieB, tieA]);

    expect(forward).toEqual(reversed);
    expect(forward).toEqual([expect.objectContaining({
      factTextRu: "Одинаковый факт.",
      factTextEn: "Same finding.",
      meaningTextRu: "Alpha meaning.",
      meaningTextEn: "Primary meaning.",
      scoreSignalKeys: ["alpha", "zeta"]
    })]);
  });

  it.each([
    {
      locale: "ru" as const,
      primary: `Главный факт: 123 456,78 USDT пришли на T${"A".repeat(33)}. ${"а".repeat(90)}.`,
      meaning: `Смысл главного факта сохранён полностью. ${"б".repeat(70)}.`,
      coverage: `Оставшиеся 17% суммы не удалось проследить. ${"в".repeat(80)}.`,
      secondary: `Дополнительный факт: 9 999 USDT. ${"г".repeat(55)}.`,
      headings: { finding: "Что нашли", conclusion: "Вывод", coverage: "Границы проверки" }
    },
    {
      locale: "en" as const,
      primary: `Primary finding: 123,456.78 USDT arrived at T${"A".repeat(33)}. ${"a".repeat(90)}.`,
      meaning: `The primary meaning is preserved in full. ${"b".repeat(70)}.`,
      coverage: `The remaining 17% of the amount could not be traced. ${"c".repeat(80)}.`,
      secondary: `Additional finding: 9,999 USDT. ${"d".repeat(55)}.`,
      headings: { finding: "Finding", conclusion: "Conclusion", coverage: "Coverage limits" }
    }
  ])("keeps the worst-case $locale preliminary body whole and within budget", ({
    locale,
    primary,
    meaning,
    coverage,
    secondary,
    headings
  }) => {
    const sections = buildPreliminaryNarrativeSections({
      locale,
      facts: [
        {
          id: "primary",
          kind: "usdt_blacklist",
          factTextRu: primary,
          factTextEn: primary,
          meaningTextRu: meaning,
          meaningTextEn: meaning
        },
        {
          id: "secondary",
          kind: "bridge_route",
          factTextRu: secondary,
          factTextEn: secondary
        }
      ],
      preferredFactId: "primary",
      coverageExplanation: {
        textRu: coverage,
        textEn: coverage,
        isRiskEvidence: false
      }
    });
    const body = [
      sections.findings.length > 0
        ? `${headings.finding}\n${sections.findings.map((finding) => `• ${finding}`).join("\n")}`
        : null,
      sections.conclusion ? `${headings.conclusion}\n${sections.conclusion}` : null,
      sections.coverage ? `${headings.coverage}\n${sections.coverage}` : null
    ].filter((part): part is string => part !== null).join("\n\n");

    expect(sections).toEqual({ findings: [primary], conclusion: meaning, coverage });
    expect(`\n\n${body}`.length).toBeLessThanOrEqual(500);
    expect(sections.findings.every((finding) => finding.length > 0)).toBe(true);
    expect(sections.conclusion).toBeTruthy();
    expect(sections.coverage).toBeTruthy();
    expect(body).toContain(locale === "en" ? "123,456.78 USDT" : "123 456,78 USDT");
    expect(body).toContain(`T${"A".repeat(33)}`);
    expect(body).not.toContain(secondary);
  });

  it("keeps finding and meaning in the final formatter without duplicating either sentence", () => {
    const finding = "83% проверяемой суммы пришло через мост UsdtOFT.";
    const meaning = "Мост мог использоваться для обмена между сетями или чтобы затруднить проверку происхождения денег.";
    const output = formatWalletNarrativeSummary(narrativeCase({
      facts: [
        {
          id: "bridge",
          kind: "bridge_route",
          factTextRu: finding,
          factTextEn: finding,
          meaningTextRu: meaning,
          meaningTextEn: meaning
        },
        {
          id: "duplicate-finding",
          kind: "collector",
          factTextRu: finding,
          factTextEn: finding
        }
      ]
    }));
    const body = output.split("\n\n").slice(1).join("\n\n");

    expect(output.match(/83% проверяемой суммы/gu)).toHaveLength(1);
    expect(output.match(/Мост мог использоваться/gu)).toHaveLength(1);
    expect(body.length).toBeLessThanOrEqual(500);
  });

  it("keeps a complete 280-character finding and drops an oversized final meaning", () => {
    const finding = `Finding: ${"f".repeat(271)}`;
    const meaning = `Meaning: ${"m".repeat(271)}`;
    const output = formatWalletNarrativeSummary(narrativeCase({
      locale: "en",
      facts: [{
        id: "max-copy",
        kind: "usdt_blacklist",
        factTextRu: finding,
        factTextEn: finding,
        meaningTextRu: meaning,
        meaningTextEn: meaning
      }]
    }));
    const completeBody = output.slice(output.indexOf("\n\n"));
    const findingCopy = output.split("Finding\n")[1];

    expect(finding).toHaveLength(280);
    expect(meaning).toHaveLength(280);
    expect(completeBody.length).toBeLessThanOrEqual(500);
    expect(findingCopy).toBe(finding);
    expect(findingCopy?.length).toBeLessThanOrEqual(280);
    expect(output).not.toContain(meaning);
  });

  it.each([
    {
      locale: "ru" as const,
      emptyFact: { factTextRu: "   ", factTextEn: "English finding." },
      meaning: { meaningTextRu: "Только интерпретация.", meaningTextEn: "Interpretation only." },
      validFinding: "Подтверждённый факт."
    },
    {
      locale: "en" as const,
      emptyFact: { factTextRu: "Русский факт.", factTextEn: "   " },
      meaning: { meaningTextRu: "Только интерпретация.", meaningTextEn: "Interpretation only." },
      validFinding: "Confirmed finding."
    }
  ])("drops an interpretation-only $locale fact before selection", ({
    locale,
    emptyFact,
    meaning,
    validFinding
  }) => {
    const caseData = buildWalletNarrativeCase({
      locale,
      decision: "DECLINE",
      score: 95,
      facts: [
        {
          id: "interpretation-only",
          kind: "usdt_blacklist",
          ...emptyFact,
          ...meaning
        },
        {
          id: "valid",
          kind: "bridge_route",
          factTextRu: "Подтверждённый факт.",
          factTextEn: "Confirmed finding."
        }
      ],
      preferredFactId: "interpretation-only",
      coverageExplanation: null
    });
    const selected = selectNarrativeFacts(caseData);
    const output = formatWalletNarrativeSummary(caseData);

    expect(caseData.facts.map((fact) => fact.id)).toEqual(["valid"]);
    expect(caseData.preferredFactId).toBeNull();
    expect(selected.map((fact) => fact.id)).toEqual(["valid"]);
    expect(output).toContain(validFinding);
    expect(output).not.toContain(locale === "en" ? meaning.meaningTextEn : meaning.meaningTextRu);
  });

  it("keeps action in the final header and out of a sanctioned shared fact", () => {
    const [fact] = catalogueApi.sourceAndRouteFacts({
      paths: [postDesignationHtxPath()],
      sourcePolicyEvidence: [postDesignationHtxPolicy()]
    });

    expect(fact?.factTextRu).not.toMatch(/операцию не проводить/i);
    expect(fact?.factTextEn).not.toMatch(/do not proceed/i);
    expect(formatWalletNarrativeSummary(narrativeCase({ facts: [fact!] })))
      .toMatch(/^🔴 95\/100.*Операцию не проводить\./u);
  });

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

  it("keeps an explicitly preferred canonical winner visible beside higher-ranked secondary facts", () => {
    const facts: NarrativeFact[] = [
      {
        id: "secondary-policy",
        kind: "direct_counterparty_sanction",
        factTextRu: "Есть вторичный исторический контекст сервиса.",
        factTextEn: "There is secondary historical service context."
      },
      {
        id: "secondary-bridge",
        kind: "unknown_contract",
        factTextRu: "Есть вторичная граница сервиса.",
        factTextEn: "There is a secondary service boundary."
      },
      {
        id: "fast-winner",
        kind: "risky_counterparty",
        factTextRu: "Через кошелёк проходит много входящих и исходящих переводов.",
        factTextEn: "Many incoming and outgoing transfers pass through the wallet."
      }
    ];

    const selected = selectNarrativeFacts(narrativeCase({
      facts,
      preferredFactId: "fast-winner"
    }));

    expect(selected.map((fact) => fact.id)).toEqual(["fast-winner", "secondary-policy"]);
    expect(formatWalletNarrativeSummary(narrativeCase({
      facts,
      preferredFactId: "fast-winner"
    }))).toContain("Через кошелёк проходит много входящих и исходящих переводов.");
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

  it("keeps both selected facts before an optional coverage part", () => {
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
    expect(output).toContain(secondary);
    expect(output).not.toContain(limitation);
    expect(output).toContain("Вывод\n");
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
      name: "preferred fact id",
      value: { preferredFactId: 42 },
      error: /preferred fact id must be a string or null/
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
      name: "fact role",
      value: { facts: [{ ...primaryFact, role: "sender" }] },
      error: /fact role is invalid/
    },
    {
      name: "fact proof strength",
      value: { facts: [{ ...primaryFact, proofStrength: "guessed" }] },
      error: /proof strength is invalid/
    },
    {
      name: "fact priority",
      value: { facts: [{ ...primaryFact, priority: 1.5 }] },
      error: /fact priority must be an integer/
    },
    {
      name: "fact evidence ids type",
      value: { facts: [{ ...primaryFact, evidenceIds: "abc" }] },
      error: /fact evidence ids must be an array/
    },
    {
      name: "empty fact evidence id",
      value: { facts: [{ ...primaryFact, evidenceIds: [""] }] },
      error: /fact evidence ids must contain non-empty strings/
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
      name: "coverage reason kind",
      value: {
        coverageExplanation: {
          reasonKind: 42,
          textRu: "Ограничение.",
          textEn: "Coverage.",
          isRiskEvidence: false
        }
      },
      error: /coverage reason kind must be a string/
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

const catalogueApi = walletNarrativeSummary as unknown as {
  subjectBlacklistFact: (profile: StablecoinRestrictionProfile) => NarrativeFact | null;
  approvalDrainRoleFact: (input: Record<string, unknown>) => NarrativeFact | null;
  verify20RoleFact: (input: Record<string, unknown>) => NarrativeFact | null;
  firstHopBlacklistFacts: (
    checkedAddress: string,
    facts: FirstHopBlacklistFact[],
    profiles?: DirectCounterpartyInteractionProfile[],
    subjectRestriction?: StablecoinRestrictionProfile | null
  ) => NarrativeFact[];
  sourceAndRouteFacts: (input: Record<string, unknown>) => NarrativeFact[];
  gasFreeFeeFact: (profiles: DirectCounterpartyInteractionProfile[]) => NarrativeFact | null;
  gasFreeFeeFactFromBalanceTransfers: (transfers: BalanceFormingTransfer[]) => NarrativeFact | null;
  coverageExplanationFor: (input: Record<string, unknown>) => WalletNarrativeCase["coverageExplanation"];
  buildWalletNarrativeEvidence: (input: Record<string, unknown>) => {
    facts: NarrativeFact[];
    coverageExplanation: WalletNarrativeCase["coverageExplanation"];
  };
};

const subject = `T${"1".repeat(33)}`;
const counterparty = `T${"2".repeat(33)}`;

function blacklistFact(overrides: Partial<FirstHopBlacklistFact> = {}): FirstHopBlacklistFact {
  return {
    counterpartyAddress: counterparty,
    direction: "inbound",
    evidenceKind: "usdt_blacklist",
    evidenceAuthority: "official_contract",
    statusAtCheck: "active",
    temporalRelation: "active_at_transfer",
    effectiveAt: "2026-05-26T12:49:03.000Z",
    effectiveTxHash: "b".repeat(64),
    checkedAt: "2026-07-11T00:00:00.000Z",
    principalAmountRaw: "25000000000",
    principalTxCount: 2,
    directionalPrincipalShare: 0.25,
    shareSemantics: "exact",
    transferTxHashes: ["a".repeat(64)],
    beforeEffectiveAmountRaw: "0",
    beforeEffectiveTxCount: 0,
    activeAmountRaw: "25000000000",
    activeTxCount: 2,
    unknownTimingAmountRaw: "0",
    unknownTimingTxCount: 0,
    directTransferCoverage: "complete",
    timelineCoverage: "complete",
    timelineEvents: [],
    ...overrides
  };
}

function firstHopCoverage(
  overrides: Partial<FirstHopBlacklistCoverage> = {}
): FirstHopBlacklistCoverage {
  return {
    requiredForDecision: true,
    scope: "checked_window",
    windowStart: "2026-05-01T00:00:00.000Z",
    windowEnd: "2026-07-11T00:00:00.000Z",
    directPrincipalTransferCoverage: "complete",
    materialCounterpartyCount: 4,
    checkedMaterialCounterpartyCount: 4,
    failedMaterialCounterpartyCount: 0,
    uncheckedMaterialCounterpartyCount: 0,
    blacklistCheckCoverage: "complete",
    incompleteReason: null,
    confirmedAdverseFactCount: 0,
    completeTimelineFactCount: 0,
    partialTimelineFactCount: 0,
    ...overrides
  };
}

function approvalProfile(
  overrides: Partial<ApprovalDrainProvenanceProfile> = {}
): ApprovalDrainProvenanceProfile {
  return {
    victimAddress: subject,
    approvalTxHash: "1".repeat(64),
    drainTxHash: "2".repeat(64),
    spenderAddress: `T${"3".repeat(33)}`,
    firstReceiverAddress: `T${"4".repeat(33)}`,
    subjectAddress: subject,
    hopDepth: 0,
    amountRaw: "850000000",
    amountPreservationRatio: 1,
    approvalAt: "2026-07-10T00:00:00.000Z",
    drainAt: "2026-07-10T00:01:00.000Z",
    pathTxHashes: ["2".repeat(64)],
    pathAddresses: [subject, `T${"3".repeat(33)}`, `T${"4".repeat(33)}`],
    score: 95,
    evidenceStrength: "exact_approval_and_transfer_from",
    subjectTokenState: null,
    victimTokenState: null,
    features: [],
    ...overrides
  };
}

function interactionProfile(
  transfers: NonNullable<DirectCounterpartyInteractionProfile["transfers"]>,
  overrides: Partial<DirectCounterpartyInteractionProfile> = {}
): DirectCounterpartyInteractionProfile {
  return {
    subjectAddress: subject,
    direction: "outbound",
    counterpartyAddress: counterparty,
    volumeRaw: "1176320000000",
    volumeRatio: 1,
    txCount: transfers.length,
    firstSeen: transfers[0]?.timestamp ?? "2026-07-11T00:00:00.000Z",
    lastSeen: transfers.at(-1)?.timestamp ?? "2026-07-11T00:00:00.000Z",
    txHashes: transfers.map((transfer) => transfer.txHash),
    transfers,
    serviceCategory: null,
    identity: null,
    snapshot: {
      address: counterparty,
      riskScore: 0,
      riskLevel: "LOW",
      source: "none",
      evidenceClass: "no_exact_label_or_cached_taint",
      reasons: ["POISON snapshot.reasons"],
      partialNotes: ["POISON snapshot.partialNotes"]
    },
    interactionWeight: 1,
    scoreContribution: 0,
    evidenceClass: "no_exact_label_or_cached_taint",
    skippedReason: null,
    ...overrides
  };
}

function originPath(overrides: Partial<MoneyOriginPath> = {}): MoneyOriginPath {
  const txHash = "9".repeat(64);
  return {
    balanceTransferTxHash: txHash,
    rootSourceAddress: counterparty,
    rootSourceType: "allowlist_cex",
    balanceShare: 0.72,
    exposureSourceKey: "allowlisted_cex",
    exposureSourceLabel: "Binance",
    sourceExposureKind: "allowlisted_cex",
    effectiveExposureShare: 0.72,
    amountUsage: {
      anchorAmountRaw: "100000000000",
      originalAmountRaw: "72000000000",
      usedAmountRaw: "72000000000",
      coverageShare: 0.72,
      role: "anchor"
    },
    pathAddresses: [counterparty, subject],
    txHashes: [txHash],
    steps: [{
      txHash,
      fromAddress: counterparty,
      toAddress: subject,
      amountRaw: "72000000000",
      timestamp: "2026-05-27T00:00:00.000Z"
    }],
    amountPreservationRatio: 1,
    timeSpanMs: 0,
    stoppedReason: "allowlist_cex_reached",
    verdict: "ACCEPTABLE",
    riskScoreContribution: 0,
    reasons: ["POISON origin reasons"],
    ...overrides
  };
}

function aggregateRoutePath(
  kind: "cross_chain_boundary" | "bridge_router_dex",
  label: string | null,
  txHash: string,
  share: number,
  amountRaw: string
): MoneyOriginPath {
  return originPath({
    balanceTransferTxHash: txHash,
    rootSourceType: "decline_boundary",
    exposureSourceLabel: label,
    sourceExposureKind: kind,
    balanceShare: share,
    txHashes: [txHash],
    amountUsage: {
      anchorAmountRaw: "100000000000",
      originalAmountRaw: amountRaw,
      usedAmountRaw: amountRaw,
      coverageShare: share,
      role: "anchor"
    },
    steps: [{
      txHash,
      fromAddress: counterparty,
      toAddress: subject,
      amountRaw,
      timestamp: "2026-05-27T00:00:00.000Z"
    }]
  });
}

function policyEvidence(overrides: Partial<SourcePolicyEvidence> = {}): SourcePolicyEvidence {
  return {
    kind: "htx_huobi",
    aggregateShare: 0.4,
    effectiveShare: 0.4,
    pathCount: 1,
    score: 70,
    riskBand: "HIGH",
    proofLevel: "exchange_policy_decline",
    canBeDampened: false,
    reasons: ["POISON policy reasons"],
    warnings: ["POISON policy warnings"],
    evidenceIds: ["8".repeat(64)],
    shareDetail: {
      scope: "where_selected_amount",
      targetAmountRaw: "100000000000",
      affectedAmountRaw: "40000000000",
      rawShare: 0.4,
      effectiveShare: 0.4,
      sourceSeverity: 70,
      valueWeightedRaw: 28,
      pathContextAdjustment: 0,
      repeatedExposureAdjustment: 0,
      dataQualityAdjustment: 0,
      walletRoleAdjustment: 0,
      shareFloor: 0,
      shareCap: 100,
      finalContribution: 70
    },
    ...overrides
  };
}

function postDesignationHtxPath(): MoneyOriginPath {
  const txHash = "8".repeat(64);
  return originPath({
    balanceTransferTxHash: txHash,
    exposureSourceKey: "htx_huobi",
    exposureSourceLabel: "HTX/Huobi",
    sourceExposureKind: "sanctioned_service",
    balanceShare: 1,
    txHashes: [txHash],
    amountUsage: {
      anchorAmountRaw: "100000000000",
      originalAmountRaw: "100000000000",
      usedAmountRaw: "100000000000",
      coverageShare: 1,
      role: "anchor"
    },
    steps: [{
      txHash,
      fromAddress: counterparty,
      toAddress: subject,
      amountRaw: "100000000000",
      timestamp: "2026-05-27T00:00:00.000Z"
    }]
  });
}

function postDesignationHtxPolicy(): SourcePolicyEvidence {
  return policyEvidence({
    kind: "sanctioned_service",
    evidenceIds: ["8".repeat(64)]
  });
}

function aggregateRouteFact(
  kind: "cross_chain_boundary" | "bridge_router_dex",
  paths: MoneyOriginPath[]
): NarrativeFact | undefined {
  return catalogueApi.sourceAndRouteFacts({
    paths,
    sourcePolicyEvidence: [policyEvidence({
      kind,
      aggregateShare: 0.5,
      effectiveShare: 0.5,
      pathCount: paths.length,
      proofLevel: "exchange_policy_context",
      evidenceIds: paths.flatMap((path) => path.txHashes),
      shareDetail: {
        ...policyEvidence().shareDetail!,
        affectedAmountRaw: "50000000000",
        rawShare: 0.5,
        effectiveShare: 0.5
      }
    })]
  }).find((fact) => fact.kind === "bridge_route");
}

function whereCoverage(overrides: Partial<WhereIsMoneyCoverage> = {}): WhereIsMoneyCoverage {
  return {
    selectedInboundTxCount: 10,
    targetAmountRaw: "100000000000",
    selectedAmountRaw: "83000000000",
    coverageRatio: 0.83,
    selectedInboundVolumeRaw: "83000000000",
    currentBalanceCoverageRatio: 0.83,
    maxDepth: 4,
    fetchedAddressCount: 3,
    partial: true,
    notes: ["POISON where notes"],
    ...overrides
  };
}

function traceHistory(
  overrides: Partial<MoneyOriginTraceHistoryCoverage> = {}
): MoneyOriginTraceHistoryCoverage {
  return {
    address: counterparty,
    targetTimestamp: "2026-05-27T00:00:00.000Z",
    fetchedTransferCount: 10,
    oldestFetchedTransferAt: "2026-05-01T00:00:00.000Z",
    reachedTargetHop: false,
    source: "live",
    coverageComplete: false,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    statusReason: "failed_retryable",
    ...overrides
  };
}

function behaviorProfile(overrides: Partial<AddressBehaviorProfile> = {}): AddressBehaviorProfile {
  return {
    subjectAddress: subject,
    incomingVolumeRaw: "100000000000",
    outgoingVolumeRaw: "98000000000",
    incomingTxCount: 18,
    outgoingTxCount: 4,
    uniqueIncomingCounterparties: 18,
    uniqueOutgoingCounterparties: 1,
    largestIncomingRaw: "10000000000",
    largestOutgoingRaw: "98000000000",
    topOutgoingCounterpartyAddress: counterparty,
    topOutgoingCounterpartyRaw: "98000000000",
    topOutgoingCounterpartyTxCount: 4,
    topOutgoingCounterpartyRatio: 1,
    inflowToOutflowRatio: 1.02,
    drainToServiceRatio: 0.98,
    timeToFirstOutgoingMs: 60_000,
    timeToFirstServiceExitMs: 60_000,
    depositThenDrainScore: 10,
    transitScore: 20,
    dampenerScore: 0,
    features: [],
    ...overrides
  };
}

function operationalProfile(
  overrides: Partial<OperationalFlowProfile> = {}
): OperationalFlowProfile {
  return {
    subjectAddress: subject,
    windowStart: "2026-05-01T00:00:00.000Z",
    windowEnd: "2026-07-11T00:00:00.000Z",
    incomingVolumeRaw: "100000000000",
    outgoingVolumeRaw: "98000000000",
    incomingTxCount: 18,
    outgoingTxCount: 4,
    inflowToOutflowRatio: 1.02,
    topIncomingCounterparties: [],
    topOutgoingCounterparties: [{
      address: counterparty,
      direction: "outgoing",
      volumeRaw: "98000000000",
      txCount: 4,
      volumeRatio: 1,
      category: "cex",
      identity: "Bybit",
      isTerminalLiquidity: true,
      isHtxHuobi: false
    }],
    categoryBreakdown: [],
    terminalLiquidityIncomingRatio: 0,
    terminalLiquidityOutgoingRatio: 1,
    htxHuobiIncomingRatio: 0,
    htxHuobiOutgoingRatio: 0,
    bridgeDexRouterOutgoingRatio: 0,
    unknownContractOutgoingRatio: 0,
    historicalTransitScore: 20,
    historicalTransitBreakdown: {
      eligible: true,
      flowUsdt: 100_000,
      volumeScore: 5,
      passThrough: 0.98,
      passThroughScore: 5,
      serviceShare: 1,
      serviceShareScore: 5,
      score: 15
    },
    operationalScore: 20,
    features: [],
    ...overrides
  };
}

describe("wallet narrative signal catalogue", () => {
  it("states the checked subject's active USDT restriction in plain RU and EN", () => {
    const fact = catalogueApi.subjectBlacklistFact({
      subjectAddress: subject,
      tokenContract: `T${"9".repeat(33)}`,
      tokenSymbol: "USDT",
      tokenStandard: "TRC20",
      decimals: 6,
      isBlacklisted: true,
      balanceRaw: "1000000",
      checkedAt: "2026-07-11T00:00:00.000Z",
      evidenceStrength: "exact_contract_state",
      methods: { blacklist: "isBlackListed(address)", balance: "balanceOf(address)" }
    });

    expect(fact?.factTextRu).toMatch(/адрес находится в ч[её]рном списке USDT/i);
    expect(fact?.factTextRu).toMatch(/переводы .*заблокированы|USDT .*заморожен/i);
    expect(fact?.factTextEn).toMatch(/address is on the USDT blacklist/i);
    expect(fact?.factTextEn).toMatch(/transfers are blocked|USDT .*frozen/i);
  });

  it.each([
    {
      role: "victim",
      checkedAddress: subject,
      walletRole: "drainer_spender",
      expectedRu: /жертва.*списан|списали.*жертва/i,
      expectedEn: /victim.*debit|debited.*victim/i,
      forbidden: /контракт-дрейнер|drainer contract/i
    },
    {
      role: "drainer_spender",
      checkedAddress: `T${"3".repeat(33)}`,
      walletRole: "victim",
      expectedRu: /получил доступ.*списал|контракт-дрейнер/i,
      expectedEn: /obtained access.*debited|drainer contract/i
    },
    {
      role: "first_receiver",
      checkedAddress: `T${"4".repeat(33)}`,
      walletRole: "victim",
      expectedRu: /первым получил.*850 USDT/i,
      expectedEn: /first.*receive.*850 USDT/i
    },
    {
      role: "route_linked",
      checkedAddress: `T${"5".repeat(33)}`,
      walletRole: "victim",
      profile: {
        subjectAddress: `T${"5".repeat(33)}`,
        hopDepth: 2 as const,
        amountPreservationRatio: 0.96,
        pathAddresses: [subject, `T${"3".repeat(33)}`, `T${"4".repeat(33)}`, `T${"5".repeat(33)}`]
      },
      expectedRu: /следующее звено|дальше по цепочке/i,
      expectedEn: /later link|farther along/i
    }
  ])("renders exact approval-drain role $role without role confusion", (row) => {
    const fact = catalogueApi.approvalDrainRoleFact({
      checkedAddress: row.checkedAddress,
      walletRole: row.walletRole,
      profile: approvalProfile(row.profile)
    });
    const copy = `${fact?.factTextRu}\n${fact?.factTextEn}`;

    expect(fact?.factTextRu).toMatch(row.expectedRu);
    expect(fact?.factTextEn).toMatch(row.expectedEn);
    if (row.forbidden) expect(copy).not.toMatch(row.forbidden);
  });

  it("does not let a stale walletRole assign an approval-drain role", () => {
    expect(catalogueApi.approvalDrainRoleFact({
      checkedAddress: `T${"8".repeat(33)}`,
      walletRole: "victim",
      profile: approvalProfile()
    })).toBeNull();
  });

  it("uses victim precedence only when the checked address is the victim", () => {
    const fact = catalogueApi.approvalDrainRoleFact({
      checkedAddress: subject,
      walletRole: "first_receiver",
      profile: approvalProfile({ spenderAddress: subject, firstReceiverAddress: subject })
    });

    expect(fact?.role).toBe("victim");
  });

  it("does not create approval-drain evidence from a method name alone", () => {
    expect(catalogueApi.approvalDrainRoleFact({
      checkedAddress: subject,
      walletRole: "unknown",
      method: "transferFrom"
    })).toBeNull();
  });

  it("renders the canonical route_linked approval profile as context", () => {
    const fact = catalogueApi.approvalDrainRoleFact({
      checkedAddress: `T${"5".repeat(33)}`,
      walletRole: "unknown",
      profile: approvalProfile({
        subjectAddress: `T${"5".repeat(33)}`,
        hopDepth: 2,
        amountPreservationRatio: 0.96,
        evidenceStrength: "route_linked",
        pathAddresses: [subject, `T${"4".repeat(33)}`, `T${"5".repeat(33)}`]
      })
    });

    expect(fact?.role).toBe("route_linked");
    expect(fact?.proofStrength).toBe("context");
    expect(`${fact?.factTextRu}\n${fact?.factTextEn}`).not.toMatch(/контракт-дрейнер|drainer contract/i);
  });

  it.each([
    {
      role: "verify20_contract",
      fingerprintMatched: true,
      expectedRu: /полный.*Verify20.*часто используют дрейнеры/i,
      expectedEn: /full.*Verify20.*often used by drainers/i,
      forbidden: /конкретн.*краж|specific theft.*proven/i
    },
    {
      role: "approval_only",
      fingerprintMatched: true,
      expectedRu: /открыл.*Verify20 доступ.*Списания.*не было.*Отзовите/i,
      expectedEn: /granted Verify20 access.*no debit.*Revoke/i
    },
    {
      role: "interaction_only",
      fingerprintMatched: true,
      expectedRu: /роль не установлена.*ручн/i,
      expectedEn: /role is unknown.*manual review/i,
      forbidden: /кошел[её]к — дрейнер|the wallet is a drainer/i
    }
  ])("renders Verify20 role $role without promoting interaction", (row) => {
    const fact = catalogueApi.verify20RoleFact({
      subjectAddress: subject,
      role: row.role,
      fingerprint: {
        matched: row.fingerprintMatched,
        selectors: [],
        blockedByTrustedService: false,
        missingSelectors: [],
        mismatchedSelectors: []
      },
      debitObserved: false
    });
    const copy = `${fact?.factTextRu}\n${fact?.factTextEn}`;

    expect(fact?.factTextRu).toMatch(row.expectedRu);
    expect(fact?.factTextEn).toMatch(row.expectedEn);
    if (row.forbidden) expect(copy).not.toMatch(row.forbidden);
  });

  it("requires the exact Verify20 fingerprint for a subject template fact", () => {
    expect(catalogueApi.verify20RoleFact({
      subjectAddress: subject,
      role: "verify20_contract",
      fingerprint: {
        matched: false,
        selectors: [],
        blockedByTrustedService: false,
        missingSelectors: [],
        mismatchedSelectors: []
      },
      method: "Verify20(address,address,address,uint256)"
    })).toBeNull();
  });

  it.each([
    {
      relation: "active_at_transfer" as const,
      direction: "inbound" as const,
      expectedRu: /Входящий:.*T222…2222.*25 000 USDT.*Контрагент/i,
      chronologyRu: /уже находился в ч[её]рном списке/i,
      expectedEn: /Inbound:.*25,000 USDT.*T222…2222/i
    },
    {
      relation: "active_at_transfer" as const,
      direction: "outbound" as const,
      expectedRu: /Исходящий:.*T222…2222.*25 000 USDT.*Контрагент/i,
      chronologyRu: /уже находился в ч[её]рном списке/i,
      expectedEn: /Outbound:.*25,000 USDT.*T222…2222/i
    },
    {
      relation: "mixed" as const,
      direction: "outbound" as const,
      fact: {
        beforeEffectiveAmountRaw: "20000000000",
        beforeEffectiveTxCount: 1,
        activeAmountRaw: "5000000000",
        activeTxCount: 1
      },
      expectedRu: /Исходящий:/i,
      chronologyRu: /до блокировки.*20 000 USDT.*после.*5 000 USDT/i,
      expectedEn: /Outbound:/i
    },
    {
      relation: "unknown" as const,
      direction: "inbound" as const,
      expectedRu: /Входящий:/i,
      chronologyRu: /дату блокировки установить не удалось/i,
      expectedEn: /Inbound:/i,
      forbidden: /уже находился|после перевода|before the transfer|after the transfer/i
    }
  ])("renders direct blacklist $direction/$relation from typed facts", (row) => {
    const [fact] = catalogueApi.firstHopBlacklistFacts(subject, [
      blacklistFact({
        direction: row.direction,
        temporalRelation: row.relation,
        ...(row.fact ?? {})
      })
    ]);
    const copy = `${fact?.factTextRu}\n${fact?.factTextEn}`;

    expect(fact?.factTextRu).toMatch(row.expectedRu);
    expect(fact?.factTextRu).toMatch(row.chronologyRu);
    expect(fact?.factTextEn).toMatch(row.expectedEn);
    if (row.forbidden) expect(copy).not.toMatch(row.forbidden);
    if (row.direction === "outbound") {
      expect(copy).not.toMatch(/источник (?:текущего )?баланса|source of (?:the )?(?:current )?balance/i);
    }
    expect(copy).not.toMatch(/проверяемый адрес находится в ч[её]рном списке|checked address is on the blacklist/i);
  });

  it("ties became-active-after chronology to the deterministic largest matched transfer", () => {
    const smallHash = "a".repeat(64);
    const largeHash = "c".repeat(64);
    const profiles = [interactionProfile([
      {
        txHash: smallHash,
        fromAddress: subject,
        toAddress: counterparty,
        amountRaw: "15000000",
        timestamp: "2026-05-26T09:44:33.000Z",
        method: "transfer",
        edgeType: "normal_transfer"
      },
      {
        txHash: largeHash,
        fromAddress: subject,
        toAddress: counterparty,
        amountRaw: "1176302000000",
        timestamp: "2026-05-26T09:56:18.000Z",
        method: "transfer",
        edgeType: "normal_transfer"
      }
    ])];
    const [fact] = catalogueApi.firstHopBlacklistFacts(subject, [
      blacklistFact({
        direction: "outbound",
        temporalRelation: "became_active_after",
        effectiveAt: "2026-05-26T12:49:03.000Z",
        principalAmountRaw: "1176317000000",
        principalTxCount: 2,
        directionalPrincipalShare: 1,
        transferTxHashes: [smallHash, largeHash],
        beforeEffectiveAmountRaw: "1176317000000",
        beforeEffectiveTxCount: 2,
        activeAmountRaw: "0",
        activeTxCount: 0
      })
    ], profiles);

    expect(fact?.factTextRu).toContain("1 176 317 USDT");
    expect(fact?.factTextRu).toMatch(/2 ч 52 мин .*1 176 302 USDT/i);
    expect(fact?.factTextEn).toMatch(/2 h 52 m .*1,176,302 USDT/i);
    expect(`${fact?.factTextRu}\n${fact?.factTextEn}`).not.toMatch(/45 с|45 s/);
    expect(`${fact?.factTextRu}\n${fact?.factTextEn}`).not.toContain("POISON");
  });

  it.each([
    ["2026-05-26T12:00:59.000Z", "2026-05-26T12:49:03.000Z", /48 мин|48 m/],
    ["2026-05-26T11:49:03.000Z", "2026-05-26T12:49:03.000Z", /1 ч 0 мин|1 h 0 m/]
  ])("formats blacklist elapsed time at useful minute precision", (timestamp, effectiveAt, expected) => {
    const txHash = "2".repeat(64);
    const [fact] = catalogueApi.firstHopBlacklistFacts(subject, [blacklistFact({
      temporalRelation: "became_active_after",
      effectiveAt,
      transferTxHashes: [txHash],
      principalTxCount: 1
    })], [interactionProfile([{
      txHash,
      fromAddress: counterparty,
      toAddress: subject,
      amountRaw: "25000000000",
      timestamp,
      method: "transfer",
      edgeType: "normal_transfer"
    }], { direction: "inbound" })]);

    expect(`${fact?.factTextRu}\n${fact?.factTextEn}`).toMatch(expected);
  });

  it.each([
    [1, /1 перевод\./, /in 1 transfer\./],
    [2, /2 перевода\./, /in 2 transfers\./],
    [5, /5 переводов\./, /in 5 transfers\./]
  ])("uses compact transfer-count grammar for %s direct transfers", (count, ru, en) => {
    const [fact] = catalogueApi.firstHopBlacklistFacts(subject, [blacklistFact({ principalTxCount: count })]);

    expect(fact?.factTextRu).toMatch(ru);
    expect(fact?.factTextEn).toMatch(en);
  });

  it("states that the subject is not blacklisted only from an exact negative subject check", () => {
    const exactNegative: StablecoinRestrictionProfile = {
      subjectAddress: subject,
      tokenContract: `T${"9".repeat(33)}`,
      tokenSymbol: "USDT",
      tokenStandard: "TRC20",
      decimals: 6,
      isBlacklisted: false,
      balanceRaw: "1000000",
      checkedAt: "2026-07-11T00:00:00.000Z",
      evidenceStrength: "exact_contract_state",
      methods: { blacklist: "isBlackListed(address)", balance: "balanceOf(address)" }
    };
    const [proved] = catalogueApi.firstHopBlacklistFacts(subject, [blacklistFact()], [], exactNegative);
    const [unknown] = catalogueApi.firstHopBlacklistFacts(subject, [blacklistFact()]);

    expect(proved?.factTextRu).toMatch(/сам адрес не в списке/i);
    expect(proved?.factTextEn).toMatch(/checked address not blacklisted/i);
    expect(`${unknown?.factTextRu}\n${unknown?.factTextEn}`).not.toMatch(/сам адрес не|checked address not/i);
  });

  it("does not apply a subject-clear restriction from another wallet", () => {
    const restriction: StablecoinRestrictionProfile = {
      subjectAddress: `T${"8".repeat(33)}`,
      tokenContract: `T${"9".repeat(33)}`,
      tokenSymbol: "USDT",
      tokenStandard: "TRC20",
      decimals: 6,
      isBlacklisted: false,
      balanceRaw: "1000000",
      checkedAt: "2026-07-11T00:00:00.000Z",
      evidenceStrength: "exact_contract_state",
      methods: { blacklist: "isBlackListed(address)", balance: "balanceOf(address)" }
    };
    const [fact] = catalogueApi.firstHopBlacklistFacts(subject, [blacklistFact()], [], restriction);

    expect(`${fact?.factTextRu}\n${fact?.factTextEn}`).not.toMatch(/сам проверяемый адрес.*не|checked address itself is not/i);
  });

  it("renders post-designation HTX sanctions only from matching sanctioned-service policy evidence", () => {
    const [fact] = catalogueApi.sourceAndRouteFacts({
      paths: [postDesignationHtxPath()],
      sourcePolicyEvidence: [postDesignationHtxPolicy()]
    });
    const copy = `${fact?.factTextRu}\n${fact?.meaningTextRu}\n${fact?.factTextEn}\n${fact?.meaningTextEn}`;

    expect(fact?.factTextRu).toMatch(/40 000 USDT.*40%.*HTX\/Huobi.*санкц.*Великобритани.*26 мая 2026/i);
    expect(fact?.factTextEn).toMatch(/40,000 USDT.*40%.*HTX\/Huobi.*UK sanctions.*26 May 2026/i);
    expect(fact?.meaningTextRu).toMatch(/прямой санкционный источник выбранной части суммы/i);
    expect(fact?.meaningTextEn).toMatch(/direct sanctioned source for the selected share/i);
    expect(copy).not.toMatch(/операцию не проводить|do not proceed/i);
    expect(copy).not.toMatch(/краж|theft/i);
  });

  it("keeps pre-designation HTX as material historical compliance risk from matched typed evidence", () => {
    const htx = SANCTIONED_CRYPTO_SERVICES.find((service) => service.key === "htx_huobi")!;
    const txHash = "7".repeat(64);
    const path = originPath({
      balanceTransferTxHash: txHash,
      exposureSourceKey: "htx_huobi",
      exposureSourceLabel: "HTX",
      sourceExposureKind: "htx_huobi",
      balanceShare: 0.4,
      txHashes: [txHash],
      steps: [{
        txHash,
        fromAddress: counterparty,
        toAddress: subject,
        amountRaw: "40000000000",
        timestamp: new Date(Date.parse(htx.designatedAt) - 1).toISOString()
      }]
    });
    const [fact] = catalogueApi.sourceAndRouteFacts({
      paths: [path],
      sourcePolicyEvidence: [policyEvidence({
        kind: "htx_huobi",
        proofLevel: "exchange_policy_context",
        evidenceIds: [txHash]
      })]
    });
    const copy = `${fact?.factTextRu}\n${fact?.meaningTextRu}\n${fact?.factTextEn}\n${fact?.meaningTextEn}`;

    expect(fact?.factTextRu).toMatch(/40 000 USDT.*40%.*HTX.*до.*санкцион/i);
    expect(fact?.factTextEn).toMatch(/40,000 USDT.*40%.*HTX.*before.*sanction/i);
    expect(fact?.meaningTextRu).toBe("Это историческая связь с HTX. Она остаётся существенным compliance-риском: принимающая биржа может задержать средства и запросить дополнительную проверку их происхождения.");
    expect(fact?.meaningTextEn).toBe("This is a historical HTX link and remains material compliance context: a receiving exchange may delay the funds and request additional source-of-funds checks.");
    expect(fact?.scoreSignalKeys).toEqual(["htx_huobi", "source_policy:htx_huobi"]);
    expect(copy).not.toMatch(/на дату перевода.*санкц|sanctioned at transfer|обычн.*бирж|clean CEX|операци.*не провод|do not proceed/i);
  });

  it("uses the exact HTX boundary and never promotes the name alone", () => {
    const htx = SANCTIONED_CRYPTO_SERVICES.find((service) => service.key === "htx_huobi")!;
    const txHash = "8".repeat(64);
    const boundaryPath = postDesignationHtxPath();
    boundaryPath.steps[0]!.timestamp = htx.designatedAt;
    const [atBoundary] = catalogueApi.sourceAndRouteFacts({
      paths: [boundaryPath],
      sourcePolicyEvidence: [postDesignationHtxPolicy()]
    });
    const namedOnlyPath = originPath({
      balanceTransferTxHash: txHash,
      exposureSourceKey: "htx_huobi",
      exposureSourceLabel: "HTX",
      sourceExposureKind: "htx_huobi",
      txHashes: [txHash],
      steps: [{
        txHash,
        fromAddress: counterparty,
        toAddress: subject,
        amountRaw: "40000000000",
        timestamp: htx.designatedAt
      }]
    });
    const [namedOnly] = catalogueApi.sourceAndRouteFacts({ paths: [namedOnlyPath] });
    const [unmatched] = catalogueApi.sourceAndRouteFacts({
      paths: [boundaryPath],
      sourcePolicyEvidence: [policyEvidence({
        kind: "sanctioned_service",
        evidenceIds: ["6".repeat(64)]
      })]
    });

    expect(atBoundary?.kind).toBe("sanctioned_source");
    expect(atBoundary?.meaningTextRu).toMatch(/прямой санкционный источник/i);
    expect(namedOnly?.kind).not.toBe("sanctioned_source");
    expect(`${namedOnly?.factTextRu}\n${namedOnly?.meaningTextRu}`).not.toMatch(/прямой санкционный|на дату перевода.*санкц/i);
    expect(unmatched?.proofStrength).toBe("context");
    expect(`${unmatched?.factTextRu}\n${unmatched?.meaningTextRu}`).not.toMatch(/прямой санкционный источник/i);
  });

  it.each([null, "Renamed exchange cluster"])(
    "uses typed HTX identity and the registry boundary when the label is %s",
    (label) => {
      const htx = SANCTIONED_CRYPTO_SERVICES.find((service) => service.key === "htx_huobi")!;
      const txHash = `${label === null ? "4" : "5"}`.repeat(64);
      const path = originPath({
        balanceTransferTxHash: txHash,
        exposureSourceKey: "htx_huobi",
        exposureSourceLabel: label,
        sourceExposureKind: "sanctioned_service",
        txHashes: [txHash],
        steps: [{
          txHash,
          fromAddress: counterparty,
          toAddress: subject,
          amountRaw: "40000000000",
          timestamp: htx.designatedAt
        }]
      });
      const [fact] = catalogueApi.sourceAndRouteFacts({
        paths: [path],
        sourcePolicyEvidence: [policyEvidence({
          kind: "sanctioned_service",
          evidenceIds: [txHash]
        })]
      });
      const copy = `${fact?.factTextRu}\n${fact?.factTextEn}`;

      expect(fact?.kind).toBe("sanctioned_source");
      expect(copy).toMatch(/HTX|Huobi/i);
      expect(copy).toMatch(/Великобритани|UK sanctions/i);
      expect(copy).not.toContain("Renamed exchange cluster");
      expect(copy).not.toContain("..");
    }
  );

  it("does not infer HTX sanctions identity or UK date from a label without the typed key", () => {
    const htx = SANCTIONED_CRYPTO_SERVICES.find((service) => service.key === "htx_huobi")!;
    const txHash = "6".repeat(64);
    const [fact] = catalogueApi.sourceAndRouteFacts({
      paths: [originPath({
        balanceTransferTxHash: txHash,
        exposureSourceKey: "other_sanctioned_service",
        exposureSourceLabel: "HTX lookalike desk",
        sourceExposureKind: "sanctioned_service",
        txHashes: [txHash],
        steps: [{
          txHash,
          fromAddress: counterparty,
          toAddress: subject,
          amountRaw: "40000000000",
          timestamp: htx.designatedAt
        }]
      })],
      sourcePolicyEvidence: [policyEvidence({
        kind: "sanctioned_service",
        evidenceIds: [txHash]
      })]
    });
    const copy = `${fact?.factTextRu}\n${fact?.factTextEn}`;

    expect(fact?.kind).toBe("sanctioned_source");
    expect(copy).not.toMatch(/Великобритани|UK sanctions|26 мая|26 May/i);
    expect(copy).not.toContain("HTX/Huobi Global");
  });

  it.each([
    ["mixer", "Known mixer", /35 000 USDT.*35%.*Known mixer/i, /миксер без установленного названия/i, /первоначальный источник.*нельзя.*проследить/i, "mixer_source"],
    ["no_name_token_liquidity", "Known pool", /35 000 USDT.*35%.*Known pool/i, /пул ликвидности без установленного названия/i, /источник.*не установлен/i, "unknown_source"],
    ["unknown_cex", "Known exchange service", /35 000 USDT.*35%.*Known exchange service/i, /биржевой сервис, название которого не удалось подтвердить/i, /общей ликвидност/i, "cex_source"],
    ["risky_label", "phishing", /35 000 USDT.*35%.*phishing/i, /источник с подтверждённой риск-меткой/i, /риск.*этой части суммы/i, "direct_counterparty_exact_label"],
    ["whitebit", "WhiteBIT", /35 000 USDT.*35%.*WhiteBIT/i, /WhiteBIT/i, /дополнительн.*проверк.*происхожд/i, "direct_counterparty_sanction"]
  ] as const)("renders matched typed %s exposure with named and unnamed identity", (kind, label, namedCopy, unnamedCopy, meaning, factKind) => {
    const txHash = kind.padEnd(64, "1").slice(0, 64);
    const build = (sourceLabel: string | null, evidenceIds = [txHash]) => catalogueApi.sourceAndRouteFacts({
      paths: [originPath({
        balanceTransferTxHash: txHash,
        rootSourceType: kind === "risky_label" ? "risky_label" : kind === "unknown_cex" ? "unknown" : "decline_boundary",
        exposureSourceLabel: sourceLabel,
        sourceExposureKind: kind,
        balanceShare: 0.35,
        txHashes: [txHash],
        steps: [{
          txHash,
          fromAddress: counterparty,
          toAddress: subject,
          amountRaw: "35000000000",
          timestamp: "2026-05-25T00:00:00.000Z"
        }]
      })],
      sourcePolicyEvidence: [policyEvidence({
        kind,
        aggregateShare: 0.35,
        effectiveShare: 0.35,
        evidenceIds,
        reasons: ["POISON_RAW_REASON"],
        warnings: ["POISON_RAW_WARNING"],
        shareDetail: {
          ...policyEvidence().shareDetail!,
          affectedAmountRaw: "35000000000",
          rawShare: 0.35,
          effectiveShare: 0.35
        }
      })]
    });
    const [named] = build(label);
    const [unnamed] = build(null);

    expect(named?.kind).toBe(factKind);
    expect(named?.factTextRu).toMatch(namedCopy);
    expect(unnamed?.factTextRu).toMatch(/35 000 USDT.*35%/i);
    expect(unnamed?.factTextRu).toMatch(unnamedCopy);
    expect(named?.meaningTextRu).toMatch(meaning);
    expect(unnamed?.meaningTextRu).toMatch(meaning);
    expect(named?.scoreSignalKeys).toEqual([kind, `source_policy:${kind}`].sort());
    expect(JSON.stringify([named, unnamed])).not.toMatch(/POISON_RAW_(?:REASON|WARNING)/);
    expect(build(label, ["0".repeat(64)])).toEqual([]);
  });

  it("renders another canonical sanctioned service without inventing authority or date", () => {
    const txHash = "5".repeat(64);
    const [fact] = catalogueApi.sourceAndRouteFacts({
      paths: [originPath({
        exposureSourceLabel: "Example Sanctioned Service",
        sourceExposureKind: "sanctioned_service",
        txHashes: [txHash]
      })],
      sourcePolicyEvidence: [policyEvidence({
        kind: "sanctioned_service",
        evidenceIds: [txHash],
        shareDetail: {
          ...policyEvidence().shareDetail!,
          affectedAmountRaw: "25000000000",
          rawShare: 0.25,
          effectiveShare: 0.25
        }
      })]
    });
    const copy = `${fact?.factTextRu}\n${fact?.meaningTextRu}\n${fact?.factTextEn}\n${fact?.meaningTextEn}`;

    expect(copy).toMatch(/25 000 USDT.*25%.*Example Sanctioned Service.*санкцион|25,000 USDT.*25%.*Example Sanctioned Service.*sanctioned/is);
    expect(copy).toMatch(/прямой санкционный источник|direct sanctioned source/i);
    expect(copy).not.toMatch(/операцию не проводить|do not proceed/i);
    expect(copy).not.toMatch(/Великобритани|\bUK\b|26 мая|26 May/i);
  });

  it("describes aggregate exposure to multiple sanctioned services without assigning it to one", () => {
    const alphaHash = "1".repeat(64);
    const zuluHash = "2".repeat(64);
    const makePath = (label: string, txHash: string, share: number, amountRaw: string) => originPath({
      balanceTransferTxHash: txHash,
      rootSourceType: "decline_boundary",
      exposureSourceLabel: label,
      sourceExposureKind: "sanctioned_service",
      balanceShare: share,
      txHashes: [txHash],
      amountUsage: {
        anchorAmountRaw: "100000000000",
        originalAmountRaw: amountRaw,
        usedAmountRaw: amountRaw,
        coverageShare: share,
        role: "anchor"
      },
      steps: [{
        txHash,
        fromAddress: counterparty,
        toAddress: subject,
        amountRaw,
        timestamp: "2026-05-27T00:00:00.000Z"
      }]
    });
    const paths = [
      makePath("Zulu Sanctioned", zuluHash, 0.2, "20000000000"),
      makePath("Alpha Sanctioned", alphaHash, 0.3, "30000000000")
    ];
    const evidence = policyEvidence({
      kind: "sanctioned_service",
      aggregateShare: 0.5,
      effectiveShare: 0.5,
      pathCount: 2,
      evidenceIds: [zuluHash, alphaHash],
      shareDetail: {
        ...policyEvidence().shareDetail!,
        affectedAmountRaw: "50000000000",
        rawShare: 0.5,
        effectiveShare: 0.5
      }
    });
    const build = (orderedPaths: MoneyOriginPath[]) => catalogueApi.sourceAndRouteFacts({
      paths: orderedPaths,
      sourcePolicyEvidence: [evidence]
    }).find((fact) => fact.kind === "sanctioned_source");
    const forward = build(paths);
    const reversed = build([...paths].reverse());
    const copy = `${forward?.factTextRu}\n${forward?.meaningTextRu}\n${forward?.factTextEn}\n${forward?.meaningTextEn}`;

    expect(forward?.factTextRu).toMatch(/50 000 USDT.*50%.*нескольких санкционных сервисов.*санкцион/i);
    expect(forward?.factTextEn).toMatch(/50,000 USDT.*50%.*multiple sanctioned services.*sanctioned/i);
    expect(copy).toMatch(/прямой санкционный источник|direct sanctioned source/i);
    expect(copy).not.toMatch(/операцию не проводить|do not proceed/i);
    expect(copy).not.toMatch(/50[ ,]000 USDT.*(?:пришло с|came from) (?:Alpha|Zulu)/i);
    expect(reversed).toEqual(forward);
  });

  it("keeps ordinary HTX and unmatched evidence as plain inbound context", () => {
    const path = originPath({
      exposureSourceKey: "htx_huobi",
      exposureSourceLabel: "HTX/Huobi",
      sourceExposureKind: "htx_huobi",
      txHashes: ["7".repeat(64)]
    });
    const cases = [
      policyEvidence({ proofLevel: "exchange_policy_context", evidenceIds: path.txHashes }),
      policyEvidence({ proofLevel: "exchange_policy_decline", evidenceIds: path.txHashes }),
      policyEvidence({ kind: "sanctioned_service", proofLevel: "exchange_policy_decline", evidenceIds: path.txHashes }),
      policyEvidence({ proofLevel: "exchange_policy_decline", evidenceIds: ["6".repeat(64)] })
    ];

    for (const evidence of cases) {
      const [fact] = catalogueApi.sourceAndRouteFacts({ paths: [path], sourcePolicyEvidence: [evidence] });
      expect(fact?.factTextRu).toMatch(/входящ.*HTX\/Huobi.*контекст|не входит в выбранн/i);
      expect(`${fact?.factTextRu}\n${fact?.factTextEn}`).not.toMatch(/операцию не проводить|do not proceed|policy/i);
    }
  });

  it("fails closed when sanctioned-service evidence does not match the selected path", () => {
    const txHash = "8".repeat(64);
    const path = originPath({
      exposureSourceLabel: "Example Sanctioned Service",
      sourceExposureKind: "sanctioned_service",
      txHashes: [txHash]
    });
    const [fact] = catalogueApi.sourceAndRouteFacts({
      paths: [path],
      sourcePolicyEvidence: [policyEvidence({
        kind: "sanctioned_service",
        evidenceIds: ["4".repeat(64)]
      })]
    });

    expect(fact?.kind).toBe("direct_counterparty_sanction");
    expect(`${fact?.factTextRu}\n${fact?.factTextEn}`).not.toMatch(/операцию не проводить|do not proceed/i);
  });

  it("renders outbound HTX from canonical operational flow as sent/to context", () => {
    const profile = operationalProfile({
      topOutgoingCounterparties: [{
        address: counterparty,
        direction: "outgoing",
        volumeRaw: "25000000000",
        txCount: 2,
        volumeRatio: 0.25,
        category: "cex",
        identity: "HTX/Huobi",
        isTerminalLiquidity: true,
        isHtxHuobi: true
      }],
      htxHuobiOutgoingRatio: 0.25
    });
    const [fact] = catalogueApi.sourceAndRouteFacts({ operationalFlowProfiles: [profile] });
    const copy = `${fact?.factTextRu}\n${fact?.meaningTextRu}\n${fact?.factTextEn}\n${fact?.meaningTextEn}`;

    expect(fact?.factTextRu).toMatch(/Исходящий:.*отправил 25 000 USDT.*на HTX\/Huobi.*2 перевод/i);
    expect(fact?.factTextEn).toMatch(/Outbound:.*sent 25,000 USDT.*to HTX\/Huobi.*2 transfers/i);
    expect(copy).not.toMatch(/источник баланса|source of.*balance|операцию не проводить|do not proceed/i);
  });

  it.each([
    { pathCount: 1, repeated: false },
    { pathCount: 10, repeated: true }
  ])("renders canonical bridge route with cross-chain and AML meaning (paths=$pathCount)", ({ pathCount, repeated }) => {
    const paths = Array.from({ length: pathCount }, (_, index) => originPath({
      balanceTransferTxHash: `${index + 1}`.repeat(64).slice(0, 64),
      exposureSourceLabel: "UsdtOFT",
      sourceExposureKind: "cross_chain_boundary",
      balanceShare: 0.83 / pathCount,
      txHashes: [`${index + 1}`.repeat(64).slice(0, 64)],
      stoppedReason: "service_boundary",
      rootSourceType: "decline_boundary"
    }));
    const [fact] = catalogueApi.sourceAndRouteFacts({
      paths,
      sourcePolicyEvidence: [policyEvidence({
        kind: "cross_chain_boundary",
        aggregateShare: 0.83,
        effectiveShare: 0.83,
        pathCount,
        proofLevel: "exchange_policy_context",
        evidenceIds: paths.flatMap((path) => path.txHashes),
        shareDetail: {
          ...policyEvidence().shareDetail!,
          affectedAmountRaw: "83000000000",
          rawShare: 0.83,
          effectiveShare: 0.83
        }
      })]
    });
    const copy = `${fact?.factTextRu}\n${fact?.meaningTextRu}\n${fact?.factTextEn}\n${fact?.meaningTextEn}`;

    expect(copy).toMatch(/83%.*UsdtOFT/i);
    if (repeated) {
      expect(copy).toMatch(/10 перевод.*сильнее скрывает.*AML-риск|10 transfers.*obscures.*AML risk/is);
    } else {
      expect(copy).toMatch(/обычн.*перевод.*сет.*затруднить.*происхожд|ordinary cross-chain transfer.*checks harder/is);
    }
  });

  it.each([
    {
      kind: "cross_chain_boundary" as const,
      ru: /50%.*несколько cross-chain сервисов/i,
      en: /50%.*multiple cross-chain services/i
    },
    {
      kind: "bridge_router_dex" as const,
      ru: /50%.*несколько DEX\/router-сервисов/i,
      en: /50%.*multiple DEX\/router services/i
    }
  ])("uses aggregate $kind wording for multiple route identities", ({ kind, ru, en }) => {
    const paths = [
      aggregateRoutePath(kind, "Zulu Route", "1".repeat(64), 0.2, "20000000000"),
      aggregateRoutePath(kind, "Alpha Route", "2".repeat(64), 0.3, "30000000000")
    ];
    const forward = aggregateRouteFact(kind, paths);
    const reversed = aggregateRouteFact(kind, [...paths].reverse());
    const copy = `${forward?.factTextRu}\n${forward?.meaningTextRu}\n${forward?.factTextEn}\n${forward?.meaningTextEn}`;

    expect(forward?.factTextRu).toMatch(ru);
    expect(forward?.factTextEn).toMatch(en);
    expect(copy).not.toMatch(/50%.*(?:пришло|прошло|came|passed).*Alpha Route/i);
    if (kind === "cross_chain_boundary") expect(copy).toMatch(/сильнее скрывает.*AML-риск|obscures.*AML risk/is);
    expect(reversed).toEqual(forward);
  });

  it.each([
    {
      kind: "cross_chain_boundary" as const,
      ru: /несколько cross-chain сервисов/i,
      en: /multiple cross-chain services/i
    },
    {
      kind: "bridge_router_dex" as const,
      ru: /несколько DEX\/router-сервисов/i,
      en: /multiple DEX\/router services/i
    }
  ])("keeps $kind aggregate when one route identity is unnamed", ({ kind, ru, en }) => {
    const paths = [
      aggregateRoutePath(kind, "Alpha Route", "3".repeat(64), 0.2, "20000000000"),
      aggregateRoutePath(kind, null, "4".repeat(64), 0.3, "30000000000")
    ];
    const forward = aggregateRouteFact(kind, paths);
    const reversed = aggregateRouteFact(kind, [...paths].reverse());

    expect(forward?.factTextRu).toMatch(ru);
    expect(forward?.factTextEn).toMatch(en);
    if (kind === "cross_chain_boundary") {
      expect(`${forward?.meaningTextRu}\n${forward?.meaningTextEn}`).toMatch(/сильнее скрывает.*AML-риск|obscures.*AML risk/is);
    }
    expect(reversed).toEqual(forward);
  });

  it.each([
    { kind: "cross_chain_boundary" as const },
    { kind: "bridge_router_dex" as const }
  ])("keeps one proven $kind identity for an aggregate", ({ kind }) => {
    const paths = [
      aggregateRoutePath(kind, "Alpha Route", "5".repeat(64), 0.2, "20000000000"),
      aggregateRoutePath(kind, "Alpha Route", "6".repeat(64), 0.3, "30000000000")
    ];
    const forward = aggregateRouteFact(kind, paths);
    const reversed = aggregateRouteFact(kind, [...paths].reverse());
    const copy = `${forward?.factTextRu}\n${forward?.factTextEn}`;

    expect(copy).toMatch(/50%.*Alpha Route/is);
    expect(copy).not.toMatch(/несколько cross-chain|multiple cross-chain|несколько DEX\/router|multiple DEX\/router/i);
    expect(reversed).toEqual(forward);
  });

  it("describes a SUN.io bridge-router-DEX route without claiming a cross-chain boundary", () => {
    const txHash = "2".repeat(64);
    const [fact] = catalogueApi.sourceAndRouteFacts({
      paths: [originPath({
        balanceTransferTxHash: txHash,
        exposureSourceLabel: "SUN.io",
        sourceExposureKind: "bridge_router_dex",
        txHashes: [txHash]
      })],
      sourcePolicyEvidence: [policyEvidence({
        kind: "bridge_router_dex",
        proofLevel: "exchange_policy_context",
        evidenceIds: [txHash]
      })]
    });
    const copy = `${fact?.factTextRu}\n${fact?.meaningTextRu}\n${fact?.factTextEn}\n${fact?.meaningTextEn}`;

    expect(copy).toMatch(/SUN\.io.*DEX|SUN\.io.*router|SUN\.io.*обменн.*сервис/is);
    expect(copy).toMatch(/обычн.*обмен.*скры.*происхожд.*AML-риск|ordinary swaps.*hide.*origin.*AML risk/is);
    expect(copy).not.toMatch(/мост|bridge|друг.*сет|another chain|other chain/i);
  });

  it("uses localized EN fallbacks for unnamed service identities", () => {
    const sanctionedHash = "3".repeat(64);
    const sanctioned = catalogueApi.sourceAndRouteFacts({
      paths: [originPath({
        balanceTransferTxHash: sanctionedHash,
        rootSourceType: "decline_boundary",
        exposureSourceLabel: null,
        sourceExposureKind: "sanctioned_service",
        txHashes: [sanctionedHash]
      })],
      sourcePolicyEvidence: [policyEvidence({
        kind: "sanctioned_service",
        evidenceIds: [sanctionedHash]
      })]
    }).find((fact) => fact.kind === "sanctioned_source");
    const crossChain = catalogueApi.sourceAndRouteFacts({ paths: [originPath({
      rootSourceType: "decline_boundary",
      exposureSourceLabel: null,
      sourceExposureKind: "cross_chain_boundary"
    })] }).find((fact) => fact.kind === "bridge_route");
    const dexRouter = catalogueApi.sourceAndRouteFacts({ paths: [originPath({
      rootSourceType: "decline_boundary",
      exposureSourceLabel: null,
      sourceExposureKind: "bridge_router_dex"
    })] }).find((fact) => fact.kind === "bridge_route");
    const cex = catalogueApi.sourceAndRouteFacts({ paths: [originPath({
      exposureSourceLabel: null,
      sourceExposureKind: "allowlisted_cex"
    })] }).find((fact) => fact.kind === "cex_source");
    const english = [sanctioned, crossChain, dexRouter, cex].map((fact) => fact?.factTextEn ?? "");

    expect(english[0]).toMatch(/unnamed sanctioned service/i);
    expect(english[1]).toMatch(/unnamed cross-chain service/i);
    expect(english[2]).toMatch(/unnamed DEX\/router service/i);
    expect(english[3]).toMatch(/unnamed exchange service/i);
    expect(english.join("\n")).not.toMatch(/[А-Яа-яЁё]/);
    expect(crossChain?.meaningTextRu).toMatch(/перевод между сетями.*затруднить/i);
  });

  it("derives CEX and a proven unknown-contract stop from canonical paths", () => {
    const cex = originPath({ balanceShare: 1 });
    const unknown = originPath({
      balanceTransferTxHash: "6".repeat(64),
      rootSourceAddress: `T${"6".repeat(33)}`,
      rootSourceType: "incomplete",
      exposureSourceLabel: null,
      sourceExposureKind: "unknown_contract",
      balanceShare: 1,
      txHashes: ["6".repeat(64)],
      amountUsage: {
        anchorAmountRaw: "100000000000",
        originalAmountRaw: "10000000000",
        usedAmountRaw: "10000000000",
        coverageShare: 0.1,
        role: "anchor"
      },
      stoppedReason: "incoming_history_not_fetched",
      historyCoverage: [traceHistory({ statusReason: "partial_provider_cap" })]
    });
    const facts = catalogueApi.sourceAndRouteFacts({ paths: [cex, unknown] });
    const copy = facts.map((fact) => `${fact.factTextRu}\n${fact.meaningTextRu}\n${fact.factTextEn}\n${fact.meaningTextEn}`).join("\n");

    expect(copy).toMatch(/72%.*пришло с Binance|72%.*came from Binance/i);
    expect(copy).toMatch(/контракт без названия.*старые переводы.*источник[а]? данных|unnamed contract.*older transfers.*provider/is);
    expect(copy).not.toMatch(/контракт.*непрослеживаем|contract.*untraceable/i);
  });

  it.each([
    ["cex", "allowlisted_cex", "allowlist_cex", "Binance"],
    ["unknown contract", "unknown_contract", "unknown", "Unknown contract"]
  ] as const)("uses selected amount usage instead of raw balance share for %s narrative", (_name, sourceExposureKind, rootSourceType, label) => {
    const txHash = "a".repeat(64);
    const [fact] = catalogueApi.sourceAndRouteFacts({ paths: [originPath({
      balanceTransferTxHash: txHash,
      rootSourceType,
      exposureSourceKey: sourceExposureKind,
      exposureSourceLabel: label,
      sourceExposureKind,
      balanceShare: 1,
      txHashes: [txHash],
      amountUsage: {
        anchorAmountRaw: "100000000000",
        originalAmountRaw: "100000000000",
        usedAmountRaw: "40000000000",
        coverageShare: 0.4,
        role: "anchor"
      },
      steps: [{
        txHash,
        fromAddress: counterparty,
        toAddress: subject,
        amountRaw: "100000000000",
        timestamp: "2026-05-27T00:00:00.000Z"
      }]
    })] });
    const copy = `${fact?.factTextRu}\n${fact?.factTextEn}`;

    expect(copy).toMatch(/40 000 USDT.*40%|40,000 USDT.*40%/i);
    expect(copy).not.toMatch(/100 000 USDT|100,000 USDT|100%/i);
  });

  it.each([
    ["cex", "allowlisted_cex", "allowlist_cex", "Binance"],
    ["unknown contract", "unknown_contract", "unknown", "Unknown contract"]
  ] as const)("scales a %s branch amount and counts a duplicated physical transfer once", (_name, sourceExposureKind, rootSourceType, label) => {
    const txHash = "b".repeat(64);
    const path = originPath({
      balanceTransferTxHash: txHash,
      rootSourceType,
      exposureSourceKey: sourceExposureKind,
      exposureSourceLabel: label,
      sourceExposureKind,
      balanceShare: 0.5,
      txHashes: [txHash],
      amountUsage: {
        anchorAmountRaw: "100000000000",
        originalAmountRaw: "100000000000",
        usedAmountRaw: "100000000000",
        coverageShare: 1,
        role: "anchor"
      },
      steps: [{
        txHash,
        fromAddress: counterparty,
        toAddress: subject,
        amountRaw: "100000000000",
        timestamp: "2026-05-27T00:00:00.000Z"
      }]
    });
    const facts = catalogueApi.sourceAndRouteFacts({ paths: [path, { ...path }] });
    const copy = facts.map((fact) => `${fact.factTextRu}\n${fact.factTextEn}`).join("\n");

    expect(facts).toHaveLength(1);
    expect(copy).toMatch(/50 000 USDT.*50%|50,000 USDT.*50%/i);
    expect(copy).not.toMatch(/100 000 USDT|100,000 USDT|100%|200 000 USDT|200,000 USDT/i);
    if (sourceExposureKind === "allowlisted_cex") {
      expect(copy).toMatch(/1 перевод|1 transfer/i);
    }
  });

  it.each([
    ["sanctioned", /40 000 USDT.*40%.*HTX/i, /прямой санкционный источник/i],
    ["htx", /40 000 USDT.*40%.*HTX.*до.*санкцион/i, /существенным compliance-риском/i],
    ["cross_chain", /40 000 USDT.*40%.*UsdtOFT/i, /обычн.*перевод.*сет|затруднить.*происхожд/i],
    ["bridge_router_dex", /40 000 USDT.*40%.*SUN\.io/i, /более ранний источник.*сложнее/i],
    ["cex", /40 000 USDT.*40%.*Binance/i, /более ранний источник.*общей ликвидност/i],
    ["unknown_contract", /40 000 USDT.*40%.*Unknown contract/i, /назначение.*не удалось определить/i]
  ] as const)("splits %s source finding from its plain meaning", (scenario, finding, meaning) => {
    const txHash = scenario.padEnd(64, "2").slice(0, 64);
    const pathOverrides: Partial<MoneyOriginPath> = {
      balanceTransferTxHash: txHash,
      balanceShare: 1,
      txHashes: [txHash],
      amountUsage: {
        anchorAmountRaw: "100000000000",
        originalAmountRaw: "40000000000",
        usedAmountRaw: "40000000000",
        coverageShare: 0.4,
        role: "anchor"
      },
      steps: [{
        txHash,
        fromAddress: counterparty,
        toAddress: subject,
        amountRaw: "40000000000",
        timestamp: scenario === "htx" ? "2026-05-25T00:00:00.000Z" : "2026-05-27T00:00:00.000Z"
      }]
    };
    const sourcePolicyEvidence: SourcePolicyEvidence[] = [];
    if (scenario === "sanctioned") {
      Object.assign(pathOverrides, { exposureSourceKey: "htx_huobi", exposureSourceLabel: "HTX", sourceExposureKind: "sanctioned_service" });
      sourcePolicyEvidence.push(postDesignationHtxPolicy());
      sourcePolicyEvidence[0]!.evidenceIds = [txHash];
    } else if (scenario === "htx") {
      Object.assign(pathOverrides, { exposureSourceKey: "htx_huobi", exposureSourceLabel: "HTX", sourceExposureKind: "htx_huobi" });
      sourcePolicyEvidence.push(policyEvidence({ kind: "htx_huobi", proofLevel: "exchange_policy_context", evidenceIds: [txHash] }));
    } else if (scenario === "cross_chain") {
      Object.assign(pathOverrides, { rootSourceType: "decline_boundary", exposureSourceLabel: "UsdtOFT", sourceExposureKind: "cross_chain_boundary" });
      sourcePolicyEvidence.push(policyEvidence({ kind: "cross_chain_boundary", proofLevel: "exchange_policy_context", evidenceIds: [txHash] }));
    } else if (scenario === "bridge_router_dex") {
      Object.assign(pathOverrides, { rootSourceType: "decline_boundary", exposureSourceLabel: "SUN.io", sourceExposureKind: "bridge_router_dex" });
      sourcePolicyEvidence.push(policyEvidence({ kind: "bridge_router_dex", proofLevel: "exchange_policy_context", evidenceIds: [txHash] }));
    } else if (scenario === "cex") {
      Object.assign(pathOverrides, { rootSourceType: "allowlist_cex", exposureSourceLabel: "Binance", sourceExposureKind: "allowlisted_cex" });
    } else {
      Object.assign(pathOverrides, { rootSourceType: "unknown", exposureSourceLabel: "Unknown contract", sourceExposureKind: "unknown_contract" });
    }
    const [fact] = catalogueApi.sourceAndRouteFacts({
      paths: [originPath(pathOverrides)],
      sourcePolicyEvidence
    });

    expect(fact?.factTextRu).toMatch(finding);
    expect(fact?.meaningTextRu).toMatch(meaning);
    expect(fact?.factTextRu).not.toMatch(meaning);
    expect(fact?.meaningTextRu).not.toMatch(finding);
    expect(fact?.scoreSignalKeys?.length).toBeGreaterThan(0);

    const rendered = formatWalletNarrativeSummary(narrativeCase({ facts: [fact!] }));
    expect(rendered).toContain(fact!.factTextRu);
    expect(rendered).toContain(fact!.meaningTextRu!);
  });

  it.each([
    { count: 1, ru: /1 перевод\)/, en: /1 transfer\)/ },
    { count: 4, ru: /4 перевода\)/, en: /4 transfers\)/ }
  ])("counts $count unique CEX balance transfers", ({ count, ru, en }) => {
    const paths = Array.from({ length: count }, (_, index) => originPath({
      balanceTransferTxHash: String(index + 1).repeat(64).slice(0, 64),
      balanceShare: 0.1,
      txHashes: [String(index + 1).repeat(64).slice(0, 64)]
    }));
    paths.push({ ...paths[0]!, balanceShare: 0 });
    const [fact] = catalogueApi.sourceAndRouteFacts({ paths });

    expect(fact?.factTextRu).toMatch(ru);
    expect(fact?.factTextEn).toMatch(en);
  });

  it("does not call an unknown contract a terminal stop without canonical stop evidence", () => {
    const [fact] = catalogueApi.sourceAndRouteFacts({ paths: [originPath({
      rootSourceType: "unknown",
      exposureSourceLabel: null,
      sourceExposureKind: "unknown_contract",
      stoppedReason: "weak_amount_or_time_continuity",
      historyCoverage: []
    })] });
    const copy = `${fact?.factTextRu}\n${fact?.factTextEn}`;

    expect(copy).toMatch(/контракт без названия|unnamed contract/i);
    expect(copy).not.toMatch(/источник не установлен|could not be traced|границ|boundary/i);
  });

  it("explains a positively identified pooled service stop from canonical boundary evidence", () => {
    const profile: BoundaryExposureProfile = {
      subjectAddress: subject,
      incomingBoundaryVolumeRaw: "10000000000",
      outgoingBoundaryVolumeRaw: "0",
      incomingBoundaryVolumeRatio: 0.1,
      outgoingBoundaryVolumeRatio: 0,
      directBoundaryTxCount: 1,
      twoHopBoundaryTxCount: 0,
      topBoundaryEntities: [{
        address: counterparty,
        category: "router",
        identity: "Example Router",
        direction: "inbound",
        volumeRaw: "10000000000",
        txCount: 1,
        maxDepth: 1
      }],
      categoryBreakdown: [],
      flows: [{
        direction: "inbound",
        depth: 1,
        boundaryAddress: counterparty,
        boundaryCategory: "router",
        boundaryIdentity: "Example Router",
        viaAddress: null,
        subjectTxHash: "1".repeat(64),
        boundaryTxHash: "1".repeat(64),
        amountRaw: "10000000000",
        boundaryAmountRaw: "10000000000",
        amountPreservationRatio: 1,
        firstTransferAt: "2026-05-27T00:00:00.000Z",
        lastTransferAt: "2026-05-27T00:00:00.000Z"
      }],
      contextScore: 10,
      features: []
    };
    const [fact] = catalogueApi.sourceAndRouteFacts({ boundaryExposureProfiles: [profile] });

    expect(fact?.factTextRu).toMatch(/Example Router.*общ(?:ая|ей) ликвидность.*до сервиса.*не прослеживается/i);
    expect(fact?.factTextEn).toMatch(/Example Router.*pooled liquidity.*before the service.*cannot be traced/i);
  });

  it("derives collector share from the terminal amount and operational inflow", () => {
    const operational = operationalProfile({
      topOutgoingCounterparties: [
        {
          address: `T${"7".repeat(33)}`,
          direction: "outgoing",
          volumeRaw: "50000000000",
          txCount: 4,
          volumeRatio: 0.5,
          category: null,
          identity: "Ordinary peer",
          isTerminalLiquidity: false,
          isHtxHuobi: false
        },
        {
          address: `T${"8".repeat(33)}`,
          direction: "outgoing",
          volumeRaw: "25000000000",
          txCount: 2,
          volumeRatio: 0.25,
          category: "unknown_contract",
          identity: "Unknown contract",
          isTerminalLiquidity: false,
          isHtxHuobi: false
        },
        {
          address: counterparty,
          direction: "outgoing",
          volumeRaw: "20000000000",
          txCount: 2,
          volumeRatio: 0.25,
          category: "cex",
          identity: "Bybit",
          isTerminalLiquidity: true,
          isHtxHuobi: false
        }
      ]
    });
    const [fact] = catalogueApi.sourceAndRouteFacts({
      addressBehaviorProfiles: [behaviorProfile({ incomingVolumeRaw: "400000000000" })],
      operationalFlowProfiles: [operational]
    });
    const copy = `${fact?.factTextRu}\n${fact?.factTextEn}`;

    expect(copy).toMatch(/18 адресов.*20%.*Bybit.*кошел[её]к-сборщик|18 addresses.*20%.*Bybit.*collector wallet/is);
    expect(copy).not.toMatch(/Ordinary peer|Unknown contract|25%|50%|98%/i);
    expect(copy).not.toMatch(/грязн|винов|dirty|guilt/i);
  });

  it("does not invent a collector service destination when no outgoing row is terminal", () => {
    const operational = operationalProfile({
      topOutgoingCounterparties: [{
        address: counterparty,
        direction: "outgoing",
        volumeRaw: "98000000000",
        txCount: 8,
        volumeRatio: 0.98,
        category: null,
        identity: "Ordinary peer",
        isTerminalLiquidity: false,
        isHtxHuobi: false
      }]
    });
    const facts = catalogueApi.sourceAndRouteFacts({
      addressBehaviorProfiles: [behaviorProfile()],
      operationalFlowProfiles: [operational]
    });

    expect(facts.some((fact) => fact.kind === "collector")).toBe(false);
  });

  it.each([
    { name: "zero inflow", operationalIncomingVolumeRaw: "0" },
    { name: "invalid inflow", operationalIncomingVolumeRaw: "invalid" },
    { name: "destination above inflow", operationalIncomingVolumeRaw: "10000000000" }
  ])("uses amount-only collector copy for $name", ({ operationalIncomingVolumeRaw }) => {
    const [fact] = catalogueApi.sourceAndRouteFacts({
      addressBehaviorProfiles: [behaviorProfile({ incomingVolumeRaw: "777000000000" })],
      operationalFlowProfiles: [operationalProfile({
        incomingVolumeRaw: operationalIncomingVolumeRaw,
        topOutgoingCounterparties: [{
          address: counterparty,
          direction: "outgoing",
          volumeRaw: "20000000000",
          txCount: 2,
          volumeRatio: 0.25,
          category: "cex",
          identity: "Bybit",
          isTerminalLiquidity: true,
          isHtxHuobi: false
        }]
      })]
    });
    const copy = `${fact?.factTextRu}\n${fact?.factTextEn}`;

    expect(fact?.factTextRu).toMatch(/18 адресов.*отправляет 20 000 USDT.*Bybit.*кошел[её]к-сборщик/is);
    expect(fact?.factTextEn).toMatch(/18 addresses.*sends 20,000 USDT.*Bybit.*collector wallet/is);
    expect(copy).not.toContain("%");
  });

  it.each([
    { direction: "inbound" as const, ru: /Входящий:.*получил 35 000 USDT.*от.*высоким риском/i, en: /Inbound:.*received 35,000 USDT.*from.*high-risk/i },
    { direction: "outbound" as const, ru: /Исходящий:.*отправил 35 000 USDT.*адресу.*высоким риском/i, en: /Outbound:.*sent 35,000 USDT.*to.*high-risk/i }
  ])("renders $direction risky counterparty direction from canonical direct interactions", ({ direction, ru, en }) => {
    const fromAddress = direction === "inbound" ? counterparty : subject;
    const toAddress = direction === "inbound" ? subject : counterparty;
    const profile = interactionProfile([{
      txHash: "5".repeat(64),
      fromAddress,
      toAddress,
      amountRaw: "35000000000",
      timestamp: "2026-05-27T00:00:00.000Z",
      method: "transfer",
      edgeType: "normal_transfer",
      economicRole: "principal"
    }], {
      direction,
      volumeRaw: "35000000000",
      volumeRatio: 0.35,
      snapshot: {
        address: counterparty,
        riskScore: 85,
        riskLevel: "CRITICAL",
        source: "fast_address_check",
        evidenceClass: "counterparty_fast_risk_snapshot",
        reasons: ["POISON risk reasons"],
        partialNotes: []
      }
    });
    const [fact] = catalogueApi.sourceAndRouteFacts({ directCounterpartyInteractionProfiles: [profile] });
    const copy = `${fact?.factTextRu}\n${fact?.factTextEn}`;

    expect(fact?.factTextRu).toMatch(ru);
    expect(fact?.factTextEn).toMatch(en);
    expect(copy).toMatch(/35%/);
    expect(copy).toMatch(/эта часть суммы|that share/i);
    if (direction === "outbound") expect(copy).not.toMatch(/источник|source of.*balance/i);
  });

  it("renders exact label codes and never treats recordedAt as an effective criminal date", () => {
    const labels: FirstHopLabelFact[] = [
      {
        counterpartyAddress: counterparty,
        direction: "inbound",
        labelCode: "stolen_funds",
        evidenceAuthority: "exact_internal",
        recordedAt: "2099-12-31T23:59:59.000Z",
        effectiveAt: null,
        principalAmountRaw: "1000000000",
        principalTxCount: 1,
        directionalPrincipalShare: 0.1,
        shareSemantics: "exact",
        transferTxHashes: ["a".repeat(64)],
        linkedToSelectedProvenance: true
      },
      {
        counterpartyAddress: `T${"6".repeat(33)}`,
        direction: "outbound",
        labelCode: "approval_drain_proximity",
        evidenceAuthority: "derived",
        recordedAt: "2099-12-31T23:59:59.000Z",
        effectiveAt: null,
        principalAmountRaw: "500000000",
        principalTxCount: 1,
        directionalPrincipalShare: 0.05,
        shareSemantics: "exact",
        transferTxHashes: ["b".repeat(64)],
        linkedToSelectedProvenance: false
      }
    ];
    const facts = catalogueApi.sourceAndRouteFacts({ firstHopLabelFacts: labels });
    const copy = facts.map((fact) => `${fact.factTextRu}\n${fact.factTextEn}`).join("\n");

    expect(copy).toMatch(/украденн|stolen funds/i);
    expect(copy).toMatch(/контекст|context/i);
    expect(copy).not.toContain("2099");
  });

  it.each([
    ["bridge", "bridge_route", /мост|bridge/i],
    ["exchange", "cex_source", /бирж|exchange/i],
    ["whitebit", "cex_source", /WhiteBIT/i],
    ["trusted", "cex_source", /доверенн.*сервис|trusted service/i],
    ["collector", "collector", /сборщик|collector/i],
    ["mule", "collector", /транзитн.*посредник|mule/i],
    ["victim", "risky_counterparty", /жертв|victim/i],
    ["needs_review", "risky_counterparty", /ручн.*провер|manual review/i],
    ["darknet_exchange_proximity", "risky_counterparty", /контекст|context/i],
    ["approval_drain_proximity", "risky_counterparty", /контекст|context/i]
  ] as const)("maps benign/context label %s to %s without automatic adverse wording", (labelCode, kind, copy) => {
    const [fact] = catalogueApi.sourceAndRouteFacts({ firstHopLabelFacts: [{
      counterpartyAddress: counterparty,
      direction: "inbound",
      labelCode,
      evidenceAuthority: labelCode === "approval_drain_proximity" ? "derived" : "exact_internal",
      recordedAt: "2099-12-31T23:59:59.000Z",
      effectiveAt: null,
      principalAmountRaw: "1000000000",
      principalTxCount: 1,
      directionalPrincipalShare: 0.1,
      shareSemantics: "exact",
      transferTxHashes: ["4".repeat(64)],
      linkedToSelectedProvenance: false
    }] });

    expect(fact?.kind).toBe(kind);
    expect(`${fact?.factTextRu}\n${fact?.factTextEn}`).toMatch(copy);
    expect(`${fact?.factTextRu}\n${fact?.factTextEn}`).not.toMatch(/точная плохая метка|exact adverse label|2099/i);
    if (labelCode === "victim") {
      expect(`${fact?.factTextRu}\n${fact?.factTextEn}`).not.toMatch(/дрейнер|drainer/i);
    }
  });

  it("physically deduplicates overlapping route and label evidence regardless of input order", () => {
    const firstHash = "1".repeat(64);
    const secondHash = "2".repeat(64);
    const paths = [
      originPath({
        balanceTransferTxHash: firstHash,
        rootSourceType: "decline_boundary",
        exposureSourceLabel: "UsdtOFT",
        sourceExposureKind: "cross_chain_boundary",
        txHashes: [firstHash]
      }),
      originPath({
        balanceTransferTxHash: secondHash,
        rootSourceType: "decline_boundary",
        exposureSourceLabel: "LayerZero",
        sourceExposureKind: "cross_chain_boundary",
        txHashes: [secondHash]
      })
    ];
    const labels: FirstHopLabelFact[] = [firstHash, secondHash].map((hash, index) => ({
      counterpartyAddress: `T${String(index + 4).repeat(33)}`,
      direction: "inbound",
      labelCode: "bridge",
      evidenceAuthority: "exact_internal",
      recordedAt: "2026-07-11T00:00:00.000Z",
      effectiveAt: null,
      principalAmountRaw: "1000000",
      principalTxCount: 1,
      directionalPrincipalShare: 0.01,
      shareSemantics: "exact",
      transferTxHashes: [hash],
      linkedToSelectedProvenance: true
    }));

    const forward = catalogueApi.sourceAndRouteFacts({ paths, firstHopLabelFacts: labels });
    const reversed = catalogueApi.sourceAndRouteFacts({
      paths: [...paths].reverse(),
      firstHopLabelFacts: [...labels].reverse()
    });
    const bridgeFacts = forward.filter((fact) => fact.kind === "bridge_route");

    expect(bridgeFacts).toHaveLength(1);
    expect(bridgeFacts[0]?.evidenceIds).toEqual([firstHash, secondHash, "9".repeat(64)]);
    expect(bridgeFacts[0]?.meaningTextEn).toMatch(/repeated bridge route.*AML risk/i);
    expect(reversed).toEqual(forward);
  });

  it("does not deduplicate different semantic kinds that share one transaction", () => {
    const txHash = "3".repeat(64);
    const facts = catalogueApi.sourceAndRouteFacts({
      paths: [originPath({
        balanceTransferTxHash: txHash,
        rootSourceType: "decline_boundary",
        exposureSourceLabel: "UsdtOFT",
        sourceExposureKind: "cross_chain_boundary",
        txHashes: [txHash]
      })],
      firstHopLabelFacts: [{
        counterpartyAddress: counterparty,
        direction: "inbound",
        labelCode: "scam",
        evidenceAuthority: "exact_internal",
        recordedAt: "2026-07-11T00:00:00.000Z",
        effectiveAt: null,
        principalAmountRaw: "1000000",
        principalTxCount: 1,
        directionalPrincipalShare: 0.01,
        shareSemantics: "exact",
        transferTxHashes: [txHash],
        linkedToSelectedProvenance: true
      }]
    });

    expect(facts.map((fact) => fact.kind)).toEqual(["direct_counterparty_exact_label", "bridge_route"]);
    expect(facts.every((fact) => fact.evidenceIds?.includes(txHash))).toBe(true);
  });

  it("omits false-positive labels and keeps derived adverse labels contextual", () => {
    const label = (labelCode: FirstHopLabelFact["labelCode"], evidenceAuthority: FirstHopLabelFact["evidenceAuthority"]): FirstHopLabelFact => ({
      counterpartyAddress: counterparty,
      direction: "inbound",
      labelCode,
      evidenceAuthority,
      recordedAt: "2026-07-11T00:00:00.000Z",
      effectiveAt: null,
      principalAmountRaw: "1000000000",
      principalTxCount: 1,
      directionalPrincipalShare: 0.1,
      shareSemantics: "exact",
      transferTxHashes: ["3".repeat(64)],
      linkedToSelectedProvenance: false
    });
    const falsePositive = catalogueApi.sourceAndRouteFacts({
      firstHopLabelFacts: [label("false_positive", "exact_internal")]
    });
    const [derivedScam] = catalogueApi.sourceAndRouteFacts({
      firstHopLabelFacts: [label("scam", "derived")]
    });

    expect(falsePositive).toEqual([]);
    expect(derivedScam?.kind).toBe("risky_counterparty");
    expect(derivedScam?.proofStrength).toBe("context");
  });

  it("keeps exact adverse labels above Verify20 and bridge, while benign labels stay below", () => {
    const makeLabel = (labelCode: FirstHopLabelFact["labelCode"]): FirstHopLabelFact => ({
      counterpartyAddress: counterparty,
      direction: "inbound",
      labelCode,
      evidenceAuthority: "exact_internal",
      recordedAt: "2026-07-11T00:00:00.000Z",
      effectiveAt: null,
      principalAmountRaw: "1000000000",
      principalTxCount: 1,
      directionalPrincipalShare: 0.1,
      shareSemantics: "exact",
      transferTxHashes: [labelCode],
      linkedToSelectedProvenance: false
    });
    const [adverse] = catalogueApi.sourceAndRouteFacts({ firstHopLabelFacts: [makeLabel("scam")] });
    const [benign] = catalogueApi.sourceAndRouteFacts({ firstHopLabelFacts: [makeLabel("exchange")] });
    const verify = catalogueApi.verify20RoleFact({
      subjectAddress: subject,
      role: "verify20_contract",
      fingerprint: { matched: true, selectors: [], blockedByTrustedService: false, missingSelectors: [], mismatchedSelectors: [] },
      debitObserved: false
    });
    const [bridge] = catalogueApi.sourceAndRouteFacts({ paths: [originPath({ sourceExposureKind: "cross_chain_boundary" })] });

    expect(adverse!.priority).toBeLessThan(verify!.priority!);
    expect(verify!.priority).toBeLessThan(bridge!.priority!);
    expect(bridge!.priority).toBeLessThan(benign!.priority!);
  });

  it("sums only exact GasFree service fees and leaves principal in ordinary first-hop facts", () => {
    const principalHash = "d".repeat(64);
    const feeHash = "e".repeat(64);
    const profile = interactionProfile([
      {
        txHash: principalHash,
        fromAddress: subject,
        toAddress: counterparty,
        amountRaw: "1176317000000",
        timestamp: "2026-05-26T09:56:18.000Z",
        method: "transfer",
        edgeType: "normal_transfer",
        economicRole: "principal",
        economicProtocol: "tron_gasfree"
      },
      {
        txHash: feeHash,
        fromAddress: subject,
        toAddress: `T${"7".repeat(33)}`,
        amountRaw: "3000000",
        timestamp: "2026-05-26T09:56:19.000Z",
        method: "transfer",
        edgeType: "normal_transfer",
        economicRole: "service_fee",
        economicProtocol: "tron_gasfree"
      },
      {
        txHash: "c".repeat(64),
        fromAddress: subject,
        toAddress: `T${"6".repeat(33)}`,
        amountRaw: "1500000",
        timestamp: "2026-05-26T10:00:00.000Z",
        method: "transfer",
        edgeType: "normal_transfer",
        economicRole: "service_fee",
        economicProtocol: "tron_gasfree"
      },
      {
        txHash: "f".repeat(64),
        fromAddress: subject,
        toAddress: `T${"8".repeat(33)}`,
        amountRaw: "9000000",
        timestamp: "2026-05-26T09:56:20.000Z",
        method: "transfer",
        edgeType: "normal_transfer",
        economicRole: "service_fee"
      }
    ]);
    const fee = catalogueApi.gasFreeFeeFact([profile]);
    const [principal] = catalogueApi.firstHopBlacklistFacts(subject, [
      blacklistFact({
        direction: "outbound",
        principalAmountRaw: "1176317000000",
        principalTxCount: 1,
        transferTxHashes: [principalHash]
      })
    ], [profile]);

    expect(fee?.factTextRu).toBe("Отдельно GasFree удержал 4,5 USDT комиссии. Она не входит в основную сумму.");
    expect(fee?.factTextEn).toBe("GasFree separately retained a 4.5 USDT fee. It is not principal.");
    expect(principal?.factTextRu).toContain("1 176 317 USDT");
    expect(principal?.factTextRu).not.toContain("1 176 320");
    expect(`${fee?.factTextRu}\n${fee?.factTextEn}`).not.toMatch(/риск|risk|санкц|blacklist/i);
    expect(`${fee?.factTextRu}\n${fee?.factTextEn}`).not.toMatch(/связан|linked|settlement|перед|before/i);
  });

  it("builds the same exact GasFree fee fact from Where balance-forming transfers", () => {
    const hugeRaw = "900719925474099312345678";
    const fee: BalanceFormingTransfer = {
      txHash: "e".repeat(64),
      fromAddress: subject,
      toAddress: `T${"7".repeat(33)}`,
      amountRaw: hugeRaw,
      timestamp: "2026-05-26T09:56:19.000Z",
      method: "transfer",
      edgeType: "normal_transfer",
      economicRole: "service_fee",
      economicProtocol: "tron_gasfree",
      coverageShare: 0,
      selectedReason: "covers_current_balance"
    };
    const duplicate = { ...fee };
    const second = { ...fee, txHash: "c".repeat(64), amountRaw: "3000000" };
    const fact = catalogueApi.gasFreeFeeFactFromBalanceTransfers([fee, duplicate, second]);

    expect(fact?.factTextRu).toContain("900 719 925 474 099 315,345678 USDT");
    expect(fact?.factTextEn).toContain("900,719,925,474,099,315.345678 USDT");
    expect(fact?.evidenceIds).toEqual(["c".repeat(64), "e".repeat(64)]);
  });

  it("does not infer a GasFree fee from destination, familiar amount, or close timing", () => {
    const heuristicOnly: BalanceFormingTransfer = {
      txHash: "f".repeat(64),
      fromAddress: subject,
      toAddress: "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird",
      amountRaw: "3000000",
      timestamp: "2026-05-26T09:56:19.000Z",
      method: "transfer",
      edgeType: "normal_transfer",
      economicRole: "principal",
      economicProtocol: "tron_gasfree",
      coverageShare: 1,
      selectedReason: "covers_current_balance"
    };

    expect(catalogueApi.gasFreeFeeFactFromBalanceTransfers([heuristicOnly])).toBeNull();
    expect(heuristicOnly.economicRole).toBe("principal");
  });

  it("does not turn a fee-only GasFree provider into direct adverse evidence", () => {
    const feeOnly = interactionProfile([{
      txHash: "e".repeat(64),
      fromAddress: subject,
      toAddress: counterparty,
      amountRaw: "3000000",
      timestamp: "2026-05-26T09:56:19.000Z",
      method: "transfer",
      edgeType: "normal_transfer",
      economicRole: "service_fee",
      economicProtocol: "tron_gasfree"
    }]);
    const evidence = catalogueApi.buildWalletNarrativeEvidence({
      checkedAddress: subject,
      firstHopBlacklistFacts: [],
      firstHopBlacklistCoverage: firstHopCoverage(),
      directCounterpartyInteractionProfiles: [feeOnly]
    });

    expect(evidence.facts.map((fact) => fact.kind)).toEqual(["gasfree_fee"]);
  });

  it("formats raw USDT with BigInt precision beyond Number.MAX_SAFE_INTEGER", () => {
    const [fact] = catalogueApi.firstHopBlacklistFacts(subject, [blacklistFact({
      principalAmountRaw: "900719925474099312345678",
      principalTxCount: 1,
      directionalPrincipalShare: null,
      shareSemantics: "unavailable"
    })]);

    expect(fact?.factTextRu).toContain("900 719 925 474 099 312,345678 USDT");
    expect(fact?.factTextEn).toContain("900,719,925,474,099,312.345678 USDT");
  });

  it.each([
    {
      status: "complete" as const,
      expectedRu: /проверено 10 входящих переводов.*прослежено 83% суммы/i,
      expectedEn: /checked 10 inbound transfers.*traced 83% of the amount/i
    },
    {
      status: "running" as const,
      expectedRu: /проверка остальных прямых контрагентов.*продолжается/i,
      expectedEn: /remaining direct counterparties.*still being checked/i
    },
    {
      status: "provider_failed" as const,
      expectedRu: /часть прямых контрагентов не проверена.*сбой источника/i,
      expectedEn: /some direct counterparties were not checked.*provider failure/i
    },
    {
      status: "budget_exhausted" as const,
      expectedRu: /часть прямых контрагентов не проверена.*технический лимит/i,
      expectedEn: /some direct counterparties were not checked.*technical limit/i
    },
    {
      status: "history_partial" as const,
      expectedRu: /история прямых переводов неполна/i,
      expectedEn: /direct transfer history is partial/i
    }
  ])("explains first-hop $status coverage independently from money coverage", (row) => {
    const coverage = catalogueApi.coverageExplanationFor({
      firstHopCoverage: firstHopCoverage({
        blacklistCheckCoverage: row.status,
        checkedMaterialCounterpartyCount: row.status === "complete" ? 4 : 2,
        uncheckedMaterialCounterpartyCount: row.status === "complete" ? 0 : 2,
        confirmedAdverseFactCount: row.status === "complete" ? 0 : 1,
        incompleteReason: row.status === "complete" ? null : `POISON ${row.status}`
      }),
      whereCoverage: whereCoverage(),
      traceHistoryCoverage: [traceHistory({ statusReason: "partial_provider_cap" })]
    });

    expect(coverage?.textRu).toMatch(row.expectedRu);
    expect(coverage?.textEn).toMatch(row.expectedEn);
    expect(coverage?.isRiskEvidence).toBe(false);
    expect(`${coverage?.textRu}\n${coverage?.textEn}`).not.toContain("POISON");
  });

  it.each([
    {
      name: "direct history",
      coverage: { directPrincipalTransferCoverage: "partial" as const },
      expected: /история прямых переводов неполна|direct transfer history is partial/i
    },
    {
      name: "timeline",
      coverage: { partialTimelineFactCount: 2, completeTimelineFactCount: 1 },
      expected: /у 2 связей.*дата блокировки|blacklist timing.*2 links/i
    },
    {
      name: "combined",
      coverage: { directPrincipalTransferCoverage: "partial" as const, partialTimelineFactCount: 2 },
      expected: /история прямых переводов неполна.*у 2 связей|direct transfer history is partial.*2 links/is
    }
  ])("does not let complete blacklist screening hide partial $name coverage", ({ coverage: axes, expected }) => {
    const coverage = catalogueApi.coverageExplanationFor({
      firstHopCoverage: firstHopCoverage({ blacklistCheckCoverage: "complete", ...axes })
    });

    expect(`${coverage?.textRu}\n${coverage?.textEn}`).toMatch(expected);
  });

  it("keeps combined canonical coverage axes complete and within the part cap", () => {
    const coverage = catalogueApi.coverageExplanationFor({
      firstHopCoverage: firstHopCoverage({
        directPrincipalTransferCoverage: "partial",
        blacklistCheckCoverage: "provider_failed",
        checkedMaterialCounterpartyCount: 1,
        failedMaterialCounterpartyCount: 3,
        partialTimelineFactCount: 2
      }),
      whereCoverage: whereCoverage(),
      traceHistoryCoverage: [traceHistory({ statusReason: "partial_provider_cap" })]
    });
    const copy = `${coverage?.textRu}\n${coverage?.textEn}`;

    expect(copy).toMatch(/83%/);
    expect(copy).toMatch(/история прямых переводов неполна|direct transfer history is partial/i);
    expect(copy).toMatch(/часть прямых контрагентов|some direct counterparties/i);
    expect(copy).toMatch(/2 связей|2 links/i);
    expect(coverage!.textRu.length).toBeLessThanOrEqual(280);
    expect(coverage!.textEn.length).toBeLessThanOrEqual(280);
  });

  it("explains unavailable money coverage without a clean or chronology claim", () => {
    const coverage = catalogueApi.coverageExplanationFor({
      firstHopCoverage: firstHopCoverage({
        directPrincipalTransferCoverage: "partial",
        blacklistCheckCoverage: "history_partial",
        materialCounterpartyCount: 0,
        checkedMaterialCounterpartyCount: 0
      }),
      whereCoverage: whereCoverage({
        selectedInboundTxCount: 0,
        coverageRatio: undefined,
        currentBalanceCoverageRatio: 0,
        partial: true
      }),
      traceHistoryCoverage: [traceHistory({
        fetchedTransferCount: 0,
        oldestFetchedTransferAt: null,
        statusReason: "failed_retryable"
      })]
    });
    const copy = `${coverage?.textRu}\n${coverage?.textEn}`;

    expect(coverage?.textRu).toMatch(/происхождение суммы не удалось проследить.*источник данных/i);
    expect(coverage?.textEn).toMatch(/could not trace the source of the amount.*data provider/i);
    expect(copy).not.toMatch(/риск не найден|no risk found|до блокировки|after blacklist/i);
  });

  it("states the untraced remainder and its structured reason for partial money coverage", () => {
    const coverage = catalogueApi.coverageExplanationFor({
      firstHopCoverage: firstHopCoverage(),
      whereCoverage: whereCoverage(),
      traceHistoryCoverage: [traceHistory({ statusReason: "partial_provider_cap" })]
    });

    expect(coverage?.textRu).toMatch(/остальные 17%.*не прослежены.*источник данных.*старые переводы/i);
    expect(coverage?.textEn).toMatch(/remaining 17%.*untraced.*provider.*older transfers/i);
  });

  it.each([
    ["provider cap", { providerCapHit: true, statusReason: "partial_provider_cap" as const }, /источник данных.*старые переводы|provider.*older transfers/i],
    ["budget", { budgetExhausted: true, statusReason: "partial_budget_exhausted" as const }, /техническ.*лимит|technical limit/i],
    ["inconsistent", { providerInconsistent: true, statusReason: "partial_provider_inconsistent" as const }, /противоречив.*истори|inconsistent history/i],
    ["provider failure", { statusReason: "failed_retryable" as const }, /запрос истории.*ошибк|history request failed/i]
  ])("explains Where-only $name coverage from structured history", (_name, history, reason) => {
    const coverage = catalogueApi.coverageExplanationFor({
      whereCoverage: whereCoverage({ notes: ["POISON notes provider_cap_unresolved"] }),
      traceHistoryCoverage: [traceHistory(history)]
    });
    const copy = `${coverage?.textRu}\n${coverage?.textEn}`;

    expect(coverage?.reasonKind).toBe("where_money_coverage");
    expect(copy).toMatch(/83%/);
    expect(copy).toMatch(reason);
    expect(copy).not.toContain("POISON");
    expect(coverage?.isRiskEvidence).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01])(
    "rejects invalid Where coverage ratio %s instead of inventing a percentage",
    (coverageRatio) => {
      const coverage = catalogueApi.coverageExplanationFor({
        whereCoverage: whereCoverage({ coverageRatio, currentBalanceCoverageRatio: coverageRatio }),
        traceHistoryCoverage: [traceHistory({ statusReason: "partial_provider_cap" })]
      });

      expect(coverage).toBeNull();
    }
  );

  it("builds Where coverage in the evidence catalogue without Deep first-hop coverage", () => {
    const evidence = catalogueApi.buildWalletNarrativeEvidence({
      checkedAddress: subject,
      whereCoverage: whereCoverage(),
      traceHistoryCoverage: [traceHistory({ statusReason: "partial_provider_cap" })]
    });

    expect(evidence.coverageExplanation?.textRu).toMatch(/83%.*17%/i);
    expect(evidence.coverageExplanation?.reasonKind).toBe("where_money_coverage");
  });

  it("requires checkedAddress at the evidence build boundary", () => {
    expect(() => catalogueApi.buildWalletNarrativeEvidence({})).toThrow(/checkedAddress.*required/i);
  });

  it.each([
    {
      name: "subject restriction",
      input: {
        subjectRestriction: {
          subjectAddress: `T${"8".repeat(33)}`,
          tokenContract: `T${"9".repeat(33)}`,
          tokenSymbol: "USDT",
          tokenStandard: "TRC20",
          decimals: 6,
          isBlacklisted: false,
          balanceRaw: "0",
          checkedAt: "2026-07-11T00:00:00.000Z",
          evidenceStrength: "exact_contract_state",
          methods: { blacklist: "isBlackListed(address)", balance: "balanceOf(address)" }
        }
      }
    },
    {
      name: "direct interaction",
      input: { directCounterpartyInteractionProfiles: [interactionProfile([], { subjectAddress: `T${"8".repeat(33)}` })] }
    },
    {
      name: "address behavior",
      input: { addressBehaviorProfiles: [behaviorProfile({ subjectAddress: `T${"8".repeat(33)}` })] }
    },
    {
      name: "operational flow",
      input: { operationalFlowProfiles: [operationalProfile({ subjectAddress: `T${"8".repeat(33)}` })] }
    },
    {
      name: "boundary exposure",
      input: {
        boundaryExposureProfiles: [{
          subjectAddress: `T${"8".repeat(33)}`,
          incomingBoundaryVolumeRaw: "0",
          outgoingBoundaryVolumeRaw: "0",
          incomingBoundaryVolumeRatio: 0,
          outgoingBoundaryVolumeRatio: 0,
          directBoundaryTxCount: 0,
          twoHopBoundaryTxCount: 0,
          topBoundaryEntities: [],
          categoryBreakdown: [],
          flows: [],
          contextScore: 0,
          features: []
        } satisfies BoundaryExposureProfile]
      }
    },
    {
      name: "approval checked address",
      input: {
        approvalDrain: {
          checkedAddress: `T${"8".repeat(33)}`,
          walletRole: "victim",
          profile: approvalProfile()
        }
      }
    },
    {
      name: "approval profile subject",
      input: {
        approvalDrain: {
          checkedAddress: subject,
          walletRole: "victim",
          profile: approvalProfile({ subjectAddress: `T${"8".repeat(33)}` })
        }
      }
    },
    {
      name: "Verify20 subject",
      input: {
        verify20: {
          subjectAddress: `T${"8".repeat(33)}`,
          role: "verify20_contract",
          fingerprint: {
            matched: true,
            selectors: [],
            blockedByTrustedService: false,
            missingSelectors: [],
            mismatchedSelectors: []
          },
          debitObserved: false
        }
      }
    }
  ])("fails closed for mixed-job $name input", ({ input }) => {
    expect(() => catalogueApi.buildWalletNarrativeEvidence({
      checkedAddress: subject,
      ...input
    })).toThrow(/subject.*does not match checkedAddress/i);
  });

  it("keeps a confirmed adverse fact primary and its limitation separate", () => {
    const evidence = catalogueApi.buildWalletNarrativeEvidence({
      checkedAddress: subject,
      firstHopBlacklistFacts: [blacklistFact()],
      firstHopBlacklistCoverage: firstHopCoverage({
        blacklistCheckCoverage: "provider_failed",
        checkedMaterialCounterpartyCount: 1,
        failedMaterialCounterpartyCount: 3,
        confirmedAdverseFactCount: 1,
        incompleteReason: "POISON provider detail"
      }),
      whereCoverage: whereCoverage(),
      traceHistoryCoverage: [traceHistory({ statusReason: "failed_retryable" })],
      snapshot: { reasons: ["POISON snapshot.reasons"] },
      decisionReasons: ["POISON decisionReasons"],
      assessment: { reasons: ["POISON assessment.reasons"], notes: ["POISON notes"] }
    });
    const serialized = JSON.stringify(evidence);

    expect(evidence.facts[0]?.kind).toBe("direct_counterparty_blacklist");
    expect(evidence.coverageExplanation).not.toBeNull();
    expect(serialized).not.toContain("POISON");
    expect(serialized).not.toMatch(/transferFrom|boundary|drain episode|anchor coverage/i);
  });

  it("does not turn first-hop coverage into a broad clean claim", () => {
    const evidence = catalogueApi.buildWalletNarrativeEvidence({
      checkedAddress: subject,
      firstHopBlacklistFacts: [],
      firstHopBlacklistCoverage: firstHopCoverage({ scope: "checked_window" }),
      snapshot: { reasons: ["USDT blacklist не найден; POISON"] }
    });
    const copy = evidence.facts.map((fact) => `${fact.factTextRu}\n${fact.factTextEn}`).join("\n");

    expect(evidence.facts).toEqual([]);
    expect(copy).not.toMatch(/неблагоприятн.*не найден|no material adverse facts|полная история|complete.*history|POISON/i);
  });

  it("sorts and deduplicates normalized evidence independently of producer order", () => {
    const left = blacklistFact({
      counterpartyAddress: `T${"3".repeat(33)}`,
      direction: "outbound",
      transferTxHashes: ["c".repeat(64)]
    });
    const right = blacklistFact({
      counterpartyAddress: `T${"4".repeat(33)}`,
      direction: "inbound",
      transferTxHashes: ["d".repeat(64)]
    });
    const build = (facts: FirstHopBlacklistFact[]) => catalogueApi.buildWalletNarrativeEvidence({
      checkedAddress: subject,
      firstHopBlacklistFacts: facts,
      firstHopBlacklistCoverage: firstHopCoverage({ confirmedAdverseFactCount: 2 })
    }).facts.map((fact) => fact.id);

    expect(build([left, right, left])).toEqual(build([right, left]));
  });

  it("keeps exact TGyt blacklist evidence primary and shows its separate GasFree fee before bridge context", () => {
    const evidence = catalogueApi.buildWalletNarrativeEvidence({
      checkedAddress: TGYT_DIRECT_BLACKLIST_CASE.subjectAddress,
      subjectRestriction: tgytSubjectRestriction(),
      firstHopBlacklistFacts: [tgytFirstHopBlacklistFact()],
      firstHopBlacklistCoverage: tgytFirstHopCoverage(),
      directCounterpartyInteractionProfiles: tgytDirectInteractionProfiles(),
      paths: [tgytBridgePath()],
      sourcePolicyEvidence: [tgytBridgePolicyEvidence()]
    });
    const text = formatWalletNarrativeSummary({
      locale: "ru",
      decision: "DECLINE",
      score: 90,
      facts: evidence.facts,
      coverageExplanation: evidence.coverageExplanation
    });
    const english = formatWalletNarrativeSummary({
      locale: "en",
      decision: "DECLINE",
      score: 90,
      facts: evidence.facts,
      coverageExplanation: evidence.coverageExplanation
    });

    expect(evidence.facts.map((fact) => fact.kind)).toEqual([
      "direct_counterparty_blacklist",
      "bridge_route",
      "gasfree_fee"
    ]);
    expect(evidence.facts[0]?.evidenceIds).toEqual([
      TGYT_DIRECT_BLACKLIST_CASE.smallPrincipalTxHash,
      TGYT_DIRECT_BLACKLIST_CASE.largePrincipalTxHash
    ]);
    expect(evidence.facts[2]?.evidenceIds).toEqual([TGYT_DIRECT_BLACKLIST_CASE.gasFreeFeeTxHash]);
    expect(selectNarrativeFacts(buildWalletNarrativeCase({
      locale: "ru",
      decision: "DECLINE",
      score: 90,
      facts: evidence.facts,
      coverageExplanation: null
    })).map((fact) => fact.kind)).toEqual(["direct_counterparty_blacklist", "bridge_route"]);
    expect(text).toMatch(/^🔴 90\/100 — критический риск\. Операцию не проводить\./u);
    expect(text).toContain("TWGC…TdTm");
    expect(text).toContain("1 176 317 USDT");
    expect(text).toContain("100% исходящей суммы");
    expect(text).toContain("Контрагент в чёрном списке USDT");
    expect(text).toMatch(/2 ч 52 мин.*1 176 302 USDT/u);
    expect(text).toContain("Сам адрес не в списке");
    expect(text).toMatch(/Отдельно GasFree удержал 3 USDT комиссии.*не входит в основную сумму/u);
    expect(text.match(/GasFree/gu)).toHaveLength(1);
    expect(text).toContain("Техническая деталь");
    expect(text).toContain("UsdtOFT");
    expect(text).not.toMatch(/перед переводом/u);
    expect(text).not.toMatch(/45 с|1 176 320|TGyt.*ч[её]рном списке|risky_counterparty|cross_chain_boundary/iu);
    expect(english).toMatch(/1,176,317 USDT went to TWGC…TdTm.*100% of the outgoing amount.*Counterparty now on USDT blacklist.*Listed 2 h 52 m after the 1,176,302 USDT transfer/u);
    expect(english).not.toMatch(/blacklisted counterparty|before the transfer/u);
    expect(text.length - text.indexOf("\n\n")).toBeLessThanOrEqual(450);
    expect(english.length - english.indexOf("\n\n")).toBeLessThanOrEqual(450);
  });

  it("does not promote an unrelated GasFree fee above material bridge context", () => {
    const profiles = tgytDirectInteractionProfiles();
    const unrelatedFeeHash = "8".repeat(64);
    const feeProfile = profiles[1]!;
    profiles[1] = {
      ...feeProfile,
      txHashes: [unrelatedFeeHash],
      transfers: feeProfile.transfers?.map((transfer) => ({ ...transfer, txHash: unrelatedFeeHash }))
    };
    const evidence = catalogueApi.buildWalletNarrativeEvidence({
      checkedAddress: TGYT_DIRECT_BLACKLIST_CASE.subjectAddress,
      subjectRestriction: tgytSubjectRestriction(),
      firstHopBlacklistFacts: [tgytFirstHopBlacklistFact()],
      firstHopBlacklistCoverage: tgytFirstHopCoverage(),
      directCounterpartyInteractionProfiles: profiles,
      paths: [tgytBridgePath()],
      sourcePolicyEvidence: [tgytBridgePolicyEvidence()]
    });
    const text = formatWalletNarrativeSummary({
      locale: "ru",
      decision: "DECLINE",
      score: 90,
      facts: evidence.facts,
      coverageExplanation: null
    });

    expect(evidence.facts.map((fact) => fact.kind)).toEqual([
      "direct_counterparty_blacklist",
      "bridge_route",
      "gasfree_fee"
    ]);
    expect(text).toContain("UsdtOFT");
    expect(text).toContain("Техническая деталь");
    expect(text).toContain("GasFree");
  });

  it("keeps coverage above the optional GasFree technical detail", () => {
    const evidence = catalogueApi.buildWalletNarrativeEvidence({
      checkedAddress: TGYT_DIRECT_BLACKLIST_CASE.subjectAddress,
      subjectRestriction: tgytSubjectRestriction(),
      firstHopBlacklistFacts: [tgytFirstHopBlacklistFact()],
      firstHopBlacklistCoverage: tgytFirstHopCoverage(),
      directCounterpartyInteractionProfiles: tgytDirectInteractionProfiles(),
      paths: [tgytBridgePath()],
      sourcePolicyEvidence: [tgytBridgePolicyEvidence()]
    });
    const text = formatWalletNarrativeSummary({
      locale: "ru",
      decision: "DECLINE",
      score: 90,
      facts: evidence.facts,
      coverageExplanation: {
        textRu: "Проверена вся доступная сумма.",
        textEn: "The full available amount was checked.",
        isRiskEvidence: false
      }
    });

    expect(text).toContain("Границы проверки");
    expect(text).toContain("UsdtOFT");
    expect(text).not.toContain("Техническая деталь");
    expect(text).not.toContain("GasFree");
  });

  it("does not duplicate a GasFree fee already selected as the second fact", () => {
    const evidence = catalogueApi.buildWalletNarrativeEvidence({
      checkedAddress: TGYT_DIRECT_BLACKLIST_CASE.subjectAddress,
      subjectRestriction: tgytSubjectRestriction(),
      firstHopBlacklistFacts: [tgytFirstHopBlacklistFact()],
      firstHopBlacklistCoverage: tgytFirstHopCoverage(),
      directCounterpartyInteractionProfiles: tgytDirectInteractionProfiles()
    });
    const text = formatWalletNarrativeSummary({
      locale: "ru",
      decision: "DECLINE",
      score: 90,
      facts: evidence.facts,
      coverageExplanation: null
    });

    expect(text.match(/GasFree/gu)).toHaveLength(1);
    expect(text).not.toContain("Техническая деталь");
  });

  it("keeps stronger exact evidence above the optional GasFree technical detail", () => {
    const evidence = catalogueApi.buildWalletNarrativeEvidence({
      checkedAddress: TGYT_DIRECT_BLACKLIST_CASE.subjectAddress,
      subjectRestriction: tgytSubjectRestriction(),
      firstHopBlacklistFacts: [tgytFirstHopBlacklistFact()],
      firstHopBlacklistCoverage: tgytFirstHopCoverage(),
      directCounterpartyInteractionProfiles: tgytDirectInteractionProfiles()
    });
    const approval: NarrativeFact = {
      id: "approval-second",
      kind: "approval_drain",
      proofStrength: "exact",
      factTextRu: "Найдена подтверждённая дрейнер-цепочка.",
      factTextEn: "A confirmed drainer route was found."
    };
    const text = formatWalletNarrativeSummary({
      locale: "ru",
      decision: "DECLINE",
      score: 95,
      facts: [...evidence.facts, approval],
      coverageExplanation: null
    });

    expect(text).toContain("подтверждённая дрейнер-цепочка");
    expect(text.indexOf("подтверждённая дрейнер-цепочка")).toBeLessThan(text.indexOf("Техническая деталь"));
    expect(text).toContain("GasFree удержал");
  });
});
