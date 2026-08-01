# Telegram Risk Report Human Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сделать итоговый Telegram/Admin риск-отчет понятным: показать, что нашли FastCheck, Where Is Money и DeepCheck, почему получился итоговый риск, что это может значить и что делать дальше, без raw scoring dump в обычном сообщении.

**Architecture:** scoring math не меняется. `calculateUnifiedWalletRisk` остается числовым источником истины для score/decision. Новый слой `src/bot/riskExplanationSummary.ts` собирает human summary из `RiskReport`, `WhereIsMoneyReport`, `DeepAddressForensicReport` и `UnifiedWalletRiskResult`. Обычный Telegram-отчет и расширенный отчет строятся из одного summary. Admin graph получает тот же human summary в `graph.summary`, чтобы right rail показывал смысловые причины рядом с evidence graph.

**Tech Stack:** TypeScript, Vitest, grammy/Telegram HTML helpers, existing Admin plain HTML/JS, existing forensic job storage. No new dependencies and no DB migration.

---

## Current State Verified

- `src/bot/createBot.ts`
  - `formatUnifiedAddressFinalReport` builds the final Telegram report.
  - `buildFinalReasonCards` collects current final reason cards.
  - `whereCoverageSummaryLine` still has English output for some Russian coverage scopes.
  - `formatInvalidWhereScoreFinalReport` still shows English labels in Russian mode.
  - `formatWhereIsMoneyUserDeliveryReport` and `formatDeepForensicUserDeliveryReport` already combine Where + Deep into the final report when both jobs exist.
- `src/risk/unifiedWalletRisk.ts`
  - `UnifiedWalletRiskResult` is exported.
  - `calculateUnifiedWalletRisk` is exported and must stay the only final score calculator for this change.
- `src/risk/scoringSignalMatrixInputs.ts`
  - Signal sources include FastCheck context, USDT blacklist, exact/route-linked approval-drain, high-risk inbound/extended provenance, source-policy provenance, asset continuation, operational flow, service boundary, counterparty context, wallet role.
- `src/admin/forensicsGraph.ts`
  - `AdminForensicsSummary` currently has `topReasons` but no human grouped explanation.
- `src/admin/adminConsole.ts`
  - The right rail currently renders `Why`, `Warnings`, `Stop reasons`, `Risk layers`, and raw summary JSON.
- `tests/bot/createBot.test.ts`
  - Has fixtures for `WhereIsMoneyReport`, `DeepAddressForensicReport`, final formatter tests, job extraction tests, and Telegram plain-text helpers.

Worktree note: before this plan, the worktree already contained unrelated Admin graph changes:

- `docs/knowledge/08-admin-and-bot-ux.md` has an Admin graph focus-line note.
- `src/admin/adminConsole.ts` changes direct-counterparty transfer visual direction and grouped-transfer styling.
- `tests/admin/adminConsole.test.ts` adds matching Admin console tests.

Preserve these changes. If implementation touches the same files, append the new bot/Admin report behavior without reverting the existing Admin graph work.

## Non-Goals

- Do not change final risk score math.
- Do not change score thresholds.
- Do not add a new dependency.
- Do not add a new DB table or persist rendered Telegram text.
- Do not expose raw matrix rows, dampener, layer weights, run profile, provider budget, or evidence class in the normal Telegram report.

## Output Contract

### Normal Telegram final report

Use this shape:

```text
Проверка адреса — итог

Адрес: <address>

Решение: не принимать автоматически.
Риск: 78/100 — высокий

Почему
• <up to 5 strongest facts>

Что это может значить
<short paragraph or 2-4 bullets>

Что делать
• <clear action>
```

Rules:

- Hard evidence first.
- Source-policy risk second.
- Behavior appears only as context.
- Coverage limitations are separate from guilt/risk proof.
- If no hard evidence was found, say that clearly.
- No raw code names unless the user-facing term is the actual domain term: `HTX/Huobi`, `USDT blacklist`, `approval-drain`, `bridge`, `DEX`.

### Detailed report

Use this shape:

```text
Расширенный отчёт по адресу

Адрес: <address>
Итог: не принимать автоматически
Риск: 78/100 — высокий

Короткий вывод
<1-2 sentences>

FastCheck
• <facts and absent evidence>

Where Is Money
• <facts and absent evidence>

DeepCheck
• <facts and absent evidence>

Что это может быть
• <possible interpretation>

Ограничения
• <data limitations>

Рекомендация
<final recommendation>
```

Rules:

- Show all material facts from all available modes.
- Show negative facts when they help interpretation: no exact approval-drain, no USDT blacklist, no deterministic theft proof.
- Include percent/share/hop count when present.
- Do not show matrix rows, raw weights, dampener, provider budgets, run profile, or raw JSON in this detailed report. Those remain in explicit beta/internal diagnostics.

## Reason Wording Dictionary

Use these Russian strings as the canonical first pass. English strings can stay close to the current code, but Russian must come first in product copy.

| Signal | User-facing Russian text |
|---|---|
| exact approval-drain, hop 0 | `Найдена точная drainer-цепочка: approve USDT -> transferFrom -> проверяемый адрес получил средства.` |
| exact approval-drain, hop N | `Найдена точная drainer-цепочка: после approve и transferFrom средства дошли до проверяемого адреса через <N> hop.` |
| saved approval-drain marker | `Раньше система уже находила связь этого адреса с точной drainer-цепочкой.` |
| route-linked approval pattern | `Есть связь с approval-drain маршрутом, но точного доказательства списания через transferFrom до этого адреса нет.` |
| USDT blacklist | `Адрес находится в активном TRC20 USDT blacklist.` |
| sanctioned service | `Найдена связь с сервисом из санкционного списка. Такой источник нельзя принимать автоматически.` |
| HTX/Huobi selected amount | `В выбранной сумме найден источник HTX/Huobi: <percent>.` |
| historical HTX/Huobi | `Историческая связь с HTX/Huobi есть, но это не доказывает источник выбранной суммы.` |
| source-policy floor | `Источник выбранной суммы попадает под policy-риск. Это не доказывает кражу, но депозит нельзя принимать автоматически.` |
| bridge/router/DEX source | `Часть цепочки проходит через bridge, router или DEX. После такой границы публичная трассировка может быть неполной.` |
| clean CEX not proven | `Чистый CEX-источник не доказан полностью.` |
| service boundary | `Цепочка дошла до биржи или сервиса. Дальше публичная on-chain трассировка ограничена.` |
| operational wallet | `Адрес похож на рабочий кошелёк: принимает USDT, собирает ликвидность и переводит средства дальше.` |
| transit wallet | `Адрес похож на транзитный кошелёк: быстро получает и переводит USDT дальше.` |
| collector/liquidity wallet | `Адрес похож на кошелёк для сбора ликвидности.` |
| risky direct counterparty | `Есть крупный контрагент с высоким риском. Это контекст, не доказательство грязного происхождения.` |
| high-risk inbound provenance | `DeepCheck нашёл точную on-chain связь с высокорисковым источником.` |
| high-risk extended provenance | `DeepCheck нашёл более длинную точную on-chain связь с высокорисковым источником.` |
| asset continuation | `Найдена cross-chain или asset-continuation связь с рискованным направлением.` |
| partial coverage | `Проверка относится к выбранной сумме и доступным данным, а не ко всей истории адреса.` |
| no hard evidence | `Точных признаков кражи, drainer-цепочки или USDT blacklist не найдено.` |
| no final decision | `Итоговый риск не опубликован: не хватает данных по происхождению средств.` |

## Implementation Tasks

- [ ] 1. Baseline and guard the worktree

  Files: none.

  Steps:

  1. Run:

     ```powershell
     git status --short
     ```

     Expected:

     - Existing modified files may include `docs/knowledge/08-admin-and-bot-ux.md`, `src/admin/adminConsole.ts`, and `tests/admin/adminConsole.test.ts`.
     - No source files should be modified before implementation starts.

  2. Run current targeted tests before changing behavior:

     ```powershell
     npm test -- tests/bot/createBot.test.ts
     ```

     Expected:

     - Vitest exits `0`.
     - Output includes `Test Files  1 passed`.

  3. If the Admin graph files above are still modified, keep their existing direct-counterparty/grouped-transfer changes. Do not revert them.

