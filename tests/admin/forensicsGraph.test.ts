import { describe, expect, it } from "vitest";
import { projectForensicJobGraph } from "../../src/admin/forensicsGraph";
import type { ForensicCheckJob } from "../../src/storage/repositories";

function job(overrides: Partial<ForensicCheckJob> = {}): ForensicCheckJob {
  return {
    id: "job-1",
    kind: "where_is_money_check",
    subjectAddress: "TSubject111111111111111111111111111111",
    status: "completed",
    windowStart: new Date("2026-06-01T00:00:00.000Z"),
    windowEnd: new Date("2026-06-01T01:00:00.000Z"),
    priority: 100,
    chatId: null,
    messageId: null,
    requestedBy: "123",
    progressJson: {},
    resultJson: {},
    rawEvidenceIds: ["raw-1"],
    observationIds: ["obs-1"],
    lastError: null,
    createdAt: new Date("2026-06-01T00:00:01.000Z"),
    updatedAt: new Date("2026-06-01T00:10:00.000Z"),
    startedAt: new Date("2026-06-01T00:00:02.000Z"),
    completedAt: new Date("2026-06-01T00:10:00.000Z"),
    ...overrides
  };
}

describe("projectForensicJobGraph", () => {
  it("projects a completed where-is-money job into graph JSON", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        riskScore: 35,
        decision: "ACCEPTABLE",
        coverage: {
          coverageRatio: 0.95,
          selectedAmountRaw: "950000000",
          targetAmountRaw: "1000000000",
          selectedInboundTxCount: 2
        },
        assessment: {
          decision: "ACCEPTABLE",
          riskScore: 35,
          provenanceConfidence: 67,
          reasons: ["95% of the requested amount was covered"]
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "weak_amount_or_time_continuity",
            riskScoreContribution: 20,
            amountRaw: "500000000",
            txHashes: ["tx-1"],
            addresses: [
              "TSource1111111111111111111111111111111",
              "TSubject111111111111111111111111111111"
            ]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.job.id).toBe("job-1");
    expect(result.graph.subject.address).toBe("TSubject111111111111111111111111111111");
    expect(result.graph.summary.decision).toBe("ACCEPTABLE");
    expect(result.graph.summary.riskScore).toBe(35);
    expect(result.graph.summary.coverageRatio).toBe(0.95);
    expect(result.graph.nodes.some((node) => node.kind === "subject")).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === "stop")).toBe(true);
    expect(result.graph.edges.some((edge) => edge.txHash === "tx-1")).toBe(true);
    expect(result.graph.paths[0]?.stopReason).toBe("weak_amount_or_time_continuity");
    expect(result.graph.weights[0]?.value).toBe(20);
    expect(result.graph.evidence.map((item) => item.id)).toContain("raw-1");
  });

  it("returns not_ready for queued and running jobs", () => {
    expect(projectForensicJobGraph(job({ status: "queued" }))).toMatchObject({
      ok: false,
      status: "not_ready"
    });
    expect(projectForensicJobGraph(job({ status: "running" }))).toMatchObject({
      ok: false,
      status: "not_ready"
    });
  });
});
