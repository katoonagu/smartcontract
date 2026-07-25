import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import {
  buildAddressHistoryManifest
} from "../../src/unifiedCheck/addressHistory";
import {
  admitBarrierHead,
  planUnifiedOrderedTasks
} from "../../src/unifiedCheck/plannerRepository";
import {
  checkpointUnifiedTask,
  claimUnifiedTask,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
const ANALYSIS_KEY_SHA256 = "a".repeat(64);
const ANALYSIS_MANIFEST_SHA256 = "b".repeat(64);
const OLD_HEAD = "a".repeat(64);
const NEXT_HEAD = "b".repeat(64);

function transactionHost(
  pool: pg.Pool,
  schema: string,
  afterQuery?: (sql: string) => Promise<void>
): UnifiedTransactionalQueryable {
  return {
    query: (sql, values) => pool.query(sql, values as unknown[]),
    async transaction<T>(work: (client: UnifiedQueryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(`set local search_path to "${schema}"`);
        const result = await work({
          query: async (sql, values) => {
            const queryResult = await client.query(sql, values as unknown[]);
            await afterQuery?.(sql);
            return queryResult;
          }
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
}

async function withScenario(
  work: (input: {
    db: pg.PoolClient;
    pool: pg.Pool;
    schema: string;
    host: UnifiedTransactionalQueryable;
  }) => Promise<void>
) {
  const pool = new pg.Pool({ connectionString, max: 4 });
  const db = await pool.connect();
  const schema = `ordered_commit_${randomUUID().replaceAll("-", "")}`;
  try {
    await db.query(`create schema "${schema}"`);
    await db.query(`set search_path to "${schema}"`);
    await db.query(
      await readFile("migrations/033_unified_wallet_check.sql", "utf8")
    );
    await db.query(
      await readFile(
        "migrations/034_unified_check_adaptive_planner.sql",
        "utf8"
      )
    );
    await db.query(
      `insert into unified_check_runs (
         id, analysis_key_sha256, subject_address, status, run_purpose,
         side_effect_policy, analysis_manifest_sha256, fairness_owner_id
       ) values (
         'run-1',$1,'TSubject','RUNNING','synthetic_test',
         'isolated',$2,'owner-1'
       )`,
      [ANALYSIS_KEY_SHA256, ANALYSIS_MANIFEST_SHA256]
    );
    await db.query(
      `insert into unified_check_artifacts (
         sha256, created_by_run_id, kind, schema_version, artifact_json
       ) values (
         $1,'run-1','analysis_manifest','1','{}'::jsonb
       )`,
      [ANALYSIS_MANIFEST_SHA256]
    );
    await work({
      db,
      pool,
      schema,
      host: transactionHost(pool, schema)
    });
  } finally {
    await db.query(`drop schema if exists "${schema}" cascade`);
    db.release();
    await pool.end();
  }
}

async function insertCompletedDirectHistory(db: pg.PoolClient) {
  await db.query(
     `insert into unified_check_tasks (
       id, run_id, kind, status, priority_lane, logical_key
     ) values (
       'direct-1','run-1','direct_history','COMPLETED','interactive','main'
     )`
  );
  await db.query(
    `insert into unified_check_artifacts (
       sha256, created_by_run_id, kind, schema_version, artifact_json
     ) values (
       'artifact-direct-1','run-1','direct_history','1','{}'::jsonb
     )`
  );
  await db.query(
    `insert into unified_check_attempts (
       id, task_id, attempt, artifact_sha256, completed_at
     ) values (
       'attempt-direct-1','direct-1',1,'artifact-direct-1',
       statement_timestamp()
     )`
  );
  await db.query(
    `update unified_check_tasks
        set accepted_attempt_id = 'attempt-direct-1'
      where id = 'direct-1'`
  );
}

async function insertAcceptedHistory(
  db: pg.PoolClient,
  input: {
    sequence: number;
    taskId: string;
    state: "ready" | "planned";
  }
) {
  const addresses = [
    "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9",
    "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP",
    "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy"
  ] as const;
  const artifact = buildAddressHistoryManifest({
    chain: "tron",
    snapshotHash: "b".repeat(64),
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    address: addresses[input.sequence % addresses.length]!,
    providerRequestVersion: "tronscan-related-trc20-v1",
    pageArtifactHashes: [],
    canonicalEventIds: [],
    rawRowCount: 0,
    duplicateCount: 0,
    exhaustion: {
      kind: "account_creation_reached",
      evidenceSha256: "c".repeat(64)
    }
  });
  const artifactSha256 = fingerprintCanonicalArtifact(artifact);
  const resultBytes = Buffer.byteLength(canonicalizeArtifactJson(artifact));
  await db.query(
     `insert into unified_check_tasks (
       id, run_id, kind, status, priority_lane, logical_key
     ) values (
       $1,'run-1','address_history',$2,'interactive',$3
     )`,
    [
      input.taskId,
      input.state === "ready" ? "COMPLETED" : "QUEUED",
      artifact.key
    ]
  );
  if (input.state === "ready") {
    await db.query(
      `insert into unified_check_artifacts (
         sha256, created_by_run_id, kind, schema_version, artifact_json
       ) values ($1,'run-1','address_history_manifest','1',$2::jsonb)`,
      [artifactSha256, JSON.stringify(artifact)]
    );
    await db.query(
      `insert into unified_check_attempts (
         id, task_id, attempt, artifact_sha256, completed_at
       ) values ($1,$2,1,$3,statement_timestamp())`,
      [`attempt-${input.taskId}`, input.taskId, artifactSha256]
    );
    await db.query(
      `update unified_check_tasks
          set accepted_attempt_id = $2
        where id = $1`,
      [input.taskId, `attempt-${input.taskId}`]
    );
  }
  await db.query(
    `insert into unified_check_planner_entries (
       run_id, canonical_sequence, task_id, planner_state, result_bytes,
       admitted_at, reserved_bytes, ready_at
     ) values (
       'run-1',$1,$2,$3,
       case when $3 = 'ready' then $4::bigint else null end,
       case when $3 = 'ready' then statement_timestamp() else null end,
       null,
       case when $3 = 'ready' then statement_timestamp() else null end
     )`,
    [input.sequence, input.taskId, input.state, resultBytes]
  );
  return {
    canonicalSequence: input.sequence,
    taskId: input.taskId,
    logicalKey: artifact.key,
    acceptedAttemptId: `attempt-${input.taskId}`,
    resultBytes,
    taskKind: "address_history",
    artifactKind: "address_history_manifest",
    artifactSchemaVersion: "1"
  };
}

async function setupCommit(db: pg.PoolClient) {
  await db.query(
    `insert into unified_check_tasks (
       id, run_id, kind, status, priority_lane, logical_key, attempt,
       lease_owner, lease_token, lease_expires_at, heartbeat_at,
       checkpoint_json
     ) values (
       'traversal-1','run-1','traversal','LEASED','interactive','main',1,
       'analysis-1','lease-1',statement_timestamp() + interval '1 minute',
       statement_timestamp(),$1::jsonb
     )`,
    [JSON.stringify({
      version: "unified-production-traversal-checkpoint-v2",
      deltaHeadSha256: OLD_HEAD
    })]
  );
  const first = await insertAcceptedHistory(db, {
    sequence: 0,
    taskId: "history-1",
    state: "ready"
  });
  await insertAcceptedHistory(db, {
    sequence: 1,
    taskId: "history-2",
    state: "planned"
  });
  return first;
}

async function replaceNextHeadWithReady(db: pg.PoolClient) {
  await db.query(
    "delete from unified_check_planner_entries where task_id = 'history-2'"
  );
  await db.query("delete from unified_check_tasks where id = 'history-2'");
  return insertAcceptedHistory(db, {
    sequence: 1,
    taskId: "history-ready",
    state: "ready"
  });
}

function commitInput(
  entry: Awaited<ReturnType<typeof setupCommit>>,
  overrides: Record<string, unknown> = {}
) {
  return {
    taskId: "traversal-1",
    leaseToken: "lease-1",
    attempt: 1,
    checkpoint: {
      version: "unified-production-traversal-checkpoint-v2",
      deltaHeadSha256: NEXT_HEAD
    },
    barrierReservedBytes: 1_048_576,
    orderedCommit: {
      runId: "run-1",
      expectedDeltaHeadSha256: OLD_HEAD,
      entries: [entry],
      discoveredTasks: []
    },
    ...overrides
  };
}

postgresDescribe("Unified ordered commit", () => {
  it("claims traversal only for planner actionability and ordered tasks only after admission", async () => {
    await withScenario(async ({ db, host }) => {
      await insertCompletedDirectHistory(db);
      await db.query(
        `insert into unified_check_tasks (
           id, run_id, kind, status, priority_lane, logical_key
         ) values (
           'traversal-1','run-1','traversal','QUEUED','interactive','main'
         )`
      );
      const initial = await claimUnifiedTask(db, {
        workerId: "analysis-1",
        leaseToken: "lease-initial",
        leaseMs: 30_000,
        kinds: ["traversal"]
      });
      expect(initial?.id).toBe("traversal-1");
      await db.query(
        `update unified_check_tasks
            set status = 'QUEUED', lease_owner = null, lease_token = null,
                lease_expires_at = null, heartbeat_at = null
          where id = 'traversal-1'`
      );
      await insertAcceptedHistory(db, {
        sequence: 0,
        taskId: "history-1",
        state: "planned"
      });
      await expect(claimUnifiedTask(db, {
        workerId: "analysis-2",
        leaseToken: "lease-planned",
        leaseMs: 30_000,
        kinds: ["traversal"]
      })).resolves.toBeNull();
      await expect(claimUnifiedTask(db, {
        workerId: "provider-1",
        leaseToken: "lease-provider-blocked",
        leaseMs: 30_000,
        kinds: ["address_history"]
      })).resolves.toBeNull();

      await admitBarrierHead(host, {
        runId: "run-1",
        reservedBytes: 1_048_576
      });
      const provider = await claimUnifiedTask(db, {
        workerId: "provider-1",
        leaseToken: "lease-provider",
        leaseMs: 30_000,
        kinds: ["address_history"]
      });
      expect(provider?.id).toBe("history-1");
      await db.query(
        `update unified_check_tasks
            set status = 'QUEUED', lease_owner = null, lease_token = null,
                lease_expires_at = null, heartbeat_at = null
          where id = 'history-1'`
      );
      const artifact = {
        version: "unified-address-history-manifest-v1",
        schemaVersion: 1,
        key: "history-1"
      };
      const artifactSha256 = fingerprintCanonicalArtifact(artifact);
      const resultBytes =
        Buffer.byteLength(canonicalizeArtifactJson(artifact));
      await db.query(
        `insert into unified_check_artifacts (
           sha256, created_by_run_id, kind, schema_version, artifact_json
         ) values ($1,'run-1','address_history_manifest','1',$2::jsonb)`,
        [artifactSha256, JSON.stringify(artifact)]
      );
      await db.query(
        `insert into unified_check_attempts (
           id, task_id, attempt, artifact_sha256, completed_at
         ) values (
           'attempt-history-1','history-1',1,$1,statement_timestamp()
         )`,
        [artifactSha256]
      );
      await db.query(
        `update unified_check_tasks
            set status = 'COMPLETED',
                accepted_attempt_id = 'attempt-history-1'
          where id = 'history-1'`
      );
      await db.query(
        `update unified_check_planner_entries
            set planner_state = 'ready', result_bytes = $1,
                reserved_bytes = null, ready_at = statement_timestamp()
          where task_id = 'history-1'`,
        [resultBytes]
      );
      const ready = await claimUnifiedTask(db, {
        workerId: "analysis-3",
        leaseToken: "lease-ready",
        leaseMs: 30_000,
        kinds: ["traversal"]
      });
      expect(ready?.id).toBe("traversal-1");
      await db.query(
        `update unified_check_tasks
            set status = 'QUEUED', lease_owner = null, lease_token = null,
                lease_expires_at = null, heartbeat_at = null
          where id = 'traversal-1'`
      );
      await db.query(
        `update unified_check_planner_entries
            set planner_state = 'committed',
                committed_at = statement_timestamp()
          where task_id = 'history-1'`
      );
      const closed = await claimUnifiedTask(db, {
        workerId: "analysis-4",
        leaseToken: "lease-closed",
        leaseMs: 30_000,
        kinds: ["traversal"]
      });
      expect(closed?.id).toBe("traversal-1");
    });
  });

  it("atomically checkpoints, commits the exact prefix and admits the next head", async () => {
    await withScenario(async ({ db, host }) => {
      const entry = await setupCommit(db);
      await expect(checkpointUnifiedTask(host, commitInput(entry)))
        .resolves.toMatchObject({ status: "QUEUED" });
      expect((await db.query(
        "select status, checkpoint_json from unified_check_tasks where id = 'traversal-1'"
      )).rows[0]).toMatchObject({
        status: "QUEUED",
        checkpoint_json: { deltaHeadSha256: NEXT_HEAD }
      });
      expect((await db.query(
        `select canonical_sequence, planner_state,
                admitted_at is not null as admitted, reserved_bytes
           from unified_check_planner_entries
          order by canonical_sequence`
      )).rows).toEqual([
        {
          canonical_sequence: "0",
          planner_state: "committed",
          admitted: true,
          reserved_bytes: null
        },
        {
          canonical_sequence: "1",
          planner_state: "planned",
          admitted: true,
          reserved_bytes: "1048576"
        }
      ]);
    });
  });

  it.each([
    ["accepted attempt", (entry: Awaited<ReturnType<typeof setupCommit>>) => ({
      orderedCommit: {
        runId: "run-1",
        expectedDeltaHeadSha256: OLD_HEAD,
        entries: [{ ...entry, acceptedAttemptId: "attempt-wrong" }],
        discoveredTasks: []
      }
    })],
    ["result bytes", (entry: Awaited<ReturnType<typeof setupCommit>>) => ({
      orderedCommit: {
        runId: "run-1",
        expectedDeltaHeadSha256: OLD_HEAD,
        entries: [{ ...entry, resultBytes: entry.resultBytes + 1 }],
        discoveredTasks: []
      }
    })],
    ["stale delta head", (entry: Awaited<ReturnType<typeof setupCommit>>) => ({
      orderedCommit: {
        runId: "run-1",
        expectedDeltaHeadSha256: "c".repeat(64),
        entries: [entry],
        discoveredTasks: []
      }
    })],
    ["lease", () => ({ leaseToken: "lease-wrong" })]
  ])("rolls back on %s mismatch", async (_name, mutate) => {
    await withScenario(async ({ db, host }) => {
      const entry = await setupCommit(db);
      await expect(checkpointUnifiedTask(host, {
        ...commitInput(entry),
        ...mutate(entry)
      })).rejects.toThrow();
      expect((await db.query(
        "select status, checkpoint_json from unified_check_tasks where id = 'traversal-1'"
      )).rows[0]).toMatchObject({
        status: "LEASED",
        checkpoint_json: { deltaHeadSha256: OLD_HEAD }
      });
      expect((await db.query(
        "select planner_state from unified_check_planner_entries where canonical_sequence = 0"
      )).rows[0]?.planner_state).toBe("ready");
    });
  });

  it("rejects a task whose accepted manifest belongs to another logical identity", async () => {
    await withScenario(async ({ db, host }) => {
      const entry = await setupCommit(db);
      const otherManifest = buildAddressHistoryManifest({
        chain: "tron",
        snapshotHash: "b".repeat(64),
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        address: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP",
        providerRequestVersion: "tronscan-related-trc20-v1",
        pageArtifactHashes: [],
        canonicalEventIds: [],
        rawRowCount: 0,
        duplicateCount: 0,
        exhaustion: {
          kind: "account_creation_reached",
          evidenceSha256: "d".repeat(64)
        }
      });
      const otherSha256 = fingerprintCanonicalArtifact(otherManifest);
      const otherBytes = Buffer.byteLength(
        canonicalizeArtifactJson(otherManifest)
      );
      await db.query(
        `insert into unified_check_artifacts (
           sha256, created_by_run_id, kind, schema_version, artifact_json
         ) values ($1,'run-1','address_history_manifest','1',$2::jsonb)`,
        [otherSha256, JSON.stringify(otherManifest)]
      );
      await db.query(
        `insert into unified_check_attempts (
           id, task_id, attempt, artifact_sha256, completed_at
         ) values (
           'attempt-history-1-other','history-1',2,$1,statement_timestamp()
         )`,
        [otherSha256]
      );
      await db.query(
        `update unified_check_tasks
            set accepted_attempt_id = 'attempt-history-1-other'
          where id = 'history-1'`
      );
      await db.query(
        `update unified_check_planner_entries
            set result_bytes = $1
          where task_id = 'history-1'`,
        [otherBytes]
      );

      await expect(checkpointUnifiedTask(host, commitInput({
        ...entry,
        acceptedAttemptId: "attempt-history-1-other",
        resultBytes: otherBytes
      }))).rejects.toThrow("unified_ordered_commit_prefix_mismatch");
      expect((await db.query(
        "select status, checkpoint_json from unified_check_tasks where id = 'traversal-1'"
      )).rows[0]).toMatchObject({
        status: "LEASED",
        checkpoint_json: { deltaHeadSha256: OLD_HEAD }
      });
      expect((await db.query(
        "select planner_state from unified_check_planner_entries where task_id = 'history-1'"
      )).rows[0]?.planner_state).toBe("ready");
    });
  });

  it("rolls back when a non-address task carries an address-history manifest", async () => {
    await withScenario(async ({ db, host }) => {
      const entry = await setupCommit(db);
      await db.query(
        "update unified_check_tasks set kind = 'direct_history' where id = 'history-1'"
      );

      await expect(checkpointUnifiedTask(host, commitInput({
        ...entry,
        taskKind: "direct_history"
      }))).rejects.toThrow("unified_ordered_commit_prefix_mismatch");
      expect((await db.query(
        "select status, checkpoint_json from unified_check_tasks where id = 'traversal-1'"
      )).rows[0]).toMatchObject({
        status: "LEASED",
        checkpoint_json: { deltaHeadSha256: OLD_HEAD }
      });
      expect((await db.query(
        "select planner_state from unified_check_planner_entries where task_id = 'history-1'"
      )).rows[0]?.planner_state).toBe("ready");
    });
  });

  it("rejects a noncontinuous expectation before mutating state", async () => {
    await withScenario(async ({ db, host }) => {
      const first = await setupCommit(db);
      const third = await insertAcceptedHistory(db, {
        sequence: 2,
        taskId: "history-3",
        state: "ready"
      });
      await expect(checkpointUnifiedTask(host, commitInput(first, {
        orderedCommit: {
          runId: "run-1",
          expectedDeltaHeadSha256: OLD_HEAD,
          entries: [first, third],
          discoveredTasks: []
        }
      }))).rejects.toThrow("unified_ordered_commit_expectation_invalid");
      expect((await db.query(
        "select status from unified_check_tasks where id = 'traversal-1'"
      )).rows[0]?.status).toBe("LEASED");
    });
  });

  it("rolls back the checkpoint if the planner commit fails", async () => {
    await withScenario(async ({ db, host }) => {
      const entry = await setupCommit(db);
      await db.query(`
        create function reject_ordered_commit() returns trigger
        language plpgsql as $$
        begin
          if new.planner_state = 'committed' then
            raise exception 'injected ordered commit failure';
          end if;
          return new;
        end
        $$;
        create trigger reject_ordered_commit_trigger
        before update on unified_check_planner_entries
        for each row execute function reject_ordered_commit()
      `);
      await expect(checkpointUnifiedTask(host, commitInput(entry)))
        .rejects.toThrow("injected ordered commit failure");
      expect((await db.query(
        "select status, checkpoint_json from unified_check_tasks where id = 'traversal-1'"
      )).rows[0]).toMatchObject({
        status: "LEASED",
        checkpoint_json: { deltaHeadSha256: OLD_HEAD }
      });
      expect((await db.query(
        "select planner_state from unified_check_planner_entries where canonical_sequence = 0"
      )).rows[0]?.planner_state).toBe("ready");
    });
  });

  it("atomically commits, appends a discovered child and admits it", async () => {
    await withScenario(async ({ db, host }) => {
      const entry = await setupCommit(db);
      await db.query(
        "delete from unified_check_planner_entries where task_id = 'history-2'"
      );
      await db.query(
        "delete from unified_check_tasks where id = 'history-2'"
      );
      const result = await checkpointUnifiedTask(host, commitInput(entry, {
        orderedCommit: {
          runId: "run-1",
          expectedDeltaHeadSha256: OLD_HEAD,
          entries: [entry],
          discoveredTasks: [{
            parentCanonicalSequence: 0,
            taskId: "history-child",
            kind: "address_history",
            logicalKey: "history-child",
            priorityLane: "interactive",
            checkpoint: { version: "test-v1" }
          }]
        }
      }));

      expect(result?.next_head_newly_admitted).toBe(true);
      expect((await db.query(
        `select entry.canonical_sequence, entry.planner_state,
                entry.admitted_at is not null as admitted, task.status,
                task.accepted_attempt_id
           from unified_check_planner_entries entry
           join unified_check_tasks task
             on task.run_id = entry.run_id and task.id = entry.task_id
          where entry.task_id = 'history-child'`
      )).rows[0]).toMatchObject({
        canonical_sequence: "1",
        planner_state: "planned",
        admitted: true,
        status: "QUEUED",
        accepted_attempt_id: null
      });
    });
  });

  it("rolls back the whole transition when the next head lifecycle is invalid", async () => {
    await withScenario(async ({ db, host }) => {
      const entry = await setupCommit(db);
      await db.query(
        "update unified_check_tasks set status = 'COMPLETED' where id = 'history-2'"
      );

      await expect(checkpointUnifiedTask(host, commitInput(entry)))
        .rejects.toThrow("unified_ordered_next_head_not_admissible");
      expect((await db.query(
        "select status, checkpoint_json from unified_check_tasks where id = 'traversal-1'"
      )).rows[0]).toMatchObject({
        status: "LEASED",
        checkpoint_json: { deltaHeadSha256: OLD_HEAD }
      });
      expect((await db.query(
        "select planner_state from unified_check_planner_entries where canonical_sequence = 0"
      )).rows[0]?.planner_state).toBe("ready");
    });
  });

  it("keeps a valid ready next head traversal-actionable without provider wake", async () => {
    await withScenario(async ({ db, host }) => {
      const entry = await setupCommit(db);
      await replaceNextHeadWithReady(db);

      const result = await checkpointUnifiedTask(host, commitInput(entry));
      expect(result?.next_head_newly_admitted).toBe(false);
      expect((await db.query(
        `select planner_state, reserved_bytes, ready_at, committed_at
           from unified_check_planner_entries
          where task_id = 'history-ready'`
      )).rows[0]).toMatchObject({
        planner_state: "ready",
        reserved_bytes: null,
        committed_at: null
      });
      expect((await db.query(
        "select status from unified_check_tasks where id = 'traversal-1'"
      )).rows[0]?.status).toBe("QUEUED");

      await insertCompletedDirectHistory(db);
      const claimed = await claimUnifiedTask(db, {
        workerId: "analysis-ready-head",
        leaseToken: "lease-ready-head",
        leaseMs: 30_000,
        kinds: ["traversal"]
      });
      expect(claimed?.id).toBe("traversal-1");
    });
  });

  it("commits while rolling refill already leased the next admitted head", async () => {
    await withScenario(async ({ db, host }) => {
      const entry = await setupCommit(db);
      await db.query(
        `update unified_check_planner_entries
            set admitted_at = statement_timestamp(), reserved_bytes = 1048576
          where task_id = 'history-2'`
      );
      await db.query(
        `update unified_check_tasks
            set status = 'LEASED', lease_owner = 'provider-1',
                lease_token = 'provider-lease',
                lease_expires_at = statement_timestamp() + interval '1 minute',
                heartbeat_at = statement_timestamp()
          where id = 'history-2'`
      );

      const result = await checkpointUnifiedTask(host, commitInput(entry));

      expect(result?.next_head_newly_admitted).toBe(false);
      expect((await db.query(
        `select entry.planner_state, entry.admitted_at is not null as admitted,
                entry.reserved_bytes, task.status, task.lease_token
           from unified_check_planner_entries entry
           join unified_check_tasks task
             on task.run_id = entry.run_id and task.id = entry.task_id
          where entry.task_id = 'history-2'`
      )).rows[0]).toMatchObject({
        planner_state: "planned",
        admitted: true,
        reserved_bytes: "1048576",
        status: "LEASED",
        lease_token: "provider-lease"
      });
      expect((await db.query(
        `select planner_state
           from unified_check_planner_entries
          where task_id = 'history-1'`
      )).rows[0]?.planner_state).toBe("committed");
    });
  });

  it("rolls back when a ready next head retains a reservation", async () => {
    await withScenario(async ({ db, host }) => {
      const entry = await setupCommit(db);
      await replaceNextHeadWithReady(db);
      await db.query(
        `alter table unified_check_planner_entries
           drop constraint unified_check_planner_entries_state_shape_check`
      );
      await db.query(
        `update unified_check_planner_entries
            set reserved_bytes = 1048576
          where task_id = 'history-ready'`
      );

      await expect(checkpointUnifiedTask(host, commitInput(entry)))
        .rejects.toThrow("unified_ordered_next_head_not_admissible");
      expect((await db.query(
        "select status, checkpoint_json from unified_check_tasks where id = 'traversal-1'"
      )).rows[0]).toMatchObject({
        status: "LEASED",
        checkpoint_json: { deltaHeadSha256: OLD_HEAD }
      });
      expect((await db.query(
        "select planner_state from unified_check_planner_entries where canonical_sequence = 0"
      )).rows[0]?.planner_state).toBe("ready");
    });
  });

  it("cannot duplicate an already committed prefix on retry", async () => {
    await withScenario(async ({ db, host }) => {
      const entry = await setupCommit(db);
      const input = commitInput(entry);
      await checkpointUnifiedTask(host, input);
      await expect(checkpointUnifiedTask(host, input)).rejects.toThrow();
      expect(Number((await db.query(
        `select count(*)::int as count
           from unified_check_planner_entries
          where planner_state = 'committed'`
      )).rows[0]?.count)).toBe(1);
    });
  });

  it("serializes concurrent refill behind commit without split state", async () => {
    await withScenario(async ({ db, pool, schema }) => {
      const entry = await setupCommit(db);
      let releaseLock!: () => void;
      const release = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let announceLock!: () => void;
      const locked = new Promise<void>((resolve) => {
        announceLock = resolve;
      });
      const commitHost = transactionHost(pool, schema, async (sql) => {
        if (
          sql.includes("from unified_check_runs") &&
          sql.includes("for update")
        ) {
          announceLock();
          await release;
        }
      });
      const commit = checkpointUnifiedTask(commitHost, commitInput(entry));
      await locked;
      const refill = planUnifiedOrderedTasks(transactionHost(pool, schema), {
        runId: "run-1",
        tasks: [{
          taskId: "history-3",
          kind: "address_history",
          logicalKey: "history-3",
          priorityLane: "interactive",
          checkpoint: { version: "test-v1" }
        }]
      });
      releaseLock();
      await expect(Promise.all([commit, refill])).resolves.toBeTruthy();
      expect((await db.query(
        `select canonical_sequence, task_id, planner_state
           from unified_check_planner_entries
          order by canonical_sequence`
      )).rows).toMatchObject([
        { canonical_sequence: "0", task_id: "history-1", planner_state: "committed" },
        { canonical_sequence: "1", task_id: "history-2", planner_state: "planned" },
        { canonical_sequence: "2", task_id: "history-3", planner_state: "planned" }
      ]);
    });
  });
});
