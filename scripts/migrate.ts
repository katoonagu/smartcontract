import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";

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
  for (const migrationFile of migrationFiles) {
    const migrationPath = new URL(`../migrations/${migrationFile}`, import.meta.url);
    const sql = await readFile(migrationPath, "utf8");
    await client.query(sql);
    console.log(`Migration applied: migrations/${migrationFile}`);
  }
} finally {
  await client.end();
}
