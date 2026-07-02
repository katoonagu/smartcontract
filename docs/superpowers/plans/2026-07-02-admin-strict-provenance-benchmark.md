# Admin Strict Provenance Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Admin-only strict provenance benchmark mode that never publishes a forensic score until selected provenance-scope hop histories are covered to their target timestamps.

**Architecture:** Reuse existing `where_is_money_check` jobs and existing TRON address index tables. Mark strict benchmark jobs with `progress_json.strictProvenanceBenchmark=true`, store phase/progress/metrics in `progress_json`, store score validity in `result_json`, and use a non-blocking `waiting_for_targeted_index` phase so workers are released while targeted index tasks run.

**Tech Stack:** TypeScript, PostgreSQL repository functions, existing forensic job queue, existing TronScan scheduler/indexer, Vitest, Admin HTML/JS console.

---

## Scope Check

This plan implements only the first approved stage: **Admin-only strict provenance benchmark**.

It does not implement Telegram strict mode, global TRON indexing, CSV/browser automation, captcha solving, unlimited graph expansion, or a new DB status enum. Normal Telegram `/check` remains unchanged.

Strict coverage means coverage inside the selected provenance scope:

- selected balance-forming incoming transfers;
- paths found from those selected transfers;
- hop addresses needed by those paths;
- hop histories up to target timestamps;
- configured `maxDepth`;
- configured hard safety limits.

The Admin benchmark job uses an all-time wallet window (`windowStart: new Date(0)`, `windowEnd: now`) so selected balance-forming transfers are not limited to the last 30 days.

## File Structure

Create:

- `src/forensics/strictProvenanceBenchmark.ts` - small helper module for strict benchmark flag parsing, phases, score validity, wait state, and metric snapshots.
- `tests/forensics/strictProvenanceBenchmark.test.ts` - unit tests for helper behavior.

Modify:

- `src/forensics/forensicJobProgress.ts` - add strict benchmark phases to the existing job phase union and runtime parsing.
- `tests/forensics/forensicJobProgress.test.ts` - add phase parsing/runtime summary checks.
- `src/storage/repositories.ts` - add waiting/requeue helpers for strict benchmark jobs and make claim skip `waiting_for_targeted_index`.
- `tests/storage/forensicCheckJobs.test.ts` - cover waiting release, claim skip, and resume after address index.
- `src/admin/adminServer.ts` - add Admin POST endpoint to create strict benchmark jobs.
- `tests/admin/adminServer.test.ts` - cover auth, validation, and created job payload.
- `src/admin/adminConsole.ts` - add a compact Admin control to start a strict benchmark and render score validity/progress fields.
- `tests/admin/adminConsole.test.ts` - cover visible control and strict progress copy.
- `src/forensics/deepForensicJob.ts` - implement strict benchmark behavior for `where_is_money_check`: phase updates, non-blocking targeted wait, `score_valid`, and blocked technical statuses.
- `tests/forensics/deepForensicJob.test.ts` - cover non-blocking wait, resume, score validity, and normal mode unchanged.
- `src/forensics/addressIndexWorker.ts` - notify waiting strict jobs when requested targeted index work completes or fails.
- `tests/forensics/addressIndexWorker.test.ts` - cover resume notification after index success/failure.
- `src/index.ts` - wire new Admin dependency and new deep job/index worker repository functions.
- `src/admin/forensicsGraph.ts` - project strict score validity and benchmark metrics into graph summary.
- `tests/admin/forensicsGraph.test.ts` - cover blocked score and metrics projection.

No migration is required for this first stage. Store strict benchmark data in existing `progress_json` and `result_json`.

## Shared Names

Use these exact JSON keys:

```ts
strictProvenanceBenchmark: true
strictProvenance: {
  phase: "selecting_flows" | "tracing_paths" | "checking_hop_coverage" | "indexing_hop_history" |
    "waiting_for_targeted_index" | "reading_local_index" | "scoring" | "completed" |
    "provider_limited" | "failed";
  scoreValid: boolean;
  scoreBlockedReason: string | null;
  technicalStatus: string | null;
  waitingFor: null | {
    address: string;
    coverageMode: "targeted";
    targetTimestamp: string;
    queuedReason: string;
  };
  selectedFlowCount: number | null;
  pathCount: number | null;
  coveredHopCount: number;
  totalHopCount: number;
}
strictBenchmarkMetrics: {
  total: {
    startedAt: string;
    completedAt: string | null;
    elapsedMs: number;
    keyCount: number | null;
    accountGroupCount: number | null;
    requestCount: number;
    successCount: number;
    failedCount: number;
    retryCount: number;
    rateLimitedCount: number;
    forbiddenCount: number;
    serverErrorCount: number;
    cooldownMs: number;
    pagesFetched: number;
    transfersFetched: number;
    effectiveRps: number | null;
  };
  stages: {
    apiMs: number;
    dbWriteMs: number;
    dbReadMs: number;
    traceMs: number;
    scoringMs: number;
  };
}
score_valid: boolean
score_blocked_reason: string | null
technical_status: string
```

Use snake_case only in final `result_json` fields that Admin/reporting reads directly. Use camelCase inside internal `progress_json` objects, matching existing code style.

## Task 1: Strict Benchmark Helper And Phases

**Files:**

- Create: `src/forensics/strictProvenanceBenchmark.ts`
- Create: `tests/forensics/strictProvenanceBenchmark.test.ts`
- Modify: `src/forensics/forensicJobProgress.ts`
- Modify: `tests/forensics/forensicJobProgress.test.ts`

- [ ] **Step 1: Write helper tests**

Create `tests/forensics/strictProvenanceBenchmark.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildStrictBenchmarkInitialProgress,
  isStrictProvenanceBenchmarkJob,
  strictBlockedResultJson,
  strictCompletedResultJson,
  strictWaitingProgressPatch
} from "../../src/forensics/strictProvenanceBenchmark";

describe("strict provenance benchmark helpers", () => {
  it("builds initial Admin-only strict benchmark progress", () => {
    const progress = buildStrictBenchmarkInitialProgress({
      locale: "ru",
      keyCount: 4,
      accountGroupCount: 4,
      now: new Date("2026-07-02T10:00:00.000Z")
    });

    expect(progress).toMatchObject({
      mode: "wallet_profile",
      locale: "ru",
      strictProvenanceBenchmark: true,
      jobPhase: "selecting_flows",
      strictProvenance: {
        phase: "selecting_flows",
        scoreValid: false,
        scoreBlockedReason: null,
        technicalStatus: null,
        waitingFor: null,
        coveredHopCount: 0,
        totalHopCount: 0
      },
      strictBenchmarkMetrics: {
        total: {
          startedAt: "2026-07-02T10:00:00.000Z",
          keyCount: 4,
          accountGroupCount: 4,
          requestCount: 0
        },
        stages: {
          apiMs: 0,
          dbWriteMs: 0,
          dbReadMs: 0,
          traceMs: 0,
          scoringMs: 0
        }
      }
    });
  });

  it("recognizes only explicit strict benchmark jobs", () => {
    expect(isStrictProvenanceBenchmarkJob({
      progressJson: { strictProvenanceBenchmark: true }
    })).toBe(true);
    expect(isStrictProvenanceBenchmarkJob({
      progressJson: { strictProvenanceBenchmark: "true" }
    })).toBe(false);
  });

  it("builds waiting progress without marking score valid", () => {
    const patch = strictWaitingProgressPatch({
      address: "THop111111111111111111111111111111111",
      targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
      queuedReason: "where_is_money_hop"
    });

    expect(patch).toMatchObject({
      jobPhase: "waiting_for_targeted_index",
      strictProvenance: {
        phase: "waiting_for_targeted_index",
        scoreValid: false,
        waitingFor: {
          address: "THop111111111111111111111111111111111",
          coverageMode: "targeted",
          targetTimestamp: "2026-06-30T11:52:00.000Z",
          queuedReason: "where_is_money_hop"
        }
      }
    });
  });

  it("builds final score validity result fields", () => {
    expect(strictCompletedResultJson()).toEqual({
      score_valid: true,
      score_blocked_reason: null,
      technical_status: "completed"
    });
    expect(strictBlockedResultJson("provider_cap_unresolved")).toEqual({
      score_valid: false,
      score_blocked_reason: "provider_cap_unresolved",
      technical_status: "provider_limited"
    });
  });
});
```

- [ ] **Step 2: Add phase parsing test**

In `tests/forensics/forensicJobProgress.test.ts`, add:

