import "dotenv/config";
import { loadConfig } from "../src/config";
import { closeDb, createDb } from "../src/storage/db";
import { repairInvalidCompleteTargetedIndexStates } from "../src/forensics/targetedIndexRepair";

type Args = {
  address: string | null;
  apply: boolean;
  includeReview: boolean;
  limit: number;
  json: boolean;
};

function databaseUrlFromEnvironment(): string {
  try {
    return loadConfig().databaseUrl;
  } catch (error) {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    throw error;
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = { address: null, apply: false, includeReview: false, limit: 200, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--include-review") {
      args.includeReview = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--address") {
      args.address = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--limit") {
      args.limit = Number(argv[index + 1] ?? args.limit);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) throw new Error("--limit must be a positive number");
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const db = createDb(databaseUrlFromEnvironment());
  try {
    const result = await repairInvalidCompleteTargetedIndexStates(db, {
      address: args.address,
      apply: args.apply,
      includeReview: args.includeReview,
      limit: args.limit
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${args.apply ? "Applied" : "Dry run"} targeted index repair`);
      console.log(`Candidates: ${result.candidates.length}`);
      console.log(`Repaired: ${result.repaired.length}`);
      for (const candidate of result.candidates) {
        console.log([
          candidate.action.toUpperCase(),
          candidate.address,
          candidate.targetTimestamp?.toISOString() ?? candidate.targetTimestampMs,
          `pages=${candidate.pages}`,
          `capped=${candidate.cappedPages}`,
          `budget=${candidate.budgetPages}->${candidate.repairBudgetPages ?? "-"}`,
          `attempts=${candidate.attemptCount}/${candidate.maxAttempts}->${candidate.repairMaxAttempts ?? "-"}`,
          `reasons=${candidate.reasons.join(",")}`
        ].join(" "));
      }
    }
  } finally {
    await closeDb(db);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
