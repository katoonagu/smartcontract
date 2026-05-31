# Telegram Notification UX v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the main Telegram notification UX so non-technical exchange operators get clear RU/EN decisions, risk, reasons, checked-origin context, and approval safety wording without raw internal diagnostics.

**Architecture:** Keep scoring and forensic analysis unchanged. Add a small presentation layer for localized labels, MSK timestamps, reason normalization, and compact report summaries, then wire existing incoming, manual check, tx, approval, where-is-money, and deep report formatters through it. The older `2026-05-31-incoming-alert-message-ux.md` plan is absorbed here as the incoming-deposit task.

**Tech Stack:** TypeScript, Vitest, existing Telegram HTML helpers, existing `BotLocale`, existing forensic job/result types.

---

## Source Documents

- Main design spec: `docs/superpowers/specs/2026-05-31-telegram-notification-ux-v2-design.md`
- Absorbed incoming-only plan: `docs/superpowers/plans/2026-05-31-incoming-alert-message-ux.md`

This file is the single implementation plan for notification UX work. Treat the incoming-only plan as historical context.

## Product Invariants

- Customer-facing final decisions are only `ACCEPTABLE` or `DECLINE`.
- Temporary states use `Статус` / `Status`, not final `REVIEW`.
- Customer-facing messages do not show `Data quality`.
- Customer-facing messages do not show raw `manual review required`.
- HTX/Huobi wording says funds came from the source: `пришло от HTX`, not `дошло до HTX`.
- Approval messages do not call something proven drain unless exact drain evidence exists.
- Secondary bot copy follows info-style: one clear action per sentence, concrete wording, no filler, no mixed Russian/English except product terms such as `USDT`, `TRON`, `approval`, `tx`.
- Admin messages may stay more technical, but reusable labels should be consistent.

## File Structure

### Create

- `src/alerts/notificationTime.ts`
  - Responsible for Telegram-friendly MSK time formatting.

- `src/alerts/notificationText.ts`
  - Responsible for localized labels, role names, risk object labels, policy phrases, and normalized user-facing reason text.

- `src/alerts/notificationSummaries.ts`
  - Responsible for converting existing risk/forensic reports into compact user-facing summary lines without changing scores.

### Modify

- `src/alerts/formatters.ts`
  - Use new helpers for incoming, approval found, approval pending, and approval context result.

- `src/bot/createBot.ts`
  - Use new compact format for `/check address`, `/check tx`, where-is-money, and deep forensic first blocks.

- `src/forensics/transactionOriginCheck.ts`
  - Expose tx display context extracted from the official TRC20 USDT transfer seed.

- `src/types.ts`
  - Ensure wallet/user locale and optional tx display fields can be passed where needed.

- `src/storage/repositories.ts`
  - Carry `users.locale` into watched wallet rows used by monitor jobs.

- `src/monitor/monitorWorker.ts`
  - Queue incoming deposit jobs with the wallet owner's locale and pass timestamps to customer formatter fallbacks.

- `src/bot/messages.ts`
  - Reuse shared wording for dashboard/safety approval summaries and clean up secondary bot copy: home/help/settings/prompts/errors/status messages.

### Test

- `tests/alerts/notificationTime.test.ts`
- `tests/alerts/notificationText.test.ts`
- `tests/alerts/formatters.test.ts`
- `tests/bot/createBot.test.ts`
- `tests/storage/repositories.test.ts`
- `tests/monitor/monitorWorker.test.ts`

---

## Task 1: Shared Notification Helpers

**Files:**
- Create: `src/alerts/notificationTime.ts`
- Create: `src/alerts/notificationText.ts`
- Test: `tests/alerts/notificationTime.test.ts`
- Test: `tests/alerts/notificationText.test.ts`

- [ ] **Step 1: Write failing MSK time tests**

Create `tests/alerts/notificationTime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatNotificationMskTime } from "../../src/alerts/notificationTime";

describe("formatNotificationMskTime", () => {
  it("formats Russian MSK notification time", () => {
    expect(formatNotificationMskTime(new Date("2026-05-31T11:02:00.000Z"), "ru")).toBe("31.05.2026 14:02 MSK");
  });

  it("formats English MSK notification time", () => {
    expect(formatNotificationMskTime(new Date("2026-05-31T11:02:00.000Z"), "en")).toBe("May 31, 2026 14:02 MSK");
  });

  it("returns null when event time is unavailable", () => {
    expect(formatNotificationMskTime(null, "ru")).toBeNull();
  });
});
```

- [ ] **Step 2: Run time helper test to verify failure**

Run:

```bash
npm test -- tests/alerts/notificationTime.test.ts
```

Expected: FAIL because `src/alerts/notificationTime.ts` does not exist.

- [ ] **Step 3: Implement MSK time helper**

Create `src/alerts/notificationTime.ts`:

```ts
import type { BotLocale } from "../types";

const MSK_TIME_ZONE = "Europe/Moscow";

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatNotificationMskTime(value: Date | null | undefined, locale: BotLocale): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MSK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(value);

  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const day = byType.get("day") ?? pad2(value.getUTCDate());
  const month = byType.get("month") ?? pad2(value.getUTCMonth() + 1);
  const year = byType.get("year") ?? String(value.getUTCFullYear());
  const hour = byType.get("hour") ?? pad2(value.getUTCHours());
  const minute = byType.get("minute") ?? pad2(value.getUTCMinutes());

  if (locale === "en") {
    const monthName = new Intl.DateTimeFormat("en-US", { timeZone: MSK_TIME_ZONE, month: "long" }).format(value);
    return `${monthName} ${Number(day)}, ${year} ${hour}:${minute} MSK`;
  }

  return `${day}.${month}.${year} ${hour}:${minute} MSK`;
}
```

