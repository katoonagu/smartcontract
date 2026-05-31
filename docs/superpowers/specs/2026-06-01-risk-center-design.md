# Risk Center Design

Date: 2026-06-01

## Problem

The main menu button "Risk" currently opens a static explanation of risk modules. For an exchange operator this is low-value text: it does not answer the practical question "is anything dangerous happening now?"

The screen should become an operational risk center. It should show recent risky events, active approval risks, and clear next actions. Technical module descriptions should move to Help or an informational sub-screen.

## Goals

- Replace the current "risk modules" copy with a useful risk inbox.
- Show the user what needs attention now: high-risk deposits, risky approvals, drain-like events, and analysis failures on important amounts.
- Keep the final UX simple for non-technical users.
- Use the same decision language as the rest of the bot: `ACCEPTABLE` / `DECLINE`, risk score, short reason, time.
- Avoid turning the screen into another long forensic report.

## Non-Goals

- Do not add a new scoring engine in this task.
- Do not recalculate all wallet provenance inside the risk screen.
- Do not delete the existing wallet safety screen; the risk center should link into it where useful.
- Do not expose raw debugging details unless the user opens a detailed event.

## Recommended Product Shape

The "Risk" button should open a "Risk Center" screen.

Primary content:

1. Current summary.
2. Top events requiring attention.
3. Recent incoming deposit decisions.
4. Active approval risks.
5. Navigation buttons.

Example in Russian:

```text
🛡 Риск

Критичных событий сейчас: 2
За 24 часа: 5 входящих, 1 approval, 0 списаний

Требует внимания
• DECLINE 68/100 · входящий депозит 384,064 USDT
  TEYPUt...UZBM ← TEaVi...fdKs
  Причина: источник близко к неизвестному контракту
  17:01

• MEDIUM 45/100 · active unlimited approval
  TLhVzk...AgXe → TNKG4...pxQ5
  Причина: непонятный spender, approval активен
  26 дней назад

Последние входящие
• ACCEPTABLE 25/100 · 279,000 USDT · TEYPUt...UZBM
• ACCEPTABLE 32/100 · 4,080 USDT · TVzGY...iZMF
• DECLINE 65/100 · 100,000 USDT · TEYPUt...UZBM
```

Example in English:

```text
🛡 Risk

Critical events now: 2
Last 24h: 5 incoming, 1 approval, 0 post-approval outflows

Needs attention
• DECLINE 68/100 · incoming deposit 384,064 USDT
  TEYPUt...UZBM ← TEaVi...fdKs
  Reason: source is close to an unknown contract
  17:01

• MEDIUM 45/100 · active unlimited approval
  TLhVzk...AgXe → TNKG4...pxQ5
  Reason: unknown spender, approval is active
  26 days ago

Recent incoming
• ACCEPTABLE 25/100 · 279,000 USDT · TEYPUt...UZBM
• ACCEPTABLE 32/100 · 4,080 USDT · TVzGY...iZMF
• DECLINE 65/100 · 100,000 USDT · TEYPUt...UZBM
```

## Data Sources

The first implementation should reuse existing stored data:

- `observed_transactions`: incoming USDT alerts and stored risk fields.
- `forensic_check_jobs`: latest `incoming_deposit_check`, `where_is_money_check`, and `address_deep_check` results.
- `wallet_approvals`: current active approvals and their risk fields.
- `observed_approval_events`: approval alerts and final context risk fields.
- `observed_approval_drain_events`: post-approval outflow observations.
- `watched_wallets`: wallet address, alert mode, locale, and user ownership.

The risk center should not trigger heavy live analysis on open. It can provide a refresh button later, but the initial screen must be fast and read mostly from DB.

## Event Model

Introduce a presentation-level event model, not a new scoring model:

```ts
type RiskCenterEventKind =
  | "incoming_deposit"
  | "approval"
  | "approval_outflow"
  | "where_is_money"
  | "deep_check"
  | "analysis_issue";

type RiskCenterEvent = {
  id: string;
  kind: RiskCenterEventKind;
  walletAddress: string;
  subjectAddress?: string;
  txHash?: string;
  amountUsdt?: string;
  decision?: "ACCEPTABLE" | "DECLINE";
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  score: number;
  reason: string;
  occurredAt: Date;
  detailAction?: RiskCenterDetailAction;
};
```

