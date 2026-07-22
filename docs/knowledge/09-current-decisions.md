---
status: current
last_verified: 2026-07-18
owner_area: docs
code_refs:
  - src/index.ts
  - src/runtime/startupSchemaGate.ts
  - src/runtime/forensicRuntimeOrchestration.ts
  - src/storage/schemaMigrations.ts
  - src/forensics/forensicCoverageV2.ts
  - src/forensics/recentFlowProvenanceSelection.ts
  - src/forensics/usddPsmRouteObservation.ts
  - src/approvals/allowanceState.ts
  - src/forensics/serviceClassifier.ts
  - src/forensics/gasFreeSettlement.ts
  - src/forensics/directHardEvidence.ts
  - src/forensics/localTronUsdtIndex.ts
  - src/risk/finalDisposition.ts
  - src/risk/unifiedWalletRisk.ts
  - src/risk/unifiedIncomingDepositRisk.ts
  - src/risk/scoringSignalMatrix.ts
  - src/risk/scoreAnchorV2.ts
  - src/risk/usddPsmExposure.ts
  - src/approvals/allowanceRefresh.ts
  - src/approvals/allowanceRefreshWorker.ts
  - src/approvals/approvalSafetyAssessment.ts
  - src/forensics/contractDecision.ts
  - src/tron/usdtBlacklistTimeline.ts
  - src/check/deepForensicCheck.ts
  - src/bot/createBot.ts
  - src/wallet/dashboard.ts
  - src/forensics/telegramDeliveryWorker.ts
  - src/bot/wherePreliminaryNarrative.ts
  - src/monitor/addressPoisoning.ts
  - src/monitor/addressPoisoningWorker.ts
  - src/alerts/addressPoisoningAlert.ts
  - src/telegram/forensicPresentation.ts
  - src/telegram/forensicPresentationAdapters.ts
  - src/telegram/forensicResultRenderer.ts
  - scripts/renderTelegramUxAcceptance.ts
  - src/bot/walletNarrativeSummary.ts
  - src/forensics/tronAddressAllTimeIndex.ts
  - src/forensics/incomingDepositJob.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/fundingFirstSourceProvenance.ts
  - src/forensics/moneyOriginOperationalAssessment.ts
  - src/forensics/strictProvenanceBenchmark.ts
  - src/forensics/targetedHistoryCoordinator.ts
  - src/forensics/addressIndexWorker.ts
  - src/forensics/targetedIndexRepair.ts
  - tests/forensics/targetedHistoryCoordinator.test.ts
  - tests/bot/wherePreliminaryNarrative.test.ts
  - tests/bot/createBot.test.ts
  - tests/telegram/unifiedForensicRenderer.acceptance.test.ts
  - tests/bot/unifiedTelegramModeWiring.acceptance.test.ts
  - tests/alerts/unifiedTelegramAlerts.acceptance.test.ts
  - tests/telegram/manualTelegramAcceptanceManifest.test.ts
  - scripts/verifyRemediationRelease.ts
  - scripts/captureTask0BPreflight.ts
  - scripts/createProductionBackupEvidence.ts
  - scripts/runSchema032ReleaseSequence.ts
supersedes:
  - docs/superpowers/specs/2026-07-03-project-knowledge-workflow-design.md
  - docs/superpowers/specs/2026-07-03-where-incoming-outcome-safety-design.md
---

# Current Decisions

This file is the short current-decision list. If a future change reverses one
of these decisions, update this file in the same work.

## Product

- The check modes remain separate: fast, deep, where, incoming.
- Unified `/check` composes signals; it is not a replacement for the separate
  jobs.
- `Where is money` explains where relevant wallet funds came from.
- `Incoming deposit` explains one concrete deposit.
- `DeepCheck` builds a wider forensic profile.

## 2026-07-13 Plan 1 Remediation Foundation

- `ForensicCoverageV2` is the candidate data contract for Where, Incoming, and
  Deep. Available, selected, and excluded counts must reconcile; amount shares
  require exact raw selected and traced amounts. Missing legacy denominators
  stay unknown rather than becoming zero or complete.
- Low-balance Where inspects the five newest principal USDT transfers. Exact
  `tron_gasfree` `service_fee` edges are resolved and excluded before the slice;
  they remain visible in gross/debit facts. GasFree principal remains ordinary
  traceable principal.
- USDD PSM support in Plan 1 stores exact one- or two-hop route observations
  through the authoritative reserve. It does not apply modifiers, change
  scoring, or generate Telegram copy.
- Approval events are observations, not current allowance authority. A current
  authoritative state requires a supplied direct official-USDT allowance
  result with strict owner/spender/token binding and a 15-minute freshness
  window. Failed or stale reads cannot imply active, zero, or unlimited state.
  Plan 1 supplies validation and persistence only; it does not make the network
  call and does not change risk scoring.
- Schema migration receipts begin at version 032. Versions 001–031 remain
  legacy/untracked. Candidate startup refuses to start providers, workers, or
  Telegram unless receipt 032, its migration-byte SHA-256, schema structure,
  and persisted allowance shapes verify exactly.
- This branch is a release candidate only. Production remains on the previous
  runtime and schema 031 until Plan 5. Plan 1 does not deploy, restart Telegram,
  or switch the production version label.
- Plan 2 scoring/contract semantics, Plan 3 runtime/delivery, and Plan 4 unified
  Telegram UX are implemented in the local release candidate. Plan 5 remains
  the independent cross-plan acceptance/release gate. Address Poisoning remains
  a separate completed track and is unchanged here.

## 2026-07-14 Plan 2 Scoring And Contract Semantics Candidate

- Fresh candidate scoring uses `scoring-signal-matrix-v3` and exactly one valid
  `ScoreAnchorV2` for every numeric publication. Invalid/missing/multiple anchors,
  unresolved evidence, a mismatched subject/mode/policy row, or an invalid
  preferred score fact fail closed to `NO_FINAL_DECISION` with no final score.
  Legacy reports are not upgraded or rescored.
- Collector/transit behavior alone is `35 REVIEW`. It can compose to `55 REVIEW`
  only with a different AML signal from a fully disjoint, non-empty episode set;
  coverage, clean evidence, partial overlap, blank IDs, and repeated collectors
  do not compose.
- Exact USDD PSM context has an explicit base of `20`, share modifiers
  `3/7/12/18/25`, half-up Deep/outbound adjustments, and standalone cap
  `45 REVIEW`. Only exact authoritative one- or two-hop observations qualify;
  PSM context alone never produces `DECLINE`.
- Approval events remain history, not current authority. Direct official-USDT
  allowance is refreshed after a new event, at finalization, and on explicit
  safety recheck. Timeout, malformed response, revert, provider failure, stale
  state, or binding failure yields `UNKNOWN/null`; the later Plan 3 candidate
  adds only bounded stale refresh and no per-approval 60-second full-node poll.
