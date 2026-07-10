# Forensic and Scoring Correctness Design

Date: 2026-07-10
Status: approved in brainstorming; pending written-spec review

## Purpose

Define one coherent correction track for the chain:

```text
address classification
  -> tracing
  -> data completeness
  -> evidence strength
  -> score validity
  -> user decision
```

This track fixes forensic and scoring correctness before any Admin or map
redesign. It does not replace the full project audit. The audit remains the
master register, and findings outside this causal chain remain deferred for
separate tracks.

## Evidence Behind This Design

The project audit found several release-blocking inconsistencies:

- missing provenance can become a valid `DECLINE`;
- complete indexes can be consumed through truncated 150/200-row reads;
- `REVIEW` or `INSUFFICIENT_EVIDENCE` can become `ACCEPTABLE`;
- exact hard evidence can be suppressed by an unrelated coverage failure;
- a context-only Fast score of 85 or more can be relabeled as hard/scam
  evidence;
- GasFree user smart accounts are treated as service boundaries and therefore
  skipped by tracing and counterparty scoring.

The live GasFree cases that motivated the address-policy correction are:

- `TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP`;
- `TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD`.

Both are TRON contract accounts and per-user GasFree Accounts. Their confirmed
`permitTransfer` calls identify one controlling user EOA for each account and
produce a principal USDT movement plus a separate fee movement. The shared
controller is `TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U` (GasFree Endpoint). The
known current service-provider and fee-recipient account is
`TLntW9Z59LYY5KEi9cmwk3PKjQga828ird`.

Observed fee examples include 1, 1.5, 2, and 3 USDT. These are examples, not
policy constants. GasFree activation and transfer fees can vary with provider
configuration, which may in turn reflect network conditions. Exact fee role
comes from transaction structure, never from matching one of these amounts.

Primary protocol references:

- https://docs.gasfree.io/
- https://support.tronlink.org/hc/en-us/articles/38903684778393-GasFree-User-Guide
- https://developers.tron.network/docs/account

## Scope

This design includes:

- GasFree Account versus GasFree Endpoint classification;
- ordinary and contract addresses at first, second, third, and later hops;
- dynamic GasFree fee recognition;
- incorrect `unknown_contract` stops;
- direct contract-address checks;
- missing provenance becoming a decline;
- loss of `REVIEW` and `INSUFFICIENT_EVIDENCE` outcomes;
- context-only Fast scores being promoted to hard evidence;
- exact hard evidence being suppressed by another mode's coverage gap;
- false provenance completeness caused by bounded local index reads;
- `scoreValid`, coverage, provider-cap, and local-budget semantics when they
  affect the result;
- minimal Admin and Telegram changes required to display the corrected result
  honestly.

## Out of Scope

- Admin redesign;
- map layout, graph compaction, responsive behavior, or accessibility;
- worker leases or stale-worker fencing;
- migration-runner safety;
- durable Telegram delivery;
- general runtime, operations, or security hardening;
- unrelated Telegram copy improvements;
- a new blockchain provider;
- manual CSV workflows;
- new dependencies;
- bulk rewriting or silently rescoring old jobs.

The full audit findings in these areas remain recorded in
`output/project-audit-2026-07-09.md` and are marked `Deferred — separate
UI/UX, runtime, or operations track` for planning purposes.

## Product Invariants

1. `isContract` is a blockchain fact. It is not automatically risk, a service
   identity, or a tracing boundary.
2. Address role and tracing policy are separate. A user-controlled smart
   account can be a contract and still be traceable.
3. Only positively identified shared or pooled infrastructure is a legitimate
   boundary.
4. Missing coverage creates uncertainty. It never creates badness and never
   creates cleanliness.
5. Numeric score never determines proof class. Proof class comes from explicit
   evidence type, scope, and eligibility.
6. An applicable exact hard proof is independently sufficient for `DECLINE`.
   Unrelated partial coverage remains visible but cannot erase the proof.
7. Without exact hard proof, materially incomplete required provenance yields
   `NO_FINAL_DECISION`.
8. A single context-only Fast signal is review-only regardless of its raw
   numeric score.
9. User-decision mapping is lossless: `REVIEW` remains `REVIEW`, and
   `INSUFFICIENT_EVIDENCE` becomes `NO_FINAL_DECISION`.
