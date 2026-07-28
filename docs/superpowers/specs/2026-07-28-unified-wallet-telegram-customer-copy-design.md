# Customer-Friendly Unified Wallet Telegram Report

Date: 2026-07-28
Status: implemented; full rollout verification pending

## Context

The Unified wallet report currently exposes audit-oriented representation
details directly in Telegram. A Russian customer can see internal scope names,
canonical fact counters, role and fact codes, ISO timestamps, raw six-decimal
USDT values, and English coverage dimensions. The information remains useful
for Admin and completeness receipts, but it does not answer the customer's
main question: whether to send funds to this wallet or accept funds from it.

This change is a surgical presentation cleanup. It keeps the existing Unified
analysis and the broad report structure. It does not introduce a new bot flow,
new score, new risk rule, or expandable details screen.

## Goal

Make the final Unified wallet message understandable to a customer checking a
counterparty before a transaction.

The report must:

- keep the numeric score as the primary status;
- explain the decisive reason in ordinary language;
- give separate guidance for sending and receiving funds;
- present money movement as a short chronological story;
- preserve useful service, contract, profile, and coverage context;
- hide internal representation details from Telegram without removing them
  from persisted evidence, completeness receipts, or Admin;
- remain deterministic, complete, and within Telegram's message limit.

## Scope

Included:

- final Unified wallet dossier messages in Russian and English;
- formatting of USDT amounts, timestamps, counts, addresses, and percentages;
- customer-facing mappings for internal score, behavior, role, and coverage
  facts used by the Unified renderer;
- renderer and template versioning;
- golden, unit, completeness, determinism, and length tests;
- the relevant current knowledge page updates during implementation.

Not included:

- monitoring alerts;
- incoming-deposit, transaction, approval-safety, theft-report, or legacy
  forensic message redesigns;
- score recalibration or new risk signals;
- changes to the Unified report schema or canonical facts;
- a Telegram `Details` button or a second customer message;
- database migrations;
- rewriting or resending historical Telegram deliveries.

## Customer Decision Contract

The report serves both transaction directions.

For a customer sending funds, the guidance explains whether the observed facts
support proceeding, require address/owner verification and a small test
transfer, or support avoiding the transaction pending manual review.

For a customer receiving funds, the guidance explains whether ordinary due
diligence is enough, whether proof of source of funds should be requested, or
whether the incoming transaction should not be accepted pending manual review.

These instructions are presentation derived from the existing final decision,
score drivers, and hard-evidence state. They do not add points or create an
independent risk decision.

The existing numeric score remains visually primary. Existing decision and
risk-band semantics remain authoritative.

## Message Hierarchy

The normal Russian report uses this order:

1. report title and full checked wallet address;
2. numeric score and existing human risk status;
3. concise explanation of the decisive score driver;
4. separate `sending` and `receiving` guidance;
5. chronological money movement;
6. service, boundary, contract, and approval findings;
7. compact wallet profile;
8. plain-language coverage and limitations;
9. concise conclusion;
10. snapshot block reference.

Sections without material findings use one short negative statement. They do
not list zero counters or internal classes.

The English report has the same semantic order and contains no Russian text.

## Approved Russian Example

```text
🧾 Проверка кошелька

TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV

🟡 35/100 — нужна проверка

Почему такая оценка

Кошелёк почти сразу переводит полученные средства дальше. Это может быть
обычный транзитный или сервисный кошелёк, но перед сделкой стоит проявить
осторожность. Сам по себе этот признак не доказывает мошенничество.

Что делать перед сделкой

• Если отправляете деньги: явных запрещающих сигналов не найдено. Для крупной
  суммы сначала сделайте небольшой тестовый перевод.
• Если принимаете деньги: попросите контрагента подтвердить происхождение
  средств — источник поступления определить не удалось.

💰 Движение денег

• Получено: 10 USDT от TWkv...8cdn
• Время: 20 июля 2026, 13:53 UTC
• Отправлено дальше: 10 USDT на TJZx...Dwoq
• Остаток: меньше 0,01 USDT

Почти вся полученная сумма была переведена дальше.

🏦 Сервисы и контракты

• Связей с известными биржами, мостами и другими размеченными сервисами не
  найдено.
• Значимых контрактных рисков и опасных разрешений не найдено.

👛 Профиль кошелька

• Создан: 20 июля 2026, 13:53 UTC
• Переводы USDT: 1 входящий, 1 исходящий
• Активность наблюдалась в течение нескольких секунд.

🔍 Что удалось проверить

• История входящих и исходящих переводов изучена до момента создания кошелька.
• Переводы прослежены полностью.
• Первоначальный источник средств определить не удалось.

🧭 Вывод

Прямых доказательств высокого риска не найдено. Однако кошелёк имеет
транзитное поведение, поэтому для крупной сделки рекомендуется дополнительная
проверка контрагента.

Данные актуальны на блоке TRON #84727122.
```

