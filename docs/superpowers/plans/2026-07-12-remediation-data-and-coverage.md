# Remediation Data And Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Внедрить проверяемый data foundation для forensic coverage, low-balance latest-five, exact GasFree fee exclusion, current allowance state, USDD PSM route observations и schema migration 032 — без изменения scoring, Telegram UX, delivery и Address Poisoning.

**Architecture:** Новые versioned contracts добавляются в существующий `src/types.ts`; вычисление coverage, allowance validation и USDD route observation остаются отдельными pure modules. Where, Incoming и Deep producers сохраняют `ForensicCoverageV2` рядом с legacy payload, а mode-specific adapters читают старые jobs без выдуманных denominator/current state. Migration 032 остаётся additive, её LF-байты закреплены Git attributes, migrator начинает checksum receipts с версии 032, а startup verifier блокирует candidate workers при несовместимой schema.

**Tech Stack:** TypeScript 5.7, Node.js ESM, Vitest 4, PostgreSQL/`pg`, существующие TronScan/Where/GasFree модули; новых dependencies нет.

---

## 1. Scope и authority

Источник: `docs/superpowers/specs/2026-07-12-telegram-runtime-forensics-remediation-design.md`.

Plan 1 владеет только:

- `REQ-01`, `REQ-02`, `REQ-03`, `REQ-10` — data/coverage preservation;
- `REQ-19` — allowance data foundation, без wallet-safety score;
- `REQ-28` — USDD PSM exact route data, без modifier integration;
- `REQ-30`, `REQ-31`, `REQ-34` — latest-five и coverage semantics;
- `REQ-38` — data/migration/legacy fail-closed branches;
- `AC-10`, `AC-11` полностью;
- data prerequisites для `AC-03…AC-06`, `AC-12…AC-13`, `AC-19…AC-24`.

Plan 1 не меняет:

- risk score, decision, `ScoreAnchorV2` или `preferredFactId`;
- USDD modifier и standalone cap;
- Verify20/Bridgers wallet-safety policy;
- Telegram copy, headings, links или `/version` presentation;
- runtime delivery/reconciliation/navigation;
- Address Poisoning schema, detector, worker или alert.

Data prerequisite test с ID `AC-XX` доказывает только сохранность необходимых
facts. Он не закрывает итоговый AC, пока его scoring/presentation test не станет
GREEN в соответствующем будущем плане.

Production invariant: Plan 1 создаёт только branch/candidate artifacts. Он не
применяет migration 032 к production, не перезапускает production bot, не
мержит branch в deployed runtime и не переключает runtime label. Production
остаётся на предыдущем verified runtime и schema 031 до общего release gate
Plan 5. Все `db:migrate`, startup и rollback проверки Plan 1 выполняются только
на disposable PostgreSQL/candidate environment.

## 2. Изолированное выполнение

Implementation выполняется в отдельном worktree, созданном Task 0 от
динамически зафиксированного `PLAN1_BASE_SHA`. Существующие dirty-файлы
основного workspace не переносятся.

## 3. File map

### Create

- `.gitattributes` — LF rule для migration SQL bytes.
- `src/forensics/forensicCoverageV2.ts` — builder, validator и legacy adapter coverage.
- `src/forensics/usddPsmRouteObservation.ts` — exact-address route facts и eligibility input для Plan 2.
- `src/approvals/allowanceState.ts` — exhaustive `ApprovalAllowanceStateV2` validator.
- `src/storage/schemaMigrations.ts` — checksum, receipt/postcondition verifier.
- `src/runtime/startupSchemaGate.ts` — fail-closed pre-worker gate.
- `migrations/032_telegram_runtime_forensics_data_contracts.sql` — receipt и allowance schema.
- `tests/fixtures/forensics/remediationDataCases.ts` — явно synthetic TKg-shaped/GasFree/USDD cases.
- `tests/forensics/forensicCoverageV2.test.ts`.
- `tests/forensics/usddPsmRouteObservation.test.ts`.
- `tests/approvals/allowanceState.test.ts`.
- `tests/storage/schemaMigrations.test.ts`.
- `tests/storage/migration032.postgres.test.ts`.
- `tests/runtime/startupSchemaGate.test.ts`.

### Modify

- `src/types.ts` — shared versioned contracts и additive report fields.
- `src/forensics/balanceFormingTransfers.ts` — ordinary selection denominator/exclusions.
- `src/forensics/recentFlowProvenanceSelection.ts` — bounded async principal slice.
- `src/check/whereIsMoneyCheck.ts` — pre-slice exact GasFree enrichment и V2 persistence.
- `src/forensics/incomingDepositJob.ts` — transaction-seed CoverageV2 producer/adapter.
- `src/check/deepForensicCheck.ts` — deep-history CoverageV2 producer/adapter.
- `src/storage/repositories.ts` — authoritative allowance columns и legacy mirror adapter.
- `scripts/migrate.ts` — tracked migration path from 032.
- `src/index.ts` — schema verifier before bot/workers.
- `tests/forensics/recentFlowProvenanceSelection.test.ts`.
- `tests/forensics/balanceFormingTransfers.test.ts`.
- `tests/check/whereIsMoneyCheck.test.ts`.
- `tests/forensics/incomingDepositJob.test.ts`.
- `tests/check/deepForensicCheck.test.ts`.
- `tests/storage/repositories.test.ts`.
- `docs/knowledge/03-job-lifecycle.md`.
- `docs/knowledge/04-data-sources-tronscan-indexing.md`.
- `docs/knowledge/05-where-is-money-and-incoming.md`.
- `docs/knowledge/06-deepcheck.md`.
- `docs/knowledge/09-current-decisions.md`.
- `docs/knowledge/10-open-problems.md`.
- `docs/knowledge/13-agent-observations.md`.

## Task 0: Freeze the base, reserve 032 and prove test infrastructure

**Files:** none. Task 0 is read-only and creates only the isolated Git worktree
and local branch metadata.

- [ ] **Step 1: Capture a dynamic immutable base SHA**

Run from the existing primary workspace after the approved Plan 1 document is
committed:

```powershell
$repo = "C:\Users\User\OneDrive\Desktop\smartcontract"
$worktree = "C:\Users\User\OneDrive\Desktop\smartcontract-remediation-data-coverage"
$env:PLAN1_BASE_SHA = (git -C $repo rev-parse master).Trim()
if ($LASTEXITCODE -ne 0 -or $env:PLAN1_BASE_SHA -notmatch '^[0-9a-f]{40}$') {
  throw "plan1_base_sha_unavailable"
}
git -C $repo cat-file -e "$($env:PLAN1_BASE_SHA):docs/superpowers/plans/2026-07-12-remediation-data-and-coverage.md"
if ($LASTEXITCODE -ne 0) { throw "approved_plan_not_in_base_sha" }
Write-Output "PLAN1_BASE_SHA=$env:PLAN1_BASE_SHA"
```

Expected: one 40-character SHA. Never replace it with a hard-coded historical
commit or a later moving `master` during execution.

- [ ] **Step 2: Prove migration number 032 is free on that exact base**

```powershell
$baseMigrations = git -C $repo ls-tree -r --name-only $env:PLAN1_BASE_SHA -- migrations
$base032 = @($baseMigrations | Where-Object { (Split-Path $_ -Leaf) -like '032_*.sql' })
$working032 = @(Get-ChildItem -LiteralPath "$repo\migrations" -Filter '032_*.sql' -ErrorAction SilentlyContinue)
$lastBaseMigration = $baseMigrations | Where-Object { $_ -match '^migrations/\d{3}_.+\.sql$' } | Sort-Object | Select-Object -Last 1
if ($base032.Count -ne 0 -or $working032.Count -ne 0) { throw "migration_032_not_free" }
if ($lastBaseMigration -notlike 'migrations/031_*.sql') { throw "unexpected_last_migration:$lastBaseMigration" }
Write-Output "MIGRATION_032=free; LAST=$lastBaseMigration"
```

Expected: `MIGRATION_032=free` and last migration `031`. If either check fails,
stop and return the plan/spec for renumbering; do not silently choose 033.

- [ ] **Step 3: Reject a conflicting line-ending policy**

```powershell
$attributesPath = Join-Path $repo '.gitattributes'
if (Test-Path $attributesPath) {
  $attributes = Get-Content -LiteralPath $attributesPath -Encoding UTF8
  if ($attributes -match 'migrations/.+eol=(crlf|native)') {
    throw "migration_line_ending_policy_conflict"
  }
}
```