10. Every newly produced report sets score validity explicitly. `undefined`
    never means valid inside core logic.
11. Fast, Deep, Where, and Incoming remain separate modes. Unified scoring
    composes their evidence but does not redefine their questions.
12. A local page limit, database read limit, or provider cap is not evidence
    about the wallet.

## Chosen Approach

Use a small canonical semantic core rather than a list of unrelated patches or
a full result-schema rewrite.

The core has four responsibilities:

1. separate address facts, roles, and boundary policy;
2. extract transaction-local GasFree economic roles;
3. materialize enough local indexed history for the concrete provenance
   question;
4. resolve final disposition once from matrix result, coverage, and applicable
   hard proof.

Existing collection, indexing, matrix scoring, and report structures are
reused where possible. No database migration or new package is required for
this design. Nullable `finalScore` and explicit `scoreValid` are report-level
JSON/type semantics: existing JSON storage can represent them, while adapters
normalize legacy records at the compatibility boundary. This is not the full
discriminated result-schema rewrite rejected below.

## Architecture

```text
on-chain/provider facts
  -> address semantics
  -> GasFree settlement extraction
  -> Fast / Deep / Where / Incoming evidence candidates

local transfer index
  -> coverage materializer
  -> mode coverage and provenance evidence

evidence candidates + coverage + applicable hard proof
  -> canonical final-disposition resolver
  -> unified result
  -> minimal Telegram/Admin serializers
```

### Address Semantics

Keep these concepts distinct:

- `isContract`: immutable provider/on-chain fact;
- `category` and `identity`: interpreted role;
- `isBoundary`: whether public-chain tracing should stop;
- confidence/evidence: why the role and boundary policy are trusted.

The role table is:

| Address role | Contract fact | Boundary | Required behavior |
|---|---:|---:|---|
| GasFree Account | true | false | trace and score like an address; preserve smart-account context |
| Unknown/unlabeled contract | true | false | trace; contract fact alone has no risk authority |
| GasFree Endpoint/Controller | true | true | count the direct interaction and stop expansion |
| Known CEX/DEX/router/bridge/pool | either | true | count the direct interaction and stop expansion |
| Known GasFree service provider such as `TLntW9...` | false | true | preserve provider identity and count the direct transfer; assign fee role only from a matched settlement |
| Ordinary address | false | false | normal tracing and scoring |

A future discovery that an apparently unknown contract is pooled
infrastructure may upgrade its role and boundary policy. The reverse is not
inferred from `isContract` alone.

### Direct Contract Checks

Direct `/check` for a contract address runs two independent analyses:

- contract-safety analysis;
- ordinary transfer-based Fast, Where, and Deep analysis.

Contract-safety failure becomes a limitation. It does not prevent transfer
analysis. Both analyses contribute evidence to the same canonical resolver;
they do not publish competing final decisions.

## GasFree Settlement Extraction

Add one small transaction-local pure extractor. It consumes transaction details
and one authoritative transfer list and returns no result unless the economic
bundle is coherent.

Conceptual result:

```text
GasFreeSettlement
  controllerAddress
  accountAddress
  userAddress
  receiverAddress
  principalRaw
  maxFeeRaw
  grossDebitRaw
  feeRaw
  feeMovements[]
  evidenceStrength
```

### Exact Structural Match

An exact settlement requires all applicable checks:

1. the transaction succeeded;
2. it calls a registered/versioned official GasFree controller;
3. the selector/signature is the official `permitTransfer` form;
4. calldata identifies the token, user EOA, receiver, value, and max fee;
5. the token is official TRON USDT;
6. one authoritative non-empty transfer list is selected so provider aliases do
   not double-count the same events;
7. principal movements from the GasFree Account to the decoded receiver sum to
   the decoded value;
8. remaining same-source official-USDT movements are candidate fees;
9. total fee does not exceed decoded max fee.

If exact `GasFreeTransfer` event fields are available, `tokenFee` and
`activateFee` can be recorded separately. Without those event fields, only the
total exact fee is recorded. The system must not invent an activation/transfer
split.

### `TLntW9...` Registry Rule

