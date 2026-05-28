import type { RiskCaseEvidenceType, RiskCaseFile } from "../types";

export function createEvidenceId(type: RiskCaseEvidenceType, sourceId: string): string {
  return `${type}:${sourceId}`;
}

function snapshot<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => snapshot(item)) as T;
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, snapshot(nestedValue)])
    ) as T;
  }

  return value;
}

export function createRiskCaseFile(
  input: Omit<RiskCaseFile, "schemaVersion" | "audit"> & {
    sourceJobId?: string;
    createdAt?: string;
  }
): RiskCaseFile {
  const knownEvidenceIds = new Set(input.deterministicEvidence.map((evidence) => evidence.id));

  for (const reason of input.scoring.reasons) {
    for (const evidenceId of reason.evidenceIds) {
      if (!knownEvidenceIds.has(evidenceId)) {
        throw new Error(`Unknown evidence id: ${evidenceId}`);
      }
    }
  }

  const deterministicEvidence = snapshot(input.deterministicEvidence);

  return {
    schemaVersion: "risk-case-v1",
    policyVersion: input.policyVersion,
    subject: snapshot(input.subject),
    deterministicEvidence,
    scoring: snapshot(input.scoring),
    coverage: snapshot(input.coverage),
    audit: {
      createdAt: input.createdAt ?? new Date().toISOString(),
      sourceJobId: input.sourceJobId,
      evidenceIds: deterministicEvidence.map((evidence) => evidence.id)
    }
  };
}