```ts
import { describe, expect, it } from "vitest";
import { buildForensicJobRuntimeSummary, parseForensicJobPhase } from "../../src/forensics/forensicJobProgress";

describe("forensic job progress", () => {
  it("accepts strict provenance benchmark phases", () => {
    expect(parseForensicJobPhase("selecting_flows")).toBe("selecting_flows");
    expect(parseForensicJobPhase("tracing_paths")).toBe("tracing_paths");
    expect(parseForensicJobPhase("checking_hop_coverage")).toBe("checking_hop_coverage");
    expect(parseForensicJobPhase("indexing_hop_history")).toBe("indexing_hop_history");
    expect(parseForensicJobPhase("waiting_for_targeted_index")).toBe("waiting_for_targeted_index");
    expect(parseForensicJobPhase("reading_local_index")).toBe("reading_local_index");
    expect(parseForensicJobPhase("scoring")).toBe("scoring");
    expect(parseForensicJobPhase("provider_limited")).toBe("provider_limited");
  });

  it("summarizes waiting strict benchmark phase", () => {
    expect(buildForensicJobRuntimeSummary({
      jobPhase: "waiting_for_targeted_index",
      jobHeartbeatAt: "2026-07-02T10:00:00.000Z"
    })).toMatchObject({
      phase: "waiting_for_targeted_index",
      heartbeatAt: "2026-07-02T10:00:00.000Z"
    });
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npx vitest run tests/forensics/strictProvenanceBenchmark.test.ts tests/forensics/forensicJobProgress.test.ts --configLoader bundle
```

Expected: FAIL because helper file and phases do not exist.

- [ ] **Step 4: Add helper implementation**

Create `src/forensics/strictProvenanceBenchmark.ts`:

```ts
import type { ForensicJobProgressPatch } from "./forensicJobProgress";

export type StrictProvenanceBenchmarkPhase =
  | "selecting_flows"
  | "tracing_paths"
  | "checking_hop_coverage"
  | "indexing_hop_history"
  | "waiting_for_targeted_index"
  | "reading_local_index"
  | "scoring"
  | "completed"
  | "provider_limited"
  | "failed";

export type StrictScoreBlockedReason =
  | "provider_error"
  | "rate_limited_after_retries"
  | "provider_inconsistent"
  | "provider_cap_unresolved"
  | "hard_safety_limit_exceeded";

export type StrictWaitingForTargetedIndex = {
  address: string;
  coverageMode: "targeted";
  targetTimestamp: string;
  queuedReason: string;
};

export type StrictProvenanceProgress = {
  phase: StrictProvenanceBenchmarkPhase;
  scoreValid: boolean;
  scoreBlockedReason: StrictScoreBlockedReason | null;
  technicalStatus: string | null;
  waitingFor: StrictWaitingForTargetedIndex | null;
  selectedFlowCount: number | null;
  pathCount: number | null;
  coveredHopCount: number;
  totalHopCount: number;
};

export function isStrictProvenanceBenchmarkJob(input: { progressJson: Record<string, unknown> }): boolean {
  return input.progressJson.strictProvenanceBenchmark === true;
}

export function buildStrictBenchmarkInitialProgress(input: {
  locale: "ru" | "en";
  keyCount: number | null;
  accountGroupCount: number | null;
  now?: Date;
}): Record<string, unknown> {
  const now = input.now ?? new Date();
  return {
    mode: "wallet_profile",
    locale: input.locale,
    strictProvenanceBenchmark: true,
    jobPhase: "selecting_flows",
    strictProvenance: {
      phase: "selecting_flows",
      scoreValid: false,
      scoreBlockedReason: null,
      technicalStatus: null,
      waitingFor: null,
      selectedFlowCount: null,
      pathCount: null,
      coveredHopCount: 0,
      totalHopCount: 0
    } satisfies StrictProvenanceProgress,
    strictBenchmarkMetrics: {
      total: {
        startedAt: now.toISOString(),
        completedAt: null,
        elapsedMs: 0,
        keyCount: input.keyCount,
        accountGroupCount: input.accountGroupCount,
        requestCount: 0,
        successCount: 0,
        failedCount: 0,
        retryCount: 0,
        rateLimitedCount: 0,
        forbiddenCount: 0,
        serverErrorCount: 0,
        cooldownMs: 0,
        pagesFetched: 0,
        transfersFetched: 0,
        effectiveRps: null
      },
      stages: {
        apiMs: 0,
        dbWriteMs: 0,
        dbReadMs: 0,
        traceMs: 0,
        scoringMs: 0
      }
    }
  };
}

export function strictWaitingProgressPatch(input: {
  address: string;
  targetTimestamp: Date;
  queuedReason: string;
}): ForensicJobProgressPatch & { strictProvenance: Partial<StrictProvenanceProgress> } {
  return {
    jobPhase: "waiting_for_targeted_index",
    strictProvenance: {
      phase: "waiting_for_targeted_index",
      scoreValid: false,
      waitingFor: {
        address: input.address,
        coverageMode: "targeted",
        targetTimestamp: input.targetTimestamp.toISOString(),
        queuedReason: input.queuedReason
      }
    }
  };
}

export function strictCompletedResultJson(): Record<string, unknown> {
  return {
    score_valid: true,
    score_blocked_reason: null,
    technical_status: "completed"
  };
}

export function strictBlockedResultJson(reason: StrictScoreBlockedReason): Record<string, unknown> {
  return {
    score_valid: false,
    score_blocked_reason: reason,
    technical_status: "provider_limited"
  };
}
```

- [ ] **Step 5: Extend forensic phases**

In `src/forensics/forensicJobProgress.ts`, extend `ForensicJobPhase`:

```ts
  | "selecting_flows"
  | "tracing_paths"
  | "checking_hop_coverage"
  | "indexing_hop_history"
  | "waiting_for_targeted_index"
  | "reading_local_index"
  | "scoring"
  | "provider_limited"
```

Add the same strings to the `phases` set.

Extend `ForensicJobProgressPatch` to allow strict progress:

```ts
  strictProvenance?: Record<string, unknown>;
  strictBenchmarkMetrics?: Record<string, unknown>;
```

In `mergeForensicJobProgress`, merge nested `strictProvenance` and `strictBenchmarkMetrics` shallowly, the same way `crossChainStage2Progress` is merged:

```ts
  const strictProvenance = isRecord(base.strictProvenance) || patch.strictProvenance
    ? {
        ...(isRecord(base.strictProvenance) ? base.strictProvenance : {}),
        ...(patch.strictProvenance ?? {})
      }
    : undefined;
  const strictBenchmarkMetrics = isRecord(base.strictBenchmarkMetrics) || patch.strictBenchmarkMetrics
    ? {
        ...(isRecord(base.strictBenchmarkMetrics) ? base.strictBenchmarkMetrics : {}),
        ...(patch.strictBenchmarkMetrics ?? {})
      }
    : undefined;
```

Then include:

```ts
    ...(strictProvenance ? { strictProvenance } : {}),
    ...(strictBenchmarkMetrics ? { strictBenchmarkMetrics } : {})
```

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run tests/forensics/strictProvenanceBenchmark.test.ts tests/forensics/forensicJobProgress.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/forensics/strictProvenanceBenchmark.ts src/forensics/forensicJobProgress.ts tests/forensics/strictProvenanceBenchmark.test.ts tests/forensics/forensicJobProgress.test.ts
git commit -m "feat(forensics): define strict provenance benchmark progress"
```

## Task 2: Waiting Job Storage Helpers

**Files:**

- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/forensicCheckJobs.test.ts`

- [ ] **Step 1: Write failing storage tests**

In `tests/storage/forensicCheckJobs.test.ts`, add tests for these repository behaviors. Use the existing fake `db.query` style in this file.

```ts
it("releases strict provenance jobs to queued waiting state", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rowCount: 1, rows: [] };
    }
  };

  const released = await releaseForensicCheckJobToWaiting(db, {
    id: "job-1",
    progressJson: {
      strictProvenanceBenchmark: true,
      jobPhase: "waiting_for_targeted_index"
    },
    lastError: null
  });

  expect(released).toBe(true);
  expect(queries[0].sql).toContain("set status = 'queued'");
  expect(queries[0].sql).toContain("where id = $1 and status = 'running'");
  expect(queries[0].params[0]).toBe("job-1");
});

it("does not claim strict jobs waiting for targeted index", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rows: [] };
    }
  };

  await claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] });

  expect(queries[0].sql).toContain("waiting_for_targeted_index");
  expect(queries[0].sql).toContain("strictProvenanceBenchmark");
});

it("marks a waiting strict job ready after targeted index completion", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rowCount: 1, rows: [] };
    }
  };

  const updated = await markStrictProvenanceJobReadyAfterIndex(db, {
    id: "job-1",
    address: "THop111111111111111111111111111111111",
    targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
    indexStatus: "complete",
    statusReason: "complete_provider_windowed",
    lastError: null
  });

  expect(updated).toBe(true);
  expect(queries[0].sql).toContain("reading_local_index");
  expect(queries[0].sql).toContain("where id = $1");
});
```

