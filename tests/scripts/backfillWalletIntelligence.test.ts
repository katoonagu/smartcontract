import { describe, expect, it } from "vitest";
import {
  runWalletIntelligenceBackfill,
  runWalletIntelligenceBackfillFromDatabase
} from "../../scripts/backfillWalletIntelligence";
import type {
  ForensicCheckJob,
  TelegramUserProfile,
  WalletIntelligenceIndexPayload,
  WalletIntelligenceRunState
} from "../../src/storage/repositories";

function job(id: string, overrides: Partial<ForensicCheckJob> = {}): ForensicCheckJob {
  return {
    id,
    kind: "address_deep_check",
    subjectAddress: "TSubject111111111111111111111111111111",
    status: "completed",
    windowStart: new Date("2026-07-06T00:00:00.000Z"),
    windowEnd: new Date("2026-07-06T01:00:00.000Z"),
    priority: 100,
    chatId: "42",
    messageId: "77",
    requestedBy: "42",
    progressJson: {},
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-07-06T00:00:00.000Z"),
    updatedAt: new Date("2026-07-06T01:00:00.000Z"),
    startedAt: new Date("2026-07-06T00:00:01.000Z"),
    completedAt: new Date("2026-07-06T01:00:00.000Z"),
    ...overrides
  };
}

function payloadFor(input: { job: ForensicCheckJob; hash: string }): WalletIntelligenceIndexPayload {
  return {
    run: {
      jobId: input.job.id,
      jobKind: input.job.kind as WalletIntelligenceIndexPayload["run"]["jobKind"],
      jobStatus: input.job.status as WalletIntelligenceIndexPayload["run"]["jobStatus"],
      subjectAddress: input.job.subjectAddress,
      requestedBy: input.job.requestedBy,
      chatId: input.job.chatId,
      messageId: input.job.messageId,
      completedAt: input.job.completedAt,
      telegramUserId: null,
      telegramUsername: null,
      telegramLocale: null,
      sourcePayloadHash: input.hash,
      indexVersion: 1,
      indexStatus: "indexed",
      indexError: null
    },
    sightings: [],
    edges: [],
    touchedAddresses: []
  };
}

describe("wallet intelligence backfill script", () => {
  it("skips jobs that already have the same indexed payload version", async () => {
    const indexedPayloads: WalletIntelligenceIndexPayload[] = [];
    const sourceJob = job("job-1");

    const result = await runWalletIntelligenceBackfill({
      listJobs: async ({ offset }) => offset === 0 ? [sourceJob] : [],
      extract: (item) => payloadFor({ job: item, hash: "hash-1" }),
      getRunState: async (): Promise<WalletIntelligenceRunState> => ({
        sourcePayloadHash: "hash-1",
        indexVersion: 1,
        indexStatus: "indexed"
      }),
      getTelegramUserProfile: async () => null,
      indexJobPayload: async (payload) => {
        indexedPayloads.push(payload);
      }
    });

    expect(result).toEqual({ indexed: 0, failed: 0, skipped: 1, snapshotCount: 1 });
    expect(indexedPayloads).toEqual([]);
  });

  it("snapshots all pages before indexing changed payloads", async () => {
    const events: string[] = [];
    const sourceJobs = [job("job-1"), job("job-2")];
    const indexedPayloads: WalletIntelligenceIndexPayload[] = [];
    const profile: TelegramUserProfile = {
      telegramUserId: "42",
      username: "client_user",
      locale: "en",
      createdAt: new Date("2026-07-06T00:00:00.000Z")
    };

    const result = await runWalletIntelligenceBackfill({
      listJobs: async ({ offset }) => {
        const pageOffset = offset ?? 0;
        events.push(`list:${pageOffset}`);
        return sourceJobs.slice(pageOffset, pageOffset + 1);
      },
      extract: (item) => payloadFor({ job: item, hash: `new-${item.id}` }),
      getRunState: async (jobId) => {
        events.push(`state:${jobId}`);
        return { sourcePayloadHash: "old", indexVersion: 1, indexStatus: "indexed" };
      },
      getTelegramUserProfile: async (telegramUserId) => {
        events.push(`profile:${telegramUserId}`);
        return profile;
      },
      indexJobPayload: async (payload) => {
        events.push(`index:${payload.run.jobId}`);
        indexedPayloads.push(payload);
      }
    }, { batchSize: 1 });

    expect(result).toEqual({ indexed: 2, failed: 0, skipped: 0, snapshotCount: 2 });
    expect(events.slice(0, 3)).toEqual(["list:0", "list:1", "list:2"]);
    expect(indexedPayloads.map((payload) => payload.run.sourcePayloadHash)).toEqual(["new-job-1", "new-job-2"]);
    expect(indexedPayloads[0]?.run).toMatchObject({
      telegramUserId: "42",
      telegramUsername: "client_user",
      telegramLocale: "en"
    });
  });

  it("counts a failed job and continues with the next snapshot job", async () => {
    const indexedPayloads: WalletIntelligenceIndexPayload[] = [];
    const warnings: Array<Record<string, unknown>> = [];
    const sourceJobs = [job("job-1"), job("job-2")];

    const result = await runWalletIntelligenceBackfill({
      listJobs: async ({ offset }) => offset === 0 ? sourceJobs : [],
      extract: (item) => payloadFor({ job: item, hash: `hash-${item.id}` }),
      getRunState: async () => null,
      getTelegramUserProfile: async () => null,
      indexJobPayload: async (payload) => {
        if (payload.run.jobId === "job-1") throw new Error("forced index failure");
        indexedPayloads.push(payload);
      },
      warn: (_message, details) => {
        warnings.push(details);
      }
    });

    expect(result).toEqual({ indexed: 1, failed: 1, skipped: 0, snapshotCount: 2 });
    expect(indexedPayloads.map((payload) => payload.run.jobId)).toEqual(["job-2"]);
    expect(warnings).toEqual([{ jobId: "job-1", error: "forced index failure" }]);
  });

  it("closes the database when startup listing fails", async () => {
    const db = { id: "fake-db" };
    const closed: unknown[] = [];

    await expect(runWalletIntelligenceBackfillFromDatabase({
      databaseUrl: "postgres://example",
      deps: {
        createDb: () => db,
        closeDb: async (input) => {
          closed.push(input);
        },
        listWalletIntelligenceBackfillJobs: async () => {
          throw new Error("forced list failure");
        },
        extractWalletIntelligenceFromJob: (item) => payloadFor({ job: item, hash: "hash-1" }),
        getWalletIntelligenceRunState: async () => null,
        getTelegramUserProfile: async () => null,
        indexWalletIntelligenceJobPayload: async () => undefined
      }
    })).rejects.toThrow("forced list failure");

    expect(closed).toEqual([db]);
  });
});
