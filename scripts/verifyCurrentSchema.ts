import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import {
  SCHEMA_032_FILENAME,
  SCHEMA_033_FILENAME,
  SCHEMA_034_FILENAME,
  SCHEMA_035_FILENAME,
  SCHEMA_036_FILENAME,
  checksumMigrationBytes,
  verifyRequiredSchema036
} from "../src/storage/schemaMigrations";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

async function checksum(filename: string): Promise<string> {
  return checksumMigrationBytes(await readFile(
    new URL(`../migrations/${filename}`, import.meta.url)
  ));
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const verification = await verifyRequiredSchema036(
    client,
    await checksum(SCHEMA_036_FILENAME),
    await checksum(SCHEMA_032_FILENAME),
    await checksum(SCHEMA_033_FILENAME),
    await checksum(SCHEMA_034_FILENAME),
    await checksum(SCHEMA_035_FILENAME)
  );
  process.stdout.write(
    `Schema ${verification.version} verified (${verification.shortChecksum})\n`
  );
} finally {
  await client.end();
}
