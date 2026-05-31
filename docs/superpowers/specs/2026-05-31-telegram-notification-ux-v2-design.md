# Telegram Notification UX v2 Design

## Goal

Make the main Telegram notifications understandable for non-technical exchange operators while preserving forensic accuracy.

The user should see a clear operational answer first:

```text
Решение: ACCEPTABLE / DECLINE
Риск: 0-100
Почему: 2-4 plain-language reasons
Что проверено: short facts
```

Raw diagnostics, internal detector names, and ambiguous final states should not be shown in the first user-facing message.

## Current Problems

The project has several independent notification families:

- incoming USDT alerts in `src/alerts/formatters.ts`;
- approval guard alerts in `src/alerts/formatters.ts`;
- manual `/check address`, `/check tx`, where-is-money, and deep forensic reports in `src/bot/createBot.ts`;
- wallet dashboard and safety summaries in `src/bot/messages.ts`.

Because these formatters evolved separately, they use different language, different field names, and different levels of technical detail.

The main UX risks:

- approval alerts are still mostly English and use technical language like `spender`, `pending context`, `Review/revoke`;
- tx mode checks the sender address but the first message does not clearly look like a tx report;
- manual address check mixes fast result, queued jobs, signals, and limits in one technical report;
- where-is-money and deep reports are useful for debugging but too verbose for first-line user decisions;
- some messages still expose internal concepts such as `Data quality`, `manual review required`, raw `REVIEW`, detector codes, and service-boundary details without explaining the business meaning.

## Scope

This design covers customer-facing Telegram notifications:

1. Incoming deposit result.
2. Manual address check.
3. Manual tx check.
4. Approval found.
5. Approval pending context.
6. Approval context result.
7. Signed smart-contract / approval-related contract context.
8. Where-is-money result.
9. Deep forensic result.
10. Digest and dashboard summaries only where wording overlaps with the above.

Admin-only alerts can remain more technical, but they should still use the same core labels when possible.

## Non-Goals

- Do not change scoring in this UX task.
- Do not change provenance tracing, LLM verdict logic, or approval detection logic.
- Do not remove detailed forensic data from stored job results.
- Do not hide diagnostics from developer/admin views if they are useful for debugging.

## Common Message Standard

### Language

- Default language is Russian.
- If the user has `locale = "en"`, render the English version.
- New formatter APIs should accept `locale: BotLocale`.
- Monitor-created jobs should carry the wallet owner's locale into `progress_json.locale`.

### Time

Show transaction time for event-based messages:

```text
Входящий USDT — 31.05.2026 14:02 MSK
USDT approval — 31.05.2026 14:02 MSK
Проверка tx — 31.05.2026 14:02 MSK
```

Use the on-chain timestamp when available. If unavailable, omit the timestamp instead of showing a fake current time.

Render in `Europe/Moscow` and suffix `MSK`.

### Decision

For final customer-facing messages:

```text
Решение: ACCEPTABLE
Решение: DECLINE
```

Do not show `REVIEW` as a final user decision.

For a temporary process state, use status wording:

```text
Статус: анализ запущен
Статус: ждём контекст операции
```

### Risk Labels

Use object-specific risk labels:

- `Риск депозита`
- `Риск адреса`
- `Риск tx`
- `Риск approval`
- `Риск контракта`

Avoid a generic `Risk` label when the object is ambiguous.

### Reasons

Reasons must be short and plain.

Use:

```text
Критичных риск-сигналов по депозиту не найдено.
Отправитель похож на рабочий ликвидный кошелёк.
15% проверенной суммы пришло от HTX.
Источник до моста не доказан.
Контракт похож на легитимный сервис, поэтому это не доказанный drain.
```

Avoid:

```text
manual review required
unknown_contract_boundary
Data quality: medium
No obvious risk signals found
Balance-forming path reaches service boundary
```

### Coverage

Do not show `Data quality` to the user.

Use coverage only when it helps explain how much of the money was traced:

