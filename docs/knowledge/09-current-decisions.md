---
status: current
last_verified: 2026-07-31
owner_area: docs
code_refs:
  - src/index.ts
  - src/storage/schemaMigrations.ts
  - src/runtime/startupSchemaGate.ts
  - src/unifiedCheck
  - src/unifiedCheck/providerHistoryCompletion.ts
  - src/forensics/adversePathDisposition.ts
  - src/risk/scoringSignalMatrixV4.ts
  - src/risk/scoreAnchorV3.ts
  - migrations/033_unified_wallet_check.sql
  - migrations/034_unified_check_adaptive_planner.sql
  - migrations/035_unified_check_run_rollout_policy.sql
  - migrations/036_remove_rollout_authority.sql
  - migrations/037_unified_runtime_handoff.sql
  - scripts/runUnifiedWalletCanary.ts
  - scripts/runUnifiedAdaptiveBenchmark.ts
  - scripts/captureUnifiedWslMemory.ps1
  - scripts/captureServiceRoleExactEvidence.ts
  - scripts/materializeServiceRoleEventMap.ts
  - scripts/auditServiceRoleShadowPrerequisites.ts
  - docs/superpowers/specs/2026-07-29-chronological-proportional-balance-provenance-design.md
  - docs/superpowers/specs/2026-07-29-service-boundary-sampling-amendment-design.md
  - docs/superpowers/specs/2026-07-30-subject-service-and-cashflow-query-amendment-design.md
  - docs/superpowers/specs/2026-07-31-stage-c-runtime-blind-and-stage-d-exact-scoring-design.md
---

# Current Decisions

## Unified Product Contract

- One logical `/check` owns one parent run and at most one automatic Telegram
  delivery intent.
- Durable intake sends one immediate non-analytical acknowledgement. It confirms
  that the check continues in the background and that an old input-form cancel
  button does not cancel the accepted run.
- Fast, Where, and Deep keep separate analytical responsibilities but are
  evidence-only children. No preliminary child report is sent.
- `COMPLETED` always has one score and decision.
- `FAILED_TECHNICAL` has no score, decision, report, analytical presentation,
  or analytical delivery. A separate lifecycle notification may explain the
  stop and offer a retry without creating a risk conclusion.
- Coverage is audit metadata. It never adds risk or blocks a completed score.
- `DELIVERY_UNKNOWN` forbids automatic retry. Manual resend is explicit,
  warned, and audited.
- Isolated canaries create no Telegram delivery intent.
- A non-terminal user check receives at most one five-minute progress message.
  An incompatible or expired runtime handoff receives exactly one durable
  technical-stop notification with the existing address retry callback.

## Evidence, Traversal, And Scoring

- Every run binds one confirmed snapshot.
- Direct history exhausts snapshot-bounded pages; traversal terminates through
  exhaustion or evidence-backed boundaries, never a product coverage target.
  TronScan `provider_range_capped` is not account creation: only ordinary
  `range_exhausted` can set that fact, while the capped provider window fails
  closed.
- Dense graphs remain finite through canonical deduplication, equivalent-state
  merging, and closure certificates.
- Address history is content-addressed once per snapshot/address and reused by
  separate funding allocations. Checkpoints are bounded heads over immutable
  chunks/deltas.
- Migration 034 is the durable ordered planner. Planning sequence is append-only
  and independent of capacity. Workers may finish admitted tasks in any order;
  traversal state changes only by atomic bounded commit of the continuous ready
  canonical prefix.
- Task acceptance, accepted-attempt identity, artifact identity, actual result
  bytes, reservation release, and planner `planned → ready` happen in one
  PostgreSQL transaction. Restart recovery reads planner rows and immutable
  manifests rather than rebuilding order from process memory.
- Durable admission is separate from planner merge state. `admitted_at is null`
  is backlog and cannot be claimed. Reservations bound lookahead by entry count
  and bytes. An already leased bounded chunk is never interrupted.
- Ordered tasks do not have a preassigned provider group. Eligibility means at
  least one healthy independent group can execute the task under the normal
  task, cooldown, lease, and timing rules.
- The adaptive provider controller computes supply separately from demand.
  Concurrency is bounded by healthy independent groups, configured provider and
  worker ceilings, DB/memory guards, and eligible ready work. Provider pacing,
  endpoint/account-group limits, cooldown, and 429 handling remain separate.
- Provider assignment proposals are not capacity until the pool accepts them
  against its current slot epoch. Pool targets, actionable capacity, and
  per-run assigned-slot counts use accepted assignments only. A stale epoch may
  request the existing coalesced controller wake fast path; other pool guards
  wait for their real lifecycle transition or rare reconciliation.
- Scheduling is work-conserving max-min fairness, hierarchically owner then run.
  Repair has an elastic borrowable reserve; at capacity one it receives bounded
  weighted turns at chunk boundaries.
