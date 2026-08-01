---
status: current
last_verified: 2026-07-28
owner_area: admin
code_refs:
  - src/admin/adminConsole.ts
  - src/admin/forensicsGraph.ts
  - src/bot/createBot.ts
  - src/forensics/telegramDeliveryWorker.ts
  - src/unifiedCheck/presentation.ts
  - src/unifiedCheck/delivery.ts
  - src/unifiedCheck/productionFinalizer.ts
  - src/unifiedCheck/watchdog.ts
  - src/unifiedCheck/lifecycleNotification.ts
  - src/unifiedCheck/runtimeHandoffRepository.ts
---

# Admin And Bot UX

## Production Truth

The production bot uses Unified intake and parent-only delivery for address
`/check` under the active Unified generation. It acknowledges the accepted
check immediately and sends no Fast/Where/Deep child result. Legacy Where,
Deep, Incoming, and legacy delivery workers remain active for work not owned by
a Unified chat/address pair; `/check <tx-hash>` remains legacy. Admin therefore
exposes both legacy job views and Unified parent/child, lifecycle, and delivery
state. Technical stops must not be presented as risk decisions. Delivery
ownership remains explicit and independent of analysis execution.

Stage B progress exposes selective-enrichment heartbeat updates no more often
than every 30 seconds plus the final candidate. Transaction evidence IDs are
audit metadata on completed Where/Incoming jobs; provider payloads stay in
immutable evidence storage and are not copied into bot reports.

## Unified Admin And Bot UX

After durable Unified intake, the bot immediately acknowledges that the address
check started and that the final result will arrive in the same chat. This is a
lifecycle acknowledgement, not a preliminary analytical report. It also makes
clear that the old input-form `Cancel` button cannot stop an already accepted
check. While Fast, Where, or Deep is running, Unified sends no child result.
After the parent reaches `COMPLETED`, the bot sends one immutable locale
presentation derived from the same report hash. RU and EN share analysis/report
identity and differ only in presentation artifacts.

If a check remains non-terminal for five minutes, the bot sends one plain
progress message explaining that a large transaction history can take longer;
it contains no score or risk conclusion. If a runtime update cannot safely
continue the pinned analysis before the two-hour drain deadline, the bot sends
one explicit technical-stop message and a `Повторить` / `Retry` button for the
same address. This lifecycle outbox is separate from completed analytical
delivery, and ambiguous Telegram acknowledgement remains
`DELIVERY_UNKNOWN` rather than being resent automatically.

New Unified Telegram presentations use the customer-facing V2 renderer. The
Telegram dossier order is:

1. full checked wallet address;
2. final numeric score and risk level;
3. a plain-language decisive reason;
4. separate guidance for sending and receiving funds;
5. chronological money movement and current balance;
6. labeled services, contracts, and approvals;
7. grouped customer-relevant behavior;
8. compact wallet profile;
9. plain-language coverage and limitations;
10. conclusion and snapshot block.

Customer copy never exposes canonical scope, role, code, fact-count, or raw
coverage-key names. USDT values remain exact in the report and receipt but are
shown with at most two decimals; non-zero dust below `0.01 USDT` is described
as such. Dates are readable UTC values, counts are localized, and counterparties
remain shortened clickable TronScan links while the checked wallet stays full.
Repeated transfers are grouped instead of becoming raw-row spam.

The visible V2 text does not replace audit detail. The completeness receipt
continues to bind every canonical fact ID, exact raw amount, denominator, risk
class, and report hash. Deterministic length-reduction removes repeated examples
before compacting profile detail. It never removes the score, decisive reason,
sending/receiving guidance, material hard evidence, material coverage limits,
or conclusion. If those cannot fit, presentation creation fails before
delivery.

Admin exposes parent/child states, immutable attempts, provider waits,
closure/coverage diagnostics, artifact hashes, score anchor, delivery state,
and watchdog actions. The authorized Unified detail view also shows the
current phase, active/idle/cooling provider slots, request rate, opaque
key-group use, exact discovered outstanding work, frontier current/peak,
address-history reuse, cache/network counts, and checkpoint/delta bytes.
Its on-demand adaptive snapshot shows opaque owner and lane, fair share,
active slots, last service time, lookahead, durable/admitted/leased/ready/
committed planner counts, canonical-head age, ready/reserved buffer, last
commit, throughput, and the decision-time blocker. These run-level identities
do not become permanent metric labels.
When the frontier can expand it says `total still expanding`; it never invents
percent complete or ETA. `FAILED_TECHNICAL` is operational.
`DELIVERY_UNKNOWN` is visible and never auto-retried; manual resend is explicit
and warned. It keeps the original stored HTML unchanged inside the warning
wrapper and retains the original V1/V2 manifest version; it never rerenders a
historical result with current copy.

The Unified list also shows a read-only runtime handoff summary: instance
label, short commit, lifecycle state, heartbeat age, drain deadline, compatible
non-terminal run count, and aggregate lifecycle-notification states. It does
not expose wallet addresses or chat IDs and has no runtime mutation buttons.

The `/check` wiring and delivery fence are implemented. The fence selects one
delivery owner only; it does not gate planner/controller work or isolated
canaries. Startup schema verification requires schema 037.

## Remaining Product Work

Recipient precheck before signing and other future wallet-safety features are
separate follow-ups; they do not block Unified analysis.
