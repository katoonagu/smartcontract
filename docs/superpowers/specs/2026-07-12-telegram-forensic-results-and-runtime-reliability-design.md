# Telegram Forensic Results And Runtime Reliability Design

## Status

Approved in conversation on 2026-07-12. This document specifies the product
behavior to implement. It does not describe behavior that is already deployed.

## Problem

Fresh Telegram checks exposed six related defects:

1. Final messages do not consistently name the checked wallet, so adjacent
   results are easy to mix up.
2. The first displayed fact can differ from the signal that set the score. A
   real `55/100` result was anchored by collector behavior while the message
   led with USDD PSM.
3. Low-balance Where can report `0 transfers / 0% / 100% unknown` even when the
   wallet has recent principal transfers below the current 1,000 USDT
   significance threshold.
4. Coverage says how many transfers were selected but not how many available
   transfers were checked or why the rest were excluded.
5. A Where parent job can remain in `waiting_for_targeted_index` after all its
   candidate-window waits are ready. The user then receives only the Deep
   context message and no final result.
6. Telegram updates are handled sequentially while some handlers wait for
   TronScan or dashboard refreshes. This makes buttons and sections feel slow.

The copy also needs restrained visual structure, plain Russian explanations,
and clickable TronScan addresses.

## Observed Cases

The design is grounded in saved jobs from 2026-07-11:

- `TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD`: final `90/100` was anchored by a
  material direct relationship with currently blacklisted
  `TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm`; an 83% bridge/router source was separate
  provenance context.
- `THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7`: final `55/100` was anchored by
  `deep_wallet_role_collector`, not USDD PSM. The wallet forwarded 99.96% of
  received volume and had 38 inbound and 68 outbound transfers in the saved
  behavior profile.
- `TKgYpYNY4gwZr2cm8PkdpTk9eUhFWGn276`: current balance was 0.023791 USDT, but
  five principal transfers existed in the checked window, including a 305 USDT
  inbound followed by a 305 USDT outbound to
  `TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE`. The 1,000 USDT threshold discarded all
  five and produced a misleading zero-coverage message.
- `TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC`: Where job
  `e996732b-5ac9-4d16-b5ae-24da4d0fa192` remained queued in
  `waiting_for_targeted_index` after all 13 candidate-window waits became
  `ready` and their matching index states became `complete`.

## Goals

1. Make every Telegram result self-identifying.
2. Explain the actual score driver before secondary context.
3. Analyze recent principal flow for low-balance wallets even when every
   transfer is below 1,000 USDT.
4. Explain checked, selected, excluded, and unresolved transfer coverage in
   ordinary language.
5. Wake ready waiting jobs idempotently and retry failed Telegram delivery.
6. Keep normal button navigation responsive without adding a concurrency
   dependency.
7. Add a calibrated USDD PSM AML signal based on share, direction, and mode.

## Non-Goals

- Do not let an LLM write the final score or factual result.
- Do not replace the separate Fast, Deep, Where, or Incoming modes.
- Do not add a general Telegram outbox service or a new queue dependency.
- Do not redesign the Admin console in this change.
- Do not claim that USDD PSM proves laundering.
- Do not treat coverage limitations as risk evidence.

## Evidence And Scoring Contract

### Score-Driver-First Rule

The first reason in a final message must bind to the canonical active score
anchor or winning matrix candidate for the checked subject. A secondary fact
cannot take the first position merely because its narrative kind has a higher
presentation priority.

The report separates:

- `Почему такая оценка`: the evidence that determined the published score;
- `Откуда деньги` or `Движение денег`: source and route context that did not
  determine the score;
- `Покрытие`: data scope and limitations, never risk evidence.

If no subject-bound fact explains a numeric score, fail closed and publish no
final score.

### Collector Policy

- Collector or transit behavior without adverse provenance or exact hard
  evidence is capped at `35/100`, decision `REVIEW`.
- A score of `55/100` requires a second independent AML signal.
- The user-facing text states the observed behavior and does not compare the
  result with an old score.

Example:

```text
Кошелёк получил 38 переводов от 24 адресов и отправил 68 переводов на
33 адреса. Дальше ушло 99,96% полученной суммы. Это похоже на транзитный
кошелёк или кошелёк-сборщик ликвидности.
```

### Current USDT Blacklist Relationship Policy

- A checked address currently blacklisted by the official USDT contract is
  critical exact evidence.
- A material direct principal relationship with a counterparty that is
  currently blacklisted remains high AML risk even if the transfer predates
  the blacklist event.
- If the counterparty was already blacklisted during the transfer, state that
  chronology explicitly as the strongest form of the relationship.
- If the counterparty was blacklisted later, state that the checked wallet
  interacted with an address that was subsequently frozen. Do not call it
  active-at-transfer evidence.
- If chronology is unknown, preserve the high current-relationship risk but
  state that the blacklist status at transfer time is unknown.
- Dust and structurally exact GasFree service-fee edges do not create this
  policy relationship. Only principal transfers that pass the existing
  materiality policy are eligible.
- Partial unrelated coverage does not materially reduce a score already
  anchored by exact hard or applicable policy evidence. The limitation remains
  visible separately.

## USDD PSM Policy

### Product Interpretation

USDD is a decentralized stablecoin. Its official documentation describes it as
freeze-free: no centralized issuer can freeze USDD itself. The Peg Stability
Module exchanges USDT and USDD at a fixed 1:1 rate and pools the USDT reserve.

This has two AML consequences:

1. The shared PSM reserve prevents attribution of the earlier USDT leg to one
   specific user after the service boundary.
2. The USDD leg is outside Tether's USDT freeze mechanism and can be used to
   interrupt the ordinary USDT trail.

The system must not promise that funds can never be frozen. Once value is
converted back into USDT, the received USDT is again subject to the USDT
contract's freeze controls.

Primary references:

- <https://docs.usdd.io/introduction>
- <https://docs.usdd.io/system-architecture/system-architecture>
- <https://docs.usdd.io/user-guide/psm-peg-stability-module>
- <https://docs.usdd.io/introduction/collateral-asset-contract-addresses>

### Share-Based Modifier

For an exact USDD PSM route, apply this context-score modifier:

| Share of the selected amount | Modifier |
| ---: | ---: |
| below 5% | +3 |
| 5% to below 20% | +7 |
| 20% to below 50% | +12 |
| 50% to below 80% | +18 |
| 80% or more | +25 |

Mode and direction adjust the modifier:

- Where current-balance, requested-amount, transaction-seed, and low-balance
  recent-flow use the full modifier because the route belongs to the selected
  amount.
- Historical Deep exposure uses half the modifier, rounded to the nearest
  integer and capped at `+12`.
- Direct inbound USDT from PSM uses the full mode-adjusted modifier.
- Outbound USDT into PSM uses half the mode-adjusted modifier, rounded to the
  nearest integer.
- A one- or two-hop PSM route is eligible only when amount continuity and the
  service identity are exact. A label-only relationship is narrative context
  without a numeric modifier.

USDD PSM alone cannot produce `DECLINE`; its standalone result is capped at
`45/100`, decision `REVIEW`. It can combine with an independent collector,
bridge, blacklist, drainer, or other eligible signal under the normal matrix.

Examples:

```text
2% исходящей суммы прошло через USDD PSM — децентрализованный обмен USDT и
USDD. Такой обмен может усложнить проверку происхождения денег. Доля
небольшая, поэтому влияние на риск минимальное.
```

```text
83% проверяемой суммы пришло через USDD PSM. Обмен через децентрализованный
USDD разрывает цепочку переводов USDT, поэтому источник денег требует
дополнительной проверки.
```

## Low-Balance Recent-Flow Selection

### Current Defect

The existing selector looks for an outgoing anchor of at least 1,000 USDT and
falls back only to inbound transfers of at least 1,000 USDT. A wallet with
smaller but relevant transfers therefore looks empty.

### Required Selection

For a wallet below the existing 1,000 USDT low-balance threshold:

1. Load and inspect the latest five principal USDT transfers in the checked
   window, regardless of amount.
2. Exclude only structurally exact GasFree service-fee edges from principal
   selection.
3. Preserve the existing meaningful-outgoing anchor path when an eligible
   outgoing transfer of at least 1,000 USDT exists.
4. When no such anchor exists, choose the latest principal outgoing from the
   five-transfer slice and select prior inbound funding candidates for it.
5. If there is no outgoing transfer, trace the latest principal inbounds from
   the five-transfer slice.
6. Run the normal subject and counterparty evidence checks for those transfers.
   A small amount does not suppress exact blacklist or drainer evidence.
7. Persist that this was a five-transfer recent-flow fallback. Do not describe
   it as current-balance provenance.

If no principal transfer exists after exclusions, publish a plain no-activity
result. Do not use the phrase `0% traced / 100% unknown`.

## Coverage Contract

Persist enough typed data to distinguish:

- `availableInboundTxCount`: inbound principal transfers examined in the
  concrete checked window or slice;
- `selectedInboundTxCount`: transfers selected for the concrete amount or
  anchor;
- `excludedInboundTxCount`: examined transfers not selected;
- a typed exclusion or limitation reason when known;
- amount coverage ratio and unresolved share.

The message must not imply that unselected transfers were never checked.

Example:

```text
📊 Проверили 24 доступных входящих перевода. К выбранной сумме относятся 10 —
они объясняют 83%. Остальные 14 проверены, но не вошли в эту денежную цепочку.
```

When a typed reason exists, use the matching sentence instead of the generic
last sentence. Supported reasons include:

- transfer occurred after the checked operation;
- its available amount was already consumed by earlier spend;
- exact GasFree service fee;
- transfer belongs to a different selected amount or episode;
- older history was unavailable from the provider;
- local materialization or provider failure.

If a reason is not proven, do not invent one. If coverage is complete, keep the
section to one short line.

## Telegram Message Architecture

### Header

Every preliminary, context-ready, final, no-final, failure, and status message
contains:

- a restrained result icon;
- the checked wallet as a shortened clickable TronScan address;
- score and decision when valid.

Canonical TronScan address URL:

```text
https://tronscan.org/#/address/<full-address>
```

### Final Section Order

1. `🧾 Проверка кошелька`
2. linked checked wallet
3. risk and action
4. `🔎 Почему такая оценка`
5. `💰 Откуда деньги` or `💸 Движение денег`
6. `📊 Покрытие`, one compact paragraph

Use at most four restrained emoji headings. Do not repeat disclaimers or expose
method names, matrix row names, internal job phases, or old score comparisons.

### Chain Presentation

- Use arrows and explicit direction.
- Shorten every TRON address and link it to TronScan.
- Show at most two largest concrete routes; aggregate the rest.
- Keep incoming provenance separate from outgoing counterparty risk.
- Do not combine an incoming bridge share and an outgoing blacklist edge into
  one causal sentence.

Example:

```text
TGyt…BAZD → 1 176 317 USDT → TWGC…TdTm
```

### Small-Balance No-Activity Copy

Only when no principal recent transfer actually exists:

```text
⚪ Оценка не рассчитана

За проверенный период не найдено переводов USDT, связанных с основной суммой.
Чтобы проверить конкретное поступление, отправьте хеш транзакции или адрес
вместе с суммой.
```

This copy must not be used when the five-transfer fallback found principal
activity.

## Waiting-Job Reconciliation

Add one idempotent repository operation that finds queued Where or Incoming
parents in `waiting_for_targeted_index` where:

- at least one durable wait exists; and
- no wait remains in `waiting`; and
- every wait is `ready`, `terminal`, or `cancelled`.

Move eligible parents to the existing resume phase:

- `reading_local_index` when all required waits are ready;
- the existing provider-limited/terminal resume path when a required wait is
  terminal.

Run reconciliation:

- once at startup;
- before each Where and Incoming polling cycle;
- after targeted-index completion as defense in depth.

The operation must be safe to call repeatedly and must not claim or reset a
currently running parent.