- [ ] **Step 4: Write failing notification text tests**

Create `tests/alerts/notificationText.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  checkedOriginLabel,
  decisionLabel,
  normalizeNotificationReason,
  riskObjectLabel,
  senderRoleText
} from "../../src/alerts/notificationText";

describe("notification text helpers", () => {
  it("localizes decision and risk object labels", () => {
    expect(decisionLabel("ru")).toBe("Решение");
    expect(decisionLabel("en")).toBe("Decision");
    expect(riskObjectLabel("deposit", "ru")).toBe("Риск депозита");
    expect(riskObjectLabel("tx", "en")).toBe("Tx risk");
  });

  it("formats checked-origin coverage for users", () => {
    expect(checkedOriginLabel(1, "ru")).toBe("Проверено происхождение: 100% суммы");
    expect(checkedOriginLabel(0.76, "en")).toBe("Checked origin: 76% of amount");
  });

  it("translates operational sender role", () => {
    expect(senderRoleText("operational_liquidity_wallet", "ru")).toBe("рабочий ликвидный кошелёк");
    expect(senderRoleText("operational_liquidity_wallet", "en")).toBe("operational liquidity wallet");
  });

  it("normalizes common internal reason text", () => {
    expect(normalizeNotificationReason("clean_source_not_fully_proven", "ru")).toBe("Чистый источник денег доказан не полностью, поэтому риск не нулевой.");
    expect(normalizeNotificationReason("15% checked funds came from HTX", "ru")).toBe("15% проверенной суммы пришло от HTX.");
    expect(normalizeNotificationReason("manual review required", "en")).toBe("Additional context was found, but no exact bad evidence was proven.");
  });
});
```

- [ ] **Step 5: Run text helper test to verify failure**

Run:

```bash
npm test -- tests/alerts/notificationText.test.ts
```

Expected: FAIL because `notificationText.ts` does not exist.

- [ ] **Step 6: Implement notification text helper**

Create `src/alerts/notificationText.ts`:

```ts
import type { BotLocale, ExchangeDecision, UserExchangeDecision } from "../types";

export type RiskObjectKind = "deposit" | "address" | "tx" | "approval" | "contract" | "where_is_money" | "deep";

export function decisionLabel(locale: BotLocale): string {
  return locale === "en" ? "Decision" : "Решение";
}

export function statusLabel(locale: BotLocale): string {
  return locale === "en" ? "Status" : "Статус";
}

export function whyLabel(locale: BotLocale): string {
  return locale === "en" ? "Why" : "Почему";
}

export function checksLabel(locale: BotLocale): string {
  return locale === "en" ? "Checks" : "Проверки";
}

export function riskObjectLabel(kind: RiskObjectKind, locale: BotLocale): string {
  if (locale === "en") {
    const labels: Record<RiskObjectKind, string> = {
      deposit: "Deposit risk",
      address: "Address risk",
      tx: "Tx risk",
      approval: "Approval risk",
      contract: "Contract risk",
      where_is_money: "Risk",
      deep: "Address risk"
    };
    return labels[kind];
  }

  const labels: Record<RiskObjectKind, string> = {
    deposit: "Риск депозита",
    address: "Риск адреса",
    tx: "Риск tx",
    approval: "Риск approval",
    contract: "Риск контракта",
    where_is_money: "Риск",
    deep: "Риск адреса"
  };
  return labels[kind];
}

export function checkedOriginLabel(coverageRatio: number | null | undefined, locale: BotLocale): string {
  const safeRatio = Number.isFinite(coverageRatio) ? Math.max(0, Math.min(1, coverageRatio ?? 0)) : 0;
  const percent = Math.round(safeRatio * 100);
  return locale === "en"
    ? `Checked origin: ${percent}% of amount`
    : `Проверено происхождение: ${percent}% суммы`;
}

export function senderRoleText(role: string | null | undefined, locale: BotLocale): string {
  if (!role) return locale === "en" ? "unknown" : "неизвестно";
  const normalized = role.toLowerCase();
  if (normalized.includes("operational") || normalized.includes("liquidity") || normalized.includes("collector")) {
    return locale === "en" ? "operational liquidity wallet" : "рабочий ликвидный кошелёк";
  }
  if (normalized.includes("clean_cex")) return locale === "en" ? "CEX-funded wallet" : "кошелёк с CEX-источником";
  if (normalized.includes("fresh") || normalized.includes("one_shot")) return locale === "en" ? "fresh one-time wallet" : "новый одноразовый кошелёк";
  return role;
}

export function displayDecision(value: ExchangeDecision | UserExchangeDecision | string): "ACCEPTABLE" | "DECLINE" {
  return value === "ACCEPTABLE" ? "ACCEPTABLE" : "DECLINE";
}

export function normalizeNotificationReason(message: string, locale: BotLocale): string {
  const lower = message.toLowerCase();

  if (message === "clean_source_not_fully_proven" || lower.includes("clean source") && lower.includes("not") && lower.includes("proven")) {
    return locale === "en"
      ? "Clean source is not fully proven, so risk is not zero."
      : "Чистый источник денег доказан не полностью, поэтому риск не нулевой.";
  }

  const htxMatch = message.match(/(\d+(?:\.\d+)?)%\s+(?:checked\s+funds|of checked funds|проверенной суммы).*?(?:HTX|Huobi)/i);
  if (htxMatch) {
    const percent = htxMatch[1];
    return locale === "en"
      ? `${percent}% of checked funds came from HTX.`
      : `${percent}% проверенной суммы пришло от HTX.`;
  }

  if (lower.includes("manual review required")) {
    return locale === "en"
      ? "Additional context was found, but no exact bad evidence was proven."
      : "Найден дополнительный контекст, но точное плохое доказательство не подтверждено.";
  }

  if (lower.includes("no obvious risk signals") || lower.includes("no critical risk")) {
    return locale === "en"
      ? "No critical risk signals were found."
      : "Критичных риск-сигналов не найдено.";
  }

  return message;
}
```