Add imports:

```ts
import {
  claimNextForensicCheckJob,
  markStrictProvenanceJobReadyAfterIndex,
  releaseForensicCheckJobToWaiting
} from "../../src/storage/repositories";
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run tests/storage/forensicCheckJobs.test.ts --configLoader bundle
```

Expected: FAIL because the new functions and claim filter do not exist.

- [ ] **Step 3: Add repository functions**

In `src/storage/repositories.ts`, export:

```ts
export async function releaseForensicCheckJobToWaiting(
  db: Db,
  input: { id: string; progressJson: Record<string, unknown>; lastError?: string | null }
): Promise<boolean> {
  const result = await db.query(
    `update forensic_check_jobs
     set status = 'queued',
       progress_json = $2,
       last_error = $3,
       updated_at = now()
     where id = $1 and status = 'running'`,
    [input.id, input.progressJson, input.lastError ?? null]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markStrictProvenanceJobReadyAfterIndex(
  db: Db,
  input: {
    id: string;
    address: string;
    targetTimestamp: Date | null;
    indexStatus: TronAddressUsdtIndexStatus;
    statusReason: TronAddressUsdtCoverageStatusReason | null;
    lastError: string | null;
  }
): Promise<boolean> {
  const phase = input.indexStatus === "complete" ? "reading_local_index" : "provider_limited";
  const result = await db.query(
    `update forensic_check_jobs
     set progress_json = progress_json
       || jsonb_build_object(
         'jobPhase', $2::text,
         'jobHeartbeatAt', $3::text,
         'strictProvenance', coalesce(progress_json->'strictProvenance', '{}'::jsonb)
           || jsonb_build_object(
             'phase', $2::text,
             'waitingFor', null,
             'lastIndexedAddress', $4::text,
             'lastIndexedTargetTimestamp', $5::text,
             'lastIndexStatus', $6::text,
             'lastIndexStatusReason', $7::text,
             'lastIndexError', $8::text
           )
       ),
       updated_at = now()
     where id = $1
       and status = 'queued'
       and progress_json->>'strictProvenanceBenchmark' = 'true'
       and progress_json->>'jobPhase' = 'waiting_for_targeted_index'`,
    [
      input.id,
      phase,
      new Date().toISOString(),
      input.address,
      input.targetTimestamp?.toISOString() ?? null,
      input.indexStatus,
      input.statusReason,
      input.lastError
    ]
  );
  return (result.rowCount ?? 0) > 0;
}
```

- [ ] **Step 4: Make claim skip waiting strict jobs**

In `claimNextForensicCheckJob`, add this condition to the `where` clause:

```sql
and not (
  job.progress_json->>'strictProvenanceBenchmark' = 'true'
  and job.progress_json->>'jobPhase' = 'waiting_for_targeted_index'
)
```

Keep this inside the existing query so normal queued jobs still claim as before.

- [ ] **Step 5: Run storage tests**

Run:

```bash
npx vitest run tests/storage/forensicCheckJobs.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/repositories.ts tests/storage/forensicCheckJobs.test.ts
git commit -m "feat(storage): support strict provenance waiting jobs"
```

## Task 3: Admin API And Console Launch

**Files:**

- Modify: `src/admin/adminServer.ts`
- Modify: `tests/admin/adminServer.test.ts`
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add failing Admin server tests**

In `tests/admin/adminServer.test.ts`, extend `AdminServerDeps` fixtures with `createStrictProvenanceBenchmarkJob`.

Add:

```ts
it("creates strict provenance benchmark jobs for authorized admins", async () => {
  let receivedInput: unknown = null;
  const created = job({
    id: "strict-job-1",
    kind: "where_is_money_check",
    status: "queued",
    progressJson: { strictProvenanceBenchmark: true }
  });
  const server = await start({
    ...deps(),
    createStrictProvenanceBenchmarkJob: async (input) => {
      receivedInput = input;
      return created;
    }
  });

  const response = await fetch(`${server.url}/admin/api/strict-provenance-benchmark`, {
    method: "POST",
    headers: {
      authorization: "Bearer secret-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      subjectAddress: "TSubject111111111111111111111111111111"
    })
  });

  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toMatchObject({
    job: {
      id: "strict-job-1",
      kind: "where_is_money_check",
      status: "queued",
      subjectAddress: "TSubject111111111111111111111111111111"
    }
  });
  expect(receivedInput).toMatchObject({
    subjectAddress: "TSubject111111111111111111111111111111"
  });
});

it("rejects strict benchmark creation without auth", async () => {
  const server = await start();

  const response = await fetch(`${server.url}/admin/api/strict-provenance-benchmark`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subjectAddress: "TSubject111111111111111111111111111111" })
  });

  expect(response.status).toBe(401);
});

it("rejects invalid strict benchmark addresses", async () => {
  const server = await start({
    ...deps(),
    createStrictProvenanceBenchmarkJob: async () => {
      throw new Error("should not create invalid jobs");
    }
  });

  const response = await fetch(`${server.url}/admin/api/strict-provenance-benchmark`, {
    method: "POST",
    headers: {
      authorization: "Bearer secret-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({ subjectAddress: "bad" })
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    error: "Invalid TRON subject address."
  });
});
```

- [ ] **Step 2: Add failing console test**

In `tests/admin/adminConsole.test.ts`, add:

```ts
it("renders strict provenance benchmark controls", () => {
  const html = adminConsoleHtml();

  expect(html).toContain("Strict benchmark");
  expect(html).toContain("strictBenchmarkAddress");
  expect(html).toContain("/admin/api/strict-provenance-benchmark");
  expect(html).toContain("startStrictBenchmark");
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npx vitest run tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts --configLoader bundle
```

Expected: FAIL because endpoint and UI do not exist.

- [ ] **Step 4: Add Admin server dependency and POST route**

In `src/admin/adminServer.ts`, add to `AdminServerDeps`:

```ts
  createStrictProvenanceBenchmarkJob?(input: {
    subjectAddress: string;
  }): Promise<ForensicCheckJob>;
```

Add helpers:

```ts
const tronAddressPattern = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("JSON body must be an object.");
  return parsed;
}
```

In `handleApiRequest`, before the existing `request.method !== "GET"` guard, add:

```ts
  if (url.pathname === "/admin/api/strict-provenance-benchmark") {
    if (request.method !== "POST") {
      writeJson(response, 405, { error: "Method not allowed." });
      return;
    }
    if (!deps.createStrictProvenanceBenchmarkJob) {
      writeJson(response, 501, { error: "Strict provenance benchmark creation is not configured." });
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      writeJson(response, 400, { error: "Invalid JSON body." });
      return;
    }
    const subjectAddress = stringField(body.subjectAddress);
    if (!subjectAddress || !tronAddressPattern.test(subjectAddress)) {
      writeJson(response, 400, { error: "Invalid TRON subject address." });
      return;
    }
    const job = await deps.createStrictProvenanceBenchmarkJob({ subjectAddress });
    writeJson(response, 201, { job: summarizeForensicJob(job) });
    return;
  }
```

- [ ] **Step 5: Add Admin console control**

In `src/admin/adminConsole.ts`, inside the jobs panel toolbar, add:

```html
<div class="toolbar-row strict-benchmark-row">
  <input id="strictBenchmarkAddress" class="wide" placeholder="TRON wallet for strict benchmark">
  <button id="startStrictBenchmark" type="button">Strict benchmark</button>
</div>
```

In the script, add:

```js
async function startStrictBenchmark() {
  const subjectAddress = el("strictBenchmarkAddress").value.trim();
  if (!subjectAddress) {
    setStatus("Strict benchmark needs a TRON wallet.");
    return;
  }
  try {
    setStatus("Creating strict benchmark...");
    const body = await api("/admin/api/strict-provenance-benchmark", {
      method: "POST",
      body: JSON.stringify({ subjectAddress })
    });
    state.pendingOpenJobId = body.job?.id || null;
    setStatus("Strict benchmark queued.");
    await loadJobs();
  } catch (error) {
    setStatus(error?.message || "Strict benchmark creation failed.");
  }
}
```

