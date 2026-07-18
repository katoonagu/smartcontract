import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import pg from "pg";
import { buildTerminalLegacyPopulation, cloneFixture } from "../fixtures/release/remediationReleaseFixtures";
import {
  REMEDIATION_COMMAND_TEMPLATE_SHA256,
  REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256
} from "../../src/release/remediationReleaseManifest";

type LegacyApi = { assertTerminalLegacyPopulationUnchanged(before: unknown, after: unknown): void };

const requirePostgres = process.env.REQUIRE_PLAN5_POSTGRES === "1";
const postgresIt = requirePostgres ? it : it.skip;
const LEGACY_FREEZE_BINDING = {
  candidateSha: "c".repeat(40),
  cutoff: "2026-07-18T00:00:00.000Z",
  cutoffSource: "task0b_release_freeze" as const,
  task0bEvidenceSha256: "a".repeat(64),
  databaseRole: "runtime_sanitized" as const,
  databaseName: "tron_watch_plan5_runtime_sanitized" as const,
  databaseFingerprintSha256: "e".repeat(64)
};

it("[REQ-03][REQ-04][PLAN5-LEGACY] rejects changed count ID set result aggregate or sent fingerprints for the terminal legacy cutoff population", async () => {
  const modulePath: string = "../../src/release/terminalLegacyPopulation";
  let api: LegacyApi;
  try {
    const loaded = await import(/* @vite-ignore */ modulePath) as Partial<LegacyApi>;
    if (typeof loaded.assertTerminalLegacyPopulationUnchanged !== "function") throw new Error("validator export missing");
    api = loaded as LegacyApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: terminal legacy population guard", { cause: error });
  }
  const before = buildTerminalLegacyPopulation();
  expect(() => api.assertTerminalLegacyPopulationUnchanged(before, cloneFixture(before))).not.toThrow();
  for (const field of [
    "populationCount",
    "sortedJobIdSetSha256",
    "aggregateImmutableResultSha256",
    "sentFingerprintSetSha256"
  ]) {
    const after: any = cloneFixture(before);
    after[field] = field === "populationCount" ? after[field] + 1 : "f".repeat(64);
    expect(() => api.assertTerminalLegacyPopulationUnchanged(before, after), field).toThrow();
  }
});

