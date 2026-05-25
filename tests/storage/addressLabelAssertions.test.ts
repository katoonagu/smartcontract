import { describe, expect, it } from "vitest";
import {
  listActiveRiskLabelsForAddress,
  upsertAddressLabelAssertion
} from "../../src/storage/repositories";
import type { Db } from "../../src/storage/db";

function createMockTransactionalDb(rows: Record<string, unknown>[] = []): {
  db: Db;
  queries: { sql: string; params: unknown[] }[];
  released: boolean;
} {
  const queries: { sql: string; params: unknown[] }[] = [];
  let released = false;
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return { rows, rowCount: 1 };
    },
    release: () => {
      released = true;
    }
  };
  return {
    db: {
      connect: async () => client
    } as unknown as Db,
    queries,
    get released() {
      return released;
    }
  };
}

function createMockDb(rows: Record<string, unknown>[] = []): { db: Db; queries: { sql: string; params: unknown[] }[] } {
  const queries: { sql: string; params: unknown[] }[] = [];
  return {
    db: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return { rows, rowCount: rows.length };
      }
    } as unknown as Db,
    queries
  };
}

describe("address label assertions", () => {
  it("upserts a confirmed darknet exchange assertion and derives an active flat label", async () => {
    const tx = createMockTransactionalDb([
      {
        id: "assertion-1",
        chain: "tron",
        address: "TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV",
        label: "darknet_exchange",
        entity_name: "Manual darknet exchange seed",
        category: "darknet_exchange",
        confidence: "high",
        severity: "critical",
        status: "active",
        source_name: "manual_verified",
        source_url: null,
        notes: "Manually verified darknet exchange seed.",
        evidence_json: { source: "manual_verified" },
        created_by_telegram_id: "9001",
        first_seen_at: new Date("2026-05-24T00:00:00.000Z"),
        last_seen_at: new Date("2026-05-24T00:00:00.000Z"),
        created_at: new Date("2026-05-24T00:00:00.000Z"),
        updated_at: new Date("2026-05-24T00:00:00.000Z")
      }
    ]);

    const assertion = await upsertAddressLabelAssertion(tx.db, {
      id: "assertion-1",
      chain: "tron",
      address: "TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV",
      label: "darknet_exchange" as any,
      entityName: "Manual darknet exchange seed",
      category: "darknet_exchange",
      confidence: "high",
      severity: "critical",
      status: "active",
      sourceName: "manual_verified",
      sourceUrl: null,
      notes: "Manually verified darknet exchange seed.",
      evidenceJson: { source: "manual_verified" },
      createdByTelegramId: "9001",
      firstSeenAt: new Date("2026-05-24T00:00:00.000Z"),
      lastSeenAt: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(assertion).toMatchObject({
      id: "assertion-1",
      label: "darknet_exchange",
      status: "active"
    });
    expect(tx.queries[0].sql).toBe("begin");
    expect(tx.queries.some((query) => query.sql.includes("insert into address_label_assertions"))).toBe(true);
    expect(tx.queries.some((query) => query.sql.includes("insert into address_labels"))).toBe(true);
    expect(tx.queries.at(-1)?.sql).toBe("commit");
    expect(tx.released).toBe(true);
  });

  it("lists active assertion-backed labels for an address", async () => {
    const { db, queries } = createMockDb([
      {
        address: "TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV",
        label: "darknet_exchange",
        source: "service_admin",
        created_by_telegram_id: "9001",
        created_at: new Date("2026-05-24T00:00:00.000Z")
      }
    ]);

    const labels = await listActiveRiskLabelsForAddress(db, "TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV");

    expect(labels).toEqual([
      expect.objectContaining({
        address: "TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV",
        label: "darknet_exchange",
        source: "service_admin"
      })
    ]);
    expect(queries[0].sql).toContain("from address_labels");
  });

  it("derives system flat labels for forensic proximity assertions", async () => {
    const tx = createMockTransactionalDb([
      {
        id: "derived-proximity-1",
        chain: "tron",
        address: "TSubject111111111111111111111111111111",
        label: "darknet_exchange_proximity",
        entity_name: "Derived darknet exchange proximity",
        category: "darknet_exchange_proximity",
        confidence: "high",
        severity: "high",
        status: "active",
        source_name: "forensic_route_search",
        source_url: null,
        notes: "Derived marker.",
        evidence_json: { source: "forensic_route_search" },
        created_by_telegram_id: null,
        first_seen_at: new Date("2026-05-24T00:00:00.000Z"),
        last_seen_at: new Date("2026-05-24T00:00:00.000Z"),
        created_at: new Date("2026-05-24T00:00:00.000Z"),
        updated_at: new Date("2026-05-24T00:00:00.000Z")
      }
    ]);

    await upsertAddressLabelAssertion(tx.db, {
      id: "derived-proximity-1",
      chain: "tron",
      address: "TSubject111111111111111111111111111111",
      label: "darknet_exchange_proximity" as any,
      entityName: "Derived darknet exchange proximity",
      category: "darknet_exchange_proximity",
      confidence: "high",
      severity: "high",
      status: "active",
      sourceName: "forensic_route_search",
      evidenceJson: { source: "forensic_route_search" },
      createdByTelegramId: null
    });

    const labelInsert = tx.queries.find((query) => query.sql.includes("insert into address_labels"));
    expect(labelInsert?.params).toEqual([
      "TSubject111111111111111111111111111111",
      "darknet_exchange_proximity",
      "system",
      null
    ]);
  });

  it("derives system flat labels for approval-drain proximity assertions", async () => {
    const tx = createMockTransactionalDb([
      {
        id: "derived-approval-drain-1",
        chain: "tron",
        address: "TSubject111111111111111111111111111111",
        label: "approval_drain_proximity",
        entity_name: "Derived approval-drain proximity",
        category: "approval_drain_proximity",
        confidence: "high",
        severity: "high",
        status: "active",
        source_name: "forensic_route_search",
        source_url: null,
        notes: "Derived marker.",
        evidence_json: { source: "forensic_route_search" },
        created_by_telegram_id: null,
        first_seen_at: new Date("2026-05-24T00:00:00.000Z"),
        last_seen_at: new Date("2026-05-24T00:00:00.000Z"),
        created_at: new Date("2026-05-24T00:00:00.000Z"),
        updated_at: new Date("2026-05-24T00:00:00.000Z")
      }
    ]);

    await upsertAddressLabelAssertion(tx.db, {
      id: "derived-approval-drain-1",
      chain: "tron",
      address: "TSubject111111111111111111111111111111",
      label: "approval_drain_proximity",
      entityName: "Derived approval-drain proximity",
      category: "approval_drain_proximity",
      confidence: "high",
      severity: "high",
      status: "active",
      sourceName: "forensic_route_search",
      evidenceJson: { source: "forensic_route_search" },
      createdByTelegramId: null
    });

    const labelInsert = tx.queries.find((query) => query.sql.includes("insert into address_labels"));
    expect(labelInsert?.params).toEqual([
      "TSubject111111111111111111111111111111",
      "approval_drain_proximity",
      "system",
      null
    ]);
  });
});
