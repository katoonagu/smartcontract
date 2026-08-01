import { describe, expect, it } from "vitest";
import {
  activateUnifiedGeneration,
  createUnifiedRuntimeGate,
  getActiveCheckGeneration,
  handoffWalletDeliveryAndAcceptRequest,
  handoffWalletDeliveryToUnified,
  ownsWalletDelivery,
  quarantineLegacyWalletDeliveries,
  selectUnifiedStartupSchedule
} from "../../src/unifiedCheck/rolloutFence";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";
import { claimNextForensicTelegramDelivery } from "../../src/storage/repositories";
import type { Db } from "../../src/storage/db";

function transactionHost(
  query: UnifiedQueryable["query"]
): UnifiedTransactionalQueryable {
  return {
    query,
    transaction: (work) => work({ query })
  };
}

describe("Unified rollout generation fence", () => {
  it("keeps legacy ownership until a durable Unified fence exists", async () => {
    const db = transactionHost(async () => ({ rows: [] }));

    const generation = await getActiveCheckGeneration(db);

    expect(generation).toEqual({
      deliveryGeneration: "legacy",
      generationId: null,
      activatedAt: null,
      runtimeCommit: null
    });
    expect(ownsWalletDelivery(generation, "legacy")).toBe(true);
    expect(ownsWalletDelivery(generation, "unified")).toBe(false);
    expect(selectUnifiedStartupSchedule(generation, [
      { label: "unified_delivery" }
    ])).toEqual([]);
  });

  it("starts isolated controller work without granting Telegram delivery ownership", () => {
    const legacyEvents: string[] = [];
    const legacy = createUnifiedRuntimeGate({
      startController: () => legacyEvents.push("start"),
      wakeController: () => legacyEvents.push("wake"),
      activateBarrierFallback: () => legacyEvents.push("fallback"),
      registerBarrierFallback: () => legacyEvents.push("register"),
      unregisterBarrierFallback: () => legacyEvents.push("unregister")
    });

    expect(legacy.start()).toBe(true);
    expect(legacy.wakeController()).toBe(true);
    expect(legacy.requestBarrierFallback()).toBe(true);
    legacy.stop();
    expect(legacyEvents).toEqual([
      "start",
      "register",
      "wake",
      "wake",
      "fallback",
      "unregister"
    ]);

    const unifiedEvents: string[] = [];
    const fallbackListeners: Array<() => void> = [];
    const unified = createUnifiedRuntimeGate({
      startController: () => unifiedEvents.push("start"),
      wakeController: () => unifiedEvents.push("wake"),
      activateBarrierFallback: () => unifiedEvents.push("fallback"),
      registerBarrierFallback: (listener) => {
        unifiedEvents.push("register");
        fallbackListeners.push(listener);
      },
      unregisterBarrierFallback: (listener) => {
        expect(listener).toBe(fallbackListeners[0]);
        unifiedEvents.push("unregister");
      }
    });

    expect(unified.start()).toBe(true);
    expect(unified.start()).toBe(false);
    expect(unifiedEvents).toEqual(["start", "register", "wake"]);
    expect(unified.wakeController()).toBe(true);
    fallbackListeners[0]!();
    expect(unifiedEvents).toEqual([
      "start",
      "register",
      "wake",
      "wake",
      "fallback"
    ]);
    unified.stop();
    expect(unifiedEvents.at(-1)).toBe("unregister");
    expect(unified.wakeController()).toBe(false);
    expect(unified.requestBarrierFallback()).toBe(false);
  });

  it("activates one generation transactionally and accepts only an exact retry", async () => {
    let active: Record<string, unknown> | undefined;
    const db = transactionHost(async (sql, values = []) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("where active = true")) {
        return { rows: active ? [active] : [] };
      }
      if (sql.includes("for update") && sql.includes("telegramDelivery,claim")) {
        return { rows: [] };
      }
      if (sql.includes("insert into unified_check_generation_fence")) {
        active = {
          generation_id: values[0],
          activated_at: values[1],
          runtime_commit: values[2],
          delivery_generation: "unified"
        };
        return { rows: [active] };
      }
      throw new Error(`unexpected_sql:${sql}`);
    });
    const input = {
      generationId: "unified-2026-07-23",
      activatedAt: "2026-07-23T12:00:00.000Z",
      runtimeCommit: "a".repeat(40)
    };

    await expect(activateUnifiedGeneration(db, input)).resolves.toMatchObject({
      deliveryGeneration: "unified",
      generationId: input.generationId
    });
    expect(selectUnifiedStartupSchedule(
      await getActiveCheckGeneration(db),
      [{ label: "unified_delivery" }]
    )).toEqual([{ label: "unified_delivery" }]);
    await expect(activateUnifiedGeneration(db, input)).resolves.toMatchObject({
      deliveryGeneration: "unified",
      generationId: input.generationId
    });
    await expect(activateUnifiedGeneration(db, {
      ...input,
      generationId: "unified-conflict"
    })).rejects.toThrow("unified_generation_already_active");
  });

  it("refuses cutover while a legacy Telegram claim can still be accepted", async () => {
    const db = transactionHost(async (sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("where active = true")) return { rows: [] };
      if (sql.includes("for update") && sql.includes("telegramDelivery,claim")) {
        return { rows: [{ id: "deep-in-flight" }] };
      }
      throw new Error(`unexpected_sql:${sql}`);
    });

    await expect(activateUnifiedGeneration(db, {
      generationId: "unified-2026-07-23",
      activatedAt: "2026-07-23T12:00:00.000Z",
      runtimeCommit: "a".repeat(40)
    })).rejects.toThrow("legacy_delivery_claims_in_flight:deep-in-flight");
  });

  it("quarantines only unsent Deep/Where delivery for the fenced chat and address", async () => {
    let updateSql = "";
    let updateValues: readonly unknown[] = [];
    const db = transactionHost(async (sql, values = []) => {
      updateSql = sql;
      updateValues = values;
      return { rows: [{ id: "where-1" }, { id: "deep-1" }], rowCount: 2 };
    });

    const result = await quarantineLegacyWalletDeliveries(db, {
      subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
      chatId: "42",
      generationId: "unified-2026-07-23",
      quarantinedAt: "2026-07-23T12:01:00.000Z"
    });

    expect(result).toEqual({ quarantinedJobIds: ["where-1", "deep-1"] });
    expect(updateSql).toContain("kind in ('where_is_money_check','address_deep_check')");
    expect(updateSql).toContain("in ('pending','retryable')");
    expect(updateSql).toContain("progress_json#>'{telegramDelivery,claim}' = 'null'::jsonb");
    expect(updateSql).not.toContain("'sent'");
    expect(updateSql).toContain("quarantinedLegacyTelegramDelivery");
    expect(updateSql).toContain("legacyDeliveryFence");
    expect(updateValues).toEqual([
      "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
      "42",
      "unified-2026-07-23",
      "2026-07-23T12:01:00.000Z"
    ]);
  });

  it("atomically owns a chat/address pair before quarantining legacy delivery", async () => {
    const queries: string[] = [];
    const db = transactionHost(async (sql) => {
      queries.push(sql);
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("where active = true")) {
        return { rows: [{
          generation_id: "unified-2026-07-23",
          activated_at: "2026-07-23T12:00:00.000Z",
          runtime_commit: "a".repeat(40),
          delivery_generation: "unified"
        }] };
      }
      if (sql.includes("as claim") && sql.includes("for update")) {
        return { rows: [{ id: "where-1", claim: null }] };
      }
      if (sql.includes("insert into unified_wallet_delivery_ownership")) {
        return { rows: [{ generation_id: "unified-2026-07-23" }] };
      }
      if (sql.includes("update forensic_check_jobs")) {
        return { rows: [{ id: "where-1" }] };
      }
      throw new Error(`unexpected_sql:${sql}`);
    });
    await expect(handoffWalletDeliveryToUnified(db, {
      subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
      chatId: "42",
      generationId: "unified-2026-07-23",
      acquiredAt: "2026-07-23T12:01:00.000Z"
    })).resolves.toEqual({ quarantinedJobIds: ["where-1"] });
    expect(queries.findIndex((sql) =>
      sql.includes("insert into unified_wallet_delivery_ownership")
    )).toBeLessThan(queries.findIndex((sql) =>
      sql.includes("update forensic_check_jobs")
    ));
  });

  it("accepts the durable action in the same transaction as pair handoff", async () => {
    const queries: string[] = [];
    let transactionCount = 0;
    const query: UnifiedQueryable["query"] = async (sql, values = []) => {
      queries.push(sql);
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("where active = true")) {
        return { rows: [{
          generation_id: "unified-2026-07-23",
          activated_at: "2026-07-23T12:00:00.000Z",
          runtime_commit: "a".repeat(40),
          delivery_generation: "unified"
        }] };
      }
      if (sql.includes("as claim") && sql.includes("for update")) {
        return { rows: [{ id: "where-1", claim: null }] };
      }
      if (sql.includes("insert into unified_wallet_delivery_ownership")) {
        return { rows: [{ generation_id: "unified-2026-07-23" }] };
      }
      if (sql.includes("update forensic_check_jobs")) {
        return { rows: [{ id: "where-1" }] };
      }
      if (sql.includes("insert into unified_check_requests")) {
        return { rows: [{
          id: values[0],
          request_correlation_id: values[1],
          subject_address: values[2],
          chat_id: values[3],
          message_thread_id: values[4],
          locale: values[5],
          run_purpose: values[6],
          side_effect_policy: values[7],
          status: "ACCEPTED",
          status_reason: null,
          run_id: null,
          ready_at: values[8],
          attempt_count: 0,
          accepted_at: values[8]
        }] };
      }
      throw new Error(`unexpected_sql:${sql}`);
    };
    const db: UnifiedTransactionalQueryable = {
      query,
      async transaction<T>(
        work: (client: UnifiedQueryable) => Promise<T>
      ): Promise<T> {
        transactionCount += 1;
        return work({ query });
      }
    };
    const acceptedAt = "2026-07-23T12:01:00.000Z";
    await expect(handoffWalletDeliveryAndAcceptRequest(db, {
      subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
      chatId: "42",
      generationId: "unified-2026-07-23",
      acquiredAt: acceptedAt,
      request: {
        id: "request-1",
        requestCorrelationId: "action-1",
        subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
        chatId: "42",
        messageThreadId: "",
        locale: "ru",
        runPurpose: "user_check",
        sideEffectPolicy: "authoritative",
        status: "ACCEPTED",
        statusReason: null,
        runId: null,
        readyAt: acceptedAt,
        attemptCount: 0,
        acceptedAt
      }
    })).resolves.toMatchObject({
      quarantinedJobIds: ["where-1"],
      request: { id: "request-1", status: "ACCEPTED" }
    });
    expect(transactionCount).toBe(1);
    expect(queries.findIndex((sql) =>
      sql.includes("insert into unified_wallet_delivery_ownership")
    )).toBeLessThan(queries.findIndex((sql) =>
      sql.includes("insert into unified_check_requests")
    ));
    expect(queries.findIndex((sql) =>
      sql.includes("update forensic_check_jobs")
    )).toBeLessThan(queries.findIndex((sql) =>
      sql.includes("insert into unified_check_requests")
    ));
  });

  it("refuses pair handoff while a legacy delivery claim is live", async () => {
    const db = transactionHost(async (sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("where active = true")) {
        return { rows: [{
          generation_id: "unified-2026-07-23",
          activated_at: "2026-07-23T12:00:00.000Z",
          runtime_commit: "a".repeat(40),
          delivery_generation: "unified"
        }] };
      }
      if (sql.includes("as claim") && sql.includes("for update")) {
        return { rows: [{ id: "deep-live", claim: { token: "live" } }] };
      }
      throw new Error(`unexpected_sql:${sql}`);
    });
    await expect(handoffWalletDeliveryToUnified(db, {
      subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
      chatId: "42",
      generationId: "unified-2026-07-23",
      acquiredAt: "2026-07-23T12:01:00.000Z"
    })).rejects.toThrow(
      "legacy_wallet_delivery_claim_in_flight:deep-live"
    );
  });

  it("quarantines a child delivery under its claim lock when Unified owns the pair", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("from forensic_check_jobs job")) {
          return {
            rows: [{
              id: "where-late",
              kind: "where_is_money_check",
              subject_address: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
              chat_id: "42",
              delivery: { version: "forensic-telegram-delivery-v1" }
            }],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {}
    };
    const db = {
      async connect() {
        return client;
      }
    } as unknown as Db;

    await expect(claimNextForensicTelegramDelivery(db, {
      now: new Date("2026-07-23T12:02:00.000Z"),
      resolveWalletDeliveryGeneration: async () => ({
        deliveryGeneration: "unified",
        generationId: "unified-2026-07-23"
      })
    })).resolves.toBeNull();

    expect(queries.some((sql) =>
      sql.includes("quarantinedLegacyTelegramDelivery")
    )).toBe(true);
    expect(queries.at(-1)).toBe("commit");
  });
});
