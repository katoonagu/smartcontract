# Theft Report Flow Design

Date: 2026-05-27

## Context

The Telegram bot currently supports wallet monitoring, address checks, transaction checks, internal labels, and limited-beta risk scoring. The requested feature adds a new main-menu path for victims to quickly submit a paid preliminary theft report from a TRON USDT transaction hash.

The source product note is `docs/research/2026-05-27-telegram-bot-cooperation-audio-notes.md`. The key constraint from that document is speed without mixing report intake with final proof: a paid report can create a strong operational signal, but the bot must preserve the distinction between a user-paid preliminary claim and confirmed evidence.

## Decision

Use a new `reported_scam` label for the receiving wallet after the user confirms a 1000 USDT deposit step. `reported_scam` is a strong critical-risk label, equivalent in score impact to `scam`, but it must render as a paid preliminary theft report rather than a confirmed scam label.

The sender wallet from the theft transaction receives a `victim` label. This label identifies the reported victim wallet for case context and should not be treated as negative risk evidence against the victim.

## User Flow

The main menu gains a new `Сообщить о краже` button.

1. User taps `Сообщить о краже`.
2. Bot sets a pending theft-report transaction state and asks for a TRON transaction hash.
3. Bot shows the same `Отмена` button pattern used by address and transaction checks.
4. User sends a transaction hash.
5. Bot loads the transaction and extracts the official TRON USDT transfer sender, receiver, and amount.
6. Bot creates or updates a draft theft report and shows a report card:

```text
Сообщить о краже

С этого кошелька:
<sender>

Ушла сумма:
<amount> USDT

На кошелек:
<receiver>

Tx:
<hash>

Комментарий:
не указан
```

7. The report card has buttons: `Подтвердить`, `Изменить tx`, `Добавить комментарий`, `Отмена`.
8. `Добавить комментарий` switches to a pending comment state. After the user sends text, the bot updates the report comment and shows the report card again.
9. `Изменить tx` switches back to transaction-hash input for the same report.
10. `Отмена` clears the pending theft-report flow and returns to the home menu.
11. `Подтвердить` moves the report to the deposit step and asks the user to send `1000 USDT` to the configured deposit wallet.
12. The deposit step has buttons: `Отправлено`, `Отмена`.
13. In the MVP, `Отправлено` uses a deposit-confirmation stub and treats the deposit as received.
14. After deposit confirmation, the bot stores labels:
    - sender wallet: `victim`
    - receiver wallet: `reported_scam`
15. Bot sends the next-step message:
    - the report has been accepted as a paid preliminary signal;
    - to confirm the case, the user must prepare and provide a formal statement/documents;
    - after receiving documents, the service can help with tracing and freezing attempts;
    - the service fee is `20%` of the deposit.
16. The final message has buttons: `Инструкция`, `Связаться с админом`.

## Data Model

Add a dedicated `theft_reports` table instead of storing report state only in Telegram session rows.

Fields:

- `id`
- `telegram_user_id`
- `tx_hash`
- `victim_address`
- `reported_scam_address`
- `amount_raw`
- `amount_usdt`
- `comment`
- `status`
- `deposit_address`
- `deposit_amount_usdt`
- `created_at`
- `updated_at`

Allowed statuses:

- `draft`
- `awaiting_deposit`
- `deposit_confirmed`
- `documents_requested`
- `cancelled`

Add `selected_theft_report_id` to `telegram_user_sessions`. This keeps pending comment and transaction replacement flows explicit instead of overloading `selected_wallet_id`.

Add labels:

- `reported_scam`
- `victim`

`reported_scam` must be accepted anywhere existing risk labels are parsed: type definitions, repository validation, database constraints, label list, and risk evaluation. `victim` must also be accepted by storage, but risk evaluation should not treat it as suspicious.

## Configuration

The MVP uses one configured deposit wallet for all reports. The report row still stores the assigned `deposit_address`, so the implementation can later switch to per-report deposit wallets without changing the user-facing flow.

The `Инструкция` button opens a configured guide URL when available. If the URL is not configured, the bot sends an inline instruction message explaining what documents to prepare and how to prove wallet ownership.

