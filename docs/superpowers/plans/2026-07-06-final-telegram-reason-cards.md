# Final Telegram Reason Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace noisy final Telegram address reports with a reason-card summary that gives a clear decision, next action, evidence, and coverage caveats.

**Architecture:** Keep scoring and forensic logic unchanged except for verifying that matrix `REVIEW` cannot display as `ACCEPTABLE`. Build a small reason-card layer inside `src/bot/createBot.ts` from existing report fields, then render user-facing final reports from those cards while keeping raw scoring diagnostics behind `showBetaDiagnostics=true` and support/admin surfaces.

**Tech Stack:** TypeScript, Grammy Telegram HTML formatting helpers, Vitest, existing TRON USDT forensic report types.

---

## File Structure

- Modify `src/bot/createBot.ts`
  - Add `FinalReasonCard` helpers near the existing unified final-report helpers.
  - Render final reports as `Что делать`, `Почему`, `Что важно учесть`.
  - Keep `Beta/internal` only when `showBetaDiagnostics=true`.
- Modify `src/alerts/notificationText.ts`
  - Add small normalization cases for clean CEX/source caveats that may still come from existing reports.
- Modify `src/risk/unifiedWalletRisk.ts`
  - Add a narrow regression test target if matrix `REVIEW` ever flattens to `ACCEPTABLE`; current code should already preserve `REVIEW`.
- Modify `tests/bot/createBot.test.ts`
  - Add failing tests for user-facing final report contract.
  - Update old expectations that currently assert matrix/debug text in normal user output.
- Modify `tests/alerts/notificationText.test.ts`
  - Add coverage for clean CEX and source-boundary reason normalization.
- Modify `tests/risk/unifiedWalletRisk.test.ts`
  - Add or strengthen matrix `REVIEW` decision preservation.
- Modify `docs/knowledge/08-admin-and-bot-ux.md`
  - Document the new final Telegram report contract.
- Modify `docs/knowledge/09-current-decisions.md`
  - Record the decision that user-facing final reports hide matrix/debug internals.

---

### Task 1: Add User-Facing Final Report Tests

**Files:**
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add failing tests for normal user output**

Insert these tests near the existing `formatUnifiedAddressFinalReportForTest` tests:

```ts
  it("renders matrix REVIEW as a user REVIEW without matrix/debug copy", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 25,
      decisionReasons: ["Clean CEX origin is not fully proven; wallet looks like an operational/liquidity wallet and no hard bad evidence was found."],
      coverage: {
        selectedInboundTxCount: 1,
        selectedInboundVolumeRaw: "1000000000",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        maxDepth: 7,
        fetchedAddressCount: 3,
        partial: true,
        notes: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      fastReport: riskReportForTest({
        level: "MEDIUM",
        score: 55,
        taintScore: 0,
        launderingPatternScore: 55,
        dominantRiskType: "laundering_pattern",
        reasons: [
          {
            code: "forensic_address_behavior",
            message: "Address shows high-volume transit-like behavior.",
            scoreImpact: 55
          }
        ]
      }),
      deepReport: deepReportForTest({
        boundaryExposureProfiles: [boundaryExposureProfile()]
      }),
      locale: "ru"
    });

    expect(text).toContain("Решение: REVIEW");
    expect(text).toContain("Что делать");
    expect(text).toContain("Почему");
    expect(text).toContain("Что важно учесть");
    expect(text).toContain("Нужна ручная проверка");
    expect(text).toContain("Чистый CEX-источник не доказан полностью.");
    expect(text).toContain("Цепочка дошла до биржи или сервиса");
    expect(text).toContain("Проверили 100% выбранной суммы");
    expect(text).not.toContain("ACCEPTABLE — Сильных риск-сигналов не найдено");
    expect(text).not.toContain("Scoring Signal Matrix");
    expect(text).not.toContain("behavior_only_prior");
    expect(text).not.toContain("Weighted layer score");
    expect(text).not.toContain("Dampener");
    expect(text).not.toContain("production_full");
    expect(text).not.toContain("Beta/internal");
  });

  it("deduplicates exact approval-drain evidence in Russian final reports", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "DECLINE",
      userDecision: "DECLINE",
      internalDecision: "DECLINE",
      riskScore: 95,
      decisionReasons: ["Exact approval-drain provenance reaches checked wallet via 0 hop(s)."],
      assessment: {
        ...whereAssessmentForTest({ decision: "DECLINE", riskScore: 95 }),
        hardBadEvidence: [
          {
            kind: "approval_drain",
            score: 95,
            evidenceIds: ["tx-transferfrom-drain"],
            message: "Exact approval-drain provenance reaches checked wallet via 0 hop(s)."
          }
        ]
      },
      approvalDrainProvenanceProfiles: [
        {
          victimAddress: "TVictim111111111111111111111111111111",
          approvalTxHash: "tx-approval-root-cause",
          drainTxHash: "tx-transferfrom-drain",
          spenderAddress: "TSpender11111111111111111111111111111",
          firstReceiverAddress: walletAddress,
          subjectAddress: walletAddress,
          hopDepth: 0,
          amountRaw: "309000000000",
          amountPreservationRatio: 0.991,
          approvalAt: "2026-05-20T09:50:00.000Z",
          drainAt: "2026-05-20T10:00:00.000Z",
          pathTxHashes: ["tx-transferfrom-drain"],
          pathAddresses: ["TVictim111111111111111111111111111111", walletAddress],
          score: 95,
          evidenceStrength: "exact_approval_and_transfer_from",
          subjectTokenState: null,
          victimTokenState: null,
          features: []
        }
      ],
      coverage: {
        selectedInboundTxCount: 5,
        selectedInboundVolumeRaw: "24213000000",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        maxDepth: 7,
        fetchedAddressCount: 8,
        partial: true,
        notes: ["provider coverage partial"]
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      fastReport: riskReportForTest({
        level: "CRITICAL",
        score: 95,
        taintScore: 95,
        launderingPatternScore: 0,
        dominantRiskType: "taint",
        reasons: [
          {
            code: "internal_label_approval_drain_proximity",
            message: "Derived high-risk marker: exact upstream approval-drain provenance linked to this address.",
            scoreImpact: 95
          }
        ]
      }),
      deepReport: deepReportForTest({
        approvalDrainProvenanceProfiles: whereReport.approvalDrainProvenanceProfiles
      }),
      locale: "ru"
    });

    expect(text).toContain("Решение: DECLINE");
    expect(text).toContain("Не принимать автоматически.");
    expect(text).toContain("Найдена точная approval-drain цепочка");
    expect(text).toContain("Ранее система уже сохраняла этот адрес как связанный с exact approval-drain.");
    expect(text).toContain("Проверили 100% выбранной суммы");
    expect(text).toContain("это не означает полную историю адреса");
    expect((text.match(/Найдена точная approval-drain цепочка/g) ?? []).length).toBe(1);
    expect(text).not.toContain("Exact approval-drain provenance reaches checked wallet");
    expect(text).not.toContain("Derived high-risk marker");
    expect(text).not.toContain("Scoring Signal Matrix");
    expect(text).not.toContain("matrix:hard_proof");
    expect(text).not.toContain("Beta/internal");
  });

  it("keeps final diagnostics only when beta diagnostics are requested", () => {
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
            evidenceIds: ["tx-transferfrom-drain"],
            message: "Exact approval-drain provenance reaches checked wallet via 0 hop(s)."
          }
        ]
      }
    });

    const normalText = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en"
    });
    const debugText = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en",
      showBetaDiagnostics: true
    });

    expect(normalText).not.toContain("Beta/internal");
    expect(normalText).not.toContain("Weighted layer score");
    expect(debugText).toContain("Beta/internal");
    expect(debugText).toContain("Weighted layer score");
  });
```

- [ ] **Step 2: Run the focused bot tests and verify failure**

Run:

```powershell
npm test -- --run tests/bot/createBot.test.ts
```

Expected: FAIL. The failures should show current output still contains matrix/debug copy and does not render the new `Что делать` contract.

- [ ] **Step 3: Commit the failing tests**

```powershell
git add tests/bot/createBot.test.ts
git commit -m "test: cover final Telegram reason cards"
```

---

### Task 2: Add Reason Card Helpers

**Files:**
- Modify: `src/bot/createBot.ts`

