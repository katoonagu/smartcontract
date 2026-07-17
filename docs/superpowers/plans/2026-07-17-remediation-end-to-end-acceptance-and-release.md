# End-to-End Acceptance And Release Implementation Plan (Plan 5)

> **For agentic workers:** REQUIRED SUB-SKILLS: use
> `subagent-driven-development` for Tasks 1–8, `test-driven-development` for
> every code change, and `verification-before-completion` before the release
> checkpoint. Tasks 9–13 are release/closeout operations and require the explicit
> approval gates defined below.

> **Status:** утверждён. Этот документ коммитится отдельно до начала Task 0;
> код и production на момент утверждения не изменены.
>
> **Approved narrow amendment:** Task 0 разделён на локальный baseline gate и
> operational/release preflight. Локальная реализация Tasks 1–8 не зависит от
> доступности production preflight; Task 9 и `ready_for_release` без полного
> operational/release preflight недостижимы.
>
> **Draft baseline:** локальный `master`
> `547d86cd6c478ca56e5b85d2ccb31cdbce2ddc17`, содержащий реализованные Plans
> 1–4. После утверждения и отдельного commit только этого документа исполнитель
> обязан динамически зафиксировать `PLAN5_BASE_SHA`; SHA из черновика нельзя
> использовать вместо фактического значения.

**Goal:** доказать сквозное соответствие `REQ-01…REQ-38` и `AC-01…AC-41`,
провести migration/runtime/version/manual Telegram gates, безопасно выпустить
ровно один immutable candidate либо выполнить заранее подготовленный rollback,
не смешивая pre-release readiness, production release и post-release Address
Poisoning closeout.

**Architecture:** Plan 5 не меняет forensic или scoring semantics. Он добавляет
исполняемый release manifest, строгую runtime-version проекцию, schema-032 CLI
verification и проверяемые manual/release artifacts. Plans 1–4 остаются
владельцами поведения. Любая найденная функциональная ошибка возвращается в
владеющий план; release начинается заново с нового candidate SHA.

**Tech stack:** TypeScript 5.7, Node.js ESM, Vitest 4, PostgreSQL 16/`pg`,
существующий grammY bot, PowerShell release runbook. Новых dependencies,
миграций и таблиц нет.

---

## 0. Authority, ownership и неизменяемые границы

### 0.1 Нормативные источники

Plan 5 исполняет:

1. `docs/superpowers/specs/2026-07-12-telegram-runtime-forensics-remediation-design.md`;
2. утверждённые Plans 1–4;
3. current knowledge `03`, `05`, `06`, `07`, `08`, `09`, `10`, `12`, `13`;
4. новые ID-linked tests, уже добавленные Plans 1–4.

Каноническая спецификация имеет приоритет над историческими
`docs/superpowers/*`. Knowledge описывает фактически реализованное состояние,
но не заменяет code/test proof.

### 0.2 Ownership Plan 5

Primary ownership:

- `AC-41`;
- executable release manifest и release evidence;
- migration/schema-032 rehearsal и production verification;
- runtime build identity и существующая команда `/version`;
- candidate/manual Telegram acceptance;
- production rollout, canary и rollback;
- post-release verification;
- handoff в отдельный read-only Address Poisoning closeout после фактического
  release/rollback; closeout не является условием `ready_for_release` или
  `released`.

Secondary integration ownership:

- повторная проверка всех `REQ-01…REQ-38`;
- повторная проверка всех `AC-01…AC-40` через новые tests Plans 1–4;
- проверка, что эти tests действительно входят в required suite manifest.

Plan 5 не чинит найденный bug. Ошибка блокирует release, возвращается владельцу
Plan 1, 2, 3 или 4, получает отдельный RED→GREEN change/review, после чего
Plan 5 фиксирует новый candidate SHA и повторяет все gates с начала.

### 0.3 Production authority

Сам факт утверждения или выполнения Tasks 0–8 не разрешает production mutation.
Нужен отдельный `GO` пользователя после показа:

- immutable `RELEASE_SHA`;
- полного release manifest со статусом `ready_for_release`;
- migration rehearsal и backup plan;
- manual Telegram evidence на 19 сообщений / 15 сценариев;
- точных start/stop/rollback commands;
- предыдущего runtime SHA/label.

До этого `production DB`, runtime и рабочий Telegram остаются без изменений.
Push не выполняется ни на одном шаге без отдельной команды.

### 0.4 Forbidden scope

Запрещено:

- менять risk score, policy rows, thresholds, USDD formula или decisions;
- менять `ScoreAnchorV2`, `ForensicCoverageV2`, allowance, collector,
  GasFree, contract или service-session semantics;
- менять Telegram golden messages по смыслу;
- менять reconciliation, delivery retry/lease/CAS semantics;
- менять `migrations/031_address_poisoning_monitor.sql`, migration 032 bytes или
  создавать migration 033;
- менять Address Poisoning detector, worker, schema, scoring isolation, alert
  copy или callbacks;
- делать Admin redesign;
- добавлять dependency;
- пересчитывать или переписывать legacy jobs;
- хранить bot token, API key, DB URL, chat/user id, raw wallet list или секреты
  в release artifacts;
- выполнять force-push, reset, destructive checkout, автоматический DB restore
  или down-migration.

Разрешённый Address Poisoning scope: неизменённые regression tests, read-only
runtime/DB health и отдельный closeout document после проверки deployed runtime.

### 0.5 Dirty worktree и stash

На момент draft у пользователя 13 незакоммиченных файлов и четыре stash. Plan 5
выполняется в отдельном clean worktree/branch. Main-worktree files и stash не
переносятся в feature commits. До merge и после merge сравниваются:

- список 13 paths;
- staging state;
- SHA-256 для non-overlap files;
- четыре stash object SHA.

Любое расхождение блокирует merge и release.

---

## 1. Release invariants

1. После последнего code/docs commit фиксируется один `RELEASE_SHA` — полный
   lowercase 40-hex SHA. Все automated/manual/schema/runtime artifacts обязаны
   ссылаться ровно на него.
2. После freeze нельзя amend/rebase/cherry-pick/commit. Любое изменение создаёт
   новый SHA и обнуляет automated, manual и rollout approval.
3. Каждый gate сохраняет allowlisted `commandId`, SHA-256 заранее утверждённого
   redacted command template, start/end time, exit code и SHA-256
   санитизированного output. Literal command, argv, env и DB URL не сохраняются.
   Release validator не доверяет свободной строке `PASS`.
4. `AC-41` требует все 41 ID, required suite set, typed per-AC trace и
   фактический полный `npm test`. Source search/meta-test не заменяет
   machine-readable Vitest JSON/JUnit evidence.
5. Для `AC-01…AC-40` release manifest принимает только exact tests Plans 1–4:
   fullName, file, owner commit, ожидаемый RED и candidate GREEN. Один ID в
   comment/string, skipped/todo test или старый regression без ID не закрывает
   AC.
6. Schema 032 считается verified только результатом текущего
   `verifyRequiredSchema032`, совпадающим с exact migration bytes candidate.
7. Текущий ожидаемый checksum migration 032:
   `41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d`.
   Plan 5 вычисляет его заново. Любое отличие блокирует release; bytes не
   переписываются внутри Plan 5.
8. Candidate startup fail-closed до schema verification. `/version` получает
   schema status из того же verified object, а не из filename или env claim.
9. Ordinary Telegram messages по-прежнему не показывают branch/SHA/runtime;
   build identity показывается только в `/version`, Admin/diagnostics/logs.
10. Production migration 032 additive и не откатывается при application
    rollback. Старый runtime запускается с conservative legacy mirrors.
11. `sent` delivery не возвращается в pending; completed result и legacy jobs
    не пересчитываются при rollout/rollback.
12. Production schema/data clone используется только offline: migration,
    receipt, postconditions, backfill и no-op. Candidate runtime, worker или
    Telegram transport никогда не запускаются против него.
13. Runtime/rollback rehearsal использует отдельную sanitized DB с synthetic
    identities и outbound Telegram transport `recording_disabled`; никакой
    реальный Telegram send из runtime rehearsal невозможен.
14. Release остается blocked при любом P0. Copy/visual P1, нарушающий
   `AC-07…09`, `AC-12…13`, `AC-20…21`, `AC-27` или `AC-39`, также блокирует.

---

## 2. Typed release contracts

### 2.1 `RuntimeVersionV1`

```ts
type RuntimeVersionV1 = {
  version: "runtime-version-v1";
  gitCommitSha: string;
  runtimeInstanceLabel: string;
  scoringPolicyVersion: "scoring-signal-matrix-v3";
  resultSchemaVersion: "score-anchor-v2+forensic-coverage-v2";
  narrativeVersion: "telegram-forensic-result-v1";
  migration: {
    verified: true;
    version: 32;
    filename: "032_telegram_runtime_forensics_data_contracts.sql";
    checksumSha256: string;
    shortChecksum: string;
  };
};
```

Strict invariants:

- SHA — 40 lowercase hex и равен frozen candidate SHA;
- instance label непустой, не содержит secret/control chars и включает short
  SHA как отдельный token;
- scoring version берётся из `SCORING_SIGNAL_MATRIX_POLICY_VERSION`;
- result/narrative literals compile-time связаны с authoritative
  `ScoreAnchorV2`, `ForensicCoverageV2` и `TelegramForensicResultV1`; formatter
  не хранит собственную копию версий;
- migration object — exact output startup verifier;
- missing/malformed/mismatched field блокирует startup candidate;
- `/version` показывает full SHA, label, policy/result/narrative versions и
  `schema 032 verified · <short checksum>`; он не делает DB/provider call.

### 2.2 `RemediationReleaseManifestV1`

