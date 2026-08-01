# Final Telegram Reason Cards Design

Date: 2026-07-06

## Goal

Make the final Telegram address report understandable for a user who needs a
decision, evidence, and next action. The report must stop exposing scoring
internals as primary product copy.

Current examples show several failures:

- `ACCEPTABLE` can appear next to medium risk and matrix `REVIEW`;
- `Scoring Signal Matrix`, `behavior_only_prior`, `weighted layer score`,
  `dampener`, `production_full`, and raw layer weights appear in user text;
- exact approval-drain evidence can be duplicated;
- raw English reasons appear in Russian reports;
- coverage wording can look contradictory: `100% checked` plus `partial`;
- the user does not get a clear action.

## User Contract

The user-facing final report has this shape:

```text
Проверка адреса — итог

Адрес: ...

Решение: REVIEW — нужна ручная проверка.
Риск: 🟡 55/100

Что делать
• ...

Почему
• ...

Что важно учесть
• ...
```

`Beta/internal` is not shown in normal user delivery. It is available only in
support/admin/debug surfaces.

## Decision Rules

The final displayed decision must not contradict the matrix.

- Matrix `DECLINE` displays as `DECLINE`.
- Matrix `REVIEW` displays as `REVIEW`, not `ACCEPTABLE`.
- Matrix `ACCEPTABLE` can display as `ACCEPTABLE` only when no blocking
  coverage state and no review-only source-policy/pattern row are active.
- `score_valid=false` remains `NO_FINAL_DECISION`.

If a bug makes `UnifiedWalletRiskResult.finalDecision` disagree with
`matrixScore.matrixDecision`, the formatter must prefer the safer visible
decision and tests must capture the mismatch.

## Reason Cards

Build final user text from normalized reason cards instead of raw strings.

Each card has:

- `kind`: stable semantic reason id;
- `priority`: sort order;
- `decision`: `decline`, `review`, `context`, or `coverage`;
- `dedupeKey`: prevents duplicated evidence;
- `source`: `where`, `deep`, `fast`, `matrix`, or `coverage`;
- `ru` and `en` text;
- optional `actionRu` and `actionEn`.

Cards are collected from existing report fields. No new forensic inference is
added in the formatter.

## Priority Order

1. Exact hard evidence:
   approval-drain, USDT blacklist, scam/phishing/stolen labels.
2. Sanctions and hard source-policy evidence:
   sanctioned crypto service with service name, authority, date, and share when
   available.
3. Direct high-risk provenance:
   darknet/exchange/source path with amount share and hop count when available.
4. Source-policy review context:
   HTX/Huobi, WhiteBIT/source-policy labels, CEX/source boundary, DEX/router,
   bridge, unknown contract.
5. Clean-source caveats:
   clean CEX origin not fully proven, residual unresolved source, dense-hop tail
   below materiality.
6. Behavior and operational context:
   transit-like flow, operational/liquidity wallet, risky major counterparty.
7. Coverage:
   partial provider/history coverage, service boundary, graph budget/provider
   limits.

Hard evidence cards go into `Почему`. Behavior and coverage cards go into
`Что важно учесть` unless they are the only reasons for a `REVIEW`.

## Russian Copy Rules

Use Russian-first copy for `ru` locale.

Examples:

- `approval_drain_exact`:
  `Найдена точная approval-drain цепочка: после approve USDT были списаны через transferFrom, проверяемый адрес получил эти средства.`
- `approval_drain_saved_marker`:
  `Ранее система уже сохраняла этот адрес как связанный с exact approval-drain.`
- `service_boundary`:
  `Цепочка дошла до биржи или сервиса. Дальше публичная on-chain трассировка ограничена.`
- `clean_cex_not_fully_proven`:
  `Чистый CEX-источник не доказан полностью.`
- `behavior_operational_wallet`:
  `Адрес похож на транзитный или операционный кошелёк. Это контекст, не доказательство грязных средств.`
