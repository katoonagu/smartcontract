# Telegram Message Style Guide Design

Date: 2026-05-23
Status: Approved for implementation planning

## Summary

This spec defines a unified Telegram message style for the TRON USDT Monitoring Bot.

The goal is to make every bot screen and alert feel like one product:

1. short enough to scan in Telegram;
2. structured enough to understand the risk context;
3. safe enough for wallet/security messaging;
4. consistent across incoming USDT alerts, Approval Guard alerts, dashboard screens, settings, and admin notifications;
5. ready for a gradual HTML migration without breaking existing inline keyboards or bot navigation.

This is a message design spec. It does not change risk scoring, approval detection, wallet monitoring, or storage policy.

## Goals

- Give users a stable card-like structure for all important bot messages.
- Separate facts, interpretation, action, and safety disclaimer.
- Keep wallet addresses, transaction hashes, Telegram IDs, methods, and commands copyable.
- Reduce alarmist wording while still making HIGH/CRITICAL signals visible.
- Make active vs planned risk modules explicit so beta scoring is not oversold.
- Make customer alert-admin messages user-facing, not service-admin dense.
- Keep service-admin alerts denser and more technical.
- Standardize HTML formatting rules and escaping.
- Migrate gradually from plain text to Telegram HTML parse mode.

## Non-Goals

- No new AML providers.
- No new graph forensics.
- No bridge tracing implementation.
- No revoke automation.
- No wallet signing.
- No custody or private-key handling.
- No new database schema.
- No new Telegram commands unless needed for formatting options.
- No change to risk-score thresholds or approval-risk rules.

## Current Product Surfaces

The style guide covers these message surfaces:

- Owner incoming USDT alerts.
- Customer alert-admin incoming alerts.
- Service-admin suspicious incoming alerts.
- Low-risk digest alerts.
- Approval Guard owner alerts.
- Approval Guard customer alert-admin alerts.
- Approval Guard service-admin alerts.
- Manual `/check` results.
- Home and help screens.
- Wallet dashboard screen.
- Wallet analytics screen.
- Risk intelligence screen.
- Wallet safety screen.
- Alert mode, settings, profile, Telegram ID, and alert-admin screens.
- Add wallet / check address / check tx prompts.

Relevant current implementation files:

- `src/alerts/formatters.ts`
- `src/approvals/approvalWorker.ts`
- `src/alerts/adminDelivery.ts`
- `src/bot/messages.ts`
- `src/bot/createBot.ts`
- `src/bot/keyboards.ts`
- `tests/alerts/formatters.test.ts`
- `tests/bot/messages.test.ts`

Related existing design specs:

- `docs/superpowers/specs/2026-05-23-approval-alert-message-design.md`
- `docs/superpowers/specs/2026-05-23-approval-session-context-design.md`

---

# Section 1: Product Message Principles

## 1.1 Message hierarchy

Every important message should use the same conceptual hierarchy:

```text
[emoji] Title / Context

Status summary

Key facts

Interpretation / explanation

Action block

Evidence / tx / links

Read-only footer, if security-related
```

Not every message needs every block, but the ordering should stay stable.

Example:

```text
🛡 Wallet safety
Wallet: TLhV...AgXe

Status: review
Risky approvals: 1

Top risky spenders
• TNKG...xQ5
  HIGH · 80/100 · EOA wallet
  Allowance: unlimited USDT

What to do
1. Open TronScan approvals.
2. Revoke only if unexpected.

🔒 Read-only: бот не подписывает транзакции, не просит seed/private key и не управляет средствами.
```

## 1.2 Facts, interpretation, action

Security and risk messages must separate three layers:

- Fact: what happened or what was found.
- Interpretation: what the bot thinks it may mean.
- Action: what the user can review externally.

Good:

```text
Fact
Incoming USDT transfer found.

Interpretation
Sender has MEDIUM risk signals from connected beta modules.

What to do
Review the sender before treating this payment as final.
```

Bad:

```text
This sender is a scammer. Do not accept money.
```

Unless the product has explicit high-confidence evidence and policy allows it, avoid definitive criminal claims.

## 1.3 Read-only safety policy

The bot is a read-only monitor.

Security-related messages must not imply that the bot can:

- sign transactions;
- revoke approvals;
- connect to the user's wallet;
- control funds;
- hold private keys;
- ask for seed/private key;
- execute a payout or compliance decision.

