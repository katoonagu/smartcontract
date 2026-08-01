# Incoming Alert Message UX Implementation Plan

> Superseded by `docs/superpowers/plans/2026-05-31-telegram-notification-ux-v2.md`. Keep this file as historical incoming-only context; implement the unified plan instead.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make incoming USDT alerts understandable for non-technical users: localized RU/EN text, transaction time, concrete source-policy explanations, no internal data-quality noise.

**Architecture:** Keep scoring unchanged. Improve only the alert presentation layer and the small amount of structured data needed for good copy: transaction time, user locale, source label, and source share per origin path. The formatter should build user-facing reasons from structured report fields, not pass raw internal reason text directly.

**Tech Stack:** TypeScript, Vitest, Telegram HTML formatter utilities, existing `BotLocale` support.

---

## Product Rules

### Language

- Default locale: Russian.
- If user locale is `en`, render the English version.
- Incoming deposit jobs already store `progress_json.locale`; make sure monitor-created jobs set it from the watched wallet owner.

### Header

Russian:

```text
Входящий USDT — 31.05.2026 14:02 MSK
```

English:

```text
Incoming USDT — May 31, 2026 14:02 MSK
```

Use the transaction timestamp from the incoming event. For this implementation, render in `Europe/Moscow` and suffix `MSK`.

### User-Facing Fields

Keep:

```text
Решение / Decision
Риск депозита / Deposit risk
Сумма / Amount
Отправитель / Sender
Кошелек / Watched wallet
Почему / Why
Проверки / Checks
Fast sender risk
Проверено происхождение / Checked origin coverage
Роль отправителя / Sender role
Tx
```

Remove from user alert:

```text
Data quality / Качество данных
```

Reason: data quality is an internal diagnostic. It is useful for debugging but makes the user wonder what to do next.

### Coverage Text

Replace:

```text
Origin coverage: 100%
```

with:

```text
Проверено происхождение: 100% суммы
Checked origin: 100% of amount
```

If coverage is partial:

```text
Проверено происхождение: 77% суммы
Checked origin: 77% of amount
```

### Reason Text Rules

Do not list internal detector names in clean cases.

Bad:

```text
Плохих меток, blacklist, HTX, bridge, DEX и approval-drain не найдено.
```

Good:

```text
Критичных риск-сигналов по депозиту не найдено.
```

HTX/Huobi wording must use "from", not "to".

Russian:

```text
15% проверенной суммы пришло от HTX.
HTX — policy-risk, не доказательство скама.
```

English:

```text
15% of checked funds came from HTX.
HTX is policy risk, not scam proof.
```

Operational wallet wording:

Russian:

```text
Отправитель похож на рабочий ликвидный кошелек.
```

English:

```text
Sender looks like an operational liquidity wallet.
```

Bridge/OFT/service wording:

Russian:

```text
Деньги пришли от bridge/OFT service.
Источник до моста не доказан.
Контракт похож на легитимный сервис, поэтому это не доказанный drain.
```

English:

```text
Funds came from a bridge/OFT service.
Source before the bridge is not proven.
The contract looks like a legitimate service, so this is not proven drain.
```

---

## Files

