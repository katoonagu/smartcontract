# Unified Address Risk Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace competing Telegram risk messages with one final address assessment where where-is-money is the primary score and preliminary/deep results add warnings unless hard evidence overrides the decision.

**Architecture:** Add a small final-report composition layer in the bot formatter path, then route preliminary, where-is-money, and deep result messages through that layer. Keep forensic scoring internals intact; this change is primarily aggregation, copy, and support/debug separation.

**Tech Stack:** TypeScript, existing Telegram HTML formatter helpers in `src/bot/createBot.ts`, existing forensic job models, existing risk policy helpers, Vitest.

---

## Spec

Primary spec: `docs/superpowers/specs/2026-06-01-unified-address-risk-report-design.md`

## Implementation Notes

- Do not change forensic scoring thresholds in this track.
- Do not remove deep or preliminary analysis jobs.
- Do not expose multiple user-facing risk scores for the same address unless hard evidence is found before async jobs finish.
- Preserve support/debug access to technical details.
- Keep messages concise and Russian-first because the current operator flow is Russian.

## Task Order

1. Add test coverage for the approved final-report rule.
2. Add final risk composition helpers.
3. Convert preliminary address output to neutral "analysis started" copy.
4. Replace normal where-is-money report with a compact final report.
5. Merge deep behavior into final context warnings instead of standalone competing score.
6. Preserve technical detail in support/debug output.
7. Fix incoming-deposit origin coverage wording.
8. Add large-transfer funding bundle detection.
9. Add adaptive deep corridor expansion.
10. Full verification and PR-style review.

---

### Task 1: Tests for One Final User Score

**Files:**
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add a regression test for compact where-is-money final output**

Add a test near existing where-is-money formatter tests:

```ts
it("formats where-is-money as the single final address score without technical sections", () => {
  const report = whereIsMoneyReportForTest({
    decision: "ACCEPTABLE",
    riskScore: 25,
    coverage: {
      selectedInboundTxCount: 32,
      currentBalanceRaw: "881418707767",
      requestedAmountRaw: null,
      targetAmountRaw: "881418707767",
      selectedAmountRaw: "840313000000",
      coverageRatio: 0.9533,
      selectedInboundVolumeRaw: "840313000000",
      currentBalanceCoverageRatio: 0.9533,
      provenanceScope: "current_balance",
      anchorTransfer: null,
      lowBalanceThresholdRaw: null,
      dataScopeNote: null,
      maxDepth: 20,
      fetchedAddressCount: 19,
      partial: true,
      notes: []
    },
    originPaths: [
      { verdict: "REVIEW", stoppedReason: "weak_amount_or_time_continuity", steps: [], addresses: [], txHashes: [], riskScoreContribution: 30, reasons: [] },
      { verdict: "REVIEW", stoppedReason: "no_previous_transfer", steps: [], addresses: [], txHashes: [], riskScoreContribution: 35, reasons: [] }
    ],
    assessment: {
      ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
      hardBadEvidence: [],
      provenanceConfidence: 41,
      coverageCompleteness: 39,
      walletRole: "operational_liquidity_wallet",
      operationalLiquidityScore: 84
    }
  });

  const text = formatWhereIsMoneyReport(whereIsMoneyJobForTest(), report, "partial", { locale: "ru" }).text;

  expect(text).toContain("Проверка адреса — итог");
  expect(text).toContain("Итоговый риск");
  expect(text).toContain("25/100");
  expect(text).toContain("Проверено 95%");
  expect(text).toContain("32 входящих");
  expect(text).toContain("Ограничения");
  expect(text).not.toContain("Технические детали");
  expect(text).not.toContain("Origin paths");
  expect(text).not.toContain("Sender interactions");
  expect(text).not.toContain("Previous fast risk");
  expect(text).not.toContain("Job:");
});
```

If local fixture names differ, adapt only the fixture wrapper, not the assertions.

- [ ] **Step 2: Add a regression test for behavior warning not overriding final score**

Add:

```ts
it("adds deep behavior as context without replacing the where-is-money score", () => {
  const whereReport = whereIsMoneyReportForTest({
    decision: "ACCEPTABLE",
    riskScore: 25,
    assessment: {
      ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
      hardBadEvidence: []
    }
  });
  const deepReport = deepReportForTest({
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
          source: "behavior",
          evidenceClass: "counterparty_behavior_context",
          reasons: ["counterparty fast check found behavior context"],
          partialNotes: []
        },
        interactionWeight: 0.56,
        evidenceClass: "counterparty_behavior_context",
        skippedReason: null
      }
    ]
  });

  const text = formatUnifiedAddressFinalReport({
    address: whereReport.subjectAddress,
    whereReport,
    deepReport,
    locale: "ru"
  }).text;

  expect(text).toContain("Итоговый риск");
  expect(text).toContain("25/100");
  expect(text).toContain("поведенческий риск");
  expect(text).toContain("не доказательство");
  expect(text).not.toContain("Риск поведения");
  expect(text).not.toContain("80/100");
});
```

- [ ] **Step 3: Add a regression test for hard-evidence override**

Add:

```ts
it("lets deterministic hard evidence override a low where-is-money score", () => {
  const whereReport = whereIsMoneyReportForTest({
    decision: "ACCEPTABLE",
    riskScore: 25,
    assessment: {
      ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
      hardBadEvidence: []
    }
  });
  const deepReport = deepReportForTest({
    stablecoinRestrictionProfiles: [
      stablecoinRestrictionProfile({ isBlacklisted: true })
    ]
  });

  const text = formatUnifiedAddressFinalReport({
    address: whereReport.subjectAddress,
    whereReport,
    deepReport,
    locale: "ru"
  }).text;

  expect(text).toContain("Решение: DECLINE");
  expect(text).toContain("95/100");
  expect(text).toContain("USDT blacklist");
});
```