- `coverage_partial`:
  `Проверили выбранные входящие переводы, но по истории или сервисным границам остались ограничения.`

Do not show raw codes in user text:

- `Scoring Signal Matrix`;
- `behavior_only_prior`;
- `hard_proof`;
- `weighted layer score`;
- `dampener`;
- `production_full`;
- `matrix:...`;
- raw English reason messages.

## Actions

The `Что делать` block depends on decision and reason cards.

`DECLINE`:

- `Не принимать автоматически.`
- `Передать кейс на ручную проверку/compliance.`
- If exact approval-drain or scam hard evidence exists:
  `Если это клиентский депозит, запросить объяснение происхождения средств.`

`REVIEW`:

- `Не принимать автоматически, если сумма существенная.`
- `Проверить кейс вручную в Admin.`
- If source is not fully proven:
  `Запросить подтверждение источника средств.`

`ACCEPTABLE`:

- `Можно принять автоматически в рамках текущей политики.`
- If coverage is partial:
  `При крупной сумме всё равно проверьте ограничения покрытия.`

`NO_FINAL_DECISION`:

- `Итоговый риск не опубликован: не хватает покрытия.`
- `Дождаться индексации или перезапустить проверку после устранения лимита.`

## Rendering Rules

- `Почему` shows at most 5 deduplicated evidence/reason cards.
- `Что важно учесть` shows at most 4 context/coverage cards.
- If there are more cards, append:
  `Ещё N технических сигналов доступны в Admin.`
- `Where Is Money`, `DeepCheck`, and `FastCheck` names can appear only when
  they help distinguish sources. They must not replace the actual reason.
- Coverage wording must distinguish selected amount from full history:
  `Проверили 100% выбранной суммы` is allowed, but if coverage is partial add
  `это не означает полную историю адреса`.
- Duplicate exact approval-drain evidence from Where, DeepCheck, saved label,
  and matrix anchor collapses into one main card plus optional confirmation.

## Support/Admin Output

Keep detailed diagnostics, but move them out of normal user delivery:

- matrix row and decision;
- weighted layer scores;
- dampener;
- raw layer weights;
- run profile;
- provider budget;
- final diagnostic line.

They can remain in support formatter or appear when `showBetaDiagnostics=true`.

## Implementation Surface

Expected code areas:

- `src/bot/createBot.ts`:
  final report formatter, reason selection, RU/EN copy, support/debug split.
- `src/alerts/notificationText.ts`:
  normalization helpers for reusable reason text.
- `src/risk/unifiedWalletRisk.ts`:
  verify final decision does not flatten matrix `REVIEW` to `ACCEPTABLE`.
- Tests in `tests/bot/createBot.test.ts` and focused risk tests if decision
  mapping changes.

## Acceptance Criteria

1. The two real examples render without raw matrix/debug terms in user text.
2. A matrix `REVIEW` result cannot display user decision `ACCEPTABLE`.
3. Exact approval-drain appears once as a clear Russian reason.
4. `approval_drain_proximity` appears only as saved confirmation, not a second
   duplicate hard reason.
5. Partial coverage explains what was checked and what remains limited.
6. `Beta/internal` is absent from normal user delivery.
7. Support/admin diagnostics still expose raw scoring details.
8. Tests cover `DECLINE`, `REVIEW`, `ACCEPTABLE`, `NO_FINAL_DECISION`,
   exact approval-drain, CEX/source-boundary context, behavior-only context,
   and partial coverage.

## Out Of Scope

- Changing TronScan indexing.
- Changing actual provenance search algorithms.
- Adding new external data sources.
- Redesigning Admin graph UI.
- Recalibrating non-approval-drain score thresholds beyond the visible
  matrix-review display bug.

## Spec Self-Review

- No empty sections remain.
- The design does not add new forensic inference in the formatter.
- The visible decision cannot contradict matrix `REVIEW` or `DECLINE`.
- The user report and support/debug report have separate contracts.
- The scope fits one implementation plan.