Replace the existing one-argument `api` helper with:

```js
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
      Authorization: "Bearer " + state.token
    }
  });
  ...
}
```

Add the event listener near other listeners:

```js
el("startStrictBenchmark").addEventListener("click", startStrictBenchmark);
```

- [ ] **Step 6: Wire Admin runtime in `src/index.ts`**

Where `startAdminServer` deps are created, pass:

```ts
createStrictProvenanceBenchmarkJob: async ({ subjectAddress }) => {
  const now = new Date();
  return createOrReuseForensicCheckJob(db, {
    kind: "where_is_money_check",
    subjectAddress,
    windowStart: new Date(0),
    windowEnd: now,
    priority: 260,
    chatId: null,
    requestedBy: "admin_strict_benchmark",
    progressJson: buildStrictBenchmarkInitialProgress({
      locale: "ru",
      keyCount: tronscanScheduler.diagnostics().apiKeyCount,
      accountGroupCount: tronscanScheduler.diagnostics().apiKeyGroupCount,
      now
    })
  });
}
```

Import `buildStrictBenchmarkInitialProgress`.

- [ ] **Step 7: Run tests**

Run:

```bash
npx vitest run tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/admin/adminServer.ts src/admin/adminConsole.ts src/index.ts tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts
git commit -m "feat(admin): queue strict provenance benchmarks"
```

## Task 4: Non-Blocking Strict Wait In Where Is Money

**Files:**

- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`

- [ ] **Step 1: Add failing non-blocking wait test**

In `tests/forensics/deepForensicJob.test.ts`, add a test that mocks `runWhereIsMoneyCheck` to force a targeted hop fetch.

```ts
it("moves strict benchmark jobs to waiting instead of synchronously ensuring targeted history", async () => {
  vi.resetModules();
  const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
    await deps.fetchEdgesForAddress("THop111111111111111111111111111111111", {
      latestTimestamp: new Date("2026-06-30T11:52:00.000Z")
    });
    throw new Error("strict wait should abort before scoring");
  });
  vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
    runWhereIsMoneyCheck
  }));

  try {
    const { runSingleDeepForensicJobCycle } = await import("../../src/forensics/deepForensicJob");
    const sourceJob = job({
      kind: "where_is_money_check",
      progressJson: {
        strictProvenanceBenchmark: true,
        mode: "wallet_profile",
        strictProvenance: { phase: "selecting_flows", scoreValid: false, waitingFor: null }
      }
    });
    const queueAddressUsdtHistory = vi.fn(async () => ({
      address: "THop111111111111111111111111111111111",
      coverageMode: "targeted",
      status: "queued",
      statusReason: null,
      targetTimestamp: new Date("2026-06-30T11:52:00.000Z")
    } as any));
    const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
    const completeForensicCheckJob = vi.fn(async () => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      releaseForensicCheckJobToWaiting,
      updateForensicCheckJobProgress: vi.fn(async () => true),
      recordRiskEvaluation: vi.fn(async () => undefined),
      queueAddressUsdtHistory,
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    } as any);

    expect(handled).toBe(true);
    expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      address: "THop111111111111111111111111111111111",
      coverageMode: "targeted",
      requestedByJobId: sourceJob.id,
      queuedReason: "where_is_money_hop"
    }));
    expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledWith(expect.objectContaining({
      id: sourceJob.id,
      progressJson: expect.objectContaining({
        jobPhase: "waiting_for_targeted_index",
        strictProvenance: expect.objectContaining({
          phase: "waiting_for_targeted_index",
          scoreValid: false
        })
      })
    }));
    expect(completeForensicCheckJob).not.toHaveBeenCalled();
  } finally {
    vi.doUnmock("../../src/check/whereIsMoneyCheck");
    vi.resetModules();
  }
});
```

- [ ] **Step 2: Add normal mode unchanged test**

Add:

```ts
it("keeps normal where-is-money targeted ensure synchronous", async () => {
  vi.resetModules();
  const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
    await deps.fetchEdgesForAddress("THop111111111111111111111111111111111", {
      latestTimestamp: new Date("2026-06-30T11:52:00.000Z")
    });
    return {
      subjectAddress: subject,
      decision: "ACCEPTABLE",
      riskScore: 20,
      coverage: { partial: false, notes: [] },
      originPaths: [],
      balanceFormingTransfers: []
    };
  });
  vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
    runWhereIsMoneyCheck
  }));

  try {
    const { runSingleDeepForensicJobCycle } = await import("../../src/forensics/deepForensicJob");
    const ensureAddressUsdtHistory = vi.fn(async () => ({
      coverageMode: "targeted",
      status: "complete",
      statusReason: "complete_provider_windowed"
    } as any));
    const completeForensicCheckJob = vi.fn(async () => true);

    await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job({ kind: "where_is_money_check", progressJson: { mode: "wallet_profile" } }),
      completeForensicCheckJob,
      updateForensicCheckJobProgress: vi.fn(async () => true),
      recordRiskEvaluation: vi.fn(async () => undefined),
      ensureAddressUsdtHistory,
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    } as any);

    expect(ensureAddressUsdtHistory).toHaveBeenCalled();
    expect(completeForensicCheckJob).toHaveBeenCalled();
  } finally {
    vi.doUnmock("../../src/check/whereIsMoneyCheck");
    vi.resetModules();
  }
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npx vitest run tests/forensics/deepForensicJob.test.ts --configLoader bundle
```

Expected: FAIL because `releaseForensicCheckJobToWaiting` dep and strict wait behavior do not exist.

- [ ] **Step 4: Add deps and strict wait error**

In `DeepForensicJobRunnerDeps`, add:

```ts
  releaseForensicCheckJobToWaiting?(input: {
    id: string;
    progressJson: Record<string, unknown>;
    lastError?: string | null;
  }): Promise<boolean>;
```

Import:

```ts
import {
  isStrictProvenanceBenchmarkJob,
  strictWaitingProgressPatch
} from "./strictProvenanceBenchmark";
```

Add a local class near `runWhereIsMoneyJob`:

```ts
class StrictProvenanceWaitingForIndex extends Error {
  constructor() {
    super("strict_provenance_waiting_for_targeted_index");
  }
}
```

- [ ] **Step 5: Split strict and normal targeted ensure**

Inside `runWhereIsMoneyJob`, compute:

```ts
  const strictBenchmark = isStrictProvenanceBenchmarkJob(job);
```

In `ensureTargetedHistory`, before synchronous `ensureAddressUsdtHistory`, add strict branch:

```ts
    if (strictBenchmark) {
      const existing = deps.getAddressUsdtIndexState
        ? await deps.getAddressUsdtIndexState({
            address,
            coverageMode: "targeted",
            targetTimestamp: maxTimestamp
          })
        : null;
      if (existing?.status === "complete") return true;
      await deps.queueAddressUsdtHistory?.({
        address,
        coverageMode: "targeted",
        targetTimestamp: maxTimestamp,
        requestedByJobId: job.id,
        queuedReason: "where_is_money_hop"
      });
      const waitPatch = strictWaitingProgressPatch({
        address,
        targetTimestamp: maxTimestamp,
        queuedReason: "where_is_money_hop"
      });
      await persistProgress(waitPatch);
      await deps.releaseForensicCheckJobToWaiting?.({
        id: job.id,
        progressJson: currentProgress,
        lastError: null
      });
      throw new StrictProvenanceWaitingForIndex();
    }
```

Add `getAddressUsdtIndexState` to deps:

```ts
  getAddressUsdtIndexState?(input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
  }): Promise<TronAddressUsdtIndexState | null>;
```

- [ ] **Step 6: Catch strict wait without failure**

Wrap the body of `runWhereIsMoneyJob` or add a `try/catch` around `runWhereIsMoneyCheck`:

```ts
  try {
    const report = await runWhereIsMoneyCheck(...);
    ...
  } catch (error) {
    if (error instanceof StrictProvenanceWaitingForIndex) return true;
    throw error;
  }