- [ ] 2. Add red tests for the new user-facing output

  Files:

  - `tests/bot/createBot.test.ts`

  Add tests near the existing unified final report tests.

  Test cases:

  1. Compact Russian final report with HTX/Huobi source-policy risk:

     - Arrange `whereIsMoneyReportForTest` with `sourceBundleExposure.htxHuobiShare = 0.7`, `coverage.selectedInboundTxCount = 1`, `coverage.coverageRatio = 1`.
     - Include `deepReportForTest({ boundaryExposureProfiles: [boundaryExposureProfile()] })`.
     - Assert text contains:
       - `Проверка адреса — итог`
       - `Решение: не принимать автоматически.`
       - `Риск:`
       - `В выбранной сумме найден источник HTX/Huobi: 70%.`
       - `Цепочка дошла до биржи или сервиса.`
       - `Точных признаков кражи, drainer-цепочки или USDT blacklist не найдено.`
       - `Запросить подтверждение происхождения средств.`
     - Assert text does not contain:
       - `matrix`
       - `Matrix`
       - `Weighted layer score`
       - `Dampener`
       - `Beta/internal`
       - `source-policy threshold`

  2. Compact Russian final report with exact approval-drain:

     - Reuse the existing approval-drain fixture.
     - Assert text contains:
       - `Найдена точная drainer-цепочка: approve USDT -> transferFrom -> проверяемый адрес получил средства.`
       - `Не принимать депозит автоматически.`
     - Assert the drainer line appears once.
     - Assert text does not contain:
       - `Exact approval-drain provenance reaches checked wallet`
       - `Scoring Signal Matrix`

  3. Detailed Russian report grouped by modes:

     - Add a test helper:

       ```ts
       function formatUnifiedAddressDetailedReportForTest(input: {
         address: string;
         whereReport: WhereIsMoneyReport;
         fastReport?: RiskReport | null;
         deepReport?: DeepAddressForensicReport | null;
         locale?: BotLocale;
       }): string {
         const formatter = (createBotModule as {
           formatUnifiedAddressDetailedReport?: (input: {
             address: string;
             whereReport: WhereIsMoneyReport;
             fastReport?: RiskReport | null;
             deepReport?: DeepAddressForensicReport | null;
             locale?: BotLocale;
           }) => { text: string };
         }).formatUnifiedAddressDetailedReport;

         expect(formatter, "formatUnifiedAddressDetailedReport should be exported").toBeTypeOf("function");
         return plainTelegramText(formatter!(input).text);
       }
       ```

     - Assert text contains:
       - `Расширенный отчёт по адресу`
       - `Короткий вывод`
       - `FastCheck`
       - `Where Is Money`
       - `DeepCheck`
       - `Что это может быть`
       - `Ограничения`
       - `Рекомендация`
       - `70% выбранной суммы связано с HTX/Huobi.`
       - `Exact approval-drain не найден.`
       - `USDT blacklist не найден.`
     - Assert text does not contain raw scoring/debug words from case 1.

  4. Russian no-final-decision report:

     - Arrange `whereReport.scoreValid = false`, `assessment.scoreValid = false`, `scoreBlockedReason = "insufficient_coverage"`.
     - Assert text contains:
       - `Проверка адреса — без итогового решения`
       - `Итоговый риск не опубликован: не хватает данных по происхождению средств.`
       - `Что делать`
       - `Дождаться индексации или перезапустить проверку.`
     - Assert text does not contain:
       - `Blocked reason`
       - `Technical status`

  5. Russian selected-anchor coverage has no English leak:

     - Arrange `coverage.checkedScope = "selected_anchor"`.
     - Assert text contains `Проверили 100% выбранного recent-flow anchor`.
     - Assert text does not contain `Checked 100%`.

  Run:

  ```powershell
  npm test -- tests/bot/createBot.test.ts
  ```

  Expected now:

  - Tests fail because `formatUnifiedAddressDetailedReport` and the new copy do not exist yet.

