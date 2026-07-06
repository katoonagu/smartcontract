import "dotenv/config";
import { pathToFileURL } from "node:url";
import type { Db } from "../src/storage/db";
import { closeDb as closeDefaultDb, createDb as createDefaultDb } from "../src/storage/db";
import {
  getTelegramUserProfile as getDefaultTelegramUserProfile,
  getWalletIntelligenceRunState as getDefaultWalletIntelligenceRunState,
  indexWalletIntelligenceJobPayload as indexDefaultWalletIntelligenceJobPayload,
  listWalletIntelligenceBackfillJobs as listDefaultWalletIntelligenceBackfillJobs,
  type ForensicCheckJob,
  type ListWalletIntelligenceBackfillJobsInput,
  type TelegramUserProfile,
  type WalletIntelligenceIndexPayload,
  type WalletIntelligenceRunState
} from "../src/storage/repositories";
import { extractWalletIntelligenceFromJob as defaultExtractWalletIntelligenceFromJob } from "../src/forensics/walletIntelligence";

export type WalletIntelligenceBackfillResult = {
  indexed: number;
  failed: number;
  skipped: number;
  snapshotCount: number;
};

export type WalletIntelligenceBackfillDeps = {
  listJobs: (input: ListWalletIntelligenceBackfillJobsInput) => Promise<ForensicCheckJob[]>;
  extract: (job: ForensicCheckJob) => WalletIntelligenceIndexPayload;
  getRunState: (jobId: string) => Promise<WalletIntelligenceRunState | null>;
  getTelegramUserProfile: (telegramUserId: string) => Promise<TelegramUserProfile | null>;
  indexJobPayload: (input: WalletIntelligenceIndexPayload) => Promise<void>;
  log?: (message: string) => void;
  warn?: (message: string, details: Record<string, unknown>) => void;
};

export type WalletIntelligenceBackfillOptions = {
  batchSize?: number;
};

export type WalletIntelligenceBackfillDatabaseDeps = {
  createDb: (databaseUrl: string) => unknown;
  closeDb: (db: unknown) => Promise<void>;
  listWalletIntelligenceBackfillJobs: (db: unknown, input: ListWalletIntelligenceBackfillJobsInput) => Promise<ForensicCheckJob[]>;
  extractWalletIntelligenceFromJob: (job: ForensicCheckJob) => WalletIntelligenceIndexPayload;
  getWalletIntelligenceRunState: (db: unknown, jobId: string) => Promise<WalletIntelligenceRunState | null>;
  getTelegramUserProfile: (db: unknown, telegramUserId: string) => Promise<TelegramUserProfile | null>;
  indexWalletIntelligenceJobPayload: (db: unknown, input: WalletIntelligenceIndexPayload) => Promise<void>;
};

export type WalletIntelligenceBackfillDatabaseOptions = {
  databaseUrl: string;
  batchSize?: number;
  deps?: WalletIntelligenceBackfillDatabaseDeps;
  log?: (message: string) => void;
  warn?: (message: string, details: Record<string, unknown>) => void;
};

function normalizedBatchSize(batchSize: number | undefined): number {
  return typeof batchSize === "number" && Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 100;
}

async function snapshotBackfillJobs(deps: WalletIntelligenceBackfillDeps, limit: number): Promise<ForensicCheckJob[]> {
  const jobs: ForensicCheckJob[] = [];
  let offset = 0;
  for (;;) {
    const batch = await deps.listJobs({ limit, offset });
    if (batch.length === 0) break;
    jobs.push(...batch);
    offset += batch.length;
  }
  return jobs;
}

export async function runWalletIntelligenceBackfill(
  deps: WalletIntelligenceBackfillDeps,
  options: WalletIntelligenceBackfillOptions = {}
): Promise<WalletIntelligenceBackfillResult> {
  const limit = normalizedBatchSize(options.batchSize);
  const jobs = await snapshotBackfillJobs(deps, limit);
  let indexed = 0;
  let failed = 0;
  let skipped = 0;
  let processed = 0;

  for (const job of jobs) {
    try {
      const extraction = deps.extract(job);
      const existing = await deps.getRunState(job.id);
      if (
        existing?.sourcePayloadHash === extraction.run.sourcePayloadHash &&
        existing.indexVersion === extraction.run.indexVersion &&
        existing.indexStatus === "indexed"
      ) {
        skipped += 1;
      } else {
        const profile = job.requestedBy ? await deps.getTelegramUserProfile(job.requestedBy).catch(() => null) : null;
        await deps.indexJobPayload({
          ...extraction,
          run: {
            ...extraction.run,
            telegramUserId: profile?.telegramUserId ?? job.requestedBy,
            telegramUsername: profile?.username ?? null,
            telegramLocale: profile?.locale ?? null
          }
        });
        indexed += 1;
      }
    } catch (error) {
      failed += 1;
      deps.warn?.("wallet_intelligence_backfill_job_failed", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    processed += 1;
    if (processed % limit === 0 || processed === jobs.length) {
      deps.log?.(`Wallet Intelligence backfill progress: indexed=${indexed} failed=${failed} offset=${processed}`);
    }
  }

  return { indexed, failed, skipped, snapshotCount: jobs.length };
}

const defaultDatabaseDeps: WalletIntelligenceBackfillDatabaseDeps = {
  createDb: createDefaultDb,
  closeDb: (db) => closeDefaultDb(db as Db),
  listWalletIntelligenceBackfillJobs: (db, input) => listDefaultWalletIntelligenceBackfillJobs(db as Db, input),
  extractWalletIntelligenceFromJob: defaultExtractWalletIntelligenceFromJob,
  getWalletIntelligenceRunState: (db, jobId) => getDefaultWalletIntelligenceRunState(db as Db, jobId),
  getTelegramUserProfile: (db, telegramUserId) => getDefaultTelegramUserProfile(db as Db, telegramUserId),
  indexWalletIntelligenceJobPayload: (db, input) => indexDefaultWalletIntelligenceJobPayload(db as Db, input)
};

export async function runWalletIntelligenceBackfillFromDatabase(
  options: WalletIntelligenceBackfillDatabaseOptions
): Promise<WalletIntelligenceBackfillResult> {
  const deps = options.deps ?? defaultDatabaseDeps;
  const db = deps.createDb(options.databaseUrl);
  try {
    return await runWalletIntelligenceBackfill({
      listJobs: (input) => deps.listWalletIntelligenceBackfillJobs(db, input),
      extract: deps.extractWalletIntelligenceFromJob,
      getRunState: (jobId) => deps.getWalletIntelligenceRunState(db, jobId),
      getTelegramUserProfile: (telegramUserId) => deps.getTelegramUserProfile(db, telegramUserId),
      indexJobPayload: (input) => deps.indexWalletIntelligenceJobPayload(db, input),
      log: options.log,
      warn: options.warn
    }, { batchSize: options.batchSize });
  } finally {
    await deps.closeDb(db);
  }
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<WalletIntelligenceBackfillResult> {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing required environment variable: DATABASE_URL");

  const batchSize = Number(env.WALLET_INTELLIGENCE_BACKFILL_BATCH_SIZE ?? 100);
  const result = await runWalletIntelligenceBackfillFromDatabase({
    databaseUrl,
    batchSize,
    log: (message) => console.log(message),
    warn: (message, details) => console.warn(message, details)
  });
  console.log(`Wallet Intelligence backfill complete: indexed=${result.indexed} failed=${result.failed}`);
  return result;
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  await main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
