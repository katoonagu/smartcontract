import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { runGoldenCaptureCli } from "../tools/golden-capture-v2/cli";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const baseUrl = (
  process.env.TRON_FULLNODE_BASE_URL ?? "https://api.trongrid.io"
).replace(/\/+$/u, "");
const client = new Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10_000,
  query_timeout: 120_000
});

const catalog = JSON.parse(
  await readFile(
    new URL(
      "../docs/audit/2026-07-system-audit/golden-v2/case-catalog.json",
      import.meta.url
    ),
    "utf8"
  )
);
const syntheticCases = JSON.parse(
  await readFile(
    new URL(
      "../tests/fixtures/golden-v2/synthetic-cases.json",
      import.meta.url
    ),
    "utf8"
  )
);

await client.connect();
try {
  process.exitCode = await runGoldenCaptureCli(process.argv.slice(2), {
    db: {
      query: async (text, values = []) =>
        client.query(text, [...values]) as Promise<{
          rows: Array<Record<string, unknown>>;
        }>
    },
    getConfirmedSnapshot: async () => {
      const response = await fetch(`${baseUrl}/walletsolidity/getnowblock`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.TRON_FULLNODE_API_KEY
            ? { "TRON-PRO-API-KEY": process.env.TRON_FULLNODE_API_KEY }
            : {})
        },
        body: "{}"
      });
      if (!response.ok) {
        throw new Error("FAILED_TECHNICAL:golden_capture_provider_failed");
      }
      const rawResponse = (await response.json()) as {
        blockID?: unknown;
        block_header?: {
          raw_data?: { number?: unknown; timestamp?: unknown };
        };
      };
      const number = rawResponse.block_header?.raw_data?.number;
      const timestamp = rawResponse.block_header?.raw_data?.timestamp;
      if (
        typeof rawResponse.blockID !== "string" ||
        !/^[0-9a-fA-F]{64}$/u.test(rawResponse.blockID) ||
        !Number.isSafeInteger(number) ||
        !Number.isSafeInteger(timestamp)
      ) {
        throw new Error("FAILED_TECHNICAL:golden_capture_provider_invalid");
      }
      return {
        snapshot: {
          confirmedBlockNumber: String(number),
          confirmedBlockHash: rawResponse.blockID.toLowerCase(),
          timestamp: new Date(timestamp as number).toISOString()
        },
        rawResponse
      };
    },
    catalog,
    syntheticCases,
    stdout: process.stdout,
    stderr: process.stderr
  });
} finally {
  await client.end();
}