- Exact Verify20 allowance safety is amount-aware: unlimited `90`, finite at
  least 100 USDT `75`, finite below 100 USDT `45`, confirmed zero `0`. Exact
  debit remains `95`. A valid wallet-initiated successful registered-service
  session may explain the approval, but foreign caller/spender, failed or
  unsupported action, time/amount/sequence mismatch, or incomplete evidence
  cannot dampen exact bad proof.
- Approval safety is separate from AML and never enters unified AML scoring.
  Contract decisions also require subject-, spender-, official-token-, and
  evidence-kind binding. An ordinary GasFree Account can be deterministic
  `10 LOW`; a GasFree endpoint/controller or pooled boundary cannot enter that
  branch.
- Automatic Flash/Pro contract analysis is disabled. Every fresh contract
  decision is deterministic with `llm=null`; a contract with confirmed
  subject-bound metadata context but no exact bad/service proof is `35 REVIEW`.
  Legacy LLM/cache JSON remains audit-only and is not read by fresh contract,
  Where, Incoming, Deep, or money-origin scoring. Money-origin results are
  identical whether a legacy LLM payload is absent, invalid, risky, legitimate,
  or unavailable.
- The branch is still unreleased. Production database, runtime, version, and
  Telegram remain unchanged until Plan 5. Plan 4 now integrates this
  deterministic, LLM-free contract output into the shared user presentation.

## 2026-07-16 Plan 3 Runtime And Delivery Candidate

- Where and Incoming parent wake-up is owned by a bounded PostgreSQL reconciler
  over the complete durable wait set. Any waiting sibling blocks resume;
  missing or cancelled waits remain waiting with a diagnostic; terminal without
  waiting resumes through `provider_limited`; all-ready resumes through
  `reading_local_index`. Reconciliation runs only after verified schema 032.
- Forensic completion is result-first and compare-and-set from `running`.
  Where, Deep, and Incoming persist immutable results and mode-bound versioned
  Telegram envelopes atomically. A lost completion CAS cannot send.
- Delivery is a separate bounded lifecycle: batch 10, 25-second abortable send,
  40-second lease, attempts 1–4, retry delays 30/120/600 seconds, stale-token
  rejection, sent fingerprint fence, and bounded stale-recovery intent
  preparation. It is honestly at-least-once across Telegram acceptance and the
  PostgreSQL acknowledgement.
- Incoming success/permanent failure settles delivery and its alert effect in
  one transaction. Retryable settlement changes only delivery. All delivery
  outcomes preserve forensic status, result, score, coverage, and evidence.
- Completed Deep `result_json` is immutable. Later second-layer refresh writes
  only a versioned, subject- and base-result-fingerprint-bound context in
  `progress_json`; it cannot rescore or trigger another delivery.
- Background allowance refresh selects at most five due official-USDT rows for
  active wallets, requires no attempt in the previous 15 minutes, rechecks
  eligibility under a per-target advisory lock, processes sequentially, and
  uses a 15-second provider timeout. Failures remain `UNKNOWN/null` and Plan 2
  causal write ordering stays authoritative.
- Normal wallet overview/analytics/risk/safety navigation is cache-only even
  when stale. First cache miss and explicit refresh show loading and start one
  deduplicated background live refresh per wallet. Slow check handlers send the
  started response and return before unresolved provider/database work.
- Plan 3 does not change scoring, final Telegram result copy/layout, Admin UX,
  schema 032, migrations, or Address Poisoning. It also does not lift
  `hard_safety_limit_exceeded`, page caps, or other bounded provider/local
  limits; heavy addresses may still have an honest no-final result.
- The candidate is not deployed. Production DB/runtime/Telegram and the version
  label remain unchanged until Plan 5. The Plan 4 UX candidate is implemented
  locally but is not released by Plan 3.

## 2026-07-17 Plan 4 Unified Telegram UX Candidate

- Fresh current-policy Where, Deep, Incoming, Contract, and Approval results
  use one typed deterministic presentation contract and renderer. Modes keep
  separate meanings; Approval stays `wallet_safety` with AML impact zero.
- Every result identifies and canonically links the checked wallet. Valid TRON
  addresses use their exact first and last four characters; invalid input is
  escaped plain text without a link. Ordinary messages omit runtime branch and
  SHA, which remain available through `/version`, Admin, and diagnostics.
- A valid score requires the subject-bound active anchor and its single
  preferred fact. That score driver is shown first, followed by at most two
  concrete routes and separate typed coverage. Missing authority, partial or
  technical no-final state, and legacy coverage never manufacture a score,
  action, or denominator.
- Where is preliminary only when a matching DeepCheck job is pending. Coverage
  is not the mode selector. Incoming binds the scored sender and every shown
  route to the exact deposit; an Address Poisoning warning stays a separate
  safety line.
- Automatic LLM text remains disabled. The user message contains no legacy
  model verdict, reason, confidence, citation, recommendation, selector, raw
  provider code, or technical service label in place of a plain explanation.
- Approval messages show the checked wallet, the contract with USDT access,
  fresh official-USDT allowance state, and exact-debit state as separate roles.
  Verify20 active/no-debit is distinct from exact debit. Bridgers has separate
  active, zero, and failed/stale branches. Actions are audience-aware, no
  transaction expiration is shown, and the bot never implies it revokes access
  on chain.
- Normal messages target about 10–15 non-empty lines, at most four restrained
  emoji headings, and no more than two concrete routes before aggregation.
  The automated fixture contract is green: 15 scenario summaries, 19 message
  records, and 11 golden comparisons. Manual Task 9 evidence and screenshots
  remain pending.
- This is still an unreleased candidate. Manual screenshots and review in an
  authorized non-production Telegram test chat are pending. Production DB,
  runtime, version, and Telegram remain unchanged until Plan 5.

## 2026-07-18 Plan 5 Candidate Handoff

- Human handoff status is `release candidate ready/pending approval`; the
  machine manifest remains `not_ready`, not `ready_for_release`. Tasks 0A and
  1-8 are complete, but fresh Task 0B operational preflight, guarded Task 9,
  and the exact 15 scenarios / 19 messages / 11 golden comparisons for manual
  Telegram acceptance are pending.
- Manifest-mode `release:verify` is byte-identical/read-only for the protected
  root. It verifies the canonical V2 store and phase but writes, repairs, or
  aggregates nothing. Before accepting a phase it also runs the concrete
  semantic validators for the acceptance trace, exact suite reports and
  sidecars, Task 8B RED cleanup proof, non-Vitest regression, schema, sanitized
  runtime, terminal legacy, rollback, and manual Telegram evidence. Trace
  GREEN hashes and exact file/fullName executions must resolve in their owner
  plan reports, including the AC-33 auxiliary proof. Suite and non-Vitest
  producers require the candidate worktree to be exact clean `HEAD` both before
  execution and immediately before evidence publication.
