# Where Preliminary Narrative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the generic preliminary Where is money Telegram message with a short deterministic explanation of the score, its meaning, and any material coverage limit.

**Architecture:** Keep scoring and forensic collection unchanged. Extend the shared wallet narrative catalogue with structured finding/meaning copy, add a pure Where-only adapter that binds the dominant typed score signal to a subject-bound fact, and let createBot.ts render those sections as Telegram HTML. Publish a numeric preliminary score only when scoreValid is explicitly true and a structured Where fact explains it; otherwise fail closed without /100 and emit one diagnostic event.

**Tech Stack:** TypeScript 5.7, Vitest 4, Grammy Telegram HTML helpers, existing walletNarrativeSummary catalogue, existing Where and Smart Contract report types.

---

## Scope and file map

Create:

- src/bot/wherePreliminaryNarrative.ts — pure adapter from a saved WhereIsMoneyReport plus optional subject-bound Verify20 evidence to score/finding/meaning/coverage sections.
- tests/bot/wherePreliminaryNarrative.test.ts — pure selection, signal, score-validity, coverage, RU/EN, and copy-safety tests.
- tests/fixtures/forensics/wherePreliminaryNarrativeCases.ts — reusable typed Where fixtures.

Modify:

- src/bot/walletNarrativeSummary.ts — structured meaning and score-signal keys, Where-only coverage, missing source kinds, action-free shared facts, preliminary section selector.
- src/bot/createBot.ts — new preliminary rendering and diagnostic callback.
- src/index.ts — one controlled runtime diagnostic.
- tests/bot/walletNarrativeSummary.test.ts — shared catalogue regressions.
- tests/bot/createBot.test.ts — Telegram integration.
- docs/knowledge/05-where-is-money-and-incoming.md.
- docs/knowledge/08-admin-and-bot-ux.md.
- docs/knowledge/09-current-decisions.md.
- docs/knowledge/10-open-problems.md.
- docs/superpowers/specs/2026-07-11-where-preliminary-narrative-design.md.

Do not modify src/types.ts, scoring math, floors, provenance tracing, indexing, job lifecycle, Admin graphs, or saved legacy reports. Do not modify knowledge 07 unless scoring changes; that is scope drift and requires review.

## Invariants

- Publish a score only when (report.scoreValid ?? report.assessment.scoreValid) === true and a subject-bound typed fact explains the dominant score signal.
- false and undefined validity both fail closed: no score emoji, no /100, no observed context score.
- No decision, action, recommendation, Что дальше, or DeepCheck state.
- Never parse decisionReasons, assessment.reasons, hardBadEvidence.message, path reasons, method names, or LLM free text.
- Exact approval roles come only from typed provenance. A victim is not a drainer.
- HTX before 2026-05-26T00:00:00Z is named REVIEW compliance context, not sanctioned-at-transfer and not clean CEX.
- HTX at or after the boundary is sanctioned only from typed sanctioned_service evidence matched to the selected Where path.
- No Deep-only first-hop, collector, relationship, or counterparty facts.
- GasFree status does not exempt principal. A fee requires exact stored service_fee plus tron_gasfree evidence.
- Coverage is a limitation, not a risk fact. Percentages refer to money.

### Task 1: Split shared facts into finding and meaning

**Files:**

- Modify: src/bot/walletNarrativeSummary.ts:17-61,113-139,211-230,1400-1538
- Test: tests/bot/walletNarrativeSummary.test.ts:1-230,1393-1531

- [ ] **Step 1: Write the failing split-copy tests**

Add an import for buildPreliminaryNarrativeSections and these tests:

    it("uses the primary meaning as the conclusion", () => {
      const sections = buildPreliminaryNarrativeSections({
        locale: "ru",
        facts: [
          {
            id: "bridge",
            kind: "bridge_route",
            factTextRu: "83% проверяемой суммы пришло через мост UsdtOFT.",
            factTextEn: "83% of the checked amount came through the UsdtOFT bridge.",
            meaningTextRu: "Мост мог использоваться для обмена между сетями или чтобы затруднить проверку происхождения денег.",
            meaningTextEn: "The bridge may have been used for a cross-chain swap or to make origin checks harder."
          },
          {
            id: "cex",
            kind: "cex_source",
            factTextRu: "17% суммы пришло с Binance.",
            factTextEn: "17% of the amount came from Binance."
          }
        ],
        preferredFactId: "bridge",
        coverageExplanation: null
      });

      expect(sections).toEqual({
        findings: [
          "83% проверяемой суммы пришло через мост UsdtOFT.",
          "17% суммы пришло с Binance."
        ],
        conclusion: "Мост мог использоваться для обмена между сетями или чтобы затруднить проверку происхождения денег.",
        coverage: null
      });
    });

    it("keeps action in the final header and out of a sanctioned fact", () => {
      const [fact] = catalogueApi.sourceAndRouteFacts({
        paths: [postDesignationHtxPath()],
        sourcePolicyEvidence: [postDesignationHtxPolicy()]
      });

      expect(fact?.factTextRu).not.toMatch(/операцию не проводить/i);
      expect(fact?.factTextEn).not.toMatch(/do not proceed/i);
      expect(formatWalletNarrativeSummary(narrativeCase({ facts: [fact!] })))
        .toMatch(/^🔴 95\/100.*Операцию не проводить\./);
    });