- Canonical head is prioritized only when normally eligible and never bypasses
  owner fairness or creates a duplicate claim. One run's full merge buffer does
  not block other runs.
- Provider, CPU analysis, and finalization are separate resource classes.
  Provider capacity adapts in the first implementation; the other classes have
  small configured ceilings and pressure/critical reduction.
- Barrier and rolling use the same planning, task, manifest, and commit code.
  Barrier is the deterministic oracle and one-way runtime fallback. The fallback
  de-admits unleased tails, lets leased chunks finish, and preserves canonical
  commit semantics.
- Direct history and direct hard evidence can run alongside traversal, but only
  the completed parent owns scoring and delivery.
- Every finalization, final hash-chain commit, and completed-presentation
  reconciliation reparses the persisted manifest against the locked run,
  subject, and confirmed snapshot before score/report/delivery mutation.
- Canonical fact identity prevents Fast/Where/Deep double counting.
- Route transaction enrichment uses raw preflight by default and full
  transaction-info only for the eight versioned evidence triggers. Subject
  hard triggers are uncapped; intermediate-boundary full requests are capped
  at five and overflow must continue traversal as explicit missing evidence.
- One process-wide selective resolver is the transaction-evidence authority
  for Stage B Where, Incoming, Deep, and calibration paths. Endpoint pacing is
  owned by the central scheduler; the CLI delay flag may only raise the
  contract-bucket floor. A false legacy job progress CAS aborts the caller and
  forbids stale completion or delivery preparation. Where, Incoming, and Deep
  keep that CAS alive during pending selective provider work with one
  job-scoped coordinator and non-overlapping heartbeat per 30 seconds plus one
  queued latest final-candidate write.
- Legacy forensic `started_at` is a strictly advancing, millisecond-safe claim
  generation. Stale recovery preserves it on requeue, and every authoritative
  runner write is fenced to it either by compare-and-set or by a row lock held
  through the side-effect transaction. Claim loss yields the stable
  `lost_forensic_job_claim` stop and cannot prepare delivery.
- Stage B replaces only the serial Where batch with a bounded slot pump.
  `FORENSIC_WHERE_WORKER_CONCURRENCY` is the sole Where claim-capacity setting
  (1 by default, 2 only for an isolated accepted canary). The legacy
  `FORENSIC_WHERE_JOBS_PER_POLL` value remains parsed solely because Incoming
  still inherits it when `FORENSIC_INCOMING_JOBS_PER_POLL` is absent. Deep and
  Incoming concurrency, guards, and polling intervals are unchanged.
- Stage B queue/slot diagnostics are lane-scoped and identity-free. Runnable
  age excludes `waiting_for_targeted_index`; Where and Deep persist
  claim/terminal queue, slot, enrichment, and scheduler snapshots under
  `performanceTiming`. Scheduler counters remain process-global and are
  attributable only inside an isolated window without other provider
  consumers. Deep stays at one slot, and Incoming retains its separate
  queue-wait timing.
- Hard transaction hashes remain candidates without indexed movement rows and
  bypass only optional parser/exploration limits, never the shared resolver.
  Incoming combines outer and nested Where enrichment evidence and propagates
  any outer incompleteness into report coverage and completion evidence IDs.
- Matrix v4 gives unknown addresses zero by default and creates risk only from
  evidence or confirmed behavior combinations. Hard floors are not diluted by
  safe volume.
- `ScoreAnchorV3` binds facts, policy/config versions, analysis, locked Golden
  identity, and report.

## Authority And Event-Time Correctness Gate

- Exact approval-drain authority requires a checked-subject, hop-zero approval
  plus transferFrom profile. Route-linked profiles and flat proximity markers
  remain context. Durable assertions bind the complete retained
  raw/profile/observation identity, and reconstructed Fast exact evidence also
  requires the matching non-empty raw evidence ID.
- Official decoded USDT blacklist declarations are semantic corroboration:
  canonical and equivalent indexed forms are accepted, while contract, raw
  topic when present, user/result, finality, transaction, block, log-index, and
  timestamp verification remain mandatory.
- Blacklist hard policy is event-time based. `became_active_after` and unknown
  timing are non-hard; a complete mixed fact uses only its exact active subset,
  which must independently pass materiality and carries only active movement
  evidence plus the matching final verified event and current-state identity.
- Local sanctions evaluation is `active | inactive | unknown`. Only an active,
  consistently registry-bound local path with evidence overlap authorizes a
  local hard fact; typed cross-chain sanctions retain separate authority.