- Task 0A observed previous runtime
  `0172978845ec74373bd245098ee8c075e0c39acf`, label `master-01729788`, Admin
  HTTP 200 and Telegram long polling against loopback `tron_watch:55999` at
  legacy schema 031 with no receipt 032. Task 0B may represent a process that
  lacks repository-manager start evidence only as discriminated
  `legacy_unmanaged_previous_runtime`. Every capture/revalidation must
  independently reproduce the exact PID/start time, executable, command line,
  entrypoint/worktree/SHA/label, loopback Admin runtime proof, production
  DB/schema identity, and read-only Telegram `getMe`/`getWebhookInfo` identity.
  It is never manager-owned evidence. Any drift, disappearance, ambiguity, or
  unexpected webhook fails closed. The current amendment authorizes evidence
  reads only: all protected production operation/resume, normal or cleanup-only
  lease takeover, candidate/previous start, stop, adoption, and rollback paths
  reject this kind before any write until complete pre-release gates, merge,
  explicit production GO, and a separate action-specific amendment/authority.
  A manager-marked process whose launcher predates a security update remains
  `manager_owned_previous_runtime`, but Task 0B must not pretend that the old
  launcher bytes equal the current action-manager bytes. Its historical
  launcher is bound separately to the exact protected origin Task 0B, derived
  freeze, complete prepared/receipt materialization bundle with separately
  pinned hashes and a timestamp inside the archived Task 0B window, owner
  candidate, repository blob, start evidence, PID and live process;
  the current guarded manager is independently hashed from the clean candidate.
  Task 0B lineage and action-time worktree Git proof both disable replace
  objects and inherited Git overrides. Start actions also bind exact entrypoint
  bytes to the authorized commit blob, reject `assume-unchanged`, `skip-worktree`
  and `fsmonitor-valid` through separate `ls-files -v/-f` checks before disabling
  fsmonitor/untracked-cache refreshes, bind stable file identity, and re-attest immediately before spawn and
  again before publishing start evidence. Capture and
  every revalidation reproduce both lineages. A later stop uses the frozen
  launcher only for old-process proof while action authority remains current-
  manager-bound. Missing origin bytes, non-ancestry, a changed process, or any
  hash mismatch fails closed.
- Production remains unchanged until Task 9, complete `G00`-`G11`, merge to
  `master`, producer/verifier rerun for the merge SHA, and explicit release GO.
  `schema:verify` remains read-only; only `schema:release:sequence` owns
  controlled migration. After protected `G12` backup, the manifest returns to
  `not_ready` with `G00`-`G12` passed and `G13`-`G15` pending before the fresh
  one-shot migration authority can be consumed.
- The guarded `release:production:backup` producer is implemented and locally
  tested, but no production backup was run. It accepts only the protected root,
  selects the unique compatible unconsumed G12 issuer-chain tip, binds exact
  Task 0B/current manifest/candidate/root/production DB, uses pinned Docker
  `pg_dump`/`pg_restore`, and writes claim, lease, progress, dump, restore-list,
  and evidence without mutating the manifest. Only
  `release:manifest:advance g12_backup_passed <exact-current-source-sha> <root>`
  marks G12.
- `G12` verification treats the dump (up to 1 TiB) and restore list (up to
  100 MiB) as bounded streaming hash/size evidence; JSON evidence remains
  size-bounded and fully parsed. Verifiers must not load the production dump
  into memory or apply the JSON artifact limit to either binary artifact.
- `G13` production migration executes on the same PostgreSQL session that owns
  advisory lock `320032500`. Its v2 authority consumption is a stable,
  resume-bounded operation claim; every execution session writes an append-only
  attempt record with exact backend-session and lock-acquisition identity.
  Terminal success/failure is prepared durably while the lock is owned, then
  the gate-eligible execution receipt is published only after successful unlock
  and is bound to both the attempt and prepared-settlement hashes.
- G12 and G13 production entrypoints accept the protected root, not an operator-
  selected authority path. Their sole issuer appends the action-specific V2
  authority; each producer resolves the exact committed unique tip and uses its
  own claim/lease or bound-session protocol. Both revalidate strict authority
  expiry before every external leaf and settlement. Only G14/G15/recovery/
  actual rollback also carry the immutable production-operation deadline.
- An expired never-claimed authority is terminalized by allowlisted transition
  plus protected root; no operator-selected attestation file is accepted. G13
  terminalization additionally binds the frozen production DB identity and
  holds the schema-032 advisory lock through terminal publication. G12 issues
  for at most 70 minutes and requires 65 minutes at claim; G13 issues for at
  most 30 minutes and requires 25 minutes at claim.
- `release:manifest:advance` is the sole manifest/gate writer. The first
  `pre_manual` transition uses source token `absent`; every later transition
  uses the lowercase hash of the exact current manifest bytes. One fixed
  discriminated bootstrap/frozen root-writer lease serializes freeze,
  transition, prepared issuer, and expired-unclaimed terminalization. A dead
  bootstrap before freeze prepare seals the root; exact prepared freeze and
  issuer crashes replay byte-for-byte, and successful freeze removes the fixed
  lease.
- G14/G15/recovery/actual rollback authority consumption is fixed as unique-tip
  selection → original production lease → immutable original-lease preclaim →
  exact committed takeover-lineage/current-tip resolution → atomic claim and
  consumption. Branch/gap/swapped/foreign lineage and orphan preclaims fail
  closed. Every external effect has a durable intent first. Terminal order is
  settlement → prepared removal → exact lease removal → byte-exact prepared
  receipt → cleanup. Direct production stop/start/query/reconciliation/capture
  leaf commands are forbidden; only the four `release:production:*:execute`
  orchestrators may own them.
- Recovery-only accepts exact abandonment+cleanup, completed receipt prefix,
  and at most one actual-intent-backed uncertain marker. It writes only typed
  local receipts plus the overall receipt before `production_failed` evidence,
  emits no normal gate evidence, and never observes, reconciles, or replays the
  uncertain effect. G14 pre-effect failure has no invented runtime evidence and
  records `attemptedExternalEffect=false` with `previous_runtime_retained`.
- Sanitized runtime and rollback rehearsal use only
  `tron_watch_plan5_runtime_sanitized` with recording-only Telegram transport.
  The real manual sender is restricted to guarded Task 9, a dedicated test bot,
  and a non-production test chat. The runtime/version command is `/version`.
