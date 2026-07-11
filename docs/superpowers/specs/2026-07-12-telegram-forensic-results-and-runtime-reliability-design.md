# Telegram Forensic Results And Runtime Reliability Design

## Status

The base design was approved in conversation on 2026-07-12. The active-USDT-
approval amendment below is awaiting final review. This document specifies the
product behavior to implement. It does not describe behavior that is already
deployed.

## Problem

Fresh Telegram checks exposed nine related defects:

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
7. Approval Guard treats a provider name such as `VerifyAccount` as benign
   metadata before it evaluates the exact Verify20 fingerprint and active
   allowance. This produced `35/100 ACCEPTABLE` for a live unlimited approval
   to a mass-debit contract.
8. `wallet_approvals.current_allowance_raw` currently mirrors the last observed
   Approval event. It is not refreshed from `allowance(owner, spender)` and can
   therefore present an old permission as current.
9. Telegram displays TRON transaction-envelope `raw_data.expiration` as if the
   USDT approval itself expired. That timestamp only limits when the signed
   transaction may be packed; it does not revoke a confirmed allowance.

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
- `TNAraW3cWKETcRz9p6obg7SzeiMzH2Z9i1`: direct calls to the official USDT
  contract on 2026-07-12 returned the maximum `uint256` allowance for both
  `TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK` and
  `TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s`. The wallet balance was
  `4,084.665 USDT`.
  - [`TFagr…nXzK`](https://tronscan.org/#/address/TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK)
    is the verified `VerifyAccount` contract with the exact four selectors
    required by the existing Verify20 fingerprint. Its history contains 309
    `Verify20` calls, 241 source wallets, and 16 receivers. The checked wallet
    was never a `Verify20` source, so no debit from it was found. The approval
    transaction is
    [`fde8…3d1`](https://tronscan.org/#/transaction/fde8e8925a5b0d65050bbfe102c21c79b508087113f955dd51f25514c2f823d1).
  - The contract creator is `TSq1…pQkC`, which also calls `Verify20`. It sent
    one BTTOLD to the checked wallet 12 seconds before the unlimited approval.
    This is a prepared sequence, but it does not prove common ownership.
  - [`TPwez…Et5s`](https://tronscan.org/#/address/TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s)
    is Bridgers. The wallet
    [approved it](https://tronscan.org/#/transaction/76e847b4c3a1dffdd3c9b26ef70d9265e31bdba546f9a31a60b2a1f59dc4a580)
    and, 66 seconds later,
    [called `swap`](https://tronscan.org/#/transaction/c16e27c144732bee70de72c88f5e3e501ac2bd5bbcdad66f6edac5b66cd31743)
    itself for `91.103009 USDT`. This is exact service-session context rather
    than a Verify20/drainer pattern.

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
8. Distinguish active wallet-safety exposure from dirty-funds provenance.
9. Verify current USDT allowance on-chain and explain dangerous and ordinary
   service approvals differently.
10. Stop presenting transaction-envelope expiration as approval expiration.

## Non-Goals

- Do not let an LLM write the final score or factual result.
- Do not replace the separate Fast, Deep, Where, or Incoming modes.
- Do not add a general Telegram outbox service or a new queue dependency.
- Do not redesign the Admin console in this change.
- Do not claim that USDD PSM proves laundering.
- Do not treat coverage limitations as risk evidence.
- Do not call an active dangerous approval proof of stolen or dirty funds.
- Do not treat a provider name, one method name, or one selector as an exact
  Verify20 fingerprint.

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

## Active USDT Approval Safety

### Separate Safety From Provenance

An approval answers whether a contract can spend the wallet's USDT. It does not
by itself answer where the wallet's money came from. The product therefore
keeps two conclusions separate:

- `Безопасность кошелька`: can the active approval put present or future USDT
  at risk?
- final AML/deposit decision: is there adverse provenance, sanctions evidence,
  an exact debit chain, or another eligible score driver?

Approval Guard must not show the exchange labels `ACCEPTABLE`, `REVIEW`, or
`DECLINE` as its primary action. It shows a wallet-safety level and a concrete
action. A critical active approval can pause work with the wallet without
claiming that its funds are stolen.

### Current-Allowance Truth

The latest Approval event is historical evidence, not proof that the allowance
is still active. The authoritative current value is the result of
`allowance(owner, spender)` called directly on the official TRON USDT contract.

Reuse `wallet_approvals.current_allowance_raw`, but populate it from that
constant call. Persist the minimum freshness metadata:

- `allowance_checked_at`;
- `allowance_check_status = confirmed | failed | stale`.

Refresh current allowance:

- after a confirmed approval or revocation event;
- before a new Approval Guard result is finalized;
- in the background when Safety is opened with stale data;
- periodically for stored active allowances so a later revocation is detected.

Normal tab navigation remains cache-first. A provider or full-node failure must
not block the Telegram menu. If the direct call fails, say that the last
unlimited approval was observed but its current state could not be confirmed.
Do not call it active until a successful constant call does so.

### Verify20 Safety Policy

For the spender itself, the exact Verify20 fingerprint retains the existing
four-selector requirement and trusted-service guard:

- `Verify20(address,address,address,uint256)`;
- `Verify10(address,uint256)`;
- `withdrawAllTrxTo(address)`;
- `transferOwnership(address)`.

For the wallet that granted permission, use these safety outcomes:

| Evidence | Wallet-safety result |
| --- | --- |
| exact Verify20 fingerprint + currently active unlimited USDT allowance | `CRITICAL 90/100` |
| exact Verify20 fingerprint + active finite allowance of at least 100 USDT | `HIGH 75/100` |
| exact Verify20 fingerprint + active finite allowance below 100 USDT | `MEDIUM 45/100` |
| exact Verify20 fingerprint + confirmed zero allowance | historical context only, no active-threat score |
| one selector, a method name, or a free-text/provider label only | review context, capped at `35/100` |
| exact approve → `transferFrom` → receiver debit from this wallet | exact drain evidence, `CRITICAL 95/100` |

The wallet's current USDT balance changes the urgency and displayed amount at
risk, not the evidence class. An unlimited active approval remains dangerous
with a zero balance because future deposits may also be spent.

Campaign statistics strengthen the explanation but do not replace the exact
fingerprint. Pre-approval funding, token dust, resource delegation, and common
caller relationships are orchestration context. They may support two
plausible readings — a controlled/test wallet or a prepared phishing sequence —
but cannot prove a shared private key or common ownership.

No observed debit must be stated plainly. It prevents the result from claiming
theft or applying the exact-drain `95/100` floor; it does not make an active
unlimited permission safe.

Canonical TNAra-shaped copy:

```text
🔴 Критическая угроза кошельку — 90/100
Кошелёк: TNAra…Z9i1

Что нашли
Кошелёк дал VerifyAccount безлимитный доступ к USDT. У контракта подтверждён
Verify20-шаблон массовых списаний: 309 вызовов, 241 кошелёк-источник и
16 получателей.

Что это значит
Разрешение всё ещё активно. Контракт может списать весь баланс — сейчас
4 084,665 USDT. Списаний с этого кошелька не найдено.

Что делать
Срочно отозвать разрешение. До повторной проверки с allowance = 0 не пополнять
кошелёк и не проводить операцию.

Дополнительно
За 12 секунд до разрешения создатель контракта отправил кошельку 1 BTTOLD.
Последовательность выглядит подготовленной: это может быть тестовый кошелёк
оператора или фишинговый сценарий. Общий владелец не доказан.
```

In rendered Telegram, the wallet, spender, and approval transaction are
shortened clickable TronScan links. The copy says `Verify20-шаблон` because the
fingerprint is exact; it does not expose selector signatures to the user.

### Known-Service Session Policy

A known service tag alone is insufficient. Lower drainer risk only when the
same wallet performed a successful nearby service action and the amount and
route match.

The TNAra-shaped Bridgers fixture is the canonical positive case:

- the wallet granted Bridgers access to USDT;
- 66 seconds later the wallet itself called `swap`;
- the call moved exactly `91.103009 USDT` through Bridgers;
- no Verify20 fingerprint or debit to an unrelated collector was found.

This remains `LOW 10/100` wallet-safety risk and does not increase the AML
score. Because the allowance is still unlimited, Safety still gives a short
hygiene action: revoke the permission if the bridge is no longer needed. A
confirmed zero allowance reduces this safety result to `0/100`.

Canonical copy:

```text
🟢 Низкий риск
Кошелёк: TNAra…Z9i1

Что нашли
Кошелёк дал Bridgers доступ к USDT и через 66 секунд сам обменял
91,103009 USDT через мост.

Вывод
Разрешение использовали для конкретного обмена. Признаков Verify20 или
дрейнера нет. Доступ остаётся безлимитным — отзовите его, если мост больше
не нужен.
```

### Approval Expiration Semantics

Official TRON documentation defines `raw_data.expiration` as the deadline after
which a transaction can no longer be packed. Once a USDT `approve` or
`increaseApproval` transaction is confirmed, this timestamp does not expire
the resulting allowance.

Primary reference:

- <https://developers.tron.network/docs/tron-protocol-transaction>

Required changes:

- rename internal `expirationAt` to `transactionExpirationAt` where feasible;
- keep it only as signing/transaction diagnostic metadata;
- remove user-facing `Истекает` and `Expires` lines from approval messages;
- remove `approval_extended_expiration` as an approval-risk reason;
- show `Активно на <allowance_checked_at>` only after a successful direct
  allowance call;
- show `Отозвано` only when the current allowance is confirmed as zero.

The two historical dates shown for the TNAra approvals were transaction
deadlines and must never again be presented as approval expiry dates.

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
19. A TNAra-shaped exact Verify20 fixture with a confirmed live unlimited
    allowance produces `CRITICAL 90/100` wallet-safety risk without claiming a
    debit or theft.
20. The same fixture includes the confirmed current USDT balance as the amount
    at risk and says that no debit from the wallet was found.
21. Campaign counts and the 12-second BTTOLD sequence appear as supporting
    context, never as proof of common ownership.
22. A single Verify20 selector or provider name remains capped at review.
23. A confirmed zero allowance removes the active-threat score while retaining
    historical context.
24. A direct allowance failure produces `current state not confirmed`, not an
    active or revoked claim.
25. A Bridgers fixture with approval, same-wallet swap after 66 seconds, and an
    exact `91.103009 USDT` route produces `LOW 10/100` wallet-safety risk and
    adds no AML score.
26. A service tag without same-wallet route and amount continuity does not
    receive the service-session dampener.
27. Approval Telegram messages never render transaction-envelope expiration as
    `Истекает` or `Expires`.
28. Transaction-envelope expiration no longer contributes
    `approval_extended_expiration` risk.
29. Existing Fast, Deep, Where, Incoming, Approval Guard, GasFree, blacklist,
    and Telegram
    regression suites remain green.

## Documentation Updates During Implementation

Update these current knowledge pages in the implementation commit:

- `docs/knowledge/03-job-lifecycle.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/06-deepcheck.md`
- `docs/knowledge/07-risk-scoring-matrix.md`
- `docs/knowledge/08-admin-and-bot-ux.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/13-agent-observations.md`

The implementation must clearly mark which previously open problems are fixed
and which delivery limitations remain.