- [ ] 3. Add the summary module

  Files:

  - `src/bot/riskExplanationSummary.ts`

  Add the module with this public API:

  ```ts
  import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
  import type { UnifiedWalletRiskResult } from "../risk/unifiedWalletRisk";
  import type {
    ApprovalDrainProvenanceProfile,
    BotLocale,
    RiskLevel,
    RiskReport,
    UserExchangeDecision,
    WhereIsMoneyReport
  } from "../types";

  export type RiskExplanationDecision = UserExchangeDecision | "NO_FINAL_DECISION";
  export type RiskExplanationSource = "fast" | "where" | "deep" | "unified" | "coverage";
  export type RiskExplanationMode = "fast" | "where" | "deep";

  export type RiskExplanationFactKind =
    | "hard_evidence"
    | "source_policy"
    | "behavior_context"
    | "service_boundary"
    | "coverage_limit"
    | "absent_evidence"
    | "recommendation";

  export type RiskExplanationFact = {
    kind: RiskExplanationFactKind;
    source: RiskExplanationSource;
    priority: number;
    dedupeKey: string;
    textRu: string;
    textEn: string;
    detailRu?: string;
    detailEn?: string;
    actionRu?: string;
    actionEn?: string;
  };

  export type RiskExplanationModeSection = {
    mode: RiskExplanationMode;
    titleRu: string;
    titleEn: string;
    facts: RiskExplanationFact[];
  };

  export type RiskExplanationSummary = {
    address: string;
    decision: RiskExplanationDecision;
    score: number | null;
    level: RiskLevel | null;
    shortConclusionRu: string;
    shortConclusionEn: string;
    primaryReasons: RiskExplanationFact[];
    modeSections: RiskExplanationModeSection[];
    possibleMeaningsRu: string[];
    possibleMeaningsEn: string[];
    limitationsRu: string[];
    limitationsEn: string[];
    recommendationsRu: string[];
    recommendationsEn: string[];
  };

  export type RiskExplanationInput = {
    address: string;
    whereReport: WhereIsMoneyReport;
    unifiedRisk: UnifiedWalletRiskResult;
    finalDecision: RiskExplanationDecision;
    fastReport?: RiskReport | null;
    deepReport?: DeepAddressForensicReport | null;
  };

  export type NoFinalRiskExplanationInput = {
    address: string;
    whereReport: WhereIsMoneyReport;
  };

  export function buildRiskExplanationSummary(input: RiskExplanationInput): RiskExplanationSummary;
  export function buildNoFinalRiskExplanationSummary(input: NoFinalRiskExplanationInput): RiskExplanationSummary;
  export function factText(fact: RiskExplanationFact, locale: BotLocale): string;
  export function factDetail(fact: RiskExplanationFact, locale: BotLocale): string | null;
  export function factAction(fact: RiskExplanationFact, locale: BotLocale): string | null;
  export function modeTitle(section: RiskExplanationModeSection, locale: BotLocale): string;
  ```

  Implementation details:

  - Move the `FinalReasonCard` concept into this module as `RiskExplanationFact`.
  - Keep the current dedupe behavior: same `dedupeKey` keeps the lower `priority`.
  - Keep priority sorting stable: `priority`, then `dedupeKey`.
  - Implement local helpers inside this module instead of importing from `createBot.ts`, to avoid circular imports:
    - `isFiniteNumber`
    - `formatPercent`
    - `shortIdentifier`
    - `formatRawUsdt`
    - `whereCoverageSummaryLine`
    - `approvalDrainExactFact`
  - Do not import Telegram HTML helpers into this module. It must be pure text/data.