Expected in the current base: `.gitattributes` is absent. Absence is allowed at
Task 0 and becomes the intentional RED condition; Task 6 adds the LF rule.

- [ ] **Step 4: Create the worktree from PLAN1_BASE_SHA and persist the SHA in local branch config**

```powershell
if (Test-Path $worktree) { throw "plan1_worktree_already_exists" }
if (git -C $repo branch --list codex/remediation-data-coverage) { throw "plan1_branch_already_exists" }
git -C $repo worktree add $worktree -b codex/remediation-data-coverage $env:PLAN1_BASE_SHA
if ($LASTEXITCODE -ne 0) { throw "plan1_worktree_create_failed" }
git -C $worktree config branch.codex/remediation-data-coverage.plan1BaseSha $env:PLAN1_BASE_SHA
Set-Location $worktree
$storedBaseSha = (git config --get branch.codex/remediation-data-coverage.plan1BaseSha).Trim()
if ($storedBaseSha -ne $env:PLAN1_BASE_SHA) { throw "plan1_base_sha_not_persisted" }
if (git status --short) { throw "plan1_worktree_not_clean" }
```

On every later execution session restore the same value with:

```powershell
$env:PLAN1_BASE_SHA = (git config --get branch.codex/remediation-data-coverage.plan1BaseSha).Trim()
if ($env:PLAN1_BASE_SHA -notmatch '^[0-9a-f]{40}$') { throw "plan1_base_sha_missing" }
```

- [ ] **Step 5: Require a reachable disposable PostgreSQL database before RED**

```powershell
if ([string]::IsNullOrWhiteSpace($env:PLAN1_TEST_DATABASE_URL)) {
  throw "PLAN1_TEST_DATABASE_URL_required"
}
$env:TEST_DATABASE_URL = $env:PLAN1_TEST_DATABASE_URL
$env:REQUIRE_PLAN1_POSTGRES = "1"
node --input-type=module -e "import pg from 'pg'; const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL }); const result = await pool.query('select current_database() as db, current_user as user_name'); console.log(result.rows[0]); await pool.end();"
if ($LASTEXITCODE -ne 0) { throw "plan1_postgres_unreachable" }
```

Expected: database/user row printed. The URL must identify a disposable test
database; production credentials are forbidden.

- [ ] **Step 6: Record the clean baseline before adding RED tests**

```powershell
npm test
npm run typecheck
```

Expected: baseline GREEN. If baseline is red, implementation stops and records
the failing command without expanding Plan 1.

## Task 1: Commit the complete RED acceptance batch

**Files:**

- Create all new test/fixture files from the File map.
- Modify `tests/forensics/balanceFormingTransfers.test.ts`.
- Modify `tests/forensics/recentFlowProvenanceSelection.test.ts`.
- Modify `tests/check/whereIsMoneyCheck.test.ts`.
- Modify `tests/forensics/incomingDepositJob.test.ts`.
- Modify `tests/check/deepForensicCheck.test.ts`.
- Modify `tests/storage/repositories.test.ts`.

- [ ] **Step 1: Add coverage and legacy RED tests**

`tests/forensics/forensicCoverageV2.test.ts` must contain these exact test names
and assertions:

```ts
it("[REQ-31][AC-13] persists available selected excluded and unresolved coverage", () => {
  const result = buildForensicCoverageV2({
    scope: "requested_amount",
    availableInboundTxCount: 24,
    selectedInboundTxCount: 10,
    selectedAmountRaw: "1000000000",
    tracedAmountRaw: "830000000",
    exclusions: [{
      reason: "different_selected_scope",
      direction: "incoming",
      txCount: 14,
      amountRaw: null,
      evidenceIds: ["coverage:scope:14"]
    }],
    limitations: []
  });

  expect(result).toMatchObject({
    version: "forensic-coverage-v2",
    availableInboundTxCount: 24,
    selectedInboundTxCount: 10,
    excludedInboundTxCount: 14,
    tracedShare: 0.83,
    unresolvedAmountRaw: "170000000",
    unresolvedShare: 0.17,
    completeness: "partial"
  });
});

it("[REQ-38][AC-13] adapts legacy coverage without inventing a denominator", () => {
  const result = adaptLegacyWhereCoverageV2({
    selectedInboundTxCount: 10,
    selectedInboundVolumeRaw: "1000000000",
    currentBalanceCoverageRatio: 0.83,
    maxDepth: 3,
    fetchedAddressCount: 4,
    partial: true,
    notes: []
  });

  expect(result.availableInboundTxCount).toBeNull();
  expect(result.excludedInboundTxCount).toBeNull();
  expect(result.unresolvedAmountRaw).toBeNull();
  expect(result.completeness).toBe("unknown");
});

it("[REQ-03][REQ-10][DATA] stores a local materialization failure only as a limitation", () => {
  const result = buildForensicCoverageV2({
    scope: "current_balance",
    availableInboundTxCount: null,
    selectedInboundTxCount: 1,
    selectedAmountRaw: "1000000",
    tracedAmountRaw: null,
    exclusions: [],
    limitations: [{
      reason: "local_materialization_failed",
      evidenceIds: ["coverage:local-read-failed"]
    }]
  });
  expect(result.limitations[0]?.reason).toBe("local_materialization_failed");
  expect(result.exclusions).toEqual([]);
  expect(result).not.toHaveProperty("riskScore");
});
```

Add rejection cases for negative/non-integer counts, non-canonical raw strings,
`selected > available`, `traced > selected`, duplicate evidence ids and an
exclusion sum that differs from `available - selected`.

Add mode producer/adapter tests:

```ts
it("[REQ-31][AC-13][INCOMING] persists transaction-seed CoverageV2 on a new Incoming report", async () => {
  const report = await buildIncomingDepositReport(incomingCoverageFixture);
  expect(report.coverageV2).toMatchObject({
    version: "forensic-coverage-v2",
    scope: "transaction_seed",
    availableInboundTxCount: 1,
    selectedInboundTxCount: 1,
    excludedInboundTxCount: 0,
    selectedAmountRaw: incomingCoverageFixture.amountRaw
  });
});

it("[REQ-31][AC-13][DEEP] persists deep-history CoverageV2 from collected inbound edges", async () => {
  const report = await runDeepAddressForensicCheck(deepCoverageDeps, deepCoverageInput);
  expect(report.coverageV2).toMatchObject({
    version: "forensic-coverage-v2",
    scope: "deep_history",
    availableInboundTxCount: 3,
    selectedInboundTxCount: 3,
    excludedInboundTxCount: 0
  });
});

it("[REQ-38][DATA] returns null for legacy Incoming or Deep coverage without a defensible denominator", () => {
  expect(adaptLegacyIncomingCoverageV2({ report: legacyIncomingReport, seed: null })).toBeNull();
  expect(adaptLegacyDeepCoverageV2(legacyDeepReportWithoutCoverageV2)).toBeNull();
});
```

`incomingCoverageFixture`, `deepCoverageDeps`, `deepCoverageInput` and the two
legacy reports are exported by `remediationDataCases.ts`; all addresses/hashes
are marked synthetic.

Append to `tests/forensics/balanceFormingTransfers.test.ts`:

```ts
it("[REQ-31][AC-13][DATA] records the ordinary inbound denominator before selection", () => {
  const subjectAddress = "TSyntheticCoverageSubject11111111111";
  const edges = Array.from({ length: 24 }, (_, index) => edge(
    `coverage-${index}`,
    `TSyntheticFunder${String(index).padStart(2, "0")}1111111111111`,
    subjectAddress,
    index < 10 ? "100000000" : "1000000",
    `2026-07-12T12:00:${String(24 - index).padStart(2, "0")}.000Z`
  ));
  const result = selectBalanceFormingTransfers({
    subjectAddress,
    currentBalanceRaw: "1000000000",
    edges
  });
  expect(result.availableInboundTxCount).toBe(24);
  expect(result.transfers).toHaveLength(10);
  expect(result.coverageExclusions).toEqual([expect.objectContaining({
    reason: "different_selected_scope",
    direction: "incoming",
    txCount: 14
  })]);
});
```

- [ ] **Step 2: Add latest-five and GasFree RED tests**

The synthetic fixture contains seven newest-to-oldest rows: five ordinary
principal transfers including `305 USDT inbound -> 305 USDT outbound`, one
structurally exact GasFree fee between them, and one older principal transfer.
The fixture name must include `synthetic`; it must not be exported as observed
on-chain evidence.

`tests/fixtures/forensics/remediationDataCases.ts` exports exactly:

```ts
export const SYNTHETIC_TKG_SUBJECT: string;
export const syntheticTkgEdges: ForensicRouteEdge[];
export const syntheticGasFreeFeeEdge: ForensicRouteEdge;
export const resolveSyntheticEconomicContext: (edge: ForensicRouteEdge) => Promise<ForensicRouteEdge>;
export const contractPrincipalInput: SelectRecentFlowInput;
export const TNARA_OWNER: string;
export const APPROVAL_TX_HASH: string;
export const NOW: Date;
export const maxAllowanceState: ApprovalAllowanceStateV2;
export const zeroAllowanceState: ApprovalAllowanceStateV2;
export const failedAllowanceState: ApprovalAllowanceStateV2;
export const expiredAllowanceState: ApprovalAllowanceStateV2;
export const exactOutboundTwoPercentInput: BuildUsddPsmRouteObservationInput;
export const exactInboundEightyThreePercentInput: BuildUsddPsmRouteObservationInput;
export const labelOnlyInput: BuildUsddPsmRouteObservationInput;
export const discontinuousInput: BuildUsddPsmRouteObservationInput;
export const incomingCoverageFixture: BuildIncomingDepositReportInput;
export const deepCoverageDeps: DeepAddressForensicDeps;
export const deepCoverageInput: RunDeepAddressForensicCheckInput;
export const legacyIncomingReport: IncomingDepositRiskReport;
export const legacyDeepReportWithoutCoverageV2: DeepAddressForensicReport;
```

Append:

```ts
it("[REQ-30][AC-10] selects the synthetic TKg latest-five principal slice including the 305 pair", async () => {
  const result = await selectRecentFlowProvenanceTransfers({
    subjectAddress: SYNTHETIC_TKG_SUBJECT,
    currentBalanceRaw: "23791",
    edges: syntheticTkgEdges,
    resolveEconomicContext: resolveSyntheticEconomicContext
  });

  expect(result.selectionMethod).toBe("recent_five_principal");
  expect(result.recentFlowPrincipalTransfers).toHaveLength(5);
  expect(result.recentFlowPrincipalTransfers.map((item) => item.txHash)).toContain("tk-in-305");
  expect(result.recentFlowPrincipalTransfers.map((item) => item.txHash)).toContain("tk-out-305");
});

it("[REQ-02][REQ-30][AC-11] excludes exact GasFree fee before taking five principal rows", async () => {
  const result = await selectRecentFlowProvenanceTransfers({
    subjectAddress: SYNTHETIC_TKG_SUBJECT,
    currentBalanceRaw: "23791",
    edges: syntheticTkgEdges,
    resolveEconomicContext: resolveSyntheticEconomicContext
  });

  expect(result.recentFlowPrincipalTransfers.map((item) => item.txHash)).not.toContain("tk-gasfree-fee");
  expect(result.recentFlowPrincipalTransfers.map((item) => item.txHash)).toContain("tk-older-principal");
  expect(result.coverageExclusions).toEqual([expect.objectContaining({
    reason: "exact_gasfree_service_fee",
    txCount: 1
  })]);
});

it("[REQ-34][AC-12] reports no principal activity only after exact exclusions", async () => {
  const result = await selectRecentFlowProvenanceTransfers({
    subjectAddress: SYNTHETIC_TKG_SUBJECT,
    currentBalanceRaw: "0",
    edges: [syntheticGasFreeFeeEdge],
    resolveEconomicContext: resolveSyntheticEconomicContext
  });

  expect(result.recentFlowPrincipalTransfers).toEqual([]);
  expect(result.principalActivity).toBe("none");
  expect(result.coverageExclusions[0]?.reason).toBe("exact_gasfree_service_fee");
});

it("[REQ-01][DATA] keeps contract and GasFree-account principal transfers in the slice", async () => {
  const result = await selectRecentFlowProvenanceTransfers(contractPrincipalInput);
  expect(result.recentFlowPrincipalTransfers.map((item) => item.txHash)).toContain("contract-principal");
  expect(result.recentFlowPrincipalTransfers.map((item) => item.txHash)).toContain("gasfree-account-principal");
});
```

Change the old dust-is-empty expectation in
`tests/check/whereIsMoneyCheck.test.ts` to `[AC-10]`: sub-1000 principal rows
must enter the persisted recent-flow slice. Add an integration assertion that
`getTransaction` enriches a GasFree candidate before the five-row slice, not
after selection.

- [ ] **Step 3: Add allowance RED tests**

`tests/approvals/allowanceState.test.ts` covers the exhaustive state table:

```ts
it("[REQ-19][AC-19] accepts a fresh direct-call max uint256 state as confirmed active", () => {
  const state = validateApprovalAllowanceStateV2(maxAllowanceState, new Date("2026-07-12T12:10:00.000Z"));
  expect(state.state).toBe("confirmed_active");
  expect(state.isUnlimited).toBe(true);
});

it("[REQ-19][AC-23] accepts confirmed zero and keeps the approval event separate", () => {
  const state = validateApprovalAllowanceStateV2(zeroAllowanceState, new Date("2026-07-12T12:10:00.000Z"));
  expect(state).toMatchObject({ state: "confirmed_zero", confirmedAllowanceRaw: "0", isUnlimited: false });
  expect(state.observedApprovalTxHash).toBe(APPROVAL_TX_HASH);
});

it("[REQ-19][AC-24] rejects failed or stale allowance as current", () => {
  expect(validateApprovalAllowanceStateV2(failedAllowanceState, NOW)).toMatchObject({ state: "failed", isUnlimited: null });
  expect(validateApprovalAllowanceStateV2(expiredAllowanceState, NOW)).toMatchObject({ state: "stale", isUnlimited: null });
});

it("[AC-20][DATA] preserves exact owner binding for a later balance-at-risk lookup", () => {
  expect(validateApprovalAllowanceStateV2(maxAllowanceState, NOW).ownerAddress).toBe(TNARA_OWNER);
});

it("[AC-21][DATA] keeps the historical approval tx separate from current allowance authority", () => {
  const state = validateApprovalAllowanceStateV2(maxAllowanceState, NOW);
  expect(state.observedApprovalTxHash).toBe(APPROVAL_TX_HASH);
  expect(state.source).toBe("official_usdt_allowance");
});

it("[AC-22][DATA] refuses provider name or selector context as a current allowance state", () => {
  expect(() => validateApprovalAllowanceStateV2({
    ...expiredAllowanceState,
    confirmedAllowanceRaw: UINT256_MAX_RAW,
    isUnlimited: true
  }, NOW)).toThrow("allowance_nonconfirmed_unlimited");
});
```

Add invalid cases for bad TRON binding, signed/leading-zero/overflow raw values,
wrong unlimited flag, success outside the 15-minute window, unknown failure
code and contradictory timestamps.

In `tests/storage/repositories.test.ts`, add `[REQ-19][DATA]` cases proving:

- event-only `upsertWalletApproval` writes the legacy mirror as
  `0/false/unknown` and authoritative state as `stale`;
- `saveWalletApprovalAllowanceStateV2` writes confirmed active, confirmed zero,
  failed and stale combinations atomically;
- row mapping reads `confirmedAllowanceRaw` from
  `allowance_confirmed_raw`, never from `current_allowance_raw`.

- [ ] **Step 4: Add USDD PSM data RED tests**

`tests/forensics/usddPsmRouteObservation.test.ts` uses authoritative reserve
`TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ`:

```ts
it("[REQ-28][AC-03][DATA] preserves exact 2 percent outbound PSM inputs without scoring", () => {
  const observation = buildUsddPsmRouteObservation(exactOutboundTwoPercentInput);
  expect(observation).toMatchObject({
    serviceId: "usdd_psm_gemjoin",
    direction: "outbound_to_psm",
    amountRaw: "20000000",
    selectedAmountRaw: "1000000000",
    hopCount: 1,
    serviceIdentityExact: true,
    amountContinuityExact: true,
    scoringEligible: true
  });
  expect(observation).not.toHaveProperty("appliedModifier");
});

it("[REQ-28][AC-04][DATA] preserves exact 83 percent inbound PSM inputs", () => {
  expect(buildUsddPsmRouteObservation(exactInboundEightyThreePercentInput)).toMatchObject({
    direction: "inbound_from_psm",
    amountRaw: "830000000",
    selectedAmountRaw: "1000000000",
    scoringEligible: true
  });
});

it("[REQ-28][AC-05][DATA] preserves deep-history mode without applying a modifier", () => {
  expect(buildUsddPsmRouteObservation({ ...exactInboundEightyThreePercentInput, mode: "deep_history" })).toMatchObject({
    mode: "deep_history",
    scoringEligible: true
  });
});

it("[REQ-28][AC-06][DATA] keeps label-only and discontinuous PSM observations ineligible", () => {
  expect(buildUsddPsmRouteObservation(labelOnlyInput).scoringEligible).toBe(false);
  expect(buildUsddPsmRouteObservation(discontinuousInput).scoringEligible).toBe(false);
});
```

