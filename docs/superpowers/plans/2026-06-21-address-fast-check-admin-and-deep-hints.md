# Address Fast Check Admin and Deep Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store address fast check as an admin-visible forensic record, show its full fast-check data and graph, and pass fast top counterparties to deep check as priority hints only.

**Architecture:** Reuse the existing `forensic_check_jobs` table by adding a new `address_fast_check` kind. Reuse the existing `OperationalFlowProfile` for fast-check top incoming, top outgoing, and service/category breakdown instead of creating a parallel top-profile model. Deep check receives compact hint addresses in `progress_json`, but it still re-fetches and re-evaluates hinted counterparties before evidence or scoring.

**Tech Stack:** TypeScript, Node.js, PostgreSQL migrations, grammy bot, Vitest, existing admin HTML/JS console.

---

## File Map

- Create `migrations/025_address_fast_check_jobs.sql`: allow `address_fast_check` in the `forensic_check_jobs.kind` check constraint.
- Modify `src/storage/repositories.ts`: add `address_fast_check` to `ForensicCheckJobKind` parsing and repository typing.
- Modify `src/admin/adminServer.ts`: allow filtering `address_fast_check`.
- Modify `src/admin/adminConsole.ts`: add `address fast` to the kind filter and show fast-check top lists in admin graph details.
- Modify `src/types.ts`: add `FastCheckHints` types. Reuse the existing `OperationalFlowProfile` shape for fast-check top data instead of adding a duplicate model.
- Modify `src/forensics/routeSearch.ts`: build `OperationalFlowProfile` during address fast exposure search.
- Modify `src/check/manualCheck.ts`: include `operationalFlowProfiles` in `ManualRiskSignals` and `ManualCheckResult`.
- Modify `src/check/addressExposureSignals.ts`: return and merge `operationalFlowProfiles` from fast address exposure.
- Modify `src/forensics/counterpartyInteraction.ts`: let deep snapshot candidate selection accept priority addresses.
- Modify `src/check/deepForensicCheck.ts`: parse `FastCheckHints` and use hinted direct counterparties for snapshot priority only.
- Modify `src/forensics/deepForensicJob.ts`: pass job `fastCheckHints` into `runDeepAddressForensicCheck`.
- Modify `src/bot/createBot.ts`: create and complete an `address_fast_check` job for wallet checks, build hints, and attach hints to deep jobs.
- Modify `src/admin/forensicsGraph.ts`: add `address_fast_check` graph projection.
- Modify tests under `tests/storage`, `tests/check`, `tests/forensics`, `tests/bot`, and `tests/admin`.

## Implementation Notes

- Fast-check admin persistence must not block the Telegram user response. If creating or completing the fast-check job fails, log the error and continue queuing follow-up jobs.
- `address_fast_check` jobs are completed synchronously. Workers must not claim them; current worker polling passes explicit job kinds, so adding the kind to storage is safe.
- Hints are not proof. Deep check can use hints only to order direct counterparty snapshot work.
- Where-is-money keeps receiving only the compact fast risk snapshot. Do not add top-list dependency there.

### Task 1: Storage and Admin Kind Support

**Files:**
- Create: `migrations/025_address_fast_check_jobs.sql`
- Modify: `src/storage/repositories.ts`
- Modify: `src/admin/adminServer.ts`
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/storage/forensicCheckJobs.test.ts`
- Test: `tests/admin/adminServer.test.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write the storage failing test**

Add this test near the existing forensic job creation tests in `tests/storage/forensicCheckJobs.test.ts`:

```typescript
  it("creates address fast check forensic jobs", async () => {
    const { db, queries } = createMockDb();
    const job = await createOrReuseForensicCheckJob(db, {
      kind: "address_fast_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      windowStart: new Date("2026-06-21T00:00:00.000Z"),
      windowEnd: new Date("2026-06-21T00:01:00.000Z"),
      priority: 130,
      progressJson: {
        locale: "ru",
        fastRiskSnapshot: {
          score: 12,
          level: "LOW"
        }
      }
    });

    expect(job.kind).toBe("address_fast_check");
    expect(queries[0].params[1]).toBe("address_fast_check");
    expect(queries[0].params[5]).toBe(130);
  });
```

- [ ] **Step 2: Run the storage test and verify it fails**

Run:

```bash
npm test -- tests/storage/forensicCheckJobs.test.ts
```

Expected: fail at TypeScript compile or runtime parsing because `address_fast_check` is not an allowed kind yet.

- [ ] **Step 3: Add the migration**

Create `migrations/025_address_fast_check_jobs.sql` with exactly:

```sql
alter table forensic_check_jobs drop constraint if exists forensic_check_jobs_kind_check;

alter table forensic_check_jobs
  add constraint forensic_check_jobs_kind_check
  check (kind in ('address_fast_check', 'address_deep_check', 'where_is_money_check', 'incoming_deposit_check'));
```

- [ ] **Step 4: Update repository kind typing**

In `src/storage/repositories.ts`, replace the `ForensicCheckJobKind` type with:

```typescript
export type ForensicCheckJobKind = "address_fast_check" | "address_deep_check" | "where_is_money_check" | "incoming_deposit_check";
```

In the same file, replace the `forensicCheckJobKinds` set with:

```typescript
const forensicCheckJobKinds = new Set<ForensicCheckJobKind>([
  "address_fast_check",
  "address_deep_check",
  "where_is_money_check",
  "incoming_deposit_check"
]);
```

- [ ] **Step 5: Update admin server kind parsing**

In `src/admin/adminServer.ts`, replace the `forensicCheckJobKinds` set with:

```typescript
const forensicCheckJobKinds = new Set<ForensicCheckJobKind>([
  "address_fast_check",
  "address_deep_check",
  "where_is_money_check",
  "incoming_deposit_check"
]);
```

- [ ] **Step 6: Write the admin console failing test**

Create `tests/admin/adminConsole.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { adminConsoleHtml } from "../../src/admin/adminConsole";

describe("adminConsoleHtml", () => {
  it("includes address fast check in the forensic job kind filter", () => {
    const html = adminConsoleHtml();

    expect(html).toContain('<option value="address_fast_check">address fast</option>');
  });
});
```

- [ ] **Step 7: Run the admin console test and verify it fails**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts
```

Expected: fail because the kind filter does not include `address_fast_check`.

- [ ] **Step 8: Add address fast to the admin console filter**

In `src/admin/adminConsole.ts`, add this option before `where-is-money`:

```html
              <option value="address_fast_check">address fast</option>
