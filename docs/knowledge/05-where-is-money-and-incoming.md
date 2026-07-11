---
status: current
last_verified: 2026-07-11
owner_area: forensics
code_refs:
  - src/forensics/fundingFirstSourceProvenance.ts
  - src/forensics/gasFreeSettlement.ts
  - src/forensics/serviceClassifier.ts
  - src/forensics/localTronUsdtIndex.ts
  - src/forensics/moneyOriginTrace.ts
  - src/forensics/moneyOriginOperationalAssessment.ts
  - src/forensics/incomingDepositJob.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/targetedHistoryCoordinator.ts
  - src/bot/wherePreliminaryNarrative.ts
  - src/bot/walletNarrativeSummary.ts
  - src/bot/createBot.ts
  - src/index.ts
  - tests/forensics/fundingFirstSourceProvenance.test.ts
  - tests/forensics/gasFreeSettlement.test.ts
  - tests/forensics/moneyOriginTrace.test.ts
  - tests/forensics/moneyOriginOperationalAssessment.test.ts
  - tests/forensics/incomingDepositJob.test.ts
  - tests/forensics/deepForensicJob.test.ts
  - tests/forensics/targetedHistoryCoordinator.test.ts
  - tests/forensics/tronAddressAllTimeIndex.test.ts
  - tests/forensics/targetedIndexRepair.test.ts
  - tests/bot/wherePreliminaryNarrative.test.ts
  - tests/bot/walletNarrativeSummary.test.ts
  - tests/bot/createBot.test.ts
supersedes:
  - docs/superpowers/specs/2026-07-03-where-incoming-outcome-safety-design.md
  - docs/superpowers/plans/2026-07-03-where-incoming-outcome-safety.md
  - docs/superpowers/specs/2026-05-27-where-is-money-balance-origin-design.md
  - docs/superpowers/specs/2026-05-29-incoming-deposit-risk-design.md
---

# Where Is Money And Incoming Deposit

## Difference

`Where is money` explains the origin of the relevant funds on a wallet.

`Incoming deposit` explains one concrete incoming transaction: who sent it and
where that sender got the money before the deposit.

Do not merge these modes. They use similar provenance logic but answer
different user questions.

## Current Behavior

When a matching DeepCheck job is queued or running, Telegram renders ordinary
Where as `Откуда деньги — предварительный результат` / `Where Is Money —
preliminary result`. A numeric preliminary risk is published only when at
least one validity mirror is explicitly `true`, neither mirror is `false`, and
a subject-bound typed fact explains the dominant saved score driver. Explicit
`false` wins over a conflicting `true`; false, undefined-only, and valid but
unexplained results show no emoji or `/100` value.

The preliminary narrative has at most two findings. The first is the primary
fact, its short meaning is a separate conclusion, and material coverage limits
are a separate section rather than risk evidence. It reads saved typed Where
facts and subject-bound Fast or Verify20 facts only. It does not read raw
reasons or LLM text, does not use Deep-only counterparty, relationship,
collector, or first-hop evidence, and does not show a decision, action,
DeepCheck state, or method name.

Historical HTX remains visible `REVIEW` compliance context before the official
designation date and must not be called sanctioned at the transfer timestamp.
At or after the designation boundary, sanctioned wording requires matching
typed `sanctioned_service` evidence for the selected Where path. GasFree
principal remains traceable and scoreable. A GasFree fee is optional technical
detail only when the saved balance-forming transfer has exact `service_fee`
plus `tron_gasfree` roles; destination, familiar amount, or timing alone does
not create that fact or explain the score.

GasFree Accounts and unknown or unlabeled contracts are traceable addresses at
the first, second, third, and later hops. Their contract fact does not create a
service stop. Positively identified pooled infrastructure still does: the
GasFree Endpoint/controller and the registered TronLink/GasFree provider
`TLntW9Z59LYY5KEi9cmwk3PKjQga828ird` remain boundaries after their direct
interaction is recorded.