- Protected production-operation crash recovery keeps `cleanup_only` strictly
  abandonment-and-cleanup-only. A durably fsynced settlement is replayed only
  through its exact original effect/recovery-capable lease binding, including a
  proven-dead owner, after the complete terminal receipt/intent/lease lineage,
  orchestration, captures, kind-specific evidence, index, and settlement bundle
  is revalidated. Abandoned-history reuse additionally reopens the operational
  attestation/issuer and exact lease-removal prepare/receipt/cleanup chain.
  Reconciled runtime starts remain valid only through their exact operation,
  claim, intent, authority, target identity, and observation window; an exact
  receipt-bound reconciliation may supply candidate stop identity when the
  runtime manager crashed before writing its own start artifact, but a
  contradictory manager artifact cannot fall through to reconciliation.
  A failed settled rollout supplies recovery start history only after its
  contiguous receipt prefix, failure draft/capture/evidence, terminal index,
  full authority issuance, settlement, and lease-removal cleanup are reopened.
  Canary invariants are checked in every observation cycle and persisted cycle
  state is restored before resumed bounded checks. Actual rollback binds the
  current `production_failed` manifest and committed transition receipt back to
  the failure source manifest; repeated abandoned rollback attempts are combined
  only within the same failure evidence, freeze identity, candidate, generation,
  and source-manifest lineage. An owned heartbeat may advance that lineage during
  topology observation, but owner identity and immutable operation bounds cannot
  change. A `previous_runtime_retained` result requires the live singleton's
  complete PID/start-time, command, executable, worktree and entrypoint identity
  to remain equal to frozen Task 0B at selection and terminal re-observation;
  the terminal topology is persisted with operation/claim/lease/time bindings
  and reopened during settlement replay. Every production runtime decision
  recomputes the release freeze from the complete canonical Task 0B artifact,
  not only its previous-runtime identity, before authority issuance,
  observation, effect execution or recovery. Settlement replay also requires
  the exact attestation/issuer pair to remain a member of the committed
  append-only authority issuance chain before publication or lease removal.
  An abandoned rollout with a durable orphan `stop_previous` intent may select
  `previous_runtime_retained` only when a later exact frozen-singleton topology
  proves the stop did not occur and no exact manager/reconciliation stop proof
  exists; a completed stop instead follows the restart-required rollback path.
  These checks are replay invariants: pre-begin settlement replay reopens the
  complete Task 0B freeze binding, and both persisted rollback topology and
  terminal settlement replay recheck the orphan intent plus absence of an exact
  manager or durable reconciliation stop proof.
  Recovery settlement replay additionally reopens the canonical recovery input,
  prior abandoned/cleanup pair, completed receipt prefix, uncertain intent, and
  recovery orchestration receipts before terminal publication or lease removal.
  The input is fsynced before recovery validation and binds the immutable lease
  consumed by the claim, so heartbeat/takeover lineage cannot rewrite it.
  After an abandoned rollback restarted the previous runtime, later
  rollback checks use the latest matching operation/claim/intent-bound start
  receipt and manager/reconciliation proof rather than the frozen pre-restart
  process identity. Historical rollback effect proof is accepted only after the
  abandoned claim, normal lease lineage, topology, intent, exact runtime
  authority, target, receipt output, and observation bounds are revalidated.
  Settlement replay also reopens the exact prior and current manager-or-
  reconciliation action proofs and the frozen Task 0B previous-runtime
  identity before it may publish or remove a terminal rollback bundle.
- Configured `hard_safety_limit_exceeded`, provider/page/local ceilings and
  bounded retries remain honest technical no-final outcomes; Plan 5 does not
  promise unlimited history. Address Poisoning is forbidden release scope.
  Separate `APC-01` closeout starts only after `released` or `rolled_back`.

## 2026-07-21 Plan 5 Task 9 evidence correction

- Task 0B canonical preflight bytes and `ReleaseFreezeIdentityV2` are immutable
  for a protected release root. Their original 15-minute observation window is
  not extended or ignored. Current liveness is supplied by append-only,
  content-addressed `task0b-release-revalidation-v1` receipts, each fresh for
  exactly 15 minutes and bound to the same preflight, generation and freeze.
- A revalidation repeats the candidate, previous runtime, sanitized binding,
  runtime manager, production database, rollback worktree, PostgreSQL tools,
  protected-root and candidate-port observations. Every value must equal the
  frozen tuple except the new exclusive-write probe. It records zero runtime
  stops/starts, migrations and Telegram sends. Missing, stale, ambiguous,
  malformed or changed evidence fails closed.
- The missing Task 0A/trace producer is reconstructed only from immutable Git
  history and actual Vitest JSON. Approved test-only commits are archived into
  ephemeral worktrees; the two canonical title patches are replayed exactly;
  behavioral RED and candidate GREEN executions are both required. Narrow
  exception: AC-07/08/09/12/13/27/39 may use typed
  `local_product_module_absent` RED when an exact zero-execution Vitest file
  failure names a relative `src/*` import from the declared test file, the
  exact test patch is bound to the frozen test commit, and Git proves that
  module absent there but present at both owner commit and candidate. Generic
  import/no-test, dependency, fixture, environment and inferred failures remain
  invalid evidence.
- Consolidated Plan 2 corrective exception: exactly the 17 primary traces
  AC-03/04/05/06/19/22/23/25/26/28/29/30/31/32/33/36/37 may use
  assertion-bound `local_product_module_absent` at frozen commit `01a29fef…`.
  Each record binds exact test `fullName`, exactly one local `src/*` absence
  line, exact test patch, owner `83f0cb96…`, and final candidate; Git proves the
  module absent at test and present at owner plus candidate. For AC-29/30 other
  assertion messages remain behavioral only when their exact frozen four-line
  multiset is present: three no-call `AssertionError` messages and one decision
  object `AssertionError`. They are not classified as infrastructure.
  Assertion-mode suite messages are forbidden and aggregate failed-test plus
  failed-suite counts are reconciled exactly; any other companion invalidates
  the complete report. Every approved behavioral failure is bound by SHA-256
  of its complete normalized Vitest message bytes, not only its first line;
  normalization removes only absolute runtime and snapshot path roots.
  Generic/synthetic, foreign-importer, dependency, fixture,
  environment, no-test and multiple-absence evidence remains invalid.
- Final narrow AC-33 evidence amendment: the separate secondary
  `[AC-33][LLM-DAMPENING]` regression is mandatory exact
  `candidate_green_only` auxiliary evidence and is not a second AC or a RED
  trace. Primary AC-33 keeps its approved assertion-bound RED, and the
  auxiliary proof cannot replace it or increase RED coverage. The one allowed
  auxiliary record binds fullName
  `[AC-33][LLM-DAMPENING] prevents legacy LLM context from lowering provider risk Verify20 or exact debit proof`,
  test commit `db5d49a944c0de489f13567d87400cb32c4eedb0`, exact test patch SHA-256
  `ae069e6d00158fe1a5e05bfe463ee4814257c3f3c3e3f0648f110679df4c9132`,
  owner `83f0cb967f61b814896e5d1a4cf01cecb1c56b59`, final candidate SHA, and
  SHA-256 of the complete candidate GREEN Vitest report. No separate RED is
  permitted: at the frozen Plan 2 boundary the test can fail only because the
  same `src/forensics/contractDecision` module is absent, while the exact test
  is already GREEN from the first commit where that product module exists.
  The complete trace set contains exactly 41 primary RED/GREEN records; this
  auxiliary is the only secondary record, and its report hash must equal the
  primary AC-33 full Plan 2 GREEN report hash. Any extra non-primary trace or
  independently hashed auxiliary report fails closed.
- Strict V2 release verification does not trust the materialized trace object
  by itself. It re-reads `acceptance-trace-capture.json`, every exact RED/GREEN
  Vitest report and every frozen test patch, repeats Git ancestry, patch and
  extension-aware `src/*` module-lineage checks, rebuilds the 41-primary plus
  one-auxiliary trace, and requires byte-identical output. Ambiguous module
  resolution fails closed.