Required footer for security/approval/safety messages:

```text
🔒 Read-only: бот не подписывает транзакции, не просит seed/private key и не управляет средствами.
```

Admin variant:

```text
🔒 Read-only alert. Bot never signs transactions or asks for seed/private key.
```

## 1.4 RU/EN tone

The product can keep the current RU/EN mixed style:

- Russian for user guidance and safety explanations.
- English for technical terms that users recognize in crypto/Telegram: `wallet`, `spender`, `approval`, `allowance`, `tx`, `risk`, `score`, `digest`, `beta`.
- English-heavy copy is acceptable for service admins.

Tone rules:

- calm, precise, non-alarmist;
- direct actions, not legal/compliance advice;
- `review-needed`, `possible`, `appears linked`, `limited beta` when evidence is incomplete;
- no fake certainty.

## 1.5 Risk-module honesty

Risk intelligence screens and risk-related alerts must distinguish:

- active modules;
- limited beta modules;
- planned / not connected modules.

Example:

```text
Active modules
• Internal labels: active
• Incoming monitor: active
• USDT approvals: limited

Planned / not connected
• AML providers: not connected
• Hop1/Hop2 graph: planned
• Bridge tracing: planned
• Case forensics: planned

Risk score is limited beta. Planned modules do not affect score yet.
```

Do not write that AML, graph, bridge tracing, or case forensics affected a score until those modules are actually connected.

## 1.6 Message roles

### Owner messages

Owner messages are user-facing. They should:

- explain what happened;
- show risk line clearly;
- preserve copyable wallet/tx values;
- give one safe next action;
- avoid internal implementation jargon unless useful.

### Customer alert-admin messages

Customer alert admins are not service operators. They should receive the same user-facing card as the owner, not dense service-admin cards.

Differences allowed:

- mention that the watched wallet belongs to the owner;
- include recipient context if needed;
- preserve the same risk explanation and safe action block.

### Service-admin messages

Service-admin messages can be denser and more technical. They should include:

- user Telegram identity;
- watched wallet;
- sender/spender/receiver;
- score and level;
- reason codes or concise signals;
- tx hash;
- admin action buttons when applicable.

Service-admin copy can use uppercase risk labels and compact rows.

---

# Section 2: Message Templates

## 2.1 Risk line standard

User-facing risk line:

```text
🟢 Low risk · 10/100
⚠️ Medium risk · 45/100
🚨 High risk · 82/100
🚨 Critical risk · 95/100
```

If this is beta scoring, include beta near the score or interpretation:

```text
⚠️ Medium risk · 45/100 · beta
```

Service-admin risk line:

```text
🚨 Incoming USDT · HIGH · 82/100
🛡 Approval Guard · CRITICAL · 95/100
```

## 2.2 Owner incoming USDT alert

Purpose: tell the wallet owner that USDT arrived and whether the sender needs review.

Recommended structure:

```text
💸 Incoming USDT

⚠️ Medium risk · 45/100 · beta

Amount: 12 450.00 USDT
Wallet:
TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe

From:
TXSenderAddress...

Что это значит
Бот нашёл incoming USDT transfer на ваш watched wallet.
У sender есть risk signals from connected beta modules. Это не final compliance decision.

Почему бот предупреждает
• repeated split transfers in recent history
• address connected to internal needs_review label

Что сделать
1. Проверьте sender и tx перед тем, как считать оплату финальной.
2. Если sender неожиданный - сохраните tx hash для разбора.

Tx:
3e5bc9adcd5c935e1932cb20a661fd09fb0b87a60f60bc3adae567a82d748c95
```

LOW-risk compact variant:

```text
💸 Incoming USDT

🟢 Low risk · 10/100 · beta

Amount: 250.00 USDT
Wallet: TLhV...AgXe
From: TXSender...1234

No obvious risk signals from connected modules.

Tx:
3e5bc9adcd5c935e1932cb20a661fd09fb0b87a60f60bc3adae567a82d748c95
```

Rules:

- LOW can be compact.
- MEDIUM/HIGH/CRITICAL should include `Что это значит`, `Почему бот предупреждает`, and `Что сделать`.
- Do not say AML/graph/bridge modules affected the score unless connected.
- Customer alert admins receive this same user-facing card.

## 2.3 Service-admin incoming USDT alert

Purpose: give the service team enough detail for manual review and labeling.

Recommended structure:

```text
🚨 Incoming USDT · HIGH · 82/100

User: @username - tg_id: 123456789
Wallet: TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe
Sender: TXSenderAddress...
Amount: 12 450.00 USDT

Signals
• internal label: needs_review
• repeated split transfers
• fast transit pattern

Interpretation
Risky incoming transfer from connected beta modules. Not a final compliance decision.

Tx:
3e5bc9adcd5c935e1932cb20a661fd09fb0b87a60f60bc3adae567a82d748c95
```

Rules:

- Service admins receive technical cards for HIGH/CRITICAL where policy says so.
- Include user Telegram ID when available.
- Keep admin action buttons separate from the message body.
- Admin alert wording can be compact and English-heavy.

## 2.4 Digest alert

Purpose: group low-risk routine incoming alerts without hiding risky transfers.

Recommended structure:

```text
🧾 USDT digest · 10m

Wallet: TLhV...AgXe
Incoming transfers: 4
Total: 3 420.00 USDT
Highest risk: 🟢 Low · 18/100 · beta

Recent transfers
• 1 200.00 USDT from TXa...1111 · Low 10/100
• 820.00 USDT from TXb...2222 · Low 18/100
• 700.00 USDT from TXc...3333 · Low 12/100
• 700.00 USDT from TXd...4444 · Low 9/100

No MEDIUM/HIGH/CRITICAL transfer was grouped into this digest.
```

Rules:

- Risky transfers should still be sent immediately according to alert mode.
- Digest should not become a huge history report.
- Use compact rows and preserve at least tx links/buttons when available.

## 2.5 Approval Guard owner alert

Approval Guard already has the canonical security-alert structure defined in:

`docs/superpowers/specs/2026-05-23-approval-alert-message-design.md`

This style guide keeps that structure as canonical:

```text
🛡 Approval Guard

⚠️ Medium risk · 45/100

Найден активный USDT approval на вашем кошельке.

Wallet:
TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe

Spender:
TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5

Identity: tokenApprove
Type: smart contract
Allowance: unlimited USDT

Что это значит
Этот smart contract имеет разрешение списывать USDT через transferFrom.
Это не доказательство кражи, но approval стоит проверить, особенно если вы не узнаёте spender.

Почему бот предупреждает
• Spender определён как named smart contract: tokenApprove
• У контракта слабые provider metadata
• Нет явного service tag

Что сделать
1. Откройте TronScan approvals.
2. Подключите TronLink именно с этим кошельком.
3. Найдите USDT approval для этого spender.
4. Если не узнаёте разрешение - revoke/cancel.

Approval tx:
3e5bc9adcd5c935e1932cb20a661fd09fb0b87a60f60bc3adae567a82d748c95

🔒 Read-only: бот не подписывает транзакции, не просит seed/private key и не управляет средствами.
```

Rules:

- Keep type-aware meaning copy for `contract`, `eoa`, and `unknown`.
- Keep service-linked helper wording when `approval_temporally_linked_to_known_swap` is present.
- Keep drain-related wording serious but not overclaiming theft.
- Keep read-only footer as a standalone final block.

## 2.6 Service-admin Approval Guard alert

Recommended structure:

```text
🛡 Approval Guard · HIGH · 82/100

User: @username - tg_id: 123456789
Wallet: TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe
Token: USDT
Spender: TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5
Identity: tokenApprove
Type: smart contract
Allowance: unlimited

Signals
• Named smart contract: tokenApprove
• Weak provider metadata
• No service tag

Interpretation
Active USDT allowance exists on-chain.
This is not proof of theft. Treat as review-needed unless the spender is expected.

Approval tx:
3e5bc9adcd5c935e1932cb20a661fd09fb0b87a60f60bc3adae567a82d748c95

🔒 Read-only alert. Bot never signs transactions or asks for seed/private key.
```

## 2.7 Home and help screens

Home should be short and non-alarming:

```text
🛡 TRON Guard

Мониторинг TRON / USDT
📁 Watched wallets: 2
⚠️ Risk checks: limited beta
🔔 Alerts: incoming USDT + risk reasons

Выберите действие ниже.
```

Help should explain scope and boundaries:

```text
🛡 TRON Guard

Что умеет бот
• мониторит TRON wallets
• присылает incoming USDT alerts
• показывает wallet analytics
• считает limited beta risk score
• показывает Approval Guard / wallet safety where available

Risk score is limited beta. AML, graph, bridge tracing, and case forensics are planned/not connected unless shown as active.

🔒 Read-only: бот не просит seed/private key и не подписывает транзакции.

Commands: /add_wallet, /wallets, /check, /settings, /profile, /my_id.
```