```ts
type ReleaseGateState = "pending" | "passed" | "failed" | "blocked";

type ReleaseCommandId =
  | "base_audit"
  | "acceptance_trace"
  | "plan1_focused"
  | "plan2_focused"
  | "plan3_focused"
  | "plan4_focused"
  | "full_regression"
  | "schema_clean_rehearsal"
  | "schema_production_clone_rehearsal"
  | "runtime_sanitized_rehearsal"
  | "manual_telegram_acceptance"
  | "legacy_terminal_population"
  | "rollback_rehearsal"
  | "address_poisoning_regression"
  | "production_backup"
  | "production_migration"
  | "production_rollout"
  | "production_canary";

type ReleaseArtifactV1 = {
  id: string;
  candidateSha: string;
  commandId: ReleaseCommandId;
  redactedTemplateSha256: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  outputSha256: string;
  state: ReleaseGateState;
};

type RemediationReleaseManifestV1 = {
  version: "remediation-release-manifest-v1";
  candidateSha: string;
  planBaseSha: string;
  requiredRequirementIds: string[];
  requiredAcceptanceIds: string[];
  gates: ReleaseArtifactV1[];
  manualTelegramEvidenceSha256: string | null;
  migrationEvidenceSha256: string | null;
  rollbackEvidenceSha256: string | null;
  overall: "not_ready" | "ready_for_release" | "released" | "rolled_back";
};
```

Validator requires exactly `REQ-01…REQ-38`, `AC-01…AC-41`, no duplicates,
the exact phase-aware gate allowlists below and `candidateSha` equality in every
artifact. It recursively rejects secret-like values in every parsed artifact
field, including URL credentials, bot/API tokens, raw chat/user ids and secret
env values. Only the allowlisted `commandId` and hash of an approved redacted
template are persisted.

State derivation is exact:

```text
G00…G11 passed
  -> ready_for_release

ready_for_release + explicit production GO
  -> G12 backup -> G13 migration -> G14 rollout -> G15 canary
  -> released

any production rollback
  -> rolled_back

Address Poisoning closeout
  -> separate APC-01 artifact/document after released|rolled_back
  -> does not change release manifest overall
```

`ready_for_release` ignores the still-pending production gates `G12…G15`, but
is impossible while any pre-release gate `G00…G11` is absent, pending, failed,
blocked, exitCode non-zero, hash invalid or foreign-SHA. `released` requires
all `G00…G15` passed. Address Poisoning implementation/closeout is never part
of either exact allowlist; only unchanged regression is `G11`.

### 2.3 `AcceptanceTraceV1`

```ts
type AcceptanceTraceV1 = {
  acceptanceId: `AC-${string}`;
  requirementIds: Array<`REQ-${string}`>;
  ownerPlan: 1 | 2 | 3 | 4 | 5;
  ownerCommitSha: string;
  testFile: string;
  fullName: string;
  primary: boolean;
  red: {
    baseSha: string;
    testPatchSha256: string;
    vitestReportSha256: string;
    expectedFailureFingerprint: string;
    status: "failed_as_expected";
  };
  green: {
    candidateSha: string;
    vitestReportSha256: string;
    status: "passed";
  };
};
```

Rules:

- exactly `AC-01…AC-41`; additional mandatory subtests may share an AC, but
  exactly one trace per AC is `primary=true`;
- every `fullName` starts with its own `[AC-XX]` token and is unique inside the
  required suite;
- owner commit is an ancestor of candidate and names the owner-plan change;
- RED comes from the original frozen test-only commit, or from an exact
  test-only patch replayed on the recorded owner base in an ephemeral worktree;
- RED is valid only for the expected behavioral assertion. Syntax, import,
  type, fixture or environment failure is rejected;
- GREEN is read from Vitest JSON/JUnit and must contain the exact file/fullName
  with state `passed`; missing, skipped, todo, duplicate or filtered-out tests
  fail closed;
- source search may lint IDs, but cannot create trace evidence.

The AC-10/11 title corrections and the new AC-33 LLM-dampening regression are
recorded as exact test-only patches and replayed against their owner bases so
their RED provenance is auditable without changing product semantics.

### 2.4 `ManualTelegramAcceptanceV1`

```ts
type ManualTelegramMessageRecordV1 = {
  id: string;
  scenarioId: string;
  candidateSha: string;
  runtimeLabel: string;
  checkedWallet: string;
  jobId: string;
  telegramMessageId: number;
  payloadSha256: string;
  screenshotFilename: string;
  screenshotSha256: string;
  requirementIds: string[];
  result: "pass" | "fail";
};

type ManualTelegramScenarioSummaryV1 = {
  scenarioId: string;
  candidateSha: string;
  runtimeLabel: string;
  messageRecordIds: string[];
  fixtureIds: string[];
  goldenIds: string[];
  requirementIds: string[];
  reviewer: string;
  reviewedAt: string;
  result: "pass" | "fail";
};

type ManualTelegramAcceptanceV1 = {
  version: "manual-telegram-acceptance-v1";
  candidateSha: string;
  messageRecords: ManualTelegramMessageRecordV1[];
  scenarioSummaries: ManualTelegramScenarioSummaryV1[];
};
```

Manual evidence binds:

- exact candidate SHA;
- exactly 19 message records, exactly 15 scenario summaries and exactly 11
  golden comparisons;
- required REQ/AC ids;
- reviewer and reviewed-at timestamp on every scenario;
- screenshot filename and SHA-256 for every message, not merely every scenario;
- candidate runtime label, checked wallet, non-null candidate/synthetic job id,
  Telegram message id and exact rendered-payload SHA-256 for every message;
- result `pass | fail`.

Fixture-only branches are persisted as synthetic jobs in the sanitized DB and
therefore still have an actual job id. The 19 payloads are produced through the
candidate's real Where/Deep/Incoming/Approval/Contract adapters and delivery
builder, then sent once through the separately authorized guarded test-bot
harness. The sanitized runtime rehearsal itself keeps real Telegram delivery
disabled.

Tokens, chat/user ids and Telegram response bodies are never persisted.
Telegram message id is allowed only as a non-secret acceptance identifier. A
message/scenario without any mandatory binding or `pass` blocks release.

### 2.5 `Schema032ReleaseEvidenceV1`

```ts
type Schema032ReleaseEvidenceV1 = {
  candidateSha: string;
  databaseRole: "clean" | "production_clone" | "runtime_sanitized" | "production";
  databaseFingerprintSha256: string;
  migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql";
  candidateBytesChecksumSha256: string;
  receiptChecksumSha256: string;
  shortChecksum: string;
  postconditionsSha256: string;
  firstApply: "applied" | "already_verified";
  secondApply: "already_verified";
};
```

Both full checksums are mandatory and equal to each other and to
`41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d`.
`/version` may show the short checksum, but release evidence always persists
the full candidate-bytes and receipt values plus postcondition hash.

### 2.6 `TerminalLegacyPopulationV1`

```ts
type TerminalLegacyPopulationV1 = {
  candidateSha: string;
  cutoff: string;
  terminalStatuses: ["completed", "failed", "cancelled"];
  populationCount: number;
  sortedJobIdSetSha256: string;
  aggregateImmutableResultSha256: string;
  sentFingerprintSetSha256: string;
  queryTemplateSha256: string;
};
```

Population contains every terminal job created at or before cutoff whose saved
policy/result marker is legacy. The ordered aggregate hashes canonical
`id/kind/status/completed_at/result_json` and excludes mutable retry/delivery
fields except the separate already-sent fingerprint set. New jobs after cutoff
cannot mask a changed count, ID set or result aggregate.

### 2.7 `RollbackRehearsalEvidenceV1` and `ProductionRollbackEvidenceV1`

Pre-GO `RollbackRehearsalEvidenceV1` records:

- exact previous production SHA/label and reproducible start command id;
- migrated sanitized DB fingerprint with schema 032 verified;
- `telegramTransport = recording_disabled` and zero outbound sends;
- previous runtime starts from its exact worktree/binary against schema 032;
- Admin health `200`, one runtime/worker schedule and expected previous
  `/version` format;
- authoritative allowance rows remain conservative through legacy mirrors;
- terminal legacy aggregate, completed results and sent fingerprints unchanged;
- stop/start cleanup leaves no process or advisory lock behind.

Before production canary `ProductionRollbackEvidenceV1` records:

Before canary the external evidence records:

- previous runtime SHA, label, PID/service identity and verified start command;
- candidate SHA and label;
- exact allowlisted stop/start/rollback command ids and redacted-template
  hashes; literal commands/secrets are not persisted;
- production DB name/fingerprint, backup path and backup SHA-256;
- schema-032 pre-state;
- operator and approval timestamp.

Plan 5 does not invent a service manager. Task 0 discovers the actual current
launch mechanism. If it is `Start-Process`, the approved command uses
`-WindowStyle Hidden`. If the old command cannot be reproduced safely, rollout
is blocked.

---

## 3. Release gate catalog and state machine

| Gate | Required evidence | Failure action |
|---|---|---|
| `G00_BASE` | clean isolated worktree, dynamic base, Plans 1–4 ancestry, preserved user files/stash | block |
| `G01_TRACE` | exact REQ/AC manifest; AC-41 test GREEN | return Plan 5 Task 2 |
| `G02_DATA` | Plan 1 focused + migration/allowance PostgreSQL GREEN | return Plan 1 |
| `G03_SCORING` | Plan 2 focused + PostgreSQL GREEN | return Plan 2 |
| `G04_RUNTIME` | Plan 3 focused + PostgreSQL GREEN | return Plan 3 |
| `G05_TELEGRAM` | Plan 4 focused, 11 exact golden, 19 message / 15 scenario manual evidence PASS | return Plan 4 |
| `G06_FULL` | typecheck, full suite, diff check, dependency/scope audit | return owning plan |
| `G07_SCHEMA_OFFLINE` | clean DB + offline production-clone rehearsals; full checksum/receipt/postconditions/no-op | block migration/release |
| `G08_VERSION_SANITIZED` | candidate runtime on sanitized DB, recording-only Telegram, `/version` exact | block startup/release |
| `G09_LEGACY_TERMINAL` | whole terminal legacy population count/ID-set/result aggregate unchanged | return owner/block |
| `G10_ROLLBACK_REHEARSAL` | exact previous SHA starts safely on migrated sanitized DB; zero external sends | block release |
| `G11_POISONING_REGRESSION` | unchanged Address Poisoning regression only | return separate owner/block |
| `G12_PRODUCTION_BACKUP` | explicit GO, verified DB identity, protected backup + SHA-256 | block production mutation |
| `G13_PRODUCTION_MIGRATION` | exact migration bytes, full receipt checksum, postconditions and no-op | rollback decision/block startup |
| `G14_PRODUCTION_ROLLOUT` | exact release SHA, one runtime, `/version`, Admin 200, workers alive | rollback on failure |
| `G15_PRODUCTION_CANARY` | lifecycle/delivery/legacy/log/queue canary complete | rollback on failure |