- Frozen adverse disposition preserves exact terminals without opening their
  history. This includes exact event-time blacklist/sanctions/restricted
  endpoints, exact HTX/restricted exchange, tracked drainer/collector, another
  exact confirmed harmful endpoint, and a confirmed Verify20 scene with full
  fingerprint plus final successful matching USDT transfer and exact
  selector/event/finality/movement binding. Only an exact-bound nonterminal
  approval/transferFrom/proxy/drainer/Verify-like lead may continue through its
  bound address/events. Method-only evidence, missing binding and unknown
  authority remain unresolved.
  Selected-amount relevance uses only already-known intermediate events. The
  single normative matrix is in the 2026-07-30 subject-service and cashflow
  query amendment.

These decisions apply to newly composed results. Historical persisted reports,
scores, assertions, and delivery artifacts are not recalculated or rewritten.

## Stage B Release State

- Selective enrichment, immutable raw/full evidence, claim fencing, the Where
  slot pump, lifecycle diagnostics, strict replay reader, and isolated canary
  harness are code-complete and covered by deterministic tests.
- The evidence-tooling hardening is merged through recorder commit `6bf24285`
  and combined merge `8bbbbc00`. Its targeted 92-test suite, combined full
  4,951-test suite, and typecheck passed.
- Runtime default remains `FORENSIC_WHERE_WORKER_CONCURRENCY=1`. Value 2 is an
  isolated canary candidate, not an approved production setting.
- The real legacy TXc fixture
  `tests/fixtures/forensics/txc-legacy-where-latency-v1.json` has not been
  captured. The local schema-037 database contains zero completed TXc legacy
  Where jobs/reports. The exact recorder commit also stops first with
  `where_latency_replay_behavior_source_mismatch`: its current behavior tree is
  not the approved historical tree, while a direct historical backport lacks
  the later `dispose` and replay-schema contracts. Baseline constants and
  behavior-source files were not changed to force a pass.
- The dedicated `tron_watch_plan3` PostgreSQL gate passed schema 037
  verification, four migration tests, and 168 claim-generation, fairness,
  immutable-evidence, and delivery tests without skips.
- No accepted artifact exists under `outputs/where-latency-canary/` for the
  concurrency-two run. The separate `where-latency-deep-residual-v1` singleton
  receipt is also absent. Repository and available worktree/ref audits found no
  deployment-owned adapter/bridge, cycle-isolated composition, deployment
  receipt builder, or attributable rollout observer, so no live canary was
  attempted. The measured Deep latency value is not part of the isolated Where
  start-SLA pass/fail and cannot authorize changing Deep concurrency; Deep
  stays at 1 and a high residual opens a separate follow-up.

## Runtime Configuration And Schema

- Adaptive rolling is ordinary validated configuration. No signed rollout
  receipt, release authority, or special generation is required to run it.
- `UNIFIED_ROLLING_ROLLOUT_STAGE` selects `global_barrier`,
  `isolated_rolling`, `bounded_user_check`, or `rolling_default` for new runs.
- `UNIFIED_PROVIDER_CAPACITY_CEILING` is a safety ceiling from 1 through 100;
  effective active capacity can be lower because of supply, demand, cooldown,
  DB, CPU, or memory guards.
- `UNIFIED_ROLLING_USER_CHECK_BASIS_POINTS` controls deterministic admission in
  `bounded_user_check`.
- Migration 035 remains immutable historical evidence. Migration 036 removes
  its rollout-receipt column and receipt-specific constraints while retaining
  stage, bucket, admission policy, capacity ceiling, and immutability.
- Startup verifies exact migration 037 plus exact predecessor receipts and
  structure for migrations 032–036 before provider, bot, or worker startup.
- One registered `ACTIVE` runtime owns Telegram intake. Restart requests an
  exact two-hour drain; the old runtime releases polling before a replacement
  can acquire it and continues only work pinned to its own commit. A different
  commit never claims the old manifest, task, or analytical delivery.
- At the handoff deadline, or when no fresh compatible drainer exists, the
  affected unfinished authoritative run becomes `FAILED_TECHNICAL`
  transactionally. Its request retains `run_id`; no score is fabricated.
- Local Windows deployment uses `npm.cmd run bot:restart`. It never scans or
  kills arbitrary Node processes. The first deployment from a pre-registry
  runtime requires a separately verified manual stop of that exact process.
- Existing runs created before schema 035 remain barrier. New runs persist their
  selected policy in the run creation transaction.
- `UNIFIED_TRAVERSAL_POLICY_VERSION` selects `snapshot-closure-v1` or
  `snapshot-closure-v2` for new runs. Existing runs always resume the traversal
  policy frozen in their analysis manifest. Historical v1 branch, request,
  analysis, and canary identity material remains byte-for-byte compatible;
  only v2 uses the new policy-discriminated identities.
- Newly created manifests bind the current label catalog and boundary predicate
  versions. Only historical v1 manifests may omit those fields; v2 fails closed.
