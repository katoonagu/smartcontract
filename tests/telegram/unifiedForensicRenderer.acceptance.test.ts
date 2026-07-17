import { describe, expect, it } from "vitest";
import { validateScoreAnchorV2 } from "../../src/risk/scoreAnchorV2";
import { telegramAddressRef } from "../../src/telegram/forensicPresentation";
import { adaptTelegramForensicResult } from "../../src/telegram/forensicPresentationAdapters";
import { renderTelegramForensicResult } from "../../src/telegram/forensicResultRenderer";
import {
  BRIDGE_SOURCE,
  BRIDGERS,
  GASFREE_ACCOUNT,
  REMEDIATION_TELEGRAM_UX_CASES,
  TGYT,
  TWGC,
  USDD_PSM,
  VERIFY20,
  remediationTelegramUxCase
} from "../fixtures/telegram/remediationTelegramUxCases";
import {
  REMEDIATION_TELEGRAM_GOLDEN_IDS,
  REMEDIATION_TELEGRAM_GOLDEN_MESSAGES
} from "../fixtures/telegram/remediationTelegramGoldenMessages";

function renderCase(id: string): string {
  return renderTelegramForensicResult(adaptTelegramForensicResult(remediationTelegramUxCase(id).source));
}

function clonedSource(id: string): ReturnType<typeof remediationTelegramUxCase>["source"] {
  return structuredClone(remediationTelegramUxCase(id).source);
}

function renderSource(source: ReturnType<typeof remediationTelegramUxCase>["source"]): string {
  return renderTelegramForensicResult(adaptTelegramForensicResult(source));
}