```

Do not call `completeForensicCheckJob` in this branch.

- [ ] **Step 7: Run tests**

Run:

```bash
npx vitest run tests/forensics/deepForensicJob.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/forensics/deepForensicJob.ts tests/forensics/deepForensicJob.test.ts
git commit -m "feat(where): wait for strict targeted history"
```

## Task 5: Resume Strict Jobs After Address Index

**Files:**

- Modify: `src/forensics/addressIndexWorker.ts`
- Modify: `tests/forensics/addressIndexWorker.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add failing resume tests**

In `tests/forensics/addressIndexWorker.test.ts`, add:

```ts
import { describe, expect, it, vi } from "vitest";
import { runAddressIndexWorkerOnce } from "../../src/forensics/addressIndexWorker";

describe("runAddressIndexWorkerOnce", () => {
  it("marks requested strict job ready after targeted index completion", async () => {
    const markStrictProvenanceJobReadyAfterIndex = vi.fn(async () => true);
    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [{
        address: "THop111111111111111111111111111111111",
        coverageMode: "targeted",
        targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
        requestedByJobId: "job-1",
        queuedReason: "where_is_money_hop"
      } as any],
      ensureAddressUsdtHistory: async () => ({
        address: "THop111111111111111111111111111111111",
        coverageMode: "targeted",
        targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
        status: "complete",
        statusReason: "complete_provider_windowed",
        lastError: null
      } as any),
      failTronAddressUsdtIndexState: vi.fn(),
      markStrictProvenanceJobReadyAfterIndex
    }, {
      claimLimit: 1,
      lockMs: 60_000,
      workerId: "test-worker"
    });

    expect(markStrictProvenanceJobReadyAfterIndex).toHaveBeenCalledWith(expect.objectContaining({
      id: "job-1",
      address: "THop111111111111111111111111111111111",
      indexStatus: "complete",
      statusReason: "complete_provider_windowed"
    }));
  });

  it("marks requested strict job provider limited after targeted index failure", async () => {
    const markStrictProvenanceJobReadyAfterIndex = vi.fn(async () => true);
    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [{
        address: "THop111111111111111111111111111111111",
        coverageMode: "targeted",
        targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
        requestedByJobId: "job-1",
        queuedReason: "where_is_money_hop"
      } as any],
      ensureAddressUsdtHistory: async () => {
        throw new Error("429 after retries");
      },
      failTronAddressUsdtIndexState: vi.fn(),
      markStrictProvenanceJobReadyAfterIndex
    }, {
      claimLimit: 1,
      lockMs: 60_000,
      workerId: "test-worker"
    });

    expect(markStrictProvenanceJobReadyAfterIndex).toHaveBeenCalledWith(expect.objectContaining({
      id: "job-1",
      indexStatus: "failed_retryable",
      lastError: "429 after retries"
    }));
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run tests/forensics/addressIndexWorker.test.ts --configLoader bundle
```

Expected: FAIL because the new dep is not used.

- [ ] **Step 3: Add worker dep and calls**

In `src/forensics/addressIndexWorker.ts`, add optional dep:

```ts
    markStrictProvenanceJobReadyAfterIndex?(input: {
      id: string;
      address: string;
      targetTimestamp: Date | null;
      indexStatus: TronAddressUsdtIndexStatus;
      statusReason: TronAddressUsdtCoverageStatusReason | null;
      lastError: string | null;
    }): Promise<boolean>;
```

Import missing types from `../types`.

After successful `ensureAddressUsdtHistory`, add:

```ts
      if (state.requestedByJobId && state.coverageMode === "targeted") {
        await deps.markStrictProvenanceJobReadyAfterIndex?.({
          id: state.requestedByJobId,
          address: completed.address,
          targetTimestamp: completed.targetTimestamp,
          indexStatus: completed.status,
          statusReason: completed.statusReason,
          lastError: completed.lastError
        });
      }
```

In the catch branch, after `failTronAddressUsdtIndexState`, add:

```ts
      if (state.requestedByJobId && state.coverageMode === "targeted") {
        await deps.markStrictProvenanceJobReadyAfterIndex?.({
          id: state.requestedByJobId,
          address: state.address,
          targetTimestamp: state.targetTimestamp,
          indexStatus: "failed_retryable",
          statusReason: classifyAddressIndexError(error) === "rate_limited"
            ? "partial_rate_limited"
            : classifyAddressIndexError(error) === "provider_inconsistent"
              ? "partial_provider_inconsistent"
              : "failed_retryable",
          lastError: error instanceof Error ? error.message : String(error)
        });
      }
```

- [ ] **Step 4: Wire runtime**

In `src/index.ts`, pass:

```ts
markStrictProvenanceJobReadyAfterIndex: (input) => markStrictProvenanceJobReadyAfterIndex(db, input)
```

Import `markStrictProvenanceJobReadyAfterIndex`.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run tests/forensics/addressIndexWorker.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/forensics/addressIndexWorker.ts src/index.ts tests/forensics/addressIndexWorker.test.ts
git commit -m "feat(index): resume strict provenance jobs after backfill"
```

## Task 6: Score Validity And Provider-Limited Completion

**Files:**

- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`

- [ ] **Step 1: Add failing score validity tests**

In `tests/forensics/deepForensicJob.test.ts`, add:

```ts
it("stores score_valid true for completed strict benchmark scores", async () => {
  vi.resetModules();
  const whereReport = {
    subjectAddress: subject,
    decision: "ACCEPTABLE",
    riskScore: 20,
    coverage: { partial: false, notes: [] },
    originPaths: [],
    balanceFormingTransfers: []
  };
  vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
    runWhereIsMoneyCheck: vi.fn(async () => whereReport)
  }));

  try {
    const { runSingleDeepForensicJobCycle } = await import("../../src/forensics/deepForensicJob");
    const completeForensicCheckJob = vi.fn(async () => true);
    await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job({
        kind: "where_is_money_check",
        progressJson: {
          strictProvenanceBenchmark: true,
          mode: "wallet_profile",
          strictProvenance: { phase: "reading_local_index", scoreValid: false, waitingFor: null }
        }
      }),
      completeForensicCheckJob,
      updateForensicCheckJobProgress: vi.fn(async () => true),
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    } as any);

    expect(completeForensicCheckJob.mock.calls[0][0]).toMatchObject({
      status: "completed",
      resultJson: {
        score_valid: true,
        score_blocked_reason: null,
        technical_status: "completed"
      }
    });
  } finally {
    vi.doUnmock("../../src/check/whereIsMoneyCheck");
    vi.resetModules();
  }
});

it("stores score_valid false when resumed strict benchmark is provider limited", async () => {
  const completeForensicCheckJob = vi.fn(async () => true);
  const { runSingleDeepForensicJobCycle } = await import("../../src/forensics/deepForensicJob");

  await runSingleDeepForensicJobCycle({
    claimNextForensicCheckJob: async () => job({
      kind: "where_is_money_check",
      progressJson: {
        strictProvenanceBenchmark: true,
        jobPhase: "provider_limited",
        strictProvenance: {
          phase: "provider_limited",
          scoreValid: false,
          scoreBlockedReason: "rate_limited_after_retries",
          waitingFor: null
        }
      }
    }),
    completeForensicCheckJob,
    updateForensicCheckJobProgress: vi.fn(async () => true),
    recordRiskEvaluation: vi.fn(async () => undefined),
    tronClient: { listRelatedTrc20Transfers: async () => [] },
    getLabelsForAddress: async () => [],
    getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
  } as any);

  expect(completeForensicCheckJob.mock.calls[0][0]).toMatchObject({
    status: "failed",
    resultJson: {
      score_valid: false,
      score_blocked_reason: "rate_limited_after_retries",
      technical_status: "provider_limited"
    }
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run tests/forensics/deepForensicJob.test.ts --configLoader bundle
```

Expected: FAIL because result fields are not persisted.

- [ ] **Step 3: Complete provider-limited jobs before trace**

At the start of the `where_is_money_check` branch in `runSingleDeepForensicJobCycle`, before calling `runWhereIsMoneyJob`, add:

```ts
    if (
      isStrictProvenanceBenchmarkJob(job) &&
      job.progressJson.jobPhase === "provider_limited"
    ) {
      const strict = isRecord(job.progressJson.strictProvenance) ? job.progressJson.strictProvenance : {};
      const reason = strict.scoreBlockedReason === "provider_error" ||
        strict.scoreBlockedReason === "rate_limited_after_retries" ||
        strict.scoreBlockedReason === "provider_inconsistent" ||
        strict.scoreBlockedReason === "provider_cap_unresolved" ||
        strict.scoreBlockedReason === "hard_safety_limit_exceeded"
          ? strict.scoreBlockedReason
          : "provider_error";
      await deps.completeForensicCheckJob({
        id: job.id,
        status: "failed",
        progressJson: job.progressJson,
        resultJson: {
          subjectAddress: job.subjectAddress,
          ...strictBlockedResultJson(reason)
        },
        rawEvidenceIds: [],
        observationIds: [],
        lastError: reason
      });
      return true;
    }
```