- [ ] **Step 5: Add migration/verifier/startup RED tests**

`tests/storage/schemaMigrations.test.ts` asserts exact constants, byte-level
SHA-256, receipt match, checksum mismatch, missing receipt, missing index and
wrong column/nullability.

It also contains the line-ending RED test:

```ts
it("[REQ-38][DATA] pins migration SQL to stable LF bytes", () => {
  const attributes = existsSync(".gitattributes")
    ? readFileSync(".gitattributes", "utf8")
    : "";
  expect(attributes).toMatch(/^\/migrations\/\*\.sql text eol=lf$/m);

  const bytes = existsSync("migrations/032_telegram_runtime_forensics_data_contracts.sql")
    ? readFileSync("migrations/032_telegram_runtime_forensics_data_contracts.sql")
    : Buffer.alloc(0);
  expect(bytes.length).toBeGreaterThan(0);
  expect(bytes.includes(13)).toBe(false);
  expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
  expect(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).not.toThrow();
});
```

`tests/storage/migration032.postgres.test.ts` must:

- require `TEST_DATABASE_URL` when `REQUIRE_PLAN1_POSTGRES=1`;
- import the not-yet-created migration/verifier module dynamically inside the
  test after the PostgreSQL connection and temporary schema are established;
  this prevents a missing-module error from bypassing the real DB preflight;
- create a unique temporary schema;
- create the migration-006 baseline `watched_wallets`/`wallet_approvals` tables;
- apply 032 once, verify receipt/postconditions, apply again as verified no-op;
- mutate the same-version bytes and expect hard checksum failure;
- drop the required index and expect hard postcondition failure;
- prove transaction failure leaves no receipt;
- drop the temporary schema in `finally`.

`tests/runtime/startupSchemaGate.test.ts`:

```ts
it("[REQ-38][DATA] performs no verified-start callback when schema 032 verification fails", async () => {
  const onVerified = vi.fn();
  await expect(runStartupSchemaGate({
    verify: async () => { throw new Error("schema_032_checksum_mismatch"); },
    onVerified
  })).rejects.toThrow("schema_032_checksum_mismatch");
  expect(onVerified).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Run the complete focused RED batch**

```powershell
$env:REQUIRE_PLAN1_POSTGRES = "1"
$env:TEST_DATABASE_URL = $env:PLAN1_TEST_DATABASE_URL
if ([string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)) { throw "PLAN1_TEST_DATABASE_URL_required" }
npx vitest run --configLoader bundle `
  tests/forensics/forensicCoverageV2.test.ts `
  tests/forensics/balanceFormingTransfers.test.ts `
  tests/forensics/recentFlowProvenanceSelection.test.ts `
  tests/check/whereIsMoneyCheck.test.ts `
  tests/forensics/incomingDepositJob.test.ts `
  tests/check/deepForensicCheck.test.ts `
  tests/forensics/usddPsmRouteObservation.test.ts `
  tests/approvals/allowanceState.test.ts `
  tests/storage/repositories.test.ts `
  tests/storage/schemaMigrations.test.ts `
  tests/storage/migration032.postgres.test.ts `
  tests/runtime/startupSchemaGate.test.ts
```

Expected RED:

- missing `forensicCoverageV2`, `allowanceState`, `usddPsmRouteObservation`,
  `schemaMigrations` and `startupSchemaGate` exports/files;
- AC-10 old selector still returns empty for sub-1000 rows;
- AC-11 exact fee is still enriched after selection;
- repository SQL lacks authoritative allowance columns;
- migration 032 file/receipt verifier do not exist;
- PostgreSQL test is executed, not skipped, and fails on missing migration 032;
- `.gitattributes` LF rule is absent.

The command must fail through missing production modules/exports or assertion
mismatches, never through test syntax errors. The PostgreSQL file must log its
temporary-schema setup before its expected missing-032 failure.

- [ ] **Step 7: Commit RED tests only**

```powershell
git add tests/fixtures/forensics/remediationDataCases.ts `
  tests/forensics/forensicCoverageV2.test.ts `
  tests/forensics/balanceFormingTransfers.test.ts `
  tests/forensics/recentFlowProvenanceSelection.test.ts `
  tests/check/whereIsMoneyCheck.test.ts `
  tests/forensics/incomingDepositJob.test.ts `
  tests/check/deepForensicCheck.test.ts `
  tests/forensics/usddPsmRouteObservation.test.ts `
  tests/approvals/allowanceState.test.ts `
  tests/storage/repositories.test.ts `
  tests/storage/schemaMigrations.test.ts `
  tests/storage/migration032.postgres.test.ts `
  tests/runtime/startupSchemaGate.test.ts
git diff --cached --name-only
git commit -m "test: define remediation data acceptance"
```

Expected: first Plan 1 commit contains tests/fixtures only and remains RED.

## Task 2: Add shared typed contracts

**Files:**

- Modify `src/types.ts`.
- Modify `src/check/deepForensicCheck.ts`.
- Test `tests/forensics/forensicCoverageV2.test.ts`.
- Test `tests/approvals/allowanceState.test.ts`.
- Test `tests/forensics/usddPsmRouteObservation.test.ts`.

- [ ] **Step 1: Add the exact shared types**

Add the canonical `ForensicCoverageV2`, `ApprovalAllowanceStateV2` and
`UsddPsmExposureV1` from the approved spec. Add these Plan-1 data types:

```ts
export type CoverageExclusionV1 = {
  reason: CoverageExclusionReasonV1;
  direction: "incoming" | "outgoing" | null;
  txCount: number;
  amountRaw: string | null;
  evidenceIds: string[];
};

export type CoverageLimitationV1 = {
  reason: "provider_history_unavailable" | "local_materialization_failed";
  evidenceIds: string[];
};

export type RecentFlowPrincipalTransferV1 = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  direction: "incoming" | "outgoing";
  amountRaw: string;
  timestamp: string;
  economicRole: "principal";
};

