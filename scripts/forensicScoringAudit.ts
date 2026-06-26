import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { parseScoringAuditCliArgs, type ParsedScoringAuditCliArgs } from "../src/forensics/scoringAuditCliArgs";
import { buildScoringAuditReport, formatScoringAuditMarkdown } from "../src/forensics/scoringAuditReport";
import { buildScoringAuditRow } from "../src/risk/scoringAudit";
import { closeDb, createDb, type Db } from "../src/storage/db";
import { getForensicCheckJob, listAdminForensicCheckJobs, type ForensicCheckJob } from "../src/storage/repositories";

function databaseUrlFromEnvironment(): string {
  try {
    return loadConfig().databaseUrl;
  } catch (error) {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    throw error;
  }
}

async function resolveJobs(args: ParsedScoringAuditCliArgs, db: Db): Promise<ForensicCheckJob[]> {
  if (args.mode === "job") {
    const job = await getForensicCheckJob(db, args.jobId);
    if (!job) throw new Error(`Forensic job not found: ${args.jobId}`);
    return [job];
  }

  const jobs = args.mode === "latest"
    ? await listAdminForensicCheckJobs(db, { subjectAddress: args.address, limit: args.limit })
    : await listAdminForensicCheckJobs(db, { limit: args.limit });

  if (jobs.length === 0) {
    throw new Error(args.mode === "latest"
      ? `No forensic jobs found for address: ${args.address}`
      : "No forensic jobs found.");
  }
  return jobs;
}

function artifactBaseName(now: Date): string {
  return `scoring-audit-${now.toISOString().replace(/[:.]/g, "-")}`;
}

try {
  const args = parseScoringAuditCliArgs(process.argv.slice(2));
  const db = createDb(databaseUrlFromEnvironment());
  try {
    const jobs = await resolveJobs(args, db);
    const report = buildScoringAuditReport(jobs.map(buildScoringAuditRow));
    await mkdir(args.outDir, { recursive: true });

    const baseName = artifactBaseName(new Date(report.generatedAt));
    if (args.format === "json" || args.format === "both") {
      await writeFile(join(args.outDir, `${baseName}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    if (args.format === "markdown" || args.format === "both") {
      await writeFile(join(args.outDir, `${baseName}.md`), `${formatScoringAuditMarkdown(report)}\n`, "utf8");
    }

    console.log(`Total jobs: ${report.totalJobs}`);
    console.log(`High partial coverage: ${report.cohorts.high_score_partial_coverage}`);
    console.log(`Acceptable limited coverage: ${report.cohorts.acceptable_limited_coverage}`);
    console.log(`Output directory: ${args.outDir}`);
  } finally {
    await closeDb(db);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
