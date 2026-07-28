import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";
import {
  SCHEMA_032_VERSION,
  SCHEMA_033_VERSION,
  SCHEMA_034_VERSION,
  SCHEMA_035_VERSION,
  SCHEMA_036_VERSION,
  SCHEMA_037_VERSION,
  applyVerifiedTrackedMigration
} from "../src/storage/schemaMigrations";

const databaseUrl = process.env.DATABASE_URL;
const migrationsDir = new URL("../migrations/", import.meta.url);
const maximumVersionText = process.env.SCHEMA_MIGRATION_MAX_VERSION;
const maximumVersion = maximumVersionText === undefined
  ? Number.POSITIVE_INFINITY
  : Number.parseInt(maximumVersionText, 10);
const verifyLatestSchemaLineage = maximumVersion >= SCHEMA_037_VERSION;
let migrationFiles: string[];

if (
  maximumVersionText !== undefined &&
  (!/^\d+$/u.test(maximumVersionText) || !Number.isSafeInteger(maximumVersion) || maximumVersion < SCHEMA_032_VERSION)
) {
  throw new Error("schema_migration_max_version_invalid");
}

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
  let requiredSchema033Checksum: string | undefined;
  let requiredSchema034Checksum: string | undefined;
  let requiredSchema035Checksum: string | undefined;
  let requiredSchema036Checksum: string | undefined;
  for (const migrationFile of migrationFiles) {
    const migrationPath = new URL(`../migrations/${migrationFile}`, import.meta.url);
    const versionText = /^(\d+)_/.exec(migrationFile)?.[1];
    if (versionText === undefined) throw new Error(`invalid_migration_filename:${migrationFile}`);
    const version = Number.parseInt(versionText, 10);
    if (version > maximumVersion) continue;
    if (version < SCHEMA_032_VERSION) {
      const sql = await readFile(migrationPath, "utf8");
      await client.query(sql);
      console.log(`Migration applied: migrations/${migrationFile}`);
      continue;
    }
    const verification = await applyVerifiedTrackedMigration(client, {
      version,
      filename: migrationFile,
      migrationBytes: await readFile(migrationPath),
      requiredSchema032Checksum,
      requiredSchema033Checksum,
      requiredSchema034Checksum,
      requiredSchema035Checksum,
      requiredSchema036Checksum,
      allowNewerReceipt: verifyLatestSchemaLineage,
      allowSchema035Additions: verifyLatestSchemaLineage,
      allowSchema036Projection: verifyLatestSchemaLineage,
      allowSchema037Projection: verifyLatestSchemaLineage
    });
    if (version === SCHEMA_032_VERSION) requiredSchema032Checksum = verification.checksumSha256;
    if (version === SCHEMA_033_VERSION) requiredSchema033Checksum = verification.checksumSha256;
    if (version === SCHEMA_034_VERSION) requiredSchema034Checksum = verification.checksumSha256;
    if (version === SCHEMA_035_VERSION) requiredSchema035Checksum = verification.checksumSha256;
    if (version === SCHEMA_036_VERSION) requiredSchema036Checksum = verification.checksumSha256;
    const action = verification.status === "applied" ? "applied and verified" : "already verified";
    console.log(
      `Migration ${action}: migrations/${migrationFile} (schema ${verification.version} ${verification.shortChecksum})`
    );
  }
} finally {
  await client.end();
}