export type UsddPsmRouteObservationV1 = {
  version: "usdd-psm-route-observation-v1";
  mode: "where" | "incoming" | "recent_flow" | "deep_history";
  serviceId: "usdd_psm_gemjoin";
  serviceAddress: string | null;
  direction: "inbound_from_psm" | "outbound_to_psm" | "unknown";
  amountRaw: string;
  selectedAmountRaw: string;
  hopCount: 1 | 2 | null;
  serviceIdentityExact: boolean;
  amountContinuityExact: boolean;
  scoringEligible: boolean;
  ineligibilityReason: "label_only" | "amount_discontinuous" | "unsupported_hop" | "invalid_amount" | null;
  evidenceIds: string[];
};
```

Extend `BalanceFormingSelection` additively with:

```ts
recentFlowPrincipalTransfers?: RecentFlowPrincipalTransferV1[];
principalActivity?: "present" | "none";
coverageExclusions?: CoverageExclusionV1[];
availableInboundTxCount?: number | null;
```

Extend `WhereIsMoneyReport` additively with:

```ts
coverageV2?: ForensicCoverageV2;
recentFlowPrincipalTransfers?: RecentFlowPrincipalTransferV1[];
usddPsmRouteObservations?: UsddPsmRouteObservationV1[];
```

Extend `IncomingDepositRiskReport` in `src/types.ts` and
`DeepAddressForensicReport` in `src/check/deepForensicCheck.ts` additively:

```ts
coverageV2?: ForensicCoverageV2;
```

Add `recent_five_principal` to `selectionMethod`. Keep every field optional on
legacy report/selection readers; new producers must populate them.

- [ ] **Step 2: Typecheck the contract layer**

```powershell
npm run typecheck
```

Expected: existing constructors remain compatible because report additions are
additive; tests stay RED only because builders are not implemented.

- [ ] **Step 3: Commit the contract layer**

```powershell
git add src/types.ts src/check/deepForensicCheck.ts
git commit -m "feat: add remediation data contracts"
```

## Task 3: Build ForensicCoverageV2 and legacy adapters

**Files:**

- Create `src/forensics/forensicCoverageV2.ts`.
- Modify `src/forensics/balanceFormingTransfers.ts`.
- Modify `src/check/whereIsMoneyCheck.ts`.
- Modify `src/forensics/incomingDepositJob.ts`.
- Modify `src/check/deepForensicCheck.ts`.
- Test `tests/forensics/forensicCoverageV2.test.ts`.
- Test `tests/forensics/balanceFormingTransfers.test.ts`.
- Test `tests/check/whereIsMoneyCheck.test.ts`.
- Test `tests/forensics/incomingDepositJob.test.ts`.
- Test `tests/check/deepForensicCheck.test.ts`.

- [ ] **Step 1: Implement exact integer coverage math**

Export:

```ts
export function buildForensicCoverageV2(input: BuildForensicCoverageV2Input): ForensicCoverageV2;
export function adaptLegacyWhereCoverageV2(input: WhereIsMoneyCoverage): ForensicCoverageV2;
export function buildIncomingCoverageV2(input: BuildIncomingCoverageV2Input): ForensicCoverageV2;
export function adaptLegacyIncomingCoverageV2(input: {
  report: IncomingDepositRiskReport;
  seed: IncomingDepositInput | null;
}): ForensicCoverageV2 | null;
export function buildDeepCoverageV2(input: BuildDeepCoverageV2Input): ForensicCoverageV2;
export function adaptLegacyDeepCoverageV2(input: {
  coverageV2?: ForensicCoverageV2;
}): ForensicCoverageV2 | null;
export function validateForensicCoverageV2(value: ForensicCoverageV2): ForensicCoverageV2;
```

Rules:

- raw amounts are canonical non-negative integers;
- shares are derived from raw `BigInt` amounts at four decimal places and are
  never trusted from caller input;
- known `available` requires
  `available = selected + excluded`;
- only exclusions with `direction=incoming` participate in
  `excludedInboundTxCount`; outgoing technical exclusions remain typed context;
- incoming exclusion `txCount` sum equals `excluded` when denominator is known;
- `unresolved = max(selected - traced, 0)`;
- Where/Incoming `complete` requires known denominator, no limitations and zero
  unresolved;
- Deep `deep_history` may be count-only: amount fields stay null and
  completeness comes only from exact subject-index/materialization status;
- `partial` requires known selected amount plus a proven gap/limitation;
- legacy missing denominator produces `available=null`, `excluded=null`,
  unresolved amount/share `null`, completeness `unknown`;
- no reason is synthesized from notes/free text.

- [ ] **Step 2: Populate the ordinary selection denominator**

`selectBalanceFormingTransfers` persists:

- `availableInboundTxCount = inbound.length` after subject/direction/positive
  amount filtering;
- one `different_selected_scope` incoming exclusion containing the count,
  summed raw amount and tx evidence ids of deterministic unselected rows;
- no exclusion when every available row was selected.

Update `tests/forensics/balanceFormingTransfers.test.ts` with
`[REQ-31][AC-13][DATA]` for a 24-row/10-selected/14-excluded case.

- [ ] **Step 3: Persist coverageV2 on every new Where report branch**

Create one local helper in `whereIsMoneyCheck.ts` and use it in normal,
fallback and true-no-activity branches:

```ts
function coverageV2ForSelection(input: {
  selection: BalanceFormingSelection;
  tracedAmountRaw: string | null;
  limitations: CoverageLimitationV1[];
}): ForensicCoverageV2 {
  return buildForensicCoverageV2({
    scope: input.selection.provenanceScope,
    availableInboundTxCount: input.selection.availableInboundTxCount ?? null,
    selectedInboundTxCount: input.selection.transfers.length,
    selectedAmountRaw: input.selection.selectedAmountRaw,
    tracedAmountRaw: input.tracedAmountRaw,
    exclusions: input.selection.coverageExclusions ?? [],
    limitations: input.limitations
  });
}
```

Provider/local failures map only to typed limitations. `notes` remain legacy
diagnostics and cannot create an exclusion.

- [ ] **Step 4: Persist transaction-seed CoverageV2 on every new Incoming report**

`buildIncomingCoverageV2` receives the concrete `IncomingDepositInput` and the
finished report:

- scope is always `transaction_seed`;
- the valid concrete deposit gives `available=1`, `selected=1`, `excluded=0`;
- `selectedAmountRaw` is the exact deposit raw amount;
- `tracedAmountRaw` is populated only from exact raw funding-bundle continuity,
  capped at the deposit amount; never reconstruct raw money from a rounded
  ratio;
- targeted/provider/local blockers become typed limitations;
- missing exact traced raw leaves traced/unresolved amount and share null.

Attach `coverageV2` inside `buildIncomingDepositReport` before the result is
persisted. `adaptLegacyIncomingCoverageV2` may reconstruct the one-deposit
denominator only when the stored job also supplies a valid seed; without that
seed it returns null.

- [ ] **Step 5: Persist deep-history CoverageV2 on every new Deep report**

`runDeepAddressForensicCheck` builds its V2 contract from the already collected
`sourceTransfers.edges`, not from `coverage.transferEdges` or provider totals:

- filter exact positive direct inbound subject edges;
- `selectedInboundTxCount` is that concrete count;
- when `allTime.subjectAllTimeComplete=true` and provider/local status is exact,
  `available=selected` and `excluded=0`;
- when the subject window is partial/inconsistent/capped, `available` and
  `excluded` are null; selected still reports the actually inspected inbound
  count and a typed limitation explains the unknown remainder;
- amount fields remain null because Deep is not a selected-amount provenance
  mode;
- `complete` is allowed only for exact all-time/materialized subject coverage;
  `partial` is used for a proven limitation and `unknown` when authority is
  absent.

Attach `coverageV2` before `DeepAddressForensicReport` is persisted.
`adaptLegacyDeepCoverageV2` validates an already stored V2 object; an older
report has no defensible inbound denominator because
`subjectTransfersFetched/transferEdges` mix directions, so the adapter returns
null rather than synthetic zero.

- [ ] **Step 6: Run all three producer/adapter coverage tests GREEN**

```powershell
npx vitest run --configLoader bundle `
  tests/forensics/forensicCoverageV2.test.ts `
  tests/forensics/balanceFormingTransfers.test.ts `
  tests/check/whereIsMoneyCheck.test.ts `
  tests/forensics/incomingDepositJob.test.ts `
  tests/check/deepForensicCheck.test.ts
npm run typecheck
```

Expected: `[REQ-31][AC-13]` passes for Where, Incoming and Deep; legacy
Where preserves known selected fields, while denominator-less Incoming/Deep
adapters return null. Unrelated new modules remain RED until their tasks.

- [ ] **Step 7: Commit coverage**

```powershell
git add src/types.ts src/forensics/forensicCoverageV2.ts `
  src/forensics/balanceFormingTransfers.ts src/check/whereIsMoneyCheck.ts `
  src/forensics/incomingDepositJob.ts src/check/deepForensicCheck.ts `
  tests/forensics/forensicCoverageV2.test.ts `
  tests/forensics/balanceFormingTransfers.test.ts tests/check/whereIsMoneyCheck.test.ts `
  tests/forensics/incomingDepositJob.test.ts tests/check/deepForensicCheck.test.ts
git commit -m "feat: persist forensic coverage v2"
```

## Task 4: Implement low-balance latest-five before GasFree slicing

**Files:**

- Modify `src/forensics/recentFlowProvenanceSelection.ts`.
- Modify `src/check/whereIsMoneyCheck.ts`.
- Test `tests/forensics/recentFlowProvenanceSelection.test.ts`.
- Test `tests/check/whereIsMoneyCheck.test.ts`.

- [ ] **Step 1: Make the selector async with a bounded resolver**

Use this exact input boundary:

```ts
export type SelectRecentFlowInput = {
  subjectAddress: string;
  currentBalanceRaw: string | null;
  edges: ForensicRouteEdge[];
  maxCandidates?: number;
  resolveEconomicContext?: (edge: ForensicRouteEdge) => Promise<ForensicRouteEdge>;
};

