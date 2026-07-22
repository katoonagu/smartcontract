# End-to-End Acceptance And Release Implementation Plan (Plan 5)

> **For agentic workers:** REQUIRED SUB-SKILLS: use
> `subagent-driven-development` for Tasks 1–8B, `test-driven-development` for
> every code change, and `verification-before-completion` before the release
> checkpoint. Tasks 9–13 are release/closeout operations and require the explicit
> approval gates defined below.

> **Status:** утверждён. Этот документ коммитится отдельно до начала Task 0;
> код и production на момент утверждения не изменены.
> Task 8 остаётся незавершённым до полного GREEN Task 8B; Task 9 заблокирован
> одновременно manifest-lifecycle gap и отдельным unmarked-runtime preflight.
>
> **Approved narrow amendment:** Task 0 разделён на локальный baseline gate и
> operational/release preflight. Локальная реализация Tasks 1–8B не зависит от
> доступности production preflight; Task 9 и `ready_for_release` без полного
> operational/release preflight недостижимы.
>
> **Approved narrow amendment (Task 11):** backup implementation commit
> `359e83ca1534dc06481ba9bc724ee803744f55f9` добавил controlled G12 producer.
> Release candidate SHA по-прежнему определяется динамически как текущий clean
> `HEAD`. G12 evidence создаётся producer-ом, а gate отмечается только V2
> `release:manifest:advance`; read-only verifier ничего не пишет. Затем G13
> выполняется только после revalidation immutable release freeze и consumption
> fresh G13 `OperationalAttestationV2` через `schema:release:sequence`.
> Production не запускался; Task 9,
> Task 10 GO и
> исходные operational gates сохраняются.
>
> **Approved amendment (2026-07-18, Task 8B):** `release:verify` остаётся
> строго read-only verifier. До Task 9 Plan 5 обязан реализовать единственного
> writer-а `RemediationReleaseManifestV2`, typed evidence policies для
> `G00…G15`, атомарный CAS lifecycle, production rollout/canary/rollback
> sole orchestrators, split crash-safe effect-capable/cleanup-only expired-lease
> takeover, executable
> protected-root trust boundary, mandatory disposable PostgreSQL RED и
> обязательную full-verification binding для всех production mutators.
> G14/G15/actual-rollback/recovery authority проходит только fresh-unconsumed
> selection → original production lease → immutable original-lease preclaim →
> exact committed takeover-lineage/current-tip resolution → atomic claim/
> consumption. Before every production external effect a bound durable intent
> is mandatory. Для G12–G15 и actual rollback/recovery strict authority-expiry guard
> действует перед каждым leaf; immutable operation-deadline guard дополнительно
> действует только для G14/G15/actual rollback/recovery. Отдельный
> production-operation lease/takeover/settlement protocol не переиспользует
> authority. G14 pre-effect failure имеет typed no-effect rollback route. Ручное
> создание или редактирование manifest/gate output и прямой запуск production
> leaf-команд запрещены. Tasks 8B.0–8B.8 ниже являются частью утверждённого
> Plan 5 и не разрешают production mutation.
>
> **Approved corrective amendment (2026-07-21, Task 9 evidence):** canonical
> Task 0B evidence and `ReleaseFreezeIdentityV2` remain immutable. A pipeline
> longer than the original 15-minute observation window uses append-only,
> content-addressed `task0b-release-revalidation-v1` receipts. Each receipt is
> valid for 15 minutes, binds the exact generation/freeze/preflight, repeats
> every operational observation read-only, and must equal the frozen tuple
> except for its fresh exclusive-write probe. It never recreates or refreshes
> the freeze. The approved corrective producer also reconstructs the missing
> Task 0A and exact RED/GREEN trace inputs from immutable Git commits and actual
> Vitest JSON reports; it does not infer RED from source text. Controlled
> runtime start evidence is emitted by the rehearsal runner only after the
> corresponding real start/observe/stop sequence succeeds; preauthored start
> fixtures are forbidden. Acceptance trace requirement and owner-plan lineage
> is an explicit reviewed per-AC table, never an index/range formula. G12 and
> G13 production entry each require a fresh Task 0B revalidation receipt bound
> byte-for-byte to the immutable preflight and release freeze; their own
> authority/lease or authority/session guards govern the already-started action.
>
> **Approved consolidated corrective amendment (2026-07-22, RED trace):** the
> exact Plan 2 primary traces AC-03/04/05/06/19/22/23/25/26/28/29/30/31/32/
> 33/36/37 may use assertion-bound `local_product_module_absent` only at frozen
> test commit `01a29fef…`. Evidence binds exact test `fullName`, one exact
> module-absence line under `src/*`, exact test patch, owner `83f0cb96…`, and
> final candidate SHA; Git proves absence at test and presence at owner plus
> candidate. AC-29/30 retain their other behavioral assertion messages, but
> only the single exact module-absence line is typed local evidence. Generic,
> synthetic, foreign-importer, dependency, fixture, environment, no-test and
> multiple-absence evidence remains fail closed. Plan 3 RED execution binds
> `PLAN3_TEST_DATABASE_URL`/`TEST_DATABASE_URL` to the exact disposable
> `tron_watch_plan3` database and requires `REQUIRE_PLAN3_POSTGRES=1`; AC-14/15
> may not be skipped. The runner verifies the exact loopback publish binding,
> pinned running PostgreSQL container/image and live database/system identity,
> then creates and removes the frozen test-only `tron` login on that disposable
> database. The exact pins are container
> `fbb25bec0cfa79a35efddb287f3ae9ba1921fb645558b0b48dfce8b45d60d39e`,
> name `/plan5-release-pg-f97549bc`, and system identifier
> `7664744009044738089`. Setup/cleanup drift and database/transport failures
> fail closed. RED classification is a positive allowlist; AC-14/15 require the
> exact frozen `reconcileWaitingForensicCheckJobs` failure and stack binding.
> RED execution selects only `[AC-NN]` tests. The fresh cleanup connection
> revalidates identity, disables the test login, terminates its sessions, drops
> only its disposable owned objects, drops the role, and verifies absence.
> Assertion-bound local-module reports reject suite-level failure messages and
> exactly reconcile aggregate counts. Only AC-29/30 may retain companions, and
> only their exact frozen three no-call plus one decision-object
> `AssertionError` multiset remains behavioral.
> This amendment changes release evidence only, not product,
> scoring, security, runtime or production state.
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
typed `RemediationReleaseManifestV2`, единственный атомарный lifecycle writer,
read-only verifier, строгую runtime-version проекцию, schema-032 CLI
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

Сам факт утверждения или выполнения Tasks 0–8B не разрешает production mutation.
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
   фактический полный Vitest run через repository-local `vitest.mjs` с
   утверждёнными serialization/test/hook bounds. npm indirection не является
   command evidence: source search/meta-test не заменяет machine-readable
   Vitest JSON/JUnit evidence.
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
15. `release:verify` read-only и не создаёт, не обновляет и не «чинит» manifest
    или gate output. Результат verifier byte-identical относительно artifact
    root.
16. `release:manifest:advance` — единственный writer manifest/gate lifecycle.
    Ручное создание/редактирование `release-manifest.json`, `gates/*` и
    transition receipts запрещено и не принимается production mutators.
17. Каждый production action требует current V2 manifest, exact current
    manifest SHA, hash-chained transition receipt, artifact-root/Task0B binding
    и полную semantic verification всех gates текущей фазы.
18. Task 9 начинается только после GREEN Tasks 8B.1–8B.8 и отдельного fresh
    Task 0B. Текущий unmarked production runtime остаётся вторым независимым
    блокером; Task 8B не разрешает его adopt/restart/stop.

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

### 2.2 `RemediationReleaseManifestV2`

V1 validation remains only for already-created local Task 1–8 test artifacts.
It has no authority to open Task 9 or any production action. Every fresh Plan 5
release lifecycle uses V2 and the sole writer described in Task 8B.

```ts
type ReleaseGateId =
  | "G00_BASE" | "G01_TRACE" | "G02_DATA" | "G03_SCORING"
  | "G04_RUNTIME" | "G05_TELEGRAM" | "G06_FULL"
  | "G07_SCHEMA_OFFLINE" | "G08_VERSION_SANITIZED"
  | "G09_LEGACY_TERMINAL" | "G10_ROLLBACK_REHEARSAL"
  | "G11_POISONING_REGRESSION" | "G12_PRODUCTION_BACKUP"
  | "G13_PRODUCTION_MIGRATION" | "G14_PRODUCTION_ROLLOUT"
  | "G15_PRODUCTION_CANARY";

type PreReleaseGateId = Exclude<ReleaseGateId,
  "G12_PRODUCTION_BACKUP" | "G13_PRODUCTION_MIGRATION" |
  "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY">;
type ProductionGateId = Exclude<ReleaseGateId, PreReleaseGateId>;

type ReleaseCommandId =
  | "base_audit" | "acceptance_trace" | "plan1_focused"
  | "plan2_focused" | "plan3_focused" | "plan4_focused"
  | "full_regression" | "schema_production_clone_rehearsal"
  | "runtime_sanitized_rehearsal" | "manual_telegram_acceptance"
  | "legacy_terminal_population" | "rollback_rehearsal"
  | "artifact_root_preflight" | "release_freeze_materialize"
  | "operational_authority_issue" | "operational_authority_terminalize"
  | "manifest_lease_takeover"
  | "production_operation_lease_takeover"
  | "production_operation_cleanup_only_takeover"
  | "production_recovery"
  | "address_poisoning_regression" | "production_backup"
  | "production_migration" | "production_rollout" | "production_canary"
  | "production_rollback";

type ManifestTransitionId =
  | "pre_manual"
  | "readiness"
  | "g12_backup_passed"
  | "g13_migration_passed"
  | "g14_rollout_passed"
  | "g15_canary_released"
  | "production_failed"
  | "rollback_rolled_back";

type GateEvidenceKind =
  | "task0_baseline" | "trusted_os_principal_policy"
  | "release_freeze_materialization"
  | "acceptance_trace" | "task8b_red" | "suite_report"
  | "suite_evidence" | "full_regression" | "schema_clean"
  | "schema_production_clone" | "schema_runtime_sanitized"
  | "runtime_rehearsal" | "terminal_legacy_population"
  | "rollback_rehearsal" | "manual_telegram_acceptance"
  | "operational_attestation" | "production_backup_consumption"
  | "production_backup_dump_progress" | "production_backup_list_progress"
  | "production_backup_dump" | "production_backup_restore_list"
  | "production_backup_evidence" | "production_migration_authority"
  | "production_migration_consumption" | "production_migration_sequence"
  | "production_operation_claim" | "production_operation_settlement"
  | "production_operation_lease_removal_prepared"
  | "production_operation_lease_removal" | "production_operation_cleanup"
  | "production_rollout_manager" | "production_rollout_queries"
  | "production_rollout_orchestration" | "production_rollout_evidence"
  | "production_canary_queries" | "production_canary_logs"
  | "production_canary_orchestration" | "production_canary_evidence";

type GateEvidenceRefV2 = {
  kind: GateEvidenceKind;
  relativePath: string; // exact allowlisted path from GateEvidencePolicy
  sha256: string;
  schemaVersion: string;
  candidateSha: string;
};

type ProductionFailureTransitionEvidenceRefV2 = {
  kind: "production_failure_evidence";
  relativePath: "production-failure-evidence-v2.json";
  sha256: string;
  schemaVersion: "production-failure-evidence-v2";
  candidateSha: string;
  sourceManifestSha256: string;
};

type ActualRollbackTransitionEvidenceRefV2 = {
  kind: "actual_rollback_evidence";
  relativePath: "production-rollback-evidence-v2.json";
  sha256: string;
  schemaVersion: "production-rollback-evidence-v2";
  candidateSha: string;
  sourceManifestSha256: string;
};

type ManifestTransitionEvidenceRefV2 =
  | ProductionFailureTransitionEvidenceRefV2
  | ActualRollbackTransitionEvidenceRefV2;

type PendingReleaseGateV2 = {
  id: ReleaseGateId;
  candidateSha: string;
  state: "pending";
};

type ExecutedReleaseGateV2 = {
  id: ReleaseGateId;
  candidateSha: string;
  state: "passed" | "failed";
  commandId: ReleaseCommandId;
  redactedTemplateSha256: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  outputSha256: string;
  evidence: GateEvidenceRefV2[];
};

type BlockedReleaseGateV2 = {
  id: ProductionGateId;
  candidateSha: string;
  state: "blocked";
  blockedByGateId: ProductionGateId;
  productionFailureEvidence: ProductionFailureTransitionEvidenceRefV2;
};

type ReleaseGateV2 =
  | PendingReleaseGateV2
  | ExecutedReleaseGateV2
  | BlockedReleaseGateV2;

type ReleaseFreezeIdentityV2 = {
  version: "release-freeze-identity-v2";
  releaseGenerationId: string;
  candidateSha: string;
  planBaseSha: string;
  artifactRootFingerprintSha256: string;
  artifactRootTrustBoundaryEvidenceSha256: string;
  productionDatabaseIdentityFingerprintSha256: string;
  postgresToolIdentitySha256: string;
  previousRuntimeDiscoverySha256: string;
  rollbackWorktreeIdentitySha256: string;
  createdAt: string;
};

type ReleaseFreezeMaterializationReceiptV2 = {
  version: "release-freeze-materialization-receipt-v2";
  commandId: "release_freeze_materialize";
  redactedTemplateSha256: string;
  task0BPreflightEvidenceSha256: string;
  protectedRootFingerprintSha256: string;
  candidateSha: string;
  runtimeIdentitySha256: string;
  bootstrapLeaseSha256: string;
  bootstrapLeaseEpoch: number;
  canonicalFreezeIdentity: ReleaseFreezeIdentityV2;
  canonicalFreezeIdentityUtf8Base64: string;
  canonicalFreezeIdentitySha256: string;
  materializedAt: string;
};

type PreparedReleaseFreezeMaterializationV2 = {
  version: "prepared-release-freeze-materialization-v2";
  commandId: "release_freeze_materialize";
  redactedTemplateSha256: string;
  protectedRootFingerprintSha256: string;
  task0BPreflightEvidenceSha256: string;
  candidateSha: string;
  runtimeIdentitySha256: string;
  bootstrapLeaseSha256: string;
  bootstrapLeaseEpoch: number;
  canonicalFreezeIdentity: ReleaseFreezeIdentityV2;
  canonicalFreezeIdentityUtf8Base64: string;
  canonicalFreezeIdentitySha256: string;
  canonicalFreezeIdentityRelativePath: "release-freeze-identity-v2.json";
  canonicalMaterializationReceipt: ReleaseFreezeMaterializationReceiptV2;
  canonicalMaterializationReceiptUtf8Base64: string;
  canonicalMaterializationReceiptSha256: string;
  canonicalMaterializationReceiptRelativePath:
    "release-freeze-materialization-receipt-v2.json";
  preparedAt: string; // all publication timestamps fixed here
};

type TrustedOsPrincipalPolicyV2 = {
  version: "trusted-os-principal-policy-v2";
  policyId:
    | "windows-service-localsystem-administrators-v1"
    | "windows-configured-canonical-set-v1"
    | "posix-owner-only-v1";
  platform: "windows" | "posix";
  normalizedTrustedPrincipalSetSha256: string;
  trustedPrincipalCount: number;
};

type ArtifactRootTrustBoundaryEvidenceV1 = {
  version: "artifact-root-trust-boundary-evidence-v1";
  candidateSha: string;
  commandId: "artifact_root_preflight";
  redactedTemplateSha256: string;
  canonicalRootPathSha256: string;
  mutableAncestorIdentitySetSha256: string;
  filesystemKind: "local_ntfs" | "local_posix";
  ownerIdentityFingerprintSha256: string;
  trustedOsPrincipalPolicyId: TrustedOsPrincipalPolicyV2["policyId"];
  trustedOsPrincipalPolicySha256: string;
  normalizedAclOrModeSha256: string;
  untrustedWriteGrantPresent: false;
  samePrincipalConcurrentMutationProhibited: true;
  checkedAt: string;
};

type OperationalAttestationV2 = {
  version: "operational-attestation-v2";
  action: ManifestTransitionId;
  generationId: string;
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  commandId: ReleaseCommandId;
  redactedTemplateSha256: string;
  previousAttestationSha256: string | null;
  priorTerminalLineageSha256: string | null;
  issuedAt: string;
  expiresAt: string;
};

type OperationalAttestationIssuerReceiptV2 = {
  version: "operational-attestation-issuer-receipt-v2";
  commandId: "operational_authority_issue";
  redactedTemplateSha256: string;
  action: ManifestTransitionId;
  generationId: string;
  sequence: number;
  previousIssuerReceiptSha256: string | null;
  attestationRelativePath: string;
  attestationSha256: string;
  previousAttestationSha256: string | null;
  priorTerminalLineageSha256: string | null;
  issuedAt: string;
};

type PreparedOperationalAttestationIssuanceV2 = {
  version: "prepared-operational-attestation-issuance-v2";
  commandId: "operational_authority_issue";
  redactedTemplateSha256: string;
  action: ManifestTransitionId;
  generationId: string;
  sequence: number;
  previousIssuerReceiptSha256: string | null;
  canonicalAttestation: OperationalAttestationV2;
  canonicalAttestationUtf8Base64: string;
  canonicalAttestationSha256: string;
  canonicalAttestationRelativePath: string;
  canonicalIssuerReceipt: OperationalAttestationIssuerReceiptV2;
  canonicalIssuerReceiptUtf8Base64: string;
  canonicalIssuerReceiptSha256: string;
  canonicalIssuerReceiptRelativePath: string;
  canonicalCommittedIssuance: CommittedOperationalAttestationIssuanceV2;
  canonicalCommittedIssuanceUtf8Base64: string;
  canonicalCommittedIssuanceSha256: string;
  canonicalCommittedIssuanceRelativePath: string;
  previousAttestationSha256: string | null;
  priorTerminalLineageSha256: string | null;
  preparedAt: string; // all canonical timestamps are fixed before publication
};

type CommittedOperationalAttestationIssuanceV2 = {
  version: "committed-operational-attestation-issuance-v2";
  commandId: "operational_authority_issue";
  redactedTemplateSha256: string;
  action: ManifestTransitionId;
  generationId: string;
  issuanceIntentSha256: string; // projection hash; does not include prepare/marker hashes
  attestationSha256: string;
  issuerReceiptSha256: string;
  committedAt: string;
};

type AuthorityTerminalReceiptV2 = {
  version: "authority-terminal-receipt-v2";
  commandId: "operational_authority_terminalize";
  redactedTemplateSha256: string;
  action: ManifestTransitionId;
  generationId: string;
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  attestationSha256: string;
  issuerReceiptSha256: string;
  previousIssuerReceiptSha256: string | null;
  reason: "expired_unclaimed";
  preclaimAbsent: true;
  claimAbsent: true;
  consumptionAbsent: true;
  actionLeaseAbsent: true;
  g13BoundSessionAbsent: true;
  g13AdvisoryLockAbsent: true;
  operationAbsent: true;
  externalEffectCount: 0;
  terminalizedAt: string;
};

type PreparedAuthorityTerminalV2 = {
  version: "prepared-authority-terminal-v2";
  commandId: "operational_authority_terminalize";
  redactedTemplateSha256: string;
  canonicalTerminalReceipt: AuthorityTerminalReceiptV2;
  canonicalTerminalReceiptUtf8Base64: string;
  canonicalTerminalReceiptSha256: string;
  canonicalTerminalReceiptRelativePath: string;
  preparedAt: string; // equals canonicalTerminalReceipt.terminalizedAt
};

type ProductionOperationKindV2 = "rollout" | "canary" | "rollback" | "recovery";
type ProductionOperationCapabilityV2 =
  | "effect_capable" | "recovery_only" | "cleanup_only";
type ProductionOperationCommandIdV2 =
  | "production_rollout" | "production_canary" | "production_rollback"
  | "production_recovery";

type ProductionAuthorityPreclaimValidationV2 = {
  version: "production-authority-preclaim-validation-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  operationalAttestationSha256: string;
  operationalAttestationIssuerReceiptSha256: string;
  recoveryFromAbandonedOperationSha256: string | null;
  commandId: ProductionOperationCommandIdV2;
  redactedTemplateSha256: string;
  originalLeaseSha256: string;
  originalLeaseEpoch: number;
  originalLeaseOwnerProcessIdentitySha256: string;
  checkedAt: string;
  expiresAt: string;
  operationDeadlineAt: string;
  minimumRequiredValidityMs: number;
  status: "fresh_compatible_unconsumed";
};

type ProductionPreclaimLeaseLineageV2 = {
  version: "production-preclaim-lease-lineage-v2";
  operationId: string;
  relativePath: string; // exact production-preclaim-lease-lineages/<operationId>/<currentTipLeaseSha256>.json
  preclaimValidationSha256: string;
  previousLineageSha256: string | null;
  originalLeaseSha256: string;
  originalLeaseEpoch: number;
  originalLeaseOwnerProcessIdentitySha256: string;
  committedTakeoverReceiptSuffixSha256s: [] | [string];
  currentTipLeaseSha256: string;
  currentTipLeaseEpoch: number;
  currentTipLeaseOwnerProcessIdentitySha256: string;
  lineageStartedAt: string;
  resolvedAt: string;
};

type OperationalAttestationConsumptionV2 = {
  version: "operational-attestation-consumption-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  operationalAttestationSha256: string;
  operationalAttestationIssuerReceiptSha256: string;
  recoveryFromAbandonedOperationSha256: string | null;
  preclaimValidationSha256: string;
  preclaimLeaseLineageRelativePath: string;
  preclaimLeaseLineageSha256: string;
  preclaimLeaseLineageCurrentTipSha256: string;
  commandId: ProductionOperationCommandIdV2;
  redactedTemplateSha256: string;
  leaseSha256AtConsumption: string;
  leaseEpochAtConsumption: number;
  consumedAt: string;
  expiresAt: string;
  operationDeadlineAt: string;
};

type ProductionOperationClaimV2 = {
  version: "production-operation-claim-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  operationalAttestationSha256: string;
  operationalAttestationIssuerReceiptSha256: string;
  recoveryFromAbandonedOperationSha256: string | null;
  authorityConsumption: OperationalAttestationConsumptionV2;
  authorityConsumptionSha256: string;
  preclaimLeaseLineageRelativePath: string;
  preclaimLeaseLineageSha256: string;
  preclaimLeaseLineageCurrentTipSha256: string;
  capability: "effect_capable" | "recovery_only";
  leaseEpochAtConsumption: number;
  operationDeadlineAt: string;
  claimedAt: string;
  claimantPid: number;
  claimantProcessStartFingerprintSha256: string;
};

type ProductionOperationLeaseV2 = {
  version: "production-operation-lease-v2";
  scope: "artifact_root_production_operation";
  relativePath: "production-operation-root.lease.json";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  operationalAttestationSha256: string;
  recoveryFromAbandonedOperationSha256: string | null;
  capability: ProductionOperationCapabilityV2;
  leaseEpoch: number;
  ownerPid: number;
  ownerProcessStartFingerprintSha256: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string; // rolling lease; policy operation deadline is separate
  operationDeadlineAt: string;
};

type PreparedProductionOperationLeaseTakeoverV2 = {
  version: "prepared-production-operation-lease-takeover-v2";
  commandId: "production_operation_lease_takeover";
  redactedTemplateSha256: string;
  capability: "effect_capable" | "recovery_only";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  authorityConsumptionSha256: string | null;
  oldLeaseSha256: string;
  oldLeaseEpoch: number;
  oldOwnerProcessIdentitySha256: string;
  canonicalNewLease: ProductionOperationLeaseV2 & {
    capability: "effect_capable" | "recovery_only";
  };
  canonicalNewLeaseUtf8Base64: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  operationDeadlineAt: string;
  preparedAt: string;
};

type CommittedProductionOperationLeaseTakeoverV2 = {
  version: "committed-production-operation-lease-takeover-v2";
  commandId: "production_operation_lease_takeover";
  redactedTemplateSha256: string;
  capability: "effect_capable" | "recovery_only";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  authorityConsumptionSha256: string | null;
  preparedTakeoverSha256: string;
  oldLeaseSha256: string;
  tombstoneRelativePath: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  operationDeadlineAt: string;
  committedAt: string;
};

type PreparedCleanupOnlyProductionOperationTakeoverV2 = {
  version: "prepared-cleanup-only-production-operation-takeover-v2";
  commandId: "production_operation_cleanup_only_takeover";
  redactedTemplateSha256: string;
  capability: "cleanup_only";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  authorityConsumptionSha256: string | null;
  terminalReason:
    | "authority_expired_before_claim"
    | "authority_expired_after_claim"
    | "operation_deadline_reached";
  oldLeaseSha256: string;
  oldLeaseEpoch: number;
  oldOwnerProcessIdentitySha256: string;
  canonicalNewLease: ProductionOperationLeaseV2 & {
    capability: "cleanup_only";
  };
  canonicalNewLeaseUtf8Base64: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  operationDeadlineAt: string;
  preparedAt: string;
};

type CleanupOnlyProductionOperationTakeoverV2 = {
  version: "cleanup-only-production-operation-takeover-v2";
  commandId: "production_operation_cleanup_only_takeover";
  redactedTemplateSha256: string;
  capability: "cleanup_only";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  authorityConsumptionSha256: string | null;
  terminalReason:
    | "authority_expired_before_claim"
    | "authority_expired_after_claim"
    | "operation_deadline_reached";
  preparedTakeoverSha256: string;
  oldLeaseSha256: string;
  tombstoneRelativePath: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  operationDeadlineAt: string;
  committedAt: string;
};

type ProductionOperationSettlementV2 = {
  version: "production-operation-settlement-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  claimSha256: string;
  authorityConsumptionSha256: string;
  finalLeaseSha256: string;
  finalLeaseEpoch: number;
  operationDeadlineAt: string;
  terminalEvidenceSha256: string;
  authorityRevalidatedAt: string;
  deadlineRevalidatedAt: string;
  settledAt: string;
} & (
  | { capability: "effect_capable";
      result: "passed";
      orchestrationReceiptSha256: string;
      attemptedExternalEffect: boolean }
  | { capability: "effect_capable";
      result: "failed";
      orchestrationReceiptSha256: string | null;
      attemptedExternalEffect: boolean }
  | { capability: "recovery_only";
      result: "failed";
      orchestrationReceiptSha256: string;
      recoveryAttemptedExternalEffect: false;
      priorAttemptedExternalEffect: boolean }
);

type ProductionOperationLeaseRemovalReceiptV2 = {
  version: "production-operation-lease-removal-receipt-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  terminalStateKind: "settlement" | "terminal_abandoned";
  terminalStateSha256: string;
  capability: ProductionOperationCapabilityV2;
  removedLeaseSha256: string;
  removedLeaseEpoch: number;
  removedAt: string; // fixed before deletion; never regenerated during replay
};

type PreparedProductionOperationLeaseRemovalV2 = {
  version: "prepared-production-operation-lease-removal-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  terminalStateKind: "settlement" | "terminal_abandoned";
  terminalStateSha256: string;
  capability: ProductionOperationCapabilityV2;
  exactCurrentLeaseSha256: string;
  exactCurrentLeaseEpoch: number;
  canonicalRemovalReceipt: ProductionOperationLeaseRemovalReceiptV2;
  canonicalRemovalReceiptUtf8Base64: string;
  canonicalRemovalReceiptSha256: string;
  preparedAt: string; // equals canonicalRemovalReceipt.removedAt
};

type ProductionOperationTerminalCleanupV2 = {
  version: "production-operation-terminal-cleanup-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  terminalStateSha256: string;
  capability: ProductionOperationCapabilityV2;
  preparedRemovalSha256: string;
  leaseRemovalReceiptSha256: string;
  removedLeaseSha256: string;
  cleanedAt: string;
};

type ProductionOperationTerminalAbandonedV2 = {
  version: "production-operation-terminal-abandoned-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  claimSha256: string | null;
  authorityConsumptionSha256: string | null;
  capability: ProductionOperationCapabilityV2;
  cleanupOnlyTakeoverSha256: string | null;
  finalLeaseSha256: string;
  finalLeaseEpoch: number;
  completedStepReceiptSetSha256: string;
  attemptedExternalEffect: boolean;
  reason:
    | "authority_expired_before_claim"
    | "authority_expired_after_claim"
    | "operation_deadline_reached"
    | "ownership_protocol_failure";
  abandonedAt: string;
};

type RemediationReleaseManifestBaseV2 = {
  version: "remediation-release-manifest-v2";
  candidateSha: string;
  planBaseSha: string;
  revision: number;
  previousManifestSha256: string | null;
  updatedAt: string;
  artifactRootFingerprintSha256: string;
  releaseFreezeIdentitySha256: string;
  latestCommittedReceiptSha256: string;
  requiredRequirementIds: string[];
  requiredAcceptanceIds: string[];
  gates: ReleaseGateV2[];
};

type RemediationReleaseManifestV2 = RemediationReleaseManifestBaseV2 & (
  | { transitionId: Exclude<ManifestTransitionId,
        "production_failed" | "rollback_rolled_back">;
      overall: "not_ready" | "ready_for_release" | "released";
      transitionEvidence: [];
      actualRollback: null }
  | { transitionId: "production_failed";
      overall: "not_ready";
      transitionEvidence: [ProductionFailureTransitionEvidenceRefV2];
      actualRollback: null }
  | { transitionId: "rollback_rolled_back";
      overall: "rolled_back";
      transitionEvidence: [
        ProductionFailureTransitionEvidenceRefV2,
        ActualRollbackTransitionEvidenceRefV2
      ];
      actualRollback: {
        evidence: ActualRollbackTransitionEvidenceRefV2;
        outcome: ProductionRollbackOutcomeV2;
      } }
);

type ManifestTransitionClaimV2 = {
  version: "manifest-transition-claim-v2";
  transitionId: ManifestTransitionId;
  transitionKeySha256: string;
  generationId: string;
  sourceManifestSha256: string | null;
  claimedAt: string;
  expiresAt: string; // at most two minutes
  claimantPid: number;
  claimantProcessStartFingerprintSha256: string;
};

type ReleaseRootWriterOperationKindV2 =
  | "manifest_transition"
  | "operational_authority_issue"
  | "operational_authority_terminalize";

type BootstrapRootWriterLeaseV2 = {
  version: "bootstrap-root-writer-lease-v2";
  scope: "artifact_root";
  relativePath: "manifest-transition-root.lease.json";
  writerOperationKind: "release_freeze_materialization";
  writerOperationKeySha256: string;
  protectedRootFingerprintSha256: string;
  task0BPreflightEvidenceSha256: string;
  candidateSha: string;
  runtimeIdentitySha256: string;
  releaseGenerationId: null;
  releaseFreezeIdentitySha256: null;
  leaseEpoch: number;
  ownerPid: number;
  ownerProcessStartFingerprintSha256: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string; // rolling 60 seconds, absolute maximum five minutes
};

type FrozenRootWriterLeaseV2 = {
  version: "frozen-root-writer-lease-v2";
  scope: "artifact_root";
  relativePath: "manifest-transition-root.lease.json";
  writerOperationKind: ReleaseRootWriterOperationKindV2;
  writerOperationKeySha256: string;
  transitionKeySha256: string | null;
  protectedRootFingerprintSha256: string;
  candidateSha: string;
  releaseGenerationId: string;
  releaseFreezeIdentitySha256: string;
  leaseEpoch: number;
  ownerPid: number;
  ownerProcessStartFingerprintSha256: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
};

type ReleaseRootWriterLeaseV2 =
  | BootstrapRootWriterLeaseV2
  | FrozenRootWriterLeaseV2;

type ManifestTransitionLeaseV2 = FrozenRootWriterLeaseV2 & {
  writerOperationKind: "manifest_transition";
  transitionKeySha256: string;
};

type PreparedFrozenRootWriterLeaseTakeoverV2 = {
  version: "prepared-frozen-root-writer-lease-takeover-v2";
  commandId: "manifest_lease_takeover";
  redactedTemplateSha256: string;
  candidateSha: string;
  releaseGenerationId: string;
  releaseFreezeIdentitySha256: string;
  artifactRootFingerprintSha256: string;
  writerOperationKind: ReleaseRootWriterOperationKindV2;
  writerOperationKeySha256: string;
  transitionKeySha256: string | null;
  oldLeaseSha256: string;
  oldLeaseEpoch: number;
  oldOwnerProcessIdentitySha256: string;
  canonicalNewLease: FrozenRootWriterLeaseV2;
  canonicalNewLeaseUtf8Base64: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  preparedAt: string;
};

type FrozenRootWriterLeaseTakeoverReceiptV2 = {
  version: "frozen-root-writer-lease-takeover-receipt-v2";
  commandId: "manifest_lease_takeover";
  redactedTemplateSha256: string;
  candidateSha: string;
  releaseGenerationId: string;
  releaseFreezeIdentitySha256: string;
  artifactRootFingerprintSha256: string;
  writerOperationKind: ReleaseRootWriterOperationKindV2;
  writerOperationKeySha256: string;
  transitionKeySha256: string | null;
  preparedTakeoverSha256: string;
  oldLeaseSha256: string;
  tombstoneRelativePath: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  committedAt: string;
};

type PreparedBootstrapRootWriterLeaseTakeoverV2 = {
  version: "prepared-bootstrap-root-writer-lease-takeover-v2";
  commandId: "manifest_lease_takeover";
  redactedTemplateSha256: string;
  protectedRootFingerprintSha256: string;
  task0BPreflightEvidenceSha256: string;
  candidateSha: string;
  runtimeIdentitySha256: string;
  preparedFreezeMaterializationSha256: string | null;
  oldLeaseSha256: string;
  oldLeaseEpoch: number;
  oldOwnerProcessIdentitySha256: string;
  canonicalNewLease: BootstrapRootWriterLeaseV2;
  canonicalNewLeaseUtf8Base64: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  preparedAt: string;
};

type BootstrapRootWriterLeaseTakeoverReceiptV2 = {
  version: "bootstrap-root-writer-lease-takeover-receipt-v2";
  commandId: "manifest_lease_takeover";
  redactedTemplateSha256: string;
  protectedRootFingerprintSha256: string;
  task0BPreflightEvidenceSha256: string;
  candidateSha: string;
  runtimeIdentitySha256: string;
  preparedFreezeMaterializationSha256: string | null;
  preparedTakeoverSha256: string;
  oldLeaseSha256: string;
  tombstoneRelativePath: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  committedAt: string;
};

type BootstrapRootTerminalAbandonedV2 = {
  version: "bootstrap-root-terminal-abandoned-v2";
  protectedRootFingerprintSha256: string;
  task0BPreflightEvidenceSha256: string;
  candidateSha: string;
  runtimeIdentitySha256: string;
  bootstrapTakeoverReceiptSha256: string;
  preparedFreezeMaterializationSha256: null;
  removedBootstrapLeaseSha256: string;
  removedBootstrapLeaseEpoch: number;
  reason: "owner_died_before_freeze_prepare";
  rootSealed: true;
  retryRequiresNewProtectedRoot: true;
  abandonedAt: string;
};

type PreparedManifestTransitionV2 = {
  version: "prepared-manifest-transition-v2";
  transitionId: ManifestTransitionId;
  transitionKeySha256: string;
  generationId: string;
  sourceManifestSha256: string | null;
  previousReceiptSha256: string | null;
  targetRevision: number;
  gateOutputSha256s: string[];
  targetSnapshotRelativePath: string;
  targetSnapshotSha256: string;
  canonicalCommittedReceipt: CommittedManifestTransitionReceiptV2;
  canonicalCommittedReceiptUtf8Base64: string;
  committedReceiptSha256: string;
  preparedAt: string;
};

type CommittedManifestTransitionReceiptV2 = {
  version: "committed-manifest-transition-receipt-v2";
  transitionId: ManifestTransitionId;
  transitionKeySha256: string;
  candidateSha: string;
  artifactRootFingerprintSha256: string;
  releaseFreezeIdentitySha256: string;
  sourceManifestSha256: string | null;
  previousReceiptSha256: string | null;
  targetManifestProjectionSha256: string;
  sourceRevision: number | null;
  targetRevision: number;
  gateOutputSha256s: string[];
  transitionEvidence: ManifestTransitionEvidenceRefV2[];
  committedAt: string;
};

type ReleaseRootTerminalAbandonedV2 = {
  version: "release-root-terminal-abandoned-v2";
  releaseGenerationId: string;
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  failedTransitionId: ManifestTransitionId;
  transitionKeySha256: string;
  terminalReason:
    | "incompatible_durable_state" | "security_identity_failure"
    | "terminal_lifecycle_protocol_failure";
  lastTrustedManifestSha256: string | null;
  observedAt: string;
};
```