- Modify: `src/types.ts`
- Modify: `src/storage/repositories.ts`
- Modify: `src/monitor/monitorWorker.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `src/alerts/formatters.ts`
- Modify: `tests/storage/repositories.test.ts`
- Modify: `tests/monitor/monitorWorker.test.ts`
- Modify: `tests/forensics/incomingDepositJob.test.ts`
- Modify: `tests/alerts/formatters.test.ts`

---

## Task 1: Carry User Locale Into Incoming Deposit Jobs

**Files:**
- Modify: `src/types.ts`
- Modify: `src/storage/repositories.ts`
- Modify: `src/monitor/monitorWorker.ts`
- Test: `tests/storage/repositories.test.ts`
- Test: `tests/monitor/monitorWorker.test.ts`

- [ ] **Step 1: Extend `WatchedWallet` with locale**

In `src/types.ts`, add `locale`:

```ts
export type WatchedWallet = {
  id: string;
  telegramUserId: string;
  telegramUsername: string | null;
  address: string;
  createdAt: Date;
  alertMode: WalletAlertMode;
  digestIntervalMinutes: number;
  locale?: BotLocale | null;
};
```

- [ ] **Step 2: Select locale in watched wallet repository queries**

In `src/storage/repositories.ts`, update `listWatchedWallets()` select lists:

```sql
select w.id, w.telegram_user_id, u.username, u.locale, w.address, w.created_at, w.alert_mode, w.digest_interval_minutes
```

Then map:

```ts
locale: row.locale ?? null
```

Also update `mapWatchedWalletFields()` so joined wallet rows can carry locale:

```ts
locale: row.wallet_locale ?? row.locale ?? null
```

- [ ] **Step 3: Add storage test coverage**

In `tests/storage/repositories.test.ts`, update the watched-wallet mock rows and expectations so at least one wallet has:

```ts
locale: "en"
```

Expected:

```ts
expect(wallets[0]).toMatchObject({
  locale: "en"
});
```

- [ ] **Step 4: Pass locale when queuing incoming deposit jobs**

In `src/monitor/monitorWorker.ts`, replace:

```ts
locale: null
```

with:

```ts
locale: wallet.locale ?? null
```

- [ ] **Step 5: Add monitor test coverage**

In `tests/monitor/monitorWorker.test.ts`, update the test that queues incoming deposit checks. Give the watched wallet `locale: "en"` and assert queued job progress contains:

```ts
expect(queueInput).toMatchObject({
  locale: "en"
});
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- tests/storage/repositories.test.ts tests/monitor/monitorWorker.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/types.ts src/storage/repositories.ts src/monitor/monitorWorker.ts tests/storage/repositories.test.ts tests/monitor/monitorWorker.test.ts
git commit -m "feat: carry locale into incoming deposit alerts"
```

---

## Task 2: Add Source Label And Share To Incoming Origin Paths

**Files:**
- Modify: `src/types.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Extend `IncomingDepositOriginPath`**

In `src/types.ts`, add fields:

```ts
sourceLabel?: string | null;
sourceKey?: string | null;
checkedAmountShare?: number;
```

Meaning:

- `sourceLabel`: human-readable source, for example `HTX`, `WhiteBIT`, `LayerZero`, `OFT`, `bridge`.
- `sourceKey`: normalized source key, for example `htx_huobi`, `whitebit`, `bridge_router_dex`.
- `checkedAmountShare`: share of the checked deposit/provenance target represented by this path, `0..1`.

- [ ] **Step 2: Populate fields in `incomingPathFromWhere()`**

In `src/forensics/incomingDepositJob.ts`, add to returned object:

```ts
sourceLabel: path.exposureSourceLabel ?? path.exposureSourceKey ?? null,
sourceKey: path.exposureSourceKey ?? path.sourceExposureKind ?? null,
checkedAmountShare: path.balanceShare ?? 0,
```

Do not change score or decision logic in this task.

- [ ] **Step 3: Add tests**

In `tests/forensics/incomingDepositJob.test.ts`, add assertions to existing HTX/WhiteBIT/context tests:

```ts
expect(result.originPaths[0]).toMatchObject({
  sourceLabel: expect.stringMatching(/HTX|WhiteBIT/),
  checkedAmountShare: expect.any(Number)
});
```

For the minority HTX/WhiteBIT case, assert:

```ts
expect(result.originPaths[0]?.checkedAmountShare).toBeGreaterThan(0);
expect(result.originPaths[0]?.checkedAmountShare).toBeLessThan(0.5);
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/types.ts src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts
git commit -m "feat: expose incoming deposit source share"
```

---

## Task 3: Localize Incoming Deposit Formatter And Add Transaction Time

**Files:**
- Modify: `src/alerts/formatters.ts`
- Test: `tests/alerts/formatters.test.ts`

- [ ] **Step 1: Extend formatter input**

In `src/alerts/formatters.ts`, import `BotLocale`:

```ts
import type { BotLocale, IncomingDepositRiskReport, RiskReport } from "../types";
```