- [ ] 4. Implement fact extraction in the summary module

  Files:

  - `src/bot/riskExplanationSummary.ts`

  Extract these facts:

  FastCheck:

  - `stablecoin_usdt_blacklisted` -> hard evidence.
  - saved approval-drain marker:
    - `internal_label_approval_drain_proximity`
    - reason message containing `exact upstream approval-drain provenance linked to this address`
  - internal hard labels from `fastReport.reasons` only when unified risk marks them as hard evidence.
  - behavior-only fast score as context, not as primary hard reason.

  Where Is Money:

  - `assessment.hardBadEvidence.kind === "approval_drain"` -> exact drainer fact.
  - `assessment.hardBadEvidence.kind === "sanctioned_service"` -> sanctioned-service hard fact.
  - deterministic hard evidence kinds -> hard fact with normalized Russian copy.
  - `sourceBundleExposure.htxHuobiShare > 0` -> selected amount HTX/Huobi fact.
  - `subjectExposureProfile.htxHuobiIncomingShare > 0` -> historical HTX/Huobi context fact.
  - `sourceBundleExposure.bridgeRouterDexShare > 0` -> bridge/router/DEX context fact.
  - `sourceBundleExposure.riskyLabelShare > 0` -> risky labeled source fact.
  - `sourceBundleExposure.unresolvedBoundary` -> boundary limitation fact.
  - `sourceProvenanceMateriality` caveats -> limitation, not primary hard evidence.
  - `coverage.partial` or unified coverage not complete -> coverage limitation.
  - selected coverage line for mode section.

  DeepCheck:

  - `stablecoinRestrictionProfiles[].isBlacklisted` -> USDT blacklist hard evidence.
  - exact approval-drain profile -> exact drainer fact.
  - route-linked approval profile -> review/context fact.
  - `inboundProvenanceProfiles` with high-risk labels -> high-risk inbound provenance hard fact.
  - `extendedProvenanceProfiles` with exact high-risk path -> high-risk extended provenance hard fact.
  - source-policy labels in inbound/extended paths -> source-policy fact.
  - `assetContinuationProfiles` score >= 65 -> asset continuation fact.
  - `operationalFlowProfiles` with high operational/historical transit score -> operational/transit wallet context.
  - `walletRoleProfiles` primary role:
    - `operational_liquidity_wallet` -> collector/liquidity text.
    - `transit_wallet` or mule/transit role -> transit text.
  - `boundaryExposureProfiles` -> service boundary fact.
  - `directCounterpartyInteractionProfiles` with `scoreContribution > 0` and risky snapshot -> risky counterparty context.
  - `counterpartyRiskProfiles` with high-risk label -> risky counterparty fact.

  Unified result:

  - `finalDecision`, `finalScore`, `finalLevel`.
  - `reasons.code === "where_source_policy_floor"` -> source-policy floor fact.
  - `reasons.code === "asset_continuation_floor"` -> asset continuation fact if Deep did not already add one.
  - `matrixScore.winningRow === "behavior_only_prior"` -> behavior context only.
  - `hardEvidenceFloor === 0` -> absent evidence line.
  - `finalDecision === "NO_FINAL_DECISION"` -> no-final summary from `buildNoFinalRiskExplanationSummary`.

  Primary reason selection:

  - Compact report uses up to 5 reasons from `primaryReasons`.
  - Include absent evidence only when no hard evidence exists.
  - Detailed report shows all facts in `modeSections`, deduped.

- [ ] 5. Rewrite final Telegram formatting to use the summary

  Files:

  - `src/bot/createBot.ts`

  Steps:

  1. Import the summary helpers:

     ```ts
     import {
       buildNoFinalRiskExplanationSummary,
       buildRiskExplanationSummary,
       factText,
       modeTitle,
       type RiskExplanationSummary
     } from "./riskExplanationSummary";
     ```

  2. Keep `calculateUnifiedWalletRisk` call inside `formatUnifiedAddressFinalReport`.

  3. Build:

     ```ts
     const summary = buildRiskExplanationSummary({
       address: input.address,
       whereReport: input.whereReport,
       fastReport: input.fastReport,
       deepReport: input.deepReport,
       unifiedRisk,
       finalDecision
     });
     ```

  4. Replace `finalWhyLines`, `finalContextLines`, and `finalActionLines` usage with summary fields.

  5. Keep `betaDiagnosticsLines`, `compactUnifiedRiskBreakdownLines`, and `runtimeMarkerLine` only behind `input.showBetaDiagnostics === true`.

  6. Normal Russian decision line should be human text, not enum-first:

     ```text
     Решение: не принимать автоматически.
     ```

     The enum can remain in English mode or beta/internal diagnostics.

  7. Keep `riskLine` if it still renders `78/100 - высокий`. If it keeps extra `(beta)` clutter in Russian, replace it with a local line:

     ```ts
     `${bold(locale === "en" ? "Risk" : "Риск")}: ${formatRiskIcon(summary.level)} ${code(`${summary.score}/100`)} - ${riskLevelText(summary.level, locale).toLowerCase()}`
     ```

  8. Remove the old duplicated `FinalReasonCard` helpers after the new summary compiles and tests pass.

