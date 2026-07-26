---
status: current
last_verified: 2026-07-25
owner_area: docs
code_refs:
  - AGENTS.md
  - docs/knowledge/AGENT_BRIEF.md
  - src/monitor/addressPoisoningWorker.ts
  - src/storage/repositories.ts
  - src/tron/tronClient.ts
  - src/approvals/allowanceState.ts
  - src/storage/schemaMigrations.ts
  - src/bot/createBot.ts
  - src/telegram/forensicPresentation.ts
  - tests/bot/unifiedTelegramModeWiring.acceptance.test.ts
  - tests/telegram/forensicPresentationContract.acceptance.test.ts
  - docs/superpowers/specs/2026-07-24-unified-wallet-check-adaptive-rolling-planner-design.md
supersedes:
  - docs/superpowers/specs/2026-07-03-project-knowledge-workflow-design.md
---

# Agent Observations

This file stores repeated agent mistakes and user corrections that future
agents should remember.

## 2026-07-03: Do Not Collapse Check Modes

Agent mistake:

The agent described a "single full provenance mode" in a way that sounded like
it would replace existing modes.

Correct rule:

The product keeps separate modes: fast, deep, where, incoming, and unified
`/check`. They can share indexing infrastructure, but they answer different
questions.

Fixed in:

- `docs/knowledge/02-check-modes.md`
- `docs/knowledge/09-current-decisions.md`

## 2026-07-03: `History Not Fully Fetched` Is Not A Product Answer

Agent mistake:

The agent treated incomplete history as a technical explanation that could be
shown as an end state.

Correct rule:

For paid forensic provenance, if the main money path is incomplete because of
our page budget or partial index state, the system should continue indexing or
finish with a technical no-score state. It should not publish a final score.

Fixed in:

- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/09-current-decisions.md`

## 2026-07-03: Docs Are Not Code Proof

Agent mistake:

The agent can over-trust documentation when describing current behavior.

Correct rule:

Knowledge docs define product intent. Code proves current implementation. If
they disagree, report the disagreement and verify code before changing behavior.

Fixed in:

- `docs/knowledge/01-product-principles.md`
- `AGENTS.md`

## 2026-07-10: Contract And Score Are Facts, Not Policy Shortcuts

- `isContract` does not imply service boundary or risk.
- A numeric score does not imply hard evidence.
- Fee/service roles require transaction structure; address identity alone is insufficient.
- Coverage failure changes certainty, not badness.

## 2026-07-11: Do Not Turn Every Fact Into A Theft Disclaimer

Agent mistake:

The agent repeatedly appended phrases such as `this does not prove theft` or
`this is not proof of dirty funds` to bridge, collector, service, victim, and
counterparty facts. The disclaimers made the report longer and framed ordinary
wallet behavior as presumptively criminal.

Correct rule:

State the observed fact, the address role, and the required action. Add a
boundary of knowledge only when it prevents a concrete overclaim. A victim is
simply called a victim. Collector behavior is described as a wallet role.
Bridge exposure is described as cross-chain AML risk without claiming that
every bridge transfer, or every laundering scheme, has the same meaning.

## 2026-07-11: Keep Address Fixtures And Economic Claims Grounded

Agent mistakes:

- A mixed-case TGyt placeholder was treated as a valid TRON address even though
  Base58 addresses are case-sensitive.
- A nearby 3 USDT GasFree fee was described as a settlement tied to a principal
  transfer without saved structural evidence for that relation.
- Contract and GasFree account types were used as reasons to skip ordinary
  principal scoring.

Correct rules:

- Use the canonical valid fixture
  `TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD`; validate copied addresses before
  building a regression around them.
- State only the saved economic fact. An exact service-fee edge is separate
  technical context and is excluded from principal, but timing or destination
  alone does not prove how that fee settled another transfer.
- `isContract` and GasFree-account status are address facts, not scoring
  exemptions. Exclude only an exact GasFree `service_fee` edge. Principal
  transfers remain eligible at every hop.

## 2026-07-11: Historical HTX Exposure Is Not Neutral

Agent mistake:

The agent proposed hiding pre-designation HTX/Huobi transfers behind the
neutral phrase `historical exchange source`, as if only transfers after the
sanctions date mattered to the user.

Correct rule:

The official designation date still controls whether a transfer is called a
direct sanctioned source. Earlier HTX/Huobi exposure nevertheless remains
material `REVIEW` compliance context and must be named plainly, because a
receiving service may delay the funds and request additional source-of-funds
checks. Do not call a pre-designation transfer sanctioned at that timestamp,
and do not flatten it into an ordinary clean CEX source.

## 2026-07-12: Wallet Safety Is Not An AML Score

Agent mistake:

A critical security warning can be treated as permission to raise the wallet's
AML score or change a source-of-funds decision.

Correct rule:

Keep the action urgent but keep the domains separate. Address poisoning is
`wallet_safety` with exactly zero score impact and is excluded from AML inputs.
A low AML result also cannot cancel an active safety warning.

## 2026-07-12: Unknown Or Partial History Is Not Clean

Agent mistake:

A bounded lookup found no match, so the sender was described as new or safe
even though the full window was not covered.

Correct rule:

Negative partial coverage is `inconclusive`. It becomes `clear` only after
complete negative coverage or an exact disqualifier that is already proven in
the checked evidence.

## 2026-07-12: Names Do Not Establish Trust

Agent mistake:

Provider text, a public tag, contract name, token label, or AI phrase was used
as if it authorized automatic suppression.

Correct rule:

Suppress only from an authorized manual trusted/false-positive decision, an
exact authoritative address-registry match, or an exact prior direct relation.
Names and free text are context, not authority.

## 2026-07-12: Async Ownership Needs Its Own Lease

Agent mistake:

A generic row `updated_at` was treated as delivery ownership, so unrelated
candidate changes could steal or invalidate an active Telegram send.

Correct rule:

Long external delivery needs both a monotonic claim generation and a dedicated
lease timestamp. The lease owns heartbeat, liveness, and stale reclaim. The
generation owns terminal compare-and-set writes. Keep the heartbeat active
through final acknowledgement, serialize reclaim against finalization by
generation, and state the external crash gap honestly instead of claiming
exactly-once delivery.

## 2026-07-12: Coverage Metadata Needs A Pinned Authority

Agent mistake:

Fallback rows, changing totals, short pages, or provider risk labels were
treated as enough to prove a complete clean history.

Correct rule:

Evidence used to prove negative coverage must stay pinned to one authoritative
provider and retain its range metadata, offsets, totals, hashes, and overlaps.
Missing, contradictory, mixed, or non-progressing pagination stays partial.
Provider risk labels are context, not transaction validity: a confirmed,
successful, non-reverted official-USDT relationship still counts, with the raw
flag preserved in evidence.

## 2026-07-13: Legacy Or Event Data Does Not Create Current Authority

Agent mistake:

An old field or approval event was treated as proof of the current on-chain
allowance.

Correct rule:

Legacy/event data can preserve history, but cannot imply current active, zero,
or unlimited allowance. Only a fresh, subject-bound direct contract-call result
can establish current authority. A failed or expired result is non-authoritative.

## 2026-07-13: Database-Written Time Uses The Database Clock

Agent mistake:

Application time was mixed with database time for a causal state transition,
which could make freshness ordering depend on host clock skew.

Correct rule:

Use the database clock for database-authored transition timestamps. Validate
causal ordering and freshness from one clock domain.

## 2026-07-13: State The Scope Of Inspected Evidence

Agent mistake:

A bounded selected slice was described as if it represented the wallet's full
history.

Correct rule:

Persist and name the inspected scope, available denominator when known,
selected facts, exclusions, and limitations. Unknown legacy denominators stay
unknown.

## 2026-07-13: Bind Evidence To An Exact Event Identity

Agent mistake:

Similar addresses, amounts, or labels were enough to attach a fact to a route.

Correct rule:

Evidence that drives a route or state must bind to the exact event identity and
subject. Address labels and amount similarity are context, not causal proof.

## 2026-07-17: Test The Real Mode Boundary With An Independent Oracle

Repeated mistake: a presentation fixture selected preliminary Where from
coverage and reused a production helper to compute its own expected escaping.
Correct rule: pending Deep alone selects preliminary versus final, so keep the
other input identical; boundary tests use literal independent expectations, not
the implementation under test as their oracle.

## 2026-07-23: Do Not Confuse Aggregation, Coverage, And Completion

Repeated corrections:

- A route share of 100% was described as if it proved 100% source coverage.
- A dense collector aggregation was described as if it were automatically a
  terminal boundary.
- An existing legacy fallback score was proposed for publication even though
  limited coverage can raise that score.

Correct rule:

- Every percentage names its denominator and scope.
- Aggregation only compresses equivalent work or presentation; it does not end
  a route without a separate evidence-backed terminal reason.
- Coverage is audit metadata in the approved matrix-v4 target and never
  creates risk points.
- A completed parent run owns the single score and delivery. Fast, Where, and
  Deep remain separate evidence producers and must not publish competing final
  results.
- New target behavior is documented as planned until code and runnable checks
  prove it; do not rewrite current behavior as if the design were already
  deployed.

## 2026-07-23: New Schema Must Update Existing Runtime Guards

Repeated mistake: a new migration was hidden from an older schema test instead
of being added to the fail-closed migration/startup contract.

Correct rule: bind the exact new migration/checksum and real trust-boundary
fixture while continuing to reject future or unknown files.

## 2026-07-24: Do Not Turn Performance Hopes Into Product Limits

Repeated correction: proposed two/ten-minute targets and “estimated remaining”
work drifted toward user-visible limits even though dense frontier size is not
known in advance.

Correct rule: measure frozen cases first. Admin may show exact discovered
outstanding work and say that the total is still expanding, but never invents
ETA or percent complete. Internal SLO proposals do not stop analysis, publish
partial scores, add risk, or become correctness gates without a separate decision.

## 2026-07-24: Simulated Capacity Is Not Live Capacity Proof

Repeated correction: an architecture intended for 8–100 provider groups was
described as if those groups were already available for a live benchmark, and
high Windows/WSL memory percentage was treated as if it proved a leak.

Correct rule: use deterministic replay to prove scheduling and correctness at
large logical capacity, but claim live throughput only for independent groups
that actually exist and passed a canary. WSL is local diagnostic evidence, not
the production memory contract. A leak requires sustained RSS/available-memory
or swap evidence across comparable runs, not one host percentage.

## 2026-07-25: Artifact Hash Is Not Planner Identity

Agent mistake: a correctly hashed address-history manifest could be selected
by its own embedded key even when the planner row belonged to another logical
task. A follow-up implementation then treated a non-address expected task kind
as permission to skip identity validation even when the accepted artifact
itself was an address-history manifest.

Correct rule: before traversal mutation or ordered commit, recompute the
manifest key from authoritative identity fields and require task kind, planner
logical key, embedded key, and recomputed key to agree. At the checkpoint
boundary, any address-history marker requires the complete expected task,
stored task, artifact kind/schema, and canonical-key tuple. Specialized
validation may be skipped only for a genuinely marker-free generic artifact.
Content integrity does not substitute for contextual identity binding.

## 2026-07-25: Release Labels Do Not Prove The Executed Command

Agent mistakes:

- The canonical release command string named migration 034 while the spawned
  argv still ran the migration-033 test.
- Schema-034 fields were added in place to historical release-evidence V1,
  execution-receipt V2, and prepared-settlement V2 shapes.

Correct rule:

- Test the actual executable and argv independently from the displayed command
  string.
- Versioned evidence is immutable. A new required field needs a new
  discriminator and current path; keep exact historical validators and use an
  explicit versioned reader only where old evidence must remain readable.

## 2026-07-25: Capacity Claims Need Measured Evidence

Repeated corrections:

- Four key strings were treated as proof of four independent provider groups.
- A local WSL percentage was treated as production memory evidence.
- A configured ceiling was treated as proof of measured live throughput.

Correct rule:

- Live capacity is capped by audited independent groups actually exercised.
- Missing WSL is a local diagnostic skip; WSL trends never substitute for a
  target Linux cgroup/host gate with process, DB, checkpoint, and post-run
  evidence.
- Adaptive rolling is ordinary validated configuration, but live capacity
  claims still require measured closure, errors, group use, throughput, and
  memory. On Windows invoke the benchmark with direct Node or `npm.cmd`; never
  loosen its CLI because `npm.ps1` swallowed flags.

## 2026-07-25: Persist Run Policy, Not Deployment Ceremony

Repeated corrections:

- Rollout was inferred from planner-row existence and recomputed from current
  configuration after restart.
- Planner execution was coupled to a separate deployment-approval subsystem.

Correct rule:

- Migration 036 retains stage, bucket, admission policy, and provider ceiling
  on each new run while removing rollout-receipt authority.
- Configuration chooses the policy for new work; restart loads the persisted
  choice, and fallback uses the same planner/commit path.
- The generation fence remains only for delivery idempotency. It must not gate
  provider work, analysis, reconciliation, or isolated canaries.

## 2026-07-25: Schema Catalog Mocks Do Not Prove PostgreSQL Driver Types

Agent mistake: schema-034 catalog verification passed mocked unit rows but
failed on PostgreSQL because `array(attname)` returned `name[]`, which
`node-postgres` did not decode as the `text[]` expected by the canonical hash.
Several PostgreSQL fixtures also stopped at schema 034 after runtime writes
had moved to schema 035.

Correct rule: cast catalog identities to stable transport types such as
`attname::text`, run the real migration acceptance, and execute the migration
command twice on the same disposable database. Any fixture exercising current
runtime writes must install the current additive schema; historical schema
gates remain separate and fail closed on newer drift.

## 2026-07-26: Benchmark Markers Must Not Become Canary Ceilings

Agent mistake: the live runner retained a hard 35-minute lifecycle deadline
while the accepted benchmark contract required dense checks to continue to a
terminal result or a real provider/resource blocker. Two healthy rolling runs
were cancelled by the harness despite ongoing bounded progress.

Correct rule: keep a generous abandoned-run safety guard separate from the
ten-minute comparison marker, log the guard explicitly, and treat a reached
guard as a blocked benchmark result rather than evidence about scheduler
correctness or provider capacity.

Operational refinement: a frozen 120-minute guard can still be shorter than a
real cold traversal with more than a thousand discovered histories. Keep 120
as the default, but allow a bounded startup-only override for an explicitly
observed isolated benchmark; do not mutate run timestamps or reinterpret a
deadline failure as a scheduler result.

## 2026-07-26: Wall Clock Is Not A Monotonic Planner Clock

Live admission exposed a timestamp-order constraint failure when PostgreSQL's
wall clock moved backward between planning and admission statements. Durable
state was correct, but `statement_timestamp()` alone could be earlier than the
persisted predecessor timestamp.

Correct rule: planner lifecycle timestamps use the later of database wall time
and the preceding durable timestamp. Timestamp constraints remain strict, but
clock adjustment cannot turn a valid state transition into a technical failure.

## 2026-07-26: Proposed Assignments Are Not Accepted Capacity

Agent mistake: repeated provider proposals were counted as refill and capacity
before the pool checked the current slot epoch and accepted them.

Correct rule: retain proposed, accepted, and rejected assignments separately.
Only accepted assignments count toward actionable slots, pool target, or refill
evidence. A stale-epoch rejection requests one coalesced retry wake when safe
eligible work remains; active, pending, and draining rejections wait for their
normal lifecycle boundary.

## 2026-07-26: Seeded Fixtures Do Not Prove Production Boundaries

Agent mistake: a generic planner replay seeded a frozen V2 dataset but never
loaded or evaluated it through the production traversal coordinator, then was
described as the production oracle.

Correct rule: boundary evidence is proved only when the production runtime
loads the hash-bound dataset and the production coordinator materially changes
traversal. Keep scheduler replay receipts as a separate deterministic scale
contract.

## 2026-07-26: Process Totals Are Not Selected-Run Evidence

Agent mistake: a selected TXc artifact copied process-global demand, active
slots, refill history, and a hardcoded zero reconciliation count under the
selected control identity. Unrelated work could therefore satisfy utilization,
and a real recovery could disappear.

Correct rule: scope selected capacity and limiting values to the controlled
run, reset and scope every retained diagnostic event at the control boundary,
mark foreign active permits as contamination, and count only isolated
timer-originated recovery cycles. Event and timer causes remain separate, and
event dominates when both coalesce; a generic event-woken controller cycle is
not reconciliation. A filesystem journal cannot authorize a unique execution
across Windows durability gaps or ancestor swaps. Commit a stable PostgreSQL
technical maintenance fence before canary invocation, keep it out of product
results/work/cleanup, and fail closed on any prior marker. Capture phase bytes
through stdout, pass runtime values without a pathname, compare them exactly,
and let Node exclusively create/sync final memory children.
