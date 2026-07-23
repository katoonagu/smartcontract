import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  claimUnifiedTask,
  createOrGetCheckRequest,
  createOrReuseUnifiedRun,
  createUnifiedDelivery,
  createUnifiedTasks,
  insertUnifiedArtifact
} from "../../src/unifiedCheck/repository";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;

postgresDescribe("Unified Check repository", () => {
  it("is idempotent, immutable and leases one task once", async () => {
    const pool = new pg.Pool({ connectionString, max: 4 });
    const client = await pool.connect();
    const schema = `unifiedrepo_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await client.query(
        await readFile("migrations/033_unified_wallet_check.sql", "utf8")
      );
      const scoped = {
        query: (sql: string, values?: readonly unknown[]) =>
          client.query(sql, values as unknown[])
      };
      const runInput = {
        id: "run-a",
        analysisKeySha256: "a".repeat(64),
        subjectAddress: "TSubject",
        runPurpose: "synthetic_test" as const,
        sideEffectPolicy: "isolated" as const,
        analysisManifestSha256: "b".repeat(64)
      };
      const first = await createOrReuseUnifiedRun(scoped, runInput);
      const reused = await createOrReuseUnifiedRun(scoped, {
        ...runInput,
        id: "run-b"
      });
      expect(reused.id).toBe(first.id);
      const runId = String(first.id);

      const request = await createOrGetCheckRequest(scoped, {
        id: "request-a",
        requestCorrelationId: "correlation-a",
        subjectAddress: "TSubject",
        chatId: "chat",
        messageThreadId: "",
        locale: "ru",
        runPurpose: "synthetic_test"
      });
      const requestAgain = await createOrGetCheckRequest(scoped, {
        id: "request-b",
        requestCorrelationId: "correlation-a",
        subjectAddress: "TSubject",
        chatId: "chat",
        messageThreadId: "",
        locale: "ru",
        runPurpose: "synthetic_test"
      });
      expect(requestAgain.id).toBe(request.id);

      await insertUnifiedArtifact(scoped, {
        sha256: "c".repeat(64),
        createdByRunId: runId,
        kind: "analysis",
        schemaVersion: "1",
        artifact: { stable: true }
      });
      await createUnifiedTasks(scoped, {
        runId,
        tasks: [
          {
            id: "task-a",
            kind: "fast",
            priorityLane: "interactive",
            logicalKey: "main"
          }
        ]
      });
      const [left, right] = await Promise.all([
        claimUnifiedTask(scoped, {
          workerId: "worker-a",
          leaseToken: "lease-a",
          leaseMs: 60_000
        }),
        claimUnifiedTask(scoped, {
          workerId: "worker-b",
          leaseToken: "lease-b",
          leaseMs: 60_000
        })
      ]);
      expect([left, right].filter(Boolean)).toHaveLength(1);

      const delivery = await createUnifiedDelivery(scoped, {
        id: "delivery-a",
        requestId: String(request.id),
        presentationSha256: "d".repeat(64)
      });
      const deliveryAgain = await createUnifiedDelivery(scoped, {
        id: "delivery-b",
        requestId: String(request.id),
        presentationSha256: "d".repeat(64)
      });
      expect(deliveryAgain.id).toBe(delivery.id);
    } finally {
      await client.query(`drop schema if exists "${schema}" cascade`);
      client.release();
      await pool.end();
    }
  });
});