- [ ] **Step 1: Add card types and utility helpers**

Insert this block after `type UnifiedRiskFinalDecision = UnifiedWalletRiskResult["finalDecision"];`:

```ts
type FinalReasonCardKind =
  | "approval_drain_exact"
  | "approval_drain_saved_marker"
  | "hard_bad_evidence"
  | "sanctioned_service"
  | "source_policy_review"
  | "clean_cex_not_fully_proven"
  | "service_boundary"
  | "behavior_operational_wallet"
  | "behavior_counterparty"
  | "coverage_partial"
  | "no_hard_evidence"
  | "matrix_review";

type FinalReasonCardDecision = "decline" | "review" | "context" | "coverage";
type FinalReasonCardSource = "where" | "deep" | "fast" | "matrix" | "coverage";

type FinalReasonCard = {
  kind: FinalReasonCardKind;
  priority: number;
  decision: FinalReasonCardDecision;
  dedupeKey: string;
  source: FinalReasonCardSource;
  ru: string;
  en: string;
  actionRu?: string;
  actionEn?: string;
};

function finalReasonCardText(card: FinalReasonCard, locale: BotLocale): string {
  return locale === "en" ? card.en : card.ru;
}

function finalReasonCardAction(card: FinalReasonCard, locale: BotLocale): string | null {
  return locale === "en" ? card.actionEn ?? null : card.actionRu ?? null;
}

function addFinalReasonCard(cards: FinalReasonCard[], card: FinalReasonCard): void {
  const existing = cards.find((item) => item.dedupeKey === card.dedupeKey);
  if (!existing) {
    cards.push(card);
    return;
  }
  if (card.priority < existing.priority) {
    const index = cards.indexOf(existing);
    cards[index] = card;
  }
}

function sortedFinalReasonCards(cards: FinalReasonCard[]): FinalReasonCard[] {
  return [...cards].sort((left, right) =>
    left.priority - right.priority ||
    left.kind.localeCompare(right.kind)
  );
}
```

- [ ] **Step 2: Add decision display helper**

Insert after `finalDecisionExplanation`:

```ts
function finalDisplayDecision(
  result: UnifiedWalletRiskResult,
  whereReport: WhereIsMoneyReport
): UnifiedRiskFinalDecision {
  if (whereScoreValid(whereReport) === false) return "NO_FINAL_DECISION";
  if (result.matrixScore.matrixDecision === "DECLINE") return "DECLINE";
  if (result.matrixScore.matrixDecision === "REVIEW") return "REVIEW";
  if (
    result.matrixScore.matrixDecision === "INSUFFICIENT_EVIDENCE" &&
    whereReport.decision === "REVIEW" &&
    result.finalScore > 0
  ) {
    return "REVIEW";
  }
  return result.finalDecision;
}
```

- [ ] **Step 3: Run typecheck and verify helper names**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit helper scaffolding**

```powershell
git add src/bot/createBot.ts
git commit -m "feat: add final reason card helpers"
```

---

### Task 3: Collect Reason Cards From Existing Reports

**Files:**
- Modify: `src/bot/createBot.ts`

- [ ] **Step 1: Add exact approval-drain profile helper**

Insert near `whereSharedSourceExposureLines`:

```ts
function exactApprovalDrainProfileFromWhere(report: WhereIsMoneyReport): WhereIsMoneyReport["approvalDrainProvenanceProfiles"][number] | null {
  return report.approvalDrainProvenanceProfiles.find((profile) =>
    profile.evidenceStrength === "exact_approval_and_transfer_from"
  ) ?? null;
}

function approvalDrainExactText(profile: WhereIsMoneyReport["approvalDrainProvenanceProfiles"][number] | null, locale: BotLocale): string {
  if (locale === "en") {
    if (!profile || profile.hopDepth === 0) {
      return "Exact approval-drain evidence was found: after approve, USDT was moved with transferFrom and the checked address received the funds.";
    }
    return `Exact approval-drain evidence was found: after approve, USDT was moved with transferFrom and the checked address is linked within ${profile.hopDepth} hop(s).`;
  }
  if (!profile || profile.hopDepth === 0) {
    return "Найдена точная approval-drain цепочка: после approve USDT были списаны через transferFrom, проверяемый адрес получил эти средства.";
  }
  return `Найдена точная approval-drain цепочка: после approve USDT были списаны через transferFrom, проверяемый адрес связан с получателем через ${profile.hopDepth} hop.`;
}
```