- [ ] **Step 7: Run helper tests**

Run:

```bash
npm test -- tests/alerts/notificationTime.test.ts tests/alerts/notificationText.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit shared helpers**

Run:

```bash
git add src/alerts/notificationTime.ts src/alerts/notificationText.ts tests/alerts/notificationTime.test.ts tests/alerts/notificationText.test.ts
git commit -m "feat: add telegram notification text helpers"
```

Expected: commit created.

---

## Task 2: Incoming Deposit Alert UX

**Files:**
- Modify: `src/types.ts`
- Modify: `src/storage/repositories.ts`
- Modify: `src/monitor/monitorWorker.ts`
- Modify: `src/forensics/incomingDepositJob.ts`
- Modify: `src/alerts/formatters.ts`
- Test: `tests/storage/repositories.test.ts`
- Test: `tests/monitor/monitorWorker.test.ts`
- Test: `tests/forensics/incomingDepositJob.test.ts`
- Test: `tests/alerts/formatters.test.ts`

This task absorbs `docs/superpowers/plans/2026-05-31-incoming-alert-message-ux.md`.

- [ ] **Step 1: Extend watched wallet type with locale**

In `src/types.ts`, extend `WatchedWallet`:

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

- [ ] **Step 2: Carry locale from repository queries**

In `src/storage/repositories.ts`, update watched wallet select lists so they include `u.locale`.

Map rows as:

```ts
locale: normalizeNullableBotLocale(row.locale ?? row.wallet_locale ?? null)
```

If `normalizeNullableBotLocale` does not exist, add this helper near other row mappers:

```ts
function normalizeNullableBotLocale(value: unknown): BotLocale | null {
  return value === "en" || value === "ru" ? value : null;
}
```

- [ ] **Step 3: Add storage tests for wallet locale**

In `tests/storage/repositories.test.ts`, update the watched-wallet test fixture so at least one returned wallet has `locale: "en"`.

Expected assertion:

```ts
expect(wallets[0]).toMatchObject({
  address: "TWallet111111111111111111111111111111",
  locale: "en"
});
```

- [ ] **Step 4: Queue incoming deposit jobs with locale**

In `src/monitor/monitorWorker.ts`, replace:

```ts
locale: null
```

with:

```ts
locale: wallet.locale ?? null
```

- [ ] **Step 5: Add monitor worker test**

In `tests/monitor/monitorWorker.test.ts`, add or update the incoming job queue assertion:

```ts
expect(queueIncomingDepositJob).toHaveBeenCalledWith(expect.objectContaining({
  locale: "en"
}));
```

- [ ] **Step 6: Pass timestamp and locale into incoming formatter dependency**

In `src/forensics/incomingDepositJob.ts`, extend the formatter dependency input:

```ts
formatIncomingDepositRiskAlert(input: {
  jobId: string;
  amount: string;
  watchedWallet: string;
  sender: string;
  txHash: string;
  timestamp?: Date | null;
  locale?: BotLocale;
  report: IncomingDepositRiskReport;
}): TelegramAlertMessage;
```

When calling it, pass:

```ts
timestamp,
locale: normalizeBotLocale(job.progressJson.locale)
```

- [ ] **Step 7: Rewrite incoming deposit formatter output**

In `src/alerts/formatters.ts`, update `formatIncomingDepositRiskAlert` to:

- accept `timestamp?: Date | null`;
- accept `locale?: BotLocale`;
- render RU by default;
- remove `Data quality`;
- replace `Origin coverage` with `Проверено происхождение: X% суммы`;
- normalize reasons through `normalizeNotificationReason`;
- use `senderRoleText`.

Core implementation shape:

```ts
const locale = input.locale ?? DEFAULT_BOT_LOCALE;
const eventTime = formatNotificationMskTime(input.timestamp, locale);
const title = locale === "en"
  ? `Incoming USDT${eventTime ? ` — ${eventTime}` : ""}`
  : `Входящий USDT${eventTime ? ` — ${eventTime}` : ""}`;
const reasons = input.report.reasons.length > 0
  ? input.report.reasons.slice(0, MAX_REASON_COUNT).map((reason) => normalizeNotificationReason(reason, locale))
  : [locale === "en" ? "No critical deposit-risk signals were found." : "Критичных риск-сигналов по депозиту не найдено."];
```

Expected checks block:

```ts
section(checksLabel(locale), [
  `${bold("Fast sender check")}: ${formatFastSenderRisk(input.report)}`,
  checkedOriginLabel(input.report.originCoverage, locale),
  `${bold(locale === "en" ? "Sender role" : "Роль отправителя")}: ${code(senderRoleText(input.report.senderRole, locale))}`
])
```

- [ ] **Step 8: Update incoming formatter tests**

In `tests/alerts/formatters.test.ts`, update the final incoming deposit risk tests:

Expected Russian default:

```ts
expect(message.text).toContain("<b>Входящий USDT");
expect(message.text).toContain("<b>Решение</b>: <code>DECLINE</code>");
expect(message.text).toContain("<b>Риск депозита</b>: <code>68/100</code>");
expect(message.text).toContain("Проверено происхождение: 76% суммы");
expect(message.text).not.toContain("Data quality");
```

Expected English:

```ts
const message = formatIncomingDepositRiskAlert({ ...baseInput, locale: "en" });
expect(message.text).toContain("<b>Incoming USDT");
expect(message.text).toContain("Checked origin: 76% of amount");
```

- [ ] **Step 9: Run incoming task tests**

Run:

```bash
npm test -- tests/storage/repositories.test.ts tests/monitor/monitorWorker.test.ts tests/forensics/incomingDepositJob.test.ts tests/alerts/formatters.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit incoming alert UX**