export async function selectRecentFlowProvenanceTransfers(
  input: SelectRecentFlowInput
): Promise<BalanceFormingSelection>;
```

Algorithm:

1. Sort candidate edges newest first with existing tx-hash tie-breaker.
2. Preserve the existing `>=1000 USDT` meaningful-outgoing path by testing
   outgoing candidates newest-first after economic resolution.
3. When no eligible large outgoing exists, resolve candidates newest-first
   until five non-fee principal transfers are collected or the checked edge
   set is exhausted.
4. Exclude only `economicProtocol=tron_gasfree` plus
   `economicRole=service_fee`; tag/address/amount similarity is not enough.
5. If the five-row principal slice has an outgoing, use the newest outgoing as
   anchor and only earlier slice inbounds as funding candidates.
6. If it has no outgoing, trace its inbound principal transfers.
7. Persist all five inspected principal rows separately from trace-selected
   funding transfers.
8. Return `principalActivity=none` only after the resolved checked set contains
   no principal transfer.

No unbounded `Promise.all(sourceEdges)` is allowed. The resolver stops after it
has enough principal rows, except that the preserved large-outgoing search may
continue through large candidates until a non-fee anchor or exhaustion.

- [ ] **Step 2: Resolve economic context before selection in Where**

Change the low-balance call to:

```ts
selection = shouldUseRecentFlow
  ? await selectRecentFlowProvenanceTransfers({
      subjectAddress: sourceAddress,
      currentBalanceRaw,
      edges: sourceEdges,
      resolveEconomicContext
    })
  : selectBalanceFormingTransfers({
      subjectAddress: sourceAddress,
      currentBalanceRaw,
      requestedAmountRaw: input.requestedAmountRaw,
      edges: sourceEdges
    });
```

Do not remove the existing post-selection GasFree safety filter; keep it as a
defense-in-depth assertion, but it must no longer be the first time the
latest-five selector learns the fee role.

- [ ] **Step 3: Persist the slice and coverage exclusion**

New reports store `recentFlowPrincipalTransfers`, available/selected/excluded
counts and `exact_gasfree_service_fee` evidence. Gross balance/debit math keeps
the fee; provenance selection does not.

- [ ] **Step 4: Run latest-five tests GREEN**

```powershell
npx vitest run --configLoader bundle `
  tests/forensics/recentFlowProvenanceSelection.test.ts `
  tests/check/whereIsMoneyCheck.test.ts `
  tests/forensics/gasFreeSettlement.test.ts
npm run typecheck
```

Expected:

- `[AC-10]` includes the 305 inbound/outbound pair;
- `[AC-11]` excludes the exact fee before the five-row cut and includes the
  older principal row;
- `[AC-12][DATA]` distinguishes real no-principal activity;
- existing `>=1000` outgoing-anchor tests remain GREEN;
- unmatched TLnt-like transfers remain principal/visible.

- [ ] **Step 5: Commit latest-five behavior**

```powershell
git add src/types.ts src/forensics/recentFlowProvenanceSelection.ts src/check/whereIsMoneyCheck.ts `
  tests/fixtures/forensics/remediationDataCases.ts `
  tests/forensics/recentFlowProvenanceSelection.test.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "fix: inspect low-balance principal transfers"
```

## Task 5: Add USDD PSM data foundation without scoring

**Files:**

- Create `src/forensics/usddPsmRouteObservation.ts`.
- Modify `src/types.ts`.
- Modify `src/check/whereIsMoneyCheck.ts`.
- Test `tests/forensics/usddPsmRouteObservation.test.ts`.

- [ ] **Step 1: Add exact authoritative address registry**

Use only the approved USDT reserve address:

```ts
export const USDD_PSM_USDT_RESERVE_ADDRESSES = new Set([
  "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ"
]);
```

Provider tag `USDD: PSM GemJoin (USDT)` is context only and cannot set
`serviceIdentityExact=true`.

- [ ] **Step 2: Build observations, not modifiers**

Export:

```ts
export function buildUsddPsmRouteObservation(
  input: BuildUsddPsmRouteObservationInput
): UsddPsmRouteObservationV1;

export function collectUsddPsmRouteObservations(input: {
  mode: UsddPsmRouteObservationV1["mode"];
  selectedAmountRaw: string;
  paths: MoneyOriginPath[];
}): UsddPsmRouteObservationV1[];
```

Eligibility requires exact registry address, direction, canonical positive raw
amounts, `amount <= selectedAmount`, exact continuity and hop 1 or 2. The
observation stores raw numerator/denominator and evidence ids. It does not call
the tier formula, create `UsddPsmExposureV1`, change a score, cap a decision or
produce user copy.

- [ ] **Step 3: Persist observations in new Where reports**

Use `mode=recent_flow` for low-balance selection and `mode=where` for ordinary
Where. Ineligible observations may be persisted as context with exact
`ineligibilityReason`; they are not inserted into scoring inputs.

- [ ] **Step 4: Run USDD data tests GREEN**

```powershell
npx vitest run --configLoader bundle `
  tests/forensics/usddPsmRouteObservation.test.ts `
  tests/forensics/serviceRouteRegistry.test.ts `
  tests/check/whereIsMoneyCheck.test.ts
npm run typecheck
```

Expected: `[AC-03…AC-05][DATA]` preserve exact inputs; `[AC-06][DATA]` rejects
label-only/discontinuous eligibility; no scoring snapshot changes.

- [ ] **Step 5: Commit USDD facts**

```powershell
git add src/types.ts src/forensics/usddPsmRouteObservation.ts src/check/whereIsMoneyCheck.ts `
  tests/forensics/usddPsmRouteObservation.test.ts
git commit -m "feat: persist exact usdd psm route facts"
```

## Task 6: Add migration 032 and authoritative allowance state

**Files:**

- Create `.gitattributes`.
- Create `migrations/032_telegram_runtime_forensics_data_contracts.sql`.
- Create `src/approvals/allowanceState.ts`.
- Modify `src/storage/repositories.ts`.
- Test `tests/approvals/allowanceState.test.ts`.
- Test `tests/storage/repositories.test.ts`.

- [ ] **Step 1: Pin all migration SQL working-tree bytes to LF**

Create `.gitattributes` with exactly:

```gitattributes
/migrations/*.sql text eol=lf
```

Do not renormalize or stage migrations 001–031. After creating migration 032,
stage only the attribute file and 032, then normalize/check the new blob:

```powershell
git add .gitattributes migrations/032_telegram_runtime_forensics_data_contracts.sql
git add --renormalize migrations/032_telegram_runtime_forensics_data_contracts.sql
git check-attr text eol -- migrations/032_telegram_runtime_forensics_data_contracts.sql
node --input-type=module -e "import { execFileSync } from 'node:child_process'; const bytes = execFileSync('git', ['show', ':migrations/032_telegram_runtime_forensics_data_contracts.sql']); if (bytes.includes(13)) throw new Error('migration_032_contains_cr'); console.log('migration_032_lf_bytes=' + bytes.length);"
```

Expected attributes: `text: set`, `eol: lf`; indexed blob contains no byte 13.
The checksum is always computed from these exact LF bytes.

- [ ] **Step 2: Write additive idempotent SQL**

Migration 032 creates `schema_migration_receipts`, adds
`allowance_confirmed_raw`, status/timestamps/failure fields, exact named checks
and `idx_wallet_approvals_allowance_refresh`. It preserves existing non-null
legacy columns.

The SQL shape is:

```sql
create table if not exists schema_migration_receipts (
  version integer primary key,
  filename text not null unique,
  checksum_sha256 text not null,
  applied_at timestamptz not null default now(),
  constraint schema_migration_receipts_checksum_check
    check (checksum_sha256 ~ '^[0-9a-f]{64}$')
);

alter table wallet_approvals add column if not exists allowance_confirmed_raw text;
alter table wallet_approvals add column if not exists allowance_check_status text not null default 'stale';
alter table wallet_approvals add column if not exists allowance_checked_at timestamptz;
alter table wallet_approvals add column if not exists allowance_fresh_until timestamptz;
alter table wallet_approvals add column if not exists allowance_last_attempt_at timestamptz;
alter table wallet_approvals add column if not exists allowance_failure_code text;

update wallet_approvals set
  allowance_confirmed_raw = null,
  allowance_check_status = 'stale',
  allowance_checked_at = null,
  allowance_fresh_until = null,
  allowance_last_attempt_at = null,
  allowance_failure_code = null,
  current_allowance_raw = '0',
  is_unlimited = false,
  status = 'unknown';
```

Add the six constraint names from the approved spec. Static checks enforce:

- canonical uint256 or null;
- exact active/zero/failed/stale field combinations;
- success timestamps equality and `fresh_until = checked_at + interval '15 minutes'`;
- failure-code allowlist;
- active/zero legacy mirror equality;
- failed/stale mirror `0/false/unknown`.

The SQL does not insert its own receipt; the migrator inserts it after
postconditions in the same transaction.

- [ ] **Step 3: Implement exhaustive runtime validation**

`src/approvals/allowanceState.ts` exports:

```ts
export const UINT256_MAX_RAW = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
export const ALLOWANCE_FRESHNESS_MS = 15 * 60 * 1000;
export function validateApprovalAllowanceStateV2(
  state: ApprovalAllowanceStateV2,
  evaluatedAt: Date
): ApprovalAllowanceStateV2;
```

Temporal precedence is `failed -> stale -> confirmed_zero/confirmed_active`.
The function returns a normalized immutable copy or throws an allowlisted
validation code; it never silently changes contradictory input to confirmed.

- [ ] **Step 4: Add repository authority and legacy mirror**

Add:

```ts
export async function saveWalletApprovalAllowanceStateV2(
  db: Db,
  input: {
    watchedWalletId: string;
    allowance: ApprovalAllowanceStateV2;
  }
): Promise<void>;
```

`upsertWalletApproval` remains the event/history writer but no longer treats
event amount as current allowance. Event-only writes produce authoritative
`stale` plus the conservative mirror. Row mapping returns the new typed
allowance and never derives it from legacy mirror fields.

- [ ] **Step 5: Run allowance tests GREEN**

```powershell
npx vitest run --configLoader bundle `
  tests/approvals/allowanceState.test.ts `
  tests/storage/repositories.test.ts
npm run typecheck
```

Expected: AC-19/23/24 data states persist correctly; no direct Tron call,
Verify20 score, Bridgers dampener or Telegram copy exists yet.

- [ ] **Step 6: Commit migration and allowance foundation**

```powershell
git add .gitattributes migrations/032_telegram_runtime_forensics_data_contracts.sql `
  src/types.ts src/approvals/allowanceState.ts src/storage/repositories.ts `
  tests/approvals/allowanceState.test.ts tests/storage/repositories.test.ts
git commit -m "feat: add verified allowance state schema"
```

## Task 7: Track migration receipts and fail startup closed

**Files:**

- Create `src/storage/schemaMigrations.ts`.
- Create `src/runtime/startupSchemaGate.ts`.
- Modify `scripts/migrate.ts`.
- Modify `src/index.ts`.
- Test `tests/storage/schemaMigrations.test.ts`.
- Test `tests/storage/migration032.postgres.test.ts`.
- Test `tests/runtime/startupSchemaGate.test.ts`.

- [ ] **Step 1: Implement the shared verifier**

Export exact constants and result:

```ts
export const REQUIRED_SCHEMA_VERSION = 32;
export const REQUIRED_SCHEMA_FILENAME = "032_telegram_runtime_forensics_data_contracts.sql";
export const SCHEMA_MIGRATION_LOCK_ID = 20260712032n;

export type Schema032Verification = {
  verified: true;
  version: 32;
  filename: typeof REQUIRED_SCHEMA_FILENAME;
  checksumSha256: string;
  shortChecksum: string;
};

export async function checksumMigrationBytes(bytes: Uint8Array): Promise<string>;
export async function verifySchema032Structure(
  queryable: Pick<Db, "query">,
  options?: { schemaName?: string }
): Promise<void>;
export async function verifyRequiredSchema032(
  queryable: Pick<Db, "query">,
  expectedChecksum: string,
  options?: { schemaName?: string }
): Promise<Schema032Verification>;
```

Verifier checks exactly one version-32 receipt, filename/checksum, all columns,
types, nullability/defaults, six named constraints and ordered index columns.
`schemaName` defaults to `public`; non-public is accepted only under Vitest for
temporary-schema PostgreSQL tests.

- [ ] **Step 2: Upgrade the migrator from version 032 onward**

Keep `001…031` legacy execution. For numeric prefix `>=032`:

```text
read exact bytes -> sha256 -> BEGIN -> pg_advisory_xact_lock(20260712032)
-> to_regclass(receipt table)
-> matching receipt: skip SQL, run full receipt + structure verification
-> no receipt: run idempotent SQL, verify structure, insert receipt,
   run full verification
-> COMMIT
```

Mismatch is a hard error; failure rolls back receipt and DDL. Do not rewrite an
existing receipt.

- [ ] **Step 3: Add the startup gate before bot/worker creation**

`src/runtime/startupSchemaGate.ts`:

```ts
export async function runStartupSchemaGate(input: {
  verify: () => Promise<Schema032Verification>;
  onVerified: (verification: Schema032Verification) => void;
}): Promise<Schema032Verification> {
  const verification = await input.verify();
  input.onVerified(verification);
  return verification;
}
```

In `src/index.ts`, compute checksum from the shipped migration and call
`runStartupSchemaGate({ verify: () => verifyRequiredSchema032(...),
onVerified: logShortSchemaVersion })` immediately after `createDb`, before
TronScan client, bot, schedules or workers are created. Because module
evaluation awaits this call, rejection prevents every later initializer. Log
only version and short checksum. Do not change `/version` output in Plan 1.

- [ ] **Step 4: Run unit verifier tests GREEN**

```powershell
npx vitest run --configLoader bundle `
  tests/storage/schemaMigrations.test.ts `
  tests/runtime/startupSchemaGate.test.ts
npm run typecheck
```

Expected: checksum/receipt/postcondition failures reject and verified-start
callback remains untouched.

- [ ] **Step 5: Run required PostgreSQL acceptance**

```powershell
$env:REQUIRE_PLAN1_POSTGRES = "1"
$env:TEST_DATABASE_URL = $env:PLAN1_TEST_DATABASE_URL
npx vitest run --configLoader bundle tests/storage/migration032.postgres.test.ts
```

Expected: test is not skipped; first apply, second verified no-op, checksum
mismatch, schema damage, partial-schema recovery, rollback-without-receipt and
legacy stale backfill all PASS.

Then verify the CLI against a disposable migrated database:

```powershell
$env:DATABASE_URL = $env:PLAN1_TEST_DATABASE_URL
npm run db:migrate
npm run db:migrate
```

Expected first run: 032 applied and receipt inserted after postconditions.
Expected second run: 032 verified/skipped with the same short checksum.

- [ ] **Step 6: Commit receipt and startup verification**

```powershell
git add src/storage/schemaMigrations.ts src/runtime/startupSchemaGate.ts `
  scripts/migrate.ts src/index.ts `
  tests/storage/schemaMigrations.test.ts tests/storage/migration032.postgres.test.ts `
  tests/runtime/startupSchemaGate.test.ts
git commit -m "feat: verify schema migration receipts"
```

## Task 8: Verify compatibility and rollback behavior

**Files:**

- Modify `tests/storage/migration032.postgres.test.ts`.
- Modify `tests/storage/repositories.test.ts`.

- [ ] **Step 1: Add legacy/new runtime compatibility assertions**

PostgreSQL tests must prove:

- pre-032 event-derived approval becomes authoritative `stale`;
- legacy non-null columns remain readable;
- new failed/stale writes appear to old runtime as `0/false/unknown`;
- confirmed active/zero writes mirror atomically;
- old result JSON without `coverageV2` goes through adapter with null
  denominator;
- new result JSON survives a serialize/deserialize round trip with exact
  version strings.

- [ ] **Step 2: Run compatibility tests**

```powershell
npx vitest run --configLoader bundle `
  tests/storage/repositories.test.ts `
  tests/storage/migration032.postgres.test.ts `
  tests/forensics/forensicCoverageV2.test.ts
```

Expected: all PASS with PostgreSQL suite actually executed.

- [ ] **Step 3: Exercise rollback compatibility only in candidate/test environment**

```powershell
$env:PLAN1_BASE_SHA = (git config --get branch.codex/remediation-data-coverage.plan1BaseSha).Trim()
$rollbackWorktree = "C:\Users\User\OneDrive\Desktop\smartcontract-plan1-rollback-check"
git worktree add --detach $rollbackWorktree $env:PLAN1_BASE_SHA
if ($LASTEXITCODE -ne 0) { throw "rollback_worktree_create_failed" }
git -C $rollbackWorktree status --short
git worktree remove $rollbackWorktree
```

Plan 1 does not perform a production rollback because it performs no production
deployment. In the disposable candidate database migration 032 and its receipt
remain; no `DROP COLUMN`, receipt deletion or reverse rewrite is allowed. The
repository compatibility tests prove that the base runtime sees the
conservative legacy mirror. Plan 5 owns any real deployment/rollback decision.
A checksum/schema failure blocks the candidate and is fixed in code/migration,
never by editing the receipt manually.

- [ ] **Step 4: Commit compatibility checks**

```powershell
git add tests/storage/migration032.postgres.test.ts tests/storage/repositories.test.ts `
  tests/forensics/forensicCoverageV2.test.ts