GasFree principal and service-fee roles are transaction-local facts. They are
assigned only when a successful registered-controller settlement, exact
calldata, official-USDT transfer list, decoded receiver/value, and fee bound all
match. Fee amount and collector are dynamic; address identity or a familiar
amount is insufficient. An unmatched transfer to TLnt remains a visible direct
transfer and is not relabeled as a fee. A structurally exact fee remains in
gross debit/accounting facts but is removed from payer provenance selection.

Complete indexed history is consumed through paged local materialization for
the concrete provenance window. A local row ceiling or database read failure is
a technical local limitation, not a TronScan provider cap and not risk
evidence.

A known-zero current wallet balance makes the current-balance origin question
`not_applicable`; a separately selected recent-flow anchor is an explicitly
different provenance scope. Incoming Deposit does not switch to balance-origin
mode: it remains seeded by the concrete deposit transaction even when the
sender's current balance is zero after sending it.

The trace can stop with `incoming_history_not_fetched` when a hop address needs
older incoming history and the available local/live data does not reach the
target timestamp.

Recent safety fixes make guarded approval-drain review plus legitimate service
context plus no hard bad evidence avoid a final user-facing `DECLINE`. In that
case the system can use `score_valid=false` with a technical coverage block.

Ordinary `Where is money` has resumable targeted indexing for narrow
candidate-window repair and for unresolved hard-evidence branches. Ordinary
material unresolved context does not automatically queue broad targeted work:
it uses a bounded balance-forming slice for the concrete hop and then records a
materiality caveat or block.

Stage 1.5 makes queued broad targeted tasks continue beyond the inline
four-page seed when that path is actually allowed. Background targeted tasks
start from a larger page budget and retry/escalate when the partial state is
caused by our page budget or by a provider-cap path that also exhausted the
local budget.

Stage 1.7 makes broad targeted tasks more efficient for heavy TronScan
addresses. For capped windows, the indexer can walk backward from the oldest
returned row instead of repeatedly splitting by midpoint and refetching the same
top page.
Where waits for the same hop address can also share a later target timestamp,
because that later target covers earlier target timestamps for the same address.

Stage 1.8 makes ordinary Where more tolerant of old retryable targeted states.
Old `partial_provider_cap` states are no longer treated as final terminal
coverage when they also exhausted the local budget; the job requeues targeted
indexing with a larger budget and stays in `waiting_for_targeted_index`.
Targeted resume also skips saved page windows when their page audit is stable.

Stage 1.9 adds a maintenance repair for old false `complete` targeted states.
After repair, ordinary Where does not wake up on that dirty coverage; it keeps
waiting while the targeted worker resumes with the existing cached pages.

Stage 1.10 fixes a same-address coverage edge case in ordinary Where. A newer
targeted state for the same hop address can cover older waits. The coordinator
now checks that covering state before deciding that an exact old
`queued`/`running` state must keep the parent job waiting. If the covering state
is terminal, Where exits waiting with a technical terminal result instead of
waiting on the stale exact state.

Stage 1.12 confirms the ordinary Where waiting/resume lifecycle for a terminal
targeted-index outcome. When the covering targeted state reached the current
12,000-page ceiling and ended as `partial_provider_cap`, all same-address waits
were marked terminal and the parent Where job exited `waiting_for_targeted_index`
with `score_valid=false`, `score_blocked_reason=provider_cap_unresolved`, and
`technical_status=provider_cap_unresolved`.

The parent Where coordinator also receives the same 12,000-page retry ceiling.
It must not turn a ceiling-level `partial_budget_exhausted` or
budget-exhausted `partial_provider_cap` state into a new larger run.

Stage 1.13 adds funding-first source provenance for ordinary Where trace hops.
For a concrete hop transfer, the trace now first asks which prior incoming
funds can explain that hop amount. It records `source_provenance` metadata with
a proof class:

- `exact`: covered funding window, amount math passes, and the trace may
  continue through the selected funders;
- `probable`: amount math supports the funding explanation, but the window is
  capped or incomplete, so it is Admin context, not hard scoring proof;