Extract postDesignationHtxPath and postDesignationHtxPolicy from the existing test at current line 1393 so the test uses the same typed path and matching evidence.

- [ ] **Step 2: Verify RED**

Run:

    npm test -- tests/bot/walletNarrativeSummary.test.ts

Expected: FAIL because the meaning fields and selector do not exist and sanctioned copy contains an action.

- [ ] **Step 3: Add the shared presentation fields**

Extend NarrativeFact:

    export type NarrativeFact = {
      id: string;
      kind: NarrativeFactKind;
      evidenceIds?: string[];
      scoreSignalKeys?: string[];
      role?: NarrativeAddressRole | null;
      proofStrength?: "exact" | "strong" | "context" | "limitation";
      priority?: number;
      factTextRu: string;
      factTextEn: string;
      meaningTextRu?: string;
      meaningTextEn?: string;
    };

Add options to narrativeFact and normalize all added strings through normalizeCopy:

    type NarrativeFactOptions = {
      meaningRu?: string;
      meaningEn?: string;
      scoreSignalKeys?: string[];
    };

    function narrativeFact(
      id: string,
      kind: NarrativeFactKind,
      factTextRu: string,
      factTextEn: string,
      role: NarrativeAddressRole | null,
      proofStrength: NonNullable<NarrativeFact["proofStrength"]>,
      evidenceIds: string[] = [],
      options: NarrativeFactOptions = {}
    ): NarrativeFact {
      return {
        id,
        kind,
        evidenceIds: [...new Set(evidenceIds.filter(Boolean))].sort(compareLexical),
        scoreSignalKeys: [...new Set(options.scoreSignalKeys ?? [])].sort(compareLexical),
        role,
        proofStrength,
        priority: factRank[kind],
        factTextRu: normalizeCopy(factTextRu),
        factTextEn: normalizeCopy(factTextEn),
        ...(options.meaningRu ? { meaningTextRu: normalizeCopy(options.meaningRu) } : {}),
        ...(options.meaningEn ? { meaningTextEn: normalizeCopy(options.meaningEn) } : {})
      };
    }

Normalize the new fields in buildWalletNarrativeCase and include them in deterministic comparison.

Keep two localization helpers so final and preliminary rendering cannot drift:

    function localizedFindingText(fact: NarrativeFact, locale: WalletNarrativeLocale): string {
      return locale === "en" ? fact.factTextEn : fact.factTextRu;
    }

    function localizedMeaningText(fact: NarrativeFact, locale: WalletNarrativeLocale): string | null {
      return (locale === "en" ? fact.meaningTextEn : fact.meaningTextRu)?.trim() || null;
    }

    function localizedFactText(fact: NarrativeFact, locale: WalletNarrativeLocale): string {
      return [localizedFindingText(fact, locale), localizedMeaningText(fact, locale)]
        .filter((part): part is string => Boolean(part))
        .join(" ");
    }

The existing final formatter, sentence dedupe, and body budget continue to use localizedFactText, so they retain both the fact and its meaning. The preliminary selector below uses localizedFindingText for bullets and localizedMeaningText for the one conclusion.

- [ ] **Step 4: Add the reusable section selector**

    export type PreliminaryNarrativeSections = {
      findings: string[];
      conclusion: string | null;
      coverage: string | null;
    };

    export function buildPreliminaryNarrativeSections(input: Pick<
      WalletNarrativeCase,
      "locale" | "facts" | "preferredFactId" | "coverageExplanation"
    >): PreliminaryNarrativeSections {
      const normalized = buildWalletNarrativeCase({
        locale: input.locale,
        decision: "NO_FINAL_DECISION",
        score: null,
        facts: input.facts,
        preferredFactId: input.preferredFactId,
        coverageExplanation: input.coverageExplanation
      });
      const selected = selectNarrativeFacts(normalized);
      const meaning = selected[0] ? localizedMeaningText(selected[0], input.locale) : null;
      return {
        findings: selected.map((fact) => localizedFindingText(fact, input.locale)),
        conclusion: meaning,
        coverage: normalized.coverageExplanation
          ? input.locale === "en"
            ? normalized.coverageExplanation.textEn
            : normalized.coverageExplanation.textRu
          : null
      };
    }