- [ ] 6. Rewrite no-final-decision Telegram formatting

  Files:

  - `src/bot/createBot.ts`
  - `src/bot/riskExplanationSummary.ts`

  Steps:

  1. In `formatInvalidWhereScoreFinalReport`, call `buildNoFinalRiskExplanationSummary`.
  2. Replace English labels:

     - `Address check - no final decision` -> `Проверка адреса — без итогового решения`
     - `Decision` -> `Решение`
     - `Blocked reason` and `Technical status` -> do not show in normal mode.

  3. Keep blocked reason and technical status only when `showBetaDiagnostics === true`.

  Expected Russian output:

  ```text
  Проверка адреса — без итогового решения

  Адрес: <address>

  Решение: итог не опубликован.

  Почему
  • Итоговый риск не опубликован: не хватает данных по происхождению средств.

  Что делать
  • Дождаться индексации или перезапустить проверку.
  ```

- [ ] 7. Add the detailed Telegram formatter

  Files:

  - `src/bot/createBot.ts`
  - `tests/bot/createBot.test.ts`

  Add export:

  ```ts
  export function formatUnifiedAddressDetailedReport(input: UnifiedAddressFinalReportInput): TelegramHtmlMessage
  ```

  Behavior:

  - If score is invalid, use `buildNoFinalRiskExplanationSummary`.
  - Otherwise calculate unified risk and build `RiskExplanationSummary`.
  - Render:
    - header;
    - address;
    - итог;
    - risk;
    - short conclusion;
    - one section per mode from `summary.modeSections`;
    - possible meanings;
    - limitations;
    - recommendation.

  Do not include beta/internal diagnostics in this formatter.

  Run:

  ```powershell
  npm test -- tests/bot/createBot.test.ts
  ```

  Expected:

  - The red tests from task 2 pass.
  - Existing unified final report tests pass after expectation updates.

- [ ] 8. Add admin/detailed access through `/check_status`

  Files:

  - `src/bot/createBot.ts`
  - `tests/bot/createBot.test.ts`

  Minimal behavior:

  - `/check_status <job-id>` keeps current behavior.
  - `/check_status <job-id> detailed` returns `formatUnifiedAddressDetailedReport` when enough reports are available.

  Implementation:

  1. Extend `CreateBotOptions` with optional related-job resolvers:

     ```ts
     getLatestWhereIsMoneyCheckJobForAddress?: (input: {
       subjectAddress: string;
       chatId: string | null;
       requestedBy: string | null;
       windowStart: Date | null;
       windowEnd: Date | null;
     }) => Promise<ForensicCheckJob | null>;
     getLatestDeepForensicCheckJobForAddressAnyStatus?: (input: {
       subjectAddress: string;
       chatId: string | null;
       requestedBy: string | null;
       windowStart: Date | null;
       windowEnd: Date | null;
     }) => Promise<ForensicCheckJob | null>;
     ```

  2. Import repository defaults:

     - `getLatestWhereIsMoneyCheckJobForAddress`
     - `getLatestDeepForensicCheckJobForAddressAnyStatus`

  3. Add local helper:

     ```ts
     function relatedJobLookupInput(job: ForensicCheckJob) {
       return {
         subjectAddress: job.subjectAddress,
         chatId: job.chatId,
         requestedBy: job.requestedBy,
         windowStart: job.windowStart,
         windowEnd: job.windowEnd
       };
     }
     ```

  4. In `/check_status`, parse the second argument:

     ```ts
     const args = commandText(ctx.match).split(/\s+/).filter(Boolean);
     const jobId = args[0] ?? "";
     const detailed = args[1]?.toLowerCase() === "detailed" || args[1]?.toLowerCase() === "подробно";
     ```

  5. If `detailed`:

     - For a Where job, extract where report and look up latest Deep job with same subject/chat/requester/window.
     - For a Deep job, extract deep report and look up latest Where job with same subject/chat/requester/window.
     - If both where report and deep report are available, send `formatUnifiedAddressDetailedReport`.
     - If only where report is available, send detailed report with `deepReport: null`.
     - If no where report is available, send localized message:

       ```text
       Подробный итоговый отчёт доступен после завершённой проверки “Откуда деньги”.
       ```

  Tests:

  - Existing `/check_status <where-id>` still sends support/debug report.
  - `/check_status <where-id> detailed` sends `Расширенный отчёт по адресу`.
  - `/check_status <deep-id> detailed` sends detailed report when a matching where job exists.