Strict production-operation capability invariants:

- rollout/canary/rollback claim, normal takeover, step/orchestration receipts
  and settlement are `effect_capable`; recovery equivalents are
  `recovery_only`. Kind/capability mismatch is invalid. Recovery accepts only
  abandoned-lineage validation and failure-evidence steps, performs zero prior
  production effects and cannot emit normal G14/G15 success evidence. A
  `cleanup_only` lease cannot parse as any claim/settlement/evidence producer;
- `CleanupOnlyProductionOperationTakeoverV2` is the sole cleanup-only claim.
  Its canonical lease preserves every operation/root/generation/candidate/
  source/nullable-consumption/deadline field from the old lease, changes only
  PID/start, heartbeat/lease expiry, epoch+1 and capability, and never changes
  external authority validity;
- cleanup-only terminal abandonment requires non-null
  `cleanupOnlyTakeoverSha256`, matching capability/reason/current lease hash and
  epoch. Effect-capable/recovery-only abandonment requires it to be null;
- cleanup-only removal prepare/receipt/cleanup all carry
  `capability="cleanup_only"`, reference that exact abandonment and cleanup
  takeover chain, and cannot reference a settlement or gate evidence;
- `authority_expired_*` requires the matching `now >= authority.expiresAt`;
  `operation_deadline_reached` requires `now >= operationDeadlineAt` while
  authority remains valid. Equality is terminal and neither bound is renewed.

Strict freeze/authority producer invariants:

- `captureTask0BPreflight.ts` records verified inputs only and cannot create or
  impersonate `ReleaseFreezeIdentityV2`. The sole producer is
  `release:freeze:materialize`, which consumes exact verified Task 0B evidence,
  first acquires `BootstrapRootWriterLeaseV2` bound to protected root, Task 0B
  preflight hash, candidate/runtime identity and owner/epoch but explicitly to
  no generation/freeze. It then fsyncs
  `PreparedReleaseFreezeMaterializationV2`, precommitting canonical freeze and
  receipt bytes/hashes/timestamps, and publishes each once with `O_EXCL`.
  A dead-owner bootstrap takeover may resume byte-exact publication only when
  that exact prepare exists. If the owner died before prepare, takeover writes
  `BootstrapRootTerminalAbandonedV2`, removes only its exact owned bootstrap
  lease, seals the root and requires a new protected root; it never invents a
  generation/freeze or reuses that root;
- `release:authority:issue` is the sole `OperationalAttestationV2` producer.
  Before publication it fsyncs one content-addressed
  `PreparedOperationalAttestationIssuanceV2` that precommits the canonical
  attestation and issuer-receipt objects, UTF-8 bytes, hashes, relative paths
  and their single shared timestamp. It then creates the attestation and receipt
  in that order with `O_EXCL`, then writes the committed marker; replay after
  prepare, attestation, receipt or before the marker uses only the prepared
  bytes and never rereads the clock or derives a second tip. Attestations,
  prepared issuances, issuer receipts and committed markers are
  append-only/content-addressed; no fixed transition+generation filename is
  overwritten. Exact byte replay is idempotent and conflicting existing bytes
  fail closed. Before creating a new prepare, the issuer resumes one exact
  unresolved compatible prepare; multiple/conflicting prepares fail closed.
  The committed marker binds an `issuanceIntentSha256` projection over the
  canonical attestation/receipt bytes, paths and lineage; that projection
  excludes prepare/marker hashes, so no hash cycle exists.
  Old consumed/expired authority remains immutable audit evidence;
- for each action+generation, issuer receipts form one sequence/previous-hash
  chain. The selector validates all actual bytes and chooses exactly one active,
  compatible, unconsumed tip. A branch, gap, multiple active attestations,
  swapped source/freeze/root/candidate/command, or missing receipt fails closed;
- bootstrap freeze materialization uses the discriminated bootstrap lease/
  takeover/terminal types above. After successful freeze publication, manifest
  materializer removes its exact fixed root-writer lease before reporting
  success; the same absence is mandatory after prepared-freeze takeover resume.
  A remaining or foreign lease makes materialization incomplete. Subsequent
  transition, authority issue and authority terminalization use only
  `FrozenRootWriterLeaseV2` under the same fixed root-writer lease/CAS path for
  their whole prepare/publish/commit sequence. Typed operation key and epoch
  fence competing writers; bootstrap artifacts can never parse as frozen
  identity-bound authority, and no separate authority lock is valid;
- a fresh recovery attestation may follow consumed/expired authority only after
  the exact prior operation has durable terminal settlement+cleanup or terminal-
  abandonment+cleanup lineage. An authority that expired before any claim may
  instead be closed only by the allowlisted authority terminalizer. Under the
  same root-writer lease it fsyncs `PreparedAuthorityTerminalV2`, precommitting
  the canonical `AuthorityTerminalReceiptV2` bytes/hash/time, then publishes
  those exact receipt bytes with `O_EXCL`. This is legal only after validating
  the exact issuer receipt/attestation/root/generation/transition bytes,
  `now >= expiresAt`, and absence of every preclaim/claim, consumption, action
  lease, G13 bound DB session/advisory lock, operation and external-effect
  artifact. Early terminalization or any such artifact fails closed. The new
  authority binds that committed terminal receipt hash as
  `priorTerminalLineageSha256`.
  `previousAttestationSha256` and `priorTerminalLineageSha256` are mandatory for
  every recovery; issuance never overwrites or revives the prior authority.

Strict V2 invariants:

- `candidateSha` всегда вычисляется как current clean `HEAD`; CLI не принимает
  SHA, gate id или evidence path от оператора;
- первый переход принимает только source token `absent`; каждый следующий —
  exact lowercase SHA-256 текущих manifest bytes;
- `revision` начинается с `1` и увеличивается ровно на один;
  `previousManifestSha256` равен source bytes hash;
- manifest chain binds immutable `release-freeze-identity-v2.json`; candidate,
  root, production DB, pinned tools, previous-runtime discovery or rollback
  worktree mismatch invalidates the chain and requires a new root;
- the freeze establishes exactly one `releaseGenerationId` for the protected
  root. Every post-freeze claim, frozen root-writer lease, production lease and
  operational attestation must use it. Only the pre-freeze bootstrap lease has
  `releaseGenerationId=null` and `releaseFreezeIdentitySha256=null`; it cannot
  survive successful materialization. A second generation is never selected or
  created in-place;
- each external G12-G15 or actual-rollback action also binds a fresh
  action-specific attestation using the root's one frozen generation. The sole
  issuer appends it at the content-addressed allowlisted path below and appends
  its previous-hash receipt; no transition+generation singleton is overwritten.
  The selector validates the complete linear issuer chain and returns exactly
  one compatible active unconsumed tip before production-lease acquisition.
  The immutable preclaim is then created only while holding the original
  production lease and permanently binds that original lease hash/epoch/owner
  and operation id; takeover never rewrites or replaces it. The exclusive claim
  under either that original lease or the exact current tip of its linear
  committed takeover chain is the atomic consumption point. Consumption and
  claim both bind the actual `ProductionPreclaimLeaseLineageV2` relative path,
  bytes hash and current-tip lease hash. Lineage artifacts are append-only per
  tip. The first lineage has `previousLineageSha256=null`, an empty committed-
  takeover suffix and one fixed `lineageStartedAt`. After each new committed
  takeover, the owner creates `L_(n+1)` at the new-tip path, references `L_n`,
  inherits unchanged `lineageStartedAt`, and contains exactly the one newly
  committed takeover receipt as its suffix. It chooses that extension's
  `resolvedAt` once, canonicalizes it, then creates and fsyncs it with `O_EXCL` at exact
  `production-preclaim-lease-lineages/<operationId>/<currentTipLeaseSha256>.json`.
  Crash after lineage publication but before claim reopens those exact bytes and
  never rereads the clock or regenerates `resolvedAt`. The validator proves
  trusted-root containment and exact path grammar, hashes actual bytes, checks
  the immutable original preclaim and resolves the original lease plus every actual
  lineage artifact and one-receipt suffix byte-for-byte back to the first,
  requires each previous hash/current tip to link exactly to the next old/new
  lease, preserves one `lineageStartedAt`, and rejects a
  branch, gap, swapped/foreign receipt or current lease not equal to the final
  tip. Replay for an existing tip reuses its bytes; an old lineage remains
  immutable audit history but is not current after a later takeover. A foreign
  path, swapped bytes/hash/preclaim/tip, branch/gap or conflicting extension
  fails closed. The claim durably binds attestation bytes to operation id, root,
  generation, candidate, source manifest, command/template and resolved lease
  lineage. No preclaim may exist outside original production-lease ownership,
  it is never rebound after takeover, and no path may describe authority as
  consumed before the claim exists;
- a consumed attestation authorizes only its one bounded operation and is not a
  perpetual capability. Immediately before every external effect, query and
  success/failure settlement, every current owner revalidates the exact durable
  consumed-authority record, action ownership and strict
  `now < consumedAuthority.expiresAt`. G12 additionally holds its backup lease;
  G13 holds its bound DB session/advisory lock. Neither carries
  `operationDeadlineAt`. G14/G15/actual rollback/recovery use `ProductionOperationV2`;
  immediately before every effect, query, crash-reconciliation and settlement
  they additionally require current operation id/lease hash/epoch and strict
  `now < immutable operationDeadlineAt`. Equality at either applicable bound
  fails closed. Therefore each policy requires enough remaining validity before
  claim for its maximum operation duration plus settlement margin (G15: more
  than 30 minutes plus margin). Normal effect-capable takeover requires both
  bounds still strict. Every takeover preserves the original consumption and
  immutable deadline and never consumes the same or a replacement attestation;
  it cannot revive expired authority or extend the operation deadline. After a
  bound, only a distinct cleanup-only takeover may acquire `cleanup_only`
  capability, which cannot perform any effect/query/reconciliation/settlement,
  evidence/gate/manifest or rollback action. If either bound is reached after a leaf effect was
  started, even read-only reconciliation, retry and settlement are blocked;
  the durable intent/partial receipts remain audit evidence. After cleanup-only
  terminal abandonment/removal/cleanup, a separately authorized
  `production_recovery` operation may only bind that lineage plus the exact
  immutable completed-step prefix and uncertain-step marker into the typed
  recovery branch of `ProductionFailureEvidenceV2`, advance `production_failed`
  and enable a fresh-authority rollback. Its `recovery_only` capability forbids
  every prior rollout/canary effect and cannot derive normal gate success
  evidence; uncertain effects are never replayed. Clock anomaly/overrun fails
  closed under this terminal recovery policy;
- pre-manual/readiness transitions bind only the chain-stable freeze identity
  and their immutable gate evidence;
- pending gate не содержит фиктивных command/timestamp/exit/output полей;
- passed/failed gate contains execution fields; blocked gate contains no
  invented execution fields and binds only `blockedByGateId` plus the exact
  typed production-failure evidence;
- `outputSha256` считается по actual immutable gate-output bytes; каждый
  evidence hash повторно считается по actual regular file opened through the
  portable component/containment/identity protocol below;
- singleton `migrationEvidenceSha256`/`rollbackEvidenceSha256` из V1 не
  используются: G07 offline, G13 production migration, G10 rehearsal и actual
  production rollback имеют разные typed refs;
- gate evidence and transition evidence are separate policies. Only
  `production_failed` carries the exact production-failure transition ref;
  only `rollback_rolled_back` additionally carries the exact actual-rollback
  ref and matching discriminated `actualRollback.outcome`;
- recursive secret scan применяется к manifest, receipts, gate outputs и всем
  parsed evidence; raw secrets/actor ids не сохраняются;
- `release:verify` не меняет ни одного байта; единственный writer —
  `release:manifest:advance`.

Exact lifecycle filenames:

```text
artifact-root-trust-boundary-evidence-v1.json
trusted-os-principal-policy-v2.json
release-freeze-materialization-prepared-v2.json
release-freeze-materialization-receipt-v2.json
release-freeze-identity-v2.json
operational-attestation-issuance-prepared/<transition>/<generation>/<issuerReceiptSha256>.json
operational-attestations/<transition>/<generation>/<attestationSha256>.json
operational-attestation-issuer-receipts/<transition>/<generation>/<receiptSha256>.json
operational-attestation-issuance-committed/<transition>/<generation>/<issuerReceiptSha256>.json
authority-terminal-prepared/<transition>/<generation>/<attestationSha256>.json
authority-terminal-receipts/<transition>/<generation>/<terminalReceiptSha256>.json
manifest-transition-claim-<transitionKeySha256>.json
manifest-transition-root.lease.json
manifest-transition-root.bootstrap-takeover-prepared-<oldLeaseSha256>.json
manifest-transition-root.bootstrap-takeover-receipt-<receiptSha256>.json
bootstrap-root-terminal-abandoned-v2.json
manifest-transition-root.frozen-takeover-prepared-<oldLeaseSha256>.json
manifest-transition-root.lease-tombstone-<oldLeaseSha256>.json
manifest-transition-root.frozen-takeover-receipt-<receiptSha256>.json
manifest-transition-prepared-<transitionKeySha256>.json
manifest-snapshots/release-manifest-r<revision>-<sha256>.json
manifest-transition-receipt-<receiptSha256>.json
release-root-terminal-abandoned.json
release-manifest.json
production-authority-preclaim-<operationId>.json
production-preclaim-lease-lineages/<operationId>/<currentTipLeaseSha256>.json
production-operation-claim-<operationalAttestationSha256>.json
production-operation-root.lease.json
production-operation-root.lease-takeover-prepared-<oldLeaseSha256>.json
production-operation-root.lease-tombstone-<oldLeaseSha256>.json
production-operation-root.lease-takeover-committed-<committedSha256>.json
production-operation-root.lease-cleanup-only-prepared-<oldLeaseSha256>.json
production-operation-root.lease-cleanup-only-committed-<committedSha256>.json
production-operation-step-intents/<operationId>/<sequence>-<stepId>-<attempt>-v2.json
production-operation-steps/<operationId>/<sequence>-<stepId>-v2.json
production-recovery-input-v2.json
production-recovery-orchestration-receipt-v2.json
production-operation-settlement-<operationId>.json
production-operation-lease-removal-prepared-<operationId>.json
production-operation-lease-removal-<operationId>.json
production-operation-terminal-cleanup-<operationId>.json
production-operation-terminal-abandoned-<operationId>.json
```

`manifest-transition-root.lease.json` is the only writer lock/CAS store for the
root. Manifest transition, first freeze materialization, authority issuance and
authority terminalization all acquire this same fixed lease with a typed
`writerOperationKind`/key; no second authority/freeze lock is allowed.
Transition-keyed lease filenames/locks are invalid even for different target
revisions, transitions or writer operations. Freeze creation alone uses null
generation/freeze identity fields in `BootstrapRootWriterLeaseV2`; every later writer uses
the non-null identity-bound `FrozenRootWriterLeaseV2`. Bootstrap and frozen
takeover/terminal artifacts are discriminated and never interchangeable. The
common old-hash/epoch fencing serializes crash recovery, but dead bootstrap
without exact prepared freeze seals the root instead of inventing identity.

`production-operation-root.lease.json` is a distinct fixed root-wide lock for
all rollout/canary/rollback/recovery operations. It never authorizes manifest writes and
the manifest lease never authorizes production effects. A production operation
must be terminally settled and its owned lease removed before the manifest
writer can consume its evidence. The exact terminal order is settlement fsync,
fsynced canonical removal prepare, exact owned-current-lease removal, fsynced
byte-exact removal receipt materialized from prepared bytes, then cleanup fsync
binding prepare and receipt. Rollout, canary, rollback and recovery can never hold
parallel production-operation leases, even with different operation ids.
Cross-protocol exclusion is fail-closed: an orchestrator proves the manifest
lease absent, acquires the production lease, then proves the manifest lease
still absent before lease-bound preclaim/claim; the manifest writer acquires its lease first, then
requires the production lease absent before evidence validation and again
before replace. Thus neither lease is held while acquiring the other and no
production operation can enter the absence-check/replace window.

The filesystem threat model is deliberately narrow and executable. The
protected artifact root and every mutable ancestor are pre-created local NTFS
or POSIX paths. Windows ACL validation uses exactly one allowlisted
`TrustedOsPrincipalPolicyV2`: the service account, LocalSystem and BUILTIN
Administrators, or one canonical configured trusted set whose normalized hash
is frozen. POSIX uses the owner-only policy. The preflight stores only policy id/
hash, normalized ACL-or-mode hash, owner hash and
`untrustedWriteGrantPresent=false`; it never stores raw ACL/principal names or
secrets. Writable Everyone, Users or any foreign principal ACE fails closed.
Queries are allowlisted/redacted, and an unsupported filesystem or ACL identity
also fails closed. Concurrent path mutation by the same trusted principal is a
forbidden operational condition, checked by Task 0B preflight;
an undetectable malicious same-principal parent-junction race is outside the
threat model and is not claimed preventable by pure Node.js.

Within that boundary, every read/create/replace `lstat`s components, rejects
pre-existing or detectable symlink/junction/reparse points, proves canonical
realpath containment, and compares available pre/post `fstat` type/identity.
POSIX may additionally use `O_NOFOLLOW` when supported. A detectable change or
platform inability to establish the required identity fails closed. Frozen
tests cover pre-existing links/reparse points and detectable substitution; they
do not assert impossible protection against a malicious same-principal
undetectable Windows parent race.

The identical trust-boundary, component-identity, no-overwrite tombstone and
PID/start ownership rules apply independently to manifest-lease and production-
operation-lease takeover. Neither protocol may infer ownership from a matching
operation id alone.

`committedAt` is injected and fixed before prepare. The canonical exact
`CommittedManifestTransitionReceiptV2` object is serialized once; both that
object and its exact UTF-8 bytes are stored in the prepared record, and its hash
is placed in the target manifest `latestCommittedReceiptSha256` before the
prepared record is written/fsynced. To avoid a circular hash, the receipt binds
`targetManifestProjectionSha256`, calculated from canonical target V2 with
`latestCommittedReceiptSha256` omitted. The receipt file itself is created only
after atomic manifest replace. After a crash, it is restored byte-for-byte only
from the prepared canonical bytes; time, reducer and serializer are not rerun.
The verifier recomputes canonical object↔bytes equality, projection, receipt
hash, typed transition refs and full manifest hash.

State derivation and sole legal order:

```text
absent
  -> pre_manual      : G00-04,G06-11 passed; G05,G12-15 pending; not_ready
  -> readiness       : G00-11 passed; G12-15 pending; ready_for_release
  -> g12_backup_passed    : G00-12 passed; G13-15 pending; not_ready
  -> g13_migration_passed : G00-13 passed; G14-15 pending; not_ready
  -> g14_rollout_passed   : G00-14 passed; G15 pending; not_ready
  -> g15_canary_released  : G00-15 passed; released
```

From a production-phase source, `production_failed` marks the exact failed
gate and all later gates `blocked`; blocked records name that gate and share its
exact typed transition failure ref. `rollback_rolled_back` then binds both that
failure ref and one exact `actual_rollback_evidence` transition ref whose
validated payload outcome equals manifest `actualRollback.outcome`:

```ts
type ProductionRollbackOutcomeV2 =
  | { kind: "previous_runtime_retained";
      failedGateId: "G13_PRODUCTION_MIGRATION" | "G14_PRODUCTION_ROLLOUT";
      previousRuntimeHealthEvidenceSha256: string;
      noPreviousStopEvidenceSha256: string;
      noCandidateStartEvidenceSha256: string }
  | { kind: "previous_runtime_restarted_without_candidate";
      failedGateId: "G14_PRODUCTION_ROLLOUT";
      previousStopEvidenceSha256: string;
      noCandidateStartEvidenceSha256: string;
      previousStartEvidenceSha256: string }
  | { kind: "candidate_replaced_with_previous";
      failedGateId: "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY";
      candidateStartEvidenceSha256: string;
      candidateStopEvidenceSha256: string;
      previousStartEvidenceSha256: string };
```

G13 failure, or G14 failure before `stop_previous`, uses
`previous_runtime_retained` and must not invent stop/start captures. G14
pre-effect failure is legal only after fresh authority was atomically consumed
by the operation claim and `verify_g13`/schema/runtime-identity/singleton
validation produced an exact typed failure with
`attemptedExternalEffect:false`. It may transition to `production_failed`,
then a distinct rollback operation consumes fresh rollback authority and emits
`previous_runtime_retained` from health/no-stop/no-candidate-start evidence.
The G14 failure/rollback route never reuses rollout authority.
G14
failure after previous stop but before candidate start uses
`previous_runtime_restarted_without_candidate`; it proves that candidate never
started and records only previous stop/restart captures. A failed
`start_candidate` command without confirmed candidate process/start evidence
remains in this branch. Only confirmed candidate-start evidence permits G14/G15
`candidate_replaced_with_previous`, which records candidate start/stop followed
by previous start. G10 rehearsal can
never satisfy any production outcome. A failed pre-release gate stays
`not_ready`, does not skip forward, and requires a new candidate/evidence root.

Within one protected root, only the freeze's single release generation exists.
An interrupted operation may resume only that same operation/generation from
an exact durable claim + prepared payload or committed receipt whose hashes and
identities all match. When its owner is dead and the lease expired, resume also
requires the explicit hash-addressed takeover protocol and current epoch fence;
PID/start ownership is never inferred or inherited. Any incompatible durable state, terminal operation error
in the lifecycle/store/authority protocol, or filesystem/security identity
failure writes/fsyncs
`release-root-terminal-abandoned.json` and seals the root. A sealed root rejects
all reads-as-authority, transitions and generation attempts. Retry is a manual
new protected root with a new freeze/release generation and candidate process;
old mutable state is never auto-copied or auto-repaired.
An expected production gate failure with valid typed evidence is not a store
protocol failure: it follows the legal `production_failed` → actual rollback
path in the same generation. It cannot be used to bypass a genuinely sealed
root.

Address Poisoning closeout remains separate `APC-01` after
`released|rolled_back` and never changes V2 manifest.

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
    kind: "behavioral_assertion" | "local_product_module_absent";
    baseSha: string;
    testCommitSha: string;
    redExecutionCommitSha: string;
    testPatchSha256: string;
    vitestReportSha256: string;
    expectedFailureFingerprint: string;
    missingProductModulePath?: string;
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

- exactly 41 RED/GREEN traces, one `primary=true` trace for each
  `AC-01…AC-41`; no non-primary RED/GREEN trace is permitted;
- every `fullName` starts with its own `[AC-XX]` token and is unique inside the
  required suite;
- owner commit is an ancestor of candidate and names the owner-plan change;
- RED comes from the original frozen test-only commit, or from an exact
  test-only patch replayed on the recorded owner base in an ephemeral worktree;