Then extend `formatIncomingDepositRiskAlert()` input:

```ts
export function formatIncomingDepositRiskAlert(input: {
  jobId: string;
  amount: string;
  watchedWallet: string;
  sender: string;
  txHash: string;
  timestamp?: Date | null;
  locale?: BotLocale | null;
  report: IncomingDepositRiskReport;
}): IncomingDepositRiskAlertMessage {
```

- [ ] **Step 2: Add date formatter**

Add helper:

```ts
function formatIncomingAlertTime(value: Date | null | undefined, locale: BotLocale): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  const dateLocale = locale === "en" ? "en-US" : "ru-RU";
  const text = new Intl.DateTimeFormat(dateLocale, {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(value);
  return `${text} MSK`;
}
```

For `en-US`, acceptable output is browser/Node Intl dependent (`05/31/2026, 14:02 MSK`). Tests should assert the presence of `2026`, `14:02`, and `MSK`, not exact punctuation.

- [ ] **Step 3: Add role label helper**

Add helper:

```ts
function incomingSenderRoleText(role: string | null, locale: BotLocale): string {
  const normalized = role ?? "unknown";
  if (locale === "en") {
    switch (normalized) {
      case "clean_cex_funded_wallet": return "clean CEX-funded wallet";
      case "operational_liquidity_wallet": return "operational liquidity wallet";
      case "fresh_one_shot_wallet": return "fresh one-shot wallet";
      case "known_service": return "known service";
      case "service_hot_wallet": return "service hot wallet";
      default: return "unknown";
    }
  }
  switch (normalized) {
    case "clean_cex_funded_wallet": return "кошелек с источником от чистой CEX";
    case "operational_liquidity_wallet": return "рабочий ликвидный кошелек";
    case "fresh_one_shot_wallet": return "новый одноразовый кошелек";
    case "known_service": return "известный сервис";
    case "service_hot_wallet": return "горячий кошелек сервиса";
    default: return "не определена";
  }
}
```

- [ ] **Step 4: Add user-facing reason builder**

Replace direct `formatIncomingDepositReasons(input.report)` usage in incoming deposit alerts with a structured reason builder:

```ts
function incomingDepositReasonLines(report: IncomingDepositRiskReport, locale: BotLocale): string[] {
  const htxPath = report.originPaths.find((path) => path.stoppedReason === "htx_huobi_reached");
  const bridgePath = report.originPaths.find((path) => path.stoppedReason === "bridge_router_dex_reached");
  const hasLegitimateServiceVerdict = report.contractVerdicts.some((verdict) =>
    verdict.verdict === "legitimate_service" && verdict.confidence >= 0.8
  );
  const roleText = incomingSenderRoleText(report.senderRole, locale);

  if (htxPath) {
    const source = htxPath.sourceLabel ?? "HTX";
    const share = formatPercent(htxPath.checkedAmountShare ?? report.originCoverage);
    return locale === "en"
      ? [
          `${share} of checked funds came from ${source}.`,
          `${source} is policy risk, not scam proof.`,
          `Sender looks like an ${roleText}.`
        ]
      : [
          `${share} проверенной суммы пришло от ${source}.`,
          `${source} — policy-risk, не доказательство скама.`,
          `Отправитель похож на ${roleText}.`
        ];
  }

  if (bridgePath) {
    const source = bridgePath.sourceLabel ?? (locale === "en" ? "bridge/service boundary" : "bridge/service");
    const lines = locale === "en"
      ? [
          `Funds came from ${source}.`,
          "Source before the bridge is not proven."
        ]
      : [
          `Деньги пришли от ${source}.`,
          "Источник до моста не доказан."
        ];
    if (hasLegitimateServiceVerdict) {
      lines.push(locale === "en"
        ? "The contract looks like a legitimate service, so this is not proven drain."
        : "Контракт похож на легитимный сервис, поэтому это не доказанный drain.");
    }
    return lines;
  }

  if (report.senderRole === "operational_liquidity_wallet" || report.senderRole === "clean_cex_funded_wallet") {
    return locale === "en"
      ? [
          `Sender looks like an ${roleText}.`,
          "No critical deposit risk signals found.",
          `Checked origin: ${formatPercent(report.originCoverage)} of amount.`
        ]
      : [
          `Отправитель похож на ${roleText}.`,
          "Критичных риск-сигналов по депозиту не найдено.",
          `Проверено происхождение: ${formatPercent(report.originCoverage)} суммы.`
        ];
  }

  return report.reasons.slice(0, MAX_REASON_COUNT);
}
```

