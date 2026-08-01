# Theft Reports Admin Workspace Design

Date: 2026-07-08

## Context

The Telegram bot already has a `Сообщить о краже` flow. A user submits a TRON
USDT transaction hash, the bot extracts the official USDT transfer, creates a
`theft_reports` row, optionally stores a user comment, moves through the deposit
step, and then marks the victim wallet as `victim` and the receiver as
`reported_scam`.

The existing data is enough for an Admin intake workspace:

- victim wallet;
- reported receiver wallet;
- transaction hash;
- amount;
- user comment;
- Telegram user id;
- bot/payment status;
- deposit address and amount;
- created and updated timestamps.

The deferred work from the original theft-report flow was a full admin review
workflow. This design adds the first admin workspace without turning it into a
case-management system.

## Decision

Add a new Russian-language Admin workspace:

```text
Заявки о краже
```

It appears beside the existing Admin navigation:

```text
Forensics | Wallet Intelligence | Заявки о краже
```

The workspace is an analyst queue for preliminary theft reports. It must not
claim that a theft is proven. It shows the user's paid preliminary claim, the
transaction facts extracted by the bot, and the internal processing state.

## Product Boundaries

The workspace answers:

```text
Какие заявки о краже пришли, что в них заявлено, в каком они внутреннем статусе,
и что админу нужно открыть или скопировать для работы?
```

It does not answer:

```text
Кража доказана?
```

Forensic proof still belongs in the existing Forensics graph, Wallet
Intelligence, TronScan evidence, and later analyst process. The new workspace
links to those tools but does not create a new proof surface.

The workspace does not launch new forensic jobs in the MVP. Starting jobs from
this screen would add product questions about which check to run, how to show
progress, and how to attach a result to a report. The first version keeps this
screen as an intake and processing queue.

Admin status changes do not send Telegram notifications. They are internal
processing state only.

## Admin Workflow

The internal admin workflow is separate from the bot's technical status.

Admin statuses:

- `new` — `Новая`;
- `awaiting_payment` — `Ждет оплату`;
- `awaiting_documents` — `Ждет документы`;
- `in_progress` — `В работе`;
- `escalated` — `Передано / эскалация`;
- `closed` — `Закрыта`;
- `cancelled` — `Отменена`.

The bot status remains the existing `theft_reports.status` value:

- `draft`;
- `awaiting_deposit`;
- `deposit_confirmed`;
- `documents_requested`;
- `cancelled`.

Admin UI can display both values, but the primary queue state is the admin
status. This prevents raw bot implementation states from becoming the analyst's
workflow.

## Data Model

Extend the existing `theft_reports` table instead of adding a new case desk or
event log.

New columns:

- `admin_status text not null default 'new'`;
- `admin_note text`;
- `admin_updated_at timestamptz`.

No audit/event table is added in the MVP. The known ceiling is that the system
does not keep a history of status or note changes. If audit history becomes
required, the upgrade path is a `theft_report_events` table.

ponytail: the MVP keeps only the latest internal admin state. The ceiling is no
change history; the upgrade path is an event log.

No `admin_closed_at` column is needed for the MVP. `admin_updated_at` is enough
for sorting and freshness.

## Repository API

Add repository functions:

- `listTheftReports(input)`;
- `updateTheftReportAdminState(db, input)`;
- reuse `getTheftReport(db, id)` where possible.

`listTheftReports(input)` supports:

- `limit`;
- `offset`;
- `adminStatus`;
- `botStatus`;
- `query`.

`query` searches useful intake fields:

- report id;
- Telegram user id;
- transaction hash;
- victim address;
- reported receiver address;
- user comment;
- admin note.

`updateTheftReportAdminState` accepts only:

- `adminStatus`;
- `adminNote`.

It must not mutate transaction facts, user comment, bot status, addresses, amount,
deposit fields, or labels.

Validation:

- `adminStatus` must be one of the allowed internal statuses;
- `adminNote` is trimmed and capped at a reasonable MVP limit, currently 2000
  characters;
- invalid input returns a normal validation error from the API.

## Admin API

Add routes:

- `GET /admin/theft-reports`;
- `GET /admin/api/theft-reports`;
- `GET /admin/api/theft-reports/:id`;
- `PATCH /admin/api/theft-reports/:id/admin-state`.

The API remains protected by the existing Admin token behavior.

`GET /admin/api/theft-reports` returns a list payload with mapped Russian labels
or enough raw fields for the UI to map labels locally. The implementation should
reuse the existing Admin JSON conventions.

`PATCH /admin/api/theft-reports/:id/admin-state` updates only the internal admin
state. It does not send Telegram messages.

## Admin UI

The workspace route is:

```text
/admin/theft-reports
```

The UI language for this workspace is Russian.

Layout:

- header with `Заявки о краже`, counters, and `Обновить`;
- filters for search, admin status, bot status, and limit;
- left/main queue list with compact report rows;
- right drawer/card with selected report details and actions.

Queue row fields:

- amount;
- admin status;
- bot status;
- short victim address;
- short reported receiver address;
- Telegram user id;
- relative or readable updated time.

Selected card sections:

- `Факты транзакции`: victim, receiver, tx hash, amount;
- `Пользователь`: Telegram user id and user comment;
- `Оплата / бот`: bot status, deposit address, deposit amount, created and
  updated times;
- `Обработка`: admin status select, `Внутренняя заметка`, `Сохранить`;
- `Действия`: copy data and open related tools.

Actions:

- copy a compact report block;
- open victim address in the existing Forensics workspace;
- open receiver address in the existing Forensics workspace;
- open victim address in Wallet Intelligence;
- open receiver address in Wallet Intelligence;
- open transaction in TronScan.

The UI must avoid wording such as `кража подтверждена`. Acceptable wording:

- `заявка`;
- `предварительное сообщение`;
- `заявленный адрес получателя`;
- `внутренняя обработка`.

## Empty And Error States

Show clear Russian states for:

- no reports exist;
- filters match no reports;
- selected report was not found;
- API request failed;
- save failed due to invalid status or stale report.

## Testing

Add focused tests:

- repository list/filter/search for theft reports;
- repository update of admin status and note;
- invalid admin status rejection;
- Admin server route for `/admin/theft-reports`;
- Admin API list/detail/PATCH routes;
- Admin console contains the Russian nav item, workspace, filters, card, PATCH
  endpoint, and does not add a theft-report forensic-job launcher.

Run:

```powershell
npm test -- tests/storage/repositories.test.ts tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts
npm run typecheck
```

The exact focused test set may be adjusted during implementation if existing
test files are split differently.

## Documentation

Implementation must update `docs/knowledge/08-admin-and-bot-ux.md`, because this
changes Admin UX. The knowledge note should say that Admin has a Russian
`Заявки о краже` workspace for preliminary theft reports, with internal status
and note fields that do not constitute forensic proof and do not send Telegram
notifications.

## Deferred Work

Deferred:

- document upload storage;
- real deposit monitoring;
- per-report deposit wallets;
- Telegram notifications for admin status changes;
- linked forensic job creation from theft reports;
- case event history;
- per-admin identity/audit log;
- legal/export package generation.

## Self-Review

- Completeness scan: no unresolved blanks remain.
- Internal consistency: bot status and admin status are explicitly separate.
- Scope check: the design stays focused on one Admin workspace, one table
  extension, and a small API.
- Ambiguity check: the MVP does not launch forensic jobs and does not send
  Telegram notifications from admin status changes.