This model should be built from existing DB rows. It should not become another place that owns forensic logic.

## Prioritization

The top "Needs attention" block should include at most 5 items.

Priority order:

1. `CRITICAL` or exact approval-drain / blacklist / USDT blacklist.
2. `DECLINE` incoming deposits.
3. `HIGH` incoming deposits or where-is-money findings.
4. Active unlimited approval with `MEDIUM+` score.
5. Analysis issue on a large deposit, for example incomplete contract metadata or LLM unavailable.

Within the same priority, sort by newest first.

Low-risk accepted deposits should not appear in "Needs attention"; they belong in "Recent incoming".

## Copy Rules

Use short, decision-oriented wording.

Good:

- "Источник близко к неизвестному контракту."
- "Есть активный unlimited approval на непонятный contract."
- "15% проверенной суммы пришло от HTX."
- "Кошелек выглядит как рабочий ликвидный кошелек."

Avoid:

- Long module explanations.
- "Beta module context" as the main message.
- Raw internal names like `unknown_contract_boundary` unless in a detail screen.
- Saying "drainer proven" when the evidence is only LLM suspicion or approval-only context.

## Keyboard

Main risk center keyboard:

- `🚨 Опасные события` / `🚨 Risk events`
- `🧾 Входящие` / `🧾 Incoming`
- `🛂 Approvals`
- `ℹ️ Как считается риск` / `ℹ️ How risk works`
- `⬅️ Назад` / `⬅️ Back`

Optional later:

- `🔄 Обновить` / `🔄 Refresh`
- `📤 Экспорт` / `📤 Export`

The MVP can keep all content on one screen and use only `Approvals`, `Incoming`, and `Back` buttons if implementation time is tight.

## Detailed Screens

The first pass can link to existing screens instead of building new detail pages:

- `Approvals` opens the current wallet safety/approval view if a wallet is selected, or a list of wallets with approval counts if opened from the main menu.
- `Incoming` opens recent incoming risk events from `observed_transactions`.
- `Risk events` filters only `DECLINE`, `HIGH`, `CRITICAL`, and `MEDIUM approval` items.
- `How risk works` contains the old module explanation, rewritten as a short help text.

## Empty State

If there are no risky events:

```text
🛡 Риск

Сейчас нет событий, которые требуют действия.

За 24 часа: 0 DECLINE, 0 HIGH, 0 новых approval.
Последние входящие можно посмотреть в разделе «Входящие».
```

English:

```text
🛡 Risk

No events require action right now.

Last 24h: 0 DECLINE, 0 HIGH, 0 new approvals.
Recent incoming deposits are available under "Incoming".
```

## Performance

The risk center must open quickly:

- Target response time: under 1 second for normal DB reads.
- No TronScan, TronGrid, or LLM calls on initial open.
- Use limited queries: top recent incoming, top approval risks, latest approval outflows, latest forensic jobs.
- Limit rows per section to avoid oversized Telegram messages.

## Error Handling

If DB data is missing or a section cannot be built:

- Show the available sections.
- Add a short line: "Часть данных временно недоступна." / "Some data is temporarily unavailable."
- Do not fail the entire screen.

## Testing

Add focused tests for:

- Empty risk center.
- Mixed events: decline deposit, medium approval, low accepted deposit.
- Sorting and top event truncation.
- Russian and English copy.
- Keyboard callbacks.
- Old `riskIntelOverviewMessage` moved or replaced without breaking existing callbacks.

## Implementation Boundaries

Recommended code boundaries:

- `src/riskCenter/riskCenterRepository.ts`: DB reads only.
- `src/riskCenter/riskCenterModel.ts`: maps DB rows into `RiskCenterEvent`.
- `src/bot/messages.ts`: formats the risk center text.
- `src/bot/keyboards.ts`: risk center keyboard.
- `src/bot/createBot.ts`: callback routing.

This keeps the new screen from spreading presentation logic across forensic modules.

## Self-Review

- No placeholders remain.
- The design does not require a new scoring engine.
- The screen is based on stored data, so it avoids TronScan/LLM delays.
- User-facing language avoids overstating LLM suspicion as proof.
- Existing safety and incoming screens remain useful and can be linked from the risk center.
