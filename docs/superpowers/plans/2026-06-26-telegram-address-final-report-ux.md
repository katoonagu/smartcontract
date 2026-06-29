# Telegram Address Final Report UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram address checks produce one readable final result, with clear preliminary/final states and human Russian explanations for score, evidence, coverage, and confidence.

**Architecture:** Keep existing forensic jobs and scoring math. Add a thin message-lifecycle layer around existing Telegram formatters: Where Is Money can produce a preliminary result when DeepCheck is still running, and DeepCheck produces the single final result once Where Is Money is available. Rewrite the final formatter copy so the user sees one final score first and beta/internal diagnostics last.

**Tech Stack:** TypeScript, grammy Telegram bot, existing formatter helpers in `src/bot/createBot.ts`, forensic job repositories in `src/storage/repositories.ts`, Vitest.

---

## Spec

Primary spec:

- `docs/superpowers/specs/2026-06-26-telegram-address-final-report-ux-design.md`

Related older spec:

- `docs/superpowers/specs/2026-06-01-unified-address-risk-report-design.md`

## Scope Check

This plan touches one subsystem: Telegram reporting for address checks.

It does not change:

- risk weights;
- risk thresholds;
- provider calls;
- forensic graph generation;
- admin graph UI;
- FastCheck, DeepCheck, or Where Is Money investigation logic.

## File Structure

- Modify `src/storage/repositories.ts`
  - Add one read helper that can fetch the latest matching DeepCheck job even when it is still `queued` or `running`.

- Modify `src/index.ts`
  - Use the new repository helper in Where Is Money delivery, so the formatter can tell whether DeepCheck is still pending.

- Modify `src/bot/createBot.ts`
  - Add a preliminary Where Is Money formatter.
  - Keep standalone Where Is Money final output for jobs that do not have a matching DeepCheck.
  - Rewrite unified final report sections: decision, risk, main reason, findings, score explanation, data trust, limitations, beta/internal.
  - Compact beta/internal diagnostics so unused zero thresholds are hidden.

- Modify `tests/storage/forensicCheckJobs.test.ts`
  - Cover the new pending/running DeepCheck lookup.

- Modify `tests/bot/createBot.test.ts`
  - Cover preliminary vs final messages.
  - Cover Russian final copy.
  - Cover compact beta/internal diagnostics.

---

## Task 1: Add Repository Lookup For Pending DeepCheck

**Files:**

- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/forensicCheckJobs.test.ts`

- [ ] **Step 1: Write the failing storage test**

In `tests/storage/forensicCheckJobs.test.ts`, update the import block:

```ts
import {
  claimNextForensicCheckJob,
  completeForensicCheckJob,
  createOrReuseForensicCheckJob,
  getForensicCheckJob,
  getLatestForensicCheckJobForAddress,
  getLatestDeepForensicCheckJobForAddress,
  getLatestDeepForensicCheckJobForAddressAnyStatus,
  getLatestWhereIsMoneyCheckJobForAddress,
  listAdminForensicCheckJobs,
  recoverStaleForensicCheckJobs
} from "../../src/storage/repositories";
```

Add this test near the existing `reads the latest completed or partial deep job` test:

```ts
it("reads the latest deep job for the same address and request context in any active result status", async () => {
  const { db, queries } = createMockDb([
    {
      rows: [
        forensicJobRow({
          id: "deep-job-running",
          kind: "address_deep_check",
          status: "running",
          subject_address: "TSubject111111111111111111111111111111",
          chat_id: "42",
          requested_by: "42",
          window_start: new Date("2026-04-24T00:00:00.000Z"),
          window_end: new Date("2026-05-24T00:00:00.000Z"),
          created_at: new Date("2026-05-24T00:01:00.000Z")
        })
      ]
    }
  ]);

  const job = await getLatestDeepForensicCheckJobForAddressAnyStatus(db, {
    subjectAddress: "TSubject111111111111111111111111111111",
    chatId: "42",
    requestedBy: "42",
    windowStart: new Date("2026-04-24T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z")
  });

  expect(job).toMatchObject({
    id: "deep-job-running",
    kind: "address_deep_check",
    status: "running",
    subjectAddress: "TSubject111111111111111111111111111111"
  });
  expect(queries[0].sql).toContain("kind = 'address_deep_check'");
  expect(queries[0].sql).toContain("status in ('queued', 'running', 'completed', 'partial')");
  expect(queries[0].sql).toContain("chat_id is not distinct from $2");
  expect(queries[0].sql).toContain("requested_by is not distinct from $3");
  expect(queries[0].sql).toContain("window_start is not distinct from $4");
  expect(queries[0].sql).toContain("window_end is not distinct from $5");
  expect(queries[0].sql).toContain("case when status in ('queued', 'running') then 0 else 1 end");
  expect(queries[0].sql).toContain("case when status in ('queued', 'running') then created_at end desc nulls last");
  expect(queries[0].sql).toContain("completed_at desc nulls last");
  expect(queries[0].sql).toContain("created_at desc");
  expect(queries[0].params).toEqual([
    "TSubject111111111111111111111111111111",
    "42",
    "42",
    new Date("2026-04-24T00:00:00.000Z"),
    new Date("2026-05-24T00:00:00.000Z")
  ]);
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```powershell
npm test -- tests/storage/forensicCheckJobs.test.ts
```

Expected: fail because `getLatestDeepForensicCheckJobForAddressAnyStatus` is not exported.

- [ ] **Step 3: Add the repository helper**

In `src/storage/repositories.ts`, add this function immediately after `getLatestDeepForensicCheckJobForAddress`:

```ts
export async function getLatestDeepForensicCheckJobForAddressAnyStatus(
  db: Db,
  input: {
    subjectAddress: string;
    chatId: string | null;
    requestedBy: string | null;
    windowStart: Date | null;
    windowEnd: Date | null;
  }
): Promise<ForensicCheckJob | null> {
  const result = await db.query(
    `select id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, created_at, updated_at,
       started_at, completed_at
     from forensic_check_jobs
     where subject_address = $1
       and chat_id is not distinct from $2
       and requested_by is not distinct from $3
       and window_start is not distinct from $4
       and window_end is not distinct from $5
       and kind = 'address_deep_check'
       and status in ('queued', 'running', 'completed', 'partial')
     order by
       case when status in ('queued', 'running') then 0 else 1 end,
       case when status in ('queued', 'running') then created_at end desc nulls last,
       completed_at desc nulls last,
       created_at desc
     limit 1`,
    [input.subjectAddress, input.chatId, input.requestedBy, input.windowStart, input.windowEnd]
  );
  return result.rows[0] ? mapForensicCheckJobRow(result.rows[0]) : null;
}
```

- [ ] **Step 4: Run the storage tests**

Run:

```powershell
npm test -- tests/storage/forensicCheckJobs.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit checkpoint**

```powershell
git add src/storage/repositories.ts tests/storage/forensicCheckJobs.test.ts
git commit -m "feat: expose active deep forensic job lookup"
```

---

## Task 2: Format Where Is Money As Preliminary When DeepCheck Is Still Running

**Files:**

- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write the failing formatter test**

In `tests/bot/createBot.test.ts`, add this test near the existing `formatWhereIsMoneyUserDeliveryReport` tests:

```ts
it("formats where-is-money delivery as preliminary when matching DeepCheck is still running", () => {
  const whereReport = whereIsMoneyReportForTest({
    decision: "DECLINE",
    userDecision: "DECLINE",
    internalDecision: "DECLINE",
    riskScore: 95,
    assessment: {
      ...whereAssessmentForTest({ decision: "DECLINE", riskScore: 95 }),
      hardBadEvidence: [
        {
          kind: "approval_drain",
          score: 95,
          message: "Exact approval-drain provenance reaches checked wallet via 0 hop(s)."
        }
      ]
    }
  });
  const runningDeepJob = whereIsMoneyJobForTest({
    id: "deep-job-running",
    kind: "address_deep_check",
    status: "running",
    subjectAddress: whereReport.subjectAddress,
    resultJson: {}
  });

  const message = formatWhereIsMoneyUserDeliveryReport(
    whereIsMoneyJobForTest({ progressJson: { locale: "ru" } }),
    whereReport,
    "completed",
    runningDeepJob,
    { locale: "ru", runtimeLabel: "worker-test" }
  );
  const text = plainTelegramText(message.text);

  expect(text).toContain("Проверка адреса — предварительный результат");
  expect(text).toContain("Предварительный риск");
  expect(text).toContain("95/100");
  expect(text).toContain("approval-drain");
  expect(text).toContain("DeepCheck ещё продолжает");
  expect(text).toContain("Финальный итог придёт");
  expect(text).not.toContain("Проверка адреса — итог");
  expect(text).not.toContain("Разбор оценки");
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts -t "formats where-is-money delivery as preliminary"
```

Expected: fail because current where delivery formats final output when DeepCheck has no completed report.

- [ ] **Step 3: Add pending DeepCheck detection**

In `src/bot/createBot.ts`, add this helper near `extractDeepForensicReportFromJob`:

```ts
function isPendingDeepForensicJob(job: ForensicCheckJob | null | undefined, subjectAddress: string): boolean {
  return Boolean(
    job &&
    job.kind === "address_deep_check" &&
    job.subjectAddress === subjectAddress &&
    (job.status === "queued" || job.status === "running")
  );
}
```

- [ ] **Step 4: Add a preliminary formatter**

In `src/bot/createBot.ts`, add this function before `formatWhereIsMoneyUserDeliveryReport`:

```ts
function formatWhereIsMoneyPreliminaryReport(
  job: ForensicCheckJob,
  report: WhereIsMoneyReport,
  options: { runtimeLabel?: string; locale?: BotLocale } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? normalizeBotLocale(job.progressJson.locale);
  const level = levelFromScore(report.riskScore);
  const hardEvidence = whereHardEvidenceReasonLines(report, locale)[0] ?? null;
  const reason = hardEvidence
    ? hardEvidence.replace(/^Жёсткое доказательство:\s*/u, "").replace(/^Hard evidence:\s*/u, "")
    : locale === "en"
      ? "Where Is Money completed a preliminary provenance pass."
      : "Where Is Money завершил предварительную проверку происхождения средств.";

  return telegramHtmlMessage([
    bold(locale === "en" ? "Address check — preliminary result" : "Проверка адреса — предварительный результат"),
    `${bold(locale === "en" ? "Address" : "Адрес")}: ${code(report.subjectAddress)}`,
    `${bold(locale === "en" ? "Preliminary risk" : "Предварительный риск")}: ${formatRiskIcon(level)} ${code(`${report.riskScore}/100`)}`,
    section(locale === "en" ? "Why" : "Почему", [
      bulletList([normalizeNotificationReason(reason, locale)])
    ]),
    section(locale === "en" ? "What happens next" : "Что дальше", [
      locale === "en"
        ? "DeepCheck is still checking address links and behavior."
        : "DeepCheck ещё продолжает проверку связей и поведения адреса.",
      locale === "en"
        ? "Final result will arrive after the remaining analysis completes."
        : "Финальный итог придёт после завершения анализа."
    ]),
    runtimeMarkerLine(options.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}
```

- [ ] **Step 5: Route pending DeepCheck to preliminary**

Change `formatWhereIsMoneyUserDeliveryReport`:

```ts
export function formatWhereIsMoneyUserDeliveryReport(
  job: ForensicCheckJob,
  report: WhereIsMoneyReport,
  status: "completed" | "partial",
  deepJob: ForensicCheckJob | null | undefined,
  options: { runtimeLabel?: string; locale?: BotLocale } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? normalizeBotLocale(job.progressJson.locale);
  const deepReport = extractDeepForensicReportFromJob(deepJob, report.subjectAddress);
  if (deepReport) {
    return formatUnifiedAddressFinalReport({
      address: report.subjectAddress,
      whereReport: report,
      deepReport,
      runtimeLabel: options.runtimeLabel,
      locale
    });
  }
  if (isPendingDeepForensicJob(deepJob, report.subjectAddress)) {
    return formatWhereIsMoneyPreliminaryReport(job, report, {
      runtimeLabel: options.runtimeLabel,
      locale
    });
  }
  return formatWhereIsMoneyReport(job, report, status, {
    runtimeLabel: options.runtimeLabel,
    locale
  });
}
```

- [ ] **Step 6: Run the focused test**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts -t "formats where-is-money delivery as preliminary"
```

Expected: pass.

- [ ] **Step 7: Commit checkpoint**

```powershell
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: mark where results preliminary while deep check runs"
```

---

## Task 3: Wire Pending DeepCheck Lookup Into Delivery

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Import the new repository helper**

In `src/index.ts`, extend the repository import:

```ts
import {
  getLatestDeepForensicCheckJobForAddress,
  getLatestDeepForensicCheckJobForAddressAnyStatus,
  getLatestWhereIsMoneyCheckJobForAddress
} from "./storage/repositories";
```

Keep the rest of the existing imports in the same import block.

- [ ] **Step 2: Use the active-status lookup for Where Is Money delivery**

In the `sendWhereIsMoneyJobResult` callback, replace:

```ts
const deepJob = await getLatestDeepForensicCheckJobForAddress(db, {
  subjectAddress: job.subjectAddress,
  chatId: job.chatId,
  requestedBy: job.requestedBy,
  windowStart: job.windowStart,
  windowEnd: job.windowEnd
});
```

with:

```ts
const deepJob = await getLatestDeepForensicCheckJobForAddressAnyStatus(db, {
  subjectAddress: job.subjectAddress,
  chatId: job.chatId,
  requestedBy: job.requestedBy,
  windowStart: job.windowStart,
  windowEnd: job.windowEnd
});
```

Leave `sendJobResult` for DeepCheck on `getLatestWhereIsMoneyCheckJobForAddress`, because DeepCheck needs a completed or partial Where Is Money report to build the final unified result.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: pass.

- [ ] **Step 4: Commit checkpoint**

```powershell
git add src/index.ts
git commit -m "fix: detect running deep check before where delivery"
```

---

## Task 4: Rewrite Unified Final Report Into User-First Sections

**Files:**

- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write the failing final-copy test**

Add this test near existing `formatUnifiedAddressFinalReportForTest` cases:

```ts
it("formats the Russian unified final report as user-first explanation before diagnostics", () => {
  const whereReport = whereIsMoneyReportForTest({
    decision: "DECLINE",
    userDecision: "DECLINE",
    internalDecision: "DECLINE",
    riskScore: 95,
    assessment: {
      ...whereAssessmentForTest({ decision: "DECLINE", riskScore: 95 }),
      hardBadEvidence: [
        {
          kind: "approval_drain",
          score: 95,
          message: "Exact approval-drain provenance reaches checked wallet via 0 hop(s)."
        }
      ],
      provenanceConfidence: 70,
      coverageCompleteness: 45
    },
    coverage: {
      ...whereIsMoneyReportForTest().coverage,
      checkedScope: "drain_episode",
      coverageRatio: 0.45,
      episodeCoverageRatio: 0.45,
      anchorCoverageRatio: 1,
      partial: true
    },
    originPaths: [
      {
        rootSourceAddress: null,
        rootSourceType: "unknown",
        pathAddresses: [],
        txHashes: [],
        steps: [],
        amountPreservationRatio: 0,
        timeSpanMs: null,
        verdict: "REVIEW",
        stoppedReason: "unknown_source_boundary",
        riskScoreContribution: 30,
        reasons: []
      }
    ]
  });

  const text = formatUnifiedAddressFinalReportForTest({
    address: whereReport.subjectAddress,
    whereReport,
    deepReport: deepReportForTest({
      directCounterpartyInteractionProfiles: [
        {
          subjectAddress: walletAddress,
          direction: "outbound",
          counterpartyAddress: "TV7PLwexampleXSUT",
          volumeRaw: "500000000000",
          volumeRatio: 0.496,
          txCount: 8,
          firstSeen: "2026-06-01T10:00:00.000Z",
          lastSeen: "2026-06-01T11:00:00.000Z",
          txHashes: ["tx-counterparty"],
          serviceCategory: null,
          identity: null,
          scoreContribution: 45,
          snapshot: {
            address: "TV7PLwexampleXSUT",
            riskScore: 80,
            riskLevel: "HIGH",
            source: "fast_address_check",
            evidenceClass: "counterparty_behavior_context",
            reasons: ["counterparty fast check found behavior context"],
            partialNotes: []
          },
          interactionWeight: 0.56,
          evidenceClass: "counterparty_behavior_context",
          skippedReason: null
        }
      ]
    }),
    locale: "ru"
  });

  expect(text).toContain("Проверка адреса — итог");
  expect(text).toContain("Решение:");
  expect(text).toContain("DECLINE");
  expect(text).toContain("Адрес нельзя принять автоматически");
  expect(text).toContain("Итоговый риск:");
  expect(text).toContain("95/100");
  expect(text).toContain("Главная причина");
  expect(text).toContain("approval-drain");
  expect(text).toContain("Что нашли");
  expect(text).toContain("Where Is Money");
  expect(text).toContain("DeepCheck");
  expect(text).toContain("Почему риск");
  expect(text).toContain("Фоновая оценка режимов");
  expect(text).toContain("Доверие к данным");
  expect(text).toContain("Среднее");
  expect(text).toContain("Beta/internal");
  expect(text).not.toContain("Разбор оценки");
  expect(text).not.toContain("Порог политики: 0");
  expect(text).not.toContain("Снижение: 0");
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts -t "formats the Russian unified final report as user-first"
```

Expected: fail because the current formatter still uses `Почему` and `Разбор оценки`.

- [ ] **Step 3: Add final decision helper copy**

In `src/bot/createBot.ts`, add these helpers near `unifiedRiskCoverageLabel`:

```ts
function finalDecisionExplanation(decision: UnifiedWalletRiskResult["finalDecision"], locale: BotLocale): string {
  if (locale === "en") {
    switch (decision) {
      case "DECLINE":
        return "The address cannot be accepted automatically.";
      case "REVIEW":
        return "Manual review is required.";
      case "ACCEPTABLE":
        return "No strong risk signals were found.";
    }
  }
  switch (decision) {
    case "DECLINE":
      return "Адрес нельзя принять автоматически.";
    case "REVIEW":
      return "Нужна ручная проверка.";
    case "ACCEPTABLE":
      return "Сильных риск-сигналов не найдено.";
  }
}
```

- [ ] **Step 4: Add score explanation helper copy**

Add:

```ts
function finalScoreExplanationLines(result: UnifiedWalletRiskResult, locale: BotLocale): string[] {
  const finalScore = result.finalScore;
  const weightedScore = result.weightedLayerScore;
  const hardFloor = result.hardEvidenceFloor;
  if (locale === "en") {
    if (hardFloor > weightedScore && finalScore >= hardFloor) {
      return [
        `Weighted mode score: ${weightedScore}/100.`,
        `Final risk is higher because hard evidence set the minimum risk to ${hardFloor}/100.`
      ];
    }
    return [`Final risk follows the weighted mode score: ${weightedScore}/100.`];
  }
  if (hardFloor > weightedScore && finalScore >= hardFloor) {
    return [
      `Фоновая оценка режимов: ${weightedScore}/100.`,
      `Финальный риск выше, потому что жёсткое доказательство закрепило минимум ${hardFloor}/100.`
    ];
  }
  return [`Финальный риск рассчитан по фоновой оценке режимов: ${weightedScore}/100.`];
}
```

- [ ] **Step 5: Add user-facing trust helper copy**

Add:

```ts
function finalDataTrustLines(result: UnifiedWalletRiskResult, whereReport: WhereIsMoneyReport, locale: BotLocale): string[] {
  const coverage = result.coverageLevel;
  const confidence = whereReport.assessment.provenanceConfidence;
  if (locale === "en") {
    if (coverage === "complete") return ["High. The main money paths were resolved well enough for the policy."];
    if (confidence >= 60) return ["Medium. The main risk is supported, but part of the provenance is incomplete."];
    return ["Limited. The result needs manual review because the provenance coverage is weak."];
  }
  if (coverage === "complete") return ["Высокое. Основные цепочки происхождения раскрыты достаточно для политики."];
  if (confidence >= 60) return ["Среднее. Главный риск подтверждён, но покрытие происхождения неполное."];
  return ["Ограниченное. Результат требует ручной проверки, потому что покрытие происхождения слабое."];
}
```

- [ ] **Step 6: Add findings helper copy**

Add:

```ts
function finalFindingLines(
  whereReport: WhereIsMoneyReport,
  deepReport: DeepAddressForensicReport | null | undefined,
  locale: BotLocale
): string[] {
  const lines: string[] = [];
  const hardEvidence = whereHardEvidenceReasonLines(whereReport, locale)[0] ?? null;
  if (hardEvidence) {
    lines.push(locale === "en"
      ? "Where Is Money confirmed hard provenance evidence."
      : "Where Is Money подтвердил жёсткий сигнал происхождения средств.");
  } else {
    lines.push(locale === "en"
      ? "Where Is Money did not find deterministic bad evidence."
      : "Where Is Money не нашёл жёстких плохих доказательств.");
  }
  lines.push(...unifiedBehaviorContextLines(deepReport, locale));
  if (whereReport.coverage.partial) {
    lines.push(locale === "en"
      ? "Part of the source graph remains unresolved."
      : "Часть происхождения средств осталась нераскрытой.");
  }
  return lines.slice(0, 4);
}
```

- [ ] **Step 7: Replace unified final report section layout**

Inside `formatUnifiedAddressFinalReport`, replace the current `telegramHtmlMessage([...])` block with this structure:

```ts
const mainReasonLines = [
  ...whereHardEvidenceLines,
  ...whereContextEvidenceLines,
  ...whereDecisionContextLines,
  ...unifiedRiskReasonLines(unifiedRisk, locale, { skipWhereHardEvidence: whereHardEvidenceLines.length > 0 })
].filter((line): line is string => Boolean(line)).slice(0, 2);
const findings = finalFindingLines(input.whereReport, input.deepReport, locale);
const scoreExplanation = finalScoreExplanationLines(unifiedRisk, locale);
const dataTrust = finalDataTrustLines(unifiedRisk, input.whereReport, locale);
const betaLines = compactUnifiedRiskBreakdownLines(unifiedRisk, locale, input.deepReport);

return telegramHtmlMessage([
  bold(locale === "en" ? "Address check — final" : "Проверка адреса — итог"),
  `${bold(locale === "en" ? "Address" : "Адрес")}: ${code(input.address)}`,
  `${bold(locale === "en" ? "Decision" : "Решение")}: ${code(finalDecision)}`,
  finalDecisionExplanation(finalDecision, locale),
  riskLine({ subjectAddress: input.address, score: finalScore, level: finalLevel, reasons: [] }, locale === "en" ? "Final risk" : "Итоговый риск", false, locale),
  section(locale === "en" ? "Main reason" : "Главная причина", [
    bulletList(mainReasonLines)
  ]),
  section(locale === "en" ? "Findings" : "Что нашли", [
    bulletList(findings)
  ]),
  section(locale === "en" ? `Why risk is ${finalScore}` : `Почему риск ${finalScore}`, [
    bulletList(scoreExplanation)
  ]),
  section(locale === "en" ? "Data trust" : "Доверие к данным", [
    bulletList(dataTrust)
  ]),
  limitationLines.length > 0 ? section(locale === "en" ? "Limits" : "Ограничения", [
    bulletList(limitationLines)
  ]) : null,
  crossChainCorridorLines.length > 0 ? section("Cross-chain corridor", [
    bulletList(crossChainCorridorLines)
  ]) : null,
  section("Beta/internal", [
    bulletList(betaLines)
  ]),
  runtimeMarkerLine(input.runtimeLabel)
].filter((line): line is string => Boolean(line)));
```

`compactUnifiedRiskBreakdownLines` is added in Task 5.

- [ ] **Step 8: Run the focused test**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts -t "formats the Russian unified final report as user-first"
```

Expected: fail only because `compactUnifiedRiskBreakdownLines` is not implemented yet. Continue to Task 5 before expecting all formatter tests to pass.

---

## Task 5: Compact Beta/Internal Diagnostics

**Files:**

- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write the compact diagnostics test**

Add:

```ts
it("hides unused zero scoring thresholds from beta internal diagnostics", () => {
  const whereReport = whereIsMoneyReportForTest({
    decision: "ACCEPTABLE",
    userDecision: "ACCEPTABLE",
    internalDecision: "ACCEPTABLE",
    riskScore: 25,
    assessment: {
      ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
      hardBadEvidence: []
    }
  });

  const text = formatUnifiedAddressFinalReportForTest({
    address: whereReport.subjectAddress,
    whereReport,
    locale: "ru"
  });

  expect(text).toContain("Beta/internal");
  expect(text).toContain("FastCheck");
  expect(text).toContain("DeepCheck");
  expect(text).toContain("Where Is Money");
  expect(text).not.toContain("Порог политики: 0");
  expect(text).not.toContain("Порог продолжения актива: 0");
  expect(text).not.toContain("Порог по паттернам: 0");
  expect(text).not.toContain("Снижение: 0");
});
```

- [ ] **Step 2: Implement compact diagnostics helper**

In `src/bot/createBot.ts`, add this helper near `unifiedRiskBreakdownLines`:

```ts
function compactUnifiedRiskBreakdownLines(
  result: UnifiedWalletRiskResult,
  locale: BotLocale,
  deepReport: DeepAddressForensicReport | null | undefined
): string[] {
  const lines: string[] = [];
  for (const layer of ["fast", "deep", "where"] as const) {
    const item = result.layerBreakdown[layer];
    const label = layer === "fast"
      ? "FastCheck"
      : layer === "deep"
        ? "DeepCheck"
        : "Where Is Money";
    lines.push(`${label}: ${item.rawScore} -> ${item.weightedContribution}`);
  }
  lines.push(locale === "en"
    ? `weighted context: ${result.contextScore}`
    : `фоновая оценка: ${result.contextScore}`);
  if (result.hardEvidenceFloor > 0) {
    lines.push(locale === "en"
      ? `hard evidence floor: ${result.hardEvidenceFloor}`
      : `жёсткий минимум риска: ${result.hardEvidenceFloor}`);
  }
  if (result.policyFloor > 0) {
    lines.push(locale === "en"
      ? `policy floor: ${result.policyFloor}`
      : `минимум политики: ${result.policyFloor}`);
  }
  if (result.assetContinuationFloor > 0) {
    lines.push(locale === "en"
      ? `asset continuation floor: ${result.assetContinuationFloor}`
      : `минимум продолжения актива: ${result.assetContinuationFloor}`);
  }
  if (result.patternFloor > 0) {
    lines.push(locale === "en"
      ? `pattern floor: ${result.patternFloor}`
      : `минимум по паттерну: ${result.patternFloor}`);
  }
  if (result.dampener > 0) {
    lines.push(locale === "en"
      ? `dampener: ${result.dampener}`
      : `снижение: ${result.dampener}`);
  }
  lines.push(locale === "en"
    ? `coverage: ${result.coverageLevel}`
    : `покрытие: ${unifiedRiskCoverageLabel(result.coverageLevel, locale)}`);
  const evidence = result.hardEvidenceFloor > 0 ? "hard" : "context";
  lines.push(locale === "en"
    ? `evidence: ${evidence}`
    : `доказательство: ${evidence}`);
  lines.push("policy: wallet-risk-v1");
  lines.push(`final risk: ${result.finalScore}`);
  lines.push(...deepRunProfileAndProviderBudgetLines(deepReport));
  return lines;
}
```

- [ ] **Step 3: Run focused tests**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts -t "beta internal|user-first"
```

Expected: pass after property names are aligned with the real `UnifiedWalletRiskResult`.

- [ ] **Step 4: Commit checkpoint**

```powershell
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "fix: make unified final report user first"
```

---

## Task 6: Preserve Existing Final Behavior For Standalone Jobs

**Files:**

- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add standalone Where Is Money final regression test**

Add:

```ts
it("keeps where-is-money delivery final when no matching DeepCheck exists", () => {
  const whereReport = whereIsMoneyReportForTest({
    decision: "ACCEPTABLE",
    userDecision: "ACCEPTABLE",
    internalDecision: "ACCEPTABLE",
    riskScore: 25
  });

  const message = formatWhereIsMoneyUserDeliveryReport(
    whereIsMoneyJobForTest({ progressJson: { locale: "ru" } }),
    whereReport,
    "completed",
    null,
    { locale: "ru" }
  );
  const text = plainTelegramText(message.text);

  expect(text).toContain("Проверка адреса — итог");
  expect(text).not.toContain("предварительный результат");
});
```

- [ ] **Step 2: Add DeepCheck final regression test**

Add:

```ts
it("keeps DeepCheck delivery final when matching Where Is Money result exists", () => {
  const whereReport = whereIsMoneyReportForTest({
    decision: "ACCEPTABLE",
    userDecision: "ACCEPTABLE",
    internalDecision: "ACCEPTABLE",
    riskScore: 25
  });
  const whereJob = whereIsMoneyJobForTest({
    resultJson: {
      subjectAddress: whereReport.subjectAddress,
      whereIsMoneyReport: whereReport
    }
  });

  const message = formatDeepForensicUserDeliveryReport(
    whereIsMoneyJobForTest({
      id: "deep-job-completed",
      kind: "address_deep_check",
      subjectAddress: whereReport.subjectAddress,
      progressJson: { locale: "ru" }
    }),
    deepReportForTest({ subjectAddress: whereReport.subjectAddress }),
    "completed",
    whereJob,
    { locale: "ru" }
  );
  const text = plainTelegramText(message.text);

  expect(text).toContain("Проверка адреса — итог");
  expect(text).not.toContain("предварительный результат");
});
```

- [ ] **Step 3: Run focused delivery tests**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts -t "where-is-money delivery|DeepCheck delivery|preliminary"
```

Expected: pass.

- [ ] **Step 4: Commit checkpoint**

```powershell
git add tests/bot/createBot.test.ts
git commit -m "test: lock address report delivery lifecycle"
```

---

## Task 7: Full Verification And PR Review

**Files:**

- Verify all touched files.

- [ ] **Step 1: Run targeted tests**

Run:

```powershell
npm test -- tests/storage/forensicCheckJobs.test.ts tests/bot/createBot.test.ts
```

Expected: pass.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Run full tests if local runtime permits**

Run:

```powershell
npm test
```

Expected: pass.

- [ ] **Step 4: Manual PR review checklist**

Review the diff for these points:

- Where Is Money with pending DeepCheck cannot send `Проверка адреса — итог`.
- DeepCheck with completed Where Is Money sends one final unified report.
- Standalone Where Is Money still sends a final report.
- Final user copy does not expose raw zero thresholds.
- Behavior risk is described as context, not proof.
- Hard evidence is described as the reason for high final risk.
- Existing support/debug formatters still expose details for admins.

- [ ] **Step 5: Final commit**

If previous tasks were not committed individually, commit all implementation changes:

```powershell
git add src/storage/repositories.ts src/index.ts src/bot/createBot.ts tests/storage/forensicCheckJobs.test.ts tests/bot/createBot.test.ts
git commit -m "fix: clarify telegram address final report lifecycle"
```

## Self-Review

Spec coverage:

- One final `Проверка адреса — итог`: covered by Tasks 2, 3, and 6.
- Preliminary result when Where Is Money finishes before DeepCheck: covered by Tasks 2 and 3.
- User-first Russian final report: covered by Task 4.
- Compact beta/internal diagnostics: covered by Task 5.
- Hard evidence explanation: covered by Task 4.
- Behavior risk as context, not proof: covered by Task 4 and existing behavior-warning tests.
- Weak coverage / limitations: preserved through existing `whereLimitationLines` and checked in Task 4.

Placeholder scan:

- The plan has no `TBD`, no unspecified "add tests", and no open implementation gaps.

Type consistency:

- The plan uses existing public functions: `formatWhereIsMoneyUserDeliveryReport`, `formatDeepForensicUserDeliveryReport`, `formatUnifiedAddressFinalReport`, `extractDeepForensicReportFromJob`.
- The only new repository function is `getLatestDeepForensicCheckJobForAddressAnyStatus`.
- `UnifiedWalletRiskResult` fields used by the plan exist in `src/risk/unifiedWalletRisk.ts`: `finalScore`, `finalLevel`, `finalDecision`, `weightedLayerScore`, `contextScore`, `hardEvidenceFloor`, `policyFloor`, `assetContinuationFloor`, `patternFloor`, `dampener`, `coverageLevel`, `layerBreakdown`, `reasons`, and `scoreBreakdown`.
