import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import {
  buildCoverageDebugReportFromJob,
  formatCoverageDebugSummary,
  formatCoverageDebugTable
} from "../src/forensics/coverageDebugReport";
import { parseCoverageDebugCliArgs } from "../src/forensics/coverageDebugCliArgs";
import { closeDb, createDb } from "../src/storage/db";
import {
  getForensicCheckJob,
  getLatestForensicCheckJobForAddress,
  type ForensicCheckJob
} from "../src/storage/repositories";

function databaseUrlFromEnvironment(): string {
  try {
    return loadConfig().databaseUrl;
  } catch (error) {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    throw error;
  }
}

async function resolveJob(args: ReturnType<typeof parseCoverageDebugCliArgs>, db: ReturnType<typeof createDb>): Promise<ForensicCheckJob> {
  const job = args.mode === "job"
    ? await getForensicCheckJob(db, args.jobId)
    : await getLatestForensicCheckJobForAddress(db, args.address);
  if (!job) {
    throw new Error(args.mode === "job"
      ? `Forensic job not found: ${args.jobId}`
      : `No forensic job found for address: ${args.address}`);
  }
  return job;
}

try {
  const args = parseCoverageDebugCliArgs(process.argv.slice(2));
  const db = createDb(databaseUrlFromEnvironment());
  try {
    const job = await resolveJob(args, db);
    const report = buildCoverageDebugReportFromJob({
      id: job.id,
      subjectAddress: job.subjectAddress,
      status: job.status,
      windowStart: job.windowStart,
      windowEnd: job.windowEnd,
      progressJson: job.progressJson,
      resultJson: job.resultJson,
      lastError: job.lastError
    });
    await mkdir(args.outDir, { recursive: true });
    const artifactPath = join(args.outDir, `${job.id}.json`);
    await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(formatCoverageDebugSummary(report));
    console.log("");
    console.log(formatCoverageDebugTable(report));
    console.log("");
    console.log(`JSON artifact: ${artifactPath}`);
  } finally {
    await closeDb(db);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
