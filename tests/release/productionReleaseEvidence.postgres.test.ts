import pg from "pg";
import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalReleaseJsonV2 } from "../../src/release/remediationReleaseManifestV2";
import {
  buildExecutedReleaseGateV2Fixture,
  buildReleaseFreezeIdentityV2Fixture,
  buildTask0BReleaseFreezeEvidence,
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
  const artifactRoot = mkdtempSync(join(tmpdir(), "plan5-pg-cas-root-"));
  if (process.platform === "win32") {
    const sid = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { encoding: "utf8" }).trim();
    execFileSync("icacls.exe", [artifactRoot, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  }
  await client.connect();
  try {
    const identity = await client.query<{ database_name: string }>(
      "select current_database()::text as database_name"
    );
    expect(identity.rows).toEqual([{ database_name: "tron_watch_plan5_task8b_red" }]);
    const api = await loadStoreApi();
    const absoluteRoot = resolve(artifactRoot);
    const rootKey = process.platform === "win32" ? absoluteRoot.toLowerCase() : absoluteRoot;
    const task0b = buildTask0BReleaseFreezeEvidence({
      observedAt: "2026-07-18T10:00:00.000Z",
      artifactRootFingerprintSha256: createHash("sha256").update(rootKey, "utf8").digest("hex")
    });
    const freeze = buildReleaseFreezeIdentityV2Fixture(task0b);
    writeFileSync(join(artifactRoot, "task0b-release-freeze.json"),
      `${canonicalReleaseJsonV2(task0b)}\n`, { flag: "wx" });
    await api.materializeReleaseFreezeV2({
      artifactRoot,
      task0BPreflightEvidence: task0b,
      evaluatedAt: "2026-07-18T10:00:00.000Z",
      producerId: "release_freeze_materialize"
    });
    const source = {
      ...buildReleaseManifestV2Fixture(),
      artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
      releaseFreezeIdentitySha256: createHash("sha256")
        .update(`${canonicalReleaseJsonV2(freeze)}\n`, "utf8").digest("hex")
    };
    const sourceBytes = Buffer.from(`${canonicalReleaseJsonV2(source)}\n`, "utf8");
    const sourceManifestSha256 = createHash("sha256").update(sourceBytes).digest("hex");
    const initialized = await api.initializePostgresManifestStateV2(client, {
      artifactRoot,
      sourceManifestBytes: sourceBytes,
      evaluatedAt: "2026-07-18T10:04:00.000Z"
    });
    expect(initialized.sourceSha256).toBe(sourceManifestSha256);
    const storedGeneration = await client.query<{ release_generation_id: string }>(
      "select release_generation_id from plan5_release_manifest_v2_cas"
    );
    expect(storedGeneration.rows).toEqual([{ release_generation_id: freeze.releaseGenerationId }]);
    await expect(api.initializePostgresManifestStateV2(client, {
      artifactRoot,
      releaseGenerationId: "caller-forged-generation",
      sourceManifestBytes: sourceBytes,
      evaluatedAt: "2026-07-18T10:04:00.000Z"
    })).rejects.toThrow(/caller.*generation|generation.*caller|input.*invalid/i);
    const transition = {
      artifactRoot,
      sourceRevision: source.revision,
      sourceManifestSha256,
      transition: {
        transitionId: "readiness",
        evaluatedAt: "2026-07-18T10:05:00.000Z",
        latestCommittedReceiptSha256: "e".repeat(64),
        operationalAttestation: null
      },
      verifiedGateOutputs: [buildExecutedReleaseGateV2Fixture("G05_TELEGRAM")],
      verifiedTransitionEvidence: { refs: [], actualRollbackOutcome: null },
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
    rmSync(artifactRoot, { recursive: true, force: true });
  }
});