- `pre_existing_balance_possible`: reached history has no usable funding
  candidate, so the sender may have had earlier balance;
- `unresolved`: the hop source is not proven;
- `service_boundary`: reserved for service-boundary provenance context.

Probable funding-first evidence does not publish a final score by itself and
does not become hard evidence. It replaces some generic debug ambiguity with a
more precise explanation of what funding candidate was seen and why it is not
exact.

Stage 1.13 live validation on `THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7` confirmed
that a terminal targeted state no longer aborts ordinary Where before cache
analysis when local indexed transfers exist. The job completed a Where report
with source-provenance metadata from cached targeted history: exact, probable,
and unresolved proof classes were all visible. Provider-cap/capped-window
funding remains non-final context; it does not become hard evidence.

Stage 1.13b adds exact-window repair for `probable` source-provenance
candidates in ordinary Where. When the broad sender history is capped but a
specific funding candidate is visible, Where can inspect only the window from
that candidate timestamp to the target transfer timestamp. If that narrow
window is complete, amount continuity still passes, and outgoing spend does not
consume the funding, the proof class upgrades from `probable` to `exact` and
the trace may continue through the selected funder. If the narrow window is
capped, inconsistent, empty, or the spend/amount guard fails, the proof stays
`probable` or `unresolved`.

Stage 1.13d adds materiality-based score validity for residual unresolved
source provenance in ordinary Where. If unresolved `source_provenance` entries
are below both local thresholds, currently 1% of checked/selected amount and
100 USDT, and there is no hard evidence in those unresolved branches, Where can
publish a valid `REVIEW` score with a `residual_unresolved_below_materiality`
caveat. Material unresolved source provenance or any hard evidence keeps the
older strict behavior: no materiality bypass.

Stage 1.13f makes that materiality outcome consistent across user-facing
surfaces. A valid ordinary Where `REVIEW` with
`residual_unresolved_below_materiality` remains `REVIEW` in the raw report,
Admin graph, bot final report, and support report. It must not be converted to
`DECLINE`, and it must not be flattened into a fake `ACCEPTABLE` 0/100 result.
Admin keeps unresolved residual paths visible but labels their stop as a
caveat, not as terminal `History not fully fetched`.

Stage 1.13g extends materiality handling to provider-capped dense-hop source
tails. If unresolved dense-hop branches are below both branch and aggregate
materiality thresholds and there is no hard evidence, ordinary Where can publish
a valid covered-part `REVIEW` score with
`dense_hop_unresolved_below_materiality`. The unresolved dense-hop tail remains
visible in Admin and Telegram as a caveat and is excluded from decisive clean or
bad evidence. Material unresolved source, aggregate unresolved source above the
threshold, or hard evidence still blocks or drives the result.

Stage 1.13g lifecycle follow-up closes the early parent terminal path for
ordinary Where. A fresh job resumed from targeted `partial_provider_cap` progress
now continues into report building and `moneyOriginOperationalAssessment` before
deciding whether the dense-hop tail is below materiality. The job stores a full
`whereIsMoneyReport`, source-provenance materiality, and top-level
`score_valid`/`technical_status` mirrors. Old cached failed jobs are not
silently reinterpreted; run a fresh Where check to get the new result.

Ordinary Where and Incoming deposit now try candidate-window targeted indexing
before broad targeted fallback for `probable` funding-first source provenance.
After source provenance is computed, the trace selects narrow candidate-to-hop
windows and waits for those targeted states first. Requesting or waiting on
candidate windows does not itself queue broad targeted history. For ordinary
Where, material unresolved source exposure after candidate-window rerun no
longer starts the older broad `where_is_money_hop` targeted fallback by itself.
The normal repair is the balance-forming slice for the concrete hop: fetch
incoming transfers before that hop transfer and stop once the fetched funding
can explain the target amount. Hard-evidence branches can still require broad
fallback. Below-materiality unresolved exposure remains a completed caveated
Where result instead of a broad-history request. Incoming keeps its separate
`incoming_deposit_hop` fallback path.