## 2.8 Wallet dashboard screen

Purpose: quick operational state of one watched wallet.

Recommended order:

1. Wallet and monitoring status.
2. Last check / last result / alert mode.
3. Risk and safety summary.
4. Balances.
5. Flow and fees.
6. Data quality if partial/stale.

Template:

```text
📍 Wallet
TLhV...AgXe

🟢 Monitoring: active
🕒 Last check: 4 min ago
📡 Last result: no new transfers
🔔 Alerts: realtime

⚠️ Risk: Medium · 45/100 · beta
🛡 Wallet safety: review (1 unlimited approval)

💵 USDT: 12 450.00
🔋 TRX: 42.10

📊 30d flow
• In: 80 000.00 USDT
• Out: 67 500.00 USDT
• Gas/fees: 102.40 TRX (~$28.10)

Data quality: full
```

Rules:

- Stable section order matters more than maximum density.
- Do not mix security interpretation into analytics numbers.
- Keep wallet address copyable in HTML migration.

## 2.9 Analytics screen

Purpose: wallet metrics only, not security interpretation.

Template:

```text
📊 Analytics
Wallet: TLhV...AgXe

Balances
• USDT: 12 450.00
• TRX: 42.10

30d flow
• In: 80 000.00 USDT
• Out: 67 500.00 USDT
• Transfers: 38
• Gas/fees: 102.40 TRX (~$28.10)

Tx counts
• Total: 420
• Incoming: 220
• Outgoing: 200

Updated: 4 min ago
Data quality: full
```

Rules:

- Avoid risk words except neutral data quality.
- Energy/fee hints are allowed if clearly phrased as operational hints.

## 2.10 Risk intelligence screen

Purpose: explain score scope and module status.

Template:

```text
⚠️ Risk intelligence
Wallet: TLhV...AgXe

Current score: Medium · 45/100 · beta
Confidence: limited beta

Active reasons
• internal label: needs_review
• approval helper contract without strong provider metadata

Active modules
• Internal labels: active
• Incoming monitor: active
• USDT approvals: limited
• Wallet activity: limited

Planned / not connected
• AML providers: not connected
• Hop1/Hop2 graph: planned
• Behavioral patterns: planned
• Bridge tracing: planned
• Case forensics: planned

Score includes connected limited-beta modules only.
```

Rules:

- Planned modules must not appear as evidence.
- If no active reasons exist, say: `No active risk reasons from connected modules.`

## 2.11 Wallet safety screen

Purpose: actionable approval/outflow safety view.

Template:

```text
🛡 Wallet safety
Wallet: TLhV...AgXe

Status: review
USDT approvals: 3
Unlimited approvals: 1
Risky approvals: 1
Post-approval outflows: 0

Top risky spenders
• TNKG...xQ5
  HIGH · 80/100 · smart contract
  Identity: tokenApprove
  Allowance: unlimited USDT
  Session: linked to swap/bridge route

Contract intelligence
• TNKG...xQ5
  no service tag · not verified · medium activity
  methods: transferFrom, approve

Shadow observations
• none

What to do
1. Open TronScan approvals.
2. Connect TronLink with the watched wallet.
3. Find USDT approval for the spender.
4. Cancel approval if unexpected.

🔒 Read-only: бот не подписывает транзакции, не просит seed/private key и не управляет средствами.
```

Rules:

- `Top risky spenders` should be multi-line cards, not long one-line rows.
- Show spender type precisely: EOA wallet, smart contract, or unknown.
- Show session context when available.
- Revoke instructions must stay external and user-controlled.

## 2.12 Settings, profile, Telegram ID, and alert admins

Settings template:

```text
⚙️ Settings

🔔 Owner alerts: all incoming
🛡 Service admins: HIGH / CRITICAL
👥 Alert admins: 2
🌐 Language: RU / EN mixed

🔒 Бот read-only: не просит seed/private key и не подписывает транзакции.
```

Profile template:

```text
👤 Profile

User: @username
Telegram ID:
123456789

📁 Watched wallets: 2
🇷🇺🇺🇸 Language: RU / EN

Для подключения alert admin используйте /my_id.
```

Alert admins template:

```text
👥 Alert admins

• Telegram ID: 123456789
  Mode: MEDIUM/HIGH/CRITICAL alerts only

• Telegram ID: 987654321
  Mode: all incoming alerts

Owner получает все входящие. Extra admins получают best-effort alerts.
```

Rules:

- Telegram IDs should be copyable in HTML migration.
- Commands should be copyable.
- Avoid dense `id - mode` rows once migrating screens.

## 2.13 Prompts and errors

Prompts can remain plain and short:

```text
Send a TRON wallet address to add monitoring.
```

```text
Send a TRON address to check risk score and reasons.
```

Errors should be direct and actionable:

```text
Usage: /check <TRON-address-or-tx-hash>
```

```text
Send a numeric Telegram ID, optionally followed by all or suspicious_only.
```

Rules:

- Prompts do not need heavy card formatting.
- If a prompt contains a command, use `<code>` after HTML migration.
- Do not add risk/safety disclaimers to every tiny validation error.

---

# Section 3: Formatting Rules, HTML/Plain Text Migration, and Acceptance Criteria

## 3.1 Formatting rules

### Message hierarchy

Each message should have a predictable structure:

```text
[emoji] Title / Context

Status summary

Key facts

Interpretation / explanation

Action block

Evidence / tx / links

Read-only footer, if security-related
```

Not every message needs every block, but the order should remain stable.

Example:

```text
🛡 Wallet safety
Wallet: <code>TLhV...AgXe</code>

Status: review
Risky approvals: 1

Top risky spenders
• <code>TNKG...xQ5</code>
  HIGH · 80/100 · EOA wallet
  Allowance: unlimited USDT

What to do
1. Open TronScan approvals.
2. Revoke only if unexpected.

🔒 Read-only: бот не подписывает транзакции, не просит seed/private key и не управляет средствами.
```

## 3.2 HTML formatting standard

### Allowed HTML tags

Use a minimal safe Telegram HTML subset:

- `<b>...</b>` for headings, labels, and risk-line emphasis.
- `<code>...</code>` for copy-sensitive values.
- `<a href="...">...</a>` only when text links are required. Prefer inline keyboard links for main actions.
- Avoid complex nested tags.

### Values that must use `<code>`

Always render these as `<code>` after HTML migration:

- TRON wallet addresses.
- Spender addresses.
- Sender/receiver addresses.
- Transaction hashes.
- Telegram IDs.
- Timestamps.
- Method names: `transferFrom`, `tokenApprove`.
- Bot commands: `/add_wallet`, `/check`, `/settings`.
- Raw technical identifiers: risk reason codes, provider names, contract method IDs.

Examples:

```text
Wallet:
<code>TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe</code>

Tx:
<code>3e5bc9adcd5c935e1932cb20a661fd09fb0b87a60f60bc3adae567a82d748c95</code>
```

### Values that should use `<b>`

Use `<b>` for:

- main headings;
- risk summary;
- field labels in dense admin cards;
- section headings.

Example:

```text
🛡 <b>Approval Guard</b>

⚠️ <b>Medium risk · 45/100</b>

<b>Wallet:</b>
<code>TLhV...</code>
```

### Dynamic values escaping

All values from external sources must be escaped before insertion into HTML:

- `&` to `&amp;`
- `<` to `&lt;`
- `>` to `&gt;`
- `"` to `&quot;`

This applies to:

- wallet/spender/sender/receiver;
- identity/provider metadata;
- reason messages;
- user names;
- token names;
- timestamps;
- tx hashes;
- admin IDs.

Do not do this:

```ts
`<code>${input.spenderIdentity}</code>`
```

Do this through a helper:

```ts
htmlCode(input.spenderIdentity)
```

## 3.3 Plain text standard

Not every message has to migrate to HTML immediately. Plain text must still follow the same card rules.

Plain text fallback:

```text
🛡 Wallet safety
Wallet: TLhV...AgXe

Status: review
Risky approvals: 1

Top risky spenders
• TNKG...xQ5
  HIGH · 80/100 · EOA wallet
  Allowance: unlimited USDT

Bot is read-only. It never signs transactions or asks for seed/private key.
```

Plain text rules:

- Do not use Markdown table syntax.
- Do not use complex MarkdownV2.
- Use bullets `•` for user-facing blocks.
- `-` is acceptable for internal/admin dense lists, but should gradually be replaced with `•` where user-facing.
- Put addresses and tx hashes on separate lines when convenient for copying.
- Split long technical strings into 2-3 lines.

