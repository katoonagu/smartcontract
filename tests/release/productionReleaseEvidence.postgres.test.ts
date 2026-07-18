import pg from "pg";
import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  RELEASE_V2_FREEZE_IDENTITY,
  buildExecutedReleaseGateV2Fixture,
  buildReleaseManifestV2Fixture
} from "../fixtures/release/remediationReleaseFixtures";

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
    const api = await loadStoreApi();
    const source = buildReleaseManifestV2Fixture();
    const sourceBytes = Buffer.from(`${JSON.stringify(source)}\n`, "utf8");
    const sourceManifestSha256 = createHash("sha256").update(sourceBytes).digest("hex");
    const initialized = await api.initializePostgresManifestStateV2(client, {
      releaseGenerationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
      sourceManifestBytes: sourceBytes,
      evaluatedAt: "2026-07-18T10:04:00.000Z"
    });
    expect(initialized.sourceSha256).toBe(sourceManifestSha256);
    const transition = {
      releaseGenerationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
      sourceRevision: source.revision,
      sourceManifestSha256,
      targetManifest: {
        ...source,
        revision: 2,
        previousManifestSha256: sourceManifestSha256,
        latestCommittedReceiptSha256: "e".repeat(64),
        updatedAt: "2026-07-18T10:05:00.000Z",
        transitionId: "readiness",
        overall: "ready_for_release",
        gates: source.gates.map((gate) => gate.id === "G05_TELEGRAM"
          ? buildExecutedReleaseGateV2Fixture("G05_TELEGRAM") : gate)
      },
      evaluatedAt: "2026-07-18T10:05:00.000Z"
    };
    const concurrent = new pg.Client({ connectionString: databaseUrl });
    await concurrent.connect();
    try {
      const outcomes = await Promise.allSettled([
        api.persistPostgresManifestTransitionV2(client, transition),
        api.persistPostgresManifestTransitionV2(concurrent, transition)
      ]);
      expect(outcomes.filter((value) => value.status === "fulfilled")).toHaveLength(1);
      expect((outcomes.find((value) => value.status === "fulfilled") as PromiseFulfilledResult<any>).value.revision).toBe(2);
      await expect(api.persistPostgresManifestTransitionV2(client, transition)).rejects.toThrow(/cas/i);
    } finally { await concurrent.end(); }
  } finally {
    await client.query("drop table if exists plan5_release_manifest_v2_cas").catch(() => undefined);
    await client.end();
  }
});