```

- [ ] **Step 9: Add admin server parse coverage**

In `tests/admin/adminServer.test.ts`, add a test next to existing job-list filter tests:

```typescript
  it("accepts address_fast_check as an admin job kind filter", async () => {
    const calls: unknown[] = [];
    const server = await start({
      ...deps(),
      listJobs: async (input) => {
        calls.push(input);
        return [];
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?kind=address_fast_check`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    expect(calls[0]).toMatchObject({ kind: "address_fast_check" });
  });
```

- [ ] **Step 10: Run focused tests**

Run:

```bash
npm test -- tests/storage/forensicCheckJobs.test.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1**

```bash
git add migrations/025_address_fast_check_jobs.sql src/storage/repositories.ts src/admin/adminServer.ts src/admin/adminConsole.ts tests/storage/forensicCheckJobs.test.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
git commit -m "feat: add address fast check job kind"
```

### Task 2: Surface Fast Top Incoming, Outgoing, and Service Data

**Files:**
- Modify: `src/forensics/routeSearch.ts`
- Modify: `src/check/manualCheck.ts`
- Modify: `src/check/addressExposureSignals.ts`
- Test: `tests/check/addressExposureSignals.test.ts`

- [ ] **Step 1: Write the failing fast tops test**

In `tests/check/addressExposureSignals.test.ts`, add this test after the existing service exposure test:

```typescript
  it("returns operational flow tops for fast address checks", async () => {
    const incomingAddress = "TIncoming111111111111111111111111111";
    const outgoingAddress = "TOutgoing111111111111111111111111111";
    const bridgeAddress = "TBridge11111111111111111111111111111";
    const transfers: RawTronscanTrc20Transfer[] = [
      {
        ...transfer("tx-incoming"),
        from_address: incomingAddress,
        to_address: sourceAddress,
        quant: "300000000"
      },
      {
        ...transfer("tx-outgoing"),
        from_address: sourceAddress,
        to_address: outgoingAddress,
        quant: "200000000"
      },
      {
        ...transfer("tx-bridge"),
        from_address: sourceAddress,
        to_address: bridgeAddress,
        quant: "100000000"
      }
    ];
    const provider = createAddressExposureRiskSignalProvider({
      tronClient: {
        listRelatedTrc20Transfers: async () => transfers
      },
      getAddressMetadata: async (address) =>
        address === bridgeAddress
          ? {
              address,
              source: "tronscan",
              name: "Bridge Router",
              tag: "Bridge",
              isContract: true,
              verified: true,
              accountType: 2,
              rawJson: {},
              fetchedAt: new Date("2026-06-21T00:00:00.000Z"),
              expiresAt: new Date("2026-06-22T00:00:00.000Z")
            }
          : null,
      now: () => new Date("2026-06-21T00:00:00.000Z")
    }, {
      maxDepth: 1,
      maxPagesPerAddress: 1,
      pageLimit: 10,
      timeoutMs: 10_000
    });

    const signals = await provider(sourceAddress);
    const flow = signals.operationalFlowProfiles?.[0];

    expect(flow).toMatchObject({
      subjectAddress: sourceAddress,
      incomingVolumeRaw: "300000000",
      outgoingVolumeRaw: "300000000",
      incomingTxCount: 1,
      outgoingTxCount: 2
    });
    expect(flow?.topIncomingCounterparties[0]).toMatchObject({
      address: incomingAddress,
      direction: "incoming",
      volumeRaw: "300000000",
      txCount: 1,
      volumeRatio: 1
    });
    expect(flow?.topOutgoingCounterparties.map((item) => item.address)).toEqual([
      outgoingAddress,
      bridgeAddress
    ]);
    expect(flow?.categoryBreakdown.some((item) => item.category === "bridge")).toBe(true);
  });
```

- [ ] **Step 2: Run the fast tops test and verify it fails**

Run:

```bash
npm test -- tests/check/addressExposureSignals.test.ts
```

Expected: fail because `operationalFlowProfiles` is not exposed from `ManualRiskSignals`.

- [ ] **Step 3: Add operational profiles to manual check result types**

In `src/check/manualCheck.ts`, add `OperationalFlowProfile` to the type import list:

```typescript
  OperationalFlowProfile,
```

Add this property to `ManualRiskSignals`:

```typescript
  operationalFlowProfiles?: OperationalFlowProfile[];
```

Add this property to `ManualCheckResult`:

```typescript
  operationalFlowProfiles: OperationalFlowProfile[];
```

In `checkAddressWithContext`, add this return field after `boundaryExposureProfiles`:

```typescript
    operationalFlowProfiles: signals.operationalFlowProfiles ?? [],
```

- [ ] **Step 4: Build operational flow in fast route search**

In `src/forensics/routeSearch.ts`, add this import:

```typescript
import { buildOperationalFlowProfile } from "./flowCounterpartyProfile";
```

Inside `runForensicAddressExposureSearch`, after `boundaryExposureProfiles` is created, add:

```typescript
  const operationalFlowProfiles = [
    buildOperationalFlowProfile({
      subjectAddress: input.sourceAddress,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      edges: graphEdges,
      classifications: classificationResult.classifications
    })
  ];
```

In the returned object from `runForensicAddressExposureSearch`, add:

```typescript
    operationalFlowProfiles,
```

- [ ] **Step 5: Return and merge operational flow signals**

In `src/check/addressExposureSignals.ts`, add `operationalFlowProfiles` to both `emptySignals()` and `partialSignals()`:

```typescript
    operationalFlowProfiles: [],
```

In `signalsFromReport`, add this field to the returned object:

```typescript
    operationalFlowProfiles: report.operationalFlowProfiles ?? [],
```

In `mergeSignals`, add this field:

```typescript
    operationalFlowProfiles: [...(primary.operationalFlowProfiles ?? []), ...(secondary.operationalFlowProfiles ?? [])],
```

- [ ] **Step 6: Run the fast tops test**

Run:

```bash
npm test -- tests/check/addressExposureSignals.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/forensics/routeSearch.ts src/check/manualCheck.ts src/check/addressExposureSignals.ts tests/check/addressExposureSignals.test.ts
git commit -m "feat: expose fast check flow tops"
```

### Task 3: Persist Fast Check Jobs and Build Deep Hints

**Files:**
- Modify: `src/types.ts`
- Modify: `src/bot/createBot.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add shared fast hint types**

In `src/types.ts`, add these exported types near the operational flow types:

```typescript
export type FastCheckHintDirection = "incoming" | "outgoing" | "service";

export type FastCheckHintAddress = {
  address: string;
  direction: FastCheckHintDirection;
  volumeRaw: string;
  txCount: number;
  volumeRatio: number;
  category: ServiceCategory | null;
  identity: string | null;
  reason: string;
};

export type FastCheckHints = {
  fastCheckJobId: string;
  generatedAt: string;
  subjectAddress: string;
  incoming: FastCheckHintAddress[];
  outgoing: FastCheckHintAddress[];
  services: FastCheckHintAddress[];
};
```

- [ ] **Step 2: Write the bot failing test for hidden Telegram output and deep hints**

In `tests/bot/createBot.test.ts`, add this test near the existing `/check` queue tests:

```typescript
  it("stores fast check details for admin and passes compact hints to deep without showing fast tables in Telegram", async () => {
    const subject = "TSubject111111111111111111111111111111";
    const incoming = "TIncoming111111111111111111111111111";
    const outgoing = "TOutgoing111111111111111111111111111";
    let createdFastJobInput: unknown = null;
    let completedFastJobInput: unknown = null;
    let queuedDeepHints: unknown = null;
    const { bot, calls } = await createSmokeBot({
      addressRiskSignals: async () => ({
        graphSignals: [],
        behaviorSignals: [],
        amlSignals: [],
        rawEvidence: [],
        observations: [],
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        boundaryExposureProfiles: [],
        walletRoleProfiles: [],
        extendedProvenanceProfiles: [],
        operationalFlowProfiles: [{
          subjectAddress: subject,
          windowStart: "2026-06-21T00:00:00.000Z",
          windowEnd: "2026-06-21T00:01:00.000Z",
          incomingVolumeRaw: "500000000",
          outgoingVolumeRaw: "400000000",
          incomingTxCount: 1,
          outgoingTxCount: 1,
          inflowToOutflowRatio: 0.8,
          topIncomingCounterparties: [{
            address: incoming,
            direction: "incoming",
            volumeRaw: "500000000",
            txCount: 1,
            volumeRatio: 1,
            category: null,
            identity: null,
            isTerminalLiquidity: false,
            isHtxHuobi: false
          }],
          topOutgoingCounterparties: [{
            address: outgoing,
            direction: "outgoing",
            volumeRaw: "400000000",
            txCount: 1,
            volumeRatio: 1,
            category: null,
            identity: null,
            isTerminalLiquidity: false,
            isHtxHuobi: false
          }],
          categoryBreakdown: [],
          terminalLiquidityIncomingRatio: 0,
          terminalLiquidityOutgoingRatio: 0,
          htxHuobiIncomingRatio: 0,
          htxHuobiOutgoingRatio: 0,
          bridgeDexRouterOutgoingRatio: 0,
          unknownContractOutgoingRatio: 0,
          historicalTransitScore: 0,
          historicalTransitBreakdown: {
            eligible: false,
            flowUsdt: 0,
            volumeScore: 0,
            passThrough: 0,
            passThroughScore: 0,
            serviceShare: 0,
            serviceShareScore: 0,
            score: 0
          },
          operationalScore: 0,
          features: []
        }],
        stablecoinRestrictionProfiles: [],
        missingChecks: []
      }),
      createAddressFastCheckJob: async (input) => {
        createdFastJobInput = input;
        return {
          id: "fast-job-1",
          kind: "address_fast_check",
          subjectAddress: input.subjectAddress,
          status: "queued",
          windowStart: input.windowStart ?? new Date("2026-06-21T00:00:00.000Z"),
          windowEnd: input.windowEnd ?? new Date("2026-06-21T00:01:00.000Z"),
          priority: 130,
          chatId: input.chatId,
          messageId: null,
          requestedBy: input.requestedBy,
          progressJson: {},
          resultJson: {},
          rawEvidenceIds: [],
          observationIds: [],
          lastError: null,
          createdAt: new Date("2026-06-21T00:00:00.000Z"),
          updatedAt: new Date("2026-06-21T00:00:00.000Z"),
          startedAt: null,
          completedAt: null
        };
      },
      completeAddressFastCheckJob: async (input) => {
        completedFastJobInput = input;
        return true;
      },
      queueDeepForensicJob: async (input) => {
        queuedDeepHints = input.fastCheckHints;
        return {
          id: "deep-job-1",
          kind: "address_deep_check",
          subjectAddress: input.subjectAddress,
          status: "queued",
          windowStart: input.windowStart ?? new Date("2026-06-21T00:00:00.000Z"),
          windowEnd: input.windowEnd ?? new Date("2026-06-21T00:01:00.000Z"),
          priority: 100,
          chatId: input.chatId,
          messageId: null,
          requestedBy: input.requestedBy,
          progressJson: {},
          resultJson: {},
          rawEvidenceIds: [],
          observationIds: [],
          lastError: null,
          createdAt: new Date("2026-06-21T00:00:00.000Z"),
          updatedAt: new Date("2026-06-21T00:00:00.000Z"),
          startedAt: null,
          completedAt: null
        };
      }
    });

    await bot.handleUpdate(messageUpdate("/check " + subject));

    expect(createdFastJobInput).toMatchObject({
      subjectAddress: subject,
      priority: 130
    });
    expect(queuedDeepHints).toMatchObject({
      fastCheckJobId: "fast-job-1",
      subjectAddress: subject,
      incoming: [expect.objectContaining({ address: incoming, direction: "incoming" })],
      outgoing: [expect.objectContaining({ address: outgoing, direction: "outgoing" })]
    });
    expect(completedFastJobInput).toMatchObject({
      id: "fast-job-1",
      status: "completed",
      resultJson: expect.objectContaining({
        subjectAddress: subject,
        followUpJobs: expect.objectContaining({
          deepJobId: "deep-job-1"
        }),
        operationalFlowProfiles: expect.any(Array)
      })
    });
    expect(lastPlainText(calls)).not.toContain("Top incoming");
    expect(lastPlainText(calls)).not.toContain("Top outgoing");
  });
```

- [ ] **Step 3: Run the bot test and verify it fails**

Run:

```bash
npm test -- tests/bot/createBot.test.ts
```

Expected: fail because `CreateBotOptions` does not expose fast-check job hooks and queue input does not carry `fastCheckHints`.

- [ ] **Step 4: Extend the bot test helper option plumbing**

In `tests/bot/createBot.test.ts`, add these fields to the `createSmokeBot` `options` type:

```typescript
  createAddressFastCheckJob?: BotOptions["createAddressFastCheckJob"];
  completeAddressFastCheckJob?: BotOptions["completeAddressFastCheckJob"];
```

In the `createBot(..., { ... })` call inside `createSmokeBot`, pass the hooks through:

```typescript
    createAddressFastCheckJob: options.createAddressFastCheckJob,
    completeAddressFastCheckJob: options.completeAddressFastCheckJob,
```

- [ ] **Step 5: Import fast hint types and repository completion**

In `src/bot/createBot.ts`, add `completeForensicCheckJob` to the repository import list:

```typescript
  completeForensicCheckJob,
```

Add `FastCheckHints` to the type import list from `../types`:

```typescript
  FastCheckHints,
```

- [ ] **Step 6: Extend queue and bot option types**

In `src/bot/createBot.ts`, add this field to `QueueAddressForensicJobInput`:

```typescript
  fastCheckHints?: FastCheckHints;
```

Add these two fields to `CreateBotOptions`:

```typescript
  createAddressFastCheckJob?: (input: QueueAddressForensicJobInput & { priority: number }) => Promise<ForensicCheckJob | null>;
  completeAddressFastCheckJob?: (input: {
    id: string;
    status: "completed" | "partial";
    progressJson: Record<string, unknown>;
    resultJson: Record<string, unknown>;
    rawEvidenceIds: string[];
    observationIds: string[];
    lastError: string | null;
  }) => Promise<boolean | void>;
```

- [ ] **Step 7: Add fast hint builders**

In `src/bot/createBot.ts`, add these helpers after `type FastRiskSnapshot`:

```typescript
function fastHintReason(direction: FastCheckHintDirection, category: string | null): string {
  if (direction === "service") return category ? `top ${category} service exposure` : "top service exposure";
  return direction === "incoming" ? "top incoming counterparty" : "top outgoing counterparty";
}

function fastHintFromCounterparty(input: {
  address: string;
  direction: "incoming" | "outgoing";
  volumeRaw: string;
  txCount: number;
  volumeRatio: number;
  category: FastCheckHints["incoming"][number]["category"];
  identity: string | null;
}): FastCheckHints["incoming"][number] {
  return {
    address: input.address,
    direction: input.direction,
    volumeRaw: input.volumeRaw,
    txCount: input.txCount,
    volumeRatio: input.volumeRatio,
    category: input.category,
    identity: input.identity,
    reason: fastHintReason(input.direction, input.category)
  };
}

function fastVolumeRatio(volumeRaw: string, totalRaw: string): number {
  const volume = Number(volumeRaw);
  const total = Number(totalRaw);
  return Number.isFinite(volume) && Number.isFinite(total) && total > 0 ? volume / total : 0;
}

function buildFastCheckHints(result: ManualCheckResult, fastCheckJobId: string, generatedAt: Date): FastCheckHints {
  const flow = result.operationalFlowProfiles[0] ?? null;
  const serviceProfile = result.serviceExposureProfiles[0] ?? null;
  const incoming = (flow?.topIncomingCounterparties ?? []).slice(0, 10).map((item) => fastHintFromCounterparty({
    address: item.address,
    direction: "incoming",
    volumeRaw: item.volumeRaw,
    txCount: item.txCount,
    volumeRatio: item.volumeRatio,
    category: item.category,
    identity: item.identity
  }));
  const outgoing = (flow?.topOutgoingCounterparties ?? []).slice(0, 10).map((item) => fastHintFromCounterparty({
    address: item.address,
    direction: "outgoing",
    volumeRaw: item.volumeRaw,
    txCount: item.txCount,
    volumeRatio: item.volumeRatio,
    category: item.category,
    identity: item.identity
  }));
  const services = (serviceProfile?.topServiceCounterparties ?? []).slice(0, 10).map((item) => ({
    address: item.address,
    direction: "service" as const,
    volumeRaw: item.volumeRaw,
    txCount: item.txCount,
    volumeRatio: serviceProfile ? fastVolumeRatio(item.volumeRaw, serviceProfile.totalOutgoingRaw) : 0,
    category: item.category,
    identity: item.identity,
    reason: fastHintReason("service", item.category)
  }));
  return {
    fastCheckJobId,
    generatedAt: generatedAt.toISOString(),
    subjectAddress: result.subjectAddress,
    incoming,
    outgoing,
    services
  };
}
```

Add `FastCheckHintDirection` to the type import list from `../types`:

```typescript
  FastCheckHintDirection,
```

- [ ] **Step 8: Add fast result builder**

In `src/bot/createBot.ts`, add this helper after `buildFastCheckHints`:

```typescript
function fastCheckResultJson(input: {
  result: ManualCheckResult;
  whereIsMoneyJob: ForensicCheckJob | null;
  deepJob: ForensicCheckJob | null;
  hints: FastCheckHints | null;
}): Record<string, unknown> {
  return {
    subjectAddress: input.result.subjectAddress,
    report: input.result.report,
    serviceExposureProfiles: input.result.serviceExposureProfiles,
    addressBehaviorProfiles: input.result.addressBehaviorProfiles,
    boundaryExposureProfiles: input.result.boundaryExposureProfiles,
    operationalFlowProfiles: input.result.operationalFlowProfiles,
    walletRoleProfiles: input.result.walletRoleProfiles,
    stablecoinRestrictionProfiles: input.result.stablecoinRestrictionProfiles,
    missingChecks: input.result.missingChecks,
    fastCheckHints: input.hints,
    followUpJobs: {
      whereIsMoneyJobId: input.whereIsMoneyJob?.id ?? null,
      deepJobId: input.deepJob?.id ?? null
    }
  };
}

function fastCheckStatus(result: ManualCheckResult): "completed" | "partial" {
  return result.missingChecks.length > 0 ? "partial" : "completed";
}
```

- [ ] **Step 9: Default fast job hooks**

In `createBot`, after `createQueuedAddressJob`, add:

```typescript
  const createAddressFastCheckJob = options.createAddressFastCheckJob ?? ((input: QueueAddressForensicJobInput & { priority: number }) =>
    createOrReuseForensicCheckJob(db, {
      kind: "address_fast_check",
      subjectAddress: input.subjectAddress,
      windowStart: input.windowStart ?? new Date(),
      windowEnd: input.windowEnd ?? new Date(),
      chatId: input.chatId,
      requestedBy: input.requestedBy,
      priority: input.priority,
      progressJson: {
        ...(input.fastRiskSnapshot ? { fastRiskSnapshot: input.fastRiskSnapshot } : {}),
        locale: input.locale ?? DEFAULT_BOT_LOCALE
      }
    }).catch((error) => {
      console.warn("address_fast_check_create_failed", error);
      return null;
    })
  );
  const completeAddressFastCheckJob = options.completeAddressFastCheckJob ?? ((input: Parameters<NonNullable<CreateBotOptions["completeAddressFastCheckJob"]>>[0]) =>
    completeForensicCheckJob(db, input).catch((error) => {
      console.warn("address_fast_check_complete_failed", error);
      return false;
    })
  );
```

- [ ] **Step 10: Store fastCheckHints in queued job progress JSON**

In `createQueuedAddressJob`, add this line to `progressJson`:

```typescript
        ...(input.fastCheckHints ? { fastCheckHints: input.fastCheckHints } : {}),
```

- [ ] **Step 11: Wire fast job creation into wallet address checks**

In `replyWithCheck`, after `queueInput` is built and before `Promise.allSettled`, add:

```typescript
    let fastJob: ForensicCheckJob | null = null;
    try {
      fastJob = await options.createAddressFastCheckJob?.({ ...queueInput, priority: 130 }) ?? null;
    } catch (error) {
      console.warn("address_fast_check_create_failed", error);
    }
    const fastCheckHints = fastJob
      ? buildFastCheckHints(result, fastJob.id, forensicWindowEnd)
      : null;
```

Replace the deep queue call in `Promise.allSettled` with:

```typescript
      options.queueDeepForensicJob?.({
        ...queueInput,
        ...(fastCheckHints ? { fastCheckHints } : {})
      }) ?? Promise.resolve(null)
```

After `deepJob` is assigned and before `sendMessage`, add:

```typescript
    if (fastJob) {
      try {
        await options.completeAddressFastCheckJob?.({
          id: fastJob.id,
          status: fastCheckStatus(result),
          progressJson: {
            ...(fastJob.progressJson ?? {}),
            ...(fastCheckHints ? { fastCheckHints } : {}),
            followUpJobs: {
              whereIsMoneyJobId: whereIsMoneyJob?.id ?? null,
              deepJobId: deepJob?.id ?? null
            },
            locale
          },
          resultJson: fastCheckResultJson({ result, whereIsMoneyJob, deepJob, hints: fastCheckHints }),
          rawEvidenceIds: result.rawEvidence.map((evidence) => evidence.id),
          observationIds: result.observations.map((observation) => observation.id),
          lastError: null
        });
      } catch (error) {
        console.warn("address_fast_check_complete_failed", error);
      }
    }
```

- [ ] **Step 12: Ensure replyWithCheck receives default hooks**

In `createBot`, pass the default hooks in every `replyWithCheck` option object. There are direct calls in `/check`, callback `check_address_value`, the free-text tx handler, and the `continuePendingManualCheck` path that forwards its `options` object.

```typescript
      createAddressFastCheckJob,
      completeAddressFastCheckJob,
```

Also add these properties to the `replyWithCheck` options parameter type:

```typescript
    createAddressFastCheckJob?: CreateBotOptions["createAddressFastCheckJob"];
    completeAddressFastCheckJob?: CreateBotOptions["completeAddressFastCheckJob"];
```

- [ ] **Step 13: Run the bot test**

Run:

```bash
npm test -- tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 14: Commit Task 3**

```bash
git add src/types.ts src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: persist address fast check results"
```

### Task 4: Consume Deep Hints as Rechecked Priority Only

**Files:**
- Modify: `src/forensics/counterpartyInteraction.ts`
- Modify: `src/check/deepForensicCheck.ts`
- Modify: `src/forensics/deepForensicJob.ts`
- Test: `tests/forensics/counterpartyInteraction.test.ts`
- Test: `tests/forensics/deepForensicJob.test.ts`

- [ ] **Step 1: Write failing priority selection test**

In `tests/forensics/counterpartyInteraction.test.ts`, add:

```typescript
  it("selects priority addresses before volume-ranked active-wallet candidates", () => {
    const selected = selectCounterpartiesForFastSnapshot({
      sparseWallet: false,
      maxActive: 2,
      priorityAddresses: [lowerShare],
      profiles: [
        {
          counterpartyAddress: highRisk,
          volumeRaw: "900000000000",
          volumeRatio: 0.9,
          txCount: 1,
          snapshot: null
        },
        {
          counterpartyAddress: lowerShare,
          volumeRaw: "10000000000",
          volumeRatio: 0.01,
          txCount: 1,
          snapshot: null
        },
        {
          counterpartyAddress: normal,
          volumeRaw: "800000000000",
          volumeRatio: 0.8,
          txCount: 1,
          snapshot: null
        }
      ]
    });

    expect(selected).toEqual([lowerShare, highRisk]);
  });
```

- [ ] **Step 2: Run the priority selection test and verify it fails**

Run:

```bash
npm test -- tests/forensics/counterpartyInteraction.test.ts
```

Expected: fail because `priorityAddresses` is not part of `SelectCounterpartiesForFastSnapshotInput`.

- [ ] **Step 3: Add priority address support**

In `src/forensics/counterpartyInteraction.ts`, add this field to `SelectCounterpartiesForFastSnapshotInput`:

```typescript
  priorityAddresses?: string[];
```

In `selectCounterpartiesForFastSnapshot`, after `sorted` is created and before the `if (input.sparseWallet)` block, add:

```typescript
  const sortedAddresses = new Set(sorted.map((profile) => profile.counterpartyAddress));
  for (const address of input.priorityAddresses ?? []) {
    if (selected.size >= max) break;
    if (sortedAddresses.has(address)) selected.add(address);
  }
```

In both later loops that add selected addresses, keep the existing `selected.add(...)` logic. The `Set` preserves priority insertion order.

- [ ] **Step 4: Run counterparty interaction tests**

Run:

```bash
npm test -- tests/forensics/counterpartyInteraction.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add deep input field and hint parser**

In `src/check/deepForensicCheck.ts`, import `FastCheckHints` from `../types`.

Add this field to `RunDeepAddressForensicCheckInput`:

```typescript
  fastCheckHints?: FastCheckHints | null;
```

Add this helper near other small parsing helpers:

```typescript
function hintedDirectCounterpartyAddresses(input: {
  hints: FastCheckHints | null | undefined;
  sourceAddress: string;
  directCounterparties: Set<string>;
}): string[] {
  if (!input.hints || input.hints.subjectAddress !== input.sourceAddress) return [];
  const ordered = [
    ...input.hints.incoming,
    ...input.hints.outgoing
  ];
  const selected = new Set<string>();
  for (const hint of ordered) {
    if (input.directCounterparties.has(hint.address)) selected.add(hint.address);
  }
  return [...selected];
}
```

This intentionally uses incoming/outgoing hints only. Service hints stay visible in the persisted fast-check result and admin graph; deep check only prioritizes an address when it is also present among the real direct counterparties from the deep run.

- [ ] **Step 6: Feed hints into direct counterparty snapshot selection**

In `buildCounterpartyFastSnapshots`, before `const selected = selectCounterpartiesForFastSnapshot`, add:

```typescript
  const directCounterparties = new Set(seedProfiles.map((profile) => profile.counterpartyAddress));
  const priorityAddresses = hintedDirectCounterpartyAddresses({
    hints: input.runInput.fastCheckHints,
    sourceAddress: input.runInput.sourceAddress,
    directCounterparties
  });
```

Then add `priorityAddresses` to the `selectCounterpartiesForFastSnapshot` call:

```typescript
    priorityAddresses,
```

- [ ] **Step 7: Parse hints in deep job runner**

In `src/forensics/deepForensicJob.ts`, import `FastCheckHints` from `../types`.

Add this helper near `fastRiskReportFromJob`:

```typescript
function fastCheckHintsFromJob(job: ForensicCheckJob): FastCheckHints | null {
  const value = job.progressJson.fastCheckHints;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as FastCheckHints;
  if (typeof record.fastCheckJobId !== "string") return null;
  if (typeof record.generatedAt !== "string") return null;
  if (typeof record.subjectAddress !== "string") return null;
  if (!Array.isArray(record.incoming) || !Array.isArray(record.outgoing) || !Array.isArray(record.services)) return null;
  return record;
}
```

In the `runDeepAddressForensicCheck` input inside `runSingleDeepForensicJobCycle`, add:

```typescript
      fastCheckHints: fastCheckHintsFromJob(job),
```

- [ ] **Step 8: Add deep job regression test for hint forwarding**

In `tests/forensics/deepForensicJob.test.ts`, add a test with a mocked `runDeepAddressForensicCheck`:

```typescript
  it("passes valid fast check hints into deep address checks", async () => {
    const hints = {
      fastCheckJobId: "fast-job-1",
      generatedAt: "2026-06-21T00:00:00.000Z",
      subjectAddress: subject,
      incoming: [],
      outgoing: [{
        address: "TOutgoing111111111111111111111111111",
        direction: "outgoing",
        volumeRaw: "100000000",
        txCount: 1,
        volumeRatio: 1,
        category: null,
        identity: null,
        reason: "top outgoing counterparty"
      }],
      services: []
    };
    vi.resetModules();
    const deepMock = vi.fn(async () => emptyDeepReport());
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck: deepMock
    }));
    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      await runCycleWithMock({
        claimNextForensicCheckJob: async () => ({
          ...job(),
          kind: "address_deep_check",
          progressJson: { fastCheckHints: hints, locale: "en" }
        }),
        completeForensicCheckJob: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
      });

      expect(deepMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        fastCheckHints: hints
      }));
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });
```

- [ ] **Step 9: Add deep job regression test for malformed hints**

In `tests/forensics/deepForensicJob.test.ts`, add this test near the valid hint forwarding test:

```typescript
  it("drops malformed fast check hints before deep address checks", async () => {
    vi.resetModules();
    const deepMock = vi.fn(async () => emptyDeepReport());
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck: deepMock
    }));
    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      await runCycleWithMock({
        claimNextForensicCheckJob: async () => ({
          ...job(),
          kind: "address_deep_check",
          progressJson: {
            fastCheckHints: {
              fastCheckJobId: "fast-job-1",
              subjectAddress: subject,
              incoming: "not-array",
              outgoing: [],
              services: []
            },
            locale: "en"
          }
        }),
        completeForensicCheckJob: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
      });

      expect(deepMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        fastCheckHints: null
      }));
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });
```

- [ ] **Step 10: Run deep focused tests**

Run:

```bash
npm test -- tests/forensics/counterpartyInteraction.test.ts tests/forensics/deepForensicJob.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 4**

```bash
git add src/forensics/counterpartyInteraction.ts src/check/deepForensicCheck.ts src/forensics/deepForensicJob.ts tests/forensics/counterpartyInteraction.test.ts tests/forensics/deepForensicJob.test.ts
git commit -m "feat: prioritize deep counterparty hints"
```

### Task 5: Admin Fast Check Graph Projection

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Write failing graph projection test**

In `tests/admin/forensicsGraph.test.ts`, add:

```typescript
  it("projects address fast check jobs into an admin graph", () => {
    const result = projectForensicJobGraph(job({
      id: "fast-job-1",
      kind: "address_fast_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      status: "completed",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        report: {
          subjectAddress: "TSubject111111111111111111111111111111",
          score: 12,
          level: "LOW",
          reasons: []
        },
        operationalFlowProfiles: [{
          subjectAddress: "TSubject111111111111111111111111111111",
          windowStart: "2026-06-21T00:00:00.000Z",
          windowEnd: "2026-06-21T00:01:00.000Z",
          incomingVolumeRaw: "500000000",
          outgoingVolumeRaw: "400000000",
          incomingTxCount: 1,
          outgoingTxCount: 1,
          inflowToOutflowRatio: 0.8,
          topIncomingCounterparties: [{
            address: "TIncoming111111111111111111111111111",
            direction: "incoming",
            volumeRaw: "500000000",
            txCount: 1,
            volumeRatio: 1,
            category: null,
            identity: null,
            isTerminalLiquidity: false,
            isHtxHuobi: false
          }],
          topOutgoingCounterparties: [{
            address: "TBridge11111111111111111111111111111",
            direction: "outgoing",
            volumeRaw: "400000000",
            txCount: 1,
            volumeRatio: 1,
            category: "bridge",
            identity: "Bridge Router",
            isTerminalLiquidity: true,
            isHtxHuobi: false
          }],
          categoryBreakdown: [{
            direction: "outgoing",
            category: "bridge",
            volumeRaw: "400000000",
            txCount: 1,
            volumeRatio: 1
          }],
          terminalLiquidityIncomingRatio: 0,
          terminalLiquidityOutgoingRatio: 1,
          htxHuobiIncomingRatio: 0,
          htxHuobiOutgoingRatio: 0,
          bridgeDexRouterOutgoingRatio: 1,
          unknownContractOutgoingRatio: 0,
          historicalTransitScore: 0,
          historicalTransitBreakdown: {
            eligible: false,
            flowUsdt: 0,
            volumeScore: 0,
            passThrough: 0,
            passThroughScore: 0,
            serviceShare: 0,
            serviceShareScore: 0,
            score: 0
          },
          operationalScore: 0,
          features: []
        }],
        serviceExposureProfiles: [{
          subjectAddress: "TSubject111111111111111111111111111111",
          totalOutgoingRaw: "400000000",
          topServiceCounterparties: [{
            address: "TBridge11111111111111111111111111111",
            direction: "outgoing",
            volumeRaw: "400000000",
            txCount: 1,
            volumeRatio: 1,
            category: "bridge",
            identity: "Bridge Router",
            isTerminalLiquidity: true,
            isHtxHuobi: false
          }]
        }],
        addressBehaviorProfiles: [],
        boundaryExposureProfiles: [],
        walletRoleProfiles: [],
        stablecoinRestrictionProfiles: [],
        missingChecks: [],
        followUpJobs: {
          whereIsMoneyJobId: "where-job-1",
          deepJobId: "deep-job-1"
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.job.kind).toBe("address_fast_check");
    expect(result.graph.summary.checkedScope).toBe("fast_check");
    expect(result.graph.nodes.map((node) => node.address)).toEqual(expect.arrayContaining([
      "TSubject111111111111111111111111111111",
      "TIncoming111111111111111111111111111",
      "TBridge11111111111111111111111111111"
    ]));
    expect(result.graph.nodes.find((node) => node.address === "TBridge11111111111111111111111111111")?.displayKind).toBe("bridge");
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "transfer",
        displayRole: "profile_context",
        amountRaw: "500000000"
      }),
      expect.objectContaining({
        type: "transfer",
        displayRole: "profile_context",
        amountRaw: "400000000"
      })
    ]));
    expect(result.graph.summary.layerSummary).toMatchObject({
      fastCheckTops: {
        outgoing: [expect.objectContaining({ address: "TBridge11111111111111111111111111111" })],
        services: [expect.objectContaining({ address: "TBridge11111111111111111111111111111", volumeRatio: 1 })]
      },
      followUpJobs: {
        whereIsMoneyJobId: "where-job-1",
        deepJobId: "deep-job-1"
      }
    });
  });
```

- [ ] **Step 2: Run graph projection test and verify it fails**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected: fail with unsupported `address_fast_check`.

- [ ] **Step 3: Add projection branch**

In `src/admin/forensicsGraph.ts`, add this branch before `address_deep_check`:

```typescript
  if (job.kind === "address_fast_check") {
    return projectAddressFastCheckJob(job, summary);
  }
```

- [ ] **Step 4: Add fast projection helper**

In `src/admin/forensicsGraph.ts`, add this function near other `project*Job` helpers:

```typescript
function projectAddressFastCheckJob(job: ForensicCheckJob, summary: AdminForensicsJobSummary): AdminForensicsProjectionResult {
  const result = job.resultJson;
  if (!isRecord(result)) {
    return { ok: false, status: "malformed", message: "Fast check result_json is not an object." };
  }
  const report = isRecord(result.report) ? result.report : {};
  const score = numberField(report, "score");
  const level = riskLevelFromScore(score);
  const flowProfiles = arrayField(result, "operationalFlowProfiles") ?? [];
  const flow = isRecord(flowProfiles[0]) ? flowProfiles[0] : {};
  const serviceProfiles = arrayField(result, "serviceExposureProfiles") ?? [];
  const serviceProfile = isRecord(serviceProfiles[0]) ? serviceProfiles[0] : {};
  const serviceTotalRaw = stringField(serviceProfile, "totalOutgoingRaw");
  const serviceTops = recordArrayField(serviceProfile, "topServiceCounterparties").map((item) => ({
    ...item,
    volumeRatio: numberField(item, "volumeRatio") ?? ratioFromRawStrings(stringField(item, "volumeRaw"), serviceTotalRaw)
  }));
  const fastCheckTops = {
    incoming: recordArrayField(flow, "topIncomingCounterparties"),
    outgoing: recordArrayField(flow, "topOutgoingCounterparties"),
    services: serviceTops
  };
  const nodes = new Map<string, AdminForensicsNode>();
  const edges: AdminForensicsEdge[] = [];
  const subjectNodeId = `address:${job.subjectAddress}`;
  nodes.set(subjectNodeId, {
    id: subjectNodeId,
    address: job.subjectAddress,
    kind: "subject",
    displayKind: "subject_wallet",
    displayLabel: shortAddress(job.subjectAddress),
    label: shortAddress(job.subjectAddress),
    riskLevel: level,
    confidence: null,
    weight: score,
    metadata: { role: "checked_wallet" }
  });
  const addCounterparty = (item: Record<string, unknown>, direction: "incoming" | "outgoing") => {
    const address = stringField(item, "address");
    if (!address) return;
    const category = stringField(item, "category");
    const identity = stringField(item, "identity");
    const nodeId = `address:${address}`;
    const displayKind = displayKindForServiceCategory(category, direction === "incoming" ? "wallet" : "service_boundary");
    const kind = displayKind === "wallet"
      ? "wallet"
      : displayKind === "smart_contract" || displayKind === "dex_contract" || displayKind === "contract_adapter" || displayKind === "contract_router"
        ? "contract"
        : "service";
    nodes.set(nodeId, {
      id: nodeId,
      address,
      kind,
      displayKind,
      displayLabel: identity ?? shortAddress(address),
      label: identity ?? shortAddress(address),
      riskLevel: null,
      confidence: null,
      weight: numberField(item, "volumeRatio"),
      metadata: {
        direction,
        category,
        identity,
        txCount: numberField(item, "txCount")
      }
    });
    const edgeId = `${direction}:${address}`;
    edges.push({
      id: edgeId,
      fromNodeId: direction === "incoming" ? nodeId : subjectNodeId,
      toNodeId: direction === "incoming" ? subjectNodeId : nodeId,
      type: "transfer",
      displayRole: "profile_context",
      amountRaw: stringField(item, "volumeRaw"),
      amountShare: numberField(item, "volumeRatio"),
      txHash: null,
      timestamp: null,
      weight: numberField(item, "volumeRatio"),
      verdict: category ? "review" : "unknown",
      evidenceIds: job.rawEvidenceIds,
      metadata: {
        direction,
        txCount: numberField(item, "txCount"),
        category,
        identity,
        source: "address_fast_check"
      }
    });
  };
  const outgoingAddresses = new Set(fastCheckTops.outgoing.map((item) => stringField(item, "address")).filter((address): address is string => Boolean(address)));
  for (const item of fastCheckTops.incoming) addCounterparty(item, "incoming");
  for (const item of fastCheckTops.outgoing) addCounterparty(item, "outgoing");
  for (const item of fastCheckTops.services) {
    const address = stringField(item, "address");
    if (address && !outgoingAddresses.has(address)) addCounterparty(item, "outgoing");
  }
  return {
    ok: true,
    graph: {
      job: summary,
      subject: {
        address: job.subjectAddress,
        displayLabel: null,
        knownLabels: [],
        role: "checked_wallet"
      },
      summary: {
        decision: score !== null && score >= 60 ? "REVIEW" : "UNKNOWN",
        riskScore: score,
        riskLevel: level,
        confidence: null,
        coverageRatio: null,
        checkedScope: "fast_check",
        anchorCoverageRatio: null,
        episodeCoverageRatio: null,
        drainEpisode: null,
        layerSummary: {
          fastCheckTops,
          followUpJobs: isRecord(result.followUpJobs) ? result.followUpJobs : {}
        },
        selectedAmountRaw: null,
        targetAmountRaw: null,
        topReasons: []
      },
      nodes: [...nodes.values()],
      edges,
      paths: [],
      weights: [],
      limitations: missingCheckLimitations(result),
      evidence: evidenceRefs(job.rawEvidenceIds, [], edges)
    }
  };
}
```

- [ ] **Step 5: Add small helpers**

`recordArrayField` already exists in `src/admin/forensicsGraph.ts`. Add these helpers near it:

```typescript
function displayKindForServiceCategory(category: string | null, fallback: AdminForensicsNodeDisplayKind): AdminForensicsNodeDisplayKind {
  if (category === "bridge" || category === "bridge_pool") return "bridge";
  if (category === "cex" || category === "exchange") return "cex";
  if (category === "dex" || category === "router") return "dex_contract";
  if (category === "unknown_contract") return "smart_contract";
  return fallback;
}

function ratioFromRawStrings(valueRaw: string | null, totalRaw: string | null): number | null {
  const value = Number(valueRaw);
  const total = Number(totalRaw);
  return Number.isFinite(value) && Number.isFinite(total) && total > 0 ? value / total : null;
}

function missingCheckLimitations(record: Record<string, unknown>): AdminForensicsLimitation[] {
  return stringArrayField(record, "missingChecks").map((message, index) => ({
    code: `fast_check_limit_${index + 1}`,
    label: message,
    severity: "review",
    pathId: null,
    explanation: message
  }));
}
```

- [ ] **Step 6: Update admin console graph details**

In `src/admin/adminConsole.ts`, update the graph title helper so:

```typescript
      if (kind === "address_fast_check") return "Fast profile graph";
```

Add limitation copy so fast check explains bounded scope:

```typescript
      if (kind === "address_fast_check") {
        return [
          "Fast check graph shows direct counterparties and nearby service boundaries collected during the bounded fast pass.",
          "Deep check and where-is-money may add or change context after their own re-checks."
        ];
      }
```

Add a small summary renderer near `riskLayerLines` so the admin details panel shows the fast-check tops as explicit lists:

```javascript
    function fastCheckTops(summary) {
      const layer = summary?.layerSummary && typeof summary.layerSummary === "object" ? summary.layerSummary : {};
      return layer.fastCheckTops && typeof layer.fastCheckTops === "object" ? layer.fastCheckTops : {};
    }
    function fastTopLine(item) {
      const name = item.identity || short(item.address || "unknown", 6);
      const amount = item.volumeRaw ? raw(item.volumeRaw) : "amount n/a";
      const share = percent(item.volumeRatio);
      const category = item.category ? " / " + item.category : "";
      return name + " - " + amount + " / " + share + " / " + (item.txCount ?? 0) + " tx" + category;
    }
    function fastCheckTopMetrics(summary) {
      const tops = fastCheckTops(summary);
      return listMetric("Top incoming", asArray(tops.incoming).map(fastTopLine), "No incoming top counterparties stored.") +
        listMetric("Top outgoing", asArray(tops.outgoing).map(fastTopLine), "No outgoing top counterparties stored.") +
        listMetric("Top services", asArray(tops.services).map(fastTopLine), "No service top counterparties stored.");
    }
```

In `renderDetails`, add the metrics directly after the existing layer summary metric:

```javascript
        (graph?.job?.kind === "address_fast_check" ? fastCheckTopMetrics(summary) : "") +
```

Extend `tests/admin/adminConsole.test.ts` with a string-level regression check that the generated HTML contains `"Top incoming"`, `"Top outgoing"`, and `"Top services"`. This keeps the Telegram text unchanged but makes the fast-check admin details visible.

- [ ] **Step 7: Run admin tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: render address fast check graph"
```

### Task 6: Full Verification and Documentation Check

**Files:**
- Modify only files needed to fix test or type failures discovered by the commands in this task.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run migration smoke command if local database env is configured**

Run:

```bash
npm run db:migrate
```

Expected when database env is configured: migrations complete without SQL constraint errors.

Expected when database env is not configured: command fails with the existing local database configuration error. Record that exact error in the final implementation notes.

- [ ] **Step 4: Inspect git diff for accidental Telegram output changes**

Run:

```bash
git diff -- src/bot/createBot.ts tests/bot/createBot.test.ts
```

Expected: detailed fast-check tables are not added to Telegram report formatting. The bot should still send the compact started/preliminary message.

- [ ] **Step 5: Commit verification fixes if any files changed**

If Step 1 through Step 4 required fixes, commit them:

```bash
git add src tests migrations
git commit -m "test: verify address fast check admin flow"
```

If no files changed, do not create an empty commit.

## Plan Self-Review

Spec coverage:

- Admin-visible fast check: Task 1, Task 3, Task 5.
- TG remains hidden: Task 3 bot test and Task 6 diff check.
- Top incoming/outgoing/services: Task 2 and Task 5.
- Fast graph: Task 5.
- Deep hints without proof dependency: Task 4.
- Where-is-money unchanged: Task 3 sends hints only to deep and Task 6 checks bot diff.
- Evidence, observations, missing checks, follow-up jobs: Task 3 result JSON and Task 5 projection.

Type consistency:

- `FastCheckHints` is defined in `src/types.ts` before use in bot and deep code.
- `operationalFlowProfiles` is added to `ManualRiskSignals`, `ManualCheckResult`, and the fast signal provider.
- `address_fast_check` is added to storage, admin server, admin console, and graph projection.

Execution order:

- Task 1 unlocks storage/admin kind parsing.
- Task 2 makes top data available.
- Task 3 persists fast results and passes hints.
- Task 4 consumes hints safely.
- Task 5 displays fast admin graph.
- Task 6 verifies the full branch.