Before returning, apply the existing MAX_BODY_LENGTH to the rendered headings plus content. Keep the primary finding first, then coverage, then the primary meaning, then the optional second finding. The final visible order remains Findings, Conclusion, Coverage. If the optional second fact does not fit, drop it. If meaning does not fit beside primary plus coverage, drop meaning. Add a worst-case RU/EN unit test asserting the returned preliminary body is at most 500 characters and has no empty heading. Do not cut amounts, addresses, percentages, or sentences.

Do not change final header behavior.

- [ ] **Step 5: Remove action from shared sanctioned facts**

Keep the observed fact in factText. Store this meaning separately:

    const sanctionedMeaning = {
      ru: "Это прямой санкционный источник выбранной части суммы.",
      en: "This is a direct sanctioned source for the selected share."
    };

The final action remains in scoredHeader only.

- [ ] **Step 6: Verify GREEN and commit**

    npm test -- tests/bot/walletNarrativeSummary.test.ts
    git add src/bot/walletNarrativeSummary.ts tests/bot/walletNarrativeSummary.test.ts
    git commit -m "refactor: split wallet narrative findings and meaning"

Expected: PASS, including final header, body budget, TGyt, Verify20, approval roles, subject binding, dedupe, and coverage.

### Task 2: Complete the Where source and coverage catalogue

**Files:**

- Modify: src/bot/walletNarrativeSummary.ts:711-1170
- Test: tests/bot/walletNarrativeSummary.test.ts:1393-1815,2313-2414

- [ ] **Step 1: Write RED tests for missing typed sources**

Add one table using existing originPath and policyEvidence helpers:

    it.each([
      ["mixer", "Known mixer", /35%.*миксер/i, /источник.*нельзя.*проследить/i],
      ["no_name_token_liquidity", null, /35%.*пул.*без установленного названия/i, /источник.*не установлен/i],
      ["unknown_cex", null, /35%.*биржевой сервис.*не удалось подтвердить/i, /общей ликвидност/i],
      ["risky_label", "phishing", /35%.*метк.*фишинг/i, /риск.*этой части суммы/i],
      ["whitebit", "WhiteBIT", /35%.*WhiteBIT/i, /дополнительн.*проверк.*происхожд/i]
    ] as const)("renders typed %s exposure", (kind, label, finding, meaning) => {
      const txHash = kind.padEnd(64, "1").slice(0, 64);
      const [fact] = catalogueApi.sourceAndRouteFacts({
        paths: [originPath({
          balanceTransferTxHash: txHash,
          exposureSourceLabel: label,
          sourceExposureKind: kind,
          balanceShare: 0.35,
          txHashes: [txHash]
        })],
        sourcePolicyEvidence: [policyEvidence({
          kind,
          aggregateShare: 0.35,
          effectiveShare: 0.35,
          evidenceIds: [txHash],
          reasons: ["POISON_RAW_REASON"],
          shareDetail: {
            ...policyEvidence().shareDetail!,
            affectedAmountRaw: "35000000000",
            rawShare: 0.35,
            effectiveShare: 0.35
          }
        })]
      });

      expect(fact?.factTextRu).toMatch(finding);
      expect(fact?.meaningTextRu).toMatch(meaning);
      expect(JSON.stringify(fact)).not.toContain("POISON_RAW_REASON");
    });

Add pre-designation and exact-boundary HTX tests:

    expect(preDesignationFact.factTextRu).toMatch(/40%.*HTX.*до.*санкцион/i);
    expect(preDesignationFact.meaningTextRu).toMatch(/биржа может задержать.*дополнительн.*проверк/i);
    expect(preDesignationFact.meaningTextRu).not.toMatch(/прямой санкционный источник/i);
    expect(atBoundaryFact.meaningTextRu).toMatch(/прямой санкционный источник/i);

- [ ] **Step 2: Verify RED**

    npm test -- tests/bot/walletNarrativeSummary.test.ts

Expected: FAIL for missing source kinds, HTX share/meaning, and unsplit bridge/CEX copy.

- [ ] **Step 3: Add semantic kinds and copy**

Add mixer_source, contract_suspicion, and unknown_source to NarrativeFactKind. Use ranks 3, 4, and 5 respectively.