Run:

```bash
git add src/types.ts src/storage/repositories.ts src/monitor/monitorWorker.ts src/forensics/incomingDepositJob.ts src/alerts/formatters.ts tests/storage/repositories.test.ts tests/monitor/monitorWorker.test.ts tests/forensics/incomingDepositJob.test.ts tests/alerts/formatters.test.ts
git commit -m "feat: improve incoming deposit alert ux"
```

Expected: commit created.

---

## Task 3: Manual Tx Check UX

**Files:**
- Modify: `src/forensics/transactionOriginCheck.ts`
- Modify: `src/bot/createBot.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add tx display context type and extractor test**

In `tests/bot/createBot.test.ts`, add a tx-mode test that sends `/check <txHash>` and expects:

```ts
expect(sentText).toContain("Проверка tx");
expect(sentText).toContain("Сумма");
expect(sentText).toContain("От");
expect(sentText).toContain("Кому");
expect(sentText).toContain("Происхождение суммы");
expect(sentText).not.toContain("Manual tx subject");
```

- [ ] **Step 2: Expose official USDT transfer display context**

In `src/forensics/transactionOriginCheck.ts`, add:

```ts
export type TransactionOriginDisplayContext = {
  txHash: string;
  timestamp: Date | null;
  amountRaw: string | null;
  fromAddress: string | null;
  toAddress: string | null;
};

export function extractUsdtTransferDisplayContext(txHash: string, raw: unknown): TransactionOriginDisplayContext | null {
  const seed = extractUsdtTransferSeedFromTransaction(txHash, raw);
  if (!seed) return null;
  return {
    txHash: seed.txHash,
    timestamp: seed.timestamp ? new Date(seed.timestamp) : null,
    amountRaw: seed.amountRaw,
    fromAddress: seed.fromAddress,
    toAddress: seed.toAddress
  };
}
```

- [ ] **Step 3: Pass tx display context to manual formatter**

In `src/bot/createBot.ts`, import `extractUsdtTransferDisplayContext` and extend `formatManualReport` options:

```ts
transactionDisplay?: TransactionOriginDisplayContext | null;
```

Inside tx branch, after loading transaction info:

```ts
const transactionDisplay = extractUsdtTransferDisplayContext(classified.value, await getTransactionInfo());
```

Pass it:

```ts
formatManualReport(result, {
  whereIsMoneyJob,
  transactionOriginRecipientAddress: whereIsMoneyJob?.subjectAddress ?? null,
  transactionDisplay,
  runtimeLabel: options.runtimeLabel,
  locale
})
```

- [ ] **Step 4: Render tx-centric first block**

In `formatManualReport`, if `options.transactionDisplay` exists, render the tx block first:

```ts
const txTime = formatNotificationMskTime(options.transactionDisplay.timestamp, locale);
const txTitle = locale === "en"
  ? `Tx check${txTime ? ` — ${txTime}` : ""}`
  : `Проверка tx${txTime ? ` — ${txTime}` : ""}`;
```

For tx mode, include:

```ts
bold(txTitle),
`${bold(decisionLabel(locale))}: ${code(displayDecision(result.report.level === "CRITICAL" || result.report.level === "HIGH" ? "DECLINE" : "ACCEPTABLE"))}`,
riskLine(result.report, riskObjectLabel("tx", locale), true, locale),
`${bold(locale === "en" ? "Amount" : "Сумма")}: ${code(options.transactionDisplay.amountRaw ? formatRawUsdt(options.transactionDisplay.amountRaw) : "unknown")}`,
`${bold(locale === "en" ? "From" : "От")}: ${code(options.transactionDisplay.fromAddress ?? result.subjectAddress)}`,
`${bold(locale === "en" ? "To" : "Кому")}: ${code(options.transactionDisplay.toAddress ?? "unknown")}`,
section(whyLabel(locale), [bulletList(userFacingLines(locale, meaningLines(result, { deepQueued })))])
```

Keep queued where/deep lines under `Проверки`.

- [ ] **Step 5: Run tx UX tests**

Run:

```bash
npm test -- tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit tx UX**

Run:

```bash
git add src/forensics/transactionOriginCheck.ts src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: make manual tx checks tx-centric"
```

Expected: commit created.

---

## Task 4: Manual Address Check UX

**Files:**
- Modify: `src/bot/createBot.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add address-check preliminary test**

In `tests/bot/createBot.test.ts`, add a `/check <address>` test that expects:

```ts
expect(sentText).toContain("Проверка адреса");
expect(sentText).toContain("Риск адреса");
expect(sentText).toContain("Почему");
expect(sentText).toContain("Дальше");
expect(sentText).toContain("Откуда деньги");
expect(sentText).toContain("Deep research");
expect(sentText).not.toContain("Key signals");
expect(sentText).not.toContain("Limits");
```

- [ ] **Step 2: Add compact address formatter branch**

In `formatManualReport`, when `options.transactionDisplay` is absent, render compact address output:

```ts
const addressTitle = locale === "en"
  ? (deepQueued ? "Address check — preliminary" : "Address check")
  : (deepQueued ? "Проверка адреса — предварительно" : "Проверка адреса");