- [ ] **Step 2: Add card builder**

Insert after the helper from Step 1:

```ts
function buildFinalReasonCards(input: UnifiedAddressFinalReportInput, result: UnifiedWalletRiskResult): FinalReasonCard[] {
  const cards: FinalReasonCard[] = [];
  const whereReport = input.whereReport;
  const exactApprovalDrain = exactApprovalDrainProfileFromWhere(whereReport);
  const hasApprovalDrainHardEvidence = whereReport.assessment.hardBadEvidence.some((evidence) => evidence.kind === "approval_drain") ||
    result.reasons.some((reason) => reason.code === "exact_approval_drain" || reason.code === "where_hard_bad_evidence");

  if (hasApprovalDrainHardEvidence) {
    addFinalReasonCard(cards, {
      kind: "approval_drain_exact",
      priority: 10,
      decision: "decline",
      dedupeKey: "approval_drain_exact",
      source: "where",
      ru: approvalDrainExactText(exactApprovalDrain, "ru"),
      en: approvalDrainExactText(exactApprovalDrain, "en"),
      actionRu: "Если это клиентский депозит, запросить объяснение происхождения средств.",
      actionEn: "If this is a customer deposit, request source-of-funds explanation."
    });
  }

  const hasSavedApprovalDrainMarker = input.fastReport?.reasons.some((reason) =>
    reason.code === "internal_label_approval_drain_proximity" ||
    reason.message.toLowerCase().includes("exact upstream approval-drain provenance linked to this address")
  ) === true;
  if (hasSavedApprovalDrainMarker) {
    addFinalReasonCard(cards, {
      kind: "approval_drain_saved_marker",
      priority: hasApprovalDrainHardEvidence ? 45 : 12,
      decision: hasApprovalDrainHardEvidence ? "context" : "decline",
      dedupeKey: "approval_drain_saved_marker",
      source: "fast",
      ru: "Ранее система уже сохраняла этот адрес как связанный с exact approval-drain.",
      en: "The system had already saved this address as linked to exact approval-drain evidence."
    });
  }

  for (const evidence of whereReport.assessment.hardBadEvidence) {
    if (evidence.kind === "approval_drain") continue;
    if (evidence.kind === "sanctioned_service") {
      addFinalReasonCard(cards, {
        kind: "sanctioned_service",
        priority: 20,
        decision: "decline",
        dedupeKey: `sanctioned:${evidence.message}`,
        source: "where",
        ru: normalizeNotificationReason(evidence.message, "ru"),
        en: normalizeNotificationReason(evidence.message, "en")
      });
      continue;
    }
    if (isDeterministicWhereHardEvidence(evidence)) {
      addFinalReasonCard(cards, {
        kind: "hard_bad_evidence",
        priority: 25,
        decision: "decline",
        dedupeKey: `hard:${evidence.kind}:${evidence.message}`,
        source: "where",
        ru: normalizeNotificationReason(evidence.message, "ru"),
        en: normalizeNotificationReason(evidence.message, "en")
      });
    }
  }

  const rawReasonText = [
    ...whereReport.decisionReasons,
    ...whereReport.assessment.reasons
  ].join(" | ").toLowerCase();
  if (rawReasonText.includes("clean cex origin is not fully proven") || rawReasonText.includes("clean_source_not_fully_proven")) {
    addFinalReasonCard(cards, {
      kind: "clean_cex_not_fully_proven",
      priority: 50,
      decision: "review",
      dedupeKey: "clean_cex_not_fully_proven",
      source: "where",
      ru: "Чистый CEX-источник не доказан полностью.",
      en: "Clean CEX origin is not fully proven.",
      actionRu: "Запросить подтверждение источника средств.",
      actionEn: "Request source-of-funds evidence."
    });
  }

  for (const line of whereSharedSourceExposureLines(whereReport, "ru")) {
    addFinalReasonCard(cards, {
      kind: "source_policy_review",
      priority: 55,
      decision: "review",
      dedupeKey: `source_policy:${line}`,
      source: "where",
      ru: line,
      en: whereSharedSourceExposureLines(whereReport, "en")[0] ?? line
    });
  }

  const boundary = firstBoundaryExposureProfile(input.deepReport ?? undefined);
  if (boundary) {
    addFinalReasonCard(cards, {
      kind: "service_boundary",
      priority: 70,
      decision: "context",
      dedupeKey: "service_boundary",
      source: "deep",
      ru: "Цепочка дошла до биржи или сервиса. Дальше публичная on-chain трассировка ограничена.",
      en: "The chain reached an exchange or service boundary. Public on-chain tracing is limited after that point."
    });
  }

  const directCounterparty = topDirectCounterpartyInteractionProfile(input.deepReport ?? undefined);
  if (directCounterparty?.snapshot?.riskScore && directCounterparty.scoreContribution > 0) {
    addFinalReasonCard(cards, {
      kind: "behavior_counterparty",
      priority: 75,
      decision: "context",
      dedupeKey: "behavior_counterparty",
      source: "deep",
      ru: "Есть риск по крупному контрагенту. Это контекст, не доказательство грязных средств.",
      en: "A major counterparty has risk context. This is context, not dirty-funds proof."
    });
  }

  if (result.matrixScore.winningRow === "behavior_only_prior") {
    addFinalReasonCard(cards, {
      kind: "behavior_operational_wallet",
      priority: 80,
      decision: result.matrixScore.matrixDecision === "REVIEW" ? "review" : "context",
      dedupeKey: "behavior_operational_wallet",
      source: "matrix",
      ru: "Адрес похож на транзитный или операционный кошелёк. Это контекст, не доказательство грязных средств.",
      en: "The address looks like a transit or operational wallet. This is context, not dirty-funds proof."
    });
  }

  if (whereReport.coverage.partial || result.coverageLevel !== "complete") {
    const coverageLineRu = whereCoverageSummaryLine(whereReport, "ru").replace("Проверено", "Проверили").replace("суммы", "выбранной суммы");
    const coverageLineEn = whereCoverageSummaryLine(whereReport, "en");
    addFinalReasonCard(cards, {
      kind: "coverage_partial",
      priority: 90,
      decision: "coverage",
      dedupeKey: "coverage_partial",
      source: "coverage",
      ru: `${coverageLineRu}; это не означает полную историю адреса.`,
      en: `${coverageLineEn}; this does not mean the full address history is complete.`
    });
  }

  if (result.hardEvidenceFloor === 0) {
    addFinalReasonCard(cards, {
      kind: "no_hard_evidence",
      priority: 95,
      decision: "context",
      dedupeKey: "no_hard_evidence",
      source: "matrix",
      ru: "Жёстких плохих доказательств не найдено.",
      en: "No deterministic bad evidence was found."
    });
  }

  if (result.matrixScore.matrixDecision === "REVIEW") {
    addFinalReasonCard(cards, {
      kind: "matrix_review",
      priority: 100,
      decision: "review",
      dedupeKey: "matrix_review",
      source: "matrix",
      ru: "Итог требует ручной проверки: найден контекстный риск без жёсткого плохого доказательства.",
      en: "The result requires manual review: contextual risk was found without deterministic bad evidence."
    });
  }

  return sortedFinalReasonCards(cards);
}
```