- RED is valid for the expected behavioral assertion. Corrective closed
  allowlists permit AC-07/08/09/12/13/27/39 to use discriminated
  `local_product_module_absent` only for a zero-execution file-load failure on
  exact frozen Plan 4, and permit exactly the 17 Plan 2 primary traces
  AC-03/04/05/06/19/22/23/25/26/28/29/30/31/32/33/36/37 to use assertion-bound
  local absence on frozen commit `01a29fef…`. A Plan 2 record requires its exact
  test `fullName`, exactly one `src/*` absence line, exact test patch, owner
  `83f0cb96…`, candidate binding, test/owner/candidate ancestry, absence at test
  commit and presence at owner plus candidate. AC-29/30 preserve other
  behavioral messages without reclassifying them. Generic import, no-test,
  dependency, type, fixture, environment, foreign importer, multiple absence
  messages or synthetic failure is rejected;
- the separate `[AC-33][LLM-DAMPENING]` regression is the only mandatory
  `candidate_green_only` auxiliary record. It is not another AC, adds no RED
  coverage and cannot replace primary AC-33 RED. It binds exact fullName, test
  commit `db5d49a9…`, test patch SHA-256 `ae069e6d…`, owner `83f0cb96…`, final
  candidate and the complete candidate GREEN Vitest report SHA-256;
- the auxiliary report SHA-256 equals the primary AC-33 full Plan 2 GREEN
  report SHA-256; it is the only permitted secondary record;
- GREEN is read from Vitest JSON/JUnit and must contain the exact file/fullName
  with state `passed`; missing, skipped, todo, duplicate or filtered-out tests
  fail closed;
- source search may lint IDs, but cannot create trace evidence.

Plan 3 RED evidence sets `REQUIRE_PLAN3_POSTGRES=1` and binds
`PLAN3_TEST_DATABASE_URL` plus `TEST_DATABASE_URL` to exact disposable
`tron_watch_plan3`; AC-14/15 must execute rather than appear skipped. The RED
runner verifies the loopback publish binding, pinned running PostgreSQL
container/image and live database/system identity before creating the frozen
test-only login, and proves that login removed afterward. Authentication,
connection, transport, identity and cleanup failures are invalid RED evidence.
Container ID
`fbb25bec0cfa79a35efddb287f3ae9ba1921fb645558b0b48dfce8b45d60d39e`,
container name `/plan5-release-pg-f97549bc`, and system identifier
`7664744009044738089` are exact pins. Plan 3 failed executions must match the
positive frozen behavioral allowlist; AC-14/15 require the exact
`reconcileWaitingForensicCheckJobs` message and stack location. RED runs filter
to `[AC-NN]` tests. Fresh cleanup revalidates the database, disables and
terminates the frozen role, removes only that role's disposable objects, drops
the role, and verifies absence. Local-module assertion reports reconcile
aggregate counts exactly, reject suite-level failure messages, and accept
companions only for the exact frozen AC-29/30 `AssertionError` multiset. Every
approved behavioral failure binds SHA-256 of its complete normalized Vitest
message bytes, not only its first line; normalization removes only absolute
runtime and snapshot path roots.

AC-20/21/24 remain behavioral: their exact original test patch is frozen at
`20ee8a75…`, and their RED execution commit is `a0f74b3b…`, where local product
modules load and the three exact assertions fail for behavior. Validators bind
test commit → RED execution commit → owner commit → candidate; they never route
these ACs through `local_product_module_absent`.

The exact Plan 4 test-patch SHA-256 pins are alerts
`544fc122c2012bb27452659a795dadbbadcedc4930d54194442558d85737e2b2`,
renderer
`c9a755269b1e3935bf8c6d71797e17493a57d4e55e6aa26b63c63c36494118e5`,
and PostgreSQL coverage
`27aa2e5102bee4d1cbba5009f70c2cd2719ceab35c46e4764ab89a0c422ee771`.
Exact kind, file, base, test commit, RED execution commit and local missing path
are pinned with the applicable hash.

The exact Plan 2 test-patch SHA-256 pins are USDD
`51f0f59bacf095a8bba8620e9236064fcaec503205c2ebf295907009dbe89c93`,
approval
`af99e8ed72dc377166dd8b88e58ba5a885eb73a0bf7784cf961478357a49210b`,
contract decision
`57057592adcd5c0eaf340398a815cec92d9d945905c44101c62bb335c427c238`,
and contract LLM isolation
`56efcdd404eebdaca3bce66e23639a2fe04f31bcb6808ff5cb0ecd6b6eec0c98`.

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

Production G13 additionally requires exact fixed file
`schema032-production-execution-receipt-v2.json`:

```ts
type Schema032Stage =
  | "first_migration" | "first_verification"
  | "second_migration" | "final_verification";

type Schema032CompletedStageV2<S extends Schema032Stage> = {
  step: S;
  receiptSha256: string;
};

type Schema032ProductionExecutionReceiptCommonV2 = {
  version: "schema-032-production-execution-receipt-v2";
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  operationalAttestationSha256: string;
  authorityConsumptionSha256: string;
  sourceManifestSha256: string;
  g12TransitionReceiptSha256: string;
  productionBackupEvidenceSha256: string;
  advisoryLockKey: 320032500;
  databaseSessionIdentitySha256: string;
  lockAcquiredAt: string;
  lockReleasedAt: string;
  migrationBytesChecksumSha256: string;
};

type Schema032ProductionExecutionSuccessV2 =
  Schema032ProductionExecutionReceiptCommonV2 & {
    result: "applied_and_verified";
    completedStages: [
      Schema032CompletedStageV2<"first_migration">,
      Schema032CompletedStageV2<"first_verification">,
      Schema032CompletedStageV2<"second_migration">,
      Schema032CompletedStageV2<"final_verification">
    ];
    receiptChecksumSha256: string;
    postconditionsSha256: string;
  };

type Schema032StageFailureArtifactPath<S extends Schema032Stage> =
  S extends "first_migration"
    ? "schema032-failures/first-migration-failure-v2.json"
    : S extends "first_verification"
      ? "schema032-failures/first-verification-failure-v2.json"
      : S extends "second_migration"
        ? "schema032-failures/second-migration-failure-v2.json"
        : "schema032-failures/final-verification-failure-v2.json";

type Schema032StageFailureArtifactV2<S extends Schema032Stage> = {
  kind: "schema032_stage_failure";
  failedStep: S;
  relativePath: Schema032StageFailureArtifactPath<S>;
  evidenceSha256: string;
};

type Schema032ProductionExecutionFailureV2 =
  Schema032ProductionExecutionReceiptCommonV2 & (
    | { result: "failed_after_attempt"; failedStep: "first_migration";
        completedStages: [];
        failureArtifact: Schema032StageFailureArtifactV2<"first_migration"> }
    | { result: "failed_after_attempt"; failedStep: "first_verification";
        completedStages: [Schema032CompletedStageV2<"first_migration">];
        failureArtifact: Schema032StageFailureArtifactV2<"first_verification"> }
    | { result: "failed_after_attempt"; failedStep: "second_migration";
        completedStages: [
          Schema032CompletedStageV2<"first_migration">,
          Schema032CompletedStageV2<"first_verification">
        ];
        failureArtifact: Schema032StageFailureArtifactV2<"second_migration"> }
    | { result: "failed_after_attempt"; failedStep: "final_verification";
        completedStages: [
          Schema032CompletedStageV2<"first_migration">,
          Schema032CompletedStageV2<"first_verification">,
          Schema032CompletedStageV2<"second_migration">
        ];
        failureArtifact: Schema032StageFailureArtifactV2<"final_verification"> }
  );

type Schema032ProductionExecutionReceiptV2 =
  | Schema032ProductionExecutionSuccessV2
  | Schema032ProductionExecutionFailureV2;
```

The schema producer writes/fsyncs this receipt after advisory-lock release. A
missing session identity, invalid lock interval, unreleased lock or checksum
mismatch cannot pass G13. Success requires all four ordered stage receipts.
Failure contains only stages completed before `failedStep`; omitted stages have
no fields or invented hashes. `failureArtifact.failedStep` must equal the union
branch, and `relativePath` must be the matching exact entry below:

| `failedStep` | Exact relative path |
|---|---|
| `first_migration` | `schema032-failures/first-migration-failure-v2.json` |
| `first_verification` | `schema032-failures/first-verification-failure-v2.json` |
| `second_migration` | `schema032-failures/second-migration-failure-v2.json` |
| `final_verification` | `schema032-failures/final-verification-failure-v2.json` |

The validator resolves only that regular non-symlink file under the protected
root, hashes its actual bytes and rejects missing, foreign, traversal or
step/path-swapped artifacts. The validated bytes supply the typed input for
`ProductionFailureEvidenceV2`.

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

### 2.7 Rollout, canary, failure and rollback evidence

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

Fresh production evidence uses these exact primary filenames and schemas:

```text
production-rollout-manager-captures-v2.json
production-rollout-query-captures-v2.json
production-rollout-orchestration-receipt-v2.json
production-rollout-evidence-v2.json            ProductionRolloutEvidenceV2
production-canary-query-captures-v2.json
production-canary-log-captures-v2.json
production-canary-orchestration-receipt-v2.json
production-canary-evidence-v2.json             ProductionCanaryEvidenceV2
production-failure-evidence-v2.json            ProductionFailureEvidenceV2
production-recovery-orchestration-receipt-v2.json
production-rollback-manager-captures-v2.json
production-rollback-query-captures-v2.json
production-rollback-orchestration-receipt-v2.json
production-operation-step-intents/<operationId>/<sequence>-<stepId>-<attempt>-v2.json
production-operation-steps/<operationId>/<sequence>-<stepId>-v2.json
production-rollback-evidence-v2.json           ProductionRollbackEvidenceV2
```

The production-operation ownership protocol is independent from manifest CAS:

The lease heartbeat interval is at most 10 seconds and rolling lease expiry is
at most 60 seconds. Hard operation deadlines from claim are exactly 10 minutes
for rollout, 35 minutes for canary (30-minute observation bound plus 5-minute
settlement margin), 15 minutes for rollback and 5 minutes for recovery. The
lease-owned preclaim requires
`attestation.expiresAt >= operationDeadlineAt`; equality is acceptable only
because every leaf additionally requires both strict
`now < consumedAuthority.expiresAt` and strict
`now < immutable operationDeadlineAt`.

1. derive the deterministic `operationId` from operation kind, candidate,
   source manifest, root, generation, command/template and attestation hash;
   validate the exact attestation as compatible, fresh, sufficiently long-lived
   and `unconsumed`, but persist no preclaim yet;
2. acquire `production-operation-root.lease.json` with `O_EXCL`, epoch `1` and
   the same operation/runtime/authority bindings. While holding that exact
   original lease, persist one immutable
   `ProductionAuthorityPreclaimValidationV2` bound to its actual hash, epoch,
   owner and `operationId`, revalidate authority plus lease, and atomically
   create the attestation-hash-addressed
   `ProductionOperationClaimV2`; that one exclusive create is consumption.
   If a crash caused takeover after preclaim but before claim, the preclaim
   remains byte-identical and the claimant first append-only extends
   `ProductionPreclaimLeaseLineageV2` at the exact current-tip-addressed path.
   The first artifact has null previous hash and empty suffix; every later tip
   references the prior lineage hash, inherits its `lineageStartedAt`, and adds
   exactly the new committed takeover receipt. Its `resolvedAt` is chosen once before
   publication. Crash after lineage write but before claim reuses the exact
   file bytes/path/hash without a new clock read. If its owner then dies and a
   later takeover commits, the next owner appends a new-tip extension that
   references the prior lineage; it never treats the older tip artifact as
   current. The embedded canonical
   `OperationalAttestationConsumptionV2` and outer claim both bind the lineage
   relative path, bytes hash and current-tip lease hash. Trusted-root/path,
   original-preclaim, actual-byte/hash, chain and tip mismatch fails closed.
   There is no replacement
   preclaim after takeover, no preclaim outside its original owned lease state
   and no consumed state before this claim. Crash after lease acquisition or
   preclaim creation resumes only through that same live lease or its exact
   fenced linear takeover chain; a branch, gap, swapped/foreign receipt or
   orphan preclaim fails closed;
3. immediately before every leaf effect, query, crash-reconciliation read and
   final settlement, re-open actual claim/lease bytes and require exact
   operation id, authority-consumption hash, current lease hash/epoch,
   PID/start owner, `now < consumedAuthority.expiresAt` and
   `now < immutable operationDeadlineAt`. Equality or passage of either bound
   fails closed. Before every external effect, canonicalize and `O_EXCL` create/
   fsync one `ProductionOrchestrationStepIntentV2` at the exact allowlisted
   operation/sequence/step/attempt path. Its actual bytes/hash bind operation,
   step, attempt, current lease hash/epoch, authority consumption, command/
   template, inputs and intended effect. `attempt` is exactly `1`; a second
   intent or retry for the same operation/sequence/step is forbidden, even
   after takeover or crash. The external effect is forbidden until that exact
   intent is durable. Its step receipt must reference the actual
   intent path/hash. A completed step receipt whose actual bytes validate may
   be skipped idempotently; an intent without receipt is reconciled only while
   both bounds still hold and the fixed observer proves one exact post-state.
   If recovery begins after a bound, only that actual unresolved intent may
   become `UncertainProductionStepMarkerV2`; absence of a durable intent means
   no uncertain-effect claim, and no marker may be fabricated from logs or
   operator input;
4. an effect-capable dead-owner expired production lease is transferred only by explicit
   `release:production:lease:takeover` with exactly expected old lease SHA-256
   and protected artifact root positionals. It uses the same trusted-root protocol as
   manifest takeover: old-hash-addressed fsynced prepare, revalidation,
   no-overwrite content-addressed tombstone, `O_EXCL` canonical epoch+1 lease
   and fsynced committed takeover. Replay around prepare/tombstone/new lease/
   committed boundaries never inherits PID/start ownership. If replay installs
   a dead preparer's canonical lease, it remains fenced and must take over that
   current dead lease into another epoch. Its new lease preserves the original
   active `effect_capable` or `recovery_only` capability. This normal takeover is rejected when
   `now >= activeAuthority.expiresAt` (the selected authority before lease-owned
   preclaim/claim, or consumed authority after claim) or
   `now >= immutable operationDeadlineAt`, including exact equality;
5. takeover preserves `operationId`, the immutable original preclaim and the
   `authorityConsumptionSha256`, original `operationDeadlineAt` and authority
   expiry; it never re-consumes or replaces authority.
   Neither expiry nor deadline can be revived or extended by takeover; either
   reached bound forbids new effects, queries, reconciliation and settlement;
6. after either strict bound is reached, an expired dead-owner lease may be
   transferred only by the separate explicit
   `release:production:lease:cleanup-only-takeover` command. It validates the
   same trusted root, operation, generation, candidate, source, expected old
   lease hash/epoch and dead PID/start identity; fsyncs an old-hash-addressed
   `PreparedCleanupOnlyProductionOperationTakeoverV2`, performs the same
   no-overwrite tombstone and `O_EXCL` epoch+1 lease installation, and fsyncs
   `CleanupOnlyProductionOperationTakeoverV2`. It preserves the original
   nullable consumption, authority expiry and immutable deadline without
   renewal, replacement or re-consumption; its claim and lease are
   `capability: "cleanup_only"`. This capability permits only: fsync typed
   terminal abandonment with the matching `authority_expired_*` or
   `operation_deadline_reached` reason, fsync canonical removal prepare, remove
   that exact owned cleanup-only lease, publish the prepared byte-exact receipt,
   and fsync terminal cleanup. It forbids every external effect, domain query,
   reconciliation, success/failure settlement, gate/evidence derivation,
   manifest advancement and rollback action. Protected artifact reads needed
   only to validate/fence this cleanup protocol are not production queries;
7. after cleanup-only abandonment, removal and cleanup are durable, the sole
   `release:production:recovery:execute` command may consume fresh recovery
   authority under a new `recovery_only` lease-owned preclaim/claim. It validates
   exact abandoned/cleanup bytes, the contiguous completed receipt prefix and
   at most one next uncertain-step marker backed by an actual fsynced intent
   without receipt. Its four steps are local validation only, typed
   `RecoveryOnlyProductionOrchestrationStepReceiptV2`; they have
   `capability="recovery_only"`, `commandId="production_recovery"`, null intent
   refs and cannot execute rollout/canary/rollback effects or queries. It fsyncs
   `RecoveryOnlyProductionOrchestrationReceiptV2` after lineage/prefix/no-replay
   validation and before creating the typed `abandoned_operation_recovery`
   failure evidence, which references that receipt. Thus the receipt never
   references failure evidence and no hash cycle exists. Recovery settlement
   requires `recoveryAttemptedExternalEffect=false`; the prior operation's
   independent `priorAttemptedExternalEffect` may be true. Only then may the
   manifest writer advance `production_failed`; rollback requires another
   fresh authority;
8. after all exact effect-capable or recovery-only steps, the current owner revalidates authority/lease,
   fsyncs the discriminated orchestration receipt, derives typed pass/failure
   evidence that references that receipt,
   revalidates both strict time bounds again and fsyncs
   `ProductionOperationSettlementV2`. Only after that durable settlement may it
   choose the one fixed `removedAt`, canonicalize the complete
   `ProductionOperationLeaseRemovalReceiptV2`, and fsync
   `PreparedProductionOperationLeaseRemovalV2` containing that canonical object,
   exact UTF-8 bytes/hash, terminal settlement hash and exact current lease
   hash/epoch through `O_EXCL`; decoded bytes, embedded object and hash must be
   identical. Only then may it remove that exact owned current fixed lease. It
   materializes the removal receipt byte-for-byte from the prepared bytes with
   `O_EXCL` and no new clock read, then finally fsyncs `ProductionOperationTerminalCleanupV2`
   binding settlement, prepare and receipt. Claim, consumption, step, takeover,
   orchestration, settlement, removal-prepare, removal and cleanup artifacts
   remain immutable audit evidence. Manifest advance is allowed only after the
   exact settlement plus prepare plus removal receipt plus cleanup and absence
   of the fixed production lease.

Crash replay of this terminal sequence is byte-exact and idempotent: a durable
settlement without prepare creates/fsyncs the one canonical prepare before any
deletion; a valid prepare with the exact owned lease still present removes only
that lease and publishes its already-committed receipt bytes; a valid prepare
with that exact lease absent and no foreign current lease publishes those same
bytes without regenerating `removedAt`; an existing valid receipt is never
rewritten, and cleanup is written only after validating prepare and receipt.
A different current lease, settlement, prepare, receipt hash or epoch fails
closed.

Crash resume before claim may continue the same operation only if the
attestation remains fresh/unconsumed and any durable preclaim still matches its
immutable original lease hash/epoch/owner/operation. A crash after lease but
before preclaim creates it only under that same original lease. A crash after
preclaim resumes through that lease or a byte-validated linear chain of
committed takeovers from the original lease to the actual current tip; it never
rewrites the preclaim to the takeover lease. Consumption and claim bind the
resolved lineage relative path/hash/current tip. The lineage is durably
published with one fixed `resolvedAt` before claim; crash after that publication
replays the exact file and never regenerates time. Path-containment/grammar,
actual bytes/hash, original preclaim, branch/gap/swapped/foreign takeover bytes
or a foreign/orphan preclaim fail closed.
Otherwise it writes no claim/effect and records terminal abandonment before
removing only its owned lease. A dead
owner at or after either time bound must use only the cleanup-only takeover;
normal takeover remains rejected. Crash
resume after claim always uses the same consumption and takeover chain. If
either authority expiry or the immutable operation deadline is reached after
any started effect, the operation is fail-closed and cannot reconcile or
settle; it fsyncs terminal-abandoned audit state, removes only its exact owned
current lease only after fsyncing the canonical removal prepare, publishes the
prepared removal receipt bytes, then terminal cleanup, without manufacturing
gate evidence. If deadline alone caused abandonment while authority remained
valid, reason is exactly `operation_deadline_reached`. A new operation with
a different fresh `production_recovery` attestation may bind
`recoveryFromAbandonedOperationSha256` only after terminal cleanup; its
`recovery_only` capability validates immutable abandoned/cleanup and receipt-
prefix/uncertain-marker bytes and emits the typed failure route without
reconciliation or prior effect replay. It cannot adopt prior ownership. The old claim/consumption remains
immutable and can never be consumed again.

Cleanup-only crash replay is idempotent across prepare/tombstone/epoch+1 lease/
committed takeover, terminal abandonment, removal prepare, exact lease removal,
prepared receipt publication and cleanup. A stale old PID, effect-capable
re-entry, missing/mismatched binding or attempted forbidden action fails closed.
Successful cleanup leaves no live PID/process ownership and no fixed production
lease; immutable claim/takeover audit files remain. It cannot create evidence
eligible for any gate or manifest transition.

```ts
type ProductionRolloutStepIdV2 =
  | "verify_g13" | "verify_schema"
  | "verify_previous_runtime_identity" | "verify_singleton_precondition"
  | "stop_previous"
  | "prove_previous_stopped" | "start_candidate"
  | "prove_candidate_started" | "immediate_runtime_checks";

type ProductionCanaryStepIdV2 =
  | "verify_g14" | "observe_cycle_1"
  | "observe_cycle_2" | "bounded_runtime_checks";

type ProductionRollbackStepIdV2 =
  | "verify_failure" | "prove_previous_healthy"
  | "prove_no_previous_stop" | "prove_no_candidate_start"
  | "restart_previous" | "stop_candidate" | "start_previous"
  | "rollback_runtime_checks";

type ProductionRecoveryStepIdV2 =
  | "verify_abandoned_cleanup" | "verify_completed_prefix"
  | "verify_uncertain_step_intent" | "validate_failure_derivation_inputs";

type ProductionExternalEffectStepIdV2 =
  | "stop_previous" | "start_candidate"
  | "restart_previous" | "stop_candidate" | "start_previous";

type ProductionOrchestrationStepIntentV2 = {
  version: "production-orchestration-step-intent-v2";
  capability: "effect_capable";
  orchestration: "rollout" | "canary" | "rollback";
  operationId: string;
  operationClaimSha256: string;
  authorityConsumptionSha256: string;
  sequence: number;
  stepId: ProductionExternalEffectStepIdV2;
  attempt: 1;
  relativePath: string; // exact production-operation-step-intents/<operationId>/<sequence>-<stepId>-<attempt>-v2.json
  currentOperationLeaseSha256: string;
  currentOperationLeaseEpoch: number;
  commandId: "production_rollout" | "production_canary" | "production_rollback";
  redactedTemplateSha256: string;
  inputSha256: string;
  intendedExternalEffectSha256: string;
  preparedAt: string;
};

type ProductionOrchestrationStepReceiptCommonV2 = {
  version: "production-orchestration-step-receipt-v2";
  operationId: string;
  operationClaimSha256: string;
  authorityConsumptionSha256: string;
  operationLeaseSha256: string;
  operationLeaseEpoch: number;
  operationDeadlineAt: string;
  inputSha256: string;
  outputSha256: string;
  observedStateSha256: string;
  sequence: number;
  startedAt: string;
  finishedAt: string;
  recoveredAfterCrash: boolean;
  result: "completed";
};

type EffectCapableProductionOrchestrationStepReceiptV2 =
  ProductionOrchestrationStepReceiptCommonV2 & {
    capability: "effect_capable";
    commandId:
      | "production_rollout" | "production_canary" | "production_rollback";
    redactedTemplateSha256: string;
  } & (
    | { executionKind: "local_validation";
        stepIntentRelativePath: null;
        stepIntentSha256: null }
    | { executionKind: "external_effect";
        stepIntentRelativePath: string;
        stepIntentSha256: string }
  ) & (
    | { orchestration: "rollout"; stepId: ProductionRolloutStepIdV2 }
    | { orchestration: "canary"; stepId: ProductionCanaryStepIdV2 }
    | { orchestration: "rollback"; stepId: ProductionRollbackStepIdV2 }
  );

type RecoveryOnlyProductionOrchestrationStepReceiptV2 =
  ProductionOrchestrationStepReceiptCommonV2 & {
    capability: "recovery_only";
    orchestration: "recovery";
    stepId: ProductionRecoveryStepIdV2;
    executionKind: "local_validation";
    commandId: "production_recovery";
    redactedTemplateSha256: string;
    stepIntentRelativePath: null;
    stepIntentSha256: null;
    recoveredAfterCrash: false;
  };

type ProductionOrchestrationStepReceiptV2 =
  | EffectCapableProductionOrchestrationStepReceiptV2
  | RecoveryOnlyProductionOrchestrationStepReceiptV2;

type ProductionOrchestrationReceiptCommonV2 = {
  version: "production-orchestration-receipt-v2";
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  operationId: string;
  operationClaimSha256: string;
  finalOperationLeaseSha256: string;
  finalOperationLeaseEpoch: number;
  operationDeadlineAt: string;
  operationLeaseTakeoverChainSha256: string;
  operationalAttestationConsumptionSha256: string;
  redactedTemplateSha256: string;
  result: "completed";
};

type EffectCapableProductionOrchestrationReceiptV2 =
  ProductionOrchestrationReceiptCommonV2 & {
    orchestration: "rollout" | "canary" | "rollback";
    capability: "effect_capable";
    commandId:
      | "production_rollout" | "production_canary" | "production_rollback";
    recoveryInputSha256: null;
    completedStepReceipts: Array<{
      relativePath: string;
      sha256: string;
      receipt: EffectCapableProductionOrchestrationStepReceiptV2;
    }>;
  };

type RecoveryOnlyProductionOrchestrationReceiptV2 =
  ProductionOrchestrationReceiptCommonV2 & {
    orchestration: "recovery";
    capability: "recovery_only";
    commandId: "production_recovery";
    recoveryInputSha256: string;
    recoveryAttemptedExternalEffect: false;
    priorAttemptedExternalEffect: boolean;
    priorCompletedStepReceiptPrefixSha256: string;
    priorUncertainStepMarkerSha256: string | null;
    completedStepReceipts: Array<{
      relativePath: string;
      sha256: string;
      receipt: RecoveryOnlyProductionOrchestrationStepReceiptV2;
    }>;
  };

type ProductionOrchestrationReceiptV2 =
  | EffectCapableProductionOrchestrationReceiptV2
  | RecoveryOnlyProductionOrchestrationReceiptV2;

type ProductionRolloutEvidenceV2 = {
  version: "production-rollout-evidence-v2";
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  operationalAttestationConsumptionSha256: string;
  sourceManifestSha256: string;
  previousStopEvidenceSha256: string;
  candidateStartEvidenceSha256: string;
  managerCapturesSha256: string;
  queryCapturesSha256: string;
  orchestrationReceiptSha256: string;
  checks: Record<"schema" | "version" | "admin" | "singleton" | "workers" |
    "logs" | "delivery" | "legacy", true>;
  result: "passed";
};

type ProductionCanaryEvidenceV2 = {
  version: "production-canary-evidence-v2";
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  operationalAttestationConsumptionSha256: string;
  sourceManifestSha256: string;
  observationStartedAt: string;
  observationFinishedAt: string;
  completedPollingCycles: number;
  queryCapturesSha256: string;
  logCapturesSha256: string;
  orchestrationReceiptSha256: string;
  checks: Record<"schema" | "version" | "admin" | "singleton" |
    "reconciliation" | "delivery" | "navigation" | "allowance" | "legacy" |
    "secrets" | "queues" | "honest_limits", true>;
  result: "passed";
};

type UncertainProductionStepMarkerV2 = {
  sequence: number;
  stepId: ProductionExternalEffectStepIdV2;
  attempt: 1;
  stepIntentRelativePath: string;
  stepIntentSha256: string;
  externalEffectMayHaveStarted: true;
  observedOutcome: "unknown";
};

type ProductionRecoveryInputV2 = {
  version: "production-recovery-input-v2";
  priorOperationKind: "rollout" | "canary";
  priorOperationId: string;
  priorTerminalAbandonedSha256: string;
  priorTerminalCleanupSha256: string;
  completedStepReceiptPrefix: Array<{
    sequence: number;
    stepId: string;
    receiptSha256: string;
  }>;
  completedStepReceiptPrefixSha256: string;
  uncertainStepMarker: UncertainProductionStepMarkerV2 | null;
  uncertainStepMarkerSha256: string | null;
  recoveryOperationalAttestationSha256: string;
  recoveryProductionLeaseSha256: string;
  recoveryAuthorityPreclaimSha256: string;
  recoveryOperationClaimSha256: string;
  recoveryAuthorityConsumptionSha256: string;
  verifiedAt: string;
};

type ProductionFailureEvidenceCommonV2 = {
  version: "production-failure-evidence-v2";
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  sourceManifestSha256: string;
  failedExecutionEvidenceSha256: string;
  observedAt: string;
};

type ProductionFailureEvidenceV2 = ProductionFailureEvidenceCommonV2 & (
  | { failedGateId: "G13_PRODUCTION_MIGRATION";
      evidenceKind: "schema032_execution_receipt";
      attemptedExternalEffect: true;
      failureCode:
        | "first_migration_failed" | "first_verification_failed"
        | "second_migration_failed" | "final_verification_failed" }
  | { failedGateId: "G14_PRODUCTION_ROLLOUT";
      evidenceKind: "runtime_rollout_preflight";
      attemptedExternalEffect: false;
      orchestrationProgressSha256: string;
      preEffectValidationReceiptsSha256: string;
      failureCode:
        | "g13_reverification_failed" | "schema_verification_failed"
        | "previous_runtime_identity_mismatch"
        | "singleton_precondition_failed" }
  | { failedGateId: "G14_PRODUCTION_ROLLOUT";
      evidenceKind: "runtime_manager_capture";
      attemptedExternalEffect: true;
      orchestrationProgressSha256: string;
      failureCode:
        | "previous_runtime_stop_failed" | "candidate_start_failed" }
  | { failedGateId: "G14_PRODUCTION_ROLLOUT";
      evidenceKind: "runtime_rollout_checks";
      attemptedExternalEffect: true;
      orchestrationProgressSha256: string;
      failureCode:
        | "schema_verification_failed" | "runtime_version_mismatch"
        | "admin_unhealthy"
        | "singleton_violation" | "worker_start_failed"
        | "delivery_invariant_failed" | "legacy_population_changed"
        | "secret_detected" }
  | { failedGateId: "G15_PRODUCTION_CANARY";
      evidenceKind: "runtime_canary_checks";
      attemptedExternalEffect: true;
      orchestrationProgressSha256: string;
      failureCode:
        | "schema_verification_failed" | "canary_timeout"
        | "polling_cycles_incomplete"
        | "runtime_version_mismatch" | "admin_unhealthy"
        | "singleton_violation" | "reconciliation_failed"
        | "delivery_invariant_failed" | "navigation_invariant_failed"
        | "allowance_invariant_failed" | "legacy_population_changed"
        | "queue_growth_detected" | "honest_limit_misreported"
        | "secret_detected" }
  | { failedGateId: "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY";
      evidenceKind: "abandoned_operation_recovery";
      priorAttemptedExternalEffect: boolean;
      recoveryAttemptedExternalEffect: false;
      recoveryInputSha256: string;
      recoveryOrchestrationReceiptSha256: string;
      priorTerminalAbandonedSha256: string;
      priorTerminalCleanupSha256: string;
      completedStepReceiptPrefixSha256: string;
      uncertainStepMarkerSha256: string | null;
      recoveryOperationalAttestationSha256: string;
      recoveryProductionLeaseSha256: string;
      recoveryAuthorityPreclaimSha256: string;
      recoveryOperationClaimSha256: string;
      recoveryAuthorityConsumptionSha256: string;
      failureCode:
        | "authority_expired_before_claim"
        | "authority_expired_after_claim"
        | "operation_deadline_reached" }
);

type ProductionRollbackEvidenceV2 = {
  version: "production-rollback-evidence-v2";
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  artifactRootFingerprintSha256: string;
  sourceManifestSha256: string;
  failureEvidenceSha256: string;
  operationalAttestationSha256: string;
  operationalAttestationConsumptionSha256: string;
  commandId: "production_rollback";
  redactedTemplateSha256: string;
  previousRuntimeIdentitySha256: string;
  orchestrationReceiptSha256: string;
  outcome: ProductionRollbackOutcomeV2;
  queryCapturesSha256: string;
  checks: Record<"schema032_retained" | "previous_version" | "admin" |
    "singleton" | "allowance" | "legacy" | "sent" | "no_duplicate_send", true>;
};
```