Add this exhaustive typed copy table:

    const additionalSourceCopy = {
      mixer: {
        kind: "mixer_source",
        unnamedRu: "миксер без установленного названия",
        unnamedEn: "an unnamed mixer",
        meaningRu: "После миксера первоначальный источник денег нельзя надёжно проследить.",
        meaningEn: "After a mixer, the original source of funds cannot be traced reliably."
      },
      no_name_token_liquidity: {
        kind: "unknown_source",
        unnamedRu: "пул ликвидности без установленного названия",
        unnamedEn: "an unnamed liquidity pool",
        meaningRu: "Первоначальный источник этой части суммы не установлен.",
        meaningEn: "The original source of this share is unknown."
      },
      unknown_cex: {
        kind: "cex_source",
        unnamedRu: "биржевой сервис, название которого не удалось подтвердить",
        unnamedEn: "an exchange service whose name could not be confirmed",
        meaningRu: "Трассировка остановилась на общей ликвидности сервиса.",
        meaningEn: "The trace stopped at the service's pooled liquidity."
      },
      risky_label: {
        kind: "direct_counterparty_exact_label",
        unnamedRu: "источник с подтверждённой риск-меткой",
        unnamedEn: "a source with a confirmed risk label",
        meaningRu: "Повышенный риск относится к этой части суммы.",
        meaningEn: "The elevated risk applies to this share."
      },
      whitebit: {
        kind: "direct_counterparty_sanction",
        unnamedRu: "WhiteBIT",
        unnamedEn: "WhiteBIT",
        meaningRu: "Принимающая биржа может запросить дополнительную проверку происхождения этой части суммы.",
        meaningEn: "A receiving exchange may request additional source-of-funds checks for this share."
      }
    } satisfies Record<string, {
      kind: NarrativeFactKind;
      unnamedRu: string;
      unnamedEn: string;
      meaningRu: string;
      meaningEn: string;
    }>;

Build these facts only from typed path kind and matching SourcePolicyEvidence. Use policyForRoute, sourceShareText, routeEvidenceIds, and aggregateSourceIdentity. Never inspect reasons or warnings. Set scoreSignalKeys to the source kind and source_policy:<kind>.

- [ ] **Step 4: Split every Where-capable source fact**

Update sanctionedSourceFacts, htxContextFacts, crossChainFacts, bridgeRouterDexFacts, cexFacts, unknownContractFacts, and the new source function:

- factText contains observed source, amount/share, count, and role.
- meaningText contains the consequence.
- no action appears in either.
- scoreSignalKeys contains the typed source kind.

Use this exact historical HTX meaning:

    ru: "Это историческая связь с HTX. Она остаётся существенным compliance-риском: принимающая биржа может задержать средства и запросить дополнительную проверку их происхождения."
    en: "This is a historical HTX link and remains material compliance context: a receiving exchange may delay the funds and request additional source-of-funds checks."

Never infer sanctions from the name HTX. Only matched sanctioned_service evidence gets sanctioned meaning.

- [ ] **Step 5: Make money coverage usable without Deep first-hop data**

Change coverageExplanationFor:

    export function coverageExplanationFor(input: {
      firstHopCoverage?: FirstHopBlacklistCoverage | null;
      whereCoverage?: WhereIsMoneyCoverage | null;
      traceHistoryCoverage?: MoneyOriginTraceHistoryCoverage[];
    }): CoverageExplanation | null {
      const trace = whereCoverageText(input.whereCoverage, input.traceHistoryCoverage ?? []);
      const parts = input.firstHopCoverage ? firstHopCoverageParts(input.firstHopCoverage) : [];
      if (trace) parts.unshift(trace);
      if (parts.length === 0) return null;
      return {
        reasonKind: input.firstHopCoverage?.blacklistCheckCoverage ?? "where_money_coverage",
        textRu: normalizeCopy(parts.map((part) => part.ru).join(" ")),
        textEn: normalizeCopy(parts.map((part) => part.en).join(" ")),
        isRiskEvidence: false
      };
    }

whereCoverageText must return null for non-finite or out-of-range ratios. Keep structured provider-cap, budget, inconsistency, and failure mappings. Never use coverage.notes as user copy.

Add a Where-side fee helper over BalanceFormingTransfer:

    export function gasFreeFeeFactFromBalanceTransfers(
      transfers: BalanceFormingTransfer[]
    ): NarrativeFact | null {
      const exactFees = transfers.filter((transfer) =>
        transfer.economicRole === "service_fee" &&
        transfer.economicProtocol === "tron_gasfree"
      );
      if (exactFees.length === 0) return null;
      return gasFreeFeeNarrativeFactFromRows(exactFees.map((transfer) => ({
        txHash: transfer.txHash,
        fromAddress: transfer.fromAddress,
        toAddress: transfer.toAddress,
        amountRaw: transfer.amountRaw
      })));
    }

Extract gasFreeFeeNarrativeFactFromRows from the existing gasFreeFeeFact implementation so DirectCounterpartyInteractionProfile and Where BalanceFormingTransfer inputs share the same BigInt sum, dedupe, and copy. Never infer a fee from address, amount, or time.

