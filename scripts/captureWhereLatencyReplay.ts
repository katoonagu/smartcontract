import "dotenv/config";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { loadConfig } from "../src/config";
import { closeDb, createDb } from "../src/storage/db";
import { canonicalizeArtifactJson } from "../src/forensics/canonicalJson";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function nonSecretConfigHash(config: Record<string, unknown>): string {
  const visible = Object.fromEntries(Object.entries(config).filter(([key]) =>
    !/(?:api[_-]?key|database|chat|telegram|token|secret|password)/i.test(key)
  ));
  return createHash("sha256").update(canonicalizeArtifactJson(visible)).digest("hex");
}

const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const source = argument("--source") ?? positional[0] ?? null;
const output = argument("--out") ?? positional[1] ?? null;
if (!source || !output) throw new Error("Usage: forensic:where-latency:capture -- --source <TRON-address> --out <new-json-file>");

const config = loadConfig();
const db = createDb(config.databaseUrl);
try {
  // This query intentionally never reads chat/requester fields: replay evidence must not carry Telegram identifiers.
  const result = await db.query(
    `select id, subject_address, window_start, window_end, progress_json, result_json
     from forensic_check_jobs
     where kind = 'where_is_money_check' and status = 'completed' and subject_address = $1
     order by completed_at desc nulls last, updated_at desc
     limit 1`,
    [source]
  );
  const job = result.rows[0] as Record<string, unknown> | undefined;
  if (!job) throw new Error("where_latency_replay_completed_legacy_job_missing");
  if (!job.result_json || typeof job.result_json !== "object") throw new Error("where_latency_replay_completed_report_missing");

  // The subsequent live wrapper is intentionally fail-closed until it can record every legacy dependency,
  // indexed movement snapshot, assertion snapshot, raw transaction, and supplemental transaction-info call.
  // It must never write a partial or guessed fixture.
  void nonSecretConfigHash(config as unknown as Record<string, unknown>);
  void resolve(output);
  throw new Error("where_latency_replay_live_recorder_requires_complete_dependency_wiring");
} finally {
  await closeDb(db);
}

// Keep the exclusive-write primitive adjacent to the command so future live wiring cannot accidentally overwrite evidence.
export async function writeReplayExclusive(path: string, bytes: string): Promise<void> {
  const file = await open(resolve(path), "wx");
  try {
    await file.writeFile(bytes, "utf8");
  } finally {
    await file.close();
  }
}