The failure validator selects its exact branch from `failedGateId` and
`evidenceKind`; `failureCode` is allowlisted only within that branch. It
revalidates the fixed typed artifact behind `failedExecutionEvidenceSha256`
and requires the same candidate, freeze, source manifest, failed step/window
and observed execution. Unknown strings, cross-gate codes, a schema failure
pointing at rollout captures or a manager failure pointing at canary queries
fail closed. For `abandoned_operation_recovery`, the referenced execution is
the already-durable `RecoveryOnlyProductionOrchestrationReceiptV2`: its hash
must equal both `failedExecutionEvidenceSha256` and
`recoveryOrchestrationReceiptSha256`. That receipt contains only the exact
recovery local-validation steps and precedes failure evidence, while settlement
requires `recoveryAttemptedExternalEffect=false` independently of the prior
operation's `priorAttemptedExternalEffect`; this ordering is acyclic.
`previous_runtime_identity_mismatch` is valid only for G14
`runtime_rollout_preflight` before `stop_previous`.
`schema_verification_failed` is valid in the G14 pre-effect branch, G14
post-start rollout checks or G15 canary checks only when the exact evidence kind
and `attemptedExternalEffect` literal match. The pre-effect branch requires
`false`, binds only actual G13/schema/runtime-identity/singleton validation
receipts, and rejects every stop/start/candidate or post-start/canary query
capture. Every G13,
post-stop G14 and G15 branch requires `attemptedExternalEffect:true`. Swapping
gate, evidence kind, effect flag or code is invalid even when each token exists
elsewhere.
G14/G15 failure additionally binds the actual immutable ordered partial-step
receipt prefix through `orchestrationProgressSha256`; G13 branches forbid that
field because schema sequencing has its own execution receipt.
The `abandoned_operation_recovery` branch is produced only by the allowlisted
`production_recovery` operation after cleanup-only terminal abandonment and
terminal cleanup are both durable. It validates actual bytes for one contiguous
completed-step receipt prefix starting at sequence 1, and either no uncertain
step or exactly the immediately following intent as
`UncertainProductionStepMarkerV2`. It binds fresh recovery authority, the
current `recovery_only` lease/preclaim/claim/consumption and the prior abandoned
operation/cleanup hashes. Recovery performs zero rollout/canary/runtime/SQL
effects, never reconciles or repeats the uncertain step, never emits normal
G14/G15 pass evidence, and only creates the typed failure evidence needed for
`production_failed`. The legal next effect-capable operation is a separately
authorized rollback.
For G14/G15, the transition-evidence policy also resolves the exact operation
claim/consumption, settlement, prepared lease-removal, byte-exact removal
receipt and terminal-cleanup files and requires the fixed production-operation
lease to be absent. For `abandoned_operation_recovery`, those are the fresh
recovery-only operation files while the evidence additionally binds the prior
cleanup-only abandoned+cleanup lineage and immutable prefix/uncertain marker. A failure
evidence file alone cannot authorize `production_failed`. Settlement
`terminalEvidenceSha256` must exactly equal the validated failure evidence.
For `effect_capable`, settlement `attemptedExternalEffect` must equal that
evidence's same field. For `recovery_only`, the generic field is absent:
settlement requires `recoveryAttemptedExternalEffect=false` and independently
requires `priorAttemptedExternalEffect` to equal both the recovery-only overall
receipt and abandoned-operation recovery failure evidence. The removal receipt must bind that settlement and
the exact removed owned lease hash/epoch, its bytes/hash must equal the prepared
canonical receipt, and cleanup must bind settlement, prepare and receipt.
The actual-rollback orchestrator first validates the append-only issuer chain
and exactly one fresh compatible unconsumed `rollback_rolled_back` tip with the
required prior terminal lineage, then acquires its lease, persists the lease-
bound preclaim and atomically persists consumption in the exclusive claim. The validator binds exact attestation/
claim/consumption bytes,
`production_rollback` command/template, protected root, candidate, source
failure manifest and previous-runtime identity. The transition evidence policy
then resolves only `production-rollback-evidence-v2.json`, validates its outcome
against manifest `actualRollback`, and rejects missing, swapped, stale or
foreign rollback attestations/operation ownership before any mutator acts. The evidence itself is
created from the bounded actions, then validated before reducer/manifest
transition; it is not a pre-action gate and therefore creates no cycle.

`release:production:{rollout|canary|recovery|rollback}:execute` are the sole production
entry points and are invoked before the first effect or observation. Each
orchestrator first validates the issuer chain and unique fresh compatible
`unconsumed` authority tip, then
acquires the fixed production-operation lease, persists the preclaim bound to
that exact lease hash/epoch/owner/operation and atomically consumes authority
inside its exclusive claim. It runs only its fixed allowlisted manager/query
step sequence and writes/fsyncs one immutable per-step receipt. Exact replay
skips a completed step only after validating its receipt and observed state.
If a crash occurs after an effect but before its receipt, the current lease
owner may perform the fixed read-only reconciliation only while both
`now < consumedAuthority.expiresAt` and
`now < immutable operationDeadlineAt`; it records recovered completion only
when the exact idempotent outcome is proven, otherwise it fails closed. After
all steps it writes orchestration receipt, typed evidence, settlement and
then fsyncs canonical removal prepare, removes the exact owned lease, publishes
the prepared receipt bytes and writes terminal cleanup in that order. Crash
replay validates each durable boundary, never regenerates time and never
reverses removal/cleanup. Operators never run underlying stop/start/
query/observation commands separately. A concurrent invocation cannot consume
authority again; only exact same-operation resume through current lease epoch/
takeover lineage may read the ordered receipt prefix. Foreign operation,
source manifest, generation or claim ownership, or equality/passage of consumed
authority expiry or immutable operation deadline, fails before every leaf
action/query/reconciliation and settlement.

Canary must cover at least 15 minutes and two completed polling cycles, and
must finish no later than 30 minutes after its claim consumed the operational
attestation and started the bounded observation. Pre-claim validation requires
validity beyond that hard bound plus settlement margin. A shorter, longer,
expired, interrupted or clock-inconsistent observation fails closed; takeover
does not reset either time bound.

Plan 5 does not invent a service manager. Task 0 discovers the actual current
launch mechanism. If it is `Start-Process`, the approved command uses
`-WindowStyle Hidden`. If the old command cannot be reproduced safely, rollout
is blocked.

---

## 3. Release gate catalog and state machine

| Gate | Exact `GateEvidencePolicy` roots | Transition | Failure action |
|---|---|---|---|
| `G00_BASE` | `task0-baseline.json`, `trusted-os-principal-policy-v2.json`, `artifact-root-trust-boundary-evidence-v1.json`, `release-freeze-materialization-receipt-v2.json`, `release-freeze-identity-v2.json` | `pre_manual` | block |
| `G01_TRACE` | `acceptance-trace.json`, exact AC-41 execution trace and `task8b-red-evidence-v1.json` with PostgreSQL execution/cleanup proof | `pre_manual` | return Plan 5 Task 2 |
| `G02_DATA` | `suite-plan1.vitest.json`, `suite-plan1.evidence.json` | `pre_manual` | return Plan 1 |
| `G03_SCORING` | `suite-plan2.vitest.json`, `suite-plan2.evidence.json` | `pre_manual` | return Plan 2 |
| `G04_RUNTIME` | `suite-plan3.vitest.json`, `suite-plan3.evidence.json` | `pre_manual` | return Plan 3 |
| `G05_TELEGRAM` | Plan 4 suite at pre-manual; finalized `manual-telegram-acceptance.json` with exact 15/19/11 at readiness | `readiness` | return Plan 4 |
| `G06_FULL` | Plan 5 suite plus `full-regression-evidence.json` | `pre_manual` | return owning plan |
| `G07_SCHEMA_OFFLINE` | distinct clean and production-clone `schema032-release-evidence.json` snapshots | `pre_manual` | block migration/release |
| `G08_VERSION_SANITIZED` | sanitized schema, manager/subprocess/query captures and `runtime-rehearsal.json` | `pre_manual` | block startup/release |
| `G09_LEGACY_TERMINAL` | `terminal-legacy-population.json` and exact Task 0B cutoff | `pre_manual` | return owner/block |
| `G10_ROLLBACK_REHEARSAL` | `rollback-rehearsal.json`; explicitly pre-GO only | `pre_manual` | block release |
| `G11_POISONING_REGRESSION` | Address Poisoning suite report/evidence only | `pre_manual` | return separate owner/block |
| `G12_PRODUCTION_BACKUP` | fresh operational attestation, one consumption claim, dump/list progress, final evidence and actual dump/list; no active lease remains | `g12_backup_passed` | block production mutation |
| `G13_PRODUCTION_MIGRATION` | fresh authority selection, bound DB execution claim/atomic consumption, per-stage unexpired/session-lock guard, `Schema032ProductionExecutionReceiptV2`, source G12 receipt/backup and all first/verify/no-op/final sequence bytes | `g13_migration_passed` | retain previous runtime or rollback decision |
| `G14_PRODUCTION_ROLLOUT` | fresh authority selection, original production lease, immutable preclaim, verified committed takeover lineage/current tip, atomic claim/consumption, durable intents before external effects, immutable authority/deadline guards, fixed operation takeover chain, rollout step/orchestration receipts, typed settlement→prepared removal→exact lease removal→byte-exact receipt→cleanup, manager/query captures and derived pass or pre/post-effect failure evidence | `g14_rollout_passed` | `production_failed`; rollback orchestrator on typed failure |
| `G15_PRODUCTION_CANARY` | fresh authority selection, original production lease, immutable preclaim, verified committed takeover lineage/current tip, atomic claim/consumption, immutable authority/deadline guards, fixed operation takeover chain, bounded canary step/orchestration receipts, typed settlement→prepared removal→exact lease removal→byte-exact receipt→cleanup, query/scheduler/log captures and derived evidence | `g15_canary_released` | `production_failed`; rollback orchestrator on failure |

Phase rules:

| V2 transition/state | Required passed gates | Gates allowed pending/terminal |
|---|---|---|
| `pre_manual / not_ready` | `G00…G04`, `G06…G11` | `G05`, `G12…G15` pending |
| `readiness / ready_for_release` | exactly `G00…G11` | `G12…G15` pending |
| `g12_backup_passed / not_ready` | exactly `G00…G12` | `G13…G15` pending |
| `g13_migration_passed / not_ready` | exactly `G00…G13` | `G14…G15` pending |
| `g14_rollout_passed / not_ready` | exactly `G00…G14` | `G15` pending |
| `g15_canary_released / released` | exactly `G00…G15` | none |
| `production_failed / not_ready` | passed prefix through the last successful production gate | one exact failed production gate; later gates blocked; exact typed failure transition ref |
| `rollback_rolled_back / rolled_back` | same attempted prefix | failure ref plus typed actual-rollback ref and equal discriminated `actualRollback.outcome` |

The writer discovers only the fixed policy roots above. Generation-bound
authority/claim/progress filenames are followed exclusively from already
validated primary evidence and strict filename grammar; the CLI never accepts
an individual evidence filename. An exact replay returns the existing target
manifest and receipt byte-for-byte. A conflicting replay or out-of-order state
fails closed.

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
- `scripts/materializeReleaseFreeze.ts` — sole O_EXCL freeze materializer.
- `scripts/issueOperationalAttestation.ts` — sole append-only authority issuer.
- `scripts/terminalizeExpiredUnclaimedAuthority.ts` — sole expired-unclaimed
  authority terminalizer.
- `src/release/releaseAuthorityStore.ts` — issuer-chain validation and unique-
  active-tip selector.
- `src/release/releaseRootWriterStore.ts` — discriminated bootstrap/frozen
  fixed root-writer lease/CAS.
- `src/release/remediationReleaseManifestV2.ts` — V2 types, strict parser and
  pure transition reducer.
- `src/release/releaseGateEvidencePolicy.ts` — exact G00–G15 typed evidence
  policy and semantic validators.
- `src/release/releaseTransitionEvidencePolicy.ts` — separate exact
  `production_failed` / `rollback_rolled_back` typed transition refs; never a
  G00–G15 gate policy.
- `src/release/releaseManifestStore.ts` — root lease/claim, CAS, durable
  content-addressed snapshots and recovery.
- `src/release/productionOperationStore.ts` — shared rollout/canary/rollback/
  recovery fixed lease, lease-bound authority preclaim/atomic consumption, step,
  settlement/canonical removal prepare/exact lease-removal receipt/cleanup and
  terminal-abandonment protocol.
- `scripts/advanceRemediationReleaseManifest.ts` — sole manifest/gate writer.
- `scripts/takeoverManifestLease.ts` — explicit same-generation expired-lease
  takeover and exact prepared/tombstone/new-lease/receipt replay.
- `scripts/takeoverProductionOperationLease.ts` — effect-capable dead-owner
  takeover permitted only while both strict time bounds hold.
- `scripts/takeoverCleanupOnlyProductionOperationLease.ts` — post-boundary
  dead-owner takeover with cleanup-only claim/lease and no production actions.
- `scripts/executeProductionRollout.ts` — sole G14 orchestrator and typed
  manager/query/step-receipt evidence producer.
- `scripts/executeProductionCanary.ts` — sole bounded G15 observation
  orchestrator and typed evidence producer.
- `scripts/executeProductionRollback.ts` — sole actual rollback orchestrator;
  never accepts G10 rehearsal.
- `scripts/executeProductionRecovery.ts` — sole recovery-only abandoned-lineage
  to typed `production_failed` translator; no rollout/canary effects.
- `tests/release/remediationReleaseManifest.acceptance.test.ts`
- `tests/release/acceptanceTrace.acceptance.test.ts`
- `tests/release/runtimeVersion.acceptance.test.ts`
- `tests/release/schema032Release.acceptance.test.ts`
- `tests/release/manualTelegramEvidence.acceptance.test.ts`
- `tests/release/terminalLegacyPopulation.acceptance.test.ts`
- `tests/release/rollbackRehearsal.acceptance.test.ts`
- `tests/release/releaseManifestLifecycle.acceptance.test.ts`
- `tests/release/releaseManifestStore.acceptance.test.ts`
- `tests/release/productionReleaseEvidence.acceptance.test.ts`
- `tests/release/productionReleaseEvidence.postgres.test.ts`
- `tests/fixtures/release/remediationReleaseFixtures.ts`
- `docs/superpowers/verification/plan5-release/README.md`

Created only after deployment/closeout:

- `docs/superpowers/verification/plan5-release/<date>-release-closeout.md`
- `docs/superpowers/verification/address-poisoning/<date>-runtime-closeout.md`

### Modify

- `scripts/captureTask0BPreflight.ts` — verified/redacted evidence only; never a
  freeze producer.
- `package.json` — existing release commands plus exact
  `release:freeze:materialize`, `release:authority:issue`,
  `release:authority:terminalize`,
  `release:manifest:advance`, `release:manifest:takeover`,
  `release:production:lease:takeover`,
  `release:production:lease:cleanup-only-takeover`,
  `release:production:rollout:execute`,
  `release:production:canary:execute`,
  `release:production:recovery:execute` and
  `release:production:rollback:execute`; no dependency changes.
- `src/release/remediationReleaseManifest.ts` — V1 compatibility parser only;
  no Task 9 or production authority.
- `scripts/verifyRemediationRelease.ts` — V2 semantic read-only verifier;
  byte-identical artifact-root invariant.
- `scripts/createProductionBackupEvidence.ts`,
  `scripts/runSchema032ReleaseSequence.ts`, `scripts/manageTask0BRuntime.ts` —
  require a fully verified V2 transition receipt/current manifest/root binding,
  never structural manifest-only validation.
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

#### Task 0A — Local baseline gate (before Tasks 1–8B)

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
   expected and does not block Tasks 1–8B.
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
release inputs do not block Tasks 1–8B.

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
6. exact `artifact-root-trust-boundary-evidence-v1.json` produced by the
   allowlisted `artifact_root_preflight` command/query with redacted-template
   hash. It proves local NTFS/POSIX filesystem, canonical root and mutable
   ancestor identities, owner and exact allowlisted
   `TrustedOsPrincipalPolicyV2`. Windows permits only service account,
   LocalSystem, BUILTIN Administrators or the frozen canonical configured set;
   Everyone/Users/foreign writable ACEs fail. Evidence persists policy id/hash,
   canonical-path/owner/ancestor/normalized-ACL-or-mode hashes and
   `untrustedWriteGrantPresent=false`; raw ACL entries, principal names/SIDs,
   command text, environment values and secrets are forbidden. Unsupported
   filesystems/ACL queries fail closed;
7. isolated candidate port and proof that discovery did not stop/start runtime,
   migrate DB or send Telegram messages.

After capture verification, materialize the freeze only through:

```powershell
npm run release:freeze:materialize -- <protected-artifact-root>
```

Task 0B is incomplete until the canonical materialization receipt and O_EXCL
freeze bytes both validate. Directly authored freeze JSON is invalid.

Every value is bound to observation time, source and candidate SHA. Missing,
stale, guessed or unverified input blocks Task 9 and prevents a valid
`RemediationReleaseManifestV2` pre-manual/readiness chain. Task 0B cannot be deferred into a
later Task 9 step and cannot be satisfied from the earlier Task 0A snapshot
alone.

The original preflight remains canonical evidence after its 15-minute
observation window expires. Current liveness is proven only by:

```powershell
npm run release:task0b:revalidate -- <protected-artifact-root>
```

This appends a canonical content-addressed receipt under
`task0b-revalidations/`. Run it at Task 9 entry and again immediately before a
liveness-sensitive runtime, terminal-legacy, manual-Telegram, strict
verification, G12 backup-entry, or G13 migration-entry consumer whenever the
latest receipt is no longer fresh. A
missing, stale, malformed, ambiguous, foreign-generation, or operationally
different receipt fails closed. Revalidation is read-only apart from its own
exclusive evidence write; it cannot modify the preflight, materialized freeze,
manifest, runtime, database, or Telegram.

`captureTask0BPreflight.ts` writes only the verified preflight evidence; it is
not a freeze producer and cannot claim producer identity. The separate sole
`release:freeze:materialize` producer validates that evidence, precommits
canonical identity bytes/hash and creates `release-freeze-identity-v2.json`
once with `O_EXCL` for the candidate/root/production-DB/tool/previous-runtime/
rollback-worktree tuple. This chain-stable
identity has no `expiresAt`, assigns the root's only `releaseGenerationId`, and
any change to one of those facts invalidates/seals the manifest chain and
requires a new protected root. Immediately before each external G12, G13, G14,
G15 or actual-rollback action, the sole `release:authority:issue` producer
fsyncs one prepared issuance and then appends its precommitted content-addressed
bounded `OperationalAttestationV2` plus chained issuer receipt for that action
using the same frozen generation, then appends the committed marker. Freeze,
issue and authority-terminal publication all hold the fixed root-writer lease/
CAS also used by manifest transitions; no separate authority lock exists. Crash
replay publishes only prepared bytes and never regenerates time. It
must match the exact freeze, source manifest and candidate, be fresh and
be the selector's unique compatible unconsumed tip at pre-claim validation,
and have enough remaining validity for the
policy maximum plus settlement margin. The exclusive operation claim atomically
persists consumption. Consumption is revalidated as unexpired before every
effect/query/settlement; it does not make an expired attestation valid. No
second/refreshed generation or re-consumption is accepted in-place. G15 must be
issued with validity beyond its 30-minute hard observation bound plus
settlement margin; an already-consumed authority that expires blocks the next
query/effect/settlement and enters fail-closed operational recovery.
If an authority expires before any claim, the allowlisted
`release:authority:terminalize` command must first acquire that same root-writer
lease, reject `now < expiresAt`, fsync canonical prepared terminal bytes and
publish the committed `AuthorityTerminalReceiptV2`. It proves zero preclaim,
claim, consumption, action lease, G13 bound DB session/advisory lock, operation
and effect artifacts. The later issuer binds the terminal receipt hash. Any
such artifact rejects this shortcut and requires normal operation terminal
lineage or a new protected root.
G12/G13 use only their typed authority expiry plus backup-lease or bound DB-
session/advisory-lock limits; they do not carry `operationDeadlineAt`.
For every G14/G15/actual-rollback effect, query, reconciliation and settlement,
the stricter production-operation guard additionally requires
`now < immutable operationDeadlineAt`; equality or passage of either bound
fails closed for ordinary work and normal takeover. Cleanup-only takeover is
the sole post-bound terminalization exception; it preserves rather than extends
the deadline and has no production-action capability.
The freeze stores the trust-boundary evidence hash. Task 9 and every production
orchestration entry point rerun the same allowlisted redacted preflight guard;
changed root/ancestor identity, trusted-principal policy/hash, normalized ACL/
mode, filesystem kind or a concurrent same-principal mutator blocks before any
effect. This is an operational trust
boundary, not a claim that Node prevents hostile same-principal path races.

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
   the three fullNames. AC-10/11 must fail on `PLAN1_BASE_SHA`. The separate
   AC-33 LLM-dampening test has no independent RED: primary AC-33 supplies the
   owner RED, while the secondary test is mandatory exact candidate-GREEN-only
   auxiliary evidence because the frozen boundary lacks the same local product
   module and the test is already GREEN once that module exists.
4. Save sanitized Vitest JSON/JUnit RED evidence and patch SHA-256 outside the
   repo, then require candidate GREEN for all three names. Bind the secondary
   AC-33 proof to exact fullName, `db5d49a9…`, patch SHA-256 `ae069e6d…`, owner
   `83f0cb96…`, candidate SHA and full GREEN report SHA-256.

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
syntax/import/type/fixture/environment failure. The sole corrective import
exception is typed `local_product_module_absent` for
AC-07/08/09/12/13/27/39 under the exact path/patch/Git-lineage constraints in
section 2.3; it does not admit generic import or no-test evidence.

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
full repository-local Vitest CLI with approved serialization/test/hook bounds,
`git diff --check`, forbidden-scope audit and PostgreSQL schema cleanup for exact
prefixes `plan1_%…plan5_%` in the exact disposable DBs.

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

### Task 8B — Manifest V2 lifecycle remediation (mandatory before Task 9)

Task 8B исправляет обнаруженный read-only audit gap. Он выполняется только в
текущем isolated feature worktree, через subagent-driven development и TDD.
Ни один шаг не читает и не меняет production DB `tron_watch:55999`, не
останавливает/запускает runtime и не отправляет Telegram. После каждого
подзадания: один ограниченный commit, clean worktree, отдельный spec-review,
отдельный code-quality/security review и forbidden-scope audit.

#### Task 8B.0 — Approve amendment and freeze corrective baseline

**Files:**

- Modify only:
  `docs/superpowers/plans/2026-07-17-remediation-end-to-end-acceptance-and-release.md`.

Steps:

1. Record current feature `HEAD`, clean-worktree state, main-worktree 13 dirty
   paths and four stash object SHAs. Do not modify main or any stash.
2. Confirm current code has no manifest writer, freeze materializer, append-only
   crash-safe prepared authority issuer/selector, expired-unclaimed authority
   terminalizer serialized by the fixed root-writer lease/CAS, capability-split
   production takeover, G14/G15/production-
   rollback evidence producer or semantic G12–G15 binding. This is the expected
   baseline, not permission to run production.