- [ ] **Step 6: Verify and commit**

    npm test -- tests/bot/walletNarrativeSummary.test.ts tests/forensics/moneyOriginPolicy.test.ts tests/forensics/gasFreeSettlement.test.ts
    git add src/bot/walletNarrativeSummary.ts tests/bot/walletNarrativeSummary.test.ts
    git commit -m "feat: complete where narrative signal catalogue"

Expected: PASS.

### Task 3: Build the pure Where adapter

**Files:**

- Create: src/bot/wherePreliminaryNarrative.ts
- Create: tests/bot/wherePreliminaryNarrative.test.ts
- Create: tests/fixtures/forensics/wherePreliminaryNarrativeCases.ts
- Modify: src/bot/walletNarrativeSummary.ts:113-139,1260-1305 — export canonical fact normalization and the existing allowlisted Fast copy/score helpers
- Modify: src/bot/createBot.ts:3500-3645 — import those Fast helpers; keep final selection behavior unchanged

- [ ] **Step 1: Create reusable typed fixtures**

Export complete implementations of:

    whereAssessmentFixture(overrides?: Partial<WhereIsMoneyAssessment>)
    whereReportFixture(overrides?: Partial<WhereIsMoneyReport>)
    bridgeWhereReportFixture(input?: { score?: number; share?: number; transferCount?: number; scoreValid?: boolean })
    htxWhereReportFixture(classification: "historical" | "sanctioned")
    approvalWhereReportFixture(role: "victim" | "first_receiver" | "route_linked")

Use current SCORING_SIGNAL_MATRIX_POLICY_VERSION and consistent dominantRiskLayer, sourcePolicyEvidence, originPaths, and evidence IDs. Move shared defaults from createBot.test.ts; do not put assertions in fixtures.

Reuse the complete current object bodies from tests/bot/createBot.test.ts:1008-1088 and the complete originPath/policyEvidence/whereCoverage/traceHistory bodies from tests/bot/walletNarrativeSummary.test.ts:814-978. Change only names and exported visibility. This is a mechanical fixture move: all POISON reason strings remain so the new tests prove that raw text is ignored.

- [ ] **Step 2: Write RED score-binding tests**

    it("binds 78 to the dominant 83% bridge fact", () => {
      const result = buildWherePreliminaryNarrative(
        bridgeWhereReportFixture({ score: 78, share: 0.83, transferCount: 10 }),
        { locale: "ru" }
      );
      expect(result.score).toBe(78);
      expect(result.sections.findings[0]).toMatch(/83%.*UsdtOFT.*10 перевод/i);
      expect(result.sections.conclusion).toMatch(/обмен.*сет|затруднить.*происхожд/i);
      expect(result.diagnosticCode).toBeNull();
    });

    it.each([false, undefined])("hides score for scoreValid=%s", (validity) => {
      const report = bridgeWhereReportFixture({ score: 78, scoreValid: false });
      if (validity === undefined) {
        delete report.scoreValid;
        delete report.assessment.scoreValid;
      }
      const result = buildWherePreliminaryNarrative(report, { locale: "ru" });
      expect(result.score).toBeNull();
      expect(result.sections.findings).toEqual([]);
      expect(result.sections.coverage).toBeTruthy();
    });

    it("fails closed when no typed fact explains a valid score", () => {
      const report = bridgeWhereReportFixture({ score: 78 });
      report.originPaths = [];
      report.assessment.sourcePolicyEvidence = [];
      const result = buildWherePreliminaryNarrative(report, { locale: "ru" });
      expect(result.score).toBeNull();
      expect(result.diagnosticCode).toBe("where_preliminary_score_without_structured_fact");
    });

Add table cases for approval victim/receiver/route-linked, mixer, sanctioned service, historical HTX, exact subject-bound Fast blacklist, typed drainer_like and unknown_suspicious contract context, low-risk Binance, unresolved origin, and every typed age signal. Every scored case asserts a concrete first finding and null diagnostic.

Use this exact case matrix:

| Case | Required typed input | Required first finding / conclusion |
|---|---|---|
| approval victim | exact profile, subject equals victimAddress | address is the victim; no drainer role |
| approval first receiver | exact profile, subject equals firstReceiverAddress | first recipient of debited USDT |
| approval route-linked | route_linked profile with positive hopDepth | later link and preserved share |
| mixer | matched mixer path/policy IDs | share through mixer; original source not reliably traceable |
| sanctioned service | matched sanctioned_service path/policy IDs | direct sanctioned source |
| historical HTX | htx_huobi selected path | pre-designation historical HTX compliance risk |
| Fast blacklist | matching Fast subject plus stablecoin_usdt_blacklisted | address is in USDT blacklist; tokens frozen |
| exact Verify20 subject | full matched fingerprint, trusted-service guard false, matching subject | known Verify20 drainer template; no claimed specific debit |
| drainer-like contract | contract_suspicion kind drainer_like | resembles debit pattern; exact debit not confirmed |
| unknown suspicious contract | contract_suspicion kind unknown_suspicious | suspicious unknown-purpose contract; no invented drain |
| Binance low risk | named allowlisted_cex selected path | scoped exchange withdrawal and pooled-liquidity boundary |
| unresolved origin | typed unresolved_origin plus valid coverage | unresolved share; no clean or crime claim |
| subject_new_large_wallet | typed age signal | new wallet received a large amount |
| relationship_new | typed age signal | main sender is new to the wallet |
| dormancy_gap | typed age signal | long inactive period before the transfer |
| relationship_repeated | typed age signal | established repeated relationship, mitigating context |
| exact GasFree fee | stored service_fee plus tron_gasfree relation available in Where evidence | technical fee separated from principal |

For GasFree, also add one negative row where the only facts are destination TLntW9Z59LYY5KEi9cmwk3PKjQga828ird, a familiar 1/1.5/2/3 USDT amount, and close timing. It must not create a fee fact.

Add negative tests for mismatched Fast subject, mismatched Verify20 subject, raw reason poison, ordinary transferFrom, and a single Verify20 selector.

- [ ] **Step 3: Verify RED**

    npm test -- tests/bot/wherePreliminaryNarrative.test.ts

Expected: FAIL because fixture and adapter modules do not exist.

- [ ] **Step 4: Implement public result types and strict gate**

    export type WherePreliminaryDiagnosticCode =
      | "where_preliminary_score_without_structured_fact";

    export type WherePreliminaryNarrative = {
      score: number | null;
      sections: PreliminaryNarrativeSections;
      preferredFactId: string | null;
      diagnosticCode: WherePreliminaryDiagnosticCode | null;
    };

    export function buildWherePreliminaryNarrative(
      report: WhereIsMoneyReport,
      options: {
        locale: WalletNarrativeLocale;
        verify20?: Verify20NarrativeEvidence | null;
      }
    ): WherePreliminaryNarrative;

Build shared evidence only from report.subjectAddress, Where approval profiles, subject-bound Verify20, originPaths, sourcePolicyEvidence, Where coverage, and path history coverage. Add deterministic facts from subject-bound fastWalletRisk, typed contractSuspicionEvidence, typed unknownOriginEvidence, and typed age signal codes. Do not read raw messages.

Append gasFreeFeeFactFromBalanceTransfers(report.balanceFormingTransfers) only when it returns an exact fact. It remains optional technical detail and never becomes the explaining score fact.

Move exactFastNarrativeCopies, behaviorFastNarrativeCopies, fastNarrativeCopy, and fastNarrativeReasonScore from createBot.ts into walletNarrativeSummary.ts and export only the two functions. createBot.ts must call the exported functions from its unchanged dominantFastNarrativeFact. The Where adapter may call fastNarrativeCopy only after it has verified fastWalletRisk.subjectAddress === report.subjectAddress and matched the reason code/evidence to the typed driver.

Rename canonicalFacts to exported canonicalNarrativeFacts and use it both from buildWalletNarrativeEvidence and the Where adapter. Do not add a second dedupe implementation.

Represent a score driver as:

    type WhereNarrativeDriver = {
      score: number;
      evidenceIds: string[];
      signalKeys: string[];
    };

driverFromReport uses dominantRiskLayer first. If absent, choose the highest typed hardBadEvidence, sourcePolicyEvidence, contractSuspicionEvidence, or unknownOriginEvidence item by score then stable signal key. Build keys from kind, sourceExposureKind, and evidenceClass.

Choose preferredFactId in this exact order:

1. overlapping evidenceIds;
2. overlapping fact.scoreSignalKeys and driver.signalKeys;
3. exact subject-bound Fast evidence;
4. for low score without an adverse driver, a named CEX/source fact;
5. no explaining fact.

Use:

    const scoreValid = (report.scoreValid ?? report.assessment.scoreValid) === true;
    const publishScore = scoreValid && preferredFactId !== null;

If publishScore is false, return null score and no findings/conclusion. Keep only structured coverage. If validity is true but no fact matches, return the diagnostic code.

- [ ] **Step 5: Add typed no-score coverage copy**

Map provider_cap_unresolved, insufficient_coverage, local_budget_limited, and local_index_read_failed to plain RU/EN sentences. Unknown codes use:

    RU: "Данных недостаточно, чтобы рассчитать предварительный риск."
    EN: "There is not enough data to calculate preliminary risk."

Never print the code.