The currently stranded TYD job should resume naturally after deployment of the
reconciler; no bespoke address rule is allowed.

## Telegram Delivery Reliability

Reuse the forensic job record instead of adding a new outbox table. Persist a
small `telegramDelivery` object in job progress:

```json
{
  "status": "pending | sent | retryable | failed",
  "attemptCount": 1,
  "lastAttemptAt": "ISO timestamp",
  "sentAt": null,
  "lastError": null,
  "messageFingerprint": "stable fingerprint"
}
```

Rules:

- Mark delivery pending before the first attempt.
- On success, store `sent` and the stable fingerprint.
- On a retryable Telegram error, store `retryable` and retry from the periodic
  worker with bounded backoff.
- Use the fingerprint and sent state to avoid duplicate successful delivery.
- Treat permanent Telegram errors as `failed` and keep them visible in Admin or
  support diagnostics.
- Delivery failure does not change the forensic result or risk score.

## Responsive Telegram Navigation

Do not add a concurrency package in this change.

- Acknowledge callback queries before DB or provider work. Preserve the current
  safe handling for stale callback queries.
- Normal wallet tabs and sections render from the latest cached snapshot,
  including a stale snapshot when necessary.
- Only explicit `Обновить` starts a live TronScan refresh.
- A live refresh immediately displays `⏳ Обновляю данные…`; provider work then
  runs in the background and updates the message when ready.
- Deduplicate concurrent refreshes for the same watched wallet.
- `/check`, address-check buttons, and transaction-check buttons acknowledge
  immediately and run heavy work through the existing background-start pattern.
- A slow check must not keep later menu callbacks waiting in the sequential
  grammY update loop.

## Error Handling

- If score-driver evidence fails subject binding, publish no final score.
- If a linked address is invalid, omit the link and keep escaped plain text.
- If the total transfer count is absent in an old result, use the old selected
  count without inventing a denominator.
- If USDD route direction, share, or amount continuity is not exact, show it as
  unscored context.
- If cached dashboard data is absent, show a loading state and perform the
  first load in the background.
- If reconciliation finds a contradictory wait set, leave the job waiting and
  record a diagnostic instead of guessing a terminal state.

## Tests And Acceptance Criteria

Implementation follows test-first development. Required failing tests include:

1. Collector-only evidence produces at most `35/100`.
2. Collector plus an independent eligible signal can produce `55/100`.
3. A 2% outbound USDD PSM route applies the small, direction-adjusted modifier
   and appears as secondary context.
4. An 83% direct inbound USDD PSM route applies the top tier and is explained
   in Where/recent-flow.
5. Historical Deep USDD exposure uses half weight and the `+12` cap.
6. Label-only or amount-discontinuous USDD proximity does not score.
7. The first Telegram finding binds to the active scoring anchor.
8. Every result type includes the linked checked wallet.
9. Every mentioned valid TRON address is shortened and linked safely.
10. Low-balance fallback selects the real five-transfer TKg-shaped fixture,
    including the 305 USDT inbound/outbound pair.
11. Exact GasFree service fees are excluded from the five principal transfers.
12. No-activity copy never prints `0% / 100% unknown`.
13. Coverage renders checked, selected, and excluded counts without implying
    unselected transfers were skipped.
14. An all-ready waiting parent is reconciled and later claimed once.
15. A mixed ready/terminal wait set resumes through the existing technical path.
16. Delivery retry records attempts and does not duplicate a sent fingerprint.
17. Normal navigation does not call TronScan; explicit refresh does.
18. Check callbacks return before the slow check promise completes.
19. Existing Fast, Deep, Where, Incoming, GasFree, blacklist, and Telegram
    regression suites remain green.

## Documentation Updates During Implementation

Update these current knowledge pages in the implementation commit:

- `docs/knowledge/03-job-lifecycle.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/07-risk-scoring-matrix.md`
- `docs/knowledge/08-admin-and-bot-ux.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/13-agent-observations.md`

The implementation must clearly mark which previously open problems are fixed
and which delivery limitations remain.