- The production v2 boundary evaluator accepts only an exact frozen label
  record that is valid at the state's event time and whose catalog policy is
  `custodial_boundary`. Hints, legacy risk rows, unknowns, bridges, DEXes,
  generic contracts, and later-valid labels remain non-terminal. Its terminal
  evidence uses the separate immutable schema-2 discriminator; v1 evidence is
  unchanged. Before history planning, the v2 coordinator persists the largest
  entry- and byte-bounded canonical prefix of terminal evidence and its delta
  as idempotent content-addressed artifacts, then commits the checkpoint that
  references the durable delta head. A crash may leave reusable unreferenced
  artifacts, but cannot expose contradictory traversal state. Restart resumes
  without reopening terminal states; only continuing states can emit
  address-history work. The partition is repeated for frontier states generated
  by every accepted history before discovery. The entry and byte limits are
  aggregate per coordinator invocation: after the first generated-boundary
  partition, only the processed continuous ready sub-prefix commits and the
  next ready row resumes later. Commit byte limits count the exact persisted
  evidence artifacts plus the exact persisted delta, not a synthetic estimate.
- New V2 freezes may derive `tronscan-address-tag-observation-v1` records from
  fresh `address_metadata` through `unified-tronscan-cex-tag-map-v1`. The
  source hash binds the raw payload, exact tag, catalog identity, fetch and
  expiry times, and matcher version. `validFrom` equals `fetchedAt` and
  `validTo` is `null`; a current tag is never backdated. Provider-freeze
  diagnostics are count-only (candidates, accepted records, and rejection
  reasons), with no addresses or raw payloads. Restart reuses the immutable
  run-bound dataset rather than rereading provider metadata.
- Completion resolves V2 service identity only from the run-bound frozen
  dataset at the direct-transfer or terminal-anchor timestamp. Direct V2 links
  aggregate event by event; V1 retains its legacy string fallback. Service
  identity is contextual presentation and does not change
  `scoring-signal-matrix-v4`, coverage, or delivery authority.
- A v2 isolated canary freezes one label dataset per confirmed snapshot during
  preparation, persists each content-addressed dataset in the batch
  transaction, and binds all snapshot/dataset hashes in a schema-2 batch
  identity. V1 canary identity bytes remain unchanged. V2 rollout is not
  authorized merely by this plumbing; the existing frozen replay, live canary,
  adjudication, and capacity gates still apply.
- The active check generation fence is retained only for wallet-delivery
  idempotency between legacy and Unified delivery workers. It does not start,
  stop, authorize, or limit planner/controller execution and does not block an
  isolated canary.
- Schema changes are additive. Migration files 032–035 are never rewritten;
  no destructive down migration is generated.

## Golden Pilot V2

- Golden Pilot is offline and imports no production code.
- Exact scores exist only after two blind reviews and adjudication.
- FIFO, LIFO, and proportional attribution were compared; proportional is the
  selected locked policy.
- That locked policy allocates a selected amount across inbound events. It is
  not chronological cashflow accounting and does not prove that production
  debits source lots for later outgoing transfers. The approved chronological
  ledger requires a new policy version and cannot rewrite Golden V2 artifacts.
- TBL7 and TQr are frozen regression cases. Live runs are separate canaries and
  cannot rewrite Golden expected artifacts.
- Locked manifest SHA-256 is
  `4d1f2568d3676cf1ee2e4411bc70e056d1f6fc80997b2919e3da4705811cb407`.

## Approved Forensic Model — Not Yet Production

### Stage C exact-role evidence admission

- The frozen source is run
  `5417cbf6-7cef-4b91-8367-d266eaf3857e`, accepted address-history manifest
  `08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0`,
  and anchor `2026-06-04T09:20:33.000Z`.
- One complete exact capture exists: manifest
  `3549712030d464a8b76a81c78000ba860e9065aa553f15a265ce6dda9c3a00d4`
  and completed receipt
  `f73237add53aa53baef87ddf86f5b8188fad90706879fc93ab22a916816a8d04`.
  It resolves `200/200` sampled events across 200 unique transactions.
- One evidence bundle
  `f84498b1f3098789233486ddd1135a3cfb708d3baff0c375fcc6a926f3270974`
  and one event-role map
  `6f5e219e16b49e3e7434763a5647104125823dd6cc1367972578b1f45056fa40`
  authorize `200/200` events. Every role is `ordinary`; missing and conflicts
  are empty.
- The final prerequisite audit exits `0` with one fully role-bound history and
  200 role-bound sampled events. All capture, disposition, bundle, and map
  artifacts remain referenced by zero accepted attempts.
- This admission completes the real-evidence prerequisite only. Stage C stays
  disabled and offline: no production import, configuration, traversal,
  finalization, score, report, Admin, bot, delivery, or runtime hook changed.

