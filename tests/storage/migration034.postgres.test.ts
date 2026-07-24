import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  REQUIRED_SCHEMA_FILENAME,
  REQUIRED_SCHEMA_VERSION,
  SCHEMA_032_FILENAME,
  SCHEMA_033_FILENAME,
  SCHEMA_034_FILENAME,
  verifyRequiredSchema034,
  verifySchema034Structure,
  applyVerifiedMigration032,
  applyVerifiedTrackedMigration,
  checksumMigrationBytes
} from "../../src/storage/schemaMigrations";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;

async function installApprovalBaseline(client: pg.PoolClient): Promise<void> {
  await client.query("create table watched_wallets (id text primary key, address text not null)");
  await client.query(readFileSync("migrations/006_approval_guard.sql", "utf8"));
}

postgresDescribe("migration 034 PostgreSQL acceptance", () => {
  it("applies after the tracked 032/033 receipt chain and enforces the adaptive planner", async () => {
    expect(REQUIRED_SCHEMA_VERSION).toBe(34);
    expect(REQUIRED_SCHEMA_FILENAME).toBe("034_unified_check_adaptive_planner.sql");

    const pool = new pg.Pool({ connectionString });
    const client = await pool.connect();
    const schema = `unified034_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await installApprovalBaseline(client);

      const migration032Bytes = readFileSync(`migrations/${SCHEMA_032_FILENAME}`);
      const schema032Checksum = await checksumMigrationBytes(migration032Bytes);
      await applyVerifiedMigration032(client, { migrationBytes: migration032Bytes, schemaName: schema });
      const migration033Bytes = readFileSync(`migrations/${SCHEMA_033_FILENAME}`);
      const schema033Checksum = await checksumMigrationBytes(migration033Bytes);
      await applyVerifiedTrackedMigration(client, {
        version: 33,
        filename: SCHEMA_033_FILENAME,
        migrationBytes: migration033Bytes,
        requiredSchema032Checksum: schema032Checksum,
        schemaName: schema
      });
      await client.query(`insert into unified_check_runs (
        id, analysis_key_sha256, subject_address, status, run_purpose, side_effect_policy, analysis_manifest_sha256
      ) values ('run-a', $1, 'TA', 'RUNNING', 'synthetic_test', 'isolated', $2),
        ('run-b', $3, 'TB', 'RUNNING', 'synthetic_test', 'isolated', $4)`,
      ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)]);
      await client.query(`insert into unified_check_tasks (id, run_id, kind, status, priority_lane)
        values ('task-a', 'run-a', 'planner-a', 'QUEUED', 'interactive'),
          ('task-b', 'run-b', 'planner-b', 'QUEUED', 'interactive')`);
      const migration034Bytes = readFileSync(`migrations/${SCHEMA_034_FILENAME}`);
      await applyVerifiedTrackedMigration(client, {
        version: 34,
        filename: SCHEMA_034_FILENAME,
        migrationBytes: migration034Bytes,
        requiredSchema032Checksum: schema032Checksum,
        requiredSchema033Checksum: schema033Checksum,
        schemaName: schema
      });
      const schema034Checksum = await checksumMigrationBytes(migration034Bytes);
      await expect(verifyRequiredSchema034(
        client,
        schema034Checksum,
        schema032Checksum,
        schema033Checksum,
        { schemaName: schema }
      )).resolves.toMatchObject({
        version: 34,
        filename: SCHEMA_034_FILENAME,
        schema032ChecksumSha256: schema032Checksum,
        schema033ChecksumSha256: schema033Checksum
      });
      await expect(verifySchema034Structure(client, { schemaName: schema })).resolves.toBeUndefined();
      await expect(client.query("select id, fairness_owner_id from unified_check_runs order by id")).resolves.toMatchObject({
        rows: [{ id: "run-a", fairness_owner_id: "run-a" }, { id: "run-b", fairness_owner_id: "run-b" }]
      });

      const columns = await client.query(`select column_name from information_schema.columns
        where table_schema = $1 and table_name = 'unified_check_planner_entries'
        order by ordinal_position`, [schema]);
      expect(columns.rows.map((row) => row.column_name)).toEqual([
        "run_id", "canonical_sequence", "task_id", "planner_state", "result_bytes",
        "admitted_at", "reserved_bytes", "planned_at", "ready_at", "committed_at"
      ]);
      const catalogs = await client.query(`select c.conname as constraint_name, i.relname as index_name
        from pg_class t
        join pg_namespace n on n.oid = t.relnamespace
        left join pg_constraint c on c.conrelid = t.oid
        left join pg_index x on x.indrelid = t.oid
        left join pg_class i on i.oid = x.indexrelid
        where n.nspname = $1 and t.relname = 'unified_check_planner_entries'`, [schema]);
      const names = JSON.stringify(catalogs.rows);
      expect(names).toContain("unified_check_planner_entries_run_task_fk");
      expect(names).toContain("unified_check_planner_entries_state_shape_check");
      expect(names).toContain("unified_check_planner_entries_timestamp_order_check");
      expect(names).toContain("unified_check_planner_entries_next_uncommitted_idx");
      expect(names).toContain("unified_check_planner_entries_ready_prefix_idx");
      expect(names).toContain("unified_check_planner_entries_admitted_task_idx");
      expect(names).toContain("unified_check_planner_entries_buffer_aggregate_idx");
      await client.query(`insert into unified_check_planner_entries
        (run_id, canonical_sequence, task_id, planner_state)
        values ('run-a', 0, 'task-a', 'planned')`);
      await expect(client.query(`insert into unified_check_planner_entries
        (run_id, canonical_sequence, task_id, planner_state)
        values ('run-a', 1, 'task-b', 'planned')`)).rejects.toThrow();
      await client.query(`insert into unified_check_tasks (id, run_id, kind, status, priority_lane)
        values ('task-c', 'run-a', 'planner-c', 'QUEUED', 'interactive')`);
      await expect(client.query(`insert into unified_check_planner_entries
        (run_id, canonical_sequence, task_id, planner_state, reserved_bytes)
        values ('run-a', 1, 'task-c', 'planned', 1)`)).rejects.toThrow();
      await expect(client.query(
        "update unified_check_runs set fairness_owner_id = '   ' where id = 'run-a'"
      )).rejects.toThrow();
      await expect(client.query(`insert into unified_check_planner_entries
        (run_id, canonical_sequence, task_id, planner_state, admitted_at, planned_at)
        values ('run-a', 1, 'task-c', 'ready', '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')`)).rejects.toThrow();
    } finally {
      await client.query("reset search_path").catch(() => undefined);
      await client.query(`drop schema if exists "${schema}" cascade`).catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
