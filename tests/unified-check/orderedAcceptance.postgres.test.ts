import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  canonicalizeArtifactJson
} from "../../src/forensics/canonicalJson";
import {
  planUnifiedOrderedTasks
} from "../../src/unifiedCheck/plannerRepository";
import {
  completeUnifiedTaskAttempt,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;

const acceptedArtifact = {
  version: "unified-address-history-manifest-v1",
  schemaVersion: 1,
  key: "manifest-key",
  note: "канон"
};

function artifactSha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalizeArtifactJson(value))
    .digest("hex");
}

async function withScenario(
  work: (input: {
    db: pg.PoolClient;
    pool: pg.Pool;
    schema: string;
    transactionHost: UnifiedTransactionalQueryable;
  }) => Promise<void>
): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 4 });
  const db = await pool.connect();
  const schema = `ordered_acceptance_${randomUUID().replaceAll("-", "")}`;
  const transactionHost: UnifiedTransactionalQueryable = {
    query: (sql, values) => pool.query(sql, values as unknown[]),
    async transaction<T>(
      transactionWork: (client: UnifiedQueryable) => Promise<T>
    ): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(`set local search_path to "${schema}"`);
        const result = await transactionWork({
          query: (sql, values) => client.query(sql, values as unknown[])
        });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  };
  try {
    await db.query(`create schema "${schema}"`);
    await db.query(`set search_path to "${schema}"`);
    await db.query(await readFile("migrations/033_unified_wallet_check.sql", "utf8"));
    await db.query(await readFile("migrations/034_unified_check_adaptive_planner.sql", "utf8"));
    await db.query(
      `insert into unified_check_runs (
        id, analysis_key_sha256, subject_address, status, run_purpose,
        side_effect_policy, analysis_manifest_sha256, fairness_owner_id
      ) values (
        'run-1','analysis-1','TSubject','RUNNING','synthetic_test',
        'isolated','analysis-manifest-1','run-1'
      )`
    );
    await work({ db, pool, schema, transactionHost });
  } finally {
    await db.query(`drop schema if exists "${schema}" cascade`);
    db.release();
    await pool.end();
  }
}

async function insertLeasedTask(
  db: pg.PoolClient,
  input: {
    taskId: string;
    attempt?: number;
    ordered?: boolean;
    admitted?: boolean;
    reservedBytes?: number;
  }
): Promise<void> {
  await db.query(
    `insert into unified_check_tasks (
      id, run_id, kind, status, priority_lane, logical_key, attempt,
      lease_owner, lease_token, lease_expires_at, heartbeat_at
    ) values (
      $1, 'run-1', 'address_history', 'LEASED', 'interactive', $1, $2,
      'worker-1', 'lease-1', statement_timestamp() + interval '1 minute',
      statement_timestamp()
    )`,
    [input.taskId, input.attempt ?? 1]
  );
  if (input.ordered === false) return;
  await db.query(
    `insert into unified_check_planner_entries (
      run_id, canonical_sequence, task_id, planner_state,
      admitted_at, reserved_bytes
    ) values (
      'run-1',
      (select count(*) from unified_check_planner_entries),
      $1,
      'planned',
      case when $2 then statement_timestamp() else null end,
      case when $2 then $3 else null end
    )`,
    [input.taskId, input.admitted !== false, input.reservedBytes ?? 4_096]
  );
}

function completionInput(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task-ordered",
    leaseToken: "lease-1",
    attempt: 1,
    attemptId: "attempt-1",
    artifactSha256: artifactSha256(acceptedArtifact),
    acceptedArtifact: {
      kind: "address_history_manifest",
      schemaVersion: "1",
      value: acceptedArtifact
    },
    manifestMaxBytes: 4_096,
    ...overrides
  };
}