The chronological ledger, exact rounding, opening/residual, artifact, probe,
closure, `95%` known-allocation deep selection, exact-bound nonterminal lead
continuation and `100 + 100` sampling contracts are approved after the
2026-07-29 manual corpus replay. They remain design-only.
Current legacy Where, Unified completion, `snapshot-closure-v1/v2`, matrix-v4,
locked Golden artifacts, and historical reports remain unchanged until
separate implementation and acceptance.

- One versioned chronological proportional ledger will serve current-balance,
  amount-only, exact-episode, and intermediate-hop provenance. Current balance
  is attributed only after later outgoing debits have consumed the available
  source inventory.
- The approved ledger makes canonically ordered incoming principal create source
  lots and debits them proportionally with deterministic integer allocation.
  Exact self-transfer is a cashflow no-op; different addresses receive
  same-owner treatment only under exact event-time-valid ownership evidence.
  GasFree principal remains an ordinary money path while an exact payer fee is
  accounting-only consumption.
- Selection, recursion, branch share, and coverage carry the same
  `usedAmountRaw`. Every funder receives a short adverse probe. Deep recursion
  covers at least 95% of the target plus every exact-bound nonterminal adverse
  lead, regardless of share or top-k. Exact adverse source endpoints are
  terminal red facts and are not opened. The model represents a probe-complete,
  non-red ordinary remainder of at most 5% as an explicit
  `screened_nonmaterial_tail`; it is not identified origin or a clean source.
  Missing order, history, reconciliation, or adverse evidence remains
  unresolved.
- Every unlabeled service-like intermediate EOA uses exactly two physical
  recent pages and two physical historical pages, at most 100 rows per window.
  The windows are at or before the route anchor and separated by at least seven
  days. Duplicates are not backfilled; fewer than 100 canonical events in
  either window forbids an inferred boundary.
- An ambiguous profile may expand only recent sampling to ten pages / at most
  500 physical rows, but only after the `100 recent + 100 historical` baseline
  is frozen. Expansion may repair only recent breadth/geometry; it never moves
  the historical cutoff or replaces temporal baseline evidence. Historical
  remains two pages / at most 100. Sampling costs have cold upper bounds of
  four or twelve history-page requests plus one account request (`5`/`13`),
  excluding adverse checks and any separately required anchor-role witness;
  the current account response does not prove `EOAAtAnchor`.
- The deterministic behavior predicate is `P=C AND B AND G AND (H OR R OR X)`.
  `H` counts distinct UTC hour-of-day values, `R` captures exact amount
  repetition, and `X` captures an extreme dominant queue: at least 80 dominant
  rows, 80% dominant share, 80 unique dominant counterparties, plus median gap
  at most 15 seconds or at least 80 dominant events in one UTC hour. `X` is a
  role feature, not an AML-risk score. It corrected a real false negative on
  `…98cdn` and `…aEGqTr` and fired on no other non-Binance case in the 21-wallet
  calibration worksheet.
- Stage C reconstruction records a three-way `estimatedWouldAction` but no
  authoritative `wouldAction`/boundary unless exact cached, frozen-fixture, or
  live physical pages already exist. It changes no frontier, score, report, or
  delivery. Stage D may suppress ordinary expansion after a complete probe: a
  clean high-service intermediate stops ordinary fan-out; a high-service
  intermediate with exact adverse evidence stops ordinary fan-out, preserves
  exact terminal red endpoints, and continues only exact-bound nonterminal
  leads. Incomplete evidence continues unresolved ordinary scope without
  reopening exact terminal endpoints. The checked subject is never an inferred
  boundary.
- `TPkv2PcELr6uq5vqdYJ3UwKnnhdV2W8SRL` (`…W8SRL`) is a positive
  calibration/replay case, not a blind case and not yet a production boundary.
- The recorded `…W8SRL → …PacGy → …WqQPC` chronology and its separate
  synthetic zero-opening control check only ledger arithmetic: `180/180`
  target coverage and `180/300` source-lot utilization. They are not exact real
  attribution. Real `…PacGy` remains unresolved without complete canonical
  history and an independent pinned balance witness; the observed `82.7 USDT`
  balance and proposed `…gsFCa` origin remain diagnostic only.
- The accepted non-synthetic canonical-tape convention is JSON-safe: raw
  amounts are unsigned decimal strings, parsing starts from `unknown`, and
  bigint conversion happens only after validation. `artifactSha256` is the
  lowercase `fingerprintCanonicalArtifact(body)`, not a wrapper or file-byte
  hash; reviewed source/tape file hashes and commit bindings remain separate.