The `Связаться с админом` button sends a contact message using the existing service-admin configuration. If no direct admin contact is configured, the bot tells the user that an admin will review the report and includes the report id.

## Bot Components

### Keyboards

Add callback kinds:

- `theft_start`
- `theft_confirm`
- `theft_change_tx`
- `theft_comment`
- `theft_cancel`
- `theft_deposit_sent`
- `theft_guide`
- `theft_admin`

Callbacks that operate on a stored report include the report id in callback data.

### Pending Actions

Add pending actions:

- `report_theft_tx`
- `report_theft_comment`

Both actions must be cleared by `Отмена`, `/start`, `/wallets`, and navigation away from the flow, matching the existing stale-pending-action behavior.

### Messages

Add message builders for:

- theft transaction prompt;
- invalid transaction hash;
- transaction parse failure;
- report card;
- deposit request;
- deposit-confirmed next steps;
- instruction fallback;
- admin contact fallback.

All user-facing messages must use the current locale pattern. Russian copy is primary; English copy can mirror the same behavior.

### Transaction Parsing

The existing transaction-check logic can extract the sender from `trc20TransferInfo`. Theft reports need a richer extractor that returns:

- sender;
- receiver;
- amount raw;
- formatted amount;
- tx hash.

The extractor must only trust the official TRON USDT contract address. It must not accept token abbreviation alone.

## Risk Policy

`reported_scam` is critical-risk evidence:

- score impact should match `scam`;
- level should be `CRITICAL`;
- rendered reason must say this is a paid preliminary theft report;
- rendered reason must not say `confirmed scam`, `fraud proven`, or similar final-proof language.

`victim` is case context:

- no negative score impact;
- can be displayed as internal context if useful;
- must not make the victim wallet look unsafe.

## Error Handling

Invalid transaction hash:

- keep the user in `report_theft_tx`;
- ask for a valid TRON transaction hash;
- keep the `Отмена` button.

Transaction lookup or parsing failure:

- explain that the bot could not read an official TRON USDT transfer from the tx;
- keep the user in `report_theft_tx`;
- keep the `Отмена` button.

Missing report on callback:

- clear pending state;
- return to home with a short message that the report was not found or expired.

Duplicate deposit confirmation click:

- make the action idempotent;
- show the already-confirmed next-step message without duplicating labels.

Comment too long:

- trim to a bounded limit before storing or reject with a short message. The implementation should choose one consistent behavior and cover it with a test.

## Testing

Add bot tests for:

- `Сообщить о краже` exists in the main menu;
- starting the flow sets pending transaction input and shows `Отмена`;
- invalid tx keeps the flow active;
- valid tx displays sender, receiver, amount, tx, and empty comment;
- adding a comment updates the report card;
- changing tx updates the draft report;
- `Подтвердить` displays the 1000 USDT deposit step and `Отправлено`;
- `Отправлено` stores `victim` and `reported_scam`;
- `/check <reported_scam_address>` returns critical risk with paid preliminary report wording;
- `/check <victim_address>` does not become critical from `victim`;
- `Отмена` clears pending state and returns home;
- repeated `Отправлено` is idempotent.

Add lower-level tests for transaction extraction:

- extracts sender, receiver, and amount from official TRON USDT transfer info;
- prefers official USDT transfer when several token transfers exist;
- rejects token-abbreviation-only spoofing;
- rejects tx without a usable receiver or amount.

## Deferred Work

The MVP does not implement real deposit monitoring, per-report deposit wallets, document upload storage, admin review workflow, law-enforcement cabinet, or automated contact routing to monitored receiver wallets. The data model and statuses leave room for those additions without changing the initial user flow.

## Self-Review

- Placeholder scan: no unresolved placeholder values are required for implementation; configurable URLs and contacts have defined fallback behavior.
- Consistency check: the UX, data model, callbacks, and risk policy all use `reported_scam` as a critical preliminary label and keep `scam` reserved for stronger confirmed evidence.
- Scope check: this is a single Telegram bot feature with one new report table, two labels, and a deposit stub. Larger cooperation-network work remains deferred.
- Ambiguity check: the report card omits the draft-status line by design, and the deposit confirmation button is named `Отправлено`.
