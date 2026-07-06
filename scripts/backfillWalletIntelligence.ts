import "dotenv/config";
import { closeDb, createDb } from "../src/storage/db";
import {
  getTelegramUserProfile,
  getWalletIntelligenceRunState,
  indexWalletIntelligenceJobPayload,
  listWalletIntelligenceBackfillJobs
} from "../src/storage/repositories";
import { extractWalletIntelligenceFromJob } from "../src/forensics/walletIntelligence";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing required environment variable: DATABASE_URL");

const batchSize = Number(process.env.WALLET_INTELLIGENCE_BACKFILL_BATCH_SIZE ?? 100);
const limit = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 100;
const db = createDb(databaseUrl);

let offset = 0;
let indexed = 0;
let failed = 0;

try {
  for (;;) {
    const jobs = await listWalletIntelligenceBackfillJobs(db, { limit, offset });
    if (jobs.length === 0) break;

    for (const job of jobs) {
      try {
        const extraction = extractWalletIntelligenceFromJob(job);
        const existing = await getWalletIntelligenceRunState(db, job.id);
        if (
          existing?.sourcePayloadHash === extraction.run.sourcePayloadHash &&
          existing.indexVersion === extraction.run.indexVersion &&
          existing.indexStatus === "indexed"
        ) {
          continue;
        }
        const profile = job.requestedBy ? await getTelegramUserProfile(db, job.requestedBy).catch(() => null) : null;
        await indexWalletIntelligenceJobPayload(db, {
          ...extraction,
          run: {
            ...extraction.run,
            telegramUserId: profile?.telegramUserId ?? job.requestedBy,
            telegramUsername: profile?.username ?? null,
            telegramLocale: profile?.locale ?? null
          }
        });
        indexed += 1;
      } catch (error) {
        failed += 1;
        console.warn("wallet_intelligence_backfill_job_failed", {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    offset += jobs.length;
    console.log(`Wallet Intelligence backfill progress: indexed=${indexed} failed=${failed} offset=${offset}`);
  }
} finally {
  await closeDb(db);
}

console.log(`Wallet Intelligence backfill complete: indexed=${indexed} failed=${failed}`);