## 3.4 Telegram length and truncation rules

Telegram hard limit: 4096 characters.

The project should keep a safe cap around 3900 characters, matching the current Approval Guard HTML alert behavior.

Rules:

- User-facing alerts must not exceed the safe cap.
- Truncation must remove whole lines or sections.
- Never cut inside `<b>`, `<code>`, or an HTML entity.
- Read-only footer and tx hash must be preserved in security alerts.
- If a message is shortened, show an explicit notice:

```text
… message shortened to fit Telegram limit.
```

Truncation preservation priority:

1. Title.
2. Risk summary.
3. Wallet / spender / sender / amount.
4. Main interpretation.
5. Tx hash.
6. Read-only footer.
7. Optional reasons/details can be shortened first.

## 3.5 Copy and tone rules

### Do

- Write calmly and precisely.
- Separate fact, interpretation, and action.
- Say `review-needed`, `possible`, `appears linked`, or `limited beta` when evidence is not final.
- Clearly say `limited beta` when a module is limited.
- Preserve RU/EN mixed style.

### Do not

- Do not write `кража подтверждена` unless explicit policy/evidence allows it.
- Do not write vague `адрес/контракт` if `spenderType` is known.
- Do not mix the read-only disclaimer with risk interpretation.
- Do not promise AML/graph/bridge tracing if the module is not connected.
- Do not instruct the user to sign a transaction inside the bot. Use external review wording: `open TronScan/TronLink and review/revoke if unexpected`.

## 3.6 Risk copy standard

Unified risk lines:

```text
🟢 Low risk · 10/100
⚠️ Medium risk · 45/100
🚨 High risk · 82/100
🚨 Critical risk · 95/100
```

For user-facing messages:

- Use `Low / Medium / High / Critical` in title case.
- Add `· beta` if the score comes from dashboard/risk-intel beta scoring.

For admin-facing messages, uppercase is acceptable:

```text
🚨 Incoming USDT · HIGH · 82/100
🛡 Approval Guard · CRITICAL · 95/100
```

Risk explanation always stays separate from score:

```text
Почему бот предупреждает
• Unlimited USDT approval to EOA wallet
• No service tag
• Nearby post-approval outflow
```

## 3.7 Button / inline keyboard rules

Text message and buttons should complement each other.

Good message explanation:

```text
Что сделать
1. Откройте TronScan approvals.
2. Найдите USDT approval для этого spender.
3. Если не узнаёте разрешение - revoke/cancel.
```

Good buttons:

```text
🛡 Review / Revoke approval
Open approval tx
Open spender
Open wallet
```

Rules:

- Inline keyboard does not replace explanation.
- Button labels should be short.
- Primary action goes first.
- Destructive wording should be cautious: prefer `Review / Revoke approval`, not `Revoke now`.
- For risk checks: `🔍 Check sender`.
- For tx: `🔗 Open tx`.
- For navigation: `⬅️ Wallet`, `📁 Wallets`, `⬅️ Menu`.

## 3.8 HTML/plain text migration plan

### Current state

- `Approval Guard` alerts already use HTML parse mode.
- `Incoming USDT` alerts are still plain text.
- `src/bot/messages.ts` screens are still plain text.
- `replyOrEdit` in bot UI currently passes only `reply_markup`, without `parse_mode`.

### Migration principle

Do not do a big-bang migration. Migrate in layers.

### Phase A - shared formatting helpers

Create or extract a common Telegram formatting layer:

```text
src/messages/telegramFormat.ts
```

Responsibilities:

- `escapeHtml`
- `htmlText`
- `htmlCode`
- `sanitizePlainText`
- `formatRiskLine`
- `formatRiskIcon`
- `formatSection`
- `formatBulletList`
- `capTelegramPlainMessage`
- `capTelegramHtmlMessage`

Acceptance:

- Approval Guard keeps current HTML safety.
- Existing tests remain green.

### Phase B - alerts to HTML

Migrate alert stream to HTML:

- `formatUserIncomingAlert`
- `formatAdminSuspiciousAlert`
- digest alert
- keep `formatUserApprovalAlert`
- keep `formatAdminApprovalAlert`

Update delivery options:

- owner incoming alerts: `parse_mode: "HTML"`
- customer admin incoming alerts: `parse_mode: "HTML"`
- service admin incoming alerts: `parse_mode: "HTML"`
- digest, if HTML: `parse_mode: "HTML"`