- Plan 3 RED trace execution is mandatory PostgreSQL execution, not an optional
  suite: the producer sets `REQUIRE_PLAN3_POSTGRES=1` and binds
  `PLAN3_TEST_DATABASE_URL`/`TEST_DATABASE_URL` to exact disposable
  `tron_watch_plan3`. The frozen test's legacy `55432` endpoint exists only
  inside a pinned Node container on the disposable PostgreSQL network; no
  production endpoint is proxied. Before execution the producer verifies the
  loopback publish binding, running pinned PostgreSQL container/image and live
  database/system identity: container
  `fbb25bec0cfa79a35efddb287f3ae9ba1921fb645558b0b48dfce8b45d60d39e`,
  name `/plan5-release-pg-f97549bc`, and PostgreSQL system identifier
  `7664744009044738089`. It creates the frozen test's least-privileged
  `tron` login only on that verified disposable database, removes it through a
  fresh verified admin connection, and fails closed on setup or cleanup drift.
  Cleanup disables login, terminates test-role sessions, revokes the grant,
  drops only objects owned by that fresh disposable role, drops the role, and
  verifies absence. The pinned Node runner uses a cryptographically unique
  tracked container name plus a private Docker CID file and invocation label.
  Cleanup may remove only the exact CID after name, immutable image and label
  inspection; a name collision or failed create never authorizes name-based
  deletion. Every success, failure, or timeout verifies that exact container
  absent before role cleanup completes.
- Trace preparation validates the exact disposable Plan 3 and Plan 4 database
  bindings before creating trace directories or RED reports. Missing or unsafe
  bindings are operator/preflight failures and leave the protected root
  untouched; they never become RED evidence.
  Frozen RED runs select only exact `[AC-NN]` tests, so
  unrelated REQ guards cannot become trace evidence. Skipped AC-14/15 and any
  authentication, connection or transport failure evidence fail closed.
  Failed Plan 3 executions accept only assertion failures or the exact frozen
  Plan 3 feature-missing messages; AC-14/15 additionally require the exact
  `reconcileWaitingForensicCheckJobs` failure and frozen stack location. This
  affects only release evidence; product/runtime/scoring semantics and
  production state do not change.
- Task 8B RED evidence is accepted only for the exact four frozen release test
  files. Every file must execute, every failure must be an exact
  `Plan 5 feature missing` behavioral failure, suite-level/no-test/skip/todo,
  generic import/environment/dependency and foreign companion failures are
  rejected, and the exact PostgreSQL assertion remains mandatory.
- Release suite and full-regression execution uses an ephemeral detached local
  Git clone at the exact candidate SHA followed by lockfile-enforced `npm ci`; candidate
  tests, typecheck and Vitest never execute from mutable ignored `node_modules`
  or skip-worktree content in the release worktree. All six suite report and
  sidecar pairs have one manifest owner: Plan 4 is bound to `G01_TRACE`, Plan 5
  to `G06_FULL`, and Plan 1/2/3/Address Poisoning to G02/G03/G04/G11.
- AC-20/21/24 do not use that exception. Their original Plan 4 test patch is
  bound to frozen test commit `20ee8a75…`, while behavioral RED executes at
  historical commit `a0f74b3b…`, after the local modules existed and before
  those three behaviors passed. Trace lineage records test commit, RED
  execution commit, owner commit and candidate separately.
- Exact Plan 4 test-patch SHA-256 pins are: alerts
  `544fc122c2012bb27452659a795dadbbadcedc4930d54194442558d85737e2b2`,
  renderer
  `c9a755269b1e3935bf8c6d71797e17493a57d4e55e6aa26b63c63c36494118e5`,
  and PostgreSQL coverage
  `27aa2e5102bee4d1cbba5009f70c2cd2719ceab35c46e4764ab89a0c422ee771`.
  A merely ancestrally valid substitute base, test commit, RED execution
  commit, file, kind, missing path, patch hash or exact Plan 4 owner commit
  `547d86cd6c478ca56e5b85d2ccb31cdbce2ddc17` fails closed.
- Sanitized candidate/previous start evidence is not an operator fixture. The
  controlled rehearsal derives the exact allowlisted command identity, runs
  the real start/observe/stop sequence, and writes that evidence only after the
  sequence succeeds.
- Acceptance trace lineage uses the reviewed explicit AC-to-REQ and AC-to-owner
  table in Plan 5. Index cycling and contiguous-range inference are invalid;
  validators reject wrong membership, order or owner plan for every trace.
- G12 backup entry and G13 migration entry each require a fresh 15-minute Task
  0B revalidation receipt whose frozen bytes and current release-freeze identity
  exactly match the immutable root. Once entry succeeds, G12 authority/lease
  and G13 authority/bound-session/advisory-lock checks govern the bounded action;
  the original Task 0B TTL is not reused as a long-operation deadline.
- Task 9 full regression evidence invokes the repository-local Vitest CLI
  directly with exact serialization and five-minute test/hook bounds. npm
  indirection is not accepted because it may rewrite or discard Vitest argv.
  The 90-minute outer timeout terminates and awaits the complete worker process
  tree before a retry or cleanup audit. This preserves a finite bound while
  covering the serialized Windows release matrix observed to exceed 60 minutes.

## 2026-07-12 Realtime USDT Address-Poisoning Protection

- The first release warns watched-wallet owners after a fresh small incoming
  official TRON USDT transfer resembles an earlier outgoing recipient. USDD and
  USDD PSM may be attached later as post-loss route evidence; they never trigger
  the initial candidate. Runtime is USDT-only, while the pure detector keeps
  token contract and decimals in its interface.
- The main monitor performs only exact raw-unit eligibility checks and writes
  `pending`, `skipped`, or `skipped_backfill` atomically with the observed
  transaction. The default maximum lure amount is 100 USDT. It never fetches
  relationship history inline.
- The dedicated worker runs every 30 seconds, claims at most 20 checks with
  concurrency two, fetches one pinned TronScan-only logical page of at most 100
  rows per claim, and stops after five pages. A logical page uses at most two
  internal calls of 50 rows; ordinary client methods retain provider fallback.
  The lookup window is strictly the 24 hours before the lure and accepts only
  confirmed, successful, non-reverted official-USDT transfers. Provider
  `riskTransaction` remains saved context and does not invalidate an otherwise
  canonical relationship. Match ranking is deterministic and one incoming
  transaction creates at most one candidate and one logical alert.
- Complete negative coverage requires authoritative provider/range metadata.
  Provider identity, offsets, `total`, `rangeTotal`, completion flags, raw and
  canonical hashes, and overlaps are stored. A non-null authoritative
  `rangeTotal` is required; `total` may be null. When both exist they must be
  consistent and `rangeTotal <= total`. Mixed provider evidence, missing or
  contradictory `rangeTotal`, contradictory paired totals,
  oversized/short-nonterminal or non-progressing pages, and internal or
  cross-claim overlap remain partial and cannot become clean.
