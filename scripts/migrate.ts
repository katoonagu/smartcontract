import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";
import {
  SCHEMA_032_VERSION,
  applyVerifiedTrackedMigration
} from "../src/storage/schemaMigrations";
import {
  buildSchema032MigrationSessionIdentitySha256,
  observeSchema032MigrationSessionIdentity
} from "../src/release/schema032MigrationIdentity";

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

const expectedSessionIdentitySha256 = process.env.SCHEMA_032_RELEASE_EXPECTED_SESSION_IDENTITY_SHA256;
const expectedSessionEndpoint = process.env.SCHEMA_032_RELEASE_EXPECTED_ENDPOINT;
if ((expectedSessionIdentitySha256 === undefined) !== (expectedSessionEndpoint === undefined)) {
  throw new Error("schema_032_sequence_migration_child_identity_invalid");
}

async function assertReleaseSessionIdentity(): Promise<void> {
  if (expectedSessionIdentitySha256 === undefined || expectedSessionEndpoint === undefined) return;
  if (!/^[0-9a-f]{64}$/u.test(expectedSessionIdentitySha256)) {
    throw new Error("schema_032_sequence_migration_child_identity_invalid");
  }
  const observed = await observeSchema032MigrationSessionIdentity(client, expectedSessionEndpoint);
  if (buildSchema032MigrationSessionIdentitySha256(observed.identity) !== expectedSessionIdentitySha256) {
    throw new Error("schema_032_sequence_migration_child_identity_mismatch");
  }
}

await client.connect();

try {
  await assertReleaseSessionIdentity();
  let requiredSchema032Checksum: string | undefined;
  for (const migrationFile of migrationFiles) {
    const migrationPath = new URL(`../migrations/${migrationFile}`, import.meta.url);
    const versionText = /^(\d+)_/.exec(migrationFile)?.[1];
    if (versionText === undefined) throw new Error(`invalid_migration_filename:${migrationFile}`);
    const version = Number.parseInt(versionText, 10);
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
      requiredSchema032Checksum
    });
    if (version === SCHEMA_032_VERSION) requiredSchema032Checksum = verification.checksumSha256;
    const action = verification.status === "applied" ? "applied and verified" : "already verified";
    console.log(
      `Migration ${action}: migrations/${migrationFile} (schema ${verification.version} ${verification.shortChecksum})`
    );
  }
  await assertReleaseSessionIdentity();
} finally {
  await client.end();
}