Import `strictBlockedResultJson`.

- [ ] **Step 4: Add score-valid fields on strict completion**

In `runWhereIsMoneyJob`, when building `resultJson`, spread strict result fields:

```ts
      ...(strictBenchmark ? strictCompletedResultJson() : {}),
```

Also set strict progress:

```ts
      ...(strictBenchmark ? {
        strictProvenance: {
          ...(isRecord(currentProgress.strictProvenance) ? currentProgress.strictProvenance : {}),
          phase: "completed",
          scoreValid: true,
          scoreBlockedReason: null,
          technicalStatus: "completed",
          waitingFor: null
        }
      } : {})
```

Import `strictCompletedResultJson`.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run tests/forensics/deepForensicJob.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/forensics/deepForensicJob.ts tests/forensics/deepForensicJob.test.ts
git commit -m "feat(where): persist strict score validity"
```

## Task 7: Admin Projection And Progress Copy

**Files:**

- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add failing graph projection test**

In `tests/admin/forensicsGraph.test.ts`, add:

```ts
it("projects strict provenance benchmark score validity and metrics", () => {
  const result = projectForensicJobGraph(job({
    kind: "where_is_money_check",
    status: "failed",
    progressJson: {
      strictProvenanceBenchmark: true,
      jobPhase: "provider_limited",
      strictProvenance: {
        phase: "provider_limited",
        scoreValid: false,
        scoreBlockedReason: "provider_cap_unresolved",
        coveredHopCount: 14,
        totalHopCount: 17
      },
      strictBenchmarkMetrics: {
        total: {
          elapsedMs: 220000,
          requestCount: 91,
          rateLimitedCount: 0,
          forbiddenCount: 0,
          serverErrorCount: 1,
          effectiveRps: 7.8,
          keyCount: 4,
          accountGroupCount: 4
        },
        stages: {
          apiMs: 120000,
          dbWriteMs: 20000,
          dbReadMs: 10000,
          traceMs: 60000,
          scoringMs: 0
        }
      }
    },
    resultJson: {
      subjectAddress: "TSubject111111111111111111111111111111",
      score_valid: false,
      score_blocked_reason: "provider_cap_unresolved",
      technical_status: "provider_limited",
      whereIsMoneyReport: {
        subjectAddress: "TSubject111111111111111111111111111111",
        decision: "REVIEW",
        riskScore: 45,
        coverage: { partial: true, notes: [] },
        originPaths: []
      }
    }
  }));

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.graph.summary.layerSummary?.strictProvenance).toMatchObject({
    benchmark: true,
    scoreValid: false,
    scoreBlockedReason: "provider_cap_unresolved",
    phase: "provider_limited",
    coveredHopCount: 14,
    totalHopCount: 17
  });
  expect(result.graph.summary.layerSummary?.strictBenchmarkMetrics).toMatchObject({
    effectiveRps: 7.8,
    requestCount: 91,
    apiMs: 120000,
    traceMs: 60000
  });
});
```

- [ ] **Step 2: Add failing console rendering test**

In `tests/admin/adminConsole.test.ts`, add:

```ts
it("renders strict provenance benchmark status copy", () => {
  const html = adminConsoleHtml();

  expect(html).toContain("Strict provenance");
  expect(html).toContain("Score valid");
  expect(html).toContain("Blocked reason");
  expect(html).toContain("Effective RPS");
  expect(html).toContain("API time");
  expect(html).toContain("DB write time");
  expect(html).toContain("Trace time");
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npx vitest run tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts --configLoader bundle
```

Expected: FAIL because strict projection and copy do not exist.

- [ ] **Step 4: Project strict fields**

In `src/admin/forensicsGraph.ts`, add helper:

```ts
function strictProvenanceSummary(progress: Record<string, unknown>, result: Record<string, unknown>): Record<string, unknown> | null {
  if (progress.strictProvenanceBenchmark !== true) return null;
  const strict = isRecord(progress.strictProvenance) ? progress.strictProvenance : {};
  return {
    benchmark: true,
    phase: stringField(strict, "phase") ?? stringField(progress, "jobPhase"),
    scoreValid: result.score_valid === true || strict.scoreValid === true,
    scoreBlockedReason: stringField(result, "score_blocked_reason") ?? stringField(strict, "scoreBlockedReason"),
    technicalStatus: stringField(result, "technical_status") ?? stringField(strict, "technicalStatus"),
    coveredHopCount: numberField(strict, "coveredHopCount"),
    totalHopCount: numberField(strict, "totalHopCount")
  };
}

function strictBenchmarkMetricsSummary(progress: Record<string, unknown>): Record<string, unknown> | null {
  const metrics = isRecord(progress.strictBenchmarkMetrics) ? progress.strictBenchmarkMetrics : null;
  const total = metrics && isRecord(metrics.total) ? metrics.total : {};
  const stages = metrics && isRecord(metrics.stages) ? metrics.stages : {};
  if (!metrics) return null;
  return {
    elapsedMs: numberField(total, "elapsedMs"),
    requestCount: numberField(total, "requestCount"),
    rateLimitedCount: numberField(total, "rateLimitedCount"),
    forbiddenCount: numberField(total, "forbiddenCount"),
    serverErrorCount: numberField(total, "serverErrorCount"),
    effectiveRps: numberField(total, "effectiveRps"),
    keyCount: numberField(total, "keyCount"),
    accountGroupCount: numberField(total, "accountGroupCount"),
    apiMs: numberField(stages, "apiMs"),
    dbWriteMs: numberField(stages, "dbWriteMs"),
    dbReadMs: numberField(stages, "dbReadMs"),
    traceMs: numberField(stages, "traceMs"),
    scoringMs: numberField(stages, "scoringMs")
  };
}
```

In `projectWhereIsMoneyJob`, include in `layerSummary`:

```ts
strictProvenance: strictProvenanceSummary(progress, result),
strictBenchmarkMetrics: strictBenchmarkMetricsSummary(progress)
```

- [ ] **Step 5: Render strict lines in Admin console**

In `src/admin/adminConsole.ts`, add a function near other summary line builders:

```js
function strictProvenanceLines(summary) {
  const layer = summary?.layerSummary || {};
  const strict = layer.strictProvenance || null;
  const metrics = layer.strictBenchmarkMetrics || null;
  if (!strict && !metrics) return "";
  const lines = [];
  if (strict) {
    lines.push("Strict provenance: " + (strict.phase || "running"));
    lines.push("Score valid: " + (strict.scoreValid === true ? "true" : "false"));
    if (strict.scoreBlockedReason) lines.push("Blocked reason: " + strict.scoreBlockedReason);
    if (strict.coveredHopCount !== null && strict.coveredHopCount !== undefined && strict.totalHopCount !== null && strict.totalHopCount !== undefined) {
      lines.push("Hop coverage: " + strict.coveredHopCount + "/" + strict.totalHopCount);
    }
  }
  if (metrics) {
    if (metrics.effectiveRps !== null && metrics.effectiveRps !== undefined) lines.push("Effective RPS: " + trimNumber(metrics.effectiveRps));
    if (metrics.requestCount !== null && metrics.requestCount !== undefined) lines.push("Requests: " + metrics.requestCount);
    if (metrics.apiMs !== null && metrics.apiMs !== undefined) lines.push("API time: " + trimNumber(metrics.apiMs / 1000) + "s");
    if (metrics.dbWriteMs !== null && metrics.dbWriteMs !== undefined) lines.push("DB write time: " + trimNumber(metrics.dbWriteMs / 1000) + "s");
    if (metrics.dbReadMs !== null && metrics.dbReadMs !== undefined) lines.push("DB read time: " + trimNumber(metrics.dbReadMs / 1000) + "s");
    if (metrics.traceMs !== null && metrics.traceMs !== undefined) lines.push("Trace time: " + trimNumber(metrics.traceMs / 1000) + "s");
    if (metrics.scoringMs !== null && metrics.scoringMs !== undefined) lines.push("Scoring time: " + trimNumber(metrics.scoringMs / 1000) + "s");
  }
  return listMetric("Strict benchmark", lines, "");
}
```

Call it in the case brief / projection metrics block where Where Is Money metrics are listed:

```js
strictProvenanceLines(summary)
```

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "feat(admin): show strict benchmark validity"
```

## Task 8: Benchmark Stage Metrics

**Files:**

- Modify: `src/forensics/strictProvenanceBenchmark.ts`
- Modify: `tests/forensics/strictProvenanceBenchmark.test.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`
- Modify: `src/forensics/tronAddressAllTimeIndex.ts`
- Modify: `tests/forensics/tronAddressAllTimeIndex.test.ts`
- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/forensicCheckJobs.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add failing metric helper test**

In `tests/forensics/strictProvenanceBenchmark.test.ts`, add:

```ts
it("accumulates benchmark stage timings", async () => {
  const progress = buildStrictBenchmarkInitialProgress({
    locale: "ru",
    keyCount: 4,
    accountGroupCount: 4,
    now: new Date("2026-07-02T10:00:00.000Z")
  });

  const measured = await measureStrictBenchmarkStage(progress, "traceMs", async () => "ok", {
    nowMs: (() => {
      const values = [1000, 1250];
      return () => values.shift() ?? 1250;
    })()
  });

  expect(measured.value).toBe("ok");
  expect(measured.progress.strictBenchmarkMetrics.stages.traceMs).toBe(250);
});

it("adds provider request counters without exposing keys", () => {
  const progress = buildStrictBenchmarkInitialProgress({
    locale: "ru",
    keyCount: 4,
    accountGroupCount: 4,
    now: new Date("2026-07-02T10:00:00.000Z")
  });

  const updated = addStrictBenchmarkCounters(progress, {
    requestCount: 3,
    successCount: 2,
    failedCount: 1,
    rateLimitedCount: 1,
    pagesFetched: 2,
    transfersFetched: 100
  });

  expect(updated.strictBenchmarkMetrics.total).toMatchObject({
    keyCount: 4,
    accountGroupCount: 4,
    requestCount: 3,
    successCount: 2,
    failedCount: 1,
    rateLimitedCount: 1,
    pagesFetched: 2,
    transfersFetched: 100
  });
  expect(JSON.stringify(updated)).not.toContain("apiKey");
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run tests/forensics/strictProvenanceBenchmark.test.ts --configLoader bundle
```

Expected: FAIL because `measureStrictBenchmarkStage` and `addStrictBenchmarkCounters` do not exist.

- [ ] **Step 3: Implement metric helper**

In `src/forensics/strictProvenanceBenchmark.ts`, add:

```ts
type StageKey = "apiMs" | "dbWriteMs" | "dbReadMs" | "traceMs" | "scoringMs";
type CounterPatch = Partial<{
  requestCount: number;
  successCount: number;
  failedCount: number;
  retryCount: number;
  rateLimitedCount: number;
  forbiddenCount: number;
  serverErrorCount: number;
  cooldownMs: number;
  pagesFetched: number;
  transfersFetched: number;
}>;

export async function measureStrictBenchmarkStage<T>(
  progressJson: Record<string, unknown>,
  stage: StageKey,
  fn: () => Promise<T>,
  options: { nowMs?: () => number } = {}
): Promise<{ value: T; progress: Record<string, any> }> {
  const nowMs = options.nowMs ?? (() => Date.now());
  const started = nowMs();
  const value = await fn();
  const elapsed = Math.max(0, nowMs() - started);
  const metrics = isRecord(progressJson.strictBenchmarkMetrics) ? progressJson.strictBenchmarkMetrics : {};
  const stages = isRecord(metrics.stages) ? metrics.stages : {};
  const nextStages = {
    ...stages,
    [stage]: Math.max(0, Number(stages[stage] ?? 0)) + elapsed
  };
  return {
    value,
    progress: {
      ...progressJson,
      strictBenchmarkMetrics: {
        ...metrics,
        stages: nextStages
      }
    }
  };
}

export function addStrictBenchmarkCounters(
  progressJson: Record<string, unknown>,
  patch: CounterPatch
): Record<string, any> {
  const metrics = isRecord(progressJson.strictBenchmarkMetrics) ? progressJson.strictBenchmarkMetrics : {};
  const total = isRecord(metrics.total) ? metrics.total : {};
  const nextTotal = { ...total };
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    nextTotal[key] = Math.max(0, Number(nextTotal[key] ?? 0)) + value;
  }
  const startedAt = typeof nextTotal.startedAt === "string" ? Date.parse(nextTotal.startedAt) : NaN;
  const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : Number(nextTotal.elapsedMs ?? 0);
  const requestCount = Number(nextTotal.requestCount ?? 0);
  return {
    ...progressJson,
    strictBenchmarkMetrics: {
      ...metrics,
      total: {
        ...nextTotal,
        elapsedMs,
        effectiveRps: elapsedMs > 0 && requestCount > 0 ? requestCount / (elapsedMs / 1000) : null
      }
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
```

- [ ] **Step 4: Add repository helper test for metric persistence**

In `tests/storage/forensicCheckJobs.test.ts`, add:

```ts
it("patches strict benchmark progress metrics for queued or running jobs", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rowCount: 1, rows: [] };
    }
  };

  const updated = await patchStrictBenchmarkProgress(db, {
    id: "job-1",
    patchJson: {
      strictBenchmarkMetrics: {
        stages: { apiMs: 125 }
      }
    }
  });

  expect(updated).toBe(true);
  expect(queries[0].sql).toContain("progress_json = progress_json || $2::jsonb");
  expect(queries[0].sql).toContain("status in ('queued', 'running')");
});
```

Expected implementation signature:

```ts
export async function patchStrictBenchmarkProgress(
  db: Db,
  input: { id: string; patchJson: Record<string, unknown> }
): Promise<boolean>
```

- [ ] **Step 5: Add indexer timing callback test**

In `tests/forensics/tronAddressAllTimeIndex.test.ts`, add this test inside the existing `describe("tron address all-time indexer", ...)` block:

```ts
it("emits API and DB write timings while indexing", async () => {
  const timings: Array<{ stage: string; elapsedMs: number }> = [];

  await indexTronAddressUsdtHistory({
    address,
    coverageMode: "all_time",
    now: () => new Date(1_790_000_000_000),
    pageLimit: 2,
    pageBatchSize: 1,
    maxPagesPerRun: 4,
    onBenchmarkStageTiming: async (stage, elapsedMs) => {
      timings.push({ stage, elapsedMs });
    },
    listTransferPage: async (_address, options) => ({
      provider: "tronscan" as const,
      total: 1,
      rangeTotal: 1,
      transfers: (options.start ?? 0) === 0
        ? [raw("timing-tx", "TFrom1111111111111111111111111111111", address, "100", 1_780_000_000_000)]
        : []
    }),
    upsertTransfers: async () => undefined,
    upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
    upsertPage: async () => undefined,
    upsertCoverageInterval: async () => undefined
  });

  expect(timings.map((row) => row.stage)).toEqual(expect.arrayContaining([
    "apiMs",
    "dbWriteMs"
  ]));
});
```

- [ ] **Step 6: Run failing metric tests**

Run:

```bash
npx vitest run tests/forensics/strictProvenanceBenchmark.test.ts tests/storage/forensicCheckJobs.test.ts tests/forensics/tronAddressAllTimeIndex.test.ts --configLoader bundle
```

Expected: FAIL because metric persistence and indexer timing callbacks do not exist.

- [ ] **Step 7: Implement metric persistence helper**

In `src/storage/repositories.ts`, add:

```ts
export async function patchStrictBenchmarkProgress(
  db: Db,
  input: { id: string; patchJson: Record<string, unknown> }
): Promise<boolean> {
  const result = await db.query(
    `update forensic_check_jobs
     set progress_json = progress_json || $2::jsonb,
       updated_at = now()
     where id = $1
       and status in ('queued', 'running')
       and progress_json->>'strictProvenanceBenchmark' = 'true'`,
    [input.id, JSON.stringify(input.patchJson)]
  );
  return (result.rowCount ?? 0) > 0;
}
```

- [ ] **Step 8: Add indexer stage timing callback**

In `src/forensics/tronAddressAllTimeIndex.ts`, extend `IndexTronAddressUsdtHistoryDeps`:

```ts
  onBenchmarkStageTiming?(stage: "apiMs" | "dbWriteMs", elapsedMs: number): Promise<void> | void;
```

Add helper:

```ts
async function measureIndexerStage<T>(
  deps: IndexTronAddressUsdtHistoryDeps,
  stage: "apiMs" | "dbWriteMs",
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  const value = await fn();
  await deps.onBenchmarkStageTiming?.(stage, Math.max(0, Date.now() - started));
  return value;
}
```

Wrap provider and write calls:

```ts
const page = await measureIndexerStage(deps, "apiMs", () =>
  deps.listTransferPage(deps.address, options)
);
```

Wrap DB writes in `completeWindow` and page/state writes:

```ts
await measureIndexerStage(deps, "dbWriteMs", () => deps.upsertTransfers(transfers));
await measureIndexerStage(deps, "dbWriteMs", () => deps.upsertCoverageInterval(...));
await measureIndexerStage(deps, "dbWriteMs", () => deps.upsertPage(...));
await measureIndexerStage(deps, "dbWriteMs", () => deps.upsertState(...));
```

Do not include API keys in timing payloads.

- [ ] **Step 9: Wire indexer metrics to waiting job progress**

In `src/index.ts`, inside `ensureAddressUsdtHistory`, add:

```ts
const patchBenchmarkStage = async (stage: "apiMs" | "dbWriteMs", elapsedMs: number) => {
  if (!input.requestedByJobId) return;
  const existingJob = await getForensicCheckJob(db, input.requestedByJobId).catch(() => null);
  if (!existingJob || existingJob.progressJson.strictProvenanceBenchmark !== true) return;
  const measured = addStrictBenchmarkCounters(existingJob.progressJson, {});
  const metrics = measured.strictBenchmarkMetrics ?? {};
  const stages = metrics.stages ?? {};
  await patchStrictBenchmarkProgress(db, {
    id: input.requestedByJobId,
    patchJson: {
      strictBenchmarkMetrics: {
        ...metrics,
        stages: {
          ...stages,
          [stage]: Math.max(0, Number(stages[stage] ?? 0)) + elapsedMs
        }
      }
    }
  });
};
```

Pass into `indexTronAddressUsdtHistory`:

```ts
onBenchmarkStageTiming: patchBenchmarkStage,
```

Import `addStrictBenchmarkCounters`, `getForensicCheckJob`, and `patchStrictBenchmarkProgress`.

- [ ] **Step 10: Add job-level metric test**

In `tests/forensics/deepForensicJob.test.ts`, add a strict completion test assertion:

```ts
expect(completeForensicCheckJob.mock.calls[0][0].progressJson.strictBenchmarkMetrics.stages).toEqual(expect.objectContaining({
  traceMs: expect.any(Number),
  scoringMs: expect.any(Number)
}));
```

- [ ] **Step 11: Record trace/scoring and DB read metrics in `runWhereIsMoneyJob`**

In strict mode, wrap `runWhereIsMoneyCheck`:

```ts
const measuredTrace = strictBenchmark
  ? await measureStrictBenchmarkStage(currentProgress, "traceMs", () => runWhereIsMoneyCheck(...))
  : { value: await runWhereIsMoneyCheck(...), progress: currentProgress };
const report = measuredTrace.value;
currentProgress = measuredTrace.progress;
```

Wrap indexed transfer reads:

```ts
const indexedTransfers = deps.listIndexedUsdtTransfersForAddress
  ? strictBenchmark
    ? (await measureStrictBenchmarkStage(currentProgress, "dbReadMs", () =>
        deps.listIndexedUsdtTransfersForAddress!(address, {
          minTimestamp,
          maxTimestamp,
          limit: edgeFetchLimit,
          orderBy: "newest"
        }).catch(() => {
          indexedFetchFailed = true;
          return [];
        })
      )).value
    : await deps.listIndexedUsdtTransfersForAddress(address, {
        minTimestamp,
        maxTimestamp,
        limit: edgeFetchLimit,
        orderBy: "newest"
      }).catch(() => {
        indexedFetchFailed = true;
        return [];
      })
  : [];
```

Before completion, add a small scoring stage measurement around final result assembly:

```ts
if (strictBenchmark) {
  const measuredScoring = await measureStrictBenchmarkStage(currentProgress, "scoringMs", async () => null);
  currentProgress = measuredScoring.progress;
}
```

After this task, strict benchmark metrics must include real `apiMs`, `dbWriteMs`, `dbReadMs`, `traceMs`, and `scoringMs`. API and DB write timings come from the address indexer. DB read and trace/scoring timings come from `runWhereIsMoneyJob`.

- [ ] **Step 12: Add scheduler diagnostics into created Admin job**

In `src/index.ts`, keep using:

```ts
tronscanScheduler.diagnostics().apiKeyCount
tronscanScheduler.diagnostics().apiKeyGroupCount
```

Do not expose key values.

- [ ] **Step 13: Run focused tests**

Run:

```bash
npx vitest run tests/forensics/strictProvenanceBenchmark.test.ts tests/forensics/tronAddressAllTimeIndex.test.ts tests/storage/forensicCheckJobs.test.ts tests/forensics/deepForensicJob.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add src/forensics/strictProvenanceBenchmark.ts src/forensics/tronAddressAllTimeIndex.ts src/forensics/deepForensicJob.ts src/storage/repositories.ts src/index.ts tests/forensics/strictProvenanceBenchmark.test.ts tests/forensics/tronAddressAllTimeIndex.test.ts tests/storage/forensicCheckJobs.test.ts tests/forensics/deepForensicJob.test.ts
git commit -m "feat(where): record strict benchmark timings"
```

## Task 9: Runtime Wiring And Verification

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/admin/adminServer.test.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`
- Modify: `docs/superpowers/specs/2026-07-02-admin-strict-provenance-benchmark-design.md`

- [ ] **Step 1: Verify runtime deps are wired**

In `src/index.ts`, ensure `runSingleDeepForensicJobCycle` deps include:

```ts
getAddressUsdtIndexState: (input) => getTronAddressUsdtIndexState(db, input),
releaseForensicCheckJobToWaiting: (input) => releaseForensicCheckJobToWaiting(db, input),
queueAddressUsdtHistory: (input) => queueTronAddressUsdtIndexState(db, {
  address: input.address,
  coverageMode: input.coverageMode,
  targetTimestamp: input.targetTimestamp ?? null,
  queuedReason: input.queuedReason,
  requestedByJobId: input.requestedByJobId ?? null,
  priority: input.queuedReason === "where_is_money_hop" ? 250 : 10,
  nextRunAt: new Date()
})
```

Ensure `runAddressIndexWorkerOnce` deps include:

```ts
markStrictProvenanceJobReadyAfterIndex: (input) => markStrictProvenanceJobReadyAfterIndex(db, input)
```

- [ ] **Step 2: Update spec status**

In `docs/superpowers/specs/2026-07-02-admin-strict-provenance-benchmark-design.md`, change:

```text
Status: Draft for user review
```

to:

```text
Status: Implementation planned
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npx vitest run tests/forensics/strictProvenanceBenchmark.test.ts tests/forensics/forensicJobProgress.test.ts tests/storage/forensicCheckJobs.test.ts tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts tests/forensics/addressIndexWorker.test.ts tests/forensics/deepForensicJob.test.ts tests/admin/forensicsGraph.test.ts --configLoader bundle
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Manual Admin benchmark smoke test**

Start the app:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:8787/admin/forensics
```

Create a strict benchmark for:

```text
THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7
```

Expected:

- job appears as `where_is_money_check`;
- `progress_json.strictProvenanceBenchmark=true`;
- while missing hop history exists, job phase becomes `waiting_for_targeted_index`;
- no `result_json.score_valid=true` appears while waiting;
- after targeted index finishes, same logical job resumes;
- final completed result has `score_valid=true`, or provider-limited result has `score_valid=false` and `score_blocked_reason`;
- Admin shows effective RPS, request count, and stage timings.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts docs/superpowers/specs/2026-07-02-admin-strict-provenance-benchmark-design.md tests/admin/adminServer.test.ts tests/forensics/deepForensicJob.test.ts
git commit -m "test: verify strict provenance benchmark runtime"
```

## Final Verification Checklist

- [ ] `git status --short` shows only intentional files.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm test` passes.
- [ ] Admin can create a strict benchmark job.
- [ ] Strict benchmark job can enter `waiting_for_targeted_index` without keeping a worker occupied.
- [ ] Address index worker can resume the waiting job.
- [ ] Strict benchmark completion writes `score_valid=true`.
- [ ] Provider-limited strict result writes `score_valid=false`.
- [ ] Normal Telegram `/check` is unchanged.
