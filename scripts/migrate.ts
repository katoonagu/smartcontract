import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

const migrationPath = new URL("../migrations/001_init.sql", import.meta.url);
const sql = await readFile(migrationPath, "utf8");
const client = new Client({ connectionString: databaseUrl });

await client.connect();

try {
  await client.query(sql);
  console.log("Migration applied: migrations/001_init.sql");
} finally {
  await client.end();
}