- [ ] **Step 3: Add card selection helpers**

Insert after `buildFinalReasonCards`:

```ts
function finalWhyLines(cards: FinalReasonCard[], locale: BotLocale): string[] {
  const primary = cards.filter((card) => card.decision === "decline" || card.decision === "review");
  const fallback = cards.filter((card) => card.decision === "context");
  return [...primary, ...fallback]
    .map((card) => finalReasonCardText(card, locale))
    .filter((line, index, lines) => line.trim().length > 0 && lines.indexOf(line) === index)
    .slice(0, 5);
}

function finalContextLines(cards: FinalReasonCard[], locale: BotLocale): string[] {
  return cards
    .filter((card) => card.decision === "context" || card.decision === "coverage")
    .map((card) => finalReasonCardText(card, locale))
    .filter((line, index, lines) => line.trim().length > 0 && lines.indexOf(line) === index)
    .slice(0, 4);
}

function finalActionLines(decision: UnifiedRiskFinalDecision, cards: FinalReasonCard[], locale: BotLocale): string[] {
  const actions: string[] = [];
  const add = (ru: string, en: string) => actions.push(locale === "en" ? en : ru);
  if (decision === "DECLINE") {
    add("Не принимать автоматически.", "Do not accept automatically.");
    add("Передать кейс на ручную проверку/compliance.", "Send the case to manual compliance review.");
  } else if (decision === "REVIEW") {
    add("Не принимать автоматически, если сумма существенная.", "Do not accept automatically if the amount is material.");
    add("Проверить кейс вручную в Admin.", "Review the case manually in Admin.");
  } else if (decision === "ACCEPTABLE") {
    add("Можно принять автоматически в рамках текущей политики.", "Can be accepted automatically under the current policy.");
  } else {
    add("Итоговый риск не опубликован: не хватает покрытия.", "Final risk was not published because coverage is incomplete.");
    add("Дождаться индексации или перезапустить проверку после устранения лимита.", "Wait for indexing or rerun the check after the limit is resolved.");
  }

  for (const card of cards) {
    const action = finalReasonCardAction(card, locale);
    if (action) actions.push(action);
  }
  if (decision === "ACCEPTABLE" && cards.some((card) => card.kind === "coverage_partial")) {
    add("При крупной сумме всё равно проверьте ограничения покрытия.", "For a large amount, still review the coverage limits.");
  }
  return [...new Set(actions)].slice(0, 4);
}
```