Candidate-window waits are durable and resumable. They use the exact
candidate-window identity (`address`, target timestamp, window start, and
candidate tx hash), so several funding candidates for the same hop can be
indexed independently. When all candidate windows for a waiting job are ready
or terminal, the parent job resumes and re-runs funding-first provenance. If
the exact candidate windows cover the material hop amount, broad targeted
fallback is not needed. If they do not, ordinary Where does not escalate from
ordinary material unresolved context to a broad `genesis -> targetTimestamp`
targeted run. It records the unresolved/pre-existing/dense balance caveat and
lets materiality or hard-evidence rules decide whether the score is valid.
Service/CEX boundaries stop before candidate-window, balance-slice, or broad
fallback work for that boundary address.
Candidate windows do not change scoring math and do not become hard proof unless
the existing funding-first rules classify the repaired window as `exact`.

For ordinary Where post-assessment broad fallback, only unresolved branches that
intersect hard evidence queue the full deduped broad target batch before the
parent job is released to `waiting_for_targeted_index`. Aggregate material
unresolved context alone is not hard evidence and does not trigger broad
fallback.

Balance-forming slice progress is distinct from targeted indexing. A running
job uses `jobPhase=checking_balance_forming_slice` and stores compact
`balanceFormingSlice` metadata: hop address, related hop transaction, target
amount, fetched page/transfer counts, coverage ratio, status, and provider or
budget flags. It does not store raw transfer rows in job progress. Admin renders
this as bounded live slice progress, not as `WAITING: TARGETED INDEX`.

Admin now applies a route-focused visibility policy to saved ordinary Where
funding candidates. Exact `source_provenance` funding members are shown as
funding edges only when they attach to a concrete route hop
`candidate -> hop -> next hop / subject`. Probable candidates remain context,
not proof. Pre-existing-balance, unresolved, and service-boundary outcomes are
shown as caveat/boundary facts. Large candidate tails are grouped instead of
silently dropped; current Admin caps are 20 exact candidates globally, 5 exact
candidates per ordinary hop, 5 probable candidates globally, and 2 probable
candidates per ordinary hop. Important hops can exceed the per-hop soft cap
inside the global cap.

Incoming deposit can still produce `scoreValid=false` when targeted coverage is
blocked. It now uses the shared resumable targeted indexing flow, including
candidate-window-first checks, before it publishes a technical coverage block.

The inline targeted seed path still uses `TARGETED_HISTORY_INLINE_MAX_PAGES =
4`, but ordinary Where no longer treats that local seed limit as a finished
answer. The normal path is candidate-window repair for probable candidates,
then a bounded balance-forming slice for the concrete hop. Broad background
targeted indexing with larger Stage 1.7 budget/depth settings is reserved for
unresolved branches that intersect hard evidence.

## Planned Behavior

A full answer means the system either:

- traces the required path to a meaningful source;
- reaches a legitimate service boundary;
- reaches the configured depth limit with covered hop history;
- finds hard bad evidence;
- finds clean operational evidence strong enough for the scoring matrix.

A local budget stop is not a full answer.

## Honest Stops

Honest boundary stops include:

- CEX;
- DEX;
- bridge;
- router;
- known service contract;
- known service wallet.

These boundaries should be shown as boundaries, not as data failure.

## Non-Final Stops

These should not be final paid results on the main money path:

- `incoming_history_not_fetched`;
- `partial_budget_exhausted`;
- old partial targeted index reused as terminal;
- timeout before required hop coverage;
- local page cap that can be raised.

Current Where behavior: for required hops, the job first uses narrow
candidate-window repair where possible, then checks a bounded balance-forming
slice for the concrete hop. If that still cannot cover a material amount, Where
publishes a caveat/block according to materiality and hard-evidence rules.
Only hard-evidence unresolved branches request broad targeted history; if that
broad target ends in a real provider/safety terminal state, Where finishes with
`score_valid=false` and a technical status, not a final score.

Current Incoming behavior: uses the same candidate-window-first targeted
wait/resume primitive as Where, but still answers the concrete deposit question
rather than a wallet-balance question.