```

Use object-specific risk label:

```ts
riskLine(result.report, riskObjectLabel("address", locale), true, locale)
```

Use sections:

```ts
section(whyLabel(locale), [
  bulletList(userFacingLines(locale, meaningLines(result, { deepQueued })).slice(0, 4))
]),
deepQueued ? section(locale === "en" ? "Next" : "Дальше", [
  options.whereIsMoneyJob ? `${locale === "en" ? "Where is money" : "Откуда деньги"}: ${code("запущено")}` : null,
  options.deepJob ? `Deep research: ${code(locale === "en" ? "queued" : "запущен")}` : null
].filter((line): line is string => Boolean(line))) : null
```

- [ ] **Step 3: Keep exact hard-evidence block when present**

If `stablecoinRestrictionEvidenceLines(result).length > 0`, keep a compact warning:

```ts
section(locale === "en" ? "Hard evidence" : "Точное доказательство", [
  bulletList(stablecoinRestrictionEvidenceLines(result).slice(0, 3))
])
```

- [ ] **Step 4: Run address UX tests**

Run:

```bash
npm test -- tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit address UX**

Run:

```bash
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: simplify manual address check messages"
```

Expected: commit created.

---

## Task 5: Approval Notification UX

**Files:**
- Modify: `src/alerts/formatters.ts`
- Modify: `src/approvals/approvalWorker.ts`
- Test: `tests/alerts/formatters.test.ts`

- [ ] **Step 1: Add approval formatter tests for Russian default**

In `tests/alerts/formatters.test.ts`, update approval tests to expect:

```ts
expect(message.text).toContain("USDT approval");
expect(message.text).toContain("<b>Решение</b>");
expect(message.text).toContain("<b>Риск approval</b>");
expect(message.text).toContain("Кому разрешено списание");
expect(message.text).toContain("Это не доказанная кража");
expect(message.text).not.toContain("Review/revoke");
```

- [ ] **Step 2: Add approval pending tests**

Add expected pending context text:

```ts
expect(message.text).toContain("Подписан smart contract");
expect(message.text).toContain("Статус");
expect(message.text).toContain("ждём контекст операции");
expect(message.text).toContain("Финальный результат придёт отдельным сообщением");
```

- [ ] **Step 3: Add approval context result tests**

For linked route:

```ts
expect(message.text).toContain("Контекст approval найден");
expect(message.text).toContain("Approval связан с bridge/swap-операцией");
expect(message.text).toContain("Списания USDT как drain не доказаны");
```

For no route:

```ts
expect(message.text).toContain("Контекст approval не найден");
expect(message.text).toContain("кошелёк небезопасен для работы");
```

- [ ] **Step 4: Pass locale and timestamps into approval formatters**

In `src/alerts/formatters.ts`, extend:

```ts
formatUserApprovalAlert(input: { locale?: BotLocale; ... })
formatUserApprovalPendingAlert(input: { locale?: BotLocale; ... })
formatUserApprovalContextResultAlert(input: { locale?: BotLocale; ... })
```

In `src/approvals/approvalWorker.ts`, pass:

```ts
locale: wallet.locale ?? DEFAULT_BOT_LOCALE
```

If `wallet.locale` is not available in approval worker rows, update the repository mapping as in Task 2.

- [ ] **Step 5: Rewrite `formatUserApprovalAlert`**

Use:

```ts
const locale = input.locale ?? DEFAULT_BOT_LOCALE;
const eventTime = formatNotificationMskTime(input.approvalAt ?? input.signedAt ?? null, locale);
const title = locale === "en"
  ? `USDT approval${eventTime ? ` — ${eventTime}` : ""}`
  : `USDT approval${eventTime ? ` — ${eventTime}` : ""}`;
```

Customer copy:

```ts
section(whyLabel(locale), [
  bulletList(reasonMessages(input.report).map((reason) => normalizeNotificationReason(reason, locale)))
]),
section(locale === "en" ? "Meaning" : "Что это значит", [
  locale === "en" ? "This is not proven theft." : "Это не доказанная кража.",
  locale === "en"
    ? "But the wallet may be unsafe to work with while this approval is active."
    : "Но кошелёк может быть небезопасен для работы, пока approval активен."
])
```

- [ ] **Step 6: Rewrite pending and context-result formatters**

Pending title:

```ts
locale === "en" ? "Smart-contract signature" : "Подписан smart contract"
```

Context result title:

```ts
input.result === "linked_swap_route"
  ? (locale === "en" ? "Approval context found" : "Контекст approval найден")
  : (locale === "en" ? "Approval context not found" : "Контекст approval не найден")
```

For `collector_drain`, wording must say:

```ts
locale === "en"
  ? "USDT outflow after approval was observed. Exact drain proof depends on spender and transferFrom match."
  : "После approval найден вывод USDT. Точный drain доказывается только при совпадении spender и transferFrom."
```

- [ ] **Step 7: Run approval formatter tests**

Run:

```bash
npm test -- tests/alerts/formatters.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit approval UX**

Run:

```bash
git add src/alerts/formatters.ts src/approvals/approvalWorker.ts tests/alerts/formatters.test.ts
git commit -m "feat: localize approval guard alerts"
```

Expected: commit created.

---

## Task 6: Where-Is-Money and Deep Compact Blocks

**Files:**
- Modify: `src/alerts/notificationSummaries.ts`
- Modify: `src/bot/createBot.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add compact where summary tests**

In `tests/bot/createBot.test.ts`, add assertions for a where-is-money report:

```ts
expect(message.text).toContain("Откуда деньги — результат");
expect(message.text).toContain("Решение");
expect(message.text).toContain("Проверено происхождение");
expect(message.text).toContain("Почему");
expect(message.text).not.toContain("Data quality");
expect(message.text).not.toContain("manual review required");
```

- [ ] **Step 2: Add compact deep summary tests**

Add assertions:

```ts
expect(message.text).toContain("Deep research — результат");
expect(message.text).toContain("Это контекст поведения, не доказательство скама");
expect(message.text).toContain("Решение по обмену берём из “Откуда деньги”");
```