3. Run:

   ```powershell
   git diff --check
   git diff --name-only
   $forbidden = @('T'+'BD','T'+'ODO','implement '+'later','fill '+'in details')
   Select-String -Pattern $forbidden `
     -Path docs/superpowers/plans/2026-07-17-remediation-end-to-end-acceptance-and-release.md
   ```

   **Expected:** diff check PASS; only this Plan 5 document changed; placeholder
   scan has no unresolved Task 8B instruction.
4. Commit only this document:

   ```powershell
   git add -- docs/superpowers/plans/2026-07-17-remediation-end-to-end-acceptance-and-release.md
   git diff --cached --check
   git diff --cached --name-only
   git commit -m "docs: approve plan 5 manifest lifecycle amendment"
   ```

5. Perform separate spec-review and documentation/code-quality review. Verify
   `git status --porcelain` is empty.

Task 8 remains incomplete after this docs commit. Task 9 remains blocked.

#### Task 8B.1 — Freeze manifest-lifecycle RED acceptance

**Files:**

- Create: `tests/release/releaseManifestLifecycle.acceptance.test.ts`.
- Create: `tests/release/releaseManifestStore.acceptance.test.ts`.
- Create: `tests/release/productionReleaseEvidence.acceptance.test.ts`.
- Create: `tests/release/productionReleaseEvidence.postgres.test.ts`.
- Modify: `tests/fixtures/release/remediationReleaseFixtures.ts` only to add
  immutable V2/evidence fixtures; V1 assertions are not weakened.

These four test files and the V2 fixture additions are the immutable frozen
Task 8B acceptance set. Task 8B.1 contains every final lifecycle/store/G00-G15
producer/orchestrator/mutator assertion needed by Tasks 8B.2–8B.7. Later tasks run them but
must not edit, regenerate or weaken them. New explicitly named non-frozen unit
tests may cover internal helpers only and cannot substitute for a frozen
acceptance assertion.

Before RED, record the local `createdb`, `dropdb` and `psql` executable
identities/versions and the disposable cluster endpoint. The endpoint must be
exact IPv4 `127.0.0.1`, must not be port 55999 or the production DB identity, and the
exact database name is fixed below. A missing tool or identity mismatch blocks
Task 8B.1 rather than converting PostgreSQL coverage into a skip.

Add these exact test identities:

```text
[REQ-38][MANIFEST-V2-INIT] creates pre-manual revision one only from absent with G00-G04 and G06-G11 passed G05 manual pending and G12-G15 pending
[REQ-38][MANIFEST-V2-TRANSITIONS] accepts only absent to pre-manual to readiness to G12 to G13 to G14 to G15
[REQ-38][MANIFEST-V2-PENDING] pending gates contain no invented execution fields
[REQ-38][MANIFEST-V2-BLOCKED] blocked gates contain only blocker and exact failure evidence without execution fields
[REQ-38][MANIFEST-V2-FREEZE] separates chain-stable freeze identity from fresh action attestations
[REQ-38][RELEASE-FREEZE-MATERIALIZER] only release freeze materializer converts verified Task0B evidence into one O_EXCL canonical identity while captureTask0BPreflight cannot impersonate the producer
[REQ-38][BOOTSTRAP-ROOT-WRITER-CRASH] discriminates bootstrap from frozen lease takeover and terminal bytes resumes exact prepared freeze after dead-owner takeover and seals the root for new-root retry when owner dies before prepare including crash after lease acquisition and after prepare before freeze receipt
[REQ-38][BOOTSTRAP-ROOT-WRITER-LEASE-CLEANUP] leaves manifest-transition-root lease absent after both normal materialization and prepared-freeze takeover-resumed successful materialization
[REQ-38][OPERATIONAL-AUTHORITY-ISSUER] appends content-addressed attestation and previous-hash issuer receipt without overwriting consumed or expired authority
[REQ-38][OPERATIONAL-AUTHORITY-ISSUER-CRASH] replays exact prepared bytes before attestation between attestation and receipt and after receipt before committed marker without a second clock read or branch and rejects a competing issuer or conflicting prepare under the fixed root-writer lease
[REQ-38][OPERATIONAL-AUTHORITY-SELECTION] selects exactly one active compatible unconsumed linear-chain tip and rejects branch gap or multiple active authority
[REQ-38][OPERATIONAL-AUTHORITY-RECOVERY] issues fresh recovery authority only after exact prior terminal lineage and preserves prior bytes
[REQ-38][OPERATIONAL-AUTHORITY-EXPIRED-UNCLAIMED] rejects early terminalization terminalizes an expired never-claimed zero-effect authority through prepared and committed bytes permits bound replacement and rejects it when any preclaim claim consumption action lease G13 bound session advisory lock operation or effect artifact exists
[REQ-38][OPERATIONAL-AUTHORITY-SWAPPED] rejects swapped freeze root generation candidate source command previous attestation or terminal lineage
[REQ-38][ROOT-WRITER-SERIALIZATION] one fixed root-writer lease and CAS serializes freeze materialization manifest transition authority issue and authority terminalization and rejects every competing writer kind
[REQ-38][MANIFEST-V2-EVIDENCE] semantically binds every G00-G15 policy to actual bytes
[REQ-38][MANIFEST-V2-FORGED] rejects a structurally valid hand-written manifest and gate output
[REQ-38][MANIFEST-V2-CAS] rejects stale and concurrent writers without overwriting the winner
[REQ-38][MANIFEST-V2-CRASH] recovers exactly before and after the atomic manifest replace
[REQ-38][MANIFEST-V2-CRASH-RECEIPT] restores exact prepared canonical receipt bytes and hash after replace-before-receipt without rerunning time reducer or serializer
[REQ-38][MANIFEST-V2-REPLAY] exact replay is byte-identical and conflicting replay fails closed
[REQ-38][MANIFEST-V2-ROOT-LEASE] one fixed root-wide lease serializes competing different transition keys before the loser creates a claim
[REQ-38][MANIFEST-V2-PATH-SAFETY] requires allowlisted trusted principal policy and rejects pre-existing or detectable POSIX symlink Windows junction reparse and identity substitutions without claiming undetectable same-principal race defense
[REQ-38][ARTIFACT-ROOT-TRUSTED-PRINCIPALS] accepts normalized writable service account LocalSystem and BUILTIN Administrators or exact configured canonical set without persisting raw ACL or principal values
[REQ-38][ARTIFACT-ROOT-UNTRUSTED-WRITE] rejects writable Everyone Users foreign ACE and unsupported filesystem or ACL identity
[REQ-38][MANIFEST-V2-RECOVERY] validates claim root-lease prepared canonical-receipt committed filenames TTL liveness exact-generation resume and receipt chain
[REQ-38][MANIFEST-V2-LEASE-TAKEOVER] takes over only one exact expired dead-owner lease in the same generation through prepared tombstone new lease and receipt
[REQ-38][MANIFEST-V2-LEASE-TAKEOVER-CRASH] replays exactly before and after tombstone new-lease and receipt boundaries without deleting or duplicating authority
[REQ-38][MANIFEST-V2-LEASE-FENCE] prevents the old owner from any effect or manifest replace after lease hash or epoch changes
[REQ-38][MANIFEST-V2-AUTHORITY-SELECTION] accepts only the freeze generation rejects a second generation and seals incompatible or terminal roots
[REQ-38][MANIFEST-V2-SEALED-ROOT] rejects every transition on terminal-abandoned root and never auto-copies state to a new root
[REQ-38][MANIFEST-V2-VERIFY-READONLY] verifier leaves every artifact byte-identical
[REQ-38][G12-V2-BINDING] validates fresh unconsumed authority before atomic claim and binds per-effect unexpired lease ownership progress final evidence actual bytes and no active lease
[REQ-38][G13-V2-BINDING] binds schema execution receipt consumed authority lock session source G12 and complete sequence
[REQ-38][G13-FAIL-FIRST-MIGRATION] records no completed stage hash and exact typed first-migration failure
[REQ-38][G13-FAIL-FIRST-VERIFICATION] records only completed first-migration receipt before exact failure
[REQ-38][G13-FAIL-SECOND-MIGRATION] records exactly the first two completed ordered receipts before exact failure
[REQ-38][G13-FAIL-FINAL-VERIFICATION] records exactly the first three completed ordered receipts before exact failure
[REQ-38][PRODUCTION-FAILURE-CODE] rejects free-form or swapped gate evidence-kind and allowlisted failure-code combinations
[REQ-38][G13-FAILURE-PATH] resolves only the failedStep-specific allowlisted relative artifact and rejects swapped foreign missing or symlink paths
[REQ-35][REQ-38][G14-V2-EVIDENCE] derives rollout only from exact manager and query captures
[REQ-35][REQ-38][G14-RUNTIME-ORDER] stops the exact previous runtime after G13 and before candidate start
[REQ-35][REQ-38][PRODUCTION-AUTHORITY-TWO-PHASE] validates exact fresh compatible unconsumed authority acquires the original production lease then persists immutable original-lease-hash-epoch-owner-operation-bound preclaim and atomically consumes authority only in the claim under that lease or the exact current tip of its committed linear takeover chain
[REQ-35][REQ-38][PRODUCTION-PRECLAIM-CRASH] resumes crash after immutable preclaim through exact original-lease to current-tip committed takeover lineage without replacing preclaim binds lineage hash and current tip in consumption and claim and rejects branch gap swapped foreign or orphan lineage
[REQ-35][REQ-38][PRODUCTION-PRECLAIM-LINEAGE-PUBLICATION] append-only creates one O_EXCL fsynced lineage per tip with null-first or previous-lineage hash one inherited lineageStartedAt one-receipt takeover suffix fixed resolvedAt and byte-exact same-tip replay then completes L2-written owner-dead takeover-L3 lineage-L3 claim bound to latest path hash and tip
[REQ-35][REQ-38][PRODUCTION-PRECLAIM-LINEAGE-SWAP] rejects traversal foreign path swapped bytes hash original preclaim current tip previous-lineage branch gap changed lineageStartedAt multi-receipt suffix or takeover receipt from another operation generation root owner epoch before claim or consumption
[REQ-35][REQ-38][PRODUCTION-AUTHORITY-EFFECT-GUARD] rejects swapped operation ownership lease epoch consumption and now equal to or beyond consumed authority expiry or immutable operation deadline before every effect query reconciliation and settlement
[REQ-35][REQ-38][PRODUCTION-AUTHORITY-EXPIRY] rejects now equal to or beyond selected preclaim or consumed postclaim authority expiry including normal effect-capable takeover preserves terminal partial evidence and permits only cleanup-only terminalization or a separately issued selected and claimed fresh-authority recovery-only operation bound to exact abandonment cleanup completed-prefix and uncertain-marker evidence without observing reconciling or repeating uncertain effects
[REQ-35][REQ-38][PRODUCTION-OPERATION-DEADLINE] rejects now equal to and after immutable operation deadline for effect query reconciliation settlement and normal effect-capable takeover never extends the deadline across either takeover and persists operation_deadline_reached abandonment while authority remains valid
[REQ-35][REQ-38][G14-ORCHESTRATOR] claims and consumes fresh authority before its first effect and crash-safely resumes only the fixed rollout step sequence
[REQ-35][REQ-38][G14-PRE-EFFECT-FAILURE] records exact attemptedExternalEffect false validation receipts transitions to production_failed and rolls back as previous_runtime_retained without stop start or candidate captures
[REQ-03][REQ-35][REQ-36][G15-V2-EVIDENCE] requires two cycles and a 15-to-30-minute bounded canary with all checks
[REQ-03][REQ-35][REQ-36][G15-ORCHESTRATOR] claims and consumes fresh authority before its first observation and crash-safely resumes only the fixed canary step sequence
[REQ-35][REQ-38][ROLLBACK-PRE-STOP] retains an already-running previous runtime without invented stop or start captures
[REQ-35][REQ-38][ROLLBACK-POST-STOP-PRE-START] keeps failed candidate-start command without confirmed process evidence in previous-only restart and rejects candidate-stop fields
[REQ-35][REQ-38][ROLLBACK-POST-CANDIDATE-START] requires confirmed candidate-start evidence before candidate stop and previous restart
[REQ-35][REQ-38][PRODUCTION-ROLLBACK-V2] rejects cross-window fields and G10 rehearsal for all three outcomes
[REQ-35][REQ-38][ROLLBACK-TRANSITION-EVIDENCE] validates fresh unconsumed authority then atomically claims consumption before actions and binds post-action typed actualRollback ref outcome command template root candidate previous runtime without circular pre-action evidence
[REQ-35][REQ-38][ROLLBACK-ORCHESTRATOR] claims and consumes fresh authority before its first effect and crash-safely resumes only the fixed rollback branch
[REQ-35][REQ-38][PRODUCTION-ORCHESTRATION-ONLY] rejects direct operator invocation or separately authored captures for rollout canary and rollback leaf steps
[REQ-35][REQ-38][PRODUCTION-ORCHESTRATION-LEASE] one fixed production-operation lease permits only exact same-operation resume and rejects concurrent foreign source or generation execution
[REQ-35][REQ-38][PRODUCTION-MANIFEST-LEASE-EXCLUSION] prevents production operation claim during manifest lease and prevents manifest evidence transition during production lease without cross-lock deadlock
[REQ-35][REQ-38][PRODUCTION-ORCHESTRATION-TAKEOVER] crash-safely transfers only one expired dead-owner effect-capable production lease while both strict bounds hold through old-hash prepare tombstone epoch-plus-one effect-capable lease and committed receipt without reconsuming authority
[REQ-35][REQ-38][PRODUCTION-CLEANUP-ONLY-TAKEOVER] after either strict bound transfers an expired dead-owner lease through trusted-root old-hash prepare tombstone epoch-plus-one cleanup-only claim lease and committed receipt without renewing or reconsuming authority then terminally abandons and leaves no live PID or fixed lease while retaining immutable audit artifacts
[REQ-35][REQ-38][PRODUCTION-CLEANUP-ONLY-FORBIDDEN] rejects every effect query reconciliation success or failure settlement evidence gate manifest advancement and rollback action under cleanup-only capability
[REQ-35][REQ-38][PRODUCTION-CLEANUP-ONLY-CRASH] replays cleanup-only prepare tombstone epoch-plus-one lease committed takeover terminal abandonment removal prepare exact removal byte-exact receipt and cleanup without duplicate action or residual PID or lease
[REQ-35][REQ-38][PRODUCTION-RECOVERY-E2E] reaches a strict bound completes cleanup-only abandonment removal and cleanup consumes fresh recovery authority under recovery-only lease-bound preclaim and claim derives typed production_failed from exact abandoned cleanup and partial-prefix lineage then permits separate fresh-authority rollback
[REQ-35][REQ-38][PRODUCTION-RECOVERY-NO-REPLAY] binds the next uncertain-step marker rejects noncontiguous or swapped receipt prefix performs zero rollout canary runtime or SQL effects and never reconciles or repeats the uncertain effect or emits normal gate evidence
[REQ-35][REQ-38][PRODUCTION-RECOVERY-TYPED-RECEIPTS] accepts only recovery-only local-validation step receipts and overall receipt with production_recovery command writes overall receipt before failure evidence binds it without a hash cycle and compares recoveryAttemptedExternalEffect false separately from priorAttemptedExternalEffect
[REQ-35][REQ-38][PRODUCTION-STEP-INTENT-CRASH] fsyncs exact attempt-one bound step intent before every external effect binds it from receipt treats only actual intent-without-receipt as uncertain across crash windows while no intent forbids an uncertain-effect claim and rejects every second intent or retry after crash or takeover
[REQ-35][REQ-38][PRODUCTION-ORCHESTRATION-FENCE] checks current operation lease hash epoch and consumed authority before every leaf and fences old or replay process ownership
[REQ-35][REQ-38][PRODUCTION-ORCHESTRATION-CRASH] replays before and after claim effects step receipts evidence durable settlement removal prepare exact owned lease removal byte-exact prepared receipt publication and cleanup without duplicate consumption effect settlement removal or cleanup
[REQ-35][REQ-38][PRODUCTION-LEASE-REMOVAL-CRASH] precommits canonical receipt object UTF8 bytes removedAt hash exact lease hash epoch and terminal state before deletion then replays prepare delete receipt publication and cleanup boundaries byte-exactly without a new clock read
[REQ-38][PRODUCTION-MUTATOR-V2] rejects V1 structural or V2 manifest without current transition receipt and root binding
[REQ-38][TASK8B-PG-RED] runs the frozen PostgreSQL RED case on an exact disposable non-production database with required execution report hash and cleanup
```

RED command:

```powershell
$ErrorActionPreference = 'Stop'
$report = Join-Path $env:PLAN5_ARTIFACT_ROOT 'task8b-red.vitest.json'
$redPort = [int]$env:PLAN5_TASK8B_RED_PGPORT
$redDb = 'tron_watch_plan5_task8b_red'
if ($redPort -le 0 -or $redPort -eq 55999) {
  throw 'PLAN5_TASK8B_RED_PGPORT must be a disposable local non-55999 port'
}
if ($env:PLAN5_TASK8B_RED_PGHOST -ne '127.0.0.1') {
  throw 'Task 8B RED PostgreSQL must use exact IPv4 127.0.0.1'
}
$env:PGHOST = $env:PLAN5_TASK8B_RED_PGHOST
$env:PGPORT = "$redPort"
$env:PGUSER = $env:PLAN5_TASK8B_RED_PGUSER
# PGPASSWORD, if required, is supplied only by the protected operator env.
$env:TEST_DATABASE_URL =
  "postgresql://$env:PLAN5_TASK8B_RED_PGUSER@$($env:PLAN5_TASK8B_RED_PGHOST):$redPort/$redDb"