Important: keep `report.reasons` as fallback for rare cases, but primary common cases should use the structured copy above.

- [ ] **Step 5: Update message layout**

In `formatIncomingDepositRiskAlert()`, use locale:

```ts
const locale = input.locale ?? "ru";
const title = locale === "en" ? "Incoming USDT" : "Входящий USDT";
const txTime = formatIncomingAlertTime(input.timestamp, locale);
```

Header:

```ts
bold(txTime ? `${title} — ${txTime}` : title)
```

Labels:

```ts
const labels = locale === "en"
  ? {
      decision: "Decision",
      depositRisk: "Deposit risk",
      amount: "Amount",
      watchedWallet: "Watched wallet",
      sender: "Sender",
      why: "Why",
      checks: "Checks",
      fastSenderRisk: "Fast sender risk",
      checkedOrigin: "Checked origin",
      senderRole: "Sender role",
      tx: "Tx"
    }
  : {
      decision: "Решение",
      depositRisk: "Риск депозита",
      amount: "Сумма",
      watchedWallet: "Кошелек",
      sender: "Отправитель",
      why: "Почему",
      checks: "Проверки",
      fastSenderRisk: "Fast sender risk",
      checkedOrigin: "Проверено происхождение",
      senderRole: "Роль отправителя",
      tx: "Tx"
    };
```

Checks section must not include data quality:

```ts
section(labels.checks, [
  `${bold(labels.fastSenderRisk)}: ${formatFastSenderRisk(input.report)}`,
  `${bold(labels.checkedOrigin)}: ${code(`${formatPercent(input.report.originCoverage)} ${locale === "en" ? "of amount" : "суммы"}`)}`,
  `${bold(labels.senderRole)}: ${code(incomingSenderRoleText(input.report.senderRole, locale))}`
])
```

- [ ] **Step 6: Update formatter tests**

In `tests/alerts/formatters.test.ts`, update existing incoming deposit tests:

1. Russian default:

```ts
const message = formatIncomingDepositRiskAlert({
  jobId: "job-123",
  amount: "384064.001319",
  watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
  sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
  txHash: "48d33...",
  timestamp: new Date("2026-05-31T11:02:00.000Z"),
  report
});

expect(message.text).toContain("<b>Входящий USDT");
expect(message.text).toContain("14:02");
expect(message.text).toContain("MSK");
expect(message.text).toContain("<b>Решение</b>: <code>DECLINE</code>");
expect(message.text).toContain("<b>Риск депозита</b>");
expect(message.text).toContain("<b>Проверено происхождение</b>: <code>76% суммы</code>");
expect(message.text).not.toContain("Data quality");
expect(message.text).not.toContain("Качество данных");
```

2. English locale:

```ts
const message = formatIncomingDepositRiskAlert({
  ...input,
  locale: "en",
  timestamp: new Date("2026-05-31T11:02:00.000Z")
});

expect(message.text).toContain("<b>Incoming USDT");
expect(message.text).toContain("14:02");
expect(message.text).toContain("MSK");
expect(message.text).toContain("<b>Decision</b>");
expect(message.text).toContain("<b>Checked origin</b>: <code>76% of amount</code>");
```

3. HTX copy:

```ts
expect(message.text).toContain("15% проверенной суммы пришло от HTX");
expect(message.text).not.toContain("дошло до HTX");
```

4. Clean copy:

```ts
expect(message.text).toContain("Критичных риск-сигналов по депозиту не найдено.");
expect(message.text).not.toContain("blacklist, HTX, bridge, DEX");
```

- [ ] **Step 7: Run formatter tests**