Phase rules:

| Manifest state | Required passed gates | Gates allowed pending |
|---|---|---|
| `not_ready` | any incomplete subset | any |
| `ready_for_release` | exactly `G00…G11` | `G12…G15` |
| `released` | exactly `G00…G15` | none |
| `rolled_back` | `G00…G11` plus recorded attempted production gates and rollback evidence | remaining production gates may be blocked |

`APC-01` is not a release gate. It is a separate post-release closeout artifact
created only after `released` or `rolled_back` and never changes the manifest.

---

## 4. File map

### Create

- `src/release/remediationReleaseManifest.ts`
- `src/release/acceptanceTrace.ts`
- `src/release/terminalLegacyPopulation.ts`
- `src/runtime/runtimeVersion.ts`
- `scripts/verifyRemediationRelease.ts`
- `scripts/verifySchema032.ts`
- `scripts/captureRemediationTestEvidence.ts`
- `scripts/snapshotTerminalLegacyPopulation.ts`
- `scripts/rehearseRemediationRuntime.ts`
- `scripts/finalizeTelegramAcceptance.ts`
- `tests/release/remediationReleaseManifest.acceptance.test.ts`
- `tests/release/acceptanceTrace.acceptance.test.ts`
- `tests/release/runtimeVersion.acceptance.test.ts`
- `tests/release/schema032Release.acceptance.test.ts`
- `tests/release/manualTelegramEvidence.acceptance.test.ts`
- `tests/release/terminalLegacyPopulation.acceptance.test.ts`
- `tests/release/rollbackRehearsal.acceptance.test.ts`
- `tests/fixtures/release/remediationReleaseFixtures.ts`
- `docs/superpowers/verification/plan5-release/README.md`

Created only after deployment/closeout:

- `docs/superpowers/verification/plan5-release/<date>-release-closeout.md`
- `docs/superpowers/verification/address-poisoning/<date>-runtime-closeout.md`

### Modify

- `package.json` — only `release:verify`, `schema:verify`, trace capture,
  runtime rehearsal and manual-evidence scripts; no dependency changes.
- `src/config.ts` — optional parsed `RUNTIME_GIT_SHA`; candidate startup makes
  it mandatory through `RuntimeVersionV1` validation.
- `src/index.ts` — retain startup `Schema032Verification`, build one runtime
  version object, pass it to bot/diagnostics.
- `src/bot/createBot.ts` — existing `/version` only; no normal-message change.
- `tests/config/config.test.ts`
- `tests/bot/createBot.test.ts`
- `tests/runtime/runtimeSchemaGateIntegration.acceptance.test.ts`
- `tests/forensics/recentFlowProvenanceSelection.test.ts` — test-title-only
  correction for AC-10/11; assertions and production behavior unchanged.
- `tests/check/contractDecisionV2.acceptance.test.ts` — separate exact
  AC-33 LLM-dampening regression; no production change unless it exposes a
  real owner-plan bug, in which case Plan 5 stops.
- knowledge `03`, `05`, `06`, `07`, `08`, `09`, `10`, `12`, `13` only where
  factual release state/runbook changes require it.

No other production file is expected. An extra path requires spec-review before
editing and may not expand product semantics. Production clone data is never
read by runtime code; sanitized runtime fixtures live only in release tests and
external disposable DB state.

---

## 5. Sequential tasks

### Task 0 — Split local baseline and operational/release preflight

**Code changes:** none. **Commit:** none.

#### Task 0A — Local baseline gate (before Tasks 1–8)

1. Verify local master contains Plan 4 final SHA and approved Plan 5 doc commit.
2. Set dynamically:

   ```powershell
   $env:PLAN5_BASE_SHA = (git rev-parse HEAD).Trim()
   if ($env:PLAN5_BASE_SHA -notmatch '^[0-9a-f]{40}$') { throw 'plan5_base_sha_invalid' }
   git show --stat --oneline $env:PLAN5_BASE_SHA
   ```

3. Create clean branch/worktree `codex/remediation-end-to-end-release`.
4. Store base SHA in branch config and assert it on every task.
5. Capture the main worktree 13-file/stash manifest without modifying it.
6. Resolve and record owner-plan-level base/test/implementation ancestry for
   `AC-01…AC-40`. Every recorded commit must exist locally and be an ancestor
   of candidate. Task 0A does not claim exact per-AC execution evidence.
7. Exact per-AC RED/GREEN traces for `AC-01…AC-40` are formed and verified by
   Tasks 1–6. `AC-41` belongs entirely to Plan 5 and first appears after its
   frozen RED batch and implementation in Tasks 1–6; its absence in Task 0A is
   expected and does not block Tasks 1–8.
8. Prove migration 032 bytes still hash to the approved full checksum.
9. Verify no `033_*.sql` and no unapproved migration exists.
10. Predeclare exact disposable identities:

    ```text
    tron_watch_plan5_clean
    tron_watch_plan5_clone
    tron_watch_plan5_runtime_sanitized
    ```

    `clone` is offline-only. `runtime_sanitized` contains only synthetic
    wallets/jobs and uses `recording_disabled` Telegram transport.
11. Record the current read-only operational snapshot without treating it as a
    release preflight. At amendment time the accepted baseline is:

    ```text
    previous runtime SHA: 0172978845ec74373bd245098ee8c075e0c39acf
    runtime label: master-01729788
    database: tron_watch on 127.0.0.1:55999
    schema state: legacy 031; schema-032 receipt absent
    Admin: HTTP 200 on 127.0.0.1:8787
    Telegram runtime mode: long polling
    ```

    Regenerated Task 0A evidence binds this snapshot to its observation time
    and sources. It does not authorize migration, rollout or Telegram sends.

**Task 0A expected:** clean feature worktree, exact local baseline and
plan-level ancestry evidence; production remains unchanged. Missing operational
release inputs do not block Tasks 1–8.

#### Task 0B — Operational/release preflight (mandatory immediately before Task 9)

Regenerate evidence from the then-current runtime and require all of:

1. exact previous runtime SHA and runtime label;
2. allowlisted start/stop command IDs and SHA-256 hashes of their redacted
   command templates; raw commands, credentials and secret environment values
   are forbidden in artifacts;
3. authoritative production DB identity and verified current schema state,
   including the schema-032 receipt pre-state;
4. exact previous-SHA rollback worktree plus the allowlisted rollback command;
5. reproducible `pg_dump`/`pg_restore` tool identities/versions and a protected
   external artifact root;
6. isolated candidate port and proof that discovery did not stop/start runtime,
   migrate DB or send Telegram messages.

Every value is bound to observation time, source and candidate SHA. Missing,
stale, guessed or unverified input blocks Task 9 and keeps
`ReleaseManifestV1.overall = "not_ready"`. Task 0B cannot be deferred into a
later Task 9 step and cannot be satisfied from the earlier Task 0A snapshot
alone.

**Reviews:** independent spec-review; independent safety/code-quality review.

### Task 1 — Repair canonical AC test identity and AC-33 coverage

**Files:**

- `tests/forensics/recentFlowProvenanceSelection.test.ts`
- `tests/check/contractDecisionV2.acceptance.test.ts`
- `tests/fixtures/release/remediationReleaseFixtures.ts`

Changes are test-only:

1. Rename, without changing assertions:

   ```text
   [AC-10][REQ-30] selects the synthetic TKg latest-five principal slice including the 305 pair
   [AC-11][REQ-02][REQ-30] excludes exact GasFree fee before taking five principal rows
   ```

2. Add the separate exact regression:

   ```text
   [AC-33][LLM-DAMPENING] prevents legacy LLM context from lowering provider risk Verify20 or exact debit proof
   ```

   It injects absent/legitimate/risky/malformed legacy model context into the
   same subject-bound deterministic cases and proves identical score,
   decision, authority and evidence IDs with zero provider calls. Service
   dampening remains covered by the existing primary AC-33 test.
3. In an ephemeral owner-base worktree, apply only the exact test patch and run
   the three fullNames. AC-10/11 must fail on `PLAN1_BASE_SHA` and AC-33
   LLM-dampening must fail on `PLAN2_BASE_SHA` for the expected missing/wrong
   behavior, never for syntax/import/fixture reasons.
4. Save sanitized Vitest JSON/JUnit RED evidence and patch SHA-256 outside the
   repo, then run the same fullNames on candidate and require GREEN.

**RED command shape:**

```powershell
npx vitest run --configLoader bundle --reporter=json `
  tests/forensics/recentFlowProvenanceSelection.test.ts `
  tests/check/contractDecisionV2.acceptance.test.ts
```

The exact owner-base worktree/patch is supplied by
`captureRemediationTestEvidence.ts`; the command must exit non-zero with the
recorded behavioral assertion. Candidate command exits zero with all three
exact fullNames passed and none skipped.

**Commit:** `test: complete canonical remediation acceptance identity`

