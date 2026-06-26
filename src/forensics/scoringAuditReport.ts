import { cohortCounts, type ScoringAuditCohort, type ScoringAuditRow } from "../risk/scoringAudit";

export type ScoringAuditReport = {
  generatedAt: string;
  totalJobs: number;
  cohorts: Record<ScoringAuditCohort, number>;
  rows: ScoringAuditRow[];
};

export function buildScoringAuditReport(
  rows: ScoringAuditRow[],
  generatedAt: Date = new Date()
): ScoringAuditReport {
  return {
    generatedAt: generatedAt.toISOString(),
    totalJobs: rows.length,
    cohorts: cohortCounts(rows),
    rows: [...rows]
  };
}

export function formatScoringAuditMarkdown(report: ScoringAuditReport): string {
  return [
    "# Scoring Audit Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Total jobs: ${report.totalJobs}`,
    "",
    "## Cohorts",
    "",
    "| Cohort | Count |",
    "| --- | ---: |",
    ...Object.entries(report.cohorts).map(([cohort, count]) => `| ${cell(cohort)} | ${count} |`),
    "",
    "## Top Flagged Rows",
    "",
    "| Job | Score | Production | Audit | Coverage | Cohorts | Missing |",
    "| --- | ---: | --- | --- | --- | --- | --- |",
    ...topFlaggedRows(report.rows).map(formatRow)
  ].join("\n");
}

function topFlaggedRows(rows: ScoringAuditRow[]): ScoringAuditRow[] {
  return rows
    .filter((row) => row.cohorts.length > 0)
    .sort((left, right) => {
      const scoreDelta = (right.finalScore ?? -1) - (left.finalScore ?? -1);
      if (scoreDelta !== 0) return scoreDelta;
      const cohortDelta = right.cohorts.length - left.cohorts.length;
      if (cohortDelta !== 0) return cohortDelta;
      return left.jobId.localeCompare(right.jobId);
    })
    .slice(0, 10);
}

function formatRow(row: ScoringAuditRow): string {
  return [
    cell(`${row.jobId} (${row.subjectAddress})`),
    row.finalScore === null ? "-" : String(row.finalScore),
    cell(row.productionDecision),
    cell(row.auditDecision),
    cell(row.coverageStatus),
    cell(row.cohorts.join(", ")),
    cell(row.missingChecks.length === 0 ? "-" : row.missingChecks.join(", "))
  ].join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function cell(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}
