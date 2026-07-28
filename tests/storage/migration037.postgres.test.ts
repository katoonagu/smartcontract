import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  SCHEMA_032_FILENAME,
  SCHEMA_033_FILENAME,
  SCHEMA_034_FILENAME,
  SCHEMA_035_FILENAME,
  SCHEMA_036_FILENAME,
  SCHEMA_037_FILENAME,
  applyVerifiedMigration032,
  applyVerifiedTrackedMigration,
  checksumMigrationBytes,
  verifyRequiredSchema037
} from "../../src/storage/schemaMigrations";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;

postgresDescribe("migration 037 PostgreSQL acceptance", () => {
  it("upgrades 036, verifies 032→037 lineage, and keeps failed request audit links", async () => {
    const pool = new pg.Pool({ connectionString });
    const client = await pool.connect();
    const schema = `unified037_${randomUUID().replaceAll("-", "")}`;
    const files = [
      SCHEMA_032_FILENAME,
      SCHEMA_033_FILENAME,
      SCHEMA_034_FILENAME,
      SCHEMA_035_FILENAME,
      SCHEMA_036_FILENAME,
      SCHEMA_037_FILENAME
    ] as const;
    const bytes = new Map(files.map((file) => [
      file,
      readFileSync(`migrations/${file}`)
    ]));
    const checksums = new Map<string, string>();
    try {
      for (const file of files) {
        checksums.set(file, await checksumMigrationBytes(bytes.get(file)!));
      }
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await client.query(
        "create table watched_wallets (id text primary key, address text not null)"
      );
      await client.query(readFileSync("migrations/006_approval_guard.sql", "utf8"));

      await applyVerifiedMigration032(client, {
        migrationBytes: bytes.get(SCHEMA_032_FILENAME)!,
        schemaName: schema
      });
      for (const [version, file] of [
        [33, SCHEMA_033_FILENAME],
        [34, SCHEMA_034_FILENAME],
        [35, SCHEMA_035_FILENAME],
        [36, SCHEMA_036_FILENAME],
        [37, SCHEMA_037_FILENAME]
      ] as const) {
        await applyVerifiedTrackedMigration(client, {
          version,
          filename: file,
          migrationBytes: bytes.get(file)!,
          requiredSchema032Checksum: checksums.get(SCHEMA_032_FILENAME),
          requiredSchema033Checksum: checksums.get(SCHEMA_033_FILENAME),
          requiredSchema034Checksum: checksums.get(SCHEMA_034_FILENAME),
          requiredSchema035Checksum: checksums.get(SCHEMA_035_FILENAME),
          requiredSchema036Checksum: checksums.get(SCHEMA_036_FILENAME),
          schemaName: schema
        });
      }

      await expect(verifyRequiredSchema037(
        client,
        checksums.get(SCHEMA_037_FILENAME)!,
        checksums.get(SCHEMA_032_FILENAME)!,
        checksums.get(SCHEMA_033_FILENAME)!,
        checksums.get(SCHEMA_034_FILENAME)!,
        checksums.get(SCHEMA_035_FILENAME)!,
        checksums.get(SCHEMA_036_FILENAME)!,
        { schemaName: schema }
      )).resolves.toMatchObject({ version: 37 });
      await expect(applyVerifiedTrackedMigration(client, {
        version: 37,
        filename: SCHEMA_037_FILENAME,
        migrationBytes: bytes.get(SCHEMA_037_FILENAME)!,
        requiredSchema032Checksum: checksums.get(SCHEMA_032_FILENAME),
        requiredSchema033Checksum: checksums.get(SCHEMA_033_FILENAME),
        requiredSchema034Checksum: checksums.get(SCHEMA_034_FILENAME),
        requiredSchema035Checksum: checksums.get(SCHEMA_035_FILENAME),
        requiredSchema036Checksum: checksums.get(SCHEMA_036_FILENAME),
        schemaName: schema
      })).resolves.toMatchObject({ status: "already_verified" });

      await client.query(`insert into unified_check_runs (
        id, analysis_key_sha256, subject_address, status, run_purpose,
        side_effect_policy, analysis_manifest_sha256, fairness_owner_id,
        rollout_stage, rollout_bucket, admission_policy,
        provider_capacity_ceiling
      ) values ('run-1',$1,'TEFjfSWdhHxzchgveQqFteiz1XhUcHFn52','RUNNING',
        'user_check','authoritative',$2,'run-1','global_barrier',null,'barrier',1)`, [
        "a".repeat(64),
        "b".repeat(64)
      ]);
      await client.query(`insert into unified_check_requests (
        id, request_correlation_id, run_id, subject_address, chat_id, locale,
        run_purpose, side_effect_policy, status, accepted_at
      ) values ('request-1','correlation-1','run-1',
        'TEFjfSWdhHxzchgveQqFteiz1XhUcHFn52','1','ru','user_check',
        'authoritative','ATTACHED',now())`);
      await expect(client.query(
        `update unified_check_requests
            set status='FAILED_TECHNICAL',
                status_reason='runtime_handoff_unavailable'
          where id='request-1'`
      )).resolves.toMatchObject({ rowCount: 1 });

      await client.query(`insert into unified_runtime_instances (
        instance_id,runtime_commit,instance_label,state,started_at,heartbeat_at
      ) values ('runtime-1',$1,'first-aaaaaaaa','ACTIVE',now(),now())`, [
        "a".repeat(40)
      ]);
      await expect(client.query(`insert into unified_runtime_instances (
        instance_id,runtime_commit,instance_label,state,started_at,heartbeat_at
      ) values ('runtime-2',$1,'second-bbbbbbbb','ACTIVE',now(),now())`, [
        "b".repeat(40)
      ])).rejects.toThrow();
    } finally {
      await client.query("reset search_path").catch(() => undefined);
      await client.query(`drop schema if exists "${schema}" cascade`)
        .catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