After commit: clean worktree, spec-review of canonical names/semantics and
code-quality review proving assertions were not weakened. A real behavior
failure returns to Plan 1/2 and restarts candidate freeze; Plan 5 does not patch
production semantics.

### Task 2 — Frozen RED batch for Plan 5

**Files:** seven new `tests/release/*` files and release fixtures only.

Add these exact tests:

```text
[AC-41] validates the release regression manifest and required suite set
[AC-41][TRACEABILITY] requires every REQ-01 through REQ-38 and AC-01 through AC-41 exactly once
[AC-41][EXECUTION] requires every exact AC fullName to execute and pass without skip or todo
[AC-41][RED-PROVENANCE] requires owner commit expected RED and candidate GREEN evidence for every AC
[REQ-38][RELEASE-MANIFEST] rejects missing pending failed foreign-SHA or unhashed gate artifacts
[REQ-38][RELEASE-PHASES] derives ready only from G00-G11 and released only from G00-G15
[REQ-38][RELEASE-SECRETS] rejects secret-like values in every artifact field
[REQ-38][RELEASE-VERSION] requires exact candidate policy result narrative and verified schema identity
[REQ-38][SCHEMA-032-RELEASE] rejects filename full candidate checksum receipt checksum or postcondition mismatch
[REQ-32][PLAN5-MANUAL] requires 19 message records 15 scenario summaries and 11 golden comparisons
[REQ-35][REQ-36][PLAN5-RUNTIME] requires startup delivery and worker gates before ready_for_release
[REQ-03][REQ-04][PLAN5-LEGACY] rejects changed count ID set result aggregate or sent fingerprints for the terminal legacy cutoff population
[REQ-35][REQ-38][ROLLBACK-REHEARSAL] requires the exact previous SHA to run safely on migrated sanitized schema 032
[G11][ADDRESS-POISONING] requires unchanged regression and excludes closeout from release readiness
```

First run:

```powershell
npx vitest run --configLoader bundle `
  tests/release/remediationReleaseManifest.acceptance.test.ts `
  tests/release/acceptanceTrace.acceptance.test.ts `
  tests/release/runtimeVersion.acceptance.test.ts `
  tests/release/schema032Release.acceptance.test.ts `
  tests/release/manualTelegramEvidence.acceptance.test.ts `
  tests/release/terminalLegacyPopulation.acceptance.test.ts `
  tests/release/rollbackRehearsal.acceptance.test.ts
