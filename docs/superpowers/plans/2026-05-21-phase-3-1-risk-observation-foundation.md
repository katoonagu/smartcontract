# Phase 3.1 Risk Observation Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every risk signal and its raw evidence as structured, reproducible observations so future AML, graph, behavior, approval, and LLM layers can build on audit-friendly data instead of transient reasons.

**Architecture:** Keep scoring deterministic and evidence-first. Add `raw_evidence` and `risk_signal_observations`, introduce a risk evaluation service that converts internal labels and detector/provider signals into stored observations, and wire manual checks plus incoming-transfer alerts through that service. Do not add TronScan Security, sanctions, Chainabuse, graph traversal, approvals, or LLM explanations in this phase; this phase creates the evidence substrate they will use.

**Tech Stack:** TypeScript, Node.js, PostgreSQL, pg transactions, Vitest, existing grammY bot and monitoring worker.

---

## Source Inputs

- `docs/research/2026-05-21-risk-intelligence-brief.md`
- `docs/research/2026-05-20-risk-signals-research.md`
- Current code state after Phase 2 Bot UX + Wallet Dashboard.

## Scope Decisions

- Build **Phase 3.1 only** from the new brief.
- Do not integrate paid AML or free external feeds yet.
- Do not implement graph proximity or behavioral detectors yet.
- Do not use an LLM for scoring.
- Persist structured evidence for current internal-label and light behavior reasons first.
- Preserve existing user-facing alerts and `/check` output, but make the underlying score reproducible from stored observations.

## File Structure

- Create `migrations/003_risk_observation_foundation.sql`: raw evidence and risk observation schema.
- Modify `src/types.ts`: extend risk reason metadata and add risk observation/evidence domain types.
- Create `src/risk/evaluation.ts`: converts labels/signals into risk observations, calls deterministic scoring, and returns a risk evaluation.
- Modify `src/risk/riskEngine.ts`: preserve compatibility while allowing richer `RiskSignal` metadata to pass into `RiskReason`.
- Modify `src/storage/repositories.ts`: add transactional persistence for raw evidence and risk signal observations.
- Modify `src/check/manualCheck.ts`: return and optionally persist a risk evaluation for manual address/tx checks.
- Modify `src/monitor/monitorWorker.ts`: persist risk evaluation evidence before sending incoming-transfer alerts.
- Modify `src/wallet/metrics.ts`: wallet safety report can reuse evaluation metadata without pretending external checks exist.
- Modify `tests/risk/riskEngine.test.ts`: metadata passthrough and scoring compatibility.
- Create `tests/risk/evaluation.test.ts`: internal-label and behavior observation generation.
- Modify `tests/storage/repositories.test.ts`: repository SQL/transaction coverage.
- Modify `tests/check/manualCheck.test.ts`: manual checks persist observations when dependency is provided.
- Modify `tests/monitor/monitorWorker.test.ts`: incoming alerts persist observations before marking alert sent.
- Modify `README.md`: document evidence-first scoring and what Phase 3.1 does/does not do.

## Data Model

Add `raw_evidence`:

```sql
create table if not exists raw_evidence (
  id text primary key,
  source text not null,
  source_type text not null,
  chain text not null default 'tron',
  address text,
  tx_hash text,
  observed_transaction_hash text,
  evidence_json jsonb not null,
  created_at timestamptz not null default now()
);
```

Add `risk_signal_observations`:

```sql
create table if not exists risk_signal_observations (
  id text primary key,
  subject_chain text not null default 'tron',
  subject_address text not null,
  subject_tx_hash text,
  observed_transaction_hash text,
  signal_group text not null,
  code text not null,
  message text not null,
  score_impact integer not null,
  confidence text not null,
  severity text not null,
  source text not null,
  policy_version text not null,
  raw_evidence_id text references raw_evidence(id) on delete set null,
  created_at timestamptz not null default now()
);
```

Indexes:

```sql
create index if not exists risk_signal_observations_subject_idx
  on risk_signal_observations(subject_chain, subject_address, created_at desc);

create index if not exists risk_signal_observations_tx_idx
  on risk_signal_observations(observed_transaction_hash);

create index if not exists raw_evidence_address_idx
  on raw_evidence(chain, address, created_at desc);
```

Allowed values:

- `signal_group`: `internal_label`, `provider`, `graph`, `behavior`, `incoming_context`, `approval`, `manual`.
- `confidence`: `low`, `medium`, `high`.
- `severity`: `info`, `low`, `medium`, `high`, `critical`.
- `source_type`: `internal_label`, `provider_response`, `detector_output`, `transfer_context`, `manual_input`.

## Task 1: Domain Types And Risk Metadata

**Files:**
- Modify: `src/types.ts`
- Modify: `src/risk/riskEngine.ts`
- Test: `tests/risk/riskEngine.test.ts`

- [ ] Extend `RiskReason` with optional metadata:

```ts
export type RiskReason = {
  code: string;
  message: string;
  scoreImpact: number;
  source?: string;
  confidence?: "low" | "medium" | "high";
  severity?: "info" | "low" | "medium" | "high" | "critical";
  evidenceRef?: string;
};
```

- [ ] Extend `RiskSignal` in `src/risk/riskEngine.ts`:

```ts
export type RiskSignal = {
  code: string;
  message: string;
  scoreImpact: number;
  source?: string;
  confidence?: "low" | "medium" | "high";
  severity?: "info" | "low" | "medium" | "high" | "critical";
  evidenceRef?: string;
};
```

- [ ] Update `sanitizeSignals` so metadata survives:

```ts
function sanitizeSignals(signals: RiskSignal[]): RiskSignal[] {
  return signals
    .filter((signal) => Number.isFinite(signal.scoreImpact) && signal.scoreImpact !== 0)
    .map((signal) => ({
      ...signal,
      scoreImpact: Math.max(0, Math.min(50, signal.scoreImpact))
    }));
}
```

- [ ] Add test:

```ts
it("preserves signal metadata in risk reasons", () => {
  const report = calculateRisk({
    subjectAddress: "TSubject111111111111111111111111111111",
    labels: [],
    graphSignals: [
      {
        code: "risky_1_hop",
        message: "1-hop exposure to risky address",
        scoreImpact: 35,
        source: "graph_v0",
        confidence: "medium",
        severity: "high",
        evidenceRef: "evidence-1"
      }
    ],
    behaviorSignals: [],
    amlSignals: []
  });

  expect(report.reasons[0]).toMatchObject({
    code: "risky_1_hop",
    source: "graph_v0",
    confidence: "medium",
    severity: "high",
    evidenceRef: "evidence-1"
  });
});
```

## Task 2: Risk Evidence Schema And Repositories

**Files:**
- Create: `migrations/003_risk_observation_foundation.sql`
- Modify: `src/storage/repositories.ts`
- Test: `tests/storage/repositories.test.ts`

- [ ] Add migration `003_risk_observation_foundation.sql` using the schema above. Make it idempotent with `create table if not exists`, `add column if not exists` if needed, guarded constraints, and indexes.

- [ ] Add repository types:

```ts
export type RawEvidenceInput = {
  id: string;
  source: string;
  sourceType: "internal_label" | "provider_response" | "detector_output" | "transfer_context" | "manual_input";
  chain: string;
  address: string | null;
  txHash: string | null;
  observedTransactionHash: string | null;
  evidenceJson: Record<string, unknown>;
};

export type RiskSignalObservationInput = {
  id: string;
  subjectChain: string;
  subjectAddress: string;
  subjectTxHash: string | null;
  observedTransactionHash: string | null;
  signalGroup: "internal_label" | "provider" | "graph" | "behavior" | "incoming_context" | "approval" | "manual";
  code: string;
  message: string;
  scoreImpact: number;
  confidence: "low" | "medium" | "high";
  severity: "info" | "low" | "medium" | "high" | "critical";
  source: string;
  policyVersion: string;
  rawEvidenceId: string | null;
};
```

