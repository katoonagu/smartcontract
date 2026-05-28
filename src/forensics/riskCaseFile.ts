import type { RiskCaseEvidenceType, RiskCaseFile } from "../types";

export function createEvidenceId(type: RiskCaseEvidenceType, sourceId: string): string {
  return `${type}:${sourceId}`;
}

export function createRiskCaseFile(
  input: Omit<RiskCaseFile, "schemaVersion" | "audit"> & {
    sourceJobId?: string;
    createdAt?: string;
  }
): RiskCaseFile {
  return {
    schemaVersion: "risk-case-v1",
    policyVersion: input.policyVersion,
    subject: input.subject,
    deterministicEvidence: input.deterministicEvidence,
    scoring: input.scoring,
    coverage: input.coverage,
    audit: {
      createdAt: input.createdAt ?? new Date().toISOString(),
      sourceJobId: input.sourceJobId,
      evidenceIds: input.deterministicEvidence.map((evidence) => evidence.id)
    }
  };
}