```

**Expected RED:** missing release/runtime/schema/manual modules or missing
required behavior. A syntax/type/fixture error is not an acceptable RED.

**Commit:** `test: define remediation release acceptance`

After commit: clean worktree, separate spec-review and code-quality review.
Frozen acceptance cannot be weakened to make release pass.

### Task 3 — Release manifest and typed acceptance trace validator

**Files:**

- `src/release/remediationReleaseManifest.ts`
- `src/release/acceptanceTrace.ts`
- `scripts/verifyRemediationRelease.ts`
- `scripts/captureRemediationTestEvidence.ts`
- `package.json`
- Task 2 manifest/trace tests/fixtures only as needed without changing semantics.

Implement strict parsing, exact ID sets, phase-aware gate allowlists,
SHA/time/hash validation and exact state derivation. CLI reads one explicit
artifact root, refuses symlinks/path escape, recursively rejects secrets, emits
only sanitized gate ids/status and exits non-zero on an invalid required gate.

Trace capture consumes Vitest JSON/JUnit. It binds every exact test fullName to
file, owner plan/commit, expected RED evidence and candidate GREEN evidence.
It rejects source-only IDs, comments/strings, missing tests, skip/todo/filter,
duplicates, foreign candidate, non-ancestor owner commit and RED caused by
syntax/import/type/fixture/environment failure.

**GREEN:** Task 2 manifest/traceability tests. Then `npm run typecheck`.

**Commit:** `feat: validate remediation release evidence`

**Reviews:** spec-review of all 38/41 IDs; code-quality/security review of path,
hash and fail-closed handling.

### Task 4 — Verified runtime identity and `/version`

**Files:**

- `src/runtime/runtimeVersion.ts`
- `src/config.ts`
- `src/index.ts`
- `src/bot/createBot.ts`
- `tests/release/runtimeVersion.acceptance.test.ts`
- `tests/config/config.test.ts`
- `tests/bot/createBot.test.ts`
- `tests/runtime/runtimeSchemaGateIntegration.acceptance.test.ts`

Implementation rules:

- build version only after `runStartupSchemaGate` returns verified schema;
- candidate/prod `RUNTIME_GIT_SHA` must be exact 40-hex;
- the runtime label contains the same short SHA;
- policy version comes from its exported constant; result/narrative values are
  compile-time constrained by the authoritative typed-contract versions;
- `/version` is pure and returns the same immutable object for the process;
- no ordinary Telegram formatter receives this metadata;
- startup closes DB and starts no provider/worker/bot on mismatch.

New/updated tests must prove exact RU/EN `/version`, no DB/provider call, full
SHA, schema short checksum, missing/mismatched env failure and unchanged
`[REQ-32][RUNTIME-HIDDEN]` behavior.

**GREEN commands:** focused release-version/config/bot/runtime tests, then
`npm run typecheck`.

**Commit:** `feat: expose verified runtime version`

**Reviews:** spec-review; code-quality review of source-of-truth and secret-free
output.

### Task 5 — Schema 032 verifier and offline rehearsal tooling

**Files:**

- `scripts/verifySchema032.ts`
- `tests/release/schema032Release.acceptance.test.ts`
- `package.json`
- existing schema migration modules only if a release adapter is impossible;
  their verification semantics may not change.

CLI must:

1. require an explicit DB URL from an explicit env name;
2. read exact migration bytes and compute SHA-256;
3. call existing `verifyRequiredSchema032`;
4. emit machine-readable `Schema032ReleaseEvidenceV1` containing full candidate
   bytes checksum, full receipt checksum, short checksum and postcondition hash;
5. report only safe DB identity/fingerprint, version and filename; never print
   URL, credentials or rows;
6. never apply migration itself;
7. exit non-zero on any filename/full-checksum/receipt/postcondition mismatch.

Offline rehearsal uses two disposable databases:

- empty `tron_watch_plan5_clean`;
- isolated restore of the current production schema/data snapshot named exactly
  `tron_watch_plan5_clone`.

For each: apply `npm run db:migrate`, verify, run again as verified no-op,
exercise allowance constraints/backfill and query the exact receipt. Clone and
clean databases are never production aliases. DB identity is checked before
create/drop/cleanup.

The production clone is created by a read-only `pg_dump --format=custom` and
`pg_restore` into the exact disposable name under an external protected
artifact directory. Evidence records dump SHA-256, source schema fingerprint,
tool versions and sanitized restore output. The clone is offline-only:

- no `src/index.ts`, bot, worker, provider, Admin or Telegram process may point
  to it;
- bot/provider credentials are removed from the rehearsal environment;
- only migration, verifier, catalog/postcondition and bounded backfill queries
  are allowed;
- cleanup uses exact DB-name guards after evidence acceptance.

Create `tron_watch_plan5_runtime_sanitized` separately from verified clean
schema. Seed only synthetic Plan 4/rollback fixtures, replace every wallet/chat/
user identity, clear all delivery/monitor queues and bind outbound Telegram to
`recording_disabled`. It is the only DB allowed for candidate/previous-runtime
rehearsal.

**Mandatory PostgreSQL RED→GREEN:** the release schema tests must actually
connect; skip is failure.

**Commit:** `feat: verify schema 032 for release`

**Reviews:** spec-review against canonical §10; PostgreSQL/rollback safety
review.

### Task 6 — Executable cross-plan suite and evidence manifest

**Files:**

- `src/release/remediationReleaseManifest.ts`
- `src/release/terminalLegacyPopulation.ts`
- `scripts/verifyRemediationRelease.ts`
- `scripts/snapshotTerminalLegacyPopulation.ts`
- `scripts/rehearseRemediationRuntime.ts`
- `tests/release/remediationReleaseManifest.acceptance.test.ts`
- `tests/release/terminalLegacyPopulation.acceptance.test.ts`
- `tests/release/rollbackRehearsal.acceptance.test.ts`
- `tests/fixtures/release/remediationReleaseFixtures.ts`

Add the exact required suite groups below. Runner executes one group at a time,
captures Vitest JSON/JUnit plus exit/hash evidence and never treats a missing,
skipped, todo or filtered test as pass. Every AC trace must resolve to an exact
fullName in these executed reports.

The same task implements the evidence-only operational helpers:

- terminal legacy snapshot queries the entire cutoff population, canonicalizes
  immutable result fields, and emits count, sorted-ID-set hash, aggregate result
  hash and sent-fingerprint-set hash without raw wallets/chat/user ids;
- runtime rehearsal verifies the exact sanitized DB identity, refuses the
  production-clone identity, forces `recording_disabled`, checks zero outbound
  sends and records candidate/previous-runtime health evidence;
- rollback rehearsal accepts only the exact previous production SHA/command id
  discovered in Task 0 and fails if schema, conservative mirrors, results,
  sent fingerprints, Admin/singleton health or expected legacy `/version`
  disagree.

#### Plan 1 group

```text
tests/forensics/forensicCoverageV2.test.ts
tests/forensics/balanceFormingTransfers.test.ts
tests/forensics/recentFlowProvenanceSelection.test.ts
tests/check/whereIsMoneyCheck.test.ts
tests/forensics/incomingDepositJob.test.ts
tests/check/deepForensicCheck.test.ts
tests/forensics/gasFreeSettlement.test.ts
tests/forensics/usddPsmRouteObservation.test.ts
tests/approvals/allowanceState.test.ts
tests/storage/repositories.test.ts
tests/storage/schemaMigrations.test.ts
tests/storage/migration032.postgres.test.ts
tests/runtime/startupSchemaGate.test.ts
```

#### Plan 2 group

```text
tests/risk/scoreAnchorV2.acceptance.test.ts
tests/risk/collectorUsddRemediation.acceptance.test.ts
tests/approvals/approvalSafetyV2.acceptance.test.ts
tests/approvals/approvalSafety.postgres.test.ts
tests/check/contractDecisionV2.acceptance.test.ts
tests/forensics/contractLlmIsolation.acceptance.test.ts
tests/forensics/moneyOriginLlmIsolation.acceptance.test.ts
tests/risk/remediationScoringCompatibility.test.ts
tests/risk/finalDisposition.test.ts
tests/risk/scoringSignalMatrix.test.ts
tests/risk/scoringSignalMatrixInputs.test.ts
tests/risk/unifiedWalletRisk.test.ts
tests/forensics/incomingDepositJob.test.ts
tests/forensics/deepForensicJob.test.ts
tests/approvals/allowanceState.test.ts
tests/approvals/approvalRisk.test.ts
tests/approvals/sessionContext.test.ts
tests/approvals/approvalWorker.test.ts
tests/approvals/safetyRecheck.test.ts
tests/forensics/usddPsmRouteObservation.test.ts
tests/forensics/contractLlmVerdict.test.ts
tests/forensics/moneyOriginOperationalAssessment.test.ts
tests/check/smartContractCheck.test.ts
tests/check/whereIsMoneyCheck.test.ts
tests/bot/createBot.test.ts
tests/alerts/formatters.test.ts
tests/tron/tronClient.test.ts
tests/storage/allowanceCausality.postgres.test.ts
```

#### Plan 3 group

```text
tests/runtime/waitReconciliation.acceptance.test.ts
tests/runtime/strandedParentRecovery.acceptance.test.ts
tests/runtime/telegramDelivery.acceptance.test.ts
tests/runtime/walletNavigation.acceptance.test.ts
tests/runtime/checkCallbacks.acceptance.test.ts
tests/runtime/allowanceRefresh.acceptance.test.ts
tests/runtime/runtimeSchemaGateIntegration.acceptance.test.ts
tests/storage/runtimeDelivery.postgres.test.ts
tests/storage/forensicCheckJobs.test.ts
tests/forensics/forensicJobProgress.test.ts
tests/forensics/addressIndexWorker.test.ts
tests/forensics/deepForensicJob.test.ts
tests/forensics/deepSecondLayerRefresh.test.ts
tests/forensics/incomingDepositJob.test.ts
tests/approvals/allowanceState.test.ts
tests/approvals/approvalWorker.test.ts
tests/wallet/dashboard.test.ts
tests/bot/createBot.test.ts
```

#### Plan 4 group

```text
tests/telegram/forensicPresentationContract.acceptance.test.ts
tests/telegram/unifiedForensicRenderer.acceptance.test.ts
tests/bot/unifiedTelegramModeWiring.acceptance.test.ts
tests/bot/unifiedTelegramProductionPaths.acceptance.test.ts
tests/alerts/unifiedTelegramAlerts.acceptance.test.ts
tests/telegram/manualTelegramAcceptanceManifest.test.ts
tests/storage/unifiedTelegramCoverage.postgres.test.ts
```

#### Address Poisoning regression group

```text
tests/monitor/addressPoisoning.test.ts
tests/monitor/addressPoisoningWorker.test.ts
tests/alerts/addressPoisoningAlert.test.ts
```

The runner additionally executes Plan 5 tests, `npm run typecheck`, the literal
full `npm test`, `git diff --check`, forbidden-scope audit and PostgreSQL schema
cleanup for exact prefixes `plan1_%…plan5_%` in the exact disposable DBs.

**Commit:** `test: make remediation release gates executable`

**Reviews:** spec-review of suite completeness; code-quality review of command
construction, skip detection and sanitized artifacts.

### Task 7 — Manual Telegram message/scenario evidence tooling

**Files:**

- `scripts/finalizeTelegramAcceptance.ts`
- `tests/release/manualTelegramEvidence.acceptance.test.ts`
- `docs/superpowers/verification/plan5-release/README.md`
- `package.json`

Reuse the Plan 4 renderer/send harness and actual candidate adapters/delivery
builder. Do not duplicate renderer or golden copy. The harness seeds synthetic
jobs into `tron_watch_plan5_runtime_sanitized`, renders all 19 payloads through
real Where/Deep/Incoming/Approval/Contract paths and records payload hashes.
Runtime background delivery remains `recording_disabled`; only the separately
authorized one-shot test-bot sender may send those exact payloads to one
allowlisted non-production chat.

Finalizer accepts only an immutable run for the exact candidate and runtime
label. It requires 19 `ManualTelegramMessageRecordV1`, 15
`ManualTelegramScenarioSummaryV1`, 11 golden comparisons and one screenshot
hash per message. Every message has checked wallet, synthetic/candidate job id,
Telegram message id, payload hash, candidate SHA and runtime label. It never
persists token, chat/user id or Telegram response body.

Tests prove wrong candidate/runtime/job/payload/message binding, missing or
duplicate message/scenario, missing/changed screenshot, pending/fail result,
10/12 golden count and secret-like value in any nested field all fail closed.

**Commit:** `test: verify manual telegram release evidence`

**Reviews:** spec-review against canonical §12; security/copy review.

### Task 8 — Candidate runbook and current-knowledge handoff

**Files:**

- `docs/superpowers/verification/plan5-release/README.md`
- knowledge `03`, `05`, `06`, `07`, `08`, `09`, `10`, `12`, `13` only as
  justified by actual candidate behavior.

Document exact allowlisted command ids/redacted templates, DB-name guards,
offline production-clone rules, sanitized runtime rehearsal, test-chat sender,
full schema checksum evidence, terminal legacy population cutoff, pre-GO
rollback rehearsal, release GO, backup/migration, rollout/canary, rollback and
the unresolved configured safety ceilings. Before production, knowledge says
`release candidate ready/pending approval`, not `deployed`.

`13-agent-observations.md` changes only for a newly observed repeated mistake.
Do not rewrite user-owned audit additions in `10` or `13`.

**Commit:** `docs: prepare remediation release runbook`

**Reviews:** whole-plan spec-review and code-quality/operational-safety review.

### Task 9 — Freeze candidate and execute all pre-release gates

**Code/docs changes:** none after freeze. **Commit:** none.

Before freezing the candidate, rerun and pass Task 0B operational/release
preflight for the then-current runtime. The verifier requires evidence for the
exact previous runtime SHA/label, allowlisted start/stop command IDs and
redacted-template hashes, production DB/schema state, rollback
worktree/command, `pg_dump`/`pg_restore`, protected artifact root and isolated
port. If any field is absent, stale or unverified, Task 9 stops before setting
`RELEASE_SHA`; no pre-manual gate may run and `ready_for_release` remains
impossible.

Set:

```powershell
$env:RELEASE_SHA = (git rev-parse HEAD).Trim().ToLowerInvariant()
$env:RUNTIME_GIT_SHA = $env:RELEASE_SHA
$env:RUNTIME_INSTANCE_LABEL = "remediation-$($env:RELEASE_SHA.Substring(0,8))"
```

Provision exact disposable DB URLs for Plans 1–5 and run the automated
pre-manual phase:

```powershell
npm run release:verify -- --phase pre-manual --artifact-root <outside-repo-path>
```

The executable phase performs the automated portions of `G00…G11`, including:

1. exact per-AC Vitest JSON/JUnit RED/GREEN trace;
2. all required PostgreSQL files, typecheck and literal full suite;
3. offline migration/no-op verification on clean DB and production clone;
4. full migration bytes/receipt checksum and postconditions evidence;
5. whole terminal legacy population count, ID-set hash, immutable result
   aggregate and sent-fingerprint set before/after;
6. exact 11 automated golden comparisons and generation of the 19 candidate
   payloads for the 15 manual scenarios;
7. Address Poisoning regression only;
8. cleanup and forbidden-scope audit.

At this point `G05_TELEGRAM` must remain exactly
`pending:manual_evidence_pending`. All other gates in `G00…G11` must be
`passed`; any other pending, skipped, blocked or failed state stops Task 9.
The command may report the phase result `pre_manual_ready`, but
`ReleaseManifestV1.overall` remains `not_ready`. This phase cannot produce
`ready_for_release`.

No runtime ever points to `tron_watch_plan5_clone`. Start the candidate only
against `tron_watch_plan5_runtime_sanitized` with provider fixtures and
`recording_disabled` Telegram transport. Verify Admin 200, singleton schedules,
workers, delivery recording, zero external sends and exact `/version`.

#### Mandatory pre-GO rollback rehearsal (`G10`)

Create a second isolated worktree at the exact previous production SHA and run
that runtime against the already migrated sanitized DB. Required checks:

1. schema 032 remains verified before and after the rehearsal;
2. previous runtime starts with its recorded command and expected legacy
   `/version` shape; it is not required to display Plan 5 fields;
3. Admin returns 200 and only one runtime/worker schedule exists;
4. `recording_disabled` transport records zero external sends;
5. stale/failed authoritative allowance rows expose conservative
   `0/false/unknown` legacy mirrors, never false active;
6. completed result hashes and whole terminal legacy population aggregates do
   not change;
7. existing `sent` fingerprints remain sent and are not reclaimed;
8. stop/start leaves no previous process, timer or advisory lock behind.

Persist `RollbackRehearsalEvidenceV1`; any failed check blocks
`ready_for_release` before production GO.

#### Manual Telegram acceptance

1. Use the 19 already-built payloads from the exact candidate and verify their
   hashes again before sending.
2. With separately authorized dedicated test credentials, send only those 19
   payloads once to one allowlisted non-production chat.
3. Capture 19 message records/screenshots and review 15 scenario summaries plus
   11 exact golden messages.
4. Finalize the manual evidence; only this operation may change
   `G05_TELEGRAM` from `pending:manual_evidence_pending` to `passed`.

The reviewer checks exactly the 15 `artifactId` entries already defined by
`MANUAL_TELEGRAM_ACCEPTANCE_CASES`. One summary is persisted per row; rows with
two fixture messages intentionally account for the difference between 15
summaries and 19 message records:

| Exact `artifactId` | Messages | Golden | Required observation |
|---|---:|---:|---|
| `GOLDEN_FINAL_AML` | 1 | 1 | checked-wallet link; principal driver first; chronology and coverage separate; deterministic final action |
| `GOLDEN_WHERE_PRELIMINARY` | 1 | 1 | preliminary Where result while Deep is pending; concrete reason; no invented final conclusion |
| `GOLDEN_NO_FINAL_TECHNICAL` | 1 | 1 | linked wallet, no score/action and a concrete technical limitation |
| `GOLDEN_TRUE_NO_ACTIVITY` | 1 | 1 | neutral no-score; no false `0%/100% unknown` |
| `GOLDEN_VERIFY20_ACTIVE_NO_DEBIT` | 1 | 1 | fresh official allowance, wallet-safety risk, balance at risk and no theft claim |
| `GOLDEN_VERIFY20_EXACT_DEBIT` | 1 | 1 | exact-debit fact first; no unsupported ownership or theft claim |
| `GOLDEN_BRIDGERS_ACTIVE` | 1 | 1 | explained service session, confirmed active state and audience-aware optional action |
| `GOLDEN_BRIDGERS_ZERO` | 1 | 1 | confirmed zero state and no required revoke action |
| `GOLDEN_BRIDGERS_ALLOWANCE_UNKNOWN` | 1 | 1 | unknown current state; never described as active or revoked |
| `GOLDEN_USDD_PSM` | 1 | 1 | exact direction/share and bounded PSM meaning without a laundering claim |
| `GOLDEN_GASFREE_ACCOUNT` | 1 | 1 | LOW 10 contract safety; principal remains traceable |
| `THJ_COLLECTOR_VARIANTS` | 2 | 0 | collector-only stays 35/REVIEW; disjoint independent signal reaches 55 with distinct evidence episodes |
| `TKG_LOW_BALANCE_AND_COVERAGE` | 2 | 0 | five principal transfers including the 305 pair; separate 24 available / 10 selected / 14 excluded coverage explanation |
| `OFFICIAL_USDT_AND_PSM_OUTBOUND` | 2 | 0 | official USDT LOW 0 with no LLM; outbound PSM base 20 + half-up modifier 2 = standalone 22/100 |
| `INCOMING_FAIL_CLOSED` | 2 | 0 | invalid legacy coverage and invalid address/anchor remain fail-closed without invented facts |

Exact totals are therefore **15 scenario summaries, 19 message records and 11
golden comparisons**. The finalizer rejects a missing, duplicate or foreign
`artifactId`, any other count, or any message/golden record not bound to one of
these exact 15 entries.

The following checks are intentionally outside
`MANUAL_TELEGRAM_ACCEPTANCE_CASES`; they do not create scenario summaries,
message records or golden comparisons:

| Runtime/canary check | Gates | Required observation |
|---|---|---|
| TYD stranded-parent reconciliation | `G08`, `G15` | sanitized startup and production canary each prove startup→reconcile→one claim→completion→one pending delivery; production observation remains post-GO |
| Delivery retry | `G08`, `G15` | sanitized retry/fingerprint evidence and post-GO production queue canary prove one visible final delivery |
| Navigation | `G08`, `G15` | sanitized and post-GO checks prove normal tab cache-only, explicit refresh and unblocked callback |
| `/version` | `G08`, `G14` | candidate and post-GO production runtime report the exact SHA/label/policy/result/narrative/schema checksum |

After manual finalization, rerun the strict readiness phase:

```powershell
npm run release:verify -- --phase readiness --artifact-root <outside-repo-path>
```

This phase requires every exact gate `G00…G11` to be `passed`, including the
finalized `G05_TELEGRAM`; it rejects pending/skipped/blocked/failed gates and
only then writes `ReleaseManifestV1.overall = "ready_for_release"`.

The TGyt/TWGC fixture proves deterministic behavior under fixture inputs. It is
not exported as an authoritative live-chain observation. Any live case fact
must record provider/source and observation time.

**Expected:** pre-manual verification leaves only G05 manual evidence pending;
manual finalization supplies exactly 15/19/11 records; the subsequent strict
readiness verification proves every `G00…G11` artifact passed and sets the
manifest to exactly `ready_for_release`. `G12…G15` remain pending. Production
is still unchanged.

### Task 10 — Merge and explicit release approval checkpoint

**Code changes:** none. **Commit:** none.

1. Present release SHA, ordered commits, scope diff, per-AC RED/GREEN trace,
   PostgreSQL/full-checksum evidence, 19/15 manual evidence, whole terminal
   legacy population hashes, rollback rehearsal and remaining limitations.
2. Obtain separate user approval to merge Plan 5 locally.
3. Preserve the main worktree's user files/stash with the same guarded stash /
   fast-forward / apply / content-hash procedure used for Plans 1–4.
4. Rerun the complete automated gate on merged `master`. Fast-forward must keep
   `master == RELEASE_SHA`; otherwise freeze is invalid.
5. Re-derive `ready_for_release`; `G12…G15` must still be pending.
6. Obtain a second explicit `GO` for production mutation.

No push is implied by merge or release GO.

### Task 11 — Production backup and migration (`G12`, `G13`)

**No source changes.** All commands operate on the approved `RELEASE_SHA`.

Preflight:

1. Verify production DB identity and connectivity read-only.
2. Record receipt-032 pre-state (normally missing on schema 031).
3. Create `pg_dump --format=custom` backup in an external protected path;
   verify restore-list readability, non-zero size and SHA-256. Missing or
   invalid `pg_dump` blocks release and leaves manifest `ready_for_release`.
4. Reconfirm the already-passed pre-GO rollback rehearsal evidence for the
   exact previous SHA; do not defer first proof until production.
5. At one cutoff record the complete terminal legacy population count,
   sorted-ID-set hash, immutable-result aggregate and sent fingerprints.
6. Persist `G12_PRODUCTION_BACKUP` with allowlisted command ids/template hashes.
7. Stop only the verified old bot/runtime process using its actual manager.

Migration:

```powershell
$env:DATABASE_URL = <production secret supplied outside artifacts>
npm run db:migrate
npm run schema:verify
npm run db:migrate
npm run schema:verify
```

The second apply is verified no-op. `schema:verify` persists
`Schema032ReleaseEvidenceV1` with the full candidate-bytes checksum, full
receipt checksum and postcondition hash. Both full checksums must equal the
approved value. Only then mark `G13_PRODUCTION_MIGRATION` passed. Candidate has
not started yet.

Any failure starts the Task 12 rollback decision; do not hotfix production.

### Task 12 — Production rollout, canary and rollback (`G14`, `G15`)

Start exactly `RELEASE_SHA` with `RUNTIME_GIT_SHA` and approved label.
Candidate must fail before Telegram/workers if schema verification fails.

Immediate `G14` gates:

- `/version` exact;
- Admin `/admin/forensics` HTTP 200;
- one Telegram polling/webhook worker;
- Where, Incoming, Deep/index, reconciler, delivery and allowance cycles alive;
- no raw secrets/ids in logs;
- no duplicate send caused by rollout;
- complete terminal legacy population aggregate unchanged.

Any failure triggers rollback; no production hotfix.

Observe at least two complete polling cycles and 15 minutes, whichever is
longer. Verify:

1. receipt row/version/filename/full checksum and all schema postconditions;
2. `/version` still matches startup verifier and `RELEASE_SHA`;
3. Admin 200 and singleton worker/process;
4. stranded all-ready reconciliation happens once, not repeatedly;
5. delivery attempts/fingerprint progress and sent rows are not reclaimed;
6. normal navigation makes no provider call; explicit refresh does;
7. stale/failed allowance is not called active before direct confirmation;
8. terminal legacy population count, exact cutoff ID-set hash, immutable result
   aggregate and sent-fingerprint set exactly match preflight;
9. no raw wallet/chat/token/API key in logs;
10. no unexpected queue growth or repeated terminal intent;
11. configured `hard_safety_limit_exceeded` and provider/local ceilings remain
    honest no-final states, not claimed fixed.

#### Rollback triggers

Rollback on schema/startup mismatch, wrong `/version`, process duplication,
Admin failure, broken delivery/worker lifecycle, score/legacy mutation,
Telegram presentation P0/P1, Address Poisoning regression or secret leakage.

#### Application rollback procedure

1. Stop candidate process.
2. Do **not** delete receipt 032, columns, constraints or delivery rows.
3. Start the exact previous verified runtime/worktree with its recorded label.
4. Verify Admin, singleton, `/version`, queues and conservative allowance view.
5. Confirm `sent` delivery remains sent and completed results unchanged.
6. Mark release manifest `rolled_back` with sanitized reason/evidence.

The DB backup is not automatically restored. Restore requires a separate
explicit operator decision after proving additive schema corruption; ordinary
application rollback leaves migration 032 in place.

If `G14` and `G15` pass, mark manifest `released` and hand off to separate
Address Poisoning closeout. The release manifest is now complete and is not
reopened by closeout.

### Task 13 — Separate Address Poisoning closeout and final documentation

Address Poisoning remains a separate track and receives no implementation
change. This task is not `G00…G15`, cannot block or create
`ready_for_release`, and runs only after manifest `released|rolled_back`:

1. rerun its three regression files on `RELEASE_SHA`;
2. read-only verify migration 031 objects/state;
3. verify monitor/check/delivery schedules and bounded queue/retry states;
4. verify `wallet_safety` observations remain `score_impact=0` and excluded
   from AML;
5. verify test-environment alert, owner-only callbacks, links and active warning
   coexistence with Incoming;
6. record four-character branch deployment/status;
7. state whether a fresh production alert was observed; absence during canary
   is `not observed`, never fabricated PASS evidence;
8. list remaining at-least-once gap and recipient-precheck future phase;
9. create separate `APC-01` closeout/follow-up evidence and document with
   `close | follow_up`.

Then update knowledge from candidate/pending to the actual deployed or
rolled-back state. Commit only docs/closeout changes. This post-release docs
commit is not the deployed runtime SHA; it must name the immutable
`deployedRuntimeSha` explicitly.

**Commit:** `docs: close remediation release and poisoning runtime audit`

**Reviews:** final spec-review of release evidence; final operational/code-
quality review. No push without separate approval.

---

## 6. Exact PostgreSQL acceptance and cleanup

Required databases are distinct:

```text
tron_watch_plan1
tron_watch_plan2
tron_watch_plan3
tron_watch_plan4
tron_watch_plan5_clean
tron_watch_plan5_clone
tron_watch_plan5_runtime_sanitized
```

Required PostgreSQL tests:

- `tests/storage/migration032.postgres.test.ts`
- `tests/storage/allowanceCausality.postgres.test.ts`
- `tests/approvals/approvalSafety.postgres.test.ts`
- `tests/storage/runtimeDelivery.postgres.test.ts`
- PostgreSQL branch in `tests/runtime/strandedParentRecovery.acceptance.test.ts`
- `tests/storage/unifiedTelegramCoverage.postgres.test.ts`
- Plan 5 schema-release PostgreSQL test.
- Plan 5 terminal-legacy-population and rollback-rehearsal PostgreSQL tests.

All required env flags are `1`; a skipped file fails the gate. The production
clone is used only by `db:migrate`, `schema:verify` and static bounded catalog/
backfill queries. The sanitized DB is used for candidate/previous-runtime
rehearsal with external Telegram disabled. No process may swap these roles.

After the run, query the exact DBs for `plan1_%…plan5_%` temporary schemas.
Cleanup may drop only exact returned test schemas after re-verifying
`current_database()`. Databases themselves are retained until release evidence
is accepted, then removed only with explicit exact-name guards. Production is
never used as a test database.

---

## 7. REQ → release gate → verification matrix

| REQ | Release gate(s) | Required verification |
|---|---|---|
| REQ-01 | G02, G06 | Plan 1 contract/GasFree trace tests; Plan 2 compatibility; full suite |
| REQ-02 | G02, G03 | exact GasFree settlement/fee exclusion before slice; compatibility regression |
| REQ-03 | G02, G04, G09, G15 | local limitation coverage; result/delivery immutability; whole terminal legacy population unchanged |
| REQ-04 | G03, G05, G09, G15 | exact-proof vs required-coverage disposition; renderer/no-final; exhaustive no legacy rescore |
| REQ-05 | G03, G04, G05, G08, G14 | mode separation, contract subject binding, delivery mode binding, sanitized real formatter/runtime paths |
| REQ-06 | G05 | deterministic subject-bound fact renderer; no raw/LLM fallback |
| REQ-07 | G05 | final risk/action or honest no-final in renderer and production paths |
| REQ-08 | G03, G05 | victim/spender/receiver/route evidence kinds and presentation remain distinct |
| REQ-09 | G05 | bridge/HTX/collector/PSM bounded Russian copy without theft presumption |
| REQ-10 | G02, G05 | typed coverage separate from score and rendered with honest reason |
| REQ-11 | G05 | physical transfer dedupe across modes/routes |
| REQ-12 | G05 | preliminary fixed order; no decision/action/Deep state |
| REQ-13 | G03, G05 | preliminary numeric risk only with valid anchor/preferred fact |
| REQ-14 | G03, G05 | preliminary excludes Deep-only/raw/LLM data |
| REQ-15 | G03, G05 | all ScoreAnchorV2 invariants and preferred driver shown first |
| REQ-16 | G03 | collector 35 cap and disjoint independent-signal composition only |
| REQ-17 | G03, G05 | material current blacklist relationship and honest chronology wording |
| REQ-18 | G03, G05 | approval wallet-safety AML impact 0; role/audience/Bridgers UI branches |
| REQ-19 | G02, G03, G04, G07, G08, G13, G15 | schema/persistence, full checksum/receipt, direct refresh, bounded runtime refresh, PG locks/failures |
| REQ-20 | G03, G05 | Verify20 tiers/exact debit/AML isolation and ownership-aware Telegram action |
| REQ-21 | G03 | exact service session plus all negative caller/time/amount/sequence/action cases |
| REQ-22 | G03, G05 | expiration absent from risk and Telegram; no implied on-chain revoke |
| REQ-23 | G03, G05 | deterministic authority and zero automatic LLM calls/output |
| REQ-24 | G03, G05 | official USDT, GasFree/endpoint boundary and unknown-contract deterministic cases |
| REQ-25 | G03, G05 | orchestration no-call and legacy LLM isolation from active presentation |
| REQ-26 | G03 | malformed/legacy model payload never enters fresh decision/evidence |
| REQ-27 | G03, G05 | deterministic contract decision first; no model output in Telegram |
| REQ-28 | G02, G03, G05 | exact PSM observation, modifier and bounded user meaning |
| REQ-29 | G03 | integer tier boundaries, half-up direction/mode adjustments and cap |
| REQ-30 | G02, G03, G05 | latest-five principal after exact fee exclusion; low-balance presentation |
| REQ-31 | G02, G05 | Where/Incoming/Deep denominators persist; available/selected/excluded render |
| REQ-32 | G05, G08, G14 | unified structure, exact links/terminology/golden, ordinary runtime hidden, production `/version` exact |
| REQ-33 | G05 | linked direction, two routes plus aggregation |
| REQ-34 | G02, G05 | true no-activity only after principal selection; no false percentages |
| REQ-35 | G04, G08, G10, G14, G15 | wait-set reconciliation, sanitized runtime, previous-SHA rollback, production singleton/canary |
| REQ-36 | G04, G08, G10, G14, G15 | delivery CAS/lease/retry/atomic effect/immutability, zero-send rollback rehearsal and production queue canary |
| REQ-37 | G04, G08, G14, G15 | cache-only navigation, explicit refresh, early callback in sanitized candidate and production runtime |
| REQ-38 | G01–G11, G13–G15 | typed AC execution/RED trace, phase/secret/schema/version/manifest fail-closed validation and no invented legacy fields |

---

## 8. AC → release gate → verification matrix

| AC | Gate | Required new test/evidence |
|---|---|---|
| AC-01 | G01, G03 | exact executed primary test: collector-only `35 REVIEW`; owner RED + candidate GREEN |
| AC-02 | G01, G03 | exact executed primary test: independent disjoint signal `55`; same/overlap stays `35` |
| AC-03 | G01, G03, G05 | 2% outbound PSM: base `20`, tier `3`, modifier `+2`, standalone `22`; manual copy |
| AC-04 | G01, G03, G05 | 83% inbound PSM top tier; manual direction/share |
| AC-05 | G01, G03 | historical Deep half/cap 12 |
| AC-06 | G01, G03 | label-only/discontinuous PSM unscored |
| AC-07 | G01, G05 | unified renderer/mode/alert exact test: active non-Fast anchor first |
| AC-08 | G01, G05 | checked wallet linked in every result type and 11 golden |
| AC-09 | G01, G05 | exact first/last four + canonical URL; invalid unlinked; manual link click |
| AC-10 | G01, G02, G05 | renamed exact fullName starts `[AC-10][REQ-30]`; TKg five including 305 pair; replayed owner RED |
| AC-11 | G01, G02 | renamed exact fullName starts `[AC-11][REQ-02][REQ-30]`; fee excluded before slice; replayed owner RED |
| AC-12 | G01, G02, G05 | true no-activity vs small principal and golden copy |
| AC-13 | G01, G02, G05, G07 | real PostgreSQL persist→reload→render 24/10/14 coverage |
| AC-14 | G01, G04, G08, G15 | all-ready once + TDEA 163/104 and TYD 216 chain in sanitized/prod runtime |
| AC-15 | G01, G04 | mixed ready/terminal technical path |
| AC-16 | G01, G04, G08, G10, G15 | retry/fingerprint/lease/crash/atomic Incoming delivery; zero-send rollback; canary queue |
| AC-17 | G01, G04, G08, G15 | normal navigation cache-only; explicit refresh live |
| AC-18 | G01, G04 | slow checks return before provider promise; early callback ack |
| AC-19 | G01, G03, G07 | fresh unlimited Verify20 `CRITICAL 90` plus PostgreSQL state |
| AC-20 | G01, G03, G05 | balance at risk/no debit + audience-aware Verify20 message |
| AC-21 | G01, G03, G05 | campaign/BTTOLD context only |
| AC-22 | G01, G03 | selector/provider name capped at context |
| AC-23 | G01, G03, G07, G10 | confirmed zero removes active threat; persists history; rollback mirror conservative |
| AC-24 | G01, G03, G05, G10 | failed/stale allowance unknown; Bridgers unknown; rollback never false active |
| AC-25 | G01, G03 | exact 66-second/91.103009 Bridgers session LOW 10 |
| AC-26 | G01, G03 | tag-only cannot dampen |
| AC-27 | G01, G05 | no approval transaction expiration or implied revoke execution |
| AC-28 | G01, G03 | envelope expiry does not affect approval risk |
| AC-29 | G01, G03, G05 | official TRON USDT LOW 0, zero LLM, manual output |
| AC-30 | G01, G03, G05 | GasFree Account LOW 10, endpoint negative, principal eligible |
| AC-31 | G01, G03 | exact Bridgers LOW 10 not decline |
| AC-32 | G01, G03 | known service unlimited without exact session REVIEW 45 |
| AC-33 | G01, G03 | primary service-dampening test plus separate `[AC-33][LLM-DAMPENING]` exact regression; both executed GREEN with owner RED evidence |
| AC-34 | G01, G03 | fresh LLM score payload ignored, no call |
| AC-35 | G01, G03 | verdict/recommendation payload ignored, no call |
| AC-36 | G01, G03 | legacy citations audit-only |
| AC-37 | G01, G03 | risky/uncited legacy payload excluded from fresh decision |
| AC-38 | G01, G03 | timeout/JSON/schema scenarios make zero provider calls |
| AC-39 | G01, G03, G05 | Bot/Alert + unified renderer exclude all legacy model text |
| AC-40 | G01, G03 | every fresh deterministic contract case bypasses Flash/Pro |
| AC-41 | G01, G06, G07, G08, G09, G10, G11, G13, G14, G15 | typed 41-AC RED/GREEN trace from Vitest reports; full suite; offline schema; sanitized runtime; rollback; AP regression; production release gates |

---

## 9. Commit and review discipline

| Task | Commit | Gate before next task |
|---:|---|---|
| 0A | none | local SHA/worktree/user-state/migration and AC-01…40 plan-level ancestry evidence; baseline spec-review + safety review |
| 0B | none | immediately before Task 9: exact runtime/DB/rollback/tooling/artifact-root preflight; any missing field blocks Task 9 |
| 1 | `test: complete canonical remediation acceptance identity` | owner-base RED replay + candidate GREEN, clean worktree, spec + test-quality review |
| 2 | `test: define remediation release acceptance` | Plan 5 RED evidence, clean worktree, spec + test-quality review |
| 3 | `feat: validate remediation release evidence` | focused GREEN, typed trace/secret tests, typecheck, spec + security review |
| 4 | `feat: expose verified runtime version` | focused GREEN, runtime-hidden regression, spec + quality review |
| 5 | `feat: verify schema 032 for release` | mandatory PG GREEN, full checksum evidence, offline clone cleanup, spec + DB-safety review |
| 6 | `test: make remediation release gates executable` | AC-41 executable trace GREEN, suite audit, spec + quality review |
| 7 | `test: verify manual telegram release evidence` | 19/15 focused GREEN, nested secret audit, spec + security review |
| 8 | `docs: prepare remediation release runbook` | full branch spec + operational review |
| 9 | none | frozen candidate; automated pre-manual gates with G05 pending; exact 15/19/11 manual finalization; strict `G00…G11` readiness verification |
| 10 | none | explicit merge approval, full rerun, explicit production GO |
| 11 | none | `G12` protected backup + `G13` exact migration/full receipt verification |
| 12 | none | `G14` rollout + `G15` canary, `released|rolled_back` |
| 13 | `docs: close remediation release and poisoning runtime audit` | separate APC-01 and final evidence reviews |

Every task commit contains all and only its task files. Before each commit:

```powershell
git diff --cached --check
git diff --cached --name-status
```

After each commit: `git status --porcelain` must be empty in the isolated
worktree. Review fixes belong to the owning task and require rerunning both
reviews. No autosquash/rewrite after `RELEASE_SHA` freeze.

---

## 10. Rollback matrix

| Failure point | Required response |
|---|---|
| Any `G00…G11` failure | remain `not_ready`; no production action; fix owner plan and restart all candidate evidence |
| Production clone contains runnable external delivery | destroy/recreate rehearsal DB; block readiness; investigate safety breach |
| Sanitized runtime records an external send | block readiness; invalidate manual/runtime evidence; no production GO |
| Previous-SHA rollback rehearsal fails | block readiness; do not substitute an untested command/runtime |
| Backup unavailable/invalid after GO | keep old runtime stopped only for the minimum verified interval or restart it; keep manifest `ready_for_release`; do not migrate |
| Migration transaction fails before receipt | verify rollback/no receipt; start exact previous runtime using rehearsed command |
| Schema 032 verifies but candidate startup fails | keep additive 032; start exact previous runtime; verify conservative mirrors/results/sent fingerprints |
| `/version` mismatch | stop candidate; start previous runtime; no DB down-migration |
| Worker/delivery/Telegram/Admin canary fails | application rollback; preserve sent/result state |
| Terminal legacy count/ID/result aggregate mismatch | immediate rollback and P0 incident evidence; do not accept a sample-only explanation |
| Address Poisoning regression before GO | block readiness; separate owner fix, no inline detector change |
| Address Poisoning safety regression after rollout | immediate rollback; separate APC-01 follow-up, no inline detector fix |
| Secret-like value in an artifact before GO | reject artifact, rotate if real secret, regenerate all dependent evidence |
| Secret leakage in production/logs | stop candidate, rotate affected secret outside repo, incident review |

Application rollback always uses the exact pre-GO rehearsed previous SHA and
command id against additive schema 032. It verifies expected legacy `/version`,
Admin 200, singleton workers, conservative allowance mirrors, unchanged whole
terminal legacy population and unchanged sent fingerprints. DB restore is
never automatic and requires separate explicit approval after proving additive
schema corruption.

---

## 11. Knowledge and release artifacts

Before release, update knowledge only to `candidate ready/pending GO`. After
release/rollback, update factual status:

- `03` — schema gate, runtime/delivery production state;
- `05` / `06` — released mode behavior, remaining honest stops;
- `07` — released policy version and wallet-safety separation;
- `08` — released Telegram UX and manual evidence status;
- `09` — deployed SHA/label/schema/policy or rollback result;
- `10` — close only actually released gaps; retain ceilings and audit findings;
- `12` — exact release/verify/rollback runbook;
- `13` — only a new repeated mistake/correction.

Release artifacts live outside the repository or under ignored `.tmp`; only
sanitized closeout summaries are committed. Each summary records artifact
hashes, not secrets or full raw logs.

---

## 12. Self-review checklist

- [x] Plan 5 owns AC-41 and integrates, but does not redefine, AC-01…40.
- [x] Task 0A requires only plan-level ancestry for AC-01…40; exact per-AC
  RED/GREEN traces are produced in Tasks 1–6, and AC-41 is created by Plan 5
  only after its own RED batch and implementation.
- [x] Missing release-operation inputs do not block local Tasks 1–8, while the
  separate Task 0B makes every runtime/DB/rollback/tooling input mandatory
  immediately before Task 9 and fail-closes `ready_for_release`.
- [x] Every REQ and AC maps to a release gate and concrete verification.
- [x] `ready_for_release` requires only `G00…G11`; `released` requires
  `G00…G15`; APC-01 is a separate post-release artifact.
- [x] AC-41 begins with a new expected RED, requires the literal full suite and
  consumes exact Vitest JSON/JUnit results rather than source search.
- [x] Every AC trace binds fullName/file/owner commit to expected RED and
  candidate GREEN; missing/skipped/todo/duplicate tests fail closed.
- [x] AC-10/11 fullNames now begin with their AC tokens and the separate AC-33
  LLM-dampening test is mandatory with replayed owner-base RED evidence.
- [x] Schema 032 verification uses receipt + exact bytes + postconditions and
  the same verifier as startup; evidence stores both full checksums.
- [x] Существующая `/version` является единственной пользовательской runtime-
  authority.
- [x] `/version` contains SHA/label/policy/result/narrative/schema while ordinary
  user messages remain free of runtime metadata.
- [x] Clean DB and production-schema/data clone migration rehearsals are
  mandatory and offline-only; runtime never points to the clone.
- [x] Candidate/previous-runtime rehearsals use only a synthetic sanitized DB
  with `recording_disabled` Telegram transport and zero external sends.
- [x] Required PostgreSQL tests cannot skip and exact cleanup is specified.
- [x] Manual evidence uses the exact 15 ordered `artifactId` values from
  `MANUAL_TELEGRAM_ACCEPTANCE_CASES` and requires exactly 15 scenario
  summaries, 19 message records, 11 golden comparisons plus
  SHA/runtime/message/job binding.
- [x] TYD reconciliation, delivery retry, navigation and `/version` are outside
  those 15 cases and remain separate `G08/G14/G15` runtime/canary checks.
- [x] Task 9 is acyclic: automated gates leave only G05 manual evidence
  pending; manual finalization passes G05; the subsequent strict verifier alone
  may derive `ready_for_release` from passed `G00…G11`.
- [x] USDD PSM 2% outbound is recorded as base 20 + modifier 2 = 22, while tier
  3 remains the share tier rather than the base.
- [x] No live on-chain transfer, approval or harmful action is used in manual
  acceptance.
- [x] Release SHA freezes before manual evidence and production.
- [x] Production mutation has a separate explicit GO after merge/reverification.
- [x] Exact previous-SHA rollback is rehearsed against migrated sanitized
  schema 032 before GO and proves conservative mirrors, result/sent
  immutability, Admin/singleton health and expected legacy `/version`.
- [x] Release artifacts store allowlisted command ids and redacted-template
  hashes; recursive secret scanning covers every field.
- [x] Whole terminal legacy population at cutoff is protected by count,
  sorted-ID-set hash, immutable-result aggregate and sent-fingerprint set;
  sample-only evidence is rejected.
- [x] Address Poisoning is regression-only during release and receives a
  separate APC-01 closeout after runtime verification; implementation is
  untouched.
- [x] No push, dependency, Admin redesign, migration 033 or product-semantic
  change is included.
- [x] User dirty files and stash have explicit preservation gates.

## 13. Approval checkpoint

План утверждён со следующей границей исполнения:

- сначала отдельным commit зафиксировать только этот документ;
- Tasks 0–8 выполнять последовательно в отдельном worktree через
  subagent-driven development;
- Task 9 не начинать до завершения Tasks 0–8 и отдельного подтверждения
  release-candidate evidence;
- production DB/runtime/Telegram не менять до полного `G00…G11`, merge в
  `master`, повторной строгой проверки и отдельного явного production GO;
- Plan 1–4 semantics и Address Poisoning implementation не трогать;
- не push/merge/deploy без отдельной команды пользователя.