The exact wording may adapt to the report's existing final decision and facts,
but the hierarchy, terminology rules, and separation of send/receive guidance
are stable requirements.

## Amount Formatting

Telegram uses a customer display formatter separate from canonical raw values.

- zero is `0 USDT`;
- a non-zero value below `0.01 USDT` is `меньше 0,01 USDT` in Russian and
  `less than 0.01 USDT` in English;
- other values use at most two decimal places;
- trailing zeroes are removed;
- Russian uses a decimal comma and English uses a decimal point;
- thousands use locale-appropriate grouping;
- ratios such as `0.000001 / 0.000001 USDT` are not displayed when the useful
  customer statement is simply the current balance or moved amount;
- exact six-decimal raw values remain unchanged in the report, receipt, and
  Admin.

Examples:

| Raw value | Russian Telegram | English Telegram |
| --- | --- | --- |
| `0` | `0 USDT` | `0 USDT` |
| `1` | `меньше 0,01 USDT` | `less than 0.01 USDT` |
| `10000` | `0,01 USDT` | `0.01 USDT` |
| `10000001` | `10 USDT` | `10 USDT` |
| `12500000` | `12,5 USDT` | `12.5 USDT` |

The renderer never uses the rounded display value for scoring, shares,
comparisons, or completeness checks.

## Date And Count Formatting

Timestamps are rendered in UTC so the same immutable presentation is
independent of the host timezone.

- Russian: `20 июля 2026, 13:53 UTC`;
- English: `20 Jul 2026, 13:53 UTC`;
- seconds are omitted unless they materially explain a rapid-forwarding
  interval;
- a missing date is `не удалось определить` / `could not be determined`;
- an invalid non-null timestamp fails presentation validation rather than
  inventing a date.

Russian count labels use correct plural forms, including `1 перевод`,
`2 перевода`, and `5 переводов`. The visible report uses `входящий` and
`исходящий`, not `in/out`.

## Address Formatting

The checked wallet remains full and copyable near the title.

Counterparty addresses are shortened in prose and remain clickable TronScan
links. A short address contains a stable prefix and suffix and never changes
the canonical address stored in the report or receipt.

## Internal-To-Customer Mapping

Telegram never shows these implementation terms:

- `facts`, `evidence facts`, or `collapsed facts`;
- `scope` values such as `current_balance_attribution`;
- internal roles such as `subject`, `sender`, `recipient`, or
  `transit_sender`;
- coverage keys such as `selection`, `trace`, `identified`, `unknown`, or
  `untraced`;
- underscore-delimited fact, reason, or policy codes.

Required mappings include:

- `history_exhausted_to_account_creation` → history was checked to the
  account's creation;
- `unknown_source` → the original source of funds could not be determined;
- `direct_activity_observed` → omitted as a customer-facing tautology;
- `rapid_forwarding` → received funds were moved onward almost immediately;
- `current_balance_attribution` → a plain current-balance statement;
- `latest_five_principal_inbound_events` → meaningful recent incoming funds;
- `all_direct_outgoing_to_snapshot` → where funds moved after arrival.

All currently reachable decisive and material context codes receive explicit RU
and EN customer copy. A newly introduced unmapped non-decisive code receives a
neutral localized statement and remains exact in Admin. A newly introduced
unmapped decisive code fails the presentation-contract test until customer
copy is added; production must not silently replace a decisive reason with an
opaque or misleading sentence.

## Behavior And Coverage Compression

Behavior rows are grouped into customer conclusions rather than role/code
counts. Duplicate history-exhaustion facts collapse into one coverage sentence.
`direct_activity_observed` is not rendered by itself. A material behavior such
as rapid forwarding remains visible even if its canonical facts are grouped.

Coverage is rendered as conclusions:

- fully traced selected directions → `Переводы прослежены полностью`;
- history exhausted to creation → `История ... изучена до момента создания
  кошелька`;
- unknown boundary share → source or destination could not be identified;
- non-zero untraced share → the message names the incomplete direction and
  states that the conclusion has limited coverage.

Raw percentages remain in the completeness receipt and Admin. They appear in
Telegram only when a percentage materially explains a customer conclusion,
such as the share of funds reaching a risky service.

## Guidance Guardrails

Customer guidance is selected from the existing final decision and evidence
authority.

- `ACCEPTABLE` does not promise safety; it states that no material signal was
  found in the checked data and recommends normal address verification.
- `REVIEW` recommends caution. Sending guidance suggests owner/address
  verification and a small test before a large transfer. Receiving guidance
  requests source-of-funds confirmation when provenance is unknown or material
  review signals exist.
- `DECLINE` recommends not sending or accepting funds pending manual review.

