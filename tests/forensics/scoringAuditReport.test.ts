import { describe, expect, it } from "vitest";
import {
  buildScoringAuditReport,
  formatScoringAuditMarkdown
} from "../../src/forensics/scoringAuditReport";
import type { ScoringAuditRow } from "../../src/risk/scoringAudit";

function row(overrides: Partial<ScoringAuditRow> = {}): ScoringAuditRow {
  return {
    jobId: "job-base",
    kind: "address_deep_check",
    subjectAddress: "TSubject111111111111111111111111111111",
    status: "completed",
    finalScore: 10,
    riskLevel: "LOW",
    productionDecision: "ACCEPTABLE",
    auditDecision: "ACCEPTABLE",
    coverageStatus: "complete",
    confidenceScore: 100,
    evidenceClass: "none",
    hardEvidenceObserved: false,
    activeAnchorCode: null,
    activeAnchorScore: null,
    dampener: null,
    policyVersion: "risk-clarity-v1",
    missingChecks: [],
    cohorts: [],
    limitations: [],
    ...overrides
  };
}

describe("scoring audit report", () => {
  it("builds totals and cohort counts from rows", () => {
    const report = buildScoringAuditReport([
      row({
        jobId: "job-high",
        cohorts: ["high_score_partial_coverage", "decline_without_hard_evidence"]
      }),
      row({
        jobId: "job-acceptable",
        cohorts: ["acceptable_limited_coverage"]
      })
    ], new Date("2026-06-26T12:00:00.000Z"));

    expect(report.generatedAt).toBe("2026-06-26T12:00:00.000Z");
    expect(report.totalJobs).toBe(2);
    expect(report.cohorts).toMatchObject({
      high_score_partial_coverage: 1,
      acceptable_limited_coverage: 1,
      decline_without_hard_evidence: 1,
      hard_evidence_cases: 0
    });
  });

  it("formats compact markdown with sorted readable flagged rows", () => {
    const report = buildScoringAuditReport([
      row({
        jobId: "job-low",
        subjectAddress: "TLow11111111111111111111111111111111",
        finalScore: 12,
        cohorts: ["acceptable_limited_coverage"],
        coverageStatus: "limited",
        missingChecks: ["provider timeout"]
      }),
      row({
        jobId: "job-high",
        subjectAddress: "THigh1111111111111111111111111111111",
        finalScore: 88,
        productionDecision: "DECLINE",
        auditDecision: "DECLINE",
        coverageStatus: "partial",
        cohorts: ["high_score_partial_coverage", "decline_without_hard_evidence"],
        missingChecks: ["bridge boundary"]
      }),
      row({
        jobId: "job-mid",
        subjectAddress: "TMid11111111111111111111111111111111",
        finalScore: 41,
        cohorts: []
      })
    ], new Date("2026-06-26T12:00:00.000Z"));

    const markdown = formatScoringAuditMarkdown(report);

    expect(markdown).toContain("# Scoring Audit Report");
    expect(markdown).toContain("Generated: 2026-06-26T12:00:00.000Z");
    expect(markdown).toContain("Total jobs: 3");
    expect(markdown).toContain("## Cohorts");
    expect(markdown).toContain("| Cohort | Count |");
    expect(markdown).toContain("high_score_partial_coverage");
    expect(markdown).toContain("acceptable_limited_coverage");
    expect(markdown).toContain("## Top Flagged Rows");
    expect(markdown).toContain("| Job | Score | Production | Audit | Coverage | Cohorts | Missing |");
    expect(markdown).toContain("job-high");
    expect(markdown).toContain("THigh1111111111111111111111111111111");
    expect(markdown).toContain("bridge boundary");
    expect(markdown.indexOf("job-high")).toBeLessThan(markdown.indexOf("job-low"));
    expect(markdown).not.toContain("job-mid");
  });
});
