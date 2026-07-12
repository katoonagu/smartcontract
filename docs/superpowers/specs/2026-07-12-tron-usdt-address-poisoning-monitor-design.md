# TRON USDT Address Poisoning Monitor Design

## Status

Approved in conversation on 2026-07-12. This document specifies the first
release: an automatic immediate USDT warning for watched wallets. Recipient
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

Add one pure detector and a thin monitor integration:

```text
confirmed small incoming USDT
  -> load bounded recent USDT relationships
  -> compare sender with earlier outgoing recipients
  -> build typed poisoning evidence
  -> persist candidate idempotently
  -> send immediate dedicated warning
  -> continue normal Incoming Deposit workflow
```

Recommended code boundary:

- `src/monitor/addressPoisoning.ts`: pure comparison and classification;
- `src/monitor/monitorWorker.ts`: trigger, persistence, and delivery order;
- existing TronScan client: one bounded related-transfer lookup;
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

Run poisoning detection after `claimObservedTransactionForUserAlert` succeeds
and before the normal Incoming Deposit job is queued.

Only trigger the live lookup when all conditions hold:

- transfer is confirmed and successful;
- token contract is official TRON USDT;
- watched wallet is active and not `paused`;
- incoming amount is greater than zero and at most configurable
  `ADDRESS_POISONING_SMALL_TRANSFER_MAX_USDT`, default `100`;
- sender and watched wallet are different valid TRON addresses.

The lookup reads at most the most recent 100 related USDT transfers within the
24 hours before the suspicious incoming transfer. It filters them locally to
earlier outgoing transfers from the watched wallet. A later transfer must never
be used to explain an earlier alert. Persist whether the result covers the full
24-hour window or was truncated by the 100-transfer limit. A positive visual
and amount match remains usable with partial coverage; a sender must never be
described as new outside the checked window.

The poisoning check is separate from ordinary alert status. Detection failure
must not prevent the Incoming Deposit job or ordinary alert from continuing.
Persist a small check state on `observed_transactions`:

- `poisoning_check_status = pending | running | clear | candidate | failed | skipped`;
- `poisoning_check_attempts`;
- `poisoning_check_last_error`;
- `poisoning_checked_at`.

Retry failed or stale-running eligible checks at the start of later polling
cycles with bounded attempts. A clear result is persisted so the same transfer
does not repeat provider work.

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
- no manual trusted/false-positive label for the sender;
- sender is not a registered service address;
- sender is not the exact real recipient.

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
but without a similar recent recipient, is not poisoning evidence. Persist the
check as `clear`; do not send a warning or increase risk. If the lookup was
truncated, retain `coverage = partial` on the check rather than implying that
the sender is new across the wallet's full history.

## Evidence Contract

Create typed raw evidence with source `address_poisoning_detector` and a risk
observation whose code describes the exact match, for example:

```text
address_poisoning_exact_amount_suffix_match
address_poisoning_visual_match_without_exact_amount
```

Evidence contains:

- watched wallet;
- token symbol, contract, and decimals;
- suspicious incoming tx, sender, amount, and timestamp;
- matched genuine recipient and outgoing tx;
- outgoing amount and timestamp;
- prefix/suffix match lengths;
- exact-amount flag and elapsed time;
- relationship window, fetched-transfer count, coverage state, and whether the
  sender appeared in the checked history;
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
- genuine recipient and matched outgoing tx hash;
- incoming/outgoing raw amounts and timestamps;
- meaningful prefix and suffix lengths;
- classification and confidence;
- `status = candidate | confirmed | dismissed`;
- raw evidence id;
- Telegram alert status, attempts, error, sent time, and message fingerprint;
- optional later loss tx hash and post-loss route evidence id;
- created and updated times.

Use a unique key over watched wallet, token contract, suspicious incoming tx,
and matched outgoing tx. Reprocessing the same event updates the existing
candidate and never sends a second successful alert with the same fingerprint.

Indexes support:

- active candidates by watched wallet;
- candidate lookup by suspicious sender for future recipient checking;
- pending/retryable alert delivery;
- confirmed/dismissed case review.

Manual `Это знакомый адрес` sets this candidate to `dismissed`; it does not
globally trust every future transfer from the address. `Пометить как подмену`
sets it to `confirmed` and retains the immutable detector evidence.

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
sent immediately for every active watched wallet except `paused`.

Canonical Russian copy:

```text
🔴 Возможна подмена адреса

Кошелёк: THJc…FMD7

Что произошло
Пришло 10 USDT от адреса, которого не было в проверенной истории:
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

## Performance And Failure Handling

- One bounded related-transfer lookup is allowed only after an eligible small
  incoming USDT transfer.
- Deduplicate concurrent checks for the same watched wallet and incoming tx.
- A short-lived per-wallet cache may reuse the same recent transfer page for
  multiple small incoming events.
- Provider timeout marks the poisoning check failed/retryable and does not fail
  normal Incoming analysis.
- Invalid addresses, token mismatch, reverted transfers, self-transfers, and
  transfers after the suspicious event are ignored.
- Alert delivery retries use the candidate fingerprint and persisted state.
- Detector output is deterministic; no LLM key or response is involved.

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
- missing sender creation time does not suppress an exact candidate;
- manual trusted/false-positive sender suppresses automatic warning;
- registered service sender suppresses automatic warning;
- small new deposit with no similar recipient is clear;
- repeated processing is idempotent;
- failed detection retries without blocking normal Incoming work;
- successful alert fingerprint is not delivered twice;
- `risk_only` and `digest` receive the security warning immediately;
- `paused` receives no warning;
- Telegram includes both full addresses and both transaction links;
- no LLM is called.

## Future Recipient Check

The next phase accepts a proposed recipient address and queries active or
confirmed poisoning candidates by watched wallet, token, and suspicious sender.
It reuses the same pure similarity function, policy version, and evidence
record. No candidate migration or reinterpretation should be necessary.

That phase may warn before signing or broadcasting. Telegram cannot cancel an
already signed transaction, so actual hot-wallet blocking requires a separate
integration outside this MVP.

## Documentation Updates During Implementation

Update these current knowledge pages in the implementation commit:

- `docs/knowledge/02-check-modes.md`;
- `docs/knowledge/03-job-lifecycle.md`;
- `docs/knowledge/04-data-sources-tronscan-indexing.md`;
- `docs/knowledge/08-admin-and-bot-ux.md`;
- `docs/knowledge/09-current-decisions.md`;
- `docs/knowledge/10-open-problems.md`;
- `docs/knowledge/13-agent-observations.md`.

The implementation docs must distinguish current USDT-only runtime support
from the token-independent detector interface and future recipient-check phase.