`TLntW9Z59LYY5KEi9cmwk3PKjQga828ird` remains in a local high-confidence
GasFree/TronLink service-provider registry. It is a strong provider-identity
signal and should be displayed as such.

The address alone does not turn an arbitrary unrelated incoming transfer into
a GasFree fee. Fee role still requires a GasFree Account source or membership
in a structurally matched `permitTransfer`/`GasFreeTransfer` settlement.

The provider identity and fee classification are separate. Because the
registered address is shared service infrastructure, tracing may count the
direct interaction and stop there. An unmatched movement to it remains an
ordinary visible direct transfer: it is not relabeled as a fee, removed from
principal scoring, or treated as proof of GasFree usage.

Fee amounts and fee-recipient lists are never hard-coded. A structurally valid
future settlement may identify a different or additional fee recipient.

### Economic Treatment

- Principal movement is an ordinary real money edge and is traced/scored.
- Fee movement remains a real `service_fee` fact.
- Fee movement participates in gross debit, balance, and spend-before-hop
  arithmetic.
- Fee movement is excluded from principal provenance path selection, ordinary
  counterparty diversity, unknown-contract share, drainer/collector campaign
  counts, and risk propagation.
- User EOA is authorization/control context only. No synthetic money edge is
  created between the EOA and GasFree Account.
- Provider labels and the fee edge remain visible, but paying a structurally
  valid expected fee does not propagate the provider's risk into the payer's
  decision. Only a separate explicit policy whose subject is that concrete
  payment, such as an applicable sanctions rule, may make it decisive.
- Exact approval-drain evidence overrides benign GasFree context.

If structural extraction fails, the transfer remains an ordinary visible fact.
Tag text, a familiar amount, or `TLntW9...` alone cannot silently suppress it
from scoring.

## Coverage Materialization

Separate provider acquisition from local materialization:

- provider acquisition asks whether the required history exists in the local
  index;
- local materialization asks whether the current check has actually read
  enough of that index to prove its result.

`index complete` proves local availability. It does not prove that one
`LIMIT 150` or `LIMIT 200` query contained the required transfer.

Where and Incoming use one shared pagination/materialization primitive over the
existing repository offset support. It reads pages until one of these terminal
conditions:

- the existing funding/amount/spend-continuity proof is satisfied;
- the required time window is exhausted;
- a configured local safety ceiling is reached;
- a local read fails.

This is intentionally proof-directed. It does not read an entire dense index
when an early page already proves the concrete amount.

### Coverage State Table

| Acquisition state | Materialization state | Outcome |
|---|---|---|
| queued/running | not started | wait; publish no score |
| complete provider window | paginating | `reading_local_index`; publish no score |
| complete provider window | proof reached/window exhausted | evaluate normally |
| complete provider window | local ceiling reached before proof | `scoreValid=false`, `local_budget_limited` |
| complete provider window | read failure | `scoreValid=false`, `local_index_read_failed` |
| retryable `partial_budget_exhausted` | n/a | increase budget and keep waiting |
| provider cap with remaining retry/split budget | n/a | split/retry and keep waiting |
| unresolved provider cap at safety ceiling | cached context may remain visible | normally `provider_cap_unresolved`, invalid score |
| explicit below-materiality unresolved tail | bounded caveat | valid `REVIEW`, never clean proof |
| legitimate service boundary | complete for this question | valid boundary stop |
| applicable exact hard proof | other provenance partial | valid `DECLINE` plus coverage caveat |

Local limits and read failures must set `providerCapHit=false`. Provider errors,
database errors, missing balance lookup, and known zero balance remain distinct
states. None can add risk.

Fast and Deep may remain bounded context modes. They must not claim exact or
clean provenance from the absence of evidence in a bounded sample.

## Evidence Classification

Every decisive candidate carries explicit:

- evidence class/proof level;
- decision eligibility;
- scope and subject linkage;
- evidence references;
- dependency on coverage;
- score or score band.

All candidates first pass through this one evidence-classification path. The
scoring matrix and final resolver consume the same normalized candidates. An
adapter may not reconstruct hard proof from a numeric score, label text, or a
second mapping table.

Numeric score does not promote evidence. In particular:

- a context-only Fast score of 85 or 90 stays review-only;
- `fast_critical` is created only from explicit allowed hard-evidence codes;
- it is never renamed `scam_or_blacklist` merely because its number is high;
- corroborated contextual patterns may be evaluated by their own explicit
  matrix row, but do not inherit a hard-proof floor.

Hard proof is applicable only when connected to the subject being decided:

- the wallet or deposit itself;
- the concrete transaction;
- a proven provenance path;
- an exact approval-drain episode.

An unrelated bad address elsewhere in case context does not create a floor.

## Canonical Final-Disposition Resolver

Add one pure resolver beside the scoring matrix. Wallet, Incoming, and their
report adapters serialize its result instead of independently remapping
decisions.

Conceptual input:

```text
decision scope and its declared coverage requirements
matrix result produced from normalized evidence candidates
applicable exact hard-proof candidates from that same candidate set
coverage state by mode
observed context score
```

Conceptual output:

```text
decision
finalScore or null
observedContextScore
scoreValid
decisionBasis
coverage
```

The precedence is:

```text
applicable exact hard proof?
  yes -> DECLINE; apply hard floor; scoreValid=true; retain coverage caveat
  no  -> required coverage invalid?
           yes -> NO_FINAL_DECISION; finalScore=null
           no  -> preserve matrix outcome exactly
```

The separate hard-proof input is not a second classification authority. It is
the subset marked `hard`, `decisionEligible`, and subject-applicable by the
canonical evidence classifier before matrix evaluation. No report adapter may
create, promote, rename, or relink a hard-proof candidate.

The lossless mapping is:

| Matrix outcome | User outcome |
|---|---|
| `DECLINE` | `DECLINE` |
| `REVIEW` | `REVIEW` |
| `ACCEPTABLE` | `ACCEPTABLE` |
| `INSUFFICIENT_EVIDENCE` | `NO_FINAL_DECISION` |

The ordinary Where below-materiality outcomes remain explicit score-valid
`REVIEW` candidates. They do not rely on an adapter converting matrix
insufficiency into review.

### Hard Proof With Partial Coverage

When exact hard proof is independently sufficient:

- final decision is `DECLINE`;
- final score is the applicable hard floor;
- final score validity is true for that decision basis;
- the incomplete mode keeps its own `scoreValid=false`;
- unified coverage is `partial` and names the incomplete mode;
- Telegram/Admin show both the hard-proof decision and the coverage caveat.

Here `scoreValid=true` means the final decision has a sufficient independent
basis. It does not claim that every contributing mode or the overall data set
is complete.

Coverage can block `ACCEPTABLE`, contextual `REVIEW`, and
provenance-dependent policy decisions. It cannot erase independently validated
hard proof, and it cannot itself create `DECLINE`.

### Decision Scope And Required Coverage

Coverage validity is evaluated against the question being answered, not as a
global all-modes boolean:

| Decision scope | Required coverage before a non-hard final decision |
|---|---|
| Standalone Fast | Fast's declared bounded window and required inputs; the result can be contextual `REVIEW`, never clean provenance |
| Standalone Deep | Deep's declared direct and second-layer window; it cannot claim complete provenance from that bound |
| Wallet unified | Where coverage for the applicable current-balance provenance question; any mode whose evidence the selected matrix row depends on must also be valid |
| Incoming unified | coverage of the concrete deposit and its required sender provenance; unrelated Wallet/Where gaps are limitations, not blockers |
| Direct contract check | ordinary transfer scope above; unavailable contract-safety analysis is an explicit limitation and cannot support a contract-safety-dependent matrix row |

A bounded but successfully completed Fast or Deep mode is not automatically a
coverage blocker. A failed or unavailable optional mode is disclosed and is
excluded from decision support. A row that requires evidence from that mode is
ineligible; the failure does not block an otherwise independent transfer-based
decision. Exact applicable hard proof still follows the precedence rule above.

Known zero current USDT balance is not missing data. For a wallet-profile
balance-origin question, Where returns `not_applicable`, contributes no clean
proof or numeric score, and is excluded from required coverage. Unified scoring
then uses the other applicable modes and the lossless matrix mapping. For an
Incoming or explicitly requested historical amount, current zero balance does
not make provenance inapplicable; the transaction/amount seed is traced under
normal coverage rules.