- [ ] **Step 4: Run focused typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit card collection**

```powershell
git add src/bot/createBot.ts
git commit -m "feat: collect final Telegram reason cards"
```

---

### Task 4: Render Final User Report From Cards

**Files:**
- Modify: `src/bot/createBot.ts`

- [ ] **Step 1: Replace normal final report sections**

In `formatUnifiedAddressFinalReport`, replace:

```ts
  const finalDecision = unifiedRisk.finalDecision;
```

with:

```ts
  const finalDecision = finalDisplayDecision(unifiedRisk, input.whereReport);
```

After `const crossChainCorridorLines = whereCrossChainCorridorLines(input.whereReport);`, add:

```ts
  const reasonCards = buildFinalReasonCards(input, unifiedRisk);
  const actionLines = finalActionLines(finalDecision, reasonCards, locale);
  const whyLines = finalWhyLines(reasonCards, locale);
  const contextLines = finalContextLines(reasonCards, locale);
  const extraSignalCount = Math.max(0, reasonCards.length - new Set([...whyLines, ...contextLines]).size);
  const extraSignalLine = extraSignalCount > 0
    ? (locale === "en"
        ? `${extraSignalCount} additional technical signal(s) are available in Admin.`
        : `Ещё ${extraSignalCount} технических сигналов доступны в Admin.`)
    : null;
```

Then replace the `return telegramHtmlMessage([...])` body with:

```ts
  return telegramHtmlMessage([
    bold(locale === "en" ? "Address check — final" : "Проверка адреса — итог"),
    `${bold(locale === "en" ? "Address" : "Адрес")}: ${code(input.address)}`,
    `${bold(locale === "en" ? "Decision" : "Решение")}: ${code(finalDecision)} — ${finalDecisionExplanation(finalDecision, locale)}`,
    riskLine({ subjectAddress: input.address, score: finalScore, level: finalLevel, reasons: [] }, locale === "en" ? "Risk" : "Риск", true, locale),
    section(locale === "en" ? "What to do" : "Что делать", [
      bulletList(actionLines)
    ]),
    section(locale === "en" ? "Why" : "Почему", [
      bulletList(whyLines, locale === "en" ? "No strong risk reason was found." : "Сильная причина риска не найдена.")
    ]),
    contextLines.length > 0 || extraSignalLine ? section(locale === "en" ? "Important context" : "Что важно учесть", [
      bulletList([...contextLines, extraSignalLine].filter((line): line is string => Boolean(line)))
    ]) : null,
    ...betaDiagnosticsLines(clarity),
    input.showBetaDiagnostics === true ? section("Beta/internal", [
      bulletList(betaInternalLines)
    ]) : null,
    limitationLines.length > 0 && input.showBetaDiagnostics === true ? section(locale === "en" ? "Limits" : "Ограничения", [
      bulletList(limitationLines)
    ]) : null,
    crossChainCorridorLines.length > 0 ? section("Cross-chain corridor", [
      bulletList(crossChainCorridorLines)
    ]) : null,
    runtimeMarkerLine(input.runtimeLabel)
  ].filter((line): line is string => Boolean(line)));
```

