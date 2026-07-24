import { describe, expect, it } from "vitest";
import {
  claimUnifiedTask,
  ensureAddressHistoryTasks,
  loadCompletedAddressHistoryManifests,
  type UnifiedQueryable
} from "../../src/unifiedCheck/repository";
import type { AddressHistoryManifestV1 } from "../../src/unifiedCheck/addressHistory";

const MANIFEST_KEY = "a".repeat(64);
const RUN_ID = "run-address-history";

function queryable(
  handler: (
    sql: string,
    values: readonly unknown[]
  ) => Array<Record<string, unknown>>
): UnifiedQueryable {
  return {
    async query(sql, values = []) {
      return { rows: handler(sql, values) };
    }
  };
}

describe("Unified address-history tasks", () => {
  it("creates one mutable task identity per run and manifest key", async () => {
    const stored = new Map<string, Record<string, unknown>>();
    const db = queryable((sql, values) => {
      const key = `${values[1]}:${values[2]}:${values[4]}`;
      if (sql.includes("insert into unified_check_tasks")) {
        if (stored.has(key)) return [];
        const row = {
          id: values[0],
          run_id: values[1],
          kind: values[2],
          status: "QUEUED",
          priority_lane: values[3],
          logical_key: values[4],
          checkpoint_json: JSON.parse(String(values[5]))
        };
        stored.set(key, row);
        return [row];
      }
      if (sql.includes("select * from unified_check_tasks")) {
        return [stored.get(`${values[0]}:${values[1]}:${values[2]}`)!];
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const input = {
      runId: RUN_ID,
      priorityLane: "interactive" as const,
      histories: [{
        taskId: "address-task-1",
        manifestKey: MANIFEST_KEY,
        identity: {
          chain: "tron" as const,
          snapshotHash: "b".repeat(64),
          tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          address: "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
          providerRequestVersion: "tronscan-related-trc20-v1"
        }
      }]
    };
    const first = await ensureAddressHistoryTasks(db, input);
    const second = await ensureAddressHistoryTasks(db, {
      ...input,
      histories: [{
        taskId: "address-task-duplicate",
        manifestKey: MANIFEST_KEY,
        identity: input.histories[0]!.identity
      }]
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe("address-task-1");
    expect(first[0]?.checkpoint_json).toEqual({
      version: "unified-address-history-checkpoint-v2",
      identity: input.histories[0]!.identity,
      history: null,
      chunkHeadSha256: null,
      chunkCount: 0,
      pageCount: 0,
      rawRowCount: 0
    });
    expect(stored).toHaveLength(1);
  });

  it("loads only accepted address-history manifest artifacts", async () => {
    const manifest = {
      version: "unified-address-history-manifest-v1",
      schemaVersion: 1,
      key: MANIFEST_KEY,
      chain: "tron",
      snapshotHash: "b".repeat(64),
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      address: "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
      providerRequestVersion: "tronscan-related-trc20-v1",
      pageArtifactHashes: ["c".repeat(64)],
      eventInventorySha256: "d".repeat(64),
      rawRowCount: 1,
      canonicalEventCount: 1,
      duplicateCount: 0,
      exhaustion: {
        kind: "provider_exhausted",
        evidenceSha256: "e".repeat(64)
      }
    } satisfies AddressHistoryManifestV1;
    const db = queryable((sql, values) => {
      expect(sql).toContain("task.kind = 'address_history'");
      expect(sql).toContain("artifact.kind = 'address_history_manifest'");
      expect(values).toEqual([RUN_ID, [MANIFEST_KEY]]);
      return [{
        logical_key: MANIFEST_KEY,
        artifact_json: manifest
      }];
    });

    const loaded = await loadCompletedAddressHistoryManifests(db, {
      runId: RUN_ID,
      manifestKeys: [MANIFEST_KEY]
    });

    expect(loaded.get(MANIFEST_KEY)).toEqual(manifest);
  });

  it("adds address-history and traversal dependency guards to claiming", async () => {
    let claimSql = "";
    const db = queryable((sql) => {
      claimSql = sql;
      return [];
    });

    await claimUnifiedTask(db, {
      workerId: "provider-1",
      leaseToken: "lease-1",
      leaseMs: 30_000,
      kinds: ["address_history", "traversal"]
    });

    expect(claimSql).toContain("task.kind <> 'address_history'");
    expect(claimSql).toContain("history_task.kind = 'address_history'");
    expect(claimSql).toContain("history_task.status <> 'COMPLETED'");
  });
});