## Mode-Specific Requirements

### Fast

- Contract addresses are not excluded from transfer analysis.
- A single behavior/context signal is review-only regardless of raw score.
- Hard evidence requires explicit proof codes.

### Deep

- Non-boundary contract counterparties receive normal direct-counterparty and
  second-layer analysis.
- `category != none` is not sufficient to zero a counterparty contribution;
  suppression requires `isBoundary=true` or another explicit policy.
- GasFree fee movements do not inflate counterparty diversity or campaign
  counts.

### Where Is Money

- GasFree Accounts and unknown contracts are traversed at first, second,
  third, and later hops.
- Provider/data failure cannot produce the current safe-default `DECLINE 65`.
- Material missing provenance without hard proof produces explicit invalid
  score and `NO_FINAL_DECISION`.
- A complete local index is paged until the required proof/window is
  materialized.

### Incoming Deposit

- Uses the same address and local-materialization semantics as Where while
  retaining its transaction-specific question.
- `IncomingDepositDecision` supports `REVIEW`.
- Matrix `REVIEW` is not flattened to `ACCEPTABLE`.
- Matrix `INSUFFICIENT_EVIDENCE` becomes `NO_FINAL_DECISION`.
- Exact deposit/sender hard proof survives unrelated Where coverage gaps.

### Unified

- Composes separate mode evidence through the canonical resolver.
- Does not infer proof class from a mode score.
- Does not treat an invalid mode as clean.
- Does not allow an invalid mode to erase applicable exact hard proof.

## Error Handling And Compatibility

- New reports always write explicit `scoreValid`, decision basis, and coverage
  state.
- Technical stops have `finalScore=null`; any numeric context is stored and
  displayed separately as observed context.
- The canonical resolver and new Wallet, Incoming, and unified report types
  explicitly allow `finalScore: number | null`. Their Admin, Telegram, and API
  serializers preserve null instead of substituting a legacy number.
- Legacy optional fields are normalized only at a compatibility boundary.
- Old jobs are not silently reinterpreted, mutated, or rescored.
- A fresh check is required to apply the new policy to an old address/job.
- Provider, local-budget, and database failures remain technical limitations,
  not risk evidence.
- Contract-safety failure does not cancel transfer analysis.
- GasFree structural mismatch does not hide a transfer; it falls back to an
  ordinary visible movement.

Minimal Admin/Telegram changes may:

- make `Technical stop / no final score` the primary state;
- show observed context only as secondary information;
- show hard-proof `DECLINE` together with `coverage partial`;
- show decision basis and GasFree fee role without a broader redesign.

## Acceptance Tests

All non-trivial behavior is introduced test-first.

### Address And Tracing

- Real-case metadata fixtures classify both supplied GasFree Accounts as
  `isContract=true`, `isBoundary=false`.
- GasFree Endpoint remains `isBoundary=true`.
- Generic unknown contract is non-boundary.
- CEX/DEX/router/bridge/pool controls remain boundaries.
- One provenance chain places traceable contract/GasFree accounts at hops one,
  two, and three and reaches the expected upstream source.
- Every supported scope consumes the same ordinary-account semantics: Fast at
  its direct scope, Deep at direct and second layer, and Where/Incoming at hops
  one, two, and three. No `service_boundary_context`, zeroed contribution, or
  premature boundary stop is emitted for a GasFree Account.
- Direct `/check` runs contract-safety and queues/runs ordinary transfer modes,
  even when contract-safety is unavailable.

### GasFree Settlement

- Recognize coherent `97 + 3`, `15 + 2`, later `value + 1`, zero-fee, changed
  collector, and multiple-fee-output settlements.
- Never rely on those example amounts.
- Reject exact settlement when fee exceeds max fee.
- Reject exact settlement when receiver or value does not match.
- Keep tag-only or spoofed `permitTransfer` as context without suppression.
- Select one authoritative transfer list and avoid duplicate alias counting.
- Classify a movement to `TLntW9...` as a GasFree fee only inside a
  structurally confirmed GasFree context; preserve its registered provider
  identity outside that context.
- An arbitrary unmatched movement involving `TLntW9...` remains a visible
  scored direct transfer and is not labeled `service_fee`; expansion still
  stops at the confirmed pooled provider boundary.