- Every provider row keeps a raw pagination identity. A missing transaction
  hash falls back to a content fingerprint for audit, but any such `:raw:` row
  makes negative coverage partial, even when the one-row range is exhausted or
  changed content produces a second fingerprint. Persisted/legacy state without
  trustworthy raw-row identities also fails closed when prior provider rows are
  present.
- Lookup evidence is bounded before copying or building sets/maps: five pages,
  500 entries in each top-level transfer/fact/id/provider collection, 100
  entries in each per-page raw-id or overlap-id list, and two hashes of each
  kind per page. Live growth is checked before merge. Oversized or malformed
  evidence becomes a bounded failure and never `clear`.
- Partial negative coverage is `inconclusive`, never `clear`. Partial evidence
  can decide a positive candidate or an exact disqualifier: a prior direct
  relation, an authorized `service_admin` trusted/false-positive label, or an
  exact authoritative service-registry address. Provider names, contract names,
  tags, phrases, token labels, and AI output never suppress a warning.
- Retryable `inconclusive` has a scheduled retry and no completion timestamp.
  Exhausting the authoritative provider range or reaching five pages produces
  terminal `inconclusive` with no scheduled retry and a completion timestamp;
  it is excluded from claims and queue metrics. This distinction uses existing
  fields and is enforced by PostgreSQL rather than a second terminal flag.
- Live and persisted pages use the same fail-closed evidence validator. The
  saved window must equal the exact 24 hours before the incoming transfer, and
  TronScan provider identity, offsets, range totals, completion, exact raw-row
  IDs, and SHA-256 hashes must agree before accepted facts reach the detector.
  An invalid live page is discarded and retried through the bounded failure
  policy at the same offset; it cannot advance progress or prove range
  exhaustion. A strictly valid exhausted page may still end as terminal
  `inconclusive` when trusted historical audit state keeps coverage partial.
- Provider failures get the initial execution plus three retries after 30, 60,
  and 120 seconds. The fourth failure is terminal. The repository is the only
  authority for attempt count and retry timing.
- Freshness is enforced inside the atomic claim and again with the running
  lease after scheduler/provider wait before every terminal write. An expired
  candidate, clear, inconclusive, or failure path becomes `skipped_backfill`.
- Poisoning evidence is `wallet_safety`, not AML. Its score impact is exactly
  zero, database and runtime guards enforce that invariant, and AML/unified
  scoring allowlists exclude the group. A safety classification cannot change
  Fast, Deep, Where, Incoming, or unified score and disposition.
- The dedicated RU/EN warning is immediate in `realtime`, `risk_only`, and
  `digest`; `paused` is skipped. It shows full addresses and both TronScan
  transaction links. Locale is fixed on the first delivery claim. Owner-only
  callbacks confirm or dismiss one candidate with idempotent compare-and-set
  transitions; terminal messages retain the links.
- Normal Incoming formatting queries the active candidate immediately before
  building the message. `candidate` and `confirmed` keep the warning line;
  `dismissed` removes it. Lookup failure cannot fail Incoming delivery, and the
  warning changes no AML decision or alert-routing result.
- Check and delivery phases have independent non-overlap guards. Delivery is
  at-least-once. Telegram send has a real abortable 30-second timeout without
  `Promise.race`, below the 40-second heartbeat and 120-second stale reclaim.
  The lease timestamp controls heartbeat/liveness/reclaim; the monotonic
  `alertAttempt` generation controls `sent`/`failed`/`skipped` terminal writes.
  A started heartbeat stays active through final acknowledgement, and reclaim
  versus finalization serializes by generation. At most four just-in-time send
  claims and the persisted fingerprint reduce duplicates, but Telegram
  acceptance cannot be atomic with the final database write.
- The healthy-capacity regression uses the real shared scheduler and the
  worst-phase two-tick path: alert at 60 seconds, within the product target of
  120 seconds. Queue, lookup, cycle, timeout, and alert latency are logged
  without sensitive addresses, chat/user ids, API keys, or tokens.
- Recipient checking before a transfer is the next phase. It is not implemented
  here and will reuse the persisted candidate and raw evidence.

## 2026-07-10 Forensic And Scoring Correctness

### Address Boundaries

- `isContract` is an on-chain fact, not service identity, risk, or a tracing
  boundary.
- GasFree Accounts and unknown or unlabeled contracts are non-boundaries and
  remain traceable and scoreable at every hop.
- Positively identified shared or pooled infrastructure remains a boundary.
  This includes the GasFree Endpoint/controller and the registered
  TronLink/GasFree provider `TLntW9Z59LYY5KEi9cmwk3PKjQga828ird`, as well as
  known CEX, DEX, router, bridge, and pool infrastructure.
- Direct contract `/check` runs contract safety and ordinary transfer analysis
  independently; unavailable contract safety does not suppress Fast, Where, or
  Deep work.

### GasFree Settlement Roles

- GasFree principal and service-fee roles require a successful structurally
  matched registered-controller settlement. Provider identity, destination, or
  a familiar fee amount alone is insufficient.
- Fees and collectors are dynamic. Exact fees remain visible in gross debit and
  accounting facts but are excluded from payer provenance, peer diversity,
  campaign counts, and ordinary risk propagation.
- An unmatched movement to TLnt remains a visible direct transfer and is not
  relabeled as a fee; expansion still stops at the confirmed pooled boundary.

### Local Materialization

- A complete provider index means the required rows are locally available; it
  does not make one limited repository query complete evidence.
- Where and Incoming page the concrete local window until existing provenance
  proof is satisfied, the window is exhausted, or a local ceiling/read failure
  occurs.
- A local limit or database read failure is a technical local limitation. It is
  not a provider cap and does not create risk.

### Canonical Final Disposition

- Numeric score does not create hard proof. Exact authority requires explicit
  evidence class, proof level, applicable subject, and decision eligibility.
- Exact subject-applicable hard proof yields a valid `DECLINE` even when
  unrelated coverage is partial; the coverage limitation remains visible.
- Invalid required coverage without such proof yields
  `NO_FINAL_DECISION`, `finalScore=null`, and a separate observed context score.
- Matrix `REVIEW` remains `REVIEW`; `INSUFFICIENT_EVIDENCE` maps to
  `NO_FINAL_DECISION`. Admin, Telegram, and alerts do not remap these outcomes.
- Old unversioned jobs are not silently reinterpreted, mutated, or rescored. A
  fresh check is required to apply the new policy.

## 2026-07-11 First-Hop Blacklist Scoring And Wallet Narrative

### Direct Principal Policy

- The official USDT contract is authoritative for current blacklist state.
  TronScan's address-scoped blacklist endpoint supplies candidate history, but
  chronology is accepted only after the transaction and official contract log
  are verified. Provider or validation failures produce a typed partial
  timeline, never a false empty or exact history.
- DeepCheck persists directed first-hop blacklist facts, internal-label facts,
  and report-level coverage even when no adverse fact is found. Required
  incomplete negative coverage yields `NO_FINAL_DECISION`; an independently
  confirmed positive remains decisive while unrelated coverage stays partial.
