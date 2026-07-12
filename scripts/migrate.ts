import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";
import {
  REQUIRED_SCHEMA_VERSION,
  applyVerifiedTrackedMigration
} from "../src/storage/schemaMigrations";

const databaseUrl = process.env.DATABASE_URL;
const migrationsDir = new URL("../migrations/", import.meta.url);
let migrationFiles: string[];

try {
  migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    console.log("No migrations directory found; nothing to apply.");
    process.exit(0);
  }
  throw error;
}

if (migrationFiles.length === 0) {
  console.log("No migration files found; nothing to apply.");
  process.exit(0);
}

if (!databaseUrl) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

const client = new Client({ connectionString: databaseUrl });

await client.connect();

try {
  let requiredSchema032Checksum: string | undefined;
  for (const migrationFile of migrationFiles) {
    const migrationPath = new URL(`../migrations/${migrationFile}`, import.meta.url);
    const versionText = /^(\d+)_/.exec(migrationFile)?.[1];
    if (versionText === undefined) throw new Error(`invalid_migration_filename:${migrationFile}`);
    const version = Number.parseInt(versionText, 10);
    if (version < REQUIRED_SCHEMA_VERSION) {
      const sql = await readFile(migrationPath, "utf8");
      await client.query(sql);
      console.log(`Migration applied: migrations/${migrationFile}`);
      continue;
    }
    const verification = await applyVerifiedTrackedMigration(client, {
      version,
      filename: migrationFile,
      migrationBytes: await readFile(migrationPath),
      requiredSchema032Checksum
    });
    if (version === REQUIRED_SCHEMA_VERSION) requiredSchema032Checksum = verification.checksumSha256;
    const action = verification.status === "applied" ? "applied and verified" : "already verified";
    console.log(
      `Migration ${action}: migrations/${migrationFile} (schema ${verification.version} ${verification.shortChecksum})`
    );
  }
} finally {
  await client.end();
}