function canonicalAddressLink(address: string): string {
  return `<a href="https://tronscan.org/#/address/${address}">${address.slice(0, 4)}…${address.slice(-4)}</a>`;
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("unified forensic Telegram renderer acceptance", () => {
  it("[REQ-15][SCORE-BINDING] accepts every nominal frozen anchor and rejects the mismatched subject fixture", () => {
    for (const fixture of REMEDIATION_TELEGRAM_UX_CASES) {
      const anchor = fixture.source.scoreAnchorV2;
      if (!anchor) continue;
      const validate = () => validateScoreAnchorV2({
        anchor,
        checkedSubjectAddress: fixture.source.checkedWalletAddress,
        checkedMode: anchor.mode,
        evidence: fixture.source.scoringEvidenceV2,
        facts: fixture.source.narrativeFactsV2
      });

      if (fixture.id === "INVALID_ADDRESS_AND_ANCHOR") expect(validate, fixture.id).toThrow();
      else expect(validate, fixture.id).not.toThrow();
    }
  });

  it("[AC-07] renders the active non-Fast score anchor first", () => {
    const html = renderCase("GOLDEN_FINAL_AML");
    const preferred = html.indexOf("Кошелёк отправил 1 176 317 USDT");
    const secondary = html.indexOf("83% проверяемой суммы");

    expect(preferred).toBeGreaterThan(-1);
    expect(secondary).toBeGreaterThan(preferred);
    expect(html).not.toMatch(/fast|быстр.*провер/i);
  });

  it("[AC-08] links the checked wallet in every Telegram result type", () => {
    const representatives = [
      "GOLDEN_WHERE_PRELIMINARY",
      "GOLDEN_FINAL_AML",
      "THJ_COLLECTOR_ONLY",
      "INCOMING_APPROVAL_ROUTE_ROLES",
      "GOLDEN_GASFREE_ACCOUNT",
      "GOLDEN_VERIFY20_ACTIVE_NO_DEBIT",
      "GOLDEN_NO_FINAL_TECHNICAL"
    ];

    for (const id of representatives) {
      const fixture = remediationTelegramUxCase(id);
      expect(renderCase(id), id).toContain(canonicalAddressLink(fixture.source.checkedWalletAddress));
    }
  });

  it("[AC-09] safely shortens and links every valid TRON address", () => {
    const expected = new Map([
      [TGYT, "TGyt…ZAZD"],
      [TWGC, "TWGC…TdTm"],
      [BRIDGE_SOURCE, "TBXS…XPdV"],
      [VERIFY20, "TFag…nXzK"],
      [BRIDGERS, "TPwe…Et5s"],
      [GASFREE_ACCOUNT, "TRiv…MnxP"],
      [USDD_PSM, "TSUY…12sQ"]
    ]);

    for (const [full, display] of expected) {
      expect(telegramAddressRef(full)).toEqual({
        address: full,
        display,
        url: `https://tronscan.org/#/address/${full}`
      });
    }
  });

  it("[AC-09][ADDRESS-SUFFIX] preserves the exact last four TRON address characters without reordering or omission", () => {
    for (const full of [TGYT, TWGC, BRIDGE_SOURCE, VERIFY20, BRIDGERS, GASFREE_ACCOUNT, USDD_PSM]) {
      const ref = telegramAddressRef(full);
      expect(ref.display.slice(-4), full).toBe(full.slice(-4));
      expect(ref.display).toBe(`${full.slice(0, 4)}…${full.slice(-4)}`);
    }
  });

  it("[AC-12] distinguishes true no-activity from small principal flow", () => {
    const noActivity = renderCase("GOLDEN_TRUE_NO_ACTIVITY");
    const smallPrincipal = renderCase("TKG_LOW_BALANCE_LATEST_FIVE");

    expect(noActivity).toContain("нет входящих переводов основной суммы");
    expect(noActivity).toContain("Технические комиссии не считаются движением основной суммы");
    expect(smallPrincipal).toContain("305");
    expect(smallPrincipal).toMatch(/5 (?:перевод|движен)/i);
    expect(smallPrincipal).not.toContain("нет входящих переводов основной суммы");
  });

  it("[AC-39][UNIFIED-RENDERER] excludes every legacy LLM field and heading", () => {
    const fixture = remediationTelegramUxCase("LEGACY_LLM_ALL_FIELDS");
    const html = renderTelegramForensicResult(adaptTelegramForensicResult(fixture.source));
    const legacy = fixture.source.legacyLlmPayload!;
    const forbiddenValues = [
      legacy.model,
      legacy.verdict,
      String(legacy.confidence),
      legacy.reason,
      ...legacy.reasons,
      legacy.recommendation,
      ...legacy.citations,
      legacy.selector,
      legacy.rawCode,
      legacy.heading
    ];

    for (const value of forbiddenValues) expect(html).not.toContain(value);
    expect(html).not.toMatch(/(?:LLM|AI[- ]?вердикт|вердикт модели|confidence|цитат)/i);
  });

  it("[REQ-06][REQ-15] renders only the subject-bound deterministic score fact", () => {
    const valid = renderCase("GOLDEN_FINAL_AML");
    const invalid = renderCase("INVALID_ADDRESS_AND_ANCHOR");

    expect(valid).toContain("Кошелёк отправил 1 176 317 USDT");
    expect(valid).not.toMatch(/fast_behavior_context|rapid_transit/);
    expect(invalid).not.toMatch(/\b90\/100\b|Операцию не проводить/);
  });

  it("[REQ-06][REQ-15][SCORE-ANCHOR-NEGATIVES] fails closed for missing anchors and invalid preferred fact bindings", () => {
    const mutations = [
      (source: ReturnType<typeof clonedSource>) => { source.scoreAnchorV2 = null; },
      (source: ReturnType<typeof clonedSource>) => { source.scoreAnchorV2!.preferredFactId = ""; },
      (source: ReturnType<typeof clonedSource>) => { source.scoreAnchorV2!.preferredFactId = "missing-preferred-fact"; }
    ];

    for (const [index, mutate] of mutations.entries()) {
      const source = clonedSource("GOLDEN_FINAL_AML");
      mutate(source);
      const html = renderSource(source);
      expect(html, String(index)).toMatch(/оценк.*не рассчитан/i);
      expect(html, String(index)).not.toMatch(/\b90\/100\b|Операцию не проводить/);
    }
  });

  it("[REQ-06][REQ-15][SCORE-ANCHOR-BINDING] fails closed for wrong mode and unresolved or foreign evidence", () => {
    const wrongMode = clonedSource("GOLDEN_FINAL_AML");
    wrongMode.scoreAnchorV2!.mode = "incoming";

    const unresolvedEvidence = clonedSource("GOLDEN_FINAL_AML");
    unresolvedEvidence.scoringEvidenceV2 = [];

    const foreignEvidence = clonedSource("GOLDEN_FINAL_AML");
    foreignEvidence.scoringEvidenceV2[0]!.subjectAddress = TWGC;

    for (const [id, source] of [["wrong-mode", wrongMode], ["unresolved", unresolvedEvidence], ["foreign", foreignEvidence]] as const) {
      const html = renderSource(source);
      expect(html, id).toMatch(/оценк.*не рассчитан/i);
      expect(html, id).not.toMatch(/\b90\/100\b|Операцию не проводить/);
    }
  });

  it("[REQ-06][REQ-38][FACT-CATALOG-NEGATIVES] fails closed for an unsupported preferred fact and omits an unsupported secondary fact", () => {
    const unsupportedPrimary = clonedSource("GOLDEN_FINAL_AML");
    unsupportedPrimary.narrativeFactsV2.find((fact) => fact.id === unsupportedPrimary.scoreAnchorV2!.preferredFactId)!.factTextKey =
      "UNSUPPORTED_PREFERRED_FACT_SENTINEL";
    const primaryHtml = renderSource(unsupportedPrimary);
    expect(primaryHtml).toMatch(/оценк.*не рассчитан/i);
    expect(primaryHtml).not.toMatch(/\b90\/100\b|UNSUPPORTED_PREFERRED_FACT_SENTINEL/);

    const unsupportedSecondary = clonedSource("GOLDEN_FINAL_AML");
    const secondary = unsupportedSecondary.narrativeFactsV2.find((fact) => !fact.isScoreDriver)!;
    secondary.factTextKey = "UNSUPPORTED_SECONDARY_FACT_SENTINEL";
    const secondaryHtml = renderSource(unsupportedSecondary);
    expect(secondaryHtml).toContain("90/100");
    expect(secondaryHtml).not.toContain("UNSUPPORTED_SECONDARY_FACT_SENTINEL");
  });

  it("[REQ-07][REQ-38] renders no-final without numeric score or risk action", () => {
    for (const id of ["GOLDEN_NO_FINAL_TECHNICAL", "INVALID_ADDRESS_AND_ANCHOR"]) {
      const html = renderCase(id);
      expect(html, id).toMatch(/оценк.*не рассчитан/i);
      expect(html, id).not.toMatch(/\b\d{1,3}\/100\b/);
      expect(html, id).not.toMatch(/Операцию не проводить|не принимайте|отзовите/i);
    }
  });

  it("[REQ-07][REQ-34][TECHNICAL-REASONS] keeps provider failure and hard safety limit as separate no-final reasons", () => {
    const provider = clonedSource("GOLDEN_NO_FINAL_TECHNICAL");
    provider.technicalLimitTextKey = "provider_error";
    const hardSafety = clonedSource("GOLDEN_NO_FINAL_TECHNICAL");
    hardSafety.technicalLimitTextKey = "hard_safety_limit_exceeded";

    const providerHtml = renderSource(provider);
    const hardSafetyHtml = renderSource(hardSafety);
    expect(providerHtml).toContain("Источник данных завершил проверку с ошибкой");
    expect(providerHtml).not.toContain("предельном объёме данных");
    expect(hardSafetyHtml).toContain("предельном объёме данных");
    expect(hardSafetyHtml).not.toContain("завершил проверку с ошибкой");
    for (const html of [providerHtml, hardSafetyHtml]) expect(html).not.toMatch(/\b\d{1,3}\/100\b/);
  });

  it("[REQ-08] keeps victim spender receiver and route roles distinct", () => {
    const fixture = remediationTelegramUxCase("INCOMING_APPROVAL_ROUTE_ROLES");
    const html = renderCase(fixture.id);
    const addresses = fixture.source.narrativeFactsV2[0]!.addresses.map((item) => item.address);

    for (const value of addresses) expect(html).toContain(canonicalAddressLink(value));
    expect(html).toMatch(/кошел[её]к.*выдал доступ/i);
    expect(html).toMatch(/контракт.*получил доступ/i);
    expect(html).toMatch(/перв(?:ый|ому) получател/i);
    expect(html).toContain("→");
  });

  it("[REQ-09][REQ-28] explains bridge HTX collector and PSM without a theft claim", () => {
    const cases = [
      ["GOLDEN_WHERE_PRELIMINARY", /мост|общ.*ликвидност/i],
      ["HTX_HISTORICAL_CONTEXT", /HTX|Huobi/i],
      ["THJ_COLLECTOR_ONLY", /коллектор|сбор.*перевод/i],
      ["GOLDEN_USDD_PSM", /USDD PSM|USDT и USDD/i]
    ] as const;

    for (const [id, expected] of cases) {
      const html = renderCase(id);
      expect(html, id).toMatch(expected);
      expect(html, id).not.toMatch(/кража доказана|украл|отмывание доказано/i);
    }
  });

  it("[REQ-11] deduplicates one physical transfer across mode facts", () => {
    const html = renderCase("DEDUPLICATED_PHYSICAL_TRANSFER");

    expect(occurrences(html, "305 USDT")).toBe(1);
    expect(occurrences(html, "→")).toBe(1);
  });

  it("[REQ-18] keeps approval wallet safety separate from an AML decision", () => {
    const html = renderCase("GOLDEN_VERIFY20_ACTIVE_NO_DEBIT");

    expect(html).toContain("риск для кошелька");
    expect(html).not.toMatch(/AML|решение обменника|Операцию не проводить|требуется проверка происхождения/i);
  });

  it("[REQ-18][APPROVAL-ISOLATION] keeps approval out of AML Where and provenance sections", () => {
    for (const id of REMEDIATION_TELEGRAM_UX_CASES.filter((item) => item.source.kind === "approval_safety").map((item) => item.id)) {
      const html = renderCase(id);
      expect(html, id).not.toContain("Движение денег");
      expect(html, id).not.toContain("Покрытие");
      expect(html, id).not.toMatch(/Откуда деньги|происхождени.*средств/i);
    }
  });

  it("[REQ-27] renders deterministic contract decisions without model output", () => {
    for (const id of ["GOLDEN_GASFREE_ACCOUNT", "OFFICIAL_USDT_CONTRACT"]) {
      const html = renderCase(id);
      expect(html, id).toMatch(/контракт|USDT/i);
      expect(html, id).not.toMatch(/LLM|AI[- ]?вердикт|confidence|рекомендация модели/i);
    }
  });

  it("[REQ-31][REQ-34] keeps coverage and true no-activity wording honest", () => {
    const covered = renderCase("COVERAGE_24_10_14");
    const noActivity = renderCase("GOLDEN_TRUE_NO_ACTIVITY");
    const legacy = renderCase("GOLDEN_NO_FINAL_TECHNICAL");

    expect(covered).toMatch(/Доступно 24.*10/s);
    expect(covered).toMatch(/14.*исключен/s);
    expect(noActivity).not.toMatch(/0%|оставш.*100%/i);
    expect(legacy).toContain("Общее число доступных переводов в этом результате не сохранено");
  });

  it("[REQ-32] enforces final section order and restrained emoji budget", () => {
    for (const id of REMEDIATION_TELEGRAM_GOLDEN_IDS) {
      const html = renderCase(id);
      const headingCount = html.split("\n").filter((line) => /^[🧾🛡🔴🟠🟡🟢⚪🔎💸🧭]/u.test(line)).length;
      expect(headingCount, id).toBeLessThanOrEqual(4);
    }

    const final = renderCase("GOLDEN_FINAL_AML");
    expect(final.indexOf("Проверка кошелька")).toBeLessThan(final.indexOf("90/100"));
    expect(final.indexOf("90/100")).toBeLessThan(final.indexOf("Почему такая оценка"));
    expect(final.indexOf("Почему такая оценка")).toBeLessThan(final.indexOf("Движение денег"));
    expect(final.indexOf("Движение денег")).toBeLessThan(final.indexOf("Покрытие"));
  });

  it("[REQ-33] renders two linked routes and aggregates the remainder", () => {
    const fixture = remediationTelegramUxCase("THREE_ROUTES_AGGREGATED");
    const html = renderCase(fixture.id);
    const [first, second, third] = fixture.source.routes;

    expect(html).toContain(canonicalAddressLink(first!.fromAddress));
    expect(html).toContain(canonicalAddressLink(second!.fromAddress));
    expect(html).not.toContain(canonicalAddressLink(third!.fromAddress));
    expect(html).toMatch(/Ещ[её] 1 маршрут.*200 USDT/is);
  });

  it("[REQ-38] fails closed for invalid addresses facts and legacy denominators", () => {
    const html = renderCase("INVALID_ADDRESS_AND_ANCHOR");

    expect(html).toContain("&lt;invalid-wallet&gt;");
    expect(html).not.toContain("https://tronscan.org/#/address/<invalid-wallet>");
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/\b90\/100\b/);
    expect(html).toMatch(/общее число доступных.*не сохранено/i);
  });

  it("[REQ-32][GOLDEN-MESSAGES] matches every exact approved Telegram fixture", () => {
    expect(Object.keys(REMEDIATION_TELEGRAM_GOLDEN_MESSAGES)).toEqual([...REMEDIATION_TELEGRAM_GOLDEN_IDS]);
    expect(REMEDIATION_TELEGRAM_GOLDEN_IDS).toHaveLength(11);

    for (const id of REMEDIATION_TELEGRAM_GOLDEN_IDS) {
      expect(renderCase(id), id).toBe(REMEDIATION_TELEGRAM_GOLDEN_MESSAGES[id]);
    }
  });

  it("[REQ-32][GOLDEN-TERMINOLOGY] keeps technical English role and route terms out of user-visible Telegram copy", () => {
    const forbidden = /\b(?:owner|spender|allowance|approval|Bridge|router|DEX)\b/i;
    for (const id of REMEDIATION_TELEGRAM_GOLDEN_IDS) {
      expect(REMEDIATION_TELEGRAM_GOLDEN_MESSAGES[id], id).not.toMatch(forbidden);
      expect(renderCase(id), id).not.toMatch(forbidden);
    }
  });

  it("[REQ-32][RUNTIME-HIDDEN] omits runtime branch and SHA from ordinary Telegram results", () => {
    for (const fixture of REMEDIATION_TELEGRAM_UX_CASES) {
      const html = renderTelegramForensicResult(adaptTelegramForensicResult(fixture.source));
      expect(html, fixture.id).not.toMatch(/Runtime:|codex\/remediation-unified-telegram-ux|d18067f6|\bSHA\b/i);
    }
  });
});