Hard evidence remains explicit. Behavioral context never becomes an allegation
of fraud, laundering, ownership, or legal guilt. A small test transfer is an
address/control precaution and is not described as resolving AML provenance.

## Architecture And Versioning

The canonical Unified report, report hash, score anchor, scoring policy,
canonical facts, and completeness inventory remain unchanged.

The change is implemented in the Unified Telegram presentation layer. Small
pure formatter and mapping functions may be extracted from
`src/unifiedCheck/presentation.ts` only when that makes the rules independently
testable; no broader presentation framework is introduced.

The presentation manifest remains schema V1 but new messages bind:

- renderer: `unified-telegram-renderer-v2`;
- template: `unified-wallet-dossier-template-v2`.

This produces a deliberately new presentation hash without changing the report
hash. Existing stored presentation envelopes and delivery intents remain
immutable. Existing deliveries are not rewritten or resent. New requests use
V2; a new request attached to a reusable completed analysis receives a V2
presentation for that request.

Manual resend after an unknown delivery continues to use the original stored
presentation artifact and therefore preserves its original renderer version.

No schema migration is required.

## Completeness And Telegram Length

The visible text may group or omit non-customer-facing representation details,
but the presentation completeness receipt continues to bind every canonical
fact ID and report section. `omittedCanonicalFactIds` remains empty.

The renderer uses deterministic length-reduction passes. When the first
customer-complete message exceeds Telegram's limit, it removes repeated address
examples and merges duplicate context sentences before compacting the profile.
It never removes:

- the score and existing decision status;
- decisive reasons;
- send and receive guidance;
- material hard evidence;
- material coverage limitations;
- the conclusion.

If those requirements cannot fit within the Telegram limit, presentation
creation fails closed rather than silently truncating essential content.

## Error Handling

- Invalid report structure or timestamp fails deterministic presentation
  validation.
- A missing optional value gets an explicit localized `could not be determined`
  phrase only where the report contract permits absence.
- Unknown non-decisive customer copy uses a localized neutral fallback and
  preserves the exact code in Admin.
- Unknown decisive customer copy is rejected by contract tests and cannot ship
  as an underscore code or generic conclusion.
- HTML escaping and TronScan link safety remain mandatory.
- Presentation errors remain technical failures and never change the wallet's
  risk score or decision.

## Test Design

Implementation follows test-first development.

Required tests:

1. A golden test based on the approved TPCP report verifies the complete RU
   message hierarchy and key wording.
2. The same report verifies semantic EN output with no Russian fragments.
3. Amount tests cover zero, sub-cent non-zero dust, exact cent, rounded normal
   values, trailing zero removal, and locale separators.
4. Timestamp tests cover RU, EN, UTC determinism, missing optional timestamps,
   and invalid non-null timestamps.
5. Russian pluralization covers `1`, `2`, `5`, `11`, `21`, and `22`.
6. Internal-term denial tests reject `facts`, `collapsed facts`, raw scope
   names, internal roles, coverage keys, and underscore-delimited codes from
   customer HTML.
7. Every reachable decisive code has explicit RU and EN copy.
8. Action tests cover `ACCEPTABLE`, `REVIEW`, and `DECLINE`, with separate
   sending and receiving guidance.
9. Money-flow tests preserve material amounts, direction, chronology, and
   clickable addresses after grouping.
10. Coverage tests verify complete, unknown-boundary, and incomplete/untraced
    wording without losing receipt values.
11. Determinism tests prove that host timezone and input ordering cannot change
    the presentation hash.
12. Completeness tests keep every canonical fact ID in the receipt and
    `omittedCanonicalFactIds` empty.
13. Length tests exercise every reduction pass and prove that decisive reasons,
    guidance, hard evidence, and limitations survive.
14. Historical-artifact tests prove that stored V1 presentations remain valid
    and manual resend reuses their original bytes.

## Acceptance Criteria

The redesign is complete when:

- the approved example renders without raw internal terminology;
- `0.000001 USDT` is shown as a meaningful sub-cent amount and
  `10.000001 USDT` is shown as `10 USDT`;
- ISO timestamps are absent from the customer message;
- the numeric score remains primary;
- sending and receiving guidance are both present;
- material risk evidence and coverage limitations remain truthful;
- RU and EN are internally consistent and unmixed;
- all presentation, delivery-binding, hash, completeness, and full repository
  tests pass;
- the relevant knowledge page records the customer-facing V2 presentation
  contract;
- the live bot produces the V2 template and runtime verification succeeds.

## Implementation Status

The presentation-only V2 renderer, formatters, mapping contract, deterministic
compaction, V1 artifact compatibility, and V2 Golden comparator binding are
implemented and covered by focused tests. Full repository verification and the
live Telegram rollout check remain required before the final acceptance
criterion is complete.