- The accepted seven-case shadow ledger does not close missing authority. Real
  `…PacGy` remains `unresolved` with
  `history_incomplete_before_anchor` and `authoritative: false`; its synthetic
  zero-opening calibration remains separate. This acceptance authorizes no
  production runtime, configuration, storage, job, selector, scoring,
  traversal, delivery, or activation change.
- No available case activated the `500 + 100` expansion trigger. A dedicated
  frozen ambiguous fixture is required before that branch is replay-proven.
- Manual live reads were not stored as raw fixture bytes. Stage D remains
  blocked on frozen evidence, `EOAAtAnchor`, a complete adverse receipt, a blind
  set, two reviews, adjudication, and a separate rollout decision.

## Subject-Service And Cashflow Selector — Design Only

- Current Unified traversal starts from every direct subject event and loads
  history for every non-terminal frontier address. A future bounded
  subject-service mode must be selected before full subject history, keep the
  subject non-terminal, suppress ordinary neighbor tasks, and report explicit
  bounded/incomplete coverage. `SUBJECT_EVENT_CAP` is not approved; the
  TronScan `10 000` sentinel and `200` pages are provider mechanics, not policy.
- `…W8SRL` is recorded calibration without frozen exact-page/anchor authority.
  `…D7NzP` remains the negative checked-subject control.
- Legacy Where uses its `<1000 USDT` recent-flow approximation; depending on
  observed activity it selects one latest meaningful outgoing or only a
  five-principal-event slice. Incoming starts from one concrete deposit. These
  are separate paths, not a shared production Cashflow Query Selector.
- The missing selector must distinguish `current_balance`, completed exact
  episode, and triggered relevance. A proposed `10 USDT / 0.1%` trigger is not
  policy because its recent window, gross-turnover denominator, materiality,
  episode coverage, and maximum ordinary episodes are unfrozen. Real
  `…dwxxhs` remains recorded/unresolved: observed ingress, approval and `669`
  debit are not canonical exact proof without a frozen tape carrying identity,
  order, opening and amount authority.

The detailed correction is
`docs/superpowers/specs/2026-07-30-subject-service-and-cashflow-query-amendment-design.md`.
It authorizes no production routing, scoring, Stage D or rollout.

## Approved Stage C Completion And Stage D Scoring Roadmap — Design Only

- Stage C remains entirely score-neutral. Its runtime shadow, physical service
  profile, EOA-at-anchor proof, adverse receipt, blind review and cashflow
  shadow do not create AML facts or change production output.
- The current 24 service cases are preserved as 21 manual/CSV research cases
  plus W8SRL, TQr and TXc. Together with the existing 6 adverse cases they
  remain a mandatory 24/24 + 6/6 regression/admission corpus. A future blind
  24 + 6 must be new and non-overlapping.
- Manual fields, probable/service-like/professional-operator/human-like labels
  and research-group notes remain historical calibration, not production
  authority. The executable classifier continues to expose only C/B/G/H/R/X
  and high_inferred_service, non_service_profile, insufficient_data or
  role_conflict.
- non_service_profile is not proof of human control. Exact service identity is
  a separate event-time-valid authority path.
- The intermediate Stage C classifier continues to exclude the checked
  subject. A future checked-subject role is report-only until a separate blind
  adjudication and scoring policy explicitly authorize candidate suppression.
  Manual or inferred subject roles do not reduce score or suppress exact
  adverse evidence.
- Stage D may change real score only through accepted exact adverse facts with
  complete subject/direct-or-exact-bound-path binding. The first atomic D2
  policy excludes cashflow-mediated scored rows because the Stage C cashflow
  shadow has no accepted EvidenceBundleV2 hash-path. Service inference,
  boundary action, coverage and unresolved states have zero direct points.
- snapshot-closure-v3 and scoring-signal-matrix-v5 form one versioned policy
  pair. EvidenceBundleV2, CanonicalFactV2, the locked V1 parity mapping,
  cross-origin occurrence reconciliation, Stage D closure receipt,
  ScoreAnchorV4 and report-v2 are part of the same atomic finalization chain.
  Reconciliation permits exactly one primary scoring candidate per exact risk
  occurrence. Historical v1/v2 and matrix-v4 results are not recalculated.
- Matrix-v5 numeric rows require separate blind scoring review and
  adjudication. Without new Stage D scored facts, v5 must preserve the numeric
  v4 score, decision and semantic selected row.

The complete approved design is
docs/superpowers/specs/2026-07-31-stage-c-runtime-blind-and-stage-d-exact-scoring-design.md.
It authorizes no implementation, canary, rollout or production activation by
itself.

## Telegram And Admin

The final Telegram dossier presents score, decisive evidence, balance
formation, outgoing movement, services/contracts/approvals, relationships and
behavior, coverage, wallet profile, and a compact conclusion. Repeated
transactions are aggregated. RU and EN share one report hash and have separate
presentation manifests.