- Material principal is at least 10,000 USDT, or at least 100 USDT and 1% of an
  exact directional denominator. Partial history cannot use the percentage
  branch. Its confirmed absolute branch contributes 60; exact share uses the
  bound profile contribution clamped to 60..90.
- Exact `tron_gasfree` service-fee edges are excluded from principal amounts and
  policy materiality. Contract, GasFree-account, and ordinary-account types do
  not exclude real principal transfers from first-, second-, or third-hop
  tracing and scoring.
- The previous production runtime uses `scoring-signal-matrix-v2`; Plan 2 fresh
  candidates use v3. In either version, the checked subject restriction has
  first priority, then `direct_counterparty_policy`, then the remaining rows.
  Stored reports without the exact current marker keep their historical decision
  and require a fresh run.

### Verify20 And Telegram

- An exact four-selector Verify20 fingerprint for the checked contract, with no
  trusted-service guard, is an independent `DECLINE` pattern with floor 85. It
  does not prove a specific debit. Exact approval-drain provenance remains the
  stronger 95 floor, and interaction with Verify20 does not itself make a
  wallet a drainer.
- Normal Telegram output is deterministic and does not use LLM/free text. It
  keeps the risk emoji, canonical action, strongest winning fact, at most one
  additional risk/context fact, and an important coverage limit. An exact
  GasFree fee can appear as optional technical detail only when there is no
  coverage part and the compact body still fits.
- Normal and detailed current-policy status share the same fresh subject-bound
  DeepCheck/first-hop prerequisite. Missing or mismatched evidence yields
  `NO_FINAL_DECISION` with no score; detailed, support, and Admin diagnostics
  remain available.

### TGyt Regression

- The valid fixture subject is `TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD`.
  It sent 1,176,317 USDT of principal to
  `TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm` in two transfers. That counterparty is
  currently in the USDT blacklist and became active there 2 hours 52 minutes
  after the larger 1,176,302 USDT transfer. The checked subject itself is not
  blacklisted.
- The 83% bridge route is secondary to the direct policy fact. A separate exact
  3 USDT GasFree service-fee edge is excluded from principal. The fresh v2
  result is `DECLINE 90`; the saved legacy result remains 78. The fixture does
  not assert authoritative hashes for the two principal transfers or invent a
  settlement relation for the fee.

## Provenance Completeness

### Current Behavior

- `History not fully fetched` is emitted when hop history does not reach the
  required timestamp.
- Some paths now block final score with `score_valid=false`.
- A guarded approval-drain review with legitimate service context and no hard
  bad evidence should not become a final user-facing `DECLINE`.
- Admin-only strict benchmark has partial waiting/resume behavior for targeted
  index tasks.
- Ordinary `Where is money` has waiting/resume behavior for required targeted
  hop history. Stage 1.8 includes background retry escalation, adaptive cursor
  splitting for capped TronScan windows, cache-aware saved-page resume, lock
  heartbeat, same-address covering-target lookup, and retry of old local-budget
  partial provider-cap states.
- Ordinary `Where is money` can run bounded exact-window repair for probable
  source-provenance candidates. It may upgrade a candidate to `exact` only when
  the candidate-to-target window is covered and spend/amount-continuity checks
  pass.
- Ordinary `Where is money` queues durable candidate-window targeted indexing
  before broad targeted fallback for probable source-provenance candidates. A
  candidate window has a lower and upper timestamp plus candidate identity; it
  does not count as broad address-history coverage.
- Ordinary `Where is money` does not queue broad targeted history just because
  candidate windows were requested or are pending. Ordinary material unresolved
  or aggregate unresolved source exposure also does not automatically queue the
  old broad `genesis -> targetTimestamp` targeted index. The normal path is a
  bounded balance-forming slice for the concrete hop: read incoming history only
  up to the target transfer and only far enough to explain the target amount,
  then continue through the funders that formed that spend. If the bounded slice
  cannot cover the amount, the result stays an unresolved/pre-existing/dense
  caveat according to materiality rules instead of starting a 12k-page broad run.
  Service/CEX boundaries stop before candidate-window, balance-slice, or broad
  fallback work for that boundary address.
- Ordinary `Where is money` post-assessment broad fallback is reserved for
  unresolved source branches that intersect hard evidence, such as exact
  approval-drain provenance. Material unresolved context alone is not hard
  evidence and does not trigger broad fallback.
- Ordinary `Where is money` Admin graphs render saved funding candidates only
  when they attach to concrete route hops. Exact candidates can be shown as
  funding edges; probable candidates remain context; over-limit candidate tails
  are grouped. This is not DeepCheck relationship expansion and does not add
  arbitrary wallet neighbors.
- Ordinary `Where is money` can publish a valid `REVIEW` score when the only
  unresolved source-provenance residue or dense-hop provider-cap tail is below
  its materiality thresholds and has no hard evidence. Residual thresholds are
  1% and 100 USDT; dense-hop thresholds are 1% per branch, 2% aggregate, and
  10,000 USDT per branch. The unresolved branch must remain visible as a caveat.
- Exact approval-drain evidence is a 95/100 critical hard floor across FastCheck,
  DeepCheck, and unified final scoring. The saved `approval_drain_proximity`
  system label inherits the same floor because it represents prior exact
  approve -> transferFrom -> receiver evidence. Telegram must explain that hard
  evidence first and move behavior/transit signals to additional context.
- Sanctioned crypto-service labels from explorer/service text are matched
  through a local registry with aliases, authority, and official designation
  date. A traced event is treated as `sanctioned_service` only on or after that
  service's designation date; before that date, HTX/Huobi remains ordinary
  `htx_huobi` source-policy context. `Ordinary` here means non-sanctioned at the
  transfer timestamp, not neutral or unimportant: historical HTX/Huobi
  exposure remains visible `REVIEW` compliance context because a receiving
  service may delay the funds and request additional source-of-funds checks.
- Medium source-policy context must not be flattened to `ACCEPTABLE`.
  Low-score HTX/Huobi policy exposure remains user-facing `REVIEW`, and simple
  alert score display maps 45-59 to `REVIEW` instead of `ACCEPTABLE`.
- Unified final scoring preserves matrix `REVIEW` as user-facing `REVIEW`.
  Review-only source-policy, contract-suspicion, and pattern rows should give a
  clear final state plus review requirement, not a final `ACCEPTABLE` label.
- Final Telegram address reports are user-facing compliance summaries, not
  scoring dumps. Matrix `REVIEW` displays as `REVIEW`, exact hard evidence is
  deduplicated into one clear reason, and raw scoring diagnostics stay in
  support/admin/debug surfaces.
- The preliminary `Where is money` Telegram narrative is verified current
  behavior for a matching queued/running DeepCheck. It publishes `/100` only
  when at least one top-level or assessment validity mirror is explicitly
  `true`, neither mirror is `false`, and a subject-bound typed fact matches the
  dominant saved driver. An explicit `false` wins over `true`; false,
  undefined-only, and valid but unexplained results fail closed without score
  or emoji.