postgresDescribe("Unified ordered acceptance", () => {
  it("atomically accepts once and returns the same success after the lease is cleared", async () => {
    await withScenario(async ({ db, transactionHost }) => {
      await insertLeasedTask(db, { taskId: "task-ordered" });
      const canonical = canonicalizeArtifactJson(acceptedArtifact);
      const first = await completeUnifiedTaskAttempt(
        transactionHost,
        completionInput()
      );

      expect(first).toMatchObject({
        id: "task-ordered",
        status: "COMPLETED",
        accepted_attempt_id: "attempt-1",
        lease_token: null
      });
      await expect(db.query(
        `select kind, schema_version, artifact_json
           from unified_check_artifacts
          where sha256 = $1`,
        [artifactSha256(acceptedArtifact)]
      )).resolves.toMatchObject({
        rows: [{
          kind: "address_history_manifest",
          schema_version: "1",
          artifact_json: acceptedArtifact
        }]
      });
      await expect(db.query(
        `select id, task_id, attempt, artifact_sha256
           from unified_check_attempts`
      )).resolves.toMatchObject({
        rows: [{
          id: "attempt-1",
          task_id: "task-ordered",
          attempt: 1,
          artifact_sha256: artifactSha256(acceptedArtifact)
        }]
      });
      await expect(db.query(
        `select planner_state, result_bytes, reserved_bytes,
                ready_at is not null as has_ready_at
           from unified_check_planner_entries
          where task_id = 'task-ordered'`
      )).resolves.toMatchObject({
        rows: [{
          planner_state: "ready",
          result_bytes: String(Buffer.byteLength(canonical, "utf8")),
          reserved_bytes: null,
          has_ready_at: true
        }]
      });

      const retried = await completeUnifiedTaskAttempt(
        transactionHost,
        completionInput({
          leaseToken: "lease-already-cleared",
          attemptId: "fresh-attempt-id"
        })
      );
      expect(retried).toMatchObject({
        id: "task-ordered",
        status: "COMPLETED",
        accepted_attempt_id: "attempt-1"
      });
      const payloadFreeRetry = await completeUnifiedTaskAttempt(
        transactionHost,
        completionInput({
          leaseToken: "lease-already-cleared",
          attemptId: "another-fresh-attempt-id",
          acceptedArtifact: undefined
        })
      );
      expect(payloadFreeRetry).toMatchObject({
        id: "task-ordered",
        status: "COMPLETED",
        accepted_attempt_id: "attempt-1"
      });
      expect((await db.query(
        "select count(*)::int as count from unified_check_attempts"
      )).rows[0]?.count).toBe(1);
      expect((await db.query(
        "select count(*)::int as count from unified_check_artifacts"
      )).rows[0]?.count).toBe(1);

      await expect(completeUnifiedTaskAttempt(
        transactionHost,
        completionInput({
          artifactSha256: "f".repeat(64)
        })
      )).rejects.toThrow("unified_task_acceptance_conflict");
      await expect(completeUnifiedTaskAttempt(
        transactionHost,
        completionInput({
          acceptedArtifact: {
            kind: "address_history_manifest",
            schemaVersion: "1",
            value: { ...acceptedArtifact, note: "different" }
          }
        })
      )).rejects.toThrow("unified_task_acceptance_conflict");
      await expect(completeUnifiedTaskAttempt(
        transactionHost,
        completionInput({ attempt: 2 })
      )).rejects.toThrow("unified_task_acceptance_conflict");
    });
  });

  it("serializes planner attachment behind acceptance and rejects a completed task", async () => {
    await withScenario(async ({ db, pool, schema }) => {
      await insertLeasedTask(db, {
        taskId: "task-race",
        ordered: false
      });
      const hash = artifactSha256(acceptedArtifact);
      await db.query(
        `insert into unified_check_artifacts (
          sha256, created_by_run_id, kind, schema_version, artifact_json
        ) values ($1, 'run-1', 'address_history_manifest', '1', $2::jsonb)`,
        [hash, JSON.stringify(acceptedArtifact)]
      );

      const acceptanceClient = await pool.connect();
      const planningClient = await pool.connect();
      try {
        await acceptanceClient.query("begin");
        await acceptanceClient.query(`set local search_path to "${schema}"`);
        await acceptanceClient.query(
          "select id from unified_check_runs where id = 'run-1' for update"
        );
        let planningLockRequested!: () => void;
        const planningReachedRunLock = new Promise<void>((resolve) => {
          planningLockRequested = resolve;
        });
        const planningHost: UnifiedTransactionalQueryable = {
          query: (sql, values) =>
            planningClient.query(sql, values as unknown[]),
          async transaction<T>(
            work: (client: UnifiedQueryable) => Promise<T>
          ): Promise<T> {
            await planningClient.query("begin");
            await planningClient.query(
              `set local search_path to "${schema}"`
            );
            try {
              const result = await work({
                query(sql, values) {
                  if (
                    sql.includes("from unified_check_runs") &&
                    sql.includes("for update")
                  ) {
                    planningLockRequested();
                  }
                  return planningClient.query(sql, values as unknown[]);
                }
              });
              await planningClient.query("commit");
              return result;
            } catch (error) {
              await planningClient.query("rollback").catch(() => undefined);
              throw error;
            }
          }
        };
        const planning = planUnifiedOrderedTasks(planningHost, {
          runId: "run-1",
          tasks: [{
            taskId: "task-race",
            kind: "address_history",
            logicalKey: "task-race",
            priorityLane: "interactive",
            checkpoint: { version: "race-v1" }
          }]
        });
        await planningReachedRunLock;

        const acceptanceHost: UnifiedTransactionalQueryable = {
          query: (sql, values) =>
            acceptanceClient.query(sql, values as unknown[]),
          transaction: (work) => work({
            query: (sql, values) =>
              acceptanceClient.query(sql, values as unknown[])
          })
        };
        await expect(completeUnifiedTaskAttempt(acceptanceHost, {
          taskId: "task-race",
          leaseToken: "lease-1",
          attempt: 1,
          attemptId: "attempt-race",
          artifactSha256: hash
        })).resolves.toMatchObject({
          status: "COMPLETED",
          accepted_attempt_id: "attempt-race"
        });
        await acceptanceClient.query("commit");

        await expect(planning).rejects.toThrow(
          "unified_planner_task_not_plannable"
        );
        await expect(db.query(
          `select task.status, task.accepted_attempt_id,
                  planner.planner_state
             from unified_check_tasks task
             left join unified_check_planner_entries planner
               on planner.run_id = task.run_id and planner.task_id = task.id
            where task.id = 'task-race'`
        )).resolves.toMatchObject({
          rows: [{
            status: "COMPLETED",
            accepted_attempt_id: "attempt-race",
            planner_state: null
          }]
        });
      } catch (error) {
        await acceptanceClient.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        acceptanceClient.release();
        planningClient.release();
      }
    });
  });

  it("rejects planning-first attachment to a leased task and lets its worker finish independently", async () => {
    await withScenario(async ({ db, pool, schema }) => {
      await insertLeasedTask(db, {
        taskId: "task-planning-first",
        ordered: false
      });
      const hash = artifactSha256(acceptedArtifact);
      await db.query(
        `insert into unified_check_artifacts (
          sha256, created_by_run_id, kind, schema_version, artifact_json
        ) values ($1, 'run-1', 'address_history_manifest', '1', $2::jsonb)`,
        [hash, JSON.stringify(acceptedArtifact)]
      );

      const planningClient = await pool.connect();
      const acceptanceClient = await pool.connect();
      let releasePlanning!: () => void;
      const planningMayContinue = new Promise<void>((resolve) => {
        releasePlanning = resolve;
      });
      let planningAtGuard!: () => void;
      const planningReachedGuard = new Promise<void>((resolve) => {
        planningAtGuard = resolve;
      });
      let acceptanceAtRunLock!: () => void;
      const acceptanceRequestedRunLock = new Promise<void>((resolve) => {
        acceptanceAtRunLock = resolve;
      });
      try {
        const planningHost: UnifiedTransactionalQueryable = {
          query: (sql, values) =>
            planningClient.query(sql, values as unknown[]),
          async transaction<T>(
            work: (client: UnifiedQueryable) => Promise<T>
          ): Promise<T> {
            await planningClient.query("begin");
            await planningClient.query(
              `set local search_path to "${schema}"`
            );
            try {
              const result = await work({
                async query(sql, values) {
                  if (
                    sql.includes("select canonical_sequence") &&
                    sql.includes("from unified_check_planner_entries")
                  ) {
                    planningAtGuard();
                    await planningMayContinue;
                  }
                  return planningClient.query(sql, values as unknown[]);
                }
              });
              await planningClient.query("commit");
              return result;
            } catch (error) {
              await planningClient.query("rollback").catch(() => undefined);
              throw error;
            }
          }
        };
        const planning = planUnifiedOrderedTasks(planningHost, {
          runId: "run-1",
          tasks: [{
            taskId: "task-planning-first",
            kind: "address_history",
            logicalKey: "task-planning-first",
            priorityLane: "interactive",
            checkpoint: { version: "planning-first-race-v1" }
          }]
        });
        await planningReachedGuard;

        const acceptanceHost: UnifiedTransactionalQueryable = {
          query: (sql, values) =>
            acceptanceClient.query(sql, values as unknown[]),
          async transaction<T>(
            work: (client: UnifiedQueryable) => Promise<T>
          ): Promise<T> {
            await acceptanceClient.query("begin");
            await acceptanceClient.query(
              `set local search_path to "${schema}"`
            );
            try {
              const result = await work({
                query(sql, values) {
                  if (
                    sql.includes("from unified_check_runs") &&
                    sql.includes("for update")
                  ) {
                    acceptanceAtRunLock();
                  }
                  return acceptanceClient.query(sql, values as unknown[]);
                }
              });
              await acceptanceClient.query("commit");
              return result;
            } catch (error) {
              await acceptanceClient.query("rollback").catch(() => undefined);
              throw error;
            }
          }
        };
        const completion = completeUnifiedTaskAttempt(acceptanceHost, {
          taskId: "task-planning-first",
          leaseToken: "lease-1",
          attempt: 1,
          attemptId: "attempt-planning-first",
          artifactSha256: hash
        });
        await acceptanceRequestedRunLock;
        releasePlanning();

        await expect(planning).rejects.toThrow(
          "unified_planner_task_not_plannable"
        );
        await expect(completion).resolves.toMatchObject({
          status: "COMPLETED",
          accepted_attempt_id: "attempt-planning-first"
        });
        await expect(db.query(
          `select task.status, task.accepted_attempt_id,
                  planner.planner_state
             from unified_check_tasks task
             left join unified_check_planner_entries planner
               on planner.run_id = task.run_id and planner.task_id = task.id
            where task.id = 'task-planning-first'`
        )).resolves.toMatchObject({
          rows: [{
            status: "COMPLETED",
            accepted_attempt_id: "attempt-planning-first",
            planner_state: null
          }]
        });
      } finally {
        releasePlanning();
        planningClient.release();
        acceptanceClient.release();
      }
    });
  });

  it("rolls back artifact, attempt, task and planner when the ready transition fails", async () => {
    await withScenario(async ({ db, transactionHost }) => {
      await insertLeasedTask(db, {
        taskId: "task-ordered",
        reservedBytes: 777
      });
      await db.query(`
        create function reject_ordered_ready() returns trigger
        language plpgsql as $$
        begin
          if new.planner_state = 'ready' then
            raise exception 'injected_planner_ready_failure';
          end if;
          return new;
        end
        $$
      `);
      await db.query(`
        create trigger reject_ordered_ready
        before update on unified_check_planner_entries
        for each row execute function reject_ordered_ready()
      `);

      await expect(completeUnifiedTaskAttempt(
        transactionHost,
        completionInput()
      )).rejects.toThrow("injected_planner_ready_failure");

      expect((await db.query(
        "select count(*)::int as count from unified_check_artifacts"
      )).rows[0]?.count).toBe(0);
      expect((await db.query(
        "select count(*)::int as count from unified_check_attempts"
      )).rows[0]?.count).toBe(0);
      await expect(db.query(
        `select status, accepted_attempt_id, lease_token
           from unified_check_tasks where id = 'task-ordered'`
      )).resolves.toMatchObject({
        rows: [{
          status: "LEASED",
          accepted_attempt_id: null,
          lease_token: "lease-1"
        }]
      });
      await expect(db.query(
        `select planner_state, result_bytes, reserved_bytes, ready_at
           from unified_check_planner_entries
          where task_id = 'task-ordered'`
      )).resolves.toMatchObject({
        rows: [{
          planner_state: "planned",
          result_bytes: null,
          reserved_bytes: "777",
          ready_at: null
        }]
      });
    });
  });

  it("rejects hash mismatch, hard-limit overflow and a missing ordered artifact without mutation", async () => {
    await withScenario(async ({ db, transactionHost }) => {
      for (const taskId of ["hash-task", "large-task", "missing-task"]) {
        await insertLeasedTask(db, { taskId });
      }

      await expect(completeUnifiedTaskAttempt(
        transactionHost,
        completionInput({
          taskId: "hash-task",
          artifactSha256: "0".repeat(64)
        })
      )).rejects.toThrow("unified_artifact_hash_mismatch");
      const canonicalBytes = Buffer.byteLength(
        canonicalizeArtifactJson(acceptedArtifact),
        "utf8"
      );
      await expect(completeUnifiedTaskAttempt(
        transactionHost,
        completionInput({
          taskId: "large-task",
          manifestMaxBytes: canonicalBytes - 1
        })
      )).rejects.toThrow("unified_ordered_manifest_hard_limit");
      await expect(completeUnifiedTaskAttempt(
        transactionHost,
        completionInput({
          taskId: "missing-task",
          acceptedArtifact: undefined
        })
      )).rejects.toThrow("unified_ordered_artifact_required");

      expect((await db.query(
        "select count(*)::int as count from unified_check_artifacts"
      )).rows[0]?.count).toBe(0);
      expect((await db.query(
        "select count(*)::int as count from unified_check_attempts"
      )).rows[0]?.count).toBe(0);
      await expect(db.query(
        `select task.status, task.accepted_attempt_id,
                planner.planner_state, planner.reserved_bytes
           from unified_check_tasks task
           join unified_check_planner_entries planner
             on planner.task_id = task.id
          order by task.id`
      )).resolves.toMatchObject({
        rows: Array.from({ length: 3 }, () => ({
          status: "LEASED",
          accepted_attempt_id: null,
          planner_state: "planned",
          reserved_bytes: "4096"
        }))
      });
    });
  });

  it("preserves existing independent completion and accepts a supplied final artifact", async () => {
    await withScenario(async ({ db, transactionHost }) => {
      await insertLeasedTask(db, {
        taskId: "task-independent",
        ordered: false
      });
      const hash = artifactSha256(acceptedArtifact);
      await db.query(
        `insert into unified_check_artifacts (
          sha256, created_by_run_id, kind, schema_version, artifact_json
        ) values ($1, 'run-1', 'address_history_manifest', '1', $2::jsonb)`,
        [hash, JSON.stringify(acceptedArtifact)]
      );

      await expect(completeUnifiedTaskAttempt(transactionHost, {
        taskId: "task-independent",
        leaseToken: "lease-1",
        attempt: 1,
        attemptId: "attempt-independent",
        artifactSha256: hash
      })).resolves.toMatchObject({
        id: "task-independent",
        status: "COMPLETED",
        accepted_attempt_id: "attempt-independent"
      });

      await insertLeasedTask(db, {
        taskId: "task-independent-supplied",
        ordered: false
      });
      const supplied = { ...acceptedArtifact, note: "supplied at acceptance" };
      const suppliedHash = artifactSha256(supplied);
      await expect(completeUnifiedTaskAttempt(transactionHost, {
        taskId: "task-independent-supplied",
        leaseToken: "lease-1",
        attempt: 1,
        attemptId: "attempt-independent-supplied",
        artifactSha256: suppliedHash,
        acceptedArtifact: {
          kind: "address_history_manifest",
          schemaVersion: "1",
          value: supplied
        }
      })).resolves.toMatchObject({
        id: "task-independent-supplied",
        status: "COMPLETED",
        accepted_attempt_id: "attempt-independent-supplied"
      });
      await expect(db.query(
        `select kind, schema_version, artifact_json
           from unified_check_artifacts where sha256 = $1`,
        [suppliedHash]
      )).resolves.toMatchObject({
        rows: [{
          kind: "address_history_manifest",
          schema_version: "1",
          artifact_json: supplied
        }]
      });
    });
  });
});