Run:

```bash
npm test -- tests/alerts/formatters.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/alerts/formatters.ts tests/alerts/formatters.test.ts
git commit -m "feat: localize incoming deposit alert copy"
```

---

## Task 4: Pass Timestamp And Locale Into Formatter From Worker

**Files:**
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `src/index.ts` if type inference requires explicit callback changes
- Test: `tests/forensics/incomingDepositJob.test.ts`

- [ ] **Step 1: Extend worker formatter dependency type**

In `src/forensics/incomingDepositJob.ts`, update `formatIncomingDepositRiskAlert` dependency input:

```ts
formatIncomingDepositRiskAlert(input: {
  jobId: string;
  amount: string;
  watchedWallet: string;
  sender: string;
  txHash: string;
  timestamp?: Date | null;
  locale?: BotLocale | null;
  report: IncomingDepositRiskReport;
}): { text: string; parseMode: "HTML"; replyMarkup?: unknown };
```

Import `BotLocale` from `../types`.

- [ ] **Step 2: Pass timestamp and locale in `runSingleIncomingDepositJobCycle()`**

Before calling formatter:

```ts
const depositTimestamp = new Date(timestampText);
const locale = stringField(job.progressJson.locale) === "en" ? "en" : "ru";
```

Then:

```ts
const message = deps.formatIncomingDepositRiskAlert({
  jobId: job.id,
  amount: stringField(job.progressJson.amount) ?? amountRaw,
  watchedWallet,
  sender,
  txHash: depositTxHash,
  timestamp: depositTimestamp,
  locale,
  report
});
```

Use the same `depositTimestamp` for `buildReport()` to avoid parsing twice.

- [ ] **Step 3: Update incoming job tests**

In `tests/forensics/incomingDepositJob.test.ts`, in the final alert test, make the formatter spy assert:

```ts
expect(formatInput).toMatchObject({
  timestamp: new Date(validProgressJson.timestamp),
  locale: "ru"
});
```

Add a second case with:

```ts
progressJson: { ...validProgressJson, locale: "en" }
```

Expected formatter input:

```ts
expect(formatInput.locale).toBe("en");
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- tests/forensics/incomingDepositJob.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/forensics/incomingDepositJob.ts tests/forensics/incomingDepositJob.test.ts src/index.ts
git commit -m "feat: pass incoming alert time and locale"
```

---

## Task 5: Final Verification And Smoke

- [ ] **Step 1: Run focused tests**

```bash
npm test -- tests/alerts/formatters.test.ts tests/forensics/incomingDepositJob.test.ts tests/monitor/monitorWorker.test.ts tests/storage/repositories.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Manual message smoke**

Use a test or local formatter call to render three examples:

1. Clean ACCEPTABLE.
2. ACCEPTABLE with HTX share.
3. DECLINE by bridge/service boundary.

Confirm:

- Russian default is used without explicit locale.
- English is used with `locale: "en"`.
- Header contains transaction time and `MSK`.
- There is no `Data quality` / `Качество данных`.
- HTX sentence says `пришло от HTX`, not `дошло до HTX`.
- Clean case says `Критичных риск-сигналов по депозиту не найдено.`
- Operational role says `рабочий ликвидный кошелек`.

- [ ] **Step 5: Commit verification updates if needed**

Only if tests or docs changed:

```bash
git add src tests docs
git commit -m "test: cover incoming alert message ux"
```

---

## Final PR Review Checklist

- [ ] Incoming deposit alert is RU by default.
- [ ] Incoming deposit alert is EN when job locale is `en`.
- [ ] Transaction time is shown in the header.
- [ ] `Data quality` is hidden from user-facing alert.
- [ ] Coverage text explains amount coverage: `Проверено происхождение: X% суммы`.
- [ ] HTX/Huobi wording uses "came from / пришло от".
- [ ] Clean reasons use a generic critical-risk sentence, not a list of detector names.
- [ ] Operational liquidity wallet is rendered as `рабочий ликвидный кошелек`.
- [ ] Existing keyboard actions still work.
- [ ] Tests and typecheck pass.