- [ ] **Step 4: Run tests and confirm expected failures**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected: fail because `formatUnifiedAddressFinalReport` and compact where-is-money output do not exist yet.

- [ ] **Step 5: PR-style review checkpoint**

Review only test intent:

- tests assert one final score;
- tests assert deep behavior is context;
- tests assert hard evidence can override;
- tests assert technical sections are absent from the normal user report.

Do not implement runtime code in Task 1.

---

### Task 2: Final Risk Composition Helpers

**Files:**
- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add final-report input and context types**

Near formatter helper types in `src/bot/createBot.ts`, add:

```ts
type UnifiedAddressFinalReportInput = {
  address: string;
  whereReport: WhereIsMoneyReport;
  deepReport?: DeepAddressForensicReport | null;
  fastReport?: RiskReport | null;
  locale?: BotLocale;
  runtimeLabel?: string;
};

type UnifiedHardEvidence = {
  score: number;
  level: RiskReport["level"];
  decision: ExchangeDecision;
  reason: string;
};
```

- [ ] **Step 2: Add deterministic hard-evidence extraction**

Add helper:

```ts
function hardEvidenceFromUnifiedInput(input: UnifiedAddressFinalReportInput): UnifiedHardEvidence | null {
  const stablecoin = input.deepReport?.stablecoinRestrictionProfiles.find((profile) => profile.isBlacklisted);
  if (stablecoin) {
    return {
      score: 95,
      level: "CRITICAL",
      decision: "DECLINE",
      reason: "USDT blacklist: адрес активен в blacklist состоянии контракта."
    };
  }

  const approvalDrain = input.deepReport?.approvalDrainProvenanceProfiles.find((profile) => profile.score >= 85);
  if (approvalDrain) {
    return {
      score: Math.max(90, approvalDrain.score),
      level: "CRITICAL",
      decision: "DECLINE",
      reason: "Найдена точная цепочка approval-drain provenance."
    };
  }

  const hardWhereEvidence = input.whereReport.assessment.hardBadEvidence[0] ?? null;
  if (hardWhereEvidence) {
    return {
      score: Math.max(85, input.whereReport.riskScore),
      level: "CRITICAL",
      decision: "DECLINE",
      reason: `Найдено жёсткое плохое доказательство: ${hardWhereEvidence.kind}.`
    };
  }

  const fastHardReason = input.fastReport?.reasons.find((reason) =>
    reason.code === "stablecoin_usdt_blacklisted" ||
    reason.code === "forensic_approval_drain_provenance" ||
    reason.code.startsWith("internal_label_scam") ||
    reason.code.startsWith("internal_label_reported_scam") ||
    reason.code.startsWith("internal_label_stolen_funds") ||
    reason.code.startsWith("internal_label_phishing")
  );
  if (fastHardReason) {
    return {
      score: Math.max(85, fastHardReason.scoreImpact),
      level: levelFromScore(Math.max(85, fastHardReason.scoreImpact)),
      decision: "DECLINE",
      reason: fastHardReason.message
    };
  }

  return null;
}
```

- [ ] **Step 3: Add compact coverage and limitation helpers**

Add:

```ts
function whereCoverageSummaryLine(report: WhereIsMoneyReport, locale: BotLocale): string {
  const percent = Math.round((report.coverage.coverageRatio ?? 0) * 100);
  const count = report.coverage.selectedInboundTxCount;
  if (locale === "en") return `Checked ${percent}% of the target amount across ${count} inbound USDT transfer(s).`;
  return `Проверено ${percent}% суммы: ${count} входящих USDT-перевода.`;
}

function whereLimitationLines(report: WhereIsMoneyReport, locale: BotLocale): string[] {
  const weak = report.originPaths.filter((path) => path.stoppedReason === "weak_amount_or_time_continuity").length;
  const missing = report.originPaths.filter((path) => path.stoppedReason === "no_previous_transfer").length;
  const lines: string[] = [];
  if (weak > 0) {
    lines.push(locale === "en"
      ? `${weak} path(s) stopped because amount/time continuity was too weak.`
      : `${weak} путей остановлены из-за слабой связи суммы/времени.`);
  }
  if (missing > 0) {
    lines.push(locale === "en"
      ? `${missing} path(s) stopped because no earlier inbound USDT transfer was found.`
      : `${missing} путей остановлены без предыдущего входящего USDT-перевода.`);
  }
  if (report.coverage.partial && lines.length === 0) {
    lines.push(locale === "en"
      ? "The report is complete, but some provenance limits remain."
      : "Отчёт готов, но по происхождению остались ограничения.");
  }
  return lines.slice(0, 3);
}
```

- [ ] **Step 4: Add behavior context helper**

Add:

```ts
function unifiedBehaviorContextLines(report: DeepAddressForensicReport | null | undefined, locale: BotLocale): string[] {
  if (!report) return [];
  const direct = topDirectCounterpartyInteractionProfile(report);
  if (direct?.snapshot?.riskScore && direct.scoreContribution > 0) {
    return [locale === "en"
      ? `Behavior warning: a major ${direct.direction} counterparty looks risky, but this is not dirty-funds proof.`
      : `Есть поведенческий риск по крупному контрагенту, но это не доказательство грязного происхождения.`];
  }
  const boundary = firstBoundaryExposureProfile(report);
  if (boundary) {
    return [locale === "en"
      ? "Service-boundary context exists; public-chain continuity is limited after that point."
      : "Есть сервисная граница: после неё публичная цепочка происхождения ограничена."];
  }
  return [];
}
```

