import { describe, expect, it } from "vitest";
import { saveForensicRouteSearchResult } from "../../src/storage/repositories";
import type { Db } from "../../src/storage/db";
import type { RawEvidenceInput, RiskSignalObservationInput } from "../../src/types";

function createMockTransactionalDb(): {
  db: Db;
  queries: { sql: string; params: unknown[] }[];
  released: boolean;
} {
  const queries: { sql: string; params: unknown[] }[] = [];
  let released = false;
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return { rows: [], rowCount: 1 };
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

describe("forensic route search repositories", () => {
  it("saves a route-search case, ranked path, edges, and evidence atomically", async () => {
    const tx = createMockTransactionalDb();
    const rawEvidence: RawEvidenceInput = {
      id: "route-evidence-1",
      source: "forensic_route_search",
      sourceType: "detector_output",
      chain: "tron",
      address: "TSource111111111111111111111111111111",
      txHash: "tx-1",
      observedTransactionHash: "tx-1",
      evidenceJson: { caseId: "case-1", pathIds: ["path-1"] }
    };
    const observation: RiskSignalObservationInput = {
      id: "route-observation-1",
      subjectChain: "tron",
      subjectAddress: "TTarget111111111111111111111111111111",
      subjectTxHash: null,
      observedTransactionHash: "tx-1",
      signalGroup: "graph",
      code: "forensic_route_candidate",
      message: "Candidate path links source to target for manual review",
      scoreImpact: 82,
      confidence: "medium",
      severity: "high",
      source: "forensic_route_search",
      policyVersion: "2026-05-24-forensic-route-v1",
      rawEvidenceId: "route-evidence-1"
    };

    await saveForensicRouteSearchResult(tx.db, {
      case: {
        id: "case-1",
        sourceAddress: "TSource111111111111111111111111111111",
        targetAddress: "TTarget111111111111111111111111111111",
        amountUsdt: "320000",
        windowStart: new Date("2026-05-01T00:00:00.000Z"),
        windowEnd: new Date("2026-05-31T00:00:00.000Z"),
        status: "completed"
      },
      rawEvidence: [rawEvidence],
      observations: [observation],
      paths: [
        {
          id: "path-1",
          caseId: "case-1",
          rank: 1,
          score: 82,
          confidence: "medium",
          pathAddresses: ["TSource111111111111111111111111111111", "THop1111111111111111111111111111111", "TTarget111111111111111111111111111111"],
          features: [{ code: "amount_preservation", label: "96% amount preserved", scoreImpact: 22 }],
          reasons: [{ code: "possible_money_flow_link", message: "Candidate path preserves most of the amount", scoreImpact: 22 }],
          rawEvidenceId: "route-evidence-1",
          edges: [
            {
              id: "edge-1",
              fromAddress: "TSource111111111111111111111111111111",
              toAddress: "THop1111111111111111111111111111111",
              txHash: "tx-1",
              amountRaw: "320000000000",
              timestamp: new Date("2026-05-05T10:00:00.000Z"),
              method: "transfer",
              edgeType: "normal_transfer"
            }
          ]
        }
      ]
    });

    expect(tx.queries[0].sql).toBe("begin");
    expect(tx.queries.some((query) => query.sql.includes("insert into forensic_cases"))).toBe(true);
    expect(tx.queries.some((query) => query.sql.includes("delete from forensic_route_paths"))).toBe(true);
    expect(tx.queries.some((query) => query.sql.includes("insert into raw_evidence"))).toBe(true);
    expect(tx.queries.some((query) => query.sql.includes("insert into risk_signal_observations"))).toBe(true);
    expect(tx.queries.some((query) => query.sql.includes("insert into forensic_route_paths"))).toBe(true);
    expect(tx.queries.some((query) => query.sql.includes("insert into forensic_route_edges"))).toBe(true);
    expect(tx.queries.at(-1)?.sql).toBe("commit");
    expect(tx.released).toBe(true);
  });
});