git commit -m "test: verify remediation data compatibility"
```

## Task 9: Update knowledge and run Plan 1 release gate

**Files:**

- Modify `docs/knowledge/03-job-lifecycle.md`.
- Modify `docs/knowledge/04-data-sources-tronscan-indexing.md`.
- Modify `docs/knowledge/05-where-is-money-and-incoming.md`.
- Modify `docs/knowledge/06-deepcheck.md`.
- Modify `docs/knowledge/09-current-decisions.md`.
- Modify `docs/knowledge/10-open-problems.md`.
- Modify `docs/knowledge/13-agent-observations.md`.

- [ ] **Step 1: Update knowledge to implemented behavior only**

Document:

- startup refuses to start workers without verified schema 032;
- migration receipt/checksum boundary begins at 032; 001–031 remain
  legacy/untracked;
- low-balance inspects latest five principal transfers and excludes only exact
  GasFree fees before slicing;
- coverage stores available/selected/excluded and legacy null denominator;
- new Where, Incoming and Deep reports persist mode-correct CoverageV2;
- current allowance data is authoritative only after direct-call state is
  supplied; Plan 1 does not yet perform the network call or score it;
- USDD exact route observations exist, but modifier/scoring/copy do not;
- Plan 1 is candidate-only; deployed production runtime/schema remain on the
  previous verified release until Plan 5;
- remaining open problems explicitly retain Plans 2–5 work.

Update knowledge 06 only for the new Deep count/limitation coverage contract.
Do not update knowledge 07 or 08 as if scoring or Telegram UX were implemented.

- [ ] **Step 2: Run focused Plan 1 suites**

```powershell
$env:REQUIRE_PLAN1_POSTGRES = "1"
$env:TEST_DATABASE_URL = $env:PLAN1_TEST_DATABASE_URL
npx vitest run --configLoader bundle `
  tests/forensics/forensicCoverageV2.test.ts `
  tests/forensics/balanceFormingTransfers.test.ts `
  tests/forensics/recentFlowProvenanceSelection.test.ts `
  tests/check/whereIsMoneyCheck.test.ts `
  tests/forensics/incomingDepositJob.test.ts `
  tests/check/deepForensicCheck.test.ts `
  tests/forensics/gasFreeSettlement.test.ts `
  tests/forensics/usddPsmRouteObservation.test.ts `
  tests/approvals/allowanceState.test.ts `
  tests/storage/repositories.test.ts `
  tests/storage/schemaMigrations.test.ts `
  tests/storage/migration032.postgres.test.ts `
  tests/runtime/startupSchemaGate.test.ts
```

Expected: zero failures; PostgreSQL test reports executed, not skipped.

- [ ] **Step 3: Run repository-wide verification**

```powershell
npm run typecheck
npm test
git diff --check
git status --short
```

Expected:

- typecheck GREEN;
- full Vitest GREEN;
- no whitespace errors;
- only intended Plan 1 files are changed/untracked.

- [ ] **Step 4: Audit forbidden scope**

```powershell
$env:PLAN1_BASE_SHA = (git config --get branch.codex/remediation-data-coverage.plan1BaseSha).Trim()
if ($env:PLAN1_BASE_SHA -notmatch '^[0-9a-f]{40}$') { throw "plan1_base_sha_missing" }
git diff $env:PLAN1_BASE_SHA -- src/risk src/bot src/alerts src/monitor migrations/031_address_poisoning_monitor.sql
```

Expected: no scoring, Telegram/alerts, Address Poisoning or migration-031 diff.
`src/index.ts` may differ only by schema startup verification and
`src/check/whereIsMoneyCheck.ts` only by Plan 1 data production/selection.

No deploy, production `db:migrate`, production bot restart, merge to deployed
branch or runtime-label switch is part of this task. The end state is a verified
candidate branch awaiting Plan 5; production continues on its previous runtime.

- [ ] **Step 5: Commit knowledge**

```powershell
git add docs/knowledge/03-job-lifecycle.md `
  docs/knowledge/04-data-sources-tronscan-indexing.md `
  docs/knowledge/05-where-is-money-and-incoming.md `
  docs/knowledge/06-deepcheck.md `
  docs/knowledge/09-current-decisions.md `
  docs/knowledge/10-open-problems.md `
  docs/knowledge/13-agent-observations.md
git commit -m "docs: record remediation data behavior"
```

## 4. Traceability gate

| Requirement | Plan 1 proof | Completion at end of Plan 1 |
|---|---|---|
| REQ-01 | Existing service-boundary regressions rerun in Task 9 | Preserved, not redesigned |
| REQ-02 | AC-11 pre-slice exact fee test + GasFree regression | Complete for selection/data |
| REQ-03 | Coverage limitation mapping + existing local-index suite | Preserved, V2 limitation added |
| REQ-10 | Coverage builder separates limitation from facts | Data complete; Telegram remains Plan 4 |
| REQ-19 | Exhaustive allowance state, migration and repository tests | Data complete; live call/score remain Plan 2 |
| REQ-28 | Exact PSM route observation tests | Data complete; modifier/copy remain Plans 2/4 |
| REQ-30 | AC-10/11 latest-five tests | Complete |
| REQ-31 | AC-13 producers/adapters for Where, Incoming and Deep plus legacy null denominator | Data complete; rendering remains Plan 4 |
| REQ-34 | AC-12 true-no-principal data test | Data complete; copy remains Plan 4 |
| REQ-38 | Legacy adapters, schema verifier and startup fail-closed | Complete for Plan 1 data scope |

| AC | New Plan 1 test | Gate status |
|---|---|---|
| AC-03 | `[AC-03][DATA]` exact 2% outbound inputs | Prerequisite only |
| AC-04 | `[AC-04][DATA]` exact 83% inbound inputs | Prerequisite only |
| AC-05 | `[AC-05][DATA]` deep-history mode preserved | Prerequisite only |
| AC-06 | `[AC-06][DATA]` label/discontinuity ineligible | Prerequisite only |
| AC-10 | `[AC-10]` synthetic TKg latest-five fixture | Complete |
| AC-11 | `[AC-11]` exact GasFree fee excluded before slice | Complete |
| AC-12 | `[AC-12][DATA]` true no-principal state | Prerequisite only |
| AC-13 | `[AC-13][DATA]` mode-correct Where/Incoming/Deep coverage persisted | Prerequisite only |
| AC-19 | `[AC-19][DATA]` confirmed max allowance persists | Prerequisite only |
| AC-20 | Persisted allowance is subject-bound and can carry later balance-at-risk input | Prerequisite only |
| AC-21 | Historical event remains separate from current allowance | Prerequisite only |
| AC-22 | No name/selector field can create current allowance state | Prerequisite only |
| AC-23 | `[AC-23][DATA]` confirmed zero persists | Prerequisite only |
| AC-24 | `[AC-24][DATA]` failed/stale is not current | Prerequisite only |

Plan 1 is accepted only when every row marked `Complete` is GREEN and every
`Prerequisite only` row is demonstrably available to the owning later plan
without any premature scoring/UX behavior.

## 5. Final review checklist

- [ ] First Plan 1 commit contains only new failing ID-linked tests/fixtures.
- [ ] Task 0 captured/persisted a dynamic `PLAN1_BASE_SHA` and proved 032 free.
- [ ] AC-10 and AC-11 have recorded RED then GREEN evidence.
- [ ] No old green test is cited as proof of a new AC.
- [ ] Where, Incoming and Deep new producers persist mode-correct CoverageV2.
- [ ] Legacy adapters never invent Incoming/Deep denominators or synthetic zero.
- [ ] Exact GasFree role is resolved before latest-five slicing.
- [ ] USDD observation contains no applied score/modifier.
- [ ] Allowance event amount never becomes authoritative current allowance.
- [ ] Migration 032 receipt checksum matches exact shipped bytes.
- [ ] `.gitattributes` pins migration SQL to LF and migration 032 contains no CR byte.
- [ ] Postcondition verifier checks real PostgreSQL schema, not only receipt.
- [ ] Startup fails before any worker/bot schedule on schema mismatch.
- [ ] PostgreSQL acceptance ran without skip.
- [ ] The PostgreSQL acceptance was part of the first recorded RED batch.
- [ ] Rollback keeps additive migration and conservative legacy mirror.
- [ ] Address Poisoning diff is empty and its regression remains GREEN.
- [ ] Plans 2–5 were not created or implemented.
- [ ] Production runtime/schema remain unchanged until Plan 5 release authority.