- [ ] **Step 5: Export the unified formatter for tests**

Add:

```ts
export function formatUnifiedAddressFinalReport(input: UnifiedAddressFinalReportInput): TelegramHtmlMessage {
  const locale = input.locale ?? DEFAULT_BOT_LOCALE;
  const hardEvidence = hardEvidenceFromUnifiedInput(input);
  const finalDecision = hardEvidence?.decision ?? input.whereReport.decision;
  const finalScore = hardEvidence?.score ?? input.whereReport.riskScore;
  const finalLevel = hardEvidence?.level ?? levelFromScore(finalScore);
  const reasonLines = [
    hardEvidence?.reason,
    whereCoverageSummaryLine(input.whereReport, locale),
    input.whereReport.assessment.hardBadEvidence.length === 0 && !hardEvidence
      ? (locale === "en" ? "No deterministic bad evidence was found." : "Жёстких плохих доказательств не найдено.")
      : null,
    ...unifiedBehaviorContextLines(input.deepReport, locale)
  ].filter((line): line is string => Boolean(line)).slice(0, 4);
  const limitationLines = whereLimitationLines(input.whereReport, locale);

  return telegramHtmlMessage([
    bold(locale === "en" ? "Address check — final" : "Проверка адреса — итог"),
    `${bold(locale === "en" ? "Address" : "Адрес")}: ${code(input.address)}`,
    `${bold(locale === "en" ? "Decision" : "Решение")}: ${code(finalDecision)}`,
    riskLine({ subjectAddress: input.address, score: finalScore, level: finalLevel, reasons: [] }, locale === "en" ? "Final risk" : "Итоговый риск", true, locale),
    section(locale === "en" ? "Why" : "Почему", [bulletList(reasonLines)]),
    limitationLines.length > 0 ? section(locale === "en" ? "Limits" : "Ограничения", [bulletList(limitationLines)]) : null,
    runtimeMarkerLine(input.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected: Task 1 tests using the unified formatter pass; compact where-is-money integration may still fail until Task 4.

- [ ] **Step 7: PR-style review checkpoint**

Check:

- hard evidence override is explicit and narrow;
- behavior context cannot override the where-is-money score;
- helper output stays compact;
- no technical internals are introduced into the unified formatter.

---

### Task 3: Neutral Preliminary Address Message

**Files:**
- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add preliminary hard-evidence detector**

Add:

```ts
function hasFastHardEvidence(report: RiskReport): boolean {
  return report.reasons.some((reason) =>
    reason.code === "stablecoin_usdt_blacklisted" ||
    reason.code === "forensic_approval_drain_provenance" ||
    reason.code.startsWith("internal_label_scam") ||
    reason.code.startsWith("internal_label_reported_scam") ||
    reason.code.startsWith("internal_label_stolen_funds") ||
    reason.code.startsWith("internal_label_phishing")
  );
}
```

- [ ] **Step 2: Add neutral preliminary formatter**

Add:

```ts
export function formatAddressCheckStarted(
  result: ManualCheckResult,
  options: { whereIsMoneyJob?: ForensicCheckJob | null; deepJob?: ForensicCheckJob | null; runtimeLabel?: string; locale?: BotLocale } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? DEFAULT_BOT_LOCALE;
  if (hasFastHardEvidence(result.report)) {
    return formatManualReport(result, options);
  }

  return telegramHtmlMessage([
    bold(locale === "en" ? "Address check — started" : "Проверка адреса — запущена"),
    `${bold(locale === "en" ? "Address" : "Адрес")}: ${code(result.subjectAddress)}`,
    section(locale === "en" ? "What is running" : "Что проверяем", [
      bulletList(locale === "en"
        ? [
            "Origin of the current USDT balance.",
            "Address behavior as additional context."
          ]
        : [
            "Происхождение текущего USDT-баланса.",
            "Поведение адреса как дополнительный контекст."
          ])
    ]),
    locale === "en"
      ? "Final risk appears after provenance analysis."
      : "Итоговый риск появится после анализа происхождения средств.",
    runtimeMarkerLine(options.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}
```

- [ ] **Step 3: Route address preliminary output through the neutral formatter**

In the address check branch that currently calls:

```ts
await sendMessage(ctx, formatManualReport(result, { whereIsMoneyJob, deepJob, runtimeLabel: options.runtimeLabel, locale }));
```

replace with:

```ts
await sendMessage(ctx, formatAddressCheckStarted(result, { whereIsMoneyJob, deepJob, runtimeLabel: options.runtimeLabel, locale }));
```

Keep transaction checks and contract checks unchanged unless they follow the same address async flow.

- [ ] **Step 4: Add tests**

Add:

```ts
it("does not show non-hard preliminary fast score while async provenance is running", () => {
  const result = {
    subjectAddress: walletAddress,
    report: {
      subjectAddress: walletAddress,
      score: 60,
      level: "HIGH",
      reasons: [
        {
          code: "forensic_operational_laundering_pattern",
          message: "Operational laundering-pattern risk.",
          scoreImpact: 60
        }
      ]
    },
    observations: [],
    rawEvidence: [],
    serviceExposureProfiles: [],
    addressBehaviorProfiles: [],
    inboundProvenanceProfiles: [],
    counterpartyRiskProfiles: [],
    directCounterpartyInteractionProfiles: [],
    stablecoinRestrictionProfiles: [],
    boundaryExposureProfiles: [],
    walletRoleProfiles: [],
    extendedProvenanceProfiles: [],
    missingChecks: []
  };

  const text = formatAddressCheckStarted(result, {
    whereIsMoneyJob: whereIsMoneyJobForTest(),
    deepJob: forensicJobForTest({ kind: "address_deep_check" }),
    locale: "ru"
  }).text;

  expect(text).toContain("Проверка адреса — запущена");
  expect(text).toContain("Итоговый риск появится");
  expect(text).not.toContain("60/100");
  expect(text).not.toContain("Риск адреса");
});
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected: preliminary tests pass.

- [ ] **Step 6: PR-style review checkpoint**

Check:

- hard evidence is still shown immediately;
- non-hard preliminary score is hidden;
- started message lists jobs without becoming technical.

---

### Task 4: Compact Where-Is-Money Final Report

**Files:**
- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Replace normal where-is-money formatter body**

In `formatWhereIsMoneyReport`, route normal user output through:

```ts
return formatUnifiedAddressFinalReport({
  address: report.subjectAddress,
  whereReport: report,
  locale,
  runtimeLabel: options.runtimeLabel
});
```

Keep a separate support/detail formatter for technical output in Task 6.

- [ ] **Step 2: Preserve localized status wording**

Do not show `partial` in the title. The unified formatter title stays:

```text
Проверка адреса — итог
```

Limitations are represented by the `Ограничения` section.

- [ ] **Step 3: Remove normal report sections**

Ensure the normal where-is-money message no longer includes:

```text
Технические детали
Evidence type
Assessment
Origin paths
Sender interactions
Coverage and limits
AI contract verdict
Previous fast risk
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected: compact where-is-money tests pass.

- [ ] **Step 5: PR-style review checkpoint**

Check:

- the user sees one final score;
- `partial` is not exposed as the report title;
- limitations are short and meaningful;
- support details are not lost, only moved.

---

### Task 5: Deep Behavior As Context, Not Competing Score

**Files:**
- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Stop sending standalone behavior score by default**

Find `formatDeepForensicReport` usage for completed deep address jobs. For the normal user path, replace standalone behavior report with one of these:

```ts
// If where-is-money result is available:
await sendMessage(ctx, formatUnifiedAddressFinalReport({
  address: whereReport.subjectAddress,
  whereReport,
  deepReport,
  locale,
  runtimeLabel: options.runtimeLabel
}));
```

If where-is-money is not available yet, use a neutral context completion message:

```ts
await sendMessage(ctx, telegramHtmlMessage([
  bold(locale === "en" ? "Address behavior — context ready" : "Контекст поведения готов"),
  locale === "en"
    ? "Final risk will be shown after provenance analysis."
    : "Итоговый риск покажем после анализа происхождения средств.",
  runtimeMarkerLine(options.runtimeLabel)
].filter((line): line is string => Boolean(line))));
```

- [ ] **Step 2: Keep standalone deep formatter for support/debug**

Do not delete `formatDeepForensicReport`. Rename or wrap it only if needed:

```ts
export function formatDeepForensicSupportReport(
  job: ForensicCheckJob,
  report: DeepAddressForensicReport,
  status: "completed" | "partial",
  options: { runtimeLabel?: string; locale?: BotLocale } = {}
): TelegramHtmlMessage {
  return formatDeepForensicReport(job, report, status, options);
}
```

- [ ] **Step 3: Add tests**

Add:

```ts
it("does not present deep behavior as a competing final risk in the normal path", () => {
  const text = formatUnifiedAddressFinalReport({
    address: "TTs9xCEZ43niXvfKTu7LcF7Kcud3Bbw7FD",
    whereReport: whereIsMoneyReportForTest({ riskScore: 25, decision: "ACCEPTABLE" }),
    deepReport: deepReportForTest({
      directCounterpartyInteractionProfiles: [
        {
          subjectAddress: walletAddress,
          direction: "outbound",
          counterpartyAddress: secondWalletAddress,
          volumeRaw: "500000000000",
          volumeRatio: 0.5,
          txCount: 3,
          firstSeen: "2026-06-01T10:00:00.000Z",
          lastSeen: "2026-06-01T11:00:00.000Z",
          txHashes: ["tx-counterparty"],
          serviceCategory: null,
          identity: null,
          snapshot: {
            address: secondWalletAddress,
            riskScore: 80,
            riskLevel: "HIGH",
            source: "fast_address_check",
            evidenceClass: "counterparty_behavior_context",
            reasons: ["counterparty fast check found behavior context"],
            partialNotes: []
          },
          interactionWeight: 0.56,
          scoreContribution: 45,
          evidenceClass: "counterparty_behavior_context",
          skippedReason: null
        }
      ]
    }),
    locale: "ru"
  }).text;

  expect(text).toContain("25/100");
  expect(text).toContain("поведенческий риск");
  expect(text).not.toContain("Риск поведения");
});
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected: deep behavior context tests pass.

- [ ] **Step 5: PR-style review checkpoint**

Check:

- no normal output shows both `Итоговый риск` and `Риск поведения`;
- deep hard evidence still triggers override;
- when where-is-money is pending, the bot does not fabricate a final score.

---

### Task 6: Support And Debug Detail Preservation

**Files:**
- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add explicit support formatter for where-is-money details**

Create:

```ts
export function formatWhereIsMoneySupportReport(
  job: ForensicCheckJob,
  report: WhereIsMoneyReport,
  status: "completed" | "partial",
  options: { runtimeLabel?: string; locale?: BotLocale } = {}
): TelegramHtmlMessage {
  const locale = options.locale ?? normalizeBotLocale(job.progressJson.locale);
  return telegramHtmlMessage([
    bold(locale === "en" ? "Where-is-money — support details" : "Откуда деньги — детали поддержки"),
    `${bold("Job")}: ${code(job.id)}`,
    `${bold(locale === "en" ? "Address" : "Адрес")}: ${code(report.subjectAddress)}`,
    `${bold(locale === "en" ? "Status" : "Статус")}: ${code(status)}`,
    `${bold(locale === "en" ? "Selected inbound transfers" : "Выбрано входящих переводов")}: ${code(String(report.coverage.selectedInboundTxCount))}`,
    `${bold(locale === "en" ? "Coverage" : "Покрытие")}: ${code(`${Math.round(report.coverage.coverageRatio * 100)}%`)}`,
    `${bold(locale === "en" ? "Fetched addresses" : "Загружено адресов")}: ${code(String(report.coverage.fetchedAddressCount))}`,
    section(locale === "en" ? "Decision reasons" : "Причины решения", [bulletList(report.decisionReasons.slice(0, 5))]),
    runtimeMarkerLine(options.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
}
```

- [ ] **Step 2: Wire support formatter only to support/debug command path**

Use `formatWhereIsMoneySupportReport` in explicit status/debug commands. Keep normal job completion output on `formatUnifiedAddressFinalReport`.

- [ ] **Step 3: Add tests**

Add:

```ts
it("keeps where-is-money job id in support details but not in normal final output", () => {
  const job = whereIsMoneyJobForTest({ id: "9d409cb0-2eac-4482-8ca7-7ddfec437cfb" });
  const report = whereIsMoneyReportForTest();

  const normal = formatUnifiedAddressFinalReport({
    address: report.subjectAddress,
    whereReport: report,
    locale: "ru"
  }).text;
  const support = formatWhereIsMoneySupportReport(job, report, "partial", { locale: "ru" }).text;

  expect(normal).not.toContain(job.id);
  expect(support).toContain(job.id);
  expect(support).toContain("детали поддержки");
});
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- tests/bot/createBot.test.ts
```

Expected: support preservation tests pass.

- [ ] **Step 5: PR-style review checkpoint**

Check:

- technical details remain reachable;
- normal output stays short;
- no support-only command accidentally becomes the default job completion message.

---

### Task 7: Full Verification And Review

**Files:**
- Modify: `src/alerts/formatters.ts`
- Modify: `src/alerts/notificationText.ts`
- Modify: `tests/alerts/formatters.test.ts`

- [ ] **Step 1: Add a regression test for incoming deposit origin coverage copy**

Add a test around incoming deposit alert formatting:

```ts
it("does not describe low incoming origin coverage as checked percentage of the deposit", () => {
  const message = formatIncomingDepositRiskAlert({
    jobId: "job-1",
    amount: "300000",
    watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
    sender: "TQAX4BGupqDWbyihEN2Ks5HbqUmw3rjDbV",
    txHash: "e83aae4784668e499b063cf78289bdbc3498ea3d56b3ff628209052516fb3dc0",
    timestamp: new Date("2026-06-01T10:28:00.000Z"),
    locale: "ru",
    report: incomingDepositRiskReportForTest({
      decision: "ACCEPTABLE",
      depositRiskScore: 40,
      riskBand: "LOW-MEDIUM",
      originCoverage: 0.15249102,
      provenanceConfidence: 31,
      dataQuality: "medium",
      senderRole: "operational_liquidity_wallet",
      reasons: [
        "Clean CEX origin is not fully proven; wallet looks like an operational/liquidity wallet and no hard bad evidence was found."
      ],
      warnings: []
    })
  }).text;

  expect(message).not.toContain("Проверено происхождение: 15% суммы");
  expect(message).toContain("Уверенность по происхождению");
  expect(message).toContain("низкая");
});
```

Use the existing incoming-deposit fixture name if it differs.

- [ ] **Step 2: Replace `checkedOriginLabel` usage for incoming deposits**

In `src/alerts/formatters.ts`, replace:

```ts
checkedOriginLabel(input.report.originCoverage, locale),
```

with:

```ts
incomingOriginConfidenceLabel(input.report, locale),
```

- [ ] **Step 3: Add the new label helper**

In `src/alerts/notificationText.ts`, add:

```ts
export function incomingOriginConfidenceLabel(
  report: Pick<IncomingDepositRiskReport, "originCoverage" | "provenanceConfidence">,
  locale: BotLocale
): string {
  const confidence = report.provenanceConfidence >= 70
    ? (locale === "en" ? "high" : "высокая")
    : report.provenanceConfidence >= 40
      ? (locale === "en" ? "medium" : "средняя")
      : (locale === "en" ? "low" : "низкая");
  const provenShare = Math.round(report.originCoverage * 100);
  return locale === "en"
    ? `${bold("Origin confidence")}: ${code(confidence)}; proven continuity ${code(`${provenShare}%`)}`
    : `${bold("Уверенность по происхождению")}: ${code(confidence)}; доказанная связка ${code(`${provenShare}%`)}`;
}
```

If `notificationText.ts` intentionally has no HTML helpers, keep this helper in `formatters.ts` instead.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- tests/alerts/formatters.test.ts
```

Expected: incoming deposit copy test passes and the old phrase is absent.

- [ ] **Step 5: PR-style review checkpoint**

Check:

- the alert no longer implies only part of the deposit was checked;
- low origin continuity is still visible;
- the text explains confidence rather than exposing raw internal coverage as the main claim.

---

### Task 8: Large-Transfer Funding Bundle Detection

**Files:**
- Modify: `src/forensics/incomingDepositCashflow.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `src/types.ts`
- Modify: `tests/forensics/incomingDepositCashflow.test.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`
- Modify: `tests/alerts/formatters.test.ts`

- [ ] **Step 1: Extend funding candidate types**

In `src/types.ts`, add an optional bundle type for incoming deposit paths:

```ts
export type IncomingDepositFundingBundle = {
  targetTxHash: string;
  targetFromAddress: string;
  targetToAddress: string;
  targetAmountRaw: string;
  bundleAmountRaw: string;
  bundleCoverageRatio: number;
  windowStart: string;
  windowEnd: string;
  fundingTxHashes: string[];
  fundingAddresses: string[];
};
```

Then add to `IncomingDepositOriginPath`:

```ts
fundingBundles?: IncomingDepositFundingBundle[];
```

- [ ] **Step 2: Add bundle detector unit test**

In `tests/forensics/incomingDepositCashflow.test.ts`, add:

```ts
it("detects recent inbound bundle covering a large outbound transfer", () => {
  const target = edge({
    txHash: "tx-out-1960k",
    fromAddress: "TCSB8G1pEPwmWEY4fnKxvh41h4aP744xyU",
    toAddress: "TQsNcd9ysat2yrG3iMoqKj3Vezp5u154Cc",
    amountRaw: "1960000000000",
    timestamp: new Date("2026-04-16T06:39:00.000Z")
  });
  const result = buildFundingBundleForOutbound({
    target,
    edges: [
      edge({ txHash: "tx-500k", fromAddress: "TLNtizKKZoxsmg9Zk9xBHenKoNLvCP7cou", toAddress: target.fromAddress, amountRaw: "500000000000", timestamp: new Date("2026-04-16T03:47:42.000Z") }),
      edge({ txHash: "tx-100", fromAddress: "TRnyAAf5zDKKTPJTpu4qkDjvRH3BYSh6Mw", toAddress: target.fromAddress, amountRaw: "100000000", timestamp: new Date("2026-04-16T03:59:45.000Z") }),
      edge({ txHash: "tx-749900", fromAddress: "TRnyAAf5zDKKTPJTpu4qkDjvRH3BYSh6Mw", toAddress: target.fromAddress, amountRaw: "749900000000", timestamp: new Date("2026-04-16T04:01:33.000Z") }),
      edge({ txHash: "tx-456k", fromAddress: "TBq8QzsQktv92Zi6t6TMYyJQawtPJ5VcsH", toAddress: target.fromAddress, amountRaw: "456000000000", timestamp: new Date("2026-04-16T04:05:36.000Z") }),
      edge({ txHash: "tx-250k", fromAddress: "TRnyAAf5zDKKTPJTpu4qkDjvRH3BYSh6Mw", toAddress: target.fromAddress, amountRaw: "250000000000", timestamp: new Date("2026-04-16T04:18:18.000Z") }),
      edge({ txHash: "tx-2999", fromAddress: "TEPSrSYPDSQ7yXpMFPq91Fb1QEWpMkRGfn", toAddress: target.fromAddress, amountRaw: "2999000000", timestamp: new Date("2026-04-16T05:32:12.000Z") })
    ],
    lookbackMs: 6 * 60 * 60 * 1000,
    minCoverageRatio: 0.95
  });

  expect(result).toMatchObject({
    targetTxHash: "tx-out-1960k",
    bundleAmountRaw: "1958999000000",
    bundleCoverageRatio: 0.9994
  });
  expect(result?.fundingTxHashes).toEqual(["tx-500k", "tx-100", "tx-749900", "tx-456k", "tx-250k", "tx-2999"]);
});
```

- [ ] **Step 3: Implement bundle detector**

In `src/forensics/incomingDepositCashflow.ts`, export:

```ts
export function buildFundingBundleForOutbound(input: {
  target: ForensicRouteEdge;
  edges: ForensicRouteEdge[];
  lookbackMs: number;
  minCoverageRatio: number;
}): IncomingDepositFundingBundle | null {
  const targetAmount = parseRaw(input.target.amountRaw);
  if (targetAmount <= 0n) return null;
  const earliest = new Date(input.target.timestamp.getTime() - input.lookbackMs);
  const funding = input.edges
    .filter((edge) => edge.toAddress === input.target.fromAddress)
    .filter((edge) => edge.timestamp < input.target.timestamp && edge.timestamp >= earliest)
    .filter((edge) => parseRaw(edge.amountRaw) > 0n)
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  const bundleAmount = funding.reduce((sum, edge) => sum + parseRaw(edge.amountRaw), 0n);
  const coverage = ratio(bundleAmount > targetAmount ? targetAmount : bundleAmount, targetAmount);
  if (coverage < input.minCoverageRatio) return null;
  return {
    targetTxHash: input.target.txHash,
    targetFromAddress: input.target.fromAddress,
    targetToAddress: input.target.toAddress,
    targetAmountRaw: input.target.amountRaw,
    bundleAmountRaw: bundleAmount.toString(),
    bundleCoverageRatio: coverage,
    windowStart: funding[0]?.timestamp.toISOString() ?? earliest.toISOString(),
    windowEnd: input.target.timestamp.toISOString(),
    fundingTxHashes: funding.map((edge) => edge.txHash),
    fundingAddresses: [...new Set(funding.map((edge) => edge.fromAddress))]
  };
}
```

- [ ] **Step 4: Attach bundles to incoming origin paths**

In `src/forensics/incomingDepositJob.ts`, after `whereReport` is built and before `incomingReportFromWhere`, create a map of bundles for large path steps:

```ts
const fundingBundlesByTxHash = new Map<string, IncomingDepositFundingBundle>();
for (const path of whereReport.originPaths) {
  for (const step of path.steps) {
    const amountRaw = BigInt(step.amountRaw);
    if (amountRaw < 500_000n * 1_000_000n) continue;
    const edges = await fetchEdgesForAddress(step.fromAddress);
    const bundle = buildFundingBundleForOutbound({
      target: {
        txHash: step.txHash,
        fromAddress: step.fromAddress,
        toAddress: step.toAddress,
        amountRaw: step.amountRaw,
        timestamp: new Date(step.timestamp),
        method: "transfer",
        edgeType: "normal_transfer"
      },
      edges,
      lookbackMs: 6 * 60 * 60 * 1000,
      minCoverageRatio: 0.95
    });
    if (bundle) fundingBundlesByTxHash.set(step.txHash, bundle);
  }
}
```

Then pass the map into `incomingReportFromWhere` and `incomingPathFromWhere`, and attach:

```ts
fundingBundles: steps
  .map((step) => fundingBundlesByTxHash.get(step.txHash) ?? null)
  .filter((bundle): bundle is IncomingDepositFundingBundle => bundle !== null)
```

- [ ] **Step 5: Use bundles for user-facing explanation**

In alert formatting, add one short limitation/context line when bundles exist:

```text
Крупный промежуточный перевод покрыт входящими потоками, но чистый источник выше по цепочке не доказан.
```

Do not turn this into `clean` source policy.

- [ ] **Step 6: Add incoming job regression test**

In `tests/forensics/incomingDepositJob.test.ts`, add a case based on the observed structure:

```ts
it("records funding bundle coverage for a large intermediate liquidity transfer", async () => {
  const report = await buildIncomingDepositReport(caseWith300kDepositAnd1960kBundle());

  const bundles = report.originPaths.flatMap((path) => path.fundingBundles ?? []);
  expect(bundles[0]).toMatchObject({
    targetAmountRaw: "1960000000000",
    bundleAmountRaw: "1958999000000",
    bundleCoverageRatio: 0.9994
  });
  expect(report.decision).toBe("ACCEPTABLE");
  expect(report.reasons.join(" ")).not.toContain("clean CEX proven");
});
```

- [ ] **Step 7: Run focused tests**

Run:

```powershell
npm test -- tests/forensics/incomingDepositCashflow.test.ts tests/forensics/incomingDepositJob.test.ts tests/alerts/formatters.test.ts
```

Expected: bundle detection tests pass, and alerts explain bundle context without claiming clean origin.

- [ ] **Step 8: PR-style review checkpoint**

Check:

- bundle coverage is separate from clean provenance;
- funding bundle does not lower risk by itself;
- second-pass data is useful for support and future expansion;
- the observed `1.96M` corridor would no longer collapse into a misleading `15% checked origin` message.

---

### Task 9: Adaptive Deep Corridor Expansion

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `src/forensics/incomingDepositCashflow.ts`
- Modify: `src/types.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`
- Modify: `tests/forensics/incomingDepositCashflow.test.ts`

- [ ] **Step 1: Extend bundle metadata with expansion status**

In `src/types.ts`, extend `IncomingDepositFundingBundle`:

```ts
deepExpansion?: {
  status: "not_run" | "clean_source_reached" | "hard_risk_reached" | "service_boundary_reached" | "unproven_corridor";
  maxDepth: number;
  fetchedAddressCount: number;
  topExpandedFunders: string[];
  reasons: string[];
};
```

- [ ] **Step 2: Add candidate selection for deep expansion**

In `src/forensics/incomingDepositCashflow.ts`, export:

```ts
export function selectFundingBundleFundersForExpansion(input: {
  bundle: IncomingDepositFundingBundle;
  maxFunders: number;
}): string[] {
  return input.bundle.fundingAddresses.slice(0, Math.max(0, input.maxFunders));
}
```

If the detector stores per-funder amounts in a later refinement, sort by amount descending. For the first implementation, preserve bundle order and cap the count.

- [ ] **Step 3: Add test for bounded branch selection**

In `tests/forensics/incomingDepositCashflow.test.ts`, add:

```ts
it("selects only top funding bundle funders for adaptive deep expansion", () => {
  const result = selectFundingBundleFundersForExpansion({
    bundle: {
      targetTxHash: "tx-out",
      targetFromAddress: "TCSB8G",
      targetToAddress: "TQsNcd",
      targetAmountRaw: "1960000000000",
      bundleAmountRaw: "1958999000000",
      bundleCoverageRatio: 0.9994,
      windowStart: "2026-04-16T03:47:42.000Z",
      windowEnd: "2026-04-16T06:39:00.000Z",
      fundingTxHashes: ["tx-500k", "tx-749900", "tx-456k", "tx-250k"],
      fundingAddresses: ["TLNtiz", "TRnyAA", "TBq8Qz", "TEPSrS"]
    },
    maxFunders: 3
  });

  expect(result).toEqual(["TLNtiz", "TRnyAA", "TBq8Qz"]);
});
```

- [ ] **Step 4: Add adaptive second-pass runner**

In `src/forensics/incomingDepositJob.ts`, after Task 8 bundle detection, add a helper:

```ts
async function expandFundingBundleCorridor(input: {
  bundle: IncomingDepositFundingBundle;
  maxDepth: number;
  maxAddressFetches: number;
  maxFunders: number;
  fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
}): Promise<NonNullable<IncomingDepositFundingBundle["deepExpansion"]>> {
  const funders = selectFundingBundleFundersForExpansion({
    bundle: input.bundle,
    maxFunders: input.maxFunders
  });
  let fetchedAddressCount = 0;
  const reasons: string[] = [];

  for (const funder of funders) {
    if (fetchedAddressCount >= input.maxAddressFetches) break;
    const labels = await input.getLabelsForAddress(funder);
    const classification = await input.getClassificationForAddress(funder);
    fetchedAddressCount += 1;

    if (labels.some((label) => label.label === "scam" || label.label === "reported_scam" || label.label === "stolen_funds" || label.label === "phishing")) {
      return {
        status: "hard_risk_reached",
        maxDepth: input.maxDepth,
        fetchedAddressCount,
        topExpandedFunders: funders,
        reasons: [`Hard-risk label reached at bundle funder ${funder}.`]
      };
    }

    if (classification && classification.category !== "none") {
      return {
        status: classification.category === "cex" || classification.category === "hot_wallet"
          ? "clean_source_reached"
          : "service_boundary_reached",
        maxDepth: input.maxDepth,
        fetchedAddressCount,
        topExpandedFunders: funders,
        reasons: [`Bundle funder ${funder} reached ${classification.category} boundary.`]
      };
    }

    await input.fetchEdgesForAddress(funder);
    reasons.push(`Expanded bundle funder ${funder}; no clean or hard-risk source reached.`);
  }

  return {
    status: "unproven_corridor",
    maxDepth: input.maxDepth,
    fetchedAddressCount,
    topExpandedFunders: funders,
    reasons
  };
}
```

This first implementation is intentionally conservative. It records deep corridor status and boundary hits; it does not rewrite the core provenance verdict.

- [ ] **Step 5: Attach expansion results to bundles**

For each bundle from Task 8, run:

```ts
const deepExpansion = await expandFundingBundleCorridor({
  bundle,
  maxDepth: 20,
  maxAddressFetches: 80,
  maxFunders: 3,
  fetchEdgesForAddress,
  getLabelsForAddress: input.deps.getLabelsForAddress,
  getClassificationForAddress
});
```

Attach the result to the stored bundle:

```ts
fundingBundlesByTxHash.set(step.txHash, {
  ...bundle,
  deepExpansion
});
```

- [ ] **Step 6: Add incoming job test for unproven deep corridor**

In `tests/forensics/incomingDepositJob.test.ts`, add:

```ts
it("keeps deep liquidity corridor unproven when 20-hop expansion finds no clean or hard-risk source", async () => {
  const report = await buildIncomingDepositReport(caseWith300kDepositAnd1960kBundle());

  const expansion = report.originPaths
    .flatMap((path) => path.fundingBundles ?? [])
    .map((bundle) => bundle.deepExpansion)
    .find((value) => value !== undefined);

  expect(expansion).toMatchObject({
    status: "unproven_corridor",
    maxDepth: 20
  });
  expect(report.decision).toBe("ACCEPTABLE");
  expect(report.reasons.join(" ")).not.toContain("clean CEX proven");
});
```

- [ ] **Step 7: Add incoming job test for clean boundary reached**

Add:

```ts
it("records clean source reached when adaptive bundle expansion reaches allowlisted CEX boundary", async () => {
  const report = await buildIncomingDepositReport(caseWithBundleFunderClassifiedAsCex());

  const expansion = report.originPaths
    .flatMap((path) => path.fundingBundles ?? [])
    .map((bundle) => bundle.deepExpansion)
    .find((value) => value !== undefined);

  expect(expansion).toMatchObject({
    status: "clean_source_reached"
  });
});
```

Do not assert that this automatically makes the whole deposit `LOW`. The final score can improve only through the existing source-policy/provenance scoring layer.

- [ ] **Step 8: Run focused tests**

Run:

```powershell
npm test -- tests/forensics/incomingDepositCashflow.test.ts tests/forensics/incomingDepositJob.test.ts
```

Expected: adaptive expansion metadata is recorded without overstating clean provenance.

- [ ] **Step 9: PR-style review checkpoint**

Check:

- expansion is bounded to top bundle funders;
- 15-20 hop behavior is not applied to every branch;
- service boundaries stop expansion;
- unproven corridor remains unproven;
- clean or hard-risk hits are recorded as evidence, not hidden.

---

### Task 10: Full Verification And Review

**Files:**
- Modify as needed only if tests reveal issues.

- [ ] **Step 1: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: pass.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm test
```

Expected: pass.

- [ ] **Step 3: Manual text scan**

Run:

```powershell
rg -n "Previous fast risk|Риск поведения|Технические детали|Origin paths|Sender interactions|Evidence type" src\\bot tests\\bot
```

Expected:

- `Previous fast risk` absent from normal output tests;
- `Риск поведения` appears only in support/debug formatter tests if kept;
- technical section strings appear only in support/debug paths.

- [ ] **Step 4: PR-style review**

Review the diff with this checklist:

- one final score in normal user flow;
- where-is-money remains primary;
- hard evidence override is narrow and deterministic;
- behavior/context wording is not accusatory;
- no forensic scoring thresholds changed;
- support/debug details preserved;
- Russian copy is short and operator-readable.

- [ ] **Step 5: Commit**

Stage only files touched by this implementation:

```powershell
git add src/bot/createBot.ts tests/bot/createBot.test.ts docs/superpowers/specs/2026-06-01-unified-address-risk-report-design.md docs/superpowers/plans/2026-06-01-unified-address-risk-report.md
git commit -m "feat: unify address risk report"
```

---

## Living Issue Log

Add follow-up issues here before implementation or between tasks. Each issue should include:

- observed bad output;
- why it confuses the operator;
- desired user-facing behavior;
- implementation task it belongs to.

### 2026-06-01: Approved Rule

Where-is-money is the primary final score. Preliminary and deep behavior add warnings only, except for deterministic hard evidence.

### 2026-06-01: Known Example

For `TTs9xC...w7FD`, the final user report should show `ACCEPTABLE` and `25/100`, plus a short warning that a major counterparty has behavior risk. It should not show separate `60/100` preliminary risk or separate `72/100` behavior risk in normal output.

## Execution Mode

Use Subagent-Driven implementation:

- one task per subagent;
- PR-style review after each task;
- no next task starts until the previous task is reviewed;
- keep commits small when implementation begins.