- [ ] Add `saveRiskEvaluationEvidence(db, input)`:

```ts
export async function saveRiskEvaluationEvidence(
  db: Db,
  input: {
    rawEvidence: RawEvidenceInput[];
    observations: RiskSignalObservationInput[];
  }
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");
    for (const evidence of input.rawEvidence) {
      await client.query(
        `insert into raw_evidence (
           id, source, source_type, chain, address, tx_hash,
           observed_transaction_hash, evidence_json
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set evidence_json = excluded.evidence_json`,
        [
          evidence.id,
          evidence.source,
          evidence.sourceType,
          evidence.chain,
          evidence.address,
          evidence.txHash,
          evidence.observedTransactionHash,
          evidence.evidenceJson
        ]
      );
    }
    for (const observation of input.observations) {
      await client.query(
        `insert into risk_signal_observations (
           id, subject_chain, subject_address, subject_tx_hash,
           observed_transaction_hash, signal_group, code, message,
           score_impact, confidence, severity, source, policy_version,
           raw_evidence_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         on conflict (id) do update set
           message = excluded.message,
           score_impact = excluded.score_impact,
           confidence = excluded.confidence,
           severity = excluded.severity,
           raw_evidence_id = excluded.raw_evidence_id`,
        [
          observation.id,
          observation.subjectChain,
          observation.subjectAddress,
          observation.subjectTxHash,
          observation.observedTransactionHash,
          observation.signalGroup,
          observation.code,
          observation.message,
          observation.scoreImpact,
          observation.confidence,
          observation.severity,
          observation.source,
          observation.policyVersion,
          observation.rawEvidenceId
        ]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
```

- [ ] Add tests that assert:
  - raw evidence insert uses `raw_evidence`;
  - observations insert uses `risk_signal_observations`;
  - transaction begins, commits on success, rolls back on thrown query;
  - no secrets or `.env` values are stored by default.

## Task 3: Risk Evaluation Service

**Files:**
- Create: `src/risk/evaluation.ts`
- Test: `tests/risk/evaluation.test.ts`

- [ ] Create constants:

```ts
export const CURRENT_RISK_POLICY_VERSION = "2026-05-21-v1";
export const DEFAULT_CHAIN = "tron";
```

- [ ] Add types:

```ts
export type RiskEvaluationContext = {
  subjectAddress: string;
  subjectTxHash?: string | null;
  observedTransactionHash?: string | null;
  chain?: string;
  policyVersion?: string;
};

export type RiskEvaluation = {
  report: RiskReport;
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
};
```

- [ ] Implement deterministic IDs:

```ts
function stableId(parts: unknown[]): string {
  const json = JSON.stringify(parts);
  return crypto.createHash("sha256").update(json).digest("hex");
}
```

Use `import crypto from "node:crypto";`.

- [ ] Implement `evaluateAddressRisk(input)`:

```ts
export function evaluateAddressRisk(input: {
  context: RiskEvaluationContext;
  labels: AddressLabel[];
  graphSignals?: RiskSignal[];
  behaviorSignals?: RiskSignal[];
  amlSignals?: RiskSignal[];
}): RiskEvaluation {
  const chain = input.context.chain ?? DEFAULT_CHAIN;
  const policyVersion = input.context.policyVersion ?? CURRENT_RISK_POLICY_VERSION;
  const rawEvidence: RawEvidenceInput[] = [];
  const internalLabelSignals = input.labels.map((label) => {
    const evidenceId = stableId(["raw", chain, input.context.subjectAddress, "internal_label", label.label, label.createdAt.toISOString()]);
    rawEvidence.push({
      id: evidenceId,
      source: label.source,
      sourceType: "internal_label",
      chain,
      address: label.address,
      txHash: null,
      observedTransactionHash: input.context.observedTransactionHash ?? null,
      evidenceJson: {
        label: label.label,
        source: label.source,
        createdByTelegramId: label.createdByTelegramId,
        createdAt: label.createdAt.toISOString()
      }
    });
    return {
      code: `internal_label_${label.label}`,
      message: `Internal label: ${label.label}`,
      scoreImpact: label.label === "trusted" || label.label === "false_positive" ? -40 : ["scam", "stolen_funds", "phishing", "mixer_like", "risky_contract"].includes(label.label) ? 90 : 35,
      source: label.source,
      confidence: label.source === "service_admin" ? "high" : "medium",
      severity: ["scam", "stolen_funds", "phishing", "mixer_like", "risky_contract"].includes(label.label) ? "critical" : "medium",
      evidenceRef: evidenceId
    } satisfies RiskSignal;
  });

  const behaviorSignals = input.behaviorSignals ?? [];
  const graphSignals = input.graphSignals ?? [];
  const amlSignals = input.amlSignals ?? [];
  const report = calculateRisk({
    subjectAddress: input.context.subjectAddress,
    labels: [],
    graphSignals,
    behaviorSignals: [...internalLabelSignals, ...behaviorSignals],
    amlSignals
  });

  const observations = report.reasons.map((reason) => ({
    id: stableId(["observation", chain, input.context.subjectAddress, input.context.observedTransactionHash ?? null, reason.code, policyVersion]),
    subjectChain: chain,
    subjectAddress: input.context.subjectAddress,
    subjectTxHash: input.context.subjectTxHash ?? null,
    observedTransactionHash: input.context.observedTransactionHash ?? null,
    signalGroup: reason.code.startsWith("internal_label_") ? "internal_label" : reason.source?.startsWith("graph") ? "graph" : reason.source?.startsWith("aml") ? "provider" : "behavior",
    code: reason.code,
    message: reason.message,
    scoreImpact: reason.scoreImpact,
    confidence: reason.confidence ?? "medium",
    severity: reason.severity ?? "medium",
    source: reason.source ?? "risk_engine",
    policyVersion,
    rawEvidenceId: reason.evidenceRef ?? null
  } satisfies RiskSignalObservationInput));

  return { report, rawEvidence, observations };
}
```

- [ ] Add tests for:
  - service-admin scam label creates raw evidence and observation;
  - trusted label creates a negative score observation but final score does not go below 0;
  - behavior signal metadata becomes a behavior observation;
  - same input generates stable IDs across repeated calls;
  - policy version is attached to every observation.

## Task 4: Manual Check Integration

**Files:**
- Modify: `src/check/manualCheck.ts`
- Modify: `src/bot/createBot.ts`
- Test: `tests/check/manualCheck.test.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] Update `ManualCheckResult`:

```ts
export type ManualCheckResult = {
  subjectAddress: string;
  report: RiskReport;
  observations: RiskSignalObservationInput[];
  rawEvidence: RawEvidenceInput[];
};
```

- [ ] Add optional dependency:

```ts
recordRiskEvaluation?(evaluation: {
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
}): Promise<void>;
```

- [ ] Replace direct `calculateRisk` call in `checkAddress` with `evaluateAddressRisk`. If `recordRiskEvaluation` exists, call it before returning.

- [ ] In `createBot.ts`, pass:

```ts
recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation)
```

to manual address and tx checks.

- [ ] Add tests:
  - `/check <address>` still returns the same user text;
  - `checkAddress` calls `recordRiskEvaluation` with at least one observation when labels exist;
  - if no labels/signals exist, storing an empty evaluation is allowed but does not create fake risk reasons.

## Task 5: Incoming Alert Integration

**Files:**
- Modify: `src/monitor/monitorWorker.ts`
- Modify: `src/index.ts`
- Test: `tests/monitor/monitorWorker.test.ts`

- [ ] Add dependency to `PollingCycleDeps`:

```ts
recordRiskEvaluation?(evaluation: {
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
}): Promise<void>;
```

- [ ] Replace `calculateSenderRisk` internals with `evaluateAddressRisk`.

- [ ] In `deliverUserAlert`, persist `evaluation.rawEvidence` and `evaluation.observations` before `sendUserAlert`.

- [ ] In `src/index.ts`, pass:

```ts
recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation)
```

- [ ] Add tests:
  - incoming transfer with internal label stores risk observation before marking user alert sent;
  - if evidence persistence fails, alert remains failed/retryable and user alert is not marked sent;
  - admin alert still only triggers on `HIGH` or `CRITICAL`.

## Task 6: Read Model For Recent Observations

**Files:**
- Modify: `src/storage/repositories.ts`
- Test: `tests/storage/repositories.test.ts`

- [ ] Add:

```ts
export async function listRecentRiskSignalObservations(
  db: Db,
  input: { subjectAddress: string; chain?: string; limit?: number }
): Promise<RiskSignalObservationInput[]> {
  const result = await db.query(
    `select id, subject_chain, subject_address, subject_tx_hash,
       observed_transaction_hash, signal_group, code, message, score_impact,
       confidence, severity, source, policy_version, raw_evidence_id
     from risk_signal_observations
     where subject_chain = $1 and subject_address = $2
     order by created_at desc
     limit $3`,
    [input.chain ?? "tron", input.subjectAddress, input.limit ?? 25]
  );
  return result.rows.map(mapRiskSignalObservationRow);
}
```

- [ ] Add tests for row mapping and default limit.

This read model is not yet shown in UI. It exists so Phase 3.2 providers can reuse cached/recent observations and so admins can inspect evidence later.

## Task 7: Docs And Smoke

**Files:**
- Modify: `README.md`

- [ ] Add a short "Evidence-First Risk Intelligence" section:

```md
## Evidence-First Risk Intelligence