Current caveat: targeted worker runs now update lock heartbeat while fetching,
but Admin still presents mostly state-level progress. It is enough to tell that
the job is waiting for targeted history and the worker is alive, but it is not
yet a full per-window stream.

## `History Not Fully Fetched`

This message means the trace needed older incoming history for a hop address and
the available data did not reach the target timestamp.

The product direction is:

```text
Do not show this as final. Keep indexing or finish with a technical stop that
does not publish a final score.
```

## Score Rule

If hard evidence is absent and required provenance coverage is incomplete, the
system must not publish a final user-facing `DECLINE`.

An exact, subject-applicable hard proof is independent of an unrelated coverage
failure. It remains a valid `DECLINE` while the result keeps
`coverage=partial` and the technical limitation visible.

Residual unresolved source provenance below materiality is different from an
uncovered main money path. It is still shown as a caveat, not exact proof, but
it does not make the whole Where score invalid when hard evidence is absent.
Provider-capped dense-hop source tails get the same treatment only when they
are below branch and aggregate materiality thresholds; the unresolved tail is
not treated as clean or bad evidence.

Dense-hop provider-capped unresolved source below branch and aggregate
materiality thresholds follows the same score-valid caveat rule. It is not
clean evidence, bad evidence, or proof of covered history.

If `score_valid=false`, Admin and Telegram must show that this is a technical
coverage block, not a verdict.

## Known Gaps

- Incoming now has the general candidate-window-first continue-indexing-then-resume
  loop. Remaining Incoming gaps are around product progress visibility
  and terminal provider/budget stops, not the absence of a resumable targeted
  primitive.
- Where has Stage 1 waiting/resume, Stage 1.5 background budget escalation,
  Stage 1.7 adaptive cursor indexing, and Stage 1.8 cache-aware resume for
  targeted partials. Stage 1.10 fixes finished covering targeted states
  shadowed by old exact non-covered states. Stage 1.12 confirms parent wake for
  terminal targeted coverage at the current ceiling. Stage 1.13 adds
  funding-first source-provenance metadata for concrete Where hops. Stage 1.13b
  can upgrade some capped `probable` funding candidates to `exact` by repairing
  only the candidate-to-target window. Stage 1.13d allows low-materiality
  residual unresolved source provenance to remain a caveat instead of a
  job-level technical blocker. Stage 1.13f keeps that caveated result as
  user-facing `REVIEW` consistently across Admin and bot formatting. Stage
  1.13g does the same for below-threshold dense-hop provider-cap tails while
  keeping material and hard-evidence branches blocking. The lifecycle follow-up
  makes resumed `partial_provider_cap` parents run the materiality assessment
  instead of completing directly from `provider_limited` progress. The bounded
  balance-forming slice follow-up stops ordinary Where from launching broad
  targeted history for material unresolved context alone; it fetches only the
  concrete hop's prior balance-forming inputs and leaves incomplete dense or
  pre-existing balance as explicit caveats unless hard evidence requires broad
  coverage.
- Provider-cap terminal states can still block scoring when the indexer cannot
  resolve the range inside the current Stage 1.7 budget/safety ceiling.
- Ordinary Where can still use cached indexed transfers after a terminal
  targeted provider-cap state to produce funding-first context. That context is
  not the same as exact covered history.
- Ordinary Where Admin visibility is limited to saved source-provenance facts
  attached to route hops. It does not add arbitrary wallet neighbors and does
  not use DeepCheck relationship expansion.
- Funding-first exact-window repair is now an inline bounded Where repair, not
  a broad address-history fetch. The queued candidate-window mode now supplies
  durable narrow windows first; probable capped-window findings remain non-final
  context unless the narrow repaired window is proven complete.
- Old incorrectly completed targeted states from pre-fix/dev runs need the
  maintenance repair before they can be trusted. The repair path exists, but it
  is not an automatic production migration.
- Admin graph can still show `History not fully fetched` for old or partial
  jobs.
- Split depth/window progress is not yet shown as a first-class Admin field.