- [ ] 9. Add Admin graph human summary

  Files:

  - `src/admin/forensicsGraph.ts`
  - `src/admin/adminServer.ts`
  - `src/admin/adminConsole.ts`
  - `tests/admin/forensicsGraph.test.ts`
  - `tests/admin/adminServer.test.ts`

  Data shape:

  ```ts
  export type AdminForensicsHumanSummary = {
    conclusion: string;
    primaryReasons: string[];
    modeSections: Array<{
      title: string;
      facts: string[];
    }>;
    possibleMeanings: string[];
    limitations: string[];
    recommendations: string[];
  };
  ```

  Add to `AdminForensicsSummary`:

  ```ts
  humanSummary: AdminForensicsHumanSummary | null;
  ```

  Implementation:

  1. In `adminServer.ts`, when serving a graph for a completed/partial where or deep job, use `deps.listJobs({ subjectAddress: job.subjectAddress, limit: 20 })` to find same-window related jobs.
  2. Extract typed reports with existing bot extractors:
     - `extractWhereIsMoneyReportFromJob`
     - `extractDeepForensicReportFromJob`
  3. Build the same `RiskExplanationSummary` when a where report exists.
  4. Pass a plain admin-safe summary into `projectForensicJobGraph` or attach it after projection before response.
  5. In `adminConsole.ts`, render `summary.humanSummary` above the metric grid:

     - `Короткий вывод`
     - `Почему`
     - `FastCheck`, `Where Is Money`, `DeepCheck`
     - `Что это может быть`
     - `Ограничения`
     - `Рекомендация`

  Tests:

  - Admin graph JSON contains `summary.humanSummary.primaryReasons`.
  - Admin console HTML/JS contains renderer labels for `Короткий вывод` and `Рекомендация`.
  - Existing graph projection tests still pass.

- [ ] 10. Update knowledge docs

  Files:

  - `docs/knowledge/08-admin-and-bot-ux.md`
  - `docs/knowledge/09-current-decisions.md`

  Add:

  - Normal Telegram final report is compact, user-first, and hides raw scoring diagnostics unless beta/internal mode is requested.
  - Detailed report is available through `/check_status <job-id> detailed` and Admin graph human summary.
  - `calculateUnifiedWalletRisk` remains the score source of truth; the new summary changes explanation only.
  - Preserve the existing modified Admin graph focus-line paragraph in `08-admin-and-bot-ux.md`.

- [ ] 11. Final verification

  Run:

  ```powershell
  npm test -- tests/bot/createBot.test.ts
  npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminServer.test.ts
  npm run typecheck
  git diff --check
  git status --short
  ```

  Expected:

  - Bot tests pass.
  - Admin tests pass.
  - Typecheck exits `0`.
  - `git diff --check` exits `0`.
  - `git status --short` shows only intended source, test, and docs files.

## Self-Review Checklist

- [ ] Normal Telegram report answers: what happened, why it matters, what to do.
- [ ] Detailed report shows FastCheck, Where Is Money, and DeepCheck separately.
- [ ] Russian text is first-class, not a partial translation of English debug text.
- [ ] The 80/95 confusion is addressed by showing the final score reason, not only a behavior fallback line.
- [ ] No scoring thresholds or final score math changed.
- [ ] No raw matrix/dampener/weight/debug text leaks into normal or detailed reports.
- [ ] Coverage wording says what was checked and does not imply the full address history is clean.
- [ ] Admin graph still works if `humanSummary` is null.
- [ ] Knowledge docs describe the new behavior.