```text
Проверено происхождение: 100% суммы
Проверено происхождение: 76% суммы
```

English:

```text
Checked origin: 100% of amount
Checked origin: 76% of amount
```

### Policy Wording

HTX/Huobi wording must say funds came from the source, not reached it:

```text
15% проверенной суммы пришло от HTX.
HTX — policy-risk, не доказательство скама.
```

English:

```text
15% of checked funds came from HTX.
HTX is policy risk, not scam proof.
```

Bridge/OFT/service wording:

```text
Деньги пришли через bridge/OFT service.
Источник до моста не доказан.
Контракт похож на легитимный сервис, поэтому это не доказанный drain.
```

English:

```text
Funds came through a bridge/OFT service.
Source before the bridge is not proven.
The contract looks like a legitimate service, so this is not proven drain.
```

## Message Designs

### 1. Incoming Deposit Result

Russian:

```text
Входящий USDT — 31.05.2026 14:02 MSK

Решение: ACCEPTABLE
Риск депозита: 25/100 LOW-MEDIUM

Сумма: 279,000 USDT
Кошелёк: TEYPUt...
Отправитель: TMnTD...

Почему:
• Отправитель похож на рабочий ликвидный кошелёк.
• Критичных риск-сигналов по депозиту не найдено.

Проверки:
• Fast sender check: 0/100 LOW
• Проверено происхождение: 100% суммы
• Роль отправителя: рабочий ликвидный кошелёк

Tx: b36982...
```

English:

```text
Incoming USDT — May 31, 2026 14:02 MSK

Decision: ACCEPTABLE
Deposit risk: 25/100 LOW-MEDIUM

Amount: 279,000 USDT
Watched wallet: TEYPUt...
Sender: TMnTD...

Why:
• Sender looks like an operational liquidity wallet.
• No critical deposit-risk signals were found.

Checks:
• Fast sender check: 0/100 LOW
• Checked origin: 100% of amount
• Sender role: operational liquidity wallet

Tx: b36982...
```

### 2. Manual Address Check

The first `/check address` response should be a compact preliminary result plus queued follow-ups.

Russian:

```text
Проверка адреса — предварительно

Решение: ACCEPTABLE
Риск адреса: 28/100 LOW-MEDIUM

Адрес: TEYPUt...

Почему:
• Адрес похож на рабочий ликвидный кошелёк.
• Критичных риск-сигналов не найдено.
• Чистый источник денег доказан не полностью, поэтому риск не нулевой.

Дальше:
• Откуда деньги: запущено
• Deep research: запущен
```

English:

```text
Address check — preliminary

Decision: ACCEPTABLE
Address risk: 28/100 LOW-MEDIUM

Address: TEYPUt...

Why:
• Address looks like an operational liquidity wallet.
• No critical risk signals were found.
• Clean source is not fully proven, so risk is not zero.

Next:
• Where is money: queued
• Deep research: queued
```

### 3. Manual Tx Check

Tx mode should look like a tx report, not only an address report.

Russian:

```text
Проверка tx — 31.05.2026 14:02 MSK

Решение: ACCEPTABLE
Риск tx: 25/100 LOW-MEDIUM

Сумма: 279,000 USDT
От: TMnTD...
Кому: TEYPUt...

Почему:
• По этой транзакции критичных риск-сигналов не найдено.
• Отправитель похож на рабочий ликвидный кошелёк.

Проверки:
• Fast sender check: 0/100 LOW
• Происхождение суммы: запущено

Tx: b36982...
```

English:

```text
Tx check — May 31, 2026 14:02 MSK

Decision: ACCEPTABLE
Tx risk: 25/100 LOW-MEDIUM

Amount: 279,000 USDT
From: TMnTD...
To: TEYPUt...

Why:
• No critical risk signals were found for this transaction.
• Sender looks like an operational liquidity wallet.

Checks:
• Fast sender check: 0/100 LOW
• Amount provenance: queued

Tx: b36982...
```

### 4. Approval Found