Acceptance:

- Inline keyboards are preserved.
- HTML escaping is covered by tests.
- Tx/address values remain copyable.
- Telegram safe cap is preserved.

### Phase C - bot screens to HTML

Migrate user-facing screens:

- `homeMessage`
- `helpMessage`
- `dashboardMessage`
- `analyticsMessage`
- `securityMessage` / risk intel
- `safetyMessage`
- `settingsMessage`
- `profileMessage`
- `alertAdminsMessage`
- prompts where useful

Update `replyOrEdit` so it can accept message options:

```ts
replyOrEdit(ctx, message, {
  parse_mode: "HTML",
  reply_markup: keyboard
});
```

Safer sequence:

1. Add options support to `replyOrEdit`.
2. Keep existing keyboard-only call sites working.
3. Migrate screen-by-screen.

Acceptance:

- Callback navigation works.
- `editMessageText` receives the same parse mode as `reply`.
- Plain prompts/errors do not break.
- Bot message tests are updated.

### Phase D - cleanup / consistency pass

After migration:

- Remove duplicated helpers from `src/alerts/formatters.ts`.
- Align bullets and section names with this style guide.
- Replace long one-line safety/risky spender rows with multi-line cards.
- Update README/docs with `Telegram message style guide`.

## 3.9 Acceptance criteria for the whole spec

### General

- All bot screens and alerts follow the same card hierarchy.
- No Telegram tables.
- No MarkdownV2 dependency.
- All dynamic HTML values are escaped.
- All copy-sensitive values are displayed in `<code>` after HTML migration.
- Risk labels are unified.
- Security-related messages have a standalone read-only footer.
- Planned/not-connected modules are clearly separated from active modules.
- User-facing copy does not overclaim theft/fraud.

### Alerts

- Incoming USDT user alert uses rich card format.
- Incoming service-admin alert uses dense technical card.
- Approval Guard user alert remains canonical security alert.
- Approval Guard service-admin alert remains dense technical alert.
- Digest alert uses compact summary card.
- Customer alert admins receive the same user-facing card, not an admin-dense card.
- Service admins receive technical cards only for HIGH/CRITICAL where policy says so.

### Screens

- Home is short and non-alarming.
- Dashboard shows monitoring, risk, safety, balances, and flow in stable order.
- Analytics does not mix numbers with security interpretation.
- Safety screen shows approvals/outflows as actionable cards.
- Risk intel honestly shows active vs not connected modules.
- Settings/Profile/Alert admins use copyable Telegram IDs and commands after HTML migration.

### Safety

- No message asks for seed/private key.
- No message says or implies that the bot can revoke/sign/control funds.
- Revoke wording always goes through user-controlled external review:
  - `Open TronScan approvals`
  - `Connect TronLink`
  - `Revoke/cancel if unexpected`
- No automatic signing flow is implied.

### Tests

Minimum tests:

- Formatter tests for:
  - user incoming HTML;
  - admin incoming HTML;
  - digest;
  - Approval Guard regression;
  - safety dashboard;
  - risk intel;
  - HTML escaping;
  - truncation safety.

- Delivery tests for:
  - `parse_mode: "HTML"` passed with inline keyboard;
  - `replyOrEdit` preserves parse mode on `reply` and `editMessageText`.

- Full checks:
  - `npm run typecheck`
  - `npm test`

## 3.10 Spec implementation boundary

This is a message design spec, not a risk-scoring spec.

Out of scope:

- new AML providers;
- graph forensics;
- revoke automation;
- wallet signing;
- new database schema;
- new Telegram commands except those needed for formatting options.

In scope:

- message structure;
- copy policy;
- HTML/plain migration;
- formatter boundaries;
- tests;
- README/docs update.

---

## Implementation Plan Handoff

A follow-up implementation plan should be saved separately under:

```text
docs/superpowers/plans/YYYY-MM-DD-telegram-message-style-guide.md
```

The implementation plan should convert this spec into small, test-driven tasks:

1. extract shared Telegram formatting helpers;
2. migrate incoming and digest alert formatters to HTML;
3. propagate `parse_mode: "HTML"` through alert delivery;
4. add `replyOrEdit` options support;
5. migrate bot screens one group at a time;
6. update tests and docs;
7. run `npm run typecheck` and `npm test`.
