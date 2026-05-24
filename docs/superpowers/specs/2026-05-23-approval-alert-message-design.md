# Approval Guard Telegram Alert Message Design

Date: 2026-05-23

## Summary

Redesign Approval Guard Telegram alerts so users can quickly understand:

1. what was found;
2. how risky it is;
3. whether the spender is an EOA or smart contract;
4. why the bot is warning;
5. what action to take;
6. that the bot is read-only and never asks for secrets.

Use a stable card-like message structure. The structure should stay consistent across different Approval Guard cases, while specific wording changes based on spender type, risk level, and route/session context.

## Goals

- Make user alerts easier to scan on Telegram.
- Keep addresses and transaction hashes monospaced/copyable.
- Make risk level visible at the top.
- Explain the meaning in plain language without overclaiming theft.
- Use spender type precisely: never write vague `address/contract` copy when `spenderType` is known.
- Keep read-only safety copy in a separate section, not mixed into the risk interpretation.
- Use a denser, more technical variant for admin alerts.

## Non-Goals

- No change to risk scoring rules.
- No automatic revoke/signing flow.
- No new blockchain data fetches.
- No redesign of all bot screens in this phase.
- No claim that an approval is theft by itself.

## Formatting Requirements

Telegram output should support bold labels and monospaced values.

Preferred parse mode: HTML, because escaping dynamic text is straightforward and avoids Telegram MarkdownV2 pitfalls with underscores, dots, hyphens, and hashes.

Required escaping:

- Escape all dynamic text used inside HTML: wallet, spender, identity, reasons, tx hash, token, risk level, timestamps.
- Use `<b>...</b>` for headings and important labels.
- Use `<code>...</code>` for addresses, transaction hashes, timestamps, `transferFrom`, and other copy-sensitive values.
- Keep message under Telegram limits using existing cap/truncation behavior.

If parse mode is not introduced in this implementation, preserve the same section structure in plain text and add parse mode in a later pass.

## User Alert Structure

Recommended user alert structure:

```text
🛡 Approval Guard

⚠️ Medium risk · 45/100

Найден активный USDT approval на вашем кошельке.

Wallet:
`TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe`

Spender:
`TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5`

Identity: tokenApprove
Type: smart contract
Allowance: unlimited USDT

## Что это значит

Этот smart contract имеет разрешение списывать USDT через `transferFrom`.

Это не доказательство кражи, но approval стоит проверить, особенно если вы не узнаёте spender.

## Почему бот предупреждает

• Spender определён как named smart contract: `tokenApprove`
• У контракта слабые provider metadata
• Нет явного service tag

## Время

On-chain: `2026-05-05 13:42:21 UTC`
Signed: `2026-05-05 13:42:15 UTC`
Expires: `2026-05-05 23:42:15 UTC`

## Что сделать

1. Откройте TronScan approvals.
2. Подключите TronLink именно с этим кошельком.
3. Найдите USDT approval для этого spender.
4. Если не узнаёте разрешение — revoke/cancel.

Approval tx:
`3e5bc9adcd5c935e1932cb20a661fd09fb0b87a60f60bc3adae567a82d748c95`

🔒 Read-only: бот не подписывает транзакции, не просит seed/private key и не управляет средствами.
```

HTML-rendered implementation should use equivalent sections with bold headings instead of literal Markdown headings if needed.

## Type-Aware Meaning Copy

The `Что это значит` block must depend on `spenderType`.

### Smart contract spender

Use when `spenderType === "contract"`:

```text
Этот smart contract имеет разрешение списывать USDT через `transferFrom`.

Это не доказательство кражи, но approval стоит проверить, особенно если вы не узнаёте spender.
```

### EOA spender

Use when `spenderType === "eoa"`:

```text
Этот обычный кошелёк / EOA-адрес имеет разрешение списывать USDT через `transferFrom`.

Обычный кошелёк редко должен быть spender’ом для USDT approval. Если вы не узнаёте этот адрес — разрешение стоит срочно проверить.
```

### Unknown spender type

Use when `spenderType` is missing or unknown:

```text
Тип spender не удалось надёжно определить, но активный USDT approval найден on-chain.

Если вы не узнаёте этот spender — разрешение стоит проверить вручную.
```

## Context-Aware Meaning Copy

The same card structure stays stable, but copy can adapt to known risk context.

### Service-linked helper approval

Use when reasons include `approval_temporally_linked_to_known_swap`:

```text
Этот smart contract имеет разрешение списывать USDT через `transferFrom`.

Похоже, approval связан со swap/bridge route. Это снижает риск, но не делает разрешение безопасным навсегда. Если операция была ожидаемой — проверьте, нужно ли оставить allowance активным.
```

