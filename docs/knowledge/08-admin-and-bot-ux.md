---
status: current
last_verified: 2026-07-27
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
---

# Admin And Bot UX

## Production Truth

The deployed bot still sends legacy mode-specific results and uses the current
Admin views/workers. Technical stops must not be presented as risk decisions.
Delivery ownership remains explicit and independent of analysis execution.

Stage B progress exposes selective-enrichment heartbeat updates no more often
than every 30 seconds plus the final candidate. Transaction evidence IDs are
audit metadata on completed Where/Incoming jobs; provider payloads stay in
immutable evidence storage and are not copied into bot reports.

## Unified Admin And Bot UX

Unified sends nothing while Fast, Where, or Deep is running. After the parent
reaches `COMPLETED`, the bot sends one immutable locale presentation derived
from the same report hash. RU and EN share analysis/report identity and differ
only in presentation artifacts.

The Telegram dossier order is:

1. wallet;
2. final score and risk level;
3. decisive reasons and evidence;
4. balance formation;
5. outgoing movement;
6. services, contracts, labels, and approvals;
7. confirmed relationships and behavior;
8. explicitly scoped coverage;
9. wallet profile;
10. compact conclusion.

Repeated transfers are evidence aggregates rather than raw-row spam. The
dossier includes available USDT/TRX balance, age and first/last USDT activity,
counts/volumes, direct incoming/outgoing services, contract/approval facts,
restriction timing, boundaries, and labelled indirect paths. Essential
evidence cannot be silently truncated; an impossible presentation fails before
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
and warned.

The `/check` wiring and delivery fence are implemented. The fence selects one
delivery owner only; it does not gate planner/controller work or isolated
canaries. Startup schema verification requires schema 036.

## Remaining Product Work

Recipient precheck before signing and other future wallet-safety features are
separate follow-ups; they do not block Unified analysis.
