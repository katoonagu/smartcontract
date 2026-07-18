import pg from "pg";
import { expect, it } from "vitest";
import { buildReleaseManifestV2Fixture } from "../fixtures/release/remediationReleaseFixtures";

const required = process.env.REQUIRE_PLAN5_POSTGRES === "1";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (required && !databaseUrl) throw new Error("Plan 5 Task 8B PostgreSQL acceptance requires TEST_DATABASE_URL");
const postgresIt = required ? it : it.skip;

async function loadStoreApi(): Promise<any> {
  const modulePath: string = "../../src/release/releaseManifestStoreV2";
  try { return await import(/* @vite-ignore */ modulePath); }
  catch (error) { throw new Error("Plan 5 feature missing: PostgreSQL manifest v2 CAS store", { cause: error }); }
}

postgresIt("[REQ-38][TASK8B-PG-RED] runs the frozen PostgreSQL RED case on an exact disposable non-production database with required execution report hash and cleanup", async () => {
  const url = new URL(databaseUrl!);
  expect(url.hostname).toBe("127.0.0.1");
  expect(Number(url.port)).not.toBe(55999);
  expect(decodeURIComponent(url.pathname.slice(1))).toBe("tron_watch_plan5_task8b_red");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const identity = await client.query<{ database_name: string }>(
      "select current_database()::text as database_name"
    );
    expect(identity.rows).toEqual([{ database_name: "tron_watch_plan5_task8b_red" }]);
    await client.query("begin");
    const api = await loadStoreApi();
    const source = buildReleaseManifestV2Fixture();
    const result = await api.persistPostgresManifestTransitionV2(client, {
      releaseGenerationId: source.releaseGenerationId,
      sourceRevision: source.revision,
      sourceManifestSha256: "8".repeat(64),
      targetManifest: { ...source, revision: 2, transitionId: "readiness" },
      evaluatedAt: "2026-07-18T10:05:00.000Z"
    });
    expect(result.revision).toBe(2);
    await client.query("rollback");
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
});