- [ ] **Step 6: Verify and commit**

    npm test -- tests/bot/wherePreliminaryNarrative.test.ts tests/bot/walletNarrativeSummary.test.ts tests/risk/fastEvidence.test.ts tests/check/smartContractCheck.test.ts
    git add src/bot/wherePreliminaryNarrative.ts src/bot/walletNarrativeSummary.ts src/bot/createBot.ts tests/bot/wherePreliminaryNarrative.test.ts tests/fixtures/forensics/wherePreliminaryNarrativeCases.ts
    git commit -m "feat: build typed where preliminary narrative"

Expected: PASS. Every published fixture score has a preferred structured fact.

### Task 4: Wire Telegram and diagnostics

**Files:**

- Modify: src/bot/createBot.ts:43-55,1821-1835,2173-2265
- Modify: src/index.ts:985-1002
- Test: tests/bot/createBot.test.ts:1008-1088,6303-6405

- [ ] **Step 1: Rewrite stale preliminary tests as RED**

New expectations:

Add this local helper beside the existing Where delivery tests:

    function preliminaryDeliveryText(
      report: WhereIsMoneyReport,
      options: Parameters<typeof formatWhereIsMoneyUserDeliveryReport>[4] = { locale: "ru" }
    ): string {
      const deepJob = whereIsMoneyJobForTest({
        id: "deep-preliminary-running",
        kind: "address_deep_check",
        status: "running",
        subjectAddress: report.subjectAddress,
        resultJson: {}
      });
      return plainTelegramText(formatWhereIsMoneyUserDeliveryReport(
        whereIsMoneyJobForTest({ progressJson: { locale: "ru" } }),
        report,
        "completed",
        deepJob,
        options
      ).text);
    }

    expect(text).toContain("Откуда деньги — предварительный результат");
    expect(text).toContain("Предварительный риск: 🟠 78/100");
    expect(text).toContain("Что нашли");
    expect(text).toContain("Вывод");
    expect(text).not.toMatch(/Почему|Что дальше|DeepCheck|Финальный итог придёт/i);
    expect(text).not.toMatch(/Операцию не проводить|Можно принять|transferFrom|hard-proof/i);

Add queued/running Deep cases, partial Where with pending Deep, invalid score, valid-unexplained diagnostic, locale precedence, runtime marker, completed current Deep unchanged, absent/failed Deep unchanged, and legacy undefined validity fail-closed.

Add score-band coverage with the same bridge fixture:

    it.each([
      [29, "🟢"],
      [30, "🟡"],
      [60, "🟠"],
      [85, "🔴"]
    ] as const)("keeps the preliminary emoji at %s", (score, icon) => {
      expect(preliminaryDeliveryText(bridgeWhereReportFixture({ score })))
        .toContain(icon + " " + score + "/100");
    });

Add one English assertion with no Russian headings, and one service label containing `<Bridge & Co>`: plainTelegramText must contain the label exactly once while raw Telegram HTML contains `&lt;Bridge &amp; Co&gt;` exactly once. This proves that catalogue copy is escaped by Telegram helpers, not pre-escaped or double-escaped.

- [ ] **Step 2: Verify RED**

    npm test -- tests/bot/createBot.test.ts

Expected: FAIL on the old generic formatter.

- [ ] **Step 3: Replace the formatter**

Delete wherePreliminaryHardEvidenceLines. Preliminary must not call whereHardEvidenceReasonLines.

Add:

    export type WherePreliminaryDiagnostic = {
      code: "where_preliminary_score_without_structured_fact";
      jobId: string;
      subjectAddress: string;
      riskScore: number;
    };

Extend delivery options with:

    onPreliminaryDiagnostic?: (diagnostic: WherePreliminaryDiagnostic) => void;

Obtain Verify20 only through extractSmartContractCheckReportFromJob and only when its subject matches report.subjectAddress.

Render:

    const narrative = buildWherePreliminaryNarrative(report, { locale, verify20 });
    if (narrative.diagnosticCode) {
      options.onPreliminaryDiagnostic?.({
        code: narrative.diagnosticCode,
        jobId: job.id,
        subjectAddress: report.subjectAddress,
        riskScore: report.riskScore
      });
    }

    return telegramHtmlMessage([
      bold(locale === "en" ? "Where Is Money — preliminary result" : "Откуда деньги — предварительный результат"),
      bold(locale === "en" ? "Address" : "Адрес") + ": " + code(report.subjectAddress),
      narrative.score === null
        ? bold(locale === "en" ? "Preliminary risk was not calculated" : "Предварительный риск не рассчитан")
        : bold(locale === "en" ? "Preliminary risk" : "Предварительный риск") + ": " +
          formatRiskIcon(levelFromScore(narrative.score)) + " " + code(String(narrative.score) + "/100"),
      narrative.sections.findings.length > 0
        ? section(locale === "en" ? "Finding" : "Что нашли", [bulletList(narrative.sections.findings)])
        : null,
      narrative.sections.conclusion
        ? section(locale === "en" ? "Conclusion" : "Вывод", [narrative.sections.conclusion])
        : null,
      narrative.sections.coverage
        ? section(locale === "en" ? "Coverage limits" : "Границы проверки", [narrative.sections.coverage])
        : null,
      runtimeMarkerLine(options.runtimeLabel)
    ].filter((line): line is string => Boolean(line)));