- Driver binding uses typed kind, evidence class, source-exposure kind, and
  evidence IDs. Raw reasons, messages, path warnings, method names, LLM text,
  and Deep-only evidence have no authority to explain the preliminary score.
  The primary fact owns the conclusion; coverage remains a separate
  non-risk section.
- A valid score without a matching typed fact emits
  `where_preliminary_score_without_structured_fact` as a best-effort runtime
  diagnostic. Diagnostic failure cannot block delivery and does not mutate the
  job, database, score, or stored report. The user sees a no-score coverage
  explanation, not the raw diagnostic code.
- The preliminary message has no canonical decision, action, recommendation,
  or DeepCheck state. It no longer has a generic completion fallback. Final
  narrative still owns canonical action; detailed, support, and Admin behavior
  is unchanged.
- Human risk explanations do not change scoring math. Normal Telegram output
  stays short and user-facing; `/check_status detailed` and Admin graph right
  rail show the detailed multi-mode explanation from saved FastCheck, Where Is
  Money, and DeepCheck evidence. Detailed views may add recommendations,
  limitations, and possible benign interpretations, but must not invent a new
  risk verdict or clean verdict outside the unified scoring result.
- A fresh ordinary Where job resumed from targeted `partial_provider_cap`
  progress must run the report builder and materiality assessment before
  deciding score validity. It must not complete directly from
  `provider_limited` progress with a minimal `provider_cap_unresolved` result.
- Old false `complete` targeted states from dev/pre-fix runs are repaired by a
  maintenance script, not by ordinary user flow.
- Wallet Intelligence is Admin-only investigative context. Completed or partial
  DeepCheck, Where, and Incoming jobs are best-effort indexed only after the job
  completion update succeeds, using already collected saved payloads. It stores
  cross-run sightings and edges, does not call TronScan, does not create labels
  or assertions, does not write risk observations, and does not affect scoring,
  Telegram output, or the original job result. Index failures are logged as
  runtime warnings.

### 2026-07-08 Amount-Aware Bridge/Router/DEX Scoring

- Small ordinary Where traces that end at `bridge_router_dex` or
  `cross_chain_boundary` stay visible, but they no longer become high policy
  declines only because they cover 100% of a small selected amount.
- For non-hard bridge/router/DEX or cross-chain source-policy exposure, affected
  selected amount `<5k USDT` caps at 58, `5k-25k USDT` caps at 59, and
  `25k-100k USDT` tapers up to 68. A single 26k transfer should not
  automatically jump to 68.
- This cap applies only when there is no hard evidence, sanctions, mixer,
  no-name liquidity, exact approval-drain provenance, or exact bad provenance.
  Those hard floors keep their existing behavior.
- Reports should still say that the selected balance-forming amount came
  through bridge/router/DEX or a cross-chain boundary. The wording must describe
  it as source-policy review context, not direct scam/drain proof.

### 2026-07-05 Dense-Hop Materiality For Where

- Dense-hop materiality changes scoring interpretation only; it does not change
  TronScan indexing or provider fetching.
- A provider-capped dense-hop unresolved source tail can be a score-valid caveat
  only below branch and aggregate thresholds and with no hard evidence.
- The tail stays visible in Admin and Telegram and is excluded from decisive
  clean/bad evidence. It is not a clean verdict.
- Material unresolved source, threshold failure, or hard evidence still blocks
  final scoring or drives the result.
- Old cached failed jobs are not silently recalculated. A fresh check must build
  a new result before Admin, bot, or support treats the dense-hop materiality
  policy as applied.

### Planned Behavior

- `History not fully fetched` is not an acceptable final paid result when the
  gap is caused by our local budget or partial index state.
- A service boundary is a legitimate stop.
- A local page-budget stop is not a legitimate source-of-funds conclusion.
- Final score should not be published as valid when the main money path is not
  covered, except for explicit low-materiality source-provenance caveats with no
  hard evidence or an independently applicable exact hard proof. Exact hard
  proof decides badness while the unrelated coverage caveat remains visible.
- If data is incomplete and cannot yet be scored, use `score_valid=false` and
  explain the technical block.
- `Incoming deposit` uses the shared candidate-window-first targeted
  wait/resume primitive, but still has separate gaps around terminal
  provider/budget stops and product progress visibility before provenance
  completeness is fully implemented across modes.

## Data Source

### Current Behavior

- TronScan is the source for TRON USDT history in this phase.
- The scheduler supports a pool of TronScan API keys and account groups.
- Inline live targeted history is capped by `TARGETED_HISTORY_INLINE_MAX_PAGES
  = 4`.
- Broad Where hop targeted indexing, when required by an unresolved
  hard-evidence branch, uses a larger Stage 1.8 background budget/depth
  ceiling. Ordinary material unresolved context uses candidate windows and the
  bounded balance-forming slice instead of this broad run.
- Candidate-window targeted indexing reads only
  `windowStartTimestamp -> windowEndTimestamp`; broad targeted indexing remains
  `genesis -> targetTimestamp`.

### Planned Behavior

- Do not add manual CSV import as a product workflow.
- Do not add another provider for this phase.
- More keys help throughput, but they do not solve local targeted budget or
  partial-state handling by themselves.

## DeepCheck

### Current Behavior

- DeepCheck all-time direct boundary works when the subject all-time index is
  complete and materializable.
- Direct hard-evidence checks for direct counterparties work.
- Second-layer metrics can still be empty even with a configured budget.

### 2026-07-05 DeepCheck Drainer-Campaign Visibility

- DeepCheck separates broad drainer-campaign context from exact approval-drain
  proof.
- Canonical USDT transfers stay plain; Verify20 and similar non-USDT wrapper
  calls are campaign context until exact approval/provenance proof is
  established.
- Similar Verify20 wrapper contracts seen across drainer-like cases remain
  deterministic campaign context for manual review. Automatic contract AI is
  disabled, and they still must not become a 95/100 hard floor without exact
  approve -> transferFrom -> receiver provenance.
- Reports include enrichment denominators and complete/lower-bound status so
  partial campaign counts are not presented as complete totals.

### 2026-07-09 Incoming Deposit Telegram Copy

- Incoming Deposit Telegram output must translate coverage blockers,
  source-share diagnostics, sender-history context, and common contract verdict
  reasons into Russian-first wording instead of leaking raw scoring strings.

### Planned Behavior

- Second-layer work should become real and metrics must reflect actual queued
  and completed work.

## Known Gaps

- `Incoming deposit` has the shared candidate-window-first targeted
  wait/resume primitive, but full main-path coverage and progress visibility are
  still less complete than ordinary Where.
- Budget escalation exists for ordinary Where targeted indexing, but the limits
  are still code constants rather than job-level/runtime product config.
- DeepCheck second-layer work is still partial/planned.

## Development Environment

- `docs/knowledge` is the current source of truth.
- Older specs, plans, research, and walkthrough docs are historical detail.
- Documentation is not code proof. Verify implementation before claiming
  current behavior.