Risk score is deterministic. Every non-zero reason should be backed by a stored `risk_signal_observations` row and, when available, a `raw_evidence` row. LLM summaries and provider adapters are future layers and must not be the only source of scoring truth.
```

- [ ] Add Phase 3.1 smoke checklist:

```md
1. Apply migrations with `npm run db:migrate`.
2. Run `/mark <address> scam` as service admin.
3. Run `/check <address>`.
4. Confirm the response still shows `Risk: CRITICAL`.
5. Query `risk_signal_observations` for the address and confirm an `internal_label_scam` row exists.
6. Confirm `raw_evidence` contains the label evidence JSON.
```

- [ ] Run:

```bash
npm test
npm run typecheck
npm run db:migrate
```

Expected:

```text
all tests pass
typecheck exits 0
003 migration applies repeatedly without error
```

## Acceptance Criteria

- `raw_evidence` and `risk_signal_observations` exist and migrations are idempotent.
- Internal labels are converted into stored evidence-backed observations.
- Behavior/provider/graph signal metadata can be represented even before providers are integrated.
- Manual `/check` persists observations when the report has non-zero reasons.
- Incoming-transfer alert risk evaluation persists observations before user alert is marked `sent`.
- Score is reproducible from `policy_version` and stored observations.
- User-facing language remains risk/evidence phrasing, not legal accusation.
- No private keys, signing, custody, or payout decisions are introduced.

## Explicit Non-Goals

- No TronScan Security API integration in this phase.
- No sanctions/OpenSanctions/Chainabuse integration in this phase.
- No commercial AML provider in this phase.
- No graph traversal/BFS in this phase.
- No approval/allowance scanner in this phase.
- No bridge route attribution in this phase.
- No LLM case explainer in this phase.

## Next Phase After This

**Phase 3.2: Source Labels And Free Signals**

Recommended first adapters:

1. TronScan Security/account flags.
2. TronScan authorization/approval security endpoint.
3. Chainabuse or sanctions baseline, depending on API access and commercial terms.

These adapters should only produce normalized observations through the Phase 3.1 evidence layer.
