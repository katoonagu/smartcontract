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

  it("projects the persisted nested where-is-money report shape", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: {
          subjectAddress: "TSubject111111111111111111111111111111",
          riskScore: 72,
          decision: "REVIEW",
          coverage: {
            coverageRatio: 0.42,
            selectedAmountRaw: "420000000",
            targetAmountRaw: "1000000000"
          },
          assessment: {
            decision: "REVIEW",
            riskScore: 72,
            provenanceConfidence: 38,
            reasons: ["Nested report reason"]
          },
          originPaths: [
            {
              verdict: "REVIEW",
              stoppedReason: "service_boundary",
              riskScoreContribution: 31,
              amountRaw: "420000000",
              txHashes: ["tx-nested"],
              addresses: [
                "TNestedSource1111111111111111111111111",
                "TSubject111111111111111111111111111111"
              ]
            }
          ]
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.summary.decision).toBe("REVIEW");
    expect(result.graph.summary.riskScore).toBe(72);
    expect(result.graph.summary.coverageRatio).toBe(0.42);
    expect(result.graph.paths[0]?.stopReason).toBe("service_boundary");
    expect(result.graph.edges.some((edge) => edge.txHash === "tx-nested")).toBe(true);
    expect(result.graph.weights[0]?.value).toBe(31);
  });

  it("scopes evidence refs to paths that declare each evidence id", () => {
    const result = projectForensicJobGraph(job({
      rawEvidenceIds: ["raw-a", "raw-b"],
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        riskScore: 55,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 0.9
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 55,
          provenanceConfidence: 70,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "weak_amount_or_time_continuity",
            riskScoreContribution: 20,
            amountRaw: "500000000",
            evidenceIds: ["raw-a"],
            txHashes: ["tx-a"],
            addresses: [
              "TSourceA111111111111111111111111111111",
              "TSubject111111111111111111111111111111"
            ]
          },
          {
            verdict: "DECLINE",
            stoppedReason: "risky_source_wallet",
            riskScoreContribution: 45,
            amountRaw: "400000000",
            evidenceIds: ["raw-b"],
            txHashes: ["tx-b"],
            addresses: [
              "TSourceB111111111111111111111111111111",
              "TSubject111111111111111111111111111111"
            ]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const rawA = result.graph.evidence.find((item) => item.id === "raw-a");
    const rawB = result.graph.evidence.find((item) => item.id === "raw-b");
    expect(rawA?.pathIds).toContain("path:0");
    expect(rawA?.pathIds).not.toContain("path:1");
    expect(rawB?.pathIds).toContain("path:1");
    expect(rawB?.pathIds).not.toContain("path:0");
  });

  it("keeps job raw evidence unscoped when paths do not declare evidence ids", () => {
    const result = projectForensicJobGraph(job({
      rawEvidenceIds: ["raw-a", "raw-b"],
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        riskScore: 55,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 0.9
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 55,
          provenanceConfidence: 70,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "weak_amount_or_time_continuity",
            riskScoreContribution: 20,
            amountRaw: "500000000",
            txHashes: ["tx-a"],
            addresses: [
              "TSourceA111111111111111111111111111111",
              "TSubject111111111111111111111111111111"
            ]
          },
          {
            verdict: "DECLINE",
            stoppedReason: "risky_source_wallet",
            riskScoreContribution: 45,
            amountRaw: "400000000",
            txHashes: ["tx-b"],
            addresses: [
              "TSourceB111111111111111111111111111111",
              "TSubject111111111111111111111111111111"
            ]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.paths.every((path) => path.evidenceIds.length === 0)).toBe(true);
    expect(result.graph.edges.every((edge) => edge.evidenceIds.length === 0)).toBe(true);
    expect(result.graph.evidence.map((item) => item.id).sort()).toEqual(["raw-a", "raw-b"]);
    expect(result.graph.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "raw-a", pathIds: [], edgeIds: [], nodeIds: [] }),
      expect.objectContaining({ id: "raw-b", pathIds: [], edgeIds: [], nodeIds: [] })
    ]));
  });
});