Admin owns operational visibility: parent/child lifecycle, immutable attempts,
provider waits, capacity and limiting reason, planner backlog/admission/leases,
ready-buffer bytes, canonical-head age, closure/coverage, hashes, score anchor,
delivery state, and watchdog actions. Progress reports exact counters only; an
expanding frontier has no percent or ETA.
The Unified page also exposes runtime generation/heartbeat/drain state,
compatible unfinished run counts, and aggregate lifecycle-notification states
without chat IDs, wallet addresses, or mutation controls.

## Benchmark And Memory Evidence

- Frozen replay is the exact barrier-versus-rolling oracle and exercises
  logical capacities 1, 4, 8, 16, 32, and 100 with reproducible seeds. V1 and
  V2 have separate immutable fixtures and PostgreSQL receipts. Each receipt
  binds its own replay hash, barrier facts, policy fixture, and capacity rows;
  exact equality is required within a policy, not across policies.
- Scheduler replay proves deterministic admission behavior at logical scale.
  The PostgreSQL barrier-versus-rolling oracle executes the production runtime,
  traversal coordinator, policy boundary, finalizer, restart, and fake delivery
  path. It is the exact traversal, terminal/frontier, canonical-fact, closure,
  manifest binding, score, decision, evidence, report, presentation, restart,
  and delivery-idempotency proof. Immutable scheduler receipts remain a
  separate compatibility artifact.
- Live claims are limited to the independent groups actually configured and
  observed. Capacity above that is simulation evidence only.
- Exact hashes are compared on one frozen provider replay. Separate live runs
  may observe different chain/provider state and instead prove internal
  consistency, closure, errors, throughput, and bounded resources.
- Ten minutes is a comparison marker, not a timeout, ceiling, or completion
  rule. The system uses all safe capacity provided there is independent work.
- Isolated canaries default to a 120-minute abandoned-run safety guard. It is
  not a performance target: dense live checks continue beyond the ten-minute
  marker, and an explicitly supplied earlier watchdog deadline remains
  authoritative. Exceptional cold benchmarks may raise the startup-only
  `UNIFIED_CANARY_DEADLINE_MINUTES` guard (1..1440); restart is required.
- Local WSL samples are diagnostics. Record vmmemWSL, Linux available memory,
  swap, process RSS/heap, DB latency, and checkpoint latency before/during/after.
  Sustained growth across equivalent completed runs is the leak signal; a
  single Windows percentage is not.
- Production capacity increases require a live canary under the real Linux
  container/cgroup or host limit. New key groups raise the configured ceiling
  only after their independent grouping and live behavior are verified.
- Provider refill diagnostics are a separate best-effort V1 aggregate. They
  retain at most 512 incomplete slot/epoch correlations and 512 durations per
  phase, drop discontinuities, and export no run/task/provider identities.
  Proposed, accepted, and rejected assignments retain the pool's current-epoch
  result; rejected proposals never count as active capacity.
  They do not mutate the historical adaptive benchmark observation V1 shape;
  the current release path persists separate control/run-bound runtime samples
  and one `unified-provider-refill-observation-v1` artifact.
- A saturated sample enters the selected dense denominator only when provider
  capacity is at least four, eligible ready provider work is at least four,
  runtime resources are normal, and at least four healthy groups exist. Short
  checkpoint/commit pauses remain in the denominator. Overall average is
  reported, but the selected gate requires a non-empty denominator, at least
  3.5 active slots per sample, zero unexplained idle samples, all four audited
  groups dispatched, zero provider errors/429, zero delivery intents/external
  sends, and zero reconciliation recovery during normal saturation.
- The selected TXc benchmark is exactly one isolated canary. The command
  captures process memory before execution, once after the first provider
  claim, and after completion; it hashes the exact sample and summary files
  before persisting passing refill evidence or the index. The schema-V2 selected
  index directly binds refill hash/creator, and a sealed export sidecar binds
  runtime/configuration/run identity plus every memory file's bytes and hash.
  Resume verifies that chain without another capture or canary. Missing WSL is
  a diagnostic `skipped`, but missing/invalid/tampered process phases fail
  closed.
- Selected saturation and limiting evidence is scoped to the controlled run.
  Foreign active permits create a failing contamination sample, retained refill
  diagnostics reset and filter every assignment/rejection and
  chunk/checkpoint/claim event to the selected run set at the control boundary,
  and only timer-originated reconciliation recovery events are counted for the
  active control/run. Process-global work cannot satisfy the selected
  utilization gate.