- [ ] **Step 2: Remove unused local variables**

After replacing the render body, remove variables that are no longer used in normal output:

```ts
  const whereHardEvidenceLines = ...
  const whereContextEvidenceLines = ...
  const whereDecisionContextLines = ...
  const topRiskReasonLines = ...
  const mainReasonLines = ...
  const findingLines = ...
  const scoreExplanationLines = ...
  const dataTrustLines = ...
```

Keep `clarity`, `limitationLines`, and `betaInternalLines` if they are still used behind `showBetaDiagnostics`.

- [ ] **Step 3: Build clarity evidence hints from reason-card text**

Replace the `evidenceHints` input with:

```ts
    evidenceHints: finalReportEvidenceHints(input, reasonCards.map((card) => finalReasonCardText(card, locale)))
```

If `reasonCards` is created after `clarity`, move card creation above `buildRiskClaritySummary`.

- [ ] **Step 4: Run focused bot tests**

Run:

```powershell
npm test -- --run tests/bot/createBot.test.ts
```

Expected: PASS for the new tests. Some older tests may fail because they expected `Findings`, `Why risk`, `Data trust`, or `Beta/internal` in normal output; update those expectations to the new contract.

- [ ] **Step 5: Commit rendering change**

```powershell
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: render final Telegram reason cards"
```

---

### Task 5: Normalize Remaining Raw Reason Text

**Files:**
- Modify: `src/alerts/notificationText.ts`
- Modify: `tests/alerts/notificationText.test.ts`

- [ ] **Step 1: Add failing notification text tests**

Append to `tests/alerts/notificationText.test.ts`:

```ts
  it("normalizes clean CEX and source-boundary caveats", () => {
    expect(normalizeNotificationReason("Clean CEX origin is not fully proven; wallet looks like an operational/liquidity wallet and no hard bad evidence was found.", "ru")).toBe(
      "Чистый CEX-источник не доказан полностью. Кошелёк похож на операционный или ликвидный, жёстких плохих доказательств нет."
    );
    expect(normalizeNotificationReason("The graph stopped before resolving a material unknown source boundary.", "ru")).toBe(
      "Граф остановился на существенной неизвестной границе источника."
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run tests/alerts/notificationText.test.ts
```

Expected: FAIL because the new normalization rules are not implemented.

- [ ] **Step 3: Implement normalization cases**

In `normalizeNotificationReason`, after approval-drain normalization and before HTX percent handling, add:

```ts
  if (normalized.includes("clean cex origin is not fully proven")) {
    return locale === "ru"
      ? "Чистый CEX-источник не доказан полностью. Кошелёк похож на операционный или ликвидный, жёстких плохих доказательств нет."
      : "Clean CEX origin is not fully proven. The wallet looks operational or liquidity-like, and no hard bad evidence was found.";
  }

  if (normalized.includes("material unknown source boundary")) {
    return locale === "ru"
      ? "Граф остановился на существенной неизвестной границе источника."
      : "The graph stopped at a material unknown source boundary.";
  }
```

- [ ] **Step 4: Run notification tests**

Run:

```powershell
npm test -- --run tests/alerts/notificationText.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit normalization**

```powershell
git add src/alerts/notificationText.ts tests/alerts/notificationText.test.ts
git commit -m "feat: normalize final report caveat text"
```

---

### Task 6: Preserve Matrix REVIEW In Unified Risk Tests

**Files:**
- Modify: `tests/risk/unifiedWalletRisk.test.ts`

- [ ] **Step 1: Add a regression test**

Append near existing review/matrix tests:

```ts
  it("preserves matrix REVIEW as final REVIEW for behavior-only prior", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(55, [
        {
          code: "forensic_address_behavior",
          message: "Address shows high-volume transit-like behavior.",
          scoreImpact: 55
        }
      ]),
      whereReport: whereReport(25)
    });

    expect(result.matrixScore.matrixDecision).toBe("REVIEW");
    expect(result.matrixScore.winningRow).toBe("behavior_only_prior");
    expect(result.finalDecision).toBe("REVIEW");
    expect(result.finalDecision).not.toBe("ACCEPTABLE");
  });