postgresIt("[REQ-03][REQ-04][PLAN5-LEGACY-POSTGRES] snapshots every eligible terminal row in one repeatable query", async () => {
  const databaseUrl = process.env.PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL;
  if (!databaseUrl) throw new Error("PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL is required");
  const parsedUrl = new URL(databaseUrl);
  if (decodeURIComponent(parsedUrl.pathname.slice(1)) !== "tron_watch_plan5_runtime_sanitized") {
    throw new Error("Task 6 PostgreSQL test requires the exact sanitized database name");
  }
  const schemaApi = await import("../../scripts/verifySchema032");
  const client = new pg.Client(schemaApi.buildSchema032ClientConfig(databaseUrl, true));
  const schema = `plan5_task6_${process.pid}_${Date.now()}`;
  await client.connect();
  try {
    await client.query(`create schema ${schema}`);
    await client.query("select set_config('search_path', $1, false)", [`${schema},public`]);
    await client.query(`create table forensic_check_jobs (
      id text primary key,
      kind text not null,
      status text not null,
      created_at timestamptz not null,
      completed_at timestamptz,
      progress_json jsonb not null,
      result_json jsonb not null
    )`);
    await client.query(`insert into forensic_check_jobs
      (id, kind, status, created_at, completed_at, progress_json, result_json)
      values
      ('legacy-a', 'address_deep_check', 'completed', '2026-07-17T08:00:00.000Z', '2026-07-17T08:01:00.000Z',
       '{"telegramDelivery":{"state":{"status":"sent","messageFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}',
       '{"decision":"REVIEW"}'),
      ('legacy-b', 'where_is_money_check', 'failed', '2026-07-17T08:30:00.000Z', null, '{}', '{}'),
      ('fresh-current', 'where_is_money_check', 'completed', '2026-07-17T08:40:00.000Z', '2026-07-17T08:41:00.000Z', '{}',
       '{"scoringPolicyVersion":"scoring-signal-matrix-v3"}'),
      ('after-cutoff', 'where_is_money_check', 'completed', '2026-07-18T10:00:00.000Z', '2026-07-18T10:01:00.000Z', '{}', '{}')`);
    const api = await import("../../src/release/terminalLegacyPopulation");
    const result = await api.snapshotTerminalLegacyPopulation(client, LEGACY_FREEZE_BINDING);
    expect(result.populationCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain("legacy-a");
    expect(result.sentFingerprintSetSha256).toMatch(/^[0-9a-f]{64}$/);
  } finally {
    await client.query("reset search_path").catch(() => undefined);
    await client.query(`drop schema if exists ${schema} cascade`).catch(() => undefined);
    await client.end();
  }
});

it("[REQ-03][REQ-04][PLAN5-LEGACY-SNAPSHOT] hashes the complete cutoff population without exposing identities", async () => {
  const api = await import("../../src/release/terminalLegacyPopulation");
  const rows = [
    {
      id: "legacy-job-b",
      kind: "where_is_money_check",
      status: "completed",
      completedAt: "2026-07-17T08:00:00.000Z",
      resultJsonText: "{\"decision\": \"REVIEW\", \"nested\": {\"a\": 1, \"b\": 2}}",
      sentFingerprint: "b".repeat(64)
    },
    {
      id: "legacy-job-a",
      kind: "address_deep_check",
      status: "failed",
      completedAt: null,
      resultJsonText: "{}",
      sentFingerprint: null
    }
  ] as const;
  const options = LEGACY_FREEZE_BINDING;
  const first = api.createTerminalLegacyPopulationSnapshot(rows, options);
  const reordered = api.createTerminalLegacyPopulationSnapshot([...rows].reverse(), options);
  expect(reordered).toEqual(first);
  expect(first.populationCount).toBe(2);
  expect(JSON.stringify(first)).not.toContain("legacy-job-");
  expect(JSON.stringify(first)).not.toContain("where_is_money_check");

  const changed = api.createTerminalLegacyPopulationSnapshot([
    rows[0],
    { ...rows[1], resultJsonText: "{\"decision\": \"DECLINE\"}" }
  ], options);
  expect(changed.sortedJobIdSetSha256).toBe(first.sortedJobIdSetSha256);
  expect(changed.aggregateImmutableResultSha256).not.toBe(first.aggregateImmutableResultSha256);

  const preciseA = api.createTerminalLegacyPopulationSnapshot([
    { ...rows[1], resultJsonText: "{\"value\": 9007199254740992}" }
  ], options);
  const preciseB = api.createTerminalLegacyPopulationSnapshot([
    { ...rows[1], resultJsonText: "{\"value\": 9007199254740993}" }
  ], options);
  expect(preciseA.aggregateImmutableResultSha256).not.toBe(preciseB.aggregateImmutableResultSha256);
});

it("[REQ-03][REQ-04][PLAN5-LEGACY-FREEZE] requires authoritative Task0B cutoff and exact sanitized database binding", async () => {
  const api: any = await import("../../src/release/terminalLegacyPopulation");
  const task0b = {
    version: "task0b-release-freeze-evidence-v1",
    candidateSha: "c".repeat(40),
    observedAt: "2026-07-18T00:00:00.000Z",
    freezeCutoff: "2026-07-18T00:00:00.000Z",
    expiresAt: "2026-07-19T00:00:00.000Z",
    previousRuntimeSha: "a".repeat(40),
    previousRuntimeLabel: "previous-aaaaaaaa",
    databaseRole: "runtime_sanitized",
    databaseName: "tron_watch_plan5_runtime_sanitized",
    databaseFingerprintSha256: "e".repeat(64),
    operationalConfigPath: "runtime-operational-config.json",
    operationalConfigSha256: "8".repeat(64),
    candidateStartCommandId: "runtime_sanitized_rehearsal",
    candidateStartTemplateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256.runtime_sanitized_rehearsal,
    candidateStopCommandId: "runtime_sanitized_stop",
    candidateStopTemplateSha256: REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.runtime_sanitized_stop,
    previousStartCommandId: "rollback_rehearsal",
    previousStartTemplateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256.rollback_rehearsal,
    previousStopCommandId: "rollback_stop",
    previousStopTemplateSha256: REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.rollback_stop
  };
  const task0bBytes = Buffer.from(JSON.stringify(task0b));
  const binding = api.deriveTerminalLegacyFreezeBinding(task0bBytes, "c".repeat(40), task0b.observedAt);
  const snapshot = api.createTerminalLegacyPopulationSnapshot([], binding);
  expect(snapshot.cutoffSource).toBe("task0b_release_freeze");
  expect(snapshot.task0bEvidenceSha256).toBe(createHash("sha256").update(task0bBytes).digest("hex"));
  expect(() => api.createTerminalLegacyPopulationSnapshot([], {
    candidateSha: "c".repeat(40),
    cutoff: task0b.freezeCutoff
  })).toThrow();
  expect(() => api.deriveTerminalLegacyFreezeBinding(
    task0bBytes,
    "b".repeat(40),
    task0b.observedAt
  )).toThrow(/candidate/i);
  expect(() => api.deriveTerminalLegacyFreezeBinding(
    task0bBytes,
    "c".repeat(40),
    "2026-07-19T00:00:00.001Z"
  )).toThrow(/stale/i);
  const unrelated = Buffer.from(JSON.stringify({ ...task0b, databaseName: "tron_watch_plan5_clone" }));
  expect(() => api.deriveTerminalLegacyFreezeBinding(
    unrelated,
    "c".repeat(40),
    task0b.observedAt
  )).toThrow(/database/i);
});

it("[REQ-03][REQ-04][PLAN5-LEGACY-QUERY] performs one unbounded whole-population query at the exact cutoff", async () => {
  const api = await import("../../src/release/terminalLegacyPopulation");
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db = {
    async query(text: string, values: unknown[]) {
      calls.push({ text, values });
      return { rows: [] };
    }
  };
  await api.snapshotTerminalLegacyPopulation(db, LEGACY_FREEZE_BINDING);
  expect(calls).toHaveLength(1);
  expect(calls[0].text).not.toMatch(/\blimit\b|\boffset\b/i);
  expect(calls[0].values).toEqual(["2026-07-18T00:00:00.000Z", "scoring-signal-matrix-v3"]);
});