- The selected harness uses PostgreSQL, not the filesystem, as restart
  authority. Before any output-path access or canary call it transactionally
  inserts one stable canonical authorization marker scoped to the allowlisted
  scenario, policy, candidate, and execution identity. The schema-036
  no-migration representation is a terminal isolated maintenance request with
  no run; it is technical fence state, not a canary result, and is excluded from
  worker claims, user/delivery counts, Admin active runs, reconciliation work,
  and automatic cleanup. Existing/mismatched marker state or persistence
  failure blocks a canary. A completed bundle resumes before authorization.
  Memory evidence uses a fresh exclusive capture directory; Node passes exact
  RSS/heap values as validated arguments, compares the returned stdout sample
  to them, and alone writes/syncs final children through exclusive no-follow
  handles.
- `checkpoint_or_commit` is a stable pool/run/task reason code but is not
  emitted by diagnostic V1. Existing state cannot prove that the transition
  holds the last otherwise-fillable slot; emission remains pending a direct
  causal signal and is never reconstructed after the fact.
- The four-group provider audit is a precondition, not evidence manufactured
  from key names, account names, or traffic. Live utilization, Linux target
  memory, and rollout remain unverified until the isolated TXc canary and
  adjudication gates pass. There is no ETA or completion percentage for an
  expanding traversal frontier.
- Stage B Where concurrency-two evidence is accepted only from the dedicated
  canary harness after a pre-authorized immutable deployment receipt and clean
  single-file ESM adapter bundle are verified before runtime import. The
  receipt binds exactly one bundle, its bytes, immutable artifact/Git identity,
  the exact Node version/flags, and the exact declared safe `node:` builtin set.
  Execution uses `vm.SourceTextModule` over those verified bytes in a restricted
  context with string/WASM code generation disabled. Its custom linker rejects
  relative, absolute, bare, `data:`, undeclared/unsafe builtin, and all dynamic
  imports; its only direct builtins are buffer, timers, and URL. The bundle
  maps the runtime contract onto the virtual `canary:bridge` import and cannot
  open a socket. The trusted host alone calls the pre-existing attested
  loopback runtime bridge bound to the real pump/scheduler/repositories; it
  does not instantiate those components. The deployment receipt binds the
  bridge protocol and canonical Ed25519 server and authorized canary-client
  public-key SPKI fingerprints. The host loads the client PKCS8 private key
  only from the explicit runtime secret file, proves that it derives the
  receipt-bound client public key, and never exposes or persists it. Every
  request is client-signed and every response is server-signed; both are bound
  to a fresh run nonce, monotonic sequence, exact allowlisted method, expiry,
  and canonical request/response hashes. Redirects or any final URL other than
  the exact configured loopback endpoint are rejected. The host verifies the
  bridge signature before returning bounded structured-cloned JSON. A
  bidirectional membrane covers host callbacks, Promise/event values, runtime
  methods and `this`, factory thenable assimilation, returns, and errors.
  Missing VM-module support fails
  closed. The canonical isolation
  file is byte-bound separately from its semantic receipt, all start/terminal/
  drain waits are harness-deadlined with abort signals and referenced timers,
  and authoritative
  scheduler ownership must show zero foreign activity and reconcile canary
  counters with the retained process-global deltas. Deep remains a separate
  singleton residual measurement under the same isolation/deadline policy.

## Customer-Facing Unified Telegram Presentation V2

- The presentation manifest schema remains `presentation-manifest-v1`; no
  database migration is required.
- Every newly created Unified presentation binds
  `unified-telegram-renderer-v2` and
  `unified-wallet-dossier-template-v2`, including a new request attached to a
  reusable completed analysis.
- Stored V1 presentation artifacts and delivery intents remain immutable and
  deliverable. They are not rewritten to V2. Manual resend preserves the
  original manifest and embeds the original HTML unchanged in the existing
  warning wrapper.
- This is a presentation-only change. The Unified report schema, report hash,
  canonical facts, evidence authority, score, decision, and completeness
  inventory remain authoritative and unchanged.
- Customer Telegram text keeps the numeric score primary, explains the decisive
  reason, and always gives separate sending and receiving guidance. It uses
  localized USDT/date/count formatting and hides internal scope, role, code,
  fact-count, and raw coverage names.
- The reachable neutral decisive code `neutral_no_observed_risk` renders as
  “no confirmed risk signals were found in the checked data” in RU and EN.
  Unknown decisive codes still fail closed; every reachable code requires an
  explicit customer-copy regression.
- Exact canonical details remain in the completeness receipt and Admin.
  Compaction may remove repeated display examples but cannot remove decisive
  reasons, guidance, material hard evidence, material coverage limitations, or
  the conclusion.
- The locked Golden V1 HTML remains protected by the locked manifest. Current
  production replay uses V2 semantic assertions and a V2-bound comparator input
  lock rather than comparing new customer copy to archived V1 bytes.

## Separate Decisions

Address-poisoning remains a separate wallet-safety feature and cannot influence
AML score. Recipient precheck before signing is a follow-up, not part of this
change.