Do not change pending/completed/missing Deep routing.

- [ ] **Step 4: Log once at runtime delivery**

In src/index.ts add:

    onPreliminaryDiagnostic: (diagnostic) => {
      logger.warn("where_preliminary_score_without_structured_fact", diagnostic);
    }

Do not mutate the job or database.

- [ ] **Step 5: Verify and commit**

    npm test -- tests/bot/createBot.test.ts tests/bot/wherePreliminaryNarrative.test.ts tests/bot/walletNarrativeSummary.test.ts tests/check/whereIsMoneyCheck.test.ts tests/check/smartContractCheck.test.ts
    git add src/bot/createBot.ts src/index.ts tests/bot/createBot.test.ts
    git commit -m "feat: explain where preliminary risk in telegram"

Expected: PASS.

### Task 5: Update product truth and run final gates

**Files:**

- Modify: docs/knowledge/05-where-is-money-and-incoming.md
- Modify: docs/knowledge/08-admin-and-bot-ux.md
- Modify: docs/knowledge/09-current-decisions.md
- Modify: docs/knowledge/10-open-problems.md
- Modify: docs/superpowers/specs/2026-07-11-where-preliminary-narrative-design.md

- [ ] **Step 1: Update docs from verified code**

Record that preliminary Where uses explicit scoreValid true, a subject-bound structured explaining fact, at most two findings, one primary meaning, and a separate coverage limit. Record that it has no decision/action/DeepCheck/raw/LLM copy. In knowledge 10 remove only the fixed preliminary generic-message bullet. Preserve the HTX Deep/Where route-selection gap and all indexing gaps. Mark the design spec implemented and add the implementing commit IDs.

- [ ] **Step 2: Run affected-area tests**

    npm test -- tests/bot/wherePreliminaryNarrative.test.ts tests/bot/walletNarrativeSummary.test.ts tests/bot/createBot.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/moneyOriginPolicy.test.ts tests/check/smartContractCheck.test.ts tests/forensics/gasFreeSettlement.test.ts tests/risk/fastEvidence.test.ts

Expected: PASS.

- [ ] **Step 3: Run the full gate**

    npm test
    npm run typecheck
    git diff --check

Expected: full Vitest PASS, TypeScript PASS, no whitespace errors.

- [ ] **Step 4: Run copy safety**

    rg -n "Where Is Money завершил предварительную|What happens next|Что дальше|DeepCheck ещё|Финальный итог придёт|hard-proof|transferFrom drain" src/bot tests/bot

Expected: no production match in preliminary. Tests may contain strings only in negative assertions.

Run infostyle:

    python C:\Users\User\.agents\skills\infostyle-editor\tools\glvrd-lite.py --input docs\superpowers\specs\2026-07-11-where-preliminary-narrative-design.md --markdown

Expected: zero брехня and no new raw technical jargon in user-copy examples. Markdown tables/code can lower the aggregate readability number.

- [ ] **Step 5: Commit docs**

    git add docs/knowledge/05-where-is-money-and-incoming.md docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/superpowers/specs/2026-07-11-where-preliminary-narrative-design.md
    git commit -m "docs: record where preliminary narrative behavior"

- [ ] **Step 6: Review the complete diff**

    git diff HEAD~5..HEAD -- src/bot tests/bot src/index.ts docs/knowledge docs/superpowers/specs/2026-07-11-where-preliminary-narrative-design.md

Confirm:

- every published score has a matching typed fact;
- invalid, legacy, and unexplained scores have no /100;
- HTX before/after designation copy is correct;
- approval victim/receiver/route roles remain distinct;
- preliminary has no decision, action, DeepCheck state, raw/LLM copy, or method name;
- final narrative still owns canonical action;
- no scoring, tracing, indexing, job, Admin, or stored-result behavior changed.

## Self-review result

- Spec coverage: every approved signal family, score gate, HTX correction, coverage case, low-risk case, and Telegram section has a task and test.
- Placeholder scan: no TBD, TODO, implement later, or undefined follow-up task.
- Type consistency: meaningText, scoreSignalKeys, WherePreliminaryNarrative, diagnostic code, and callback use one spelling throughout.
- Scope: one focused production file and one shared fixture; no dependency, migration, public API, scoring change, or forensic schema change.