### Confirmed or possible collector drain

Use when reasons indicate confirmed drain behavior or possible collector drain:

```text
Этот spender связан с поведением, похожим на вывод средств через `transferFrom`.

Это серьёзный сигнал. Проверьте approval и историю списаний. Если операция не ваша — отмените allowance и сохраните tx hash для разбора.
```

Drain-specific copy must not say "theft confirmed" unless the risk engine has explicit evidence and product policy allows that wording.

## Risk Level Presentation

At the top, show risk as:

```text
⚠️ Medium risk · 45/100
```

Use level-aware icons:

- LOW: `🟢 Low risk · N/100`
- MEDIUM: `⚠️ Medium risk · N/100`
- HIGH: `🚨 High risk · N/100`
- CRITICAL: `🚨 Critical risk · N/100`

Use title case for English risk labels in the user-facing card.

## Field Rules

Always show when available:

- Wallet
- Spender
- Identity
- Type
- Allowance
- Risk level/score
- Reasons
- Approval tx
- Safety note

Show timing section only when at least one timing field exists:

- On-chain
- Signed
- Expires

If a timing field is missing, omit that row instead of showing `unknown`.

If identity is missing, show:

```text
Identity: unknown
```

If allowance is unlimited, show:

```text
Allowance: unlimited USDT
```

If allowance is finite, show the decoded value when available.

## Reasons Section

User alert heading:

```text
Почему бот предупреждает
```

Rules:

- Keep the existing max reason count.
- Use bullet `•` instead of `-` for better Telegram readability.
- Monospace short technical tokens inside reasons when possible, e.g. `tokenApprove`, `transferFrom`.
- Do not overtranslate provider/source names.

## Action Section

Use one stable action block for user alerts:

```text
Что сделать

1. Откройте TronScan approvals.
2. Подключите TronLink именно с этим кошельком.
3. Найдите USDT approval для этого spender.
4. Если не узнаёте разрешение — revoke/cancel.
```

If inline buttons already include TronScan links, the text can still stay because it explains the expected user action.

## Safety Note

Keep safety note separate at the end:

```text
🔒 Read-only: бот не подписывает транзакции, не просит seed/private key и не управляет средствами.
```

Do not put this sentence inside `Что это значит`; it is product trust/safety copy, not risk interpretation.

## Admin Alert Structure

Admin alerts should be denser and more technical:

```text
🛡 Approval Guard · MEDIUM · 45/100

Wallet: `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe`
Token: USDT
Spender: `TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5`
Identity: tokenApprove
Type: smart contract
Allowance: unlimited

On-chain: `2026-05-05 13:42:21 UTC`
Signed: `2026-05-05 13:42:15 UTC`
Expiration: `2026-05-05 23:42:15 UTC`

Signals
• Named smart contract: `tokenApprove`
• Weak provider metadata
• No service tag

Interpretation
Active USDT allowance exists on-chain.
This is not proof of theft. Treat as review-needed unless the spender is expected.

Approval tx:
`3e5bc9adcd5c935e1932cb20a661fd09fb0b87a60f60bc3adae567a82d748c95`

🔒 Read-only alert. Bot never signs transactions or asks for seed/private key.
```

Admin alerts can keep English-heavy wording because they are for operators. User alerts should be clearer and can remain RU/EN mixed.

## Implementation Notes

- Current formatter lives in `src/alerts/formatters.ts`.
- Current user Approval Guard formatter is `formatUserApprovalAlert`.
- Current admin Approval Guard formatter is `formatAdminApprovalAlert`.
- Current send paths pass plain text to `bot.api.sendMessage`; implementation must either pass `parse_mode: "HTML"` for these alerts or intentionally keep plain text for now.
- If parse mode is added only for approval alerts, make sure alert send options still preserve existing inline keyboards.
- Existing tests under `tests/alerts/formatters.test.ts` should be updated with snapshot-like expectations for user/admin Approval Guard messages.

## Acceptance Criteria

- User Approval Guard alert uses the approved card structure.
- Admin Approval Guard alert uses the approved dense technical structure.
- Meaning copy is precise for `contract`, `eoa`, and `unknown` spender types.
- Service-linked helper copy preserves the same card format but changes interpretation text.
- Read-only safety copy appears as a separate final section.
- Dynamic addresses and tx hashes remain copyable and visually distinct.
- Formatter tests cover at least contract, EOA, unknown, and service-linked cases.
- `npm run typecheck` and `npm test` pass.