```

- [ ] **Step 2: Run the focused risk test**

Run:

```powershell
npm test -- --run tests/risk/unifiedWalletRisk.test.ts
```

Expected: PASS if current code already preserves matrix `REVIEW`. If it fails, inspect `finalDecisionFromMatrix` in `src/risk/unifiedWalletRisk.ts` and make the minimal change so `matrixScore.matrixDecision === "REVIEW"` returns `"REVIEW"`.

- [ ] **Step 3: Commit the regression test**

```powershell
git add tests/risk/unifiedWalletRisk.test.ts src/risk/unifiedWalletRisk.ts
git commit -m "test: preserve matrix review decisions"
```

---

### Task 7: Update Knowledge Docs

**Files:**
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/09-current-decisions.md`

- [ ] **Step 1: Update bot UX docs**

Add this paragraph to `docs/knowledge/08-admin-and-bot-ux.md` after the current Telegram reason-formatting paragraph:

```md
Final Telegram address reports use reason cards. Normal user delivery shows
`Решение`, `Риск`, `Что делать`, `Почему`, and `Что важно учесть`. It must not
show scoring internals such as matrix rows, weighted layer scores, dampeners,
run profiles, or raw layer weights. Those diagnostics remain available in
support/admin output or when beta diagnostics are explicitly enabled.
```

- [ ] **Step 2: Update current decisions**

Add this bullet to `docs/knowledge/09-current-decisions.md` under current behavior:

```md
- Final Telegram address reports are user-facing compliance summaries, not
  scoring dumps. Matrix `REVIEW` displays as `REVIEW`, exact hard evidence is
  deduplicated into one clear reason, and raw scoring diagnostics stay in
  support/admin/debug surfaces.
```

- [ ] **Step 3: Commit docs**

```powershell
git add docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md
git commit -m "docs: record final Telegram reason card contract"
```

---

### Task 8: Full Verification And Final Commit Check

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests**

```powershell
npm test -- --run tests/bot/createBot.test.ts tests/alerts/notificationText.test.ts tests/risk/unifiedWalletRisk.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

```powershell
npm test
```

Expected: PASS. Current baseline before this plan was 138 test files and 2142 tests.

- [ ] **Step 4: Check diff hygiene**

```powershell
git diff --check
git status --short --branch
```

Expected:

- `git diff --check` has no whitespace errors.
- Only intended files are modified.
- Existing unrelated untracked files such as `tmp/` and `docs/superpowers/plans/2026-07-06-where-balance-forming-slice.md` remain untouched unless the user explicitly asks otherwise.

- [ ] **Step 5: Final implementation commit if any changes remain staged separately**

If previous task commits already captured every implementation change, skip this step. If there are remaining intended changes, commit them:

```powershell
git add src/bot/createBot.ts src/alerts/notificationText.ts src/risk/unifiedWalletRisk.ts tests/bot/createBot.test.ts tests/alerts/notificationText.test.ts tests/risk/unifiedWalletRisk.test.ts docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md
git commit -m "feat: simplify final Telegram address reports"
```

---

## Self-Review

- Spec coverage:
  - Reason cards: Tasks 2 and 3.
  - User contract sections: Task 4.
  - Matrix `REVIEW` display: Tasks 1 and 6.
  - Approval-drain dedupe: Tasks 1 and 3.
  - Partial coverage wording: Tasks 1 and 3.
  - Debug/support split: Tasks 1 and 4.
  - Docs: Task 7.
- No empty steps remain.
- No task asks the implementer to infer a missing helper name.
- The formatter does not add new forensic inference; it only maps existing report fields to user text.
- The plan leaves unrelated untracked files untouched.