Approval alerts must separate safety risk from proven theft.

Russian:

```text
USDT approval — 31.05.2026 14:02 MSK

Решение: DECLINE
Риск approval: 78/100 HIGH

Кошелёк: TLhVzk...
Кому разрешено списание: TNKG4...
Размер: unlimited USDT

Почему:
• Активное unlimited-разрешение на непонятный контракт.
• Списания USDT не доказаны.
• Контекст нормального bridge/swap-сценария не найден.

Что это значит:
• Это не доказанная кража.
• Но кошелёк небезопасен для работы, пока approval активен.

Approval tx: 3e5bc9...
```

English:

```text
USDT approval — May 31, 2026 14:02 MSK

Decision: DECLINE
Approval risk: 78/100 HIGH

Wallet: TLhVzk...
Approved spender: TNKG4...
Allowance: unlimited USDT

Why:
• Active unlimited approval to an unknown contract.
• USDT drain is not proven.
• No normal bridge/swap route context was found.

Meaning:
• This is not proven theft.
• But the wallet is unsafe to work with while this approval is active.

Approval tx: 3e5bc9...
```

### 5. Approval Pending Context

This is a temporary state, not a final decision.

Russian:

```text
Подписан smart contract — 31.05.2026 14:02 MSK

Статус: ждём контекст операции
Предварительный риск: 45/100 MEDIUM

Кошелёк: TLhVzk...
Контракт: TNKG4...
Разрешение: unlimited USDT

Почему:
• Контракт пока не распознан как известный сервис.
• Система ждёт, появится ли рядом swap/bridge/route-операция.

Финальный результат придёт отдельным сообщением.
```

English:

```text
Smart-contract signature — May 31, 2026 14:02 MSK

Status: waiting for operation context
Preliminary risk: 45/100 MEDIUM

Wallet: TLhVzk...
Contract: TNKG4...
Allowance: unlimited USDT

Why:
• Contract is not recognized as a known service yet.
• The system is waiting for nearby swap/bridge/route activity.

Final result will arrive in a separate message.
```

### 6. Approval Context Result

Russian, legitimate route:

```text
Контекст approval найден — 31.05.2026 14:12 MSK

Решение: ACCEPTABLE
Риск approval: 35/100 LOW-MEDIUM

Кошелёк: TLhVzk...
Контракт: TPwez...
Разрешение: unlimited USDT

Почему:
• Approval связан с bridge/swap-операцией.
• Контракт похож на легитимный сервис.
• Списания USDT как drain не доказаны.

Route tx: 0e940f...
Approval tx: 3e5bc9...
```

Russian, risky no-route:

```text
Контекст approval не найден — 31.05.2026 14:12 MSK

Решение: DECLINE
Риск approval: 70/100 HIGH

Кошелёк: TLhVzk...
Контракт: TNKG4...
Разрешение: unlimited USDT

Почему:
• Активное unlimited-разрешение осталось без понятного service route.
• Списания USDT не доказаны.
• Но кошелёк небезопасен для работы, пока approval активен.
```

### 7. Where-Is-Money Result

The full report can remain available, but the user-facing first block should be compact.

Russian:

```text
Откуда деньги — результат

Решение: ACCEPTABLE
Риск: 32/100 LOW-MEDIUM

Адрес: TEYPUt...
Проверено происхождение: 72% суммы

Почему:
• Кошелёк похож на рабочий ликвидный кошелёк.
• Чистый CEX-origin доказан не полностью.
• Hard bad evidence не найдено.

Главный источник:
• 15% проверенной суммы пришло от HTX — policy-risk, не доказательство скама.
```

Detailed origin paths, sender interactions, LLM verdicts, and coverage notes should be either lower in the message or moved to a technical follow-up/admin view.

### 8. Deep Forensic Result

Deep result should not compete with where-is-money. It is supporting context.

Russian:

```text
Deep research — результат

Риск адреса: 39/100 MEDIUM

Адрес: TS3ga...

Что изменилось:
• Найден крупный контрагент со средним fast-risk.
• Это контекст поведения, не доказательство скама.

Вывод:
• Решение по обмену берём из “Откуда деньги”.
• Deep research показывает дополнительный риск-контекст.
```

## Structured Data Needed

To render the messages well, formatters need structured fields instead of raw reason text only.

### Shared Notification Context

Add or derive a small context object:

```ts
type NotificationContext = {
  locale: BotLocale;
  eventAt?: Date | null;
  objectKind: "deposit" | "address" | "tx" | "approval" | "where_is_money" | "deep";
};
```

### Tx Check Context

Manual tx check should expose:

```ts
type ManualTxDisplayContext = {
  txHash: string;
  timestamp?: Date | null;
  amountRaw?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
};
```

This can be extracted from the same official TRC20 USDT transfer seed used by transaction-origin mode.

### Approval Context

Approval formatters should receive:

```ts
type ApprovalDisplayContext = {
  approvalAt?: Date | null;
  signedAt?: Date | null;
  spenderIdentity?: string | null;
  allowanceDisplay: string;
  serviceRouteStatus?: "linked" | "not_found" | "pending" | "drain_like";
  exactDrainProof?: "found" | "not_found" | "not_checked";
};
```

### Reason Translation Layer

Create a small translation/normalization layer for common internal reason patterns:

- `clean_source_not_fully_proven` -> clean but non-zero risk wording;
- `operational_liquidity_wallet` -> working liquidity wallet wording;
- `htx_weighted_policy` -> `% came from HTX`;
- `bridge_oft_boundary` -> bridge/OFT source wording;
- `exact_approval_drain` -> exact drain wording;
- `active_unlimited_eoa_approval` -> unsafe active approval wording;
- `approval_only_no_drain` -> approval exists, drain not proven wording;
- fallback: sanitized raw reason.

## Architecture

Keep the scoring modules separate from notification rendering.

Recommended structure:

```text
src/alerts/
  formatters.ts                 existing public formatters
  notificationText.ts           shared localized labels/reason text
  notificationTime.ts           MSK date formatting
  notificationSummaries.ts      report -> user-facing summary

src/bot/createBot.ts            calls compact formatter for manual check/tx/where/deep
src/bot/messages.ts             dashboard/safety can reuse shared labels
```

The formatter should not recompute risk. It should only:

- choose user-facing labels;
- convert structured risk facts into text;
- hide internal diagnostics from the primary customer message;
- preserve technical facts where still useful.

## Rollout Order

1. Build shared notification text helpers: locale, MSK time, risk label, coverage label, source-policy phrases.
2. Update incoming deposit formatter using the already written incoming alert UX plan.
3. Update manual `/check tx` so the first message is tx-centric.
4. Update manual `/check address` so the first message is compact and queues are clear.
5. Update approval found / pending / context result formatters.
6. Add compact first block to where-is-money and deep result messages.
7. Update dashboard/safety wording only where it reuses approval language.

## Testing

Add formatter tests for both Russian and English:

- incoming deposit clean operational wallet;
- incoming deposit weighted HTX source;
- tx check with amount/from/to/time;
- address check preliminary with queued where/deep;
- approval active unlimited unknown contract;
- approval pending context;
- approval linked bridge/swap route;
- approval no-route result;
- where-is-money compact block with HTX share;
- deep forensic result that explicitly says it is supporting context.

Regression checks:

- no customer formatter emits final `REVIEW`;
- no customer formatter emits `Data quality`;
- no customer formatter emits raw `manual review required`;
- HTX wording uses “came from / пришло от”;
- approval messages do not call something a proven drain unless exact drain evidence exists.

## Open Implementation Notes

- Some files currently show mojibake in PowerShell output, but the source can still compile. Implementation should preserve UTF-8 and verify rendered Telegram text in tests.
- Existing admin alerts can stay more detailed, but shared labels should reduce inconsistency.
- Full report detail should remain available for debugging and future admin views; this design only changes the customer-facing first message.