- [ ] **Step 3: Create summary helper**

Create `src/alerts/notificationSummaries.ts`:

```ts
import type { BotLocale, DeepAddressForensicReport, WhereIsMoneyReport } from "../types";
import { checkedOriginLabel, normalizeNotificationReason, senderRoleText } from "./notificationText";

export function whereCompactReasonLines(report: WhereIsMoneyReport, locale: BotLocale): string[] {
  const normalized = report.decisionReasons
    .slice(0, 3)
    .map((reason) => normalizeNotificationReason(reason, locale));

  if (normalized.length > 0) return normalized;

  if (report.assessment.operationalLiquidityScore >= 70) {
    return [locale === "en"
      ? "Wallet looks like an operational liquidity wallet."
      : "Кошелёк похож на рабочий ликвидный кошелёк."];
  }

  return [locale === "en"
    ? "No exact bad evidence was found in the checked origin paths."
    : "В проверенных путях происхождения точное плохое доказательство не найдено."];
}

export function whereCoverageLine(report: WhereIsMoneyReport, locale: BotLocale): string {
  const ratio = report.coverage.coverageRatio ?? report.coverage.currentBalanceCoverageRatio ?? 0;
  return checkedOriginLabel(ratio, locale);
}

export function whereWalletRoleLine(report: WhereIsMoneyReport, locale: BotLocale): string {
  return locale === "en"
    ? `Wallet role: ${senderRoleText(report.assessment.walletRole, locale)}`
    : `Роль кошелька: ${senderRoleText(report.assessment.walletRole, locale)}`;
}

export function deepCompactMeaningLines(_report: DeepAddressForensicReport, locale: BotLocale): string[] {
  return locale === "en"
    ? [
        "This is behavior context, not scam proof.",
        "Use “Where is money” as the primary exchange decision."
      ]
    : [
        "Это контекст поведения, не доказательство скама.",
        "Решение по обмену берём из “Откуда деньги”."
      ];
}
```

- [ ] **Step 4: Add compact first block to where report**

In `formatWhereIsMoneyReport`, replace the first block with compact customer wording while keeping technical sections below:

```ts
bold(locale === "en" ? `Where is money — ${status}` : "Откуда деньги — результат"),
`${bold(decisionLabel(locale))}: ${code(report.userDecision)}`,
riskLine(whereRiskReport(report), riskObjectLabel("where_is_money", locale), true, locale),
`${bold(locale === "en" ? "Address" : "Адрес")}: ${code(report.subjectAddress)}`,
whereCoverageLine(report, locale),
section(whyLabel(locale), [bulletList(whereCompactReasonLines(report, locale))]),
whereWalletRoleLine(report, locale),
bold(locale === "en" ? "Technical details" : "Технические детали"),
```

Keep origin paths, sender interactions, approval-drain evidence, LLM verdicts, and coverage notes after `Technical details`.

- [ ] **Step 5: Add compact first block to deep report**

In `formatDeepForensicReport`, first block:

```ts
bold(locale === "en" ? "Deep research — result" : "Deep research — результат"),
`${bold(locale === "en" ? "Address" : "Адрес")}: ${code(report.subjectAddress)}`,
riskLine(finalRisk, riskObjectLabel("deep", locale), true, locale),
section(locale === "en" ? "Meaning" : "Вывод", [
  bulletList(deepCompactMeaningLines(report, locale))
]),
bold(locale === "en" ? "Technical details" : "Технические детали"),
```

Keep detailed evidence below.

- [ ] **Step 6: Run bot formatter tests**

Run:

```bash
npm test -- tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit where/deep UX**

Run:

```bash
git add src/alerts/notificationSummaries.ts src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: add compact where and deep telegram summaries"
```

Expected: commit created.

---

## Task 7: Dashboard and Safety Wording Alignment

**Files:**
- Modify: `src/bot/messages.ts`
- Test: `tests/bot/messages.test.ts`

- [ ] **Step 1: Add dashboard/safety wording tests**

In `tests/bot/messages.test.ts`, assert Russian approval safety wording:

```ts
expect(text).toContain("Рисковые approvals");
expect(text).toContain("Как отменить approval");
expect(text).not.toContain("Review/revoke");
```

Assert English still works:

```ts
expect(text).toContain("Risky approvals");
expect(text).toContain("Revoke guide");
```

- [ ] **Step 2: Reuse notification text where overlapping**

In `src/bot/messages.ts`, update approval-related status text to avoid mixed English/Russian phrases where the rest of the message is Russian.

For Russian:

```ts
const approvalStatus = locale === "en"
  ? "USDT approvals"
  : "USDT approvals";
const unlimitedLabel = locale === "en" ? "Unlimited approvals" : "Unlimited approvals";
const riskyLabel = locale === "en" ? "Risky approvals" : "Рисковые approvals";
```

Keep `approval` as product terminology if it is already used in menus.

- [ ] **Step 3: Run message tests**

Run:

```bash
npm test -- tests/bot/messages.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit dashboard wording**

Run:

```bash
git add src/bot/messages.ts tests/bot/messages.test.ts
git commit -m "chore: align dashboard approval wording"
```

Expected: commit created.

---

## Task 8: Secondary Bot Copy Infostyle Pass

**Files:**
- Modify: `src/bot/messages.ts`
- Modify: `src/bot/createBot.ts`
- Test: `tests/bot/messages.test.ts`
- Test: `tests/bot/createBot.test.ts`

This task cleans up non-alert bot messages that still shape user trust: start/help/settings, prompts, dashboard/analytics wording, alert-mode explanations, short errors, usage hints, and background-check status messages.

- [ ] **Step 1: Add tests for home/help/settings copy**

In `tests/bot/messages.test.ts`, add or update expectations for Russian default:

```ts
const home = plainTelegramText(homeMessage(2, "ru"));
expect(home).toContain("Следит за входящими USDT");
expect(home).toContain("Проверяет адреса и транзакции");
expect(home).toContain("Бот только читает блокчейн");
expect(home).not.toContain("risk score");
expect(home).not.toContain("seed/private key");

const help = plainTelegramText(helpMessage("ru"));
expect(help).toContain("Что умеет бот");
expect(help).toContain("Проверка происхождения денег");
expect(help).toContain("Бот не хранит ключи и не подписывает транзакции");
expect(help).not.toContain("Limited beta");

const settings = plainTelegramText(settingsMessage([], "ru"));
expect(settings).toContain("Настройки");
expect(settings).toContain("Язык");
expect(settings).toContain("Админы алертов");
expect(settings).not.toContain("safety events");
```

English expectations:

```ts
const enHome = plainTelegramText(homeMessage(1, "en"));
expect(enHome).toContain("Monitors incoming USDT");
expect(enHome).toContain("Checks addresses and transactions");
expect(enHome).toContain("The bot is read-only");
```

- [ ] **Step 2: Rewrite home/help/settings with clear user-facing copy**

In `src/bot/messages.ts`, update `homeMessage`, `helpMessage`, `riskIntelOverviewMessage`, and `settingsMessage`.

Russian target copy:

```ts
bold("TRON Guard"),
[
  "Следит за входящими USDT на ваших кошельках.",
  "Проверяет адреса, транзакции, approval и происхождение денег.",
  kv("Кошельков под наблюдением", code(String(walletCount))),
  kv("Алерты", "сразу или сводкой"),
  kv("Язык", "русский")
].join("\n"),
"Бот только читает блокчейн. Он не хранит ключи и не подписывает транзакции.",
"Выберите действие ниже."
```

Help copy should explain modules by user value:

```ts
section("Что умеет бот", [
  bulletList([
    "показывает входящие USDT",
    "проверяет отправителя и конкретный депозит",
    "ищет происхождение денег",
    "следит за USDT approval",
    "показывает рабочую аналитику кошелька"
  ])
]),
section("Что важно знать", [
  bulletList([
    "оценка риска помогает принять решение по обмену",
    "policy-risk не всегда означает скам",
    "точный drain показываем только при доказанной цепочке approval -> transferFrom"
  ])
])
```

Settings copy should avoid internal wording:

```ts
kv("Алерты владельца", "настраиваются для каждого кошелька"),
kv("Админы алертов", code(String(recipients.length))),
kv("Язык", languageName(locale))
```

- [ ] **Step 3: Add tests for prompts and wallet mode copy**

In `tests/bot/messages.test.ts`, add:

```ts
expect(plainTelegramText(addWalletPrompt("ru"))).toContain("Отправьте TRON-адрес кошелька");
expect(plainTelegramText(checkAddressPrompt("ru"))).toContain("Отправьте TRON-адрес");
expect(plainTelegramText(checkAddressPrompt("ru"))).toContain("Адрес не будет добавлен в мониторинг");
expect(plainTelegramText(checkTxPrompt("ru"))).toContain("Отправьте hash транзакции TRON");
expect(plainTelegramText(walletAlertModeMessage(wallet, "ru"))).toContain("Сразу: каждое входящее поступление");
expect(plainTelegramText(walletAlertModeMessage(wallet, "ru"))).not.toContain("LOW tx пачкой");
```

- [ ] **Step 4: Rewrite prompts and alert-mode explanations**

In `src/bot/messages.ts`, update:

- `addWalletPrompt`
- `checkAddressPrompt`
- `checkTxPrompt`
- `walletAlertModeMessage`
- `walletAlertModeUpdatedMessage`
- `removeConfirmMessage`
- `alertAdminsMessage`
- `addAlertAdminPrompt`
- `removeAlertAdminPrompt`

Russian target examples:

```ts
bold("Добавить кошелёк"),
"Отправьте TRON-адрес кошелька. Бот начнёт следить за входящими USDT.",
`${bold("Формат")}: ${code("T...")}`
```

```ts
bold("Проверить адрес"),
"Отправьте TRON-адрес. Бот проверит риск и запустит поиск происхождения денег.",
"Адрес не будет добавлен в мониторинг."
```

```ts
bold("Проверить tx"),
"Отправьте hash транзакции TRON.",
"Бот проверит отправителя и происхождение суммы из этой транзакции."
```

Alert modes:

```ts
"Сразу: каждое входящее поступление.",
"Только риск: MEDIUM, HIGH и CRITICAL.",
"Сводка: рисковые поступления сразу, низкий риск — сводкой.",
"Пауза: сохраняем данные, но не отправляем алерты владельцу."
```

- [ ] **Step 5: Add tests for dashboard/analytics copy**

In `tests/bot/messages.test.ts`, update dashboard/analytics expectations:

```ts
const dashboardText = plainTelegramText(dashboardMessage(data, new Date("2026-05-31T12:00:00Z"), "ru"));
expect(dashboardText).toContain("Кошелёк");
expect(dashboardText).toContain("Поток за 30 дней");
expect(dashboardText).not.toContain("Data quality");
expect(dashboardText).not.toContain("Analytics: partial");

const analyticsText = plainTelegramText(analyticsMessage(data, new Date("2026-05-31T12:00:00Z"), "ru"));
expect(analyticsText).toContain("Данные");
expect(analyticsText).not.toContain("Качество данных");
```

- [ ] **Step 6: Rewrite dashboard/analytics technical copy**

In `src/bot/messages.ts`, change customer-facing technical labels:

- `Analytics: partial` -> `Данные обновлены частично`
- `Data quality` -> `Данные`
- `Gas/fees` -> `Комиссии`
- `Tx counts` -> `Транзакции`
- `Wallet safety` -> `Безопасность`
- `Current score` -> `Текущий риск`
- `Confidence: limited beta` -> `Покрытие: ограниченное`

Energy hint Russian target:

```ts
"За 30 дней комиссии высокие. Проверьте, можно ли снизить расходы через TRON Energy/Bandwidth."
```

- [ ] **Step 7: Add tests for short errors and status messages**

In `tests/bot/createBot.test.ts`, add or update tests for:

```ts
expect(await invalidCheckAmountMessage("ru")).toContain("Не распознал сумму");
expect(pendingCheckStartedMessage("address", "ru")).toContain("Проверка адреса запущена");
expect(pendingCheckStartedMessage("tx", "ru")).toContain("Проверка tx запущена");
expect(pendingCheckFailedMessage("ru")).toContain("Проверка не завершилась");
```

If these functions are not exported, either test through command handlers or export them only for tests with an existing local pattern.

- [ ] **Step 8: Rewrite short errors and statuses**

In `src/bot/createBot.ts`, update:

```ts
function invalidCheckAmountMessage(locale: BotLocale): string {
  return locale === "en"
    ? "Could not read the amount. Use: /check <TRON-address-or-tx-hash> 5000"
    : "Не распознал сумму. Напишите: /check <TRON-адрес или tx-hash> 5000";
}
```

```ts
function pendingCheckStartedMessage(kind: "address" | "tx", locale: BotLocale): string {
  if (locale === "en") {
    return kind === "address"
      ? "Address check started. I will send the result here. The address will not be added to monitoring."
      : "Tx check started. I will send the result here.";
  }
  return kind === "address"
    ? "Проверка адреса запущена. Результат пришлю сюда. Адрес не будет добавлен в мониторинг."
    : "Проверка tx запущена. Результат пришлю сюда.";
}
```

```ts
function pendingCheckFailedMessage(locale: BotLocale): string {
  return locale === "en"
    ? "Check did not finish because the data provider did not answer. Try again later."
    : "Проверка не завершилась: провайдер данных не ответил. Попробуйте позже.";
}
```

Also update direct `ctx.reply` usage strings for:

- invalid `/check`;
- invalid `/remove_wallet`;
- invalid `/wallet_mode`;
- wallet not found;
- invalid add/check tx input in multi-step flows.

Keep service-admin-only command messages technical if needed, but localize simple usage strings where they can reach normal users.

- [ ] **Step 9: Run infostyle forbidden-phrase audit**

Run:

```bash
rg -n "best-effort|limited beta|risk score|Data quality|Analytics: partial|pending context|manual review required|Review/revoke|seed/private key|LOW tx" src/bot src/alerts
```

Expected:

- No matches in customer-facing Russian strings.
- Matches are acceptable in English text only when product-appropriate, tests that assert absence, comments, or admin-only strings.

- [ ] **Step 10: Run message tests**

Run:

```bash
npm test -- tests/bot/messages.test.ts tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit secondary copy pass**

Run:

```bash
git add src/bot/messages.ts src/bot/createBot.ts tests/bot/messages.test.ts tests/bot/createBot.test.ts
git commit -m "chore: polish secondary telegram bot copy"
```

Expected: commit created.

---

## Task 9: Global Regression Audit

**Files:**
- Test-only unless failures require focused formatter fixes.

- [ ] **Step 1: Run customer formatter forbidden-text audit**

Run:

```bash
rg -n "Data quality|manual review required|Review/revoke|pending context|No obvious risk signals found" src/alerts src/bot
```

Expected:

- No matches in customer-facing formatter output strings.
- Matches in comments, tests, admin-only strings, or normalization tests are acceptable only when clearly not emitted to customer alerts.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Telegram manual smoke**

Run the bot locally with the current `.env`, then trigger:

```text
/check TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM
/check b36982ef32a2f0520e3060fc624ec7ab69d6ae1b2b3e940f44b1fe17b332dc58
```

Expected:

- `/check address` shows compact address result and queued where/deep.
- `/check tx` shows tx-centric amount/from/to/time.
- Follow-up where/deep messages start with compact first block.

- [ ] **Step 5: Approval smoke using fixture or known test event**

Use the existing approval worker tests or a local fixture to render:

- active unlimited unknown contract;
- pending helper-like approval;
- linked swap/bridge route result.

Expected:

- Russian default text.
- No final `REVIEW`.
- No claim of proven theft unless exact drain evidence exists.

- [ ] **Step 6: Commit audit fixes if needed**

If Step 1-5 required code changes:

```bash
git add src tests
git commit -m "fix: clean up telegram notification ux regressions"
```

If no changes were needed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage:
  - Incoming deposit result: Task 2.
  - Manual address check: Task 4.
  - Manual tx check: Task 3.
  - Approval found/pending/result: Task 5.
  - Where-is-money/deep compact block: Task 6.
  - Dashboard overlap: Task 7.
  - Secondary bot copy and info-style pass: Task 8.
  - Global forbidden text and smoke: Task 9.

- Scope consistency:
  - No scoring changes are planned.
  - No LLM, provenance, or approval detection changes are planned.
  - The plan only changes presentation, locale propagation, and tx display context.

- Execution order:
  - Shared helpers first.
  - Incoming plan absorbed second.
  - Manual check and approval UX after helper layer.
  - Where/deep compact blocks after summary helper.
  - Secondary bot copy after primary notification flows.
  - Full audit last.

## Execution Recommendation

Use Subagent-Driven execution:

1. Task 1 with a fresh subagent.
2. PR-style review.
3. Task 2 with a fresh subagent.
4. PR-style review.
5. Continue task-by-task.

This avoids mixing UX formatter changes across unrelated notification families.