$created = $false
$cleanupVerified = $false
$reportSha = $null
try {
  $before = psql -d postgres -X -A -t -v ON_ERROR_STOP=1 `
    -c "SELECT count(*) FROM pg_database WHERE datname = '$redDb'"
  if (($before | Out-String).Trim() -ne '0') { throw 'disposable database already exists' }
  createdb --maintenance-db postgres --encoding UTF8 -- $redDb
  if ($LASTEXITCODE -ne 0) { throw 'disposable database creation failed' }
  $created = $true
  $env:REQUIRE_PLAN5_POSTGRES = '1'
  npx vitest run --configLoader bundle --reporter=json --outputFile $report `
    tests/release/releaseManifestLifecycle.acceptance.test.ts `
    tests/release/releaseManifestStore.acceptance.test.ts `
    tests/release/productionReleaseEvidence.acceptance.test.ts `
    tests/release/productionReleaseEvidence.postgres.test.ts
  if ($LASTEXITCODE -eq 0) { throw 'Task 8B frozen batch unexpectedly GREEN' }
  $json = Get-Content -Raw -Encoding UTF8 $report | ConvertFrom-Json
  $assertions = @($json.testResults | ForEach-Object { $_.assertionResults })
  $required = '[REQ-38][TASK8B-PG-RED] runs the frozen PostgreSQL RED case on an exact disposable non-production database with required execution report hash and cleanup'
  $pgAssertions = @($assertions | Where-Object { $_.fullName -eq $required })
  if ($pgAssertions.Count -ne 1) { throw 'required PostgreSQL RED assertion missing or duplicate' }
  if ($pgAssertions[0].status -ne 'failed') { throw 'required PostgreSQL assertion did not produce behavioral RED' }
  if (($pgAssertions[0].failureMessages -join "`n") -notmatch 'Plan 5 feature missing') {
    throw 'PostgreSQL RED failure fingerprint is not behavioral'
  }
  $pgFiles = @($json.testResults | Where-Object { $_.name -like '*productionReleaseEvidence.postgres.test.ts' })
  if ($pgFiles.Count -ne 1) { throw 'PostgreSQL RED file missing or duplicate' }
  $pgFileAssertions = @($pgFiles[0].assertionResults)
  if ($pgFileAssertions.Count -eq 0 -or @($pgFileAssertions | Where-Object { $_.status -in @('pending','skipped','todo','disabled') }).Count -ne 0) {
    throw 'PostgreSQL RED assertion skipped'
  }
  $reportSha = (Get-FileHash -Algorithm SHA256 $report).Hash.ToLowerInvariant()
}
finally {
  if ($created) {
    dropdb --if-exists --maintenance-db postgres -- $redDb
    if ($LASTEXITCODE -ne 0) { throw 'disposable database cleanup failed' }
  }
  $remaining = psql -d postgres -X -A -t -v ON_ERROR_STOP=1 `
    -c "SELECT count(*) FROM pg_database WHERE datname = '$redDb'"
  if (($remaining | Out-String).Trim() -ne '0') { throw 'disposable database remains after RED' }
  $cleanupVerified = $true
  Remove-Item Env:REQUIRE_PLAN5_POSTGRES -ErrorAction SilentlyContinue
  Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
}
if (-not $reportSha -or -not $cleanupVerified) { throw 'Task 8B RED evidence incomplete' }
[ordered]@{
  version = 'task8b-red-evidence-v1'
  candidateSha = (git rev-parse HEAD).Trim().ToLowerInvariant()
  databaseName = $redDb
  databasePort = $redPort
  requirePlan5Postgres = $true
  postgresAssertionsExecuted = $pgFileAssertions.Count
  skippedPostgresAssertions = 0
  vitestReportSha256 = $reportSha
  cleanupDatabaseCount = 0
} | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 `
  (Join-Path $env:PLAN5_ARTIFACT_ROOT 'task8b-red-evidence-v1.json')
```

**Expected RED:** guarded dynamic imports convert each missing V2 capability to
the named behavioral assertion `Plan 5 feature missing`; the suite itself still
loads normally. Syntax, unhandled import-resolution, fixture, type or
environment errors are not acceptable RED. The PostgreSQL test must execute,
not skip, on the exact local disposable database and non-55999 port. The
`finally` path drops that exact database even when RED, verifies its catalog
count is zero, and immutable evidence records the Vitest JSON report hash plus
the cleanup receipt. No raw database credential is written to command
arguments or artifacts.

**Commit:** `test: define release manifest v2 lifecycle acceptance`

Then clean worktree, spec-review proving every audit finding has an exact
test, code-quality review proving no assertion manufactures a final manifest,
and forbidden-scope audit.

#### Task 8B.2 — Implement V2 types and pure reducer

**Files:**

- Create: `src/release/remediationReleaseManifestV2.ts`.
- Frozen Task 8B.1 files: run only; no edits. If helper coverage is needed,
  create an explicitly non-frozen `tests/release/remediationReleaseManifestV2.unit.test.ts`.

Implement:

- strict parsing of the §2.2 V2 contracts and exact key sets;
- discriminated bootstrap-vs-frozen root-writer lease/takeover/terminal types,
  lease-bound production preclaim and `recovery_only` operation/failure branch;
- `reduceManifestTransition(current, transition, verifiedGateOutputs,
  verifiedTransitionEvidence)` as a pure function with the sole state order
  specified above; non-failure transitions require an empty transition set,
  while failure/rollback require their exact discriminated tuples;
- revision, previous hash, latest receipt, transition id, stable-freeze/root/
  candidate invariants and fresh operational-attestation compatibility;
- pending, passed/failed execution and non-executed blocked records;
- gate/evidence-kind-discriminated production failure codes and the three
  honest rollback-window preconditions, including exact abandoned-lineage
  recovery failure but no recovery-derived gate success;
- recursive secret rejection and exact REQ/AC/gate sets.

The reducer receives already-verified typed outputs. It performs no filesystem,
Git, process, DB, network or time calls. `updatedAt` is an injected exact ISO
value. It never accepts free evidence or gate ids.

RED/GREEN:

```powershell
npx vitest run --configLoader bundle `
  tests/release/releaseManifestLifecycle.acceptance.test.ts `
  -t "MANIFEST-V2-INIT|MANIFEST-V2-TRANSITIONS|MANIFEST-V2-PENDING"
npm run typecheck
```

**Expected GREEN:** init/order/pending cases pass; later filesystem and
production-policy tests remain RED until their owning tasks.

**Commit:** `feat(release): define manifest v2 lifecycle`

Then clean worktree, separate state-machine spec-review and type/security
quality review.

#### Task 8B.3 — Implement sole CAS writer and crash-safe store

**Files:**

- Create: `src/release/releaseRootWriterStore.ts` — the one fixed root-writer
  lease/CAS shared by freeze, manifest, authority issue and terminalization.
- Create: `src/release/releaseManifestStore.ts`.
- Create: `scripts/advanceRemediationReleaseManifest.ts`.
- Create: `scripts/takeoverManifestLease.ts`.
- Modify: `package.json` — add only:

  ```json
  "release:manifest:advance": "node --import tsx scripts/advanceRemediationReleaseManifest.ts",
  "release:manifest:takeover": "node --import tsx scripts/takeoverManifestLease.ts"
  ```

- Frozen `tests/release/releaseManifestStore.acceptance.test.ts`: run only; no
  edits. Injection seams belong in production code or an explicitly non-frozen
  `tests/release/releaseManifestStore.unit.test.ts`.

The CLI accepts exactly three positionals:

```text
release:manifest:advance <allowlisted-transition> <expected-source-sha256|absent> <protected-artifact-root>
release:manifest:takeover <expected-old-lease-sha256> <protected-artifact-root>
```

No optional candidate, gate, evidence, command or individual artifact path is
accepted. Candidate is exact clean Git `HEAD`; dirty worktree fails before
claim. Root is absolute/outside repository/non-symlink/restrictive and its
fingerprint must equal `ReleaseFreezeIdentityV2` for every manifest/frozen
operation. Bootstrap takeover occurs before that identity exists and instead
must match exact protected-root/Task0B-preflight/candidate/runtime bindings.

For transitions requiring operational authority, the writer starts from the
exact fixed policy filename or the generation recorded by the single consumed
attestation. Discovery is deterministic: its `generationId` must equal the one
`releaseGenerationId` frozen for the root. A second generation, unconsumed,
foreign or incompatible authority fails and seals the root; directory order or
newest timestamp never selects an authority. The same operation/generation can
resume only from its exact owned durable prepared/receipt state.

Store protocol:

1. acquire the one fixed root-wide exclusive
   `manifest-transition-root.lease.json` first through
   `releaseRootWriterStore`; its payload carries the typed writer operation
   kind/key and a transition key only for manifest writes, but its filename is
   never keyed. Freeze materialization, manifest transition, authority issue and
   authority terminalization all use this store; no separate lock is permitted.
   Only while a manifest transition holds it, require
   `production-operation-root.lease.json` absent, then create the generation-
   bound exclusive claim. A live lease blocks every other writer operation
   before it can create a claim or publish prepared bytes;
2. validate/open every path with the portable component `lstat` + canonical
   containment + pre/post `fstat` identity protocol in §2.2; POSIX may add
   `O_NOFOLLOW`, Windows rejects junction/reparse substitution. Require exact
   expected source SHA or exact absence;
3. derive a deterministic `transitionKeySha256` from candidate, source hash,
   transition, root, release-freeze hash and, for G12-G15, the single relevant
   consumed operational-attestation hash;
4. resolve fixed evidence policy, verify actual bytes, and run pure reducer;
5. choose `committedAt`, build/serialize the exact canonical committed receipt,
   put its exact hash into the target manifest, then write/fsync immutable gate
   outputs, target snapshot and `PreparedManifestTransitionV2` containing both
   receipt object and exact UTF-8 bytes before any manifest replace;
6. while still owning the lease, re-read source bytes, repeat CAS and require
   the fixed production-operation lease still absent;
7. write/fsync a same-directory temporary current manifest and atomically
   replace `release-manifest.json`; this replace is the only commit point;
8. after replace, write/fsync the receipt file from prepared bytes only, verify
   byte/hash equality with manifest `latestCommittedReceiptSha256`, then remove
   the owned fixed root lease.

Expired-lease takeover is a separate explicit command, never an implicit
branch of `advance`. The parser first selects exactly one discriminated branch:
bootstrap lease/takeover/terminal with null freeze/generation, or frozen lease/
takeover with non-null immutable freeze/generation. Cross-branch artifacts fail
closed. Both branches use the same old-hash/epoch fencing protocol:

1. rerun the artifact-root trust-boundary guard, open the one fixed lease, and
   require its actual bytes hash to equal the operator-supplied
   `expected-old-lease-sha256`; require either exact bootstrap root/preflight/
   candidate/runtime or exact frozen root/generation/freeze plus typed writer
   operation kind/key (and transition key for manifest), expired
   absolute/heartbeat deadlines and dead PID/start identity to match. A live,
   unexpired, foreign-generation, second/multiple or otherwise ambiguous lease
   fails closed without mutation;
2. derive `newLeaseEpoch = oldLease.leaseEpoch + 1`, serialize the exact
   canonical replacement lease once, and write/fsync
   the exclusive old-hash-addressed discriminated
   `PreparedBootstrapRootWriterLeaseTakeoverV2` or
   `PreparedFrozenRootWriterLeaseTakeoverV2` containing the
   old hash/owner identity and the replacement object, exact UTF-8 bytes and
   hash; an existing conflicting prepared file fails closed;
3. re-read and revalidate the old lease hash, epoch and owner, then perform a
   no-overwrite atomic move to the content-addressed old-lease tombstone. If
   the platform/filesystem cannot guarantee no-overwrite movement inside the
   verified trust boundary, fail closed and require a manually created new
   protected root. On replay, exactly one of fixed old lease or matching
   tombstone identifies the boundary; a matching tombstone continues, while
   both, neither or conflicting bytes fail closed;
4. create the fixed lease path with `O_EXCL` from prepared bytes only, verify
   object/bytes/hash/epoch equality, then write/fsync the matching content-
   addressed bootstrap or frozen takeover receipt. Exact replay recognizes and completes crashes
   before/after prepared, tombstone, new-lease and receipt boundaries; it never
   deletes an unrecognized artifact, invents a lease or changes canonical
   bytes. A later process may install the already-prepared canonical lease or
   finalize its missing receipt, but neither action transfers the canonical
   lease's recorded PID/start ownership to that later process;
5. both old and replacement owners re-read the fixed lease and prove their
   exact lease hash and epoch immediately before every external effect and
   immediately before manifest replace. A fenced old owner performs no effect,
   observation-derived write or manifest transition;
6. after the takeover receipt is durable, only the still-live process whose
   PID/start is recorded in the replacement lease resumes the one exact
   already-prepared operation to its normal commit/receipt boundary. If a later
   replay process installed that prepared lease, or the recorded owner crashed
   before completing the operation, replay first completes the exact takeover
   receipt, remains fenced from effects, and requires a second explicit
   takeover of that now-current dead lease hash to create its current epoch +
   1. No process inherits another PID/start-bound lease and no `advance` call
   bypasses takeover. For bootstrap only, an exact durable
   `PreparedReleaseFreezeMaterializationV2` permits byte-exact freeze/receipt
   publication. Without that prepare, the new owner writes
   `BootstrapRootTerminalAbandonedV2`, removes only its exact bootstrap lease,
   seals this root and requires a new protected root; it cannot start a new
   prepare or synthesize freeze identity.

A crash before replace leaves the previous manifest authoritative; exact replay
of the same generation uses claim/prepared/snapshot and completes once. A crash
after replace but before receipt file creation restores that one byte-exact
receipt only from durable prepared bytes and confirms its precommitted hash;
time, reducer and serializer are not rerun. A completed replay returns the
existing exact bytes and never rewrites.

| Existing state | Liveness/TTL rule | Recovery |
|---|---|---|
| bootstrap lease only, no prepared freeze | exact root/preflight/candidate/runtime, expired dead owner | explicit bootstrap takeover writes terminal-abandoned, removes exact lease, seals root; retry only in a new protected root |
| bootstrap lease + exact prepared freeze, publication incomplete | exact prepared canonical freeze/receipt bytes and expired dead owner | explicit bootstrap takeover resumes only byte-exact remaining freeze/receipt publication, including crash after prepare before receipt |
| fixed root lease only, no claim/operation-prepared/receipt | heartbeat ≤10 seconds, rolling lease ≤60 seconds, absolute operation ≤5 minutes | live lease blocks all transition keys; dead/expired owner seals root because no exact resumable operation exists |
| fixed root lease + claim, no operation-prepared/receipt | claim ≤2 minutes and exact PID/start plus lease heartbeat prove live ownership | live owner blocks; dead/expired owner seals root rather than guessing work state |
| exact operation prepared + expired dead-owner lease | old lease actual hash/epoch/owner, frozen generation and prepared operation must all match | only explicit `release:manifest:takeover` may install epoch+1 through prepared takeover, tombstone and receipt |
| operation prepared + current owned lease hash/epoch | exact claim/root-lease ownership, canonical operation bytes/hash and source CAS required | resume the one prepared operation; revalidate fence before every effect and replace |
| manifest replaced, receipt missing | target full hash/projection and prepared receipt object/bytes/hash must match; live owner resumes or expired dead owner first completes exact takeover | write the one exact prepared receipt; no time/reducer/serializer rerun |
| committed receipt present | receipt hash, previousReceipt hash and manifest latest hash must agree | return byte-identical result |
| incompatible durable state or terminal lifecycle/store/authority/security/path-identity failure | never eligible | fsync terminal-abandoned marker; seal root; no blind delete/takeover/new generation |

Every receipt after revision 1 requires `previousReceiptSha256` equal to source
manifest `latestCommittedReceiptSha256`; revision 1 uses null. Claim/lease/
prepared artifacts use the exact filenames in §2.2 and are schema-validated
before any liveness decision. The store never creates a replacement generation
or copies mutable artifacts to a new root; new-root recovery is a separate
manual release start.

RED/GREEN:

```powershell
npx vitest run --configLoader bundle `
  tests/release/releaseManifestStore.acceptance.test.ts
npm run typecheck
```

**Expected GREEN:** bootstrap/frozen discrimination, crash after bootstrap lease
before prepare seals/new-root, crash after prepare before freeze receipt resumes
byte-exactly; CAS plus competing-different-transition and cross-kind
freeze/manifest/issuer/terminalizer root-writer lock,
replace-before-receipt byte-exact recovery, single-generation resume/seal,
explicit expired dead-owner takeover and old-owner hash/epoch fencing pass.
Crash replay covers each prepared/tombstone/new-lease/receipt boundary.
After a crash following prepared creation, a later process that installs the
canonical dead-owner lease, or a process arriving after new-lease creation,
may finish only that takeover boundary/receipt; it proves it is fenced until it
explicitly takes over the current dead lease into the next epoch.
Trusted-principal-policy preflight accepts only normalized service-account/
LocalSystem/BUILTIN-Administrators (or exact configured set) and rejects
Everyone/Users/foreign writable ACEs, unsupported filesystems and raw-principal
artifact leakage. Pre-existing/detectable POSIX-symlink/Windows-junction/
reparse substitution tests pass on injected temp roots. If required
identity or no-overwrite movement cannot be established, the test expects
fail-closed/manual-new-root; no test claims undetectable malicious
same-principal race defense and no production or repository root is mutated.

**Commit:** `feat(release): advance manifest atomically`

Then clean worktree, spec-review of commit point/recovery/takeover/fencing and
separate filesystem/security quality review.

#### Task 8B.4 — Bind exact G00–G11 evidence policies

**Files:**

- Create: `src/release/releaseGateEvidencePolicy.ts`.
- Modify: `src/release/remediationReleaseManifestV2.ts`.
- Modify: `scripts/advanceRemediationReleaseManifest.ts`.
- Modify: `scripts/verifyRemediationRelease.ts`.
- Modify: `scripts/captureTask0BPreflight.ts` — evidence capture only.
- Create: `scripts/materializeReleaseFreeze.ts` — sole freeze producer.
- Create: `scripts/issueOperationalAttestation.ts` — sole append-only authority
  issuer and selector-backed producer.
- Create: `scripts/terminalizeExpiredUnclaimedAuthority.ts` — sole zero-effect
  authority terminalizer.
- Create: `src/release/releaseAuthorityStore.ts`.
- Modify: `package.json` with exactly:

  ```json
  "release:freeze:materialize": "node --import tsx scripts/materializeReleaseFreeze.ts",
  "release:authority:issue": "node --import tsx scripts/issueOperationalAttestation.ts",
  "release:authority:terminalize": "node --import tsx scripts/terminalizeExpiredUnclaimedAuthority.ts"
  ```
- Frozen Task 8B.1 files: run only; no edits. Non-frozen policy helper coverage,
  if required, goes only in `tests/release/releaseGateEvidencePolicy.unit.test.ts`.

Implement the G00–G11 rows in §3 as an exhaustive
`Record<PreReleaseGateId, GateEvidencePolicyV2>`. No G12–G15 placeholder,
cast or default policy exists. Each policy has exact primary
filenames, derived supporting filename grammar, schema validators, candidate/
root/release-freeze bindings, required evidence kinds and canonical ordering.
No expiring operational attestation is required for G00-G11. G07 keeps
clean and production-clone refs distinct. G10 is tagged
`scope: "pre_go_rehearsal"` and cannot satisfy actual rollback.

Task 8B.4 nevertheless implements the Task8B-owned future-action producers.
`captureTask0BPreflight` can only write verified redacted evidence.
`release:freeze:materialize` accepts only the protected root, resolves the
allowlisted preflight path, validates candidate/root/DB/tool/runtime/rollback/
trusted-principal-policy bindings, acquires the discriminated bootstrap lease,
fsyncs `PreparedReleaseFreezeMaterializationV2`, then creates the canonical
freeze and materialization receipt with `O_EXCL` from prepared bytes only.
Dead-owner bootstrap without prepare is terminal/new-root; with exact prepare
it resumes remaining publications byte-exactly. Materialization, authority issue and authority
terminalization all use the existing fixed root-writer lease/CAS store; their
typed operation key serializes them with manifest and every other root writer.
`release:authority:issue` accepts only one allowlisted
transition token plus protected root, derives generation/candidate/source/
command/template/TTL and any recovery lineage from actual immutable files, and
first fsyncs a content-addressed prepared issuance containing canonical
attestation/receipt objects, bytes, hashes, paths and one timestamp. It then
publishes those exact attestation and issuer-receipt bytes with `O_EXCL`, then
publishes the committed issuance marker. Restart at every prepare/attestation/
receipt/before-committed-marker boundary completes only that
prepared issuance, with no new clock read or alternate tip. Before a new
prepare, one unresolved compatible prepare is resumed and multiple/conflicting
prepares fail closed. Only after the committed marker is fsynced may the exact
owned root-writer lease be removed. It never accepts an
expiry, source hash, prior hash or terminal lineage from the operator.

The authority selector scans the allowlisted action+generation directory,
validates one complete previous-receipt/previous-attestation chain and returns
exactly one active compatible unconsumed tip. Branches, gaps, multiple active
tips, swapped bytes and recovery issuance without prior terminal cleanup fail
closed. Consumed/expired files are never overwritten or deleted. Before
replacing an authority that expired without a claim, the operator invokes the
allowlisted terminalizer, which holds that same root-writer lease, fsyncs the
canonical prepared terminal record and publishes the exact committed terminal
receipt only after proving expiry and absence of every preclaim/claim,
consumption, action lease, G13 bound DB session/advisory lock, operation and
effect artifact. The replacement's terminal-lineage hash must reference that
receipt. Only after that receipt is fsynced may the exact owned root-writer
lease be removed. Early terminalization or any conflicting artifact rejects
replacement rather than guessing ownership.
G01 additionally validates the actual Task 8B RED JSON hash, exact PostgreSQL
test fullName, zero skipped PostgreSQL assertions and exact disposable-database
cleanup evidence; a source-only or non-PostgreSQL RED cannot substitute it.

`pre_manual` validates all automated evidence, creates passed G00–04/G06–11,
and creates only pending G05/G12–15. `readiness` accepts the same source bytes
plus finalized exact 15/19/11 manual evidence and passes G05. No other evidence
is reinterpreted or rewritten.

`release:verify` gains V2 semantic validation but remains byte-for-byte
read-only. The acceptance test hashes the complete artifact tree before and
after verification and requires equality.

RED/GREEN:

```powershell
npx vitest run --configLoader bundle `
  tests/release/releaseManifestLifecycle.acceptance.test.ts `
  tests/release/remediationReleaseManifest.acceptance.test.ts `
  tests/release/manualTelegramEvidence.acceptance.test.ts
npm run typecheck
```

**Expected GREEN:** G00–G11 policy/forged/read-only cases pass; G12–G15 cases
remain owned by later tasks. Freeze materializer, byte-exact prepared issuer
crash replay/committed marker, competing-writer exclusion, selector, prepared/
committed expired-unclaimed and operation terminal recovery and trusted-
principal frozen tests are GREEN.

Use two bounded commits: `feat(release): materialize freeze and issue authority`
then `feat(release): bind pre-release gate evidence`, each with clean worktree
and separate spec/security quality review.

Then clean worktree, exact-policy spec-review and separate secret/path/
read-only quality review.

#### Task 8B.5 — Bind G12 backup and G13 migration transitions

**Files:**

- Modify: `src/release/releaseGateEvidencePolicy.ts`.
- Modify: `src/release/remediationReleaseManifestV2.ts`.
- Modify: `scripts/advanceRemediationReleaseManifest.ts`.
- Modify: `tests/release/productionBackup.acceptance.test.ts` only to expose
  existing actual-byte fixtures; producer semantics stay unchanged here.
- Modify: `tests/release/schema032Release.acceptance.test.ts` only to expose
  existing complete sequence fixtures.
- Modify: `scripts/runSchema032ReleaseSequence.ts` to persist the durable G13
  execution receipt and typed failure execution input.
- Frozen Task 8B.1 files: run only; no edits.

Task 8B.5 extends the pre-release policy map only as
`Record<PreReleaseGateId | "G12_PRODUCTION_BACKUP" |
"G13_PRODUCTION_MIGRATION", GateEvidencePolicyV2>`. It does not claim a full
`ReleaseGateId` record until Task 8B.6 supplies G14/G15.

G12 policy starts only from exact `readiness` V2 bytes and binds:

- chain-stable release freeze plus the append-only selector's unique compatible
  backup attestation tip, validated fresh/unconsumed before the single atomic
  consumption claim and revalidated as
  unexpired with the owned backup lease before every dump/list effect and
  settlement;
- exactly one consumption claim plus dump and list progress for its generation;
- successful final evidence requires the operation lease to be absent because
  the producer deletes its owned lease after completion;
- `production-backup-evidence.json`;
- actual `production-backup.dump` and restore-list bytes, size/hash/count;
- candidate, root, release-freeze identity, production DB identity and source
  manifest hash.

The policy has no duplicate “claim” kind: the authority consumption is the one
claim. Every artifact uses the freeze's one release generation; any second or
incompatible generation seals the root under Task 8B.3.

G13 policy starts only from exact G12 target bytes and binds:

- schema operational attestation selected from the validated linear issuer
  chain as the unique compatible tip, validated fresh/unconsumed before its
  atomic claim/consumption and revalidated as unexpired with the exact DB session/
  advisory-lock ownership before every migration/verification query and
  settlement;
- exact G12 transition receipt and backup bytes;
- on success, the exact ordered four-stage tuple: first migration, first
  verification, second already-verified migration and final verification;
- exact migration filename/full bytes checksum/full receipt checksum,
  postconditions, production DB identity and the successful
  `schema032-production-execution-receipt-v2.json`, including lock key/session
  and acquired/released times.

No singleton V1 migration hash is read. `g12_backup_passed` and
`g13_migration_passed` both produce `overall=not_ready`.
The G13 RED/GREEN batch also proves that the schema producer always closes the
advisory-lock interval and writes the durable execution receipt after an
attempt. Each `failed_after_attempt` branch names one `failedStep`, contains
only the exact ordered receipts for earlier completed stages and carries the
matching typed failure artifact at its one allowlisted `schema032-failures/*`
relative path; later-stage fields/hashes are forbidden. Exact-path resolution
uses the portable §2.2 component/containment/identity protocol, hashes actual
regular-file bytes and rejects swapped/foreign/missing/symlink/junction
artifacts. A missing producer receipt, session hash or lock release blocks typed failure
derivation; any non-success result, missing success-stage member or invented
failure-stage hash blocks G13.

RED/GREEN:

```powershell
npx vitest run --configLoader bundle `
  tests/release/releaseManifestLifecycle.acceptance.test.ts `
  tests/release/productionBackup.acceptance.test.ts `
  tests/release/schema032Release.acceptance.test.ts `
  -t "G12|G13|MANIFEST-V2-EVIDENCE"
npm run typecheck
```

**Expected GREEN:** every actual-byte binding passes; missing/swapped/stale/
foreign sequence member fails closed.

**Commit:** `feat(release): bind backup and migration transitions`

Then clean worktree, production-order spec-review and separate backup/schema
security quality review. No producer is run against production.

#### Task 8B.6 — Implement G14, G15, abandoned recovery and actual rollback orchestrators

**Files:**

- Create: `scripts/executeProductionRollout.ts`.
- Create: `scripts/executeProductionCanary.ts`.
- Create: `scripts/executeProductionRollback.ts`.
- Create: `scripts/executeProductionRecovery.ts`.
- Create: `scripts/takeoverProductionOperationLease.ts`.
- Create: `scripts/takeoverCleanupOnlyProductionOperationLease.ts`.
- Create: `src/release/productionOperationStore.ts`.
- Frozen Task 8B.1 acceptance/PostgreSQL files: run only; no edits.
- Modify: `src/release/releaseGateEvidencePolicy.ts`.
- Create: `src/release/releaseTransitionEvidencePolicy.ts`.
- Modify: `src/release/remediationReleaseManifestV2.ts`.
- Modify: `package.json` with only the four exact sole-orchestrator commands
  and their two capability-separated explicit lease-takeover commands:

  ```json
  "release:production:rollout:execute": "node --import tsx scripts/executeProductionRollout.ts",
  "release:production:canary:execute": "node --import tsx scripts/executeProductionCanary.ts",
  "release:production:rollback:execute": "node --import tsx scripts/executeProductionRollback.ts",
  "release:production:recovery:execute": "node --import tsx scripts/executeProductionRecovery.ts",
  "release:production:lease:takeover": "node --import tsx scripts/takeoverProductionOperationLease.ts",
  "release:production:lease:cleanup-only-takeover": "node --import tsx scripts/takeoverCleanupOnlyProductionOperationLease.ts"
  ```

Task 8B.6 adds G14/G15 and only now exports the exhaustive
`Record<ReleaseGateId, GateEvidencePolicyV2>`; compile-time exact keys reject
missing, placeholder or extra policies.
Separately, it exports an exhaustive transition-evidence policy only for
`production_failed` and `rollback_rolled_back`. It resolves the two fixed
transition paths/kinds/hashes, never returns `GateEvidenceRefV2`, and requires
the committed receipt/manifest typed transition refs to match actual bytes.
Each transition artifact binds only its already-existing source manifest; it
never references the target manifest or target receipt, so the writer sequence
has no circular gate dependency.

All four scripts accept only the protected artifact root and are the sole
entry points for their production phase. Before the first effect or
observation, each revalidates the actual V2 source manifest/receipt/freeze,
validates the issuer chain and selects exactly one phase attestation as the
exact fresh compatible unconsumed tip,
acquires the fixed production-operation lease, persists the immutable preclaim
bound to that original lease hash/epoch/owner/operation, then atomically persists
claim plus consumption with exact operation/root/generation/candidate/source/
command/template and resolved original→current-tip lease-lineage ownership. No
preclaim exists outside its original lease
and no consumed state exists before the claim. Only the exact claim/current lease owner may execute its fixed step
sequence, and it revalidates current lease hash/epoch,
`now < consumedAuthority.expiresAt` and
`now < immutable operationDeadlineAt` before every
effect/query/reconciliation/settlement.
Their production implementations create the exact exclusive manager/query/log
capture files listed in §2.7 directly from the repo runtime manager, protected
PostgreSQL queries, bounded scheduler observations and sanitized log scanner.
They do not trust operator-authored capture JSON and expose no leaf
stop/start/query command to the operator. Tests inject observers that emit the
same typed schemas against sanitized fixtures. No free PID, URL, DB, SHA,
command, evidence path or pass/fail string is accepted.
The PostgreSQL branch uses only exact
`tron_watch_plan5_runtime_sanitized`, requires `REQUIRE_PLAN5_POSTGRES=1`,
recording-disabled Telegram and deterministic synthetic rows.

Task 8B.6 implements the full §2.7 ownership store: one fixed root-wide
production-operation lease, lease-bound preclaim, attestation-hash-addressed
claim/atomic consumption with original→current-tip lineage, durable pre-effect
step intents, operation-bound step receipts, settlement/removal-prepare/byte-
exact-receipt/cleanup and explicit lease takeover. The takeover CLI accepts only expected old lease SHA-256 and
protected root. The normal CLI verifies dead PID/start plus lease expiry, both
strict authority/deadline bounds and exact operation/
root/generation/candidate/source/authority bindings; fsyncs old-hash-addressed
`PreparedProductionOperationLeaseTakeoverV2`; performs no-overwrite tombstone
move and `O_EXCL` canonical epoch+1 lease; then fsyncs
`CommittedProductionOperationLeaseTakeoverV2`. The same root-trust model and
multi-epoch replay/fencing rules as manifest takeover apply. Post-claim
takeover carries the original authority-consumption hash and never creates a
second claim. Before-claim takeover preserves the byte-identical preclaim bound
to its original lease; it never creates a replacement under the takeover lease.
Claim is legal only if the original attestation remains fresh/unconsumed,
`now < immutable operationDeadlineAt`, and an exact
`ProductionPreclaimLeaseLineageV2` append-only chain resolves every committed
old→new takeover without branch/gap/foreign binding. The first tip has null
previous lineage and empty suffix; every later tip references the previous
lineage, inherits `lineageStartedAt` and adds exactly one takeover receipt.
Before claim it O_EXCL-creates/fsyncs the latest tip artifact with one fixed
`resolvedAt`; same-tip replay is byte-exact, while a later takeover requires a
new extension and the old artifact is no longer current. Consumption and claim bind its relative
path, actual hash and current tip. Traversal/foreign path, swapped bytes/hash/
preclaim/tip or invalid chain fails closed;
normal effect-capable takeover at or beyond either strict boundary is rejected.

The separate cleanup-only CLI is legal only after authority expiry or immutable
deadline and for an expired dead-owner lease. It uses the same trusted-root,
old-hash prepare/tombstone/O_EXCL epoch+1/committed fencing, but produces only
`CleanupOnlyProductionOperationTakeoverV2` and a lease with
`capability="cleanup_only"`; the committed takeover is its sole cleanup-only
claim. It preserves nullable original consumption and both time bounds without
renewal/re-consumption. Its closed path is durable terminal abandonment,
canonical removal prepare, exact owned cleanup-only lease removal, byte-exact
receipt publication and terminal cleanup. Deadline-only abandonment while
authority remains valid uses `operation_deadline_reached`. All effects, domain
queries, reconciliation, settlement, evidence/gates/manifest advancement and
rollback steps throw before touching production state. Crash replay completes
only this closed cleanup path and leaves no live PID or fixed lease. The only
forward transition is a separate `production_recovery` operation with fresh
authority and `recovery_only` lease/preclaim/claim. It binds exact
TerminalAbandoned + terminal cleanup bytes, the contiguous immutable completed-
step prefix and the next uncertain-step marker; performs no rollout/canary/
runtime/SQL effect or uncertain-step reconciliation; emits only the
recovery-only orchestration receipt, followed by the
`abandoned_operation_recovery` branch of `ProductionFailureEvidenceV2` that
references that receipt; and
enables `production_failed`. A later rollback is another fresh-authority
operation. Cleanup capability itself never derives this evidence.

The allowlisted step ids and order are closed sets:

```text
rollout: verify_g13, verify_schema, verify_previous_runtime_identity,
         verify_singleton_precondition, stop_previous,
         prove_previous_stopped, start_candidate, prove_candidate_started,
         immediate_runtime_checks
canary : verify_g14, observe_cycle_1, observe_cycle_2,
         bounded_runtime_checks
rollback(previous_runtime_retained): verify_failure,
         prove_previous_healthy, prove_no_previous_stop,
         prove_no_candidate_start
rollback(previous_runtime_restarted_without_candidate): verify_failure,
         restart_previous, prove_no_candidate_start,
         rollback_runtime_checks
rollback(candidate_replaced_with_previous): verify_failure,
         stop_candidate, start_previous, rollback_runtime_checks
recovery: verify_abandoned_cleanup, verify_completed_prefix,
          verify_uncertain_step_intent, validate_failure_derivation_inputs
```

`consume_authority` is deliberately absent from the step list: lease-bound
preclaim and atomic claim/consumption precede every step. The rollout prefix through
`verify_singleton_precondition` is pre-effect. Any exact failure in that prefix
produces only validation receipts and a typed G14
`runtime_rollout_preflight` failure with
`attemptedExternalEffect:false`; it forbids stop/start/candidate and post-start/
canary query captures while retaining exact validation-query receipts.
Failures at or after `stop_previous` are
`attemptedExternalEffect:true` and must bind the actual ordered effect prefix.

Every completed step is fsynced as an immutable
`ProductionOrchestrationStepReceiptV2`. Before the next step, the orchestrator
validates the complete ordered prefix, including exact orchestration↔command,
step-id↔sequence, source manifest, input/output and observed-state bindings.
Before an external effect it first fsyncs the canonical
`ProductionOrchestrationStepIntentV2`; the effect-capable step receipt must
bind that actual allowlisted path/hash. Local-validation and recovery-only
receipts have null intent refs. On restart it reconciles an effect whose
process crashed before its receipt only through the fixed read-only observer
for that step, after revalidating current lease epoch,
`now < consumedAuthority.expiresAt` and
`now < immutable operationDeadlineAt`; it writes recovered completion only when the exact idempotent
post-state is proven, otherwise it fails closed. It never repeats an effect on
uncertain state. Either reached bound blocks reconciliation and cannot be
repaired by takeover or re-consumption. After the final step it fsyncs the orchestration receipt and
only then derives and emits the typed gate/transition evidence that binds that
receipt, revalidates ownership plus both strict time bounds, fsyncs settlement,
fsyncs the canonical removal prepare, removes only the exact owned current
lease, publishes the precommitted receipt bytes, then fsyncs terminal cleanup
binding settlement, prepare and receipt. Crash replay resumes at the first
missing durable boundary without regenerating `removedAt` or rewriting a valid later artifact.
Evidence derivation is not itself a
step and therefore creates no receipt/evidence hash cycle.

Recovery validates the abandoned operation's actual immutable intent and step
directories:
the completed prefix begins at sequence 1 with no gap/duplicate and hashes each
receipt byte-for-byte. If the exact next allowlisted fsynced intent exists
without a receipt, its actual path/hash is the only possible marker at sequence
`prefix.length + 1`, outcome `unknown`; without that intent, recovery must not
claim an uncertain effect. Recovery never observes, reconciles or reissues it.
Its local validation step receipts are `recovery_only`; after them it fsyncs the
overall recovery receipt, then failure evidence references that receipt, then
settlement checks `recoveryAttemptedExternalEffect=false` separately from the
prior operation's possibly true `priorAttemptedExternalEffect`. Swapped
terminal cleanup, fabricated/non-prefix intent or receipt, a second uncertain
marker, any recovery effect/query, normal gate evidence or cleanup-only
evidence derivation fails before `production_failed`.

G14 rollout orchestration requires all existing Task 12 checks:

- exact G13 manifest/receipt and schema 032 verification;
- a fresh-unconsumed G14 attestation selected before lease, then bound once by
  the original-lease preclaim and consumed only by the exact atomic operation
  claim under that lease or the verified current tip of its linear takeover
  chain;
- manager-owned `stop_previous` is allowed only from exact G13-passed state;
  direct liveness proves the previous runtime stopped before any
  `start_candidate` call; exact stop→start ordering is persisted and tested;
- exact candidate SHA/label `/version`, Admin 200, one candidate process and
  one poller/worker schedule;
- Where, Incoming, Deep/index, reconciler, delivery and allowance cycles alive;
- no raw secrets/actor ids, no duplicate delivery and unchanged terminal
  legacy population.

G15 canary orchestration selects its own fresh-unconsumed sufficiently long-
lived attestation, acquires the lease, persists the immutable original-lease-
bound preclaim and consumes it atomically at observation start under that lease
or the verified current tip of its linear takeover chain.
It requires at
least two complete polling cycles and at least 15 minutes, but no more than 30
minutes, and every Task 12 canary check: schema/version/
Admin/singleton stability, one reconciliation, bounded delivery/fingerprint,
cache-only navigation plus explicit refresh, conservative stale allowance,
unchanged terminal population, no secret/log leakage, no unexpected queue/
terminal-intent growth and honest no-final safety ceilings.

G13 sequence plus the G14 rollout and G15 canary orchestrators persist a fixed-
path typed failure evidence when their exact typed failure route is reached.
G14 pre-effect validation failure is legal after claim with
`attemptedExternalEffect:false`; all external-effect/query failure branches use
`attemptedExternalEffect:true`. `production_failed` derives the failed gate
from that validated evidence.
Its strict validator requires the exact gate-specific evidence kind and
allowlisted failure code and revalidates the referenced execution bytes;
operator-supplied gate ids, free-form reasons/codes and cross-kind evidence are
rejected. A G12 backup failure before production mutation leaves the readiness
manifest unchanged and does not enter rollback.

For G14, an exact failure in `verify_g13`, `verify_schema`,
`verify_previous_runtime_identity` or `verify_singleton_precondition` occurs
after operation claim/authority consumption but before any runtime effect. The
orchestrator persists only those actual validation step receipts, failure
evidence with `evidenceKind=runtime_rollout_preflight` and
`attemptedExternalEffect=false`, settlement, canonical lease-removal prepare,
exact prepared receipt and cleanup. The transition policy
allows `production_failed` from that evidence and rejects any stop/start/
candidate/post-start-query capture or effect-step receipt. Rollback then starts a new
operation with its own fresh rollback attestation and may emit only
`previous_runtime_retained` from exact previous-runtime health, no-stop and
no-candidate-start evidence. It never reuses the consumed G14 authority.

Actual production rollback requires a preceding `production_failed` V2 state
and a new rollback operation/authority; it never reuses rollout consumption.
G13 failure or G14 pre-effect/pre-stop failure emits
`previous_runtime_retained` and
proves the previous runtime stayed healthy without stop/start captures. G14
failure after previous stop but before candidate start emits
`previous_runtime_restarted_without_candidate`, with previous stop/restart and
proof of no candidate start. A failed candidate-start command remains in that
branch unless process/start evidence confirms the candidate actually started.
Only then may G14/G15 emit `candidate_replaced_with_previous`, requiring exact
candidate-start evidence, candidate stop and previous-runtime start. Every
branch rejects fields from another window,
retains additive schema 032, verifies version/Admin/singleton/conservative
allowance/legacy/sent/no-duplicate state and rejects `rollback-rehearsal.json`
by kind/schema/scope.
The rollback orchestrator selects a fresh-unconsumed same-generation
`OperationalAttestationV2` for `rollback_rolled_back`, acquires its lease,
persists the exact immutable original-lease-bound preclaim, then atomically
consumes it in its own claim under that lease or the verified current tip of
its linear takeover chain. It binds command id
`production_rollback`, redacted-template hash, root/candidate/source failure
manifest and previous-runtime identity, and persists the exact fixed-path
transition evidence. Missing/stale/foreign attestation fails before runtime
mutation. After the bounded rollback actions, missing/swapped/foreign evidence
fails before reducer invocation and prevents `rollback_rolled_back`; evidence
is never required before the actions that it records.

Use four small commits in this order:

1. `feat(release): orchestrate production rollout` — also owns the shared
   production-operation claim/lease/takeover/settlement/removal-prepare/receipt/
   cleanup store used by all four, immutable original-lease preclaim/linear-
   takeover lineage ownership and durable pre-effect step intents;
2. `feat(release): orchestrate production canary`;
3. `feat(release): recover abandoned production operation` — recovery-only
   typed failure translation with uncertain-effect no-replay;
4. `feat(release): orchestrate production rollback`.

After each commit run its exact `-t "G14"`, `-t "G15"`,
`-t "PRODUCTION-RECOVERY"` or `-t "PRODUCTION-ROLLBACK"` focused tests, staged-name/diff checks, clean
worktree, separate spec-review and separate quality/security review.

Final Task 8B.6 GREEN:

```powershell
$env:REQUIRE_PLAN5_POSTGRES='1'
$redPort = [int]$env:PLAN5_TASK8B_RED_PGPORT
$redDb = 'tron_watch_plan5_task8b_red'
$env:TEST_DATABASE_URL =
  "postgresql://$env:PLAN5_TASK8B_RED_PGUSER@$($env:PLAN5_TASK8B_RED_PGHOST):$redPort/$redDb"
npx vitest run --configLoader bundle `
  tests/release/productionReleaseEvidence.acceptance.test.ts `
  tests/release/productionReleaseEvidence.postgres.test.ts
npm run typecheck
```

**Expected:** all G14/G15/recovery/rollback tests GREEN without external send; exact
disposable PostgreSQL cleanup PASS. Frozen acceptance proves fresh unconsumed
authority selection, current production lease before hash/epoch/operation-bound
preclaim, atomic operation-bound consumption, orphan/foreign-preclaim rejection, swapped ownership/
epoch plus equality/beyond expiry and immutable-deadline rejection before every
effect/query/reconciliation/settlement and takeover, direct leaf
rejection, one fixed production-operation lease, crash-safe multi-epoch
takeover without re-consumption, deadlock-free mutual exclusion with manifest
lease, exact durable step receipts and terminal
settlement→removal-prepare→owned-lease-removal→byte-exact-receipt→cleanup order.
Frozen crash tests cover every boundary and prove no new clock read after
prepare. G14 pre-effect failure reaches `production_failed` and a
fresh-authority `previous_runtime_retained` rollback without any invented stop/
start/candidate capture. Bound-reached cleanup-only E2E reaches fresh recovery-
only claim, typed `production_failed` and separate rollback; crash windows
resume idempotently or fail closed without repeating uncertain effects.

#### Task 8B.7 — Require V2 verification in every production mutator

**Files:**

- Modify: `scripts/createProductionBackupEvidence.ts`.
- Modify: `scripts/runSchema032ReleaseSequence.ts`.
- Modify: `scripts/manageTask0BRuntime.ts`.
- Modify: `scripts/verifyRemediationRelease.ts`.
- Modify: `tests/release/productionBackup.acceptance.test.ts`.
- Modify: `tests/release/schema032Release.acceptance.test.ts`.
- Modify: `tests/release/task0bRuntimeManager.acceptance.test.ts`.
- Frozen Task 8B.1 files: run only; no edits.

Before ownership, each mutator/orchestrator validates exact compatible authority as
the append-only selector's unique fresh, sufficiently long-lived `unconsumed`
tip, validates its issuer chain and prepared issuance, and rejects any
`expired_unclaimed` lineage that coexists with a preclaim, claim, consumption,
action lease, G13 bound DB session/advisory lock, operation or effect artifact;
it does not call the selected tip consumed. G14/G15/rollback/recovery then
acquire the production lease, persist preclaim bound to its exact hash/epoch/
owner/operation, and atomically persist consumption in the exclusive claim;
G12/G13 retain their own existing lease/session claim order. Immediately before every
external mutation, query, reconciliation and settlement, it then verifies:

- current actual `release-manifest.json` is strict V2 and its bytes equal the
  authority/expected source hash;
- exact latest hash-chained transition receipt and immutable source snapshot;
- current release-freeze/root/candidate binding, exact immutable action claim/
  consumption and current action ownership: G12 backup lease, G13 bound DB
  session/advisory-lock interval, or G14/G15/rollback/recovery production-operation
  lease hash/epoch/PID-start;
- every action's consumed attestation satisfies
  `now < consumedAuthority.expiresAt` before each owned operation;
- G12 additionally requires its current backup lease; G13 requires its bound
  DB session/advisory-lock interval. Neither has `operationDeadlineAt`;
- only G14/G15/actual rollback/recovery additionally require
  `now < immutable operationDeadlineAt` before every effect/query/
  reconciliation/settlement and normal effect-capable takeover. Equality or
  passage of either bound fails. Neither takeover refreshes either bound,
  changes operation id or consumes replacement authority;
- full semantic evidence for the required phase, not only gate state;
- action-specific phase: readiness for backup, G12 for migration,
  G13 for candidate rollout, failed production state plus exact typed failure
  transition ref for rollback, or exact abandoned+cleanup+receipt-prefix/
  uncertain-step lineage for recovery;
- for actual rollback, one fresh same-generation attestation, allowlisted
  `production_rollback` command/template, exact root/candidate/previous-runtime
  identity selected unconsumed before lease, bound by lease-owned preclaim and
  atomically consumed by that rollback operation. After the actions and before the manifest writer,
  require `ActualRollbackTransitionEvidenceRefV2` whose referenced payload
  outcome equals target manifest `actualRollback`.

For G14/G15/actual rollback/recovery these checks are entered only through the four
Task 8B.6 orchestrators. `manageTask0BRuntime` remains an internal fixed-step
adapter and has no operator-facing production package command; direct leaf
invocation cannot satisfy or advance a production gate.
The cleanup-only takeover is the sole post-bound exception to ordinary
authority-time rejection. Its strict capability guard accepts only protected-
artifact validation plus terminal-abandonment/removal-prepare/exact-removal/
prepared-receipt/cleanup writes. Every production mutation, query,
reconciliation, settlement, evidence derivation, gate/manifest transition and
rollback action rejects `capability="cleanup_only"` before invoking an adapter.
Its completed cleanup state is never eligible evidence for a gate transition.
Only a separately fresh-authorized `recovery_only` claim may combine exact
abandonment+cleanup and immutable prefix/uncertain-marker bytes into the one
typed `production_failed` branch; it cannot run prior effects or emit pass
evidence.
They also require exact settlement, canonical lease-removal prepare, byte-exact
prepared removal receipt and terminal-cleanup bytes in that order and absence
of the fixed production-operation lease before any G14/G15/failure/rollback
manifest transition. G14
`runtime_rollout_preflight` failure is accepted only with
claim/consumption, pre-effect validation receipts,
`attemptedExternalEffect:false` and no runtime-effect captures.

V1, fixture-like hand-written V2, missing gate output, arbitrary evidence hash,
stale receipt, changed freeze/root, stale or foreign action attestation,
out-of-order transition and verifier-only
status object all fail before claim and before mutation. Existing authority
TTL, lease, exact DB/runtime binding and secret handling remain stricter and
are not weakened.
The failure path also validates the exact `failedGateId` + `evidenceKind` +
allowlisted `failureCode` branch and rejects a failure artifact whose failed
step, source manifest, candidate, freeze or referenced execution hash differs.
It also resolves the G13 `failureArtifact.relativePath` from `failedStep`
instead of accepting an operator-supplied filename.
The reducer, verifier and every rollback mutator reject missing, swapped,
consumed-before-claim, duplicate-consumption, stale-at-claim, expired-before-
effect/query/reconciliation/settlement, deadline-equal/deadline-exceeded or
foreign operation/lease/transition refs and reject
receipt transition refs that differ from manifest/actual bytes.

`release:verify` supports only read-only phase checks. It never invokes the
writer and never changes manifest `overall`. Its exact phase allowlist is
`manifest | pre-manual | readiness | g12 | g13 | g14 | released | rolled-back`.

RED/GREEN:

```powershell
npx vitest run --configLoader bundle `
  tests/release/releaseManifestLifecycle.acceptance.test.ts `
  tests/release/productionBackup.acceptance.test.ts `
  tests/release/schema032Release.acceptance.test.ts `
  tests/release/task0bRuntimeManager.acceptance.test.ts `
  -t "PRODUCTION-MUTATOR-V2|forged|manifest|authority|phase"
npm run typecheck
```

**Expected GREEN:** all mutators reject structural-only authority and accept
only the exact fully verified V2 phase under injected non-production tests.

**Commit:** `fix(release): require verified manifest transitions for production`

Then clean worktree, production-authority spec-review and independent
security/code-quality review.

#### Task 8B.8 — Runbook, full verification and Task 8 completion

**Files:**

- Modify: `docs/superpowers/verification/plan5-release/README.md`.
- Modify: `docs/knowledge/09-current-decisions.md`.
- Modify: `docs/knowledge/12-runbooks.md`.
- Modify `docs/knowledge/10-open-problems.md` or
  `docs/knowledge/13-agent-observations.md` only if a genuinely new unresolved
  or repeated issue remains; do not overwrite user-owned lines.

Replace every instruction to “build/update manifest” manually with exact
`release:manifest:advance` calls and the expected source SHA chain. State that
`release:verify` is byte-identical/read-only. Document exact G14/G15/recovery/rollback
`:execute` orchestration order, forbid direct leaf stop/start/query commands,
document selection→original production lease→immutable original-lease-bound
preclaim→exact committed takeover-lineage resolution→atomic claim/consumption,
branch/gap/swapped/foreign lineage and orphan-preclaim rejection, durable step-
intent-before-external-effect ordering, strict authority-expiry plus
immutable-deadline checks only for G14/G15/recovery/actual-rollback leaves and
normal takeover, the discriminated bootstrap/frozen fixed root-writer
serialization of freeze/manifest/prepared issuer/
expired-unclaimed terminalizer, byte-exact issuer crash replay, production-
operation lease/takeover and settlement→prepared-removal→lease-removal→byte-
exact-receipt→cleanup recovery. State that dead bootstrap before freeze prepare
seals the root and requires a new protected root, while an exact prepared
freeze is resumed byte-for-byte and both successful paths remove the fixed
root-writer lease. State that recovery-only translates exact
abandonment+cleanup+completed-prefix/actual-intent-backed uncertain-marker
lineage through typed local step receipts and an overall receipt created before
referencing failure evidence to `production_failed`, emits no normal gate
evidence and never observes,
reconciles or replays the uncertain effect. Also document the G14
pre-effect failure path;
state that no production command was executed. Keep the unmarked runtime
blocker explicit.

Focused and full GREEN:

```powershell
npx vitest run --configLoader bundle `
  tests/release/releaseManifestLifecycle.acceptance.test.ts `
  tests/release/releaseManifestStore.acceptance.test.ts `
  tests/release/productionReleaseEvidence.acceptance.test.ts `
  tests/release/productionReleaseEvidence.postgres.test.ts `
  tests/release/remediationReleaseManifest.acceptance.test.ts `
  tests/release/productionBackup.acceptance.test.ts `
  tests/release/schema032Release.acceptance.test.ts `
  tests/release/task0bRuntimeManager.acceptance.test.ts
npm run typecheck
node node_modules/vitest/vitest.mjs run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000
npx vitest run --configLoader bundle `
  tests/monitor/addressPoisoning.test.ts `
  tests/monitor/addressPoisoningWorker.test.ts `
  tests/alerts/addressPoisoningAlert.test.ts
git diff --check
```

Also require exact disposable PostgreSQL cleanup, Plan 5 scope audit, no
Address Poisoning diff, no migration 032 byte change/no migration 033, feature
worktree clean, and main 13 dirty paths/four stash hashes unchanged.

**Commit:** `docs: document manifest v2 release lifecycle`

After the commit run whole-plan spec-review and independent operational/
security code-quality review. Task 8 becomes complete only when both reviews
PASS and every Task 8B focused/full check is GREEN. Task 9 still requires a
current operational-preflight revalidation against the existing immutable
`ReleaseFreezeIdentityV2` and separate resolution of the unmarked-runtime
blocker. It must not recreate the freeze; G12-G15 later consume their own fresh
action-specific `OperationalAttestationV2` only after sole-issuer append and
unique-compatible-tip selection.

### Task 9 — Freeze candidate and execute all pre-release gates

**Code/docs changes:** none after freeze. **Commit:** none.

At Task 9 entry, revalidate Task 0B operational/release preflight for the
then-current runtime against the existing immutable
`ReleaseFreezeIdentityV2`, its canonical materialization receipt and the exact
trusted-principal policy/hash; do not recreate or refresh the freeze. The verifier
requires evidence for the
exact previous runtime SHA/label, allowlisted start/stop command IDs and
redacted-template hashes, production DB/schema state, rollback
worktree/command, `pg_dump`/`pg_restore`, protected artifact root and isolated
port. If any field is absent, stale or unverified, Task 9 stops before setting
`RELEASE_SHA`; no pre-manual gate may run and `ready_for_release` remains
impossible. It also requires the fixed root-writer lease absent, no unresolved
prepared authority issuance/terminalization, and every committed authority
chain artifact byte-valid; Task 9 never repairs or publishes those artifacts.
The 15-minute receipt is renewable only by another complete read-only
`release:task0b:revalidate` observation against the same immutable generation.
Long test runs therefore do not weaken TTL validation and do not force a new
release root.

Set:

```powershell
$env:RELEASE_SHA = (git rev-parse HEAD).Trim().ToLowerInvariant()
$env:RUNTIME_GIT_SHA = $env:RELEASE_SHA
$env:RUNTIME_INSTANCE_LABEL = "remediation-$($env:RELEASE_SHA.Substring(0,8))"
```

Provision exact disposable DB URLs for Plans 1–5 and run all automated
producers first. Then create V2 revision 1 through the sole writer and verify it
read-only:

```powershell
$env:PLAN5_ARTIFACT_ROOT = '<outside-repo-path>'
npm run release:manifest:advance -- pre_manual absent $env:PLAN5_ARTIFACT_ROOT
npm run release:verify -- --phase pre-manual --artifact-root <outside-repo-path>
```

The producer phase supplies the automated evidence for `G00…G11`, including:

1. exact per-AC Vitest JSON/JUnit RED/GREEN trace;
2. all required PostgreSQL files, typecheck and literal full suite;
3. offline migration/no-op verification on clean DB and production clone;
4. full migration bytes/receipt checksum and postconditions evidence;
5. whole terminal legacy population count, ID-set hash, immutable result
   aggregate and sent-fingerprint set before/after;
6. exact 11 automated golden comparisons and generation of the 19 candidate
   payloads for the 15 manual scenarios;
7. Address Poisoning regression only;

Before trace capture, run `release:trace:prepare`. It archives the exact
approved test-only commits, applies only the two canonical test-title patches,
runs every owner RED batch, rejects infrastructure failures except the narrow
typed `local_product_module_absent` evidence for
AC-07/08/09/12/13/27/39, and writes the content-addressed RED reports/patches
plus the reconstructed Task 0A baseline. That typed evidence requires exact
frozen test commit, test patch, local `src/*` path, owner commit and candidate
bindings; generic import/no-test/environment failures remain invalid.
AC-20/21/24 use a separate archived behavioral run at `a0f74b3b…` with the
original `20ee8a75…` test patch and explicit RED-execution lineage.
`release:trace:capture` then binds those artifacts to the already-produced
candidate GREEN reports. Neither command changes product code or semantics.

The reviewed primary trace map is exact; order and membership of every REQ
list are evidence semantics. AC-39 deliberately uses the selected Plan 4 real
Incoming-formatter regression as its primary trace (the Plan 2 isolation test
remains regression coverage):

| AC | exact REQ IDs | owner plan |
|---|---|---:|
| AC-01 | REQ-15, REQ-16 | 2 |
| AC-02 | REQ-15, REQ-16, REQ-17 | 2 |
| AC-03 | REQ-28, REQ-29 | 2 |
| AC-04 | REQ-28, REQ-29 | 2 |
| AC-05 | REQ-28, REQ-29 | 2 |
| AC-06 | REQ-28, REQ-29 | 2 |
| AC-07 | REQ-06, REQ-09, REQ-15, REQ-32 | 4 |
| AC-08 | REQ-05, REQ-08, REQ-32 | 4 |
| AC-09 | REQ-32, REQ-33 | 4 |
| AC-10 | REQ-30 | 1 |
| AC-11 | REQ-02, REQ-30 | 1 |
| AC-12 | REQ-03, REQ-04, REQ-07, REQ-12, REQ-13, REQ-14, REQ-34 | 4 |
| AC-13 | REQ-03, REQ-04, REQ-10, REQ-11, REQ-19, REQ-31 | 4 |
| AC-14 | REQ-35 | 3 |
| AC-15 | REQ-35 | 3 |
| AC-16 | REQ-03, REQ-05, REQ-36 | 3 |
| AC-17 | REQ-37 | 3 |
| AC-18 | REQ-37 | 3 |
| AC-19 | REQ-18, REQ-19, REQ-20 | 2 |
| AC-20 | REQ-08, REQ-18, REQ-20 | 4 |
| AC-21 | REQ-20 | 4 |
| AC-22 | REQ-20 | 2 |
| AC-23 | REQ-19, REQ-20 | 2 |
| AC-24 | REQ-18, REQ-19, REQ-20 | 4 |
| AC-25 | REQ-18, REQ-21 | 2 |
| AC-26 | REQ-21 | 2 |
| AC-27 | REQ-18, REQ-22 | 4 |
| AC-28 | REQ-22 | 2 |
| AC-29 | REQ-23, REQ-24, REQ-27 | 2 |
| AC-30 | REQ-01, REQ-23, REQ-24, REQ-27 | 2 |
| AC-31 | REQ-18, REQ-21, REQ-24 | 2 |
| AC-32 | REQ-18, REQ-21, REQ-24 | 2 |
| AC-33 | REQ-20, REQ-23, REQ-25, REQ-27 | 2 |
| AC-34 | REQ-23, REQ-25, REQ-26, REQ-27 | 2 |
| AC-35 | REQ-23, REQ-25, REQ-26, REQ-27 | 2 |
| AC-36 | REQ-25, REQ-26, REQ-27 | 2 |
| AC-37 | REQ-23, REQ-25, REQ-26, REQ-27 | 2 |
| AC-38 | REQ-23, REQ-25, REQ-26 | 2 |
| AC-39 | REQ-05, REQ-06, REQ-07, REQ-14, REQ-25, REQ-27, REQ-32 | 4 |
| AC-40 | REQ-23, REQ-24, REQ-25, REQ-27 | 2 |
| AC-41 | REQ-38 | 5 |

8. cleanup and forbidden-scope audit.

At this point `G05_TELEGRAM` is a V2 pending record without execution fields.
All other gates in `G00…G11` must be `passed`; any other pending, skipped,
blocked or failed state stops Task 9. The `pre_manual` transition produces
`RemediationReleaseManifestV2.overall = "not_ready"`. Read-only verifier cannot
produce `ready_for_release`.

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
4. Finalize the manual evidence. The finalizer writes evidence only; it cannot
   change G05 or manifest. Only the subsequent `readiness` V2 transition may
   pass G05.

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

After manual finalization, compute the exact current manifest bytes hash,
advance once, then rerun the strict read-only readiness verifier:

```powershell
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path $env:PLAN5_ARTIFACT_ROOT 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- readiness $source $env:PLAN5_ARTIFACT_ROOT
npm run release:verify -- --phase readiness --artifact-root <outside-repo-path>
```

This phase requires every exact gate `G00…G11` to be `passed`, including the
finalized `G05_TELEGRAM`; it rejects pending/skipped/blocked/failed gates and
proves the writer produced `RemediationReleaseManifestV2.overall =
"ready_for_release"`. Verifier writes nothing.

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
5. Preserve the exact V2 hash chain and rerun read-only readiness verification;
   `G12…G15` must still be pending. Do not rebuild or hand-edit manifest. If
   merge changes SHA or any immutable evidence bytes, invalidate the freeze and
   start a new artifact root/manual cycle.
6. Obtain a second explicit `GO` for production mutation.

No push is implied by merge or release GO.

### Task 11 — Production backup and migration (`G12`, `G13`)

**No source changes.** All commands operate on the approved `RELEASE_SHA`.

G12/G13 retain their separate backup-lease and bound DB session/advisory-lock
claim protocols. They do not emit `ProductionAuthorityPreclaimValidationV2`,
`ProductionPreclaimLeaseLineageV2` or production-orchestration step intents;
those contracts belong only to Task 12 production operations. Their existing
atomic claim/consumption and per-effect ownership guards remain mandatory.

Before every G12/G13 issuer invocation, an earlier compatible tip that expired
without claim is replaceable only in this order:

```powershell
npm run release:authority:terminalize -- <transition> <protected-root>
npm run release:authority:issue -- <transition> <protected-root>
```

The terminalizer holds the fixed root-writer lease and publishes prepared then
committed exact `expired_unclaimed` bytes. It rejects early execution and any
preclaim, claim, consumption, action lease, G13 bound DB session/advisory lock,
operation or effect artifact; rejection routes to normal operation terminal
recovery or a new protected root.

G12 controlled backup:

1. Append/read a fresh `release:task0b:revalidate` receipt, then revalidate the
   exact clean `RELEASE_SHA`, explicit production GO, immutable
   chain-bound `ReleaseFreezeIdentityV2`, `ready_for_release` manifest,
   production DB/root fingerprints, rollback rehearsal, receipt-032 pre-state
   and terminal legacy snapshot. Invoke the sole issuer for one sufficiently
   long-lived G12 authority using the freeze's release generation:

   ```powershell
   npm run release:authority:issue -- g12_backup_passed <protected-root>
   ```

   The producer validates it before claim; the exclusive backup claim is the
   atomic consumption point. The previous runtime remains unchanged; backup
   does not stop it.
2. Supply the production secret only through the protected process environment
   as `TASK0B_PRODUCTION_DATABASE_URL`. It is never written to argv, the
   authority, logs or artifacts.
3. The backup producer resolves exactly the selector's unique compatible
   unconsumed tip from the protected root and runs without an authority path:

   ```powershell
   npm run release:production:backup -- <protected-root>
   ```

4. The producer owns pinned Docker `pg_dump --format=custom` and
   `pg_restore --list`, claim/lease/progress receipts, bounded resume and exact
   binding revalidation. Before every dump/list effect and settlement it
   revalidates exact consumed authority as unexpired plus current backup-lease
   ownership. It produces `production-backup.dump`,
   `production-backup-restore-list.txt` and
   `production-backup-evidence.json`; it does not mutate the release manifest.
5. Advance through the sole writer, then verify read-only:

   ```powershell
   $source = (Get-FileHash -Algorithm SHA256 `
     (Join-Path $env:PLAN5_ARTIFACT_ROOT 'release-manifest.json')).Hash.ToLowerInvariant()
   npm run release:manifest:advance -- g12_backup_passed $source $env:PLAN5_ARTIFACT_ROOT
   npm run release:verify -- --phase g12 --artifact-root $env:PLAN5_ARTIFACT_ROOT
   ```

   Only this transition marks `G12_PRODUCTION_BACKUP=passed`, returning the
   manifest to `not_ready` with `G00…G12` passed and `G13…G15` pending.

G13 controlled migration:

1. Append/read a new fresh `release:task0b:revalidate` receipt, revalidate the
   same immutable `ReleaseFreezeIdentityV2`, then invoke
   `release:authority:issue -- g13_migration_passed <protected-root>` to append
   one sufficiently long-lived G13 `OperationalAttestationV2` bound to the
   current `not_ready` manifest, same
   frozen release generation, exact candidate/DB identity and verified G12
   backup hash. The sequence revalidates it before claim and atomically consumes
   it only in the bound execution claim.
2. Run the controlled sequence without `--offline`:

   ```powershell
   npm run schema:release:sequence -- `
     --database-url-env TASK0B_PRODUCTION_DATABASE_URL `
     --expected-endpoint <loopback-host:port> `
     --expected-system-identifier <system-identifier> `
     --artifact-root <protected-root>
   ```

3. The sequence owns the first migration, full checksum/receipt and
   postcondition verification, the second `already_verified` no-op, and final
   verification. Before every migration/verification query and settlement it
   revalidates the exact consumed authority as unexpired plus bound DB session/
   advisory-lock ownership. Advance `g13_migration_passed` with the exact current source
   manifest SHA and then run read-only `--phase g13` verification. Only the
   writer marks `G13_PRODUCTION_MIGRATION` passed from the complete evidence.
   Candidate startup and previous-runtime stop remain Task 12/G14 operations.

   ```powershell
   $source = (Get-FileHash -Algorithm SHA256 `
     (Join-Path $env:PLAN5_ARTIFACT_ROOT 'release-manifest.json')).Hash.ToLowerInvariant()
   npm run release:manifest:advance -- g13_migration_passed $source $env:PLAN5_ARTIFACT_ROOT
   npm run release:verify -- --phase g13 --artifact-root $env:PLAN5_ARTIFACT_ROOT
   ```

Any failure stops forward progress. If G13 has mutated production, start the
Task 12 rollback decision; otherwise leave the previous runtime unchanged. Do
not hotfix production. Resume is allowed only from the exact durable state of
the same operation/generation. Incompatible or terminal lifecycle/store/
authority state, or a path-security failure, seals the root; retry requires a
manually created new protected root/freeze and never copies old mutable state
automatically. A valid typed G13 execution failure instead follows the legal
`production_failed`/rollback path and does not manufacture a new generation.

### Task 12 — Production rollout, canary, abandoned recovery and rollback (`G14`, `G15`)

Before every G14/G15/recovery/actual-rollback issuer invocation, the same typed
`release:authority:terminalize -- <transition> <protected-root>` then
`release:authority:issue -- <transition> <protected-root>` order applies to a
prior never-claimed expired tip. The terminalizer rejects early execution and
any preclaim/claim/consumption/action lease or lock/operation/effect artifact; a
claimed or effect-bearing operation requires its normal terminal settlement/
abandonment and cleanup lineage before replacement authority can be issued.

Task 12 uses normal `release:production:lease:takeover` only while both strict
authority/deadline bounds hold. If either bound has been reached and the lease
owner is dead with an expired lease, the only legal command is:

```powershell
npm run release:production:lease:cleanup-only-takeover -- `
  <expected-old-lease-sha256> $env:PLAN5_ARTIFACT_ROOT
```

It may only create the `cleanup_only` claim/lease and complete terminal
abandonment → canonical removal prepare → exact owned lease removal → prepared
byte-exact receipt → cleanup. It cannot run health/SQL/runtime/rollback actions,
settle success/failure, derive evidence or advance any gate/manifest. After
cleanup the operation remains non-advancing and requires the separately
authorized typed recovery-only route; no PID or production lease may remain.

That route is exact and allowlisted:

```powershell
npm run release:authority:issue -- production_failed $env:PLAN5_ARTIFACT_ROOT
npm run release:production:recovery:execute -- $env:PLAN5_ARTIFACT_ROOT
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path $env:PLAN5_ARTIFACT_ROOT 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- production_failed $source $env:PLAN5_ARTIFACT_ROOT
```

The recovery orchestrator acquires a new production lease, writes its lease-
bound immutable preclaim, atomically consumes fresh `production_recovery`
authority and writes only local-validation recovery step receipts. It validates
exact TerminalAbandoned+cleanup+partial-prefix and an uncertain marker only
when backed by the actual fsynced unmatched step-intent path/hash. It then
writes the recovery-only overall orchestration receipt before typed failure
evidence references it and settlement separately proves
`recoveryAttemptedExternalEffect=false`; prior operation effect state remains
`priorAttemptedExternalEffect`. It performs no rollout/canary/rollback effect
or query and does not replay the uncertain step. Rollback starts afterward with
another fresh authority and claim.

The operator first invokes
`release:authority:issue -- g14_rollout_passed $env:PLAN5_ARTIFACT_ROOT`; the
issuer appends the unique compatible same-generation G14 tip whose validity
exceeds the rollout deadline plus settlement margin. If an earlier tip expired
unclaimed, the separate terminalizer must first append the prepared and
committed zero-effect `expired_unclaimed` receipt under the fixed root-writer
lease; any preclaim/claim/consumption/lease-or-lock/operation/effect evidence
blocks that shortcut. Then the operator
invokes exactly one production command. The rollout orchestrator is called
before the first production query/effect; it alone validates the linear issuer
chain and unique active compatible authority tip,
acquires the fixed production-operation lease, writes the lease-bound preclaim,
atomically claims/consumes authority under that original lease or the verified
current tip of its committed linear takeover chain, revalidates G13/schema/runtime identity/singleton, stops the previous
runtime only after those checks pass, proves it stopped, starts the exact candidate, performs immediate
`/version`/Admin/singleton/worker/delivery/legacy/log checks, fsyncs an exact
bound step intent before each stop/start external effect, fsyncs every step
receipt and orchestration/evidence, then follows the sole terminal order:
durable settlement, durable canonical removal prepare, removal of the exact
owned current lease, byte-exact publication of the prepared lease-removal
receipt, and terminal cleanup binding prepare and receipt. Before every
query/effect/reconciliation/settlement it checks the current lease epoch,
`now < consumedAuthority.expiresAt` and
`now < immutable operationDeadlineAt`; equality or passage of either bound
fails closed. The
operator does not invoke stop, start, health, SQL or capture commands
separately:

```powershell
npm run release:production:rollout:execute -- $env:PLAN5_ARTIFACT_ROOT
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path $env:PLAN5_ARTIFACT_ROOT 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- g14_rollout_passed $source $env:PLAN5_ARTIFACT_ROOT
npm run release:verify -- --phase g14 --artifact-root $env:PLAN5_ARTIFACT_ROOT
```

The `g14_rollout_passed` advance is legal only after exact passed settlement,
its canonical removal prepare and byte-exact owned-lease-removal receipt,
terminal cleanup binding all three, and
absence of the production-operation lease. If instead the
orchestrator emits typed failure settlement, the operator advances
`production_failed`, not G14, then follows rollback below. A pre-effect
G13/schema/runtime-identity/singleton failure has
`attemptedExternalEffect:false`, contains only validation receipts and selects
`previous_runtime_retained`; it never invents stop/start/candidate captures.
For any exact typed failure settlement, use only:

```powershell
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path $env:PLAN5_ARTIFACT_ROOT 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- production_failed $source $env:PLAN5_ARTIFACT_ROOT
npm run release:verify -- --phase manifest --artifact-root $env:PLAN5_ARTIFACT_ROOT
```

The operator does not run a leaf recovery action. A candidate that
cannot verify schema fails before Telegram/workers. Starting it before a
proven previous stop, or stopping the previous runtime before verified G13,
cannot produce a rollout receipt.

For G15, the operator invokes
`release:authority:issue -- g15_canary_released $env:PLAN5_ARTIFACT_ROOT`; the
issuer appends a separate unique compatible canary tip whose validity exceeds
30 minutes plus settlement margin, and the operator invokes exactly
the canary orchestrator before the first observation. It revalidates the issuer
chain/unique tip and alone acquires the
fixed operation lease, writes the lease-bound preclaim, atomically claims/
consumes authority under that original lease or the verified current tip of its
committed linear takeover chain, observes at least
two full polling cycles and 15 minutes (hard 30-minute bound), performs all
schema/version/Admin/singleton/reconciliation/
delivery/navigation/allowance/legacy/secrets/queue/honest-limit checks from the
fixed allowlist, revalidates current lease epoch/unexpired authority before
every query/reconciliation and settlement: specifically both
`now < consumedAuthority.expiresAt` and
`now < immutable operationDeadlineAt`. It persists step and
orchestration/evidence, then durable settlement and canonical removal prepare,
removes the exact owned current lease, publishes the prepared receipt bytes,
and only then persists terminal cleanup binding settlement/prepare/removal. The
operator does not issue observation queries or capture commands separately:

```powershell
npm run release:production:canary:execute -- $env:PLAN5_ARTIFACT_ROOT
$source = (Get-FileHash -Algorithm SHA256 `
  (Join-Path $env:PLAN5_ARTIFACT_ROOT 'release-manifest.json')).Hash.ToLowerInvariant()
npm run release:manifest:advance -- g15_canary_released $source $env:PLAN5_ARTIFACT_ROOT
npm run release:verify -- --phase released --artifact-root $env:PLAN5_ARTIFACT_ROOT
```

#### Rollback triggers

Rollback on schema/startup mismatch, wrong `/version`, process duplication,
Admin failure, broken delivery/worker lifecycle, score/legacy mutation,
Telegram presentation P0/P1, Address Poisoning regression or secret leakage.

#### Application rollback procedure

1. Require the failed migration/rollout/canary orchestration to persist its
   typed fixed-path failure evidence. Advance `production_failed`; the writer
   derives the exact failed gate and blocked suffix without a free gate.
2. Invoke `release:authority:issue -- rollback_rolled_back
   $env:PLAN5_ARTIFACT_ROOT`. The issuer requires the exact prior terminal
   production lineage and appends one compatible sufficiently long-lived same-
   generation rollback authority; then
   invoke only the rollback orchestrator. It is called before its first effect,
   validates the issuer chain/unique tip, acquires the fixed operation lease,
   writes the lease-bound preclaim, atomically claims/
   consumes it under that original lease or the verified current tip of its
   committed linear takeover chain, revalidates the immutable freeze and exact failure state,
   selects exactly one typed branch from observed evidence, and owns every
   required health/stop/start/query step. The operator never executes those
   leaf operations:

   ```powershell
   npm run release:production:rollback:execute -- $env:PLAN5_ARTIFACT_ROOT
   ```

3. The orchestrator's closed branches are:
   `previous_runtime_retained` when no previous stop occurred;
   `previous_runtime_restarted_without_candidate` when the previous runtime
   stopped but candidate start is unconfirmed; or
   `candidate_replaced_with_previous` only when exact candidate-start evidence
   exists. Each branch fsyncs its ordered step receipts, proves forbidden
   cross-window actions absent, fsyncs an exact bound step intent before each
   restart/stop/start external effect, retains additive schema 032, verifies Admin,
   singleton, `/version`, queues, conservative allowance, sent delivery and
   immutable completed results, then writes orchestration and rollback
   evidence, durable settlement and canonical removal prepare, removes the
   exact owned current lease, publishes the prepared receipt bytes, and only
   then writes terminal cleanup binding settlement/prepare/removal. Crash replay
   resumes byte-exactly at the first missing durable boundary, never regenerates
   `removedAt` and never writes cleanup before removal. Every leaf,
   reconciliation and settlement requires current lease epoch,
   `now < consumedAuthority.expiresAt` and
   `now < immutable operationDeadlineAt`; normal takeover preserves both bounds,
   extends neither and is rejected at or after either boundary. Cleanup-only
   takeover may only terminalize/remove the dead lease under the common Task 12
   rule and cannot execute this rollback branch. It never
   repeats an uncertain stop/start effect.
4. Validate the fixed typed transition ref/outcome against the consumed
   attestation, exact settlement/removal-prepare/removal-receipt/cleanup order
   and absent production-operation lease, then perform only the manifest
   advance and read-only verify:

   ```powershell
   $source = (Get-FileHash -Algorithm SHA256 `
     (Join-Path $env:PLAN5_ARTIFACT_ROOT 'release-manifest.json')).Hash.ToLowerInvariant()
   npm run release:manifest:advance -- rollback_rolled_back $source $env:PLAN5_ARTIFACT_ROOT
   npm run release:verify -- --phase rolled-back --artifact-root $env:PLAN5_ARTIFACT_ROOT
   ```

G10 rehearsal is rejected. Neither orchestrator nor operator deletes receipt
032, columns, constraints or delivery rows.

The DB backup is not automatically restored. Restore requires a separate
explicit operator decision after proving additive schema corruption; ordinary
application rollback leaves migration 032 in place.

If `G14` and `G15` pass, the `g15_canary_released` writer transition marks the
manifest `released` and hands off to separate
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
| REQ-35 | G04, G08, G10, G14, G15 | wait-set reconciliation, sanitized runtime, rollback and canary; immutable preclaim→append-only per-tip lineage extensions with inherited start/fixed resolution, latest path/hash/tip-bound claim and L2→takeover→L3 crash recovery; single-attempt durable effect intents; branch-specific effect/recovery settlement flags and typed no-replay recovery |
| REQ-36 | G04, G08, G10, G14, G15 | delivery CAS/lease/retry/atomic effect/immutability, zero-send rollback rehearsal and production queue canary |
| REQ-37 | G04, G08, G14, G15 | cache-only navigation, explicit refresh, early callback in sanitized candidate and production runtime |
| REQ-38 | G00–G15 | typed lifecycle; trusted per-tip lineage paths where first has null previous/empty suffix and every extension references prior hash, inherits `lineageStartedAt`, adds one takeover receipt and fixes `resolvedAt`; same-tip replay reuses bytes, later takeover requires new latest extension, claim binds latest path/hash/tip and rejects branch/gap/foreign; external-effect intent attempt is literal 1 with second intent/retry forbidden; effect settlement compares generic effect flag while recovery settlement separately matches recovery false and prior flag across receipt/evidence; other freeze/authority/capability/time/cleanup invariants remain fail-closed |

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
| AC-33 | G01, G03 | primary service-dampening trace keeps owner RED; separate `[AC-33][LLM-DAMPENING]` is exact candidate-GREEN-only auxiliary evidence |
| AC-34 | G01, G03 | fresh LLM score payload ignored, no call |
| AC-35 | G01, G03 | verdict/recommendation payload ignored, no call |
| AC-36 | G01, G03 | legacy citations audit-only |
| AC-37 | G01, G03 | risky/uncited legacy payload excluded from fresh decision |
| AC-38 | G01, G03 | timeout/JSON/schema scenarios make zero provider calls |
| AC-39 | G01, G03, G05 | Bot/Alert + unified renderer exclude all legacy model text |
| AC-40 | G01, G03 | every fresh deterministic contract case bypasses Flash/Pro |
| AC-41 | G00–G15 | frozen V2 adds append-only L2-written→owner-dead→takeover-L3→lineage-L3→latest-bound claim plus previous-hash/start/suffix branch rejection; same-tip byte replay; attempt-1 intent and second-intent/retry negative; effect-capable versus recovery-only settlement flag matching; all prior freeze/authority/recovery/rollback/migration/AP gates remain mandatory |

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
| 8B.0 | `docs: approve plan 5 manifest lifecycle amendment` | only Plan 5 doc; corrective baseline; spec + doc-quality review |
| 8B.1 | `test: define release manifest v2 lifecycle acceptance` | all final lifecycle/store/orchestration/PostgreSQL assertions frozen up front; mandatory non-55999 disposable PostgreSQL behavioral RED, JSON hash and verified cleanup; spec + test-quality review |
| 8B.2 | `feat(release): define manifest v2 lifecycle` | pure reducer GREEN; typecheck; state-machine spec + quality review |
| 8B.3 | `feat(release): advance manifest atomically` | byte-exact receipt crash replay, discriminated bootstrap/frozen root leases, bootstrap lease-before-prepare terminal abandonment/new-root and prepared-freeze exact resume, frozen prepared/tombstone/new-lease takeover, epoch fencing, achievable portable path trust and sealed-root GREEN; filesystem spec + security review |
| 8B.4a/b | `feat(release): materialize freeze and issue authority`; `feat(release): bind pre-release gate evidence` | fixed root-writer serialization; normal and prepared-takeover-resumed materializer both prove fixed lease absent; prepared append-only issuer with byte-exact attestation/receipt/committed-marker crash replay; prepared/committed expired-unclaimed terminalizer with early/claimed/G13-lock negatives; selector/operation recovery/trusted-principal plus G00–G11 semantic/read-only GREEN; producer/policy spec + security review after each |
| 8B.5 | `feat(release): bind backup and migration transitions` | G12 settlement plus G13 four-stage success/all four honest failure-window and exact-path RED→GREEN; production-order spec + security review |
| 8B.6a | `feat(release): orchestrate production rollout` | shared store with append-only per-tip lineage extension/latest claim binding, L2→takeover→L3 crash resume and branch rejection; one attempt-1 intent per external step with retry rejection; branch-specific settlement flags; takeover/cleanup/G14 GREEN; spec + quality review |
| 8B.6b | `feat(release): orchestrate production canary` | same ownership protocol, sufficiently long-lived authority, fixed bounded steps, crash/expiry recovery and duration/checks GREEN; spec + quality review |
| 8B.6c | `feat(release): recover abandoned production operation` | recovery-only fresh lease/preclaim/lineage-bound claim; typed local step receipts then overall receipt before referencing failure evidence; exact abandonment/cleanup/completed prefix and actual unmatched intent marker; separate prior/recovery effect flags, no hash cycle, no normal gate evidence/effect/replay; spec + quality review |
| 8B.6d | `feat(release): orchestrate production rollback` | all rollback windows including fresh-authority retained runtime after G14 pre-effect failure and separately fresh rollback after abandoned-operation recovery; fixed branch lease/receipts/crash resume, typed transition binding and G10-negative GREEN; spec + quality review |
| 8B.7 | `fix(release): require verified manifest transitions for production` | mutators require latest append-only lineage chain/path/hash/tip and reject stale-current/branch/gap/foreign extension; reject second effect intent/retry; effect/recovery settlement validates only its discriminated flag contract; G12/G13 and cleanup guards remain exact; spec + security review |
| 8B.8 | `docs: document manifest v2 release lifecycle` | discriminated bootstrap/frozen lifecycle and lease cleanup, immutable preclaim/takeover lineage, durable effect intent, typed recovery receipt-before-failure no-replay route and focused/PG/typecheck/full/AP/scope GREEN; whole-plan reviews |
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
| Missing/forged/hand-edited V2 manifest, gate output or transition receipt | reject artifact root; no production action; regenerate through sole writer from a new exact evidence root |
| Missing/forged freeze materialization receipt or capture script-authored identity | reject root; only `release:freeze:materialize` may O_EXCL-create canonical freeze bytes from verified Task0B evidence |
| Bootstrap owner dies after lease acquisition but before freeze prepare | explicit bootstrap takeover writes `BootstrapRootTerminalAbandonedV2`, removes only its exact lease, seals the root and requires a new protected root; no generation/freeze is synthesized |
| Bootstrap owner dies after exact freeze prepare but before identity/receipt completion | explicit discriminated bootstrap takeover preserves root/preflight/candidate/runtime and epoch fencing, then publishes only prepared freeze/receipt bytes; bootstrap artifacts never parse as frozen writer state |
| Authority issuer chain branches, has multiple active tips, swapped binding or recovery without prior terminal lineage | reject selection and claim; no action; preserve all bytes for audit and investigate rather than overwrite/delete |
| Authority issuer crashes after prepared issuance, between publications or after receipt before committed marker | under the same fixed root-writer lease/CAS, replay only the precommitted attestation/receipt/marker bytes and timestamps through remaining `O_EXCL` publications; conflicting bytes or a competing writer/prepared tip fail closed |
| Authority expires before claim | the allowlisted terminalizer rejects early use, then under the fixed root-writer lease fsyncs prepared and exact committed `expired_unclaimed` receipt only after proving exact old attestation/issuer receipt/root/generation/transition and zero preclaim/claim/consumption/action-lease/G13-session-or-advisory-lock/operation/effect artifacts; issue replacement bound to that terminal receipt, otherwise require normal terminal recovery or a new root |
| Stale/concurrent manifest writer | CAS loser exits without overwrite; retain winning bytes/receipt; investigate conflicting operator process |
| Crash before atomic manifest replace | previous manifest remains authoritative; same-generation exact replay recovers from owned prepared snapshot/canonical receipt bytes |
| Crash after replace but before receipt file | restore the exact precommitted receipt bytes/hash from fsynced prepared state; never rerun clock/reducer/serializer, gate producer or external mutation |
| Different transition, freeze materializer, authority issuer or terminalizer competes for root-writer lease | the one fixed root-wide lease/CAS blocks it regardless of writer kind/key; no keyed or authority-specific parallel lock is allowed |
| Expired dead-owner manifest lease with one exact prepared transition | explicit same-generation takeover only: verify old hash/epoch/owner, fsync prepared replacement, no-overwrite tombstone, O_EXCL epoch+1 lease and receipt; crash replay is exact; old owner is fenced before replace |
| Live/unexpired/foreign/multiple lease or platform cannot guarantee no-overwrite takeover inside the trusted root | fail closed; perform no takeover; require investigation or a manually created protected root as applicable |
| Production orchestrator crashes after original-lease-bound preclaim but before atomic claim/consumption | never replace the immutable preclaim; resume under the original lease or resolve the byte-exact committed old→new takeover chain to the actual current tip, bind that lineage hash/tip in consumption and claim, and reject every branch, gap, swapped/foreign receipt or orphan preclaim before effects; otherwise terminal-abandon with zero effects |
| External-effect step intent exists without a step receipt | treat only that actual fsynced canonical intent path/hash as the single uncertain marker; do not observe, reconcile, retry or fabricate outcome during post-bound recovery; if no intent exists, no uncertain-effect claim is legal |
| Production orchestrator crashes after claim while both bounds hold | explicit effect-capable production-lease prepare/tombstone/O_EXCL epoch+1/committed takeover preserves operation id, original consumption and immutable deadline; every new effect/query/reconciliation/settlement requires current epoch and both strict bounds; old/replay owner is fenced |
| Consumed production authority expires or immutable operation deadline is reached with expired dead-owner lease | normal active takeover is rejected and cannot revive, replace or extend either bound; only explicit cleanup-only prepare/tombstone/O_EXCL epoch+1 claim/lease may terminally abandon (`operation_deadline_reached` when deadline alone is reached), canonical-prepare/remove/publish/cleanup, leaving no PID/lease; cleanup capability cannot derive evidence; a fresh `recovery_only` lease-bound preclaim/claim may bind exact abandonment+cleanup+completed-prefix/uncertain-marker into `production_failed` with zero prior-effect replay, followed only by separately fresh-authority rollback |
| Crash during terminal settlement/removal/cleanup | replay requires the exact durable settlement and fsynced canonical receipt prepare before deletion, removes only its exact owned current lease, publishes/validates the prepared bytes/hash/removedAt and lease hash+epoch, then persists cleanup binding all three; crash after deletion never regenerates time, a foreign lease or mismatch fails closed, and cleanup never precedes removal |
| Root trust/policy mismatch, writable Everyone/Users/foreign ACE, unsupported filesystem/ACL query, pre-existing/detectable symlink/junction/reparse or file-identity substitution | fail closed and seal root; never follow/replace outside canonical protected root; no claim of defense against forbidden malicious same-principal path races |
| Second generation or incompatible/terminal durable state in same root | write/fsync terminal-abandoned marker; reject root permanently; retry only through manual new protected root/freeze, with no automatic state copy |
| Production clone contains runnable external delivery | destroy/recreate rehearsal DB; block readiness; investigate safety breach |
| Sanitized runtime records an external send | block readiness; invalidate manual/runtime evidence; no production GO |
| Previous-SHA rollback rehearsal fails | block readiness; do not substitute an untested command/runtime |
| Backup unavailable/invalid after GO | leave the verified old runtime unchanged; keep V2 manifest `ready_for_release`; do not advance G12 or migrate |
| G14 `verify_g13`/schema/runtime-identity/singleton fails after claim but before effects | persist only validation receipts plus `attemptedExternalEffect:false`, durable settlement, canonical removal prepare, exact owned-lease removal, byte-exact prepared receipt and cleanup in that order; advance `production_failed`, then invoke a new fresh-authority rollback operation for `previous_runtime_retained`; stop/start/candidate captures are forbidden |
| G13 fails, or G14 `stop_previous` is attempted but exact liveness proves the previous runtime remained running | persist exact typed failure evidence; invoke only rollback orchestrator, which retains the exact previous runtime, forbids successful stop/start captures and records `previous_runtime_retained` |
| G14 fails after previous stop; candidate start command fails without confirmed process/start evidence | invoke only rollback orchestrator; it keeps additive 032, restarts only the exact previous runtime, forbids candidate-stop capture and records `previous_runtime_restarted_without_candidate` |
| G14 has confirmed candidate process/start evidence and then fails | invoke only rollback orchestrator; it keeps additive 032, stops candidate, starts exact previous runtime, records `candidate_replaced_with_previous` and verifies conservative mirrors/results/sent fingerprints |
| G14 `/version` mismatch after candidate start | invoke only rollback orchestrator for `candidate_replaced_with_previous`; no DB down-migration |
| G15 worker/delivery/Telegram/Admin canary fails | invoke only rollback orchestrator for `candidate_replaced_with_previous`; preserve sent/result state |
| Production failure without typed failure evidence | stop forward progress; do not hand-edit failed/blocked gates and do not invoke rollback manager until `production_failed` transition is valid |
| Actual rollback evidence/attestation missing, stale, foreign, swapped or replaced by G10 rehearsal | reject `rolled_back`; require fresh same-generation rollback authority plus exact typed transition ref/outcome/command/root/runtime binding |
| Terminal legacy count/ID/result aggregate mismatch | immediate rollback and P0 incident evidence; do not accept a sample-only explanation |
| Address Poisoning regression before GO | block readiness; separate owner fix, no inline detector change |
| Address Poisoning safety regression after rollout | immediate rollback; separate APC-01 follow-up, no inline detector fix |
| Secret-like value in an artifact before GO | reject artifact, rotate if real secret, regenerate all dependent evidence |
| Secret leakage in production/logs | invoke the typed rollback orchestrator when runtime rollback is safe, rotate affected secret outside repo and start incident review; never issue leaf stop/start commands manually |

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
- [x] Missing release-operation inputs do not block local Tasks 1–8B, while the
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
- [x] Required PostgreSQL tests cannot skip. Task 8B.1 itself runs its frozen
  PostgreSQL RED assertion on exact IPv4 `127.0.0.1` and the disposable non-
  55999 database, hashes the JSON report and verifies exact cleanup even on RED.
- [x] Manual evidence uses the exact 15 ordered `artifactId` values from
  `MANUAL_TELEGRAM_ACCEPTANCE_CASES` and requires exactly 15 scenario
  summaries, 19 message records, 11 golden comparisons plus
  SHA/runtime/message/job binding.
- [x] TYD reconciliation, delivery retry, navigation and `/version` are outside
  those 15 cases and remain separate `G08/G14/G15` runtime/canary checks.
- [x] Task 9 is acyclic: automated gates leave only G05 manual evidence
  pending; manual finalization writes evidence only; `readiness` writer passes
  G05; the subsequent strict verifier only proves `ready_for_release`.
- [x] Task 8B freezes RED tests for init/order/every transition, semantic
  G00–G15 evidence, forged-manifest rejection, CAS/concurrency, crash/replay,
  byte-identical verifier, sole freeze materializer, append-only issuer/selector/
  terminal recovery, trusted-principal allowlist/rejection, mutator capability
  guards, G14/G15 and actual rollback. The four
  test files plus V2 fixture additions are immutable after Task 8B.1; later
  tasks only run them.
- [x] Frozen INIT asserts the canonical staged map: G00–G04 and G06–G11 passed,
  G05 manual pending, G12–G15 pending and `overall=not_ready`; it never claims
  all G00–G11 passed at `pre_manual`.
- [x] Pending, executed and blocked gates are disjoint; blocked gates contain
  only their blocker and exact production-failure evidence.
- [x] G12 binds one consumption, dump/list progress and final bytes, and cannot
  pass while an operation lease remains; authority is fresh/unconsumed before
  claim and unexpired with current lease ownership before every effect and
  settlement. G12 has no `operationDeadlineAt`; its backup lease is its second
  bound. G13 likewise uses authority expiry plus DB session/advisory-lock bounds.
- [x] Stable release-freeze identity is separate from fresh G12–G15/recovery/rollback action
  attestations; capture cannot create it, sole materializer O_EXCL-creates it,
  and Task 9 revalidates but never recreates it. Sole append-only issuer plus
  fsynced prepared issuance, previous-hash receipts and committed marker retain
  old authority; crash before/between/after publication replays only
  precommitted bytes/timestamps. Freeze/manifest/issuer/terminalizer share one
  fixed root-writer lease/CAS, so competing writer kinds cannot branch, and
  the selector requires one linear chain and one active compatible unconsumed
  tip. Recovery issuance requires exact operation terminal lineage or prepared/
  committed zero-effect `expired_unclaimed` terminal receipt; early, claimed,
  action-lease, G13-session/advisory-lock, multiple/swapped/conflicting-
  operation states fail closed.
  Each action consumes its selected authority atomically and requires it
  unexpired before every effect/query/settlement. G14/G15/recovery/rollback
  also use immutable operation deadline; G15 validity covers its 30-minute
  bound plus settlement margin.
- [x] Bootstrap root ownership is discriminated from frozen ownership. Before
  freeze preparation, the bootstrap lease has null generation/freeze identity
  and binds exact protected-root, verified Task 0B preflight, candidate and
  runtime identities. A dead owner with no exact prepare is terminal-abandoned,
  its exact lease is removed, the root is sealed and retry requires a new root;
  an exact prepared freeze is the only state that a bootstrap takeover may
  resume byte-for-byte. Normal and takeover-resumed successful materialization
  both prove the fixed root-writer lease absent. Frozen leases/takeovers never
  parse as bootstrap state.
- [x] G13 success persists all four ordered stage receipts; each failure branch
  names its failed step, preserves only earlier completed stages and binds one
  typed failure artifact without invented later hashes. The artifact resolves
  only through its failed-step-specific allowlisted relative path.
- [x] Previous runtime stops only after G13 passes and before candidate start;
  rollback distinguishes pre-stop retention, post-stop/pre-start restart and
  candidate replacement with only window-applicable captures. A failed start
  command stays pre-start until direct process/start evidence proves otherwise.
- [x] Claim/lease/prepared/committed receipt schemas, filenames, TTL/liveness,
  crash recovery and `latestCommittedReceiptSha256` chaining are exact. The
  fsynced prepared record contains canonical receipt object/bytes/hash chosen
  before replace, so post-replace crash replay is byte-exact without rerunning
  time, reducer or serializer.
- [x] One fixed root-writer lease/CAS serializes freeze, every manifest
  transition key, authority issue and authority terminalization; no parallel
  authority lock exists. An exact expired dead-owner writer lease is recoverable
  only through prepared replacement,
  no-overwrite tombstone, O_EXCL epoch+1 lease and takeover receipt; old owners
  are hash/epoch-fenced before each effect and replace, including crash replay.
- [x] Portable path safety uses a pre-created local root, exact allowlisted
  trusted-principal policy, hashed owner/normalized-ACL/ancestor evidence,
  `untrustedWriteGrantPresent=false`, component lstat, realpath containment and
  pre/post file identity. It rejects pre-existing/detectable links/reparse and
  identity changes, writable Everyone/Users/foreign ACEs and unsupported ACL/
  filesystems, but does not claim pure Node defense against the explicitly
  forbidden malicious same-principal undetectable Windows parent race.
- [x] Each protected root has one frozen release generation. Only exact durable
  same-operation resume is allowed; incompatible/terminal/security failure
  fsyncs a terminal-abandoned marker, and retry is a manual new-root release
  without automatic copying.
- [x] Evidence policy staging is compile-time exhaustive only after G14/G15;
  earlier stages cannot use placeholders or casts to claim completeness.
- [x] Rollout/canary/recovery/rollback `:execute` commands are the sole
  production entry points. A distinct fixed root-wide production-operation
  lease serializes all four. Each selects authority, acquires the original
  lease, persists one immutable preclaim bound to its hash/epoch/owner/operation
  and only then atomically claims/consumes it. A takeover never replaces that
  preclaim: the claim/consumption bind an exact linear committed takeover-
  receipt lineage from original lease to current tip. Lineage is append-only per
  tip: first has null previous/empty suffix; each later extension references the
  prior hash, inherits `lineageStartedAt`, adds one takeover receipt and fixes
  its own `resolvedAt`. Same-tip crash reuses bytes; a later takeover requires a
  new latest extension, so an old tip is audit history, not current.
  Claim/consumption bind latest relative path, actual hash and tip.
  Traversal, foreign path, bytes/hash/preclaim/tip mismatch, branch/gap/swapped/
  foreign lineage and orphan preclaims reject.
  Current-epoch plus strict authority-expiry/immutable-deadline
  per-leaf guards, closed ordered steps, settlement, canonical owned-lease
  removal prepare, byte-exact receipt and cleanup. Normal effect-capable
  takeover requires both strict bounds. Post-bound cleanup-only takeover
  preserves both bounds, never renews/reconsumes authority, fences old owners
  and permits only terminal abandonment→prepare→remove→receipt→cleanup.
  Effects, queries, reconciliation, settlement, evidence/gates/manifest and
  rollback actions all reject cleanup-only capability; no PID/lease remains.
  Operators
  run only the orchestrator, manifest advance and read-only verifier.
- [x] Frozen RED distinguishes normal takeover from
  `CleanupOnlyProductionOperationTakeoverV2`: normal takeover rejects equality/
  passage of either bound; expired/dead cleanup-only takeover succeeds without
  renewal, every forbidden action fails, every prepare/tombstone/lease/
  abandonment/removal/cleanup crash boundary replays idempotently, and final
  state contains no live PID or production lease.
- [x] `expired_unclaimed` is legal only when the exact authority has no
  preclaim, claim, consumption, action lease, G13 bound session/advisory lock,
  operation or effect artifact. Cleanup-only cannot derive failure evidence.
  After exact abandonment and cleanup, a separate fresh recovery-only
  lease/preclaim/claim may bind only the contiguous completed-receipt prefix
  and at most one next uncertain marker backed by an actual canonical fsynced
  effect intent without receipt. No intent means no uncertain-effect claim.
  Recovery uses only typed local-validation step receipts and a recovery-only
  overall receipt, translates that immutable lineage to `production_failed`,
  and performs no runtime/SQL/canary action, query, observation,
  reconciliation, replay or normal gate-evidence emission. Rollback then uses
  another fresh authority and operation.
- [x] Before every external effect, the orchestrator fsyncs one canonical
  `ProductionOrchestrationStepIntentV2` bound to operation/step/attempt/current
  lease+epoch/authority/command/template/inputs; the effect receipt references
  its actual allowlisted path/hash. Crash before intent cannot claim an
  uncertain effect; crash after intent and before receipt preserves the sole
  typed uncertain marker whose step is a `ProductionExternalEffectStepIdV2`
  and whose attempt is exactly `1`. A second intent/retry for that step rejects
  after crash or takeover.
- [x] Orchestration has no hash cycle: intents precede external effects and
  effect receipts; operational step receipts are complete first, the
  discriminated orchestration receipt binds them second, and gate/rollback/
  recovery failure evidence binds that receipt third; settlement binds evidence
  fourth, exact owned-lease
  removal prepare precommitting receipt object/UTF-8 bytes/removedAt/hash and
  exact lease hash/epoch is fifth, exact removal plus byte-exact receipt
  publication are sixth, cleanup binds settlement/prepare/receipt seventh, and
  only then may manifest transition. Crash replay is byte-exact across every
  terminal boundary, never regenerates time and cleanup never precedes removal.
  Evidence
  derivation is not an orchestration step. Recovery receipt capability/command
  are exactly `recovery_only`/`production_recovery`. Effect-capable settlement
  compares its generic `attemptedExternalEffect` to effect evidence. Recovery-
  only settlement has no generic field: it requires
  `recoveryAttemptedExternalEffect=false` and separately matches
  `priorAttemptedExternalEffect` across recovery receipt and failure evidence.
- [x] G14 validation failure after claim but before runtime effects is typed
  `attemptedExternalEffect:false`, contains only exact validation receipts,
  legally reaches `production_failed`, then uses a distinct fresh rollback
  operation for `previous_runtime_retained` without stop/start/candidate data.
- [x] Rollout/canary/failure/rollback V2 evidence uses fixed filenames and a
  fail-closed canary requiring two cycles and 15–30 minutes.
- [x] V2 has revision, previous-manifest hash, transition id, updated-at,
  artifact-root/release-freeze binding, typed per-gate refs and honest pending
  records; G12-G15 and actual rollback separately claim and consume fresh
  same-generation attestations only after unconsumed validation.
- [x] `release:manifest:advance` is the sole writer; candidate is clean HEAD;
  CLI accepts no candidate/gate/evidence path and performs durable CAS.
- [x] G07 offline evidence is distinct from G13 production migration; G10
  rehearsal cannot satisfy production rollback.
- [x] Settled G12 binds durable authority-consumption/progress/final evidence
  and dump/list bytes, and proves that the producer deleted its owned lease;
  deleted lease bytes are not invented or retained. G13 binds consumed
  authority, source G12 and its honest success/failure sequence. Both revalidate
  unexpired authority and current ownership before each effect/query/settlement.
- [x] Production failure evidence is gate/evidence-kind discriminated and uses
  only allowlisted codes validated against the exact referenced artifact;
  swapped gate/kind/code combinations fail even when each token exists.
- [x] Gate evidence and transition evidence use separate exhaustive policies.
  `production_failed` and `rollback_rolled_back` receipts/manifests bind their
  typed refs; actual rollback also binds fresh same-generation authority,
  `production_rollback` command/template, root/candidate and previous runtime.
- [x] G14/G15/recovery/rollback orchestrators are implemented and tested with injected
  or sanitized inputs before Task 9, including both authority phases, swapped
  ownership/epoch plus equality/beyond authority-expiry and immutable-deadline
  rejection (including takeover after deadline and typed
  `operation_deadline_reached` abandonment), production-lease takeover/fencing,
  terminal settlement→removal-prepare→exact removal→byte-exact receipt→cleanup
  recovery, G14 pre-effect
  failure, immutable-preclaim takeover-lineage claim, effect-intent crash
  windows, recovery-only typed step/overall receipt before failure evidence and
  exact-prefix/actual-intent-backed uncertain-marker no-replay,
  leaf-command rejection and crash resume, but never run against production in
  Task 8B.
- [x] Production mutators require fully verified V2 state/receipt/root binding,
  not a structural fixture-like manifest.
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
  hashes; recursive secret scanning covers every field. Root trust evidence
  stores only trusted-policy id/hash, normalized ACL/owner fingerprints/hashes
  and booleans, never raw ACL/principal data.
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
- Tasks 0–8B выполнять последовательно в отдельном worktree через
  subagent-driven development;
- Task 9 не начинать до завершения Tasks 0–8B, revalidation существующего
  immutable `ReleaseFreezeIdentityV2` и current operational-preflight evidence,
  отдельного подтверждения release-candidate evidence и разрешения
  unmarked-runtime blocker; freeze не пересоздаётся, а G12–G15 и actual rollback
  позже получают через sole append-only issuer отдельные action-specific
  `OperationalAttestationV2` той же frozen generation, выбранные как unique
  compatible unconsumed tip и атомарно consumed только в bound claim; G12/G13
  используют authority expiry плюс lease/session limits, а только G14/G15/
  rollback требуют both `now < consumedAuthority.expiresAt` and
  `now < immutable operationDeadlineAt`; normal takeover post-bound запрещён,
  cleanup-only takeover не продлевает bounds и только удаляет зависший lease;
- production DB/runtime/Telegram не менять до полного `G00…G11`, merge в
  `master`, повторной строгой проверки и отдельного явного production GO;
- Plan 1–4 semantics и Address Poisoning implementation не трогать;
- не push/merge/deploy без отдельной команды пользователя.
