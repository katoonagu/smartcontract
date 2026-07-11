import { describe, expect, it, vi } from "vitest";
import * as walletNarrativeSummary from "../../src/bot/walletNarrativeSummary";
import {
  buildWalletNarrativeCase,
  formatWalletNarrativeSummary,
  selectNarrativeFacts,
  type NarrativeFact,
  type WalletNarrativeCase
} from "../../src/bot/walletNarrativeSummary";
import type {
  ApprovalDrainProvenanceProfile,
  DirectCounterpartyInteractionProfile,
  FirstHopBlacklistCoverage,
  FirstHopBlacklistFact,
  FirstHopLabelFact,
  StablecoinRestrictionProfile
} from "../../src/types";

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
    facts: FirstHopBlacklistFact[],
    profiles?: DirectCounterpartyInteractionProfile[],
    subjectRestriction?: StablecoinRestrictionProfile | null
  ) => NarrativeFact[];
  sourceAndRouteFacts: (input: Record<string, unknown>) => NarrativeFact[];
  gasFreeFeeFact: (profiles: DirectCounterpartyInteractionProfile[]) => NarrativeFact | null;
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
      walletRole: "victim",
      expectedRu: /жертва.*списан|списали.*жертва/i,
      expectedEn: /victim.*debit|debited.*victim/i,
      forbidden: /контракт-дрейнер|drainer contract/i
    },
    {
      role: "drainer_spender",
      checkedAddress: `T${"3".repeat(33)}`,
      walletRole: "drainer_spender",
      expectedRu: /получил доступ.*списал|контракт-дрейнер/i,
      expectedEn: /obtained access.*debited|drainer contract/i
    },
    {
      role: "first_receiver",
      checkedAddress: `T${"4".repeat(33)}`,
      walletRole: "first_receiver",
      expectedRu: /первым получил.*850 USDT/i,
      expectedEn: /first.*receive.*850 USDT/i
    },
    {
      role: "route_linked",
      checkedAddress: `T${"5".repeat(33)}`,
      walletRole: "unknown",
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
      expectedRu: /Входящий:.*получил 25 000 USDT.*контрагент/i,
      chronologyRu: /уже находился в ч[её]рном списке/i,
      expectedEn: /Inbound:.*received 25,000 USDT/i
    },
    {
      relation: "active_at_transfer" as const,
      direction: "outbound" as const,
      expectedRu: /Исходящий:.*отправил 25 000 USDT.*контрагент/i,
      chronologyRu: /уже находился в ч[её]рном списке/i,
      expectedEn: /Outbound:.*sent 25,000 USDT/i
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
    const [fact] = catalogueApi.firstHopBlacklistFacts([
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
    const [fact] = catalogueApi.firstHopBlacklistFacts([
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
    expect(fact?.factTextRu).toMatch(/2 ч(?:аса)? 52 мин(?:уты)? 45 с(?:екунд)? .*1 176 302 USDT/i);
    expect(fact?.factTextEn).toMatch(/2 h 52 m 45 s .*1,176,302 USDT/i);
    expect(`${fact?.factTextRu}\n${fact?.factTextEn}`).not.toContain("POISON");
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
    const [proved] = catalogueApi.firstHopBlacklistFacts([blacklistFact()], [], exactNegative);
    const [unknown] = catalogueApi.firstHopBlacklistFacts([blacklistFact()]);

    expect(proved?.factTextRu).toMatch(/сам проверяемый адрес.*ч[её]рн.*спис.*не|сам проверяемый адрес.*не.*ч[её]рн.*спис/i);
    expect(proved?.factTextEn).toMatch(/checked address itself is not.*blacklist/i);
    expect(`${unknown?.factTextRu}\n${unknown?.factTextEn}`).not.toMatch(/сам проверяемый адрес.*не|checked address itself is not/i);
  });

  it.each([
    {
      name: "sanctioned HTX source",
      route: {
        kind: "sanctioned_service",
        identity: "HTX/Huobi",
        direction: "inbound",
        linkedToSelectedProvenance: true,
        occurredAt: "2026-05-26T12:00:00.000Z",
        sanctionsAuthority: "UK",
        designationDate: "2026-05-26",
        amountRaw: "40000000000",
        share: 0.4,
        txCount: 1
      },
      expectedRu: /40%.*HTX\/Huobi.*Великобритани.*санкц.*операцию не проводить/i,
      expectedEn: /40%.*HTX\/Huobi.*UK.*sanctioned.*do not proceed/i,
      forbidden: /краж|theft/i
    },
    {
      name: "one-off bridge",
      route: {
        kind: "bridge",
        identity: "UsdtOFT",
        direction: "inbound",
        amountRaw: "83000000000",
        share: 0.83,
        txCount: 1,
        repeated: false
      },
      expectedRu: /83%.*через мост UsdtOFT.*другой сети.*не видна в TRON.*обычн.*обмен.*скры.*происхожд.*AML-риск/is,
      expectedEn: /83%.*UsdtOFT bridge.*another chain.*not visible on TRON.*ordinary swaps.*hide.*origin.*AML risk/is,
      forbidden: /нейтрален|neutral|отмывание невозможно|laundering .*impossible|не доказано|unproven/i
    },
    {
      name: "repeated bridge",
      route: {
        kind: "bridge",
        identity: "UsdtOFT",
        direction: "inbound",
        amountRaw: "83000000000",
        share: 0.83,
        txCount: 10,
        repeated: true
      },
      expectedRu: /83%.*десяти переводах|83%.*10 переводах.*усложняет.*нетипичен/is,
      expectedEn: /83%.*10 transfers.*harder to trace.*unusual/is
    },
    {
      name: "CEX source",
      route: {
        kind: "cex",
        identity: "Binance",
        direction: "inbound",
        amountRaw: "72000000000",
        share: 0.72,
        txCount: 4
      },
      expectedRu: /72%.*пришло с Binance.*четыр/i,
      expectedEn: /72%.*came from Binance.*four/i
    },
    {
      name: "unknown contract boundary",
      route: {
        kind: "unknown_contract",
        identity: null,
        direction: "inbound",
        amountRaw: "10000000000",
        share: 0.1,
        txCount: 1,
        untracedReason: "history_before_contract_unavailable"
      },
      expectedRu: /контракт без названия.*источник до контракта не установлен/i,
      expectedEn: /unnamed contract.*source before the contract could not be traced/i
    },
    {
      name: "known service boundary",
      route: {
        kind: "service_boundary",
        identity: "Example Router",
        direction: "inbound",
        amountRaw: "10000000000",
        share: 0.1,
        txCount: 1,
        untracedReason: "pooled_service_history"
      },
      expectedRu: /Example Router.*сервис.*источник до сервиса.*не удалось проследить/i,
      expectedEn: /Example Router.*service.*source before the service.*could not be traced/i
    },
    {
      name: "collector",
      route: {
        kind: "collector",
        identity: "Bybit",
        direction: "outbound",
        amountRaw: "98000000000",
        share: 0.98,
        txCount: 18,
        uniqueCounterpartyCount: 18
      },
      expectedRu: /собирает переводы.*18 адресов.*98%.*Bybit.*ликвидн|кошел[её]к-сборщик/is,
      expectedEn: /collects transfers.*18 addresses.*98%.*Bybit.*liquidity|collector wallet/is,
      forbidden: /грязн|винов|dirty|guilt/i
    },
    {
      name: "risky counterparty",
      route: {
        kind: "risky_counterparty",
        identity: null,
        direction: "inbound",
        amountRaw: "35000000000",
        share: 0.35,
        txCount: 2
      },
      expectedRu: /35%.*высоким риском.*этой части суммы/i,
      expectedEn: /35%.*high-risk address.*that share/i,
      forbidden: /кража не доказана|theft is not proven/i
    }
  ])("renders $name from typed route evidence", (row) => {
    const [fact] = catalogueApi.sourceAndRouteFacts({ routes: [row.route] });
    const copy = `${fact?.factTextRu}\n${fact?.factTextEn}`;

    expect(fact?.factTextRu).toMatch(row.expectedRu);
    expect(fact?.factTextEn).toMatch(row.expectedEn);
    if (row.forbidden) expect(copy).not.toMatch(row.forbidden);
  });

  it("keeps pre-designation, outbound, and unselected HTX links as context", () => {
    const routes = [
      { direction: "inbound", linkedToSelectedProvenance: true, occurredAt: "2026-05-25T23:59:59.000Z" },
      { direction: "outbound", linkedToSelectedProvenance: true, occurredAt: "2026-05-27T00:00:00.000Z" },
      { direction: "inbound", linkedToSelectedProvenance: false, occurredAt: "2026-05-27T00:00:00.000Z" }
    ].map((fields) => ({
      kind: "sanctioned_service",
      identity: "HTX/Huobi",
      amountRaw: "1000000000",
      share: 0.1,
      txCount: 1,
      sanctionsAuthority: "UK",
      designationDate: "2026-05-26",
      ...fields
    }));

    for (const route of routes) {
      const [fact] = catalogueApi.sourceAndRouteFacts({ routes: [route] });
      expect(`${fact?.factTextRu}\n${fact?.factTextEn}`).not.toMatch(/операцию не проводить|do not proceed/i);
    }
  });

  it("does not apply the HTX designation date to another service or an unverified authority", () => {
    const routes = [
      { identity: "Another Exchange", sanctionsAuthority: "UK", designationDate: "2026-05-26" },
      { identity: "HTX/Huobi", sanctionsAuthority: "unknown", designationDate: "2026-05-26" }
    ].map((fields) => ({
      kind: "sanctioned_service",
      direction: "inbound",
      linkedToSelectedProvenance: true,
      occurredAt: "2026-05-27T00:00:00.000Z",
      amountRaw: "1000000000",
      share: 0.1,
      txCount: 1,
      ...fields
    }));

    for (const route of routes) {
      const [fact] = catalogueApi.sourceAndRouteFacts({ routes: [route] });
      expect(`${fact?.factTextRu}\n${fact?.factTextEn}`).not.toMatch(/операцию не проводить|do not proceed/i);
    }
  });

  it("does not invent a CEX or service identity when none was resolved", () => {
    const facts = catalogueApi.sourceAndRouteFacts({
      routes: [
        {
          kind: "cex",
          identity: null,
          direction: "inbound",
          amountRaw: "1000000000",
          share: 0.1,
          txCount: 1
        },
        {
          kind: "service_boundary",
          identity: null,
          direction: "inbound",
          amountRaw: "2000000000",
          share: 0.2,
          txCount: 1,
          untracedReason: "pooled_service_history"
        }
      ]
    });
    const copy = facts.map((fact) => `${fact.factTextRu}\n${fact.factTextEn}`).join("\n");

    expect(copy).toMatch(/биржев.*сервис|exchange service/i);
    expect(copy).toMatch(/сервис с общей ликвидностью|pooled-liquidity service/i);
    expect(copy).not.toMatch(/unknown exchange|1000000000|2000000000/);
  });

  it("canonicalizes route facts independently of route insertion order", () => {
    const bridge = {
      kind: "bridge",
      identity: "UsdtOFT",
      direction: "inbound",
      amountRaw: "83000000000",
      share: 0.83,
      txCount: 1,
      repeated: false
    };
    const cex = {
      kind: "cex",
      identity: "Binance",
      direction: "inbound",
      amountRaw: "72000000000",
      share: 0.72,
      txCount: 4
    };
    const ids = (routes: Record<string, unknown>[]) => catalogueApi.buildWalletNarrativeEvidence({
      routes,
      firstHopBlacklistCoverage: firstHopCoverage()
    }).facts.map((fact) => fact.id);

    expect(ids([bridge, cex, bridge])).toEqual(ids([cex, bridge]));
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
    const facts = catalogueApi.sourceAndRouteFacts({ routes: [], firstHopLabelFacts: labels });
    const copy = facts.map((fact) => `${fact.factTextRu}\n${fact.factTextEn}`).join("\n");

    expect(copy).toMatch(/украденн|stolen funds/i);
    expect(copy).toMatch(/контекст|context/i);
    expect(copy).not.toContain("2099");
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
    const [principal] = catalogueApi.firstHopBlacklistFacts([
      blacklistFact({
        direction: "outbound",
        principalAmountRaw: "1176317000000",
        principalTxCount: 1,
        transferTxHashes: [principalHash]
      })
    ], [profile]);

    expect(fee?.factTextRu).toMatch(/3 USDT.*комисси.*сервис/i);
    expect(fee?.factTextEn).toMatch(/3 USDT.*service fee/i);
    expect(principal?.factTextRu).toContain("1 176 317 USDT");
    expect(principal?.factTextRu).not.toContain("1 176 320");
    expect(`${fee?.factTextRu}\n${fee?.factTextEn}`).not.toMatch(/риск|risk|санкц|blacklist/i);
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
      firstHopBlacklistFacts: [],
      firstHopBlacklistCoverage: firstHopCoverage(),
      directCounterpartyInteractionProfiles: [feeOnly]
    });

    expect(evidence.facts.map((fact) => fact.kind)).toEqual(["gasfree_fee"]);
  });

  it("formats raw USDT with BigInt precision beyond Number.MAX_SAFE_INTEGER", () => {
    const [fact] = catalogueApi.firstHopBlacklistFacts([blacklistFact({
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
      expectedRu: /проверили 10 входящих переводов.*проследили 83% суммы/i,
      expectedEn: /checked 10 inbound transfers.*traced 83% of the amount/i
    },
    {
      status: "running" as const,
      expectedRu: /проверка остальных прямых контрагентов.*продолжается/i,
      expectedEn: /remaining direct counterparties.*still being checked/i
    },
    {
      status: "provider_failed" as const,
      expectedRu: /не удалось проверить часть прямых контрагентов.*повторн/i,
      expectedEn: /could not check some direct counterparties.*run.*again/i
    },
    {
      status: "budget_exhausted" as const,
      expectedRu: /техническом лимите.*часть контрагентов не проверена/i,
      expectedEn: /technical limit.*some counterparties were not checked/i
    },
    {
      status: "history_partial" as const,
      expectedRu: /только часть истории прямых переводов/i,
      expectedEn: /only part of the direct transfer history/i
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
      traceCoverage: {
        status: row.status === "complete" ? "exact" : "partial",
        direction: "inbound",
        checkedTransferCount: 10,
        tracedAmountPercent: 83,
        untracedReason: "older_history_unavailable"
      }
    });

    expect(coverage?.textRu).toMatch(row.expectedRu);
    expect(coverage?.textEn).toMatch(row.expectedEn);
    expect(coverage?.isRiskEvidence).toBe(false);
    expect(`${coverage?.textRu}\n${coverage?.textEn}`).not.toContain("POISON");
  });

  it("explains unavailable money coverage without a clean or chronology claim", () => {
    const coverage = catalogueApi.coverageExplanationFor({
      firstHopCoverage: firstHopCoverage({
        directPrincipalTransferCoverage: "partial",
        blacklistCheckCoverage: "history_partial",
        materialCounterpartyCount: 0,
        checkedMaterialCounterpartyCount: 0
      }),
      traceCoverage: {
        status: "unavailable",
        direction: "inbound",
        checkedTransferCount: null,
        tracedAmountPercent: null,
        untracedReason: "provider_failed"
      }
    });
    const copy = `${coverage?.textRu}\n${coverage?.textEn}`;

    expect(coverage?.textRu).toMatch(/происхождение суммы не удалось проследить.*источник данных/i);
    expect(coverage?.textEn).toMatch(/could not trace the source of the amount.*data provider/i);
    expect(copy).not.toMatch(/риск не найден|no risk found|до блокировки|after blacklist/i);
  });

  it("states the untraced remainder and its structured reason for partial money coverage", () => {
    const coverage = catalogueApi.coverageExplanationFor({
      firstHopCoverage: firstHopCoverage(),
      traceCoverage: {
        status: "partial",
        direction: "inbound",
        checkedTransferCount: 10,
        tracedAmountPercent: 83,
        untracedReason: "older_history_unavailable"
      }
    });

    expect(coverage?.textRu).toMatch(/оставшиеся 17%.*не удалось.*источник данных.*старые переводы/i);
    expect(coverage?.textEn).toMatch(/remaining 17%.*could not.*data provider.*older transfers/i);
  });

  it("keeps a confirmed adverse fact primary and its limitation separate", () => {
    const evidence = catalogueApi.buildWalletNarrativeEvidence({
      firstHopBlacklistFacts: [blacklistFact()],
      firstHopBlacklistCoverage: firstHopCoverage({
        blacklistCheckCoverage: "provider_failed",
        checkedMaterialCounterpartyCount: 1,
        failedMaterialCounterpartyCount: 3,
        confirmedAdverseFactCount: 1,
        incompleteReason: "POISON provider detail"
      }),
      traceCoverage: {
        status: "partial",
        direction: "inbound",
        checkedTransferCount: 10,
        tracedAmountPercent: 83,
        untracedReason: "provider_failed"
      },
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

  it("returns a scoped neutral fact only for complete coverage with no material finding", () => {
    const evidence = catalogueApi.buildWalletNarrativeEvidence({
      firstHopBlacklistFacts: [],
      firstHopBlacklistCoverage: firstHopCoverage({ scope: "checked_window" }),
      traceCoverage: {
        status: "exact",
        direction: "inbound",
        checkedTransferCount: 10,
        tracedAmountPercent: 100,
        untracedReason: null
      },
      snapshot: { reasons: ["USDT blacklist не найден; POISON"] }
    });
    const copy = evidence.facts.map((fact) => `${fact.factTextRu}\n${fact.factTextEn}`).join("\n");

    expect(copy).toMatch(/проверенн.*окн|checked window/i);
    expect(copy).toMatch(/материальн.*неблагоприятн.*не найден|no material adverse facts/i);
    expect(copy).not.toMatch(/полная история|full history|USDT blacklist не найден|POISON/i);
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
      firstHopBlacklistFacts: facts,
      firstHopBlacklistCoverage: firstHopCoverage({ confirmedAdverseFactCount: 2 })
    }).facts.map((fact) => fact.id);

    expect(build([left, right, left])).toEqual(build([right, left]));
  });
});