- Keep fee in balance math while excluding it from principal provenance and
  counterparty risk.
- Paying an expected legitimate GasFree fee does not change the payer's risk
  decision; an explicit subject-applicable policy rule remains testable
  separately.
- Preserve exact approval-drain precedence.

### Scoring And Decisions

- Null balance/provider failure yields `scoreValid=false`,
  `NO_FINAL_DECISION`, and no hard evidence.
- Known zero balance remains distinct from lookup failure.
- Matrix `REVIEW 45` remains `REVIEW` for Wallet and Incoming.
- Matrix `INSUFFICIENT_EVIDENCE` becomes `NO_FINAL_DECISION`.
- Context-only Fast 90 creates no `fast_critical`, `scam_or_blacklist`, or hard
  floor; it yields at most `REVIEW` with sufficient applicable coverage, or
  `NO_FINAL_DECISION` when required coverage is invalid, never `DECLINE`.
- Explicit Fast blacklist/approval-drain proof retains the hard floor.
- Exact blacklist/approval-drain plus invalid unrelated Where coverage yields
  final `DECLINE` and preserves the coverage caveat.
- No hard proof plus invalid coverage plus high context yields
  `NO_FINAL_DECISION` with secondary observed context.
- Unrelated hard evidence does not affect the subject decision.

### Local Materialization And Coverage

- A complete Where index with the required funding edge at row 151 reads the
  second local page, makes no live provider request, and reaches the source.
- A complete Incoming index with the required edge at row 201 reads the second
  local page, makes no live provider request, and reaches the source.
- A local safety ceiling before proof yields `scoreValid=false`,
  `providerCapHit=false`, and a local-budget blocker.
- A local read failure yields a local-read blocker, never provider cap or risk.
- Known zero current balance makes wallet-profile balance origin
  `not_applicable` without clean proof; Incoming and requested-amount fixtures
  still trace their transaction/amount seeds.
- Existing targeted coordinator/worker tests remain gates for budget
  escalation, provider-cap splitting/retry, and terminal safety ceilings.

### Compatibility And Presentation

- Old result fixtures remain readable through compatibility normalization.
- Old jobs are not rewritten during reads.
- New Wallet, Incoming, unified, Admin, Telegram, and API fixtures preserve a
  null final score for technical stops while keeping observed context separate.
- Invalid-score Admin/Telegram fixtures show technical stop rather than a final
  critical risk badge.
- Hard-proof decline fixtures show the decision and partial-coverage caveat
  together.

### Verification Gate

- Focused tests demonstrate RED before behavior changes and GREEN after them.
- Full `npm test` passes.
- `npm run typecheck` passes.
- Relevant knowledge docs are updated in the same change.
- No unplanned database migration, dependency, or UI redesign is introduced.

## Alternatives Rejected

### GasFree-Only Exception

A narrow GasFree allowlist is smaller but leaves `isContract` and
`unknown_contract` as accidental tracing policy. Other user smart accounts
would reproduce the bug.

### Trace Every Contract Through Every Service

This follows the literal contract graph but creates false cross-user
provenance through exchanges, routers, bridges, pools, and other shared
infrastructure.

### Independent Local Patches

Changing each condition in place is initially smaller, but decision mapping,
proof classification, and coverage precedence remain duplicated and can drift
again.

### Full Discriminated Result Rewrite

A strict `decided | technical_stop` schema would prevent more impossible
states, but it expands this track into a broad API/Admin/Telegram migration.
The canonical resolver provides the required correctness with less churn. A
full schema redesign may be considered later.

## Documentation Required During Implementation

Implementation that changes behavior must update:

- `docs/knowledge/05-where-is-money-and-incoming.md`;
- `docs/knowledge/06-deepcheck.md`;
- `docs/knowledge/07-risk-scoring-matrix.md`;
- `docs/knowledge/09-current-decisions.md`;
- `docs/knowledge/10-open-problems.md` when resolved findings are removed or
  remaining gaps are clarified;
- `docs/knowledge/08-admin-and-bot-ux.md` only for the minimal semantic display
  changes included here.

The separate UI/UX and operations findings remain in the full audit and must
not be silently dropped from future planning.
