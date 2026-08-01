# TRON USDT Address Poisoning Monitor Design

## Status

Approved after review and implemented on the feature branch on 2026-07-12.
This document describes the first release: an automatic immediate USDT warning
for watched wallets. It does not claim production deployment. Recipient
checking before a transfer is the next phase and must reuse the evidence saved
by this release.

## Problem

An attacker can create a TRON address that looks like a recent recipient, send
a small token transfer to the victim, and place the lookalike beside the real
recipient in transaction history. A user who copies the address from history
may then send the real payment to the attacker.

The current monitor sees confirmed incoming USDT transfers for watched wallets
and stores them in `observed_transactions`. It does not compare a new sender
with recent outgoing recipients. The normal sender-risk and Incoming Deposit
checks therefore miss the poisoning relation.

This is a wallet-safety event, not source-of-funds evidence. A critical
poisoning warning must not by itself mark the wallet's money dirty or alter its
AML score.

## Verified THJ Case

Subject wallet:

`THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7`

All times below are Moscow time on 2026-07-01:

1. At `15:46:57`, the subject sent `10 USDT` to the real recipient
   `THDppXpzBV14Wp9o47zkDRjpLvZSCd58Fg` in
   [`8c70…d44f`](https://tronscan.org/#/transaction/8c70cadc7128323239873d886e0c20ae6feb1d6096c951159c3517793e16d44f).
2. TronScan records creation/activation of
   `TABPfWW3Q7vCnfPQgQ8BCpjHqFqhCd58Fg` at `15:47:27`, 30 seconds later.
3. At `15:47:39`, `TWkvffFDMsqbmTLkMHMABmw452Hyq98cdn` funded that address
   with `10.000001 USDT` in `ba4d…d330`.
4. At `15:47:42`, the lookalike sent exactly `10 USDT` to the subject in
   [`2c97…bb4e`](https://tronscan.org/#/transaction/2c973bca918030e1ed0f49f4e69192368837c050398dc980fabf8ae2cdecbb4e).
5. At `15:51:39`, 3 minutes 57 seconds after the poisoning transfer, the
   subject sent `282,693 USDT` to the lookalike in
   [`976f…df7`](https://tronscan.org/#/transaction/976f0e1609cf0721a9026995e1ccc238b1110ee56c0485c4038226e5ff6c2df7).
6. At `15:51:54`, 15 seconds later, the lookalike called `sellGem` on USDD PSM
   contract `TBXW4hS5KYjjbJXDpnrPf4zhkLwrpUjbyz` in
   [`2fc2…be4`](https://tronscan.org/#/transaction/2fc22b7b5a0da88e506864aa7c073af863ca18fee4116017229d5be296612be4).
   The transaction moved `282,693 USDT` to PSM reserve
   `TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ` and returned `282,693 USDD` to the
   lookalike.

The real and fake recipient addresses have the same six-character suffix:

```text
THDppXpzBV14Wp9o47zkDRjpLvZSCd58Fg
TABPfWW3Q7vCnfPQgQ8BCpjHqFqhCd58Fg
                            Cd58Fg
```

The lure, the victim's loss, and the detector trigger are USDT transfers through
official contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`. USDD appears only in
the later PSM conversion. The poisoning detector must not depend on USDD or on
the post-loss conversion.

The displayed account-creation timestamp is supporting context only. In this
same history, TronScan records activation of the real recipient after its first
USDT receipt. Account creation/activation therefore cannot be a required
poisoning condition.

## Goals

1. Warn the owner of a watched wallet immediately after a suspicious small
   incoming USDT transfer.
2. Detect the relation before any later large transfer to the lookalike.
3. Build the decision deterministically without an LLM.
4. Persist the candidate and typed evidence for deduplication, manual review,
   later confirmation, and the future recipient-check feature.
5. Keep ordinary Incoming Deposit analysis independent and running normally.
6. Limit provider work to small incoming transfers and bounded recent history.

## Non-Goals

- Do not block or sign transactions from Telegram.
- Do not implement recipient checking in this release.
- Do not monitor USDD, USDC, or arbitrary TRC-20 tokens in the runtime MVP.
- Do not call every small transfer an attack.
- Do not use poisoning evidence as dirty-funds provenance or an AML decline.
- Do not require a fresh-account timestamp or a later confirmed loss.
- Do not start a new heavy forensic job for the initial warning.

## Architecture

Add one pure detector, a thin monitor enqueue step, and a separately scheduled
lightweight poisoning worker:

```text
confirmed small incoming USDT
  -> apply freshness and eligibility gates
  -> persist a pending poisoning check
  -> continue normal Incoming Deposit workflow
  -> lightweight worker loads bounded recent USDT relationships
  -> compare sender with earlier outgoing recipients
  -> build typed poisoning evidence
  -> persist candidate idempotently
  -> send immediate dedicated warning
```

Recommended code boundary:

- `src/monitor/addressPoisoning.ts`: pure comparison and classification;
- `src/monitor/monitorWorker.ts`: freshness gate and non-blocking enqueue;
- `src/monitor/addressPoisoningWorker.ts`: bounded claim, lookup, persistence,
  retry, and delivery;
- existing TronScan client: bounded paginated related-transfer lookup;
- storage repositories: check state, candidate lifecycle, and alert delivery;
- alert formatter and keyboard: dedicated Russian-first message.

The detector accepts token metadata even though the first integration is only
official TRON USDT:

```text
tokenContract
tokenSymbol
tokenDecimals
incoming transfer
prior relationship facts
recent outgoing transfers
optional sender account facts
```

This keeps the matching logic reusable for future configured TRC-20 tokens
without pretending that the current monitor already ingests them.

## Monitor Integration

Before the observed transaction insert, compute the cheap local eligibility
status. `claimObservedTransactionForUserAlert` stores the transfer and its
`pending`, `skipped`, or `skipped_backfill` poisoning state atomically. Do not
perform the TronScan relationship lookup inline. Queue the normal Incoming
Deposit job without waiting for poisoning analysis.

Only trigger the live lookup when all conditions hold:

- transfer is confirmed and successful;
- token contract is official TRON USDT;
- watched wallet is active and not `paused`;
- event age does not exceed the existing
  `incomingDepositRealtimeMaxAgeMs` value at claim time;
- incoming amount is greater than zero and at most configurable
  `ADDRESS_POISONING_SMALL_TRANSFER_MAX_USDT`, default `100`;
- sender and watched wallet are different valid TRON addresses.

An older event is historical backfill. Persist
`poisoning_check_status = skipped_backfill` and do not perform a lookup or send
a security warning. The ordinary Incoming Deposit path keeps its existing
backfill behavior. The repository applies the fresh-event cutoff inside the
atomic `for update skip locked` claim. After any scheduler or provider wait,
the worker checks freshness again before every terminal write, bound to the
running check lease. An expired candidate, clear, inconclusive, or error path
becomes `skipped_backfill`, so downtime cannot create a late warning.

Migration 031 uses `skipped_backfill` as the safe default for all pre-existing
and unspecified rows. Any legacy `clear` without an allowed typed reason is
rewritten to `skipped_backfill` with `legacy_clear_reason_unknown`; migration
never invents `complete_no_match` coverage.

Each worker claim reads one logical page of at most 100 related USDT transfers
within the strict 24 hours before the suspicious incoming transfer. The
poisoning path uses the pinned TronScan-only page API; it does not use the
ordinary client's TronGrid fallback. One logical 100-row page uses at most two
internal 50-row provider calls. It filters locally to confirmed, successful,
non-reverted official-USDT transfers earlier than the lure. A provider
`riskTransaction` flag remains contextual metadata: it does not invalidate an
otherwise canonical relationship transfer, and the raw flag remains in saved
provider evidence.

Persist the pinned provider, requested/start/next offsets, `total`,
`rangeTotal`, completion and consistency flags, raw and canonical response
hashes, per-fact provider identity, and internal/cross-claim overlaps. Complete
coverage requires a non-null authoritative `rangeTotal`; `total` may be null.
When both values exist they must remain consistent, with
`rangeTotal <= total`. Mixed provider evidence, a missing `rangeTotal`,
contradictory totals, an oversized page, a short nonterminal page, unexplained
no progress, or overlap never proves complete negative coverage. Such a result
stays partial/inconclusive rather than becoming `clear`.

Every raw provider row receives a pagination identity. Rows with a transaction
hash use that hash plus an event index when available. A row without a
transaction hash is retained for audit under a content fingerprint, but its
`:raw:` identity makes provider metadata incomplete. Even one tx-less row in an
otherwise exhausted range cannot support negative `clear`. If its content
changes later, both fingerprints remain auditable and coverage still stays
partial. Persisted version-2 or legacy lookup state without complete raw-row
identity evidence also fails closed when it already contains provider rows.

A positive visual/amount match is usable with partial coverage. An exact
disqualifier is also usable: an earlier direct relationship, an exact
`service_admin` `trusted` or `false_positive` label for the sender, or an exact
authoritative service-address registry match. Without a candidate or an exact
disqualifier, a truncated lookup is `inconclusive`, never `clear`.

The lightweight worker may continue an inconclusive lookup by one saved page
per claim. Hard product limits are five logical pages and at most 500 entries
in each top-level evidence collection: transfers, provider facts, accepted ids,
raw ids, and provider identities. Each page is limited to 100
entries in each raw-id or overlap-id list and two raw plus two canonical
response hashes. Persisted state is validated against these bounds before
arrays are copied or sets/maps are built; live pages and aggregate growth are
checked before merge. Oversized or malformed evidence becomes a bounded failed
check and can never become `clear`.

The worker stores the cursor, oldest covered timestamp, page count, and fetched
transfer count. If it still cannot cover the full 24-hour window, it remains
`inconclusive` after the retry budget is exhausted; it does not become clean by
default. A sender must never be described as new outside the checked window.

The poisoning check is separate from ordinary alert status. Detection failure
must not prevent the Incoming Deposit job or ordinary alert from continuing.
Persist a small check state on `observed_transactions`:

- `poisoning_check_status = pending | running | inconclusive | clear | candidate | failed | skipped | skipped_backfill`;
- `poisoning_check_attempts`;
- `poisoning_check_last_error`;
- lookup cursor, page count, fetched-transfer count, oldest covered timestamp,
  and `coverage = complete | partial`;
- `poisoning_checked_at`.

The dedicated worker claims `pending`, retryable `inconclusive`, `failed`, or
stale `running` rows with `for update skip locked`. Provider failures have one
initial execution and three retries after 30, 60, and 120 seconds; the fourth
failure is terminal. The repository is the sole attempt-policy authority. A
clear result is persisted
only after complete negative coverage or an exact disqualifier, so the same
transfer does not repeat provider work. An `inconclusive` row is retryable only
while its page count is below five and the event remains fresh. After that it
stays non-retryable `inconclusive` until an explicit future policy or manual
review changes it.

## Address Similarity

Compare fixed TRON base58 strings, not display abbreviations.

Persist:

- raw common prefix length;
- meaningful prefix length, excluding the universal leading `T`;
- common suffix length;
- whether both a prefix and suffix threshold matched.

Never use the shared leading `T` as evidence. Never compare an address with
itself. Levenshtein distance is optional diagnostic context and cannot replace
prefix/suffix matching.

Strong visual similarity is any of:

- common suffix of at least six characters;
- meaningful prefix of at least six characters after the leading `T`;
- common suffix of at least four plus meaningful prefix of at least three.

Moderate visual similarity is a common suffix of five or meaningful prefix of
five without the combined strong rule.

The THJ fixture has raw prefix length `1`, meaningful prefix length `0`, and
suffix length `6`.

## Relationship And Amount Rules

The suspicious sender must not have appeared in the checked relationship
history strictly before the incoming transfer:

- no earlier direct transfer between the watched wallet and sender in the
  bounded 24-hour relationship result;
- no authorized manual trusted/false-positive decision for the sender;
- sender has no exact address match in the authoritative service registry;
- sender is not the exact matched earlier recipient.

Do not mark a sender trusted merely because the wallet later sends money to it.
Trust requires manual confirmation, an address-book entry in the future, or a
stable relationship that predates the suspicious event.

Compare amounts in raw token units. Exact equality is the strongest condition.
Display decimals only after matching. For future tokens, optional USD value
controls the small-transfer trigger; it does not replace raw token equality.

## Risk Classification

### Critical Candidate

All required:

- sender absent from the checked recent relationship history;
- strong visual similarity to a prior outgoing recipient;
- exact raw-amount match with that prior outgoing transfer;
- outgoing and suspicious incoming transfers are no more than 24 hours apart;
- both transfers use the same token contract.

This is a critical wallet-safety warning, not proof that funds were already
stolen. The THJ warning must be created from steps 1-4, before step 5.

### High Candidate

All required:

- sender absent from the checked recent relationship history;
- strong or moderate visual similarity;
- incoming amount at or below the configured small-transfer threshold;
- a prior outgoing recipient exists within 24 hours;
- exact amount equality is absent or similarity is only moderate.

### No User Alert

A small incoming transfer from a sender absent from the checked recent history,
but without a similar recent recipient, is not poisoning evidence only when the
full 24-hour relationship window was covered. Persist that result as `clear`;
do not send a warning or increase risk.

If the lookup was truncated and found neither a candidate nor an exact
disqualifier, persist `inconclusive` with `coverage = partial`. Do not alert, do
not label the sender clean or new, and retry within the bounded lookup budget.

## Evidence Contract

Create typed raw evidence with source `address_poisoning_detector` and one
generic wallet-safety observation:

```text
code = address_poisoning_candidate
```

The observation is only the queryable safety marker. Match type,
classification, prefix/suffix lengths, raw-amount equality, transfer facts,
coverage, and ranking details live in the typed evidence JSON.

This requires a new `RiskSignalGroup` and database value:

```text
signal_group = wallet_safety
score_impact = 0
```

Add a database constraint that every `wallet_safety` observation has
`score_impact = 0`. Unified wallet risk, Incoming Deposit risk, matrix scoring,
FastCheck, Where Is Money, and DeepCheck must explicitly exclude this group
from score and disposition inputs. This exclusion is required even if an old or
manually corrupted row has a non-zero value. Wallet-safety observations may be
read only by safety alerts, Admin safety views, and the future recipient check.

Evidence contains:

- watched wallet;
- token symbol, contract, and decimals;
- suspicious incoming tx, sender, amount, and timestamp;
- matched earlier recipient and outgoing tx;
- outgoing amount and timestamp;
- prefix/suffix match lengths;
- exact-amount flag and elapsed time;
- relationship window, fetched-transfer count, coverage state, and whether the
  sender appeared in the checked history;
- raw provider-row identities, including content fingerprints for tx-less rows,
  plus page hashes and overlap audit data;
- optional sender activation time and transaction counts;
- detector policy version;
- every provider or local evidence id used.

Missing optional account metadata lowers explanation completeness but does not
erase an otherwise exact transfer/address match.

## Candidate Persistence

Add `address_poisoning_candidates` with the minimum queryable fields needed by
monitoring and future recipient checking:

- stable `id`;
- `watched_wallet_id`;
- token contract, symbol, and decimals;
- suspicious incoming tx hash and sender;
- matched earlier recipient and outgoing tx hash;
- incoming/outgoing raw amounts and timestamps;
- meaningful prefix and suffix lengths;
- classification and confidence;
- primary-match rank inputs and secondary matches inside raw evidence;
- `status = candidate | confirmed | dismissed`;
- compact opaque callback token bound to the candidate;
- raw evidence id;
- Telegram alert status, fixed locale, attempt generation, dedicated lease,
  retry time, error, sent time, and message fingerprint;
- optional later-loss transaction hash and `later_loss_evidence_json`;
- created and updated times.

Persist at most one candidate per watched wallet, token contract, and
suspicious incoming tx. Rank every eligible match in the successfully fetched
evidence at decision time and select one primary match in this order:

1. `CRITICAL` before `HIGH`;
2. more matched address characters;
3. exact raw-amount equality before non-equality;
4. smaller absolute time difference;
5. newer outgoing transfer;
6. lexicographically smaller outgoing tx hash as the final stable tie-breaker.

Store all fetched non-primary matches in the raw evidence, not as additional
candidate rows. A positive match may finish the live lookup with partial
coverage so the warning is not delayed while older pages are fetched; unfetched
history is not represented as checked or ranked. Use a unique key over watched
wallet, token contract, and suspicious incoming tx. Reprocessing updates the
same candidate and never sends more than one logical alert for that incoming
transfer. After `alert_status = sent` is stored, the status exclusion prevents
the row from being reclaimed. The fingerprint records the delivery identity of
the rendered immutable candidate facts; it is not the claim predicate.
Telegram has no idempotency key, so a process crash after Telegram accepts the
message but before the database marks it sent leaves a narrow unavoidable
duplicate-delivery window. Delivery is therefore at-least-once with persisted
deduplication, not strict exactly-once.

Indexes support:

- active candidates by watched wallet;
- candidate lookup by suspicious sender for future recipient checking;
- pending/retryable alert delivery;
- confirmed/dismissed case review.

Manual `Это знакомый адрес` sets this candidate to `dismissed`; it does not
globally trust every future transfer from the address. `Пометить как подмену`
sets it to `confirmed` and retains the immutable detector evidence.

Both actions require server-side authorization. Callback data contains the
action plus a compact opaque candidate token bound to one candidate; it never
contains authority by itself. The handler loads the candidate with its watched
wallet and requires `ctx.from.id` to equal the wallet owner's
`telegram_user_id`. It does not trust the message chat, forwarded-message
metadata, or a caller-supplied wallet id. An unauthorized or unknown callback
returns a neutral unavailable response and changes nothing.

Status transitions use a compare-and-set repository method. The first owner
transition from `candidate` to `confirmed` or `dismissed` wins; repeating the
same action is idempotent, and the opposite action does not silently reverse a
terminal decision. Reopening a terminal decision is outside this release.
The callback edits only candidate status/timestamps and the terminal keyboard;
it does not rewrite detector facts. Unknown, unauthorized, unavailable, or
conflicting callbacks return a neutral response and no candidate payload.

## USDD PSM Separation

The initial poisoning candidate is complete before any USDD event exists.
Never require or score PSM contact when creating the warning.

If later analysis finds the victim's large USDT transfer to the candidate and
the candidate's USDT-to-USDD PSM conversion, attach them as post-loss evidence:

```text
poisoning candidate
  -> later victim loss in USDT
  -> later USDT-to-USDD PSM conversion
```

The PSM route strengthens confirmation and explains where the stolen value
went. It remains a separate route fact and cannot rewrite the original lure as
USDD.

Post-loss live monitoring and automatic PSM enrichment are not required for
the initial MVP. The schema and evidence link must allow a later forensic job
or recipient-check phase to add those facts idempotently.

## Telegram Alert

Security warnings override `risk_only` and `digest` delivery delay. They are
sent immediately in `realtime`, `risk_only`, and `digest`; `paused` is skipped.
The owner's locale is fixed atomically when the first delivery claim is taken,
so retries and callback edits keep the same language.

Canonical Russian copy:

```text
🔴 Возможна подмена адреса

Кошелёк: THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7

Что произошло
Пришло 10 USDT от адреса, который не встречался среди переводов за проверенные
24 часа:
TABPfWW3Q7vCnfPQgQ8BCpjHqFqhCd58Fg

Он повторяет последние 6 символов адреса:
THDppXpzBV14Wp9o47zkDRjpLvZSCd58Fg

Этому адресу вы отправили 10 USDT 45 секунд назад.

Что делать
Не копируйте адрес из истории переводов. Сверьте каждый символ с адресом
получателя или возьмите адрес из сохранённого источника.
```

Full addresses are intentional in this warning. Ordinary Telegram results keep
short linked addresses, but poisoning prevention requires visual comparison of
the complete strings.

Buttons:

- `Входящий перевод`;
- `Исходящий перевод`;
- `Это знакомый адрес`;
- `Пометить как подмену`.

The alert says `возможна подмена` until a user confirms it or exact later loss
evidence is attached. It never says that theft has already happened based only
on the lure.

Ordinary Incoming Deposit analysis remains independent. If it finishes after
an active poisoning candidate exists, append:

```text
⚠️ Предупреждение о возможной подмене адреса остаётся активным.
```

A low AML score or benign source-of-funds result must not hide, downgrade, or
contradict the separate wallet-safety warning. If Incoming Deposit finishes
first, it stays unchanged and the dedicated safety alert follows separately.
Immediately before formatting, Incoming queries the candidate for the same
watched wallet and incoming tx. `candidate` and `confirmed` keep the warning;
`dismissed` removes it. Lookup failure is logged and Incoming delivery
continues. The query changes neither score, disposition, nor `shouldSend`.

## Performance And Failure Handling

- The main monitor performs no poisoning provider lookup; it only persists an
  eligible pending check.
- A separately scheduled lightweight worker runs independently of wallet
  polling. Defaults: every 30 seconds, at most 20 claimed checks per cycle,
  concurrency two, and a five-second timeout per provider request. Worker
  uses zero client retries. Its client shares the existing key/rate scheduler,
  but uses `interactive_fast` priority and an `address_poisoning` deduplication
  namespace.
- Check and Telegram-delivery phases have independent non-overlap guards. A
  scheduler tick skips only the phase whose prior cycle is still running.
- Each claim fetches at most one pinned logical page of 100 transfers, built
  from no more than two internal TronScan calls. Continuations use the saved
  cursor and never restart page one. Ordinary non-poisoning client methods keep
  their existing fallback behavior.
- Deduplicate concurrent checks for the same watched wallet and incoming tx.
- Provider timeout marks the poisoning check failed/retryable and does not fail
  normal Incoming analysis.
- Invalid addresses, token mismatch, reverted transfers, self-transfers, and
  transfers after the suspicious event are ignored.
- Alert delivery claims one candidate only when a bounded send slot is free.
  The Telegram request receives a real abort signal after 30 seconds; no
  `Promise.race` wrapper is used. This timeout is below the 40-second heartbeat
  interval and 120-second stale-delivery lease.
- Delivery ownership has two separate fields. The alert lease timestamp drives
  heartbeat, liveness, and stale reclaim. The monotonic `alertAttempt`
  generation drives `sent`, `failed`, and `skipped` terminal compare-and-set
  writes. Once started, the heartbeat remains active through the final database
  acknowledgement. Reclaim and finalization serialize by generation, and at
  most four send executions are claimed. Rows whose status is `sent` are
  excluded from claims. The persisted fingerprint identifies the rendered
  immutable candidate facts; delivery claims do not use it as their predicate.
- Detector output is deterministic; no LLM key or response is involved.
- Under a healthy provider and queue depth within configured cycle capacity,
  the alert SLO is no more than two wallet-polling cycles and normally no more
  than 120 seconds after the confirmed transfer is observed. Queue age, queue
  depth, lookup latency, timeout count, and alert latency are recorded as
  metrics. The real shared-scheduler regression places lookup and delivery in
  worst-phase consecutive ticks and sends at 60 seconds, within the 120-second
  target. Flooding may delay analysis but cannot block wallet polling or turn
  partial coverage into `clear`.

Operational events are exact and avoid sensitive addresses, Telegram user/chat
ids, API keys, and tokens:

- `address_poisoning_lookup_completed`: `txHash`, `providerLatencyMs`,
  `pageCount`, `fetchedCount`, and `coverage`; a successfully processed page
  also includes the accumulated `provider`, while a failed lookup reports
  `coverage=failed` without `provider`;
- `address_poisoning_cycle_completed`: `queueDepth`, `oldestQueueAgeMs`,
  `claimed`, `durationMs`, `timeoutCount`;
- `address_poisoning_alert_sent`: `candidateId`, `classification`,
  `queueAgeMs`, `alertLatencyMs`.

If queue metrics cannot be read, `queueDepth` and `oldestQueueAgeMs` are `null`,
not zero.

Automatic suppression is allowed only for an exact sender label written by
`service_admin` as `trusted` or `false_positive`, an exact sender match in the
authoritative service-address registry, or an earlier direct relationship in
the checked history. A provider label, contract name, token name, or free-text
metadata is not sufficient. The owner's `Это знакомый адрес` action dismisses
only that existing candidate; it does not create trust or suppress future
sender events.

## Tests And Acceptance Criteria

Implementation follows test-first development.

### Historical THJ Fixture

The fixture must prove:

1. official token is USDT, not USDD;
2. real recipient and lookalike share suffix `Cd58Fg` of length six;
3. `10 USDT` outgoing and `10 USDT` incoming match exactly;
4. elapsed time is 45 seconds;
5. lookalike did not appear in the checked history before the lure;
6. a critical candidate is persisted from the lure before the
   `282,693 USDT` loss;
7. later loss can attach to the same candidate;
8. later `sellGem` is represented as `282,693 USDT -> USDD PSM -> 282,693 USDD`,
   not as the lure token.

### Detector Regressions

- universal leading `T` contributes zero meaningful prefix characters;
- exact same address never matches as a lookalike;
- five-character suffix without exact amount is HIGH, not CRITICAL;
- six-character suffix plus exact amount within 24 hours is CRITICAL;
- same evidence after 24 hours does not meet the critical time rule;
- raw token equality respects token contract and decimals;
- future/later transfers are never used in the initial decision;
- poisoning pages stay pinned to TronScan while ordinary client fallback remains;
- missing, inconsistent, overlapping, or non-progressing pagination cannot
  produce `clear`;
- a tx-less provider row keeps its raw content fingerprint for audit but forces
  partial coverage, including an exhausted one-row range or changed content;
- persisted and live evidence over five pages, 500 entries in any top-level
  evidence collection, 100 entries in any per-page id/overlap list, or two
  hashes of either kind per page fails bounded and never produces `clear`;
- `riskTransaction` remains raw contextual metadata and does not invalidate an
  otherwise canonical relationship transfer;
- an event that expires during provider/scheduler wait becomes
  `skipped_backfill` before any terminal write, including the error path;
- missing sender creation time does not suppress an exact candidate;
- an exact `service_admin` trusted/false-positive sender label suppresses the
  warning;
- an exact authoritative service-registry address suppresses the warning;
- an earlier direct relationship suppresses the warning;
- provider labels, contract names, token names, and free text do not suppress
  the warning;
- a complete 24-hour lookup with no match is clear;
- a truncated lookup with no match is inconclusive, not clear;
- partial coverage still permits a positive candidate or exact disqualifier;
- an inconclusive lookup resumes from its saved cursor and never restarts page
  one;
- exceeding the five-page budget remains inconclusive;
- an event older than `incomingDepositRealtimeMaxAgeMs` is
  `skipped_backfill` and sends no safety alert;
- repeated processing is idempotent;
- multiple eligible outgoing matches produce one candidate and one alert using
  the documented deterministic rank;
- failed detection retries without blocking normal Incoming work;
- a candidate whose alert status is `sent` is not reclaimed; the stored
  fingerprint identifies rendered immutable facts but is not the claim
  predicate;
- a crash between Telegram acceptance and the `sent` database write is covered
  as an explicit at-least-once delivery limitation;
- Telegram delivery has an abortable 30-second timeout without `Promise.race`;
- the lease controls delivery liveness, while `alertAttempt` generation controls
  terminal writes and serializes finalization against reclaim;
- `risk_only` and `digest` receive the security warning immediately;
- `paused` receives no warning;
- Telegram includes both full addresses and both transaction links;
- only the watched-wallet owner can confirm or dismiss a candidate;
- a forwarded button, guessed token, wrong owner, repeated action, and opposite
  terminal action cannot mutate the candidate incorrectly;
- every `wallet_safety` observation has zero score impact and is excluded from
  every AML/unified scoring path even when a malformed fixture uses a non-zero
  stored value;
- a later low-risk Incoming result keeps the active poisoning-warning line;
- the healthy-provider alert SLO is checked with fake timers and queue latency
  metrics;
- no LLM is called.

## Future Recipient Check

The next phase accepts a proposed recipient address and queries active or
confirmed poisoning candidates by watched wallet, token, and suspicious sender.
It reuses the same pure similarity function, policy version, and evidence
record. No candidate migration or reinterpretation should be necessary.

That phase may warn before signing or broadcasting. Telegram cannot cancel an
already signed transaction, so actual hot-wallet blocking requires a separate
integration outside this MVP.

## Documentation Updated During Implementation

Implementation documentation was synchronized with the implemented branch
behavior in these surfaces:

- `README.md`;
- `docs/knowledge/02-check-modes.md`;
- `docs/knowledge/03-job-lifecycle.md`;
- `docs/knowledge/04-data-sources-tronscan-indexing.md`;
- `docs/knowledge/07-risk-scoring-matrix.md`;
- `docs/knowledge/08-admin-and-bot-ux.md`;
- `docs/knowledge/09-current-decisions.md`;
- `docs/knowledge/10-open-problems.md`;
- `docs/knowledge/13-agent-observations.md`.

They distinguish current USDT-only runtime support from the token-aware pure
detector interface and the future recipient-check phase.
